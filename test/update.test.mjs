import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { compareVersions, newestVersion } from './dist.mjs';
import { REPO_ROOT, TMP_ROOT, updateCheckEnv } from './helpers.mjs';

const CLI = path.join(REPO_ROOT, 'dist', 'index.js');
const { name: PKG, version: CURRENT } = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
);
const NOTICE = `c4builder 99.0.0 is available (current ${CURRENT}). Run: c4builder update`;
const DAY_MS = 24 * 60 * 60 * 1000;

describe('выбор новейшей версии', () => {
    it.each([
        ['стабильный канал не смотрит rc', '0.5.1', { latest: '0.6.0', rc: '0.7.0-rc.1' }, '0.6.0'],
        ['пререлиз отстал от стабильной', '0.5.0-rc.1', { latest: '0.5.1', rc: '0.5.0-rc.1' }, '0.5.1'],
        ['текущая новее опубликованной', '0.6.0', { latest: '0.5.1' }, undefined],
        ['пререлиз видит новый rc', '0.6.0-rc.1', { latest: '0.5.1', rc: '0.6.0-rc.2' }, '0.6.0-rc.2'],
        ['релиз старше своих rc', '0.6.0-rc.3', { latest: '0.6.0', rc: '0.6.0-rc.3' }, '0.6.0'],
        ['версия актуальна', '0.5.1', { latest: '0.5.1' }, undefined]
    ])('%s', (_, current, tags, expected) =>
        expect(newestVersion(current, JSON.stringify(tags))).toBe(expected));

    it('формат npm 12: массив из одного объекта', () =>
        expect(newestVersion('0.5.1', '[\n  {\n    "rc": "0.5.0-rc.1",\n    "latest": "0.6.0"\n  }\n]')).toBe(
            '0.6.0'
        ));

    // Пустой кэш — неудачная попытка, недописанный — гонка с фоновым npm, error — ответ npm --json.
    it.each([
        '',
        '{"lat',
        'null',
        '{"error":{"code":"E404"}}',
        '{"latest":"<b>1.0.0</b>"}'
    ])('нет данных: %j', (text) => expect(newestVersion('0.5.1', text)).toBeUndefined());

    it('порядок semver', () => {
        expect(compareVersions('0.6.0-rc.2', '0.6.0-rc.1')).toBeGreaterThan(0);
        expect(compareVersions('0.6.0-rc.10', '0.6.0-rc.2')).toBeGreaterThan(0);
        expect(compareVersions('0.6.0', '0.6.0-rc.3')).toBeGreaterThan(0);
        expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
        expect(compareVersions('0.5.1', '0.5.1')).toBe(0);
    });
});

