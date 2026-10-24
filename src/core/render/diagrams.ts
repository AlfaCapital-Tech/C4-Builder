import chalk from 'chalk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import fsextra from 'fs-extra';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import { writeFile, VENDORED_JAR } from '../../util/utils.ts';
import { httpGetBuffer } from '../../util/http.ts';
// D2-бэкенд: только статические хелперы (парсинг импортов) грузятся сразу; сам
// движок @terrastruct/d2 тянется лениво внутри renderD2/teardownD2.
import { renderD2, foldD2Imports } from './d2renderer.ts';
// BPMN-бэкенд: пакеты движка грузятся лениво внутри renderBpmn.
import { renderBpmn, BPMN_CACHE_PACKAGES } from './bpmnrenderer.ts';
// Mermaid-бэкенд: пакет движка грузится лениво внутри renderMermaid.
import { renderMermaid, MERMAID_PACKAGE } from './mermaidrenderer.ts';
import { resolveJava } from './jre.ts';
// PNG-выход: SVG обоих движков растеризуется resvg (ленивая загрузка внутри модуля).
import { rasterizeSvgToPng } from './pngraster.ts';
// Шрифт-пин общий с resvg-растеризатором (одна точка правды, см. fonts.ts).
import { FONTS_DIR, DEFAULT_FONT_NAME } from './fonts.ts';
import { VENDOR_DIR } from '../../util/paths.ts';
import { foldIncludes, diagramOutputFormat, type Diagram, type TreeItem } from '../scan/tree.ts';
import type { BuildOptions } from '../../config/options.ts';

// cacheConf: Configstore-подобная заглушка чексумм картинок (см. cli/dispatch).
// Владелец — generateImages; build() лишь пробрасывает её из dispatch.
export interface CacheConf {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
}

// Параметры прямого вызова PlantUML (renderDiagram).
export interface RenderDiagramOptions {
    javaBin: string;
    jarPath: string;
    includePath: string;
    format: string;
    charset: string;
    isDitaa: boolean;
    useSystemFonts: boolean;
}

// Колбэк прогресса рендера: сколько картинок обработано из общего числа.
export type ImageProgress = (processed: number, total: number) => void;

// Таймаут рендера ОДНОЙ диаграммы: зависший JVM (циклы Smetana-layout) не эмитит
// ни 'close', ни 'error' — без таймаута await виснет вечно, а в watch-режиме
// isBuilding остаётся true навсегда. По таймауту процесс убивается (SIGTERM→SIGKILL).
const RENDER_TIMEOUT_MS = 120_000;
const SIGKILL_GRACE_MS = 5_000;

// Размер пула PlantUML-рендера. Каждая задача — отдельный процесс java (свой JVM,
// свои сотни МБ heap), поэтому пул НЕ равен числу ядер: дефолт — cpus-1, но не более 4.
// Переопределяется env C4BUILDER_RENDER_CONCURRENCY (целое ≥1); мусор — молча дефолт.
const renderConcurrency = (): number => {
    const raw = process.env.C4BUILDER_RENDER_CONCURRENCY;
    if (raw !== undefined) {
        const n = Number(raw);
        if (Number.isInteger(n) && n >= 1) return n;
    }
    return Math.max(1, Math.min(4, os.cpus().length - 1));
};

// Дорожки очереди рендера. Каждая — свой пул: PlantUML — отдельные процессы java
// (renderConcurrency()), остальные движки — по одной задаче (см. комментарии в
// generateImages); дорожки работают параллельно друг другу.
export type DiagramLane = 'plantuml' | 'd2' | 'bpmn' | 'mermaid';

export interface DiagramTask {
    /** Путь картинки относительно dist (posix, без ведущего слэша): по нему страница узнаёт готовую картинку. */
    out: string;
    lane: DiagramLane;
    run: () => Promise<void>;
}

