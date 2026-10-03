import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { clearD2FileCache, clearIncludeCache, foldD2Imports, foldIncludes } from './dist.mjs';
import { TMP_ROOT } from './helpers.mjs';

// Материал зависимостей диаграмм уходит в чексумму кэша картинок: строки ниже
// зафиксированы на коде ДО выделения общего резолвера (collectIncludes/d2LocalImports).
// Любое их изменение = инвалидация кэша у всех потребителей разом.
let dir;
let rel; // префикс путей в материале: относительный к cwd, posix

const write = (relPath, content) => {
    fs.mkdirSync(path.join(dir, path.dirname(relPath)), { recursive: true });
    fs.writeFileSync(path.join(dir, relPath), content);
};

beforeAll(() => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    dir = fs.mkdtempSync(path.join(TMP_ROOT, 'deps-'));
    rel = path.relative(process.cwd(), dir).split(path.sep).join('/');
    // PlantUML: вложенный include, повтор, поиск от include-пути, !includesub с частью
    write('p/a.iuml', '!include b.iuml\nA\n');
    write('p/b.iuml', 'B\n');
    write('p/inc/c.iuml', '!include top.iuml\nC\n');
    write('p/top.iuml', 'TOP\n');
    write('p/sub.iuml', '!startsub P1\nS\n!endsub\n');
    // D2: импорт с вложенным, закавыченный путь с пробелом, почтовый адрес — не импорт
    write('d/x/main.d2', 'on disk\n');
    write('d/lib.d2', 'lib: {shape: person}\n...@nested\n');
    write('d/nested.d2', 'n\n');
    write('d/x/sub dir/q.d2', 'q\n');
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
    clearIncludeCache();
    clearD2FileCache();
});

describe('материал чексуммы зависимостей диаграмм', () => {
    it('foldIncludes: DFS, повтор и stdlib/URL пропущены, поиск от include-пути', () => {
        const body = [
            '@startuml',
            '!include <C4/C4_Container>',
            '!include a.iuml',
            '!include a.iuml',
            '!includeurl https://example.com/x.iuml',
            '  !include_once "inc/c.iuml"',
            '!includesub sub.iuml!P1',
            '!include b.iuml',
            '@enduml',
            ''
        ].join('\n');
        const p = path.join(dir, 'p');
        expect(foldIncludes(body, p, p, new Set())).toBe(
            ` ${rel}/p/a.iuml !include b.iuml\nA\n` +
                ` ${rel}/p/b.iuml B\n` +
                ` ${rel}/p/inc/c.iuml !include top.iuml\nC\n` +
                ` ${rel}/p/top.iuml TOP\n` +
                ` ${rel}/p/sub.iuml !startsub P1\nS\n!endsub\n`
        );
    });

    it('foldD2Imports: граф без входного файла, сортировка по пути, seed вместо диска', () => {
        const seed = '...@../lib\nu: @"sub dir/q"\nmail: foo@bar.com\n';
        expect(foldD2Imports(path.join(dir, 'd', 'x', 'main.d2'), seed)).toBe(
            ` ${rel}/d/lib.d2 lib: {shape: person}\n...@nested\n` +
                ` ${rel}/d/nested.d2 n\n` +
                ` ${rel}/d/x/sub dir/q.d2 q\n`
        );
    });
});
