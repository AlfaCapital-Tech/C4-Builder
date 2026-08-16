import chalk from 'chalk';
import path from 'node:path';
import fsextra from 'fs-extra';

import { makeDirectory, writeOnSameLine } from '../util/utils.ts';
// clearD2FileCache: сброс кеша графа D2-импортов на границах сборки (сам webworker
// D2 гасит CLI после одиночной сборки — в watch-режиме он переживает ребилды).
import { clearD2FileCache } from './render/d2renderer.ts';
import type { BuildOptions } from '../config/options.ts';
// Фазы сборки: scan (дерево исходников) → render (диаграммы) → compose (markdown/сайт).
import { generateTree, engineSupportsRemote, clearIncludeCache } from './scan/tree.ts';
import { generateImages, type CacheConf } from './render/diagrams.ts';
import { generateMD, generateWebMD, generateCompleteMD, clearDiagramCache } from './compose/markdown.ts';
// Плагины: хуки afterScan (виртуальные страницы) / afterBuild и ассеты сайта.
// Загружены заранее в cli/dispatch и приходят третьим аргументом (как cacheConf).
import { runAfterScan, runAfterBuild } from './plugins/hooks.ts';
import { injectPluginAssets } from './plugins/assets.ts';
import type { LoadedPlugin } from './plugins/types.ts';

// Оркестратор владеет lifecycle выходного каталога: dist бэкапится в dist_bk, откуда
// generateImages восстанавливает неизменённые по чексумме картинки; в конце бэкап сносится.
const DIST_BACKUP_FOLDER_SUFFIX = '_bk';

const build = async (
    options: BuildOptions,
    cacheConf: CacheConf,
    plugins: LoadedPlugin[] = []
): Promise<void> => {
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
        await runAfterScan(tree, options, plugins);

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
                    `В проекте есть диаграммы без онлайн-сервера рендера (${[...offline].join(', ')}), ` +
                        'но generateLocalImages выключен — включите локальную генерацию изображений ' +
                        '(generateLocalImages).'
                );
            }
        }

        if (options.GENERATE_LOCAL_IMAGES) {
            console.log(chalk.blue('generating images'));
            await generateImages(
                tree,
                options,
                (count, total) => {
                    writeOnSameLine(`processed ${count}/${total} images`);
                },
                cacheConf,
                bkFolderName
            );
            console.log('');
        }
        if (options.GENERATE_MD) {
            console.log(chalk.blue('generating markdown files'));
            await generateMD(tree, options, (count, total) => {
                writeOnSameLine(`processed ${count}/${total} files`);
            });
            console.log('');
        }
        if (options.GENERATE_WEBSITE) {
            console.log(chalk.blue('generating docsify site'));
            await generateWebMD(tree, options);
            await injectPluginAssets(plugins, options);
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

        await runAfterBuild(options, plugins);

        console.log(chalk.green(`built in ${(Date.now() - start_date.getTime()) / 1000} seconds`));
        ok = true;
    } finally {
        // Бэкап dist сносим ТОЛЬКО при успехе: при падении фазы dist_bk — единственная
        // полная копия прошлого удачного билда, её нельзя терять (иначе первый же
        // сломавшийся рендер уничтожает рабочий вывод).
        if (ok) {
            await fsextra.removeSync(bkFolderName);
        } else if (options.GENERATE_LOCAL_IMAGES && fsextra.existsSync(bkFolderName)) {
            console.log(
                chalk.yellow(`\nсборка прервана — бэкап предыдущего билда сохранён в ./${bkFolderName}`)
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
