import figlet from 'figlet';
import { InvalidArgumentError, program } from 'commander';
import chalk from 'chalk';
import path from 'node:path';

import Configstore from 'configstore';

import cmdHelp from './commands/help.ts';
import cmdNewProject from './commands/new.ts';
import cmdJre from './commands/jre.ts';
import cmdCheck from './commands/check.ts';
import cmdList from './commands/list.ts';
import cmdSite from './commands/site.ts';
import cmdFeedback from './commands/feedback.ts';
import cmdSkills, { skillsNotice } from './commands/skills.ts';
import { detectAgent } from './agent.ts';
import { cmdUpdate, pendingUpdate, startUpdateCheck } from './update.ts';
import cmdCollect from './wizard/collect.ts';
import { build, type BuildResult } from '../core/build.ts';
import { loadPlugins, pluginWatchPaths } from '../core/plugins/load.ts';
import fs from 'node:fs';
import watch from 'node-watch';
import { EventEmitter } from 'node:events';

import { clearConsole } from '../util/utils.ts';
import { acquireBuildLock, BuildLockHeldError, waitBuildLock } from '../util/lock.ts';
// teardownD2 живёт здесь, а не в finally build(): в watch-режиме D2-воркер должен
// переживать ребилды (его пересоздание — секунды), гасим его только когда сборок
// больше не будет (одиночный запуск).
import { teardownD2 } from '../core/render/d2renderer.ts';
import { teardownBpmn } from '../core/render/bpmnrenderer.ts';
import { teardownMermaid } from '../core/render/mermaidrenderer.ts';
import { packageJson as pkg } from '../util/paths.ts';
import type { BuildOptions, C4ConfigFile, ConfigIssue } from '../config/options.ts';
import { outputDirs, parseConfig } from '../config/options.ts';
import { isValidPort } from '../config/schema.ts';

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

// Позиционные подкоманды: allowExcessArguments пропускает любые, список — единственный фильтр.
// Commander о них не знает — аргументы и описания здесь же, для блока команд в --help.
const COMMANDS: Record<string, [args: string, about: string]> = {
    check: ['<files...>', 'check diagrams without a build, exit code 0 or 1'],
    jre: ['info|install', 'which Java will be used | download a JRE in advance'],
    site: ['', 'build and serve the site locally (same as --site)'],
    new: ['', 'create a project from the template (same as --new)'],
    config: ['', 'setup wizard with the current values (same as --config)'],
    update: ['', 'update a global npm install to the newest version'],
    feedback: ['', 'wait for page feedback from site -w (--wait --as <name>)'],
    skills: ['', 'install or update the agent skills in the current folder']
};

const commandsHelp = (): string => {
    const rows = Object.entries(COMMANDS).map(([name, [args, about]]): [string, string] => [
        `${name} ${args}`.trim(),
        about
    ]);
    const width = Math.max(...rows.map(([usage]) => usage.length));
    return `\nCommands:\n${rows.map(([usage, about]) => `  ${usage.padEnd(width)}  ${about}`).join('\n')}`;
};

const intro = () => {
    console.log(chalk.blue(figlet.textSync('c4builder')));
    console.log(chalk.gray('Blow up your software documentation writing skills'));
};

// Читает сырой `.c4builder` и разбирает его щадяще (config/parseConfig): для визарда и
// `--list`. Возвращает лишь ЗАДАННЫЕ пользователем и ВАЛИДНЫЕ ключи (недостающее и битое
// = undefined, как читалось до валидации), чтобы визард спросил их на первом запуске,
// а `--list` всё равно показал конфиг. Битые ключи — в `issues` для предупреждения.
function readLenientConfig(conf: ConfStore): {
    config: Partial<C4ConfigFile>;
    issues: ConfigIssue[];
    salvaged: C4ConfigFile;
} {
    const raw = (conf.all ?? {}) as Record<string, unknown>;
    const result = parseConfig(raw);
    const source: C4ConfigFile = result.ok ? result.value : result.salvaged;
    const broken = new Set(result.ok ? [] : result.issues.map((i) => i.key));
    const config = Object.fromEntries(
        Object.keys(source)
            // null в файле = «не задан» (как отсутствие ключа): схема уже подставила
            // дефолт, но визард обязан спросить значение, а не молча принять его.
            .filter((k) => k in raw && raw[k] !== null && !broken.has(k))
            .map((k) => [k, source[k as keyof C4ConfigFile]])
    ) as Partial<C4ConfigFile>;
    return { config, issues: result.ok ? [] : result.issues, salvaged: source };
}

