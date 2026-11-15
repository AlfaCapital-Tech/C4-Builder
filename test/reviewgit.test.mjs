import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { publishFile, pushPending, ReviewGitError, reviewPending, serialQueue, sshEnv } from './dist.mjs';
import { gitSandbox } from './helpers.mjs';

// Коммит и пуш файла журнала (change site-review-approve-push) на временном репозитории с
// bare-remote: только журнал в коммите, перенос на ушедший вперёд upstream, отказ при конфликте,
// отказы preflight, откат правки, повтор после отклонённого пуша, очередь.
const boxes = [];
afterAll(() => {
    for (const b of boxes) fs.rmSync(b.base, { recursive: true, force: true });
});

const LOG = '# Review\n\n## Remarks\n\n| # | Remark |\n|---|---|\n';
const sandbox = () => {
    const box = gitSandbox('reviewgit-');
    boxes.push(box);
    // git-модуль наследует окружение процесса: подменённый глобальный конфиг — и для него.
    Object.assign(process.env, box.env);
    box.init((dir) => {
        fs.mkdirSync(path.join(dir, 'change'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'change', 'review.md'), LOG);
        fs.writeFileSync(path.join(dir, 'change', 'design.md'), '# Design\n');
        fs.writeFileSync(path.join(dir, 'change', 'tasks.md'), '# Tasks\n');
    });
    const file = path.join(box.work, 'change', 'review.md');
    const append = (line) => fs.appendFileSync(file, `${line}\n`);
    const publish = (extra = {}) =>
        publishFile({ cwd: box.work, file, message: 'review change: comments', ...extra });
    return { ...box, file, append, publish };
};

// Посторонние правки рабочей копии: в индексе и нет.
const dirty = (box) => {
    fs.appendFileSync(path.join(box.work, 'change', 'design.md'), 'staged\n');
    box.git(box.work, 'add', 'change/design.md');
    fs.appendFileSync(path.join(box.work, 'change', 'tasks.md'), 'unstaged\n');
};
const expectDirty = (box) => {
    expect(box.git(box.work, 'diff', '--cached', '--name-only')).toBe('change/design.md');
    expect(box.git(box.work, 'diff', '--name-only')).toBe('change/tasks.md');
    expect(fs.readFileSync(path.join(box.work, 'change', 'tasks.md'), 'utf8')).toBe('# Tasks\nunstaged\n');
};

