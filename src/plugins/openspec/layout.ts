// Раскладка change'ов раздела по страницам: путь, подпись в sidebar, вложенность под
// родителя и группа. Родитель задаётся ключом `.openspec.yaml` (опция плагина `parentKey`) —
// так корневое изменение задачи и его подзадачи (по платформам, сервисам) читаются деревом,
// а не плоским списком длинных id с одинаковым началом. Группа (опция `groupKey`, например
// команда) — промежуточная папка раздела: `Changes/<группа>/<id>`.
import type { Change } from './scan.ts';

export interface Placement {
    /** Сегменты страницы change'а от корня сайта. */
    segments: string[];
    /** Подпись в sidebar и таблицах: id или, у вложенного, хвост id после id родителя. */
    label: string;
    parent?: Change;
    children: Change[];
    /** Группа change'а верхнего уровня (значение `groupKey`); вложенный — в группе родителя. */
    group?: string;
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
 * С `groupKey` change верхнего уровня, у которого задан этот ключ, кладётся под папку
 * группы: `<base>/<группа>/<id>`; вложенные идут за родителем. Значение со `/` или
 * совпадающее с подписью change'а без группы (коллизия путей) — группой не считается.
 * С `nameKey` подпись и сегмент пути change'а верхнего уровня — значение ключа (например
 * `x-name: Оплата картой`): sidebar и таблицы читаются по-человечески, а адрес страницы
 * стабилен, пока значение не меняют. Недопустимое значение (`/`, `\`, `#`, `?`, `.`, `..`) или
 * занятое в той же папке — подпись остаётся id; для группы — то же, change остаётся без группы.
 */
export const layoutChanges = (
    changes: Change[],
    base: string[],
    {
        parentKey,
        groupKey,
        nameKey,
        archived = false
    }: { parentKey?: string; groupKey?: string; nameKey?: string; archived?: boolean } = {}
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
    // Значение ключа как сегмент пути: addPage отвергает `/`, `\`, `.`, `..` и пустые, а `#` и
    // `?` encodeURI оставляет как есть — ссылка в sidebar оборвалась бы на якоре или запросе.
    const segment = (key: string | undefined, c: Change): string | undefined => {
        const v = key ? c.meta[key]?.trim() : undefined;
        return v && !/[\\/#?]/.test(v) && v !== '.' && v !== '..' ? v : undefined;
    };
    const wanted = (c: Change): string => segment(nameKey, c) ?? c.id;
    // Подписи change'ов без группы заняты на уровне base — группа с таким именем дала бы коллизию.
    const flat = new Set(top.filter((c) => !segment(groupKey, c)).map(wanted));
    const groups = new Set<string>();
    const used = new Map<string, Set<string>>();
    for (const c of top) {
        const g = segment(groupKey, c);
        const group = g && !flat.has(g) ? g : undefined;
        if (group) groups.add(group);
        const folder = group ?? '';
        const taken = used.get(folder) ?? new Set<string>();
        used.set(folder, taken);
        // Повтор подписи в папке (или имя группы на уровне base) — откат на уникальный id.
        const want = wanted(c);
        const label = taken.has(want) || (!group && want !== c.id && groups.has(want)) ? c.id : want;
        taken.add(label);
        layout.set(c, {
            segments: group ? [...base, group, label] : [...base, label],
            label,
            children: [],
            group
        });
    }
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
        layout.set(c, {
            segments: [...host.segments, label],
            label,
            parent,
            children: [],
            group: host.group
        });
        host.children.push(c);
    }
    return layout;
};

/** Группы раскладки по алфавиту; change'ы без группы в список не входят. */
export const groupNames = (changes: Change[], layout: Layout): string[] =>
    [...new Set(changes.map((c) => layout.get(c)?.group).filter((g): g is string => !!g))].sort((a, b) =>
        a.localeCompare(b)
    );

/**
 * Change'ы в порядке вывода: каждый верхнего уровня, сразу за ним — его вложенные. Порядок
 * внутри обоих уровней — порядок `changes` (по имени для страниц, по дате для таблиц); с
 * группами — сначала группы по алфавиту, затем change'ы без группы.
 */
export const pageOrder = (changes: Change[], layout: Layout): Change[] => {
    const pos = new Map(changes.map((c, i) => [c, i]));
    const groups = groupNames(changes, layout);
    const rank = (c: Change): number => {
        const g = layout.get(c)?.group;
        return g ? groups.indexOf(g) : groups.length;
    };
    return changes
        .filter((c) => !layout.get(c)?.parent)
        .sort((a, b) => rank(a) - rank(b) || (pos.get(a) ?? 0) - (pos.get(b) ?? 0))
        .flatMap((c) => [
            c,
            ...[...(layout.get(c)?.children ?? [])].sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0))
        ]);
};
