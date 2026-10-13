import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { REPO_ROOT, TMP_ROOT, updateCheckEnv } from './helpers.mjs';

// Подсказка после сборки печатает `c4builder site` — форма обязана работать наравне
// с `--site`, иначе allowExcessArguments молча глотает её и команда просто пересобирает.
const CONFIG = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/default.c4builder.json'), 'utf8')
);
const { version: CURRENT } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

fs.mkdirSync(TMP_ROOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'cli-site-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
fs.writeFileSync(path.join(dir, 'src', 'README.md'), '# root\n');
fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify({ ...CONFIG, webPort: '38321' }));

// onReady выполняется, пока сервер жив; после него процесс гасится.
const serve = (args, { env = process.env, onReady = async () => {} } = {}) =>
    new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(REPO_ROOT, 'dist', 'index.js'), ...args], {
            cwd: dir,
            encoding: 'utf8',
            env
        });
        let out = '';
        let ready = false;
        const done = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`сервер не поднялся за 30 с:\n${out}`));
        }, 30_000);
        child.stdout.on('data', (d) => {
            out += d;
            if (ready || !out.includes('serving your docsify site')) return;
            ready = true;
            clearTimeout(done);
            onReady()
                .then(() => resolve(out), reject)
                .finally(() => child.kill('SIGTERM'));
        });
        child.stderr.on('data', (d) => (out += d));
        child.on('exit', (code) => {
            clearTimeout(done);
            if (!ready)
                reject(new Error(`процесс завершился (exit=${code}) вместо запуска сервера:\n${out}`));
        });
    });

describe('c4builder site', () => {
    it('позиционная подкоманда поднимает сервер так же, как --site', async () => {
        expect(await serve(['site'])).toContain('serving your docsify site');
    }, 60_000);
});

// Свежий кэш проверки обновлений: фоновый npm не запускается, плашка берёт версию из кэша.
describe('плашка о новой версии в site -w', () => {
    const xdg = path.join(dir, 'xdg');
    fs.mkdirSync(path.join(xdg, 'c4builder'), { recursive: true });
    fs.writeFileSync(path.join(xdg, 'c4builder', 'dist-tags.json'), '{"latest":"99.0.0"}');

    const page = async (port, env) => {
        let html = '';
        await serve(['site', '-w', '-p', String(port)], {
            env: updateCheckEnv(xdg, env),
            onReady: async () => {
                html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
            }
        });
        return html;
    };

    it('в отдаче dev-сервера — плашка с обеими версиями, в файлах сборки её нет', async () => {
        const html = await page(38322);
        expect(html).toContain('id="c4builder-update"');
        expect(html).toContain(`c4builder 99.0.0 is available (current ${CURRENT})`);
        expect(html).toContain('c4builder update');
        expect(fs.readFileSync(path.join(dir, 'docs', 'index.html'), 'utf8')).not.toContain(
            'c4builder-update'
        );
    }, 60_000);

    it('с NO_UPDATE_NOTIFIER=1 плашки нет', async () => {
        const html = await page(38323, { NO_UPDATE_NOTIFIER: '1' });
        expect(html).toContain('</body>');
        expect(html).not.toContain('c4builder-update');
    }, 60_000);
});