// Путь задачи/страницы к единому виду: posix, без ведущего слэша (relOut корневой папки
// идёт без него, вложенных — с ним; из URL страницы он приходит с ним всегда).
const normalizeRel = (p: string): string => p.split(path.sep).join('/').replace(/^\/+/, '');

// Очередь рендера с приоритетом. Задачи лежат в порядке обхода дерева; воркеры дорожки
// берут их с головы (shift), поэтому prioritize() переставляет ещё не начатые задачи, а
// выполняющиеся не трогает. Без prioritize ведёт себя как прежний пул с общим индексом:
// при первой ошибке дорожки новые задачи не стартуют, УЖЕ запущенные дожидаются (чтобы не
// осталось висящих JVM), после чего пробрасывается первая пойманная ошибка. Результат
// не собираем — каждая задача пишет свой файл сама.
export class DiagramQueue {
    private readonly lanes = new Map<DiagramLane, DiagramTask[]>();
    private readonly doneListeners: Array<(out: string) => void> = [];
    private total = 0;

    constructor(
        private readonly hooks: {
            width: (lane: DiagramLane) => number;
            /** Вызывается по окончании run() при любом исходе (персист кэша). */
            onSettled?: () => void;
        }
    ) {}

    /** Сколько задач добавлено (в т.ч. уже выполненных). */
    get size(): number {
        return this.total;
    }

    add(task: DiagramTask): void {
        const tasks = this.lanes.get(task.lane) ?? [];
        this.lanes.set(task.lane, tasks);
        tasks.push({ ...task, out: normalizeRel(task.out) });
        this.total++;
    }

    /** Колбэк на каждую УСПЕШНО завершённую задачу — путь картинки относительно dist. */
    onDone(cb: (out: string) => void): void {
        this.doneListeners.push(cb);
    }

    /** Диаграммы из папки страницы `pageMd` (путь относительно dist) — в голову очереди. */
    prioritize(pageMd: string): void {
        const dir = path.posix.dirname(normalizeRel(pageMd));
        for (const tasks of this.lanes.values()) {
            const head = tasks.filter((t) => path.posix.dirname(t.out) === dir);
            if (!head.length || head.length === tasks.length) continue;
            const rest = tasks.filter((t) => !head.includes(t));
            tasks.splice(0, tasks.length, ...head, ...rest);
        }
    }

    async run(): Promise<void> {
        try {
            // allSettled — чтобы падение одной дорожки не оставляло другие как floating promise
            // с висящими JVM: все доосушаются, затем бросаем первую ошибку (порядок между
            // дорожками не значим).
            const results = await Promise.allSettled(
                [...this.lanes].map(([lane, tasks]) => this.drain(tasks, this.hooks.width(lane)))
            );
            const failed = results.find((r) => r.status === 'rejected');
            if (failed && failed.status === 'rejected') throw failed.reason;
        } finally {
            this.hooks.onSettled?.();
        }
    }

    private async drain(tasks: DiagramTask[], concurrency: number): Promise<void> {
        let firstError: unknown;
        const worker = async (): Promise<void> => {
            for (;;) {
                if (firstError !== undefined) return;
                const task = tasks.shift();
                if (!task) return;
                try {
                    await task.run();
                } catch (err) {
                    if (firstError === undefined) firstError = err;
                    continue;
                }
                for (const cb of this.doneListeners) cb(task.out);
            }
        };
        const width = Math.max(1, Math.min(concurrency, tasks.length));
        await Promise.all(Array.from({ length: width }, worker));
        if (firstError !== undefined) throw firstError;
    }
}

// Пауза между записями .c4builder.cache по ходу рендера: не чаще раза в полсекунды, а не
// после каждой диаграммы (Configstore пишет файл синхронно), но и не только в конце —
// прерванная Ctrl+C сборка оставляет в кэше всё готовое, кроме последних полусекунды.
const CACHE_PERSIST_MS = 500;

