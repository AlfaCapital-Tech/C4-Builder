import { spawn, spawnSync, type SpawnSyncOptions } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';

import { isPathInside } from '../util/archive.ts';
import { PACKAGE_ROOT, packageJson as pkg } from '../util/paths.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
// Без лимитов npm в сети, молча теряющей пакеты, висит минутами (повторы с паузами до 60 с).
const VIEW = ['view', pkg.name, 'dist-tags', '--json', '--fetch-retries=0', '--fetch-timeout=5000'];

// npm на Windows — npm.cmd, а .cmd Node ≥ 20.12 запускает только через shell. Команду склеиваем
// сами: shell с массивом аргументов Node помечает DEP0190. Аргументы фиксированные или прошли SEMVER.
const WIN = process.platform === 'win32';
const npmCommand = (args: string[]): [string, string[]] =>
    WIN ? [['npm', ...args].join(' '), []] : ['npm', args];
const npmSync = (args: string[], options: Pick<SpawnSyncOptions, 'stdio' | 'timeout'>) => {
    const [cmd, argv] = npmCommand(args);
    return spawnSync(cmd, argv, { ...options, encoding: 'utf8', shell: WIN, windowsHide: true });
};

// CI ставят GitLab CI, GitHub Actions и большинство CI; C4BUILDER_DOCKER — наш Dockerfile;
// NO_UPDATE_NOTIFIER — общая конвенция с пакетом update-notifier.
export const disabled = (): boolean =>
    !!(process.env.CI || process.env.NO_UPDATE_NOTIFIER || process.env.C4BUILDER_DOCKER);

const cacheFile = (): string =>
    path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
        'c4builder',
        'dist-tags.json'
    );

// Порядок semver без зависимости semver: numeric-коллатор сравнивает цифровые серии численно
// (0.10.0 > 0.9.0, rc.10 > rc.2); стабильная версия старше пререлиза того же ядра.
const collator = new Intl.Collator('en', { numeric: true });
export const compareVersions = (a: string, b: string): number => {
    const [coreA = '', preA = ''] = a.split(/-(.*)/);
    const [coreB = '', preB = ''] = b.split(/-(.*)/);
    return collator.compare(coreA, coreB) || Number(!preA) - Number(!preB) || collator.compare(preA, preB);
};

// Версия для обновления по dist-tags от npm, или undefined: нет данных (пустой, битый, недописанный
// кэш, JSON-ошибка npm) либо ничего новее текущей. Пререлиз смотрит и на rc, который может отстать
// от latest. npm 12 отдаёт dist-tags массивом из одного объекта, npm ≤ 11 — самим объектом.
export const newestVersion = (current: string, distTags: string): string | undefined => {
    let tags: Record<string, unknown> | null;
    try {
        tags = [JSON.parse(distTags)].flat()[0];
    } catch {
        return undefined;
    }
    let newest = current;
    for (const tag of current.includes('-') ? ['latest', 'rc'] : ['latest']) {
        const v = tags?.[tag];
        if (typeof v === 'string' && SEMVER.test(v) && compareVersions(v, newest) > 0) newest = v;
    }
    return newest === current ? undefined : newest;
};

// Обновление, известное по прошлой проверке; читать до startUpdateCheck — она обнуляет кэш.
export const pendingUpdate = (): string | undefined => {
    if (disabled()) return undefined;
    try {
        return newestVersion(pkg.version, fs.readFileSync(cacheFile(), 'utf8'));
    } catch {
        return undefined;
    }
};

// Не чаще раза в сутки — отсоединённый `npm view` со stdout прямо в файл кэша: CLI его не ждёт,
// а реестр, прокси и сертификаты npm берёт из npmrc — тот же путь, что у установки обновления.
// mtime кэша — время последней попытки, удачной или нет.
export const startUpdateCheck = (): void => {
    if (disabled()) return;
    try {
        const file = cacheFile();
        if (Date.now() - (fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0) < DAY_MS) return;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const fd = fs.openSync(file, 'w');
        try {
            // open('w') уже пустого файла (прошлая попытка без сети) обновляет mtime не на всех ФС.
            fs.futimesSync(fd, new Date(), new Date());
            // fd/ignore, а не pipe: pipe ребёнка держал бы event loop CLI до выхода npm.
            const [cmd, argv] = npmCommand(VIEW);
            spawn(cmd, argv, {
                detached: true,
                stdio: ['ignore', fd, 'ignore'],
                shell: WIN,
                windowsHide: true
            })
                .on('error', () => {}) // нет npm в PATH: без обработчика ENOENT роняет CLI
                .unref();
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        // Проверка необязательна: недоступный на запись каталог конфигурации не должен мешать CLI.
    }
};

// realpath: npm link и симлинки prefix'а (nvm, Homebrew) — сравниваем реальные пути.
const installedGlobally = (globalRoot: string): boolean => {
    try {
        return isPathInside(fs.realpathSync(globalRoot), fs.realpathSync(PACKAGE_ROOT));
    } catch {
        return false;
    }
};

// `c4builder update`: ставит новейшую версию при глобальной npm-установке, иначе подсказывает,
// как обновиться. Ставим точную версию, а не @latest: для пререлиза новейшей бывает и latest.
export const cmdUpdate = (): void => {
    if (process.env.C4BUILDER_DOCKER) {
        console.log('c4builder runs in the Docker image, pull the new image instead:');
        console.log('  docker pull ghcr.io/alfacapital-tech/c4builder:latest');
        process.exit(1);
    }
    const view = npmSync(VIEW, { stdio: ['ignore', 'pipe', 'inherit'], timeout: 60_000 });
    if (view.status !== 0) {
        const reason = view.error?.message ?? `npm exited with code ${view.status}`;
        console.error(chalk.red(`could not query the npm registry: ${reason}`));
        process.exit(1);
    }
    const next = newestVersion(pkg.version, view.stdout);
    if (!next) {
        console.log(chalk.green(`c4builder ${pkg.version} is up to date`));
        return;
    }
    const root = npmSync(['root', '-g'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 });
    if (root.status === 0 && installedGlobally(root.stdout.trim())) {
        console.log(`updating c4builder ${pkg.version} -> ${next}`);
        process.exit(npmSync(['install', '-g', `${pkg.name}@${next}`], { stdio: 'inherit' }).status ?? 1);
    }
    console.log(
        `c4builder ${next} is available (current ${pkg.version}), but this copy is not a global npm install.`
    );
    console.log(`update the project dependency:  npm i -D ${pkg.name}@${next}`);
    console.log(`or run the new version once:    npx ${pkg.name}@${next}`);
    process.exit(1);
};
