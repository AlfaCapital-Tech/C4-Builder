// Коммит и пуш файла журнала ревью со страницы `site -w` (change site-review-approve-push): кнопки
// Approve row и Push. Ревьюеры часто не работают с git каждый день, а в той же рабочей копии
// параллельно работает агент, поэтому поведение консервативное: в коммит идёт только файл журнала,
// пушится только он (чужие незапушенные коммиты, merge в процессе — отказ), индекс и рабочая копия
// не прячутся в stash, конфликт с upstream не разрешается автоматически, пуш — без force.
import { spawn } from 'node:child_process';
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

// Обычная команда — быстро; сеть и хуки коммита (pre-commit проекта) — дольше. Объект, а не
// константы: тест уменьшает таймаут, чтобы проверить убийство зависшего hook'а.
export const GIT_TIMEOUTS = { command: 30_000, network: 90_000, commit: 120_000 };
// После выхода git ждём закрытия его вывода недолго: фоновый процесс hook'а (`sleep &`) держит
// унаследованный пайп сколько угодно, а ответ git уже получен.
const CLOSE_GRACE_MS = 2_000;
// Между SIGTERM и SIGKILL группе процессов.
const KILL_GRACE_MS = 1_000;

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

// Вывод git больше этого — ошибка: журнал и служебные ответы маленькие, а память сервера общая.
const MAX_OUTPUT = 64 * 1024 * 1024;

// ssh без вопросов: пароль ключа и подтверждение host key ssh спрашивает не через stdin, а через
// /dev/tty — терминал, где запущен `site -w`; GIT_TERMINAL_PROMPT на ssh не действует. Свою
// команду ssh пользователя (переменные или core.sshCommand) не подменяем. Кэш — по каталогу.
const sshEnvCache = new Map<string, Promise<Record<string, string>>>();
export const sshEnv = (cwd: string): Promise<Record<string, string>> => {
    const cached = sshEnvCache.get(cwd);
    if (cached) return cached;
    const found = (async (): Promise<Record<string, string>> => {
        if (process.env.GIT_SSH_COMMAND || process.env.GIT_SSH) return {};
        const own = await run(cwd, ['config', '--get', 'core.sshCommand'], {});
        return own.code === 0 && own.stdout.trim() ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };
    })();
    sshEnvCache.set(cwd, found);
    return found;
};

/**
 * git без shell: аргументы не интерпретируются, имя файла с пробелами или `;` безопасно. stdin
 * закрыт (кроме команд с `input`): hook или credential helper, читающий stdin, получает EOF, а не
 * ждёт ввода до таймаута. `GIT_TERMINAL_PROMPT=0` — пуш по https без сохранённых учётных данных
 * падает сразу; `LC_ALL=C` — сообщения git в ответе странице на английском.
 */
const run = (
    cwd: string,
    args: string[],
    { timeout = GIT_TIMEOUTS.command, input, env }: GitOptions
): Promise<Run> =>
    new Promise((resolve) => {
        // Своя группа процессов: по таймауту убиваем git вместе с ssh и hook'ами, которые он
        // запустил, — иначе они держат пайпы, промис не завершается, и очередь встаёт навсегда.
        const group = process.platform !== 'win32';
        const child = spawn('git', args, {
            cwd,
            env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
            stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
            detached: group
        });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let size = 0;
        let failure = '';
        let done = false;
        const finish = (code: number | null): void => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            child.stdout?.destroy();
            child.stderr?.destroy();
            const stdout = Buffer.concat(out).toString('utf8');
            if (failure) resolve({ code: -1, stdout, stderr: failure });
            else resolve({ code: code ?? -1, stdout, stderr: Buffer.concat(err).toString('utf8') });
        };
        const kill = (why: string): void => {
            failure = why;
            const signal = (sig: NodeJS.Signals): void => {
                try {
                    if (group && child.pid) process.kill(-child.pid, sig);
                    else child.kill(sig);
                } catch {
                    // группа уже завершилась
                }
            };
            signal('SIGTERM');
            setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS).unref();
            finish(null);
        };
        const collect = (into: Buffer[]) => (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_OUTPUT) kill(`git ${args[0]} printed more than ${MAX_OUTPUT} bytes`);
            else into.push(chunk);
        };
        child.stdout?.on('data', collect(out));
        child.stderr?.on('data', collect(err));
        const timer = setTimeout(
            () =>
                kill(
                    `git ${args[0]} timed out after ${timeout / 1000} s — git must push without asking for a password or confirmation`
                ),
            timeout
        );
        child.on('error', (e) => {
            failure = `cannot run git: ${e.message}`;
            finish(null);
        });
        child.on('exit', (code) => {
            const t = setTimeout(() => finish(code), CLOSE_GRACE_MS);
            t.unref();
            child.on('close', () => {
                clearTimeout(t);
                finish(code);
            });
        });
        child.stdin?.on('error', () => undefined);
        if (input !== undefined) child.stdin?.end(input);
    });

