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
import type { BuildOptions, C4ConfigFile, ConfigIssue } from '../config/options.ts';
import { parseConfig } from '../config/options.ts';

// Configstore-подобное хранилище конфига/кэша. Реальный инстанс — Configstore;
// заглушки (режим --new, где проектного конфига ещё нет) кастуются к нему.
interface ConfStore {
    // Значение конфига/кэша типизируется по месту чтения (T выводится из целевого
    // поля BuildOptions) — вместо any на границе Configstore, который отдаёт unknown.
    get<T = unknown>(key: string): T | undefined;
    // Весь конфиг разом — вход для zod-разбора (parseConfig); заглушки его не несут.
    readonly all?: Record<string, unknown>;
    set(key: string, value: unknown): void;
    delete(key: string): void;
    clear(): void;
}

const intro = () => {
    console.log(chalk.blue(figlet.textSync('c4builder')));
    console.log(chalk.gray('Blow up your software documentation writing skills'));
};

// Читает сырой `.c4builder` и разбирает его щадяще (config/parseConfig): для визарда и
// `--list`. Возвращает лишь ЗАДАННЫЕ пользователем и ВАЛИДНЫЕ ключи (недостающее и битое
// = undefined, как читалось до валидации), чтобы визард спросил их на первом запуске,
// а `--list` всё равно показал конфиг. Битые ключи — в `issues` для предупреждения.
function readLenientConfig(conf: ConfStore): { config: Partial<C4ConfigFile>; issues: ConfigIssue[] } {
    const raw = (conf.all ?? {}) as Record<string, unknown>;
    const result = parseConfig(raw);
    const source: C4ConfigFile = result.ok ? result.value : result.salvaged;
    const broken = new Set(result.ok ? [] : result.issues.map((i) => i.key));
    const config = Object.fromEntries(
        Object.keys(source)
            .filter((k) => k in raw && !broken.has(k))
            .map((k) => [k, source[k as keyof C4ConfigFile]])
    ) as Partial<C4ConfigFile>;
    return { config, issues: result.ok ? [] : result.issues };
}

// Строгий путь (сборка) не терпит битого конфига: печатает внятную ошибку и завершает
// процесс с ненулевым кодом. Держим решение о выходе здесь, в CLI, а не в config/*.
function failOnConfigIssues(issues: ConfigIssue[]): never {
    console.error(chalk.red('Ошибка в .c4builder — невалидные значения не дают собрать документацию:'));
    for (const { key, message } of issues) console.error(chalk.red(`  ${key} — ${message}`));
    process.exit(1);
}

// Щадящий путь (--config/первый запуск визарда) предупреждает о битых ключах: они
// трактуются как «не задано» и будут перезаписаны валидными значениями после визарда.
function warnConfigIssues(issues: ConfigIssue[]): void {
    console.log(
        chalk.yellow('\n⚠ Невалидные ключи в .c4builder (трактуются как «не задано», визард их перезапишет):')
    );
    for (const { key, value, message } of issues)
        console.log(chalk.yellow(`  ⚠ ${key}: ${JSON.stringify(value)} — ${message}`));
}

