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

const run = (...args) =>
    spawnSync(process.execPath, [path.join(REPO_ROOT, 'dist', 'index.js'), ...args], {
        cwd: dir,
        encoding: 'utf8'
    });

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
