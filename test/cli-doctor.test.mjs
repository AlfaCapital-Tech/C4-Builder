import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

import { cachedJava, detectSystemJava, installKind, nodeCheck } from './dist.mjs';
import { agentEnv, REPO_ROOT, serveSite, TMP_ROOT } from './helpers.mjs';

// `c4builder doctor` (change cli-doctor). Сеть не трогаем: фейковый npm в PATH, JRE не скачивается.
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');
const VERSION = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' }).stdout.trim();
const CONFIG = fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/default.c4builder.json'), 'utf8');
const ENGINES = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).engines.node;
const ID = /^(env|skills|render|project|runtime)(\.[a-z][a-z0-9]*)+$/;
const POSIX = process.platform !== 'win32';
const HAS_JAVA = !!(detectSystemJava() ?? cachedJava());

fs.mkdirSync(TMP_ROOT, { recursive: true });
const root = fs.mkdtempSync(path.join(TMP_ROOT, 'cli-doctor-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

// Фейки — sh-скрипты (только POSIX). npm: каждый вызов — строка в FAKE_LOG, view печатает FAKE_VIEW и
// выходит с FAKE_EXIT. java: `-version` отвечает как Java 21, рендер падает.
const BIN = path.join(root, 'bin');
const FAKE_JAVA = path.join(root, 'fake-java');
fs.mkdirSync(BIN);
fs.mkdirSync(path.join(FAKE_JAVA, 'bin'), { recursive: true });
fs.writeFileSync(
    path.join(BIN, 'npm'),
    `#!/bin/sh
echo "$*" >> "$FAKE_LOG"
[ "$1" = view ] && printf '%s' "$FAKE_VIEW"
exit "\${FAKE_EXIT:-0}"
`,
    { mode: 0o755 }
);
fs.writeFileSync(
    path.join(FAKE_JAVA, 'bin', 'java'),
    `#!/bin/sh
[ "$1" = -version ] && echo 'openjdk version "21.0.1"' >&2 && exit 0
echo broken java >&2
exit 1
`,
    { mode: 0o755 }
);

// Песочница: свой HOME, `.git` в корне (поиск скиллов не выходит в репозиторий c4builder), без
// переменных агентов и гейтов проверки обновлений — фоновая проверка была бы видна по логу фейка.
const GATES = ['CI', 'NO_UPDATE_NOTIFIER', 'C4BUILDER_DOCKER', 'CODEX_HOME'];
const JRE_CACHE = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
const sandbox = ({ git = true } = {}) => {
    const dir = fs.mkdtempSync(path.join(root, 'case-'));
    const home = path.join(dir, 'home');
    const cwd = path.join(dir, 'repo');
    const log = path.join(dir, 'npm.log');
    fs.mkdirSync(home);
    fs.mkdirSync(git ? path.join(cwd, '.git') : cwd, { recursive: true });
    const env = (extra = {}) => ({
        ...Object.fromEntries(Object.entries(agentEnv()).filter(([k]) => !GATES.includes(k))),
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(dir, 'xdg'),
        XDG_CACHE_HOME: JRE_CACHE,
        PATH: `${BIN}${path.delimiter}${process.env.PATH}`,
        FAKE_LOG: log,
        ...extra
    });
    const cli = (args, extra, at = cwd) =>
        spawnSync(process.execPath, [CLI, ...args], { cwd: at, encoding: 'utf8', env: env(extra) });
    const run = (args, extra, at) => cli(['doctor', ...args], extra, at);
    const json = (args, extra, at) => {
        const res = run([...args, '--json'], extra, at);
        return { res, report: JSON.parse(res.stdout) };
    };
    const npmCalls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
    return { dir, home, cwd, env, cli, run, json, npmCalls };
};
const byId = (report, id) => report.checks.find((c) => c.id === id);
const lastLine = (out) => out.trimEnd().split('\n').at(-1);
const project = (cwd, config = CONFIG) => {
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'README.md'), '# root\n');
    fs.writeFileSync(path.join(cwd, '.c4builder'), config);
};
const skillFile = (base, name = 'c4builder') => path.join(base, 'skills', name, 'SKILL.md');
const SKILLS = fs.readdirSync(path.join(REPO_ROOT, 'skills'));
// Отметку версии всех скиллов каталога `<base>/skills` — на 0.1.0.
const ageSkills = (base) => {
    for (const name of SKILLS) {
        const file = skillFile(base, name);
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(VERSION, '0.1.0'));
    }
};

