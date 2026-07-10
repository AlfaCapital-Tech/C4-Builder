// Резолвер исполняемого файла Java для рендеринга PlantUML.
// Приоритетная цепочка (первый годный источник выигрывает):
//   1) системная java (JAVA_HOME → PATH), мажор ≥ 17;
//   2) ранее скачанный JRE в пользовательском кеше;
//   3) автоскачивание Temurin 21 JRE с публичного Adoptium (sha256 → распаковка).
// Корпоративные/приватные зеркала намеренно не вводятся: единственный сетевой
// источник — публичный api.adoptium.net.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import type { IncomingMessage } from 'node:http';

// Результат резолва Java: путь к бинарю, источник (system/cache/download) и,
// для системной java, распознанная мажорная версия.
interface JreResolution {
    path: string;
    source: string;
    major?: number;
}

// yauzl/tar грузятся лениво (только при распаковке скачанного JRE) — сохраняем это
// синхронным require через createRequire, а не тянем их на импорте модуля.
const require = createRequire(import.meta.url);

const MAJOR_MIN = 17; // минимальная годная мажорная версия системной java
const TEMURIN_FEATURE = 21; // скачиваем ровно Temurin 21 JRE
const JAVA_BIN = process.platform === 'win32' ? 'java.exe' : 'java';

// --- платформа: process.* → параметры Adoptium ---
const adoptiumOs = (): string =>
    (({ win32: 'windows', darwin: 'mac', linux: 'linux' }) as Record<string, string>)[process.platform] ||
    process.platform;

const adoptiumArch = (): string =>
    (({ x64: 'x64', arm64: 'aarch64', ppc64: 'ppc64le', s390x: 's390x' }) as Record<string, string>)[
        process.arch
    ] || process.arch;

// Мажорная версия из вывода `java -version`: `... version "21.0.11"` → 21,
// `... version "1.8.0_302"` → 8 (легаси-схема 1.x). null, если не распознано.
const parseMajor = (versionOutput: string): number | null => {
    const m = String(versionOutput).match(/version "(\d+)(?:\.(\d+))?[^"]*"/);
    if (!m) return null;
    const first = parseInt(m[1], 10);
    return first === 1 && m[2] ? parseInt(m[2], 10) : first;
};

const javaMajor = (javaPath: string): number | null => {
    let res: SpawnSyncReturns<string>;
    try {
        res = spawnSync(javaPath, ['-version'], { encoding: 'utf8' });
    } catch {
        return null;
    }
    if (!res || res.error || res.status !== 0) return null;
    return parseMajor((res.stderr || '') + (res.stdout || '')); // `-version` пишет в stderr
};

const whichOnPath = (bin: string): string | null => {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (!dir) continue;
        const full = path.join(dir, bin);
        try {
            if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
        } catch {
            /* недоступный элемент PATH — пропускаем */
        }
    }
    return null;
};

// (1) системная java: сперва JAVA_HOME, затем PATH; годна при мажоре ≥ MAJOR_MIN.
// Отсутствие/ошибка запуска не прерывает — вернём null (переход к следующему источнику).
const detectSystemJava = (): JreResolution | null => {
    const candidates: string[] = [];
    if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', JAVA_BIN));
    const onPath = whichOnPath(JAVA_BIN);
    if (onPath) candidates.push(onPath);

    const seen = new Set();
    for (const c of candidates) {
        if (seen.has(c)) continue;
        seen.add(c);
        if (!fs.existsSync(c)) continue;
        const major = javaMajor(c);
        if (major !== null && major >= MAJOR_MIN) return { path: c, major, source: 'system' };
    }
    return null;
};

// --- кеш: ~/.cache/c4builder/jre/temurin-21-<os>-<arch>/ (Windows — %LOCALAPPDATA%) ---
const cacheRoot = (): string =>
    process.platform === 'win32'
        ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
        : process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');

const jreCacheDir = (): string =>
    path.join(
        cacheRoot(),
        'c4builder',
        'jre',
        `temurin-${TEMURIN_FEATURE}-${adoptiumOs()}-${adoptiumArch()}`
    );