// Строгий путь (сборка) не терпит битого конфига: печатает внятную ошибку и завершает
// процесс с ненулевым кодом. Держим решение о выходе здесь, в CLI, а не в config/*.
function failOnConfigIssues(issues: ConfigIssue[]): never {
    console.error(chalk.red('.c4builder error — invalid values prevent building the documentation:'));
    for (const { key, message } of issues) console.error(chalk.red(`  ${key} — ${message}`));
    process.exit(1);
}

// Щадящий путь (--config/первый запуск визарда) предупреждает о битых ключах: они
// трактуются как «не задано» и будут перезаписаны валидными значениями после визарда.
function warnConfigIssues(issues: ConfigIssue[]): void {
    console.log(
        chalk.yellow('\n⚠ Invalid keys in .c4builder (treated as "not set", the wizard will overwrite them):')
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
        GENERATE_LLMS: c.generateLLMS,
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
        SIDEBAR_COLLAPSE: c.sidebarCollapse,
        EXECUTE_SCRIPT: c.executeScript,
        EXCLUDE_OTHER_FILES: c.excludeOtherFiles,
        USE_SYSTEM_FONTS: c.useSystemFonts,
        QUESTIONS_HEADING: c.questionsHeading,
        UI_LANGUAGE: c.uiLanguage,
        PLUGINS: c.plugins
    };
}

