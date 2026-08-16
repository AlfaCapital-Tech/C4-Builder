// Сканер OpenSpec-store: активные change'ы, архив, спеки. Только файловая система —
// `openspec` CLI не шеллим (сборка не зависит от его наличия/версии).
import fs from 'node:fs';
import path from 'node:path';

export interface Artifact {
    /** Имя без расширения: proposal, design, tasks, plan… */
    name: string;
    content: string;
}

export interface Delta {
    /** Относительный posix-путь от папки change'а: specs/<…>/spec.md */
    relPath: string;
    content: string;
}

export interface Change {
    id: string;
    dir: string;
    archived: boolean;
    artifacts: Artifact[];
    deltas: Delta[];
    schema?: string;
    created?: string;
    /** Прогресс чекбоксов tasks.md; undefined — нет tasks.md или чекбоксов. */
    progress?: { done: number; total: number };
    /** max mtime файлов change'а, мс. */
    mtime: number;
}

export interface Spec {
    /** Сегменты пути от specs/: ['sales-copilot', 'copilot-calls-tab']. */
    path: string[];
    content: string;
}

export interface Store {
    changes: Change[];
    archive: Change[];
    specs: Spec[];
}

const listDirs = (dir: string): string[] =>
    fs.existsSync(dir)
        ? fs
              .readdirSync(dir, { withFileTypes: true })
              .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
              .map((e) => e.name)
              .sort()
        : [];

// Все spec.md под dir рекурсивно: относительные posix-пути (сортировано).
const findSpecFiles = (dir: string, rel = ''): string[] => {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const e of fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) out.push(...findSpecFiles(path.join(dir, e.name), r));
        else if (e.name === 'spec.md') out.push(r);
    }
    return out;
};

// Прогресс по чекбоксам: `- [ ]` / `- [x]` в любом месте tasks.md.
export const taskProgress = (tasks: string): { done: number; total: number } | undefined => {
    const boxes = [...tasks.matchAll(/^[ \t]*[-*+][ \t]+\[([ xX])\]/gm)];
    if (!boxes.length) return undefined;
    return { done: boxes.filter((m) => m[1] !== ' ').length, total: boxes.length };
};

// Метаданные `.openspec.yaml` построчно: нужны два скаляра, yaml-парсер избыточен.
const readMeta = (file: string): { schema?: string; created?: string } => {
    if (!fs.existsSync(file)) return {};
    const meta: { schema?: string; created?: string } = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^(schema|created):\s*(.+?)\s*$/);
        if (m) meta[m[1] as 'schema' | 'created'] = m[2].replace(/^["']|["']$/g, '');
    }
    return meta;
};

const scanChange = (dir: string, archived: boolean): Change => {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    let mtime = 0;
    const touch = (file: string): void => {
        mtime = Math.max(mtime, fs.statSync(file).mtimeMs);
    };
    const artifacts: Artifact[] = files
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
        .map((e) => e.name)
        .sort()
        .map((name) => {
            const file = path.join(dir, name);
            touch(file);
            return { name: name.slice(0, -3), content: fs.readFileSync(file, 'utf8') };
        });
    const deltas: Delta[] = findSpecFiles(path.join(dir, 'specs'), 'specs').map((relPath) => {
        const file = path.join(dir, relPath);
        touch(file);
        return { relPath, content: fs.readFileSync(file, 'utf8') };
    });
    const metaFile = path.join(dir, '.openspec.yaml');
    if (fs.existsSync(metaFile)) touch(metaFile);
    const tasks = artifacts.find((a) => a.name === 'tasks');
    return {
        id: path.basename(dir),
        dir,
        archived,
        artifacts,
        deltas,
        ...readMeta(metaFile),
        progress: tasks ? taskProgress(tasks.content) : undefined,
        mtime
    };
};

/** Читает store целиком; отсутствующие подпапки (changes/, specs/) — пустые списки. */
export const scanStore = (storeDir: string): Store => {
    const changesDir = path.join(storeDir, 'changes');
    const archiveDir = path.join(changesDir, 'archive');
    const specsDir = path.join(storeDir, 'specs');
    return {
        changes: listDirs(changesDir)
            .filter((n) => n !== 'archive')
            .map((n) => scanChange(path.join(changesDir, n), false)),
        // Архив — от новых к старым: имя начинается с даты архивации.
        archive: listDirs(archiveDir)
            .reverse()
            .map((n) => scanChange(path.join(archiveDir, n), true)),
        specs: findSpecFiles(specsDir).map((rel) => ({
            path: rel.split('/').slice(0, -1),
            content: fs.readFileSync(path.join(specsDir, rel), 'utf8')
        }))
    };
};
