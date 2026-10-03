import fs from 'node:fs';
import path from 'node:path';
import fsextra from 'fs-extra';
import { createRequire } from 'node:module';

import defaultDocsifyTemplate from './docsify.template.ts';
import { encodeURIPath, readFile, writeFile, plantUmlServerUrl } from '../../util/utils.ts';
import { VENDOR_DIR } from '../../util/paths.ts';
// Фаза scan: тип дерева и его элементов + производные (имя папки, формат выхода диаграммы)
// и единый реестр расширений диаграмм (источник истины для regex ссылок ниже).
import {
    getFolderName,
    diagramOutputFormat,
    DIAGRAM_ENGINES,
    engineSupportsRemote,
    collectIncludes,
    type TreeItem,
    type Diagram
} from '../scan/tree.ts';
// Фаза render: mime-тип формата и загрузка удалённо отрендеренной картинки (embed-ветка).
import { getMime, httpGet } from '../render/diagrams.ts';
// Граф D2-импортов — тот же, что у рендера (приложение llms-full.txt).
import { d2LocalImports } from '../render/d2renderer.ts';
import type { BuildOptions } from '../../config/options.ts';

// Стратегия подстановки диаграммы в markdown (embed/link/img) — задаётся вызывающим.
type GetDiagram = (item: TreeItem, diagram: Diagram, options: BuildOptions) => Promise<string>;

// docsifyTemplate можно переопределить пользовательским шаблоном (см. generateWebMD),
// поэтому это mutable-локаль, а не const-импорт; user-шаблон грузим синхронно через createRequire.
const require = createRequire(import.meta.url);
let docsifyTemplate = defaultDocsifyTemplate;

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

