import { type DiagramProblem, errorText, isDiagramError } from '../../core/render/problem.ts';
import { escapeRegExp, positionAt } from '../../util/text.ts';

// Модель замечания `check --format` и её сборка из структурных замечаний движков. Поля приходят
// от источника (DiagramProblem рендерера) — разбора текста здесь нет: смена формы замечания
// ломает компиляцию и тесты, а не тихо портит отчёт (design change check-output-format, §1).

export type Engine = 'plantuml' | 'd2' | 'bpmn' | 'mermaid' | 'wireflow';

export interface Diagnostic {
    /** Абсолютный путь: относительный к базе отчёта считает форматтер. */
    file: string;
    line: number | null;
    column: number | null;
    /** null — расширение не поддерживается, движка нет. */
    engine: Engine | null;
    severity: 'error' | 'warning';
    rule: string | null;
    element: string | null;
    message: string;
    /** id входит в message по форме движка — префикс `<id>: ` в тексте аннотации не нужен. */
    elementInMessage?: boolean;
}

/** Структурное замечание движка → замечание отчёта; file — абсолютный путь проверяемого файла. */
export const toDiagnostic = (
    p: DiagramProblem,
    file: string,
    engine: Engine | null,
    severity: Diagnostic['severity']
): Diagnostic => ({
    file: p.file ?? file,
    line: p.line ?? null,
    column: p.column ?? null,
    engine,
    severity,
    rule: p.rule ?? null,
    element: p.element ?? null,
    message: p.message,
    elementInMessage: p.elementInMessage === true
});

/**
 * Брошенное проверкой → замечания. У ошибок движков структура готова (details); прочее — ENOENT,
 * неподдерживаемое расширение, не-Error из чужого кода — одно замечание без позиции.
 */
export const errorDiagnostics = (e: unknown, file: string, engine: Engine | null): Diagnostic[] =>
    (isDiagramError(e) ? e.details : [{ message: errorText(e) }]).map((p) =>
        toDiagnostic(p, file, engine, 'error')
    );

/**
 * Без повторов по всем полям: ошибка в общем импортируемом `.d2` иначе попала бы в отчёт за
 * каждый импортирующий файл. Порядок — первого появления.
 */
export const uniqueDiagnostics = (list: Diagnostic[]): Diagnostic[] => {
    const seen = new Set<string>();
    return list.filter((d) => {
        const key = JSON.stringify([
            d.file,
            d.line,
            d.column,
            d.engine,
            d.severity,
            d.rule,
            d.element,
            d.message
        ]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

/**
 * Позиция первого объявления id в исходнике (строка и колонка с 1): атрибут `id` в BPMN XML,
 * ключ `"id"` в wireflow JSON. У этих движков в замечании только id — без позиции аннотация
 * CI встала бы на начало файла. null — объявление не найдено или движок другой.
 */
export const locate = (
    source: string,
    element: string,
    engine: Engine | null
): { line: number; column: number } | null => {
    const re =
        engine === 'bpmn'
            ? new RegExp(String.raw`\bid\s*=\s*(["'])${escapeRegExp(element)}\1`)
            : engine === 'wireflow'
              ? new RegExp(String.raw`"id"\s*:\s*${escapeRegExp(JSON.stringify(element))}`)
              : null;
    const m = re && source.match(re);
    return m && m.index !== undefined ? positionAt(source, m.index) : null;
};
