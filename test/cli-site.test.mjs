import { spawn, spawnSync } from 'node:child_process';
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
fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify({ ...CONFIG, webPort: '28321' }));

const serve = (args, opts) => serveSite(dir, args, opts);
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');

describe('c4builder site', () => {
    it('позиционная подкоманда поднимает сервер так же, как --site', async () => {
        expect(await serve(['site'])).toContain('serving your docsify site');
    }, 60_000);

    // Express 5 зовёт колбэк listen и с ошибкой: раньше печатались «serving»/«go to», а код был 0.
    // Заняты и следующие порты (один — только на ::1, куда ведёт localhost) — подсказка обязана их
    // пропустить, а сервер — не переходить сам. Диапазон пробы (port+1…port+10) не пересекается
    // с портами других тестов: файлы идут параллельно.
    it('занятый порт → код 1, без «go to», с подсказкой свободного порта', async () => {
        const port = 28380;
        const busy = [];
        const hold = (p, host) =>
            new Promise((resolve, reject) => {
                const s = http.createServer();
                s.once('error', reject).listen(p, host, () => resolve(busy.push(s)));
            });
        try {
            await hold(port, '127.0.0.1');
            await hold(port + 1, '127.0.0.1');
            const v6 = await hold(port + 2, '::1').then(
                () => true,
                () => false
            );
            const res = spawnSync(process.execPath, [CLI, 'site', '-p', String(port)], {
                cwd: dir,
                encoding: 'utf8',
                timeout: 60_000
            });
            expect(res.status, `${res.stdout}${res.stderr}`).toBe(1);
            const hint = res.stdout.match(
                new RegExp(`port ${port} is already in use — pass a different one, e\\.g\\. -p (\\d+)`)
            );
            expect(hint, res.stdout).not.toBeNull();
            expect(Number(hint[1])).toBeGreaterThan(port + (v6 ? 2 : 1));
            expect(Number(hint[1])).toBeLessThanOrEqual(port + 10);
            expect(res.stdout).not.toContain('go to');
            // сервер не поднялся — файла состояния нет (change site-server-state)
            expect(fs.existsSync(path.join(dir, '.c4builder.server.json'))).toBe(false);
        } finally {
            for (const s of busy) s.close();
        }
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
        const html = await page(28322);
        expect(html).toContain('id="c4builder-update"');
        expect(html).toContain(`c4builder 99.0.0 is available (current ${CURRENT})`);
        expect(html).toContain('c4builder update');
        expect(fs.readFileSync(path.join(dir, 'docs', 'index.html'), 'utf8')).not.toContain(
            'c4builder-update'
        );
    }, 60_000);

    it('с NO_UPDATE_NOTIFIER=1 плашки нет', async () => {
        const html = await page(28323, { NO_UPDATE_NOTIFIER: '1' });
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
        const port = 28324;
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
        const port = 28325;
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

// Журнал ревью (change site-review-log): маршрут и кнопка есть только с `reviewLog`; файл —
// ближайший вверх от исходника страницы; строка — по шаблону cells с автором из конфига.
describe('журнал ревью в site -w', () => {
    const rdir = fs.mkdtempSync(path.join(TMP_ROOT, 'cli-site-review-'));
    afterAll(() => fs.rmSync(rdir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(rdir, 'src', 'Change'), { recursive: true });
    fs.writeFileSync(path.join(rdir, 'src', 'README.md'), '# root\n');
    fs.writeFileSync(path.join(rdir, 'src', 'Change', 'README.md'), '# change\n\n## Flow\n\nfoo bar\n');
    const TABLE =
        '# Review\n\n## Remarks\n\n| # | Where | Remark | Author | Status |\n|---|---|---|---|---|\n';
    const log = path.join(rdir, 'src', 'review.md');
    fs.writeFileSync(log, TABLE);
    fs.writeFileSync(
        path.join(rdir, '.c4builder'),
        JSON.stringify({
            ...CONFIG,
            reviewLog: {
                heading: 'Remarks',
                cells: ['', '{artifact} → {section}', '{text}', '{author}', ''],
                author: 'Reviewer'
            }
        })
    );
    const post = (port, body, origin = true) =>
        fetch(`http://127.0.0.1:${port}/__c4builder/review-log`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(origin ? { Origin: `http://127.0.0.1:${port}` } : {})
            },
            body: JSON.stringify(body)
        });

    it('POST дописывает строку в ближайший review.md; без Origin — 403; нет файла выше — 404', async () => {
        const port = 28326;
        await serveSite(rdir, ['site', '-w', '-p', String(port)], {
            onReady: async () => {
                const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
                expect(html).toContain('"review.md"');
                expect((await post(port, { page: 'Change/Change.md', comment: 'x' }, false)).status).toBe(
                    403
                );
                const ok = await post(port, {
                    page: 'Change/Change.md',
                    quote: 'foo bar',
                    section: 'Flow',
                    comment: 'Why?'
                });
                const okBody = await ok.json();
                expect(ok.status, JSON.stringify(okBody)).toBe(200);
                expect(okBody).toEqual({ file: 'src/review.md', number: 1 });
                expect(fs.readFileSync(log, 'utf8')).toBe(
                    `${TABLE}| 1 | Change → Flow | Why? — «foo bar» | Reviewer |  |\n`
                );
                // исходник страницы не тронут
                expect(fs.readFileSync(path.join(rdir, 'src', 'Change', 'README.md'), 'utf8')).toBe(
                    '# change\n\n## Flow\n\nfoo bar\n'
                );
                // Страница журнала: `src/review.md` слит в корневую Overview.md, среди её исходников
                // журнал узнаётся по разделу; GET подтверждает, DELETE удаляет строку по номеру и видимой ячейке.
                const origin = { Origin: `http://127.0.0.1:${port}` };
                // GET — без Origin (так шлёт браузер same-origin), чужой Origin — 403
                const check = (page, headers = {}) =>
                    fetch(`http://127.0.0.1:${port}/__c4builder/review-log?page=${page}`, { headers });
                expect((await check('Overview.md', { Origin: 'http://evil.test' })).status).toBe(403);
                expect((await check('Overview.md', origin)).status).toBe(200);
                const chk = await check('Overview.md');
                expect(chk.status, JSON.stringify(await chk.clone().json())).toBe(200);
                expect(await chk.json()).toEqual({ file: 'src/review.md', log: true });
                // страница с замечанием: её строки журнала для подсветки цитат
                const other = await check('Change/Change.md');
                expect(other.status).toBe(200);
                expect(await other.json()).toEqual({
                    file: 'src/review.md',
                    log: false,
                    logPage: 'Overview.md',
                    remarks: [{ number: 1, comment: 'Why?', quote: 'foo bar', section: 'Flow' }]
                });
                const del = (body) =>
                    fetch(`http://127.0.0.1:${port}/__c4builder/review-log`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json', ...origin },
                        body: JSON.stringify(body)
                    });
                expect(
                    (await del({ page: 'Change/Change.md', number: 1, text: 'Change → Flow' })).status
                ).toBe(404);
                expect((await del({ page: 'Overview.md', number: 1, text: 'nope' })).status).toBe(404);
                expect((await del({ page: 'Overview.md', number: 1, text: 'Change → Flow' })).status).toBe(
                    200
                );
                expect(fs.readFileSync(log, 'utf8')).toBe(TABLE);
                fs.renameSync(log, `${log}.bak`);
                const missing = await post(port, { page: 'Change/Change.md', comment: 'x' });
                expect(missing.status).toBe(404);
                expect((await missing.json()).error).toBe(
                    'review.md not found next to src/Change/README.md or above it'
                );
                fs.renameSync(`${log}.bak`, log);
            }
        });
    }, 60_000);

    it('questions: false — кнопки и маршрута вопросов нет; reviewLog.enabled: false — журнала нет', async () => {
        const port = 28328;
        const cfg = path.join(rdir, '.c4builder');
        const saved = fs.readFileSync(cfg, 'utf8');
        const parsed = JSON.parse(saved);
        fs.writeFileSync(
            cfg,
            JSON.stringify({
                ...parsed,
                questions: false,
                reviewLog: { ...parsed.reviewLog, enabled: false }
            })
        );
        try {
            await serveSite(rdir, ['site', '-w', '-p', String(port)], {
                onReady: async () => {
                    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
                    expect(html).toContain('var QUESTIONS = false');
                    expect(html).not.toContain('"review.md"');
                    const origin = { Origin: `http://127.0.0.1:${port}` };
                    const res = await fetch(`http://127.0.0.1:${port}/__c4builder/comments`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...origin },
                        body: JSON.stringify({ page: 'Change/Change.md', comment: 'x' })
                    });
                    expect(res.status).toBe(404);
                    expect((await post(port, { page: 'Change/Change.md', comment: 'x' })).status).toBe(404);
                }
            });
        } finally {
            fs.writeFileSync(cfg, saved);
        }
    }, 60_000);

    it('без reviewLog маршрута нет', async () => {
        const port = 28327;
        await serve(['site', '-w', '-p', String(port)], {
            onReady: async () => {
                expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).not.toContain('"review.md"');
                expect((await post(port, { page: 'Overview.md', comment: 'x' })).status).toBe(404);
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
        const res = await run(28326, [], agentEnv({ CLAUDECODE: '1' }));
        expect(res.out).toContain(
            'agent mode (claude-code): page feedback goes to "c4builder feedback --wait --as <name> -p 28326"'
        );
        // Лог фонового процесса (спека build-pipeline): подсказка — отдельной строкой, без `\r`-прогресса.
        expect(res.out).toMatch(/^agent mode \(claude-code\): /m);
        expect(res.out).not.toContain('\r');
        expect(res.html).toContain('var AGENT = { on: true');
        expect(res.post).toBe(200);
    }, 60_000);

    it('--no-agent при CLAUDECODE=1 — без подсказки и режима, эндпоинты feedback — 404', async () => {
        const res = await run(28327, ['--no-agent'], agentEnv({ CLAUDECODE: '1' }));
        expect(res.out).not.toContain('agent mode');
        expect(res.html).toContain('var AGENT = { on: false');
        expect(res.next).toBe(404);
        expect(res.post).toBe(404);
    }, 60_000);

    it('без переменных агента режим выключен, но страница уже со сниппетом', async () => {
        const res = await run(28328, [], agentEnv());
        expect(res.out).not.toContain('agent mode (');
        expect(res.html).toContain('var AGENT = { on: false');
    }, 60_000);
});

// Фолбэк на закешированный index.html (окно ребилда) — только для корня: ссылка на
// несуществующую папку должна давать 404, а не главную со статусом 200.
describe('неизвестные пути в site -w', () => {
    it('корень и реальный файл — 200, несуществующий каталог — 404', async () => {
        const port = 28329;
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

// `--open` — главная, `--open-change <id>` (change site-agent-review) — короткий адрес change'а;
// ключа нет в карте — предупреждение в stderr, адрес всё равно печатается.
describe('--open / --open-change <id> в site', () => {
    const env = agentEnv({ BROWSER: 'none' });
    it('неизвестный id — предупреждение в stderr, сервер работает; без переадресаций index.html прежний', async () => {
        const port = 28331;
        const out = await serve(['site', '-w', '-p', String(port), '--open-change', 'nope'], {
            env,
            onReady: async () => {
                expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
                const html = fs.readFileSync(path.join(dir, 'docs', 'index.html'), 'utf8');
                expect(html).not.toContain('c4builder-redirects');
                expect(html).not.toContain('"redirects"');
                expect(fs.existsSync(path.join(dir, 'docs', 'vendor', 'c4builder-redirects.js'))).toBe(false);
            }
        });
        expect(out).toContain(`go to http://localhost:${port}/#/change/nope`);
        expect(out).toContain('warning: the site has no page change/nope');
    }, 60_000);

    it("id change'а из плагина openspec — адрес #/change/<id> без предупреждения", async () => {
        const project = path.join(dir, 'openspec-project');
        fs.mkdirSync(path.join(project, 'src'), { recursive: true });
        fs.mkdirSync(path.join(project, 'openspec', 'changes', 'add-dark-mode'), { recursive: true });
        fs.writeFileSync(path.join(project, 'src', 'README.md'), '# root\n');
        fs.writeFileSync(
            path.join(project, 'openspec', 'changes', 'add-dark-mode', 'proposal.md'),
            '## Why\n\ndark\n'
        );
        fs.writeFileSync(
            path.join(project, '.c4builder'),
            JSON.stringify({ ...CONFIG, generateLocalImages: false, plugins: ['openspec'] })
        );
        const port = 28332;
        const out = await serveSite(
            project,
            ['site', '-w', '-p', String(port), '--open-change', 'add-dark-mode'],
            {
                env,
                onReady: async () => {
                    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
                    expect(html).toContain(
                        '"/change/add-dark-mode": "/OpenSpec/Changes/add-dark-mode/add-dark-mode"'
                    );
                    expect(html).toContain('<script src="vendor/c4builder-redirects.js"></script>');
                    expect(
                        (await fetch(`http://127.0.0.1:${port}/vendor/c4builder-redirects.js`)).status
                    ).toBe(200);
                }
            }
        );
        expect(out).toContain(`go to http://localhost:${port}/#/change/add-dark-mode`);
        expect(out).not.toContain('warning: the site has no page');
    }, 60_000);

    it('--open без значения — главная, как раньше', async () => {
        const port = 28333;
        // serveSite резолвится по строке «serving» — «go to» приходит следом, ждём её запросом.
        const out = await serve(['site', '-p', String(port), '--open'], {
            env,
            onReady: async () => {
                expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
            }
        });
        expect(out).toContain(`go to http://localhost:${port}\n`);
        expect(out).not.toContain('#/change/');
    }, 60_000);

    it('-o не забирает следующий аргумент: `-o site -wp <port>` поднимает сайт', async () => {
        const port = 28334;
        const out = await serve(['-o', 'site', '-wp', String(port)], {
            env,
            onReady: async () => {
                expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
            }
        });
        expect(out).toContain(`go to http://localhost:${port}\n`);
        expect(out).not.toContain('#/change/');
    }, 60_000);
});

// Эндпоинт состояния (change site-server-state, D5): во всех режимах, только для запросов команд CLI.
// Сервер — в процессе теста: pid в ответе — process.pid.
describe('GET /__c4builder/status', () => {
    const distDir = path.join(dir, 'status-dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body></body></html>');
    const FB = { 'X-C4builder-Feedback': '1' };
    const start = (port, watch) =>
        cmdSite(
            { DIST_FOLDER: distDir, WEB_PORT: String(port) },
            { port, watch, agent: { on: true, name: 'claude-code', explicit: false }, pollMs: 10_000 },
            new EventEmitter()
        );

    it('site -w: 200 с pid и слушателем foo для команды CLI, 403 со страницы', async () => {
        const port = 28430;
        const base = `http://127.0.0.1:${port}`;
        const server = await start(port, true);
        const poll = new AbortController();
        try {
            // long-poll слушателя foo висит, пока не прервём
            const waiting = fetch(`${base}/__c4builder/feedback/next?as=foo`, {
                headers: FB,
                signal: poll.signal
            }).catch(() => {});
            await new Promise((r) => setTimeout(r, 200));
            const res = await fetch(`${base}/__c4builder/status`, { headers: FB });
            expect(res.status).toBe(200);
            expect(await res.json()).toMatchObject({
                pid: process.pid,
                port,
                watch: true,
                agent: { on: true, name: 'claude-code' },
                listeners: [{ name: 'foo', state: 'listening', queued: 0 }],
                unaddressed: 0
            });
            const page = await fetch(`${base}/__c4builder/status`, { headers: { ...FB, Origin: base } });
            expect(page.status).toBe(403);
            expect((await fetch(`${base}/__c4builder/status`)).status).toBe(403);
            poll.abort();
            await waiting;
        } finally {
            poll.abort();
            await new Promise((r) => server.close(r));
        }
    });

    it('без -w — тот же ответ с пустыми списками и выключенным агентским режимом', async () => {
        const port = 28431;
        const server = await start(port, false);
        try {
            const res = await fetch(`http://127.0.0.1:${port}/__c4builder/status`, { headers: FB });
            expect(res.status).toBe(200);
            expect(await res.json()).toMatchObject({
                pid: process.pid,
                port,
                watch: false,
                agent: { on: false },
                listeners: [],
                unaddressed: 0
            });
        } finally {
            await new Promise((r) => server.close(r));
        }
    });
});

// Файл состояния и один сервер на конфиг (change site-server-state, D2, D3, D7) — настоящий процесс CLI:
// удаление проверяется по сигналам, а отказ второго сервера — до сборки.
describe('файл состояния site', () => {
    const life = path.join(dir, 'life');
    fs.mkdirSync(path.join(life, 'src'), { recursive: true });
    fs.writeFileSync(path.join(life, 'src', 'README.md'), '# root\n');
    fs.writeFileSync(path.join(life, '.c4builder'), JSON.stringify({ ...CONFIG, webPort: '28439' }));
    fs.writeFileSync(path.join(life, 'other.c4builder'), JSON.stringify({ ...CONFIG, webPort: '28439' }));
    const STATE = path.join(life, '.c4builder.server.json');
    const env = agentEnv({ BROWSER: 'none' });
    const launch = (args) => {
        const child = spawn(process.execPath, [CLI, ...args], { cwd: life, env });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal, out })));
        const serving = new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                if (!out.includes('serving your docsify site')) return;
                clearInterval(timer);
                resolve();
            }, 50);
            exited.then(() => {
                clearInterval(timer);
                reject(new Error(`процесс завершился вместо запуска сервера:\n${out}`));
            });
        });
        return { child, exited, serving };
    };
    const run = (args) =>
        new Promise((resolve) => {
            const child = spawn(process.execPath, [CLI, ...args], { cwd: life, env });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (d) => (stdout += d));
            child.stderr.on('data', (d) => (stderr += d));
            child.on('exit', (code) => resolve({ code, stdout, stderr }));
        });

    it.each([
        ['SIGINT', 28432],
        ['SIGTERM', 28433]
    ])(
        'файл с port/url/pid/watch после serving, удалён после %s',
        async (signal, port) => {
            const server = launch(['--site', '-w', '-p', String(port)]);
            try {
                await server.serving;
                expect(JSON.parse(fs.readFileSync(STATE, 'utf8'))).toMatchObject({
                    port,
                    url: `http://localhost:${port}`,
                    pid: server.child.pid,
                    watch: true
                });
            } finally {
                server.child.kill(signal);
            }
            const { code } = await server.exited;
            expect(code).toBe(signal === 'SIGINT' ? 130 : 143);
            expect(fs.existsSync(STATE)).toBe(false);
        },
        60_000
    );

    it('повторный запуск — код 1 без сборки, первый жив; --open-change — код 0; другой -c — второй сервер', async () => {
        const port = 28434;
        const first = launch(['site', '-w', '-p', String(port)]);
        try {
            await first.serving;
            const before = fs.readFileSync(STATE, 'utf8');
            const again = await run(['--site', '-w']);
            expect(again.code).toBe(1);
            expect(again.stderr).toContain(
                `c4builder site is already running for this project at http://localhost:${port} (pid ${first.child.pid})`
            );
            expect(again.stdout).not.toContain('built in');
            expect(fs.readFileSync(STATE, 'utf8')).toBe(before);
            const status = await fetch(`http://127.0.0.1:${port}/__c4builder/status`, {
                headers: { 'X-C4builder-Feedback': '1' }
            });
            expect((await status.json()).pid).toBe(first.child.pid);

            const open = await run(['site', '--open-change', 'nope']);
            expect(open.code, open.stderr).toBe(0);
            expect(open.stdout).toContain(`go to http://localhost:${port}/#/change/nope`);
            expect(open.stderr).toContain('warning: the site has no page change/nope');
            expect(open.stdout).not.toContain('built in');

            const other = launch(['--site', '-w', '-c', 'other.c4builder', '-p', String(port + 1)]);
            try {
                await other.serving;
                expect(
                    JSON.parse(fs.readFileSync(path.join(life, 'other.c4builder.server.json'), 'utf8'))
                ).toMatchObject({ port: port + 1, pid: other.child.pid });
            } finally {
                other.child.kill('SIGTERM');
                await other.exited;
            }
            expect(fs.existsSync(path.join(life, 'other.c4builder.server.json'))).toBe(false);
            expect(fs.readFileSync(STATE, 'utf8')).toBe(before);
        } finally {
            first.child.kill('SIGTERM');
            await first.exited;
        }
    }, 90_000);

    it('файл убитого процесса (SIGKILL) недействителен: следующий запуск перезаписывает его', async () => {
        const port = 28436;
        const killed = launch(['site', '-w', '-p', String(port)]);
        try {
            await killed.serving;
        } finally {
            killed.child.kill('SIGKILL');
        }
        await killed.exited;
        expect(JSON.parse(fs.readFileSync(STATE, 'utf8')).pid).toBe(killed.child.pid);
        const next = launch(['site', '-w', '-p', String(port + 1)]);
        try {
            await next.serving;
            expect(JSON.parse(fs.readFileSync(STATE, 'utf8'))).toMatchObject({
                port: port + 1,
                pid: next.child.pid
            });
        } finally {
            next.child.kill('SIGTERM');
            await next.exited;
        }
    }, 90_000);

    // D3: SIGHUP не перехватывается — под nohup сервер переживает закрытие терминала, как раньше. Без
    // nohup процесс гибнет от сигнала, файл остаётся и недействителен по pid.
    it('SIGHUP завершает сервер сигналом, без обработчика: файл остаётся', async () => {
        const server = launch(['site', '-w', '-p', '28440']);
        try {
            await server.serving;
        } finally {
            server.child.kill('SIGHUP');
        }
        const { code, signal } = await server.exited;
        expect({ code, signal }).toEqual({ code: null, signal: 'SIGHUP' });
        expect(JSON.parse(fs.readFileSync(STATE, 'utf8')).pid).toBe(server.child.pid);
        fs.rmSync(STATE);
    }, 60_000);

    // D7: просили -w (или --agent), а работающий сервер без него — не переиспользуем молча, даже с --open.
    it('работающий сервер без -w, повторный запуск с -w или --agent — код 1 и совет перезапустить с -w', async () => {
        const plain = launch(['site', '-p', '28441']);
        try {
            await plain.serving;
            for (const args of [
                ['--site', '-w'],
                ['site', '-w', '--open-change', 'nope'],
                ['site', '--agent', '--open']
            ]) {
                const res = await run(args);
                expect(res.code, args.join(' ')).toBe(1);
                expect(res.stderr).toContain(
                    `c4builder site is already running for this project at http://localhost:28441 (pid ${plain.child.pid}) without -w — stop that process and start c4builder site -w`
                );
                expect(res.stdout).not.toContain('go to');
            }
            // без -w — прежнее поведение: открыть работающий
            const open = await run(['site', '--open']);
            expect(open.code, open.stderr).toBe(0);
            expect(open.stdout).toContain('go to http://localhost:28441');
        } finally {
            plain.child.kill('SIGTERM');
            await plain.exited;
        }
    }, 90_000);
});
