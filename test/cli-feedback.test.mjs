import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

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

describe('c4builder feedback', () => {
    it('без сервера — код 1 и адрес сервера, каталог пуст', async () => {
        const empty = fs.mkdtempSync(path.join(dir, 'empty-'));
        const res = await feedback(empty, '--wait', '-p', '38359');
        expect(res.code).toBe(1);
        expect(res.stderr).toContain('no c4builder site -w on http://localhost:38359');
        expect(res.stdout).toBe('');
        expect(fs.readdirSync(empty)).toEqual([]);
    });

    it('с site -w: пустая очередь без --wait — пустой stdout и код 0; --wait печатает отправленную пачку', async () => {
        const base = 'http://127.0.0.1:38350';
        await serveSite(project, ['site', '-w'], {
            env: agentEnv(),
            onReady: async () => {
                // порт — из webPort своего .c4builder
                expect(await feedback(project)).toEqual({ code: 0, stdout: '', stderr: '' });
                const waiting = feedback(project, '--wait');
                await new Promise((r) => setTimeout(r, 500));
                const posted = await fetch(`${base}/__c4builder/feedback`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Origin: base },
                    body: JSON.stringify({
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
                const res = await feedback(project, '--wait', '-p', '38351');
                expect(res.code).toBe(1);
                expect(res.stderr).toContain('http://localhost:38351');
                expect(res.stderr).toContain('--no-agent');
            }
        });
    }, 60_000);
});