// Версии пакетов движков (D2, BPMN, mermaid) для чексуммы кэша (апгрейд движка → перерендер).
// Читаем package.json лениво и один раз: pure-PlantUML сборки их не трогают.
const versionCache = new Map<string, string>();
const pkgVersion = (name: string): string => {
    let version = versionCache.get(name);
    if (version === undefined) {
        // package.json ищем по путям поиска node_modules, а не require(`${name}/package.json`):
        // пакеты с полем exports (bpmn-auto-layout) этот подпуть не отдают — версия молча
        // становилась бы 'unknown', и апгрейд движка не перерисовывал бы диаграммы.
        try {
            const paths = createRequire(import.meta.url).resolve.paths(name) ?? [];
            const dir = paths.find((p) => fs.existsSync(path.join(p, name, 'package.json')));
            if (!dir) throw new Error(`${name} not found`);
            version = (
                JSON.parse(fs.readFileSync(path.join(dir, name, 'package.json'), 'utf8')) as {
                    version: string;
                }
            ).version;
        } catch {
            version = 'unknown';
        }
        versionCache.set(name, version);
    }
    return version;
};

// В ключ кеша: смена режима не должна отдавать картинку, отрисованную другим шрифтом
// (D2 тоже — его PNG растрирует общий resvg).
export const fontCacheTag = (options: BuildOptions): string =>
    options.USE_SYSTEM_FONTS ? 'system' : DEFAULT_FONT_NAME;

// renderKey: параметры, влияющие на БАЙТЫ вывода помимо контента и графа импортов.
// Без него смена layout (D2) или charset (PlantUML) не меняла чексумму → из бэкапа
// копировалась старая картинка (новые параметры молча игнорировались, кэш чистился
// только через --reset). Формат/движок/версия движка тоже в ключе: их смена обязана
// приводить к перерендеру.
export const renderKey = (
    diagram: Pick<Diagram, 'engine' | 'isDitaa'>,
    options: BuildOptions,
    outFormat: string
): string =>
    (diagram.engine === 'd2'
        ? `d2\0${pkgVersion('@terrastruct/d2')}\0layout=${options.D2_LAYOUT}\0fmt=${outFormat}`
        : diagram.engine === 'bpmn'
          ? `bpmn\0${BPMN_CACHE_PACKAGES.map(pkgVersion).join('\0')}\0fmt=${outFormat}`
          : diagram.engine === 'mermaid'
            ? `mermaid\0${pkgVersion(MERMAID_PACKAGE)}\0fmt=${outFormat}`
            : `puml\0${VENDORED_JAR.version}\0charset=${options.CHARSET}\0fmt=${outFormat}\0ditaa=${diagram.isDitaa}`) +
    `\0font=${fontCacheTag(options)}`;

export const getMime = (format: string): string => {
    if (format === 'svg') return `image/svg+xml`;
    return `image/${format}`;
};

// Загрузка удалённо отрендеренной картинки (embed-ветка онлайн-рендера PlantUML) в
// base64. Редиректы и таймауты берём из общего util/http: прежде здесь был голый GET
// без обоих — 302 от PlantUML-сервера ронял embed-сборку, а зависший сокет вешал её.
export const httpGet = async (url: string): Promise<string> => (await httpGetBuffer(url)).toString('base64');

