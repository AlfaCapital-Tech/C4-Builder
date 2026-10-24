import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cmdSite } from './dist.mjs';
import { agentEnv, ensureManagedJre, REPO_ROOT, serveSite, TMP_ROOT } from './helpers.mjs';

// Холодный старт dev-сервера (change site-warm-start): сайт отдаётся до рендера диаграмм,
// заглушки `rendering…`, фоновый рендер с событием `image`, финальная пересборка и reload,
// ошибка рендера в фоне не роняет сервер, правка во время рендера не теряется.
const CONFIG = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/default.c4builder.json'), 'utf8')
);

fs.mkdirSync(TMP_ROOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'cli-site-warm-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const puml = (title) => `@startuml\ntitle ${title}\nA -> B: ${title}\n@enduml\n`;
const BROKEN = '@startuml\nAlice -> \nfoo bar baz\n@enduml\n';

// Проект: 3 диаграммы в разных папках (пути с пробелами — как в реальных проектах).
const project = (name, diagrams) => {
    const root = path.join(dir, name);
    for (const [folder, content] of Object.entries(diagrams)) {
        const d = path.join(root, 'src', folder);
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, 'diagram.puml'), content);
        fs.writeFileSync(path.join(d, 'page.md'), `# ${folder}\n\nText of ${folder}.\n`);
    }
    fs.writeFileSync(path.join(root, 'src', 'README.md'), '# root\n');
    fs.writeFileSync(path.join(root, '.c4builder'), JSON.stringify({ ...CONFIG, webPort: '3261' }));
    return root;
};

let env;
beforeAll(async () => {
    env = agentEnv({ JAVA_HOME: await ensureManagedJre() });
});

const text = async (url) => {
    const res = await fetch(url);
    return { status: res.status, body: await res.text() };
};

