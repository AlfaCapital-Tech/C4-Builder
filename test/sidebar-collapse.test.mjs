import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { STORAGE_GUARD_JS } from './dist.mjs';
import { REPO_ROOT, TMP_ROOT, ensureManagedJre, runBuild } from './helpers.mjs';

// Сворачивание sidebar (change sidebar-collapse): вендорный docsify-sidebar-collapse подключается
// пост-обработкой index.html и уровнем раскрытия в опциях docsify — поэтому работает и с
// пользовательским docsifyTemplate; sidebarCollapse: false возвращает прежний index.html.
const CONFIG = {
    ...JSON.parse(
        fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'default.c4builder.json'), 'utf8')
    ),
    projectName: 'demo',
    generateMD: false,
    generateCompleteMD: false,
    generateLLMS: false
};

const LINK = '<link rel="stylesheet" href="vendor/sidebar-collapse.css">';
const SCRIPT = '<script src="vendor/docsify-sidebar-collapse.min.js"></script>';
const GUARD = '<script src="vendor/c4builder-storage-guard.js"></script>';

// Шаблон-копия: как у команд, вставляет переданные опции в window.$docsify целиком.
const TEMPLATE = `export default (o) => \`<!DOCTYPE html><html><head><title>\${o.name}</title>
<link rel="stylesheet" href="\${o.stylesheet}"></head>
<body><div id="app"></div><script>window.$docsify = \${JSON.stringify(o)};</script>
<script src="vendor/docsify.min.js"></script>%EXTRA%</body></html>\`;
`;

const write = (root, rel, content) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
};

// Только markdown — без диаграмм сборка не зовёт JVM и остаётся быстрой.
const makeFixture = (name, config) => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, `sidebar-collapse-${name}-`));
    write(dir, 'src/README.md', 'root');
    write(dir, 'src/A/README.md', 'a');
    write(dir, 'src/A/B/README.md', 'b');
    write(dir, 'src/A/B/C/README.md', 'c');
    fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify({ ...CONFIG, ...config }));
    return dir;
};

const dirs = {};
const html = (name) => fs.readFileSync(path.join(dirs[name], 'docs', 'index.html'), 'utf8');
const inDist = (name, rel) => fs.existsSync(path.join(dirs[name], 'docs', rel));

