import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { cmdSite } from './dist.mjs';
import { agentEnv, REPO_ROOT, serveSite, TMP_ROOT, updateCheckEnv } from './helpers.mjs';

// Подсказка после сборки печатает `c4builder site` — форма обязана работать наравне
// с `--site`, иначе allowExcessArguments молча глотает её и команда просто пересобирает.
const CONFIG = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/default.c4builder.json'), 'utf8')
);
const { version: CURRENT } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

fs.mkdirSync(TMP_ROOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'cli-site-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
fs.writeFileSync(path.join(dir, 'src', 'README.md'), '# root\n');
fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify({ ...CONFIG, webPort: '38321' }));

const serve = (args, opts) => serveSite(dir, args, opts);

describe('c4builder site', () => {
    it('позиционная подкоманда поднимает сервер так же, как --site', async () => {
        expect(await serve(['site'])).toContain('serving your docsify site');
    }, 60_000);
});

// Свежий кэш проверки обновлений: фоновый npm не запускается, плашка берёт версию из кэша.
describe('плашка о новой версии в site -w', () => {
    const xdg = path.join(dir, 'xdg');
    fs.mkdirSync(path.join(xdg, 'c4builder'), { recursive: true });
    fs.writeFileSync(path.join(xdg, 'c4builder', 'dist-tags.json'), '{"latest":"99.0.0"}');

    const page = async (port, env) => {
        let html = '';
        await serve(['site', '-w', '-p', String(port)], {
            env: updateCheckEnv(xdg, env),
            onReady: async () => {
                html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
            }
        });
        return html;
    };

    it('в отдаче dev-сервера — плашка с обеими версиями, в файлах сборки её нет', async () => {
        const html = await page(38322);
        expect(html).toContain('id="c4builder-update"');
        expect(html).toContain(`c4builder 99.0.0 is available (current ${CURRENT})`);
        expect(html).toContain('c4builder update');
        expect(fs.readFileSync(path.join(dir, 'docs', 'index.html'), 'utf8')).not.toContain(
            'c4builder-update'
        );
    }, 60_000);

    it('с NO_UPDATE_NOTIFIER=1 плашки нет', async () => {
        const html = await page(38323, { NO_UPDATE_NOTIFIER: '1' });
        expect(html).toContain('</body>');
        expect(html).not.toContain('c4builder-update');
    }, 60_000);
});

// Комментарии к выделенному тексту (change site-comments): запись в исходник страницы,
// защита по Origin, неизвестная страница, без -w ни скрипта, ни маршрута.
describe('комментарии в site -w', () => {
    const post = (port, body, headers = {}) =>
        fetch(`http://127.0.0.1:${port}/__c4builder/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body)
        });
    const readme = path.join(dir, 'src', 'README.md');

    it('POST с Origin сайта дописывает раздел в исходник; чужой Origin, пустой комментарий и неизвестная страница отклоняются', async () => {
        const port = 38324;
        const before = fs.readFileSync(readme, 'utf8');
        try {
            await serve(['site', '-w', '-p', String(port)], {
                onReady: async () => {
                    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
                    expect(html).toContain('__c4builderComments');
                    expect(fs.readFileSync(path.join(dir, 'docs', 'index.html'), 'utf8')).not.toContain(
                        '__c4builderComments'
                    );

                    expect((await post(port, { page: 'Overview.md', comment: 'x' })).status).toBe(403);
                    expect(
                        (
                            await post(
                                port,
                                { page: 'Overview.md', comment: 'x' },
                                { Origin: 'http://evil.test' }
                            )
                        ).status
                    ).toBe(403);
                    // DNS rebinding: Host и Origin согласованы, но домен чужой. fetch Host не
                    // подменяет — нужен голый http.request.
                    const rebound = await new Promise((resolve, reject) => {
                        const body = JSON.stringify({ page: 'Overview.md', comment: 'x' });
                        http.request(
                            {
                                host: '127.0.0.1',
                                port,
                                method: 'POST',
                                path: '/__c4builder/comments',
                                headers: {
                                    Host: `evil.test:${port}`,
                                    Origin: `http://evil.test:${port}`,
                                    'Content-Type': 'application/json',
                                    'Content-Length': Buffer.byteLength(body)
                                }
                            },
                            (res) => resolve(res.resume().statusCode)
                        )
                            .on('error', reject)
                            .end(body);
                    });
                    expect(rebound).toBe(403);
                    const origin = { Origin: `http://127.0.0.1:${port}` };
                    expect((await post(port, { page: 'Nope.md', comment: 'x' }, origin)).status).toBe(404);
                    expect((await post(port, { page: 'Overview.md', comment: '  ' }, origin)).status).toBe(
                        400
                    );
                    expect(fs.readFileSync(readme, 'utf8')).toBe(before);

                    const ok = await post(
                        port,
                        { page: '/Overview.md', quote: 'root', section: 'root', comment: 'Why?' },
                        origin
                    );
                    expect(ok.status).toBe(200);
                    expect(await ok.json()).toEqual({ file: 'src/README.md', number: null });
                    expect(fs.readFileSync(readme, 'utf8')).toBe(
                        '# root\n\n## Open questions\n\n- Why? — «root» (§ root)\n'
                    );

                    const del = await fetch(`http://127.0.0.1:${port}/__c4builder/comments`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json', ...origin },
                        body: JSON.stringify({ page: 'Overview.md', text: 'Why? — «root» (§ root)' })
                    });
                    expect(del.status).toBe(200);
                    expect(fs.readFileSync(readme, 'utf8')).toBe('# root\n\n## Open questions\n\n');
                    expect(
                        (
                            await fetch(`http://127.0.0.1:${port}/__c4builder/comments`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ page: 'Overview.md', text: 'x' })
                            })
                        ).status
                    ).toBe(403);
                }
            });
        } finally {
            fs.writeFileSync(readme, before);
        }
    }, 60_000);

    it('без -w нет ни скрипта, ни маршрута', async () => {
        const port = 38325;
        await serve(['site', '-p', String(port)], {
            onReady: async () => {
                expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).not.toContain(
                    '__c4builderComments'
                );
                const res = await post(
                    port,
                    { page: 'Overview.md', comment: 'x' },
                    { Origin: `http://127.0.0.1:${port}` }
                );
                expect(res.status).toBe(404);
            }
        });
    }, 60_000);
});

