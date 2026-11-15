// Коммит и пуш файла журнала ревью со страницы `site -w` (change site-review-approve-push): кнопки
// Approve row и Push. Ревьюеры часто не работают с git каждый день, а в той же рабочей копии
// параллельно работает агент, поэтому поведение консервативное: в коммит идёт только файл журнала,
// пушится только он (чужие незапушенные коммиты, merge в процессе — отказ), индекс и рабочая копия
// не прячутся в stash, конфликт с upstream не разрешается автоматически, пуш — без force.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Ошибка git-операции: текст на английском с хвостом вывода git и HTTP-статус для страницы. */
export class ReviewGitError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
    }
}

interface Run {
    code: number;
    stdout: string;
    stderr: string;
}

// Обычная команда — быстро; сеть и хуки коммита (pre-commit проекта) — дольше.
const TIMEOUT = 30_000;
const NETWORK_TIMEOUT = 90_000;
const COMMIT_TIMEOUT = 120_000;

// Подсказка в ошибке после неудачного пуша: кнопка, которую нажимали, — Push или Approve row
// (подписи меняет проект), поэтому без названия.
const RETRY = 'the commit stays local, press the button again to retry';

// Хвост вывода git в ошибке: целиком stderr бывает в сотни строк (хуки), странице хватит конца.
const tail = (r: Pick<Run, 'stdout' | 'stderr'>): string => {
    const text = (r.stderr.trim() || r.stdout.trim()).split('\n').slice(-6).join('\n').trim();
    return text ? `: ${text}` : '';
};

interface GitOptions {
    timeout?: number;
    input?: string;
    env?: Record<string, string>;
}

/**
 * git без shell: аргументы не интерпретируются, имя файла с пробелами или `;` безопасно.
 * `GIT_TERMINAL_PROMPT=0` — пуш по https без сохранённых учётных данных падает сразу, а не ждёт
 * ввода пароля в терминале сервера; `LC_ALL=C` — сообщения git в ответе странице на английском.
 */
const git = (cwd: string, args: string[], { timeout = TIMEOUT, input, env }: GitOptions = {}): Promise<Run> =>
    new Promise((resolve) => {
        const child = execFile(
            'git',
            args,
            {
                cwd,
                timeout,
                maxBuffer: 64 * 1024 * 1024,
                env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
            },
            (err, stdout, stderr) => {
                const e = err as { code?: unknown; killed?: boolean; message: string } | null;
                if (e?.killed) {
                    resolve({
                        code: -1,
                        stdout: String(stdout),
                        stderr: `git ${args[0]} timed out after ${timeout / 1000} s — git must work without asking for a password`
                    });
                    return;
                }
                if (e && typeof e.code !== 'number') {
                    resolve({ code: -1, stdout: '', stderr: `cannot run git: ${e.message}` });
                    return;
                }
                resolve({ code: e ? Number(e.code) : 0, stdout: String(stdout), stderr: String(stderr) });
            }
        );
        if (input !== undefined) child.stdin?.end(input);
    });

const must = async (cwd: string, args: string[], what: string, status = 500, options?: GitOptions) => {
    const r = await git(cwd, args, options);
    if (r.code !== 0) throw new ReviewGitError(`${what}${tail(r)}`, status);
    return r.stdout.trim();
};

/** Ветка, её upstream и файл журнала: куда пушить и что разрешено пушить. */
export interface Upstream {
    /** Корень репозитория: plumbing-команды работают с путями от него. */
    top: string;
    branch: string;
    /** Имя remote upstream'а. */
    remote: string;
    /** Файл журнала от корня репозитория, через `/`. */
    log: string;
    /** Незапушенные коммиты уже есть (только журнала — иначе preflight отказывает). */
    pending: boolean;
}

// Незавершённая операция git: пока она идёт, HEAD и индекс принадлежат ей, а не журналу.
const IN_PROGRESS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'];

