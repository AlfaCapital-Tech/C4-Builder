import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { d2LocalImports, generateLlmsFull } from './dist.mjs';
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

const tmpDir = () => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'llms-'));
    dirs.push(dir);
    return dir;
};

// Временный проект: files — { относительный путь: содержимое }, config — поверх BASE_CONFIG.
const makeProject = (files, config = {}) => {
    const dir = tmpDir();
    for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
    fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify({ ...BASE_CONFIG, ...config }));
    return dir;
};

// input '' — висящий визард получил бы EOF и упал, а не завис.
const runCli = (dir) => {
    const res = spawnSync(process.execPath, [CLI], { cwd: dir, encoding: 'utf8', input: '' });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
};

const exists = (dir, rel) => fs.existsSync(path.join(dir, 'docs', rel));

describe('конфиг без generateLLMS', () => {
    it('визард не показывается, llms-файлов нет', () => {
        const dir = makeProject({ 'src/README.md': '# Home\n' });
        const { status, out } = runCli(dir);
        expect(status, out).toBe(0);
        expect(out).not.toContain('Compilation format');
        expect(exists(dir, 'llms.txt')).toBe(false);
        expect(exists(dir, 'llms-full.txt')).toBe(false);
    });
});

describe('generateLLMS без website', () => {
    it('предупреждение, код 0, markdown собран, llms-файлов нет', () => {
        const dir = makeProject(
            { 'src/README.md': '# Home\n' },
            { generateWEB: false, generateMD: true, generateLLMS: true }
        );
        const { status, out } = runCli(dir);
        expect(status, out).toBe(0);
        expect(out).toContain('generateLLMS requires generateWEB');
        expect(exists(dir, 'README.md')).toBe(true);
        expect(exists(dir, 'llms.txt')).toBe(false);
        expect(exists(dir, 'llms-full.txt')).toBe(false);
    });
});

