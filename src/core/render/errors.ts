import { BpmnError } from './bpmnrenderer.ts';
import { MermaidError } from './mermaidrenderer.ts';
import { WireflowError } from './wireflowrenderer.ts';

// Разбор ошибки движка в короткие строки-проблемы — общий для `c4builder check` и сборки:
// один и тот же файл обязан давать одинаковый текст в обоих местах (иначе агент учит два
// формата). Префикс файла сюда не входит — его добавляет вызывающий (`✗ <file>: <problem>`).

// stderr PlantUML в -pipe: `ERROR` / позиция / описание. Позиция — 0-based строка
// диаграммы; файловая диаграмма уходит в движок без изменений (scan/tree.ts), поэтому для
// файла с одной диаграммой это строка файла N+1.
// ponytail: в файле с несколькими @startuml позиция считается от начала блока — смещение
// не учитываем, добавить, если такие файлы станут проверять.
const PUML_ERROR = /^ERROR\n(\d+)\n(.*)$/m;

// Сбой процесса PlantUML (код выхода, таймаут): первая строка — суть, дальше сырой stderr
// со стеком Java, который по умолчанию не показываем.
const PUML_PROCESS = /^PlantUML (exited with code|did not finish)/;

export const VERBOSE_HINT = '(run with --verbose for details)';

/** Позиция и описание синтаксической ошибки PlantUML; null — ошибка не входа (или не PlantUML). */
export const plantUmlInputError = (err: unknown): { line: number; message: string } | null => {
    const m = `${(err as Error)?.message ?? ''}`.match(PUML_ERROR);
    return m ? { line: Number(m[1]) + 1, message: m[2].trim() } : null;
};

/**
 * Короткие строки-проблемы ошибки рендера. `lib` — `.iuml`, проверенный через обёртку:
 * позиция относится к обёртке, а не к файлу, поэтому без номера строки.
 */
export const describeRenderError = (err: unknown, { lib = false }: { lib?: boolean } = {}): string[] => {
    // BPMN и wireflow: по строке на нарушение — агент правит их по id элемента; mermaid — `line N: …`.
    if (err instanceof BpmnError || err instanceof MermaidError || err instanceof WireflowError) {
        return err.problems;
    }
    const puml = plantUmlInputError(err);
    if (puml) return [lib ? puml.message : `line ${puml.line}: ${puml.message}`];
    const message = err instanceof Error ? err.message : `${err}`;
    const [first, ...rest] = message.split('\n');
    if (PUML_PROCESS.test(first) && rest.some((l) => l.trim())) return [`${first} ${VERBOSE_HINT}`];
    return [message];
};

/** Упавшая диаграмма строгой сборки: путь для сообщения, строки-проблемы и исходная ошибка. */
export interface DiagramFailure {
    /** Порядковый номер в обходе дерева — для стабильного порядка вывода. */
    index: number;
    file: string;
    problems: string[];
    cause: unknown;
}

// Ошибки входа всех диаграмм сборки разом: строгая сборка дорендеривает остальные и
// сообщает обо всех, а CLI печатает их строками `✗` без стека (стек — только с --verbose).
export class DiagramBuildError extends Error {
    readonly failures: DiagramFailure[];
    /** Строки `✗` уже напечатаны (build.ts) — верхний обработчик их не повторяет. */
    reported = false;
    constructor(failures: DiagramFailure[]) {
        const sorted = [...failures].sort((a, b) => a.index - b.index);
        super(
            `${sorted.length} diagram${sorted.length === 1 ? '' : 's'} failed to render:\n` +
                diagramErrorLines(sorted).join('\n')
        );
        this.name = 'DiagramBuildError';
        this.failures = sorted;
    }
}

/** Строки `<file>: <problem>` без маркера — маркер и цвет ставит место печати. */
export const diagramErrorLines = (failures: DiagramFailure[]): string[] =>
    failures.flatMap((f) => f.problems.map((p) => `${f.file}: ${p}`));
