import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
    BPMN_CACHE_PACKAGES,
    clearD2FileCache,
    clearIncludeCache,
    defaultConfig,
    foldD2Imports,
    foldIncludes,
    renderKey
} from './dist.mjs';
import { REPO_ROOT, TMP_ROOT } from './helpers.mjs';

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

// BPMN-движок — optionalDependencies с ленивой загрузкой (change bpmn-diagrams). Отсутствие
// пакетов эмулирует хук резолва: проект без .bpmn обязан собираться, .bpmn — падать с
// подсказкой установки, а не с трассой стека.
describe('ленивая загрузка BPMN-зависимостей', () => {
    const CLI = path.join(REPO_ROOT, 'dist', 'index.js');
    const HOOK = path.join(REPO_ROOT, 'test', 'fixtures', 'hide-bpmn.mjs');
    const run = (cwd, ...args) =>
        spawnSync(process.execPath, ['--import', HOOK, CLI, ...args], {
            cwd,
            encoding: 'utf8',
            input: '',
            timeout: 120_000
        });

    it('проект без .bpmn собирается без BPMN-пакетов', () => {
        write('nobpmn/src/README.md', '# Home\n');
        write('nobpmn/src/x.d2', 'a -> b\n');
        write('nobpmn/.c4builder', JSON.stringify({ ...defaultConfig, projectName: 'nobpmn', hasRun: true }));
        const res = run(path.join(dir, 'nobpmn'));
        expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
        expect(fs.existsSync(path.join(dir, 'nobpmn', 'docs', 'x.svg'))).toBe(true);
    });

    it('.bpmn без пакетов → понятная ошибка с подсказкой установки', () => {
        write('b/p.bpmn', '<x/>');
        const res = run(path.join(dir, 'b'), 'check', 'p.bpmn');
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(/✗ p\.bpmn: Rendering \.bpmn diagrams requires the optional packages/);
        expect(res.stderr).toMatch(/without --omit=optional: npm i -g @alfacapital-tech\/c4builder/);
    });

    it('ключ кэша BPMN несёт версии пакетов раскладки, рендера и валидации; ключи D2/PlantUML прежние', () => {
        const v = (name) =>
            JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'node_modules', name, 'package.json'), 'utf8'))
                .version;
        const options = { D2_LAYOUT: 'dagre', CHARSET: 'UTF-8', USE_SYSTEM_FONTS: false };
        expect(BPMN_CACHE_PACKAGES).toEqual(['bpmn-js', 'bpmn-auto-layout', 'bpmnlint']);
        // Смена любой версии меняет ключ → чексумму → диаграмма перерисовывается.
        expect(renderKey({ engine: 'bpmn', isDitaa: false }, options, 'png')).toBe(
            `bpmn\0${v('bpmn-js')}\0${v('bpmn-auto-layout')}\0${v('bpmnlint')}\0fmt=png\0font=Nimbus Sans`
        );
        // Прежние ключи неизменны: иначе кэш картинок у всех потребителей инвалидировался бы разом.
        expect(renderKey({ engine: 'd2', isDitaa: false }, options, 'svg')).toBe(
            `d2\0${v('@terrastruct/d2')}\0layout=dagre\0fmt=svg\0font=Nimbus Sans`
        );
        expect(renderKey({ engine: 'plantuml', isDitaa: true }, options, 'png')).toMatch(
            /^puml\0[\d.]+\0charset=UTF-8\0fmt=png\0ditaa=true\0font=Nimbus Sans$/
        );
    });
});