// Прямой вызов PlantUML: layout считает встроенный Java-движок Smetana
// (`-Playout=smetana`), внешний graphviz/dot не нужен. Диаграмма подаётся в stdin
// (`-pipe`), результат читается из stdout — имя выходного файла задаёт c4builder,
// а не директива `@startuml <name>`. Include-путь и вендорный шрифт отдаются JVM.
// ditaa рендерит собственный движок (layout не участвует), а `-Playout=smetana`
// на нём меняет размер холста — поэтому для ditaa флаг не передаётся (выход
// байт-в-байт совпадает с историческим).
//
// Оба имени шрифта пиним явно. `-SdefaultFontName` покрывает текст, а бэджи классов
// (буквы «C»/«A»/«I» в кружках) PlantUML рисует КРИВЫМИ отдельного шрифта
// CircledCharacterFontName: без пина это логический шрифт JVM, который резолвит
// системный fontconfig (Ubuntu → DejaVu/TrueType, Arch → Nimbus/CFF) — контуры
// расходятся между ОС. С пином шрифт берётся из vendor/fonts (JRE своих не несёт,
// freetype у Temurin бандлед), и SVG получается одинаковым везде.
// ditaa этим не лечится: его движок берёт AWT-шрифт мимо обеих опций.
// useSystemFonts убирает все три шрифтовых аргумента — рендер как до пина (машинозависим).
export const renderArgv = ({
    jarPath,
    includePath,
    format,
    charset,
    isDitaa,
    useSystemFonts
}: Omit<RenderDiagramOptions, 'javaBin'>): string[] => [
    '-Djava.awt.headless=true',
    `-Dplantuml.include.path=${includePath}`,
    ...(useSystemFonts ? [] : [`-Dsun.java2d.fontpath=prepend:${FONTS_DIR}`]),
    '-jar',
    jarPath,
    ...(isDitaa ? [] : ['-Playout=smetana']),
    ...(useSystemFonts
        ? []
        : [`-SdefaultFontName=${DEFAULT_FONT_NAME}`, `-SCircledCharacterFontName=${DEFAULT_FONT_NAME}`]),
    '-charset',
    charset,
    `-t${format}`,
    '-pipe'
];

export const renderDiagram = (content: string | Buffer, options: RenderDiagramOptions): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const child = spawn(options.javaBin, renderArgv(options));
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];

        // stdio по умолчанию 'pipe' → потоки заведомо не null; берём их деструктуризацией
        // с одним guard вместо non-null assertion на каждом обращении.
        const { stdin, stdout: childOut, stderr: childErr } = child;
        if (!stdin || !childOut || !childErr) {
            return reject(new Error('PlantUML: failed to open stdio streams of the java process'));
        }

        // Smetana печатает диагностический шум (UNSURE_ABOUT…) — это не ошибка
        // рендера, пользователю не показываем; остальной stderr пробрасываем.
        const cleanStderr = (): string =>
            Buffer.concat(stderr)
                .toString('utf8')
                .split('\n')
                .filter((line) => line.trim() && !/UNSURE_ABOUT/.test(line))
                .join('\n');

        let settled = false;
        let sigkillTimer: NodeJS.Timeout | undefined;
        const timer: NodeJS.Timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            // JVM завис: мягко SIGTERM, затем жёстко SIGKILL, если не среагировал.
            child.kill('SIGTERM');
            sigkillTimer = setTimeout(() => child.kill('SIGKILL'), SIGKILL_GRACE_MS);
            sigkillTimer.unref();
            const tail = cleanStderr();
            reject(
                new Error(
                    `PlantUML did not finish in ${RENDER_TIMEOUT_MS / 1000} s and was aborted` +
                        (tail ? `\n${tail}` : '')
                )
            );
        }, RENDER_TIMEOUT_MS);
        timer.unref();
        const clearTimers = (): void => {
            clearTimeout(timer);
            if (sigkillTimer) clearTimeout(sigkillTimer);
        };

        childOut.on('data', (chunk) => stdout.push(chunk));
        childErr.on('data', (chunk) => stderr.push(chunk));
        child.on('error', (err) => {
            // java не найдена и пр.
            clearTimers();
            if (settled) return;
            settled = true;
            reject(err);
        });
        child.on('close', (code) => {
            clearTimers(); // гасим таймеры даже если сработал timeout (не убиваем чужой PID)
            if (settled) return;
            settled = true;
            const errText = cleanStderr();
            if (code !== 0) {
                return reject(new Error(`PlantUML exited with code ${code}\n${errText}`));
            }
            if (errText) process.stderr.write(`${errText}\n`);
            resolve(Buffer.concat(stdout));
        });

        stdin.on('error', () => {}); // EPIPE, если java упала до чтения stdin
        stdin.write(content);
        stdin.end();
    });

