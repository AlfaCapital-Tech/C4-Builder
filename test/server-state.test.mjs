import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
    cmdSite,
    readServerState,
    removeServerState,
    resolvePort,
    stateFile,
    writeServerState
} from './dist.mjs';
import { TMP_ROOT } from './helpers.mjs';

// Файл состояния dev-сервера и выбор порта клиентом (change site-server-state, D1–D4, D6). Сервер — в
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

    it('сервер пишет файл после listen и удаляет при закрытии; без configPath файла нет', async () => {
        const configPath = project('server');
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
            expect(await resolvePort(configPath)).toMatchObject({ port: 28401, source: 'state' });
            // явный -p побеждает файл
            expect(await resolvePort(configPath, 28402)).toEqual({ port: 28402, source: 'flag' });
        } finally {
            await new Promise((r) => server.close(r));
        }
        expect(fs.existsSync(stateFile(configPath))).toBe(false);
    });

    it('мёртвый pid, чужой pid на порту и битый файл — недействительны: порт из webPort, файл не удалён', async () => {
        const configPath = project('invalid');
        const server = await cmdSite(
            { DIST_FOLDER: distDir, WEB_PORT: '28409' },
            { port: 28403 },
            new EventEmitter()
        );
        try {
            const cases = {
                dead: JSON.stringify(state(28403, deadPid())),
                // pid жив (родитель теста), но сервер на порту отвечает другим pid — сервер не этого файла
                foreign: JSON.stringify(state(28403, process.ppid)),
                broken: '{"port": 28403, "pid":',
                shape: JSON.stringify({ port: 'x', pid: process.pid })
            };
            for (const [name, text] of Object.entries(cases)) {
                fs.writeFileSync(stateFile(configPath), text);
                expect(await resolvePort(configPath), name).toEqual({ port: 28409, source: 'config' });
                expect(fs.readFileSync(stateFile(configPath), 'utf8'), name).toBe(text);
            }
        } finally {
            await new Promise((r) => server.close(r));
        }
    });

    it('без конфига и файла — порт по умолчанию', async () => {
        expect(await resolvePort(path.join(dir, 'nope', '.c4builder'))).toEqual({
            port: 3000,
            source: 'config'
        });
    });
});
