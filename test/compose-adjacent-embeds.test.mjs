import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { diagramRefRegex } from './dist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');

// Регрессия issue #12: две ссылки ![..](x.puml) подряд (через пустую строку, без текста
// между ними) — вторая оставалась сырой в теле, а её диаграмма уезжала в начало страницы
// (fallback «неупомянутых» диаграмм + diagramsOnTop). Баг стрелял при УКОРАЧИВАЮЩЕЙ замене
// (regex.exec по переприсваиваемой строке: lastIndex уезжал за следующую ссылку), поэтому
// alt длиннее remote-URL картинки. generateLocalImages=false → remote-URL, java не нужна.
const ALT =
    'C4 container diagram of the ordering platform: API gateway, order service, payment adapter, PostgreSQL';
let dir;
let readme;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(REPO_ROOT, 'test', '.tmp-adjacent-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'src', 'index.md'),
        `## Section\nSome text.\n\n![${ALT}](a.puml)\n\n![${ALT} (reply)](b.puml)\n\n## Next\n\n## Upper\n\n![upper](C.PUML)\n`
    );
    fs.writeFileSync(path.join(dir, 'src', 'a.puml'), '@startuml\nAlice -> Bob : hello\n@enduml\n');
    fs.writeFileSync(path.join(dir, 'src', 'b.puml'), '@startuml\nBob -> Alice : hi\n@enduml\n');
    // Расширение в верхнем регистре: scan считает файл диаграммой — ссылка тоже должна найтись.
    fs.writeFileSync(path.join(dir, 'src', 'C.PUML'), '@startuml\nCarol -> Bob : hey\n@enduml\n');
    fs.writeFileSync(
        path.join(dir, '.c4builder'),
        // Полный набор ключей — иначе визард переспросил бы недостающее и завис на EOF.
        JSON.stringify({
            projectName: 'adjacent',
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
            diagramsOnTop: true,
            embedDiagram: false,
            excludeOtherFiles: false,
            generateLocalImages: false,
            plantumlServerUrl: 'https://www.plantuml.com/plantuml',
            diagramFormat: 'svg',
            d2Layout: 'dagre',
            charset: 'UTF-8',
            hasRun: true
        })
    );
    const res = spawnSync(process.execPath, [CLI], { cwd: dir, encoding: 'utf8', input: '' });
    if (res.status !== 0) throw new Error(`build failed: ${res.stdout}\n${res.stderr}`);
    readme = fs.readFileSync(path.join(dir, 'docs', 'README.md'), 'utf8');
});

afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('issue #12: соседние ссылки на диаграммы', () => {
    it('обе ссылки заменены, сырых .puml не осталось', () => {
        expect(readme).not.toMatch(/\.puml\)/i);
        expect(readme.match(/!\[diagram\]\(/g)?.length).toBe(3);
    });

    it('диаграммы стоят на своих местах в порядке документа', () => {
        const text = readme.indexOf('Some text.');
        const first = readme.indexOf('![diagram](');
        const second = readme.indexOf('![diagram](', first + 1);
        const next = readme.indexOf('## Next');
        expect(readme.indexOf('## Section')).toBeLessThan(text);
        expect(text).toBeLessThan(first);
        expect(first).toBeLessThan(second);
        expect(second).toBeLessThan(next);
    });

    it('ссылка на C.PUML (расширение в верхнем регистре) заменена на своём месте', () => {
        const upper = readme.indexOf('## Upper');
        expect(readme.indexOf('![diagram](', upper)).toBeGreaterThan(upper);
        expect(readme.slice(0, readme.indexOf('## Section'))).not.toContain('![diagram](');
    });
});

describe('diagramRefRegex: ссылка на диаграмму с title', () => {
    const refs = (md) => [...md.matchAll(diagramRefRegex())].map((m) => [m[1], m[2]]);

    it('title в двойных и одинарных кавычках — путь и title отдельно', () => {
        expect(refs('![x](flow.mmd "T (draft)")')).toEqual([['flow.mmd', '"T (draft)"']]);
        expect(refs("![x](a/flow.puml ':size=600')")).toEqual([['a/flow.puml', "':size=600'"]]);
        expect(refs('![x](wireflow.json "W")')).toEqual([['wireflow.json', '"W"']]);
    });

    it('без title — как раньше; две ссылки на строке не склеиваются', () => {
        expect(refs('![a](a.puml "A") and ![b](b.d2)')).toEqual([
            ['a.puml', '"A"'],
            ['b.d2', undefined]
        ]);
    });

    it('незакавыченный хвост — не title, ссылка не диаграмма', () => {
        expect(refs('![x](flow.mmd lol)')).toEqual([]);
    });
});
