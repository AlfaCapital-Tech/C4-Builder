import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addPage, addRedirect, isVirtual } from './dist.mjs';
import { REPO_ROOT, TMP_ROOT, ensureManagedJre, runBuild } from './helpers.mjs';

// Виртуальные страницы плагинов: сквозной прогон реального CLI на мини-фикстуре с
// локальным плагином `./plugin.mjs` — sidebar, страницы сайта, generateMD, complete,
// локальный рендер PlantUML на stdlib, порядок DFS, ассеты и afterBuild.
// База — полный конфиг golden-фикстуры (визард спрашивает недостающие ключи).
const CONFIG = {
    ...JSON.parse(
        fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'default.c4builder.json'), 'utf8')
    ),
    projectName: 'demo',
    includeNavigation: false,
    includeTableOfContents: false,
    includeBreadcrumbs: false
};

const PLUGIN = `
import fs from 'node:fs';
import path from 'node:path';
export default {
    name: 'demo',
    assets: { styles: [path.resolve('assets/demo.css')], scripts: [path.resolve('assets/demo.js')] },
    watchPaths: () => ['no-such-dir'],
    afterScan(ctx) {
        ctx.addPage({ path: ['A', 'Virt'], markdown: 'virtual under real folder' });
        ctx.addPage({ path: ['M'], markdown: 'mount summary' });
        ctx.addPage({
            path: ['M', 'Sub', 'Page'],
            markdown: 'Text before ![ctx](d1.puml) after',
            diagrams: [{ file: 'd1.puml', content: '@startuml\\n!include <C4/C4_Context>\\nPerson(u, "User")\\nSystem(s, "Sys")\\nRel(u, s, "uses")\\n@enduml' }]
        });
        ctx.addRedirect(['change', 'x'], ['M', 'Sub', 'Page']);
        ctx.addRedirect(['change', 'Ё й'], ['A', 'Virt']);
    },
    afterBuild(ctx) { fs.writeFileSync(path.join(ctx.distFolder, 'after-build.txt'), 'ok'); }
};
`;

const makeFixture = (name, pluginBody, config = CONFIG) => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, `plugins-tree-${name}-`));
    for (const rel of ['src', 'src/A', 'src/A/B', 'src/Z', 'assets']) fs.mkdirSync(path.join(dir, rel));
    fs.writeFileSync(path.join(dir, 'src/README.md'), 'root text');
    fs.writeFileSync(path.join(dir, 'src/A/README.md'), 'a text');
    fs.writeFileSync(path.join(dir, 'src/A/B/README.md'), 'b text');
    fs.writeFileSync(path.join(dir, 'src/Z/README.md'), 'z text');
    fs.writeFileSync(path.join(dir, 'assets/demo.css'), 'body{}');
    fs.writeFileSync(path.join(dir, 'assets/demo.js'), 'window.demo=1;');
    fs.writeFileSync(path.join(dir, 'plugin.mjs'), pluginBody);
    fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify({ ...config, plugins: ['./plugin.mjs'] }));
    return dir;
};

let dir;
const read = (rel) => fs.readFileSync(path.join(dir, 'docs', rel), 'utf8');

