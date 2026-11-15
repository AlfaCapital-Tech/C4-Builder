// Коммит и пуш файла журнала ревью со страницы `site -w` (change site-review-approve-push): кнопки
// Approve row и Push. Ревьюеры часто не работают с git каждый день, поэтому поведение
// консервативное: в коммит идёт только файл журнала (параллельные правки агента в рабочей копии не
// трогаются), конфликт с upstream не разрешается автоматически, пуш — без force.
import { execFile } from 'node:child_process';
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

// Хвост вывода git в ошибке: целиком stderr бывает в сотни строк (хуки), странице хватит конца.
const tail = (r: Pick<Run, 'stdout' | 'stderr'>): string => {
    const text = (r.stderr.trim() || r.stdout.trim()).split('\n').slice(-6).join('\n').trim();
    return text ? `: ${text}` : '';
};

/**
 * git без shell: аргументы не интерпретируются, имя файла с пробелами или `;` безопасно.
 * `GIT_TERMINAL_PROMPT=0` — пуш по https без сохранённых учётных данных падает сразу, а не ждёт
 * ввода пароля в терминале сервера; `LC_ALL=C` — сообщения git в ответе странице на английском.
 */
const git = (cwd: string, args: string[], timeout = TIMEOUT, input?: string): Promise<Run> =>
    new Promise((resolve) => {
        const child = execFile(
            'git',
            args,
            {
                cwd,
                timeout,
                maxBuffer: 4 * 1024 * 1024,
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
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

const must = async (cwd: string, args: string[], what: string, status = 500, timeout = TIMEOUT) => {
    const r = await git(cwd, args, timeout);
    if (r.code !== 0) throw new ReviewGitError(`${what}${tail(r)}`, status);
    return r.stdout.trim();
};

/** Ветка и её upstream: куда пушить и с чем сравнивать. */
export interface Upstream {
    branch: string;
    /** Имя remote upstream'а (`.` — локальная ветка). */
    remote: string;
    /** Ветка в remote, `refs/heads/…` снят. */
    remoteBranch: string;
}

/**
 * Проверка до любых правок файла: репозиторий, текущая ветка (не detached HEAD) и её upstream.
 * Апрув без upstream не должен оставить изменённый журнал, поэтому ошибка — до записи ячеек.
 */
export const preflight = async (cwd: string): Promise<Upstream> => {
    await must(cwd, ['rev-parse', '--show-toplevel'], 'the project is not inside a git repository', 409);
    const head = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (head.code !== 0)
        throw new ReviewGitError('HEAD is detached — check out a branch to commit the review log', 409);
    const branch = head.stdout.trim();
    const remote = await git(cwd, ['config', '--get', `branch.${branch}.remote`]);
    const merge = await git(cwd, ['config', '--get', `branch.${branch}.merge`]);
    if (remote.code !== 0 || merge.code !== 0 || !remote.stdout.trim())
        throw new ReviewGitError(
            `branch ${branch} has no upstream — push it once with "git push -u <remote> ${branch}"`,
            409
        );
    return {
        branch,
        remote: remote.stdout.trim(),
        remoteBranch: merge.stdout.trim().replace(/^refs\/heads\//, '')
    };
};

/**
 * Коммит одного файла: `--only` берёт рабочую версию только этого пути и не трогает индекс
 * остальных — уже добавленные агентом правки не уйдут в коммит журнала и не потеряются.
 * Неотслеживаемый журнал сначала добавляется: `--only` знает лишь отслеживаемые пути.
 * Возвращает хэш коммита либо null, если файл не изменён.
 */
export const commitFile = async (cwd: string, file: string, message: string): Promise<string | null> => {
    const rel = path.relative(cwd, file);
    const status = await must(cwd, ['status', '--porcelain', '--', rel], 'git status failed');
    if (!status) return null;
    if (status.startsWith('??')) await must(cwd, ['add', '--', rel], `could not add ${rel}`);
    await must(
        cwd,
        ['commit', '--only', '-m', message, '--', rel],
        `could not commit ${rel}`,
        500,
        COMMIT_TIMEOUT
    );
    return must(cwd, ['rev-parse', '--short', 'HEAD'], 'git rev-parse failed');
};

const ahead = async (cwd: string): Promise<number> =>
    Number(await must(cwd, ['rev-list', '--count', '@{upstream}..HEAD'], 'git rev-list failed')) || 0;

/**
 * Синхронизация с upstream и пуш. Rebase — только если upstream ушёл вперёд: autostash на каждом
 * пуше без нужды трогал бы правки рабочей копии. Конфликт — `rebase --abort` (он же возвращает
 * autostash), коммит журнала остаётся локальным. Пуш — явным `HEAD:<ветка>` в remote upstream'а,
 * чтобы не зависеть от `push.default` пользователя; без force. Возвращает, был ли пуш.
 */
export const syncAndPush = async (cwd: string, up: Upstream): Promise<boolean> => {
    // Нечего отдавать — и fetch не нужен: в HEAD нет коммитов, которых нет в upstream.
    if (!(await ahead(cwd))) return false;
    if (up.remote !== '.')
        await must(
            cwd,
            ['fetch', '--quiet', up.remote],
            `could not fetch ${up.remote} — the commit stays local, press Push again later`,
            502,
            NETWORK_TIMEOUT
        );
    const behind = await git(cwd, ['merge-base', '--is-ancestor', '@{upstream}', 'HEAD']);
    if (behind.code === 1) {
        // Autostash возвращает правки рабочей копии, но не индекс: добавленное агентом в индекс
        // стало бы неиндексированным. Индекс сохраняем патчем и накладываем обратно после rebase
        // или его отмены; не наложился — содержимое всё равно в рабочей копии.
        const staged = await git(cwd, ['diff', '--cached', '--binary']);
        const restoreIndex = async (): Promise<void> => {
            if (staged.code === 0 && staged.stdout)
                await git(cwd, ['apply', '--cached'], TIMEOUT, staged.stdout);
        };
        const rebase = await git(cwd, ['rebase', '--autostash', '@{upstream}'], COMMIT_TIMEOUT);
        if (rebase.code === 0) await restoreIndex();
        else {
            const abort = await git(cwd, ['rebase', '--abort']);
            await restoreIndex();
            throw new ReviewGitError(
                `the review log conflicts with changes in ${up.remote}/${up.remoteBranch} — run git pull and resolve the conflict by hand; the commit stays local${tail(rebase)}${abort.code === 0 ? '' : ` (rebase --abort failed${tail(abort)})`}`,
                409
            );
        }
    } else if (behind.code !== 0) throw new ReviewGitError(`git merge-base failed${tail(behind)}`, 500);
    if (!(await ahead(cwd))) return false;
    await must(
        cwd,
        ['push', up.remote, `HEAD:${up.remoteBranch}`],
        `push to ${up.remote}/${up.remoteBranch} was rejected — the commit stays local, press Push again to retry`,
        502,
        NETWORK_TIMEOUT
    );
    return true;
};

/** Подстановки `{change}`, `{action}`, `{author}`, `{file}` в шаблон сообщения коммита. */
export const commitMessage = (template: string, vars: Record<string, string>): string =>
    template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));

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

/** Проверка git → правка → коммит только журнала → синхронизация с upstream → пуш. */
export const publishFile = async ({ cwd, file, message, edit }: PublishInput): Promise<PublishResult> => {
    const up = await preflight(cwd);
    edit?.();
    const commit = await commitFile(cwd, file, message);
    const pushed = await syncAndPush(cwd, up);
    // Rebase переписывает хэш: в ответе — тот коммит, что теперь в ветке.
    const head = commit && (await must(cwd, ['rev-parse', '--short', 'HEAD'], 'git rev-parse failed'));
    return { commit: head || null, pushed };
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