const git = async (cwd: string, args: string[], options: GitOptions = {}): Promise<Run> =>
    run(cwd, args, { ...options, env: { ...(await sshEnv(cwd)), ...options.env } });

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
    /** Сколько незапушенных коммитов (только журнала — иначе preflight отказывает). */
    ahead: number;
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
    // Ignored-журнал не закоммитить: отказ до правки, а не «успешный» апрув без коммита.
    if ((await git(top, ['check-ignore', '-q', '--', log])).code === 0)
        throw new ReviewGitError(`${log} is ignored by git — the review log cannot be committed`, 409);
    // Незапушенные коммиты одной проходкой: строка коммита `\x01<хэш> <родители>`, за ней имена
    // файлов; `-z` — имена без кавычек и \-экранирования кириллицы (core.quotepath).
    const unpushed = (
        await must(
            cwd,
            ['log', '-z', '--format=%x01%H %P', '--name-only', '@{upstream}..HEAD'],
            'git log failed'
        )
    )
        .split('\0')
        .map((t) => t.replace(/^\n/, ''))
        .filter(Boolean);
    const commits = unpushed.filter((t) => t.startsWith('\x01'));
    const merges = commits.some((t) => t.trim().split(' ').length > 2);
    if (merges || unpushed.some((t) => !t.startsWith('\x01') && t !== log))
        throw new ReviewGitError(
            `branch ${branch} has unpushed commits besides the review log — push or drop them with git first`,
            409
        );
    return { top, branch, remote, log, ahead: commits.length };
};

/**
 * Коммит одного файла: `--only` берёт рабочую версию только этого пути и не трогает индекс
 * остальных — уже добавленные агентом правки не уйдут в коммит журнала и не потеряются.
 * Неотслеживаемый журнал сначала добавляется: `--only` знает лишь отслеживаемые пути; при
 * неудаче коммита добавление снимается. Возвращает хэш коммита либо null, если файл не изменён.
 */