// Агентский режим (change site-agent-feedback, D2): подсказка при старте и флаг в странице.
describe('агентский режим site -w', () => {
    const run = async (port, args, env) => {
        const res = {};
        res.out = await serve(['site', '-w', '-p', String(port), ...args], {
            env,
            onReady: async () => {
                const base = `http://127.0.0.1:${port}`;
                res.html = await (await fetch(`${base}/`)).text();
                res.next = (
                    await fetch(`${base}/__c4builder/feedback/next?wait=0`, {
                        headers: { 'X-C4builder-Feedback': '1' }
                    })
                ).status;
                res.post = (
                    await fetch(`${base}/__c4builder/feedback`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Origin: base },
                        body: JSON.stringify({ decision: 'approved', comments: [] })
                    })
                ).status;
            }
        });
        return res;
    };

    it('с CLAUDECODE=1 — подсказка про feedback --wait и режим в странице', async () => {
        const res = await run(38326, [], agentEnv({ CLAUDECODE: '1' }));
        expect(res.out).toContain(
            'agent mode (claude-code): page feedback goes to "c4builder feedback --wait -p 38326"'
        );
        expect(res.html).toContain('var AGENT = { on: true');
        expect(res.post).toBe(200);
    }, 60_000);

    it('--no-agent при CLAUDECODE=1 — без подсказки и режима, эндпоинты feedback — 404', async () => {
        const res = await run(38327, ['--no-agent'], agentEnv({ CLAUDECODE: '1' }));
        expect(res.out).not.toContain('agent mode');
        expect(res.html).toContain('var AGENT = { on: false');
        expect(res.next).toBe(404);
        expect(res.post).toBe(404);
    }, 60_000);

    it('без переменных агента режим выключен, но страница уже со сниппетом', async () => {
        const res = await run(38328, [], agentEnv());
        expect(res.out).not.toContain('agent mode (');
        expect(res.html).toContain('var AGENT = { on: false');
    }, 60_000);
});