describe('команда doctor', () => {
    it('вне проекта без терминала — проверки выполняются, project skipped, каталог пуст', () => {
        const { cwd, run, json } = sandbox({ git: false });
        const res = run(['--offline']);
        expect(res.stderr).not.toContain('run c4builder new, or c4builder config');
        for (const title of ['Environment', 'Skills (all agents)', 'Render', 'Project', 'Runtime'])
            expect(res.stdout).toMatch(new RegExp(`^${title.replace(/[()]/g, '\\$&')}$`, 'm'));
        expect(lastLine(res.stdout)).toMatch(/^\d+ errors?, \d+ warnings?$/);
        const { report } = json(['project', '--offline']);
        expect(report.checks).toEqual([
            { id: 'project.config', status: 'skipped', message: 'no .c4builder here', fix: 'c4builder new' }
        ]);
        expect(fs.readdirSync(cwd)).toEqual([]);
    });

    it('опечатка в группе — код 2 и список групп, без проверок', () => {
        const res = sandbox().run(['skils']);
        expect(res.status).toBe(2);
        expect(res.stderr).toContain('unknown doctor group: skils');
        expect(res.stderr).toContain('env, skills, render, project, runtime');
        expect(res.stdout).toBe('');
    });

    it('--json --offline — один JSON-объект со стабильными id, fix у каждой ошибки', () => {
        const { res, report } = sandbox().json(['--offline']);
        expect(Object.keys(report)).toEqual(['version', 'channel', 'agent', 'checks', 'summary']);
        expect(report).toMatchObject({ version: VERSION, channel: VERSION.includes('-') ? 'rc' : 'latest' });
        for (const c of report.checks) {
            expect(c.id).toMatch(ID);
            expect(['ok', 'warn', 'error', 'skipped']).toContain(c.status);
            if (c.status === 'error') expect(c.fix, c.id).toBeTruthy();
        }
        const count = (s) => report.checks.filter((c) => c.status === s).length;
        expect(report.summary).toEqual({ errors: count('error'), warnings: count('warn') });
        expect(res.status).toBe(report.summary.errors ? 1 : 0);
        const skills = report.checks.filter((c) => c.id.startsWith('skills.'));
        expect(skills.at(-1)).toMatchObject({ id: 'skills.session', status: 'skipped' });
    });

    it('одна группа — только она, последняя строка группы — оговорка о сессии', () => {
        const res = sandbox().run(['skills']);
        const lines = res.stdout.trimEnd().split('\n');
        expect(lines[1]).toBe('Skills (all agents)');
        expect(res.stdout).not.toContain('Environment');
        expect(lines.at(-2)).toBe('  – what the agent session loaded is not visible to the CLI');
    });

    it('только предупреждения — код 0, с --strict — 1', () => {
        const { run } = sandbox();
        expect(run(['skills']).status).toBe(0);
        expect(run(['skills', '--strict']).status).toBe(1);
    });
});

