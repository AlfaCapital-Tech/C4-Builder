import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import chalk from 'chalk';

import { detectAgent } from '../agent.ts';
import { compareVersions, newestVersion, npmCommand, viewArgs, WIN } from '../update.ts';
import { packageSkills, SKILLS_DIR, skillRoots, stampIn, unstamp } from './skills.ts';
import { WIZARD_KEYS } from '../wizard/collect.ts';
import { defaultConfig } from '../../config/defaults.ts';
import { type BuildOptions, type C4ConfigFile, parseConfig } from '../../config/options.ts';
import { loadPlugins } from '../../core/plugins/load.ts';
import { renderDiagram } from '../../core/render/diagrams.ts';
import { renderD2, teardownD2 } from '../../core/render/d2renderer.ts';
import { DEFAULT_FONT_NAME } from '../../core/render/fonts.ts';
import { detectSystemJava, installedJavaAt, jreCacheDir } from '../../core/render/jre.ts';
import { renderMermaid, teardownMermaid } from '../../core/render/mermaidrenderer.ts';
import { PACKAGE_ROOT, packageJson as pkg, VENDOR_DIR } from '../../util/paths.ts';
import { VENDORED_JAR } from '../../util/utils.ts';
import { findServer, stateFile } from '../server-state.ts';

// `c4builder doctor [group...]` (change cli-doctor): только читает — ничего не ставит и не скачивает,
// пишет лишь временный каталог `--full`. Id проверок стабильны: на них опираются агенты и `--json`.

type Status = 'ok' | 'warn' | 'error' | 'skipped';
interface Check {
    id: string;
    status: Status;
    message: string;
    fix?: string;
    askUser?: boolean;
    details?: string;
}
type Extra = Pick<Check, 'fix' | 'askUser' | 'details'>;
const check = (id: string, status: Status, message: string, extra: Extra = {}): Check => ({
    id,
    status,
    message,
    ...extra
});

type Project =
    | { file: string; error: string; config?: undefined }
    | {
          file: string;
          error?: undefined;
          raw: Record<string, unknown>;
          config: C4ConfigFile;
          broken: Map<string, string>;
      };
interface Install {
    how: string;
    // Как поставить необязательные пакеты c4builder (движки D2 и Mermaid).
    fix: (pkgs: string) => string;
}
interface Ctx {
    cwd: string;
    configPath: string;
    full: boolean;
    offline: boolean;
    port?: number;
    agent?: string;
    project?: Project;
    java?: { path: string; label: string };
    install: Install;
    files: string[];
}

const DOCS = 'https://alfacapital-tech.github.io/C4-Builder/en/#';
const CONFIG_DOCS = `${DOCS}/05%20CLI%20and%20configuration/05%20CLI%20and%20configuration`;
const PLUGINS_DOCS = `${DOCS}/06%20Plugins/06%20Plugins`;
const ISSUES = 'https://github.com/AlfaCapital-Tech/C4-Builder/issues';
const CLI = path.join(PACKAGE_ROOT, 'dist', 'index.js');
const run = promisify(execFile);
const seconds = (since: number): string => `${((Date.now() - since) / 1000).toFixed(1)} s`;
const firstLine = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0];
const tail = (log: string): string => log.trim().split('\n').slice(-20).join('\n');

// --- env ---

// Нижняя граница `engines.node` вида `>=X[.Y[.Z]]`: semver-парсер ради одной формы не тащим (D5).
export const nodeCheck = (version: string, range = ''): Check => {
    const bound = range.match(/^>=\s*(\d+(?:\.\d+)*)$/)?.[1];
    if (!bound)
        return check('env.node', 'skipped', `Node.js ${version}, engines.node "${range}" not checked`);
    return compareVersions(version, bound) >= 0
        ? check('env.node', 'ok', `Node.js ${version}`)
        : check('env.node', 'error', `Node.js ${version} is older than ${range}`, {
              fix: 'https://nodejs.org/en/download'
          });
};

// Свой `npm view` вместо фоновой проверки: таймаут 3 с, и `disabled()` (CI, NO_UPDATE_NOTIFIER) его не
// выключает — doctor запускают явно (D6). Асинхронно, чтобы остальные проверки шли параллельно.
const updateCheck = async (offline: boolean): Promise<Check> => {
    if (offline) return check('env.update', 'skipped', 'update check skipped (--offline)');
    const [cmd, argv] = npmCommand(viewArgs(3000));
    try {
        const { stdout } = await run(cmd, argv, { shell: WIN, windowsHide: true, timeout: 3000 });
        const next = newestVersion(pkg.version, stdout);
        return next
            ? check('env.update', 'warn', `c4builder ${next} is available`, { fix: 'c4builder update' })
            : check('env.update', 'ok', 'no newer version');
    } catch {
        return check('env.update', 'skipped', 'registry not reachable');
    }
};