// Ищем bin/java в корне кеша или на один уровень ниже (архив несёт каталог jdk-*-jre;
// на macOS бинарь лежит в Contents/Home/bin). null → установка невалидна/битая.
const findJavaUnder = (root: string): string | null => {
    if (!fs.existsSync(root)) return null;
    const direct = path.join(root, 'bin', JAVA_BIN);
    if (fs.existsSync(direct)) return direct;
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return null;
    }
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        const sub = path.join(root, e.name);
        for (const rel of [
            ['bin', JAVA_BIN],
            ['Contents', 'Home', 'bin', JAVA_BIN]
        ]) {
            const p = path.join(sub, ...rel);
            if (fs.existsSync(p)) return p;
        }
    }
    return null;
};

// Маркер завершённости распаковки: кладётся ПОСЛЕДНИМ в staging и едет в кеш вместе
// с ним. cachedJava доверяет кешу только при его наличии — иначе прерванная (Ctrl+C)
// или гоночная распаковка (bin/java уже есть, lib/modules ещё нет) навсегда выдавалась
// бы за валидный JRE. Проверка дешёвая: существование файла, без запуска JVM.
const MARKER_NAME = '.c4builder-jre-ready.json';
const markerPath = (root: string): string => path.join(root, MARKER_NAME);

// (2) кеш: валиден только при наличии маркера завершённости И исполняемого bin/java.
const cachedJava = (): JreResolution | null => {
    const root = jreCacheDir();
    if (!fs.existsSync(markerPath(root))) return null;
    const bin = findJavaUnder(root);
    return bin ? { path: bin, source: 'cache' } : null;
};

// --- HTTP с обработкой редиректов (assets-эндпоинт может 307-редиректить на github) ---
// Лимит редиректов гасит петли (A→B→A), таймауты — зависшие сокеты: молча повисший
// коннект/приём не должен подвешивать `jre install`/сборку навсегда. Значения можно
// переопределить env-переменными (в т.ч. для тестов).
const posInt = (v: string | undefined, dflt: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : dflt;
};
const CONNECT_TIMEOUT_MS = posInt(process.env.C4BUILDER_JRE_CONNECT_TIMEOUT_MS, 30_000);
const IDLE_TIMEOUT_MS = posInt(process.env.C4BUILDER_JRE_IDLE_TIMEOUT_MS, 60_000);
const MAX_REDIRECTS = 5;

