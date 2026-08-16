// Встроенный плагин openapi: набор OpenAPI-спек (локальная папка или архив репозитория
// контрактов) → раздел сайта со страницей swagger-ui на спеку. Полностью офлайн:
// бандл swagger-ui вендорен (подключается веткой executeScript шаблона), CSS — ассетом
// плагина, спеки копируются в dist статикой с сохранением относительных путей ($ref).
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { definePlugin } from '../../core/plugins/types.ts';
import { globFiles } from '../../util/glob.ts';
import { VENDOR_DIR } from '../../util/paths.ts';
import { encodeURIPath } from '../../util/utils.ts';

const optionsSchema = z
    .object({
        mount: z.string().min(1).default('API'),
        dir: z.string().optional(),
        archive: z.string().optional(),
        subdir: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        glob: z.string().default('**/openapi.{yaml,yml,json}')
    })
    .strict()
    .refine((o) => (o.dir === undefined) !== (o.archive === undefined), {
        message: 'нужен ровно один источник: dir либо archive'
    });

type Opts = z.output<typeof optionsSchema>;

// Имя страницы: родительская папка спеки; в корне источника — имя файла без расширения.
const pageName = (rel: string): string => {
    const dir = path.posix.dirname(rel);
    return dir === '.' ? path.posix.basename(rel).replace(/\.[^.]+$/, '') : path.posix.basename(dir);
};

export default definePlugin<Opts>({
    name: 'openapi',
    options: optionsSchema,
    requires: { executeScript: true },
    assets: { styles: [path.join(VENDOR_DIR, 'swagger-ui', 'swagger-ui.css')] },
    watchPaths: (o) => (o.dir ? [o.dir] : []),

    async afterScan(ctx, o) {
        const { mount } = o;
        const root = await ctx.source({
            dir: o.dir,
            archive: o.archive,
            subdir: o.subdir,
            headers: o.headers
        });
        const files = globFiles(root, o.glob);
        if (!files.length)
            throw new Error(`по шаблону "${o.glob}" в ${o.dir ?? o.archive} не найдено ни одной спеки`);
        const names = new Map<string, string>();
        for (const rel of files) {
            const name = pageName(rel);
            const dup = names.get(name);
            if (dup) throw new Error(`две спеки дают одно имя страницы "${name}": ${dup} и ${rel}`);
            names.set(name, rel);
        }
        // Спеки — статикой в dist с сохранением относительных путей ($ref между ними).
        for (const rel of files) {
            const dest = path.join(ctx.options.DIST_FOLDER, mount, '_specs', rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(path.join(root, rel), dest);
        }

        const sorted = [...names.entries()].sort(([a], [b]) => a.localeCompare(b));
        const link = (name: string): string =>
            encodeURIPath(path.posix.join(mount, name, ctx.options.WEB_FILE_NAME || name));
        ctx.addPage({
            path: [mount],
            markdown: sorted.map(([name, rel]) => `- [${name}](${link(name)}) — \`${rel}\``).join('\n')
        });
        for (const [name, rel] of sorted) {
            // Спека грузится swagger-ui по ссылке от корня сайта (SPA: base = index.html);
            // относительные $ref внутри спек резолвятся от её URL — структура сохранена.
            const specUrl = encodeURIPath(path.posix.join(mount, '_specs', rel));
            const domId = `swagger-${name.replace(/[^A-Za-z0-9_-]/g, '_')}`;
            ctx.addPage({
                path: [mount, name],
                markdown: [
                    `<div id="${domId}"></div>`,
                    '<script>',
                    `SwaggerUIBundle({ url: '${specUrl}', dom_id: '#${domId}' });`,
                    '</script>'
                ].join('\n')
            });
        }
    }
});
