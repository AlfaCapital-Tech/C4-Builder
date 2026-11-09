import figlet from 'figlet';
import { program } from 'commander';
import chalk from 'chalk';
import path from 'node:path';

import Configstore from 'configstore';

import cmdDocs from './commands/docs.ts';
import cmdNewProject from './commands/new.ts';
import cmdJre from './commands/jre.ts';
import cmdCheck from './commands/check.ts';
import cmdList from './commands/list.ts';
import cmdSite, { reuseRunningServer } from './commands/site.ts';
import cmdStatus from './commands/status.ts';
import { liveServer } from './server-state.ts';
import cmdFeedback from './commands/feedback.ts';
import cmdSkills, { skillsNotice } from './commands/skills.ts';
import cmdDoctor from './commands/doctor.ts';
import { detectAgent } from './agent.ts';
import { COMMAND_HELP, commandHelp, FLAG_ALIASES, generalHelp, HELP_EXIT, NO_PROJECT_EXIT } from './help.ts';
import { defineOptions } from './options.ts';
import { cmdUpdate, pendingUpdate, startUpdateCheck } from './update.ts';
import cmdCollect from './wizard/collect.ts';
import { build, type BuildResult } from '../core/build.ts';
import type { DiagramQueue } from '../core/render/diagrams.ts';
import { isVerbose } from './verbose.ts';
import { loadPlugins, pluginWatchPaths } from '../core/plugins/load.ts';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';

import { clearConsole } from '../util/utils.ts';
import { acquireBuildLock, BuildLockHeldError, waitBuildLock } from '../util/lock.ts';
import { watchTree } from '../util/watch.ts';
// teardownD2 живёт здесь, а не в finally build(): в watch-режиме D2-воркер должен
// переживать ребилды (его пересоздание — секунды), гасим его только когда сборок
// больше не будет (одиночный запуск).
import { teardownD2 } from '../core/render/d2renderer.ts';
import { teardownBpmn } from '../core/render/bpmnrenderer.ts';
import { teardownMermaid } from '../core/render/mermaidrenderer.ts';
import { packageJson as pkg } from '../util/paths.ts';
import type { BuildOptions, C4ConfigFile, ConfigIssue } from '../config/options.ts';
import { outputDirs, parseConfig } from '../config/options.ts';
import { commentsLog, configWarnings } from '../config/schema.ts';

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

// Баннер — только в терминале: в CI, логе агента и файле это ~10 строк шума перед делом.
const intro = () => {
    if (!process.stdout.isTTY) return;
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
        BUTTONS: c.buttons,
        // Ключ `comments` или прежний `reviewLog`; выключенный журнал для сборки равен отсутствующему.
        REVIEW_LOG: commentsLog(c),
        UI_LANGUAGE: c.uiLanguage,
        PLUGINS: c.plugins
    };
}

const unknownCommand = (name: string): never => {
    console.error(chalk.red(`unknown command: ${name}`));
    console.error(
        `available commands: ${Object.keys(COMMAND_HELP).join(', ')} (see c4builder --help for options)`
    );
    process.exit(HELP_EXIT.unknown[0]);
};

// Флаговая форма команды вместе с --help (`c4builder --site --help`) — справка этой команды.
const ALIAS_COMMANDS = FLAG_ALIASES.map((f) => f.slice(2));

