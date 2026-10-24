import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

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
                    await fetch(`${base}/__c4builder/feedback/next?as=foo&wait=0`, {
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

    it('с CLAUDECODE=1 — подсказка про feedback --wait --as и режим в странице', async () => {
        const res = await run(38326, [], agentEnv({ CLAUDECODE: '1' }));
        expect(res.out).toContain(
            'agent mode (claude-code): page feedback goes to "c4builder feedback --wait --as <name> -p 38326"'
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

// Фолбэк на закешированный index.html (окно ребилда) — только для корня: ссылка на
// несуществующую папку должна давать 404, а не главную со статусом 200.
describe('неизвестные пути в site -w', () => {
    it('корень и реальный файл — 200, несуществующий каталог — 404', async () => {
        const port = 38329;
        await serve(['site', '-w', '-p', String(port)], {
            onReady: async () => {
                const base = `http://127.0.0.1:${port}`;
                const root = await fetch(`${base}/`);
                expect(root.status).toBe(200);
                expect(await root.text()).toContain('</html>');
                expect((await fetch(`${base}/index.html`)).status).toBe(200);
                expect((await fetch(`${base}/nope/`)).status).toBe(404);
            }
        });
    }, 60_000);
});
