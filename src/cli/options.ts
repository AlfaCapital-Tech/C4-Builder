import { type Command, InvalidArgumentError, Option } from 'commander';

import { isValidPort } from '../config/schema.ts';
import { FORMATS } from './commands/check.report.ts';
import { packageJson as pkg } from '../util/paths.ts';

// Регистрация опций — отдельно от диспетчера: тест полноты справки сверяет с ней таблицы help.ts,
// не загружая весь граф CLI (визард, сборку, команды).
// Описания без «for `x`:» — к какой команде относится опция, видно по справке команды.
export const defineOptions = (cmd: Command): Command =>
    cmd
        .name('c4builder')
        .version(pkg.version, '-V, --version', 'print the version')
        // Встроенная справка commander срабатывала внутри parse() и на `check --help` печатала
        // справку программы целиком; своя опция оставляет выбор справки диспетчеру.
        .helpOption(false)
        .option('-h, --help', 'show help (c4builder <command> --help for a command)')
        .option('--new', 'same as c4builder new')
        .option('--name <name>', 'project name (skips the name prompt)')
        .option('-y, --yes', 'non-interactive: defaults, no prompts (requires --name)')
        .option('--force', 'with install: download a JRE even if system java is suitable')
        .option('--config', 'same as c4builder config')
        .option('-c, --config-file <path>', 'configuration file relative to the current folder (.c4builder)')
        .option('--list', 'same as c4builder list')
        .option('--reset', 'same as c4builder reset')
        .option('--site', 'same as c4builder site')
        .option('-w, --watch', 'watch for changes and rebuild')
        .option('-o, --open', 'open the site in the browser')
        // Отдельная опция, а не `--open [id]`: необязательное значение забирало бы следующий
        // токен (`-o site`, `-ow`, `-wop 3918` меняли смысл).
        .option(
            '--open-change <id>',
            'open the page of the OpenSpec change <id> (#/change/<id>) in the browser'
        )
        .option('--agent', 'with -w: accept page feedback for a coding agent (c4builder feedback)')
        .option('--no-agent', 'with -w: no agent feedback even when run by a coding agent')
        .option('--wait', 'wait for the next batch of page feedback')
        .option('--as <name>', 'listener name (your change or task) — the page sends batches to it')
        .option(
            '--json',
            'JSON output (doctor: one object with stable check ids; check: same as --format json)'
        )
        // choices: опечатку (`--format jsno`) commander отклоняет со списком значений и кодом 1,
        // а не молча печатает текст, который CI не разберёт.
        .addOption(
            new Option('--format <format>', 'output format: json, github, gitlab for agents and CI').choices(
                FORMATS
            )
        )
        .option('--files-from <file>', 'also check the paths listed in a file, one per line (- for stdin)')
        .option(
            '-v, --verbose',
            'full engine output on diagram errors (build, check; also DEBUG=c4builder); doctor: absolute paths and details'
        )
        .option('--strict', 'exit code 1 on warnings too')
        .option('--full', 'build the template project in a temporary folder')
        .option('--offline', 'no network requests')
        .option('--docs', 'same as c4builder docs')
        .option('--system-fonts', 'render with system fonts instead of the bundled one (not deterministic)')
        .option(
            '-p, --port <n>',
            'port of the local site (default: webPort of .c4builder; feedback, doctor, status: the running site)',
            (v) => {
                // parseInt молча резал бы опечатку ('30OO' → 30) — валидируем строго.
                if (!isValidPort(v))
                    throw new InvalidArgumentError('expected a TCP port: an integer 1..65535');
                return Number(v);
            }
        )
        .allowExcessArguments(); // позиционные аргументы подкоманд `jre <action>` и `check <file...>`