describe('скиллы', () => {
    const installed = (agent = { CLAUDECODE: '1' }) => {
        const sb = sandbox();
        expect(sb.cli(['skills'], agent).status).toBe(0);
        return sb;
    };

    it('актуальные после `c4builder skills` — ok, код 0', () => {
        const { res, report } = installed().json(['skills'], { CLAUDECODE: '1' });
        expect(res.status, res.stdout).toBe(0);
        expect(report.agent).toBe('claude-code');
        expect(report.checks.map((c) => [c.id, c.status])).toEqual([
            ['skills.agents.project', 'ok'],
            ['skills.claude.project', 'ok'],
            ['skills.session', 'skipped']
        ]);
    });

    it('дописанная строка — warn «edited copy», с -v — изменённый файл', () => {
        const { cwd, json } = installed();
        fs.appendFileSync(skillFile(path.join(cwd, '.claude')), 'my note\n');
        const c = byId(json(['skills', '-v'], { CLAUDECODE: '1' }).report, 'skills.claude.project');
        expect(c).toMatchObject({ status: 'warn', fix: 'c4builder skills', askUser: true });
        expect(c.message).toContain('c4builder: edited copy');
        expect(c.details).toBe(skillFile(path.join(cwd, '.claude')));
    });

    it('скиллы старше CLI — ✗ и `fix: c4builder skills` с пометкой о согласии', () => {
        const { cwd, run } = installed();
        ageSkills(path.join(cwd, '.claude'));
        const res = run(['skills'], { CLAUDECODE: '1' });
        expect(res.status).toBe(1);
        expect(res.stdout).toContain(`✗ .claude/skills — from 0.1.0, CLI ${VERSION}`);
        expect(res.stdout).toContain('      fix: c4builder skills   (ask the user first)');
    });

    it('личная копия без версии — warn с её путём, удалить с согласия пользователя', () => {
        const { home, json } = installed();
        fs.mkdirSync(path.dirname(skillFile(path.join(home, '.claude'))), { recursive: true });
        fs.writeFileSync(
            skillFile(path.join(home, '.claude')),
            '---\nname: c4builder\ndescription: old\n---\n'
        );
        const { res, report } = json(['skills'], { CLAUDECODE: '1' });
        expect(byId(report, 'skills.claude.project').status).toBe('ok');
        const c = byId(report, 'skills.claude.personal');
        expect(c).toMatchObject({ status: 'warn', askUser: true, fix: 'rm -r ~/.claude/skills/c4builder' });
        expect(c.message).toMatch(
            /^~\/\.claude\/skills — c4builder: no version; .*overrides project skills$/
        );
        expect(res.stdout).not.toContain(home);
    });

    it('переводы строк CRLF (клон с autocrlf на Windows) — не правка копии', () => {
        const { cwd, json } = installed();
        const dir = path.join(cwd, '.claude', 'skills');
        for (const rel of fs.readdirSync(dir, { recursive: true })) {
            const file = path.join(dir, rel);
            if (fs.statSync(file).isFile())
                fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
        }
        expect(byId(json(['skills'], { CLAUDECODE: '1' }).report, 'skills.claude.project').status).toBe('ok');
    });

    it('актуальная личная копия при проектной у Claude Code — warn о перекрытии, у .agents — нет', () => {
        const { home, cwd, cli, json } = installed();
        expect(cli(['skills'], { CLAUDECODE: '1' }, home).status).toBe(0); // личные копии текущей версии
        fs.appendFileSync(skillFile(path.join(cwd, '.claude')), 'my note\n');
        const { report } = json(['skills'], { CLAUDECODE: '1' });
        expect(byId(report, 'skills.claude.project')).toMatchObject({
            status: 'warn',
            fix: 'c4builder skills'
        });
        expect(byId(report, 'skills.claude.personal')).toEqual({
            id: 'skills.claude.personal',
            status: 'warn',
            message: '~/.claude/skills — overrides project skills',
            fix: `rm -r ${SKILLS.map((n) => `~/.claude/skills/${n}`).join(' ')}`,
            askUser: true
        });
        expect(byId(report, 'skills.agents.personal').status).toBe('ok');
    });

    it('вне git под домашним каталогом — личная копия не считается проектной', () => {
        const sb = sandbox();
        // Пробел в домашнем каталоге: пути в `rm -r` — в кавычках, `~` — до кавычки.
        const home = path.join(sb.dir, 'my home');
        const notes = path.join(home, 'notes');
        fs.mkdirSync(notes, { recursive: true });
        const env = { CLAUDECODE: '1', HOME: home, USERPROFILE: home };
        expect(sb.cli(['skills'], env, home).status).toBe(0);
        ageSkills(path.join(home, '.claude'));
        const report = (args) => JSON.parse(sb.run(['skills', '--json', ...args], env, notes).stdout);
        const plain = report([]);
        expect(plain.checks.map((c) => c.id)).toEqual([
            'skills.agents.personal',
            'skills.claude.personal',
            'skills.session'
        ]);
        const c = byId(plain, 'skills.claude.personal');
        expect(c).toMatchObject({
            status: 'error',
            message: `~/.claude/skills — from 0.1.0, CLI ${VERSION}`
        });
        const rm = (base) => `rm -r ${SKILLS.map((n) => base(`.claude/skills/${n}`)).join(' ')}`;
        expect(c.fix).toBe(`c4builder skills && ${rm((p) => `~/"${p}"`)}`);
        expect(byId(report(['-v']), 'skills.claude.personal').fix).toBe(
            `c4builder skills && ${rm((p) => `"${path.join(home, p)}"`)}`
        );
    });

    it('Codex при скиллах только в .claude — скиллов для Codex нет', () => {
        const { cwd, json } = installed();
        fs.rmSync(path.join(cwd, '.agents'), { recursive: true });
        const { report } = json(['skills'], { CODEX_THREAD_ID: 't' });
        expect(report.checks.map((c) => c.id)).toEqual(['skills.installed', 'skills.session']);
        expect(byId(report, 'skills.installed')).toMatchObject({
            status: 'warn',
            message: 'no c4builder skills for codex here',
            fix: 'c4builder skills'
        });
    });

    it('скилл плагина Claude Code дублирует проектный — warn без fix', () => {
        const { home, json } = installed();
        const plugin = path.join(home, '.claude/plugins/cache/market/tools/1.0.0/skills/c4builder-review');
        fs.mkdirSync(plugin, { recursive: true });
        fs.writeFileSync(path.join(plugin, 'SKILL.md'), '---\nname: c4builder-review\n---\nother\n');
        const c = byId(json(['skills'], { CLAUDECODE: '1' }).report, 'skills.claude.plugins');
        expect(c).toEqual({
            id: 'skills.claude.plugins',
            status: 'warn',
            message:
                'plugin tools@market duplicates project skills: c4builder-review (differs from this package)'
        });
    });

    it('кэш плагинов не обходится — skipped, не error', () => {
        const { home, json } = installed();
        fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
        fs.writeFileSync(path.join(home, '.claude', 'plugins', 'cache'), 'not a folder');
        const { res, report } = json(['skills'], { CLAUDECODE: '1' });
        expect(byId(report, 'skills.claude.plugins').status).toBe('skipped');
        expect(res.status).toBe(0);
    });
});

