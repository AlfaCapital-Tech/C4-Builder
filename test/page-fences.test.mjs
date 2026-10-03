import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT, TMP_ROOT } from './helpers.mjs';

// Блоки ```plantuml в страницах проекта рендерятся при сборке (системной java, как в
// check.test.mjs) во всех выходах; ```puml/```d2 — показ исходника, остаются кодом.
// Шаблон — пользовательский с клиентским docsify-plantuml (как у арх-репо).
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');
const CONFIG = {
    ...JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'test', 'fixtures', 'default.c4builder.json'), 'utf8')
    ),
    projectName: 'pf',
    includeNavigation: false,
    includeTableOfContents: false,
    includeBreadcrumbs: false,
    supportSearch: false,
    docsifyTemplate: 'tpl.mjs'
};

const FILES = {
    'src/README.md':
        '# Home\n\n```plantuml\n!include <C4/C4_Context>\nPerson(u, "PageFenceUser")\n```\n\n' +
        '```puml\n@startuml\nAlice -> Bob : puml-source\n@enduml\n```\n\n```d2\na -> d2-source\n```\n',
    'src/shared.iuml': 'Alice -> Bob : from-include\n',
    'src/A/README.md': '# A\n\n```plantuml\n!include ../shared.iuml\n```\n',
    'src/B/README.md': '# B\n\n```plantuml\n[a[b] --> [c]\n```\n',
    'tpl.mjs':
        "export default (o) => '<script>window.$docsify = ' + JSON.stringify(o) + ';</script>' +\n" +
        '  \'<script src="vendor/docsify-plantuml.min.js"></script>\';\n'
};

let dir;
let out;
const read = (rel) => fs.readFileSync(path.join(dir, 'docs', rel), 'utf8');
// Картинка блока страницы rel: имя — <имя .md>-<хеш>.svg рядом со страницей (в
// complete-документе ссылка уже с папкой — folder).
const image = (rel, folder = '') => {
    const m = read(rel).match(new RegExp(`!\\[diagram\\]\\((${folder}README-[0-9a-f]{8}\\.svg)\\)`));
    expect(m, rel).not.toBeNull();
    return read(path.posix.join(path.posix.dirname(rel), decodeURI(m[1])));
};

beforeAll(() => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    dir = fs.mkdtempSync(path.join(TMP_ROOT, 'page-fences-'));
    for (const [rel, content] of Object.entries(FILES)) {
        fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
    }
    fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify(CONFIG));
    const res = spawnSync(process.execPath, [CLI], { cwd: dir, encoding: 'utf8', input: '' });
    out = `${res.stdout}${res.stderr}`;
    if (res.status !== 0) throw new Error(`сборка упала (exit=${res.status}):\n${out}`);
});
afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('блоки ```plantuml в страницах', () => {
    it('сайт, markdown-коллекция и complete-markdown: картинка вместо блока', () => {
        for (const rel of ['Overview.md', 'README.md', 'pf.md']) {
            const md = read(rel);
            expect(md, rel).not.toContain('```plantuml');
            expect(md, rel).not.toContain('PageFenceUser');
            expect(image(rel)).toContain('PageFenceUser');
        }
    });

    it('```puml и ```d2 остаются кодом', () => {
        const md = read('Overview.md');
        expect(md).toContain('```puml\n@startuml\nAlice -> Bob : puml-source\n@enduml\n```');
        expect(md).toContain('```d2\na -> d2-source\n```');
    });

    it('относительный !include резолвится от каталога страницы', () => {
        expect(image('A/A.md')).toContain('from-include');
        expect(image('A/README.md')).toContain('from-include');
        expect(image('pf.md', '/A/')).toContain('from-include');
    });

    it('битый блок: сборка жива, заглушка, предупреждение с путём .md', () => {
        expect(out).toMatch(/src[/\\]B[/\\]README\.md/);
        expect(image('B/B.md')).toContain('diagram not rendered');
    });

    it('пользовательский шаблон: родные emoji в опциях, docsify-plantuml.min.js в выходе', () => {
        expect(read('index.html')).toContain('"nativeEmoji":true');
        expect(fs.existsSync(path.join(dir, 'docs', 'vendor', 'docsify-plantuml.min.js'))).toBe(true);
    });

    it('llms-full.txt: исходник блока в fence plantuml, include — в приложении', () => {
        const full = read('llms-full.txt');
        expect(full).toContain(
            '```plantuml\n@startuml\n!include <C4/C4_Context>\nPerson(u, "PageFenceUser")\n@enduml\n```'
        );
        expect(full).toContain('### src/shared.iuml');
    });
});