beforeAll(async () => {
    await ensureManagedJre();
    dirs.default = makeFixture('default', {});
    dirs.explicit = makeFixture('explicit', { sidebarCollapse: true });
    dirs.off = makeFixture('off', { sidebarCollapse: false });
    dirs.template = makeFixture('template', { docsifyTemplate: 'tpl.mjs' });
    write(dirs.template, 'tpl.mjs', TEMPLATE.replace('%EXTRA%', ''));
    // Шаблон, подключавший плагин и страховку руками: дубля быть не должно, файлы — в dist.
    dirs.manual = makeFixture('manual', { docsifyTemplate: 'tpl.mjs' });
    write(dirs.manual, 'tpl.mjs', TEMPLATE.replace('%EXTRA%', `${GUARD}${LINK}${SCRIPT}`));
    for (const dir of Object.values(dirs)) runBuild(dir);
});
afterAll(() => {
    for (const dir of Object.values(dirs)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('sidebarCollapse по умолчанию', () => {
    it('index.html подключает стиль и скрипт сворачивания, уровень раскрытия 1', () => {
        const page = html('default');
        expect(page).toContain(LINK);
        expect(page).toContain(SCRIPT);
        expect(page).toContain('"sidebarDisplayLevel": 1');
    });

    it('скрипт стоит после docsify.min.js — плагин регистрируется в $docsify.plugins до старта', () => {
        const page = html('default');
        expect(page.indexOf(SCRIPT)).toBeGreaterThan(page.indexOf('<script src="vendor/docsify.min.js">'));
        expect(page.indexOf(SCRIPT)).toBeLessThan(page.indexOf('</body>'));
    });

    it('страховка localStorage — раньше всех скриптов страницы', () => {
        const page = html('default');
        expect(page.indexOf(GUARD)).toBeGreaterThan(-1);
        expect(page.indexOf(GUARD)).toBe(page.search(/<script\b/));
    });

    it('ассеты лежат в vendor/ выхода и не ходят во внешние домены', () => {
        expect(inDist('default', 'vendor/sidebar-collapse.css')).toBe(true);
        expect(inDist('default', 'vendor/docsify-sidebar-collapse.min.js')).toBe(true);
        expect(inDist('default', 'vendor/c4builder-storage-guard.js')).toBe(true);
        // Комментарии (русские) остаются в исходнике в src — в выход не попадают.
        expect(
            fs.readFileSync(path.join(dirs.default, 'docs', 'vendor/c4builder-storage-guard.js'), 'utf8')
        ).not.toMatch(/\/\/|\/\*|[\u0400-\u04ff]/);
        for (const rel of [
            'vendor/sidebar-collapse.css',
            'vendor/docsify-sidebar-collapse.min.js',
            'vendor/c4builder-storage-guard.js'
        ]) {
            expect(fs.readFileSync(path.join(dirs.default, 'docs', rel), 'utf8')).not.toMatch(
                /https?:\/\/|\/\/cdn/
            );
        }
    });

    it('старый конфиг без ключа даёт тот же index.html, что явный sidebarCollapse: true', () => {
        expect(html('default')).toBe(html('explicit'));
    });
});

// Узкий экран (в jsdom clientWidth = 0) и заблокированное хранилище: вендорный плагин пишет в
// localStorage без try/catch и без страховки не регистрируется — в sidebar остаётся только корень.
describe('заблокированный localStorage на мобильном', () => {
    const vendor = (f) => fs.readFileSync(path.join(REPO_ROOT, 'vendor', 'docsify', f), 'utf8');
    const run = async (withGuard) => {
        const { JSDOM } = await import('jsdom');
        const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
            runScripts: 'outside-only',
            beforeParse(window) {
                Object.defineProperty(window, 'localStorage', {
                    configurable: true,
                    get() {
                        throw new window.DOMException('The operation is insecure.', 'SecurityError');
                    }
                });
            }
        });
        dom.window.eval('window.$docsify = {};');
        if (withGuard) dom.window.eval(STORAGE_GUARD_JS);
        let error;
        try {
            dom.window.eval(vendor('docsify-sidebar-collapse.min.js'));
        } catch (e) {
            error = e;
        }
        const plugins = dom.window.$docsify.plugins?.length ?? 0;
        dom.window.close();
        return { error, plugins };
    };

    it('без страховки плагин падает (воспроизведение), со страховкой — регистрируется', async () => {
        expect((await run(false)).error?.name).toBe('SecurityError');
        const guarded = await run(true);
        expect(guarded.error).toBeUndefined();
        expect(guarded.plugins).toBeGreaterThan(0);
    });
});

describe('sidebarCollapse: false', () => {
    it('ни тегов, ни ключа — index.html прежний, sidebar полностью развёрнут', () => {
        const page = html('off');
        expect(page).not.toContain('sidebar-collapse');
        expect(page).not.toContain('storage-guard');
        expect(page).not.toContain('sidebarDisplayLevel');
    });
});

describe('пользовательский docsifyTemplate', () => {
    it('шаблон, спредящий опции: теги инжектятся, уровень доходит до window.$docsify', () => {
        const page = html('template');
        expect(page).toContain(LINK);
        expect(page).toContain(SCRIPT);
        expect(page).toMatch(/window\.\$docsify = \{.*"sidebarDisplayLevel":1/);
        expect(page.indexOf(SCRIPT)).toBeGreaterThan(page.indexOf('<script src="vendor/docsify.min.js">'));
    });

    it('шаблон уже подключает плагин сам — второй раз не подключаем', () => {
        const page = html('manual');
        expect(page.match(/sidebar-collapse\.css/g)).toHaveLength(1);
        expect(page.match(/docsify-sidebar-collapse\.min\.js/g)).toHaveLength(1);
        expect(page.match(/c4builder-storage-guard\.js/g)).toHaveLength(1);
        expect(inDist('manual', 'vendor/c4builder-storage-guard.js')).toBe(true);
    });
});
