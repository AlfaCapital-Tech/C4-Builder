import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TMP_ROOT, ensureManagedJre, runBuild } from './helpers.mjs';

// Встроенный плагин openspec на мини-фикстуре store: 2 активных change'а (tasks, дельты,
// plantuml, кастомный артефакт, картинка), 1 архивный, одно- и двухуровневые спеки.
const CONFIG = {
    ...JSON.parse(
        fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'default.c4builder.json'), 'utf8')
    ),
    projectName: 'demo',
    generateMD: false,
    generateCompleteMD: true,
    includeNavigation: false,
    includeTableOfContents: false,
    includeBreadcrumbs: false
};

const write = (root, rel, content) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
};

const makeStore = (dir, store = 'openspec') => {
    const s = path.join(dir, store);
    // change 1: полный, с диаграммой, картинкой, ссылками, tasks 1/3
    write(s, 'changes/dig-1-alpha/.openspec.yaml', 'schema: spec-driven\ncreated: 2026-08-01\n');
    write(
        s,
        'changes/dig-1-alpha/proposal.md',
        [
            '## Why',
            '',
            'See [design](design.md) and [tasks](./tasks.md#done) and [delta](specs/area/cap-a/spec.md).',
            '',
            '![pic](img/pic.png)',
            '',
            // картинка-ссылка, title, битый %-escape, файл рядом
            '[![pic](img/pic.png)](design.md) [notes](notes/a.md "Notes") [pct](notes/100%.md)',
            ''
        ].join('\n')
    );
    write(s, 'changes/dig-1-alpha/notes/a.md', 'note');
    write(
        s,
        'changes/dig-1-alpha/design.md',
        '## Context\n\nDiagram:\n\n```plantuml\n!include <C4/C4_Context>\nPerson(u, "Alice")\nSystem(s, "Sys")\nRel(u, s, "uses")\n```\n\nAfter.\n\n```js\nconst x = 1; // не диаграмма\n```\n\n[Backend](_back/back.md \':include\')\n\n[DDL](_back/ddl.sql \':include :type=code\')\n'
    );
    // подфайлы design через ':include': диаграмма, картинка и ссылка от каталога подфайла, цикл include
    write(
        s,
        'changes/dig-1-alpha/_back/back.md',
        "# Backend\n\n```plantuml\nBob -> Carol\n```\n\n![pic](../img/pic.png) [tasks](../tasks.md)\n\n[loop](loop.md ':include')\n"
    );
    write(s, 'changes/dig-1-alpha/_back/loop.md', "loop body\n\n[back](back.md ':include')\n");
    write(s, 'changes/dig-1-alpha/_back/ddl.sql', 'create table t (id int);\n');
    // артефакт specs.md рядом с дельтами — делит страницу с индексом дельт
    write(s, 'changes/dig-1-alpha/specs.md', '## Specs notes\n\nabout deltas\n');
    write(
        s,
        'changes/dig-1-alpha/tasks.md',
        '## 1. Work\n\n- [x] 1.1 done\n- [ ] 1.2 todo\n- [ ] 1.3 todo\n'
    );
    write(s, 'changes/dig-1-alpha/plan.md', '## Plan\n\ncustom artifact\n');
    write(
        s,
        'changes/dig-1-alpha/specs/area/cap-a/spec.md',
        '## ADDED Requirements\n\n### Requirement: A\n\nA text\n'
    );
    write(s, 'changes/dig-1-alpha/img/pic.png', 'PNG');
    // change 2: без tasks, без метаданных
    write(
        s,
        'changes/dig-2-beta/proposal.md',
        '## Why\n\nbeta\n\n![Поток](flow.puml)\n\n![битый](broken.mmd)\n'
    );
    // картинки-ссылки на файлы диаграмм: рендер локальным движком, битый файл — заглушка
    write(s, 'changes/dig-2-beta/flow.puml', '@startuml\nAlice -> Bob : hi\n@enduml\n');
    write(s, 'changes/dig-2-beta/broken.mmd', 'flowchart LR\n  A -->\n');
    // архив
    write(s, 'changes/archive/2026-08-01-dig-0-old/proposal.md', '## Why\n\nold\n');
    write(s, 'changes/archive/2026-08-01-dig-0-old/tasks.md', '- [x] a\n- [x] b\n');
    // спеки: одно- и двухуровневые; папка area с собственной spec.md (d2-диаграмма) и вложенными
    // ```puml: плагин извлекает и его (в отличие от страниц проекта, где это «показать исходник»)
    write(s, 'specs/solo/spec.md', '## Purpose\n\nsolo spec\n\n```puml\nAlice -> Bob\n```\n');
    write(s, 'specs/area/spec.md', '## Purpose\n\narea spec\n\n```d2\nx -> y\n```\n');
    write(s, 'specs/area/cap-a/spec.md', '## Purpose\n\ncap-a spec\n');
    write(s, 'specs/area/cap-b/spec.md', '## Purpose\n\ncap-b spec\n');
    return s;
};

const makeFixture = (name, plugins, withStore = true) => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, `plugin-openspec-${name}-`));
    write(dir, 'src/README.md', 'root');
    write(dir, 'src/A/README.md', 'a');
    if (withStore) makeStore(dir);
    fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify({ ...CONFIG, plugins }));
    return dir;
};

let dir;
const read = (rel) => fs.readFileSync(path.join(dir, 'docs', rel), 'utf8');

