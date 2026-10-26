import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { cmdSite } from './dist.mjs';
import { agentEnv, REPO_ROOT, serveSite, TMP_ROOT } from './helpers.mjs';

// `c4builder feedback` (change site-agent-feedback, D9): забирает пачку у `site -w`, не трогая
// каталог. Порт всегда явный или из своего .c4builder — дефолтный 3000 может быть занят живым сервером.
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');
const CONFIG = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/default.c4builder.json'), 'utf8')
);

fs.mkdirSync(TMP_ROOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'cli-feedback-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const project = path.join(dir, 'project');
fs.mkdirSync(path.join(project, 'src'), { recursive: true });
fs.writeFileSync(path.join(project, 'src', 'README.md'), '# root\n\nfoo bar\n');
fs.writeFileSync(path.join(project, '.c4builder'), JSON.stringify({ ...CONFIG, webPort: '38350' }));

const feedback = (cwd, ...args) =>
    new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, 'feedback', ...args], { cwd, env: agentEnv() });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('exit', (code) => resolve({ code, stdout, stderr }));
    });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AS_REQUIRED = '--as <name> is required';

describe('c4builder feedback', () => {
    it('без сервера — код 1 и адрес сервера, каталог пуст', async () => {
        const empty = fs.mkdtempSync(path.join(dir, 'empty-'));
        const res = await feedback(empty, '--wait', '--as', 'foo', '-p', '38359');
        expect(res.code).toBe(1);
        expect(res.stderr).toContain('no c4builder site -w on http://localhost:38359');
        expect(res.stdout).toBe('');
        expect(fs.readdirSync(empty)).toEqual([]);
    });

    it('без --as или с недопустимым именем — код 2 и пример команды, без обращения к серверу', async () => {
        for (const args of [[], ['--as', 'a b'], ['--as', 'x'.repeat(65)]]) {
            const res = await feedback(dir, '--wait', '-p', '38359', ...args);
            expect(res.code, args.join(' ')).toBe(2);
            expect(res.stderr).toContain(AS_REQUIRED);
            expect(res.stderr).toContain('c4builder feedback --wait --as add-dark-mode');
            // код 2 раньше сети: иначе было бы «no c4builder site -w» и код 1
            expect(res.stderr).not.toContain('no c4builder site -w');
            expect(res.stdout).toBe('');
        }
    });

    it('с site -w: пустой ящик без --wait — пустой stdout и код 0; --wait печатает отправленную пачку', async () => {
        const base = 'http://127.0.0.1:38350';
        await serveSite(project, ['site', '-w'], {
            env: agentEnv(),
            onReady: async () => {
                // порт — из webPort своего .c4builder
                expect(await feedback(project, '--as', 'foo')).toEqual({ code: 0, stdout: '', stderr: '' });
                const waiting = feedback(project, '--wait', '--as', 'foo');
                await new Promise((r) => setTimeout(r, 500));
                const posted = await fetch(`${base}/__c4builder/feedback`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Origin: base },
                    body: JSON.stringify({
                        to: 'foo',
                        decision: 'submitted',
                        comments: [
                            {
                                page: 'Overview.md',
                                quote: 'foo bar',
                                section: 'root',
                                comment: 'Rename to baz'
                            }
                        ]
                    })
                });
                expect(posted.status).toBe(200);
                const res = await waiting;
                expect(res.code, res.stderr).toBe(0);
                expect(res.stdout).toContain('Decision: submitted');
                expect(res.stdout).toContain(
                    '## 1. Overview.md (§ root)\nSources: src/README.md\nQuote: "foo bar"'
                );
                expect(res.stdout).toContain('> Rename to baz');
            }
        });
    }, 60_000);

    it('сервер с --no-agent — код 1 и сообщение про --no-agent', async () => {
        await serveSite(project, ['site', '-w', '--no-agent', '-p', '38351'], {
            env: agentEnv({ CLAUDECODE: '1' }),
            onReady: async () => {
                const res = await feedback(project, '--wait', '--as', 'foo', '-p', '38351');
                expect(res.code).toBe(1);
                expect(res.stderr).toContain('http://localhost:38351');
                expect(res.stderr).toContain('--no-agent');
            }
        });
    }, 60_000);
});