// `import()` необязательных пакетов резолвится от каталога установки c4builder, а не от cwd: ставить их
// надо туда же. Первое `node_modules` в пути — проект и у pnpm (`node_modules/.pnpm/…/node_modules/…`),
// и у вложенной зависимости.
export const installKind = (cwd: string, root = PACKAGE_ROOT): Install => {
    const { sep } = path;
    const nm = root.indexOf(`${sep}node_modules${sep}`);
    const owner = root.slice(0, nm);
    const pnpm = root.includes(`${sep}.pnpm${sep}`);
    const add = pnpm ? 'pnpm add' : 'npm i';
    // Как в подсказке рендерера Mermaid: переустановить c4builder вместе с необязательными пакетами.
    const reinstall = (how: string): Install => ({ how, fix: () => `${add} -g ${pkg.name}` });
    if (process.env.C4BUILDER_DOCKER) return { how: 'Docker image', fix: () => ISSUES };
    if (nm < 0) return { how: 'source checkout', fix: () => 'npm install' };
    if (owner.includes(`${sep}_npx${sep}`)) return reinstall('npx');
    if (cwd === owner || cwd.startsWith(owner + sep))
        return { how: pnpm ? 'project dependency (pnpm)' : 'project dependency', fix: (p) => `${add} ${p}` };
    // Глобальный npm — `{prefix}/lib/node_modules`, на Windows — `{prefix}/node_modules` в любом каталоге.
    if (pnpm || WIN || path.basename(owner) === 'lib') return reinstall(pnpm ? 'global pnpm' : 'global npm');
    return reinstall('unknown install');
};

const installCheck = ({ how }: Install): Check => {
    const bin = WIN ? 'c4builder.cmd' : 'c4builder';
    const found = new Set(
        (process.env.PATH ?? '')
            .split(path.delimiter)
            .map((dir) => path.join(dir, bin))
            .filter((f) => fs.existsSync(f))
            .map((f) => fs.realpathSync(f))
    );
    return found.size > 1
        ? check(
              'env.install',
              'warn',
              `${how}; ${found.size} c4builder executables on PATH, the first one runs`,
              {
                  details: [...found].join('\n')
              }
          )
        : check('env.install', 'ok', how, { details: PACKAGE_ROOT });
};

const d2Check = async (ctx: Ctx): Promise<Check> => {
    if (!ctx.files.some((f) => f.endsWith('.d2')))
        return check('env.d2', 'skipped', 'no .d2 files in the project');
    try {
        await import('@terrastruct/d2');
        return check('env.d2', 'ok', 'D2 engine installed');
    } catch {
        return check('env.d2', 'error', 'D2 engine (@terrastruct/d2) is not installed', {
            fix: ctx.install.fix('@terrastruct/d2')
        });
    }
};

const proxyCheck = (): Check => {
    const set = ['HTTPS_PROXY', 'HTTP_PROXY', 'NODE_EXTRA_CA_CERTS'].filter(
        (k) => process.env[k] || process.env[k.toLowerCase()]
    );
    const ca = process.env.NODE_EXTRA_CA_CERTS;
    // Значения переменных не печатаем никогда: в адресе прокси бывают логин и пароль (D9).
    const fact = set.length ? `${set.join(', ')} set` : 'no proxy variables set';
    if (ca && !fs.existsSync(ca))
        return check('env.proxy', 'warn', `${fact}; NODE_EXTRA_CA_CERTS points to a missing file`, {
            fix: 'point NODE_EXTRA_CA_CERTS to an existing CA bundle',
            details: ca
        });
    return check('env.proxy', 'ok', fact);
};

