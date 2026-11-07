import type { Command, Option } from 'commander';

import { EXTENSIONS } from './commands/check.ts';
import { GROUP_NAMES } from './commands/doctor.ts';

// Справка CLI (change command-help). Своя, а не commander-овская: commander знает одну программу
// с плоским набором опций и на `check --help` печатал все ~30 флагов всех команд. Здесь — какие
// опции относятся к команде, формат вывода и коды возврата; сами тексты опций (флаги и описание)
// берутся из регистрации в commander, чтобы описание жило в одном месте.

interface CommandHelp {
    args: string;
    // Строка в списке команд общей справки.
    summary: string;
    // Абзац в справке команды; без него — summary.
    about?: string;
    // Длинные имена опций, зарегистрированных в commander.
    options: string[];
    // [образец строки, пояснение]
    output?: [sample: string, meaning: string][];
    exit: [code: number, meaning: string][];
    examples: string[];
}

// Опции, применимые к нескольким командам или к сборке без команды.
export const GLOBAL_OPTIONS = ['--config-file', '--watch', '--port', '--system-fonts', '--version', '--help'];

// Флаговые формы команд: работают как раньше, но в справке их нет — каноническая форма позиционная.
export const FLAG_ALIASES = ['--site', '--new', '--config', '--list', '--reset', '--docs'];

const OK_OR_ERROR: CommandHelp['exit'] = [
    [0, 'success'],
    [1, 'error']
];

// Порядок ключей — порядок в списке команд и в сообщении о неизвестной команде.
export const COMMAND_HELP: Record<string, CommandHelp> = {
    check: {
        args: '<files...>',
        summary: 'check diagrams without a build',
        about: `Checks diagram files without a project or a build: ${EXTENSIONS.join(', ')}. A file with another extension is an error.`,
        options: [],
        output: [
            ['✓ <file>', 'stdout: the file is valid'],
            ['✗ <file>: line <N>: <message>', 'stderr: a .puml error, line from the start of the file'],
            [
                '✗ <file>: <message>',
                'stderr: other errors (.iuml without a line); BPMN and wireflow print a line per problem, mermaid starts with line <N>'
            ]
        ],
        exit: [
            [0, 'all files are valid'],
            [1, 'at least one file has errors, or no files given']
        ],
        examples: ['c4builder check src/context.puml', 'c4builder check src/*.d2 src/process.bpmn']
    },
    jre: {
        args: 'info|install',
        summary: 'managed JRE parameters | download a JRE in advance',
        about: 'PlantUML needs Java. "install" resolves it ahead of a build (CI, offline): a suitable system java is used as is, otherwise a JRE is downloaded into the cache. "info" prints the managed JRE parameters for external caches (CI).',
        options: ['--force'],
        output: [
            ['{"feature":…,"schema":…,"cacheDir":"…"}', 'jre info: one JSON line, stdout'],
            ['JRE ready (<source>): <path>', 'jre install: the Java that builds will use']
        ],
        exit: [
            [0, 'success'],
            [1, 'unknown subcommand or the download failed']
        ],
        examples: ['c4builder jre install', 'c4builder jre info']
    },
    site: {
        args: '',
        summary: 'build and serve the site locally',
        about: 'Builds the documentation and serves the site on http://localhost:<port>. With -w it rebuilds on changes and reloads the page; when run by a coding agent, -w also accepts page feedback for c4builder feedback.',
        options: [
            '--watch',
            '--open',
            '--open-change',
            '--agent',
            '--no-agent',
            '--port',
            '--config-file',
            '--system-fonts'
        ],
        exit: OK_OR_ERROR,
        examples: ['c4builder site -w', 'c4builder site -w --open-change add-dark-mode']
    },
    new: {
        args: '',
        summary: 'create a project from the template',
        about: 'Creates a project folder from the template in the current folder. Without -y asks the name and settings interactively.',
        options: ['--name', '--yes'],
        exit: OK_OR_ERROR,
        examples: ['c4builder new', 'c4builder new --name demo -y']
    },
    config: {
        args: '',
        summary: 'setup wizard with the current values',
        about: 'Runs the setup wizard for the project in the current folder with the current values as defaults and saves .c4builder. Needs a terminal.',
        options: ['--config-file'],
        exit: OK_OR_ERROR,
        examples: ['c4builder config']
    },
    update: {
        args: '',
        summary: 'update a global npm install to the newest version',
        about: 'Updates a global npm install of c4builder to the newest version. For a project dependency or the Docker image prints what to run instead.',
        options: [],
        exit: [
            [0, 'up to date or updated'],
            [1, 'the registry is unreachable, or not a global npm install (npm exit code if npm fails)']
        ],
        examples: ['c4builder update']
    },
    feedback: {
        args: '',
        summary: 'wait for page feedback from site -w',
        about: 'Gets a batch of page feedback for a coding agent from the c4builder site -w server of the current folder (port: -p or webPort of .c4builder). Without --wait returns at once when there is no new feedback.',
        options: ['--wait', '--as', '--port', '--config-file'],
        output: [
            ['<batch>', 'stdout: the batch of page feedback as text; nothing when there is none'],
            ['Change page: <url>', 'stderr: the change page, when --as names an OpenSpec change of the site']
        ],
        exit: [
            [0, 'a batch was printed, or no new feedback without --wait'],
            [
                1,
                'no site -w server, agent feedback is disabled (no -w or --no-agent), or an unexpected response'
            ],
            [2, '--as is missing or invalid']
        ],
        examples: ['c4builder feedback --wait --as add-dark-mode']
    },
    skills: {
        args: '',
        summary: 'install or update the agent skills in the current folder',
        about: 'Installs the agent skills of this c4builder version into .agents/skills of the current folder (and .claude/skills under Claude Code or when .claude exists); older copies are replaced.',
        options: [],
        exit: OK_OR_ERROR,
        examples: ['c4builder skills']
    },
    doctor: {
        args: '[group...]',
        summary: `diagnose ${GROUP_NAMES.join(', ')} (read-only)`,
        about: `Diagnoses the environment and the project without changing anything. Groups: ${GROUP_NAMES.join(', ')}; all of them without arguments.`,
        options: ['--json', '--verbose', '--strict', '--full', '--offline', '--port', '--config-file'],
        output: [
            [
                '✓ | ! | ✗ | – <message>',
                'a line per check: ok, warning, error, skipped; paths are shortened without -v'
            ],
            [
                '{"version":…,"checks":[…],"summary":{…}}',
                'with --json: one JSON object instead; checks have stable ids'
            ]
        ],
        exit: [
            [0, 'no errors'],
            [1, 'errors found (with --strict, warnings too)'],
            [2, 'unknown group']
        ],
        examples: ['c4builder doctor', 'c4builder doctor env render --json']
    },
    list: {
        args: '',
        summary: 'print the current configuration',
        options: ['--config-file'],
        exit: [
            [0, 'success'],
            [1, 'no .c4builder in the current folder']
        ],
        examples: ['c4builder list']
    },
    reset: {
        args: '',
        summary: 'clear the configuration of the current folder',
        about: 'Clears .c4builder and its cache in the current folder; the next run starts the setup wizard.',
        options: ['--config-file'],
        exit: [
            [0, 'success'],
            [1, 'no .c4builder in the current folder']
        ],
        examples: ['c4builder reset']
    },
    docs: {
        args: '',
        summary: 'explain the configuration options',
        about: 'Prints links to the full documentation and a brief explanation of the configuration options. Works in any folder.',
        options: [],
        exit: [[0, 'success']],
        examples: ['c4builder docs']
    },
    help: {
        args: '[command]',
        summary: 'show help for a command',
        about: 'Same as c4builder <command> --help; without a command prints the general help.',
        options: [],
        exit: [
            [0, 'success'],
            [1, 'unknown command']
        ],
        examples: ['c4builder help check']
    }
};

