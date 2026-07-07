import fs from 'node:fs';
import path from 'node:path';
import fsextra from 'fs-extra';
import { createRequire } from 'node:module';

import defaultDocsifyTemplate from './docsify.template.ts';
import { encodeURIPath, readFile, writeFile, plantUmlServerUrl } from '../../util/utils.ts';
import { VENDOR_DIR } from '../../util/paths.ts';
// Фаза scan: тип дерева и его элементов + производные (имя папки, формат выхода диаграммы).
import { getFolderName, diagramOutputFormat, type TreeItem, type Diagram } from '../scan/tree.ts';
// Фаза render: mime-тип формата и загрузка удалённо отрендеренной картинки (embed-ветка).
import { getMime, httpGet } from '../render/diagrams.ts';
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
                const ref = diagramRef[1]; // const → сужение держится в замыкании .find
                const diagram = item.diagrams.find((x) => x.dir === ref);
                if (diagram) {
                    alreadyIncluded.push(ref);
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

export const generateCompleteMD = async (tree: TreeItem[], options: BuildOptions): Promise<void> => {
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
                        (await readFile(
                            path.join(
                                options.DIST_FOLDER,
                                item.dir.replace(options.ROOT_FOLDER, ''),
                                diagramUrl
                            )
                        )) as Buffer
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

    await Promise.all(filePromises);
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
                        (await readFile(
                            path.join(
                                options.DIST_FOLDER,
                                item.dir.replace(options.ROOT_FOLDER, ''),
                                diagramUrl
                            )
                        )) as Buffer
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

    await Promise.all(filePromises);
};

export const generateWebMD = async (tree: TreeItem[], options: BuildOptions): Promise<void> => {
    const filePromises: Promise<void>[] = [];
    let docsifySideBar = '';

    const getWebFileName = (originalFileName: string): string => options.WEB_FILE_NAME || originalFileName;

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
                        (await readFile(
                            path.join(
                                options.DIST_FOLDER,
                                item.dir.replace(options.ROOT_FOLDER, ''),
                                diagramUrl
                            )
                        )) as Buffer
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

    await Promise.all(filePromises);
};