const httpGet = (url: string, redirectsLeft = MAX_REDIRECTS): Promise<IncomingMessage> =>
    new Promise((resolve, reject) => {
        const req = https.get(
            url,
            { headers: { 'User-Agent': 'c4builder-jre-resolver' }, timeout: CONNECT_TIMEOUT_MS },
            (res) => {
                const statusCode = res.statusCode as number; // ответ всегда со статусом
                const { headers } = res;
                if (statusCode >= 300 && statusCode < 400 && headers.location) {
                    res.resume();
                    if (redirectsLeft <= 0) {
                        return reject(new Error(`Слишком много редиректов (>${MAX_REDIRECTS}) для ${url}`));
                    }
                    const next = new URL(headers.location as string, url).toString();
                    return resolve(httpGet(next, redirectsLeft - 1));
                }
                if (statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${statusCode} для ${url}`));
                }
                // Коннект установлен, заголовки получены → с таймаута коннекта переключаемся
                // на idle-таймаут приёма (архив ~50 МБ тянется дольше): молчащий посреди
                // приёма сокет уронит таймаут, а не подвесит сборку.
                req.setTimeout(IDLE_TIMEOUT_MS);
                resolve(res);
            }
        );
        req.on('timeout', () => req.destroy(new Error(`Таймаут сети (${url})`)));
        req.on('error', reject);
    });

const httpGetJson = async (url: string): Promise<unknown> => {
    const res = await httpGet(url);
    const chunks: Buffer[] = [];
    for await (const c of res) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

// Adoptium assets API отдаёт ссылку и sha256 одним запросом. ВАЖНО: link и checksum
// приходят из ОДНОГО ответа API — sha256 защищает лишь от повреждения при передаче
// (усечённый/битый архив), но НЕ от компрометации самого API/ответа.
const fetchAssetMeta = async (): Promise<{
    link: string;
    sha256: string;
    name: string;
    release: string;
}> => {
    const url =
        `https://api.adoptium.net/v3/assets/latest/${TEMURIN_FEATURE}/hotspot` +
        `?image_type=jre&vendor=eclipse&os=${adoptiumOs()}&architecture=${adoptiumArch()}`;
    const json = await httpGetJson(url);
    const asset = Array.isArray(json) ? json.find((a) => a.binary?.package) : null;
    if (!asset) {
        throw new Error(
            `Adoptium не отдал JRE-сборку под ${adoptiumOs()}/${adoptiumArch()} (Temurin ${TEMURIN_FEATURE})`
        );
    }
    const pkg = asset.binary.package;
    if (!pkg.link) throw new Error('Adoptium не вернул ссылку на архив JRE');
    // Отсутствие checksum — ошибка, а не молчаливый пропуск проверки целостности.
    if (!pkg.checksum) {
        throw new Error(
            `Adoptium не вернул sha256 для ${pkg.name || 'архива JRE'}: ` +
                'отказ принимать архив без проверки целостности'
        );
    }
    return { link: pkg.link, sha256: pkg.checksum, name: pkg.name, release: asset.release_name };
};

const downloadAndVerify = async (link: string, expectedSha: string, destFile: string): Promise<void> => {
    const res = await httpGet(link);
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(destFile);
        res.on('data', (c) => hash.update(c));
        res.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        res.pipe(out);
    });
    const actual = hash.digest('hex').toLowerCase();
    if (!expectedSha) throw new Error('Нет ожидаемого sha256 — проверка целостности архива невозможна');
    if (actual !== expectedSha.toLowerCase()) {
        throw new Error(`sha256 архива не совпал: ожидалось ${expectedSha}, получено ${actual}`);
    }
};

// Минимальный контракт yauzl (внешняя опц. зависимость без @types): только то,
// что реально использует extractZip — без привязки к полному API либы.
interface YauzlEntry {
    fileName: string;
    externalFileAttributes: number;
}
interface YauzlZipFile {
    on(event: 'entry', listener: (entry: YauzlEntry) => void): void;
    on(event: 'end', listener: () => void): void;
    on(event: 'error', listener: (err: Error) => void): void;
    readEntry(): void;
    openReadStream(entry: YauzlEntry, cb: (err: Error | null, stream: NodeJS.ReadableStream) => void): void;
}

const extractZip = (archive: string, destDir: string): Promise<void> =>
    new Promise((resolve, reject) => {
        require('yauzl').open(archive, { lazyEntries: true }, (err: Error | null, zip: YauzlZipFile) => {
            if (err) return reject(err);
            zip.on('entry', (entry: YauzlEntry) => {
                const dest = path.join(destDir, entry.fileName);
                if (entry.fileName.endsWith('/')) {
                    fs.mkdirSync(dest, { recursive: true });
                    return zip.readEntry();
                }
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                zip.openReadStream(entry, (e: Error | null, rs: NodeJS.ReadableStream) => {
                    if (e) return reject(e);
                    const ws = fs.createWriteStream(dest);
                    ws.on('error', reject);
                    ws.on('finish', () => {
                        const mode = (entry.externalFileAttributes >>> 16) & 0o777;
                        if (mode) {
                            try {
                                fs.chmodSync(dest, mode);
                            } catch {
                                /* права не критичны на windows */
                            }
                        }
                        zip.readEntry();
                    });
                    rs.pipe(ws);
                });
            });
            zip.on('end', resolve);
            zip.on('error', reject);
            zip.readEntry();
        });
    });

const extractArchive = (archive: string, destDir: string, isZip: boolean): Promise<void> =>
    isZip ? extractZip(archive, destDir) : require('tar').x({ file: archive, cwd: destDir });

// (3) скачивание: assets API → sha256 (до распаковки) → распаковка в staging →
// атомарная замена кеша. Распаковываем НЕ в финальный каталог, а в свой staging
// (<dir>.tmp-<pid>, уникальный на процесс → параллельные сборки не топчут друг друга),
// кладём маркер и лишь затем атомарным rename заменяем кеш. Прерывание (Ctrl+C) или
// гонка не оставят финальный каталог полураспакованным.
const downloadJre = async ({ log }: { log?: (msg: string) => void } = {}): Promise<JreResolution> => {
    const meta = await fetchAssetMeta();
    const dir = jreCacheDir();
    const isZip = adoptiumOs() === 'windows';
    const parent = path.dirname(dir);
    fs.mkdirSync(parent, { recursive: true });
    const tmpArchive = path.join(parent, `.download-${process.pid}${isZip ? '.zip' : '.tar.gz'}`);
    const stageDir = `${dir}.tmp-${process.pid}`;
    try {
        if (log) log(`Скачивание Temurin ${TEMURIN_FEATURE} JRE (${meta.release || meta.name})…`);
        await downloadAndVerify(meta.link, meta.sha256, tmpArchive);
        fs.rmSync(stageDir, { recursive: true, force: true });
        fs.mkdirSync(stageDir, { recursive: true });
        await extractArchive(tmpArchive, stageDir, isZip);
        if (!findJavaUnder(stageDir)) {
            throw new Error('JRE распакован, но исполняемый bin/java не найден');
        }
        fs.writeFileSync(
            markerPath(stageDir),
            JSON.stringify({ feature: TEMURIN_FEATURE, release: meta.release, sha256: meta.sha256 })
        );
        fs.rmSync(dir, { recursive: true, force: true }); // окно rm→rename минимально, rename атомарен
        fs.renameSync(stageDir, dir);
    } finally {
        fs.rmSync(tmpArchive, { force: true });
        fs.rmSync(stageDir, { recursive: true, force: true }); // подчистить staging при ошибке
    }
    const bin = findJavaUnder(dir);
    if (!bin) throw new Error('JRE распакован, но исполняемый bin/java не найден');
    return { path: bin, source: 'download' };
};

const failureMessage = (cause?: { message?: string }): string =>
    [
        'Не удалось получить Java для рендеринга PlantUML-диаграмм.',
        'Ни системная java (17+), ни кеш, ни скачивание с Adoptium не сработали. Сделайте одно из двух:',
        '  • установите JRE 17+ (например, Eclipse Temurin) — java на PATH или задайте JAVA_HOME;',
        '  • выполните `c4builder jre install`, чтобы загрузить JRE в локальный кеш.',
        cause?.message ? `Причина: ${cause.message}` : ''
    ]
        .filter(Boolean)
        .join('\n');

// Мемо результата резолва на процесс: watch-режим не платит скан PATH + spawnSync
// `java -version` (~50-300 мс) на каждый ребилд. Кешируем сам промис (как d2Promise
// в d2renderer.ts). force обходит кеш (для `jre install --force`), но успешный резолв —
// в т.ч. после force — его обновляет; провал не кешируем.
let resolvePromise: Promise<JreResolution> | null = null;

// Резолв по цепочке. { force } пропускает систему и кеш (форс-скачивание для
// `jre install --force`). Возвращает { path, source }.
const resolveJava = async ({
    force = false,
    log
}: {
    force?: boolean;
    log?: (msg: string) => void;
} = {}): Promise<JreResolution> => {
    if (!force && resolvePromise) return resolvePromise;
    const run = (async (): Promise<JreResolution> => {
        if (!force) {
            const sys = detectSystemJava();
            if (sys) return sys;
            const cached = cachedJava();
            if (cached) return cached;
        }
        try {
            return await downloadJre({ log });
        } catch (e) {
            throw new Error(failureMessage(e as Error));
        }
    })();
    resolvePromise = run;
    try {
        return await run;
    } catch (e) {
        if (resolvePromise === run) resolvePromise = null; // провал не кешируем — даём повторить
        throw e;
    }
};

// Публичный API модуля. jreCacheDir/adoptiumOs/adoptiumArch/parseMajor/MAJOR_MIN —
// module-private (снаружи не используются; CI хардкодит путь кеша и суффикс ключа).
export { resolveJava, detectSystemJava, cachedJava, TEMURIN_FEATURE };
