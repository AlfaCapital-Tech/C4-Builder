import { createHash } from 'node:crypto';
import path from 'node:path';

import type { Diagnostic } from './check.problems.ts';

// Форматтеры машинного вывода `check` — чистые функции над моделью замечания: их проверяют
// юнит-тесты без запуска движков, а новый формат (SARIF…) — ещё один форматтер.

export const FORMATS = ['text', 'json', 'github', 'gitlab'] as const;
export type Format = (typeof FORMATS)[number];

interface ReportOptions {
    /** Каталог, от которого считаются пути в отчёте. */
    base: string;
}

/**
 * База путей отчёта. Аннотации GitHub и Code Quality GitLab ждут путь от корня репозитория —
 * `check` же могут запустить из подкаталога (`cd docs && c4builder check …`).
 */
export const reportBase = (
    format: Format,
    env: NodeJS.ProcessEnv = process.env,
    cwd: string = process.cwd()
): string =>
    (format === 'github' ? env.GITHUB_WORKSPACE : format === 'gitlab' ? env.CI_PROJECT_DIR : undefined) ||
    cwd;

const relPath = (file: string, base: string): string => path.relative(base, file).split(path.sep).join('/');

// Текст для человека в CI: у bpmnlint id элемента в сообщении нет — без префикса непонятно,
// о каком элементе речь; у wireflow и PlantUML id уже в тексте, дубль не нужен.
const text = (d: Diagnostic): string =>
    d.element !== null && !d.message.includes(d.element) ? `${d.element}: ${d.message}` : d.message;

const checkName = (d: Diagnostic): string => {
    const engine = d.engine ?? 'c4builder';
    return d.rule ? `${engine}/${d.rule}` : engine;
};

export const formatJson = (list: Diagnostic[], { base }: ReportOptions): string =>
    JSON.stringify(
        list.map((d) => ({
            file: relPath(d.file, base),
            line: d.line,
            column: d.column,
            engine: d.engine,
            severity: d.severity,
            rule: d.rule,
            element: d.element,
            message: d.message
        })),
        null,
        2
    );

// Экранирование workflow-команд GitHub: данные — `%`, CR, LF; в свойствах ещё `:` и `,`,
// иначе они читались бы как разделители команды.
const ghData = (s: string): string => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const ghProp = (s: string): string => ghData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export const formatGithub = (list: Diagnostic[], { base }: ReportOptions): string =>
    list
        .map((d) => {
            const props = [`file=${ghProp(relPath(d.file, base))}`];
            if (d.line !== null) props.push(`line=${d.line}`);
            if (d.column !== null) props.push(`col=${d.column}`);
            const title = `c4builder${d.engine ? ` ${d.engine}` : ''}${d.rule ? ` [${d.rule}]` : ''}`;
            props.push(`title=${ghProp(title)}`);
            return `::${d.severity} ${props.join(',')}::${ghData(text(d))}`;
        })
        .join('\n');

// fingerprint без номера строки: иначе пустая строка выше превращала бы замечание в «новое» в
// виджете MR. Одинаковые замечания одного файла различает порядковый номер.
export const formatGitlab = (list: Diagnostic[], { base }: ReportOptions): string => {
    const seen = new Map<string, number>();
    return JSON.stringify(
        list.map((d) => {
            const file = relPath(d.file, base);
            const name = checkName(d);
            const key = [file, name, d.element ?? '', d.message].join('\0');
            const n = seen.get(key) ?? 0;
            seen.set(key, n + 1);
            return {
                description: text(d),
                check_name: name,
                fingerprint: createHash('sha256').update(`${key}\0${n}`).digest('hex'),
                severity: d.severity === 'error' ? 'major' : 'minor',
                location: { path: file, lines: { begin: d.line ?? 1 } }
            };
        }),
        null,
        2
    );
};

export const formatReport = (format: Exclude<Format, 'text'>, list: Diagnostic[], base: string): string =>
    (format === 'json' ? formatJson : format === 'github' ? formatGithub : formatGitlab)(list, { base });
