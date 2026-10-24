import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { agentEnv, REPO_ROOT, serveSite, TMP_ROOT } from './helpers.mjs';

// `c4builder skills`, уведомление о скиллах под агентом и скиллы в `--new` (change skills-install).
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');
const CONFIG = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/default.c4builder.json'), 'utf8')
);
const VERSION = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' }).stdout.trim();
const SKILLS = fs.readdirSync(path.join(REPO_ROOT, 'skills'));
const RUN = 'Ask the user, then run: c4builder skills';
const NOT_INSTALLED = `c4builder agent skills are not installed here. ${RUN}`;
const PERSONAL = `~/.claude/skills/c4builder (no version) overrides project skills. Ask the user to remove it`;

fs.mkdirSync(TMP_ROOT, { recursive: true });
const root = fs.mkdtempSync(path.join(TMP_ROOT, 'cli-skills-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

// Свежий кэш проверки обновлений: уведомления о скиллах выключены там же, где проверка версии, поэтому
// её гейты (NO_UPDATE_NOTIFIER из vitest.config, CI) сняты, а фоновый npm не стартует.
const XDG = path.join(root, 'xdg');
fs.mkdirSync(path.join(XDG, 'c4builder'), { recursive: true });
fs.writeFileSync(path.join(XDG, 'c4builder', 'dist-tags.json'), JSON.stringify({ latest: VERSION }));
const GATES = ['CI', 'NO_UPDATE_NOTIFIER', 'C4BUILDER_DOCKER'];
// Кэш managed-JRE остаётся настоящим: `check` не должен качать JRE в подменённый HOME.
const JRE_CACHE = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');

// Песочница: свой HOME (личные скиллы) и `.git` в корне — поиск проектных скиллов не выходит в
// репозиторий c4builder, внутри которого лежит test/.tmp.
const sandbox = ({ git = true } = {}) => {
    const dir = fs.mkdtempSync(path.join(root, 'case-'));
    const home = path.join(dir, 'home');
    const cwd = path.join(dir, 'repo');
    fs.mkdirSync(home);
    fs.mkdirSync(git ? path.join(cwd, '.git') : cwd, { recursive: true });
    const env = (extra = {}) => ({
        ...Object.fromEntries(Object.entries(agentEnv()).filter(([k]) => !GATES.includes(k))),
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: XDG,
        XDG_CACHE_HOME: JRE_CACHE,
        ...extra
    });
    const run = (args, extra, at = cwd) =>
        spawnSync(process.execPath, [CLI, ...args], { cwd: at, encoding: 'utf8', env: env(extra) });
    return { home, cwd, env, run };
};

// Минимальный проект без диаграмм: сборка за доли секунды и без java.
const project = (dir) => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'README.md'), '# root\n');
    fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify(CONFIG));
    return dir;
};

const skillFile = (base, name = 'c4builder') => path.join(base, 'skills', name, 'SKILL.md');
const writeSkill = (base, stamp) => {
    fs.mkdirSync(path.dirname(skillFile(base)), { recursive: true });
    const meta = stamp ? `metadata:\n  generatedBy: "${stamp}"\n` : '';
    fs.writeFileSync(skillFile(base), `---\nname: c4builder\ndescription: old copy\n${meta}---\n\n# old\n`);
};
const stampOf = (file) => fs.readFileSync(file, 'utf8').match(/^ {2}generatedBy: "(.*)"$/m)?.[1];
const packaged = (name) => fs.readFileSync(path.join(REPO_ROOT, 'skills', name, 'SKILL.md'), 'utf8');
const unstamped = (file) => fs.readFileSync(file, 'utf8').replace(/\nmetadata:\n {2}generatedBy: ".*"/, '');
const notices = (stderr) => stderr.split('\n').filter((l) => l.includes('c4builder skills'));