describe('холодный старт site -w', () => {
    it('сервер отвечает до рендера, порядок строк, после `rendered` картинки готовы, правка во время рендера не теряется', async () => {
        const port = 3262;
        const root = project('cold', {
            'A Folder': puml('A'),
            'B Folder': puml('B'),
            'C Folder': puml('C')
        });
        const base = `http://127.0.0.1:${port}`;
        const pageMd = path.join(root, 'src', 'B Folder', 'page.md');
        const out = await serveSite(root, ['site', '-w', '-p', String(port)], {
            env,
            onReady: async ({ waitFor, output }) => {
                // Сервер поднят, фоновый рендер ещё не закончен.
                expect(output()).not.toMatch(/rendered \d+ diagrams in/);
                const svg = await text(`${base}/A%20Folder/diagram.svg`);
                expect(svg.status).toBe(200);
                expect(svg.body).toContain('rendering…');
                expect((await text(`${base}/`)).status).toBe(200);
                // Страница сайта: сниппет с обработчиком image и подменой src
                const html = (await text(`${base}/`)).body;
                expect(html).toContain("addEventListener('image'");
                expect(html).toContain("'v=' + Date.now()");

                // Правка страницы во время фонового рендера.
                fs.writeFileSync(pageMd, '# B Folder\n\nEdited during render.\n');

                await waitFor(/rendering 3 diagrams in background…/);
                await waitFor(/rendered 3 diagrams in [\d.]+ s/, 120_000);
                // Финальная пересборка из кэша (всё по чексуммам) — и правка в ней.
                await waitFor(/built in [\d.]+ seconds/, 60_000);
                await new Promise((r) => setTimeout(r, 300));
                for (const f of ['A%20Folder', 'B%20Folder', 'C%20Folder']) {
                    const { body } = await text(`${base}/${f}/diagram.svg`);
                    expect(body, f).not.toContain('rendering…');
                    expect(body, f).toContain('<svg');
                }
                expect((await text(`${base}/B%20Folder/B%20Folder.md`)).body).toContain(
                    'Edited during render.'
                );
                const cache = JSON.parse(fs.readFileSync(path.join(root, '.c4builder.cache'), 'utf8'));
                expect(cache.checksums).toHaveLength(3);
            }
        });
        const at = (s) => {
            const i = out.indexOf(s);
            expect(i, s).toBeGreaterThanOrEqual(0);
            return i;
        };
        const serving = at('serving your docsify site');
        const rendering = at('rendering 3 diagrams in background…');
        const rendered = out.search(/rendered 3 diagrams in [\d.]+ s/);
        expect(serving).toBeLessThan(rendering);
        expect(rendering).toBeLessThan(rendered);
        // Прогресс первой сборки: восстановленных из кэша нет, заглушки в прогресс не входят.
        expect(out.slice(0, serving)).not.toContain('processed 3 images');
    }, 240_000);

    it('ошибка в фоне: сервер жив, заглушка с ошибкой и ✗ в логе; после правки файла диаграмма перерисована', async () => {
        const port = 3263;
        const root = project('broken', { Good: puml('G'), Bad: BROKEN });
        const base = `http://127.0.0.1:${port}`;
        const badPuml = path.join(root, 'src', 'Bad', 'diagram.puml');
        const out = await serveSite(root, ['site', '-w', '-p', String(port)], {
            env,
            onReady: async ({ waitFor }) => {
                await waitFor(/rendered 2 diagrams in [\d.]+ s/, 120_000);
                // Финальная пересборка: битая диаграмма не в кэше → рендерится снова и снова
                // падает, но сборка не прерывается (softErrors) — сайт целый, на месте
                // диаграммы заглушка с ошибкой.
                await waitFor(/built in [\d.]+ seconds/, 60_000);
                await new Promise((r) => setTimeout(r, 300));
                expect((await text(`${base}/`)).status).toBe(200);
                expect((await text(`${base}/Bad/Bad.md`)).status).toBe(200);
                const bad = await text(`${base}/Bad/diagram.svg`);
                expect(bad.status).toBe(200);
                expect(bad.body).toContain('diagram not rendered');
                expect((await text(`${base}/Good/diagram.svg`)).body).not.toContain('rendering…');

                // Правка файла → обычная пересборка watch → картинка настоящая.
                fs.writeFileSync(badPuml, puml('Fixed'));
                await waitFor(/built in [\d.]+ seconds/, 120_000);
                await new Promise((r) => setTimeout(r, 300));
                const fixed = await text(`${base}/Bad/diagram.svg`);
                expect(fixed.body).not.toContain('diagram not rendered');
                expect(fixed.body).toContain('Fixed');
            }
        });
        expect(out).toMatch(/✗ Diagram "diagram\.svg": PlantUML exited with code 200/);
        expect(out).toContain('serving your docsify site');
    }, 240_000);

    it('тёплый старт: всё из кэша — без заглушек и фонового рендера', async () => {
        const port = 3264;
        const root = project('warm', { 'W Folder': puml('W') });
        const base = `http://127.0.0.1:${port}`;
        await serveSite(root, ['site', '-w', '-p', String(port)], {
            env,
            onReady: async ({ waitFor }) => {
                await waitFor(/rendered 1 diagrams in [\d.]+ s/, 120_000);
                await waitFor(/built in [\d.]+ seconds/, 60_000);
            }
        });
        const out = await serveSite(root, ['site', '-w', '-p', String(port)], {
            env,
            onReady: async () => {
                expect((await text(`${base}/W%20Folder/diagram.svg`)).body).not.toContain('rendering…');
            }
        });
        expect(out).not.toContain('in background');
        expect(out).toContain('processed 1 images');
    }, 240_000);
});

