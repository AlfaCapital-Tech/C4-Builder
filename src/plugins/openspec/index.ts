// Встроенный плагин openspec: локальный OpenSpec-store → раздел сайта (сводка, активные
// change'ы, спеки, архив). Диаграммы артефактов рендерятся локальным движком сборки.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { definePlugin } from '../../core/plugins/types.ts';
import { type Layout, layoutChanges, pageOrder } from './layout.ts';
import { type Change, scanStore, type Store } from './scan.ts';
import {
    type RenderedPage,
    renderArchiveIndex,
    renderChange,
    renderChangesIndex,
    relSource,
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
        artifacts: z.array(z.string()).default(['proposal', 'design', 'tasks']),
        // Ключ `.openspec.yaml` со ссылкой на родительский change (например `x-parent`):
        // вложенный change выводится страницей под родителем. Не задан — плоский список.
        parentKey: z.string().min(1).optional(),
        // Ключ `.openspec.yaml` с группой change'а (например `x-team`): change'ы верхнего
        // уровня раскладываются по папкам групп `Changes/<группа>/<id>`. Не задан — без групп.
        groupKey: z.string().min(1).optional(),
        // Ключ `.openspec.yaml` с человеческим именем change'а (например `x-name`): подпись и
        // сегмент пути change'а верхнего уровня вместо id. Не задан — id.
        nameKey: z.string().min(1).optional(),
        // Дополнительные колонки таблицы Changes из `.openspec.yaml` (например исполнитель):
        // `[{ key: "x-assignee", title: "Assignee" }]`. Не задана — прежняя таблица.
        columns: z.array(z.object({ key: z.string().min(1), title: z.string().min(1) }).strict()).optional()
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
            throw new Error(`OpenSpec store not found: ${storeDir} (dir option of the openspec plugin)`);
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
        // Родитель добавляется раньше вложенных: в sidebar под ним сначала его артефакты,
        // затем вложенные change'ы. Страница группы — перед первым её change'ем, со своей
        // таблицей (без секций — она сама и есть секция).
        const addChanges = (
            changes: Change[],
            layout: Layout,
            section: string,
            index: (members: Change[]) => string
        ): void => {
            const seen = new Set<string>();
            for (const change of pageOrder(changes, layout)) {
                const at = layout.get(change);
                if (!at) continue;
                if (at.group && !seen.has(at.group)) {
                    seen.add(at.group);
                    const members = changes.filter((c) => layout.get(c)?.group === at.group);
                    ctx.addPage({ path: [mount, section, at.group], markdown: index(members) });
                }
                addPages(renderChange(change, at.segments, o.artifacts, options, layout), change.dir);
            }
        };
        const { parentKey, groupKey, nameKey } = o;
        const active = layoutChanges(store.changes, [mount, 'Changes'], { parentKey, groupKey, nameKey });
        const archived = layoutChanges(store.archive, [mount, 'Archive'], {
            parentKey,
            groupKey,
            nameKey,
            archived: true
        });

        ctx.addPage({ path: [mount], markdown: renderSummary(store, mount, options, active, o.columns) });

        ctx.addPage({
            path: [mount, 'Changes'],
            markdown: renderChangesIndex(store.changes, mount, options, active, { columns: o.columns })
        });
        addChanges(store.changes, active, 'Changes', (members) =>
            renderChangesIndex(members, mount, options, active, { sections: false, columns: o.columns })
        );

        // Specs: индекс, промежуточные папки, страницы спек — тем же рендером, что и
        // дельты (fenced-диаграммы локально, ссылки на файлы рядом со спекой).
        const specsDir = path.join(storeDir, 'specs');
        addPages(
            renderSpecTree(store.specs, [mount, 'Specs'], options, (pagePath, spec) =>
                renderMarkdown(pagePath, `spec-${spec.path.join('-')}`, spec.content, {
                    srcRoot: specsDir,
                    fromDir: spec.path.join('/'),
                    source: relSource(specsDir, `${spec.path.join('/')}/spec.md`),
                    options
                })
            ),
            specsDir
        );

        ctx.addPage({
            path: [mount, 'Archive'],
            markdown: renderArchiveIndex(store.archive, mount, options, archived)
        });
        addChanges(store.archive, archived, 'Archive', (members) =>
            renderArchiveIndex(members, mount, options, archived, { sections: false })
        );
    }
});