describe('publishFile', () => {
    it('коммит только журнала: правки в индексе и вне его не попадают в коммит и не теряются', async () => {
        const box = sandbox();
        dirty(box);
        box.append('| 1 | Why? |');
        const r = await box.publish();
        expect(r.commit).toMatch(/^[0-9a-f]{7,}$/);
        expect(r.pushed).toBe(true);
        expect(box.git(box.work, 'show', '--name-only', '--format=', 'HEAD')).toBe('change/review.md');
        expect(box.remoteLog()[0]).toBe('review change: comments');
        expectDirty(box);
    });

    it('upstream ушёл вперёд без конфликта — перенос и push, рабочая копия как была', async () => {
        const box = sandbox();
        fs.writeFileSync(path.join(box.other, 'other.md'), 'colleague\n');
        box.git(box.other, 'add', 'other.md');
        box.git(box.other, 'commit', '-q', '-m', 'colleague');
        box.git(box.other, 'push', '-q');
        dirty(box);
        box.append('| 1 | Why? |');
        const r = await box.publish();
        expect(r.pushed).toBe(true);
        expect(box.remoteLog().slice(0, 2)).toEqual(['review change: comments', 'colleague']);
        expect(box.git(box.work, 'rev-parse', '--short', 'HEAD')).toBe(r.commit);
        expectDirty(box);
    });

    it('конфликт журнала — отказ, рабочая копия как была, коммит локальный, 409', async () => {
        const box = sandbox();
        fs.appendFileSync(path.join(box.other, 'change', 'review.md'), '| 1 | Theirs |\n');
        box.git(box.other, 'commit', '-q', '-am', 'colleague');
        box.git(box.other, 'push', '-q');
        dirty(box);
        box.append('| 1 | Mine |');
        const err = await box.publish().catch((e) => e);
        expect(err).toBeInstanceOf(ReviewGitError);
        expect(err.status).toBe(409);
        expect(err.message).toContain('run git pull and resolve the conflict by hand');
        expect(fs.existsSync(path.join(box.work, '.git', 'rebase-merge'))).toBe(false);
        expect(fs.existsSync(path.join(box.work, '.git', 'rebase-apply'))).toBe(false);
        expect(box.git(box.work, 'log', '-1', '--format=%s')).toBe('review change: comments');
        expect(fs.readFileSync(box.file, 'utf8')).toBe(`${LOG}| 1 | Mine |\n`);
        expect(box.remoteLog()[0]).toBe('colleague');
        expectDirty(box);
        expect(box.git(box.work, 'stash', 'list')).toBe('');
    });

    it('нет upstream или HEAD отсоединён — ошибка до правки файла, коммита нет', async () => {
        const box = sandbox();
        const head = box.git(box.work, 'rev-parse', 'HEAD');
        let edited = false;
        const edit = () => {
            edited = true;
        };
        box.git(box.work, 'checkout', '-q', '-b', 'feature');
        const noUp = await box.publish({ edit }).catch((e) => e);
        expect(noUp.status).toBe(409);
        expect(noUp.message).toBe(
            'branch feature has no upstream — push it once with "git push -u <remote> feature"'
        );
        box.git(box.work, 'checkout', '-q', '--detach');
        const detached = await box.publish({ edit }).catch((e) => e);
        expect(detached.status).toBe(409);
        expect(detached.message).toContain('HEAD is detached');
        expect(edited).toBe(false);
        expect(box.git(box.work, 'rev-parse', 'HEAD')).toBe(head);
    });

    it('нечего коммитить и не впереди — ни коммита, ни пуша', async () => {
        const box = sandbox();
        expect(await box.publish()).toEqual({ commit: null, pushed: false });
        expect(box.remoteLog()).toEqual(['init']);
    });

    it('пуш отклонён — ошибка с выводом git, коммит локальный; повтор пушит без нового коммита', async () => {
        const box = sandbox();
        const hook = path.join(box.remote, 'hooks', 'pre-receive');
        fs.writeFileSync(hook, '#!/bin/sh\necho "protected branch" >&2\nexit 1\n', { mode: 0o755 });
        box.append('| 1 | Why? |');
        const err = await box.publish().catch((e) => e);
        expect(err).toBeInstanceOf(ReviewGitError);
        expect(err.message).toContain('push to origin/main was rejected');
        expect(err.message).toContain('protected branch');
        const local = box.git(box.work, 'rev-parse', 'HEAD');
        expect(box.remoteLog()).toEqual(['init']);
        fs.rmSync(hook);
        expect(await box.publish()).toEqual({ commit: null, pushed: true });
        expect(box.git(box.work, 'rev-parse', 'HEAD')).toBe(local);
        expect(box.remoteLog()).toEqual(['review change: comments', 'init']);
    });

    it('неотслеживаемый журнал добавляется и коммитится', async () => {
        const box = sandbox();
        const file = path.join(box.work, 'change', 'new', 'review.md');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, LOG);
        const r = await publishFile({ cwd: box.work, file, message: 'new log' });
        expect(r.pushed).toBe(true);
        expect(box.git(box.work, 'show', '--name-only', '--format=', 'HEAD')).toBe('change/new/review.md');
    });
});

describe('serialQueue', () => {
    it('два одновременных вызова завершаются оба, без index.lock', async () => {
        const box = sandbox();
        const queue = serialQueue();
        const run = (line) =>
            queue(() => box.publish({ edit: () => box.append(line), message: `review change: ${line}` }));
        const [a, b] = await Promise.all([run('| 1 | A |'), run('| 2 | B |')]);
        expect(a.commit).toBeTruthy();
        expect(b.commit).toBeTruthy();
        expect(box.remoteLog()).toEqual(['review change: | 2 | B |', 'review change: | 1 | A |', 'init']);
    });

    it('ошибка одной операции не рвёт очередь', async () => {
        const queue = serialQueue();
        const failed = queue(() => Promise.reject(new Error('boom')));
        const next = queue(() => Promise.resolve(42));
        await expect(failed).rejects.toThrow('boom');
        expect(await next).toBe(42);
    });
});

