import { errorText, isDiagramError } from './problem.ts';

// Ошибки сборки диаграмм поверх problem.ts: короткий текст для печати, заглушка, подробности
// по --verbose и ошибка всей сборки разом. Разбор ошибок движков здесь не живёт — каждый
// рендерер бросает DiagramError со структурой у источника (PlantUML — renderDiagram), поэтому
// `check` и сборка печатают для одного файла один и тот же текст. Префикс файла сюда не входит
// — его добавляет вызывающий (`✗ <file>: <problem>`).

// Сбой процесса PlantUML (код выхода, таймаут) без разобранной ошибки входа: первая строка —
// суть, дальше сырой stderr со стеком Java, который по умолчанию не показываем.
const PUML_PROCESS = /^PlantUML (exited with code|did not finish)/;

export const VERBOSE_HINT = '(run with --verbose for details)';

/**
 * Короткие строки-проблемы ошибки рендера: у ошибок движков — их problems, у сбоя процесса
 * PlantUML — первая строка и подсказка про флаг, прочее — сообщение целиком.
 */
export const describeRenderError = (err: unknown): string[] => {
    if (isDiagramError(err)) return err.problems;
    const message = errorText(err);
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
    isDiagramError(err) ? err.problems.join('\n') : errorText(err);

/** Полный текст ошибки для --verbose: стек включает сообщение, а в нём — stderr движка. */
export const errorDetails = (err: unknown): string =>
    err instanceof Error ? (err.stack ?? err.message) : errorText(err);

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
    ...(fatal === undefined ? [] : [errorText(fatal)])
];
