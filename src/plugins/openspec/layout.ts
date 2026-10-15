// Раскладка change'ов раздела по страницам: путь, подпись в sidebar и вложенность под
// родителя. Родитель задаётся ключом `.openspec.yaml` (опция плагина `parentKey`) — так
// корневое изменение задачи и его подзадачи (по платформам, сервисам) читаются деревом,
// а не плоским списком длинных id с одинаковым началом.
import type { Change } from './scan.ts';

export interface Placement {
    /** Сегменты страницы change'а от корня сайта. */
    segments: string[];
    /** Подпись в sidebar и таблицах: id или, у вложенного, хвост id после id родителя. */
    label: string;
    parent?: Change;
    children: Change[];
}

export type Layout = Map<Change, Placement>;

// Архивный change — `<YYYY-MM-DD>-<id>`; ссылка на родителя пишется по активному id.
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;
const originalId = (c: Change, archived: boolean): string =>
    archived ? c.id.replace(DATE_PREFIX, '') : c.id;

/**
 * Без `parentKey` — все change'ы на верхнем уровне `base` (прежнее поведение). С ним
 * change, у которого в `.openspec.yaml` есть `parentKey`, указывающий на change того же
 * списка, кладётся страницей под родителя. Вложенность — один уровень: родитель сам
 * вложенный или не найден — change остаётся на верхнем уровне. Подпись вложенного — хвост
 * id после `<id родителя>-`; если хвоста нет или он совпадает с подстраницей родителя
 * (артефакт, `specs`) или с подписью соседа — полный id.
 */
export const layoutChanges = (
    changes: Change[],
    base: string[],
    { parentKey, archived = false }: { parentKey?: string; archived?: boolean } = {}
): Layout => {
    const byId = new Map(changes.map((c) => [originalId(c, archived), c]));
    const parentOf = (c: Change): Change | undefined => {
        const ref = parentKey ? c.meta[parentKey] : undefined;
        const p = ref ? byId.get(ref) : undefined;
        return p && p !== c ? p : undefined;
    };
    const layout: Layout = new Map();
    const top = changes.filter((c) => {
        const p = parentOf(c);
        return !p || parentOf(p);
    });
    for (const c of top) layout.set(c, { segments: [...base, c.id], label: c.id, children: [] });
    for (const c of changes) {
        if (layout.has(c)) continue;
        const parent = parentOf(c) as Change;
        const host = layout.get(parent) as Placement;
        const taken = new Set([
            ...parent.artifacts.map((a) => a.name),
            'specs',
            ...host.children.map((s) => (layout.get(s) as Placement).label)
        ]);
        const own = originalId(c, archived);
        const prefix = `${originalId(parent, archived)}-`;
        const tail = own.startsWith(prefix) ? own.slice(prefix.length) : '';
        const label = tail && !taken.has(tail) ? tail : c.id;
        layout.set(c, { segments: [...host.segments, label], label, parent, children: [] });
        host.children.push(c);
    }
    return layout;
};

/**
 * Change'ы в порядке вывода: каждый верхнего уровня, сразу за ним — его вложенные. Порядок
 * внутри обоих уровней — порядок `changes` (по имени для страниц, по дате для таблиц).
 */
export const pageOrder = (changes: Change[], layout: Layout): Change[] => {
    const pos = new Map(changes.map((c, i) => [c, i]));
    return changes
        .filter((c) => !layout.get(c)?.parent)
        .flatMap((c) => [
            c,
            ...[...(layout.get(c)?.children ?? [])].sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0))
        ]);
};