// Отказы preflight (code review): пушится только журнал и только в ветку с тем же именем.
describe('preflight: отказы до правки файла', () => {
    // publishFile с правкой-флагом: отказ — до правки, коммита нет.
    const refused = async (box) => {
        const head = box.git(box.work, 'rev-parse', 'HEAD');
        let edited = false;
        const err = await box
            .publish({
                edit: () => {
                    edited = true;
                }
            })
            .catch((e) => e);
        expect(err).toBeInstanceOf(ReviewGitError);
        expect(err.status).toBe(409);
        expect(edited).toBe(false);
        expect(box.git(box.work, 'rev-parse', 'HEAD')).toBe(head);
        return err.message;
    };

    it('upstream — ветка с другим именем: отказ, в неё не пушится', async () => {
        const box = sandbox();
        box.git(box.work, 'checkout', '-q', '-b', 'review-x', '--track', 'origin/main');
        expect(await refused(box)).toContain(
            'branch review-x tracks origin/main, not a branch of the same name'
        );
        expect(box.remoteLog()).toEqual(['init']);
    });

    it('незапушенный коммит другого файла (WIP агента) — отказ', async () => {
        const box = sandbox();
        fs.appendFileSync(path.join(box.work, 'change', 'tasks.md'), 'wip\n');
        box.git(box.work, 'commit', '-q', '-am', 'wip');
        expect(await refused(box)).toContain('has unpushed commits besides the review log');
        expect(box.remoteLog()).toEqual(['init']);
    });

    it('незапушенный merge-коммит — отказ, даже если он трогает только журнал', async () => {
        const box = sandbox();
        box.git(box.work, 'checkout', '-q', '-b', 'side');
        box.append('| 1 | Side |');
        box.git(box.work, 'commit', '-q', '-am', 'side');
        box.git(box.work, 'checkout', '-q', 'main');
        box.git(box.work, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
        expect(await refused(box)).toContain('has unpushed commits besides the review log');
    });

    it('merge в процессе — отказ', async () => {
        const box = sandbox();
        box.git(box.work, 'checkout', '-q', '-b', 'side');
        fs.appendFileSync(path.join(box.work, 'change', 'tasks.md'), 'side\n');
        box.git(box.work, 'commit', '-q', '-am', 'side');
        box.git(box.work, 'checkout', '-q', 'main');
        box.git(box.work, 'merge', '-q', '--no-ff', '--no-commit', 'side');
        expect(await refused(box)).toContain(
            'MERGE_HEAD exists — a merge, rebase or cherry-pick is in progress'
        );
        box.git(box.work, 'merge', '--abort');
    });

    it('upstream-ветки больше нет (удалена в remote, fetch --prune) — отказ', async () => {
        const box = sandbox();
        box.git(box.work, 'update-ref', '-d', 'refs/remotes/origin/main');
        expect(await refused(box)).toBe(
            'upstream origin/main does not exist — push the branch with "git push -u origin main"'
        );
    });
});

describe('перенос на ушедший вперёд upstream', () => {
    // Коллега правит другой файл и пушит: upstream уходит вперёд.
    const colleague = (box, file = 'other.md', text = 'colleague\n') => {
        fs.mkdirSync(path.dirname(path.join(box.other, file)), { recursive: true });
        fs.writeFileSync(path.join(box.other, file), text);
        box.git(box.other, 'add', file);
        box.git(box.other, 'commit', '-q', '-m', 'colleague');
        box.git(box.other, 'push', '-q');
    };

    it('индекс сохраняется как есть: новый файл, правка и большой файл (> 4 МБ) остаются staged', async () => {
        const box = sandbox();
        colleague(box);
        fs.writeFileSync(path.join(box.work, 'new.md'), 'new\n');
        fs.writeFileSync(path.join(box.work, 'big.txt'), 'x'.repeat(5 * 1024 * 1024));
        fs.appendFileSync(path.join(box.work, 'change', 'design.md'), 'staged\n');
        box.git(box.work, 'add', 'new.md', 'big.txt', 'change/design.md');
        fs.appendFileSync(path.join(box.work, 'change', 'design.md'), 'unstaged on top\n');
        box.append('| 1 | Why? |');
        const r = await box.publish();
        expect(r.pushed).toBe(true);
        expect(box.remoteLog().slice(0, 2)).toEqual(['review change: comments', 'colleague']);
        expect(box.git(box.work, 'diff', '--cached', '--name-only').split('\n')).toEqual([
            'big.txt',
            'change/design.md',
            'new.md'
        ]);
        expect(box.git(box.work, 'diff', '--name-only')).toBe('change/design.md');
        expect(box.git(box.work, 'stash', 'list')).toBe('');
        expect(fs.readFileSync(path.join(box.work, 'other.md'), 'utf8')).toBe('colleague\n');
    });

    it('журнал правили оба в разных местах — слияние без конфликта', async () => {
        const box = sandbox();
        const theirs = fs.readFileSync(path.join(box.other, 'change', 'review.md'), 'utf8');
        colleague(box, 'change/review.md', `Intro by colleague\n\n${theirs}`);
        box.append('| 1 | Mine |');
        expect((await box.publish()).pushed).toBe(true);
        const remote = box.git(box.remote, 'show', 'main:change/review.md');
        expect(remote).toContain('Intro by colleague');
        expect(remote).toContain('| 1 | Mine |');
        expect(fs.readFileSync(box.file, 'utf8')).toBe(`${remote}\n`);
    });

    it('локальная правка файла, изменённого в upstream, — отказ, всё как было', async () => {
        const box = sandbox();
        colleague(box, 'change/tasks.md', '# Tasks\ncolleague\n');
        fs.appendFileSync(path.join(box.work, 'change', 'tasks.md'), 'mine\n');
        box.append('| 1 | Why? |');
        const err = await box.publish().catch((e) => e);
        expect(err.status).toBe(409);
        expect(err.message).toContain('local changes overlap with changes in origin/main');
        expect(box.git(box.work, 'log', '-1', '--format=%s')).toBe('review change: comments');
        expect(box.git(box.work, 'rev-list', '--count', 'HEAD')).toBe('2');
        expect(fs.readFileSync(path.join(box.work, 'change', 'tasks.md'), 'utf8')).toBe('# Tasks\nmine\n');
        expect(box.remoteLog()[0]).toBe('colleague');
    });
});

describe('откат и дотолкивание', () => {
    it('коммит не удался (pre-commit hook) — правка файла откатывается', async () => {
        const box = sandbox();
        const hook = path.join(box.work, '.git', 'hooks', 'pre-commit');
        fs.writeFileSync(hook, '#!/bin/sh\necho "lint failed" >&2\nexit 1\n', { mode: 0o755 });
        const err = await box.publish({ edit: () => box.append('| 1 | Why? |') }).catch((e) => e);
        expect(err).toBeInstanceOf(ReviewGitError);
        expect(err.message).toContain('lint failed');
        expect(fs.readFileSync(box.file, 'utf8')).toBe(LOG);
        expect(box.git(box.work, 'status', '--porcelain')).toBe('');
    });

    it('незапушенный коммит журнала: reviewPending видит его, pushPending дотолкает без нового коммита', async () => {
        const box = sandbox();
        const hook = path.join(box.remote, 'hooks', 'pre-receive');
        fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        expect((await reviewPending(box.work, box.file)).unpushed).toBe(0);
        box.append('| 1 | Why? |');
        const err = await box.publish().catch((e) => e);
        expect(err.message).toContain('the commit stays local, press the button again to retry');
        expect(err.message).not.toContain('Push');
        expect(await reviewPending(box.work, box.file)).toEqual({ changed: false, unpushed: 1 });
        fs.rmSync(hook);
        const head = box.git(box.work, 'rev-parse', 'HEAD');
        expect(await pushPending(box.work, box.file)).toBe(true);
        expect(box.git(box.work, 'rev-parse', 'HEAD')).toBe(head);
        expect((await reviewPending(box.work, box.file)).unpushed).toBe(0);
    });
});

// Второй раунд code review: откат только своей записи, untracked при showUntrackedFiles=no,
// stdin закрыт, ssh в batch-режиме, подпись перенесённого коммита.
describe('надёжность git-операций', () => {
    it('коммит упал, а журнал успели поправить (hook дописал строку) — откат не затирает правку', async () => {
        const box = sandbox();
        const hook = path.join(box.work, '.git', 'hooks', 'pre-commit');
        fs.writeFileSync(hook, '#!/bin/sh\necho "| 9 | Concurrent |" >> change/review.md\nexit 1\n', {
            mode: 0o755
        });
        const err = await box.publish({ edit: () => box.append('| 1 | Why? |') }).catch((e) => e);
        expect(err).toBeInstanceOf(ReviewGitError);
        expect(err.message).toContain(
            'the review log changed meanwhile, so the approval edit was not rolled back'
        );
        expect(fs.readFileSync(box.file, 'utf8')).toBe(`${LOG}| 1 | Why? |\n| 9 | Concurrent |\n`);
    });

    it('status.showUntrackedFiles=no — новый журнал всё равно виден и коммитится', async () => {
        const box = sandbox();
        box.git(box.work, 'config', 'status.showUntrackedFiles', 'no');
        const file = path.join(box.work, 'change', 'new', 'review.md');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, LOG);
        expect(await reviewPending(box.work, file)).toEqual({ changed: true, unpushed: 0 });
        const r = await publishFile({ cwd: box.work, file, message: 'new log' });
        expect(r.commit).toBeTruthy();
        expect(box.git(box.work, 'show', '--name-only', '--format=', 'HEAD')).toBe('change/new/review.md');
    });

    it('stdin git закрыт: hook, читающий stdin, получает EOF и не ждёт до таймаута', async () => {
        const box = sandbox();
        const hook = path.join(box.work, '.git', 'hooks', 'pre-commit');
        fs.writeFileSync(hook, '#!/bin/sh\ncat > /dev/null\nexit 0\n', { mode: 0o755 });
        box.append('| 1 | Why? |');
        const started = Date.now();
        expect((await box.publish()).pushed).toBe(true);
        expect(Date.now() - started).toBeLessThan(10_000);
    }, 20_000);

    it('ssh в batch-режиме, если своей команды ssh нет; core.sshCommand и GIT_SSH_COMMAND не подменяются', async () => {
        const plain = sandbox();
        expect(await sshEnv(plain.work)).toEqual({ GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' });
        const own = sandbox();
        own.git(own.work, 'config', 'core.sshCommand', 'ssh -i key');
        expect(await sshEnv(own.work)).toEqual({});
        const envSet = sandbox();
        process.env.GIT_SSH_COMMAND = 'ssh -v';
        try {
            expect(await sshEnv(envSet.work)).toEqual({});
        } finally {
            delete process.env.GIT_SSH_COMMAND;
        }
    });

    it('commit.gpgsign=true — перенесённый на upstream коммит подписан (gpg.program — заглушка)', async () => {
        const box = sandbox();
        // Заглушка gpg: git проверяет строку SIG_CREATED в status-fd и берёт подпись из stdout.
        const fake = path.join(box.base, 'fake-gpg.sh');
        fs.writeFileSync(
            fake,
            "#!/bin/sh\ncat > /dev/null\nprintf '\\n[GNUPG:] SIG_CREATED D 1 8 00 0 FAKE\\n' >&2\nprintf -- '-----BEGIN PGP SIGNATURE-----\\n\\nfake\\n-----END PGP SIGNATURE-----\\n'\n",
            { mode: 0o755 }
        );
        box.git(box.work, 'config', 'gpg.program', fake);
        box.git(box.work, 'config', 'commit.gpgsign', 'true');
        box.git(box.work, 'config', 'user.signingkey', 'TESTKEY');
        fs.writeFileSync(path.join(box.other, 'other.md'), 'colleague\n');
        box.git(box.other, 'add', 'other.md');
        box.git(box.other, 'commit', '-q', '-m', 'colleague');
        box.git(box.other, 'push', '-q');
        box.append('| 1 | Why? |');
        expect((await box.publish()).pushed).toBe(true);
        expect(box.remoteLog().slice(0, 2)).toEqual(['review change: comments', 'colleague']);
        expect(box.git(box.remote, 'cat-file', 'commit', 'main')).toContain(
            'gpgsig -----BEGIN PGP SIGNATURE-----'
        );
    });
});
