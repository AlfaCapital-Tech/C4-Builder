// Встроенный плагин openspec: локальный OpenSpec-store → раздел сайта (сводка, активные
// change'ы, спеки, архив). Диаграммы артефактов рендерятся локальным движком сборки.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { definePlugin } from '../../core/plugins/types.ts';
import { type Change, scanStore, type Store } from './scan.ts';
import {
    renderArchiveIndex,
    renderChange,
    renderChangesIndex,
    renderSpecIndex,
    renderSummary,
    specFolders
} from './render.ts';

const optionsSchema = z
    .object({
        dir: z.string().default('openspec'),
        mount: z.string().min(1).default('OpenSpec'),
        // Порядок артефактов change'а; первый выводится на странице change'а, остальные —
        // подстраницами; не перечисленные — после, по алфавиту.
        artifacts: z.array(z.string()).default(['proposal', 'design', 'tasks'])
    })
    .strict();

type Opts = z.output<typeof optionsSchema>;

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
        // Страницы change'а + файлы, на которые ссылаются артефакты (картинки): каталог
        // страницы в dist уже создан addPage — копируем сразу.
        const addChange = (change: Change, segments: string[]): void => {
            for (const page of renderChange(change, segments, o.artifacts, options)) {
                ctx.addPage({ path: page.path, markdown: page.markdown, diagrams: page.diagrams });
                for (const rel of page.files) {
                    const dest = path.join(options.DIST_FOLDER, ...page.path, rel);
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.copyFileSync(path.join(change.dir, rel), dest);
                }
            }
        };

        ctx.addPage({ path: [mount], markdown: renderSummary(store, mount, options) });

        ctx.addPage({
            path: [mount, 'Changes'],
            markdown: renderChangesIndex(store.changes, mount, options)
        });
        for (const change of store.changes) addChange(change, [mount, 'Changes', change.id]);

        // Specs: индекс, промежуточные папки (двухуровневая раскладка) со списком вложенных, страницы спек.
        const specsBase = [mount, 'Specs'];
        for (const prefix of [[], ...specFolders(store.specs)])
            ctx.addPage({
                path: [...specsBase, ...prefix],
                markdown: renderSpecIndex(store.specs, prefix, specsBase, options)
            });
        for (const spec of store.specs)
            ctx.addPage({ path: [...specsBase, ...spec.path], markdown: spec.content });

        ctx.addPage({
            path: [mount, 'Archive'],
            markdown: renderArchiveIndex(store.archive, mount, options)
        });
        for (const change of store.archive) addChange(change, [mount, 'Archive', change.id]);
    }
});
