import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS, injectSiteAssets, loadPlugins } from './dist.mjs';
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
            "SwaggerUIBundle({ url: 'API/_specs/finch/openapi.yaml', dom_id: '#swagger-finch', validatorUrl: null });"
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
        // Без AsyncAPI-спек компонента AsyncAPI в выходе нет.
        expect(fs.existsSync(path.join(dir, 'docs/vendor/plugins/openapi/asyncapi-standalone.js'))).toBe(
            false
        );
        expect(html).not.toContain('unpkg.com');
    });

    it('кастомный шаблон без swagger-строки — бандл подключается ассетом плагина', async () => {
        const dist = fs.mkdtempSync(path.join(TMP_ROOT, 'plugin-openapi-assets-'));
        fs.writeFileSync(path.join(dist, 'index.html'), '<html><head></head><body></body></html>');
        const plugin = await BUILTIN_PLUGINS.openapi();
        await injectSiteAssets([{ plugin, opts: {} }], { DIST_FOLDER: dist });
        expect(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')).toContain(
            '<script src="vendor/plugins/openapi/swagger-ui-bundle.js"></script>'
        );
        expect(fs.existsSync(path.join(dist, 'vendor/plugins/openapi/swagger-ui-bundle.js'))).toBe(true);
        fs.rmSync(dist, { recursive: true, force: true });
    });

    it("dir '.' (источник — предок dist): повторная сборка не видит свои копии спек", () => {
        const d = makeFixture('self', [['openapi', { dir: '.', glob: '**/openapi.yaml' }]]);
        // Тёзка выходного каталога глубже в источнике — не выходной каталог.
        write(d, 'contracts/docs/openapi.yaml', 'openapi: 3.0.0\n');
        runBuild(d);
        // Без отсева docs_bk вторая сборка нашла бы копию finch — коллизия имён страниц.
        runBuild(d);
        expect(fs.existsSync(path.join(d, 'docs/API/finch/finch.md'))).toBe(true);
        expect(fs.existsSync(path.join(d, 'docs/API/docs/docs.md'))).toBe(true);
        expect(fs.existsSync(path.join(d, 'docs/API/_specs/docs_bk'))).toBe(false);
        fs.rmSync(d, { recursive: true, force: true });
    });
});

