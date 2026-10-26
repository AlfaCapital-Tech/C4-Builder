import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { embedFigmaImages, loadPlugins } from './dist.mjs';
import { TMP_ROOT, ensureManagedJre, runBuild } from './helpers.mjs';

// Встроенный плагин figma: список фреймов в опциях → раздел Figma со сводкой в порядке
// списка и страницей-эмбедом на фрейм. Сборка в сеть не ходит; embed.figma.com — только на
// страницах раздела. Ключи файлов в фикстуре вымышленные.
const CONFIG = {
    ...JSON.parse(
        fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'default.c4builder.json'), 'utf8')
    ),
    projectName: 'demo',
    generateMD: true,
    generateCompleteMD: false,
    executeScript: false
};

const FRAMES = [
    {
        name: 'Onboarding',
        url: 'https://www.figma.com/design/AbC123xyz/App?node-id=12-34&t=track&p=f',
        description: 'First launch\n\nSecond paragraph.'
    },
    { name: 'Checkout', url: 'https://www.figma.com/file/AbC123xyz/App' },
    { name: 'Mobile/Login', url: 'https://www.figma.com/proto/PrO456/Flow?node-id=1-2&scaling=fit' }
];

const write = (root, rel, content) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
};

const makeFixture = (name, plugins) => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, `plugin-figma-${name}-`));
    write(dir, 'src/README.md', 'root');
    write(
        dir,
        'src/Context/README.md',
        [
            'context',
            '',
            '![Главный экран](https://www.figma.com/design/EmB789/Screens?node-id=5-6&t=x)',
            '',
            'Inline ![chip](https://www.figma.com/design/EmB789/Screens?node-id=7-8) here.',
            '',
            '![bad](https://www.figma.com/nope)',
            '',
            '```',
            '![in code](https://www.figma.com/design/EmB789/Screens)',
            '```'
        ].join('\n')
    );
    fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify({ ...CONFIG, plugins }));
    return dir;
};

let dir;
let log;
const read = (rel) => fs.readFileSync(path.join(dir, 'docs', rel), 'utf8');

