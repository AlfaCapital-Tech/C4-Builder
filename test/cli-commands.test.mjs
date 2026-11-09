import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';

import { COMMAND_HELP, defineOptions, FLAG_ALIASES, GLOBAL_OPTIONS } from './dist.mjs';
import { REPO_ROOT, TMP_ROOT } from './helpers.mjs';

// Позиционные подкоманды: `new`/`config` — синонимы флагов, а неизвестная команда —
// ошибка. Раньше allowExcessArguments глотал любой позиционный аргумент и запускал сборку.
fs.mkdirSync(TMP_ROOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'cli-commands-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const runIn = (cwd, ...args) =>
    spawnSync(process.execPath, [path.join(REPO_ROOT, 'dist', 'index.js'), ...args], {
        cwd,
        encoding: 'utf8'
    });
const run = (...args) => runIn(dir, ...args);

const listTree = (root) => fs.readdirSync(root, { recursive: true }).sort();

const COMMANDS = [
    'check',
    'jre',
    'site',
    'new',
    'config',
    'update',
    'feedback',
    'skills',
    'doctor',
    'status',
    'list',
    'reset',
    'docs',
    'help'
];

describe('позиционные подкоманды CLI', () => {
    it('`new --name demo -y` создаёт проект так же, как `--new`', () => {
        const positional = run('new', '--name', 'demo', '-y');
        expect(positional.status, positional.stderr).toBe(0);
        const flag = run('--new', '--name', 'demo-flag', '-y');
        expect(flag.status, flag.stderr).toBe(0);
        expect(listTree(path.join(dir, 'demo'))).toEqual(listTree(path.join(dir, 'demo-flag')));
    });

    it('неизвестная команда → код 1 и список команд, без сборки и промптов', () => {
        const before = listTree(dir);
        const res = run('nwe');
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('unknown command: nwe');
        expect(res.stderr).toContain(
            'check, jre, site, new, config, update, feedback, skills, doctor, status'
        );
        expect(listTree(dir)).toEqual(before); // ни .c4builder, ни docs
    });

    // npm убран из PATH: настоящий реестр и глобальная установка в тестах недопустимы, а ошибка
    // реестра доказывает, что пошло именно обновление, а не мастер или сборка.
    it('`update` в пустом каталоге — обновление CLI без мастера и сборки, каталог пуст', () => {
        const empty = fs.mkdtempSync(path.join(dir, 'empty-'));
        const res = spawnSync(process.execPath, [path.join(REPO_ROOT, 'dist', 'index.js'), 'update'], {
            cwd: empty,
            encoding: 'utf8',
            env: { ...process.env, PATH: empty }
        });
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('could not query the npm registry');
        expect(res.stdout).toBe(''); // ни заставки, ни вопросов мастера
        expect(fs.readdirSync(empty)).toEqual([]);
    });
});

// Справочные команды раньше создавали пустые .c4builder и .c4builder.cache в любом каталоге:
// следующий `c4builder` там уже считал его проектом.
describe('справочные команды без побочных эффектов', () => {
    it('`--docs` в пустом каталоге → код 0, каталог пуст', () => {
        const empty = fs.mkdtempSync(path.join(dir, 'empty-'));
        const res = runIn(empty, '--docs');
        expect(res.status, res.stderr).toBe(0);
        expect(fs.readdirSync(empty)).toEqual([]);
    });

    it.each(['--list', '--reset'])('`%s` вне проекта → ошибка, каталог пуст', (flag) => {
        const empty = fs.mkdtempSync(path.join(dir, 'empty-'));
        const res = runIn(empty, flag);
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain('no .c4builder');
        expect(fs.readdirSync(empty)).toEqual([]);
    });

    it('`--help` — имя c4builder и все подкоманды', () => {
        const res = run('--help');
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toContain('Usage: c4builder');
        for (const cmd of COMMANDS) expect(res.stdout).toMatch(new RegExp(`^  ${cmd}\\b`, 'm'));
    });

    it('`docs` и `list` позиционно — как флаги, каталог пуст', () => {
        const empty = fs.mkdtempSync(path.join(dir, 'empty-'));
        const docs = runIn(empty, 'docs');
        expect(docs.status, docs.stderr).toBe(0);
        expect(docs.stdout).toContain('CONFIGURATION OPTIONS');
        const list = runIn(empty, 'list');
        expect(list.status).toBe(1);
        expect(list.stderr).toContain('no .c4builder');
        expect(fs.readdirSync(empty)).toEqual([]);
    });

    it('`--list` в каталоге проекта печатает конфиг', () => {
        expect(run('new', '--name', 'listed', '-y').status).toBe(0);
        const res = runIn(path.join(dir, 'listed'), '--list');
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toMatch(/Project Name: .*listed/);
    });
});

// Без терминала мастер падал ExitPromptError со стектрейсом и кодом 0 — CI считал сборку
// успешной. Битый JSON Configstore молча затирал, и запуск уходил в тот же мастер.
describe('запуск без терминала', () => {
    const noStack = (res) => expect(`${res.stdout}${res.stderr}`).not.toMatch(/^\s+at /m);

    it('нет .c4builder → код 1 и подсказка, каталог пуст', () => {
        const empty = fs.mkdtempSync(path.join(dir, 'empty-'));
        const res = runIn(empty);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain(`no .c4builder in ${empty} — run c4builder new`);
        noStack(res);
        expect(fs.readdirSync(empty)).toEqual([]);
    });

    it('битый JSON в .c4builder → код 1 с причиной, файл не тронут', () => {
        const broken = fs.mkdtempSync(path.join(dir, 'broken-'));
        fs.writeFileSync(path.join(broken, '.c4builder'), '{bad');
        const res = runIn(broken);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain(`cannot read ${path.join(broken, '.c4builder')}: `);
        noStack(res);
        expect(fs.readFileSync(path.join(broken, '.c4builder'), 'utf8')).toBe('{bad');
    });

    it('неполный .c4builder → мастер закрыт, код 1 без стектрейса', () => {
        const partial = fs.mkdtempSync(path.join(dir, 'partial-'));
        fs.writeFileSync(path.join(partial, '.c4builder'), '{"projectName":"p"}');
        const res = runIn(partial);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('aborted: the prompt was closed (no terminal for the wizard)');
        noStack(res);
    });
});

// Справка по команде (change command-help): `<cmd> --help` печатал общую справку со всеми ~30 флагами,
// и агент, знакомясь с командой, получал чужие флаги без форматов вывода и кодов возврата.
describe('справка', () => {
    const ONLY_IN_COMMANDS = [
        '--wait',
        '--as',
        '--force',
        '--name',
        '--yes',
        '--open-change',
        '--agent',
        '--json'
    ];
    const flags = (text) => new Set(text.match(/(?<![\w-])--[a-z][\w-]*/g));
    const helpIn = (...args) => {
        const empty = fs.mkdtempSync(path.join(dir, 'help-'));
        const res = runIn(empty, ...args);
        expect(fs.readdirSync(empty), `${args.join(' ')}: файлы в каталоге`).toEqual([]);
        return res;
    };

    it.each([['--help'], ['-h'], ['help']])('`%s` — общая: команды и только глобальные опции', (arg) => {
        const res = helpIn(arg);
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toContain('Usage: c4builder');
        expect(res.stdout).toContain('builds the documentation');
        expect(res.stdout).toContain('c4builder <command> --help');
        for (const opt of [
            '-c, --config-file',
            '-w, --watch',
            '-p, --port',
            '--system-fonts',
            '-V, --version',
            '-h, --help'
        ])
            expect(res.stdout).toContain(opt);
        const shown = flags(res.stdout);
        for (const f of [...ONLY_IN_COMMANDS, ...FLAG_ALIASES]) expect(shown.has(f), f).toBe(false);
    });

    it.each(COMMANDS)('`%s` — справка через --help, -h и help <cmd> одинакова, код 0', (cmd) => {
        const long = helpIn(cmd, '--help');
        expect(long.status, long.stderr).toBe(0);
        expect(long.stdout).toMatch(new RegExp(`^Usage: c4builder ${cmd}\\b`));
        expect(long.stdout).toContain('Exit codes:');
        expect(long.stdout).toContain('Examples:');
        expect(helpIn(cmd, '-h').stdout).toBe(long.stdout);
        expect(helpIn('help', cmd).stdout).toBe(long.stdout);
    });

    it.each(FLAG_ALIASES)('`help %s` — справка команды, как `%s --help`', (alias) => {
        const res = helpIn('help', alias);
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toBe(helpIn(alias, '--help').stdout);
        expect(res.stdout).toContain(`Usage: c4builder ${alias.slice(2)}`);
    });

    it('`check --help` — без чужих флагов, формат вывода и коды', () => {
        const { stdout } = helpIn('check', '--help');
        expect(stdout).toContain('Usage: c4builder check <files...>');
        const shown = flags(stdout);
        for (const f of ['--wait', '--as', '--force', '--name', '--open-change'])
            expect(shown.has(f), f).toBe(false);
        expect(stdout).toContain('✓ <file>');
        expect(stdout).toContain('✗ <file>: line <N>: <message>');
        expect(stdout).toMatch(/^ {2}0 {2}/m);
        expect(stdout).toMatch(/^ {2}1 {2}/m);
    });

    it('`feedback -h` — свои опции и код 2', () => {
        const { stdout } = helpIn('feedback', '-h');
        for (const opt of ['--wait', '--as <name>', '-p, --port <n>']) expect(stdout).toContain(opt);
        expect(stdout).not.toContain('--force');
        expect(stdout).not.toContain('--open-change');
        expect(stdout).toContain('stdout');
        expect(stdout).toMatch(/^ {2}2 {2}--as is missing or invalid/m);
    });

    it('`doctor --help` — группы, --json и коды 0/1/2', () => {
        const { stdout } = helpIn('doctor', '--help');
        expect(stdout).toContain('env, skills, render, project, runtime');
        expect(stdout).toContain('--json');
        expect(stdout).toMatch(/^ {2}1 {2}.*--strict/m);
        expect(stdout).toMatch(/^ {2}2 {2}unknown group/m);
    });

    it('аргументы команды не мешают справке: файл не проверяется, JRE не скачивается', () => {
        const check = helpIn('check', 'missing.puml', '--help');
        expect(check.status, check.stderr).toBe(0);
        expect(check.stdout).toContain('Usage: c4builder check');
        expect(check.stderr).toBe('');
        const jre = helpIn('jre', 'install', '--help');
        expect(jre.status, jre.stderr).toBe(0);
        expect(jre.stdout).toBe(helpIn('jre', '--help').stdout); // ни строк загрузки, ни «JRE ready …: /path»
    });

    it.each([
        ['serve', '--help'],
        ['help', 'serve']
    ])('`%s %s` — неизвестная команда, код 1', (...args) => {
        const res = helpIn(...args);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('unknown command: serve');
        expect(res.stdout).toBe('');
    });

    // Тест полноты: новая опция, не попавшая ни в одну таблицу справки, была бы невидима.
    it('каждая опция commander, кроме флаговых алиасов, есть в справке', () => {
        const registered = defineOptions(new Command()).options.map((o) => o.long);
        const listed = new Set([...GLOBAL_OPTIONS, ...Object.values(COMMAND_HELP).flatMap((h) => h.options)]);
        const missing = registered.filter((o) => !FLAG_ALIASES.includes(o) && !listed.has(o));
        expect(missing).toEqual([]);
        expect(
            [...listed].filter((o) => !registered.includes(o)),
            'в таблице — незарегистрированная опция'
        ).toEqual([]);
        expect(Object.keys(COMMAND_HELP)).toEqual(COMMANDS);
    });
});