// Маппит разобранный `.c4builder` (camelCase) в BuildOptions (SCREAMING_CASE).
// Полный конфиг (после дефолтов схемы) → полный BuildOptions; частичный (щадящий вид
// визарда/--list) → Partial, где недостающие/битые поля остаются undefined.
function getOptions(c: C4ConfigFile): BuildOptions;
function getOptions(c: Partial<C4ConfigFile>): Partial<BuildOptions>;
function getOptions(c: Partial<C4ConfigFile>): BuildOptions | Partial<BuildOptions> {
    return {
        // Легаси-детект: выбор версии PlantUML удалён; ключ plantumlVersion из старых
        // .c4builder отдаём build.js только для однократного предупреждения на пине.
        LEGACY_PLANTUML_VERSION: c.plantumlVersion,
        GENERATE_MD: c.generateMD,
        GENERATE_WEBSITE: c.generateWEB,
        GENERATE_COMPLETE_MD_FILE: c.generateCompleteMD,
        // Легаси-детект: PDF-вывод удалён, но truthy-ключи в старых .c4builder
        // ловим здесь (где доступен conf) и отдаём build.js для предупреждения.
        LEGACY_PDF_KEYS: (['generatePDF', 'generateCompletePDF'] as const).filter((k) => c[k]),
        GENERATE_LOCAL_IMAGES: c.generateLocalImages,
        EMBED_DIAGRAM: c.embedDiagram,
        ROOT_FOLDER: c.rootFolder,
        DIST_FOLDER: c.distFolder,
        PROJECT_NAME: c.projectName,
        REPO_NAME: c.repoUrl,
        HOMEPAGE_NAME: c.homepageName,
        WEB_THEME: c.webTheme === '//unpkg.com/docsify/lib/themes/vue.css' ? 'vendor/vue.css' : c.webTheme,
        DOCSIFY_TEMPLATE: c.docsifyTemplate,
        INCLUDE_NAVIGATION: c.includeNavigation,
        INCLUDE_BREADCRUMBS: c.includeBreadcrumbs,
        INCLUDE_TABLE_OF_CONTENTS: c.includeTableOfContents,
        INCLUDE_LINK_TO_DIAGRAM: c.includeLinkToDiagram,
        EXCLUDE_SIDEBAR_FOLDER_BY_PATH: c.excludeSidebarFolderByPath,
        DIAGRAMS_ON_TOP: c.diagramsOnTop,
        CHARSET: c.charset,
        WEB_PORT: c.webPort,
        HAS_RUN: c.hasRun,
        PLANTUML_SERVER_URL: c.plantumlServerUrl,
        DIAGRAM_FORMAT: c.diagramFormat,
        D2_LAYOUT: c.d2Layout,
        MD_FILE_NAME: 'README',
        WEB_FILE_NAME: c.webFileName,
        SUPPORT_SEARCH: c.supportSearch,
        EXECUTE_SCRIPT: c.executeScript,
        EXCLUDE_OTHER_FILES: c.excludeOtherFiles
    };
}

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

    // --reset чистит .c4builder при ЛЮБОМ его содержимом — до строгой проверки конфига,
    // чтобы сломанное значение не мешало собственному сбросу.
    if (opts.reset && !opts.new) {
        clearConsole();
        intro();
        conf.clear();
        cacheConf.clear();
        console.log(`configuration was reset`);
        return;
    }

    // Начальный конфиг для визарда/--list: щадящий разбор (незаданные и битые поля =
    // undefined), чтобы визард спросил недостающее, а --list всё равно показал конфиг.
    const { config: rawConfig, issues: configIssues } = readLenientConfig(conf);
    const currentConfig = getOptions(rawConfig);

    if (opts.new || opts.config || !currentConfig.HAS_RUN) clearConsole();

    intro();

    if (!currentConfig.HAS_RUN && !opts.new) {
        console.log(
            `\nif you created the project using the 'c4model new' command you can just press enter and go with the default options to get a basic idea of how it works.\n`
        );
        console.log(`you can always change the configuration by running > c4builder config\n`);
    }

    if (opts.new) return cmdNewProject(opts);
    if (opts.list) return cmdList(currentConfig, configIssues);

    // Повторная сборка установленного проекта (есть HAS_RUN, не --config) — строгий путь:
    // битый конфиг обязан упасть с внятной ошибкой сразу, а не быть тихо «починен» визардом.
    // Первый запуск (!HAS_RUN) и --config остаются щадящими — это штатный путь восстановления.
    const strictBuild = !opts.config && !!currentConfig.HAS_RUN;
    if (configIssues.length) {
        if (strictBuild) failOnConfigIssues(configIssues);
        warnConfigIssues(configIssues);
    }

    await cmdCollect(currentConfig, conf, opts);
    if (!opts.config) {
        conf.set('hasRun', true);

        let isBuilding = false;
        let attemptedWatchBuild = false;
        // Опции сборки после визарда: строгий разбор итогового конфига. Штатно валиден
        // (визард только что записал корректные значения; повторная сборка с битым конфигом
        // отсеяна выше) — падение здесь страхует от иного невалидного состояния.
        const built = parseConfig((conf.all ?? {}) as Record<string, unknown>);
        if (!built.ok) failOnConfigIssues(built.issues);
        const options = getOptions(built.value);
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
