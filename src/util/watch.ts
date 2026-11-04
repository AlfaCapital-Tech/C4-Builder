import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

type Emit = (p: string) => void;
type Report = (err: NodeJS.ErrnoException) => void;

// Наблюдение за деревьями папок: onChange получает абсолютные пути, изменившиеся за delayMs
// от первого события, одной пачкой — одно сохранение даёт один ребилд, а непрерывная запись не
// откладывает его бесконечно. ignore — путь не наблюдается и не даёт событий (выход сборки,
// .c4builder*). Возвращает функцию остановки.
export const watchTree = (
    roots: string[],
    { ignore = () => false, delayMs = 200 }: { ignore?: (p: string) => boolean; delayMs?: number },
    onChange: (paths: string[]) => void
): (() => void) => {
    const pending = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    const emit: Emit = (p) => {
        if (ignore(p)) return;
        pending.add(p);
        timer ??= setTimeout(() => {
            timer = undefined;
            const paths = [...pending];
            pending.clear();
            onChange(paths);
        }, delayMs);
    };
    let warned = false;
    const report: Report = (err) => {
        if (warned) return;
        warned = true;
        const hint = err.code === 'ENOSPC' ? ' (raise fs.inotify.max_user_watches)' : '';
        console.log(chalk.yellow(`watch: ${err.message}${hint} — some changes may be missed`));
    };
    const closers =
        process.platform === 'linux'
            ? [perDirectory(roots, emit, ignore, report)]
            : roots.map((root) => native(root, emit, report));
    return () => {
        clearTimeout(timer);
        for (const close of closers) close();
    };
};

// macOS и Windows: рекурсия в ядре (FSEvents, ReadDirectoryChangesW), замену файла видит.
const native = (root: string, emit: Emit, report: Report): (() => void) => {
    try {
        const w = fs.watch(root, { recursive: true }, (_e, name) =>
            emit(name ? path.join(root, name) : root)
        );
        w.on('error', report);
        return () => w.close();
    } catch (err) {
        report(err as NodeJS.ErrnoException);
        return () => {};
    }
};

// Встроенный recursive на Linux до Node 24.22 / 26.9 (и во всех 22.x) следит за каждым файлом
// по пути: файл, заменённый переименованием (sed -i, safe write редакторов), выпадает из
// наблюдения навсегда (#53; в Node исправлено в nodejs/node#65486). Здесь fs.watch на каждую
// папку: она видит правки и переименования своих файлов, новые подпапки подписываются по событию.
// ponytail: свой обход, пока engines пускает Node без исправления; поднимем — native везде.
const perDirectory = (
    roots: string[],
    emit: Emit,
    ignore: (p: string) => boolean,
    report: Report
): (() => void) => {
    const watchers = new Map<string, fs.FSWatcher>();
    const unwatch = (dir: string): void => {
        for (const [d, w] of watchers)
            if (d === dir || d.startsWith(dir + path.sep)) {
                w.close();
                watchers.delete(d);
            }
    };
    const scan = (dir: string): void => {
        if (ignore(dir) || watchers.has(dir)) return;
        try {
            const w = fs.watch(dir, (event, name) => {
                const p = name ? path.join(dir, name) : dir;
                // rename подпапки (mv, rm + mkdir): прежний inode ушёл, а его номер мог достаться
                // новой папке — сверка inode не спасает, подписка всегда заново.
                if (event === 'rename' && watchers.has(p)) unwatch(p);
                fs.stat(p, (err, st) => {
                    if (!err && st.isDirectory()) scan(p);
                });
                emit(p);
            });
            w.on('error', () => unwatch(dir));
            watchers.set(dir, w);
            for (const e of fs.readdirSync(dir, { withFileTypes: true }))
                if (e.isDirectory()) scan(path.join(dir, e.name));
        } catch (err) {
            // Папку удалили между событием и обходом — её уход придёт событием родителя.
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') report(err as NodeJS.ErrnoException);
        }
    };
    for (const root of roots) scan(root);
    return () => {
        for (const w of watchers.values()) w.close();
        watchers.clear();
    };
};