describe('c4builder skills', () => {
    it('из терминала в пустом каталоге — только .agents со всеми скиллами и отметкой версии', () => {
        const { cwd, run } = sandbox({ git: false });
        const res = run(['skills']);
        expect(res.status, res.stderr).toBe(0);
        expect(fs.readdirSync(cwd)).toEqual(['.agents']); // ни .claude, ни .c4builder, ни сборки
        for (const name of SKILLS) {
            const file = skillFile(path.join(cwd, '.agents'), name);
            expect(stampOf(file), name).toBe(VERSION);
            expect(unstamped(file), name).toBe(packaged(name));
            expect(res.stdout).toContain(`installed ${path.join('.agents', 'skills', name)}`);
        }
    });

    it('под Claude Code — и .agents, и .claude', () => {
        const { cwd, run } = sandbox({ git: false });
        expect(run(['skills'], { CLAUDECODE: '1' }).status).toBe(0);
        for (const dir of ['.agents', '.claude'])
            for (const name of SKILLS) expect(stampOf(skillFile(path.join(cwd, dir), name))).toBe(VERSION);
    });

    it('при существующем .claude/ ставит туда и без CLAUDECODE', () => {
        const { cwd, run } = sandbox({ git: false });
        fs.mkdirSync(path.join(cwd, '.claude'));
        expect(run(['skills']).status).toBe(0);
        expect(stampOf(skillFile(path.join(cwd, '.claude')))).toBe(VERSION);
    });

    it('повтор заменяет скилл пакета целиком и не трогает чужой', () => {
        const { cwd, run } = sandbox();
        const agents = path.join(cwd, '.agents');
        writeSkill(agents, '0.1.0');
        const stale = path.join(agents, 'skills', 'c4builder', 'stale.md');
        fs.writeFileSync(stale, 'gone\n');
        const other = path.join(agents, 'skills', 'other', 'SKILL.md');
        fs.mkdirSync(path.dirname(other), { recursive: true });
        fs.writeFileSync(other, 'mine\n');
        expect(run(['skills']).status).toBe(0);
        expect(run(['skills']).status).toBe(0);
        expect(fs.existsSync(stale)).toBe(false);
        expect(unstamped(skillFile(agents))).toBe(packaged('c4builder'));
        expect(stampOf(skillFile(agents))).toBe(VERSION);
        expect(fs.readFileSync(other, 'utf8')).toBe('mine\n');
    });

    it('личная копия без версии — предупреждение в stderr, копия не изменена', () => {
        const { home, cwd, run } = sandbox();
        writeSkill(path.join(home, '.claude'));
        const before = fs.readFileSync(skillFile(path.join(home, '.claude')), 'utf8');
        const res = run(['skills'], { CLAUDECODE: '1' });
        expect(res.status).toBe(0);
        expect(res.stderr).toContain(PERSONAL);
        expect(fs.readFileSync(skillFile(path.join(home, '.claude')), 'utf8')).toBe(before);
        expect(stampOf(skillFile(path.join(cwd, '.claude')))).toBe(VERSION);
    });
});

