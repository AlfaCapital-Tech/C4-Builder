import chalk from 'chalk';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { text as streamText } from 'node:stream/consumers';

import { VENDOR_DIR } from '../../util/paths.ts';
import { type ExitCodes, exitAfterWrite } from '../../util/exit.ts';
import { VENDORED_JAR } from '../../util/utils.ts';
import { resolveJava } from '../../core/render/jre.ts';
import { PlantUmlInputError, renderDiagram } from '../../core/render/diagrams.ts';
import { renderD2, teardownD2 } from '../../core/render/d2renderer.ts';
import { renderBpmn, teardownBpmn } from '../../core/render/bpmnrenderer.ts';
import { renderMermaid, teardownMermaid } from '../../core/render/mermaidrenderer.ts';
import { renderWireflow } from '../../core/render/wireflowrenderer.ts';
// Короткий текст и подробности ошибки — общие со сборкой: один файл даёт один и тот же текст.
import { describeRenderError, errorDetails } from '../../core/render/errors.ts';
import { warnUndeclaredRels } from '../../core/render/plantumllint.ts';
import { DiagramError, type DiagramProblem, errorText, problemText } from '../../core/render/problem.ts';
import { captureDiagramWarnings, diagramWarningCount } from '../../core/render/warnings.ts';
import {
    type Diagnostic,
    type Engine,
    errorDiagnostics,
    locate,
    toDiagnostic,
    uniqueDiagnostics
} from './check.problems.ts';
import { type Format, formatReport, realFile, reportBase } from './check.report.ts';

// `c4builder check <file...>` — валидация отдельных диаграмм ТЕМ ЖЕ движком, что и
// сборка (вендорный PlantUML jar + системная/managed java, бандл D2, конвейер BPMN, mermaid,
// wireflow), без проекта и
// `.c4builder`. Рендер идёт в память и выбрасывается: проверяем ровно то, что упало бы
// в сборке (системный `plantuml` может отличаться версией). Код выхода 0 — все файлы ок,
// 1 — есть ошибка (движка, неизвестного расширения или чтения файла), а с `--strict` —
// и предупреждение (для CI и pre-commit).

export const EXIT = {
    ok: [0, 'all files are valid (with --strict: and without warnings)'],
    failed: [
        1,
        'at least one file has errors (with --strict: or warnings), no files given, or --files-from cannot be read'
    ]
} as const satisfies ExitCodes;

const JAR_PATH = path.join(VENDOR_DIR, VENDORED_JAR.jar);

// Куда печатать служебные сообщения (выбор и загрузка JRE): в машинном формате stdout занят
// отчётом, поэтому режим передаёт свой лог явно.
type Log = (message: string) => void;

// JRE резолвится лениво и один раз: список только из .d2 java не трогает.
let javaPromise: Promise<string> | null = null;
const getJava = (log: Log): Promise<string> => {
    javaPromise ??= resolveJava({ log }).then((r) => r.path);
    return javaPromise;
};

// .iuml — библиотека без @startuml: сам по себе PlantUML «рендерит» его без ошибок,
// поэтому проверяем через включение в пустую диаграмму. Контекст C4 библиотеке стилей
// задаёт подключающая диаграмма — при ошибке движка повтор с C4-stdlib (Dynamic тянет
// Component → Container → Context, Deployment — Container). Не сразу с C4: это +~1.2 с
// java на файл, а самодостаточные библиотеки подключают C4 сами.
const LIB_CONTEXTS = ['', '!include <C4/C4_Dynamic>\n!include <C4/C4_Deployment>\n'];

const checkPlantUml = async (abs: string, log: Log): Promise<void> => {
    const isLib = path.extname(abs) === '.iuml';
    const attempts = isLib
        ? LIB_CONTEXTS.map((ctx) => `@startuml\n${ctx}!include ${abs}\n@enduml\n`)
        : [await readFile(abs)];
    for (const [i, content] of attempts.entries()) {
        const isDitaa = /@startditaa/i.test(content.toString());
        try {
            const svg = await renderDiagram(content, {
                javaBin: await getJava(log),
                jarPath: JAR_PATH,
                includePath: path.dirname(abs),
                format: isDitaa ? 'png' : 'svg',
                charset: 'UTF-8',
                isDitaa,
                useSystemFonts: false
            });
            // .iuml сам связей не рисует — проверяем только диаграммы; у ditaa нет SVG. Кэша
            // здесь нет и формат всегда SVG — в отличие от сборки (см. render/diagrams.ts).
            if (!isLib && !isDitaa) warnUndeclaredRels(relative(abs), content.toString(), svg.toString());
            return;
        } catch (e) {
            // Повтор — только на ошибке входа: сбой процесса java контекстом C4 не лечится.
            if (!(e instanceof PlantUmlInputError)) throw e;
            if (i < attempts.length - 1) continue;
            if (!isLib) throw e;
            // Для .iuml позиция относится к обёртке, а не к файлу — не показываем; полный вывод
            // движка (message) остаётся для --verbose.
            const problem: DiagramProblem = { message: e.details[0].message };
            throw new DiagramError(e.message, [problem], [problemText(problem)]);
        }
    }
};