beforeAll(async () => {
    await ensureManagedJre();
    dir = makeFixture('ok', ['openspec']);
    runBuild(dir);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('плагин openspec', () => {
    it("sidebar: раздел OpenSpec, под change'ем — подстраницы артефактов и specs", () => {
        const lines = read('_sidebar.md').trimEnd().split('\n');
        expect(lines).toEqual([
            '* [Overview](Overview)',
            '  * [A](A/A)',
            '  * [OpenSpec](OpenSpec/OpenSpec)',
            '    * [Changes](OpenSpec/Changes/Changes)',
            '      * [dig-1-alpha](OpenSpec/Changes/dig-1-alpha/dig-1-alpha)',
            '        * [design](OpenSpec/Changes/dig-1-alpha/design/design)',
            '        * [tasks](OpenSpec/Changes/dig-1-alpha/tasks/tasks)',
            '        * [plan](OpenSpec/Changes/dig-1-alpha/plan/plan)',
            '        * [specs](OpenSpec/Changes/dig-1-alpha/specs/specs)',
            '          * [area](OpenSpec/Changes/dig-1-alpha/specs/area/area)',
            '            * [cap-a](OpenSpec/Changes/dig-1-alpha/specs/area/cap-a/cap-a)',
            '      * [dig-2-beta](OpenSpec/Changes/dig-2-beta/dig-2-beta)',
            '    * [Specs](OpenSpec/Specs/Specs)',
            '      * [area](OpenSpec/Specs/area/area)',
            '        * [cap-a](OpenSpec/Specs/area/cap-a/cap-a)',
            '        * [cap-b](OpenSpec/Specs/area/cap-b/cap-b)',
            '      * [solo](OpenSpec/Specs/solo/solo)',
            '    * [Archive](OpenSpec/Archive/Archive)',
            '      * [2026-08-01-dig-0-old](OpenSpec/Archive/2026-08-01-dig-0-old/2026-08-01-dig-0-old)',
            '        * [tasks](OpenSpec/Archive/2026-08-01-dig-0-old/tasks/tasks)'
        ]);
    });

    it('сводка: счётчики, прогресс, таблица со ссылками', () => {
        const md = read('OpenSpec/OpenSpec.md');
        expect(md).toContain('**Active changes:** [2](OpenSpec/Changes/Changes)');
        expect(md).toContain('**Specs:** [4](OpenSpec/Specs/Specs)');
        expect(md).toContain('**Archived:** [1](OpenSpec/Archive/Archive)');
        expect(md).toContain('**Tasks:** <progress value="1" max="3"></progress> 1/3 (33%)');
        expect(md).toMatch(
            /\| \[dig-1-alpha\]\(OpenSpec\/Changes\/dig-1-alpha\/dig-1-alpha\) \| spec-driven \| <progress value="1" max="3"><\/progress> 1\/3 \(33%\) \| \d{4}-\d{2}-\d{2} \|/
        );
        expect(md).toMatch(/\| \[dig-2-beta\]\(OpenSpec\/Changes\/dig-2-beta\/dig-2-beta\) \| — \| — \|/);
    });

    it('страница change: шапка, ссылки на подстраницы, proposal inline, ссылки на артефакты → страницы', () => {
        const md = read('OpenSpec/Changes/dig-1-alpha/dig-1-alpha.md');
        expect(md).toContain('# dig-1-alpha');
        expect(md).toContain(
            '**Schema:** spec-driven · **Created:** 2026-08-01 · **Tasks:** <progress value="1" max="3"></progress> 1/3 (33%)'
        );
        expect(md).toContain(
            '[design](OpenSpec/Changes/dig-1-alpha/design/design) · [tasks](OpenSpec/Changes/dig-1-alpha/tasks/tasks) · [plan](OpenSpec/Changes/dig-1-alpha/plan/plan) · [specs](OpenSpec/Changes/dig-1-alpha/specs/specs)'
        );
        expect(md).not.toContain('specs/specs) · [specs]'); // артефакт specs — одна ссылка
        expect(md).toContain('## Why'); // proposal без обёртки, заголовки не сдвинуты
        expect(md).toContain('See [design](OpenSpec/Changes/dig-1-alpha/design/design)');
        expect(md).toContain('[tasks](OpenSpec/Changes/dig-1-alpha/tasks/tasks?id=done)');
        expect(md).toContain('[delta](OpenSpec/Changes/dig-1-alpha/specs/area/cap-a/cap-a)');
        expect(md).toContain('![pic](img/pic.png)');
        expect(fs.existsSync(path.join(dir, 'docs/OpenSpec/Changes/dig-1-alpha/img/pic.png'))).toBe(true);
        // картинка-ссылка: внешняя ссылка → страница, картинка не тронута
        expect(md).toContain('[![pic](img/pic.png)](OpenSpec/Changes/dig-1-alpha/design/design)');
        // title сохраняется вместе с ':ignore'; битый %-escape оставлен как есть
        expect(md).toContain("[notes](OpenSpec/Changes/dig-1-alpha/notes/a.md ':ignore Notes')");
        expect(md).toContain('[pct](notes/100%.md)');
        expect(fs.existsSync(path.join(dir, 'docs/OpenSpec/Changes/dig-1-alpha/notes/a.md'))).toBe(true);
    });

    it('complete markdown: файлы виртуальных страниц скопированы и в корень dist', () => {
        expect(fs.existsSync(path.join(dir, 'docs/img/pic.png'))).toBe(true);
        expect(read('demo.md')).toContain('![pic](img/pic.png)');
    });

    it('подстраницы: tasks с чекбоксами, plan, дельта спеки и её индекс', () => {
        expect(read('OpenSpec/Changes/dig-1-alpha/tasks/tasks.md')).toContain('- [x] 1.1 done');
        expect(read('OpenSpec/Changes/dig-1-alpha/plan/plan.md')).toContain('custom artifact');
        expect(read('OpenSpec/Changes/dig-1-alpha/specs/area/cap-a/cap-a.md')).toContain(
            '### Requirement: A'
        );
        const specs = read('OpenSpec/Changes/dig-1-alpha/specs/specs.md');
        expect(specs).toContain(
            '- [area](OpenSpec/Changes/dig-1-alpha/specs/area/area)\n  - [cap-a](OpenSpec/Changes/dig-1-alpha/specs/area/cap-a/cap-a)'
        );
        expect(specs).toContain('about deltas'); // артефакт specs.md на той же странице
    });

    it('```plantuml вырезан и отрендерен локально на подстранице design; ```js остался', () => {
        const md = read('OpenSpec/Changes/dig-1-alpha/design/design.md');
        expect(md).not.toContain('```plantuml');
        // имя — по хешу содержимого, не по позиции
        const m = md.match(/!\[diagram\]\((design-[0-9a-f]{8})\.svg\)/);
        expect(m).not.toBeNull();
        expect(md).toContain('```js');
        const svg = read(`OpenSpec/Changes/dig-1-alpha/design/${m[1]}.svg`);
        expect(svg).toContain('<svg');
        expect(svg).toContain('Alice');
    });

    it("':include' markdown-подфайла встроен при сборке, прочие include — относительно страницы", () => {
        const md = read('OpenSpec/Changes/dig-1-alpha/design/design.md');
        expect(md).not.toContain('[Backend](');
        expect(md).toContain('# Backend');
        // диаграмма подфайла отрендерена локально, а не сырым ```plantuml в браузере
        const m = [...md.matchAll(/!\[diagram\]\((design-[0-9a-f]{8})\.svg\)/g)].map((x) => x[1]);
        expect(m).toHaveLength(2);
        expect(read(`OpenSpec/Changes/dig-1-alpha/design/${m[1]}.svg`)).toContain('Carol');
        // ссылки подфайла резолвятся от его каталога, пути — от страницы
        expect(md).toContain('![pic](img/pic.png)');
        expect(fs.existsSync(path.join(dir, 'docs/OpenSpec/Changes/dig-1-alpha/design/img/pic.png'))).toBe(
            true
        );
        expect(md).toContain('[tasks](OpenSpec/Changes/dig-1-alpha/tasks/tasks)');
        // цикл: loop встроен, повторный back.md не встраивается, а остаётся embed от страницы
        expect(md).toContain('loop body');
        expect(md).toContain("[back](_back/back.md ':include')");
        // не-markdown embed docsify грузит относительно страницы — путь не переписан от корня
        expect(md).toContain("[DDL](_back/ddl.sql ':include :type=code')");
        expect(fs.existsSync(path.join(dir, 'docs/OpenSpec/Changes/dig-1-alpha/design/_back/ddl.sql'))).toBe(
            true
        );
    });

    it('спеки: страницы, папка со своей spec.md + список вложенных, d2 отрендерен локально', () => {
        expect(read('OpenSpec/Specs/area/cap-a/cap-a.md')).toContain('cap-a spec');
        const area = read('OpenSpec/Specs/area/area.md');
        expect(area).toContain('area spec');
        expect(area).toContain('- [cap-a](OpenSpec/Specs/area/cap-a/cap-a)');
        expect(area).not.toContain('```d2');
        const m = area.match(/!\[diagram\]\((spec-area-[0-9a-f]{8})\.svg\)/);
        expect(m).not.toBeNull();
        expect(read(`OpenSpec/Specs/area/${m[1]}.svg`)).toContain('<svg');
        expect(read('OpenSpec/Specs/Specs.md')).toContain('  - [cap-b](OpenSpec/Specs/area/cap-b/cap-b)');
        const solo = read('OpenSpec/Specs/solo/solo.md');
        expect(solo).not.toContain('```puml');
        expect(solo).toMatch(/!\[diagram\]\(spec-solo-[0-9a-f]{8}\.svg\)/);
    });

    it('архив: сводка со ссылкой и страница', () => {
        expect(read('OpenSpec/Archive/Archive.md')).toContain(
            '- [2026-08-01-dig-0-old](OpenSpec/Archive/2026-08-01-dig-0-old/2026-08-01-dig-0-old)'
        );
        const md = read('OpenSpec/Archive/2026-08-01-dig-0-old/2026-08-01-dig-0-old.md');
        expect(md).toContain('**Tasks:** <progress value="2" max="2"></progress> 2/2 (100%)');
        expect(md).toContain('## Why'); // proposal inline
        expect(read('OpenSpec/Archive/2026-08-01-dig-0-old/tasks/tasks.md')).toContain('- [x] a');
    });
});

describe('плагин openspec: крайние случаи', () => {
    it('пустой store — раздел с нулевыми счётчиками', () => {
        const d = makeFixture('empty', ['openspec'], false);
        fs.mkdirSync(path.join(d, 'openspec'));
        runBuild(d);
        expect(fs.readFileSync(path.join(d, 'docs/OpenSpec/OpenSpec.md'), 'utf8')).toContain(
            '**Active changes:** [0]'
        );
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('опция artifacts управляет порядком и inline-артефактом', () => {
        const d = makeFixture('order', [['openspec', { artifacts: ['plan', 'tasks'] }]]);
        runBuild(d);
        const main = fs.readFileSync(
            path.join(d, 'docs/OpenSpec/Changes/dig-1-alpha/dig-1-alpha.md'),
            'utf8'
        );
        expect(main).toContain('custom artifact'); // plan — на странице change'а
        expect(main).toContain(
            '[tasks](OpenSpec/Changes/dig-1-alpha/tasks/tasks) · [design](OpenSpec/Changes/dig-1-alpha/design/design) · [proposal](OpenSpec/Changes/dig-1-alpha/proposal/proposal)'
        );
        // change без plan: страница = шапка + ссылки, proposal — подстраницей
        const beta = fs.readFileSync(path.join(d, 'docs/OpenSpec/Changes/dig-2-beta/dig-2-beta.md'), 'utf8');
        expect(beta).not.toContain('## Why');
        expect(fs.existsSync(path.join(d, 'docs/OpenSpec/Changes/dig-2-beta/proposal/proposal.md'))).toBe(
            true
        );
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('битый ```plantuml в артефакте — предупреждение с файлом и картинка-заглушка, сборка жива', () => {
        const d = makeFixture('badfence', ['openspec']);
        write(
            path.join(d, 'openspec'),
            'changes/dig-2-beta/design.md',
            '# D\n\n```plantuml\n[a[b] --> [c]\n```\n'
        );
        const out = runBuild(d);
        expect(out).toMatch(/openspec[/\\]changes[/\\]dig-2-beta[/\\]design\.md/);
        const beta = path.join(d, 'docs/OpenSpec/Changes/dig-2-beta');
        const svg = fs.readdirSync(beta, { recursive: true }).find((f) => String(f).endsWith('.svg'));
        expect(svg).toBeTruthy();
        expect(fs.readFileSync(path.join(beta, String(svg)), 'utf8')).toContain('diagram not rendered');
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('```mermaid в design.md (flowchart и sequence) — картинки вместо кода', () => {
        const d = makeFixture('mermaid', ['openspec']);
        write(
            path.join(d, 'openspec'),
            'changes/dig-2-beta/design.md',
            '# D\n\n```mermaid\nflowchart LR\n  A[Клиент] --> B[Шлюз]\n```\n\n' +
                '```mermaid\nsequenceDiagram\n  Клиент->>Шлюз: Запрос\n```\n'
        );
        runBuild(d);
        const page = path.join(d, 'docs/OpenSpec/Changes/dig-2-beta/design');
        const md = fs.readFileSync(path.join(page, 'design.md'), 'utf8');
        expect(md).not.toContain('```mermaid');
        const images = [...md.matchAll(/!\[diagram\]\((design-[0-9a-f]{8}\.svg)\)/g)].map((m) => m[1]);
        expect(images).toHaveLength(2);
        expect(fs.readFileSync(path.join(page, images[0]), 'utf8')).toContain('Шлюз');
        expect(fs.readFileSync(path.join(page, images[1]), 'utf8')).toContain('Запрос');
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('битый plugins при первом запуске (щадящий путь) — exit 1, конфиг не переписан', () => {
        const d = makeFixture('badplugins', [['openspec', 'openspec']]);
        fs.writeFileSync(
            path.join(d, '.c4builder'),
            JSON.stringify({ ...CONFIG, hasRun: false, plugins: [['openspec', 'openspec']] })
        );
        expect(() => runBuild(d)).toThrow(/plugins/);
        expect(JSON.parse(fs.readFileSync(path.join(d, '.c4builder'), 'utf8')).plugins).toEqual([
            ['openspec', 'openspec']
        ]);
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('отсутствующий dir — ошибка с путём; mount переименовывает раздел', () => {
        const d = makeFixture('nodir', [['openspec', { dir: 'nope' }]], false);
        expect(() => runBuild(d)).toThrow(/OpenSpec store not found: .*nope/);
        fs.rmSync(d, { recursive: true, force: true });
        const d2 = makeFixture('mount', [['openspec', { mount: 'Планы' }]]);
        runBuild(d2);
        expect(fs.existsSync(path.join(d2, 'docs/Планы/Changes/dig-1-alpha/dig-1-alpha.md'))).toBe(true);
        expect(fs.readFileSync(path.join(d2, 'docs/_sidebar.md'), 'utf8')).toContain('* [Планы](%D0%9F');
        fs.rmSync(d2, { recursive: true, force: true });
    });
    it("короткий адрес: id с '#' и совпадение id у двух экземпляров — предупреждение, сборка проходит", () => {
        const d = makeFixture(
            'redirect-clash',
            [
                ['openspec', { dir: 'storeA', mount: 'SA' }],
                ['openspec', { dir: 'storeB', mount: 'SB' }]
            ],
            false
        );
        makeStore(d, 'storeA');
        makeStore(d, 'storeB');
        write(path.join(d, 'storeA'), 'changes/fix#1/proposal.md', '## Why\n\nfix\n');
        const out = runBuild(d);
        expect(out).toMatch(/openspec \(SB\): no short address for change dig-1-alpha: .*already declared/);
        expect(out).toMatch(/openspec \(SA\): no short address for change fix#1: .*invalid redirect path/);
        const html = fs.readFileSync(path.join(d, 'docs', 'index.html'), 'utf8');
        const { redirects } = JSON.parse(
            html.match(/window\.\$docsify = (\{[\s\S]*?\});\s*<\/script>/)[1]
        ).c4builder;
        // Первый экземпляр выигрывает.
        expect(redirects['/change/dig-1-alpha']).toMatch(/^\/SA\//);
        fs.rmSync(d, { recursive: true, force: true });
    });
});

// Корень задачи и подзадачи по платформам: ссылка на родителя — ключ `.openspec.yaml`
// (`x-parent`), опция parentKey кладёт вложенные под родителя с подписью-хвостом id.
const addFamily = (d) => {
    const s = path.join(d, 'openspec');
    write(s, 'changes/dig-3-root/.openspec.yaml', 'schema: spec-driven\n');
    write(s, 'changes/dig-3-root/proposal.md', '## Why\n\nroot\n');
    write(s, 'changes/dig-3-root/design.md', '## Context\n\nroot design\n');
    for (const [id, schema] of [
        ['dig-3-root-ios', 'spec-driven'],
        ['dig-3-root-back-api', 'spec-driven'],
        // хвост совпадает с подстраницей родителя (design) — подпись полным id
        ['dig-3-root-design', 'spec-driven']
    ]) {
        // комментарий в конце строки — не часть значения
        write(s, `changes/${id}/.openspec.yaml`, `schema: ${schema}\nx-parent: dig-3-root # root task\n`);
        write(s, `changes/${id}/proposal.md`, `## Why\n\n${id}\n`);
    }
    // родителя нет в store — остаётся на верхнем уровне
    write(s, 'changes/dig-4-orphan/.openspec.yaml', 'x-parent: dig-404\n');
    write(s, 'changes/dig-4-orphan/proposal.md', '## Why\n\norphan\n');
    // архив: ссылка — по активному id родителя, без даты архивации
    write(s, 'changes/archive/2026-08-02-dig-5-old/proposal.md', '## Why\n\nold root\n');
    write(s, 'changes/archive/2026-08-01-dig-5-old-web/.openspec.yaml', 'x-parent: dig-5-old\n');
    write(s, 'changes/archive/2026-08-01-dig-5-old-web/proposal.md', '## Why\n\nold web\n');
};

describe('плагин openspec: опция parentKey', () => {
    let d;
    const readD = (rel) => fs.readFileSync(path.join(d, 'docs', rel), 'utf8');
    beforeAll(() => {
        d = makeFixture('parent', [['openspec', { parentKey: 'x-parent' }]]);
        addFamily(d);
        runBuild(d);
    });
    afterAll(() => fs.rmSync(d, { recursive: true, force: true }));

    it('sidebar: вложенные — под родителем после его артефактов, подпись — хвост id', () => {
        const lines = readD('_sidebar.md').trimEnd().split('\n');
        const from = lines.indexOf('      * [dig-3-root](OpenSpec/Changes/dig-3-root/dig-3-root)');
        expect(lines.slice(from, from + 5)).toEqual([
            '      * [dig-3-root](OpenSpec/Changes/dig-3-root/dig-3-root)',
            '        * [design](OpenSpec/Changes/dig-3-root/design/design)',
            '        * [back-api](OpenSpec/Changes/dig-3-root/back-api/back-api)',
            '        * [dig-3-root-design](OpenSpec/Changes/dig-3-root/dig-3-root-design/dig-3-root-design)',
            '        * [ios](OpenSpec/Changes/dig-3-root/ios/ios)'
        ]);
        expect(lines).toContain('      * [dig-4-orphan](OpenSpec/Changes/dig-4-orphan/dig-4-orphan)');
        expect(lines.some((l) => l.includes('OpenSpec/Changes/dig-3-root-ios/'))).toBe(false);
        expect(lines).toContain('        * [web](OpenSpec/Archive/2026-08-02-dig-5-old/web/web)');
    });

    it('таблица Changes: вложенные сразу под родителем, со стрелкой; страницы связаны', () => {
        const rows = readD('OpenSpec/Changes/Changes.md').split('\n');
        const root = rows.findIndex((r) =>
            r.startsWith('| [dig-3-root](OpenSpec/Changes/dig-3-root/dig-3-root)')
        );
        expect(root).toBeGreaterThan(-1);
        expect(rows.slice(root + 1, root + 4).every((r) => r.startsWith('| ↳ ['))).toBe(true);
        expect(rows.join('\n')).toContain('| ↳ [ios](OpenSpec/Changes/dig-3-root/ios/ios) | spec-driven |');
        expect(readD('OpenSpec/Changes/dig-3-root/dig-3-root.md')).toMatch(
            /\*\*Sub-changes:\*\* .*\[ios\]\(OpenSpec\/Changes\/dig-3-root\/ios\/ios\)/
        );
        expect(readD('OpenSpec/Changes/dig-3-root/ios/ios.md')).toContain(
            '**Parent:** [dig-3-root](OpenSpec/Changes/dig-3-root/dig-3-root)'
        );
    });

    it('архив: вложенный — пунктом под родителем', () => {
        expect(readD('OpenSpec/Archive/Archive.md')).toContain(
            '- [2026-08-02-dig-5-old](OpenSpec/Archive/2026-08-02-dig-5-old/2026-08-02-dig-5-old)\n  - [web](OpenSpec/Archive/2026-08-02-dig-5-old/web/web)'
        );
    });

    it('без опции — прежний плоский список', () => {
        const flat = makeFixture('noparent', ['openspec']);
        addFamily(flat);
        runBuild(flat);
        const sidebar = fs.readFileSync(path.join(flat, 'docs/_sidebar.md'), 'utf8');
        expect(sidebar).toContain('      * [dig-3-root-ios](OpenSpec/Changes/dig-3-root-ios/dig-3-root-ios)');
        expect(fs.readFileSync(path.join(flat, 'docs/OpenSpec/Changes/Changes.md'), 'utf8')).not.toContain(
            '↳'
        );
        fs.rmSync(flat, { recursive: true, force: true });
    });
});

// Группы (опция groupKey, например команда): change'ы верхнего уровня — под папкой группы,
// вложенные — за родителем; группа с именем change'а без группы не создаётся.
describe('плагин openspec: опция groupKey', () => {
    let d;
    const readD = (rel) => fs.readFileSync(path.join(d, 'docs', rel), 'utf8');
    beforeAll(() => {
        d = makeFixture('group', [['openspec', { parentKey: 'x-parent', groupKey: 'x-team' }]]);
        addFamily(d);
        const s = path.join(d, 'openspec');
        write(s, 'changes/dig-3-root/.openspec.yaml', 'schema: spec-driven\nx-team: Service\n');
        write(s, 'changes/dig-4-orphan/.openspec.yaml', 'x-parent: dig-404\nx-team: Innovation\n');
        // имя группы совпадает с id change'а без группы — коллизия путей, группой не считается
        write(
            s,
            'changes/dig-1-alpha/.openspec.yaml',
            'schema: spec-driven\ncreated: 2026-08-01\nx-team: dig-2-beta\n'
        );
        write(s, 'changes/archive/2026-08-02-dig-5-old/.openspec.yaml', 'x-team: Service\n');
        runBuild(d);
    });
    afterAll(() => fs.rmSync(d, { recursive: true, force: true }));

    it("sidebar: группы по алфавиту, под ними change'ы и их вложенные; без группы — после групп", () => {
        const lines = readD('_sidebar.md').trimEnd().split('\n');
        const at = (l) => lines.indexOf(l);
        const inno = at('      * [Innovation](OpenSpec/Changes/Innovation/Innovation)');
        const service = at('      * [Service](OpenSpec/Changes/Service/Service)');
        const alpha = at('      * [dig-1-alpha](OpenSpec/Changes/dig-1-alpha/dig-1-alpha)');
        expect(inno).toBeGreaterThan(-1);
        expect(service).toBeGreaterThan(inno);
        expect(alpha).toBeGreaterThan(service);
        expect(lines[inno + 1]).toBe(
            '        * [dig-4-orphan](OpenSpec/Changes/Innovation/dig-4-orphan/dig-4-orphan)'
        );
        expect(lines[service + 1]).toBe(
            '        * [dig-3-root](OpenSpec/Changes/Service/dig-3-root/dig-3-root)'
        );
        expect(lines).toContain('          * [ios](OpenSpec/Changes/Service/dig-3-root/ios/ios)');
        expect(lines).toContain('      * [Service](OpenSpec/Archive/Service/Service)');
        expect(lines).toContain('          * [web](OpenSpec/Archive/Service/2026-08-02-dig-5-old/web/web)');
    });

    it('таблица Changes — секции по группам, страница группы — её таблица без секций', () => {
        const md = readD('OpenSpec/Changes/Changes.md');
        const pos = ['### Innovation', '### Service', '### Ungrouped'].map((h) => md.indexOf(h));
        expect(pos.every((p, i) => p > -1 && (i === 0 || p > pos[i - 1]))).toBe(true);
        expect(md).toContain('| ↳ [ios](OpenSpec/Changes/Service/dig-3-root/ios/ios) | spec-driven |');
        const group = readD('OpenSpec/Changes/Service/Service.md');
        expect(group).toContain('| [dig-3-root](OpenSpec/Changes/Service/dig-3-root/dig-3-root)');
        expect(group).not.toContain('### ');
        expect(readD('OpenSpec/Changes/Service/dig-3-root/ios/ios.md')).toContain(
            '**Parent:** [dig-3-root](OpenSpec/Changes/Service/dig-3-root/dig-3-root)'
        );
    });

    it('архив: секция группы, вложенный — пунктом под родителем', () => {
        const md = readD('OpenSpec/Archive/Archive.md');
        expect(md).toContain('### Service');
        expect(md).toContain(
            '- [2026-08-02-dig-5-old](OpenSpec/Archive/Service/2026-08-02-dig-5-old/2026-08-02-dig-5-old)\n  - [web](OpenSpec/Archive/Service/2026-08-02-dig-5-old/web/web)'
        );
        expect(fs.existsSync(path.join(d, 'docs/OpenSpec/Archive/Service/Service.md'))).toBe(true);
    });
});

// Человеческое имя (опция nameKey): подпись и сегмент пути change'а верхнего уровня —
// значение ключа; повтор в той же папке и недопустимое значение — откат на id.
describe('плагин openspec: опция nameKey', () => {
    let d;
    const readD = (rel) => fs.readFileSync(path.join(d, 'docs', rel), 'utf8');
    const page = (...segs) => encodeURI(`${segs.join('/')}/${segs.at(-1)}`);
    beforeAll(() => {
        d = makeFixture('name', [
            ['openspec', { parentKey: 'x-parent', groupKey: 'x-team', nameKey: 'x-name' }]
        ]);
        addFamily(d);
        const s = path.join(d, 'openspec');
        write(
            s,
            'changes/dig-3-root/.openspec.yaml',
            'schema: spec-driven\nx-team: Service\nx-name: Корень задачи\n'
        );
        // то же имя в другой группе — допустимо
        write(
            s,
            'changes/dig-4-orphan/.openspec.yaml',
            'x-parent: dig-404\nx-team: Innovation\nx-name: Корень задачи\n'
        );
        // повтор имени в одной папке: первый по порядку получает имя, второй — id
        write(
            s,
            'changes/dig-1-alpha/.openspec.yaml',
            'schema: spec-driven\ncreated: 2026-08-01\nx-name: Бета\n'
        );
        write(s, 'changes/dig-2-beta/.openspec.yaml', 'x-name: Бета\n');
        // имя совпадает с id другого change'а — тот же путь, остаётся id
        write(s, 'changes/dig-0-zero/.openspec.yaml', 'x-name: dig-2-beta\n');
        write(s, 'changes/dig-0-zero/proposal.md', '## Why\n\ndig-0-zero\n');
        // недопустимое значение для сегмента пути — id
        write(s, 'changes/archive/2026-08-02-dig-5-old/.openspec.yaml', 'x-name: a/b\n');
        // `#` encodeURI не кодирует — ссылка оборвалась бы на якоре, поэтому id
        write(s, 'changes/dig-6-hash/.openspec.yaml', 'x-name: "Задача #6"\n');
        write(s, 'changes/dig-6-hash/proposal.md', '## Why\n\ndig-6-hash\n');
        // короткие адреса: архивная копия активного change'а и два архива одного id
        write(s, 'changes/archive/2026-07-01-dig-3-root/proposal.md', '## Why\n\nold root\n');
        write(s, 'changes/archive/2026-07-01-dig-5-old/proposal.md', '## Why\n\nolder\n');
        runBuild(d);
    });
    afterAll(() => fs.rmSync(d, { recursive: true, force: true }));

    it('sidebar: имена вместо id, вложенные — под именем родителя', () => {
        const sidebar = readD('_sidebar.md');
        expect(sidebar).toContain(
            `        * [Корень задачи](${page('OpenSpec', 'Changes', 'Service', 'Корень задачи')})`
        );
        expect(sidebar).toContain(
            `        * [Корень задачи](${page('OpenSpec', 'Changes', 'Innovation', 'Корень задачи')})`
        );
        expect(sidebar).toContain(
            `          * [ios](${page('OpenSpec', 'Changes', 'Service', 'Корень задачи', 'ios')})`
        );
        expect(sidebar).toContain(`      * [Бета](${page('OpenSpec', 'Changes', 'Бета')})`);
        expect(sidebar).toContain('      * [dig-2-beta](OpenSpec/Changes/dig-2-beta/dig-2-beta)');
        expect(sidebar).toContain('      * [dig-0-zero](OpenSpec/Changes/dig-0-zero/dig-0-zero)');
        expect(sidebar).toContain(
            '      * [2026-08-02-dig-5-old](OpenSpec/Archive/2026-08-02-dig-5-old/2026-08-02-dig-5-old)'
        );
        expect(sidebar).toContain('      * [dig-6-hash](OpenSpec/Changes/dig-6-hash/dig-6-hash)');
        expect(sidebar).not.toContain('Задача');
        expect(sidebar).not.toContain('OpenSpec/Changes/Service/dig-3-root/');
    });

    it('таблица и связи — по именам', () => {
        expect(readD('OpenSpec/Changes/Changes.md')).toContain(
            `| [Корень задачи](${page('OpenSpec', 'Changes', 'Service', 'Корень задачи')}) |`
        );
        expect(readD('OpenSpec/Changes/Service/Корень задачи/ios/ios.md')).toContain(
            `**Parent:** [Корень задачи](${page('OpenSpec', 'Changes', 'Service', 'Корень задачи')})`
        );
    });

    // Короткие адреса `#/change/<id>` (change site-agent-review): ключ — ASCII-id, значение —
    // закодированный путь страницы; активный важнее архивного, из архивных — новейший.
    it('карта переадресаций в index.html: группа и имя, вложенный, архив, активный+архивный', () => {
        const html = readD('index.html');
        const { redirects } = JSON.parse(
            html.match(/window\.\$docsify = (\{[\s\S]*?\});\s*<\/script>/)[1]
        ).c4builder;
        expect(redirects).toMatchObject({
            '/change/dig-3-root': `/${page('OpenSpec', 'Changes', 'Service', 'Корень задачи')}`,
            '/change/dig-3-root-ios': `/${page('OpenSpec', 'Changes', 'Service', 'Корень задачи', 'ios')}`,
            '/change/dig-3-root-design': `/${page('OpenSpec', 'Changes', 'Service', 'Корень задачи', 'dig-3-root-design')}`,
            '/change/dig-1-alpha': `/${page('OpenSpec', 'Changes', 'Бета')}`,
            '/change/dig-5-old': '/OpenSpec/Archive/2026-08-02-dig-5-old/2026-08-02-dig-5-old'
        });
        // Вложенный архивный: по полному id, на страницу под тем архивным родителем, куда его
        // положила раскладка (при двух архивах одного id layoutChanges берёт последний в списке).
        expect(redirects['/change/dig-5-old-web']).toMatch(
            /^\/OpenSpec\/Archive\/\d{4}-\d{2}-\d{2}-dig-5-old\/web\/web$/
        );
        expect(Object.keys(redirects).filter((k) => /dig-3-root$|dig-5-old$/.test(k))).toEqual([
            '/change/dig-3-root',
            '/change/dig-5-old'
        ]);
        expect(Object.keys(redirects).every((k) => /^\/change\/[\w.-]+$/.test(k))).toBe(true);
        expect(html).toContain('<script src="vendor/c4builder-redirects.js"></script>');
    });
});

// Колонки из `.openspec.yaml` в таблице Changes (опция columns), например исполнитель.
describe('плагин openspec: опция columns', () => {
    let d;
    const readD = (rel) => fs.readFileSync(path.join(d, 'docs', rel), 'utf8');
    beforeAll(() => {
        d = makeFixture('columns', [
            [
                'openspec',
                {
                    parentKey: 'x-parent',
                    columns: [
                        { key: 'x-assignee', title: 'Assignee' },
                        { key: 'x-jira', title: 'Jira' }
                    ]
                }
            ]
        ]);
        addFamily(d);
        const s = path.join(d, 'openspec');
        write(
            s,
            'changes/dig-3-root/.openspec.yaml',
            // значение в кавычках — целиком, `#` внутри — не комментарий
            'schema: spec-driven\nx-assignee: "Alice #1" # lead\nx-jira: DIG-3\n'
        );
        // `|` в значении экранируется, иначе строка таблицы развалится
        write(s, 'changes/dig-3-root-ios/.openspec.yaml', 'x-parent: dig-3-root\nx-assignee: Bob | Carol\n');
        runBuild(d);
    });
    afterAll(() => fs.rmSync(d, { recursive: true, force: true }));

    it('заголовок и значения колонок; нет значения — прочерк', () => {
        const md = readD('OpenSpec/Changes/Changes.md');
        expect(md).toContain(
            '| Change | Schema | Tasks | Updated | Assignee | Jira |\n|---|---|---|---|---|---|'
        );
        expect(md).toMatch(
            /\| \[dig-3-root\]\(OpenSpec\/Changes\/dig-3-root\/dig-3-root\) \| spec-driven \| .* \| Alice #1 \| DIG-3 \|/
        );
        expect(md).toMatch(
            /\| ↳ \[ios\]\(OpenSpec\/Changes\/dig-3-root\/ios\/ios\) \| — \| .* \| Bob \\\| Carol \| — \|/
        );
        expect(readD('OpenSpec/OpenSpec.md')).toContain('| Assignee | Jira |');
    });
});

describe('плагин openspec: файлы диаграмм в артефактах', () => {
    it('![](flow.puml) — диаграмма страницы, исходник в выход не копируется', () => {
        const page = read('OpenSpec/Changes/dig-2-beta/dig-2-beta.md');
        expect(page).toMatch(/!\[[^\]]*\]\(flow\.svg\)/);
        expect(page).not.toContain('flow.puml');
        expect(read('OpenSpec/Changes/dig-2-beta/flow.svg')).toContain('<svg');
        expect(fs.existsSync(path.join(dir, 'docs/OpenSpec/Changes/dig-2-beta/flow.puml'))).toBe(false);
    });

    it('битый файл диаграммы — заглушка вместо картинки, сборка проходит', () => {
        expect(read('OpenSpec/Changes/dig-2-beta/broken.svg')).toContain('diagram not rendered');
    });

    // Отдельный store: коллизии имён, include/импорты соседних файлов, ссылки с title.
    describe('имена, зависимости и title', () => {
        let d;
        let out;
        const readD = (rel) => fs.readFileSync(path.join(d, 'docs', rel), 'utf8');
        const svgs = (rel) => fs.readdirSync(path.join(d, 'docs', rel)).filter((f) => f.endsWith('.svg'));
        beforeAll(() => {
            d = makeFixture('diagram-files', ['openspec'], false);
            const c = path.join(d, 'openspec/changes/dig-3');
            write(
                c,
                'proposal.md',
                [
                    '![D](flow.d2)',
                    '![M](flow.mmd)',
                    '![P](ctx.puml)',
                    '![I](imp.d2)',
                    '![T](titled.mmd "Titled")',
                    "![S](sized.mmd ':size=600')",
                    ''
                ].join('\n\n')
            );
            write(c, 'flow.d2', 'fromD2 -> other\n');
            write(c, 'flow.mmd', 'flowchart LR\n  A[fromMermaid] --> B\n');
            write(c, 'ctx.puml', '@startuml\n!include styles.iuml\nAlice -> Bob\n@enduml\n');
            write(c, 'styles.iuml', 'Carol -> Dave : fromInclude\n');
            write(c, 'imp.d2', '...@lib\nx -> imported\n');
            write(c, 'lib.d2', 'imported: fromImport\n');
            write(c, 'titled.mmd', 'flowchart LR\n  A --> B\n');
            write(c, 'sized.mmd', 'flowchart LR\n  C --> D\n');
            // одноимённый файл из подфайла `:include` — другая папка, другая диаграмма
            write(c, 'design.md', "![A](seq.mmd)\n\n[B](_back/back.md ':include')\n");
            write(c, 'seq.mmd', 'flowchart LR\n  A[topSeq] --> B\n');
            write(c, '_back/back.md', '![B](seq.mmd)\n');
            write(c, '_back/seq.mmd', 'flowchart LR\n  A[backSeq] --> B\n');
            out = runBuild(d);
        });
        afterAll(() => fs.rmSync(d, { recursive: true, force: true }));

        it('flow.d2 + flow.mmd рядом — две картинки и предупреждение о коллизии', () => {
            const page = readD('OpenSpec/Changes/dig-3/dig-3.md');
            const hashed = page.match(/!\[diagram\]\(([0-9a-f]{8}-flow\.svg)\)/)?.[1];
            expect(page).toContain('![diagram](flow.svg)');
            expect(hashed).toBeDefined();
            expect(readD('OpenSpec/Changes/dig-3/flow.svg')).toContain('fromD2');
            expect(readD(`OpenSpec/Changes/dig-3/${hashed}`)).toContain('fromMermaid');
            expect(out).toContain(
                "Output name collision 'flow.svg': 'openspec/changes/dig-3/flow.d2' and 'openspec/changes/dig-3/flow.mmd'"
            );
        });

        it('одноимённые диаграммы страницы и её :include-подфайла — разные картинки, без предупреждения', () => {
            const page = readD('OpenSpec/Changes/dig-3/design/design.md');
            const hashed = page.match(/!\[diagram\]\(([0-9a-f]{8}-seq\.svg)\)/)?.[1];
            expect(page).toContain('![diagram](seq.svg)');
            expect(hashed).toBeDefined();
            expect(svgs('OpenSpec/Changes/dig-3/design')).toHaveLength(2);
            expect(readD('OpenSpec/Changes/dig-3/design/seq.svg')).toContain('topSeq');
            expect(readD(`OpenSpec/Changes/dig-3/design/${hashed}`)).toContain('backSeq');
            expect(out).not.toContain("collision 'seq.svg'");
        });

        it('!include PlantUML и импорт D2 находят соседние файлы', () => {
            expect(readD('OpenSpec/Changes/dig-3/ctx.svg')).toContain('fromInclude');
            expect(readD('OpenSpec/Changes/dig-3/imp.svg')).toContain('fromImport');
            expect(out).not.toMatch(/cannot include|failed to import|not rendered/);
        });

        it('правка включённого и импортированного файла перерисовывает картинку (чексумма)', () => {
            const c = path.join(d, 'openspec/changes/dig-3');
            write(c, 'styles.iuml', 'Carol -> Dave : changedInclude\n');
            write(c, 'lib.d2', 'imported: changedImport\n');
            runBuild(d);
            expect(readD('OpenSpec/Changes/dig-3/ctx.svg')).toContain('changedInclude');
            expect(readD('OpenSpec/Changes/dig-3/imp.svg')).toContain('changedImport');
        });

        it('ссылка с title — картинка на месте ссылки, title сохранён', () => {
            const page = readD('OpenSpec/Changes/dig-3/dig-3.md');
            expect(page).toContain('![diagram](titled.svg "Titled")');
            expect(page).toContain("![diagram](sized.svg ':size=600')");
            expect(page).not.toMatch(/\.mmd\b/);
            // не дописаны второй раз в конец страницы как «неупомянутые»
            expect(page.match(/titled\.svg/g)).toHaveLength(1);
            expect(page.match(/sized\.svg/g)).toHaveLength(1);
        });
    });
});
