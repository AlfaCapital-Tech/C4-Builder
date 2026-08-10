import fs from 'node:fs';
import path from 'node:path';

// Второй бэкенд рендера: D2 (terrastruct) через @terrastruct/d2 (WASM → SVG).
// Пакет ~60 МБ и поднимает webworker, поэтому это опциональная зависимость с
// ленивой загрузкой: движок инициализируется единожды за прогон и только когда
// в дереве есть .d2. Импорты D2 (`@`/`...@`) c4builder резолвит сам и подаёт
// движку виртуальной файловой системой — тот же граф питает и чексумму кэша.

// Минимальный контракт движка @terrastruct/d2 (внешний, без привязки к его типам,
// skipLibCheck-политика) — только то, что реально используется здесь.
interface D2Compiled {
    diagram: unknown;
    renderOptions: unknown;
}
interface D2Engine {
    ready?: Promise<unknown>;
    worker?: { terminate(): Promise<void> };
    compile(request: unknown): Promise<D2Compiled>;
    render(diagram: unknown, renderOptions: unknown): Promise<string>;
}

// Кешируем сам промис инициализации (а не разрешённый инстанс): иначе два
// параллельных первых вызова оба увидят null и создадут по воркеру — один утечёт.
// null — «ещё не грузили».
let d2Promise: Promise<D2Engine> | null = null;

// Ленивый singleton через динамический import(): @terrastruct/d2 (~60 МБ, поднимает
// webworker) — опциональная зависимость, поэтому грузится только при первом вызове,
// а не на импорте модуля.
const getD2 = (): Promise<D2Engine> => {
    if (d2Promise) return d2Promise;
    d2Promise = (async () => {
        let mod: typeof import('@terrastruct/d2');
        try {
            mod = await import('@terrastruct/d2');
        } catch (err) {
            d2Promise = null; // провал импорта не кешируем — даём повторить
            const e = err as Error;
            throw new Error(
                'Для рендера .d2-диаграмм нужен пакет @terrastruct/d2 (опциональная зависимость, ~60 МБ).\n' +
                    'Установите его: npm install @terrastruct/d2\n' +
                    `Исходная ошибка: ${e.message || e}`
            );
        }
        return new mod.D2() as unknown as D2Engine;
    })();
    return d2Promise;
};

// Явный teardown: webworker иначе держит процесс и CLI не завершается. Зовётся из
// CLI (dispatch) после ОДИНОЧНОЙ сборки — в watch-режиме воркер переживает ребилды
// (его пересоздание на каждый ребилд стоило секунды), а при Ctrl+C умирает с процессом.
// НЕ должен бросать: его throw затёр бы исходную причину падения сборки. Все ошибки
// освобождения глушим (движок уже мёртв — то, что надо освободить, и так освобождено).
// Идемпотентен: d2Promise=null в начале. Кеш графа импортов сбрасывает не он, а
// clearD2FileCache() на границах build().
const teardownD2 = async (): Promise<void> => {
    if (!d2Promise) return;
    const pending = d2Promise;
    d2Promise = null;
    let inst: D2Engine;
    try {
        inst = await pending;
    } catch {
        return; // движок не инициализировался — освобождать нечего
    }
    try {
        await inst.ready; // worker создаётся асинхронно в init()
    } catch {
        // init движка мог упасть — это уже отражено ошибкой рендера; глушим, иначе
        // throw из finally build() подменил бы исходную причину падения сборки.
    }
    try {
        if (inst.worker) await inst.worker.terminate();
    } catch {
        // воркер уже недоступен/мёртв — освобождать нечего.
    }
};

// Разрешить ссылку импорта в .d2-файл на диске. Расширение .d2 подразумевается,
// а `@file.key1.key2` — частичный импорт: имя файла это префикс до ключевого пути,
// поэтому отрезаем хвостовые .key-сегменты, пока не найдём существующий файл.
const resolveImport = (ref: string, fromDir: string): string | null => {
    const segs = ref.split('.');
    for (let i = segs.length; i >= 1; i--) {
        const candidate = path.resolve(fromDir, `${segs.slice(0, i).join('.')}.d2`);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
};

// Собрать граф импортов от входного .d2 рекурсивно: { абсолютный путь -> контент }.
// Лидирующий `@` не после word-символа отсекает почтовые адреса (`foo@bar`).
// Путь импорта поддерживает пробелы и юникод (папки `4 D2 Example`, `3 Локализация`),
// а также закавыченную форму `@"путь с пробелом"` — движок @terrastruct/d2
// принимает все три (проверено эмпирически). Незакавыченный путь читается до
// терминатора statement (`#` комментарий, `;`, `}`, перевод строки) минус хвостовой
// пробел — иначе инлайновый spread `x: { ...@lib }` захватил бы `lib }`. Флаг `u` —
// корректный юникод. Хвостовые `.key`-сегменты частичного импорта отрезает resolveImport.
const IMPORT_RE = /(?<!\w)@(?:"([^"\n]+)"|([^\s"#;}\n][^#;}\n]*?)\s*(?=[#;}\n]|$))/gu;