const relative = (abs: string): string => path.relative(process.cwd(), abs);

// Суффикс имени файла (с точкой) → движок и проверка. Суффиксы из нескольких расширений
// (`.wireflow.json`) совпадают и точным именем файла (`wireflow.json`), как в scan;
// файл `puml`/`d2`/`mmd` без расширения диаграммой не считается — тоже как в scan.
interface Checker {
    engine: Engine;
    run: (abs: string, log: Log) => Promise<unknown>;
}
const CHECKERS: Record<string, Checker> = {
    '.puml': { engine: 'plantuml', run: checkPlantUml },
    '.iuml': { engine: 'plantuml', run: checkPlantUml },
    '.d2': { engine: 'd2', run: (abs) => renderD2(abs) },
    '.bpmn': { engine: 'bpmn', run: async (abs) => renderBpmn(await readFile(abs, 'utf8'), relative(abs)) },
    '.mmd': {
        engine: 'mermaid',
        run: async (abs) => renderMermaid(await readFile(abs, 'utf8'), relative(abs))
    },
    '.wireflow.json': {
        engine: 'wireflow',
        run: async (abs) => renderWireflow(await readFile(abs, 'utf8'), relative(abs))
    }
};
// Экспорт — для справки `check --help`: список расширений там не расходится с кодом.
export const EXTENSIONS = Object.keys(CHECKERS);
const EXPECTED = `${EXTENSIONS.slice(0, -1).join(', ')} or ${EXTENSIONS[EXTENSIONS.length - 1]}`;

const checkerFor = (abs: string): Checker | undefined => {
    const lower = path.basename(abs).toLowerCase();
    const isExactName = (e: string): boolean => e.indexOf('.', 1) !== -1 && lower === e.slice(1);
    const ext = EXTENSIONS.filter((e) => lower.endsWith(e) || isExactName(e)).sort(
        (a, b) => b.length - a.length
    )[0];
    return ext === undefined ? undefined : CHECKERS[ext];
};

const teardown = async (): Promise<void> => {
    await teardownD2();
    await teardownBpmn();
    await teardownMermaid();
};

interface Checked {
    /** Путь, как его передал пользователь, — для текстового вывода. */
    file: string;
    abs: string;
    engine: Engine | null;
    /** Брошенное проверкой; null — файл прошёл (предупреждения возможны). */
    failure: { error: unknown } | null;
    /** Предупреждений за проверку файла — для `--strict` в тексте. */
    warnings: number;
}

// Общий цикл обоих режимов: проверка файла и счёт его предупреждений. Режимы различаются
// только тем, что делают с результатом (report).
// ponytail: последовательно — на сотнях файлов добавить пул как в generateImages.
const checkFiles = async (
    files: string[],
    log: Log,
    report: (checked: Checked) => void | Promise<void>
): Promise<void> => {
    try {
        for (const file of files) {
            const abs = path.resolve(file);
            const checker = checkerFor(abs);
            const before = diagramWarningCount();
            let failure: Checked['failure'] = null;
            try {
                if (!checker) throw new Error(`unsupported extension (expected ${EXPECTED})`);
                await checker.run(abs, log);
            } catch (error) {
                failure = { error };
            }
            await report({
                file,
                abs,
                engine: checker?.engine ?? null,
                failure,
                warnings: diagramWarningCount() - before
            });
        }
    } finally {
        await teardown();
    }
};

