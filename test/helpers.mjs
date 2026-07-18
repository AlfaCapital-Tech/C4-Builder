import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cachedJava, resolveJava } from './dist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.join(__dirname, '..');
const TEMPLATE_SRC = path.join(REPO_ROOT, 'template', 'src');

// Матрица вариантов: одни исходники template/src, разные fixture-конфиги.
// default — базовый контракт; links-top/embed-png фиксируют ветки compose-слоя.
export const VARIANTS = ['default', 'links-top', 'embed-png'];
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const fixtureConfig = (variant) => path.join(FIXTURES_DIR, `${variant}.c4builder.json`);

const GOLDEN_ROOT = path.join(__dirname, 'golden');
export const goldenDir = (variant) => path.join(GOLDEN_ROOT, variant);
const goldenManifest = (variant) => path.join(goldenDir(variant), 'manifest.json');
const goldenTree = (variant) => path.join(goldenDir(variant), 'tree');

export const TMP_ROOT = path.join(__dirname, '.tmp');
const ACTUAL_ROOT = path.join(TMP_ROOT, 'actual');
export const actualDir = (variant) => path.join(ACTUAL_ROOT, variant);

// Расширение '' покрывает файлы без расширения (.nojekyll)
const TEXT_EXTENSIONS = new Set([
    '.md',
    '.svg',
    '.html',
    '.css',
    '.js',
    '.json',
    '.iuml',
    '.puml',
    '.txt',
    ''
]);

const isText = (rel) => TEXT_EXTENSIONS.has(path.posix.extname(rel).toLowerCase());

// Диффуемые файлы хранятся в golden/tree полным текстом; vendor-копии docsify
// (1.8 МБ, прямая копия vendor/docsify) — только sha256 в манифесте.
export const isDiffable = (rel) => isText(rel) && !rel.startsWith('vendor/');

// --- пин managed-JVM ---
// Golden-рендер обязан идти на одной managed-JVM (Temurin) локально и на CI, а не
// на произвольной системной java: берём кешированный JRE (при отсутствии — качаем,
// минуя системную java) и подставляем его JAVA_HOME сборке. detectSystemJava в
// продуктовом коде проверяет JAVA_HOME первым, правок jre.js не требуется.
let managedJavaHome;
export const ensureManagedJre = async () => {
    if (managedJavaHome) return managedJavaHome;
    const jre = cachedJava() ?? (await resolveJava({ force: true }));
    // <root>/bin/java → <root> (macOS: <root>/Contents/Home/bin/java → <root>/Contents/Home)
    managedJavaHome = path.dirname(path.dirname(jre.path));
    return managedJavaHome;
};

// Неинтерактивный эквивалент `c4builder new`: копия template/src + готовый .c4builder варианта
export const createFixture = (variant) => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, `fixture-${variant}-`));
    fs.cpSync(TEMPLATE_SRC, path.join(dir, 'src'), { recursive: true });
    fs.copyFileSync(fixtureConfig(variant), path.join(dir, '.c4builder'));
    return dir;
};

// Таймаут одной сборки. Согласован с hookTimeout в vitest.config.mjs: тот покрывает
// сумму (ensureManagedJre + 3×BUILD_TIMEOUT_MS), чтобы внятная ошибка ниже срабатывала
// раньше, чем невнятный «hook timed out» от vitest.
export const BUILD_TIMEOUT_MS = 240_000;

export const runBuild = (dir) => {
    if (!managedJavaHome) throw new Error('ensureManagedJre() не вызван до runBuild — JAVA_HOME не пинован');
    const res = spawnSync(process.execPath, [path.join(REPO_ROOT, 'dist', 'index.js')], {
        cwd: dir,
        encoding: 'utf8',
        timeout: BUILD_TIMEOUT_MS,
        env: { ...process.env, JAVA_HOME: managedJavaHome }
    });
    // При таймауте spawnSync возвращает status=null и заполняет res.error — иначе
    // сообщение «exit=null» скрыло бы факт зависания JVM-рендера.
    if (res.error?.code === 'ETIMEDOUT') {
        throw new Error(
            `сборка c4builder не уложилась в таймаут ${BUILD_TIMEOUT_MS} мс (JVM-рендер завис?)\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`
        );
    }
    if (res.status !== 0) {
        throw new Error(
            `сборка c4builder упала (exit=${res.status}${res.signal ? `, signal=${res.signal}` : ''})\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`
        );
    }
};

