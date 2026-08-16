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
    generateCompleteMD: false,
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
        '## Why\n\nSee [design](design.md) and [tasks](./tasks.md#done) and [delta](specs/area/cap-a/spec.md).\n\n![pic](img/pic.png)\n'
    );
    write(
        s,
        'changes/dig-1-alpha/design.md',
        '## Context\n\nDiagram:\n\n```plantuml\n!include <C4/C4_Context>\nPerson(u, "Alice")\nSystem(s, "Sys")\nRel(u, s, "uses")\n```\n\nAfter.\n\n```js\nconst x = 1; // не диаграмма\n```\n'
    );
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
    // спеки: одно- и двухуровневые
    write(s, 'specs/solo/spec.md', '## Purpose\n\nsolo spec\n');
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
    it('sidebar: раздел OpenSpec с подразделами Changes/Specs/Archive', () => {
        const lines = read('_sidebar.md').trimEnd().split('\n');
        expect(lines).toEqual([
            '* [Overview](Overview)',
            '  * [A](A/A)',
            '  * [OpenSpec](OpenSpec/OpenSpec)',
            '    * [Changes](OpenSpec/Changes/Changes)',
            '      * [dig-1-alpha](OpenSpec/Changes/dig-1-alpha/dig-1-alpha)',
            '      * [dig-2-beta](OpenSpec/Changes/dig-2-beta/dig-2-beta)',
            '    * [Specs](OpenSpec/Specs/Specs)',
            '      * [area](OpenSpec/Specs/area/area)',
            '        * [cap-a](OpenSpec/Specs/area/cap-a/cap-a)',
            '        * [cap-b](OpenSpec/Specs/area/cap-b/cap-b)',
            '      * [solo](OpenSpec/Specs/solo/solo)',
            '    * [Archive](OpenSpec/Archive/Archive)',
            '      * [2026-08-01-dig-0-old](OpenSpec/Archive/2026-08-01-dig-0-old/2026-08-01-dig-0-old)'
        ]);
    });

    it('сводка: счётчики, прогресс, таблица со ссылками', () => {
        const md = read('OpenSpec/OpenSpec.md');
        expect(md).toContain("**Активных change'ов:** [2](OpenSpec/Changes/Changes)");
        expect(md).toContain('**Спек:** [3](OpenSpec/Specs/Specs)');
        expect(md).toContain('**В архиве:** [1](OpenSpec/Archive/Archive)');
        expect(md).toContain('**Задачи:** 1/3');
        expect(md).toMatch(
            /\| \[dig-1-alpha\]\(OpenSpec\/Changes\/dig-1-alpha\/dig-1-alpha\) \| spec-driven \| 1\/3 \| \d{4}-\d{2}-\d{2} \|/
        );
        expect(md).toMatch(/\| \[dig-2-beta\]\(OpenSpec\/Changes\/dig-2-beta\/dig-2-beta\) \| — \| — \|/);
    });

    it('страница change: шапка, порядок разделов, сдвиг заголовков, чекбоксы, якоря, дельты', () => {
        const md = read('OpenSpec/Changes/dig-1-alpha/dig-1-alpha.md');
        expect(md).toContain('# dig-1-alpha');
        expect(md).toContain('**Схема:** spec-driven · **Создан:** 2026-08-01 · **Задачи:** 1/3');
        const order = [
            '## proposal',
            '## design',
            '## tasks',
            '## plan',
            '## Дельты спек',
            '### area / cap-a'
        ].map((h) => md.indexOf(`\n${h}\n`));
        expect(order.every((i) => i > 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(md).toContain('### Why'); // h2 артефакта под h2 раздела
        expect(md).toContain('#### Requirement: A'); // дельта: +2
        expect(md).toContain('- [x] 1.1 done');
        expect(md).toContain('[design](#design)');
        expect(md).toContain('[tasks](#done)');
        expect(md).toContain('[delta](#area-cap-a)');
        expect(md).toContain('![pic](img/pic.png)');
        expect(fs.existsSync(path.join(dir, 'docs/OpenSpec/Changes/dig-1-alpha/img/pic.png'))).toBe(true);
    });

    it('```plantuml вырезан и отрендерен локально; ```js остался', () => {
        const md = read('OpenSpec/Changes/dig-1-alpha/dig-1-alpha.md');
        expect(md).not.toContain('```plantuml');
        expect(md).toContain('![diagram](design-1.svg)');
        expect(md).toContain('```js');
        const svg = read('OpenSpec/Changes/dig-1-alpha/design-1.svg');
        expect(svg).toContain('<svg');
        expect(svg).toContain('Alice');
    });

    it('спеки: страницы и промежуточная папка со списком', () => {
        expect(read('OpenSpec/Specs/area/cap-a/cap-a.md')).toContain('cap-a spec');
        const area = read('OpenSpec/Specs/area/area.md');
        expect(area).toContain('- [cap-a](OpenSpec/Specs/area/cap-a/cap-a)');
        expect(read('OpenSpec/Specs/Specs.md')).toContain('  - [cap-b](OpenSpec/Specs/area/cap-b/cap-b)');
    });

    it('архив: сводка со ссылкой и страница', () => {
        expect(read('OpenSpec/Archive/Archive.md')).toContain(
            '- [2026-08-01-dig-0-old](OpenSpec/Archive/2026-08-01-dig-0-old/2026-08-01-dig-0-old)'
        );
        expect(read('OpenSpec/Archive/2026-08-01-dig-0-old/2026-08-01-dig-0-old.md')).toContain(
            '**Задачи:** 2/2'
        );
    });
});

describe('плагин openspec: крайние случаи', () => {
    it('пустой store — раздел с нулевыми счётчиками', () => {
        const d = makeFixture('empty', ['openspec'], false);
        fs.mkdirSync(path.join(d, 'openspec'));
        runBuild(d);
        expect(fs.readFileSync(path.join(d, 'docs/OpenSpec/OpenSpec.md'), 'utf8')).toContain(
            "**Активных change'ов:** [0]"
        );
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
