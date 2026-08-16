import fs from 'node:fs';
import path from 'node:path';

import type { BuildOptions } from '../../config/options.ts';
import { encodeURIPath } from '../../util/utils.ts';
import type { LoadedPlugin } from './types.ts';

// Вставка тегов в готовый HTML: стили — перед последним `</head>`, скрипты — перед
// последним `</body>` (регистронезависимо); тега нет — в конец файла (браузер исполнит
// и так). Пост-обработка не зависит от того, чей это шаблон (docsifyTemplate пользователя
// править не требуется). Экспортируется для юнит-теста.
export const injectHtml = (
    html: string,
    { styles, scripts }: { styles: string[]; scripts: string[] }
): string => {
    const before = (doc: string, closing: RegExp, block: string): string => {
        if (!block) return doc;
        const m = [...doc.matchAll(closing)].pop();
        return m?.index === undefined
            ? `${doc}\n${block}`
            : `${doc.slice(0, m.index)}${block}\n${doc.slice(m.index)}`;
    };
    const styleTags = styles.map((s) => `<link rel="stylesheet" href="${s}">`).join('\n');
    const scriptTags = scripts.map((s) => `<script src="${s}"></script>`).join('\n');
    return before(before(html, /<\/head>/gi, styleTags), /<\/body>/gi, scriptTags);
};

/**
 * Копирует ассеты плагинов в `dist/vendor/plugins/<name>/` и подключает их в
 * `dist/index.html`. Зовётся после generateWebMD (index.html уже записан).
 */
export const injectPluginAssets = async (plugins: LoadedPlugin[], options: BuildOptions): Promise<void> => {
    const indexPath = path.join(options.DIST_FOLDER, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    // Файл с тем же именем уже подключён шаблоном (дефолтный шаблон сам грузит
    // vendor/swagger-ui-bundle.js) — второй раз не копируем и не подключаем.
    const linked = (file: string): boolean =>
        new RegExp(
            `(?:src|href)=["'][^"']*\\b${path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`
        ).test(html);
    const styles: string[] = [];
    const scripts: string[] = [];
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
    if (!styles.length && !scripts.length) return;
    fs.writeFileSync(indexPath, injectHtml(html, { styles, scripts }));
};
