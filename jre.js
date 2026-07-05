// Резолвер исполняемого файла Java для рендеринга PlantUML.
// Приоритетная цепочка (первый годный источник выигрывает):
//   1) системная java (JAVA_HOME → PATH), мажор ≥ 17;
//   2) ранее скачанный JRE в пользовательском кеше;
//   3) автоскачивание Temurin 21 JRE с публичного Adoptium (sha256 → распаковка).
// Корпоративные/приватные зеркала намеренно не вводятся: единственный сетевой
// источник — публичный api.adoptium.net.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const MAJOR_MIN = 17; // минимальная годная мажорная версия системной java
const TEMURIN_FEATURE = 21; // скачиваем ровно Temurin 21 JRE
const JAVA_BIN = process.platform === 'win32' ? 'java.exe' : 'java';

// --- платформа: process.* → параметры Adoptium ---
const adoptiumOs = () =>
    ({ win32: 'windows', darwin: 'mac', linux: 'linux' })[process.platform] || process.platform;

const adoptiumArch = () =>
    ({ x64: 'x64', arm64: 'aarch64', ppc64: 'ppc64le', s390x: 's390x' })[process.arch] || process.arch;

// Мажорная версия из вывода `java -version`: `... version "21.0.11"` → 21,
// `... version "1.8.0_302"` → 8 (легаси-схема 1.x). null, если не распознано.
const parseMajor = (versionOutput) => {
    const m = String(versionOutput).match(/version "(\d+)(?:\.(\d+))?[^"]*"/);
    if (!m) return null;
    const first = parseInt(m[1], 10);
    return first === 1 && m[2] ? parseInt(m[2], 10) : first;
};

const javaMajor = (javaPath) => {
    let res;
    try {
        res = spawnSync(javaPath, ['-version'], { encoding: 'utf8' });
    } catch {
        return null;
    }
    if (!res || res.error || res.status !== 0) return null;
    return parseMajor((res.stderr || '') + (res.stdout || '')); // `-version` пишет в stderr
};

const whichOnPath = (bin) => {
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
const detectSystemJava = () => {
    const candidates = [];
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
const cacheRoot = () =>
    process.platform === 'win32'
        ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
        : process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');

const jreCacheDir = () =>
    path.join(
        cacheRoot(),
        'c4builder',
        'jre',
        `temurin-${TEMURIN_FEATURE}-${adoptiumOs()}-${adoptiumArch()}`
    );

// Ищем bin/java в корне кеша или на один уровень ниже (архив несёт каталог jdk-*-jre;
// на macOS бинарь лежит в Contents/Home/bin). null → установка невалидна/битая.
const findJavaUnder = (root) => {
    if (!fs.existsSync(root)) return null;
    const direct = path.join(root, 'bin', JAVA_BIN);
    if (fs.existsSync(direct)) return direct;
    let entries;
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

// (2) кеш: валиден только при наличии исполняемого bin/java.
const cachedJava = () => {
    const bin = findJavaUnder(jreCacheDir());
    return bin ? { path: bin, source: 'cache' } : null;
};

// --- HTTP с обработкой редиректов (assets-эндпоинт может 307-редиректить на github) ---
const httpGet = (url) =>
    new Promise((resolve, reject) => {
        https
            .get(url, { headers: { 'User-Agent': 'c4builder-jre-resolver' } }, (res) => {
                const { statusCode, headers } = res;
                if (statusCode >= 300 && statusCode < 400 && headers.location) {
                    res.resume();
                    return resolve(httpGet(new URL(headers.location, url).toString()));
                }
                if (statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${statusCode} для ${url}`));
                }
                resolve(res);
            })
            .on('error', reject);
    });

const httpGetJson = async (url) => {
    const res = await httpGet(url);
    const chunks = [];
    for await (const c of res) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

// Adoptium assets API отдаёт ссылку и sha256 одним запросом.
const fetchAssetMeta = async () => {
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
    return { link: pkg.link, sha256: pkg.checksum, name: pkg.name, release: asset.release_name };
};

const downloadAndVerify = async (link, expectedSha, destFile) => {
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
    const actual = hash.digest('hex');
    if (expectedSha && actual.toLowerCase() !== expectedSha.toLowerCase()) {
        throw new Error(`sha256 архива не совпал: ожидалось ${expectedSha}, получено ${actual}`);
    }
};

const extractZip = (archive, destDir) =>
    new Promise((resolve, reject) => {
        require('yauzl').open(archive, { lazyEntries: true }, (err, zip) => {
            if (err) return reject(err);
            zip.on('entry', (entry) => {
                const dest = path.join(destDir, entry.fileName);
                if (entry.fileName.endsWith('/')) {
                    fs.mkdirSync(dest, { recursive: true });
                    return zip.readEntry();
                }
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                zip.openReadStream(entry, (e, rs) => {
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

const extractArchive = (archive, destDir, isZip) =>
    isZip ? extractZip(archive, destDir) : require('tar').x({ file: archive, cwd: destDir });

// (3) скачивание: assets API → sha256 (до распаковки) → распаковка в кеш.
// Битую/старую установку затираем целиком перед распаковкой.
const downloadJre = async ({ log } = {}) => {
    const meta = await fetchAssetMeta();
    const dir = jreCacheDir();
    const isZip = adoptiumOs() === 'windows';
    const parent = path.dirname(dir);
    fs.mkdirSync(parent, { recursive: true });
    const tmp = path.join(parent, `.download-${process.pid}${isZip ? '.zip' : '.tar.gz'}`);
    try {
        if (log) log(`Скачивание Temurin ${TEMURIN_FEATURE} JRE (${meta.release || meta.name})…`);
        await downloadAndVerify(meta.link, meta.sha256, tmp);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        await extractArchive(tmp, dir, isZip);
    } finally {
        fs.rmSync(tmp, { force: true });
    }
    const bin = findJavaUnder(dir);
    if (!bin) throw new Error('JRE распакован, но исполняемый bin/java не найден');
    return { path: bin, source: 'download' };
};

const failureMessage = (cause) =>
    [
        'Не удалось получить Java для рендеринга PlantUML-диаграмм.',
        'Ни системная java (17+), ни кеш, ни скачивание с Adoptium не сработали. Сделайте одно из двух:',
        '  • установите JRE 17+ (например, Eclipse Temurin) — java на PATH или задайте JAVA_HOME;',
        '  • выполните `c4builder jre install`, чтобы загрузить JRE в локальный кеш.',
        cause?.message ? `Причина: ${cause.message}` : ''
    ]
        .filter(Boolean)
        .join('\n');

// Резолв по цепочке. { force } пропускает систему и кеш (форс-скачивание для
// `jre install --force`). Возвращает { path, source }.
const resolveJava = async ({ force = false, log } = {}) => {
    if (!force) {
        const sys = detectSystemJava();
        if (sys) return sys;
        const cached = cachedJava();
        if (cached) return cached;
    }
    try {
        return await downloadJre({ log });
    } catch (e) {
        throw new Error(failureMessage(e));
    }
};

module.exports = {
    resolveJava,
    detectSystemJava,
    cachedJava,
    jreCacheDir,
    adoptiumOs,
    adoptiumArch,
    parseMajor,
    MAJOR_MIN,
    TEMURIN_FEATURE
};