beforeAll(async () => {
    await ensureManagedJre();
    dir = makeFixture('ok', [['figma', { frames: FRAMES, height: 800 }]]);
    log = runBuild(dir);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('плагин figma', () => {
    it('раздел Figma: сводка в порядке списка, вложенный Mobile/Login — подраздел', () => {
        expect(read('_sidebar.md')).toContain(
            '  * [Figma](Figma/Figma)\n    * [Onboarding](Figma/Onboarding/Onboarding)\n    * [Checkout](Figma/Checkout/Checkout)\n    * [Mobile](Figma/Mobile/Mobile)\n      * [Login](Figma/Mobile/Login/Login)'
        );
        expect(read('Figma/Figma.md')).toContain(
            '- [Onboarding](Figma/Onboarding/Onboarding) — First launch\n- [Checkout](Figma/Checkout/Checkout)\n- [Mobile/Login](Figma/Mobile/Login/Login)'
        );
    });

    it('страница фрейма: описание, ссылка Open in Figma над iframe с embed-host и node-id', () => {
        const page = read('Figma/Onboarding/Onboarding.md');
        expect(page).toContain(
            'First launch\n\nSecond paragraph.\n\n[Open in Figma](https://www.figma.com/design/AbC123xyz/App?node-id=12-34&t=track&p=f)\n\n<iframe src="https://embed.figma.com/design/AbC123xyz?node-id=12-34&embed-host=c4builder" width="100%" height="800" loading="lazy" allowfullscreen></iframe>'
        );
        // трекинговые параметры в эмбед не попадают
        expect(page).not.toMatch(/embed\.figma\.com[^"]*[?&](t|p)=/);
        // file → design, без node-id — только embed-host
        expect(read('Figma/Checkout/Checkout.md')).toContain(
            '[Open in Figma](https://www.figma.com/file/AbC123xyz/App)\n\n<iframe src="https://embed.figma.com/design/AbC123xyz?embed-host=c4builder"'
        );
        expect(read('Figma/Mobile/Login/Login.md')).toContain(
            '<iframe src="https://embed.figma.com/proto/PrO456?node-id=1-2&embed-host=c4builder"'
        );
    });

    it('executeScript не меняется, ассетов плагина нет, одна строка лога', () => {
        const html = read('index.html');
        expect(html).toContain('"executeScript": false');
        expect(html).not.toContain('vendor/plugins/figma');
        expect(fs.existsSync(path.join(dir, 'docs/vendor/plugins/figma'))).toBe(false);
        expect(
            log.match(
                /figma: 3 frame page\(s\), 2 embed\(s\) in pages load embed\.figma\.com — readers need network access to Figma/g
            )
        ).toHaveLength(1);
        expect(log).not.toContain('requires executeScript');
    });

    it('markdown-выход: ссылка на исходный url есть', () => {
        expect(read('Figma/Onboarding/README.md')).toContain(
            '[Open in Figma](https://www.figma.com/design/AbC123xyz/App?node-id=12-34&t=track&p=f)'
        );
    });

    it('embed.figma.com — только на страницах раздела', () => {
        const files = fs
            .readdirSync(path.join(dir, 'docs'), { recursive: true })
            .map((f) => String(f).split(path.sep).join('/'))
            .filter((f) => /^index\.html$|\.css$|\.md$/.test(f));
        // Страница с картинкой-ссылкой на Figma — тоже эмбед; прочие страницы и index.html — без.
        const outside = files.filter(
            (f) => !f.startsWith('Figma/') && !f.startsWith('Context/') && read(f).includes('embed.figma.com')
        );
        expect(files.filter((f) => f.startsWith('Figma/')).length).toBeGreaterThan(0);
        expect(outside).toEqual([]);
    });
});

describe('плагин figma: эмбеды в страницах', () => {
    const page = () => read('Context/Context.md');

    it('картинка-ссылка одна на строке — ссылка Open in Figma и iframe на её месте', () => {
        expect(page()).toContain(
            '[Open in Figma: Главный экран](https://www.figma.com/design/EmB789/Screens?node-id=5-6&t=x)\n\n<iframe src="https://embed.figma.com/design/EmB789?node-id=5-6&embed-host=c4builder" width="100%" height="800" loading="lazy" allowfullscreen></iframe>'
        );
    });

    it('внутри текста — обычная ссылка, в коде и битая ссылка — без изменений', () => {
        expect(page()).toContain(
            'Inline [chip](https://www.figma.com/design/EmB789/Screens?node-id=7-8) here.'
        );
        expect(page()).toContain('![in code](https://www.figma.com/design/EmB789/Screens)');
        expect(page()).toContain('![bad](https://www.figma.com/nope)');
        expect(page().match(/<iframe/g)).toHaveLength(1);
        expect(log).toContain('figma: https://www.figma.com/nope: not a Figma link');
    });

    it('markdown-выход: ссылка Open in Figma есть', () => {
        expect(read('Context/README.md')).toContain(
            '[Open in Figma: Главный экран](https://www.figma.com/design/EmB789/Screens?node-id=5-6&t=x)'
        );
    });
});

describe('плагин figma: код не трогается', () => {
    const URL = 'https://www.figma.com/design/EmB789/Screens';
    const embed = (md) => embedFigmaImages(md, 'c4builder', 600);

    it('inline-код: ссылка в `…` и ``…`` остаётся как есть, соседняя вне кода — ссылка', () => {
        const md = `Use \`![x](${URL})\` or \`\`![y](${URL})\`\` — ![z](${URL})`;
        const r = embed(md);
        expect(r.count).toBe(1);
        expect(r.md).toBe(`Use \`![x](${URL})\` or \`\`![y](${URL})\`\` — [z](${URL})`);
    });

    it('строка из одного inline-кода — не эмбед', () => {
        const md = `\`![x](${URL})\``;
        expect(embed(md)).toEqual({ md, count: 0 });
    });

    it('блок кода с отступом не трогается, абзац в пункте списка — обрабатывается', () => {
        const code = `text\n\n    ![x](${URL})\n\n\t![y](${URL})\n\nafter`;
        expect(embed(code)).toEqual({ md: code, count: 0 });
        const list = embed(`- item\n\n    ![x](${URL})`);
        expect(list.count).toBe(1);
        expect(list.md).toContain('<iframe');
    });
});

describe('плагин figma: ошибки схемы (до старта сборки)', () => {
    const opts = () => ({ EXECUTE_SCRIPT: false });
    const load = (o) => loadPlugins([['figma', o]], process.cwd(), opts());
    const frame = (url, name = 'A') => ({ name, url });

    it('неизвестный ключ — ошибка с именем плагина и опции; frames необязателен', async () => {
        await expect(load({})).resolves.toBeDefined();
        await expect(load({ frames: [] })).resolves.toBeDefined();
        await expect(
            load({ frames: [frame('https://www.figma.com/design/K/A')], hieght: 1 })
        ).rejects.toThrow(/hieght/);
    });

    it('не ссылка Figma — ошибка с индексом фрейма и ожидаемой формой', async () => {
        for (const bad of [
            'https://example.com/mockup.png',
            'not a url',
            'https://www.figma.com/embed?url=https://www.figma.com/design/K/A',
            'https://www.figma.com/K/A',
            'https://www.figma.com/design/',
            // Тип — ключ прототипа: не должен давать мусорный адрес эмбеда.
            'https://www.figma.com/constructor/K/A',
            'https://www.figma.com/toString/K/A'
        ])
            await expect(
                load({ frames: [frame('https://www.figma.com/design/K/A'), frame(bad, 'B')] })
            ).rejects.toThrow(
                /plugins\[0\] figma: frames\.1\.url — not a Figma link, expected https:\/\/www\.figma\.com\/<design\|file\|proto\|board\|slides\|deck>\/<key>\/<name>\?node-id=…/
            );
    });

    it('дубль имени и пустой сегмент имени — ошибка', async () => {
        await expect(
            load({
                frames: [
                    frame('https://www.figma.com/design/K/A', 'Checkout'),
                    frame('https://www.figma.com/board/B', 'Checkout')
                ]
            })
        ).rejects.toThrow(/frames\.1\.name — duplicate frame name "Checkout"/);
        await expect(load({ frames: [frame('https://www.figma.com/design/K/A', 'a//b')] })).rejects.toThrow(
            /frames\.0\.name — empty segment in frame name "a\/\/b"/
        );
        await expect(load({ frames: [frame('https://www.figma.com/design/K/A', '/a')] })).rejects.toThrow(
            /empty segment/
        );
    });

    it('нормализация: все типы, embed.figma.com, figma.com без www, node-id сохраняется', async () => {
        const [{ opts: o }] = await load({
            embedHost: 'demo',
            frames: [
                frame('https://figma.com/design/K1/Name?node-id=1-2', 'd'),
                frame('https://www.figma.com/file/K2/Name', 'f'),
                frame('https://www.figma.com/proto/K3?node-id=3-4&scaling=min-zoom', 'p'),
                frame('https://www.figma.com/board/K4/Board', 'b'),
                frame('https://www.figma.com/slides/K5/Deck', 's'),
                frame('https://www.figma.com/deck/K6/Deck?node-id=5%3A6', 'k'),
                frame('https://embed.figma.com/design/K7?node-id=7-8&embed-host=other', 'e')
            ]
        });
        expect(o.mount).toBe('Figma');
        expect(o.height).toBe(600);
        expect(o.frames.map((f) => f.embed)).toEqual([
            'https://embed.figma.com/design/K1?node-id=1-2&embed-host=demo',
            'https://embed.figma.com/design/K2?embed-host=demo',
            'https://embed.figma.com/proto/K3?node-id=3-4&embed-host=demo',
            'https://embed.figma.com/board/K4?embed-host=demo',
            'https://embed.figma.com/slides/K5?embed-host=demo',
            'https://embed.figma.com/deck/K6?node-id=5%3A6&embed-host=demo',
            'https://embed.figma.com/design/K7?node-id=7-8&embed-host=demo'
        ]);
        expect(o.frames[0].url).toBe('https://figma.com/design/K1/Name?node-id=1-2');
    });
});
