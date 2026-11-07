import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { agentEnv, REPO_ROOT, serveSite, TMP_ROOT } from './helpers.mjs';

// `c4builder status [--json]` (change site-server-state, D8). Спавн асинхронный: сервер старой версии
// эмулируется в процессе теста, и spawnSync заблокировал бы его event loop.
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');
const CONFIG = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/default.c4builder.json'), 'utf8')
);

fs.mkdirSync(TMP_ROOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'cli-status-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const project = path.join(dir, 'project');
fs.mkdirSync(path.join(project, 'src'), { recursive: true });
fs.writeFileSync(path.join(project, 'src', 'README.md'), '# root\n');
fs.writeFileSync(path.join(project, '.c4builder'), JSON.stringify({ ...CONFIG, webPort: '28410' }));

const status = (cwd, ...args) =>
    new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, 'status', ...args], { cwd, env: agentEnv() });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('exit', (code) => resolve({ code, stdout, stderr }));
    });

describe('c4builder status', () => {
    it('сервер работает на другом -p — адрес, pid и слушатели по файлу состояния, код 0', async () => {
        const base = 'http://127.0.0.1:28411';
        await serveSite(project, ['site', '-w', '-p', '28411'], {
            env: agentEnv(),
            onReady: async () => {
                const { pid } = JSON.parse(
                    fs.readFileSync(path.join(project, '.c4builder.server.json'), 'utf8')
                );
                // слушатель foo: long-poll висит, пока не прервём
                const poll = new AbortController();
                const waiting = fetch(`${base}/__c4builder/feedback/next?as=foo`, {
                    headers: { 'X-C4builder-Feedback': '1' },
                    signal: poll.signal
                }).catch(() => {});
                await new Promise((r) => setTimeout(r, 200));
                try {
                    const text = await status(project);
                    expect(text.code, text.stderr).toBe(0);
                    expect(text.stdout).toContain(`site is running at http://localhost:28411 (pid ${pid}`);
                    expect(text.stdout).toContain('foo — listening, 0 queued');
                    const json = await status(project, '--json');
                    expect(json.code).toBe(0);
                    expect(JSON.parse(json.stdout)).toMatchObject({
                        running: true,
                        url: 'http://localhost:28411',
                        port: 28411,
                        source: 'state',
                        pid,
                        watch: true,
                        listeners: [{ name: 'foo', state: 'listening', queued: 0 }],
                        unaddressed: 0
                    });
                } finally {
                    poll.abort();
                    await waiting;
                }
            }
        });
    }, 60_000);

    it('сервера нет — --json с running: false и проверенным портом, код 1', async () => {
        const res = await status(project, '--json');
        expect(res.code).toBe(1);
        expect(JSON.parse(res.stdout)).toEqual({
            running: false,
            port: 28410,
            source: 'config',
            busy: false
        });
        const flag = await status(project, '-p', '28412');
        expect(flag.code).toBe(1);
        expect(flag.stdout).toContain('no c4builder site on http://localhost:28412');
    });

    it('файл состояния убитого сервера — сервер не запущен', async () => {
        const file = path.join(project, '.c4builder.server.json');
        fs.writeFileSync(file, JSON.stringify({ port: 28413, url: 'http://localhost:28413', pid: 999999 }));
        try {
            const res = await status(project, '--json');
            expect(res.code).toBe(1);
            expect(JSON.parse(res.stdout)).toMatchObject({ running: false, port: 28410, source: 'config' });
            expect(fs.existsSync(file)).toBe(true); // status только читает
        } finally {
            fs.rmSync(file, { force: true });
        }
    });

    it('сервер старой версии (SSE на /__livereload, без эндпоинта состояния) — работает, без подробностей', async () => {
        const old = http
            .createServer((req, res) => {
                if (req.url === '/__livereload') {
                    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                    res.write('retry: 1000\n\n');
                    return;
                }
                res.writeHead(404).end('not found');
            })
            .listen(28414, '127.0.0.1');
        await new Promise((r) => old.once('listening', r));
        try {
            const res = await status(project, '-p', '28414');
            expect(res.code).toBe(0);
            expect(res.stdout).toContain('site is running at http://localhost:28414');
            const json = await status(project, '-p', '28414', '--json');
            expect(JSON.parse(json.stdout)).toEqual({
                running: true,
                url: 'http://localhost:28414',
                port: 28414,
                source: 'flag'
            });
        } finally {
            old.closeAllConnections();
            old.close();
        }
    });

    it('порт занят чужим процессом — код 1, busy: true', async () => {
        const other = http.createServer((_, res) => res.end('hello')).listen(28415, '127.0.0.1');
        await new Promise((r) => other.once('listening', r));
        try {
            const res = await status(project, '-p', '28415', '--json');
            expect(res.code).toBe(1);
            expect(JSON.parse(res.stdout)).toEqual({
                running: false,
                port: 28415,
                source: 'flag',
                busy: true
            });
        } finally {
            other.close();
        }
    });

    it('вне проекта — порт по умолчанию, код 1, каталог пуст', async () => {
        const empty = fs.mkdtempSync(path.join(dir, 'empty-'));
        const res = await status(empty, '-p', '28416');
        expect(res.code).toBe(1);
        // ни заставки, ни мастера — одна строка ответа
        expect(res.stdout).toBe(
            'no c4builder site on http://localhost:28416 — start it with c4builder site -w\n'
        );
        expect(fs.readdirSync(empty)).toEqual([]);
        const json = await status(empty, '--json');
        expect(JSON.parse(json.stdout)).toMatchObject({ port: 3000, source: 'config' });
        expect(fs.readdirSync(empty)).toEqual([]);
    });
});