beforeAll(async () => {
    await ensureManagedJre();
    dir = makeFixture('ok', PLUGIN);
    runBuild(dir);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('виртуальные страницы в сборке', () => {
    it('sidebar: раздел на своём уровне, DFS-порядок (Virt внутри A, M в конце)', () => {
        const lines = read('_sidebar.md').trimEnd().split('\n');
        expect(lines).toEqual([
            '* [Overview](Overview)',
            '  * [A](A/A)',
            '    * [B](A/B/B)',
            '    * [Virt](A/Virt/Virt)',
            '  * [Z](Z/Z)',
            '  * [M](M/M)',
            '    * [Sub](M/Sub/Sub)',
            '      * [Page](M/Sub/Page/Page)'
        ]);
    });

    it('страница сайта с диаграммой, отрендеренной локально (stdlib C4)', () => {
        const page = read('M/Sub/Page/Page.md');
        expect(page).toContain('# Page');
        expect(page).toContain('Text before ![diagram](d1.svg) after');
        const svg = read('M/Sub/Page/d1.svg');
        expect(svg).toContain('<svg');
        expect(svg).toContain('User');
    });

    it('промежуточный узел без контента — авто-заголовок', () => {
        expect(read('M/Sub/Sub.md')).toContain('# Sub');
    });

    it('generateMD и complete содержат виртуальные страницы', () => {
        expect(read('M/Sub/Page/README.md')).toContain('Text before');
        const complete = read('demo.md');
        expect(complete).toContain('## Page');
        expect(complete).toContain('![diagram](/M/Sub/Page/d1.svg)');
    });

    it('ассеты скопированы и подключены в index.html; afterBuild отработал', () => {
        const html = read('index.html');
        expect(html).toMatch(/<link rel="stylesheet" href="vendor\/plugins\/demo\/demo.css">\s*<\/head>/);
        // Скрипт переадресаций подключается после ассетов плагинов — он тоже перед </body>.
        expect(html).toMatch(
            /<script src="vendor\/plugins\/demo\/demo.js"><\/script>\s*(<script src="vendor\/c4builder-redirects.js"><\/script>\s*)?<\/body>/
        );
        expect(read('vendor/plugins/demo/demo.css')).toBe('body{}');
        expect(read('after-build.txt')).toBe('ok');
    });

    // Переадресации (change site-agent-review): карта в $docsify и локальный скрипт в index.html.
    it('переадресации: карта в опциях docsify, скрипт подключён и скопирован в vendor', () => {
        const html = read('index.html');
        const docsify = JSON.parse(html.match(/window\.\$docsify = (\{[\s\S]*?\});\s*<\/script>/)[1]);
        expect(docsify.c4builder).toEqual({
            redirects: { '/change/x': '/M/Sub/Page/Page', '/change/%D0%81%20%D0%B9': '/A/Virt/Virt' }
        });
        expect(html).toMatch(/<script src="vendor\/c4builder-redirects.js"><\/script>\s*<\/body>/);
        expect(read('vendor/c4builder-redirects.js')).toContain('location.replace');
        expect(read('vendor/c4builder-redirects.js')).not.toMatch(/https?:\/\//);
    });
});

describe('ошибки плагинов прерывают сборку', () => {
    it('исключение в хуке — имя плагина в сообщении, exit ≠ 0', () => {
        const d = makeFixture(
            'throw',
            `export default { name: 'boom', afterScan() { throw new Error('kaput'); } };`
        );
        expect(() => runBuild(d)).toThrow(/Plugin boom \(afterScan\): kaput/);
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('коллизия с реальной папкой', () => {
        const d = makeFixture(
            'collide',
            `export default { name: 'c', afterScan(ctx) { ctx.addPage({ path: ['A'], markdown: 'x' }); } };`
        );
        expect(() => runBuild(d)).toThrow(/taken by a real folder/);
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('повтор короткого пути вторым плагином — ошибка с путём и именем второго плагина', () => {
        const d = makeFixture(
            'redirect-dup',
            `export default { name: 'first', afterScan(ctx) { ctx.addRedirect(['change', 'x'], ['A']); } };`,
            { ...CONFIG, plugins: ['./plugin.mjs', './second.mjs'] }
        );
        fs.writeFileSync(
            path.join(d, 'second.mjs'),
            `export default { name: 'second', afterScan(ctx) { ctx.addRedirect(['change', 'x'], ['Z']); } };`
        );
        // makeFixture перезаписывает plugins одним файлом — возвращаем оба.
        fs.writeFileSync(
            path.join(d, '.c4builder'),
            JSON.stringify({ ...CONFIG, plugins: ['./plugin.mjs', './second.mjs'] })
        );
        expect(() => runBuild(d)).toThrow(
            /Plugin second \(afterScan\): addRedirect: redirect path change\/x is already declared/
        );
        fs.rmSync(d, { recursive: true, force: true });
    });
});

describe('addPage (юнит)', () => {
    const opts = {
        ROOT_FOLDER: 'src',
        DIST_FOLDER: 'x',
        GENERATE_WEBSITE: false,
        GENERATE_MD: false,
        GENERATE_LOCAL_IMAGES: false
    };
    const mk = (dir, parent) => ({
        dir,
        name: path.basename(dir),
        level: dir.split('/').length,
        parent,
        mdFiles: [],
        diagrams: [],
        descendants: []
    });
    it('вставка в конец поддерева, level/parent/descendants как у scan', () => {
        const tree = [mk('src'), mk('src/A', 'src'), mk('src/A/B', 'src/A'), mk('src/Z', 'src')];
        tree[0].descendants = ['A', 'Z'];
        tree[1].descendants = ['B'];
        const item = addPage(tree, opts, { path: ['A', 'C', 'D'], markdown: 'md' });
        expect(tree.map((t) => t.dir)).toEqual(['src', 'src/A', 'src/A/B', 'src/A/C', 'src/A/C/D', 'src/Z']);
        expect(item).toMatchObject({ level: 4, parent: 'src/A/C', name: 'D', mdFiles: ['md'] });
        expect(tree[1].descendants).toEqual(['B', 'C']);
        expect(isVirtual(item)).toBe(true);
        expect(isVirtual(tree[1])).toBe(false);
        // пустой промежуточный узел плагин вправе наполнить позже
        addPage(tree, opts, { path: ['A', 'C'], markdown: 'index' });
        expect(tree[3].mdFiles).toEqual(['index']);
        expect(() => addPage(tree, opts, { path: ['A', 'C'], markdown: 'again' })).toThrow(/already added/);
    });
    it('диаграммы: движок по расширению, неизвестное — ошибка', () => {
        const tree = [mk('src')];
        const item = addPage(tree, opts, { path: ['P'], diagrams: [{ file: 'a.d2', content: 'x -> y' }] });
        expect(item.diagrams[0]).toMatchObject({ dir: 'a.d2', engine: 'd2', ext: '.d2' });
        expect(() =>
            addPage(tree, opts, { path: ['Q'], diagrams: [{ file: 'a.txt', content: '' }] })
        ).toThrow(/unknown extension/);
        expect(() => addPage(tree, opts, { path: ['a/b'] })).toThrow(/invalid page path/);
    });
});

describe('addRedirect (юнит)', () => {
    const opts = { WEB_FILE_NAME: '' };
    it('ключ и значение — пути от корня после encodeURI, значение с именем файла страницы', () => {
        const redirects = new Map();
        addRedirect(redirects, opts, ['change', 'x'], ['OpenSpec', 'Changes', 'x']);
        addRedirect(redirects, opts, ['change', 'y'], ['OpenSpec', 'Changes', 'Группа', 'Имя y']);
        expect([...redirects]).toEqual([
            ['/change/x', '/OpenSpec/Changes/x/x'],
            ['/change/y', `/${encodeURI('OpenSpec/Changes/Группа/Имя y/Имя y')}`]
        ]);
        // webFileName — общее имя файла страниц
        const named = new Map();
        addRedirect(named, { WEB_FILE_NAME: 'README' }, ['change', 'x'], ['A', 'B']);
        expect(named.get('/change/x')).toBe('/A/B/README');
    });
    it('повтор пути — ошибка с путём; недопустимые сегменты отвергаются', () => {
        const redirects = new Map();
        addRedirect(redirects, opts, ['change', 'x'], ['A']);
        expect(() => addRedirect(redirects, opts, ['change', 'x'], ['B'])).toThrow(
            /redirect path change\/x is already declared/
        );
        expect(() => addRedirect(redirects, opts, ['change', 'a#b'], ['A'])).toThrow(/invalid redirect path/);
        expect(() => addRedirect(redirects, opts, ['change', 'a?b'], ['A'])).toThrow(/invalid redirect path/);
        expect(() => addRedirect(redirects, opts, ['a/b'], ['A'])).toThrow(/invalid redirect path/);
        expect(() => addRedirect(redirects, opts, [], ['A'])).toThrow(/invalid redirect path/);
        expect(() => addRedirect(redirects, opts, ['change', 'z'], ['..'])).toThrow(/invalid page path/);
        expect(redirects.size).toBe(1);
    });
});

// Вендорный скрипт переадресаций — в песочнице vm с подменой window/location: браузера в тестах
// нет, а логика (сразу и на hashchange, срез query, раскодированный hash) проверяется и так.
describe('vendor/docsify/c4builder-redirects.js (vm)', () => {
    const SCRIPT = fs.readFileSync(
        path.join(REPO_ROOT, 'vendor', 'docsify', 'c4builder-redirects.js'),
        'utf8'
    );
    const MAP = { '/change/x': '/M/Sub/Page/Page', '/change/%D0%81': '/A/Virt/Virt' };
    const run = (hash, redirects = MAP) => {
        const replaced = [];
        const listeners = {};
        const location = { hash, replace: (h) => replaced.push(h) };
        const window = {
            $docsify: redirects ? { c4builder: { redirects } } : {},
            addEventListener: (name, fn) => (listeners[name] = fn)
        };
        vm.runInNewContext(SCRIPT, { window, location });
        return {
            replaced,
            fire: (h) => {
                location.hash = h;
                listeners.hashchange();
            }
        };
    };

    it('совпадение — location.replace на путь страницы сразу и на hashchange; query отбрасывается', () => {
        expect(run('#/change/x').replaced).toEqual(['#/M/Sub/Page/Page']);
        expect(run('#/change/x?id=section').replaced).toEqual(['#/M/Sub/Page/Page']);
        expect(run('#change/x').replaced).toEqual(['#/M/Sub/Page/Page']);
        const site = run('#/');
        expect(site.replaced).toEqual([]);
        site.fire('#/change/x');
        expect(site.replaced).toEqual(['#/M/Sub/Page/Page']);
    });

    it('раскодированный браузером hash находится по карте; чужие пути и пустая карта не трогаются', () => {
        expect(run('#/change/Ё').replaced).toEqual(['#/A/Virt/Virt']);
        expect(run('#/change/nope').replaced).toEqual([]);
        expect(run('#/M/Sub/Page/Page').replaced).toEqual([]);
        expect(run('').replaced).toEqual([]);
        expect(run('#/change/x', null).replaced).toEqual([]);
    });
});