// bkFolderName — каталог бэкапа dist, откуда восстанавливаются неизменённые картинки
// по чексумме. Его lifecycle (создание/удаление) держит оркестратор build(); сюда
// путь приходит явным параметром, а не пересчитывается из общей константы.
// Картинка-заглушка вместо упавшей «мягкой» диаграммы: ошибка видна на странице,
// сайт остаётся собранным (так же вёл себя онлайн-рендер docsify-plantuml).
const errorPlaceholderSvg = (name: string, reason: string): string => {
    const esc = (s: string): string =>
        s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
    const lines = [`${name}: diagram not rendered`, ...reason.split('\n')]
        .flatMap((l) => l.match(/.{1,88}/g) ?? [''])
        .slice(0, 8);
    const w = 720;
    const h = 34 + lines.length * 20;
    const text = lines
        .map((l, i) => `<text x="16" y="${34 + i * 20}" font-size="14">${esc(l)}</text>`)
        .join('');
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
        `font-family="${DEFAULT_FONT_NAME}" fill="#8b0000">` +
        `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="#fff5f5" stroke="#8b0000"/>${text}</svg>`
    );
};

// Заглушка на месте диаграммы, которую dev-сервер дорисует в фоне (режим deferImages):
// страница отдаётся сразу, картинка подменится по готовности. Нейтральные цвета — это
// не ошибка. В dist без `-w` не попадает: обычная сборка ждёт рендера.
export const pendingPlaceholderSvg = (name: string): string => {
    const esc = (s: string): string =>
        s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
    const w = 480;
    const h = 56;
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
        `font-family="${DEFAULT_FONT_NAME}" fill="#666">` +
        `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="#f7f7f7" stroke="#bbb" stroke-dasharray="6 4"/>` +
        `<text x="16" y="34" font-size="14">${esc(name)}: rendering…</text></svg>`
    );
};

export interface GenerateImagesFlags {
    /**
     * Отложенный рендер (dev-сервер `site -w`): из кэша восстанавливаем сразу, остальным
     * диаграммам пишем заглушку `rendering…` и возвращаем очередь, не дожидаясь её.
     * Подразумевает softErrors.
     */
    deferImages?: boolean;
    /**
     * Ошибка рендера любой диаграммы — заглушка с ошибкой и `✗` в логе вместо исключения
     * (как у «мягких» диаграмм плагинов). Dev-сервер включает это и для пересборки по
     * окончании фоновой очереди: битая диаграмма не должна оставить сайт полусобранным.
     */
    softErrors?: boolean;
}

