import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    defaultConfig,
    MermaidError,
    renderMermaid,
    resvgFontOptions,
    teardownMermaid,
    textWidth
} from './dist.mjs';
import { REPO_ROOT, TMP_ROOT } from './helpers.mjs';

// Mermaid-движок (change mermaid-diagrams): @mermaid-js/tiny в jsdom, геометрия текста —
// resvg по вендорному шрифту. Фикстуры синтетические, подписи кириллические.
const SRC = {
    flowchart:
        'flowchart LR\n  subgraph Банк\n    A[Клиент] -->|запрос| B(Сервис)\n  end\n  B --> C[(База данных)]',
    sequence:
        'sequenceDiagram\n  participant К as Клиент\n  participant С as Сервис\n  К->>С: Запрос\n' +
        '  Note right of С: обработка\n  С-->>К: Ответ',
    state: 'stateDiagram-v2\n  [*] --> Новый\n  Новый --> Активный\n  Активный --> [*]',
    er: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE : contains',
    class: 'classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }\n  Animal <|-- Dog',
    gantt: 'gantt\n  title План\n  dateFormat YYYY-MM-DD\n  section S\n  Задача A :a1, 2024-01-01, 3d\n  Задача B :after a1, 2d',
    pie: 'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85'
};
// Эталон — те же источники и конфигурация в настоящем браузере (headless Chrome, бандл из
// node_modules, вендорный шрифт): размеры диаграмм совпадают. Расхождение до 1 px — от
// системного fallback-шрифта, которым Chrome меряет часть подписей.
const BROWSER_SIZE = {
    flowchart: [685.7, 132],
    sequence: [550, 302],
    state: [152, 258],
    er: [146.25, 444],
    class: [162.3, 262],
    gantt: [800, 148],
    pie: [551.58, 450]
};

const render = async (src, file = 'x.mmd') => (await renderMermaid(src, file)).toString();
// Разметка без <style>: в CSS mermaid есть правила для neo-вида и фильтров, не применяемые к classic.
const body = (svg) => svg.replace(/<style>[\s\S]*?<\/style>/, '');
const size = (svg) => /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg).slice(1).map(Number);
const rejection = async (promise) => {
    try {
        await promise;
    } catch (e) {
        return e;
    }
    throw new Error('ожидалась ошибка');
};
// Пиксели PNG цвета заливки (фон прозрачный): фигуры, пропавшие из-за фильтров, дали бы 0.
const pixelsOf = (svg, [r, g, b]) => {
    const { pixels } = new Resvg(svg, { font: resvgFontOptions(false) }).render();
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] === r && pixels[i + 1] === g && pixels[i + 2] === b && pixels[i + 3] === 255) n++;
    return n;
};

afterAll(() => teardownMermaid());

