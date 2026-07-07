import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fsextra from 'fs-extra';
import { spawn } from 'node:child_process';

import { writeFile, VENDORED_JAR } from '../../util/utils.ts';
// D2-бэкенд: только статические хелперы (парсинг импортов) грузятся сразу; сам
// движок @terrastruct/d2 тянется лениво внутри renderD2/teardownD2.
import { renderD2, foldD2Imports } from './d2renderer.ts';
import { resolveJava } from './jre.ts';
// PNG-выход: SVG обоих движков растеризуется resvg (ленивая загрузка внутри модуля).
import { rasterizeSvgToPng } from './pngraster.ts';
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
}

// Колбэк прогресса рендера: сколько картинок обработано из общего числа.
export type ImageProgress = (processed: number, total: number) => void;

// Вендорный шрифт: ширина текста в SVG считается из AWT-метрик, поэтому
// шрифт пинуется, чтобы рендер не зависел от того, что установлено на машине.
const FONTS_DIR = path.join(VENDOR_DIR, 'fonts');
const DEFAULT_FONT_NAME = 'Liberation Sans';

export const getMime = (format: string): string => {
    if (format === 'svg') return `image/svg+xml`;
    return `image/${format}`;
};

export const httpGet = async (url: string): Promise<string> => {
    // return new pending promise
    return new Promise((resolve, reject) => {
        // select http or https module, depending on reqested url
        const lib = url.startsWith('https') ? https : http;
        const request = lib.get(url, (response) => {
            const status = response.statusCode as number; // ответ всегда со статусом
            // handle http errors
            if (status < 200 || status > 299) {
                reject(new Error(`Failed to load page ${url}, status code: ${status}`));
            }
            // temporary data holder
            const body: Buffer[] = [];
            // on every content chunk, push it to the data array
            response.on('data', (chunk) => body.push(chunk));
            // we are done, resolve promise with those joined chunks
            response.on('end', () => resolve(Buffer.concat(body).toString('base64')));
        });
        // handle connection errors of the request
        request.on('error', (err) => reject(err));
    });
};

