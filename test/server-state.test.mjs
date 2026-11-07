import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
    cmdSite,
    findServer,
    liveServer,
    readServerState,
    removeServerState,
    stateFile,
    writeServerState
} from './dist.mjs';
import { TMP_ROOT } from './helpers.mjs';

// Файл состояния dev-сервера и поиск сервера клиентом (change site-server-state, D1–D4, D6). Сервер — в
// процессе теста: его pid — process.pid, и эндпоинт состояния отвечает им же.
fs.mkdirSync(TMP_ROOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'server-state-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const distDir = path.join(dir, 'dist');
fs.mkdirSync(distDir);
fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body></body></html>');

// Конфиг со своим webPort: источник `config` отличим от порта сервера.
const project = (name) => {
    const cwd = path.join(dir, name);
    fs.mkdirSync(cwd);
    const configPath = path.join(cwd, '.c4builder');
    fs.writeFileSync(configPath, JSON.stringify({ webPort: '28409' }));
    return configPath;
};
const state = (port, pid) => ({
    port,
    url: `http://localhost:${port}`,
    pid,
    version: '0.0.0',
    watch: true,
    startedAt: new Date().toISOString()
});
const close = (server) => new Promise((r) => server.close(r));
// pid завершившегося процесса — гарантированно не наш и (почти наверняка) не живой.
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

describe('файл состояния сервера', () => {
    it('запись атомарна, удаление — только своего pid', () => {
        const configPath = project('write');
        writeServerState(configPath, state(28400, 4242));
        expect(fs.readdirSync(path.dirname(configPath)).sort()).toEqual([
            '.c4builder',
            '.c4builder.server.json'
        ]);
        expect(readServerState(configPath)).toMatchObject({ port: 28400, pid: 4242 });
        removeServerState(configPath); // pid в файле чужой — файл остаётся
        expect(fs.existsSync(stateFile(configPath))).toBe(true);
        removeServerState(configPath, 4242);
        expect(fs.existsSync(stateFile(configPath))).toBe(false);
    });

    it('сервер пишет файл после listen и удаляет при закрытии вместе со своим обработчиком exit', async () => {
        const configPath = project('server');
        const exitListeners = process.listenerCount('exit');
        const server = await cmdSite(
            { DIST_FOLDER: distDir, WEB_PORT: '28409' },
            { port: 28401, watch: true, configPath },
            new EventEmitter()
        );
        try {
            expect(readServerState(configPath)).toMatchObject({
                port: 28401,
                url: 'http://localhost:28401',
                pid: process.pid,
                watch: true
            });
            // действительный файл: источник `state`, порт из файла
            expect(await findServer(configPath)).toMatchObject({ kind: 'own', port: 28401, source: 'state' });
            // явный -p на тот же сервер — тоже свой: проект совпадает
            expect(await findServer(configPath, { port: 28401 })).toMatchObject({
                kind: 'own',
                source: 'flag'
            });
            // явный -p побеждает файл
            expect(await findServer(configPath, { port: 28402 })).toMatchObject({
                kind: 'free',
                port: 28402,
                source: 'flag'
            });
        } finally {
            await close(server);
        }
        expect(fs.existsSync(stateFile(configPath))).toBe(false);
        expect(process.listenerCount('exit')).toBe(exitListeners);
    });

    it('мёртвый, нулевой и чужой pid, битый файл — недействительны: порт из webPort, файл не удалён', async () => {
        const configPath = project('invalid');
        const server = await cmdSite(
            { DIST_FOLDER: distDir, WEB_PORT: '28409' },
            { port: 28403 },
            new EventEmitter()
        );
        try {
            const cases = {
                dead: JSON.stringify(state(28403, deadPid())),
                // kill(0, 0) «находит» группу процессов — pid 0 живым владельцем не считается
                zero: JSON.stringify(state(28403, 0)),
                // pid жив (родитель теста), но сервер на порту отвечает другим pid — сервер не этого файла
                foreign: JSON.stringify(state(28403, process.ppid)),
                broken: '{"port": 28403, "pid":',
                shape: JSON.stringify({ port: 'x', pid: process.pid })
            };
            for (const [name, text] of Object.entries(cases)) {
                fs.writeFileSync(stateFile(configPath), text);
                expect(await findServer(configPath), name).toMatchObject({
                    kind: 'free',
                    port: 28409,
                    source: 'config'
                });
                expect(fs.readFileSync(stateFile(configPath), 'utf8'), name).toBe(text);
            }
        } finally {
            await close(server);
        }
    });

    // D4: живой pid и молчащий порт — сервер занят, а не мёртв; отказ в соединении — pid переиспользован.
    it('живой pid: порт не ответил за таймаут — unresponsive, соединение отклонено — файл недействителен', async () => {
        const configPath = project('timeout');
        const silent = http.createServer(() => {}).listen(28404, '127.0.0.1');
        await new Promise((r) => silent.once('listening', r));
        try {
            writeServerState(configPath, state(28404, process.pid));
            expect(await liveServer(configPath)).toMatchObject({ kind: 'unresponsive' });
            expect(await findServer(configPath)).toMatchObject({
                kind: 'unresponsive',
                port: 28404,
                source: 'state'
            });
        } finally {
            silent.closeAllConnections();
            await close(silent);
        }
        expect(await liveServer(configPath)).toBeUndefined();
        expect(await findServer(configPath)).toMatchObject({ kind: 'free', port: 28409 });
    });

    // Соседний worktree на том же порту: c4builder отвечает, но его конфиг — другой.
    it('сервер другого проекта на порту — other-project, а не свой', async () => {
        const ours = project('ours');
        const theirs = project('theirs');
        const server = await cmdSite(
            { DIST_FOLDER: distDir, WEB_PORT: '28409' },
            { port: 28405, configPath: theirs },
            new EventEmitter()
        );
        try {
            const found = await findServer(ours, { port: 28405 });
            expect(found).toMatchObject({ kind: 'other-project', port: 28405 });
            expect(found.status.project).toBe(fs.realpathSync(theirs));
            expect(await findServer(theirs, { port: 28405 })).toMatchObject({ kind: 'own' });
        } finally {
            await close(server);
        }
    });

    it('без конфига и файла — порт по умолчанию', async () => {
        expect(await findServer(path.join(dir, 'nope', '.c4builder'), { port: undefined })).toMatchObject({
            port: 3000,
            source: 'config'
        });
    });
});