const env = async (ctx: Ctx): Promise<Check[]> => {
    const update = updateCheck(ctx.offline);
    const d2 = d2Check(ctx);
    return [
        nodeCheck(process.versions.node, pkg.engines?.node),
        check('env.cli', 'ok', `c4builder ${pkg.version} (${channel})`),
        await update,
        installCheck(ctx.install),
        ctx.java
            ? check('env.java', 'ok', ctx.java.label, { details: ctx.java.path })
            : check('env.java', 'warn', 'no Java 17+ and no managed JRE', { fix: 'c4builder jre install' }),
        await d2,
        ctx.project?.config?.useSystemFonts
            ? check(
                  'env.fonts',
                  'warn',
                  'useSystemFonts: true in .c4builder, rendering is not deterministic',
                  {
                      fix: 'remove useSystemFonts from .c4builder',
                      askUser: true
                  }
              )
            : check('env.fonts', 'ok', `bundled font ${DEFAULT_FONT_NAME}`),
        proxyCheck()
    ];
};

// --- skills ---

// Каталоги скиллов (D4) и агенты, которые их читают. `.agents` проверяется под любым агентом: туда
// ставит `c4builder skills`.
const FAMILIES = [
    {
        key: 'agents',
        dir: '.agents',
        personal: () => path.join(os.homedir(), '.agents', 'skills'),
        readBy: (a: string) => a !== 'claude-code'
    },
    {
        key: 'claude',
        dir: '.claude',
        personal: () => path.join(os.homedir(), '.claude', 'skills'),
        readBy: (a: string) => a === 'claude-code'
    },
    {
        key: 'codex',
        dir: '.codex',
        personal: () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills'),
        readBy: (a: string) => a === 'codex'
    }
];

// Хэши файлов скилла (в скиллах только markdown); из SKILL.md вырезана отметка версии, которую вписывает
// `c4builder skills`. CRLF → LF: клон с `core.autocrlf=true` на Windows — не правка копии.
const digest = (dir: string): Map<string, string> =>
    new Map(
        fs
            .readdirSync(dir, { recursive: true, withFileTypes: true })
            .filter((e) => e.isFile())
            .map((e) => {
                const rel = path.relative(dir, path.join(e.parentPath, e.name));
                const text = fs.readFileSync(path.join(dir, rel), 'utf8').replace(/\r\n/g, '\n');
                const hash = crypto.createHash('sha256').update(rel === 'SKILL.md' ? unstamp(text) : text);
                return [rel, hash.digest('hex')];
            })
    );
// Файлы копии, не совпавшие с пакетом (лишние и недостающие тоже). want — отпечаток скилла пакета, если
// он уже посчитан: проверка плагинов сверяет с ним много каталогов.
const changedFiles = (name: string, copy: string, want = digest(path.join(SKILLS_DIR, name))): string[] => {
    const have = digest(copy);
    return [...new Set([...want.keys(), ...have.keys()])].filter((f) => want.get(f) !== have.get(f));
};

// В кавычках, если нужно: с `-v` в путях домашний каталог, а в нём бывают пробелы.
const quote = (p: string): string => (/^[\w@%+=:,./-]+$/.test(p) ? p : `"${p}"`);

// personal — у личной копии: есть ли рядом проектная и перекрывает ли её личная. Перекрывает только у
// Claude Code (личная побеждает при одинаковом имени), у Codex порядок не описан (D4).
const copyCheck = (id: string, root: string, personal?: { project: boolean; shadows: boolean }): Check => {
    const names = packageSkills();
    const present: string[] = [];
    const problems = new Map<string, string[]>();
    const changed: string[] = [];
    let stale = false;
    let onlyNewer = true;
    for (const name of names) {
        const stamp = stampIn(root, name);
        if (stamp !== undefined) present.push(name);
        const order = stamp ? compareVersions(stamp, pkg.version) : 0;
        const files = stamp && !order ? changedFiles(name, path.join(root, name)) : [];
        const problem =
            stamp === undefined
                ? 'missing'
                : !stamp
                  ? 'no version'
                  : order < 0
                    ? `from ${stamp}, CLI ${pkg.version}`
                    : order > 0
                      ? `from ${stamp}, newer than CLI ${pkg.version}`
                      : files.length
                        ? 'edited copy'
                        : undefined;
        if (!problem) continue;
        stale ||= order < 0;
        onlyNewer &&= order > 0;
        changed.push(...files.map((f) => path.join(root, name, f)));
        problems.set(problem, [...(problems.get(problem) ?? []), name]);
    }
    const text = [...problems].map(([p, who]) =>
        who.length === names.length ? p : `${who.join(', ')}: ${p}`
    );
    if (personal?.shadows) text.push('overrides project skills');
    if (!text.length) return check(id, 'ok', `${root} — ${pkg.version}`);
    // Без проектной копии сначала ставится она: иначе после удаления личной у агента скиллов нет вовсе.
    const rm = `rm -r ${present.map((n) => quote(path.join(root, n))).join(' ')}`;
    const fix: Extra =
        problems.size && onlyNewer
            ? { fix: 'c4builder update' }
            : personal
              ? { fix: personal.project ? rm : `c4builder skills && ${rm}`, askUser: true }
              : { fix: 'c4builder skills', askUser: true };
    return check(id, stale ? 'error' : 'warn', `${root} — ${text.join('; ')}`, {
        ...fix,
        details: changed.join('\n') || undefined
    });
};