describe('llms.txt и llms-full.txt: сборка проекта', () => {
    const CTX = '@startuml\n!include <C4/C4_Context>\n!include styles.iuml\nPerson(u, "User")\n@enduml\n';
    // ``` внутри исходника: fence обязан быть длиннее
    const API = '@startuml\n!include ../styles.iuml\nnote "```code```" as N\n@enduml\n';
    const STYLES = '!include _inc/deep.iuml\nskinparam shadowing false\n';
    const DEEP = 'skinparam roundCorner 8\n';
    let dir;
    let llms;
    let full;

    beforeAll(() => {
        dir = makeProject(
            {
                'src/README.md': 'root\n',
                'src/ctx.puml': CTX,
                'src/styles.iuml': STYLES,
                'src/_inc/deep.iuml': DEEP,
                'src/Система А/README.md': 'система\n',
                'src/Система А/api.puml': API,
                'src/Hidden/README.md': 'hidden\n',
                'openspec/changes/c-1/proposal.md': '## Why\n\n```plantuml\nAlice -> Bob\n```\n'
            },
            { generateLLMS: true, excludeSidebarFolderByPath: ['src/Hidden'], plugins: ['openspec'] }
        );
        const { status, out } = runCli(dir);
        if (status !== 0) throw new Error(`build failed: ${out}`);
        llms = fs.readFileSync(path.join(dir, 'docs', 'llms.txt'), 'utf8');
        full = fs.readFileSync(path.join(dir, 'docs', 'llms-full.txt'), 'utf8');
    });

    it('llms.txt: заголовок, blockquote со ссылкой на llms-full.txt, секция Pages', () => {
        expect(llms.startsWith('# llmsdemo\n\n> ')).toBe(true);
        expect(llms).toContain('[llms-full.txt](llms-full.txt)');
        expect(llms).toContain('\n## Pages\n\n');
    });

    it('llms.txt: состав и порядок = _sidebar.md, ссылки ведут на существующие .md', () => {
        const sidebar = fs.readFileSync(path.join(dir, 'docs', '_sidebar.md'), 'utf8');
        const sidebarUrls = [...sidebar.matchAll(/^\s*\* \[.*\]\((.*)\)$/gm)].map((m) => `${m[1]}.md`);
        const lines = llms.split('## Pages\n\n')[1].trimEnd().split('\n');
        // плоский список: каждая строка — `- [..](..)` от начала строки
        expect(lines.every((l) => /^- \[.+\]\(.+\)$/.test(l))).toBe(true);
        const urls = lines.map((l) => l.match(/\]\((.*)\)$/)[1]);
        expect(urls).toEqual(sidebarUrls);
        for (const url of urls) expect(exists(dir, decodeURI(url)), url).toBe(true);
    });

    it('llms.txt: заголовок — путь страницы, кириллица и пробелы кодируются', () => {
        expect(llms).toContain('- [Overview](Overview.md)\n');
        expect(llms).toContain(`- [Система А](${encodeURI('Система А/Система А.md')})\n`);
    });

    it('llms.txt: исключённой папки нет, страницы плагина openspec есть', () => {
        expect(llms).not.toContain('Hidden');
        expect(llms).toContain('- [OpenSpec](OpenSpec/OpenSpec.md)\n');
        expect(llms).toContain('- [OpenSpec / Changes / c-1](OpenSpec/Changes/c-1/c-1.md)\n');
    });

    it('llms-full.txt: исходник .puml целиком в блоке plantuml, ссылок на картинку нет', () => {
        expect(full).toContain(`\`\`\`plantuml\n${CTX}\`\`\``);
        expect(full).not.toContain('ctx.svg');
        expect(full).not.toContain('plantuml.com');
    });

    it('llms-full.txt: исходник с ``` получает fence из 4 кавычек', () => {
        expect(full).toContain(`\`\`\`\`plantuml\n${API}\`\`\`\``);
    });

    it('llms-full.txt: fence-диаграмма OpenSpec-артефакта — блок plantuml', () => {
        expect(full).toContain('```plantuml\n@startuml\nAlice -> Bob\n@enduml\n```');
    });

    it('llms-full.txt: приложение — общий .iuml один раз, вложенный есть, stdlib нет', () => {
        const appendix = full.split('\n## Included files\n')[1];
        expect(appendix).toBeDefined();
        expect(full.match(/^### src\/styles\.iuml$/gm)).toHaveLength(1);
        expect(appendix).toContain(`### src/_inc/deep.iuml\n\n\`\`\`plantuml\n${DEEP}\`\`\``);
        expect(appendix).toContain(`### src/styles.iuml\n\n\`\`\`plantuml\n${STYLES}\`\`\``);
        expect(appendix.match(/^### /gm)).toHaveLength(2); // <C4/...> не разворачивается
        // строки !include в исходниках не тронуты
        expect(full).toContain('!include <C4/C4_Context>\n!include styles.iuml\n');
    });
});

describe('generateLlmsFull: независимость от настроек картинок', () => {
    const D2 = 'u: Клиент {class: person}\n...@_c4lib\n';
    const LIB = 'classes: {person: {style.fill: "#0b4884"}}\n';
    const DITAA = '@startditaa\n+--+\n|A |\n+--+\n@endditaa\n';
    // Строка-ловушка: PlantUML-скан include'ов принял бы её за директиву и затащил bait.iuml.
    const BPMN = '<?xml version="1.0"?>\n<!--\n!include bait.iuml\n-->\n<bpmn:definitions/>\n';
    let dir;
    let full;

    beforeAll(async () => {
        dir = tmpDir();
        const src = path.join(dir, 'src');
        write(src, 'a.d2', D2);
        write(src, '_c4lib.d2', LIB);
        write(src, 'bait.iuml', 'skinparam x y\n');
        const tree = [
            {
                dir: src,
                name: 'Overview',
                level: 1,
                mdFiles: ['root\n'],
                diagrams: [
                    { dir: 'a.d2', ext: '.d2', engine: 'd2', content: Buffer.from(D2), isDitaa: false },
                    { dir: 'b.puml', ext: '.puml', engine: 'plantuml', content: DITAA, isDitaa: true },
                    {
                        dir: 'c.bpmn',
                        ext: '.bpmn',
                        engine: 'bpmn',
                        content: Buffer.from(BPMN),
                        isDitaa: false
                    }
                ],
                descendants: []
            }
        ];
        // embed + png: стратегия картинок прочитала бы несуществующие файлы из dist
        full = await generateLlmsFull(tree, {
            PROJECT_NAME: 'p',
            ROOT_FOLDER: src,
            DIST_FOLDER: path.join(dir, 'docs'),
            HOMEPAGE_NAME: 'Overview',
            EMBED_DIAGRAM: true,
            GENERATE_LOCAL_IMAGES: true,
            DIAGRAM_FORMAT: 'png',
            INCLUDE_BREADCRUMBS: false,
            DIAGRAMS_ON_TOP: false
        });
    });

    it('диаграммы — исходники (d2, ditaa как plantuml), без data:image', () => {
        expect(full).not.toContain('data:image');
        expect(full).toContain(`\`\`\`d2\n${D2}\`\`\``);
        expect(full).toContain(`\`\`\`plantuml\n${DITAA}\`\`\``);
    });

    it('BPMN — исходник в блоке xml, include-скан PlantUML к нему не применяется', () => {
        expect(full).toContain(`\`\`\`xml\n${BPMN}\`\`\``);
        expect(full).not.toContain('bait.iuml\n\n```');
    });

    it('D2-импорт — в приложении блоком d2', () => {
        expect(full).toMatch(/\n### \S+\/src\/_c4lib\.d2\n\n```d2\n/);
        expect(full).toContain(`\`\`\`d2\n${LIB}\`\`\``);
    });

    it('d2LocalImports: граф импортов без входного файла', () => {
        const src = path.join(dir, 'src');
        expect(d2LocalImports(path.join(src, 'a.d2'), D2)).toEqual([[path.join(src, '_c4lib.d2'), LIB]]);
    });
});