describe('среда', () => {
    it('нижняя граница engines.node пакета разбирается', () => {
        expect(nodeCheck(process.versions.node, ENGINES).status).toBe('ok');
        expect(nodeCheck('22.9.0', '>=22.17')).toMatchObject({ status: 'error', fix: expect.any(String) });
        expect(nodeCheck('22.17.0', '^22.17').status).toBe('skipped');
    });

    it.skipIf(!POSIX)('способ установки и куда ставить D2 — по пути пакета, pnpm не «global npm»', () => {
        const kind = (root, cwd = '/work/app') => {
            const { how, fix } = installKind(cwd, root);
            return [how, fix('@terrastruct/d2')];
        };
        const pkg = 'node_modules/@alfacapital-tech/c4builder';
        expect(kind(`/work/app/${pkg}`)).toEqual(['project dependency', 'npm i @terrastruct/d2']);
        expect(kind(`/work/app/node_modules/.pnpm/@alfacapital-tech+c4builder@1.0.0/${pkg}`)).toEqual([
            'project dependency (pnpm)',
            'pnpm add @terrastruct/d2'
        ]);
        expect(kind(`/usr/lib/${pkg}`)).toEqual(['global npm', 'npm i -g @alfacapital-tech/c4builder']);
        expect(kind(`/home/u/.npm/_npx/abc/${pkg}`)[0]).toBe('npx');
        expect(kind(`/home/u/.config/yarn/global/${pkg}`)[0]).toBe('unknown install');
        expect(kind('/src/C4-Builder')).toEqual(['source checkout', 'npm install']);
    });

    it.skipIf(!POSIX)('--offline — npm не запускается ни проверкой, ни фоном', () => {
        const { dir, json, npmCalls } = sandbox();
        const c = byId(json(['env', '--offline']).report, 'env.update');
        expect(c.status).toBe('skipped');
        expect(npmCalls()).toBe('');
        expect(fs.existsSync(path.join(dir, 'xdg'))).toBe(false); // кэш фоновой проверки не создан
    });

    it.skipIf(!POSIX)('реестр отдаёт новее — warn с `c4builder update`, таймаут запроса 3 с', () => {
        const { json, npmCalls } = sandbox();
        const { report } = json(['env'], { FAKE_VIEW: '{"latest":"99.0.0"}' });
        expect(byId(report, 'env.update')).toMatchObject({ status: 'warn', fix: 'c4builder update' });
        expect(npmCalls().trim().split('\n')).toEqual([expect.stringContaining('--fetch-timeout=3000')]);
    });

    it.skipIf(!POSIX)('реестр не ответил — skipped, код возврата от него не зависит', () => {
        const { res, report } = sandbox().json(['env'], { FAKE_EXIT: '1' });
        expect(byId(report, 'env.update')).toMatchObject({
            status: 'skipped',
            message: 'registry not reachable'
        });
        expect(res.status).toBe(report.summary.errors ? 1 : 0);
    });

    it.skipIf(!POSIX)('CI и NO_UPDATE_NOTIFIER проверку не выключают', () => {
        const { report } = sandbox().json(['env'], {
            CI: 'true',
            NO_UPDATE_NOTIFIER: '1',
            FAKE_VIEW: '{"latest":"99.0.0"}'
        });
        expect(byId(report, 'env.update').status).toBe('warn');
    });

    it('без Java — env.java warn, рендер skipped с `c4builder jre install`, кэш JRE пуст', () => {
        const { dir, json } = sandbox();
        const cache = path.join(dir, 'cache');
        fs.mkdirSync(cache);
        const { report } = json(['env', 'render', '--full', '--offline'], {
            PATH: BIN,
            JAVA_HOME: '',
            XDG_CACHE_HOME: cache
        });
        const fix = 'c4builder jre install';
        expect(byId(report, 'env.java')).toMatchObject({ status: 'warn', fix });
        expect(byId(report, 'render.plantuml')).toMatchObject({ status: 'skipped', fix });
        expect(byId(report, 'render.full')).toMatchObject({ status: 'skipped', fix });
        expect(fs.readdirSync(cache)).toEqual([]);
    });
});