describe('плагин openapi: ошибки', () => {
    const opts = () => ({ EXECUTE_SCRIPT: false });
    it('dir и archive одновременно либо ни одного — ошибка схемы', async () => {
        await expect(loadPlugins([['openapi', {}]], dir, opts())).rejects.toThrow(/exactly one source/);
        await expect(
            loadPlugins([['openapi', { dir: 'a', archive: 'http://x/y.zip' }]], dir, opts())
        ).rejects.toThrow(/exactly one source/);
        await expect(loadPlugins([['openapi', { dir: 'a', globs: 'x' }]], dir, opts())).rejects.toThrow(
            /globs/
        );
    });
    it('пустой glob — ошибка сборки с источником и шаблоном', () => {
        const d = makeFixture('empty', [['openapi', { dir: 'contracts', glob: '*.nothing' }]]);
        expect(() => runBuild(d)).toThrow(
            /Plugin openapi \(afterScan\): no specs match "\*\.nothing" in contracts/
        );
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('ни один совпавший файл не содержит ключа openapi/swagger — прежняя ошибка', () => {
        const d = makeFixture('nokey', [['openapi', { dir: 'contracts', glob: 'shared/*.yaml' }]]);
        expect(() => runBuild(d)).toThrow(
            /Plugin openapi \(afterScan\): no specs match "shared\/\*\.yaml" in contracts/
        );
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('одноимённые папки в flat — ошибка с обоими файлами и подсказкой layout: "tree"', () => {
        const d = makeFixture('dup', [['openapi', { dir: 'contracts', glob: '**/openapi.yaml' }]]);
        write(d, 'contracts/billing/v2/openapi.yaml', 'openapi: 3.0.0\n');
        write(d, 'contracts/ledger/v2/openapi.yaml', 'openapi: 3.0.0\n');
        expect(() => runBuild(d)).toThrow(
            /same page "v2": billing\/v2\/openapi\.yaml and ledger\/v2\/openapi\.yaml — set layout: "tree"/
        );
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('спека и папка с тем же именем — ошибка с обоими файлами и путём страницы', () => {
        const d = makeFixture('clash-dir', [['openapi', { dir: 'contracts', glob: '**/*.yaml' }]]);
        write(d, 'contracts/finch.yaml', 'openapi: 3.0.0\n');
        expect(() => runBuild(d)).toThrow(/same page "finch": finch\.yaml and finch\/openapi\.yaml/);
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('спеки одной папки с одним именем без расширения — ошибка', () => {
        const d = makeFixture('clash-ext', [['openapi', { dir: 'contracts' }]]);
        write(d, 'contracts/finch/openapi.json', '{ "openapi": "3.0.0" }');
        expect(() => runBuild(d)).toThrow(
            /same page "finch\/openapi": finch\/openapi\.json and finch\/openapi\.yaml/
        );
        fs.rmSync(d, { recursive: true, force: true });
    });
    it('неизвестное значение layout — ошибка схемы', async () => {
        await expect(loadPlugins([['openapi', { dir: 'a', layout: 'deep' }]], dir, opts())).rejects.toThrow(
            /layout/
        );
    });
});

// Несколько спек в одной папке, глубокая раскладка и файлы без ключа openapi — одна сборка.
describe('плагин openapi: раскладка страниц по папкам', () => {
    let d;
    let log;
    const page = (rel) => fs.readFileSync(path.join(d, 'docs', rel), 'utf8');
    beforeAll(() => {
        d = makeFixture('multi', [['openapi', { dir: 'contracts', glob: '**/*.{yaml,json}' }]]);
        write(
            d,
            'contracts/billing/openapi.yaml',
            'openapi: 3.0.0\ninfo:\n  title: Billing API\n  version: "1"\n'
        );
        write(
            d,
            'contracts/billing/openapi-admin.yaml',
            '---\nopenapi: 3.1.0\ninfo:\n  version: "1"\n  title: "Billing admin API"\npaths: {}\n'
        );
        write(d, 'contracts/billing/payouts.yaml', 'swagger: "2.0"\npaths: {}\n');
        write(d, 'contracts/services/team/ledger/openapi.yaml', 'openapi: 3.0.0\n');
        write(d, 'contracts/merge-config.json', '{ "info": { "title": "not a spec" } }');
        write(d, 'contracts/events/asyncapi.yaml', 'asyncapi: 2.6.0\ninfo:\n  title: Events\n');
        write(d, 'contracts/events/openapi.yaml', 'openapi: 3.0.0\ninfo:\n  title: Events REST\n');
        log = runBuild(d);
    });
    afterAll(() => fs.rmSync(d, { recursive: true, force: true }));

    it('папка с несколькими спеками: оглавление без swagger-ui, страница на спеку', () => {
        const index = page('API/billing/billing.md');
        expect(index).toBe(
            [
                '# billing',
                '',
                '- [openapi.yaml](API/billing/openapi/openapi) — Billing API',
                '- [openapi-admin.yaml](API/billing/openapi-admin/openapi-admin) — Billing admin API',
                '- [payouts.yaml](API/billing/payouts/payouts)'
            ].join('\n')
        );
        expect(index).not.toContain('SwaggerUIBundle');
        for (const name of ['openapi', 'openapi-admin', 'payouts']) {
            const p = page(`API/billing/${name}/${name}.md`);
            const id = `swagger-billing_${name}`;
            expect(p.match(/<div id="/g)).toHaveLength(1);
            expect(p).toContain(`<div id="${id}"></div>`);
            expect(p).toContain(
                `SwaggerUIBundle({ url: 'API/_specs/billing/${name}.yaml', dom_id: '#${id}', validatorUrl: null });`
            );
        }
        expect(page('_sidebar.md')).toContain(
            '    * [billing](API/billing/billing)\n      * [openapi](API/billing/openapi/openapi)\n      * [openapi-admin](API/billing/openapi-admin/openapi-admin)\n      * [payouts](API/billing/payouts/payouts)\n    * [common](API/common/common)'
        );
    });

    it('глубокая раскладка без опции: страница — имя папки, как раньше', () => {
        expect(page('API/ledger/ledger.md')).toContain('<div id="swagger-ledger"></div>');
        expect(fs.existsSync(path.join(d, 'docs/API/services'))).toBe(false);
    });

    it('сводка: все страницы спек с полным путём', () => {
        expect(page('API/API.md')).toBe(
            [
                '# API',
                '',
                '- [billing/openapi](API/billing/openapi/openapi) — `billing/openapi.yaml`',
                '- [billing/openapi-admin](API/billing/openapi-admin/openapi-admin) — `billing/openapi-admin.yaml`',
                '- [billing/payouts](API/billing/payouts/payouts) — `billing/payouts.yaml`',
                '- [common](API/common/common) — `common/openapi.yaml`',
                '- [events/asyncapi](API/events/asyncapi/asyncapi) — `events/asyncapi.yaml`',
                '- [events/openapi](API/events/openapi/openapi) — `events/openapi.yaml`',
                '- [finch](API/finch/finch) — `finch/openapi.yaml`',
                '- [ledger](API/ledger/ledger) — `services/team/ledger/openapi.yaml`',
                '- [selling-agent](API/selling-agent/selling-agent) — `selling-agent/openapi.yaml`'
            ].join('\n')
        );
    });

    it('файлы без ключа openapi/swagger/asyncapi: нет страниц, в _specs есть, предупреждение на каждый', () => {
        for (const rel of ['shared/schemas.yaml', 'merge-config.json']) {
            expect(fs.existsSync(path.join(d, 'docs/API/_specs', rel))).toBe(true);
            expect(log).toContain(
                `openapi: ${rel}: not an OpenAPI or AsyncAPI document (no openapi/swagger/asyncapi key), skipped`
            );
        }
        expect(log).not.toContain('events/asyncapi.yaml: not an');
        for (const name of ['shared', 'schemas', 'merge-config']) {
            expect(page('_sidebar.md')).not.toContain(`[${name}]`);
            expect(page('API/API.md')).not.toContain(name);
        }
    });

    it('AsyncAPI рядом с OpenAPI: оглавление, страница компонента AsyncAPI со спекой по относительному пути', () => {
        expect(page('API/events/events.md')).toBe(
            [
                '# events',
                '',
                '- [openapi.yaml](API/events/openapi/openapi) — Events REST',
                '- [asyncapi.yaml](API/events/asyncapi/asyncapi) — Events'
            ].join('\n')
        );
        const p = page('API/events/asyncapi/asyncapi.md');
        expect(p).toContain('<div id="asyncapi-events_asyncapi"></div>');
        expect(p).toContain(
            "lib.render({ schema: { url: 'API/_specs/events/asyncapi.yaml' }, config: { show: { sidebar: false } } }, document.getElementById('asyncapi-events_asyncapi'));"
        );
        expect(p).not.toContain('SwaggerUIBundle');
        // Один <script> без пустых строк: docsify выполняет только первый, пустая строка рвёт HTML-блок.
        expect(p.match(/<script>/g)).toHaveLength(1);
        expect(p.slice(p.indexOf('<div'))).not.toMatch(/\n\s*\n/);
        expect(page('API/events/openapi/openapi.md')).toContain('SwaggerUIBundle');
    });

    it('компонент AsyncAPI копируется в выход, но в index.html не подключается', () => {
        for (const f of ['asyncapi-standalone.js', 'asyncapi.css']) {
            expect(fs.existsSync(path.join(d, 'docs/vendor/plugins/openapi', f))).toBe(true);
        }
        expect(page('index.html')).not.toContain('asyncapi');
        expect(page('API/events/asyncapi/asyncapi.md')).toContain("var dir = 'vendor/plugins/openapi/';");
    });
});

describe('плагин openapi: layout tree', () => {
    let d;
    const page = (rel) => fs.readFileSync(path.join(d, 'docs', rel), 'utf8');
    beforeAll(() => {
        d = makeFixture('tree', [['openapi', { dir: 'contracts', glob: '**/openapi.yaml', layout: 'tree' }]]);
        write(d, 'contracts/billing/openapi.yaml', 'openapi: 3.0.0\n');
        write(d, 'contracts/billing/v2/openapi.yaml', 'openapi: 3.0.0\n');
        write(d, 'contracts/ledger/v2/openapi.yaml', 'openapi: 3.0.0\n');
        runBuild(d);
    });
    afterAll(() => fs.rmSync(d, { recursive: true, force: true }));

    it('версия во вложенной папке: вложенные страницы с разными dom_id', () => {
        expect(page('API/billing/billing.md')).toContain('<div id="swagger-billing"></div>');
        expect(page('API/billing/v2/v2.md')).toContain(
            "SwaggerUIBundle({ url: 'API/_specs/billing/v2/openapi.yaml', dom_id: '#swagger-billing_v2', validatorUrl: null });"
        );
        expect(page('API/ledger/v2/v2.md')).toContain(
            "SwaggerUIBundle({ url: 'API/_specs/ledger/v2/openapi.yaml', dom_id: '#swagger-ledger_v2', validatorUrl: null });"
        );
        expect(page('_sidebar.md')).toContain(
            '    * [billing](API/billing/billing)\n      * [v2](API/billing/v2/v2)\n    * [common](API/common/common)'
        );
        expect(page('_sidebar.md')).toContain(
            '    * [ledger](API/ledger/ledger)\n      * [v2](API/ledger/v2/v2)'
        );
    });

    it('сводка перечисляет страницы с полным путём', () => {
        const summary = page('API/API.md');
        expect(summary).toContain('- [billing](API/billing/billing) — `billing/openapi.yaml`');
        expect(summary).toContain('- [billing/v2](API/billing/v2/v2) — `billing/v2/openapi.yaml`');
        expect(summary).toContain('- [ledger/v2](API/ledger/v2/v2) — `ledger/v2/openapi.yaml`');
        // Папка без спек — промежуточный узел, не строка сводки.
        expect(summary).not.toContain('- [ledger]');
    });
});

// `'` в пути спеки не должен ломать инлайн-скрипт страницы (URL — в JS-строке в одинарных кавычках).
describe('плагин openapi: апостроф в пути спеки', () => {
    let d;
    const page = (rel) => fs.readFileSync(path.join(d, 'docs', rel), 'utf8');
    const script = (p) => p.slice(p.indexOf('<script>') + 8, p.indexOf('</script>'));
    beforeAll(() => {
        d = makeFixture('quote', [['openapi', { dir: 'contracts', glob: "q'*/*.yaml" }]]);
        write(d, "contracts/q'events/asyncapi.yaml", 'asyncapi: 2.6.0\ninfo:\n  title: Events\n');
        write(d, "contracts/q'rest/openapi.yaml", 'openapi: 3.0.0\n');
        runBuild(d);
    });
    afterAll(() => fs.rmSync(d, { recursive: true, force: true }));

    it('URL спеки с %27, скрипт AsyncAPI и swagger-ui синтаксически корректен', () => {
        const asyncPage = page("API/q'events/q'events.md");
        expect(asyncPage).toContain("schema: { url: 'API/_specs/q%27events/asyncapi.yaml' }");
        expect(() => new Function(script(asyncPage))).not.toThrow();
        const restPage = page("API/q'rest/q'rest.md");
        expect(restPage).toContain("url: 'API/_specs/q%27rest/openapi.yaml'");
        expect(() => new Function(script(restPage))).not.toThrow();
        expect(fs.existsSync(path.join(d, 'docs', "API/_specs/q'events/asyncapi.yaml"))).toBe(true);
    });
});
