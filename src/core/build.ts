import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fsextra from 'fs-extra';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import defaultDocsifyTemplate from './compose/docsify.template.ts';
import {
    encodeURIPath,
    makeDirectory,
    readFile,
    writeFile,
    plantUmlServerUrl,
    VENDORED_JAR
} from '../util/utils.ts';
// D2-бэкенд: только статические хелперы (парсинг импортов) грузятся сразу; сам
// движок @terrastruct/d2 тянется лениво внутри renderD2/teardownD2.
import { renderD2, foldD2Imports, teardownD2 } from './render/d2renderer.ts';
import { resolveJava } from './render/jre.ts';
// PNG-выход: SVG обоих движков растеризуется resvg (ленивая загрузка внутри модуля).
import { rasterizeSvgToPng } from './render/pngraster.ts';
import { VENDOR_DIR } from '../util/paths.ts';
import type { BuildOptions } from '../config/options.ts';

// Внутренние структуры монолита (границы будущих модулей build-split).
interface Diagram {
    dir: string; // имя файла диаграммы (историческое поле)
    ext: string;
    engine: string; // 'plantuml' | 'd2'
    content: string | Buffer;
    isDitaa: boolean;
}

interface TreeItem {
    dir: string;
    name: string;
    level: number;
    parent?: string;
    mdFiles: (string | Buffer)[];
    diagrams: Diagram[];
    descendants: string[];
}

// cacheConf: Configstore-подобная заглушка чексумм (см. cli/dispatch).
interface CacheConf {
    get(key: string): any;
    set(key: string, value: unknown): void;
}

// Параметры прямого вызова PlantUML (renderDiagram).
interface RenderDiagramOptions {
    javaBin: string;
    jarPath: string;
    includePath: string;
    format: string;
    charset: string;
    isDitaa: boolean;
}

// Стратегия подстановки диаграммы в markdown (embed/link/img) — задаётся вызывающим.
type GetDiagram = (item: TreeItem, diagram: Diagram, options: BuildOptions) => Promise<string>;

// docsifyTemplate можно переопределить пользовательским шаблоном (см. generateWebMD),
// поэтому это mutable-локаль, а не const-импорт; user-шаблон грузим синхронно через createRequire.
const require = createRequire(import.meta.url);
let docsifyTemplate = defaultDocsifyTemplate;

const DIST_BACKUP_FOLDER_SUFFIX = '_bk';

// Вендорный шрифт: ширина текста в SVG считается из AWT-метрик, поэтому
// шрифт пинуется, чтобы рендер не зависел от того, что установлено на машине.
const FONTS_DIR = path.join(VENDOR_DIR, 'fonts');
const DEFAULT_FONT_NAME = 'Liberation Sans';

// Формат выходного файла диаграммы: ditaa всегда PNG (нативный, без SVG-представления),
// иначе — выбранный DIAGRAM_FORMAT. При png не-ditaa рендерится в SVG и растеризуется
// (см. рендер ниже), поэтому D2 тоже честно поддерживает png (раньше молча оставался SVG).
const diagramOutputFormat = (diagram: Diagram, options: BuildOptions): string =>
    diagram.isDitaa ? 'png' : options.DIAGRAM_FORMAT;

const getMime = (format: string): string => {
    if (format === 'svg') return `image/svg+xml`;
    return `image/${format}`;
};

