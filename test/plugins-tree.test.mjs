import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addPage, isVirtual } from './dist.mjs';
import { TMP_ROOT, ensureManagedJre, runBuild } from './helpers.mjs';

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
        expect(html).toMatch(/<script src="vendor\/plugins\/demo\/demo.js"><\/script>\s*<\/body>/);
        expect(read('vendor/plugins/demo/demo.css')).toBe('body{}');
        expect(read('after-build.txt')).toBe('ok');
    });
});

describe('ошибки плагинов прерывают сборку', () => {
    it('исключение в хуке — имя плагина в сообщении, exit ≠ 0', () => {
        const d = makeFixture(
            'throw',
            `export default { name: 'boom', afterScan() { throw new Error('kaput'); } };`
        );
        expect(() => runBuild(d)).toThrow(/Плагин boom \(afterScan\): kaput/);
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('коллизия с реальной папкой', () => {
        const d = makeFixture(
            'collide',
            `export default { name: 'c', afterScan(ctx) { ctx.addPage({ path: ['A'], markdown: 'x' }); } };`
        );
        expect(() => runBuild(d)).toThrow(/занят реальной папкой/);
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
        expect(() => addPage(tree, opts, { path: ['A', 'C'], markdown: 'again' })).toThrow(/уже добавлена/);
    });
    it('диаграммы: движок по расширению, неизвестное — ошибка', () => {
        const tree = [mk('src')];
        const item = addPage(tree, opts, { path: ['P'], diagrams: [{ file: 'a.d2', content: 'x -> y' }] });
        expect(item.diagrams[0]).toMatchObject({ dir: 'a.d2', engine: 'd2', ext: '.d2' });
        expect(() =>
            addPage(tree, opts, { path: ['Q'], diagrams: [{ file: 'a.txt', content: '' }] })
        ).toThrow(/неизвестное расширение/);
        expect(() => addPage(tree, opts, { path: ['a/b'] })).toThrow(/некорректный путь/);
    });
});