// Плагины Claude Code — по реестру установленных `installed_plugins.json`, а не обходом кэша: кэш хранит и
// удалённые плагины (каталог версии помечен `.orphaned_at`), и старые версии, и установки в другие
// проекты — от них были ложные дубли (#74). Формат реестра и раскладка кэша не контракт, поэтому только
// warn без fix (удалять плагин целиком нельзя: в нём другие скиллы) или skipped.
const pluginCheck = (cwd: string): Check | undefined => {
    const base = path.join(os.homedir(), '.claude', 'plugins');
    const registry = path.join(base, 'installed_plugins.json');
    // Нет реестра — плагины не ставились; проверки нет, как раньше при отсутствии кэша.
    if (!fs.existsSync(registry)) return undefined;
    let plugins: [string, unknown[]][];
    try {
        const parsed = JSON.parse(fs.readFileSync(registry, 'utf8'))?.plugins;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error('no "plugins" object');
        // version 2 — массив записей (по одной на проект), version 1 — одна запись объектом.
        plugins = Object.entries(parsed as Record<string, unknown>).map(([key, v]) => {
            if (Array.isArray(v)) return [key, v];
            if (v && typeof v === 'object') return [key, [v]];
            throw new Error(`plugins["${key}"] is neither an array nor an object`);
        });
    } catch (e) {
        return check('skills.claude.plugins', 'skipped', 'Claude Code plugin registry is not recognized', {
            details: firstLine(e)
        });
    }
    // realpath: на macOS `/tmp` и `/var` — симлинки, а process.cwd() отдаёт уже разрешённый путь; native —
    // на регистронезависимой ФС приводит регистр к настоящему, JS-версия оставила бы как в projectPath.
    const real = (p: string): string => {
        try {
            return fs.realpathSync.native(p);
        } catch {
            return path.resolve(p);
        }
    };
    // Каталоги, установка в которые видна отсюда: cwd и предки до git-корня включительно — projectPath
    // обычно git-корень, а doctor запускают и из подкаталога. Выше домашнего не поднимаемся, сам домашний —
    // не проект (кроме запуска прямо в нём): иначе установка с projectPath=~ шла бы в счёт во всех
    // проектах под ним — тот же ложный дубль. Граница та же, что у skillRoots.
    const home = real(os.homedir());
    const projects = new Set<string>();
    for (let d = real(cwd); ; d = path.dirname(d)) {
        if (d === home && projects.size) break;
        projects.add(d);
        if (d === home || fs.existsSync(path.join(d, '.git')) || path.dirname(d) === d) break;
    }
    // Неизвестная область без projectPath учитывается — лишний информационный warn лучше пропущенного дубля.
    const inScope = (e: Record<string, unknown>): boolean => {
        if (e.scope === 'user') return true;
        if (typeof e.projectPath !== 'string') return e.scope !== 'project' && e.scope !== 'local';
        return projects.has(real(e.projectPath));
    };
    const subdirs = (d: string): string[] =>
        fs
            .readdirSync(d, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => path.join(d, e.name));
    // Отпечатки скиллов пакета — один раз: сверяются с каждым каталогом каждого плагина.
    const own = new Map(packageSkills().map((name) => [name, digest(path.join(SKILLS_DIR, name))]));
    const found: string[] = [];
    const failed: string[] = [];
    for (const [key, entries] of plugins) {
        // Ошибка в одном плагине не должна прятать дубли, найденные в других.
        try {
            // Записей у плагина несколько (разные проекты) — каталоги подходящих объединяем.
            const dirs = new Set<string>();
            for (const e of entries) {
                // Битая запись — не повод терять остальные.
                if (!e || typeof e !== 'object' || !inScope(e as Record<string, unknown>)) continue;
                const { installPath, version } = e as Record<string, unknown>;
                if (typeof installPath === 'string') {
                    dirs.add(path.resolve(installPath));
                    continue;
                }
                // Без installPath — кэш `<marketplace>/<plugin>/<version>`: версия записи, если она там есть,
                // иначе все версии (помеченные `.orphaned_at` отсеются ниже).
                const at = key.lastIndexOf('@');
                if (at <= 0) continue;
                const versions = path.join(base, 'cache', key.slice(at + 1), key.slice(0, at));
                const exact = typeof version === 'string' && path.join(versions, version);
                if (exact && fs.existsSync(exact)) dirs.add(exact);
                else if (fs.existsSync(versions)) for (const v of subdirs(versions)) dirs.add(v);
            }
            // Один скилл из нескольких каталогов — одна строка; отличается хотя бы в одной копии — differs.
            const differs = new Map<string, boolean>();
            for (const dir of dirs) {
                // Запись реестра могла устареть: каталог удалённой версии не в счёт и при явном installPath.
                if (fs.existsSync(path.join(dir, '.orphaned_at'))) continue;
                for (const [name, want] of own) {
                    const skill = path.join(dir, 'skills', name);
                    if (!fs.existsSync(path.join(skill, 'SKILL.md'))) continue;
                    differs.set(name, !!differs.get(name) || changedFiles(name, skill, want).length > 0);
                }
            }
            if (differs.size)
                found.push(
                    `plugin ${key} duplicates project skills: ${[...differs]
                        .map(([name, d]) => (d ? `${name} (differs from this package)` : name))
                        .join(', ')}`
                );
        } catch (e) {
            failed.push(`${key}: ${firstLine(e)}`);
        }
    }
    const details = failed.join('\n') || undefined;
    if (found.length) return check('skills.claude.plugins', 'warn', found.join('; '), { details });
    if (failed.length)
        return check('skills.claude.plugins', 'skipped', 'Claude Code plugin directory is not readable', {
            details
        });
    return undefined;
};