export const generateImages = async (
    tree: TreeItem[],
    options: BuildOptions,
    onImageGenerated: ImageProgress | undefined,
    cacheConf: CacheConf,
    bkFolderName: string,
    { deferImages = false, softErrors = deferImages }: GenerateImagesFlags = {}
): Promise<DiagramQueue | undefined> => {
    // Чексуммы прошлого прогона — в Set: попадание проверяется O(1) на диаграмму
    // (было O(N) find → O(N²) на всё дерево).
    const oldChecksums = new Set((cacheConf.get('checksums') as string[] | undefined) || []);
    // Каждой диаграмме — запись в порядке обхода дерева; ok выставляется задачей при
    // УСПЕХЕ (рендер или восстановление из бэкапа). В кеш пишем только успешные: иначе
    // упавший прогон терял бы чексуммы уже отрендеренных → их полный перерендер на
    // следующем запуске (см. persist ниже).
    const checksumEntries: { cksum: string; ok: boolean }[] = [];

    // Персист кэша по ходу рендера: не чаще CACHE_PERSIST_MS и обязательно по окончании
    // очереди (onSettled). Набор — old ∩ успешные, как и раньше, но накапливается постепенно.
    let persistTimer: NodeJS.Timeout | undefined;
    const persist = (): void => {
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = undefined;
        cacheConf.set(
            'checksums',
            checksumEntries.filter((e) => e.ok).map((e) => e.cksum)
        );
    };
    const schedulePersist = (): void => {
        if (persistTimer) return;
        persistTimer = setTimeout(persist, CACHE_PERSIST_MS);
        persistTimer.unref();
    };

    let totalImages = 0;
    let processedImages = 0;

    // Рендерим единственным вендорным JAR — выбора версии больше нет. Легаси-ключ
    // plantumlVersion в старых .c4builder игнорируем; предупреждаем однократно, только
    // если он пинует конкретную удалённую версию (≠ latest и ≠ версии вендорного JAR).
    const jarPath = path.join(VENDOR_DIR, VENDORED_JAR.jar);
    const pinned = options.LEGACY_PLANTUML_VERSION;
    if (pinned && pinned !== 'latest' && pinned !== VENDORED_JAR.version) {
        console.log(chalk.bold(chalk.yellow('WARNING:')));
        console.log(
            chalk.yellow(
                `Choosing the PlantUML version was removed — builds use the vendored JAR ${VENDORED_JAR.version}. ` +
                    `The plantumlVersion: "${pinned}" key can be removed from .c4builder.`
            )
        );
    }

    // JRE резолвится ЛЕНИВО и один раз за сборку: только когда встретилась PlantUML-
    // диаграмма, которую РЕАЛЬНО надо рендерить (кэш не сработал — restore-путь ниже
    // делает continue до создания render-задачи). Проект целиком на D2 либо полностью
    // восстановленный из бэкапа java не трогает — важно для офлайн-пересборки готового
    // проекта на машине без установленной java (иначе резолв инициировал бы скачивание).
    let javaPromise: Promise<string> | null = null;
    const getJava = (): Promise<string> => {
        if (!javaPromise) {
            javaPromise = resolveJava({ log: (m) => console.log(chalk.gray(m)) }).then((r) => r.path);
        }
        return javaPromise;
    };

    for (const item of tree) {
        totalImages += item.diagrams.length;
    }

    // Прогресс инкрементируем по ЗАВЕРШЕНИИ каждой задачи. Порядок завершения при
    // конкурентности недетерминирован (сообщения `processed X/Y` могут идти вразнобой),
    // но X монотонно растёт и финал = totalImages. Инкремент атомарен (один event-loop).
    const withProgress =
        (task: () => Promise<void>): (() => Promise<void>) =>
        async () => {
            await task();
            processedImages++;
            if (onImageGenerated) onImageGenerated(processedImages, totalImages);
        };

    // D2-задачи гоняем отдельной дорожкой с конкурентностью 1: @terrastruct/d2 держит
    // ЕДИНСТВЕННЫЙ worker с одним currentResolve/currentReject без корреляции запросов —
    // два параллельных renderD2 затирают колбэк друг друга (промис виснет / результаты
    // перепутываются). Движок всё равно однопоточный, так что сериализация D2 бесплатна.
    // BPMN рендерится в общем окне jsdom главного потока — параллельность ничего не даёт,
    // а последовательная очередь исключает гонки на общем состоянии бандла bpmn-js.
    // Mermaid — так же: своё окно jsdom, глобальный конфиг и подмены на время рендера.
    // PlantUML — отдельные процессы java, их гоняем пулом renderConcurrency().
    const queue = new DiagramQueue({
        width: (lane) => (lane === 'plantuml' ? renderConcurrency() : 1),
        onSettled: persist
    });
    // Отложенный режим: восстановление из кэша выполняется сразу (до возврата), заглушки
    // пишутся параллельно; в очередь уходит только то, что надо рендерить.
    const immediate: Array<() => Promise<void>> = [];
    const placeholders: Promise<void>[] = [];

    for (const item of tree) {
        for (const diagram of item.diagrams) {
            // Чексумма = контент диаграммы + свёрнутый граф её зависимостей, чтобы
            // правка включаемого/импортируемого файла инвалидировала кэш: PlantUML —
            // !include-граф (.iuml и пр.), D2 — граф @/...@-импортов. У BPMN и mermaid их нет.
            const body = `${diagram.content || ''}`;
            const entryPath = path.join(item.dir, diagram.dir);
            const isD2 = diagram.engine === 'd2';
            const isBpmn = diagram.engine === 'bpmn';
            const isMermaid = diagram.engine === 'mermaid';
            const includes = isD2
                ? foldD2Imports(entryPath, body)
                : isBpmn || isMermaid
                  ? ''
                  : foldIncludes(body, item.dir, item.dir, new Set());
            const outFormat = diagramOutputFormat(diagram, options);
            const outName = `${path.parse(diagram.dir).name}.${outFormat}`;
            const relOut = path.join(item.dir.replace(options.ROOT_FOLDER, ''), outName);
            // Путь выхода — тоже в чексумме: восстановление из бэкапа идёт по паре
            // «чексумма встречалась» + «бэкап с этим именем есть», иначе диаграммы,
            // обменявшиеся содержимым (или сдвинувшиеся имена fence-блоков плагинов),
            // молча получали бы чужую старую картинку.
            const cksum = crypto
                .createHash('sha256')
                .update(
                    `${body}${includes}${renderKey(diagram, options, outFormat)}\0out=${relOut.split(path.sep).join('/')}`,
                    'utf-8'
                )
                .digest('hex');

            // Записи копим в порядке обхода дерева, СИНХРОННО и до запуска задач:
            // порядок массива не зависит от того, кто из воркеров финиширует раньше —
            // .c4builder.cache детерминирован (важно для сравнения кэша между сборками).
            const cksumEntry = { cksum, ok: false };
            checksumEntries.push(cksumEntry);

            // path to backup image file
            const bkFilePath = path.join(bkFolderName, relOut);

            // path to image in dist folder
            const filePath = path.join(options.DIST_FOLDER, relOut);

            // if checksum exists (diagram untouched) and file/image exists - copy image back from backup folder
            if (oldChecksums.has(cksum) && fs.existsSync(bkFilePath)) {
                // Восстановление из бэкапа — без рендера; JVM/worker не задействованы,
                // поэтому кладём в дорожку PlantUML (движок не важен). В отложенном
                // режиме — сразу: страница должна уйти с готовыми картинками из кэша.
                const restore = withProgress(async () => {
                    fsextra.copyFileSync(bkFilePath, filePath);
                    cksumEntry.ok = true;
                    schedulePersist();
                });
                if (deferImages) immediate.push(restore);
                else queue.add({ out: relOut, lane: 'plantuml', run: restore });
                continue;
            }

            // PNG-выход не-ditaa диаграмм — растеризацией SVG (resvg), а не нативным
            // движком: единый детерминированный PNG для PlantUML и D2. ditaa остаётся
            // нативным PlantUML-PNG (у него нет SVG-представления) — не растеризуем.
            const needsRaster = outFormat === 'png' && !diagram.isDitaa;
            const diagramContent = diagram.content;
            const includePath = item.dir;
            const isDitaa = diagram.isDitaa;
            // Имя картинки диаграммы виртуальной страницы производно от контента —
            // без исходного файла в сообщении его не найти.
            const source = diagram.source;
            const soft = diagram.soft === true;
            const lane: DiagramLane = isD2 ? 'd2' : isBpmn ? 'bpmn' : isMermaid ? 'mermaid' : 'plantuml';

            // Заглушка с ошибкой вместо картинки: у «мягких» диаграмм — всегда (блоки в markdown
            // плагинов писались под онлайн-рендер, где битый блок давал картинку с ошибкой, а
            // не падение сборки), при softErrors — у любых: фоновый рендер не должен ронять
            // dev-сервер. Чексумма не сохраняется — следующая пересборка перерисует.
            const writeErrorPlaceholder = async (reason: string): Promise<void> => {
                const svg = Buffer.from(errorPlaceholderSvg(outName, reason), 'utf-8');
                await writeFile(
                    filePath,
                    outFormat === 'png' ? await rasterizeSvgToPng(svg, options.USE_SYSTEM_FONTS) : svg
                );
            };

            const render = async (): Promise<void> => {
                // render diagram to image: D2 через WASM, PlantUML — прямым вызовом java.
                // Для растеризации PlantUML не-ditaa рендерим в svg (не -tpng), затем resvg.
                let rendered: Buffer;
                try {
                    // Путь для сообщений движка; у блоков в markdown — их страница.
                    const file = source ?? path.relative(process.cwd(), entryPath).split(path.sep).join('/');
                    if (isD2) {
                        rendered = await renderD2(entryPath, { layout: options.D2_LAYOUT, seed: body });
                    } else if (isBpmn) {
                        rendered = await renderBpmn(body, file);
                    } else if (isMermaid) {
                        rendered = await renderMermaid(body, file);
                    } else {
                        // Резолв JRE отложен до первого реального PlantUML-рендера (эта
                        // ветка исполняется лишь при промахе кэша). getJava мемоизирует.
                        const javaBin = await getJava();
                        rendered = await renderDiagram(diagramContent, {
                            javaBin,
                            jarPath,
                            includePath,
                            format: needsRaster ? 'svg' : outFormat,
                            charset: options.CHARSET,
                            isDitaa,
                            useSystemFonts: options.USE_SYSTEM_FONTS
                        });
                    }
                    const image = needsRaster
                        ? await rasterizeSvgToPng(rendered, options.USE_SYSTEM_FONTS)
                        : rendered;
                    await writeFile(filePath, image);
                    cksumEntry.ok = true;
                    schedulePersist();
                } catch (err: unknown) {
                    // Имя диаграммы в ошибку: renderDiagram/renderD2 сами его не знают.
                    const reason = `${(err as Error).message || err}`;
                    const msg = `Diagram "${outName}"${source ? ` (${source})` : ''}: ${reason}`;
                    if (softErrors) {
                        console.log(chalk.red(`✗ ${msg}`));
                        await writeErrorPlaceholder(reason);
                        return;
                    }
                    if (!soft) throw new Error(msg);
                    console.log(chalk.yellow(`⚠ ${msg}`));
                    await writeErrorPlaceholder(reason);
                }
            };

            if (deferImages) {
                const svg = Buffer.from(pendingPlaceholderSvg(outName), 'utf-8');
                placeholders.push(
                    (async () =>
                        writeFile(
                            filePath,
                            outFormat === 'png' ? await rasterizeSvgToPng(svg, options.USE_SYSTEM_FONTS) : svg
                        ))()
                );
                // Прогресс фоновой очереди печатает dev-сервер — withProgress здесь не нужен.
                queue.add({ out: relOut, lane, run: render });
            } else {
                queue.add({ out: relOut, lane, run: withProgress(render) });
            }
        }
    }

    if (deferImages) {
        // В прогрессе этой фазы — только восстановленные из кэша; остальное дорисует очередь.
        totalImages = immediate.length;
        await Promise.all([...immediate.map((t) => t()), ...placeholders]);
        // Чексуммы восстановленных — в кэш сразу: очередь может и не дойти до конца (Ctrl+C).
        persist();
        return queue.size ? queue : undefined;
    }

    // Дорожки PlantUML, D2, BPMN и mermaid работают независимо (процессы java, WASM-worker,
    // главный поток) и параллельно друг другу; при частичном падении чексуммы успешно
    // обработанных всё равно персистятся (onSettled) — вместе с сохранением dist_bk при
    // ошибке (build.ts) повторный прогон после сбоя чинит только упавшую диаграмму.
    await queue.run();
    return undefined;
};