// Дальше — спавн собранного CLI с фейковым npm в PATH: настоящий npm не вызывается, кэш пишется
// во временный XDG_CONFIG_HOME. Фейк — sh-скрипт, поэтому только POSIX.
const POSIX = process.platform !== 'win32';
fs.mkdirSync(TMP_ROOT, { recursive: true });
const root = fs.mkdtempSync(path.join(TMP_ROOT, 'update-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

// Каждый вызов — строка в FAKE_LOG; view отвечает FAKE_VIEW после FAKE_SLEEP с и выходит с
// FAKE_EXIT, `root -g` печатает FAKE_ROOT, install только логируется.
const BIN = path.join(root, 'bin');
fs.mkdirSync(BIN);
fs.writeFileSync(
    path.join(BIN, 'npm'),
    `#!/bin/sh
echo "$*" >> "$FAKE_LOG"
case "$1" in
    view) sleep "\${FAKE_SLEEP:-0}"; printf '%s' "$FAKE_VIEW"; exit "\${FAKE_EXIT:-0}" ;;
    root) echo "$FAKE_ROOT" ;;
esac
`,
    { mode: 0o755 }
);

const sandbox = () => {
    const dir = fs.mkdtempSync(path.join(root, 'case-'));
    const cwd = path.join(dir, 'cwd');
    fs.mkdirSync(cwd);
    const xdg = path.join(dir, 'xdg');
    return {
        dir,
        cwd,
        xdg,
        log: path.join(dir, 'npm.log'),
        cache: path.join(xdg, 'c4builder', 'dist-tags.json')
    };
};
const writeCache = (sb, text, mtimeMs = Date.now()) => {
    fs.mkdirSync(path.dirname(sb.cache), { recursive: true });
    fs.writeFileSync(sb.cache, text);
    fs.utimesSync(sb.cache, mtimeMs / 1000, mtimeMs / 1000);
};
const npmLog = (sb) => (fs.existsSync(sb.log) ? fs.readFileSync(sb.log, 'utf8') : '');

const run = (sb, args, env = {}) =>
    spawnSync(process.execPath, [CLI, ...args], {
        cwd: sb.cwd,
        encoding: 'utf8',
        timeout: 60_000,
        env: updateCheckEnv(sb.xdg, {
            PATH: `${BIN}${path.delimiter}${process.env.PATH}`,
            FAKE_LOG: sb.log,
            ...env
        })
    });

describe.skipIf(!POSIX)('фоновая проверка', () => {
    it('зависший npm не задерживает выход CLI', async () => {
        const sb = sandbox();
        const started = Date.now();
        const res = run(sb, ['--docs'], { FAKE_SLEEP: '10' });
        expect(res.status, res.stderr).toBe(0);
        // Фейковый npm спит 10 с — порог ловит ожидание, а запас нужен раннеру CI под полным npm test.
        expect(Date.now() - started).toBeLessThan(8000);
        await vi.waitFor(() =>
            expect(npmLog(sb)).toContain(
                `view ${PKG} dist-tags --json --fetch-retries=0 --fetch-timeout=5000`
            )
        );
    });

    it.each(['CI', 'NO_UPDATE_NOTIFIER', 'C4BUILDER_DOCKER'])('с %s проверка не запускается', (name) => {
        const sb = sandbox();
        expect(run(sb, ['--docs'], { [name]: 'true' }).status).toBe(0);
        // Кэш создаётся синхронно до спавна npm — его отсутствие доказывает, что проверки не было.
        expect(fs.existsSync(sb.cache)).toBe(false);
        expect(npmLog(sb)).toBe('');
    });

    it('повторный запуск в течение суток не вызывает npm', () => {
        const sb = sandbox();
        const hourAgo = Date.now() - 60 * 60 * 1000;
        writeCache(sb, '{"latest":"0.0.1"}', hourAgo);
        expect(run(sb, ['--docs']).status).toBe(0);
        expect(fs.readFileSync(sb.cache, 'utf8')).toBe('{"latest":"0.0.1"}');
        expect(fs.statSync(sb.cache).mtimeMs).toBeLessThan(hourAgo + 1000);
        expect(npmLog(sb)).toBe('');
    });

    it('неудачная попытка тоже обновляет mtime кэша', async () => {
        const sb = sandbox();
        writeCache(sb, '', Date.now() - 2 * DAY_MS); // пустой кэш прошлой попытки без сети
        expect(run(sb, ['--docs'], { FAKE_EXIT: '1' }).status).toBe(0);
        expect(fs.statSync(sb.cache).mtimeMs).toBeGreaterThan(Date.now() - 60_000);
        await vi.waitFor(() => expect(npmLog(sb)).toContain('view'));
    });

    it('без npm в PATH CLI не падает', () => {
        const sb = sandbox();
        const res = run(sb, ['--docs'], { PATH: sb.dir });
        expect(res.status, res.stderr).toBe(0);
        expect(res.stderr).toBe('');
        expect(fs.existsSync(sb.cache)).toBe(true); // проверка запускалась
    });
});

describe.skipIf(!POSIX)('уведомление в терминале', () => {
    it('последняя строка stderr; stdout и код те же, что без уведомления', () => {
        const sb = sandbox();
        writeCache(sb, '{"latest":"99.0.0"}');
        fs.writeFileSync(path.join(sb.cwd, 'ok.puml'), '@startuml\nAlice -> Bob : hi\n@enduml\n');
        const on = run(sb, ['check', 'ok.puml']);
        const off = run(sb, ['check', 'ok.puml'], { NO_UPDATE_NOTIFIER: '1' });
        expect(on.status, on.stderr).toBe(0);
        expect(on.status).toBe(off.status);
        expect(on.stdout).toBe(off.stdout);
        expect(on.stderr.trimEnd().split('\n').at(-1)).toBe(NOTICE);
        expect(off.stderr).not.toContain('is available');
    });

    it.each([
        ['кэш с текущей версией', ['--docs'], `{"latest":"${CURRENT}"}`],
        ['--version', ['--version'], '{"latest":"99.0.0"}']
    ])('%s — без уведомления', (_, args, cache) => {
        const sb = sandbox();
        writeCache(sb, cache);
        const res = run(sb, args);
        expect(res.status, res.stderr).toBe(0);
        expect(res.stderr).not.toContain('is available');
    });
});

describe.skipIf(!POSIX)('c4builder update', () => {
    const update = (env) => {
        const sb = sandbox();
        const res = run(sb, ['update'], { FAKE_VIEW: '{"latest":"99.0.0"}', ...env });
        // Ни файлов в cwd, ни фоновой проверки (кэша) у самой команды обновления.
        expect(fs.readdirSync(sb.cwd)).toEqual([]);
        expect(fs.existsSync(sb.cache)).toBe(false);
        return { res, log: npmLog(sb) };
    };

    it('глобальная установка устарела → npm install -g точной версии, код npm', () => {
        const { res, log } = update({ FAKE_ROOT: path.dirname(REPO_ROOT) });
        expect(res.status, res.stderr).toBe(0);
        expect(log).toContain(`install -g ${PKG}@99.0.0`);
    });

    it('версия актуальна → is up to date, код 0', () => {
        const { res, log } = update({
            FAKE_VIEW: `{"latest":"${CURRENT}"}`,
            FAKE_ROOT: path.dirname(REPO_ROOT)
        });
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toContain(`c4builder ${CURRENT} is up to date`);
        expect(log).not.toContain('install');
    });

    it('не глобальная установка → подсказки npm i -D и npx, код 1', () => {
        const { res, log } = update({ FAKE_ROOT: root });
        expect(res.status).toBe(1);
        expect(res.stdout).toContain(`npm i -D ${PKG}@99.0.0`);
        expect(res.stdout).toContain(`npx ${PKG}@99.0.0`);
        expect(log).not.toContain('install');
    });

    it('Docker → docker pull, код 1, npm не вызывается', () => {
        const { res, log } = update({ C4BUILDER_DOCKER: '1' });
        expect(res.status).toBe(1);
        expect(res.stdout).toContain('docker pull ghcr.io/alfacapital-tech/c4builder:latest');
        expect(log).toBe('');
    });

    it('реестр недоступен → ошибка на английском, код 1', () => {
        const { res, log } = update({ FAKE_EXIT: '1' });
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('could not query the npm registry');
        expect(log).not.toContain('install');
    });
});
