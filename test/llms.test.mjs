import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { REPO_ROOT, TMP_ROOT } from './helpers.mjs';

const CLI = path.join(REPO_ROOT, 'dist', 'index.js');

// Полный набор ключей (кроме generateLLMS) — иначе визард переспросил бы недостающее.
// generateLocalImages=false: PlantUML уходит remote-URL'ом, java и рендер не нужны.
const BASE_CONFIG = {
    projectName: 'llmsdemo',
    homepageName: 'Overview',
    rootFolder: 'src',
    distFolder: 'docs',
    generateMD: false,
    generateCompleteMD: false,
    generateWEB: true,
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
    generateLocalImages: false,
    plantumlServerUrl: 'https://www.plantuml.com/plantuml',
    diagramFormat: 'svg',
    d2Layout: 'dagre',
    charset: 'UTF-8',
    hasRun: true
};

const write = (root, rel, content) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
};

const dirs = [];
afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

// Временный проект: files — { относительный путь: содержимое }, config — поверх BASE_CONFIG.
const makeProject = (files, config = {}) => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'llms-'));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
    fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify({ ...BASE_CONFIG, ...config }));
    return dir;
};

// input '' — висящий визард получил бы EOF и упал, а не завис.
const runCli = (dir) => {
    const res = spawnSync(process.execPath, [CLI], { cwd: dir, encoding: 'utf8', input: '' });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
};

describe('конфиг без generateLLMS', () => {
    it('визард не показывается, сборка проходит', () => {
        const dir = makeProject({ 'src/README.md': '# Home\n' });
        const { status, out } = runCli(dir);
        expect(status, out).toBe(0);
        expect(out).not.toContain('Compilation format');
    });
});
