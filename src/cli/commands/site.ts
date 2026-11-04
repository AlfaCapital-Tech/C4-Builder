import chalk from 'chalk';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import open from 'open';
import type { EventEmitter } from 'node:events';
import type { BuildOptions } from '../../config/options.ts';
import type { BuildResult } from '../../core/build.ts';
import type { PageSources } from '../../core/compose/markdown.ts';
import { batchSchema, type FeedbackBatch, formatBatch, LISTENER_NAME } from '../../core/feedback.ts';
import { redirectKey } from '../../core/plugins/tree.ts';
import { deleteQuestion, formatQuestion, pickSource, writeQuestion } from '../../core/questions.ts';
import {
    deleteRemark,
    findReviewFile,
    isReviewFile,
    parseRemarks,
    writeRemark
} from '../../core/reviewlog.ts';
import { packageJson as pkg } from '../../util/paths.ts';
import type { AgentMode } from '../agent.ts';
import { pendingUpdate } from '../update.ts';
import {
    COMMENTS_PATH,
    commentsSnippet,
    FEEDBACK_HEADER,
    FEEDBACK_PATH,
    type MailboxState,
    PAGE_PATH,
    REVIEW_LOG_PATH
} from './site.comments.ts';

const COMMENT_MAX = 2000;

type Item = { id: string; batch: FeedbackBatch };
type Mailbox = {
    queue: Item[];
    waiters: express.Response[];
    polls: number;
    listening: boolean;
    lastSeen: number;
    idle?: NodeJS.Timeout;
};

