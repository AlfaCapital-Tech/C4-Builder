import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { REPO_ROOT, TMP_ROOT } from './helpers.mjs';

// Подсказка после сборки печатает `c4builder site` — форма обязана работать наравне
// с `--site`, иначе allowExcessArguments молча глотает её и команда просто пересобирает.
const CONFIG = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/default.c4builder.json'), 'utf8')
);

fs.mkdirSync(TMP_ROOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'cli-site-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const serve = (args) =>
    new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(REPO_ROOT, 'dist', 'index.js'), ...args], {
            cwd: dir,
            encoding: 'utf8'
        });
        let out = '';
        const done = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`сервер не поднялся за 30 с:\n${out}`));
        }, 30_000);
        child.stdout.on('data', (d) => {
            out += d;
            if (out.includes('serving your docsify site')) {
                clearTimeout(done);
                child.kill('SIGTERM');
                resolve(out);
            }
        });
        child.stderr.on('data', (d) => (out += d));
        child.on('exit', (code) => {
            clearTimeout(done);
            if (!out.includes('serving your docsify site'))
                reject(new Error(`процесс завершился (exit=${code}) вместо запуска сервера:\n${out}`));
        });
    });

describe('c4builder site', () => {
    it('позиционная подкоманда поднимает сервер так же, как --site', async () => {
        fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src', 'README.md'), '# root\n');
        fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify({ ...CONFIG, webPort: '38321' }));
        expect(await serve(['site'])).toContain('serving your docsify site');
    }, 60_000);
});
