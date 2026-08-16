// Встроенный плагин openspec: локальный OpenSpec-store → раздел сайта (сводка, активные
// change'ы, спеки, архив). Диаграммы артефактов рендерятся локальным движком сборки.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { definePlugin } from '../../core/plugins/types.ts';
import { scanStore, type Store } from './scan.ts';
import {
    renderArchiveIndex,
    renderChange,
    renderChangesIndex,
    renderSpecIndex,
    renderSummary
} from './render.ts';

const optionsSchema = z
    .object({
        dir: z.string().default('openspec'),
        mount: z.string().min(1).default('OpenSpec')
    })
    .strict();

type Opts = z.output<typeof optionsSchema>;

// Файлы change'ов, на которые ссылаются артефакты (картинки и пр.): копируются в
// afterBuild рядом со страницей. Заполняется в afterScan текущей сборки; ключ — mount,
// чтобы два экземпляра плагина (разные store) не мешали друг другу.
const pendingCopies = new Map<string, Array<{ from: string; to: string[] }>>();

export default definePlugin<Opts>({
    name: 'openspec',
    options: optionsSchema,
    watchPaths: (o) => [o.dir],

    afterScan(ctx, o) {
        const storeDir = path.resolve(o.dir);
        if (!fs.existsSync(storeDir))
            throw new Error(`OpenSpec store не найден: ${storeDir} (опция dir плагина openspec)`);
        const store: Store = scanStore(storeDir);
        const { mount } = o;
        const { options } = ctx;
        const copies: Array<{ from: string; to: string[] }> = [];
        pendingCopies.set(mount, copies);

        ctx.addPage({ path: [mount], markdown: renderSummary(store, mount, options) });

        ctx.addPage({
            path: [mount, 'Changes'],
            markdown: renderChangesIndex(store.changes, mount, options)
        });
        for (const change of store.changes) {
            const segments = [mount, 'Changes', change.id];
            const page = renderChange(change, segments);
            ctx.addPage({ path: segments, markdown: page.markdown, diagrams: page.diagrams });
            for (const rel of page.files)
                copies.push({ from: path.join(change.dir, rel), to: [...segments, rel] });
        }

        ctx.addPage({ path: [mount, 'Specs'], markdown: renderSpecIndex(store.specs, [], mount, options) });
        // Промежуточные папки спек (двухуровневая раскладка) — подразделы со списком вложенных.
        const folders = new Set<string>();
        for (const spec of store.specs)
            for (let i = 1; i < spec.path.length; i++) folders.add(spec.path.slice(0, i).join('/'));
        for (const folder of [...folders].sort()) {
            const prefix = folder.split('/');
            ctx.addPage({
                path: [mount, 'Specs', ...prefix],
                markdown: renderSpecIndex(store.specs, prefix, mount, options)
            });
        }
        for (const spec of store.specs)
            ctx.addPage({ path: [mount, 'Specs', ...spec.path], markdown: spec.content });

        ctx.addPage({
            path: [mount, 'Archive'],
            markdown: renderArchiveIndex(store.archive, mount, options)
        });
        for (const change of store.archive) {
            const segments = [mount, 'Archive', change.id];
            const page = renderChange(change, segments);
            ctx.addPage({ path: segments, markdown: page.markdown, diagrams: page.diagrams });
            for (const rel of page.files)
                copies.push({ from: path.join(change.dir, rel), to: [...segments, rel] });
        }
    },

    afterBuild(ctx, o) {
        for (const { from, to } of pendingCopies.get(o.mount) ?? []) {
            const dest = path.join(ctx.distFolder, ...to);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(from, dest);
        }
    }
});