describe('рендер', () => {
    it.skipIf(!HAS_JAVA)('крошечная C4-диаграмма — ok со временем', () => {
        const c = byId(sandbox().json(['render', '--offline']).report, 'render.plantuml');
        expect(c.status, c.message).toBe('ok');
        expect(c.message).toMatch(/ in \d+\.\d s$/);
    });

    it.skipIf(!HAS_JAVA)('--full --json — один JSON-объект, временного каталога после выхода нет', () => {
        const { dir, json } = sandbox();
        const tmp = path.join(dir, 'tmp');
        fs.mkdirSync(tmp);
        const { res, report } = json(['render', '--full', '--offline'], { TMPDIR: tmp });
        const c = byId(report, 'render.full');
        expect(c.status, `${c.message}\n${res.stderr}`).toBe('ok');
        expect(c.details).toBeUndefined(); // лог сборки — только с -v
        expect(fs.readdirSync(tmp)).toEqual([]);
    });

    it.skipIf(!POSIX)('пробная сборка упала — error с хвостом лога, временного каталога нет', () => {
        const { dir, run, json } = sandbox();
        const tmp = path.join(dir, 'tmp');
        fs.mkdirSync(tmp);
        const env = { PATH: BIN, JAVA_HOME: FAKE_JAVA, TMPDIR: tmp };
        const { res, report } = json(['render', '--full', '--offline'], env);
        expect(res.status).toBe(1);
        const c = byId(report, 'render.full');
        expect(c).toMatchObject({ status: 'error', fix: expect.any(String) });
        expect(c.details).toContain('broken java');
        expect(fs.readdirSync(tmp)).toEqual([]);
        expect(run(['render', '--full', '--offline'], env).stdout).toContain('broken java');
    });
});

