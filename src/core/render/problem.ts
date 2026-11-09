// Замечание движка диаграмм — структура у источника. Рендерер, который находит нарушение, сразу
// знает строку, правило и id элемента; печатный текст (`⚠ <file>: …`, `✗ <file>: …`, message
// ошибки сборки) собирается из структуры одной функцией problemText. Раньше `check --format`
// восстанавливал поля регулярками из готового текста: смена формулировки в рендерере тихо
// портила отчёт. Теперь смена формы — правка этого типа, её ловят компилятор и тесты.

export interface DiagramProblem {
    /** Текст для отчёта: без позиции и без id, если id — отдельная часть формы движка. */
    message: string;
    /** Строка и колонка с 1. */
    line?: number;
    column?: number;
    /** Правило проверки: bpmnlint, раскладки BPMN, смысловой проверки (#60). */
    rule?: string;
    /** id элемента BPMN, узла или ребра wireflow, алиас связи C4. */
    element?: string;
    /**
     * id уже входит в message по форме движка (wireflow `edge "e1": …` — вид узла значим; связь
     * C4 `… undeclared element "x"`): ни текст, ни отчёт префикс `<id>: ` не добавляют.
     */
    elementInMessage?: boolean;
    /** Абсолютный путь, если замечание в другом файле (импорт D2); иначе — файл диаграммы. */
    file?: string;
    /**
     * Печатный текст, когда движок сам вписал позицию в формулировку (XML-парсер BPMN,
     * JSON.parse, mermaid): вывод сборки и `check` остаётся байт в байт прежним, а message —
     * без позиции (позиция в line/column, fingerprint GitLab от неё не зависит).
     */
    text?: string;
}

/**
 * Печатная форма замечания (без пути файла) — контракт, который читают люди, агенты и хуки:
 * `<id|-> [<rule>] <msg>` (bpmnlint, раскладка BPMN), иначе `line N: ` и `<id>: ` перед текстом.
 */
export const problemText = (p: DiagramProblem): string => {
    if (p.text !== undefined) return p.text;
    if (p.rule !== undefined && !p.elementInMessage) return `${p.element ?? '-'} [${p.rule}] ${p.message}`;
    const at = p.line === undefined ? '' : `line ${p.line}: `;
    const id = p.element === undefined || p.elementInMessage ? '' : `${p.element}: `;
    return `${at}${id}${p.message}`;
};

/**
 * Ошибка движка со структурными замечаниями. problems — печатные строки без пути файла
 * (`check` печатает `✗ <file>: <problem>`), details — те же нарушения структурой для
 * `check --format`. У D2 печатная форма — прежний многострочный message целиком.
 */
export class DiagramError extends Error {
    readonly details: DiagramProblem[];
    readonly problems: string[];
    constructor(message: string, details: DiagramProblem[], problems: string[] = [message]) {
        super(message);
        this.details = details;
        this.problems = problems;
    }
}

/** Ошибка конвейера по файлу: message — печатные строки с путём (так их печатает сборка). */
export const fileError = (file: string, details: DiagramProblem[]): [string, DiagramProblem[], string[]] => {
    const problems = details.map(problemText);
    return [problems.map((p) => `${file}: ${p}`).join('\n'), details, problems];
};

export const isDiagramError = (e: unknown): e is DiagramError => e instanceof DiagramError;

/**
 * Текст брошенного: не-Error (строка, undefined из чужого кода) не роняет вывод. message берём
 * и у ошибки другого realm (окно jsdom), для которой instanceof Error ложен.
 */
export const errorText = (e: unknown): string => {
    const message = (e as { message?: unknown } | null | undefined)?.message;
    return typeof message === 'string' ? message : String(e);
};