export default async () => {
    program
        .name('c4builder')
        .usage('[command] [options]')
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
        .option(
            '-o, --open [page]',
            'open the generated site in the browser (with --site): the home page, or the OpenSpec change <page> (#/change/<id>)'
        )
        .option('--agent', 'with --site -w: accept page feedback for a coding agent (c4builder feedback)')
        .option('--no-agent', 'with --site -w: no agent feedback even when run by a coding agent')
        .option('--wait', 'for `feedback`: wait for the next batch of page feedback')
        .option(
            '--as <name>',
            'for `feedback`: listener name (your change or task) — the page sends batches to it'
        )
        .option('--docs', 'a brief explanation for the available configuration options')
        .option('--system-fonts', 'render with system fonts instead of the bundled one (not deterministic)')
        .option('-p, --port <n>', 'port used for serving the generated site', (v) => {
            // parseInt молча резал бы опечатку ('30OO' → 30) — валидируем строго.
            if (!isValidPort(v)) throw new InvalidArgumentError('expected a TCP port: an integer 1..65535');
            return Number(v);
        })
        .allowExcessArguments() // позиционные аргументы подкоманд `jre <action>` и `check <file...>`
        .addHelpText('after', commandsHelp())
        .parse(process.argv);

    const opts = program.opts();
    const [cmd, ...cmdArgs] = program.args;

    // allowExcessArguments глотает любой позиционный аргумент — без этой проверки
    // опечатка (`c4builder nwe`) молча превращалась бы в сборку.
    if (cmd !== undefined && !Object.hasOwn(COMMANDS, cmd)) {
        console.error(chalk.red(`unknown command: ${cmd}`));
        console.error(
            `available commands: ${Object.keys(COMMANDS).join(', ')} (see c4builder --help for options)`
        );
        process.exit(1);
    }
    // --version/--help уже вышли в parse. Уведомление — по кэшу прошлой проверки, до её
    // перезапуска; exit покрывает и выходы через process.exit. Вывод `feedback` читает агент.
    if (cmd !== 'update' && cmd !== 'feedback') {
        const next = pendingUpdate();
        if (next)
            process.once('exit', () =>
                process.stderr.write(
                    `c4builder ${next} is available (current ${pkg.version}). Run: c4builder update\n`
                )
            );
        startUpdateCheck();
    }
    // Прогрев JRE — до загрузки конфига проекта и intro: команда самостоятельна.
    if (cmd === 'jre') return cmdJre(cmdArgs, { force: opts.force });
    // Проверка отдельных диаграмм — тоже без конфига проекта.
    if (cmd === 'check') return cmdCheck(cmdArgs);
    // Обновление CLI — до Configstore, чтобы не создавать .c4builder в любом каталоге.
    if (cmd === 'update') return cmdUpdate();
    // Замечания со страницы `site -w` — тоже до Configstore: команду запускают в любом каталоге.
    if (cmd === 'feedback')
        return cmdFeedback(path.join(process.cwd(), opts.configFile ?? '.c4builder'), opts);
    // Установка скиллов — до Configstore: ставит их и в каталог без проекта.
    if (cmd === 'skills') return cmdSkills();
    // `site`/`new`/`config` — позиционные синонимы одноимённых флагов: эту форму печатают
    // подсказки CLI и учат README, шаблон и скиллы.
    if (cmd) opts[cmd] = true;
    // Справочные команды не должны оставлять файлов: конструктор Configstore сразу пишет
    // .c4builder и .c4builder.cache, и следующий запуск считал бы каталог проектом.
    if (opts.docs) return cmdHelp();
    const configPath = path.join(process.cwd(), opts.configFile ?? '.c4builder');
    if ((opts.list || opts.reset) && !opts.new && !fs.existsSync(configPath)) {
        console.error(
            chalk.red(
                `no .c4builder in ${process.cwd()} — run inside a project or create one with c4builder new`
            )
        );
        process.exit(1);
    }
    // Без терминала мастеру неоткуда взять ответы: inquirer падал со стектрейсом и кодом 0.
    if (!opts.new && !process.stdin.isTTY && !fs.existsSync(configPath)) {
        console.error(
            chalk.red(
                `no ${opts.configFile ?? '.c4builder'} in ${process.cwd()} — run c4builder --new, or c4builder --config in a terminal`
            )
        );
        process.exit(1);
    }

    let conf: ConfStore = { get: () => {} } as unknown as ConfStore;
    let cacheConf: ConfStore = { get: () => {}, set: () => {}, clear: () => {} } as unknown as ConfStore;
    // Лок сборки — рядом с конфигом проекта (см. util/lock.ts). Заполняется вместе с conf.
    let lockPath = '';
    if (!opts.new) {
        const projectKey = process.cwd().split(path.sep).splice(1).join('_');
        lockPath = `${configPath}.lock`;
        try {
            // По умолчанию Configstore молча затирает битый JSON пустым конфигом — настройки
            // терялись, а сборка уходила в мастер. --reset стирает конфиг и так.
            conf = new Configstore(projectKey, {}, { configPath, clearInvalidConfig: !!opts.reset });
        } catch (e) {
            console.error(chalk.red(`.c4builder error — cannot read ${configPath}: ${(e as Error).message}`));
            process.exit(1);
        }
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
    const { config: rawConfig, issues: configIssues, salvaged } = readLenientConfig(conf);
    const currentConfig = getOptions(rawConfig);

    if (opts.new || opts.config || !currentConfig.HAS_RUN) clearConsole();

    intro();

    if (!currentConfig.HAS_RUN && !opts.new) {
        console.log(
            `\nif you created the project using the 'c4builder new' command you can just press enter and go with the default options to get a basic idea of how it works.\n`
        );
        console.log(`you can always change the configuration by running > c4builder config\n`);
    }

    if (opts.new) return cmdNewProject(opts);
    if (opts.list) return cmdList(currentConfig, configIssues);

    // Повторная сборка установленного проекта (есть HAS_RUN, не --config) — строгий путь:
    // битый конфиг обязан упасть с внятной ошибкой сразу, а не быть тихо «починен» визардом.
    // Первый запуск (!HAS_RUN) и --config остаются щадящими — это штатный путь восстановления.
    // `plugins` визард не спрашивает — salvage молча переписал бы его в `[]` и сборка
    // прошла бы без раздела плагина; битый `plugins` роняет всегда.
    const strictBuild = !opts.config && !!currentConfig.HAS_RUN;
    if (configIssues.length) {
        if (strictBuild || configIssues.some((i) => i.key === 'plugins')) failOnConfigIssues(configIssues);
        warnConfigIssues(configIssues);
        // Битые ключи чиним физически (salvage-значение = дефолт схемы, либо удаление):
        // визард переспрашивает не всё (вложенные блоки гейтятся generate*-флагами), а
        // строгий parseConfig после него обязан пройти — иначе exit 1 на каждом запуске.
        for (const { key } of configIssues) {
            const v = salvaged[key as keyof C4ConfigFile];
            if (v === undefined) conf.delete(key);
            else conf.set(key, v);
        }
    }

    await cmdCollect(currentConfig, conf, opts);
    if (!opts.config) {
        // При старте, а не при выходе, как уведомление о версии: `site -w` живёт до остановки.
        const skills = skillsNotice();
        if (skills) process.stderr.write(`${skills}\n`);
        let isBuilding = false;
        let attemptedWatchBuild = false;
        // Опции сборки после визарда: строгий разбор итогового конфига. Штатно валиден
        // (визард только что записал корректные значения; повторная сборка с битым конфигом
        // отсеяна выше) — падение здесь страхует от иного невалидного состояния.
        const built = parseConfig((conf.all ?? {}) as Record<string, unknown>);
        if (!built.ok) failOnConfigIssues(built.issues);
        // hasRun — только ПОСЛЕ успешной валидации: битый конфиг с hasRun=true навсегда
        // уводил бы последующие запуски на строгий путь (exit 1 до визарда).
        conf.set('hasRun', true);
        const options = getOptions(built.value);
        if (opts.systemFonts) options.USE_SYSTEM_FONTS = true; // флаг сильнее ключа конфига
        // Плагины грузятся и валидируются до первой сборки: битые опции — exit 1 сразу.
        const plugins = await loadPlugins(options.PLUGINS, process.cwd(), options).catch((e: Error) => {
            console.error(chalk.red(`failed to load plugins: ${e.message}`));
            return process.exit(1);
        });
        const reloadEmitter = new EventEmitter();
        reloadEmitter.setMaxListeners(0);
        // Итог последней удачной сборки (страницы → исходники, переадресации): dev-сервер читает
        // его геттером, поэтому после ребилда в watch видит свежий без рестарта.
        let result: BuildResult = { pages: new Map(), redirects: new Map() };
        if (opts.watch) {
            // node-watch: CJS-рантайм при ESM-.d.ts (export default) — дефолт-импорт
            // типизируется как namespace. Каст к реальной сигнатуре, рантайм не меняется.
            const watchDir = watch as unknown as typeof import('node-watch').default;
            const inside = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + path.sep);
            // Пути наблюдения — абсолютные и без вложенных друг в друга: node-watch дедуплицирует
            // события по имени, а один файл под двумя корнями приходил бы дважды.
            const candidates = [
                path.resolve(options.ROOT_FOLDER),
                ...pluginWatchPaths(plugins, process.cwd(), fs.existsSync)
            ];
            const watchPaths = candidates.filter(
                (p, i) => !candidates.some((q, j) => j !== i && inside(p, q) && (p !== q || j < i))
            );
            // Собственные записи сборки (dist, dist_bk, .c4builder*) не должны триггерить
            // ребилд — при dir плагина, накрывающем cwd, это бесконечная петля.
            const output = outputDirs(options);
            const filter = (name: string, skip: symbol): boolean | symbol =>
                output.some((d) => inside(name, d)) || name.startsWith(configPath) ? skip : true;
            watchDir(watchPaths, { recursive: true, filter }, async (_evt, name) => {
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
                    // Лок на всю серию ребилдов: параллельная ручная сборка в этом же
                    // каталоге не потопчет dist_bk и не потеряет чексуммы кеша. Занят другим
                    // живым процессом (второй `site -w` на той же папке) — ждём до минуты и
                    // собираем сами: иначе ребилд пропадает и браузер не получает reload.
                    const release = await waitBuildLock(lockPath, 60_000, (e) =>
                        console.log(chalk.gray(`waiting for another build: ${e.message}`))
                    );
                    try {
                        result = await build(options, cacheConf, plugins);
                        while (attemptedWatchBuild) {
                            attemptedWatchBuild = false;
                            result = await build(options, cacheConf, plugins);
                        }
                    } finally {
                        release();
                    }
                } catch (err) {
                    buildOk = false;
                    attemptedWatchBuild = false;
                    if (err instanceof BuildLockHeldError) {
                        // Соседняя сборка ещё идёт — ребилд пропущен, watch жив.
                        console.log(chalk.yellow(`rebuild skipped: ${err.message}`));
                    } else {
                        const e = err as Error;
                        console.log(chalk.red(`build failed: ${e?.stack ? e.stack : e}`));
                    }
                } finally {
                    isBuilding = false;
                }
                if (buildOk) reloadEmitter.emit('reload');
            });
        }

        isBuilding = true;
        let release: () => void;
        try {
            release = acquireBuildLock(lockPath);
        } catch (e) {
            // Занято живой сборкой — падаем сразу с внятным сообщением, без стектрейса.
            console.error(chalk.red((e as Error).message));
            process.exit(1);
        }
        try {
            result = await build(options, cacheConf, plugins);
        } finally {
            release();
            // Одиночная сборка: D2-воркер больше не нужен, без teardown он держал бы
            // процесс. В watch-режиме воркер живёт до конца процесса (Ctrl+C).
            if (!opts.watch) {
                await teardownD2();
                await teardownBpmn();
                await teardownMermaid();
            }
        }
        isBuilding = false;

        if (opts.site) {
            try {
                return await cmdSite(
                    options,
                    { ...opts, agent: detectAgent(process.env, opts) },
                    reloadEmitter,
                    () => result
                );
            } catch {
                // Ошибку запуска сервера (занятый порт) cmdSite уже напечатал — остаётся код выхода.
                process.exit(1);
            }
        }

        if (options.GENERATE_WEBSITE && !opts.watch) {
            console.log(chalk.gray('\nto view the generated website run'));
            console.log(`> c4builder site`);
        }
    }
};
