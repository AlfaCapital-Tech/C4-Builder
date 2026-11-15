import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT, TMP_ROOT } from './helpers.mjs';

// Онлайн-рендер PlantUML удалён (change remove-remote-plantuml): старые ключи `.c4builder`
// не ломают сборку, `false` даёт предупреждение, а диаграммы всё равно рендерятся локально.
// Java резолвит сам CLI (как в golden) — в CI она есть.
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');

const BASE = {
    projectName: 'legacy',
    homepageName: 'Overview',
    rootFolder: 'src',
    distFolder: 'docs',
    generateMD: true,
    generateCompleteMD: true,
    generateWEB: true,
    generateLLMS: false,
    includeNavigation: false,
    includeTableOfContents: false,
    webTheme: 'vendor/vue.css',
    supportSearch: false,
    repoUrl: '',
    executeScript: false,
    docsifyTemplate: '',
    webPort: '3000',
    includeBreadcrumbs: false,
    includeLinkToDiagram: false,
    diagramsOnTop: false,
    embedDiagram: false,
    excludeOtherFiles: false,
    diagramFormat: 'svg',
    d2Layout: 'dagre',
    charset: 'UTF-8',
    hasRun: true
};
const SERVER = 'https://www.plantuml.com/plantuml';

fs.mkdirSync(TMP_ROOT, { recursive: true });
const root = fs.mkdtempSync(path.join(TMP_ROOT, 'legacy-local-images-'));

// Проект с PlantUML и D2: D2 онлайн-сервера и раньше не имел, PlantUML уходил на plantuml.com.
const build = (name, config) => {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'README.md'), '# Overview\n\nBody.\n');
    fs.writeFileSync(path.join(dir, 'src', 'context.puml'), '@startuml\nAlice -> Bob: hi\n@enduml\n');
    fs.writeFileSync(path.join(dir, 'src', 'flow.d2'), 'a -> b\n');
    // В формате configstore (табы, без перевода строки в конце), как его пишут мастер и `new -y`:
    // сборка перезаписывает файл `hasRun`, и побайтное сравнение ловит любую правку ключей.
    const configText = JSON.stringify(config, undefined, '\t');
    fs.writeFileSync(path.join(dir, '.c4builder'), configText);
    // Без терминала: если мастер решит что-то спросить, он упадёт, а не повиснет.
    const res = spawnSync(process.execPath, [CLI], {
        cwd: dir,
        encoding: 'utf8',
        input: '',
        timeout: 240_000
    });
    return { dir, status: res.status, out: `${res.stdout}${res.stderr}`, configText };
};

// Текстовые выходы сборки (страницы, index.html, вендорные скрипты), где встречается адрес
// сервера рендера: имена, а не содержимое — иначе упавший expect вывалит мегабайты JS.
const leaking = (dir) =>
    fs
        .readdirSync(path.join(dir, 'docs'), { recursive: true })
        .map(String)
        .filter((f) => /\.(md|html|js|txt)$/.test(f))
        .filter((f) => fs.readFileSync(path.join(dir, 'docs', f), 'utf8').includes('plantuml.com'));
const page = (dir) => fs.readFileSync(path.join(dir, 'docs', 'README.md'), 'utf8');

let off;
let on;
let none;
beforeAll(() => {
    off = build('off', { ...BASE, generateLocalImages: false, plantumlServerUrl: SERVER });
    on = build('on', { ...BASE, generateLocalImages: true, plantumlServerUrl: SERVER });
    none = build('none', BASE);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('старый конфиг с generateLocalImages: false', () => {
    it('код 0, предупреждение называет оба ключа', () => {
        expect(off.status, off.out).toBe(0);
        expect(off.out).toContain('WARNING:');
        expect(off.out).toMatch(/generateLocalImages, plantumlServerUrl/);
    });

    it('PlantUML и D2 отрендерены локально, адреса сервера в выходах нет', () => {
        const docs = fs.readdirSync(path.join(off.dir, 'docs'));
        expect(docs).toEqual(expect.arrayContaining(['context.svg', 'flow.svg']));
        expect(page(off.dir)).toContain('context.svg');
        expect(leaking(off.dir)).toEqual([]);
    });

    it('.c4builder побайтно не изменён', () => {
        expect(fs.readFileSync(path.join(off.dir, '.c4builder'), 'utf8')).toBe(off.configText);
    });
});

describe('ключи онлайн-рендера со значениями по умолчанию и без них', () => {
    it('true и адрес сервера — без предупреждения', () => {
        expect(on.status, on.out).toBe(0);
        expect(on.out).not.toMatch(/generateLocalImages/);
        expect(leaking(on.dir)).toEqual([]);
    });

    it('конфиг без обоих ключей собирается без мастера и без предупреждения', () => {
        expect(none.status, none.out).toBe(0);
        expect(none.out).not.toMatch(/generateLocalImages|PlantUML Server URL|Compilation format/);
        expect(fs.readdirSync(path.join(none.dir, 'docs'))).toContain('context.svg');
    });
});
