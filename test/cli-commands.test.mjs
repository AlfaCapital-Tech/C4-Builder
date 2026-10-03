import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

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
        expect(res.stderr).toContain('check, jre, site, new, config');
        expect(listTree(dir)).toEqual(before); // ни .c4builder, ни docs
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

    it('`--list` в каталоге проекта печатает конфиг', () => {
        expect(run('new', '--name', 'listed', '-y').status).toBe(0);
        const res = runIn(path.join(dir, 'listed'), '--list');
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toMatch(/Project Name: .*listed/);
    });
});