// Очередь и каналы feedback (D1, D3, D4, D6) — сервер в процессе теста: окна long-poll и
// присутствия слушателя короче боевых.
describe('очередь feedback в site -w', () => {
    const distDir = path.join(dir, 'feedback-dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body></body></html>');
    const PAGES = new Map([['A.md', [path.join(process.cwd(), 'src', 'A', 'README.md')]]]);
    const ONE = {
        decision: 'submitted',
        comments: [{ page: 'A.md', quote: 'foo bar', section: 'Flow', comment: 'Rename to baz' }]
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const start = async (port, { agent, pollMs = 10_000, idleMs = 30_000 } = {}) => {
        const server = await cmdSite(
            { DIST_FOLDER: distDir, WEB_PORT: String(port), QUESTIONS_HEADING: 'Open questions' },
            { port, watch: true, agent, pollMs, idleMs },
            new EventEmitter(),
            () => PAGES
        );
        const url = `http://127.0.0.1:${port}`;
        return {
            url,
            post: (body = ONE, headers = { Origin: url }) =>
                fetch(`${url}/__c4builder/feedback`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify(body)
                }),
            next: (query = '', headers = { 'X-C4builder-Feedback': '1' }, signal) =>
                fetch(`${url}/__c4builder/feedback/next${query}`, { headers, signal }),
            close: () =>
                new Promise((r) => {
                    server.closeAllConnections();
                    server.close(r);
                })
        };
    };

    // Поток /__livereload: next(name) ждёт ближайшее событие с этим именем.
    const sse = async (url) => {
        const reader = (await fetch(`${url}/__livereload`)).body.getReader();
        const decoder = new TextDecoder();
        const events = [];
        let buf = '';
        return async (name) => {
            for (;;) {
                const i = events.findIndex((e) => e.event === name);
                if (i >= 0) return events.splice(i, 1)[0].data;
                const { value, done } = await reader.read();
                if (done) throw new Error('поток SSE закрыт');
                buf += decoder.decode(value, { stream: true });
                for (let at = buf.indexOf('\n\n'); at >= 0; at = buf.indexOf('\n\n')) {
                    const block = buf.slice(0, at);
                    buf = buf.slice(at + 2);
                    const event = block.match(/^event: (.*)$/m)?.[1];
                    if (event) events.push({ event, data: JSON.parse(block.match(/^data: (.*)$/m)[1]) });
                }
            }
        };
    };

    it('пачка до подключения ждёт в очереди и выдаётся следующему запросу; пустая очередь с ?wait=0 → 204', async () => {
        const s = await start(38340);
        try {
            expect((await s.next('?wait=0')).status).toBe(204);
            const posted = await s.post();
            expect(posted.status).toBe(200);
            const { id, queued } = await posted.json();
            expect(queued).toBe(true);
            expect(id).toMatch(/^[\w-]{36}$/);
            const got = await s.next();
            expect(got.status).toBe(200);
            expect(got.headers.get('content-type')).toMatch(/^text\/markdown/);
            const text = await got.text();
            expect(text).toContain('Decision: submitted');
            expect(text).toContain(
                '## 1. A.md (§ Flow)\nSources: src/A/README.md\nQuote: "foo bar"\n\n> Rename to baz'
            );
            expect((await s.next('?wait=0')).status).toBe(204);
        } finally {
            await s.close();
        }
    });

    it('два ожидающих — пачку получает самый ранний, второй ждёт дальше; оборванный ожидающий не считается', async () => {
        const s = await start(38341, { pollMs: 1500 });
        try {
            const aborted = new AbortController();
            s.next('', undefined, aborted.signal).catch(() => {});
            await sleep(100);
            aborted.abort();
            await sleep(100);
            expect((await (await s.post()).json()).queued).toBe(true);
            expect((await s.next('?wait=0')).status).toBe(200);

            const first = s.next().then(async (r) => [r.status, await r.text()]);
            await sleep(100);
            const second = s.next().then((r) => r.status);
            await sleep(100);
            expect((await (await s.post()).json()).queued).toBe(false);
            expect((await first)[0]).toBe(200);
            expect(await second).toBe(204);
        } finally {
            await s.close();
        }
    });

    it('защита: next без заголовка, с Origin или чужим Host и POST без Origin — 403, очередь не трогается; первый next включает режим', async () => {
        const s = await start(38342);
        try {
            expect((await s.post()).status).toBe(200);
            expect((await s.next('?wait=0', {})).status).toBe(403);
            expect((await s.next('?wait=0', { 'X-C4builder-Feedback': '1', Origin: s.url })).status).toBe(
                403
            );
            const rebound = await new Promise((resolve, reject) => {
                http.get(
                    {
                        host: '127.0.0.1',
                        port: 38342,
                        path: '/__c4builder/feedback/next?wait=0',
                        headers: { Host: 'evil.test:38342', 'X-C4builder-Feedback': '1' }
                    },
                    (res) => resolve(res.resume().statusCode)
                ).on('error', reject);
            });
            expect(rebound).toBe(403);
            expect((await s.post(ONE, {})).status).toBe(403);
            expect((await s.post(ONE, { Origin: 'http://evil.test' })).status).toBe(403);
            expect((await s.post({ decision: 'submitted', comments: [] })).status).toBe(400);
            expect((await s.post({ ...ONE, decision: 'merged' })).status).toBe(400);
            expect(await (await fetch(`${s.url}/`)).text()).toContain('var AGENT = { on: false');

            const got = await s.next('?wait=0');
            expect(got.status).toBe(200);
            expect(await got.text()).toContain('Rename to baz');
            expect((await s.next('?wait=0')).status).toBe(204);
            expect(await (await fetch(`${s.url}/`)).text()).toContain('var AGENT = { on: true');
        } finally {
            await s.close();
        }
    });

    it('явно выключенный режим — оба эндпоинта 404', async () => {
        const s = await start(38343, { agent: { on: false, name: '', explicit: true } });
        try {
            expect((await s.post()).status).toBe(404);
            expect((await s.next('?wait=0')).status).toBe(404);
        } finally {
            await s.close();
        }
    });

    it('SSE: agent при подключении и смене слушателя, delivered с id выданной пачки', async () => {
        const s = await start(38344, { pollMs: 60_000, idleMs: 300 });
        try {
            const next = await sse(s.url);
            expect(await next('agent')).toEqual({ on: false, listening: false });
            const poll = s.next();
            expect(await next('agent')).toEqual({ on: true, listening: true });
            const { id, queued } = await (await s.post()).json();
            expect(queued).toBe(false);
            expect((await poll).status).toBe(200);
            expect(await next('delivered')).toEqual({ id });
            expect(await next('agent')).toEqual({ on: true, listening: false });
        } finally {
            await s.close();
        }
    });
});
