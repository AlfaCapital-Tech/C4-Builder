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
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

import { httpGetStream, httpGetJson } from '../../util/http.ts';

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

// Версия схемы кеша JRE: инкрементируется при смене раскладки каталога или формата
// маркера. Внешние кеши (ключ actions/cache в .github/workflows/ci.yml) включают её,
// иначе кеш, снятый старой схемой, восстанавливался бы вечно: cachedJava признал бы
// его невалидным, а actions/cache при попадании в ключ не пересохраняет каталог.
const JRE_CACHE_SCHEMA = 1;

// Маркер завершённости распаковки: кладётся ПОСЛЕДНИМ в staging и едет в кеш вместе
// с ним. cachedJava доверяет кешу только при его наличии — иначе прерванная (Ctrl+C)
// или гоночная распаковка (bin/java уже есть, lib/modules ещё нет) навсегда выдавалась
// бы за валидный JRE. Проверка дешёвая: существование файла, без запуска JVM.
const MARKER_NAME = '.c4builder-jre-ready.json';
const markerPath = (root: string): string => path.join(root, MARKER_NAME);

// Валиден ли распакованный JRE в каталоге root: маркер завершённости той же схемы +
// НАЙДЕННЫЙ и ЗАПУСКАЕМЫЙ bin/java. Запускаемость проверяем так же, как detectSystemJava
// (javaMajor): маркер мог остаться от оборванной мимо него распаковки или частичного
// копирования кеша (битые lib/*), и тогда «валидный» по маркеру бинарь всё равно не
// стартует. Возвращает путь к бинарю или null.
const installedJavaAt = (root: string): string | null => {
    let marker: { schema?: number };
    try {
        marker = JSON.parse(fs.readFileSync(markerPath(root), 'utf-8'));
    } catch {
        return null; // маркера нет или он битый — распаковка не завершилась
    }
    if (marker.schema !== JRE_CACHE_SCHEMA) return null; // кеш старой раскладки
    const bin = findJavaUnder(root);
    if (!bin) return null;
    return javaMajor(bin) !== null ? bin : null;
};

// (2) кеш: валиден при маркере той же схемы И запускаемом bin/java. Битый/неполный
// каталог сносим, чтобы resolveJava ушёл на перекачку, а не залипал на нём (downloadJre
// пишет в свой staging, поэтому невалидный dir — это заведомо остаток, а не чужая
// установка в процессе).
const cachedJava = (): JreResolution | null => {
    const root = jreCacheDir();
    const bin = installedJavaAt(root);
    if (bin) return { path: bin, source: 'cache' };
    if (fs.existsSync(root)) {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            /* не удалось снести — downloadJre всё равно перезапишет каталог */
        }
    }
    return null;
};

// HTTP-запросы (редиректы + таймауты) — в общем util/http. Здесь только User-Agent
// резолвера: Adoptium assets-эндпоинт 307-редиректит на github, приём архива ~50 МБ.
const JRE_UA = { 'User-Agent': 'c4builder-jre-resolver' };

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
    const json = await httpGetJson(url, { headers: JRE_UA });
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
    const res = await httpGetStream(link, { headers: JRE_UA });
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

// Защита от zip-slip: путь записи, разрешённый относительно destDir, обязан
// оставаться ВНУТРИ него (не `../` за пределы). Экспортируется для юнит-теста.
export const isPathInside = (destDir: string, entryName: string): boolean => {
    const root = path.resolve(destDir);
    const dest = path.resolve(root, entryName);
    return dest === root || dest.startsWith(root + path.sep);
};

const extractZip = (archive: string, destDir: string): Promise<void> =>
    new Promise((resolve, reject) => {
        require('yauzl').open(archive, { lazyEntries: true }, (err: Error | null, zip: YauzlZipFile) => {
            if (err) return reject(err);
            zip.on('entry', (entry: YauzlEntry) => {
                // zip-slip: злонамеренная запись `../../evil` вышла бы за destDir. tar-ветка
                // защищена node-tar≥6 по умолчанию, zip (yauzl) — нет, проверяем сами.
                if (!isPathInside(destDir, entry.fileName)) {
                    return reject(
                        new Error(`Небезопасный путь в архиве JRE (выход за каталог): ${entry.fileName}`)
                    );
                }
                // Симлинки пропускаем: вне доверенного Adoptium-архива симлинк мог бы
                // указывать за пределы каталога. Temurin Windows-zip симлинков не содержит.
                const isSymlink = ((entry.externalFileAttributes >>> 16) & 0xffff & 0o170000) === 0o120000;
                if (isSymlink) return zip.readEntry();
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
            JSON.stringify({
                schema: JRE_CACHE_SCHEMA,
                feature: TEMURIN_FEATURE,
                release: meta.release,
                sha256: meta.sha256
            })
        );
        // Установка в общий кеш без межпроцессной блокировки. Не делаем rm(dir)+rename
        // (окно, в котором dir исчезает у параллельной сборки): если к этому моменту в dir
        // уже валидный JRE — другой процесс успел, принимаем его и выбрасываем свой stage.
        // Иначе пытаемся атомарный rename; провал rename (dir возник в гонке / остался
        // старый невалидный каталог) разбираем: валиден теперь → чужой, невалиден → сносим
        // и ставим свой.
        if (!installedJavaAt(dir)) {
            try {
                fs.renameSync(stageDir, dir);
            } catch {
                if (!installedJavaAt(dir)) {
                    fs.rmSync(dir, { recursive: true, force: true });
                    fs.renameSync(stageDir, dir);
                }
            }
        }
    } finally {
        fs.rmSync(tmpArchive, { force: true });
        fs.rmSync(stageDir, { recursive: true, force: true }); // подчистить staging (no-op, если переименован)
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

// Публичный API модуля. jreCacheDir и JRE_CACHE_SCHEMA нужны подкоманде `jre info` —
// из неё CI берёт путь кеша и материал ключа (см. .github/workflows/ci.yml), не
// хардкодя путь и не grep'ая константы из исходников. adoptiumOs/adoptiumArch/
// parseMajor/MAJOR_MIN — module-private.
export { resolveJava, detectSystemJava, cachedJava, TEMURIN_FEATURE, JRE_CACHE_SCHEMA, jreCacheDir };
