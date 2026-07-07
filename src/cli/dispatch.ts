import figlet from 'figlet';
import { program } from 'commander';
import chalk from 'chalk';
import path from 'node:path';

import Configstore from 'configstore';

import cmdHelp from './commands/help.ts';
import cmdNewProject from './commands/new.ts';
import cmdJre from './commands/jre.ts';
import cmdList from './commands/list.ts';
import cmdSite from './commands/site.ts';
import cmdCollect from './wizard/collect.ts';
import { build } from '../core/build.ts';
import watch from 'node-watch';
import { EventEmitter } from 'node:events';

import { clearConsole } from '../util/utils.ts';
import { packageJson as pkg } from '../util/paths.ts';
import type { BuildOptions } from '../config/options.ts';

// Configstore-подобное хранилище конфига/кэша. Реальный инстанс — Configstore;
// заглушки (режим --new, где проектного конфига ещё нет) кастуются к нему.
interface ConfStore {
    // Значение конфига/кэша типизируется по месту чтения (T выводится из целевого
    // поля BuildOptions) — вместо any на границе Configstore, который отдаёт unknown.
    get<T = unknown>(key: string): T;
    set(key: string, value: unknown): void;
    delete(key: string): void;
    clear(): void;
}

const intro = () => {
    console.log(chalk.blue(figlet.textSync('c4builder')));
    console.log(chalk.gray('Blow up your software documentation writing skills'));
};

const getOptions = (conf: ConfStore): BuildOptions => {
    return {
        // Легаси-детект: выбор версии PlantUML удалён; ключ plantumlVersion из старых
        // .c4builder отдаём build.js только для однократного предупреждения на пине.
        LEGACY_PLANTUML_VERSION: conf.get('plantumlVersion'),
        GENERATE_MD: conf.get('generateMD'),
        GENERATE_WEBSITE: conf.get('generateWEB'),
        GENERATE_COMPLETE_MD_FILE: conf.get('generateCompleteMD'),
        // Легаси-детект: PDF-вывод удалён, но truthy-ключи в старых .c4builder
        // ловим здесь (где доступен conf) и отдаём build.js для предупреждения.
        LEGACY_PDF_KEYS: ['generatePDF', 'generateCompletePDF'].filter((k) => conf.get(k)),
        GENERATE_LOCAL_IMAGES: conf.get('generateLocalImages'),
        EMBED_DIAGRAM: conf.get('embedDiagram'),
        ROOT_FOLDER: conf.get('rootFolder'),
        DIST_FOLDER: conf.get('distFolder'),
        PROJECT_NAME: conf.get('projectName'),
        REPO_NAME: conf.get('repoUrl'),
        HOMEPAGE_NAME: conf.get('homepageName'),
        WEB_THEME:
            conf.get('webTheme') === '//unpkg.com/docsify/lib/themes/vue.css'
                ? 'vendor/vue.css'
                : conf.get('webTheme'),
        DOCSIFY_TEMPLATE: conf.get('docsifyTemplate'),
        INCLUDE_NAVIGATION: conf.get('includeNavigation'),
        INCLUDE_BREADCRUMBS: conf.get('includeBreadcrumbs'),
        INCLUDE_TABLE_OF_CONTENTS: conf.get('includeTableOfContents'),
        INCLUDE_LINK_TO_DIAGRAM: conf.get('includeLinkToDiagram'),
        EXCLUDE_SIDEBAR_FOLDER_BY_PATH: conf.get('excludeSidebarFolderByPath'),
        DIAGRAMS_ON_TOP: conf.get('diagramsOnTop'),
        CHARSET: conf.get('charset'),
        WEB_PORT: conf.get('webPort'),
        HAS_RUN: conf.get('hasRun'),
        PLANTUML_SERVER_URL: conf.get('plantumlServerUrl'),
        DIAGRAM_FORMAT: conf.get('diagramFormat'),
        D2_LAYOUT: conf.get('d2Layout') || 'dagre',
        MD_FILE_NAME: 'README',
        WEB_FILE_NAME: conf.get('webFileName'),
        SUPPORT_SEARCH: conf.get('supportSearch'),
        EXECUTE_SCRIPT: conf.get('executeScript'),
        EXCLUDE_OTHER_FILES: conf.get('excludeOtherFiles')
    };
};