// Очередь, ящики и каналы feedback (site-agent-feedback D1, D3, D4, D6; feedback-mailboxes D3–D4) —
// сервер в процессе теста: окна long-poll, присутствия слушателя и жизни ящика короче боевых.
describe('ящики feedback в site -w', () => {
    const distDir = path.join(dir, 'feedback-dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body></body></html>');
    const PAGES = new Map([['A.md', [path.join(process.cwd(), 'src', 'A', 'README.md')]]]);
    const ONE = {
        decision: 'submitted',
        comments: [{ page: 'A.md', quote: 'foo bar', section: 'Flow', comment: 'Rename to baz' }]
    };
    const FB = { 'X-C4builder-Feedback': '1' };
    const batchFor = (to) => ({ ...ONE, to, comments: [{ ...ONE.comments[0], comment: `for ${to}` }] });

    // Переадресации сборки (change site-agent-review): change `add-dark-mode` есть на сайте.
    const REDIRECTS = new Map([['/change/add-dark-mode', '/OpenSpec/Changes/add-dark-mode/add-dark-mode']]);

    const start = async (port, { agent, pollMs = 10_000, idleMs = 30_000, mailboxTtlMs } = {}) => {
        const server = await cmdSite(
            { DIST_FOLDER: distDir, WEB_PORT: String(port), QUESTIONS_HEADING: 'Open questions' },
            { port, watch: true, agent, pollMs, idleMs, mailboxTtlMs },
            new EventEmitter(),
            () => ({ pages: PAGES, redirects: REDIRECTS })
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
            // Слушатель foo; query дописывается к ?as=foo.
            next: (query = '', headers = FB, signal) =>
                fetch(`${url}/__c4builder/feedback/next?as=foo${query}`, { headers, signal }),
            // `c4builder feedback --wait --as <name>` на этот сервер.
            listen: (name) => feedback(dir, '--wait', '--as', name, '-p', String(port)),
            close: () =>
                new Promise((r) => {
                    server.closeAllConnections();
                    server.close(r);
                })
        };
    };

    // Поток /__livereload: next(name, pred) ждёт ближайшее событие с этим именем (и условием).
    const sse = async (url) => {
        const reader = (await fetch(`${url}/__livereload`)).body.getReader();
        const decoder = new TextDecoder();
        const events = [];
        let buf = '';
        return async (name, pred = () => true) => {
            for (;;) {
                const i = events.findIndex((e) => e.event === name && pred(e.data));
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
    const listening =
        (...names) =>
        (d) =>
            names.every((n) => d.mailboxes.some((m) => m.name === n && m.state === 'listening'));

    it('пачка до подключения ждёт без адресата и выдаётся первому слушателю; пустой ящик с wait=0 → 204', async () => {
        const s = await start(38340);
        try {
            const posted = await s.post();
            expect(posted.status).toBe(200);
            const { id, queued, to } = await posted.json();
            expect(queued).toBe(true);
            expect(to).toBeUndefined();
            expect(id).toMatch(/^[\w-]{36}$/);
            const got = await s.next();
            expect(got.status).toBe(200);
            expect(got.headers.get('content-type')).toMatch(/^text\/markdown/);
            const text = await got.text();
            expect(text).toContain('Decision: submitted');
            expect(text).toContain(
                '## 1. A.md (§ Flow)\nSources: src/A/README.md\nQuote: "foo bar"\n\n> Rename to baz'
            );
            expect((await s.next('&wait=0')).status).toBe(204);
        } finally {
            await s.close();
        }
    });

    it('два ожидающих с одним именем — пачку получает самый ранний, второй ждёт дальше; оборванный не считается', async () => {
        const s = await start(38341, { pollMs: 1500 });
        try {
            const aborted = new AbortController();
            s.next('', undefined, aborted.signal).catch(() => {});
            await sleep(100);
            aborted.abort();
            await sleep(100);
            expect((await (await s.post(batchFor('foo'))).json()).queued).toBe(true);
            expect((await s.next('&wait=0')).status).toBe(200);

            const first = s.next().then(async (r) => [r.status, await r.text()]);
            await sleep(100);
            const second = s.next().then((r) => r.status);
            await sleep(100);
            expect((await (await s.post(batchFor('foo'))).json()).queued).toBe(false);
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
            expect((await s.next('&wait=0', {})).status).toBe(403);
            expect((await s.next('&wait=0', { ...FB, Origin: s.url })).status).toBe(403);
            const rebound = await new Promise((resolve, reject) => {
                http.get(
                    {
                        host: '127.0.0.1',
                        port: 38342,
                        path: '/__c4builder/feedback/next?as=foo&wait=0',
                        headers: { Host: 'evil.test:38342', ...FB }
                    },
                    (res) => resolve(res.resume().statusCode)
                ).on('error', reject);
            });
            expect(rebound).toBe(403);
            expect((await s.post(ONE, {})).status).toBe(403);
            expect((await s.post(ONE, { Origin: 'http://evil.test' })).status).toBe(403);
            expect((await s.post({ decision: 'submitted', comments: [] })).status).toBe(400);
            expect((await s.post({ ...ONE, decision: 'merged' })).status).toBe(400);
            expect((await s.post({ ...ONE, to: 'a b' })).status).toBe(400);
            expect(await (await fetch(`${s.url}/`)).text()).toContain('var AGENT = { on: false');

            const got = await s.next('&wait=0');
            expect(got.status).toBe(200);
            expect(await got.text()).toContain('Rename to baz');
            expect((await s.next('&wait=0')).status).toBe(204);
            expect(await (await fetch(`${s.url}/`)).text()).toContain('var AGENT = { on: true');
        } finally {
            await s.close();
        }
    });

    it('явно выключенный режим — оба эндпоинта 404', async () => {
        const s = await start(38343, { agent: { on: false, name: '', explicit: true } });
        try {
            expect((await s.post()).status).toBe(404);
            expect((await s.next('&wait=0')).status).toBe(404);
        } finally {
            await s.close();
        }
    });

    it('SSE: agent с ящиками при подключении и смене слушателя, delivered с id и адресатом', async () => {
        const s = await start(38344, { pollMs: 60_000, idleMs: 300 });
        try {
            const next = await sse(s.url);
            expect(await next('agent')).toEqual({ on: false, mailboxes: [] });
            const poll = s.next();
            expect(await next('agent')).toEqual({
                on: true,
                mailboxes: [{ name: 'foo', state: 'listening', queued: 0 }]
            });
            const { id, queued, to } = await (await s.post(batchFor('foo'))).json();
            expect([queued, to]).toEqual([false, 'foo']);
            expect((await poll).status).toBe(200);
            expect(await next('delivered')).toEqual({ id, to: 'foo' });
            expect(await next('agent')).toEqual({
                on: true,
                mailboxes: [{ name: 'foo', state: 'reconnecting', queued: 0 }]
            });
            expect(await (await fetch(`${s.url}/`)).text()).toContain(
                'var AGENT = { on: true, mailboxes: [{"name":"foo","state":"reconnecting","queued":0}] }'
            );
        } finally {
            await s.close();
        }
    });

    it('два агента: пачка на bar только у bar и ждёт его между запусками, пока foo слушает', async () => {
        const s = await start(38345, { pollMs: 60_000 });
        try {
            const next = await sse(s.url);
            const foo = s.listen('foo');
            const bar = s.listen('bar');
            await next('agent', listening('foo', 'bar'));
            expect((await (await s.post(batchFor('bar'))).json()).queued).toBe(false);
            const first = await bar;
            expect(first.code, first.stderr).toBe(0);
            expect(first.stdout).toContain('> for bar');

            // bar правит файлы и ещё не перезапустился: пачка ждёт в его ящике, foo её не получает
            const again = await (await s.post({ ...batchFor('bar'), general: 'second' })).json();
            expect([again.queued, again.to]).toEqual([true, 'bar']);
            await next('agent', (d) => d.mailboxes.some((m) => m.name === 'bar' && m.queued === 1));
            const second = await s.listen('bar');
            expect(second.stdout).toContain('second');

            await s.post(batchFor('foo'));
            const own = await foo;
            expect(own.stdout).toContain('> for foo');
            expect(own.stdout).not.toContain('for bar');
        } finally {
            await s.close();
        }
    }, 30_000);

    it('без имени: /next — 400, CLI — код 2; пачка остаётся и достаётся первому --as foo', async () => {
        const s = await start(38346);
        try {
            expect((await s.post()).status).toBe(200);
            for (const query of ['?wait=0', '?as=&wait=0', '?as=a%20b&wait=0']) {
                const res = await fetch(`${s.url}/__c4builder/feedback/next${query}`, { headers: FB });
                expect(res.status, query).toBe(400);
                expect((await res.json()).error).toContain(AS_REQUIRED);
            }
            const old = await feedback(dir, '--wait', '-p', '38346');
            expect(old.code).toBe(2);
            expect(old.stderr).toContain(AS_REQUIRED);
            const got = await s.listen('foo');
            expect(got.code, got.stderr).toBe(0);
            expect(got.stdout).toContain('> Rename to baz');
        } finally {
            await s.close();
        }
    }, 30_000);

    // Адрес страницы change'а (change site-agent-review, D6): эндпоинт и строка `Change page` в stderr.
    it("/page: 200 с адресом для change'а, 404 для чужого имени, 403 с Origin или без заголовка, 400 без имени", async () => {
        const s = await start(38348);
        try {
            const page = (query, headers = FB) => fetch(`${s.url}/__c4builder/page${query}`, { headers });
            const ok = await page('?as=add-dark-mode');
            expect(ok.status).toBe(200);
            expect(await ok.json()).toEqual({ url: '/#/change/add-dark-mode' });
            expect((await page('?as=review-2')).status).toBe(404);
            expect((await page('?as=add-dark-mode', { ...FB, Origin: s.url })).status).toBe(403);
            expect((await page('?as=add-dark-mode', {})).status).toBe(403);
            expect((await page('?as=a%20b')).status).toBe(400);
            expect((await page('')).status).toBe(400);
        } finally {
            await s.close();
        }
    });

    it('feedback --wait --as <change>: строка Change page в stderr, stdout — только пачка; не change — без строки', async () => {
        const s = await start(38349, { pollMs: 60_000 });
        try {
            const next = await sse(s.url);
            const dark = s.listen('add-dark-mode');
            const other = s.listen('review-2');
            await next('agent', listening('add-dark-mode', 'review-2'));
            await s.post(batchFor('add-dark-mode'));
            await s.post(batchFor('review-2'));
            const [got, none] = await Promise.all([dark, other]);
            expect(got.code, got.stderr).toBe(0);
            expect(got.stderr).toBe('Change page: http://localhost:38349/#/change/add-dark-mode\n');
            expect(got.stdout).toMatch(/^# Page feedback \(c4builder\)\n/);
            expect(got.stdout).toContain('> for add-dark-mode');
            expect(got.stdout).not.toContain('Change page');
            expect(none.code, none.stderr).toBe(0);
            expect(none.stderr).toBe('');
            expect(none.stdout).toContain('> for review-2');
        } finally {
            await s.close();
        }
    }, 30_000);

    it('пустой ящик пропадает по mailboxTtlMs, ящик с пачкой остаётся', async () => {
        const s = await start(38347, { idleMs: 50, mailboxTtlMs: 300 });
        try {
            const next = await sse(s.url);
            expect((await s.next('&wait=0')).status).toBe(204);
            await s.post(batchFor('bar'));
            await next('agent', (d) => d.mailboxes.length === 2);
            expect(await next('agent', (d) => d.mailboxes.map((m) => m.name).join() === 'bar')).toEqual({
                on: true,
                mailboxes: [{ name: 'bar', state: 'reconnecting', queued: 1 }]
            });
            await sleep(700);
            expect(await (await fetch(`${s.url}/`)).text()).toContain(
                'mailboxes: [{"name":"bar","state":"reconnecting","queued":1}]'
            );
        } finally {
            await s.close();
        }
    });
});
