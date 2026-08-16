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
        '## Context\n\nDiagram:\n\n```plantuml\n!include <C4/C4_Context>\nPerson(u, "Alice")\nSystem(s, "Sys")\nRel(u, s, "uses")\n```\n\nAfter.\n\n```js\nconst x = 1; // не диаграмма\n```\n'
    );
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
    write(s, 'changes/dig-2-beta/proposal.md', '## Why\n\nbeta\n');
    // архив
    write(s, 'changes/archive/2026-08-01-dig-0-old/proposal.md', '## Why\n\nold\n');
    write(s, 'changes/archive/2026-08-01-dig-0-old/tasks.md', '- [x] a\n- [x] b\n');
    // спеки: одно- и двухуровневые; папка area с собственной spec.md (d2-диаграмма) и вложенными
    write(s, 'specs/solo/spec.md', '## Purpose\n\nsolo spec\n');
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
        expect(() => runBuild(d)).toThrow(/OpenSpec store не найден: .*nope/);
        fs.rmSync(d, { recursive: true, force: true });
        const d2 = makeFixture('mount', [['openspec', { mount: 'Планы' }]]);
        runBuild(d2);
        expect(fs.existsSync(path.join(d2, 'docs/Планы/Changes/dig-1-alpha/dig-1-alpha.md'))).toBe(true);
        expect(fs.readFileSync(path.join(d2, 'docs/_sidebar.md'), 'utf8')).toContain('* [Планы](%D0%9F');
        fs.rmSync(d2, { recursive: true, force: true });
    });
});
