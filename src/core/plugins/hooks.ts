// Вызов хуков плагинов из оркестратора сборки. Порядок — порядок записей `plugins`;
// ошибка хука прерывает сборку с именем плагина (cause сохраняет исходный стек).
import type { BuildOptions } from '../../config/options.ts';
import type { TreeItem } from '../scan/tree.ts';
import { resolveSource } from './source.ts';
import { addPage } from './tree.ts';
import type { LoadedPlugin } from './types.ts';

const wrap = async (name: string, hook: string, fn: () => Promise<void> | void): Promise<void> => {
    try {
        await fn();
    } catch (e) {
        throw new Error(`Плагин ${name} (${hook}): ${(e as Error).message ?? e}`, { cause: e });
    }
};

export const runAfterScan = async (
    tree: TreeItem[],
    options: BuildOptions,
    plugins: LoadedPlugin[]
): Promise<void> => {
    for (const { plugin, opts } of plugins) {
        if (!plugin.afterScan) continue;
        const ctx = {
            tree,
            options,
            addPage: (page: Parameters<typeof addPage>[2]) => addPage(tree, options, page),
            source: resolveSource
        };
        await wrap(plugin.name, 'afterScan', () => plugin.afterScan?.(ctx, opts));
    }
};

export const runAfterBuild = async (options: BuildOptions, plugins: LoadedPlugin[]): Promise<void> => {
    for (const { plugin, opts } of plugins) {
        if (!plugin.afterBuild) continue;
        await wrap(plugin.name, 'afterBuild', () =>
            plugin.afterBuild?.({ distFolder: options.DIST_FOLDER, options }, opts)
        );
    }
};
