import fs from 'node:fs';

// Межпроцессный advisory-лок сборки. Два одновременных запуска c4builder в одном
// каталоге (watch + ручная сборка) гоняются за dist/dist_bk и за RMW-записью
// .c4builder.cache (Configstore читает-модифицирует-пишет весь файл целиком) —
// теряются чексуммы, а переименования dist топчут друг друга. Лок-файл создаётся
// атомарно (flag 'wx'), владелец пишет в него свой pid и время захвата.

// Страховка от переиспользованного ОС-ю pid: лок старше часа считается протухшим,
// даже если pid формально жив (легитимная сборка длиннее часа — экзотика).
const STALE_MS = 60 * 60 * 1000;

// EPERM = процесс существует, но сигналить ему нельзя (чужой пользователь) — жив.
const ownerAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
};

// Отдельный класс: watch-режим по нему отличает «занято соседней сборкой»
// (пропустить ребилд с коротким сообщением) от настоящего падения сборки.
export class BuildLockHeldError extends Error {}

// Захват лока: возвращает release-колбэк. Занято живым процессом — BuildLockHeldError.
// Протухший лок (мёртвый владелец / нечитаемый файл / старше STALE_MS) снимается и
// захват повторяется один раз; в гонке двух «снявших» победит один, второй получит
// EEXIST со свежим живым владельцем и honest-ошибку.
export const acquireBuildLock = (lockPath: string): (() => void) => {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }), {
                flag: 'wx'
            });
            return () => {
                fs.rmSync(lockPath, { force: true });
            };
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
            let meta: { pid?: number; at?: number } = {};
            try {
                meta = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
            } catch {
                /* нечитаемый лок = протухший */
            }
            const alive = typeof meta.pid === 'number' && ownerAlive(meta.pid);
            const fresh = typeof meta.at === 'number' && Date.now() - meta.at < STALE_MS;
            if (alive && fresh) {
                throw new BuildLockHeldError(
                    `сборка уже идёт в этом каталоге (pid ${meta.pid}) — дождитесь её завершения ` +
                        `или удалите ${lockPath}, если это остаток упавшего процесса`
                );
            }
            fs.rmSync(lockPath, { force: true });
        }
    }
    throw new BuildLockHeldError(`не удалось захватить лок сборки: ${lockPath}`);
};