const collectFiles = (entryAbs: string, acc: Map<string, string> = new Map()): Map<string, string> => {
    const abs = path.resolve(entryAbs);
    if (acc.has(abs)) return acc;
    let content: string;
    try {
        // Строго UTF-8: язык D2 определён поверх UTF-8, опция CHARSET конфига относится
        // к PlantUML (уходит в -charset) и на .d2 сознательно не распространяется.
        content = fs.readFileSync(abs, 'utf-8');
    } catch {
        return acc;
    }
    acc.set(abs, content);
    // matchAll снимает все совпадения независимым итератором и не делит lastIndex
    // между вложенными вызовами — иначе рекурсия затирала бы позицию глобального
    // regex и вложенные (2-го уровня) импорты молча терялись бы.
    for (const m of content.matchAll(IMPORT_RE)) {
        const ref = m[1] ?? m[2]; // закавыченный | незакавыченный путь
        if (!ref) continue;
        const resolved = resolveImport(ref, path.dirname(abs));
        if (resolved) collectFiles(resolved, acc);
    }
    return acc;
};

// Мемоизация графа на время одной сборки: foldD2Imports (чексумма) и
// buildCompileRequest (рендер) иначе читают один и тот же граф с диска дважды.
// Ключ — абсолютный путь входного файла. Сбрасывается clearD2FileCache() на границах
// build(), иначе watch-режим отдавал бы устаревшее содержимое. Возвращаемую Map
// потребители НЕ мутируют (foldD2Imports исключает входной файл фильтром, не delete).
let filesMemo: Map<string, Map<string, string>> | null = null;
const clearD2FileCache = (): void => {
    filesMemo = null;
};
const collectFilesCached = (entryAbs: string): Map<string, string> => {
    const abs = path.resolve(entryAbs);
    if (!filesMemo) filesMemo = new Map();
    const hit = filesMemo.get(abs);
    if (hit) return hit;
    const built = collectFiles(abs);
    filesMemo.set(abs, built);
    return built;
};

// Общий корень набора путей — чтобы ключи виртуальной fs были относительны ему и
// родительские импорты (`...@../c4lib`) резолвились движком как на реальном диске.
const commonAncestor = (files: string[]): string => {
    const dirs = files.map((f) => path.dirname(f).split(path.sep));
    const min = Math.min(...dirs.map((d) => d.length));
    const common = [];
    for (let i = 0; i < min; i++) {
        const seg = dirs[0][i];
        if (dirs.every((d) => d[i] === seg)) common.push(seg);
        else break;
    }
    return common.join(path.sep) || path.sep;
};

// Подготовить аргументы compile(): виртуальная fs (все файлы графа) + inputPath.
const buildCompileRequest = (entryAbs: string): { fs: Record<string, string>; inputPath: string } => {
    const files = collectFilesCached(entryAbs);
    // Пустой граф = не прочитался сам входной файл (удалён/недоступен — гонка в watch).
    // Без guard'а commonAncestor([]) давал бы сырой TypeError (Math.min()=Infinity).
    if (files.size === 0) {
        throw new Error(`D2: не удалось прочитать ${entryAbs} (файл удалён или недоступен?)`);
    }
    const root = commonAncestor([...files.keys()]);
    const toKey = (abs: string): string => path.relative(root, abs).split(path.sep).join('/');
    const fsMap: Record<string, string> = {};
    for (const [abs, content] of files) fsMap[toKey(abs)] = content;
    return { fs: fsMap, inputPath: toKey(path.resolve(entryAbs)) };
};

// Рендер .d2 → SVG (Buffer). Ошибки компиляции пробрасываются с путём файла.
const renderD2 = async (
    entryAbs: string,
    { layout = 'dagre' }: { layout?: string } = {}
): Promise<Buffer> => {
    const d2 = await getD2();
    const { fs: fsMap, inputPath } = buildCompileRequest(entryAbs);
    let result: D2Compiled;
    try {
        result = await d2.compile({ fs: fsMap, inputPath, options: { layout } });
    } catch (err) {
        const e = err as Error;
        throw new Error(`Ошибка компиляции D2 (${entryAbs}):\n${e.message || e}`);
    }
    let svg: string;
    try {
        svg = await d2.render(result.diagram, result.renderOptions);
    } catch (err) {
        const e = err as Error;
        throw new Error(`Ошибка рендера D2 (${entryAbs}):\n${e.message || e}`);
    }
    return Buffer.from(svg, 'utf8');
};

// Материал импортов для чексуммы кэша (без самого входного файла — его контент
// хэшируется отдельно). Правка импортируемого .d2 меняет чексумму зависимой
// диаграммы — аналог foldIncludes для PlantUML.
// Путь в материале — относительный к cwd, posix-разделители: чексумма не зависит
// от машины/чекаута/ОС (абсолютный путь делал кеш непереносимым).
const foldD2Imports = (entryAbs: string): string => {
    const abs = path.resolve(entryAbs);
    const files = collectFilesCached(entryAbs);
    const rel = (p: string): string => path.relative(process.cwd(), p).split(path.sep).join('/');
    // Мемоизированную Map не мутируем (её же использует buildCompileRequest) —
    // входной файл исключаем фильтром, а не delete. Сортировка по относительному
    // ключу — тому же, что уходит в материал.
    return [...files.entries()]
        .filter(([p]) => p !== abs)
        .map(([p, content]) => [rel(p), content])
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([p, content]) => ` ${p} ${content}`)
        .join('');
};

export { renderD2, foldD2Imports, teardownD2, clearD2FileCache };