const skills = async (ctx: Ctx): Promise<Check[]> => {
    const { agent } = ctx;
    const checks: Check[] = [];
    let readable = false;
    for (const f of FAMILIES.filter((f) => !agent || f.readBy(agent) || f.key === 'agents')) {
        const { personal, project } = skillRoots(f.dir, ctx.cwd, f.personal());
        if (project) checks.push(copyCheck(`skills.${f.key}.project`, project));
        if (personal)
            checks.push(
                copyCheck(`skills.${f.key}.personal`, personal, {
                    project: !!project,
                    shadows: !!project && f.key === 'claude'
                })
            );
        readable ||= !!(personal || project) && (!agent || f.readBy(agent));
    }
    if (!readable)
        checks.push(
            check('skills.installed', 'warn', `no c4builder skills for ${agent ?? 'any agent'} here`, {
                fix: 'c4builder skills',
                askUser: true
            })
        );
    if (!agent || agent === 'claude-code') {
        const plugins = pluginCheck(ctx.cwd);
        if (plugins) checks.push(plugins);
    }
    checks.push(
        check('skills.session', 'skipped', 'what the agent session loaded is not visible to the CLI')
    );
    return checks;
};

// --- render ---

const C4_SAMPLE = `@startuml
!include <C4/C4_Context>
Person(user, "User")
System(app, "App")
Rel(user, app, "Uses")
@enduml
`;

const timed = async (
    id: string,
    label: string,
    work: () => Promise<unknown>,
    fix: string
): Promise<Check> => {
    const started = Date.now();
    try {
        await work();
        return check(id, 'ok', `${label} in ${seconds(started)}`);
    } catch (e) {
        return check(id, 'error', `${label} failed: ${firstLine(e)}`, {
            fix,
            details: String((e as Error)?.message ?? e)
                .split('\n')
                .slice(1)
                .join('\n')
        });
    }
};

