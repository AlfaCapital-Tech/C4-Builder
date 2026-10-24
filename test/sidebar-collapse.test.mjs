import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TMP_ROOT, ensureManagedJre, runBuild } from './helpers.mjs';

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
    // Шаблон, подключавший плагин руками до этого релиза: дубля быть не должно.
    dirs.manual = makeFixture('manual', { docsifyTemplate: 'tpl.mjs' });
    write(dirs.manual, 'tpl.mjs', TEMPLATE.replace('%EXTRA%', `${LINK}${SCRIPT}`));
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

    it('ассеты лежат в vendor/ выхода и не ходят во внешние домены', () => {
        expect(inDist('default', 'vendor/sidebar-collapse.css')).toBe(true);
        expect(inDist('default', 'vendor/docsify-sidebar-collapse.min.js')).toBe(true);
        for (const rel of ['vendor/sidebar-collapse.css', 'vendor/docsify-sidebar-collapse.min.js']) {
            expect(fs.readFileSync(path.join(dirs.default, 'docs', rel), 'utf8')).not.toMatch(
                /https?:\/\/|\/\/cdn/
            );
        }
    });

    it('старый конфиг без ключа даёт тот же index.html, что явный sidebarCollapse: true', () => {
        expect(html('default')).toBe(html('explicit'));
    });
});

describe('sidebarCollapse: false', () => {
    it('ни тегов, ни ключа — index.html прежний, sidebar полностью развёрнут', () => {
        const page = html('off');
        expect(page).not.toContain('sidebar-collapse');
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
    });
});