export default async () => {
    program
        .version(pkg.version)
        .option('--new', 'create a new project from template')
        .option('--name <name>', 'project name for --new (skips the name prompt)')
        .option('-y, --yes', 'non-interactive --new: defaults, no prompts (requires --name)')
        .option('--force', 'for `jre install`: force JRE download even if system java is present')
        .option('--config', 'change configuration for the current directory')
        .option('-c, --config-file <.c4builder>', 'set the configuration file relative path')
        .option('--list', 'display the current configuration')
        .option('--reset', 'clear all configuration')
        .option('--site', 'serve the generated site')
        .option('-w, --watch', 'watch for changes and rebuild')
        .option('-o, --open', 'open the generated site in the browser (with --site)')
        .option('--docs', 'a brief explanation for the available configuration options')
        .option('-p, --port <n>', 'port used for serving the generated site', parseInt)
        .allowExcessArguments() // позиционные аргументы подкоманды `jre <action>`
        .parse(process.argv);

    const opts = program.opts();

    // Прогрев JRE — до загрузки конфига проекта и intro: команда самостоятельна.
    if (program.args[0] === 'jre') return cmdJre(program.args.slice(1), { force: opts.force });

    let conf: ConfStore = { get: () => {} } as unknown as ConfStore;
    let cacheConf: ConfStore = { get: () => {}, set: () => {}, clear: () => {} } as unknown as ConfStore;
    if (!opts.new) {
        const projectKey = process.cwd().split(path.sep).splice(1).join('_');
        const configPath = path.join(process.cwd(), opts.configFile ?? '.c4builder');
        conf = new Configstore(projectKey, {}, { configPath });
        cacheConf = new Configstore(`${projectKey}_cache`, {}, { configPath: `${configPath}.cache` });

        // Миграция: чексуммы раньше жили в .c4builder, переносим их в .c4builder.cache,
        // чтобы рабочий конфиг перестал «дёргаться» в git при каждой сборке.
        const legacyChecksums = conf.get('checksums');
        if (legacyChecksums !== undefined) {
            if (cacheConf.get('checksums') === undefined) {
                cacheConf.set('checksums', legacyChecksums);
            }
            conf.delete('checksums');
        }
    }

    if (opts.docs) return cmdHelp();

    //initial options
    let options = getOptions(conf);

    if (opts.new || opts.config || !options.HAS_RUN) clearConsole();

    intro();

    if (!options.HAS_RUN && !opts.new) {
        console.log(
            `\nif you created the project using the 'c4model new' command you can just press enter and go with the default options to get a basic idea of how it works.\n`
        );
        console.log(`you can always change the configuration by running > c4builder config\n`);
    }

    if (opts.new) return cmdNewProject(opts);
    if (opts.list) return cmdList(options);

    if (opts.reset) {
        conf.clear();
        cacheConf.clear();
        console.log(`configuration was reset`);
        return;
    }

    await cmdCollect(options, conf, opts);
    if (!opts.config) {
        conf.set('hasRun', true);

        let isBuilding = false;
        let attemptedWatchBuild = false;
        //get options after wizard
        options = getOptions(conf);
        const reloadEmitter = new EventEmitter();
        reloadEmitter.setMaxListeners(0);
        if (opts.watch) {
            // node-watch: CJS-рантайм при ESM-.d.ts (export default) — дефолт-импорт
            // типизируется как namespace. Каст к реальной сигнатуре, рантайм не меняется.
            const watchDir = watch as unknown as typeof import('node-watch').default;
            watchDir(options.ROOT_FOLDER, { recursive: true }, async (_evt, name) => {
                // clearConsole();
                // intro();
                console.log(chalk.gray(`\n${name} changed. Rebuilding...`));
                if (isBuilding) {
                    attemptedWatchBuild = true;
                    if (options.GENERATE_LOCAL_IMAGES)
                        console.log(
                            chalk.bold(
                                chalk.yellow(
                                    'Build already in progress, consider disabling local image generation '
                                )
                            )
                        );

                    return;
                }

                isBuilding = true;
                let buildOk = true;
                try {
                    await build(options, cacheConf);
                    while (attemptedWatchBuild) {
                        attemptedWatchBuild = false;
                        await build(options, cacheConf);
                    }
                } catch (err) {
                    buildOk = false;
                    attemptedWatchBuild = false;
                    const e = err as Error;
                    console.log(chalk.red(`build failed: ${e?.stack ? e.stack : e}`));
                } finally {
                    isBuilding = false;
                }
                if (buildOk) reloadEmitter.emit('reload');
            });
        }

        isBuilding = true;
        await build(options, cacheConf);
        isBuilding = false;

        if (opts.site) return await cmdSite(options, opts, reloadEmitter);

        if (options.GENERATE_WEBSITE && !opts.watch) {
            console.log(chalk.gray('\nto view the generated website run'));
            console.log(`> c4builder site`);
        }
    }
};