describe('рендер', () => {
    it.each(
        Object.keys(SRC)
    )('%s: размер как в браузере, без foreignObject, фильтров и внешних адресов', async (type) => {
        const svg = await render(SRC[type]);
        const [w, h] = size(svg);
        expect(Math.abs(w - BROWSER_SIZE[type][0]), `width ${w}`).toBeLessThanOrEqual(1);
        expect(Math.abs(h - BROWSER_SIZE[type][1]), `height ${h}`).toBeLessThanOrEqual(1);
        expect(svg).not.toContain('foreignObject');
        expect(svg).not.toMatch(/<filter|\sfilter=|filter:/);
        expect(svg).not.toContain('@import');
        expect(svg.replace(/xmlns(:\w+)?="http:\/\/www\.w3\.org\/[^"]*"/g, '')).not.toMatch(/https?:/);
    });

    it('кириллические подписи flowchart помещаются в фигуры', async () => {
        const svg = await render(SRC.flowchart);
        const nodes = [
            ...svg.matchAll(
                /<rect class="basic label-container"[^>]*width="([\d.]+)"[\s\S]*?class="text-inner-tspan"[^>]*>([^<]+)</g
            )
        ];
        expect(nodes.map(([, , label]) => label)).toEqual(['Клиент', 'Сервис']);
        for (const [, width, label] of nodes) expect(textWidth(label, 16)).toBeLessThan(Number(width));
    });

    it('gantt: ненулевая ширина и полосы задач', async () => {
        const svg = await render(SRC.gantt);
        expect(size(svg)[0]).toBeGreaterThan(0);
        const bars = [...svg.matchAll(/<rect [^>]*class="task [^"]*"[^>]*/g)];
        expect(bars).toHaveLength(2);
        for (const [bar] of bars) expect(Number(/width="([\d.]+)"/.exec(bar)[1])).toBeGreaterThan(0);
    });

    it('classic закреплён: %%{init}%% и frontmatter не включают neo и HTML-подписи', async () => {
        for (const src of [
            '%%{init: {"look": "neo", "htmlLabels": true}}%%\nflowchart LR\n  A --> B',
            '---\nconfig:\n  look: neo\n  htmlLabels: true\n---\nflowchart LR\n  A --> B'
        ]) {
            const svg = body(await render(src));
            expect(svg).toContain('data-look="classic"');
            expect(svg).not.toContain('data-look="neo"');
            expect(svg).not.toContain('foreignObject');
        }
    });

    it('CSS под resvg: списки селекторов разнесены, каналы rgba() целые', async () => {
        const svg = await render(SRC.class);
        // Иначе resvg выбросил бы правило .extension целиком из-за [id$=…] в списке, и
        // наконечник наследования стал бы залитым.
        expect(svg).not.toMatch(/\[id\$="[^"]*"\]\s*,/);
        expect(svg).toMatch(/#m[0-9a-f]{8} \.extension\{fill:transparent/);
        for (const [, args] of svg.matchAll(/rgba?\(([^)]*)\)/g))
            for (const channel of args.split(',').slice(0, 3)) expect(channel.trim()).toMatch(/^\d+$/);
    });

    // Дефект смоука на реальном корпусе: каскад CSS обходил всё дерево SVG на каждый замер —
    // ER на 20 сущностей рендерился около минуты, после исправления — пару секунд.
    it('большая ER-диаграмма рендерится за секунды', async () => {
        const entities = Array.from(
            { length: 20 },
            (_, i) =>
                `  Сущность${i} {\n${Array.from({ length: 10 }, (_, j) => `    string поле${j}`).join('\n')}\n  }`
        );
        const relations = Array.from(
            { length: 19 },
            (_, i) => `  Сущность${i} ||--o{ Сущность${i + 1} : связь`
        );
        const start = Date.now();
        await render(`erDiagram\n${entities.join('\n')}\n${relations.join('\n')}`);
        expect(Date.now() - start).toBeLessThan(20_000);
    }, 60_000);

    it('PNG: узлы и участники видны', async () => {
        const NODE_FILL = [236, 236, 255]; // #ECECFF темы default
        expect(pixelsOf(await render(SRC.flowchart), NODE_FILL)).toBeGreaterThan(10_000);
        expect(pixelsOf(await render(SRC.sequence), NODE_FILL)).toBeGreaterThan(30_000);
        expect(pixelsOf(await render(SRC.sequence), [255, 245, 173])).toBeGreaterThan(1_000); // заметка
    });
});

describe('детерминизм', () => {
    const RANDOM = 'gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev';

    it('повторный рендер в одном процессе побайтно равен, случайные id gitGraph — от seed', async () => {
        const run = async () => [
            await render(SRC.sequence),
            await render(SRC.er),
            await render(SRC.class),
            await render(RANDOM)
        ];
        const first = await run();
        expect(await run()).toEqual(first);
    });

    it('SVG не зависит от рендеров перед ним и от окна', async () => {
        await render(SRC.flowchart);
        await render(SRC.sequence);
        const after = await render(SRC.class);
        await teardownMermaid();
        expect(await render(SRC.class)).toBe(after);
    });

    it('окно jsdom не протекает в глобальные объекты процесса', async () => {
        await render(SRC.flowchart);
        expect(globalThis.document).toBeUndefined();
        expect(globalThis.mermaid).toBeUndefined();
    });
});

describe('ошибки', () => {
    it('mindmap и architecture: тип назван неподдерживаемым', async () => {
        for (const [src, type] of [
            ['mindmap\n  root((Корень))\n    A', 'mindmap'],
            ['%% схема\narchitecture-beta\n  service db(database)[DB]', 'architecture-beta']
        ]) {
            const e = await rejection(render(src, 'a/m.mmd'));
            expect(e).toBeInstanceOf(MermaidError);
            expect(e.message).toBe(`a/m.mmd: ${e.problems[0]}`);
            expect(e.problems[0]).toMatch(
                new RegExp(`^line \\d: unsupported mermaid diagram type '${type}'$`)
            );
        }
    });

    it('KaTeX: явная ошибка вместо формулы сырым текстом', async () => {
        const e = await rejection(render('flowchart LR\n  A --> B\n  B["$$x^2$$"]'));
        expect(e.problems).toEqual(["line 3: unsupported mermaid feature 'KaTeX math' ($$...$$)"]);
    });

    it('синтаксическая ошибка: номер строки файла с учётом frontmatter и комментариев', async () => {
        const e = await rejection(render('flowchart LR\n  A -->> ((B'));
        expect(e.problems[0]).toMatch(/^line 2: .*Expecting .*got 'TAGEND'$/);
        const shifted = await rejection(
            render(
                '---\ntitle: T\n---\n%%{init: {"theme": "forest"}}%%\n\n%% comment\nflowchart LR\n  A --> B\n  B -->> ((C'
            )
        );
        expect(shifted.problems[0]).toMatch(/^line 9: /);
    });

    it('неизвестный тип и пустой источник', async () => {
        expect((await rejection(render('hello world'))).problems).toEqual([
            "line 1: unknown mermaid diagram type 'hello'"
        ]);
        expect((await rejection(render(''))).problems).toEqual([
            "line 1: unknown mermaid diagram type '(empty)'"
        ]);
    });
});

// Интеграция со сборкой: .mmd — файл диаграммы (ошибка роняет сборку), блок — мягкий.
describe('сборка проекта', () => {
    const CLI = path.join(REPO_ROOT, 'dist', 'index.js');
    let dir;
    const project = (name, files) => {
        const root = path.join(dir, name);
        for (const [rel, content] of Object.entries({
            ...files,
            '.c4builder': JSON.stringify({ ...defaultConfig, projectName: name, hasRun: true })
        })) {
            fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        }
        // Таймаут: незакрытое окно jsdom не дало бы CLI завершиться.
        return {
            root,
            res: spawnSync(process.execPath, [CLI], {
                cwd: root,
                encoding: 'utf8',
                input: '',
                timeout: 120_000
            })
        };
    };

    beforeAll(() => {
        fs.mkdirSync(TMP_ROOT, { recursive: true });
        dir = fs.mkdtempSync(path.join(TMP_ROOT, 'mermaid-'));
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('.mmd и блок рендерятся, CLI завершается', () => {
        const { root, res } = project('ok', {
            'src/README.md': `# Home\n\n\`\`\`mermaid\n${SRC.sequence}\n\`\`\`\n`,
            'src/s/README.md': '# S\n',
            'src/s/flow.mmd': SRC.flowchart
        });
        expect(res.error).toBeUndefined();
        expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
        expect(fs.readFileSync(path.join(root, 'docs', 's', 'flow.svg'), 'utf8')).toContain('Клиент');
        const page = fs.readFileSync(path.join(root, 'docs', 'README.md'), 'utf8');
        expect(page).not.toContain('```mermaid');
        const [, image] = /!\[diagram\]\((README-[0-9a-f]{8}\.svg)\)/.exec(page);
        expect(fs.readFileSync(path.join(root, 'docs', image), 'utf8')).toContain('обработка');
    });

    it('битый .mmd роняет сборку с путём файла и строкой', () => {
        const { res } = project('bad-file', {
            'src/README.md': '# Home\n',
            'src/flow.mmd': 'flowchart LR\n  A --> B\n  B -->> ((C'
        });
        expect(res.status).toBe(1);
        expect(`${res.stdout}${res.stderr}`).toMatch(/src\/flow\.mmd: line 3: /);
    });

    it('битый блок: код 0, заглушка, предупреждение с именем .md', () => {
        const { root, res } = project('bad-block', {
            'src/README.md': '# Home\n\n```mermaid\nmindmap\n  root\n```\n'
        });
        expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
        expect(res.stdout).toMatch(/⚠ .*\(src\/README\.md\).*unsupported mermaid diagram type 'mindmap'/);
        const [, image] = /!\[diagram\]\((README-[0-9a-f]{8}\.svg)\)/.exec(
            fs.readFileSync(path.join(root, 'docs', 'README.md'), 'utf8')
        );
        expect(fs.readFileSync(path.join(root, 'docs', image), 'utf8')).toContain('diagram not rendered');
    });
});
