import fs from 'node:fs';
import path from 'node:path';

import type { BuildOptions } from '../../config/options.ts';
import { VENDOR_DIR } from '../../util/paths.ts';
import { encodeURIPath } from '../../util/utils.ts';
import type { Redirects } from './tree.ts';
import type { LoadedPlugin } from './types.ts';

// Вставка тегов в готовый HTML: стили — перед последним `</head>`, скрипты — перед
// последним `</body>` (регистронезависимо), headScripts — перед первым `<script>` (раньше
// скриптов шаблона), а без него — перед `</head>`; тега нет — в конец файла (браузер исполнит
// и так). Пост-обработка не зависит от того, чей это шаблон (docsifyTemplate пользователя
// править не требуется). Экспортируется для юнит-теста.
export const injectHtml = (
    html: string,
    { styles, scripts, headScripts = [] }: { styles: string[]; scripts: string[]; headScripts?: string[] }
): string => {
    const before = (doc: string, closing: RegExp, block: string): string => {
        if (!block) return doc;
        const m = [...doc.matchAll(closing)].pop();
        return m?.index === undefined
            ? `${doc}\n${block}`
            : `${doc.slice(0, m.index)}${block}\n${doc.slice(m.index)}`;
    };
    const tags = (files: string[]): string => files.map((s) => `<script src="${s}"></script>`).join('\n');
    const styleTags = styles.map((s) => `<link rel="stylesheet" href="${s}">`).join('\n');
    let doc = before(before(html, /<\/head>/gi, styleTags), /<\/body>/gi, tags(scripts));
    if (headScripts.length) {
        const first = doc.search(/<script\b/i);
        // Тег на своей строке с отступом соседнего `<script>` — если тот начинает строку.
        const lineStart = doc.lastIndexOf('\n', first - 1) + 1;
        const indent = /^[ \t]*$/.test(doc.slice(lineStart, first)) ? doc.slice(lineStart, first) : '';
        doc =
            first === -1
                ? before(doc, /<\/head>/gi, tags(headScripts))
                : `${doc.slice(0, first)}${tags(headScripts)}\n${indent}${doc.slice(first)}`;
    }
    return doc;
};

// Ассеты сайта от самого ядра (не плагинов): уже лежат в `dist/vendor/` — туда целиком
// копируется vendor/docsify (compose/markdown), поэтому их только подключают, не копируют.
// Сворачивание sidebar — пост-обработкой, а не строкой шаблона, чтобы работало и с
// пользовательским docsifyTemplate (включая копии старого встроенного шаблона). Страховка
// localStorage — раньше всех скриптов: вендорный плагин без неё падает при заблокированном
// хранилище, и на мобильном в свёрнутом sidebar остаётся только корень.
const coreSiteAssets = (
    options: BuildOptions
): { styles: string[]; scripts: string[]; headScripts: string[] } =>
    options.SIDEBAR_COLLAPSE
        ? {
              styles: ['vendor/sidebar-collapse.css'],
              scripts: ['vendor/docsify-sidebar-collapse.min.js'],
              headScripts: ['vendor/c4builder-storage-guard.js']
          }
        : { styles: [], scripts: [], headScripts: [] };

/**
 * Подключает в `dist/index.html` ассеты сайта: ядра (сворачивание sidebar при
 * `sidebarCollapse`) и плагинов — последние копируются в `dist/vendor/plugins/<name>/`.
 * Зовётся после generateWebMD (index.html уже записан).
 */
export const injectSiteAssets = async (plugins: LoadedPlugin[], options: BuildOptions): Promise<void> => {
    const indexPath = path.join(options.DIST_FOLDER, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    // Файл с тем же именем уже подключён шаблоном (дефолтный шаблон сам грузит
    // vendor/swagger-ui-bundle.js; шаблон команды мог подключать сворачивание руками) —
    // второй раз не копируем и не подключаем.
    const linked = (file: string): boolean =>
        new RegExp(
            `(?:src|href)=["'][^"']*\\b${path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`
        ).test(html);
    const core = coreSiteAssets(options);
    const styles: string[] = core.styles.filter((f) => !linked(f));
    const scripts: string[] = core.scripts.filter((f) => !linked(f));
    const headScripts: string[] = core.headScripts.filter((f) => !linked(f));
    // Скрипты c4builder (`c4builder-*.js`) общая копия vendor/docsify пропускает — кладём сами,
    // даже если шаблон подключил их руками: иначе тег есть, а файла в dist нет.
    for (const file of core.headScripts) {
        fs.mkdirSync(path.join(options.DIST_FOLDER, 'vendor'), { recursive: true });
        fs.copyFileSync(
            path.join(VENDOR_DIR, 'docsify', path.basename(file)),
            path.join(options.DIST_FOLDER, 'vendor', path.basename(file))
        );
    }
    for (const { plugin } of plugins) {
        if (!plugin.assets) continue;
        const rel = path.posix.join('vendor', 'plugins', plugin.name);
        const destDir = path.join(options.DIST_FOLDER, 'vendor', 'plugins', plugin.name);
        const copy = (files: string[] | undefined, out: string[]): void => {
            for (const file of files ?? []) {
                if (linked(file)) continue;
                fs.mkdirSync(destDir, { recursive: true });
                fs.copyFileSync(file, path.join(destDir, path.basename(file)));
                out.push(encodeURIPath(path.posix.join(rel, path.basename(file))));
            }
        };
        copy(plugin.assets.styles, styles);
        copy(plugin.assets.scripts, scripts);
    }
    if (!styles.length && !scripts.length && !headScripts.length) return;
    fs.writeFileSync(indexPath, injectHtml(html, { styles, scripts, headScripts }));
};

// Скрипт переадресаций (change site-agent-review): вендорный файл копируется в `dist/vendor/` и
// подключается в index.html только при непустой карте — сайт без переадресаций прежний.
// Отдельно от injectSiteAssets: карта переадресаций известна только после скана.
const REDIRECTS_SCRIPT = 'c4builder-redirects.js';

/** Подключает скрипт переадресаций к `dist/index.html`. Зовётся после injectSiteAssets. */
export const injectRedirects = (options: BuildOptions, redirects: Redirects): void => {
    if (!redirects.size) return;
    const vendorDist = path.join(options.DIST_FOLDER, 'vendor');
    fs.mkdirSync(vendorDist, { recursive: true });
    fs.copyFileSync(
        path.join(VENDOR_DIR, 'docsify', REDIRECTS_SCRIPT),
        path.join(vendorDist, REDIRECTS_SCRIPT)
    );
    const indexPath = path.join(options.DIST_FOLDER, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    fs.writeFileSync(
        indexPath,
        injectHtml(html, { styles: [], scripts: [path.posix.join('vendor', REDIRECTS_SCRIPT)] })
    );
};