export default async () => {
    defineOptions(program).parse(process.argv);

    const opts = program.opts();
    const [cmd, ...cmdArgs] = program.args;

    // allowExcessArguments глотает любой позиционный аргумент — без этой проверки опечатка
    // (`c4builder nwe`) молча превращалась бы в сборку. Таблица справки — единственный список команд.
    if (cmd !== undefined && !Object.hasOwn(COMMAND_HELP, cmd)) unknownCommand(cmd);
    // Справка — до уведомления о версии, Configstore и проверки терминала: она не должна ни создавать
    // файлов, ни скачивать JRE (`jre install --help`), ни проверять файл (`check x.puml --help`).
    if (opts.help || cmd === 'help') {
        // `help <cmd>` и `help --site` — как `<cmd> --help` и `--site --help`; `help --help` —
        // справка самой команды help.
        const alias = ALIAS_COMMANDS.find((c) => opts[c]);
        const topic =
            cmd === 'help' ? (cmdArgs[0] ?? alias ?? (opts.help ? 'help' : undefined)) : (cmd ?? alias);
        if (topic !== undefined && !Object.hasOwn(COMMAND_HELP, topic)) unknownCommand(topic);
        process.stdout.write(topic === undefined ? generalHelp(program) : commandHelp(program, topic));
        return;
    }
    // Опции только для `check` глобальные (commander не знает подкоманд), и другая команда молча
    // их игнорировала бы: `doctor --format json` печатал бы текст с кодом 0, и CI разбирал бы его.
    for (const [flag, value] of [
        ['--format', opts.format],
        ['--files-from', opts.filesFrom]
    ] as const)
        if (value !== undefined && cmd !== 'check') {
            const hint = flag === '--format' ? ' (use --json for doctor)' : '';
            console.error(chalk.red(`${flag} is only supported by check${hint}`));
            process.exit(1);
        }
    // --version уже вышел в parse, справка — выше. Уведомление — по кэшу прошлой проверки, до её
    // перезапуска; exit покрывает и выходы через process.exit. Вывод `feedback` и `status` читает агент;
    // doctor сообщает о новой версии сам, а фоновый `npm view` ходил бы в сеть и с --offline.
    if (cmd !== 'update' && cmd !== 'feedback' && cmd !== 'doctor' && cmd !== 'status') {
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
    if (cmd === 'check') return cmdCheck(cmdArgs, { ...opts, verbose: isVerbose(opts) });
    // Обновление CLI — до Configstore, чтобы не создавать .c4builder в любом каталоге.
    if (cmd === 'update') return cmdUpdate();
    // Замечания со страницы `site -w` — тоже до Configstore: команду запускают в любом каталоге.
    if (cmd === 'feedback')
        return cmdFeedback(path.join(process.cwd(), opts.configFile ?? '.c4builder'), opts);
    // Установка скиллов — до Configstore: ставит их и в каталог без проекта.
    if (cmd === 'skills') return cmdSkills();
    // Состояние dev-сервера — до Configstore: только читает, работает и вне проекта.
    if (cmd === 'status') return cmdStatus(path.join(process.cwd(), opts.configFile ?? '.c4builder'), opts);
    // Диагностика — тоже до Configstore и проверки терминала: работает вне проекта, в CI и под агентом.
    if (cmd === 'doctor') return cmdDoctor(cmdArgs, opts);
    // `site`/`new`/`config`/`list`/`reset`/`docs` — позиционные синонимы одноимённых флагов:
    // эту форму печатают справка и подсказки CLI, учат README, шаблон и скиллы.
    if (cmd) opts[cmd] = true;
    // Справочные команды не должны оставлять файлов: конструктор Configstore сразу пишет
    // .c4builder и .c4builder.cache, и следующий запуск считал бы каталог проектом.
    if (opts.docs) return cmdDocs();
    const configPath = path.join(process.cwd(), opts.configFile ?? '.c4builder');
    if ((opts.list || opts.reset) && !opts.new && !fs.existsSync(configPath)) {
        console.error(
            chalk.red(
                `no .c4builder in ${process.cwd()} — run inside a project or create one with c4builder new`
            )
        );
        process.exit(NO_PROJECT_EXIT.noProject[0]);
    }
    // Без терминала мастеру неоткуда взять ответы: inquirer падал со стектрейсом и кодом 0.
    if (!opts.new && !process.stdin.isTTY && !fs.existsSync(configPath)) {
        console.error(
            chalk.red(
                `no ${opts.configFile ?? '.c4builder'} in ${process.cwd()} — run c4builder new, or c4builder config in a terminal`
            )
        );
        process.exit(1);
    }
    // Сервер этого конфига уже работает (change site-server-state, D7) — до лока и сборки: иначе
    // повторный запуск пересобрал бы dist, который раздаёт первый сервер.
    if (opts.site && !opts.new && !opts.config && !opts.list && !opts.reset) {
        const live = await liveServer(configPath);
        if (live) process.exit(await reuseRunningServer(live.state, opts));
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
        for (const w of configWarnings((conf.all ?? {}) as Record<string, unknown>))
            console.log(chalk.yellow(`⚠ .c4builder: ${w}`));
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
        // Пересборка в watch (по правке и после фоновой очереди) — одна на оба пути, чтобы их
        // протоколы не расходились. softErrors: упавшая диаграмма не кэшируется и упала бы на
        // каждом ребилде — обычная сборка оставила бы сайт без страниц, пока её не починят;
        // здесь она получает заглушку с ошибкой. Правки во время сборки — ещё один проход.
        // failedRenders — упавшие за сессию: без изменений входа они не рендерятся снова (иначе
        // каждая битая .puml — лишний JVM под локом на каждом ребилде). offThread: при живом
        // dev-сервере BPMN и mermaid рендерятся в worker-потоке, сервер не замирает.
        const failedRenders = new Map<string, string>();
        const offThread = !!opts.site;
        // Подробности ошибок диаграмм (stderr движка, стек) — во всех путях сборки, в т.ч. мягких.
        const verbose = isVerbose(opts);
        // Ошибку сборки печатает и гасит (false): watch и сервер живы, прежний result в силе.
        const rebuild = async (): Promise<boolean> => {
            try {
                do {
                    attemptedWatchBuild = false;
                    result = await build(options, cacheConf, plugins, {
                        softErrors: true,
                        failedRenders,
                        offThread,
                        verbose
                    });
                } while (attemptedWatchBuild);
                return true;
            } catch (err) {
                attemptedWatchBuild = false;
                const e = err as Error;
                console.log(chalk.red(`build failed: ${e?.stack ? e.stack : e}`));
                return false;
            }
        };
        if (opts.watch) {
            const inside = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + path.sep);
            // Пути наблюдения — абсолютные и без вложенных друг в друга: вложенный корень на
            // macOS/Windows дал бы второй рекурсивный наблюдатель на то же дерево.
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
            const ignore = (p: string): boolean =>
                output.some((d) => inside(p, d)) || p.startsWith(configPath);
            watchTree(watchPaths, { ignore }, async (paths) => {
                // Временный файл sed -i к моменту пачки уже исчез — в лог идёт живой путь.
                const name = paths.find((p) => fs.existsSync(p)) ?? paths[0];
                const more = paths.length > 1 ? ` (+${paths.length - 1} more)` : '';
                console.log(chalk.gray(`\n${name}${more} changed. Rebuilding...`));
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
                let buildOk = false;
                try {
                    // Лок на всю серию ребилдов: параллельная ручная сборка в этом же
                    // каталоге не потопчет dist_bk и не потеряет чексуммы кеша. Занят другим
                    // живым процессом (второй `site -w` на той же папке) — ждём до минуты и
                    // собираем сами: иначе ребилд пропадает и браузер не получает reload.
                    const release = await waitBuildLock(lockPath, 60_000, (e) =>
                        console.log(chalk.gray(`waiting for another build: ${e.message}`))
                    );
                    try {
                        buildOk = await rebuild();
                    } finally {
                        release();
                    }
                } catch (err) {
                    // Сюда — только ошибки лока: ошибку сборки rebuild гасит сам.
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
        // Dev-сервер (change site-warm-start): первая сборка не ждёт диаграмм без кэша —
        // сервер поднимается на заглушках, рендер идёт в фоне после `serving`. Очередь живёт
        // в переменной, чтобы dev-сервер мог поднимать диаграммы открытой страницы в её голову.
        let pending: DiagramQueue | undefined;
        try {
            const deferImages = !!(opts.site && opts.watch);
            result = await build(options, cacheConf, plugins, {
                deferImages,
                verbose,
                ...(deferImages ? { failedRenders, offThread } : {})
            });
            ({ pending } = result);
            // Правка во время первой сборки: watch только взвёл attemptedWatchBuild — ребилд
            // за ним делает ждущая сторона. При фоновой очереди это её финальная пересборка,
            // без очереди — здесь, пока лок ещё наш. Иначе правка терялась до следующей.
            if (!pending && attemptedWatchBuild) await rebuild();
        } finally {
            // Лок и флаг сборки держим, пока фоновый рендер пишет в dist (снимаются ниже).
            if (!pending) release();
            // Одиночная сборка: D2-воркер больше не нужен, без teardown он держал бы
            // процесс. В watch-режиме воркер живёт до конца процесса (Ctrl+C).
            if (!opts.watch) {
                await teardownD2();
                await teardownBpmn();
                await teardownMermaid();
            }
        }
        if (!pending) isBuilding = false;

        if (opts.site) {
            // Без обработчиков Ctrl+C и SIGTERM завершают Node без события exit — файл состояния
            // сервера остался бы. 128 + n — код, которым оболочка и так отметила бы сигнал. SIGHUP не
            // перехватываем: обработчик отменил бы его игнорирование под nohup и закрытие терминала
            // гасило бы сервер; без nohup файл после SIGHUP остаётся и недействителен по pid (D4).
            for (const signal of ['SIGINT', 'SIGTERM'] as const)
                process.once(signal, () => process.exit(128 + os.constants.signals[signal]));
            try {
                await cmdSite(
                    options,
                    { ...opts, configPath, agent: detectAgent(process.env, opts) },
                    reloadEmitter,
                    () => result,
                    (page) => pending?.prioritize(page)
                );
            } catch {
                // Ошибку запуска сервера (занятый порт) cmdSite уже напечатал — остаётся код выхода.
                process.exit(1);
            }
            if (!pending) return;
            // Фоновый рендер холодного старта. Готовая картинка → событие `image` открытым
            // страницам (подмена <img> на месте); по окончании очереди — обычная пересборка из
            // кэша и reload: так embedDiagram, complete-документ и llms получают картинки, а
            // правки исходников во время рендера (attemptedWatchBuild) не теряются.
            const queue = pending;
            const started = Date.now();
            console.log(`rendering ${queue.size} diagrams in background…`);
            let done = 0;
            queue.onDone((out) => {
                done++;
                if (process.stdout.isTTY) process.stdout.write(`rendered ${done}/${queue.size} diagrams\r`);
                reloadEmitter.emit('image', { path: out });
            });
            try {
                await queue.run();
            } catch (err) {
                // Задачи отложенного режима ловят свои ошибки сами; сюда попадает только сбой
                // самой очереди — сервер всё равно не роняем.
                console.log(chalk.red(`background render failed: ${(err as Error)?.message ?? err}`));
            }
            pending = undefined;
            console.log(`rendered ${queue.size} diagrams in ${(Date.now() - started) / 1000} s`);
            let buildOk = false;
            try {
                buildOk = await rebuild();
            } finally {
                release();
                isBuilding = false;
            }
            if (buildOk) reloadEmitter.emit('reload');
            return;
        }

        if (options.GENERATE_WEBSITE && !opts.watch) {
            console.log(chalk.gray('\nto view the generated website run'));
            console.log(`> c4builder site`);
        }
    }
};