/**
 * Проверка до любых правок файла (апрув без upstream не должен оставить изменённый журнал):
 * репозиторий без незавершённого merge/rebase/cherry-pick; ветка, а не detached HEAD; upstream —
 * ветка с тем же именем в remote, и она существует. Пушить разрешено только журнал: незапушенные
 * коммиты, трогающие что-то ещё (WIP агента, merge), — отказ. Незапушенные коммиты только этого
 * журнала допустимы: это наш же коммит после отклонённого пуша, повтор его дотолкает.
 */
export const preflight = async (cwd: string, file: string): Promise<Upstream> => {
    const top = await must(
        cwd,
        ['rev-parse', '--show-toplevel'],
        'the project is not inside a git repository',
        409
    );
    const paths = await must(
        cwd,
        ['rev-parse', ...IN_PROGRESS.flatMap((p) => ['--git-path', p])],
        'git rev-parse failed'
    );
    paths.split('\n').forEach((p, i) => {
        if (fs.existsSync(path.resolve(cwd, p)))
            throw new ReviewGitError(
                `${IN_PROGRESS[i]} exists — a merge, rebase or cherry-pick is in progress; finish or abort it first`,
                409
            );
    });
    const head = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (head.code !== 0)
        throw new ReviewGitError('HEAD is detached — check out a branch to commit the review log', 409);
    const branch = head.stdout.trim();
    const remote = (await git(cwd, ['config', '--get', `branch.${branch}.remote`])).stdout.trim();
    const merge = (await git(cwd, ['config', '--get', `branch.${branch}.merge`])).stdout.trim();
    if (!remote || !merge)
        throw new ReviewGitError(
            `branch ${branch} has no upstream — push it once with "git push -u <remote> ${branch}"`,
            409
        );
    const remoteBranch = merge.replace(/^refs\/heads\//, '');
    // Как push.default=simple: ветка review-x с upstream origin/master иначе запушилась бы в master.
    if (remote === '.' || remoteBranch !== branch)
        throw new ReviewGitError(
            `branch ${branch} tracks ${remote === '.' ? 'the local branch' : remote}/${remoteBranch}, not a branch of the same name — push the review log with git by hand`,
            409
        );
    const upstream = await git(cwd, ['rev-parse', '--verify', '--quiet', '@{upstream}']);
    if (upstream.code !== 0)
        throw new ReviewGitError(
            `upstream ${remote}/${branch} does not exist — push the branch with "git push -u ${remote} ${branch}"`,
            409
        );
    // Путь журнала от корня — через realpath: /tmp и /private/tmp на macOS, симлинки проекта.
    const real = path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
    const log = path.relative(top, real).split(path.sep).join('/');
    const merges = Number(
        await must(cwd, ['rev-list', '--count', '--merges', '@{upstream}..HEAD'], 'git rev-list failed')
    );
    // `-z`: имена без кавычек и \-экранирования кириллицы (core.quotepath).
    const touched = (
        await must(cwd, ['log', '-z', '--format=', '--name-only', '@{upstream}..HEAD'], 'git log failed')
    )
        .split(/[\0\n]/)
        .filter(Boolean);
    if (merges || touched.some((f) => f !== log))
        throw new ReviewGitError(
            `branch ${branch} has unpushed commits besides the review log — push or drop them with git first`,
            409
        );
    const ahead = Number(
        await must(cwd, ['rev-list', '--count', '@{upstream}..HEAD'], 'git rev-list failed')
    );
    return { top, branch, remote, log, pending: ahead > 0 };
};

/**
 * Коммит одного файла: `--only` берёт рабочую версию только этого пути и не трогает индекс
 * остальных — уже добавленные агентом правки не уйдут в коммит журнала и не потеряются.
 * Неотслеживаемый журнал сначала добавляется: `--only` знает лишь отслеживаемые пути; при
 * неудаче коммита добавление снимается. Возвращает хэш коммита либо null, если файл не изменён.
 */
export const commitFile = async (cwd: string, file: string, message: string): Promise<string | null> => {
    const rel = path.relative(cwd, file);
    const status = await must(cwd, ['status', '--porcelain', '--', rel], 'git status failed');
    if (!status) return null;
    const added = status.startsWith('??');
    if (added) await must(cwd, ['add', '--', rel], `could not add ${rel}`);
    const commit = await git(cwd, ['commit', '--only', '-m', message, '--', rel], {
        timeout: COMMIT_TIMEOUT
    });
    if (commit.code !== 0) {
        if (added) await git(cwd, ['reset', '-q', '--', rel]);
        throw new ReviewGitError(`could not commit ${rel}${tail(commit)}`, 500);
    }
    return must(cwd, ['rev-parse', '--short', 'HEAD'], 'git rev-parse failed');
};

const ahead = async (cwd: string): Promise<number> =>
    Number(await must(cwd, ['rev-list', '--count', '@{upstream}..HEAD'], 'git rev-list failed')) || 0;

// Содержимое журнала в ревизии; нет файла — пусто (журнал добавлен после общего предка).
const blob = async (top: string, rev: string, log: string): Promise<string> => {
    const r = await git(top, ['cat-file', 'blob', `${rev}:${log}`]);
    return r.code === 0 ? r.stdout : '';
};

/**
 * Upstream ушёл вперёд: коммиты журнала переносятся на него без rebase и stash. Незапушенные
 * коммиты — только журнала (это гарантирует preflight), поэтому новый коммит — дерево upstream с
 * журналом, слитым трёхсторонне (`merge-file`: общий предок, наш, upstream). Дерево собирается во
 * временном индексе, рабочая копия переключается `checkout -B`: он переносит локальные правки и
 * индекс как есть и отказывает целиком, если они пересекаются с изменениями upstream. Так ни один
 * сбой не оставляет правки в stash или неиндексированными. Несколько коммитов журнала сливаются в
 * один с сообщением последнего.
 */
const moveOnto = async (up: Upstream): Promise<void> => {
    const { top, log, branch, remote } = up;
    const conflict = (what: string) =>
        new ReviewGitError(
            `${what} — run git pull and resolve the conflict by hand; the commit stays local`,
            409
        );
    const target = await must(top, ['rev-parse', '@{upstream}'], 'git rev-parse failed');
    const base = await must(top, ['merge-base', 'HEAD', target], 'git merge-base failed');
    const [baseText, ours, theirs] = await Promise.all([
        blob(top, base, log),
        blob(top, 'HEAD', log),
        blob(top, target, log)
    ]);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4builder-review-'));
    try {
        let merged = ours;
        if (theirs !== baseText && ours !== theirs) {
            const files = { ours, base: baseText, theirs };
            for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(tmp, name), text);
            const m = await git(top, [
                'merge-file',
                '-p',
                path.join(tmp, 'ours'),
                path.join(tmp, 'base'),
                path.join(tmp, 'theirs')
            ]);
            if (m.code > 0 && m.code < 128)
                throw conflict(`the review log conflicts with changes in ${remote}/${branch}`);
            if (m.code !== 0) throw new ReviewGitError(`git merge-file failed${tail(m)}`, 500);
            merged = m.stdout;
        }
        const id = await must(top, ['hash-object', '-w', '--stdin'], 'git hash-object failed', 500, {
            input: merged
        });
        const mode =
            (await must(top, ['ls-tree', '--full-tree', 'HEAD', '--', log], 'git ls-tree failed')).split(
                ' '
            )[0] || '100644';
        const env = { GIT_INDEX_FILE: path.join(tmp, 'index') };
        await must(top, ['read-tree', target], 'git read-tree failed', 500, { env });
        await must(
            top,
            ['update-index', '--add', '--cacheinfo', `${mode},${id},${log}`],
            'git update-index failed',
            500,
            { env }
        );
        const tree = await must(top, ['write-tree'], 'git write-tree failed', 500, { env });
        const message = await must(top, ['log', '-1', '--format=%B', 'HEAD'], 'git log failed');
        const commit = await must(
            top,
            ['commit-tree', tree, '-p', target, '-F', '-'],
            'git commit-tree failed',
            500,
            {
                input: `${message}\n`
            }
        );
        const checkout = await git(top, ['checkout', '-q', '-B', branch, commit]);
        if (checkout.code !== 0)
            throw conflict(`local changes overlap with changes in ${remote}/${branch}${tail(checkout)}`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
};

/**
 * Синхронизация с upstream и пуш: fetch, перенос коммита журнала на ушедший вперёд upstream,
 * пуш `HEAD:<ветка>` — имя совпадает с upstream (preflight), явная форма не зависит от
 * `push.default` пользователя; без force. Возвращает, был ли пуш.
 */
export const syncAndPush = async (cwd: string, up: Upstream): Promise<boolean> => {
    // Нечего отдавать — и fetch не нужен: в HEAD нет коммитов, которых нет в upstream.
    if (!(await ahead(cwd))) return false;
    await must(cwd, ['fetch', '--quiet', up.remote], `could not fetch ${up.remote} — ${RETRY}`, 502, {
        timeout: NETWORK_TIMEOUT
    });
    const behind = await git(cwd, ['merge-base', '--is-ancestor', '@{upstream}', 'HEAD']);
    if (behind.code === 1) await moveOnto(up);
    else if (behind.code !== 0) throw new ReviewGitError(`git merge-base failed${tail(behind)}`, 500);
    await must(
        cwd,
        ['push', up.remote, `HEAD:${up.branch}`],
        `push to ${up.remote}/${up.branch} was rejected — ${RETRY}`,
        502,
        { timeout: NETWORK_TIMEOUT }
    );
    return true;
};

export interface PublishInput {
    cwd: string;
    /** Абсолютный путь файла журнала внутри `cwd`. */
    file: string;
    message: string;
    /** Правка файла после проверки git и до коммита (апрув пишет ячейки). */
    edit?: () => void;
}

export interface PublishResult {
    /** Короткий хэш нового коммита; null — файл не изменён. */
    commit: string | null;
    pushed: boolean;
}

/**
 * Проверка git → правка → коммит только журнала → синхронизация с upstream → пуш. Коммит не
 * удался (hook, index.lock) — правка откатывается: журнал не остаётся изменённым без коммита.
 */
export const publishFile = async ({ cwd, file, message, edit }: PublishInput): Promise<PublishResult> => {
    const up = await preflight(cwd, file);
    const before = edit ? fs.readFileSync(file, 'utf8') : undefined;
    edit?.();
    let commit: string | null;
    try {
        commit = await commitFile(cwd, file, message);
    } catch (e) {
        if (before !== undefined) fs.writeFileSync(file, before);
        throw e;
    }
    const pushed = await syncAndPush(cwd, up);
    // Перенос на upstream меняет хэш: в ответе — тот коммит, что теперь в ветке.
    const head = commit && (await must(cwd, ['rev-parse', '--short', 'HEAD'], 'git rev-parse failed'));
    return { commit: head || null, pushed };
};

/**
 * Есть ли незапушенный коммит этого журнала, который можно дотолкать (повторный Approve row после
 * отклонённого пуша). Любой отказ preflight — нет: дотолкать нельзя.
 */
export const unpushedLog = async (cwd: string, file: string): Promise<boolean> =>
    (await preflight(cwd, file).catch(() => undefined))?.pending ?? false;

/** Дотолкать уже закоммиченный журнал без нового коммита (несохранённые правки файла не трогаются). */
export const pushPending = async (cwd: string, file: string): Promise<boolean> =>
    syncAndPush(cwd, await preflight(cwd, file));

/**
 * Очередь git-операций сервера: строго по одной. Две вкладки, нажавшие Push одновременно,
 * иначе сталкиваются на `index.lock`; ошибка одной операции не рвёт цепочку.
 */
export const serialQueue = () => {
    let last: Promise<unknown> = Promise.resolve();
    return <T>(task: () => Promise<T>): Promise<T> => {
        const run = last.then(task, task);
        last = run.catch(() => undefined);
        return run;
    };
};