// Шрифтозависимые выходы: ditaa рисует текст собственным AWT-движком, который берёт шрифт
// мимо -SdefaultFontName, мимо вендорного sun.java2d.fontpath и мимо fontconfig, поэтому
// растр отличается между дистрибутивами (Ubuntu-CI vs Arch). Пин -SCircledCharacterFontName
// снял эту зависимость у бэджей классов, но на ditaa он не распространяется. Такие файлы
// сверяем на валидность PNG, а не побайтно, иначе golden красный вне CI.
const isFontSensitive = (rel) => path.basename(rel) === 'ditaa.png';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const fontSensitiveSha = (buf) =>
    buf.subarray(0, 8).equals(PNG_MAGIC) && buf.length > 0
        ? 'font-sensitive:png-ok'
        : 'font-sensitive:BROKEN';

// Нормализация недетерминизма: XML-комментарии в SVG (версия PlantUML и пр.), CRLF -> LF,
// а также base64 шрифтозависимой ditaa-картинки, встроенной в md (режим embedDiagram).
const normalize = (rel, buf) => {
    if (!isText(rel)) return buf;
    let text = buf.toString('utf8').replace(/\r\n/g, '\n');
    if (rel.endsWith('.svg')) text = text.replace(/<!--[\s\S]*?-->/g, '');
    if (rel.endsWith('.md'))
        text = text.replace(
            /(!\[ditaa\]\(data:image\/[\w+.-]+;base64,)[A-Za-z0-9+/=]+/g,
            '$1<FONT-SENSITIVE>'
        );
    return Buffer.from(text, 'utf8');
};

// Дерево выходных файлов: relPath (posix, сортирован) -> { buf, sha, text }
export const collectNormalizedTree = (root) => {
    const rels = [];
    const walk = (rel) => {
        for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
            const r = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(r);
            else rels.push(r);
        }
    };
    walk('');
    rels.sort();

    const tree = {};
    for (const rel of rels) {
        const buf = normalize(rel, fs.readFileSync(path.join(root, rel)));
        tree[rel] = {
            buf,
            sha: isFontSensitive(rel)
                ? fontSensitiveSha(buf)
                : crypto.createHash('sha256').update(buf).digest('hex'),
            get text() {
                return buf.toString('utf8');
            }
        };
    }
    return tree;
};

export const goldenExists = (variant) => fs.existsSync(goldenManifest(variant));

export const readGoldenTreeFile = (variant, rel) =>
    fs.readFileSync(path.join(goldenTree(variant), rel), 'utf8');

export const compareWithGolden = (tree, variant) => {
    const manifest = JSON.parse(fs.readFileSync(goldenManifest(variant), 'utf8')).files;
    return {
        missing: Object.keys(manifest).filter((rel) => !(rel in tree)),
        extra: Object.keys(tree).filter((rel) => !(rel in manifest)),
        changed: Object.keys(tree).filter((rel) => rel in manifest && tree[rel].sha !== manifest[rel])
    };
};

export const updateGolden = (tree, variant) => {
    fs.rmSync(goldenDir(variant), { recursive: true, force: true });
    fs.mkdirSync(goldenTree(variant), { recursive: true });
    const files = {};
    for (const [rel, file] of Object.entries(tree)) {
        files[rel] = file.sha;
        if (isDiffable(rel)) {
            const target = path.join(goldenTree(variant), rel);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, file.buf);
        }
    }
    fs.writeFileSync(goldenManifest(variant), `${JSON.stringify({ files }, null, 2)}\n`);
};

// Нормализованная копия фактического выхода — для отладки и как CI-артефакт,
// из которого регенерируется эталон (см. test/README.md)
export const writeActualTree = (tree, variant) => {
    fs.rmSync(actualDir(variant), { recursive: true, force: true });
    for (const [rel, file] of Object.entries(tree)) {
        const target = path.join(actualDir(variant), rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.buf);
    }
};

// Кириллица в SVG уезжает числовыми XML-сущностями (&#1050; = «К») — декодируем перед проверками
export const decodeXmlEntities = (text) =>
    text.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