describe('проект и запуск', () => {
    it('валидный проект с .d2 — конфиг, полнота и пути ok, движок D2 загружается', () => {
        const { cwd, json } = sandbox();
        project(cwd);
        fs.writeFileSync(path.join(cwd, 'src', 'flow.d2'), 'a -> b\n');
        const { report } = json(['env', 'render', 'project', '--offline'], { PATH: BIN, JAVA_HOME: '' });
        for (const id of ['project.config', 'project.complete', 'project.paths', 'env.d2', 'render.d2'])
            expect(byId(report, id)?.status, id).toBe('ok');
    });

    it('плагин печатает в stdout при импорте — `--json` остаётся одним JSON, вывод плагина — в details', () => {
        const { cwd, json } = sandbox();
        project(cwd, JSON.stringify({ ...JSON.parse(CONFIG), plugins: ['./plug.mjs'] }));
        fs.writeFileSync(
            path.join(cwd, 'plug.mjs'),
            "console.log('plugin loaded');\nexport default { name: 'plug' };\n"
        );
        expect(byId(json(['project', '--offline']).report, 'project.paths')).toMatchObject({ status: 'ok' });
        expect(byId(json(['project', '--offline', '-v']).report, 'project.paths').details).toBe(
            'plugin loaded'
        );
    });

    it('битый, неполный конфиг и нет rootFolder — error, warn, error', () => {
        const { cwd, json } = sandbox();
        fs.writeFileSync(path.join(cwd, '.c4builder'), JSON.stringify({ projectName: 'x', webPort: 'abc' }));
        const { report } = json(['project']);
        expect(byId(report, 'project.config')).toMatchObject({ status: 'error', fix: 'c4builder config' });
        expect(byId(report, 'project.config').message).toContain('webPort');
        expect(byId(report, 'project.complete')).toMatchObject({ status: 'warn', fix: 'c4builder config' });
        expect(byId(report, 'project.paths')).toMatchObject({
            status: 'error',
            message: 'missing rootFolder src'
        });
    });

    it('порт занят чужим процессом — warn с `-p <port>`', async () => {
        const { cwd, env } = sandbox();
        const server = http.createServer((_, res) => res.end('hello')).listen(28371, '127.0.0.1');
        await new Promise((r) => server.once('listening', r));
        try {
            // Асинхронный спавн: spawnSync заблокировал бы event loop, и сервер теста не ответил бы.
            const { stdout } = await promisify(execFile)(
                process.execPath,
                [CLI, 'doctor', 'runtime', '-p', '28371', '--json'],
                { cwd, env: env() }
            ).catch((e) => e);
            const c = byId(JSON.parse(stdout), 'runtime.port');
            expect(c).toMatchObject({ status: 'warn', message: 'port 28371 is in use by another process' });
            expect(c.fix).toContain('-p <port>');
        } finally {
            server.close();
        }
    });

    it('запущен `site -w` — ok «site -w is running» с адресом', async () => {
        const { cwd, env, json } = sandbox();
        project(cwd);
        await serveSite(cwd, ['site', '-w', '-p', '28372'], {
            env: env(),
            onReady: async () => {
                const c = byId(json(['runtime', '-p', '28372']).report, 'runtime.port');
                expect(c).toMatchObject({
                    status: 'ok',
                    message: 'site -w is running at http://localhost:28372'
                });
            }
        });
    }, 60_000);

    it('вывод для issue — без значений переменных и абсолютного домашнего каталога', () => {
        const { home, run } = sandbox();
        const ca = path.join(home, 'certs', 'missing.pem');
        fs.mkdirSync(path.dirname(skillFile(path.join(home, '.claude'))), { recursive: true });
        fs.writeFileSync(skillFile(path.join(home, '.claude')), '---\nname: c4builder\n---\n');
        const env = { HTTPS_PROXY: 'http://proxy.local:8080', NODE_EXTRA_CA_CERTS: ca };
        for (const args of [['--offline'], ['--offline', '--json']]) {
            const out = run(args, env).stdout;
            expect(out).toContain('HTTPS_PROXY, NODE_EXTRA_CA_CERTS set');
            expect(out).toContain('~/.claude/skills');
            expect(out).not.toContain('proxy.local');
            expect(out).not.toContain(home);
            expect(out).not.toContain('missing.pem');
        }
        expect(run(['env', '--offline', '-v'], env).stdout).toContain(ca);
    });
});
