import chalk from 'chalk';
import path from 'node:path';
import fsextra from 'fs-extra';

import { makeDirectory, writeFile, writeProgress } from '../util/utils.ts';
// clearD2FileCache: сброс кеша графа D2-импортов на границах сборки (сам webworker
// D2 гасит CLI после одиночной сборки — в watch-режиме он переживает ребилды).
import { clearD2FileCache } from './render/d2renderer.ts';
import { type BuildOptions, DIST_BACKUP_FOLDER_SUFFIX } from '../config/options.ts';
// Фазы сборки: scan (дерево исходников) → render (диаграммы) → compose (markdown/сайт).
import { generateTree, engineSupportsRemote, clearIncludeCache } from './scan/tree.ts';
import { generateImages, type CacheConf, type DiagramQueue } from './render/diagrams.ts';
import {
    generateMD,
    generateWebMD,
    generateCompleteMD,
    generateLlmsTxt,
    generateLlmsFull,
    clearDiagramCache,
    type PageSources
} from './compose/markdown.ts';
// Плагины: хуки afterScan (виртуальные страницы) / afterBuild и ассеты сайта.
// Загружены заранее в cli/dispatch и приходят третьим аргументом (как cacheConf).
import { runAfterScan, runAfterBuild } from './plugins/hooks.ts';
import { injectRedirects, injectSiteAssets } from './plugins/assets.ts';
import type { Redirects } from './plugins/tree.ts';
import type { LoadedPlugin } from './plugins/types.ts';

// Оркестратор владеет lifecycle выходного каталога: dist бэкапится в dist_bk, откуда
// generateImages восстанавливает неизменённые по чексумме картинки; в конце бэкап сносится.

/**
 * Итог сборки для `site -w`: карта страниц сайта → исходные файлы (пустая без website) — для
 * комментариев; переадресации плагинов — для `--open-change <id>` и адреса страницы в `feedback`.
 */
export interface BuildResult {
    pages: PageSources;
    redirects: Redirects;
    /** deferImages: очередь диаграмм, которых нет в кэше (на их месте заглушки); нет — всё из кэша. */
    pending?: DiagramQueue;
}

export interface BuildFlags {
    /**
     * Отложенный рендер для dev-сервера: сборка не ждёт диаграмм без кэша — пишет заглушки
     * `rendering…`, компонует страницы поверх них и возвращает очередь в `pending`.
     */
    deferImages?: boolean;
    /** Ошибка рендера — заглушка с ошибкой и `✗`, а не падение сборки (см. render/diagrams). */
    softErrors?: boolean;
    /** Упавшие в сессии dev-сервера диаграммы — не перерендеривать без изменений (render/diagrams). */
    failedRenders?: Map<string, string>;
    /** BPMN и mermaid — в worker-потоке, чтобы не блокировать dev-сервер (render/offthread). */
    offThread?: boolean;
}

const build = async (
    options: BuildOptions,
    cacheConf: CacheConf,
    plugins: LoadedPlugin[] = [],
    { deferImages = false, softErrors = deferImages, failedRenders, offThread }: BuildFlags = {}
): Promise<BuildResult> => {
    const start_date = new Date();
    let pages: PageSources = new Map();
    let pending: DiagramQueue | undefined;
    const redirects: Redirects = new Map();
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

    // Сбросить пофайловые кеши прошлой сборки (актуально для watch-режима): base64
    // диаграмм, граф D2-импортов, контент include-файлов PlantUML.
    clearDiagramCache();
    clearD2FileCache();
    clearIncludeCache();

    let ok = false;
    try {
        //actual build
        console.log(chalk.green(`\nbuilding documentation in ./${options.DIST_FOLDER}`));
        const tree = await generateTree(options.ROOT_FOLDER, options);
        console.log(chalk.blue(`parsed ${tree.length} folders`));
        // Виртуальные страницы плагинов встают в дерево до рендера — дальше они
        // неотличимы от реальных папок (диаграммы, sidebar, поиск, complete).
        await runAfterScan(tree, options, plugins, redirects);

        // У движков без онлайн-рендера (D2, см. remoteRender в DIAGRAM_ENGINES) при
        // выключенной локальной генерации диаграммы не во что превратить — ссылки на
        // SVG вели бы в никуда. Падаем сразу с понятной ошибкой, а не молча битым выводом.
        if (!options.GENERATE_LOCAL_IMAGES) {
            const offline = new Set(
                tree.flatMap((item) =>
                    item.diagrams.filter((d) => !engineSupportsRemote(d.engine)).map((d) => d.engine)
                )
            );
            if (offline.size) {
                throw new Error(
                    `The project has diagrams with no online render server (${[...offline].join(', ')}), ` +
                        'but generateLocalImages is off — enable local image generation ' +
                        '(generateLocalImages).'
                );
            }
        }

        if (options.GENERATE_LOCAL_IMAGES) {
            console.log(chalk.blue('generating images'));
            pending = await generateImages(
                tree,
                options,
                (count, total) => writeProgress(count, total, 'images'),
                cacheConf,
                bkFolderName,
                { deferImages, softErrors, failedRenders, offThread }
            );
            console.log('');
        }
        if (options.GENERATE_MD) {
            console.log(chalk.blue('generating markdown files'));
            await generateMD(tree, options, (count, total) => writeProgress(count, total, 'files'));
            console.log('');
        }
        if (options.GENERATE_WEBSITE) {
            console.log(chalk.blue('generating docsify site'));
            pages = await generateWebMD(tree, options, redirects);
            await injectSiteAssets(plugins, options);
            injectRedirects(options, redirects);
        }
        // llms.txt ссылается на .md страниц сайта — без website ссылаться не на что.
        if (options.GENERATE_LLMS && options.GENERATE_WEBSITE) {
            console.log(chalk.blue('generating llms.txt'));
            await writeFile(path.join(options.DIST_FOLDER, 'llms.txt'), generateLlmsTxt(tree, options));
            await writeFile(
                path.join(options.DIST_FOLDER, 'llms-full.txt'),
                await generateLlmsFull(tree, options)
            );
        } else if (options.GENERATE_LLMS) {
            console.log(chalk.yellow('generateLLMS requires generateWEB — llms.txt not created'));
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
                    `PDF output is no longer supported. Remove manually from .c4builder: ${options.LEGACY_PDF_KEYS.join(
                        ', '
                    )}.`
                )
            );
        }

        await runAfterBuild(options, plugins);

        console.log(chalk.green(`built in ${(Date.now() - start_date.getTime()) / 1000} seconds`));
        ok = true;
        return { pages, redirects, pending };
    } finally {
        // Бэкап dist сносим ТОЛЬКО при успехе: при падении фазы dist_bk — единственная
        // полная копия прошлого удачного билда, её нельзя терять (иначе первый же
        // сломавшийся рендер уничтожает рабочий вывод).
        if (ok) {
            await fsextra.removeSync(bkFolderName);
        } else if (options.GENERATE_LOCAL_IMAGES && fsextra.existsSync(bkFolderName)) {
            console.log(
                chalk.yellow(`\nbuild aborted — the previous build is backed up in ./${bkFolderName}`)
            );
        }
        // Пофайловые кеши нужны только внутри сборки — чистим и на выходе, чтобы
        // watch-процесс не держал base64 всех диаграмм в памяти между ребилдами.
        clearDiagramCache();
        clearD2FileCache();
        clearIncludeCache();
    }
};
export { build };