export const commitFile = async (cwd: string, file: string, message: string): Promise<string | null> => {
    const rel = path.relative(cwd, file);
    // `--untracked-files=all`: иначе по status.showUntrackedFiles=no новый журнал выглядит чистым.
    const status = await must(
        cwd,
        ['status', '--porcelain', '--untracked-files=all', '--', rel],
        'git status failed'
    );
    if (!status) return null;
    const added = status.startsWith('??');
    if (added) await must(cwd, ['add', '--', rel], `could not add ${rel}`);
    const commit = await git(cwd, ['commit', '--only', '-m', message, '--', rel], {
        timeout: GIT_TIMEOUTS.commit
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
        // commit-tree не читает commit.gpgsign сам: без -S перенесённый коммит в репозитории с
        // обязательной подписью ушёл бы неподписанным.
        const sign = await git(top, ['config', '--bool', '--get', 'commit.gpgsign']);
        const key = (await git(top, ['config', '--get', 'user.signingkey'])).stdout.trim();
        const signArgs = sign.stdout.trim() === 'true' ? [key ? `-S${key}` : '-S'] : [];
        const commit = await must(
            top,
            ['commit-tree', ...signArgs, tree, '-p', target, '-F', '-'],
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
export const syncAndPush = async (cwd: string, up: Upstream, known?: number): Promise<boolean> => {
    // Нечего отдавать — и fetch не нужен: в HEAD нет коммитов, которых нет в upstream. Число уже
    // известно из preflight (плюс наш коммит) — второй rev-list не нужен.
    if (!(known ?? (await ahead(cwd)))) return false;
    await must(
        cwd,
        ['fetch', '--quiet', up.remote, up.branch],
        `could not fetch ${up.remote} — ${RETRY}`,
        502,
        {
            timeout: GIT_TIMEOUTS.network
        }
    );
    const behind = await git(cwd, ['merge-base', '--is-ancestor', '@{upstream}', 'HEAD']);
    if (behind.code === 1) await moveOnto(up);
    else if (behind.code !== 0) throw new ReviewGitError(`git merge-base failed${tail(behind)}`, 500);
    await must(
        cwd,
        ['push', up.remote, `HEAD:${up.branch}`],
        `push to ${up.remote}/${up.branch} was rejected — ${RETRY}; git must push without asking for a password or confirmation`,
        502,
        { timeout: GIT_TIMEOUTS.network }
    );
    return true;
};

export interface PublishInput {
    cwd: string;
    /** Абсолютный путь файла журнала внутри `cwd`. */
    file: string;
    /** Сообщение коммита; функция — вычисляется после правки (автор апрува — из записанной строки). */
    message: string | (() => string);
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
    const written = edit ? fs.readFileSync(file, 'utf8') : undefined;
    // Откат — только своей записи: если файл поправили, пока шёл коммит (редактор, агент),
    // старое содержимое затёрло бы чужую правку.
    const rollback = (e: ReviewGitError): ReviewGitError => {
        if (before === undefined) return e;
        if (fs.readFileSync(file, 'utf8') === written) {
            fs.writeFileSync(file, before);
            return e;
        }
        return new ReviewGitError(
            `${e.message} (the review log changed meanwhile, so the approval edit was not rolled back)`,
            e.status
        );
    };
    let commit: string | null;
    try {
        commit = await commitFile(cwd, file, typeof message === 'function' ? message() : message);
    } catch (e) {
        throw e instanceof ReviewGitError ? rollback(e) : e;
    }
    // Правка есть, а коммитить нечего (assume-unchanged, skip-worktree) — апрув не дошёл бы до remote.
    if (edit && !commit)
        throw rollback(
            new ReviewGitError(
                `git sees no change in ${up.log} after the edit — check how git tracks it`,
                409
            )
        );
    const pushed = await syncAndPush(cwd, up, up.ahead + (commit ? 1 : 0));
    // Перенос на upstream меняет хэш: в ответе — тот коммит, что теперь в ветке.
    const head = commit && (await must(cwd, ['rev-parse', '--short', 'HEAD'], 'git rev-parse failed'));
    return { commit: head || null, pushed };
};

/** Что пушить в журнале: изменён ли файл относительно HEAD и сколько незапушенных коммитов журнала. */
export interface ReviewPending {
    changed: boolean;
    unpushed: number;
}

/**
 * Состояние для плашки Push. null — пушить нельзя (не git, нет upstream, чужие незапушенные коммиты,
 * merge в процессе): кнопка дала бы только ошибку, страница плашку не показывает. `up` — сделанный
 * preflight, чтобы вызывающий не повторял его.
 */
export const reviewPending = async (
    cwd: string,
    file: string
): Promise<(ReviewPending & { up: Upstream }) | null> => {
    const up = await preflight(cwd, file).catch(() => undefined);
    if (!up) return null;
    const status = await git(cwd, [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        path.relative(cwd, file)
    ]);
    return status.code === 0 ? { changed: !!status.stdout.trim(), unpushed: up.ahead, up } : null;
};

/** Журнал в ревизии (`HEAD`, `@{upstream}`); нет файла — пусто. */
export const logAt = (up: Upstream, rev: string): Promise<string> => blob(up.top, rev, up.log);

/**
 * Дотолкать уже закоммиченный журнал без нового коммита (несохранённые правки файла не трогаются).
 * `up` — уже сделанный preflight, чтобы не повторять его.
 */
export const pushPending = async (cwd: string, file: string, up?: Upstream): Promise<boolean> => {
    const checked = up ?? (await preflight(cwd, file));
    return syncAndPush(cwd, checked, checked.ahead);
};

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