// Сервер в процессе теста: событие `image` в SSE и приоритет открытой страницы (design 2, 3).
describe('site -w: событие image и приоритет страницы', () => {
    const distDir = path.join(dir, 'inproc-dist');
    fs.mkdirSync(path.join(distDir, 'A b'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body></body></html>');
    fs.writeFileSync(path.join(distDir, 'A b', 'Page.md'), '# A b\n');
    fs.writeFileSync(path.join(distDir, '_sidebar.md'), '- x\n');
    fs.writeFileSync(path.join(distDir, 'Overview.md'), '# root\n');

    const start = async (port, prioritize) => {
        const emitter = new EventEmitter();
        const server = await cmdSite(
            { DIST_FOLDER: distDir, WEB_PORT: String(port), QUESTIONS_HEADING: 'Open questions' },
            { port, watch: true },
            emitter,
            () => ({ pages: new Map(), redirects: new Map() }),
            prioritize
        );
        return {
            emitter,
            url: `http://127.0.0.1:${port}`,
            close: () =>
                new Promise((r) => {
                    server.closeAllConnections();
                    server.close(r);
                })
        };
    };

    it('SSE: reloadEmitter.emit("image", { path }) приходит клиенту событием image', async () => {
        const { emitter, url, close } = await start(3265);
        try {
            const res = await fetch(`${url}/__livereload`);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            const read = async (pred) => {
                while (!pred(buf)) {
                    const { value, done } = await reader.read();
                    if (done) throw new Error('поток SSE закрыт');
                    buf += decoder.decode(value, { stream: true });
                }
            };
            await read((b) => b.includes('event: agent')); // подключение состоялось
            emitter.emit('image', { path: 'A b/diagram.svg' });
            await read((b) => b.includes('event: image'));
            expect(buf).toContain('event: image\ndata: {"path":"A b/diagram.svg"}\n\n');
            await reader.cancel();
        } finally {
            await close();
        }
    });

    it('клиент: событие image меняет src совпавших <img> на путь с ?v=, остальные не трогает', async () => {
        const { url, close } = await start(3268);
        let html;
        try {
            html = await (await fetch(`${url}/`)).text();
        } finally {
            await close();
        }
        const script = html.match(
            /<script>\s*\(function \(\) \{\s*if \(window\.__c4builderLiveReload\)[\s\S]*?<\/script>/
        );
        expect(script).not.toBeNull();
        const { JSDOM } = await import('jsdom');
        const sources = [];
        const dom = new JSDOM(
            `<!DOCTYPE html><html><body>
<img id="rel" src="A b/diagram.svg"><img id="enc" src="/A%20b/diagram.svg?v=1">
<img id="other" src="A b/other.svg"><img id="ext" src="https://example.com/A%20b/diagram.svg">
${script[0]}</body></html>`,
            {
                url: 'http://localhost:3268/#/A%20b/Page',
                runScripts: 'dangerously',
                beforeParse(window) {
                    // EventSource в jsdom нет — подставляем управляемый.
                    window.EventSource = class {
                        constructor() {
                            this.listeners = {};
                            sources.push(this);
                        }
                        addEventListener(name, fn) {
                            this.listeners[name] = fn;
                        }
                        close() {}
                    };
                }
            }
        );
        expect(sources).toHaveLength(1);
        sources[0].listeners.image({ data: JSON.stringify({ path: 'A b/diagram.svg' }) });
        const src = (id) => dom.window.document.getElementById(id).getAttribute('src');
        expect(src('rel')).toMatch(/^\/A%20b\/diagram\.svg\?v=\d+$/);
        expect(src('enc')).toMatch(/^\/A%20b\/diagram\.svg\?v=\d+$/);
        expect(src('enc')).not.toBe('/A%20b/diagram.svg?v=1');
        expect(src('other')).toBe('A b/other.svg');
        expect(src('ext')).toBe('https://example.com/A%20b/diagram.svg');
        dom.window.close();
    });

    it('GET <страница>.md зовёт prioritize с декодированным путём; служебные _*.md и не-md — нет', async () => {
        const calls = [];
        const { url, close } = await start(3266, (page) => calls.push(page));
        try {
            expect((await fetch(`${url}/A%20b/Page.md`)).status).toBe(200);
            expect((await fetch(`${url}/Overview.md`)).status).toBe(200);
            expect((await fetch(`${url}/_sidebar.md`)).status).toBe(200);
            expect((await fetch(`${url}/`)).status).toBe(200);
            expect((await fetch(`${url}/Missing.md`)).status).toBe(404); // очередь всё равно узнаёт о странице
            expect(calls).toEqual(['A b/Page.md', 'Overview.md', 'Missing.md']);
        } finally {
            await close();
        }
    });

    it('без prioritize (обычный site) запросы .md проходят как раньше', async () => {
        const { url, close } = await start(3267);
        try {
            expect((await fetch(`${url}/A%20b/Page.md`)).status).toBe(200);
        } finally {
            await close();
        }
    });
});