const LIVERELOAD_PATH = '/__livereload';
// Сигнал «читатель открыл страницу» для приоритета фонового рендера (change site-warm-start).
const OPEN_PATH = '/__c4builder/open';
// Восстановление скролла после reload: docsify рендерит контент асинхронно после fetch md,
// высота страницы доступна не сразу — поллим до достижения нужной y или таймаута.
// Комментарии держим здесь, а не в сниппете: он уходит в браузер пользователя.
// События агента (design D4) идут по тому же потоку и пересылаются сниппету комментариев
// DOM-событиями `c4builder:*` — второй EventSource странице не нужен.
// Событие `image` (change site-warm-start): диаграмма дорисована в фоне — у совпавших по
// пути <img> меняем src на тот же путь с `?v=<ts>`, без перезагрузки и потери прокрутки.
// Сравниваем декодированные pathname: docsify резолвит src относительно страницы и кодирует
// пробелы, а сервер шлёт сырой путь относительно dist. Готовые пути запоминаем: docsify при
// возврате на страницу рисует <img> заново без `?v`, и браузер взял бы из кэша заглушку —
// поэтому в doneEach версия проставляется снова.
// Приоритет очереди — по сигналу навигации docsify (beforeEach), а не по любому GET *.md:
// поиск docsify после первой отрисовки запрашивает .md всех страниц sidebar и перебивал бы
// открытую, которую сам docsify повторно не запрашивает (берёт из кэша).
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
    var ready = {};
    var refreshImages = function () {
        var imgs = document.querySelectorAll('img[src]');
        for (var i = 0; i < imgs.length; i++) {
            var url, v;
            try {
                url = new URL(imgs[i].getAttribute('src'), location.href);
                v = url.origin === location.origin && ready[decodeURIComponent(url.pathname)];
            } catch (err) { continue; }
            if (!v || url.search === '?v=' + v) continue;
            url.search = 'v=' + v;
            imgs[i].setAttribute('src', url.pathname + url.search);
        }
    };
    if (window.$docsify) {
        window.$docsify.plugins = [].concat(window.$docsify.plugins || [], function (hook, vm) {
            hook.beforeEach(function (content) {
                var file = vm && vm.route && vm.route.file;
                if (typeof file === 'string' && file && window.fetch) {
                    fetch('${OPEN_PATH}', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ page: file })
                    }).catch(function () {});
                }
                return content;
            });
            hook.doneEach(refreshImages);
        });
    }
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
        es.addEventListener('image', function (e) {
            try {
                ready['/' + JSON.parse(e.data).path] = Date.now();
                refreshImages();
            } catch (err) {}
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

// Только подсказка для ошибки «порт занят»: сам сервер на найденный порт не переходит —
// feedback, --open-change и скиллы берут порт из -p/webPort (change site-port-busy-hint).
// Гонка до перезапуска не важна: занят снова — будет новая подсказка.
const freePortAfter = async (port: number, tries = 10): Promise<number | undefined> => {
    for (let p = port + 1; p <= Math.min(port + tries, 65535); p++) {
        const free = await new Promise<boolean>((resolve) => {
            const probe = net.createServer();
            probe.once('error', () => resolve(false));
            probe.listen(p, '127.0.0.1', () => probe.close(() => resolve(true)));
        });
        if (free) return p;
    }
};

export default (
    currentConfiguration: BuildOptions,
    program: {
        port?: number;
        watch?: boolean;
        // `--open` — главная; `--open-change <id>` — короткий адрес `#/change/<id>` (change site-agent-review).
        open?: boolean;
        openChange?: string;
        agent?: AgentMode;
        // Окна long-poll (design D1), пульса присутствия слушателя (D4) и жизни пустого ящика
        // (change feedback-mailboxes, D3) — параметры для тестов.
        pollMs?: number;
        idleMs?: number;
        mailboxTtlMs?: number;
    },
    reloadEmitter?: EventEmitter,
    // Итог текущей сборки (страницы → исходники, переадресации) — геттером, чтобы видеть
    // результат ребилдов watch.
    result: () => BuildResult = () => ({ pages: new Map(), redirects: new Map() }),
    // Фоновый рендер холодного старта (change site-warm-start): запрос `.md` страницы поднимает
    // её диаграммы в голову очереди. Замыкание, а не очередь: она есть только у первой сборки.
    prioritize?: (pageMd: string) => void
) => {
    if (!currentConfiguration.DIST_FOLDER) return console.log(chalk.red('No destination folder configured'));
    const pages = (): PageSources => result().pages;

    const app = express();
    const port = program.port || currentConfiguration.WEB_PORT;
    const distFolder = path.resolve(currentConfiguration.DIST_FOLDER);
    const liveReloadEnabled = !!(program.watch && reloadEmitter);
    const agent: AgentMode = { ...(program.agent ?? { on: false, name: '', explicit: false }) };

    // Кеш корневого index.html — отдаём его из памяти, если на диске его временно нет
    // (в окне build.js → emptyDir(DIST_FOLDER) перед записью).
    let lastIndexHtml: string | null = null;
    let sweeper: NodeJS.Timeout | undefined;

    // reloadEmitter в условии — сужает тип до EventEmitter внутри блока (liveReloadEnabled
    // истинно ⟺ reloadEmitter задан), поэтому дальше без non-null assertions.
    if (liveReloadEnabled && reloadEmitter) {
        // Ящики слушателей `c4builder feedback --as <name>` (change feedback-mailboxes, D3–D4).
        // Слушает, пока открыт long-poll или с конца последнего прошло меньше idleMs — зазор между
        // повторами команды. Пачки без адресата (ящиков ещё не было) достаются любому имени.
        const { pollMs = 25_000, idleMs = 30_000, mailboxTtlMs = 30 * 60_000 } = program;
        const mailboxes = new Map<string, Mailbox>();
        const unaddressed: Item[] = [];
        const box = (name: string): Mailbox => {
            const b = mailboxes.get(name) ?? {
                queue: [],
                waiters: [],
                polls: 0,
                listening: false,
                lastSeen: Date.now()
            };
            mailboxes.set(name, b);
            return b;
        };
        const agentState = () => ({
            on: agent.on,
            mailboxes: [...mailboxes].map(
                ([name, b]): MailboxState => ({
                    name,
                    state: b.listening ? 'listening' : 'reconnecting',
                    queued: b.queue.length
                })
            )
        });
        // Событие — только когда снимок изменился: publish зовётся после любой смены очередей.
        let published = JSON.stringify(agentState());
        const publish = (): void => {
            const state = agentState();
            const json = JSON.stringify(state);
            if (json === published) return;
            published = json;
            reloadEmitter.emit('agent', state);
        };
        sweeper = setInterval(
            () => {
                for (const [name, b] of mailboxes)
                    if (!b.polls && !b.queue.length && Date.now() - b.lastSeen >= mailboxTtlMs)
                        mailboxes.delete(name);
                publish();
            },
            Math.min(mailboxTtlMs, 60_000)
        ).unref();

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
            const onImage = (data: unknown) => res.write(`event: image\ndata: ${JSON.stringify(data)}\n\n`);
            const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

            reloadEmitter.on('reload', onReload); // liveReloadEnabled ⇒ reloadEmitter задан
            reloadEmitter.on('agent', onAgent);
            reloadEmitter.on('delivered', onDelivered);
            reloadEmitter.on('image', onImage);
            onAgent(agentState());
            console.log(
                chalk.gray(`livereload: client connected (${reloadEmitter.listenerCount('reload')} total)`)
            );

            req.on('close', () => {
                clearInterval(heartbeat);
                reloadEmitter.off('reload', onReload);
                reloadEmitter.off('agent', onAgent);
                reloadEmitter.off('delivered', onDelivered);
                reloadEmitter.off('image', onImage);
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
        const reviewLog = currentConfiguration.REVIEW_LOG;
        const questions = currentConfiguration.QUESTIONS;
        // Кэш проверки обновлений читается на каждую страницу: результат фоновой проверки,
        // запущенной этим же `site -w`, виден со следующей перезагрузки без рестарта сервера.
        const inject = (html: string): string => {
            const next = pendingUpdate();
            const snippet =
                LIVERELOAD_SNIPPET +
                commentsSnippet(currentConfiguration.QUESTIONS_HEADING, {
                    questions,
                    agent: agent.on,
                    mailboxes: agentState().mailboxes,
                    project: projectKey,
                    language: currentConfiguration.UI_LANGUAGE,
                    reviewLog: reviewLog && {
                        file: reviewLog.file,
                        heading: reviewLog.heading,
                        label: reviewLog.label
                    }
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
        // Запрос команды `c4builder feedback`, а не страницы: нестандартный заголовок вынуждает
        // браузер к preflight, на который сервер не отвечает (design D6), Origin у неё нет.
        const fromFeedbackCommand = (req: express.Request): boolean =>
            !!localHost(req) && !req.get('origin') && req.get(FEEDBACK_HEADER) === '1';
        // Общая часть POST/DELETE: проверка Origin и исходный файл страницы из тела запроса.
        // Ошибка уже отправлена клиенту, когда возвращается undefined.
        // Страница сайта из тела/запроса → её исходники внутри проекта (путь нормализован, `..` и
        // неизвестная страница — undefined). Общее для вопросов и журнала ревью.
        const cwd = process.cwd();
        const relOf = (file: string): string => path.relative(cwd, file).split(path.sep).join('/');
        const localSources = (raw: string): { page: string; sources: string[] } | undefined => {
            const page = path.posix.normalize(raw.replace(/^\/+/, ''));
            const sources = page.startsWith('..') ? undefined : pages().get(page);
            return sources && { page, sources: sources.filter((s) => s.startsWith(cwd + path.sep)) };
        };
        const resolveTarget = (
            req: express.Request,
            res: express.Response,
            heading: string
        ): { file: string; rel: string; body: Record<string, unknown> } | undefined => {
            if (!fromSite(req)) {
                res.status(403).json({ error: 'comments are accepted only from the site itself' });
                return undefined;
            }
            const body = (req.body ?? {}) as Record<string, unknown>;
            const found = localSources(str(body.page));
            if (!found) {
                res.status(404).json({ error: `unknown page: ${str(body.page)}` });
                return undefined;
            }
            const file = pickSource(found.sources, heading);
            if (!file) {
                res.status(404).json({ error: 'this page has no source file to write to' });
                return undefined;
            }
            return { file, rel: relOf(file), body };
        };
        // Тело комментария: текст, цитата и раздел; ошибка уже отправлена, когда undefined.
        const commentBody = (
            body: Record<string, unknown>,
            res: express.Response
        ): { comment: string; quote: string; section: string } | undefined => {
            const comment = str(body.comment).trim();
            const quote = str(body.quote);
            const section = str(body.section);
            if (!comment) {
                res.status(400).json({ error: 'comment is empty' });
                return undefined;
            }
            if (comment.length > COMMENT_MAX || quote.length > COMMENT_MAX) {
                res.status(400).json({
                    error: `comment and quote must be at most ${COMMENT_MAX} characters`
                });
                return undefined;
            }
            return { comment, quote, section };
        };

        // `questions: false` — маршрутов нет, как и кнопки.
        if (questions)
            app.post(COMMENTS_PATH, express.json({ limit: '64kb' }), (req, res) => {
                const target = resolveTarget(req, res, heading);
                if (!target) return;
                const { file, rel, body } = target;
                const parsed = commentBody(body, res);
                if (!parsed) return;
                const { comment, quote, section } = parsed;
                try {
                    const number = writeQuestion(file, heading, formatQuestion({ comment, quote, section }));
                    console.log(chalk.gray(`comment added to ${rel}${number ? ` as #${number}` : ''}`));
                    res.json({ file: rel, number });
                } catch (e) {
                    res.status(500).json({ error: `could not write the comment: ${(e as Error).message}` });
                }
            });

        // Удаление вопроса: по номеру (числовая таблица) и тексту, как он виден на странице.
        if (questions)
            app.delete(COMMENTS_PATH, express.json({ limit: '64kb' }), (req, res) => {
                const target = resolveTarget(req, res, heading);
                if (!target) return;
                const { file, rel, body } = target;
                const text = str(body.text).trim();
                if (!text) {
                    res.status(400).json({ error: 'question text is empty' });
                    return;
                }
                const number =
                    typeof body.number === 'number' ? body.number : Number(str(body.number)) || null;
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

        // Замечание в журнал ревью (change site-review-log): файл — ближайший `reviewLog.file` от
        // исходника страницы вверх до корня проекта; автор — из конфига либо git user.name того,
        // кто запустил `site -w` (журнал правится на машине ревьюера).
        if (reviewLog) {
            const gitUser = (): string => {
                const r = spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' });
                return r.status === 0 ? r.stdout.trim() : '';
            };
            // `author: ""` в конфиге (как в примере документации) — не задан, а не пустой автор.
            const author = reviewLog.author || gitUser();
            app.post(REVIEW_LOG_PATH, express.json({ limit: '64kb' }), (req, res) => {
                // Исходник страницы — тот же, что у вопроса: заголовок журнала в исходниках не ищем.
                const target = resolveTarget(req, res, heading);
                if (!target) return;
                const { file: source, body } = target;
                const parsed = commentBody(body, res);
                if (!parsed) return;
                const file = findReviewFile(path.dirname(source), reviewLog.file, cwd);
                if (!file) {
                    res.status(404).json({
                        error: `${reviewLog.file} not found next to ${target.rel} or above it`
                    });
                    return;
                }
                const rel = relOf(file);
                try {
                    const number = writeRemark(file, reviewLog, { ...parsed, source, author });
                    console.log(chalk.gray(`remark added to ${rel}${number ? ` as #${number}` : ''}`));
                    res.json({ file: rel, number });
                } catch (e) {
                    res.status(500).json({ error: `could not write the remark: ${(e as Error).message}` });
                }
            });
            // Страница сайта, исходник которой — файл журнала (ссылка с подсвеченной цитаты на строку).
            const pageOf = (file: string): string | undefined => {
                for (const [page, sources] of pages()) if (sources.includes(file)) return page;
                return undefined;
            };
            // Исходник страницы, если она — сам журнал (сниппет общий для всех страниц, страница
            // спрашивает это перед тем, как показать кнопки удаления у строк раздела).
            const ownLog = (sources: string[]): string | undefined =>
                sources.find((s) => isReviewFile(s, reviewLog.file, cwd));
            // Same-origin GET браузер шлёт без Origin — требуем лишь локальный Host и отвергаем чужой
            // Origin: это чтение, ответ (путь файла) чужой странице всё равно не отдаётся без CORS.
            // Страница журнала → `{ file, log: true }`; другая страница → её замечания из журнала
            // `{ file, log: false, logPage, remarks }` для подсветки цитат; журнала нет — 404.
            app.get(REVIEW_LOG_PATH, (req, res) => {
                if (!localHost(req) || (req.get('origin') && !fromSite(req))) {
                    res.status(403).json({ error: 'comments are accepted only from the site itself' });
                    return;
                }
                const found = localSources(str(req.query.page));
                const own = found && ownLog(found.sources);
                if (own) {
                    res.json({ file: relOf(own), log: true });
                    return;
                }
                const source = found && pickSource(found.sources, heading);
                const file = source && findReviewFile(path.dirname(source), reviewLog.file, cwd);
                if (!source || !file) {
                    res.status(404).json({
                        error: `${reviewLog.file} not found for page ${str(req.query.page)}`
                    });
                    return;
                }
                try {
                    res.json({
                        file: relOf(file),
                        log: false,
                        logPage: pageOf(file) ?? null,
                        remarks: parseRemarks(file, reviewLog, source)
                    });
                } catch (e) {
                    res.status(500).json({ error: `could not read the review log: ${(e as Error).message}` });
                }
            });
            // Удаление строки журнала — как у вопроса: номер и текст ячейки, видимой на странице, плюс
            // все ячейки строки (таблицы без номеров: одна ячейка бывает общей у нескольких строк).
            app.delete(REVIEW_LOG_PATH, express.json({ limit: '64kb' }), (req, res) => {
                if (!fromSite(req)) {
                    res.status(403).json({ error: 'comments are accepted only from the site itself' });
                    return;
                }
                const body = (req.body ?? {}) as Record<string, unknown>;
                const found = localSources(str(body.page));
                const file = found && ownLog(found.sources);
                if (!file) {
                    res.status(404).json({ error: `page ${str(body.page)} is not the review log` });
                    return;
                }
                const rel = relOf(file);
                const text = str(body.text).trim();
                if (!text) {
                    res.status(400).json({ error: 'remark text is empty' });
                    return;
                }
                const number =
                    typeof body.number === 'number' ? body.number : Number(str(body.number)) || null;
                const cells = Array.isArray(body.cells) ? body.cells.map(str) : undefined;
                try {
                    const result = deleteRemark(file, reviewLog.heading, { number, text }, cells);
                    if ('error' in result) {
                        const messages = {
                            'not-found': `remark not found in ${rel} — the page may be stale, reload it`,
                            ambiguous: `several identical remarks in ${rel} — remove it by hand`
                        };
                        res.status(result.error === 'not-found' ? 404 : 409).json({
                            error: messages[result.error]
                        });
                        return;
                    }
                    console.log(chalk.gray(`remark removed from ${rel}`));
                    res.json({ file: rel });
                } catch (e) {
                    res.status(500).json({ error: `could not remove the remark: ${(e as Error).message}` });
                }
            });
        }

        // Замечания агенту (change site-agent-feedback): FIFO пачек в памяти (design D3), страница
        // шлёт POST, `c4builder feedback` забирает long-poll'ом (D1). Пачка снимается с очереди,
        // когда ответ записан; обрыв до этого возвращает её в голову очереди, откуда её взяли.
        const disabled = (): boolean => agent.explicit && !agent.on;
        const drop = (b: Mailbox, res: express.Response): void => {
            const i = b.waiters.indexOf(res);
            if (i >= 0) b.waiters.splice(i, 1);
        };
        const pump = (name: string, b: Mailbox): void => {
            for (;;) {
                const source = b.queue.length ? b.queue : unaddressed;
                if (!source.length || !b.waiters.length) return;
                const res = b.waiters.shift();
                const item = source.shift();
                if (res && item) deliver(name, res, item, source);
            }
        };
        const pumpAll = (): void => {
            for (const [name, b] of mailboxes) pump(name, b);
        };
        const deliver = (name: string, res: express.Response, item: Item, source: Item[]): void => {
            res.on('close', () => {
                if (!res.writableFinished) {
                    source.unshift(item);
                    pumpAll();
                } else {
                    console.log(chalk.gray(`feedback: batch delivered to ${name} (${item.batch.decision})`));
                    reloadEmitter.emit('delivered', { id: item.id, to: name });
                }
                publish();
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
            const { to, ...batch } = parsed.data;
            if (batch.decision === 'submitted' && !batch.comments.length && !batch.general) {
                res.status(400).json({ error: 'nothing to send' });
                return;
            }
            const id = randomUUID();
            // Ящик адресата создаётся и здесь: выбранный на вкладке адресат не теряется, даже если
            // его пустой ящик успели удалить.
            const target = to === undefined ? undefined : box(to);
            const queued = !(target ? [target] : [...mailboxes.values()]).some((b) => b.waiters.length);
            (target?.queue ?? unaddressed).push({ id, batch });
            pumpAll();
            publish();
            console.log(
                chalk.gray(
                    `feedback for ${to ?? 'any listener'}: ${batch.decision}, ${batch.comments.length} comment(s)${queued ? ' — queued, not listening' : ''}`
                )
            );
            res.json({ id, queued, to });
        });

        // Нестандартный заголовок вынуждает браузер к preflight, на который сервер не отвечает:
        // чужая страница не может ни прочитать, ни «съесть» очередь простым запросом (design D6).
        app.get(`${FEEDBACK_PATH}/next`, (req, res) => {
            if (!fromFeedbackCommand(req)) {
                res.status(403).json({ error: 'feedback is served only to the c4builder feedback command' });
                return;
            }
            if (disabled()) {
                res.status(404).json({ error: 'agent feedback is disabled (--no-agent)' });
                return;
            }
            const name = req.query.as;
            if (typeof name !== 'string' || !LISTENER_NAME.test(name)) {
                res.status(400).json({
                    error: '--as <name> is required: 1-64 letters, digits, ".", "_" or "-" (c4builder feedback --wait --as <name>)'
                });
                return;
            }
            if (!agent.on)
                console.log(chalk.gray(`agent mode on: "c4builder feedback --as ${name}" connected`));
            agent.on = true;
            const b = box(name);
            b.polls++;
            b.listening = true;
            clearTimeout(b.idle);
            publish();
            let timer: NodeJS.Timeout | undefined;
            res.on('close', () => {
                clearTimeout(timer);
                drop(b, res);
                b.lastSeen = Date.now();
                if (--b.polls === 0)
                    b.idle = setTimeout(() => {
                        b.listening = false;
                        publish();
                    }, idleMs);
            });
            b.waiters.push(res);
            pump(name, b);
            if (!b.waiters.includes(res)) return;
            timer = setTimeout(
                () => {
                    // Пачку успели отдать этому запросу — ответ уже пишется, 204 не нужен.
                    if (!b.waiters.includes(res)) return;
                    drop(b, res);
                    res.status(204).end();
                },
                req.query.wait === '0' ? 0 : pollMs
            );
        });

        // Открытая страница — первая в очереди фонового рендера. Сигнал шлёт сниппет на каждый
        // переход docsify; путь — route.file (относительный или с basePath, бывает в
        // percent-encoding). Очереди уже нет (тёплый старт, рендер закончен) — просто 204.
        app.post(OPEN_PATH, express.json({ limit: '4kb' }), (req, res) => {
            if (!fromSite(req)) {
                res.status(403).json({ error: 'accepted only from the site itself' });
                return;
            }
            let page = str(req.body?.page).replace(/^https?:\/\/[^/]+/, '');
            try {
                page = decodeURIComponent(page);
            } catch (_e) {
                // уже декодирован и содержит «%» — берём как есть
            }
            page = page.replace(/^\/+/, '');
            if (page && prioritize) prioritize(page);
            res.status(204).end();
        });

        // Адрес страницы change'а по имени слушателя (change site-agent-review, D6): `c4builder
        // feedback --as <name>` печатает его в stderr. Защита — как у /next: чужой странице
        // список change'ей ни к чему.
        app.get(PAGE_PATH, (req, res) => {
            if (!fromFeedbackCommand(req)) {
                res.status(403).json({ error: 'served only to the c4builder feedback command' });
                return;
            }
            const name = req.query.as;
            if (typeof name !== 'string' || !LISTENER_NAME.test(name)) {
                res.status(400).json({ error: 'as=<name> is required' });
                return;
            }
            const key = redirectKey(['change', name]);
            if (!result().redirects.has(key)) {
                res.status(404).json({ error: `no page for change/${name}` });
                return;
            }
            res.json({ url: `/#${key}` });
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
            // docsify — один корневой index.html с hash-роутингом. Фолбэк окна ребилда только
            // для корня: иначе любой несуществующий `…/` отвечал бы 200 главной, а не 404.
            const isRoot = urlPath === '/';
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
                    if (isRoot && lastIndexHtml) {
                        res.set('Cache-Control', 'no-store').type('html').send(lastIndexHtml);
                        return;
                    }
                    return next();
                }
                const page = inject(data);
                if (isRoot) lastIndexHtml = page;
                res.set('Cache-Control', 'no-store').type('html').send(page);
            });
        });
    }

    // express 5 / path-to-regexp v8 запрещает голый '/*' как путь маршрута — раздаём
    // статику через app.use (тот же эффект: fallthrough-обработчик всех GET).
    app.use(express.static(distFolder));

    return new Promise((resolve, reject) => {
        // Express 5 зовёт колбэк listen и с ошибкой (занятый порт) — её разбирает
        // server.on('error') ниже, а «serving» печатаем только после настоящего listen.
        const server = app.listen(port as number, '127.0.0.1', (err?: Error) => {
            if (err) return;
            const base = `http://localhost:${port}`;
            // `--open-change <id>`: короткий адрес change'а. Ключа нет в карте — предупреждаем, но
            // адрес всё равно открываем: в watch change могут собрать позже.
            const route = program.openChange ? redirectKey(['change', program.openChange]) : '';
            const url = route ? `${base}/#${route}` : base;
            console.log('serving your docsify site');
            console.log(`go to ${chalk.green(url)}`);
            if (route && !result().redirects.has(route))
                console.error(
                    chalk.yellow(
                        `warning: the site has no page change/${program.openChange} — ${url} shows "not found" until a change with this id is built`
                    )
                );
            if (liveReloadEnabled)
                console.log(chalk.gray('livereload enabled (browser auto-reload on rebuild)'));
            if (liveReloadEnabled && agent.on)
                console.log(
                    `agent mode (${agent.name}): page feedback goes to "c4builder feedback --wait --as <name>${program.port ? ` -p ${port}` : ''}" — run it in the background, <name> is your change or task; run it again with the same name after each batch`
                );
            // --open/--open-change: открываем браузер один раз при старте; BROWSER=none отключает (CI/headless)
            if ((program.open || route) && process.env.BROWSER !== 'none')
                open(url).catch(() => console.log(chalk.gray('could not open the browser automatically')));
            resolve(server);
        });
        server.on('close', () => clearInterval(sweeper));
        server.on('error', async (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                const free = await freePortAfter(Number(port));
                console.log(
                    chalk.red(
                        `port ${port} is already in use — pass a different one${free ? `, e.g. -p ${free}` : ' with -p <port>'}`
                    )
                );
            } else {
                console.log(chalk.red(`server error: ${err.message}`));
            }
            reject(err);
        });
    });
};
