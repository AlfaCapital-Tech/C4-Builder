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

// java на Windows печатает `\r\n`: без нормализации блок ERROR не узнаётся, и вместо
// `line N: …` пользователь получил бы сырой stderr.
const messageOf = (err: unknown): string =>
    `${err instanceof Error ? err.message : (err ?? '')}`.replace(/\r\n?/g, '\n');

/** Позиция и описание синтаксической ошибки PlantUML; null — ошибка не входа (или не PlantUML). */
export const plantUmlInputError = (err: unknown): { line: number; message: string } | null => {
    const m = messageOf(err).match(PUML_ERROR);
    return m ? { line: Number(m[1]) + 1, message: m[2].trim() } : null;
};

// Ошибка с разобранной сутью (нарушения BPMN/wireflow, строка mermaid или PlantUML) — null,
// если движок дал только сырой текст.
const structuredProblems = (err: unknown, lib: boolean): string[] | null => {
    // BPMN и wireflow: по строке на нарушение — агент правит их по id элемента; mermaid — `line N: …`.
    if (err instanceof BpmnError || err instanceof MermaidError || err instanceof WireflowError) {
        return err.problems;
    }
    const puml = plantUmlInputError(err);
    return puml ? [lib ? puml.message : `line ${puml.line}: ${puml.message}`] : null;
};

/**
 * Короткие строки-проблемы ошибки рендера. `lib` — `.iuml`, проверенный через обёртку:
 * позиция относится к обёртке, а не к файлу, поэтому без номера строки.
 */
export const describeRenderError = (err: unknown, { lib = false }: { lib?: boolean } = {}): string[] => {
    const structured = structuredProblems(err, lib);
    if (structured) return structured;
    const message = messageOf(err);
    const [first, ...rest] = message.split('\n');
    if (PUML_PROCESS.test(first) && rest.some((l) => l.trim())) return [`${first} ${VERBOSE_HINT}`];
    return [message];
};

/**
 * Текст картинки-заглушки: разобранная суть, если есть, иначе сообщение движка целиком (у
 * сбоя процесса PlantUML — хвост stderr). Подсказка про флаг CLI в картинке бессмысленна —
 * читатель сайта его не запустит.
 */
export const placeholderText = (err: unknown): string =>
    (structuredProblems(err, false) ?? [messageOf(err)]).join('\n');

/** Полный текст ошибки для --verbose: стек включает stderr движка (он в message). */
export const errorDetails = (err: unknown): string =>
    err instanceof Error ? (err.stack ?? err.message) : `${err}`;

/** Нет java и т. п.: дело не во входе диаграммы — одно сообщение на сборку, без строки на файл. */
export class DiagramEnvironmentError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'DiagramEnvironmentError';
    }
}

/** Упавшая диаграмма строгой сборки: путь для сообщения, строки-проблемы и исходная ошибка. */
export interface DiagramFailure {
    /** Порядковый номер в обходе дерева — для стабильного порядка вывода. */
    index: number;
    file: string;
    problems: string[];
    cause: unknown;
}

// Ошибки всех диаграмм сборки разом: строгая сборка дорендеривает остальные и сообщает обо
// всех, а CLI печатает их строками `✗` без стека (стек — только с --verbose). `fatal` —
// ошибка, остановившая очередь (нет java): собранные до неё ошибки входа не теряются.
export class DiagramBuildError extends Error {
    readonly failures: DiagramFailure[];
    readonly fatal?: unknown;
    constructor(failures: DiagramFailure[], fatal?: unknown) {
        const sorted = [...failures].sort((a, b) => a.index - b.index);
        const lines = diagramErrorLines(sorted, fatal);
        super(
            `${lines.length} diagram error${lines.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
            fatal === undefined ? undefined : { cause: fatal }
        );
        this.name = 'DiagramBuildError';
        this.failures = sorted;
        this.fatal = fatal;
    }
}

/** Строки `<file>: <problem>` (и сообщение fatal-ошибки) без маркера — маркер ставит место печати. */
export const diagramErrorLines = (failures: DiagramFailure[], fatal?: unknown): string[] => [
    ...failures.flatMap((f) => f.problems.map((p) => `${f.file}: ${p}`)),
    ...(fatal === undefined ? [] : [messageOf(fatal)])
];