const httpGet = async (url: string): Promise<string> => {
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

const getFolderName = (dir: string, root: string, homepage: string): string => {
    return dir === root ? homepage : path.parse(dir).base;
};

const generateTree = async (dir: string, options: BuildOptions): Promise<TreeItem[]> => {
    const tree: TreeItem[] = [];

    const build = async (dir: string, parent?: string): Promise<void> => {
        // Skip output folder - this allows a user to use the top-level folder as ROOT_FOLDER.
        if (dir === options.DIST_FOLDER) {
            return;
        }

        const name = getFolderName(dir, options.ROOT_FOLDER, options.HOMEPAGE_NAME);
        let item = tree.find((x) => x.dir === dir);
        if (!item) {
            item = {
                dir: dir,
                name: name,
                level: dir.split(path.sep).length,
                parent: parent,
                mdFiles: [],
                diagrams: [],
                descendants: []
            };
            tree.push(item);
        }

        const IGNORED_FILES = ['CLAUDE.md'];
        const files = fs.readdirSync(dir).filter((x) => x.charAt(0) !== '_' && !IGNORED_FILES.includes(x));
        for (const file of files) {
            //if folder
            if (fs.statSync(path.join(dir, file)).isDirectory()) {
                item.descendants.push(file);
                //create corresponding dist folder
                if (options.GENERATE_WEBSITE || options.GENERATE_MD || options.GENERATE_LOCAL_IMAGES)
                    await makeDirectory(
                        path.join(options.DIST_FOLDER, dir.replace(options.ROOT_FOLDER, ''), file)
                    );

                await build(path.join(dir, file), dir);
            }
        }

        const mdFiles = files.filter((x) => path.extname(x).toLowerCase() === '.md');
        for (const mdFile of mdFiles) {
            const fileContents = await readFile(path.join(dir, mdFile));
            item.mdFiles.push(fileContents);
        }
        // Диаграммы обоих бэкендов: .puml → PlantUML, .d2 → D2. Поле dir — имя файла
        // (историческое), engine выбирает рендерер, isDitaa — только для PlantUML.
        const diagramFiles = files.filter((x) => ['.puml', '.d2'].includes(path.extname(x).toLowerCase()));
        for (const diagramFile of diagramFiles) {
            const ext = path.extname(diagramFile).toLowerCase();
            const engine = ext === '.d2' ? 'd2' : 'plantuml';
            const fileContents = await readFile(path.join(dir, diagramFile));
            const isDitaa =
                engine === 'plantuml' &&
                !!(fileContents ? fileContents.toString() : '').match(/(@startditaa)/gi);
            item.diagrams.push({ dir: diagramFile, ext, engine, content: fileContents, isDitaa });
        }
        item.diagrams.sort((a, b) => `${a.dir}`.localeCompare(b.dir));

        //copy all other files (.d2 исходники, как и .puml, не копируем — они рендерятся)
        const otherFiles = options.EXCLUDE_OTHER_FILES
            ? []
            : files.filter(
                  (x) =>
                      x.charAt(0) === '_' ||
                      ['.md', '.puml', '.d2'].indexOf(path.extname(x).toLowerCase()) === -1
              );

        for (const otherFile of otherFiles) {
            if (fs.statSync(path.join(dir, otherFile)).isDirectory()) continue;

            if (options.GENERATE_MD || options.GENERATE_WEBSITE)
                await fsextra.copy(
                    path.join(dir, otherFile),
                    path.join(options.DIST_FOLDER, dir.replace(options.ROOT_FOLDER, ''), otherFile)
                );
            if (options.GENERATE_COMPLETE_MD_FILE)
                await fsextra.copy(path.join(dir, otherFile), path.join(options.DIST_FOLDER, otherFile));
        }
    };

    await build(dir);

    // Диаграммы именуются по basename исходника, поэтому foo.puml и foo.d2 в одной
    // папке при одном формате дают один выходной файл и затирают друг друга —
    // отлавливаем это явной ошибкой, а не молчаливой потерей одной из диаграмм.
    for (const item of tree) {
        const seen = new Map<string, string>();
        for (const d of item.diagrams) {
            const out = `${path.parse(d.dir).name}.${diagramOutputFormat(d, options)}`;
            if (seen.has(out))
                throw new Error(
                    `Коллизия имени выхода '${out}' в ${item.dir}: '${seen.get(out)}' и '${d.dir}' ` +
                        `рендерятся в один файл. Переименуйте одну из диаграмм.`
                );
            seen.set(out, d.dir);
        }
    }

    return tree;
};

// Свернуть локальные !include (.iuml и пр.) диаграммы в материал для чексуммы — рекурсивно.
// Иначе правка включённого .iuml не инвалидирует кэш и на сайт уезжает устаревший рендер.
// URL (!include https://…) и stdlib (!include <…>) пропускаем: локально не меняются.
const foldIncludes = (
    content: string,
    fileDir: string,
    searchDir: string,
    visited: Set<string>
): string => {
    const re = /^[ \t]*!include(?:_once|_many|sub|url)?[ \t]+(.+?)[ \t]*$/gim;
    let out = '';
    let m;
    // biome-ignore lint/suspicious/noAssignInExpressions: идиома regex.exec() в условии while
    while ((m = re.exec(content)) !== null) {
        const ref = m[1]
            .trim()
            .replace(/^["']|["']$/g, '')
            .split('!')[0]
            .trim(); // снять кавычки и !subpart
        if (!ref || /^https?:\/\//i.test(ref) || ref.startsWith('<')) continue;
        // PlantUML резолвит include от каталога файла с директивой, затем от include-пути (item.dir)
        const resolved = [path.resolve(fileDir, ref), path.resolve(searchDir, ref)].find(
            (p) => fs.existsSync(p) && fs.statSync(p).isFile()
        );
        if (!resolved || visited.has(resolved)) continue; // защита от циклов и повторов
        visited.add(resolved);
        let inc = '';
        try {
            inc = fs.readFileSync(resolved, 'utf-8');
        } catch {
            continue;
        }
        out += ` ${resolved} ${inc}`;
        out += foldIncludes(inc, path.dirname(resolved), searchDir, visited); // вложенные include
    }
    return out;
};

// Прямой вызов PlantUML: layout считает встроенный Java-движок Smetana
// (`-Playout=smetana`), внешний graphviz/dot не нужен. Диаграмма подаётся в stdin
// (`-pipe`), результат читается из stdout — имя выходного файла задаёт c4builder,
// а не директива `@startuml <name>`. Include-путь и вендорный шрифт отдаются JVM.
// ditaa рендерит собственный движок (layout не участвует), а `-Playout=smetana`
// на нём меняет размер холста — поэтому для ditaa флаг не передаётся (выход
// байт-в-байт совпадает с историческим).
const renderDiagram = (
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

        // stdio по умолчанию 'pipe' → потоки заведомо не null (assert снимает strict-null).
        child.stdout!.on('data', (chunk) => stdout.push(chunk));
        child.stderr!.on('data', (chunk) => stderr.push(chunk));
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

        child.stdin!.on('error', () => {}); // EPIPE, если java упала до чтения stdin
        child.stdin!.write(content);
        child.stdin!.end();
    });

const generateImages = async (
    tree: TreeItem[],
    options: BuildOptions,
    onImageGenerated: ((processed: number, total: number) => void) | undefined,
    cacheConf: CacheConf
): Promise<void> => {
    // Get the old checksums (from last run) of all PUML-files
    const oldChecksums: string[] = cacheConf.get('checksums') || [];
    const newChecksums: string[] = [];
    const bkFolderName = options.DIST_FOLDER + DIST_BACKUP_FOLDER_SUFFIX;

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
            const entryPath = diagram.engine === 'd2' ? path.join(item.dir, diagram.dir) : null;
            const includes =
                diagram.engine === 'd2'
                    ? foldD2Imports(entryPath!)
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
                const rendered =
                    diagram.engine === 'd2'
                        ? renderD2(entryPath!, { layout: options.D2_LAYOUT })
                        : renderDiagram(diagram.content, {
                              javaBin: javaBin!, // needsJava → резолвнут для plantuml-ветки
                              jarPath,
                              includePath: item.dir,
                              format: needsRaster ? 'svg' : outFormat,
                              charset: options.CHARSET,
                              isDitaa: diagram.isDitaa
                          });

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

// Если первый md-файл уже начинается с заголовка h1 — авто-заголовок страницы
// по имени папки/файла не добавляем, чтобы не было двух заголовков подряд.
// Проверяем только первый md-файл: именно он окажется сразу за авто-заголовком
// в compileDocument, поэтому только он может породить визуальный дубль.
// Лидирующий BOM (﻿) учитываем — md-файлы из Windows/редакторов часто с ним.
const hasOwnH1 = (item: TreeItem): boolean => {
    if (!item.mdFiles || item.mdFiles.length === 0) return false;
    return /^﻿?\s*#\s+\S/.test(item.mdFiles[0].toString());
};

// Вставить блок (breadcrumb / TOC / навигация) сразу после первого h1.
// Используется когда у пользователя свой h1 — авто-заголовок не ставится,
// а служебный блок должен оказаться ПОД заголовком, как было раньше.
const injectAfterFirstH1 = (md: string, block: string): string => {
    if (!block) return md;
    const m = md.match(/^([\s\S]*?#\s+[^\n]*\n)/);
    if (!m) return `${block}\n\n${md}`;
    return m[1] + block + md.slice(m[1].length);
};

const compileDocument = async (
    md: string,
    item: TreeItem,
    options: BuildOptions,
    getDiagram: GetDiagram
): Promise<string> => {
    let MD = md;
    const alreadyIncluded: string[] = [];
    const texts: string[] = [];
    const diagrams: string[] = [];
    const regex = /(?:!\[.*?\]\()(.*\.(?:puml|d2))(\))/g;

    for (const mdFile of item.mdFiles) {
        let content = mdFile.toString();

        let diagramRef: RegExpExecArray | null;
        // biome-ignore lint/suspicious/noAssignInExpressions: идиома regex.exec() в условии while
        while ((diagramRef = regex.exec(content)) !== null) {
            if (diagramRef?.[1]) {
                const diagram = item.diagrams.find((x) => x.dir === diagramRef![1]);
                if (diagram) {
                    alreadyIncluded.push(diagramRef[1]);
                    content = content.replace(diagramRef[0], await getDiagram(item, diagram, options));
                }
            }
        }
        texts.push(content);
    }
    for (const diagram of item.diagrams) {
        if (alreadyIncluded.find((x) => x === diagram.dir)) {
            continue;
        }

        diagrams.push(await getDiagram(item, diagram, options));
    }

    let fullDoc = [];
    if (options.DIAGRAMS_ON_TOP) {
        fullDoc = [...diagrams, ...texts];
    } else {
        fullDoc = [...texts, ...diagrams];
    }

    for (const doc of fullDoc) {
        MD += '\n\n';
        MD += doc;
    }

    return MD;
};

const generateCompleteMD = async (tree: TreeItem[], options: BuildOptions): Promise<void[]> => {
    const filePromises: Promise<void>[] = [];

    //title
    let MD = `# ${options.PROJECT_NAME}`;
    //table of contents
    let tableOfContents = '';
    for (const item of tree)
        tableOfContents += `${'  '.repeat(item.level - 1)}* [${item.name}](#${encodeURIPath(
            item.name
        ).replace(/%20/g, '-')})\n`;
    MD += `\n\n${tableOfContents}\n---`;

    for (const item of tree) {
        const name = getFolderName(item.dir, options.ROOT_FOLDER, options.HOMEPAGE_NAME);

        //title
        MD += `\n\n## ${name}`;
        if (name !== options.HOMEPAGE_NAME) {
            if (options.INCLUDE_BREADCRUMBS) MD += `\n\n\`${item.dir.replace(options.ROOT_FOLDER, '')}\``;
            MD += `\n\n[${options.HOMEPAGE_NAME}](#${encodeURIPath(options.PROJECT_NAME).replace(
                /%20/g,
                '-'
            )})`;
        }

        //concatenate markdown files
        MD = await compileDocument(MD, item, options, async (item, diagram, options) => {
            let diagramUrl = encodeURIPath(
                path.join(
                    path.dirname(diagram.dir),
                    `${path.parse(diagram.dir).name}.${diagramOutputFormat(diagram, options)}`
                )
            );
            if (!options.GENERATE_LOCAL_IMAGES && diagram.engine === 'plantuml')
                diagramUrl = plantUmlServerUrl(
                    options.PLANTUML_SERVER_URL,
                    diagramOutputFormat(diagram, options),
                    diagram.content as string // рендер-контент диаграммы (Buffer читается как текст)
                );

            if (options.EMBED_DIAGRAM) {
                let imgContent = '';
                if (options.GENERATE_LOCAL_IMAGES)
                    imgContent = (
                        await readFile(
                            path.join(
                                options.DIST_FOLDER,
                                item.dir.replace(options.ROOT_FOLDER, ''),
                                diagramUrl
                            )
                        ) as Buffer
                    ).toString('base64');
                else imgContent = await httpGet(diagramUrl);

                const diagramImage = `\n![${path.parse(diagram.dir).name}](data:${getMime(
                    diagramOutputFormat(diagram, options)
                )};base64,${imgContent})\n`;

                const diagramLink = `\n[Download ${path.parse(diagram.dir).name} diagram](${encodeURIPath(
                    path.join(item.dir.replace(options.ROOT_FOLDER, ''), diagramUrl)
                )} ':ignore')`;
                return diagramImage + diagramLink;
            } else {
                const diagramImage = `![diagram](${diagramUrl})`;
                const diagramLink = `[Go to ${path.parse(diagram.dir).name} diagram](${encodeURIPath(
                    path.join(item.dir.replace(options.ROOT_FOLDER, ''), diagramUrl)
                )})`;
                if (!options.INCLUDE_LINK_TO_DIAGRAM)
                    //img
                    return diagramImage;
                //link
                else return diagramLink;
            }
        });
    }

    //write file to disk
    filePromises.push(writeFile(path.join(options.DIST_FOLDER, `${options.PROJECT_NAME}.md`), MD));

    return Promise.all(filePromises);
};

const generateMD = async (
    tree: TreeItem[],
    options: BuildOptions,
    onProgress?: (processed: number, total: number) => void
): Promise<void[]> => {
    let processedCount = 0;
    const totalCount = tree.length;

    const filePromises: Promise<void>[] = [];
    for (const item of tree) {
        const name = getFolderName(item.dir, options.ROOT_FOLDER, options.HOMEPAGE_NAME);
        const ownH1 = hasOwnH1(item);
        //title
        let MD = ownH1 ? '' : `# ${name}`;

        // "Page chrome" — breadcrumb / TOC / навигация. Собираем отдельно, чтобы при
        // наличии собственного h1 у пользователя поместить весь блок ПОД его заголовок,
        // а не над ним (как было исторически — между авто-# name и контентом).
        let chrome = '';
        //bradcrumbs
        if (options.INCLUDE_BREADCRUMBS && name !== options.HOMEPAGE_NAME)
            chrome += `\n\n\`${item.dir.replace(options.ROOT_FOLDER, '')}\``;
        //table of contents
        if (options.INCLUDE_TABLE_OF_CONTENTS) {
            let tableOfContents = '';
            for (const _item of tree) {
                const label = `${item.dir === _item.dir ? '**' : ''}${_item.name}${
                    item.dir === _item.dir ? '**' : ''
                }`;
                tableOfContents += `${'  '.repeat(_item.level - 1)}* [${label}](${encodeURIPath(
                    path.join(
                        './',
                        item.level - 1 > 0 ? '../'.repeat(item.level - 1) : '',
                        _item.dir.replace(options.ROOT_FOLDER, ''),
                        `${options.MD_FILE_NAME}.md`
                    )
                )})\n`; //slice 1 if root and down
            }
            chrome += `\n\n${tableOfContents}\n---`;
        }
        //parent menu
        if (item.parent && options.INCLUDE_NAVIGATION) {
            const parentName = getFolderName(item.parent, options.ROOT_FOLDER, options.HOMEPAGE_NAME);
            chrome += `\n\n[${parentName} (up)](${encodeURIPath(
                path.join(
                    './',
                    item.level - 1 > 0 ? '../'.repeat(item.level - 1) : '',
                    item.parent.replace(options.ROOT_FOLDER, ''),
                    `${options.MD_FILE_NAME}.md`
                )
            )})`;
        }

        //exclude files and folders prefixed with _
        let descendantsMenu = '';
        for (const file of item.descendants) {
            descendantsMenu += `\n\n- [${file}](${encodeURIPath(
                path.join(
                    './',
                    item.level - 1 > 0 ? '../'.repeat(item.level - 1) : '',
                    item.dir.replace(options.ROOT_FOLDER, ''),
                    file,
                    `${options.MD_FILE_NAME}.md`
                )
            )})`;
        }
        //descendants menu
        if (descendantsMenu && options.INCLUDE_NAVIGATION) chrome += `${descendantsMenu}`;
        //separator
        if (options.INCLUDE_NAVIGATION) chrome += `\n\n---`;

        // Если своего h1 нет — chrome идёт сразу после авто-заголовка, как раньше.
        // Если есть — chrome будет вставлен после пользовательского h1 пост-обработкой.
        if (!ownH1) MD += chrome;

        //concatenate markdown files
        MD = await compileDocument(MD, item, options, async (item, diagram, options) => {
            let diagramUrl = encodeURIPath(
                path.join(
                    path.dirname(diagram.dir),
                    `${path.parse(diagram.dir).name}.${diagramOutputFormat(diagram, options)}`
                )
            );
            if (!options.GENERATE_LOCAL_IMAGES && diagram.engine === 'plantuml')
                diagramUrl = plantUmlServerUrl(
                    options.PLANTUML_SERVER_URL,
                    diagramOutputFormat(diagram, options),
                    diagram.content as string // рендер-контент диаграммы (Buffer читается как текст)
                );

            if (options.EMBED_DIAGRAM) {
                let imgContent = '';
                if (options.GENERATE_LOCAL_IMAGES)
                    imgContent = (
                        await readFile(
                            path.join(
                                options.DIST_FOLDER,
                                item.dir.replace(options.ROOT_FOLDER, ''),
                                diagramUrl
                            )
                        ) as Buffer
                    ).toString('base64');
                else imgContent = await httpGet(diagramUrl);

                const diagramImage = `\n![${path.parse(diagram.dir).name}](data:${getMime(
                    diagramOutputFormat(diagram, options)
                )};base64,${imgContent})\n`;

                const diagramLink = `[Download ${
                    path.parse(diagram.dir).name
                } diagram](${diagramUrl} ':ignore')`;
                return diagramImage + diagramLink;
            } else {
                const diagramImage = `![diagram](${diagramUrl})`;
                const diagramLink = `[Go to ${path.parse(diagram.dir).name} diagram](${diagramUrl})`;
                if (!options.INCLUDE_LINK_TO_DIAGRAM)
                    //img
                    return diagramImage;
                //link
                else return diagramLink;
            }
        });

        // Если был свой h1 — вставляем chrome (breadcrumbs/TOC/nav) после него.
        if (ownH1) MD = injectAfterFirstH1(MD, chrome);

        //write to disk
        filePromises.push(
            writeFile(
                path.join(
                    options.DIST_FOLDER,
                    item.dir.replace(options.ROOT_FOLDER, ''),
                    `${options.MD_FILE_NAME}.md`
                ),
                MD.trimStart()
            ).then(() => {
                processedCount++;
                if (onProgress) onProgress(processedCount, totalCount);
            })
        );
    }

    return Promise.all(filePromises);
};

const generateWebMD = async (tree: TreeItem[], options: BuildOptions): Promise<void[]> => {
    const filePromises: Promise<void>[] = [];
    let docsifySideBar = '';

    const getWebFileName = (originalFileName: string): string =>
        options.WEB_FILE_NAME || originalFileName;

    const isExcluded = (dir: string) => {
        if (!Array.isArray(options.EXCLUDE_SIDEBAR_FOLDER_BY_PATH)) return false;

        return options.EXCLUDE_SIDEBAR_FOLDER_BY_PATH.find((pathToExclude) => {
            const isString = typeof pathToExclude === 'string';

            if (isString) return dir.startsWith(pathToExclude);

            return false;
        });
    };

    for (const item of tree) {
        //sidebar
        if (!isExcluded(item.dir)) {
            docsifySideBar += `${'  '.repeat(item.level - 1)}* [${item.name}](${encodeURIPath(
                path.join(...path.join(item.dir).split(path.sep).splice(1), getWebFileName(item.name))
            )})\n`;
        }
        const name = getFolderName(item.dir, options.ROOT_FOLDER, options.HOMEPAGE_NAME);

        //title
        let MD = hasOwnH1(item) ? '' : `# ${name}`;

        //concatenate markdown files
        MD = await compileDocument(MD, item, options, async (item, diagram, options) => {
            let diagramUrl = encodeURIPath(
                path.join(
                    path.dirname(diagram.dir),
                    `${path.parse(diagram.dir).name}.${diagramOutputFormat(diagram, options)}`
                )
            );
            if (!options.GENERATE_LOCAL_IMAGES && diagram.engine === 'plantuml')
                diagramUrl = plantUmlServerUrl(
                    options.PLANTUML_SERVER_URL,
                    diagramOutputFormat(diagram, options),
                    diagram.content as string // рендер-контент диаграммы (Buffer читается как текст)
                );

            if (options.EMBED_DIAGRAM) {
                let imgContent = '';
                if (options.GENERATE_LOCAL_IMAGES)
                    imgContent = (
                        await readFile(
                            path.join(
                                options.DIST_FOLDER,
                                item.dir.replace(options.ROOT_FOLDER, ''),
                                diagramUrl
                            )
                        ) as Buffer
                    ).toString('base64');
                else imgContent = await httpGet(diagramUrl);

                const diagramImage = `\n![${path.parse(diagram.dir).name}](data:${getMime(
                    diagramOutputFormat(diagram, options)
                )};base64,${imgContent})\n`;

                const diagramLink = `[Download ${
                    path.parse(diagram.dir).name
                } diagram](${diagramUrl} ':ignore')`;

                return diagramImage + diagramLink;
            } else {
                const diagramImage = `![diagram](${diagramUrl})`;
                const diagramLink = `[Go to ${path.parse(diagram.dir).name} diagram](${diagramUrl})`;
                if (!options.INCLUDE_LINK_TO_DIAGRAM)
                    //img
                    return diagramImage;
                //link
                else return diagramLink;
            }
        });

        MD = MD.trimStart();

        //write to disk
        filePromises.push(
            writeFile(
                path.join(
                    options.DIST_FOLDER,
                    item.dir.replace(options.ROOT_FOLDER, ''),
                    `${getWebFileName(item.name)}.md`
                ),
                MD
            )
        );
    }

    if (options.DOCSIFY_TEMPLATE && options.DOCSIFY_TEMPLATE !== '') {
        docsifyTemplate = require(path.join(process.cwd(), options.DOCSIFY_TEMPLATE));
    }

    const getRootName = (): TreeItem | undefined => tree.find((item) => !item.parent);

    //docsify homepage
    filePromises.push(
        writeFile(
            path.join(options.DIST_FOLDER, `index.html`),
            docsifyTemplate({
                name: options.PROJECT_NAME,
                repo: options.REPO_NAME,
                loadSidebar: true,
                auto2top: true,
                homepage: `${options.WEB_FILE_NAME || getRootName()!.name}.md`,
                plantuml: {
                    skin: 'classic'
                },
                stylesheet: options.WEB_THEME,
                alias: { '/.*/_sidebar.md': '/_sidebar.md' },
                supportSearch: options.SUPPORT_SEARCH,
                executeScript: options.EXECUTE_SCRIPT
            })
        )
    );

    //copy local docsify vendor files to dist
    const docsifyVendorSrc = path.join(VENDOR_DIR, 'docsify');
    if (fs.existsSync(docsifyVendorSrc)) {
        filePromises.push(fsextra.copy(docsifyVendorSrc, path.join(options.DIST_FOLDER, 'vendor')));
    }

    //github pages preparation
    filePromises.push(writeFile(path.join(options.DIST_FOLDER, `.nojekyll`), ''));

    //sidebar
    filePromises.push(writeFile(path.join(options.DIST_FOLDER, '_sidebar.md'), docsifySideBar));

    return Promise.all(filePromises);
};

const build = async (options: BuildOptions, cacheConf: CacheConf): Promise<void> => {
    const start_date = new Date();
    const bkFolderName = options.DIST_FOLDER + DIST_BACKUP_FOLDER_SUFFIX;

    // Generating local images, remove old backup image folder, rename current dist folder to new backup
    if (options.GENERATE_LOCAL_IMAGES) {
        await fsextra.removeSync(bkFolderName);
        if (await fsextra.existsSync(options.DIST_FOLDER)) {
            await fsextra.rename(options.DIST_FOLDER, bkFolderName);
        }
    } else {
        //clear dist directory
        await fsextra.emptyDir(options.DIST_FOLDER);
    }
    await makeDirectory(path.join(options.DIST_FOLDER));

    //actual build
    console.log(chalk.green(`\nbuilding documentation in ./${options.DIST_FOLDER}`));
    const tree = await generateTree(options.ROOT_FOLDER, options);
    console.log(chalk.blue(`parsed ${tree.length} folders`));

    // У D2 нет онлайн-сервера рендера (в отличие от PlantUML): без локальной
    // генерации .d2 не во что превратить — ссылки на SVG вели бы в никуда.
    // Падаем сразу с понятной ошибкой, а не молча битым выводом.
    if (!options.GENERATE_LOCAL_IMAGES && tree.some((item) => item.diagrams.some((d) => d.engine === 'd2'))) {
        throw new Error(
            'В проекте есть .d2-диаграммы, но generateLocalImages выключен. У D2 нет ' +
                'онлайн-сервера рендера — включите локальную генерацию изображений (generateLocalImages).'
        );
    }

    if (options.GENERATE_LOCAL_IMAGES) {
        console.log(chalk.blue('generating images'));
        await generateImages(
            tree,
            options,
            (count, total) => {
                process.stdout.write(`processed ${count}/${total} images\r`);
            },
            cacheConf
        );
        console.log('');
    }
    if (options.GENERATE_MD) {
        console.log(chalk.blue('generating markdown files'));
        await generateMD(tree, options, (count, total) => {
            process.stdout.write(`processed ${count}/${total} files\r`);
        });
        console.log('');
    }
    if (options.GENERATE_WEBSITE) {
        console.log(chalk.blue('generating docsify site'));
        await generateWebMD(tree, options);
    }
    if (options.GENERATE_COMPLETE_MD_FILE) {
        console.log(chalk.blue('generating complete markdown file'));
        await generateCompleteMD(tree, options);
    }
    // PDF-вывод удалён. Легаси-конфиг с truthy generatePDF/generateCompletePDF не
    // роняем: печатаем предупреждение с реально присутствующими ключами и собираем
    // остальные выходы (exit 0). Конфиг НЕ мутируем — только подсказка пользователю.
    if (options.LEGACY_PDF_KEYS?.length) {
        console.log(chalk.bold(chalk.yellow('WARNING:')));
        console.log(
            chalk.yellow(
                `PDF-вывод больше не поддерживается. Удалите вручную из .c4builder: ${options.LEGACY_PDF_KEYS.join(
                    ', '
                )}.`
            )
        );
    }

    // Remove image backup folder
    await fsextra.removeSync(bkFolderName);

    // Освободить D2-инстанс (webworker), иначе процесс не завершится. No-op, если .d2 не было.
    await teardownD2();

    console.log(chalk.green(`built in ${(Date.now() - start_date.getTime()) / 1000} seconds`));
};
export { build };
