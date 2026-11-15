import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { commitMessage, publishFile, ReviewGitError, serialQueue } from './dist.mjs';
import { gitSandbox } from './helpers.mjs';

// Коммит и пуш файла журнала (change site-review-approve-push) на временном репозитории с
// bare-remote: только журнал в коммите, rebase на ушедший вперёд upstream, отмена при конфликте,
// ошибки без upstream, повтор после отклонённого пуша, очередь.
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

    it('upstream ушёл вперёд без конфликта — rebase и push, рабочая копия как была', async () => {
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

    it('конфликт — rebase отменён, рабочая копия как была, коммит локальный, 409', async () => {
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

describe('commitMessage', () => {
    it('подстановки {change}, {action}, {author}, {file}; неизвестные остаются', () => {
        expect(
            commitMessage('review {change}: {action} — {author} ({file}) {x}', {
                change: 'add-push-platform',
                action: 'approved',
                author: 'Иванов Иван',
                file: 'openspec/changes/add-push-platform/review.md'
            })
        ).toBe(
            'review add-push-platform: approved — Иванов Иван (openspec/changes/add-push-platform/review.md) {x}'
        );
    });
});
