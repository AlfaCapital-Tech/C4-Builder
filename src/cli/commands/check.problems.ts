import { UNDECLARED_REL_RE, UNDECLARED_REL_RULE } from '../../core/render/plantumllint.ts';

// Модель замечания `check --format` и разбор в неё текста движков. Структуру берём из строки,
// которую движок уже отдаёт `check` (таблица форм — design change check-output-format): это
// тот же стабильный контракт, который разбирают агенты. Переделка throw-сайтов движков на
// структуру сдвинула бы текстовый вывод, а грамматики собраны здесь — смена формы строки
// ломает один модуль и его тесты.

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
}

export type Problem = Pick<Diagnostic, 'line' | 'column' | 'rule' | 'element' | 'message'>;

const plain = (message: string, line: number | null = null): Problem => ({
    line,
    column: null,
    rule: null,
    element: null,
    message
});

const LINE = /^line (\d+): ([\s\S]*)$/;
// bpmnlint и раскладка: `<id> [<rule>] <msg>`, `-` — нарушение без элемента.
const BPMN_RULE = /^(\S+) \[([^\]]+)\] ([\s\S]*)$/;
// Предупреждения разбора moddle: `<id>: <msg>`. Только для BPMN — у прочих движков так
// начинаются `ENOENT: …` и подобные, там это не id.
const BPMN_ID = /^([^\s:]+): ([\s\S]*)$/;
// wireflow собирает `who` через q() = JSON.stringify — им же id и разбираем.
const WIREFLOW_ID = /^(?:node|edge|card|group|note) ("(?:[^"\\]|\\.)*")/;

/** Строка замечания движка → поля модели. Нераспознанное — целиком в message. */
export const parseProblem = (engine: Engine | null, text: string): Problem => {
    if (engine === 'bpmn') {
        const rule = text.match(BPMN_RULE);
        if (rule) return { ...plain(rule[3]), rule: rule[2], element: rule[1] === '-' ? null : rule[1] };
        const id = text.match(BPMN_ID);
        if (id) return { ...plain(id[2]), element: id[1] };
        return plain(text);
    }
    if (engine === 'wireflow') {
        // Вид узла (`card`/`edge`) значим для чтения — message остаётся целой строкой.
        const m = text.match(WIREFLOW_ID);
        let element: string | null = null;
        if (m)
            try {
                element = String(JSON.parse(m[1]));
            } catch {}
        return { ...plain(text), element };
    }
    const lined = text.match(LINE);
    const problem = lined ? plain(lined[2], Number(lined[1])) : plain(text);
    if (engine === 'plantuml') {
        const rel = problem.message.match(UNDECLARED_REL_RE);
        if (rel) return { ...problem, rule: UNDECLARED_REL_RULE, element: rel[2] };
    }
    return problem;
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
            ? new RegExp(String.raw`\bid\s*=\s*(["'])${escapeRe(element)}\1`)
            : engine === 'wireflow'
              ? new RegExp(String.raw`"id"\s*:\s*${escapeRe(JSON.stringify(element))}`)
              : null;
    const m = re && source.match(re);
    if (!m || m.index === undefined) return null;
    const before = source.slice(0, m.index);
    const lineStart = before.lastIndexOf('\n') + 1;
    return { line: before.split('\n').length, column: m.index - lineStart + 1 };
};
