// Встроенный плагин openspec: локальный OpenSpec-store → раздел сайта (сводка, активные
// change'ы, спеки, архив). Диаграммы артефактов рендерятся локальным движком сборки.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { definePlugin } from '../../core/plugins/types.ts';
import { type Change, scanStore, type Store } from './scan.ts';
import {
    type RenderedPage,
    renderArchiveIndex,
    renderChange,
    renderChangesIndex,
    renderMarkdown,
    renderSpecTree,
    renderSummary
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
        // Страницы + файлы, на которые они ссылаются (картинки): рядом со страницей (каталог
        // в dist уже создан addPage) и, как scan для реальных папок, в корень dist для
        // complete-markdown; excludeOtherFiles действует и здесь.
        const addPages = (pages: RenderedPage[], srcRoot: string): void => {
            for (const page of pages) {
                ctx.addPage({ path: page.path, markdown: page.markdown, diagrams: page.diagrams });
                if (options.EXCLUDE_OTHER_FILES) continue;
                for (const { from, to } of page.files) {
                    const src = path.join(srcRoot, from);
                    const dests = [path.join(options.DIST_FOLDER, ...page.path, to)];
                    // Ссылки вверх (`../` из дельты) от корня complete-файла всё равно никуда не ведут.
                    if (options.GENERATE_COMPLETE_MD_FILE && !path.posix.normalize(to).startsWith('..'))
                        dests.push(path.join(options.DIST_FOLDER, to));
                    for (const dest of dests) {
                        fs.mkdirSync(path.dirname(dest), { recursive: true });
                        fs.copyFileSync(src, dest);
                    }
                }
            }
        };
        const addChange = (change: Change, segments: string[]): void =>
            addPages(renderChange(change, segments, o.artifacts, options), change.dir);

        ctx.addPage({ path: [mount], markdown: renderSummary(store, mount, options) });

        ctx.addPage({
            path: [mount, 'Changes'],
            markdown: renderChangesIndex(store.changes, mount, options)
        });
        for (const change of store.changes) addChange(change, [mount, 'Changes', change.id]);

        // Specs: индекс, промежуточные папки, страницы спек — тем же рендером, что и
        // дельты (fenced-диаграммы локально, ссылки на файлы рядом со спекой).
        const specsDir = path.join(storeDir, 'specs');
        addPages(
            renderSpecTree(store.specs, [mount, 'Specs'], options, (pagePath, spec) =>
                renderMarkdown(pagePath, `spec-${spec.path.join('-')}`, spec.content, {
                    srcRoot: specsDir,
                    fromDir: spec.path.join('/'),
                    options
                })
            ),
            specsDir
        );

        ctx.addPage({
            path: [mount, 'Archive'],
            markdown: renderArchiveIndex(store.archive, mount, options)
        });
        for (const change of store.archive) addChange(change, [mount, 'Archive', change.id]);
    }
});
