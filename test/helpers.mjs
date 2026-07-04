import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.join(__dirname, '..');
const TEMPLATE_SRC = path.join(REPO_ROOT, 'template', 'src');
const FIXTURE_CONFIG = path.join(__dirname, 'fixture.c4builder.json');

export const GOLDEN_DIR = path.join(__dirname, 'golden');
const GOLDEN_MANIFEST = path.join(GOLDEN_DIR, 'manifest.json');
const GOLDEN_TREE = path.join(GOLDEN_DIR, 'tree');

export const TMP_ROOT = path.join(__dirname, '.tmp');
export const ACTUAL_DIR = path.join(TMP_ROOT, 'actual');

// Расширение '' покрывает файлы без расширения (.nojekyll)
const TEXT_EXTENSIONS = new Set(['.md', '.svg', '.html', '.css', '.js', '.json', '.iuml', '.puml', '.txt', '']);

const isText = (rel) => TEXT_EXTENSIONS.has(path.posix.extname(rel).toLowerCase());

// Диффуемые файлы хранятся в golden/tree полным текстом; vendor-копии docsify
// (1.8 МБ, прямая копия vendor/docsify) — только sha256 в манифесте.
export const isDiffable = (rel) => isText(rel) && !rel.startsWith('vendor/');

// Неинтерактивный эквивалент `c4builder new`: копия template/src + готовый .c4builder
export const createFixture = () => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'fixture-'));
    fs.cpSync(TEMPLATE_SRC, path.join(dir, 'src'), { recursive: true });
    fs.copyFileSync(FIXTURE_CONFIG, path.join(dir, '.c4builder'));
    return dir;
};

export const runBuild = (dir) => {
    const res = spawnSync(process.execPath, [path.join(REPO_ROOT, 'index.js')], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 240_000
    });
    if (res.status !== 0) {
        throw new Error(
            `сборка c4builder упала (exit=${res.status})\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`
        );
    }
};

// Нормализация недетерминизма: XML-комментарии в SVG (версия PlantUML и пр.), CRLF -> LF
const normalize = (rel, buf) => {
    if (!isText(rel)) return buf;
    let text = buf.toString('utf8').replace(/\r\n/g, '\n');
    if (rel.endsWith('.svg')) text = text.replace(/<!--[\s\S]*?-->/g, '');
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
            sha: crypto.createHash('sha256').update(buf).digest('hex'),
            get text() {
                return buf.toString('utf8');
            }
        };
    }
    return tree;
};

export const goldenExists = () => fs.existsSync(GOLDEN_MANIFEST);

export const readGoldenTreeFile = (rel) => fs.readFileSync(path.join(GOLDEN_TREE, rel), 'utf8');

export const compareWithGolden = (tree) => {
    const manifest = JSON.parse(fs.readFileSync(GOLDEN_MANIFEST, 'utf8')).files;
    return {
        missing: Object.keys(manifest).filter((rel) => !(rel in tree)),
        extra: Object.keys(tree).filter((rel) => !(rel in manifest)),
        changed: Object.keys(tree).filter((rel) => rel in manifest && tree[rel].sha !== manifest[rel])
    };
};

export const updateGolden = (tree) => {
    fs.rmSync(GOLDEN_DIR, { recursive: true, force: true });
    fs.mkdirSync(GOLDEN_TREE, { recursive: true });
    const files = {};
    for (const [rel, file] of Object.entries(tree)) {
        files[rel] = file.sha;
        if (isDiffable(rel)) {
            const target = path.join(GOLDEN_TREE, rel);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, file.buf);
        }
    }
    fs.writeFileSync(GOLDEN_MANIFEST, JSON.stringify({ files }, null, 2) + '\n');
};

// Нормализованная копия фактического выхода — для отладки и как CI-артефакт,
// из которого регенерируется эталон (см. test/README.md)
export const writeActualTree = (tree) => {
    fs.rmSync(ACTUAL_DIR, { recursive: true, force: true });
    for (const [rel, file] of Object.entries(tree)) {
        const target = path.join(ACTUAL_DIR, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.buf);
    }
};

// Кириллица в SVG уезжает числовыми XML-сущностями (&#1050; = «К») — декодируем перед проверками
export const decodeXmlEntities = (text) =>
    text.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
