import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { httpGetBuffer } from '../../util/http.ts';
import { extractTarGz, extractZip } from '../../util/archive.ts';
import type { SourceSpec } from './types.ts';

// Кэш скачанных архивов на процесс: в watch-режиме повторные сборки не качают заново.
// Ключ — URL; каталог на диске — по sha1(URL) в tmp, чистить не нужно.
const archiveCache = new Map<string, Promise<string>>();
export const clearSourceCache = (): void => archiveCache.clear();

// Формат по магическим байтам, а не по расширению: URL archive-API часто без него
// (`…/archive?format=zip`). zip — `PK\x03\x04`, gzip — `\x1f\x8b`.
const isZipBuffer = (b: Buffer): boolean =>
    b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
const isGzipBuffer = (b: Buffer): boolean => b.length > 1 && b[0] === 0x1f && b[1] === 0x8b;

const downloadArchive = async (url: string, headers: Record<string, string>): Promise<string> => {
    const dir = path.join(
        os.tmpdir(),
        `c4builder-src-${crypto.createHash('sha1').update(url).digest('hex')}`
    );
    // Распаковываем в свой staging и заменяем кэш атомарным rename — параллельная
    // сборка того же URL не увидит полураспакованный каталог.
    const stage = `${dir}.tmp-${process.pid}`;
    const archive = `${stage}.archive`;
    let body: Buffer;
    try {
        body = await httpGetBuffer(url, { headers });
    } catch (e) {
        throw new Error(`архив недоступен: ${(e as Error).message}`);
    }
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(archive, body);
    try {
        if (isZipBuffer(body)) await extractZip(archive, stage);
        else if (isGzipBuffer(body)) await extractTarGz(archive, stage);
        else throw new Error(`неизвестный формат архива ${url} (ожидается zip или tar.gz)`);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.renameSync(stage, dir);
    } finally {
        fs.rmSync(archive, { force: true });
        fs.rmSync(stage, { recursive: true, force: true }); // no-op после rename
    }
    // GitLab/GitHub archive кладут всё в `<repo>-<sha>/` — единственный корневой каталог снимаем.
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.length === 1 && entries[0].isDirectory() ? path.join(dir, entries[0].name) : dir;
};

/**
 * Резолв источника плагина в локальный каталог: `dir` — проверка существования;
 * `archive` — скачивание (с непустыми `headers`), распаковка в tmp-кэш, снятие
 * единственного корневого каталога, затем `subdir`. Ошибки называют путь/URL.
 */
export const resolveSource = async (spec: SourceSpec, cwd: string = process.cwd()): Promise<string> => {
    if (spec.dir !== undefined) {
        const abs = path.resolve(cwd, spec.dir);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory())
            throw new Error(`источник dir не найден: ${abs}`);
        return abs;
    }
    if (spec.archive === undefined) throw new Error('источник должен задавать dir либо archive');
    const url = spec.archive;
    const headers = Object.fromEntries(Object.entries(spec.headers ?? {}).filter(([, v]) => v !== ''));
    let rootPromise = archiveCache.get(url);
    if (!rootPromise) {
        rootPromise = downloadArchive(url, headers);
        archiveCache.set(url, rootPromise);
        rootPromise.catch(() => archiveCache.delete(url)); // неудачу не кэшируем — следующая сборка повторит
    }
    const root = await rootPromise;
    const result = spec.subdir ? path.join(root, spec.subdir) : root;
    if (!fs.existsSync(result) || !fs.statSync(result).isDirectory())
        throw new Error(`в архиве ${url} нет каталога ${spec.subdir ?? '.'} (распаковано в ${root})`);
    return result;
};
