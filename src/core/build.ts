import chalk from 'chalk';
import path from 'node:path';
import fsextra from 'fs-extra';

import { makeDirectory } from '../util/utils.ts';
// teardownD2: освобождение webworker D2 в конце сборки.
import { teardownD2 } from './render/d2renderer.ts';
import type { BuildOptions } from '../config/options.ts';
// Фазы сборки: scan (дерево исходников) → render (диаграммы) → compose (markdown/сайт).
import { generateTree } from './scan/tree.ts';
import { generateImages, type CacheConf } from './render/diagrams.ts';
import { generateMD, generateWebMD, generateCompleteMD } from './compose/markdown.ts';

// Оркестратор владеет lifecycle выходного каталога: dist бэкапится в dist_bk, откуда
// generateImages восстанавливает неизменённые по чексумме картинки; в конце бэкап сносится.
const DIST_BACKUP_FOLDER_SUFFIX = '_bk';

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
            cacheConf,
            bkFolderName
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