// Сборка шаблонного проекта дочерним CLI, как шаг «Smoke build» скилла c4builder-setup (D7). Java —
// найденная, через JAVA_HOME: иначе дочерняя сборка могла бы скачать JRE.
const fullBuild = async (ctx: Ctx): Promise<Check> => {
    if (!ctx.java)
        return check('render.full', 'skipped', 'template build needs Java', { fix: 'c4builder jre install' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4builder-doctor-'));
    const env = {
        ...process.env,
        NO_UPDATE_NOTIFIER: '1',
        JAVA_HOME: path.dirname(path.dirname(ctx.java.path))
    };
    let log = '';
    const step = async (args: string[], cwd: string): Promise<void> => {
        const out = await run(process.execPath, [CLI, ...args], {
            cwd,
            env,
            timeout: 300_000,
            maxBuffer: 64 << 20
        }).catch((e) => {
            log += `${e.stdout ?? ''}${e.stderr ?? ''}`;
            throw new Error(e.killed ? 'timed out' : `exit code ${e.code}`);
        });
        log += out.stdout + out.stderr;
    };
    const started = Date.now();
    try {
        await step(['--new', '--name', 'doctor', '-y'], dir);
        // --verbose: без него ошибка диаграммы — одна короткая строка, а хвосту лога в details нужна
        // причина (stderr движка): ради неё doctor и запускают.
        await step(['--verbose'], path.join(dir, 'doctor'));
        return check('render.full', 'ok', `template project built in ${seconds(started)}`, {
            details: tail(log)
        });
    } catch (e) {
        return check('render.full', 'error', `template project build failed: ${firstLine(e)}`, {
            fix: ISSUES,
            details: tail(log)
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

const render = async (ctx: Ctx): Promise<Check[]> => {
    const { java } = ctx;
    const has = (ext: string): boolean => ctx.files.some((f) => f.endsWith(ext));
    const plantuml = java
        ? timed(
              'render.plantuml',
              'PlantUML with C4',
              () =>
                  renderDiagram(C4_SAMPLE, {
                      javaBin: java.path,
                      jarPath: path.join(VENDOR_DIR, VENDORED_JAR.jar),
                      includePath: ctx.cwd,
                      format: 'svg',
                      charset: 'UTF-8',
                      isDitaa: false,
                      useSystemFonts: false
                  }),
              'c4builder jre install --force'
          )
        : check('render.plantuml', 'skipped', 'PlantUML needs Java', { fix: 'c4builder jre install' });
    // Встроенные образцы, а не файлы проекта: проверяется движок, а не диаграммы пользователя.
    const d2 =
        has('.d2') &&
        timed(
            'render.d2',
            'D2',
            () => renderD2(path.join(ctx.cwd, 'doctor.d2'), { seed: 'a -> b\n' }).finally(teardownD2),
            ctx.install.fix('@terrastruct/d2')
        );
    const mermaid =
        has('.mmd') &&
        timed(
            'render.mermaid',
            'Mermaid',
            () => renderMermaid('graph TD\n  a --> b\n', 'doctor.mmd').finally(teardownMermaid),
            ctx.install.fix('@mermaid-js/tiny jsdom')
        );
    const full = ctx.full && fullBuild(ctx);
    return (await Promise.all([plantuml, d2, mermaid, full])).filter((c): c is Check => !!c);
};

// --- project, runtime ---

const readProject = (file: string): Project | undefined => {
    if (!fs.existsSync(file)) return undefined;
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return { file, error: firstLine(e) };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { file, error: 'not a JSON object' };
    const parsed = parseConfig(raw as Record<string, unknown>);
    return {
        file,
        raw: raw as Record<string, unknown>,
        config: parsed.ok ? parsed.value : parsed.salvaged,
        broken: new Map(parsed.ok ? [] : parsed.issues.map((i) => [i.key, i.message]))
    };
};

const pathsCheck = async (ctx: Ctx, config: C4ConfigFile): Promise<Check> => {
    const missing: string[] = [];
    if (!fs.statSync(path.resolve(ctx.cwd, config.rootFolder), { throwIfNoEntry: false })?.isDirectory())
        missing.push(`rootFolder ${config.rootFolder}`);
    // Код плагинов исполняется при импорте, и его печать в stdout сломала бы `--json`: она уходит в details,
    // как лог пробной сборки. EXECUTE_SCRIPT: true — иначе загрузчик сам напишет строку о включении executeScript.
    const write = process.stdout.write;
    let log = '';
    process.stdout.write = ((chunk: string | Uint8Array) => {
        log += String(chunk);
        return true;
    }) as typeof write;
    let failed: string | undefined;
    try {
        const plugins = await loadPlugins(config.plugins, ctx.cwd, { EXECUTE_SCRIPT: true } as BuildOptions);
        for (const { plugin, opts } of plugins)
            for (const p of plugin.watchPaths?.(opts) ?? [])
                if (!fs.existsSync(path.resolve(ctx.cwd, p))) missing.push(`plugin ${plugin.name}: ${p}`);
    } catch (e) {
        failed = firstLine(e);
    } finally {
        process.stdout.write = write;
    }
    const details = tail(log) || undefined;
    if (failed) return check('project.paths', 'error', failed, { fix: PLUGINS_DOCS, details });
    if (!missing.length)
        return check('project.paths', 'ok', `rootFolder ${config.rootFolder} and plugin paths exist`, {
            details
        });
    return check('project.paths', 'error', `missing ${missing.join('; ')}`, {
        ...(missing[0].startsWith('rootFolder')
            ? { fix: 'c4builder config', askUser: true }
            : { fix: PLUGINS_DOCS }),
        details
    });
};

const project = async (ctx: Ctx): Promise<Check[]> => {
    const p = ctx.project;
    if (!p) return [check('project.config', 'skipped', 'no .c4builder here', { fix: 'c4builder --new' })];
    const name = path.relative(ctx.cwd, p.file);
    if (p.error !== undefined)
        return [
            check('project.config', 'error', `${name} is not valid JSON: ${p.error}`, { fix: CONFIG_DOCS })
        ];
    const { raw, config, broken } = p;
    const issues = [...broken].map(([k, m]) => `${k} — ${m}`);
    const unset = (Object.keys(WIZARD_KEYS) as (keyof typeof WIZARD_KEYS)[]).filter(
        (k) => raw[k] == null || broken.has(k) || config[k] === undefined || config[k] === ''
    );
    return [
        issues.length
            ? check('project.config', 'error', `${name}: ${issues.join('; ')}`, {
                  ...(broken.has('plugins')
                      ? { fix: PLUGINS_DOCS }
                      : { fix: 'c4builder config', askUser: true })
              })
            : check('project.config', 'ok', `${name} valid`),
        unset.length
            ? check('project.complete', 'warn', `the setup wizard asks for ${unset.join(', ')}`, {
                  fix: 'c4builder config',
                  askUser: true
              })
            : check('project.complete', 'ok', 'non-interactive build ready'),
        await pathsCheck(ctx, config)
    ];
};

// Порт: `-p` → живой файл состояния сервера → `webPort` (change site-server-state, D9). Сервер из файла
// уже опознан по pid — пробу не повторяем.
// Иначе чем занят порт, решает эндпоинт состояния: нет ответа — чужой процесс.
const runtime = async (ctx: Ctx): Promise<Check[]> => {
    // Конфиг уже прочитан readProject — webPort оттуда, а не вторым разбором файла.
    const found = await findServer(ctx.configPath, {
        port: ctx.port,
        webPort: Number(ctx.project?.config?.webPort ?? defaultConfig.webPort)
    });
    const { port, url } = found;
    const from = found.source === 'state' ? ` (from ${path.basename(stateFile(ctx.configPath))})` : '';
    const portCheck = (): Check => {
        switch (found.kind) {
            case 'free':
                return check('runtime.port', 'ok', `port ${port} free`);
            case 'own':
                return check(
                    'runtime.port',
                    'ok',
                    found.status.watch
                        ? `site -w is running at ${url}${from}`
                        : `site is running at ${url} without -w${from}`
                );
            case 'unresponsive':
                return check(
                    'runtime.port',
                    'warn',
                    `site is running at ${url} (pid ${found.state.pid}) but did not answer in time${from}`,
                    { fix: 'c4builder status' }
                );
            case 'other-project':
                return check(
                    'runtime.port',
                    'warn',
                    `port ${port} is used by the c4builder site of another project${found.status.project ? ` (${found.status.project})` : ''}`,
                    { fix: 'c4builder site -w -p <port>' }
                );
            case 'busy':
                return check('runtime.port', 'warn', `port ${port} is in use by another process`, {
                    fix: 'c4builder site -w -p <port>'
                });
        }
    };
    return [
        portCheck(),
        check(
            'runtime.agent',
            'ok',
            ctx.agent ? `coding agent ${ctx.agent}, agent mode on` : 'no coding agent, agent mode off'
        )
    ];
};

// --- вывод ---

const GROUPS = { env, skills, render, project, runtime };
type Group = keyof typeof GROUPS;
const TITLES: Record<Group, string> = {
    env: 'Environment',
    skills: 'Skills',
    render: 'Render',
    project: 'Project',
    runtime: 'Runtime'
};
const MARKS: Record<Status, string> = {
    ok: chalk.green('✓'),
    warn: chalk.yellow('!'),
    error: chalk.red('✗'),
    skipped: chalk.gray('–')
};
const channel = pkg.version.includes('-') ? 'rc' : 'latest';
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

// Без -v вывод безопасно вставлять в issue (D9): каталог запуска — относительно, домашний — `~`.
const redact =
    (cwd: string, home: string) =>
    (s: string): string =>
        s
            .split(cwd + path.sep)
            .join('')
            // Путь в кавычках (quote): `~` — до кавычки, иначе оболочка его не раскроет.
            .split(`"${home}${path.sep}`)
            .join(`~${path.sep}"`)
            .split(home + path.sep)
            .join(`~${path.sep}`);

export default async (
    args: string[],
    opts: {
        json?: boolean;
        verbose?: boolean;
        strict?: boolean;
        full?: boolean;
        offline?: boolean;
        port?: number;
        configFile?: string;
    }
): Promise<void> => {
    const unknown = args.filter((a) => !Object.hasOwn(GROUPS, a));
    if (unknown.length) {
        console.error(`unknown doctor group: ${unknown.join(', ')}`);
        console.error(`available groups: ${Object.keys(GROUPS).join(', ')}`);
        process.exit(2);
    }
    const groups = (Object.keys(GROUPS) as Group[]).filter((g) => !args.length || args.includes(g));
    const cwd = process.cwd();
    const found = detectAgent(process.env, {});
    const configPath = path.join(cwd, opts.configFile ?? '.c4builder');
    const proj = readProject(configPath);
    const sources = proj?.config && path.resolve(cwd, proj.config.rootFolder);
    let files: string[] = [];
    try {
        if (sources) files = fs.readdirSync(sources, { recursive: true, encoding: 'utf8' });
    } catch {}
    // Java — один раз на env и render и только чтением: installedJavaAt, а не cachedJava, который сносит
    // битый кэш, и не resolveJava, который скачивает JRE (D5).
    const needJava = groups.includes('env') || groups.includes('render');
    const sys = needJava ? detectSystemJava() : null;
    const cached = needJava && !sys ? installedJavaAt(jreCacheDir()) : null;
    const ctx: Ctx = {
        cwd,
        configPath,
        full: !!opts.full,
        offline: !!opts.offline,
        port: opts.port,
        agent: found.on ? found.name : undefined,
        project: proj,
        java: sys
            ? { path: sys.path, label: `Java ${sys.major} (system)` }
            : cached
              ? { path: cached, label: 'managed JRE (cache)' }
              : undefined,
        install: installKind(cwd),
        files
    };
    const results = await Promise.all(
        groups.map((g) =>
            GROUPS[g](ctx).catch((e) => [
                check(`${g}.doctor`, 'error', `check failed: ${firstLine(e)}`, { fix: ISSUES })
            ])
        )
    );
    // details — только с -v и у ошибок; без -v пути обезличены.
    const clean = opts.verbose ? (s: string) => s : redact(cwd, os.homedir());
    const shown = results.map((checks) =>
        checks.map((c) => ({
            ...c,
            message: clean(c.message),
            ...(c.fix && { fix: clean(c.fix) }),
            details: c.details && (opts.verbose || c.status === 'error') ? clean(c.details) : undefined
        }))
    );
    const all = shown.flat();
    const errors = all.filter((c) => c.status === 'error').length;
    const warnings = all.filter((c) => c.status === 'warn').length;
    if (opts.json) {
        const report = {
            version: pkg.version,
            channel,
            agent: ctx.agent ?? null,
            checks: all,
            summary: { errors, warnings }
        };
        console.log(JSON.stringify(report, null, 2));
    } else {
        const lines = [`c4builder doctor ${pkg.version} (${channel})`];
        for (const [i, g] of groups.entries()) {
            lines.push(g === 'skills' ? `${TITLES[g]} (${ctx.agent ?? 'all agents'})` : TITLES[g]);
            for (const c of shown[i]) {
                lines.push(`  ${MARKS[c.status]} ${c.message}`);
                if (c.fix) lines.push(`      fix: ${c.fix}${c.askUser ? '   (ask the user first)' : ''}`);
                if (c.details) lines.push(...c.details.split('\n').map((l) => chalk.gray(`      ${l}`)));
            }
        }
        lines.push(`${plural(errors, 'error')}, ${plural(warnings, 'warning')}`);
        console.log(lines.join('\n'));
    }
    process.exitCode = errors || (opts.strict && warnings) ? 1 : 0;
};