// Прямой вызов PlantUML: layout считает встроенный Java-движок Smetana
// (`-Playout=smetana`), внешний graphviz/dot не нужен. Диаграмма подаётся в stdin
// (`-pipe`), результат читается из stdout — имя выходного файла задаёт c4builder,
// а не директива `@startuml <name>`. Include-путь и вендорный шрифт отдаются JVM.
// ditaa рендерит собственный движок (layout не участвует), а `-Playout=smetana`
// на нём меняет размер холста — поэтому для ditaa флаг не передаётся (выход
// байт-в-байт совпадает с историческим).
export const renderDiagram = (
    content: string | Buffer,
    { javaBin, jarPath, includePath, format, charset, isDitaa }: RenderDiagramOptions
): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const argv = [
            '-Djava.awt.headless=true',
            `-Dplantuml.include.path=${includePath}`,
            `-Dsun.java2d.fontpath=prepend:${FONTS_DIR}`,
            '-jar',
            jarPath,
            ...(isDitaa ? [] : ['-Playout=smetana']),
            `-SdefaultFontName=${DEFAULT_FONT_NAME}`,
            '-charset',
            charset,
            `-t${format}`,
            '-pipe'
        ];

        const child = spawn(javaBin, argv);
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];

        // stdio по умолчанию 'pipe' → потоки заведомо не null; берём их деструктуризацией
        // с одним guard вместо non-null assertion на каждом обращении.
        const { stdin, stdout: childOut, stderr: childErr } = child;
        if (!stdin || !childOut || !childErr) {
            return reject(new Error('PlantUML: не удалось открыть stdio-потоки процесса java'));
        }
        childOut.on('data', (chunk) => stdout.push(chunk));
        childErr.on('data', (chunk) => stderr.push(chunk));
        child.on('error', reject); // java не найдена и пр.
        child.on('close', (code) => {
            // Smetana печатает диагностический шум (UNSURE_ABOUT…) — это не ошибка
            // рендера, пользователю не показываем; остальной stderr пробрасываем.
            const errText = Buffer.concat(stderr)
                .toString('utf8')
                .split('\n')
                .filter((line) => line.trim() && !/UNSURE_ABOUT/.test(line))
                .join('\n');
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
    // Get the old checksums (from last run) of all PUML-files
    const oldChecksums = (cacheConf.get('checksums') as string[] | undefined) || [];
    const newChecksums: string[] = [];

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

    // JRE резолвится ЛЕНИВО и один раз за сборку: только если в дереве есть хотя бы одна
    // PlantUML-диаграмма. Проект целиком на D2 java не трогает (скачивание не инициируется).
    const needsJava = tree.some((item) => item.diagrams.some((d) => d.engine === 'plantuml'));
    let javaBin: string | null = null;
    if (needsJava) {
        javaBin = (await resolveJava({ log: (m) => console.log(chalk.gray(m)) })).path;
    }

    for (const item of tree) {
        totalImages += item.diagrams.length;
    }

    const taskList: Promise<void>[] = [];

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
                    ? foldD2Imports(entryPath)
                    : foldIncludes(body, item.dir, item.dir, new Set());
            const cksum = crypto
                .createHash('sha256')
                .update(body + includes, 'utf-8')
                .digest('hex');

            const outName = `${path.parse(diagram.dir).name}.${diagramOutputFormat(diagram, options)}`;

            // path to backup image file
            const bkFilePath = path.join(bkFolderName, item.dir.replace(options.ROOT_FOLDER, ''), outName);

            // path to image in dist folder
            const filePath = path.join(
                options.DIST_FOLDER,
                item.dir.replace(options.ROOT_FOLDER, ''),
                outName
            );

            // if checksum exists (diagram untouched) and file/image exists - copy image back from backup folder
            if (oldChecksums.find((x) => x === cksum) && (await fs.existsSync(bkFilePath))) {
                await fsextra.copyFileSync(bkFilePath, filePath);
            } else {
                const outFormat = diagramOutputFormat(diagram, options);
                // PNG-выход не-ditaa диаграмм — растеризацией SVG (resvg), а не нативным
                // движком: единый детерминированный PNG для PlantUML и D2. ditaa остаётся
                // нативным PlantUML-PNG (у него нет SVG-представления) — не растеризуем.
                const needsRaster = outFormat === 'png' && !diagram.isDitaa;
                // render diagram to image: D2 через WASM, PlantUML — прямым вызовом java.
                // Для растеризации PlantUML не-ditaa рендерим в svg (не -tpng), затем resvg.
                let rendered: Promise<Buffer>;
                if (entryPath !== null) {
                    rendered = renderD2(entryPath, { layout: options.D2_LAYOUT });
                } else {
                    // needsJava гарантирует резолв для plantuml-ветки; guard — нарратив для типов.
                    if (!javaBin) throw new Error('PlantUML: JRE не резолвнут для plantuml-диаграммы');
                    rendered = renderDiagram(diagram.content, {
                        javaBin,
                        jarPath,
                        includePath: item.dir,
                        format: needsRaster ? 'svg' : outFormat,
                        charset: options.CHARSET,
                        isDitaa: diagram.isDitaa
                    });
                }

                const render = rendered
                    .then((image) => (needsRaster ? rasterizeSvgToPng(image) : image))
                    .then((image) => writeFile(filePath, image));

                taskList.push(render);
            }

            const taskPromises = Promise.all(taskList).then(() => {
                processedImages++;
                if (onImageGenerated) onImageGenerated(processedImages, totalImages);
            });

            await taskPromises;

            // Add diagram checksum
            newChecksums.push(cksum);
        }
    }

    // store all puml checksums
    cacheConf.set('checksums', newChecksums);
};
