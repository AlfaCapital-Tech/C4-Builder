import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acquireBuildLock, BuildLockHeldError } from './dist.mjs';

// Межпроцессный лок сборки (util/lock.ts): конкурентные запуски в одном каталоге
// не должны молча топтать dist_bk и RMW-запись .c4builder.cache.
describe('lock: advisory-лок сборки', () => {
    let dir;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4b-lock-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const lockPath = () => path.join(dir, '.c4builder.lock');

    it('захват создаёт лок-файл, release снимает его', () => {
        const release = acquireBuildLock(lockPath());
        expect(fs.existsSync(lockPath())).toBe(true);
        release();
        expect(fs.existsSync(lockPath())).toBe(false);
    });

    it('повторный захват при живом владельце — BuildLockHeldError с pid', () => {
        acquireBuildLock(lockPath()); // держим: владелец — наш живой процесс
        expect(() => acquireBuildLock(lockPath())).toThrow(BuildLockHeldError);
        expect(() => acquireBuildLock(lockPath())).toThrow(String(process.pid));
    });

    it('протухший лок мёртвого процесса снимается и захватывается', () => {
        // pid за пределами pid_max — заведомо не живой процесс
        fs.writeFileSync(lockPath(), JSON.stringify({ pid: 2 ** 30, at: Date.now() }));
        const release = acquireBuildLock(lockPath());
        expect(fs.existsSync(lockPath())).toBe(true);
        release();
    });

    it('нечитаемый лок трактуется как протухший', () => {
        fs.writeFileSync(lockPath(), 'мусор — не JSON');
        const release = acquireBuildLock(lockPath());
        release();
        expect(fs.existsSync(lockPath())).toBe(false);
    });

    it('лок живого владельца, но старше часа — считается протухшим (переиспользованный pid)', () => {
        fs.writeFileSync(
            lockPath(),
            JSON.stringify({ pid: process.pid, at: Date.now() - 2 * 60 * 60 * 1000 })
        );
        const release = acquireBuildLock(lockPath());
        release();
    });
});
