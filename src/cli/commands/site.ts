import chalk from 'chalk';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import open from 'open';
import type { EventEmitter } from 'node:events';
import type { BuildOptions } from '../../config/options.ts';
import type { PageSources } from '../../core/compose/markdown.ts';
import { batchSchema, type FeedbackBatch, formatBatch } from '../../core/feedback.ts';
import { deleteQuestion, formatQuestion, pickSource, writeQuestion } from '../../core/questions.ts';
import { packageJson as pkg } from '../../util/paths.ts';
import type { AgentMode } from '../agent.ts';
import { pendingUpdate } from '../update.ts';
import { COMMENTS_PATH, commentsSnippet, FEEDBACK_HEADER, FEEDBACK_PATH } from './site.comments.ts';

const COMMENT_MAX = 2000;

const LIVERELOAD_PATH = '/__livereload';
// Восстановление скролла после reload: docsify рендерит контент асинхронно после fetch md,
// высота страницы доступна не сразу — поллим до достижения нужной y или таймаута.
// Комментарии держим здесь, а не в сниппете: он уходит в браузер пользователя.
// События агента (design D4) идут по тому же потоку и пересылаются сниппету комментариев
// DOM-событиями `c4builder:*` — второй EventSource странице не нужен.
const LIVERELOAD_SNIPPET = `
<script>
(function () {
    if (window.__c4builderLiveReload) return;
    window.__c4builderLiveReload = true;
    var KEY = '__c4builderScroll';
    try {
        var saved = sessionStorage.getItem(KEY);
        if (saved) {
            sessionStorage.removeItem(KEY);
            var data = JSON.parse(saved);
            if (data && data.hash === location.hash && typeof data.y === 'number') {
                var deadline = Date.now() + 2000;
                var tryRestore = function () {
                    var maxScroll = document.documentElement.scrollHeight - window.innerHeight;
                    if (maxScroll >= data.y || Date.now() >= deadline) {
                        window.scrollTo(0, Math.min(data.y, Math.max(maxScroll, 0)));
                        return;
                    }
                    requestAnimationFrame(tryRestore);
                };
                requestAnimationFrame(tryRestore);
            }
        }
    } catch (e) {}
    var delay = 1000;
    var connect = function () {
        var es = new EventSource('${LIVERELOAD_PATH}');
        es.onopen = function () { delay = 1000; };
        es.addEventListener('reload', function () {
            try {
                sessionStorage.setItem(KEY, JSON.stringify({ y: window.scrollY, hash: location.hash }));
            } catch (e) {}
            es.close();
            location.reload();
        });
        ['agent', 'delivered'].forEach(function (name) {
            es.addEventListener(name, function (e) {
                try {
                    window.dispatchEvent(new CustomEvent('c4builder:' + name, { detail: JSON.parse(e.data) }));
                } catch (err) {}
            });
        });
        es.onerror = function () {
            es.close();
            setTimeout(connect, delay);
            delay = Math.min(delay * 2, 30000);
        };
    };
    connect();
})();
</script>`;

// Плашка о новой версии — только в отдаче dev-сервера, в dist не попадает. Флаг закрытия — в
// sessionStorage: переживает reload ребилдом и живёт до закрытия вкладки.
const updateBanner = (next: string): string => `
<div id="c4builder-update" style="position:fixed;right:16px;bottom:16px;z-index:1000;max-width:360px;padding:10px 36px 10px 14px;border:1px solid #e0c060;border-radius:6px;background:#fff8dc;color:#333;font:14px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.15)">
c4builder ${next} is available (current ${pkg.version}). Run: <code>c4builder update</code>
<button type="button" aria-label="Close" style="position:absolute;top:4px;right:8px;border:0;background:none;color:inherit;font-size:18px;line-height:1;cursor:pointer">&times;</button>
</div>
<script>
(function () {
    var KEY = '__c4builderUpdateClosed';
    var el = document.getElementById('c4builder-update');
    try {
        if (sessionStorage.getItem(KEY)) return el.remove();
    } catch (e) {}
    el.querySelector('button').onclick = function () {
        el.remove();
        try {
            sessionStorage.setItem(KEY, '1');
        } catch (e) {}
    };
})();
</script>`;

