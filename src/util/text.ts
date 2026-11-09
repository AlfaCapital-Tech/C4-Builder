// Мелкие помощники над строками, общие для сборки, рендереров и `check`: раньше у каждого
// модуля была своя копия, и правка одной (например, набора спецсимволов) не доходила до других.

/** Строка как литерал внутри RegExp. */
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Позиция символа по смещению в тексте: строка и колонка с 1 (так их показывают редакторы и CI). */
export const positionAt = (source: string, index: number): { line: number; column: number } => {
    const before = source.slice(0, index);
    return { line: before.split('\n').length, column: index - before.lastIndexOf('\n') };
};
