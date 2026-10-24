// Встроенный плагин openapi: набор OpenAPI-спек (локальная папка или архив репозитория
// контрактов) → раздел сайта со страницей swagger-ui на спеку. Полностью офлайн:
// бандл swagger-ui и CSS — вендорные ассеты плагина, спеки копируются в dist статикой
// с сохранением относительных путей ($ref).
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { z } from 'zod';

import { outputDirs } from '../../config/options.ts';
import { redactUrl } from '../../core/plugins/source.ts';
import { definePlugin } from '../../core/plugins/types.ts';
import { isPathInside } from '../../util/archive.ts';
import { VENDOR_DIR } from '../../util/paths.ts';
import { encodeURIPath } from '../../util/utils.ts';

const optionsSchema = z
    .object({
        mount: z.string().min(1).default('API'),
        dir: z.string().min(1).optional(),
        archive: z.string().optional(),
        subdir: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        glob: z.string().default('**/openapi.{yaml,yml,json}'),
        // flat — страница папки названа её именем (адреса существующих сайтов не меняются);
        // tree — путь папки от источника, версии во вложенных папках дают вложенные страницы.
        layout: z.enum(['flat', 'tree']).default('flat')
    })
    .strict()
    .refine((o) => (o.dir === undefined) !== (o.archive === undefined), {
        message: 'exactly one source required: dir or archive'
    });

type Opts = z.output<typeof optionsSchema>;

// Файлы под root по glob: posix-пути, сортировка. Каталоги с точкой (.git) fs.glob не
// обходит сам. Выходные каталоги (skip) отсеиваются по результату, а не в exclude:
// под `**` Node передаёт в exclude лишь имя записи, и вложенный `x/docs` был бы
// неотличим от корневого `docs`.
const findFiles = (root: string, pattern: string, skip: string[]): string[] =>
    fs
        .globSync(pattern, { cwd: root, exclude: (p) => path.basename(p) === 'node_modules' })
        .filter((rel) => !skip.some((d) => isPathInside(d, path.resolve(root, rel))))
        .map((rel) => rel.split(path.sep).join('/'))
        .sort();

const stem = (file: string): string => path.posix.basename(file).replace(/\.[^.]+$/, '');

/** Спека, прошедшая отбор по содержимому: путь от источника и `info.title`, если он есть. */
interface Spec {
    rel: string;
    title?: string;
}

// Отбор по содержимому без YAML-парсера: ключ верхнего уровня всегда стоит в начале строки.
// Заголовок — первая `title:` внутри блока `info:` (отступные строки сразу за ним).
const YAML_SPEC_KEY = /^(openapi|swagger)\s*:/m;
const YAML_INFO_BLOCK = /^info\s*:[ \t]*\n((?:[ \t]+.*(?:\n|$))*)/m;
const YAML_TITLE = /^[ \t]+title\s*:[ \t]*(.+?)[ \t]*$/m;