describe('уведомление о скиллах под агентом', () => {
    it('скиллов нет — одна строка в stderr, stdout и код выхода как без агента', () => {
        const { cwd, run } = sandbox();
        project(cwd);
        const agent = run([], { CLAUDECODE: '1' });
        const human = run([]);
        expect(notices(agent.stderr)).toEqual([NOT_INSTALLED]);
        expect(agent.status).toBe(human.status);
        const timeless = (s) => s.replace(/built in [\d.]+ seconds/, '');
        expect(timeless(agent.stdout)).toBe(timeless(human.stdout));
        expect(notices(human.stderr)).toEqual([]);
    });

    it('после `c4builder skills` строки нет', () => {
        const { cwd, run } = sandbox();
        project(cwd);
        expect(run(['skills'], { CLAUDECODE: '1' }).status).toBe(0);
        const res = run([], { CLAUDECODE: '1' });
        expect(res.status, res.stderr).toBe(0);
        expect(notices(res.stderr)).toEqual([]);
    });

    it('отметка старше CLI — строка с обеими версиями при старте `site -w`', async () => {
        const { cwd, env } = sandbox();
        project(cwd);
        writeSkill(path.join(cwd, '.claude'), '0.1.0');
        const out = await serveSite(cwd, ['site', '-w', '-p', '38360'], { env: env({ CLAUDECODE: '1' }) });
        const line = `c4builder agent skills here are from 0.1.0 (current ${VERSION}). ${RUN}`;
        expect(out).toContain(line);
        expect(out.indexOf(line)).toBeLessThan(out.indexOf('serving your docsify site'));
    }, 60_000);

    it('копия новее CLI — строки нет', () => {
        const { cwd, run } = sandbox();
        project(cwd);
        writeSkill(path.join(cwd, '.claude'), '99.0.0');
        expect(notices(run([], { CLAUDECODE: '1' }).stderr)).toEqual([]);
    });

    it('личная копия без версии перекрывает актуальные проектные — строка с её путём', () => {
        const { home, cwd, run } = sandbox();
        project(cwd);
        expect(run(['skills'], { CLAUDECODE: '1' }).status).toBe(0);
        writeSkill(path.join(home, '.claude'));
        expect(notices(run([], { CLAUDECODE: '1' }).stderr)).toEqual([
            `${PERSONAL}, then run: c4builder skills`
        ]);
    });

    it('Codex при скиллах только в .claude — скиллы не установлены', () => {
        const { cwd, run } = sandbox();
        project(cwd);
        writeSkill(path.join(cwd, '.claude'), VERSION);
        expect(notices(run([], { CODEX_THREAD_ID: 't' }).stderr)).toEqual([NOT_INSTALLED]);
    });

    it('скиллы в корне git-репозитория, сборка в подкаталоге — строки нет', () => {
        const { cwd, run } = sandbox();
        expect(run(['skills'], { CLAUDECODE: '1' }).status).toBe(0);
        const docs = project(path.join(cwd, 'docs'));
        const res = run([], { CLAUDECODE: '1' }, docs);
        expect(res.status, res.stderr).toBe(0);
        expect(notices(res.stderr)).toEqual([]);
    });

    it.each([
        ['агент с CI=true', { CLAUDECODE: '1', CI: 'true' }],
        ['агент с NO_UPDATE_NOTIFIER=1', { CLAUDECODE: '1', NO_UPDATE_NOTIFIER: '1' }],
        ['C4BUILDER_AGENT=0', { CLAUDECODE: '1', C4BUILDER_AGENT: '0' }]
    ])('%s — строки нет', (_, extra) => {
        const { cwd, run } = sandbox();
        project(cwd);
        const res = run([], extra);
        expect(res.status, res.stderr).toBe(0);
        expect(notices(res.stderr)).toEqual([]);
    });

    it('`check` под агентом — строки нет', () => {
        const { cwd, run } = sandbox();
        fs.writeFileSync(path.join(cwd, 'ok.puml'), '@startuml\nA -> B\n@enduml\n');
        const res = run(['check', 'ok.puml'], { CLAUDECODE: '1' });
        expect(res.status, res.stderr).toBe(0);
        expect(notices(res.stderr)).toEqual([]);
    });
});

describe('новый проект получает скиллы', () => {
    it('`--new --name demo -y` под Claude Code — скиллы в обоих каталогах, сборка их не публикует', () => {
        const { cwd, run } = sandbox();
        const res = run(['--new', '--name', 'demo', '-y'], { CLAUDECODE: '1' });
        expect(res.status, res.stderr).toBe(0);
        const demo = path.join(cwd, 'demo');
        for (const dir of ['.agents', '.claude'])
            expect(stampOf(skillFile(path.join(demo, dir)))).toBe(VERSION);
        // Шаблонные диаграммы сборке здесь не нужны (их рендер проверяет skills.test): важно лишь, что
        // каталоги скиллов рядом с rootFolder не попадают в выходы.
        fs.rmSync(path.join(demo, 'src'), { recursive: true });
        project(demo);
        const build = run([], { CLAUDECODE: '1' }, demo);
        expect(build.status, build.stderr).toBe(0);
        expect(notices(build.stderr)).toEqual([]);
        const out = fs.readdirSync(path.join(demo, 'docs'), { recursive: true });
        expect(out.filter((f) => /(^|[\\/])(\.agents|\.claude|SKILL\.md)$/.test(f))).toEqual([]);
    });
});