const table = (rows: [string, string][]): string => {
    const width = Math.max(...rows.map(([left]) => left.length));
    return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`).join('\n');
};

// Неизвестное имя — ошибка разработчика (опция переименована, а таблица нет), её ловит тест полноты.
const optionRows = (program: Command, names: string[]): [string, string][] =>
    names.map((name) => {
        const option = program.options.find((o: Option) => o.long === name);
        if (!option) throw new Error(`help: unknown option ${name}`);
        return [option.flags, option.description];
    });

// Абзац — по словам до 80 символов: справку читают и в терминале, а не только агенты.
const wrap = (text: string, width = 80): string =>
    text
        .split(' ')
        .reduce<string[]>((lines, word) => {
            const last = lines.at(-1);
            if (last !== undefined && `${last} ${word}`.length <= width)
                lines[lines.length - 1] = `${last} ${word}`;
            else lines.push(word);
            return lines;
        }, [])
        .join('\n');

const usage = (name: string, h: CommandHelp): string =>
    ['Usage: c4builder', name, h.args, h.options.length ? '[options]' : ''].filter(Boolean).join(' ');

export const generalHelp = (program: Command): string =>
    [
        'Usage: c4builder [command] [options]',
        '',
        'Without a command, builds the documentation of the project in the current folder',
        '(runs the setup wizard first if there is no .c4builder).',
        '',
        'Commands:',
        table(Object.entries(COMMAND_HELP).map(([name, h]) => [`${name} ${h.args}`.trim(), h.summary])),
        '',
        'Options:',
        table(optionRows(program, GLOBAL_OPTIONS)),
        '',
        'Run c4builder <command> --help for its options, output format and exit codes.',
        ''
    ].join('\n');

export const commandHelp = (program: Command, name: string): string => {
    const h = COMMAND_HELP[name];
    const blocks = [usage(name, h), wrap(h.about ?? `${h.summary[0].toUpperCase()}${h.summary.slice(1)}.`)];
    if (h.options.length) blocks.push(`Options:\n${table(optionRows(program, h.options))}`);
    if (h.output) blocks.push(`Output:\n${table(h.output)}`);
    blocks.push(`Exit codes:\n${table(h.exit.map(([code, meaning]) => [String(code), meaning]))}`);
    blocks.push(`Examples:\n${h.examples.map((e) => `  ${e}`).join('\n')}`);
    return `${blocks.join('\n\n')}\n`;
};
