import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');

// 4.2: при пользовательском h1 + diagramsOnTop нессылочная диаграмма НЕ должна вставать
// выше заголовка. generateLocalImages=false → диаграмма превращается в remote-URL
// (java и рендер не нужны), поэтому тест самодостаточен и быстр.
let dir;
let readme;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(REPO_ROOT, 'test', '.tmp-h1-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'index.md'), '# My Own Title\n\nBody text.\n');
    fs.writeFileSync(path.join(dir, 'src', 'a.puml'), '@startuml\nAlice -> Bob\n@enduml\n');
    fs.writeFileSync(
        path.join(dir, '.c4builder'),
        // Полный набор ключей — иначе визард переспросил бы недостающее и завис на EOF.
        JSON.stringify({
            projectName: 'h1demo',
            homepageName: 'Overview',
            rootFolder: 'src',
            distFolder: 'docs',
            generateMD: true,
            generateCompleteMD: false,
            generateWEB: false,
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
            diagramsOnTop: true,
            embedDiagram: false,
            excludeOtherFiles: false,
            generateLocalImages: false,
            plantumlServerUrl: 'https://www.plantuml.com/plantuml',
            diagramFormat: 'svg',
            d2Layout: 'dagre',
            charset: 'UTF-8',
            hasRun: true
        })
    );
    const res = spawnSync(process.execPath, [CLI], { cwd: dir, encoding: 'utf8', input: '' });
    if (res.status !== 0) throw new Error(`build failed: ${res.stdout}\n${res.stderr}`);
    readme = fs.readFileSync(path.join(dir, 'docs', 'README.md'), 'utf8');
});

afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('4.2: пользовательский h1 + diagramsOnTop', () => {
    it('заголовок остаётся первым, диаграмма — под ним', () => {
        const h1Pos = readme.indexOf('# My Own Title');
        const diagramPos = readme.indexOf('![diagram]');
        const bodyPos = readme.indexOf('Body text.');
        expect(h1Pos).toBeGreaterThanOrEqual(0);
        expect(diagramPos).toBeGreaterThanOrEqual(0);
        expect(h1Pos).toBeLessThan(diagramPos); // h1 выше диаграммы (регрессия была наоборот)
        expect(diagramPos).toBeLessThan(bodyPos); // diagramsOnTop: диаграмма выше тела
    });

    it('ровно один h1 в документе', () => {
        expect(readme.match(/^#\s+/gm)?.length).toBe(1);
    });
});