const readSpec = (file: string, rel: string): Spec | undefined => {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    if (rel.endsWith('.json')) {
        let doc: unknown;
        try {
            doc = JSON.parse(text);
        } catch {
            return undefined;
        }
        if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return undefined;
        const o = doc as Record<string, unknown>;
        if (!('openapi' in o || 'swagger' in o)) return undefined;
        const info = o.info;
        const title =
            typeof info === 'object' &&
            info !== null &&
            typeof (info as Record<string, unknown>).title === 'string'
                ? ((info as Record<string, unknown>).title as string)
                : undefined;
        return { rel, title: title?.trim() || undefined };
    }
    if (!YAML_SPEC_KEY.test(text)) return undefined;
    const block = YAML_INFO_BLOCK.exec(text)?.[1] ?? '';
    const raw = YAML_TITLE.exec(block)?.[1];
    const title = raw?.replace(/^(['"])(.*)\1$/, '$2').trim();
    return { rel, title: title || undefined };
};

// Порядок спек в оглавлении папки: сначала openapi.{yaml,yml,json}, остальные по имени.
const byIndexOrder = (a: Spec, b: Spec): number => {
    const main = (s: Spec) => (stem(s.rel) === 'openapi' ? 0 : 1);
    return main(a) - main(b) || path.posix.basename(a.rel).localeCompare(path.posix.basename(b.rel));
};

export default definePlugin<Opts>({
    name: 'openapi',
    options: optionsSchema,
    requires: { executeScript: true },
    // Бандл объявлен ассетом, а не взят из шаблона docsify: пользовательский docsifyTemplate
    // может его не подключать; при дефолтном шаблоне injectSiteAssets дубль не добавит.
    assets: {
        styles: [path.join(VENDOR_DIR, 'swagger-ui', 'swagger-ui.css')],
        scripts: [path.join(VENDOR_DIR, 'docsify', 'swagger-ui-bundle.js')]
    },
    watchPaths: (o) => (o.dir ? [path.join(o.dir, o.subdir ?? '')] : []),

    async afterScan(ctx, o) {
        const { mount } = o;
        const source = o.dir ?? redactUrl(o.archive ?? '');
        const root = await ctx.source({
            dir: o.dir,
            archive: o.archive,
            subdir: o.subdir,
            headers: o.headers
        });
        // Источник может быть предком выходного каталога (dir: '.') — свои же копии
        // спек прошлой сборки в dist/dist_bk не считаются источником.
        const skip = outputDirs(ctx.options);
        const specs: Spec[] = [];
        for (const rel of findFiles(root, o.glob, skip)) {
            const spec = readSpec(path.join(root, rel), rel);
            // Фрагмент схем, названный openapi.yaml, теряет страницу — об этом нельзя молчать.
            if (!spec)
                console.log(
                    chalk.yellow(
                        `⚠ openapi: ${rel}: not an OpenAPI document (no openapi/swagger key), skipped`
                    )
                );
            else specs.push(spec);
        }
        if (!specs.length) throw new Error(`no specs match "${o.glob}" in ${source}`);

        // Статикой в dist — все yaml/json источника, а не только совпавшие с glob: $ref
        // может вести в общие схемы (components), не являющиеся спеками.
        for (const rel of findFiles(root, '**/*.{yaml,yml,json}', skip)) {
            const dest = path.join(ctx.options.DIST_FOLDER, mount, '_specs', rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(path.join(root, rel), dest);
        }

        // Группы по родительской папке источника.
        const groups = new Map<string, Spec[]>();
        for (const spec of specs) {
            const dir = path.posix.dirname(spec.rel);
            const p = dir === '.' ? '' : dir;
            groups.set(p, [...(groups.get(p) ?? []), spec]);
        }
        const folders = [...groups.keys()].filter((p) => p !== '').sort((a, b) => a.localeCompare(b));
        // Путь страницы папки относительно mount; корень источника — сама сводка раздела.
        const folderPath = (p: string): string[] =>
            o.layout === 'tree' ? p.split('/') : [path.posix.basename(p)];

        // В flat одноимённые папки из разных мест источника дают одну страницу — та же ошибка,
        // что и раньше, но теперь с выходом.
        const byPagePath = new Map<string, string>();
        for (const p of folders) {
            const key = folderPath(p).join('/');
            const dup = byPagePath.get(key);
            if (dup !== undefined)
                throw new Error(
                    `two folders give the same page "${key}": ${groups.get(dup)?.[0].rel} and ${groups.get(p)?.[0].rel} — set layout: "tree" to keep pages nested as the source folders`
                );
            byPagePath.set(key, p);
        }

        // Страницы раздела: path относительно mount; у оглавления папки спеки нет.
        interface Page {
            path: string[];
            spec?: Spec;
            specs: Spec[];
        }
        const pages: Page[] = [];
        const taken = new Map<string, string>();
        const addPage = (page: Page) => {
            const key = page.path.join('/');
            const dup = taken.get(key);
            if (dup !== undefined)
                throw new Error(`two specs give the same page "${key}": ${dup} and ${page.specs[0].rel}`);
            taken.set(key, page.specs[0].rel);
            pages.push(page);
        };
        for (const spec of groups.get('') ?? []) addPage({ path: [stem(spec.rel)], spec, specs: [spec] });
        for (const p of folders) {
            const group = [...(groups.get(p) ?? [])].sort(byIndexOrder);
            const base = folderPath(p);
            if (group.length === 1) addPage({ path: base, spec: group[0], specs: group });
            else {
                addPage({ path: base, specs: group });
                for (const spec of group) addPage({ path: [...base, stem(spec.rel)], spec, specs: [spec] });
            }
        }

        // Порядок страниц — по алфавиту пути: так было до опции layout (боковая панель и
        // сводка), а в tree родитель остаётся раньше вложенной страницы (префикс короче).
        pages.sort((a, b) => a.path.join('/').localeCompare(b.path.join('/')));
        const link = (segs: string[]): string =>
            encodeURIPath(
                path.posix.join(mount, ...segs, ctx.options.WEB_FILE_NAME || segs[segs.length - 1])
            );
        const pageOf = (spec: Spec): Page => pages.find((pg) => pg.spec === spec) as Page;
        ctx.addPage({
            path: [mount],
            markdown: pages
                .filter((pg) => pg.spec)
                .map((pg) => `- [${pg.path.join('/')}](${link(pg.path)}) — \`${pg.spec?.rel}\``)
                .join('\n')
        });
        for (const page of pages) {
            if (!page.spec) {
                // Оглавление папки с несколькими спеками; вложенные папки видны в боковой панели.
                ctx.addPage({
                    path: [mount, ...page.path],
                    markdown: page.specs
                        .map((s) => {
                            const label = path.posix.basename(s.rel);
                            const line = `- [${label}](${link(pageOf(s).path)})`;
                            return s.title ? `${line} — ${s.title}` : line;
                        })
                        .join('\n')
                });
                continue;
            }
            // Спека грузится swagger-ui по ссылке от корня сайта (SPA: base = index.html);
            // относительные $ref внутри спек резолвятся от её URL — структура сохранена.
            // validatorUrl: null — иначе swagger-ui шлёт адрес спеки на validator.swagger.io.
            // dom_id — из пути страницы спеки от mount: он уникален на сайте, в отличие от
            // последнего сегмента (billing/v2 и ledger/v2), и для папки с одной спекой прежний.
            const specUrl = encodeURIPath(path.posix.join(mount, '_specs', page.spec.rel));
            const domId = `swagger-${page.path.join('/').replace(/[^A-Za-z0-9_-]/g, '_')}`;
            ctx.addPage({
                path: [mount, ...page.path],
                markdown: [
                    `<div id="${domId}"></div>`,
                    '<script>',
                    `SwaggerUIBundle({ url: '${specUrl}', dom_id: '#${domId}', validatorUrl: null });`,
                    '</script>'
                ].join('\n')
            });
        }
    }
});
