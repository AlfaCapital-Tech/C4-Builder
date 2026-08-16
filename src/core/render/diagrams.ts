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
import { resolveJava } from './jre.ts';
// PNG-выход: SVG обоих движков растеризуется resvg (ленивая загрузка внутри модуля).
import { rasterizeSvgToPng } from './pngraster.ts';
// Шрифт-пин общий с resvg-растеризатором (одна точка правды, см. fonts.ts).
import { FONTS_DIR, DEFAULT_FONT_NAME } from './fonts.ts';
import { VENDOR_DIR } from '../../util/paths.ts';
import { foldIncludes, diagramOutputFormat, type TreeItem } from '../scan/tree.ts';
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

// Пул ограниченной конкурентности: гоняет tasks не более `concurrency` одновременно.
// Порядок вызова задач сохраняется (worker'ы разбирают общий индекс next), результат —
// не собираем (каждая задача пишет свой файл сама). При первой ошибке новые задачи не
// стартуют, но УЖЕ запущенные дожидаются (finally у Promise.all в воркере) — чтобы не
// осталось висящих JVM, — после чего пробрасывается первая пойманная ошибка.
const runPool = async (tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> => {
    let next = 0;
    let firstError: unknown;
    const worker = async (): Promise<void> => {
        while (next < tasks.length && firstError === undefined) {
            const task = tasks[next++];
            try {
                await task();
            } catch (err) {
                if (firstError === undefined) firstError = err;
            }
        }
    };
    const width = Math.max(1, Math.min(concurrency, tasks.length));
    const workers: Promise<void>[] = [];
    for (let i = 0; i < width; i++) workers.push(worker());
    await Promise.all(workers);
    if (firstError !== undefined) throw firstError;
};

// Версия движка @terrastruct/d2 для чексуммы кэша (апгрейд движка → перерендер).
// Читаем package.json лениво и один раз: pure-PlantUML сборки его не трогают.
let d2VersionCache: string | null = null;
const d2EngineVersion = (): string => {
    if (d2VersionCache !== null) return d2VersionCache;
    try {
        const req = createRequire(import.meta.url);
        d2VersionCache = (req('@terrastruct/d2/package.json') as { version: string }).version;
    } catch {
        d2VersionCache = 'unknown';
    }
    return d2VersionCache;
};

// В ключ кеша: смена режима не должна отдавать картинку, отрисованную другим шрифтом
// (D2 тоже — его PNG растрирует общий resvg).
export const fontCacheTag = (options: BuildOptions): string =>
    options.USE_SYSTEM_FONTS ? 'system' : DEFAULT_FONT_NAME;

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
            return reject(new Error('PlantUML: не удалось открыть stdio-потоки процесса java'));
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
                    `PlantUML не завершился за ${RENDER_TIMEOUT_MS / 1000} c и был прерван` +
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
                return reject(new Error(`PlantUML завершился с кодом ${code}\n${errText}`));
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
export const generateImages = async (
    tree: TreeItem[],
    options: BuildOptions,
    onImageGenerated: ImageProgress | undefined,
    cacheConf: CacheConf,
    bkFolderName: string
): Promise<void> => {
    // Чексуммы прошлого прогона — в Set: попадание проверяется O(1) на диаграмму
    // (было O(N) find → O(N²) на всё дерево).
    const oldChecksums = new Set((cacheConf.get('checksums') as string[] | undefined) || []);
    // Каждой диаграмме — запись в порядке обхода дерева; ok выставляется задачей при
    // УСПЕХЕ (рендер или восстановление из бэкапа). В кеш пишем только успешные: иначе
    // упавший прогон терял бы чексуммы уже отрендеренных → их полный перерендер на
    // следующем запуске (см. persist в finally ниже).
    const checksumEntries: { cksum: string; ok: boolean }[] = [];

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
                `Выбор версии PlantUML удалён — сборка идёт вендорным JAR ${VENDORED_JAR.version}. ` +
                    `Ключ plantumlVersion: "${pinned}" в .c4builder можно убрать.`
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

    // D2-задачи гоняем отдельной очередью с конкурентностью 1: @terrastruct/d2 держит
    // ЕДИНСТВЕННЫЙ worker с одним currentResolve/currentReject без корреляции запросов —
    // два параллельных renderD2 затирают колбэк друг друга (промис виснет / результаты
    // перепутываются). Движок всё равно однопоточный, так что сериализация D2 бесплатна.
    // PlantUML — отдельные процессы java, их гоняем пулом renderConcurrency().
    const d2Tasks: Array<() => Promise<void>> = [];
    const otherTasks: Array<() => Promise<void>> = [];

    for (const item of tree) {
        for (const diagram of item.diagrams) {
            // Чексумма = контент диаграммы + свёрнутый граф её зависимостей, чтобы
            // правка включаемого/импортируемого файла инвалидировала кэш: PlantUML —
            // !include-граф (.iuml и пр.), D2 — граф @/...@-импортов.
            const body = `${diagram.content || ''}`;
            // entryPath нужен только D2 (граф импортов + рендер); для PlantUML не считаем.
            // entryPath !== null ⟺ engine === 'd2' — используем как сужение типа вместо assertion.
            const entryPath = diagram.engine === 'd2' ? path.join(item.dir, diagram.dir) : null;
            const includes =
                entryPath !== null
                    ? foldD2Imports(entryPath, body)
                    : foldIncludes(body, item.dir, item.dir, new Set());
            const outFormat = diagramOutputFormat(diagram, options);
            // renderKey: параметры, влияющие на БАЙТЫ вывода помимо контента и графа
            // импортов. Без него смена layout (D2) или charset (PlantUML) не меняла
            // чексумму → из бэкапа копировалась старая картинка (новые параметры молча
            // игнорировались, кэш чистился только через --reset). Формат/движок/версия
            // движка тоже в ключе: их смена обязана приводить к перерендеру.
            const renderKey =
                (entryPath !== null
                    ? `d2\0${d2EngineVersion()}\0layout=${options.D2_LAYOUT}\0fmt=${outFormat}`
                    : `puml\0${VENDORED_JAR.version}\0charset=${options.CHARSET}\0fmt=${outFormat}\0ditaa=${diagram.isDitaa}`) +
                `\0font=${fontCacheTag(options)}`;
            const outName = `${path.parse(diagram.dir).name}.${outFormat}`;
            const relOut = path.join(item.dir.replace(options.ROOT_FOLDER, ''), outName);
            // Путь выхода — тоже в чексумме: восстановление из бэкапа идёт по паре
            // «чексумма встречалась» + «бэкап с этим именем есть», иначе диаграммы,
            // обменявшиеся содержимым (или сдвинувшиеся имена fence-блоков плагинов),
            // молча получали бы чужую старую картинку.
            const cksum = crypto
                .createHash('sha256')
                .update(`${body}${includes}${renderKey}\0out=${relOut.split(path.sep).join('/')}`, 'utf-8')
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
                // поэтому кладём в общий пул (kind не важен).
                otherTasks.push(
                    withProgress(async () => {
                        fsextra.copyFileSync(bkFilePath, filePath);
                        cksumEntry.ok = true;
                    })
                );
                continue;
            }

            // PNG-выход не-ditaa диаграмм — растеризацией SVG (resvg), а не нативным
            // движком: единый детерминированный PNG для PlantUML и D2. ditaa остаётся
            // нативным PlantUML-PNG (у него нет SVG-представления) — не растеризуем.
            const needsRaster = outFormat === 'png' && !diagram.isDitaa;
            const diagramContent = diagram.content;
            const includePath = item.dir;
            const isDitaa = diagram.isDitaa;

            const task = withProgress(async () => {
                // render diagram to image: D2 через WASM, PlantUML — прямым вызовом java.
                // Для растеризации PlantUML не-ditaa рендерим в svg (не -tpng), затем resvg.
                let rendered: Buffer;
                try {
                    if (entryPath !== null) {
                        rendered = await renderD2(entryPath, { layout: options.D2_LAYOUT, seed: body });
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
                } catch (err: unknown) {
                    // Имя диаграммы в ошибку: renderDiagram/renderD2 сами его не знают.
                    throw new Error(`Диаграмма "${outName}": ${(err as Error).message || err}`);
                }
            });

            if (entryPath !== null) d2Tasks.push(task);
            else otherTasks.push(task);
        }
    }

    // PlantUML-пул и D2-очередь работают независимо (процессы java vs WASM-worker) и
    // параллельно друг другу. allSettled — чтобы падение одной очереди не оставляло
    // вторую как floating promise с висящими JVM: обе доосушаются, затем бросаем первую
    // ошибку (приоритет — PlantUML-пул, порядок между очередями не значим).
    try {
        const results = await Promise.allSettled([
            runPool(otherTasks, renderConcurrency()),
            runPool(d2Tasks, 1)
        ]);
        const failed = results.find((r) => r.status === 'rejected');
        if (failed && failed.status === 'rejected') throw failed.reason;
    } finally {
        // Персистим чексуммы даже при частичном падении: успешно обработанные диаграммы
        // не перерендерятся на следующем прогоне. Вместе с сохранением dist_bk при ошибке
        // (build.ts) повторный прогон после сбоя чинит только упавшую диаграмму.
        cacheConf.set(
            'checksums',
            checksumEntries.filter((e) => e.ok).map((e) => e.cksum)
        );
    }
};
