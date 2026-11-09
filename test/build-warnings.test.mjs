import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');

// Связь C4 на необъявленный алиас (#60) в сборке: то же предупреждение, что у `check`, но код
// возврата не меняется. Диаграмма из кэша не перерисовывается — и не перепроверяется, поэтому
// вторая сборка молчит: гарантию даёт только `check`, это контракт, а не недосмотр.
const DANGLING =
    '@startuml\n!include <C4/C4_Context>\nPerson(u, "User")\nSystem(s, "S")\nRel(u, s, "uses")\n' +
    'Rel(u, nope, "typo alias")\n@enduml\n';

// Блоки ```plantuml в странице: строка в предупреждении — строка страницы, а не блока; блоку
// без @startuml сборка добавляет обёртку, и она не должна сдвигать номер.
const README = [
    '# Overview',
    '',
    'Body.',
    '',
    '```plantuml',
    '!include <C4/C4_Context>',
    'Person(u, "User")',
    'Rel(u, ghost1, "no startuml")', // строка 8
    '```',
    '',
    '```plantuml',
    '@startuml',
    '!include <C4/C4_Context>',
    'Person(u, "User")',
    'Rel(u, ghost2, "with startuml")', // строка 15
    '@enduml',
    '```',
    ''
].join('\n');

let dir;
const build = () => {
    const res = spawnSync(process.execPath, [CLI], {
        cwd: dir,
        encoding: 'utf8',
        input: '',
        timeout: 240_000
    });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
};
let first;
let second;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(REPO_ROOT, 'test', '.tmp-buildwarn-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'README.md'), README);
    fs.writeFileSync(path.join(dir, 'src', 'a.puml'), DANGLING);
    fs.writeFileSync(
        path.join(dir, '.c4builder'),
        // Полный набор ключей — иначе визард переспросил бы недостающее и завис на EOF.
        JSON.stringify({
            projectName: 'warn',
            homepageName: 'Overview',
            rootFolder: 'src',
            distFolder: 'docs',
            generateMD: true,
            generateCompleteMD: false,
            generateWEB: false,
            includeNavigation: false,
            includeTableOfContents: false,
            webTheme: 'vendor/vue.css',
            supportSearch: false,
            repoUrl: '',
            executeScript: false,
            docsifyTemplate: '',
            webPort: '3000',
            includeBreadcrumbs: false,
            includeLinkToDiagram: false,
            diagramsOnTop: false,
            embedDiagram: false,
            excludeOtherFiles: false,
            generateLocalImages: true,
            plantumlServerUrl: 'https://www.plantuml.com/plantuml',
            diagramFormat: 'svg',
            d2Layout: 'dagre',
            charset: 'UTF-8',
            hasRun: true
        })
    );
    first = build();
    second = build();
});

afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('сборка: Rel на необъявленный алиас', () => {
    it('первая сборка печатает ⚠ с путём и строкой, код 0, SVG создан', () => {
        expect(first.status, first.out).toBe(0);
        expect(first.out).toMatch(/⚠ src\/a\.puml: line 6: Rel to undeclared element "nope"/);
        expect(first.out).toMatch(/⚠ src\/README\.md: line 8: Rel to undeclared element "ghost1"/);
        expect(first.out).toMatch(/⚠ src\/README\.md: line 15: Rel to undeclared element "ghost2"/);
        expect(first.out.match(/undeclared element/g)).toHaveLength(3); // объявленные u и s не задеты
        expect(fs.readdirSync(path.join(dir, 'docs')).some((f) => f.endsWith('.svg'))).toBe(true);
    });

    it('повторная сборка из кэша предупреждение не печатает', () => {
        expect(second.status, second.out).toBe(0);
        expect(second.out).not.toMatch(/undeclared element/);
    });
});
