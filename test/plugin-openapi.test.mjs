import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS, injectPluginAssets, loadPlugins } from './dist.mjs';
import { TMP_ROOT, ensureManagedJre, runBuild } from './helpers.mjs';

// Встроенный плагин openapi: локальная папка с 3 спеками и относительным $ref →
// раздел API со страницами swagger-ui без CDN, спеки скопированы с сохранением путей.
const CONFIG = {
    ...JSON.parse(
        fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'default.c4builder.json'), 'utf8')
    ),
    projectName: 'demo',
    generateMD: false,
    generateCompleteMD: false,
    executeScript: false
};

const write = (root, rel, content) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
};

const makeFixture = (name, plugins) => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, `plugin-openapi-${name}-`));
    write(dir, 'src/README.md', 'root');
    write(
        dir,
        'contracts/common/openapi.yaml',
        'openapi: 3.0.0\ncomponents:\n  schemas:\n    Error:\n      type: object\n'
    );
    write(
        dir,
        'contracts/finch/openapi.yaml',
        "openapi: 3.0.0\npaths:\n  /x:\n    get:\n      responses:\n        '500':\n          $ref: '../common/openapi.yaml#/components/schemas/Error'\n"
    );
    write(dir, 'contracts/selling-agent/openapi.yaml', 'openapi: 3.0.0\n');
    write(dir, 'contracts/shared/schemas.yaml', 'components: {}\n'); // не спека, но цель $ref
    write(dir, 'contracts/README.md', 'not a spec');
    fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify({ ...CONFIG, plugins }));
    return dir;
};

let dir;
const read = (rel) => fs.readFileSync(path.join(dir, 'docs', rel), 'utf8');

beforeAll(async () => {
    await ensureManagedJre();
    dir = makeFixture('ok', [['openapi', { dir: 'contracts', glob: '*/openapi.yaml' }]]);
    runBuild(dir);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('плагин openapi', () => {
    it('раздел API: сводка по алфавиту и страницы спек', () => {
        expect(read('_sidebar.md')).toContain(
            '  * [API](API/API)\n    * [common](API/common/common)\n    * [finch](API/finch/finch)\n    * [selling-agent](API/selling-agent/selling-agent)'
        );
        expect(read('API/API.md')).toContain('- [finch](API/finch/finch) — `finch/openapi.yaml`');
    });

    it('страница спеки: swagger-ui без CDN, спека статикой по относительному пути', () => {
        const page = read('API/finch/finch.md');
        expect(page).toContain('<div id="swagger-finch"></div>');
        expect(page).toContain(
            "SwaggerUIBundle({ url: 'API/_specs/finch/openapi.yaml', dom_id: '#swagger-finch'"
        );
        expect(page).not.toMatch(/https?:\/\//);
        expect(read('API/_specs/finch/openapi.yaml')).toContain('../common/openapi.yaml');
        expect(fs.existsSync(path.join(dir, 'docs/API/_specs/common/openapi.yaml'))).toBe(true);
        // все yaml/json источника — статикой (цели $ref вне glob), md — нет
        expect(fs.existsSync(path.join(dir, 'docs/API/_specs/shared/schemas.yaml'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'docs/API/_specs/README.md'))).toBe(false);
        expect(read('_sidebar.md')).not.toContain('shared');
    });

    it('executeScript принудительно, swagger-ui.css подключён ассетом, бандл — один раз', () => {
        const html = read('index.html');
        expect(html.match(/swagger-ui-bundle\.js/g)).toHaveLength(1);
        expect(html).toContain('<script src="vendor/swagger-ui-bundle.js"></script>');
        expect(html).toContain('<link rel="stylesheet" href="vendor/plugins/openapi/swagger-ui.css">');
        expect(fs.existsSync(path.join(dir, 'docs/vendor/plugins/openapi/swagger-ui.css'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'docs/vendor/plugins/openapi/swagger-ui-bundle.js'))).toBe(false);
        expect(html).not.toContain('unpkg.com');
    });

    it('кастомный шаблон без swagger-строки — бандл подключается ассетом плагина', async () => {
        const dist = fs.mkdtempSync(path.join(TMP_ROOT, 'plugin-openapi-assets-'));
        fs.writeFileSync(path.join(dist, 'index.html'), '<html><head></head><body></body></html>');
        const plugin = await BUILTIN_PLUGINS.openapi();
        await injectPluginAssets([{ plugin, opts: {} }], { DIST_FOLDER: dist });
        expect(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')).toContain(
            '<script src="vendor/plugins/openapi/swagger-ui-bundle.js"></script>'
        );
        expect(fs.existsSync(path.join(dist, 'vendor/plugins/openapi/swagger-ui-bundle.js'))).toBe(true);
        fs.rmSync(dist, { recursive: true, force: true });
    });

    it("dir '.' (источник — предок dist): повторная сборка не видит свои копии спек", () => {
        const d = makeFixture('self', [['openapi', { dir: '.', glob: 'contracts/*/openapi.yaml' }]]);
        runBuild(d);
        runBuild(d);
        expect(fs.existsSync(path.join(d, 'docs/API/finch/finch.md'))).toBe(true);
        fs.rmSync(d, { recursive: true, force: true });
    });
});

describe('плагин openapi: ошибки', () => {
    const opts = () => ({ EXECUTE_SCRIPT: false });
    it('dir и archive одновременно либо ни одного — ошибка схемы', async () => {
        await expect(loadPlugins([['openapi', {}]], dir, opts())).rejects.toThrow(/ровно один источник/);
        await expect(
            loadPlugins([['openapi', { dir: 'a', archive: 'http://x/y.zip' }]], dir, opts())
        ).rejects.toThrow(/ровно один источник/);
        await expect(loadPlugins([['openapi', { dir: 'a', globs: 'x' }]], dir, opts())).rejects.toThrow(
            /globs/
        );
    });
    it('пустой glob — ошибка сборки с источником и шаблоном', () => {
        const d = makeFixture('empty', [['openapi', { dir: 'contracts', glob: '*.nothing' }]]);
        expect(() => runBuild(d)).toThrow(
            /Плагин openapi \(afterScan\): по шаблону "\*\.nothing" в contracts/
        );
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('коллизия имён страниц — ошибка', () => {
        const d = makeFixture('dup', [['openapi', { dir: 'contracts', glob: '**/*.yaml' }]]);
        write(d, 'contracts/other/finch/openapi.yaml', 'openapi: 3.0.0\n');
        expect(() => runBuild(d)).toThrow(/одно имя страницы "finch"/);
        fs.rmSync(d, { recursive: true, force: true });
    });
});