export default (
    currentConfiguration: BuildOptions,
    program: {
        port?: number;
        watch?: boolean;
        open?: boolean;
        agent?: AgentMode;
        // Окна long-poll (design D1) и пульса присутствия слушателя (D4) — параметры для тестов.
        pollMs?: number;
        idleMs?: number;
    },
    reloadEmitter?: EventEmitter,
    // Карта «страница → исходники» текущей сборки — геттером, чтобы видеть результат ребилдов watch.
    pages: () => PageSources = () => new Map()
) => {
    if (!currentConfiguration.DIST_FOLDER) return console.log(chalk.red('No destination folder configured'));

    const app = express();
    const port = program.port || currentConfiguration.WEB_PORT;
    const distFolder = path.resolve(currentConfiguration.DIST_FOLDER);
    const liveReloadEnabled = !!(program.watch && reloadEmitter);
    const agent: AgentMode = { ...(program.agent ?? { on: false, name: '', explicit: false }) };

    // Кеш index.html — отдаём его из памяти, если на диске его временно нет
    // (в окне build.js → emptyDir(DIST_FOLDER) перед записью).
    let lastIndexHtml: string | null = null;

    // reloadEmitter в условии — сужает тип до EventEmitter внутри блока (liveReloadEnabled
    // истинно ⟺ reloadEmitter задан), поэтому дальше без non-null assertions.
    if (liveReloadEnabled && reloadEmitter) {
        // Состояние слушателя `c4builder feedback` (design D4): подключён, пока открыт long-poll
        // или с конца последнего прошло меньше idleMs — зазор между повторами команды.
        let listening = false;
        const agentState = () => ({ on: agent.on, listening });
        const setAgent = (on: boolean, listen: boolean): void => {
            if (on === agent.on && listen === listening) return;
            agent.on = on;
            listening = listen;
            reloadEmitter.emit('agent', agentState());
        };

        app.get(LIVERELOAD_PATH, (req, res) => {
            res.set({
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no'
            });
            res.flushHeaders();
            res.write('retry: 1000\n\n');

            const onReload = () => res.write('event: reload\ndata: {}\n\n');
            const onAgent = (data: unknown) => res.write(`event: agent\ndata: ${JSON.stringify(data)}\n\n`);
            const onDelivered = (data: unknown) =>
                res.write(`event: delivered\ndata: ${JSON.stringify(data)}\n\n`);
            const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

            reloadEmitter.on('reload', onReload); // liveReloadEnabled ⇒ reloadEmitter задан
            reloadEmitter.on('agent', onAgent);
            reloadEmitter.on('delivered', onDelivered);
            onAgent(agentState());
            console.log(
                chalk.gray(`livereload: client connected (${reloadEmitter.listenerCount('reload')} total)`)
            );

            req.on('close', () => {
                clearInterval(heartbeat);
                reloadEmitter.off('reload', onReload);
                reloadEmitter.off('agent', onAgent);
                reloadEmitter.off('delivered', onDelivered);
                console.log(
                    chalk.gray(
                        `livereload: client disconnected (${reloadEmitter.listenerCount('reload')} left)`
                    )
                );
            });
        });

        // Ключ черновиков review в localStorage (design D5): страницы разных проектов на одном
        // localhost:<port> не должны видеть чужой черновик.
        const projectKey = createHash('sha1').update(process.cwd()).digest('hex').slice(0, 8);
        // Кэш проверки обновлений читается на каждую страницу: результат фоновой проверки,
        // запущенной этим же `site -w`, виден со следующей перезагрузки без рестарта сервера.
        const inject = (html: string): string => {
            const next = pendingUpdate();
            const snippet =
                LIVERELOAD_SNIPPET +
                commentsSnippet(currentConfiguration.QUESTIONS_HEADING, {
                    agent: agent.on,
                    listening,
                    project: projectKey
                }) +
                (next ? updateBanner(next) : '');
            if (html.includes('</body>')) return html.replace('</body>', `${snippet}</body>`);
            return html + snippet;
        };

        // Комментарий к выделенному тексту → раздел вопросов исходного файла страницы
        // (change site-comments, design D3). Сервер слушает только 127.0.0.1, но страница
        // любого сайта в браузере может слать POST на localhost — требуем Origin самого сайта.
        const str = (v: unknown): string => (typeof v === 'string' ? v : '');
        const heading = currentConfiguration.QUESTIONS_HEADING;
        // Host — только локальный: при DNS rebinding чужой домен резолвится в 127.0.0.1 и
        // присылает согласованные Host и Origin, сверка Origin с одним Host это пропускает.
        const localHost = (req: express.Request): string | undefined => {
            const host = req.get('host');
            const local = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
            return host && local.includes(host) ? host : undefined;
        };
        const fromSite = (req: express.Request): boolean => {
            const host = localHost(req);
            return !!host && req.get('origin') === `http://${host}`;
        };
        // Общая часть POST/DELETE: проверка Origin и исходный файл страницы из тела запроса.
        // Ошибка уже отправлена клиенту, когда возвращается undefined.
        const resolveTarget = (
            req: express.Request,
            res: express.Response
        ): { file: string; rel: string; body: Record<string, unknown> } | undefined => {
            if (!fromSite(req)) {
                res.status(403).json({ error: 'comments are accepted only from the site itself' });
                return undefined;
            }
            const body = (req.body ?? {}) as Record<string, unknown>;
            const page = path.posix.normalize(str(body.page).replace(/^\/+/, ''));
            const sources = page.startsWith('..') ? undefined : pages().get(page);
            if (!sources) {
                res.status(404).json({ error: `unknown page: ${page}` });
                return undefined;
            }
            const cwd = process.cwd();
            const file = pickSource(
                sources.filter((s) => s.startsWith(cwd + path.sep)),
                heading
            );
            if (!file) {
                res.status(404).json({ error: 'this page has no source file to write to' });
                return undefined;
            }
            return { file, rel: path.relative(cwd, file).split(path.sep).join('/'), body };
        };

        app.post(COMMENTS_PATH, express.json({ limit: '64kb' }), (req, res) => {
            const target = resolveTarget(req, res);
            if (!target) return;
            const { file, rel, body } = target;
            const comment = str(body.comment).trim();
            const quote = str(body.quote);
            const section = str(body.section);
            if (!comment) {
                res.status(400).json({ error: 'comment is empty' });
                return;
            }
            if (comment.length > COMMENT_MAX || quote.length > COMMENT_MAX) {
                res.status(400).json({
                    error: `comment and quote must be at most ${COMMENT_MAX} characters`
                });
                return;
            }
            try {
                const number = writeQuestion(file, heading, formatQuestion({ comment, quote, section }));
                console.log(chalk.gray(`comment added to ${rel}${number ? ` as #${number}` : ''}`));
                res.json({ file: rel, number });
            } catch (e) {
                res.status(500).json({ error: `could not write the comment: ${(e as Error).message}` });
            }
        });

        // Удаление вопроса: по номеру (числовая таблица) и тексту, как он виден на странице.
        app.delete(COMMENTS_PATH, express.json({ limit: '64kb' }), (req, res) => {
            const target = resolveTarget(req, res);
            if (!target) return;
            const { file, rel, body } = target;
            const text = str(body.text).trim();
            if (!text) {
                res.status(400).json({ error: 'question text is empty' });
                return;
            }
            const number = typeof body.number === 'number' ? body.number : Number(str(body.number)) || null;
            try {
                const result = deleteQuestion(file, heading, { number, text });
                if ('error' in result) {
                    const messages = {
                        'not-found': `question not found in ${rel} — the page may be stale, reload it`,
                        ambiguous: `several identical questions in ${rel} — remove it by hand`
                    };
                    res.status(result.error === 'not-found' ? 404 : 409).json({
                        error: messages[result.error]
                    });
                    return;
                }
                console.log(chalk.gray(`comment removed from ${rel}`));
                res.json({ file: rel });
            } catch (e) {
                res.status(500).json({ error: `could not remove the comment: ${(e as Error).message}` });
            }
        });

        // Замечания агенту (change site-agent-feedback): FIFO пачек в памяти (design D3), страница
        // шлёт POST, `c4builder feedback` забирает long-poll'ом (D1). Пачка снимается с очереди,
        // когда ответ записан; обрыв до этого возвращает её в голову очереди.
        const { pollMs = 25_000, idleMs = 30_000 } = program;
        const queue: { id: string; batch: FeedbackBatch }[] = [];
        const waiters: express.Response[] = [];
        let polls = 0;
        let idleTimer: NodeJS.Timeout | undefined;
        const disabled = (): boolean => agent.explicit && !agent.on;
        const drop = (res: express.Response): void => {
            const i = waiters.indexOf(res);
            if (i >= 0) waiters.splice(i, 1);
        };
        const pump = (): void => {
            while (queue.length && waiters.length) {
                const res = waiters.shift();
                const item = queue.shift();
                if (res && item) deliver(res, item);
            }
        };
        const deliver = (res: express.Response, item: { id: string; batch: FeedbackBatch }): void => {
            res.on('close', () => {
                if (!res.writableFinished) {
                    queue.unshift(item);
                    pump();
                    return;
                }
                console.log(chalk.gray(`feedback: batch delivered to the agent (${item.batch.decision})`));
                reloadEmitter.emit('delivered', { id: item.id });
            });
            res.type('text/markdown').send(formatBatch(item.batch, pages(), process.cwd()));
        };

        app.post(FEEDBACK_PATH, express.json({ limit: '4mb' }), (req, res) => {
            if (!fromSite(req)) {
                res.status(403).json({ error: 'feedback is accepted only from the site itself' });
                return;
            }
            if (disabled()) {
                res.status(404).json({ error: 'agent feedback is disabled (--no-agent)' });
                return;
            }
            const parsed = batchSchema.safeParse(req.body);
            if (!parsed.success) {
                const issue = parsed.error.issues[0];
                res.status(400).json({
                    error: `invalid feedback: ${issue?.path.join('.')} ${issue?.message}`
                });
                return;
            }
            const batch = parsed.data;
            if (batch.decision === 'submitted' && !batch.comments.length && !batch.general) {
                res.status(400).json({ error: 'nothing to send' });
                return;
            }
            const id = randomUUID();
            const queued = !waiters.length;
            queue.push({ id, batch });
            pump();
            console.log(
                chalk.gray(
                    `feedback: ${batch.decision}, ${batch.comments.length} comment(s)${queued ? ' — queued, no agent listening' : ''}`
                )
            );
            res.json({ id, queued });
        });

        // Нестандартный заголовок вынуждает браузер к preflight, на который сервер не отвечает:
        // чужая страница не может ни прочитать, ни «съесть» очередь простым запросом (design D6).
        app.get(`${FEEDBACK_PATH}/next`, (req, res) => {
            if (!localHost(req) || req.get('origin') || req.get(FEEDBACK_HEADER) !== '1') {
                res.status(403).json({ error: 'feedback is served only to the c4builder feedback command' });
                return;
            }
            if (disabled()) {
                res.status(404).json({ error: 'agent feedback is disabled (--no-agent)' });
                return;
            }
            if (!agent.on) console.log(chalk.gray('agent mode on: "c4builder feedback" connected'));
            polls++;
            clearTimeout(idleTimer);
            setAgent(true, true);
            let timer: NodeJS.Timeout | undefined;
            res.on('close', () => {
                clearTimeout(timer);
                drop(res);
                if (--polls === 0) idleTimer = setTimeout(() => setAgent(agent.on, false), idleMs);
            });
            waiters.push(res);
            pump();
            if (!waiters.includes(res)) return;
            timer = setTimeout(
                () => {
                    // Пачку успели отдать этому запросу — ответ уже пишется, 204 не нужен.
                    if (!waiters.includes(res)) return;
                    drop(res);
                    res.status(204).end();
                },
                req.query.wait === '0' ? 0 : pollMs
            );
        });

        app.use((req, res, next) => {
            if (req.method !== 'GET') return next();
            let urlPath: string;
            try {
                urlPath = decodeURIComponent(req.path);
            } catch (_e) {
                return next();
            }
            let filePath: string;
            const isIndex = urlPath.endsWith('/');
            if (isIndex) {
                filePath = path.join(distFolder, urlPath, 'index.html');
            } else if (/\.html?$/.test(urlPath)) {
                filePath = path.join(distFolder, urlPath);
            } else {
                return next();
            }
            const resolved = path.resolve(filePath);
            if (resolved !== distFolder && !resolved.startsWith(distFolder + path.sep)) return next();

            fs.readFile(resolved, 'utf8', (err, data) => {
                if (err) {
                    // ENOENT в окне ребилда (emptyDir → запись) — отдаём последний известный index.html.
                    if (isIndex && lastIndexHtml) {
                        res.set('Cache-Control', 'no-store').type('html').send(lastIndexHtml);
                        return;
                    }
                    return next();
                }
                const page = inject(data);
                if (isIndex) lastIndexHtml = page;
                res.set('Cache-Control', 'no-store').type('html').send(page);
            });
        });
    }

    // express 5 / path-to-regexp v8 запрещает голый '/*' как путь маршрута — раздаём
    // статику через app.use (тот же эффект: fallthrough-обработчик всех GET).
    app.use(express.static(distFolder));

    return new Promise((resolve, reject) => {
        const server = app.listen(port as number, '127.0.0.1', () => {
            const url = `http://localhost:${port}`;
            console.log('serving your docsify site');
            console.log(`go to ${chalk.green(url)}`);
            if (liveReloadEnabled)
                console.log(chalk.gray('livereload enabled (browser auto-reload on rebuild)'));
            if (liveReloadEnabled && agent.on)
                console.log(
                    `agent mode (${agent.name}): page feedback goes to "c4builder feedback --wait${program.port ? ` -p ${port}` : ''}" — run it in the background and again after each batch`
                );
            // --open: открываем браузер один раз при старте; BROWSER=none отключает (CI/headless)
            if (program.open && process.env.BROWSER !== 'none')
                open(url).catch(() => console.log(chalk.gray('could not open the browser automatically')));
            resolve(server);
        });
        server.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                console.log(
                    chalk.red(`port ${port} is already in use — pass a different one with -p <port>`)
                );
            } else {
                console.log(chalk.red(`server error: ${err.message}`));
            }
            reject(err);
        });
    });
};
