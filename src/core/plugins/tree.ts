import fs from 'node:fs';
import path from 'node:path';

import type { BuildOptions } from '../../config/options.ts';
import { engineForExt, type TreeItem } from '../scan/tree.ts';
import type { PageSpec } from './types.ts';

// Виртуальные элементы дерева (добавлены плагинами, каталога на диске нет). Нужно
// лишь для правила коллизий в addPage: реальную папку затирать нельзя, а свой же
// пустой промежуточный узел плагин вправе наполнить позже.
const VIRTUAL = new WeakSet<TreeItem>();
export const isVirtual = (item: TreeItem): boolean => VIRTUAL.has(item);

// Индекс сразу за концом поддерева элемента: дерево DFS-упорядочено, потомки идут
// подряд за родителем — вставка туда сохраняет порядок обхода (sidebar/навигация).
const subtreeEnd = (tree: TreeItem[], parent: TreeItem): number => {
    const prefix = parent.dir + path.sep;
    let i = tree.indexOf(parent) + 1;
    while (i < tree.length && tree[i].dir.startsWith(prefix)) i++;
    return i;
};

/**
 * Добавляет виртуальную страницу в дерево сборки: считает `dir`/`level`/`parent` как
 * scan (dir = ROOT_FOLDER/сегменты), дополняет `descendants` родителя, вставляет в конец
 * поддерева родителя; недостающие промежуточные сегменты создаёт пустыми узлами
 * (авто-заголовок, как папка без README). Каталог в dist создаётся здесь же — compose
 * пишет страницы без mkdir, полагаясь на scan.
 */
export const addPage = (tree: TreeItem[], options: BuildOptions, page: PageSpec): TreeItem => {
    const segments = page.path;
    if (!segments.length || segments.some((s) => !s || /[\\/]/.test(s) || s === '.' || s === '..'))
        throw new Error(`addPage: некорректный путь страницы ${JSON.stringify(segments)}`);
    const root = tree.find((x) => !x.parent);
    if (!root) throw new Error('addPage: в дереве нет корневого элемента');

    let parent = root;
    let item = root;
    for (const [i, seg] of segments.entries()) {
        const dir = path.join(parent.dir, seg);
        const last = i === segments.length - 1;
        const existing = tree.find((x) => x.dir === dir);
        if (existing) {
            if (last) {
                if (!VIRTUAL.has(existing))
                    throw new Error(
                        `addPage: путь ${segments.join('/')} занят реальной папкой ${dir} — переименуйте раздел плагина (mount)`
                    );
                if (existing.mdFiles.length || existing.diagrams.length)
                    throw new Error(`addPage: страница ${segments.join('/')} уже добавлена`);
            }
            item = existing;
        } else {
            item = {
                dir,
                name: seg,
                level: dir.split(path.sep).length,
                parent: parent.dir,
                mdFiles: [],
                diagrams: [],
                descendants: []
            };
            VIRTUAL.add(item);
            parent.descendants.push(seg);
            tree.splice(subtreeEnd(tree, parent), 0, item);
            if (options.GENERATE_WEBSITE || options.GENERATE_MD || options.GENERATE_LOCAL_IMAGES)
                fs.mkdirSync(path.join(options.DIST_FOLDER, dir.replace(options.ROOT_FOLDER, '')), {
                    recursive: true
                });
        }
        parent = item;
    }

    const md =
        page.markdown === undefined ? [] : Array.isArray(page.markdown) ? page.markdown : [page.markdown];
    item.mdFiles.push(...md);
    for (const d of page.diagrams ?? []) {
        const ext = path.extname(d.file).toLowerCase();
        const engine = engineForExt(ext);
        if (!engine)
            throw new Error(
                `addPage: у диаграммы "${d.file}" страницы ${segments.join('/')} неизвестное расширение`
            );
        item.diagrams.push({
            dir: d.file,
            ext,
            engine,
            content: d.content,
            isDitaa: engine === 'plantuml' && /@startditaa/i.test(d.content),
            source: d.source,
            soft: d.soft
        });
    }
    return item;
};