// Текст: `✓`/`✗` по файлу, предупреждения печатают сами движки (`⚠`, тоже stderr).
const checkText = async (files: string[], strict: boolean, verbose: boolean): Promise<number> => {
    let failed = false;
    await checkFiles(
        files,
        (m) => console.log(chalk.gray(m)),
        ({ file, failure, warnings }) => {
            if (failure) {
                failed = true;
                const { error } = failure;
                for (const p of describeRenderError(error)) console.error(chalk.red(`✗ ${file}: ${p}`));
                // Сбой процесса PlantUML в короткой строке обещает подробности по --verbose.
                if (verbose) console.error(chalk.gray(errorDetails(error)));
            } else if (strict && warnings) {
                failed = true;
                console.error(chalk.red(`✗ ${file}: ${warnings} warning(s), failing with --strict`));
            } else console.log(chalk.green(`✓ ${file}`));
        }
    );
    return failed ? EXIT.failed[0] : EXIT.ok[0];
};

// Машинный формат: замечания копятся и печатаются одним отчётом в конце (json и gitlab — один
// массив). В stdout — только отчёт: предупреждения перехвачены, строк ✓/✗/⚠ нет.
const checkMachine = async (
    files: string[],
    format: Exclude<Format, 'text'>,
    strict: boolean
): Promise<{ code: number; report: string }> => {
    const warned: { file: string; problem: DiagramProblem }[] = [];
    captureDiagramWarnings((file, problem) => warned.push({ file, problem }));
    const all: Diagnostic[] = [];
    let failed = false;
    try {
        await checkFiles(
            files,
            (m) => console.error(chalk.gray(m)),
            async ({ abs, engine, failure }) => {
                // Путь предупреждения — тот, что check передал движку (относительный к cwd).
                const list = warned
                    .splice(0)
                    .map(({ file, problem }) => toDiagnostic(problem, path.resolve(file), engine, 'warning'));
                if (failure) list.push(...errorDiagnostics(failure.error, abs, engine));
                for (const d of list) d.file = realFile(d.file);
                if (list.some((d) => d.severity === 'error' || strict)) failed = true;
                await locateElements(list);
                all.push(...list);
            }
        );
    } finally {
        captureDiagramWarnings(null);
    }
    return {
        code: failed ? EXIT.failed[0] : EXIT.ok[0],
        report: formatReport(format, uniqueDiagnostics(all), reportBase(format))
    };
};

// BPMN и wireflow сообщают только id — строку и колонку берём из объявления id в исходнике.
// Файл читается заново лишь при таком замечании; в D2 ошибка может быть в импортированном
// файле, поэтому исходник — по file замечания.
const locateElements = async (list: Diagnostic[]): Promise<void> => {
    const sources = new Map<string, string | null>();
    for (const d of list) {
        if (d.element === null || d.line !== null) continue;
        if (d.engine !== 'bpmn' && d.engine !== 'wireflow') continue;
        if (!sources.has(d.file)) sources.set(d.file, await readFile(d.file, 'utf8').catch(() => null));
        const source = sources.get(d.file);
        const at = source ? locate(source, d.element, d.engine) : null;
        if (at) Object.assign(d, at);
    }
};

// Список путей из файла или stdin (`-`), по одному на строку; пустые строки пропускаются. Так
// список изменённых файлов из `git diff` уходит в один вызов — один отчёт. xargs делит длинный
// список на несколько вызовов, и машинный формат дал бы несколько JSON-массивов подряд.
const readList = async (from: string): Promise<string[]> => {
    let content: string;
    try {
        content = from === '-' ? await streamText(process.stdin) : await readFile(from, 'utf8');
    } catch (e) {
        console.error(chalk.red(`--files-from: cannot read ${from}: ${errorText(e)}`));
        process.exit(EXIT.failed[0]);
    }
    return content.split(/\r?\n/).filter((line) => line.trim() !== '');
};

export default async (
    files: string[],
    opts: { strict?: boolean; format?: Format; json?: boolean; filesFrom?: string; verbose?: boolean } = {}
): Promise<void> => {
    const format = opts.format ?? (opts.json ? 'json' : 'text');
    const list = opts.filesFrom === undefined ? files : [...files, ...(await readList(opts.filesFrom))];
    if (format !== 'text') {
        const { code, report } = await checkMachine(list, format, !!opts.strict);
        return exitAfterWrite(code, report ? `${report}\n` : '');
    }
    // Пустой список из --files-from — «изменённых диаграмм нет», а не ошибка вызова.
    if (list.length === 0 && opts.filesFrom === undefined) {
        console.log(chalk.red(`usage: c4builder check [--strict] <file...>  (${EXTENSIONS.join(' | ')})`));
        process.exit(EXIT.failed[0]);
    }
    return exitAfterWrite(await checkText(list, !!opts.strict, !!opts.verbose));
};