// Расширения диаграмм без точки, экранированные для regex. Источник истины — реестр
// DIAGRAM_ENGINES из фазы scan (scan/tree.ts): добавление движка там автоматически
// расширяет regex ссылок здесь, без синхронной правки. Экранируем на случай спецсимволов.
const diagramExtAlternation = (): string =>
    DIAGRAM_ENGINES.map((e) => e.ext.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

// Ссылка на диаграмму в markdown: ![alt](path.puml|d2). Путь ленивый и не пересекает ')',
// иначе две ссылки на одной строке склеились бы в один матч и не заменились. Свежий объект
// на вызов — чтобы matchAll не тянул чужой lastIndex.
const diagramRefRegex = (): RegExp =>
    new RegExp(`!\\[.*?\\]\\(([^)]*?\\.(?:${diagramExtAlternation()}))\\)`, 'g');

// Кеш base64 отрендеренных диаграмм на время ОДНОЙ сборки: один файл читают все три
// генератора (per-page md / docsify / complete). clearDiagramCache() зовётся в начале build() —
// иначе в watch-режиме (build() вызывается повторно) вернулись бы данные до правки файла.
const diagramBase64Cache = new Map<string, string>();
export const clearDiagramCache = (): void => diagramBase64Cache.clear();

const readDiagramBase64 = async (absPath: string): Promise<string> => {
    const cached = diagramBase64Cache.get(absPath);
    if (cached !== undefined) return cached;
    const b64 = (await readFile(absPath)).toString('base64');
    diagramBase64Cache.set(absPath, b64);
    return b64;
};

// Тот же кеш для embed-ветки онлайн-рендера (ключ — URL, с абсолютными путями не
// пересекается): три генератора иначе тянули бы одну и ту же картинку с PlantUML-сервера
// трижды за сборку.
const readRemoteDiagramBase64 = async (url: string): Promise<string> => {
    const cached = diagramBase64Cache.get(url);
    if (cached !== undefined) return cached;
    const b64 = await httpGet(url);
    diagramBase64Cache.set(url, b64);
    return b64;
};

// Единый рендер markdown одной диаграммы для всех трёх генераторов. В complete-документе
// ссылки «скачать/перейти» префиксуются папкой элемента, а Download отбивается переводом
// строки (историческая вёрстка). Признак — variant, а не пустота префикса: у диаграмм в
// корневой папке префикс пуст, и complete всё равно обязан отбить ссылку.
const buildDiagramMarkdown = async (
    item: TreeItem,
    diagram: Diagram,
    options: BuildOptions,
    variant: 'page' | 'complete'
): Promise<string> => {
    const isComplete = variant === 'complete';
    const name = path.parse(diagram.dir).name;
    const format = diagramOutputFormat(diagram, options);
    // rawPath — сырой путь (для чтения файла и как основа ссылок), кодируем ровно один раз.
    const rawPath = path.join(path.dirname(diagram.dir), `${name}.${format}`);
    // Онлайн-рендер (движки с remoteRender в DIAGRAM_ENGINES) отдаёт абсолютный URL
    // сервера: его нельзя ни префиксовать папкой, ни повторно кодировать (encodeURI
    // сломал бы схему https:// и '+' в base64).
    const isRemoteUrl = !options.GENERATE_LOCAL_IMAGES && engineSupportsRemote(diagram.engine);
    const diagramUrl = isRemoteUrl
        ? plantUmlServerUrl(
              options.PLANTUML_SERVER_URL,
              format,
              diagram.content as string // рендер-контент диаграммы (Buffer читается как текст)
          )
        : encodeURIPath(rawPath);

    // В complete-документе И картинка, И ссылка «скачать/перейти» префиксуются папкой
    // элемента: complete.md лежит в корне dist, а картинки — во вложенных папках, поэтому
    // относительный путь считается от корня. Склеиваем СЫРЫЕ сегменты и кодируем один раз
    // (иначе % из первого encodeURI превратился бы в %25). Абсолютный URL онлайн-рендера
    // отдаём как есть — без папки и без повторного encodeURI. В page-варианте md лежит
    // рядом с картинкой, поэтому путь остаётся относительным к странице (diagramUrl).
    const localHref =
        isComplete && !isRemoteUrl
            ? encodeURIPath(path.join(item.dir.replace(options.ROOT_FOLDER, ''), rawPath))
            : diagramUrl;

    if (options.EMBED_DIAGRAM) {
        const imgContent = options.GENERATE_LOCAL_IMAGES
            ? await readDiagramBase64(
                  path.join(options.DIST_FOLDER, item.dir.replace(options.ROOT_FOLDER, ''), rawPath)
              )
            : await readRemoteDiagramBase64(diagramUrl);
        const diagramImage = `\n![${name}](data:${getMime(format)};base64,${imgContent})\n`;
        const diagramLink = `${isComplete ? '\n' : ''}[Download ${name} diagram](${localHref} ':ignore')`;
        return diagramImage + diagramLink;
    }

    const diagramImage = `![diagram](${localHref})`;
    if (!options.INCLUDE_LINK_TO_DIAGRAM) return diagramImage;
    return `[Go to ${name} diagram](${localHref})`;
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
    const regex = diagramRefRegex();

    for (const mdFile of item.mdFiles) {
        const content = mdFile.toString();

        // Один проход matchAll + сборка из срезов: каждая ссылка заменяется ровно один раз.
        // (Прежний regex.exec + переприсваивание content пропускал ссылки при укорачивающей замене.)
        let result = '';
        let lastIndex = 0;
        for (const m of content.matchAll(regex)) {
            const ref = m[1];
            const diagram = item.diagrams.find((x) => x.dir === ref);
            if (!diagram) continue; // ссылка без соответствующей диаграммы — оставляем сырой markdown
            alreadyIncluded.push(ref);
            result += content.slice(lastIndex, m.index) + (await getDiagram(item, diagram, options));
            lastIndex = m.index + m[0].length;
        }
        result += content.slice(lastIndex);
        texts.push(result);
    }
    for (const diagram of item.diagrams) {
        if (alreadyIncluded.find((x) => x === diagram.dir)) {
            continue;
        }

        diagrams.push(await getDiagram(item, diagram, options));
    }

    let fullDoc: string[] = [];
    if (options.DIAGRAMS_ON_TOP) {
        // Пользовательский h1 обязан оставаться самым первым: при diagramsOnTop диаграммы
        // иначе встают ВЫШЕ заголовка страницы. Отделяем ведущий h1 первого текста и держим
        // его перед диаграммами (chrome вставляется под него caller'ом), остальное тело —
        // после. Ведущего h1 нет (авто-заголовок) → прежний порядок diagrams → texts.
        const [firstText = '', ...restTexts] = texts;
        const h1 = firstText.match(/^(﻿?\s*#\s+[^\n]*)\n?([\s\S]*)$/);
        fullDoc = h1
            ? [h1[1], ...diagrams, h1[2], ...restTexts].filter((s) => s !== '')
            : [...diagrams, ...texts];
    } else {
        fullDoc = [...texts, ...diagrams];
    }

    for (const doc of fullDoc) {
        MD += '\n\n';
        MD += doc;
    }

    return MD;
};

// Якорь заголовка в complete-документе (докcифай/GitHub-стиль: пробелы → дефисы).
const mdAnchor = (name: string): string => `#${encodeURIPath(name).replace(/%20/g, '-')}`;

// Относительная ссылка со страницы уровня fromLevel на README целевой папки
// (rootRel — путь цели от ROOT_FOLDER). Один паттерн для TOC, навигации вверх и
// меню подпапок — прежде дублировался трижды.
const relativeMdLink = (fromLevel: number, rootRel: string, mdFileName: string): string =>
    encodeURIPath(
        path.join('./', fromLevel - 1 > 0 ? '../'.repeat(fromLevel - 1) : '', rootRel, `${mdFileName}.md`)
    );

// Состав и ссылки sidebar сайта — общие с llms.txt, чтобы оглавление агента не
// разъехалось с навигацией. Чистоту string[] гарантирует zod-схема.
const inSidebar = (item: TreeItem, options: BuildOptions): boolean =>
    !options.EXCLUDE_SIDEBAR_FOLDER_BY_PATH?.some((pathToExclude) => item.dir.startsWith(pathToExclude));

// Путь веб-страницы от корня сайта, без .md. path.relative, а не отрезание первого
// сегмента: то ломалось на многосегментном rootFolder из рукописного конфига.
const sitePagePath = (item: TreeItem, options: BuildOptions): string =>
    path.join(path.relative(options.ROOT_FOLDER, item.dir), options.WEB_FILE_NAME || item.name);

// Тело страницы (титул + контент с диаграммами) — общий скелет generateMD и
// generateWebMD. chrome (breadcrumbs/TOC/навигация) встаёт под заголовок: при
// авто-титуле — сразу за ним, при пользовательском h1 — пост-вставкой после него.
const compilePage = async (item: TreeItem, options: BuildOptions, chrome = ''): Promise<string> => {
    const name = getFolderName(item.dir, options.ROOT_FOLDER, options.HOMEPAGE_NAME);
    const ownH1 = hasOwnH1(item);
    let MD = ownH1 ? '' : `# ${name}${chrome}`;
    MD = await compileDocument(MD, item, options, (i, d, o) => buildDiagramMarkdown(i, d, o, 'page'));
    if (ownH1) MD = injectAfterFirstH1(MD, chrome);
    return MD.trimStart();
};

// Единый документ со всеми страницами в порядке дерева. Стратегия диаграмм — у вызывающего:
// complete.md вставляет картинки, llms-full.txt — исходники; состав и порядок общие.
const composeComplete = async (
    tree: TreeItem[],
    options: BuildOptions,
    getDiagram: GetDiagram
): Promise<string> => {
    //title
    let MD = `# ${options.PROJECT_NAME}`;
    //table of contents
    let tableOfContents = '';
    for (const item of tree)
        tableOfContents += `${'  '.repeat(item.level - 1)}* [${item.name}](${mdAnchor(item.name)})\n`;
    MD += `\n\n${tableOfContents}\n---`;

    for (const item of tree) {
        const name = getFolderName(item.dir, options.ROOT_FOLDER, options.HOMEPAGE_NAME);

        //title
        MD += `\n\n## ${name}`;
        if (name !== options.HOMEPAGE_NAME) {
            if (options.INCLUDE_BREADCRUMBS) MD += `\n\n\`${item.dir.replace(options.ROOT_FOLDER, '')}\``;
            MD += `\n\n[${options.HOMEPAGE_NAME}](${mdAnchor(options.PROJECT_NAME)})`;
        }

        //concatenate markdown files
        MD = await compileDocument(MD, item, options, getDiagram);
    }
    return MD;
};

export const generateCompleteMD = async (tree: TreeItem[], options: BuildOptions): Promise<void> =>
    writeFile(
        path.join(options.DIST_FOLDER, `${options.PROJECT_NAME}.md`),
        // complete: ссылки на диаграммы префиксуются папкой элемента.
        await composeComplete(tree, options, (i, d, o) => buildDiagramMarkdown(i, d, o, 'complete'))
    );

// llms.txt (llmstxt.org): плоский список — парсеры читают строки `- [..](..)` от начала
// строки и теряют вложенные; иерархию несёт заголовок «A / B / C».
export const generateLlmsTxt = (tree: TreeItem[], options: BuildOptions): string => {
    const pages = tree
        .filter((item) => inSidebar(item, options))
        .map((item) => {
            const rel = path.relative(options.ROOT_FOLDER, item.dir);
            const title = rel ? rel.split(path.sep).join(' / ') : options.HOMEPAGE_NAME;
            return `- [${title}](${encodeURIPath(`${sitePagePath(item, options)}.md`)})\n`;
        });
    return (
        `# ${options.PROJECT_NAME}\n\n` +
        '> Architecture documentation built with c4builder. Pages are markdown; full text with ' +
        'diagram sources (PlantUML/D2): [llms-full.txt](llms-full.txt).\n\n' +
        `## Pages\n\n${pages.join('')}`
    );
};

// Fence длиннее самой длинной серии обратных кавычек текста — иначе блок закрылся бы изнутри.
const fenced = (text: string, lang = ''): string => {
    const fence = '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)));
    return `${fence}${lang}\n${text.endsWith('\n') ? text : `${text}\n`}${fence}`;
};

const FENCE_LANG: Record<string, string> = { '.puml': 'plantuml', '.iuml': 'plantuml', '.d2': 'd2' };

// llms-full.txt: состав complete-документа, но диаграмма — исходником (C4-PlantUML/D2-текст
// агенту полезнее SVG). Локальные include/импорты — один раз в приложении, а не инлайном:
// общий styles.iuml иначе повторился бы в каждой диаграмме. Резолв — тот же, что у рендера.
export const generateLlmsFull = async (tree: TreeItem[], options: BuildOptions): Promise<string> => {
    const MD = await composeComplete(tree, options, async (_item, diagram) =>
        fenced(`${diagram.content}`, diagram.engine)
    );
    const deps = new Map<string, string>();
    for (const item of tree) {
        for (const diagram of item.diagrams) {
            const body = `${diagram.content}`;
            if (diagram.engine === 'd2') {
                for (const [abs, content] of d2LocalImports(path.join(item.dir, diagram.dir), body))
                    deps.set(abs, content);
            } else {
                for (const inc of collectIncludes(body, item.dir, item.dir, new Set()))
                    deps.set(inc.abs, inc.content);
            }
        }
    }
    if (!deps.size) return `${MD}\n`;
    const files = [...deps]
        .map(([abs, content]) => [path.relative(process.cwd(), abs).split(path.sep).join('/'), content])
        .sort(([a], [b]) => (a < b ? -1 : 1));
    const appendix = files
        .map(
            ([p, content]) => `\n\n### ${p}\n\n${fenced(content, FENCE_LANG[path.extname(p).toLowerCase()])}`
        )
        .join('');
    return `${MD}\n\n## Included files${appendix}\n`;
};

export const generateMD = async (
    tree: TreeItem[],
    options: BuildOptions,
    onProgress?: (processed: number, total: number) => void
): Promise<void> => {
    let processedCount = 0;
    const totalCount = tree.length;

    const filePromises: Promise<void>[] = [];
    for (const item of tree) {
        const name = getFolderName(item.dir, options.ROOT_FOLDER, options.HOMEPAGE_NAME);

        // "Page chrome" — breadcrumb / TOC / навигация. Собирается отдельно и встаёт
        // под заголовок страницы (авто или пользовательский h1) внутри compilePage.
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
                tableOfContents += `${'  '.repeat(_item.level - 1)}* [${label}](${relativeMdLink(
                    item.level,
                    _item.dir.replace(options.ROOT_FOLDER, ''),
                    options.MD_FILE_NAME
                )})\n`;
            }
            chrome += `\n\n${tableOfContents}\n---`;
        }
        //parent menu
        if (item.parent && options.INCLUDE_NAVIGATION) {
            const parentName = getFolderName(item.parent, options.ROOT_FOLDER, options.HOMEPAGE_NAME);
            chrome += `\n\n[${parentName} (up)](${relativeMdLink(
                item.level,
                item.parent.replace(options.ROOT_FOLDER, ''),
                options.MD_FILE_NAME
            )})`;
        }

        //descendants menu (files and folders prefixed with _ excluded at scan)
        let descendantsMenu = '';
        for (const file of item.descendants) {
            descendantsMenu += `\n\n- [${file}](${relativeMdLink(
                item.level,
                path.join(item.dir.replace(options.ROOT_FOLDER, ''), file),
                options.MD_FILE_NAME
            )})`;
        }
        if (descendantsMenu && options.INCLUDE_NAVIGATION) chrome += `${descendantsMenu}`;
        //separator
        if (options.INCLUDE_NAVIGATION) chrome += `\n\n---`;

        const MD = await compilePage(item, options, chrome);

        //write to disk
        filePromises.push(
            writeFile(
                path.join(
                    options.DIST_FOLDER,
                    item.dir.replace(options.ROOT_FOLDER, ''),
                    `${options.MD_FILE_NAME}.md`
                ),
                MD
            ).then(() => {
                processedCount++;
                if (onProgress) onProgress(processedCount, totalCount);
            })
        );
    }

    await Promise.all(filePromises);
};

export const generateWebMD = async (tree: TreeItem[], options: BuildOptions): Promise<void> => {
    const filePromises: Promise<void>[] = [];
    let docsifySideBar = '';

    const getWebFileName = (originalFileName: string): string => options.WEB_FILE_NAME || originalFileName;

    for (const item of tree) {
        if (inSidebar(item, options)) {
            docsifySideBar += `${'  '.repeat(item.level - 1)}* [${item.name}](${encodeURIPath(
                sitePagePath(item, options)
            )})\n`;
        }

        const MD = await compilePage(item, options);

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
        // require ESM/TS-шаблона возвращает namespace { default: fn }, а не саму функцию —
        // разворачиваем default, иначе дальше «docsifyTemplate is not a function».
        const loaded = require(path.join(process.cwd(), options.DOCSIFY_TEMPLATE));
        const fn = typeof loaded === 'function' ? loaded : loaded?.default;
        if (typeof fn !== 'function') {
            throw new Error(
                `docsifyTemplate «${options.DOCSIFY_TEMPLATE}» должен экспортировать функцию ` +
                    `(module.exports = fn или export default fn), получено: ${typeof fn}`
            );
        }
        docsifyTemplate = fn;
    }

    // Имя корневого элемента дерева (без parent) для homepage docsify. Считается лениво
    // (только если не задан WEB_FILE_NAME); отсутствие корня — явная ошибка вместо assertion.
    const rootName = (): string => {
        const root = tree.find((item) => !item.parent);
        if (!root) throw new Error('docsify: корневой элемент дерева не найден');
        return root.name;
    };

    //docsify homepage
    filePromises.push(
        writeFile(
            path.join(options.DIST_FOLDER, `index.html`),
            docsifyTemplate({
                name: options.PROJECT_NAME,
                repo: options.REPO_NAME,
                loadSidebar: true,
                auto2top: true,
                homepage: `${options.WEB_FILE_NAME || rootName()}.md`,
                plantuml: {
                    skin: 'classic'
                },
                stylesheet: options.WEB_THEME,
                alias: { '/.*/_sidebar.md': '/_sidebar.md' },
                nativeEmoji: true,
                supportSearch: options.SUPPORT_SEARCH,
                executeScript: options.EXECUTE_SCRIPT
            })
        )
    );

    //copy local docsify vendor files to dist
    const docsifyVendorSrc = path.join(VENDOR_DIR, 'docsify');
    if (fs.existsSync(docsifyVendorSrc)) {
        const vendorDist = path.join(options.DIST_FOLDER, 'vendor');
        // Тема — без ведущего @import Google Fonts (у её шрифтов есть системный fallback).
        // Правим копию, а не vendor/: повторное вендорение вернуло бы @import.
        const theme = path.join(vendorDist, 'vue.css');
        filePromises.push(
            fsextra
                .copy(docsifyVendorSrc, vendorDist)
                .then(async () =>
                    writeFile(theme, (await readFile(theme)).toString().replace(/^@import url\([^)]*\);/, ''))
                )
        );
    }

    //github pages preparation
    filePromises.push(writeFile(path.join(options.DIST_FOLDER, `.nojekyll`), ''));

    //sidebar
    filePromises.push(writeFile(path.join(options.DIST_FOLDER, '_sidebar.md'), docsifySideBar));

    await Promise.all(filePromises);
};
