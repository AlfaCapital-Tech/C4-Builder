import chalk from 'chalk';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { VENDOR_DIR } from '../../util/paths.ts';
import { VENDORED_JAR } from '../../util/utils.ts';
import { resolveJava } from '../../core/render/jre.ts';
import { renderDiagram } from '../../core/render/diagrams.ts';
import { D2Error, renderD2, teardownD2 } from '../../core/render/d2renderer.ts';
import { BpmnError, renderBpmn, teardownBpmn } from '../../core/render/bpmnrenderer.ts';
import { MermaidError, renderMermaid, teardownMermaid } from '../../core/render/mermaidrenderer.ts';
import { WireflowError, renderWireflow } from '../../core/render/wireflowrenderer.ts';
import { warnUndeclaredRels } from '../../core/render/plantumllint.ts';
import { captureDiagramWarnings, diagramWarningCount } from '../../core/render/warnings.ts';
import { type Diagnostic, type Engine, locate, parseProblem } from './check.problems.ts';
import { type Format, formatReport, reportBase } from './check.report.ts';

// `c4builder check <file...>` — валидация отдельных диаграмм ТЕМ ЖЕ движком, что и
// сборка (вендорный PlantUML jar + системная/managed java, бандл D2, конвейер BPMN, mermaid,
// wireflow), без проекта и
// `.c4builder`. Рендер идёт в память и выбрасывается: проверяем ровно то, что упало бы
// в сборке (системный `plantuml` может отличаться версией). Код выхода 0 — все файлы ок,
// 1 — есть ошибка (движка, неизвестного расширения или чтения файла), а с `--strict` —
// и предупреждение (для CI и pre-commit).

// stderr PlantUML в -pipe: `ERROR` / позиция / описание. Позиция — 0-based строка
// диаграммы, для файла с одной диаграммой это file:N+1.
// ponytail: в файле с несколькими @startuml позиция считается от начала блока — смещение
// не учитываем, добавить, если такие файлы станут проверять.
const PUML_ERROR = /^ERROR\n(\d+)\n(.*)$/m;

const JAR_PATH = path.join(VENDOR_DIR, VENDORED_JAR.jar);

// JRE резолвится лениво и один раз: список только из .d2 java не трогает. В машинном формате
// сообщения о выборе и загрузке JRE — в stderr: stdout там занят отчётом.
let javaPromise: Promise<string> | null = null;
let logToStderr = false;
const getJava = (): Promise<string> => {
    javaPromise ??= resolveJava({
        log: (m) => (logToStderr ? console.error : console.log)(chalk.gray(m))
    }).then((r) => r.path);
    return javaPromise;
};

// .iuml — библиотека без @startuml: сам по себе PlantUML «рендерит» его без ошибок,
// поэтому проверяем через включение в пустую диаграмму. Контекст C4 библиотеке стилей
// задаёт подключающая диаграмма — при ошибке движка повтор с C4-stdlib (Dynamic тянет
// Component → Container → Context, Deployment — Container). Не сразу с C4: это +~1.2 с
// java на файл, а самодостаточные библиотеки подключают C4 сами.
const LIB_CONTEXTS = ['', '!include <C4/C4_Dynamic>\n!include <C4/C4_Deployment>\n'];

const checkPlantUml = async (abs: string): Promise<void> => {
    const isLib = path.extname(abs) === '.iuml';
    const attempts = isLib
        ? LIB_CONTEXTS.map((ctx) => `@startuml\n${ctx}!include ${abs}\n@enduml\n`)
        : [await readFile(abs)];
    for (const [i, content] of attempts.entries()) {
        const isDitaa = /@startditaa/i.test(content.toString());
        try {
            const svg = await renderDiagram(content, {
                javaBin: await getJava(),
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
            const m = (e as Error).message.match(PUML_ERROR);
            if (!m) throw e;
            if (i < attempts.length - 1) continue;
            // Для .iuml позиция относится к обёртке, а не к файлу — не показываем.
            throw new Error(isLib ? m[2] : `line ${Number(m[1]) + 1}: ${m[2]}`);
        }
    }
};

const relative = (abs: string): string => path.relative(process.cwd(), abs);

// Суффикс имени файла (с точкой) → движок и проверка. Суффиксы из нескольких расширений
// (`.wireflow.json`) совпадают и точным именем файла (`wireflow.json`), как в scan;
// файл `puml`/`d2`/`mmd` без расширения диаграммой не считается — тоже как в scan.
interface Checker {
    engine: Engine;
    run: (abs: string) => Promise<unknown>;
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
const EXTENSIONS = Object.keys(CHECKERS);
const EXPECTED = `${EXTENSIONS.slice(0, -1).join(', ')} or ${EXTENSIONS[EXTENSIONS.length - 1]}`;

const checkerFor = (abs: string): Checker | undefined => {
    const lower = path.basename(abs).toLowerCase();
    const isExactName = (e: string): boolean => e.indexOf('.', 1) !== -1 && lower === e.slice(1);
    const ext = EXTENSIONS.filter((e) => lower.endsWith(e) || isExactName(e)).sort(
        (a, b) => b.length - a.length
    )[0];
    return ext === undefined ? undefined : CHECKERS[ext];
};

// Ошибки движка, у которых по строке на нарушение (BPMN и wireflow — агент правит их по id
// элемента; mermaid — `line N: …`).
const problemsOf = (e: unknown): string[] =>
    e instanceof BpmnError || e instanceof MermaidError || e instanceof WireflowError
        ? e.problems
        : [(e as Error).message];

const teardown = async (): Promise<void> => {
    await teardownD2();
    await teardownBpmn();
    await teardownMermaid();
};

// Брошенная проверкой ошибка → замечания. Текст PlantUML разбираем всегда: прочие его ошибки
// (ENOENT) под грамматику `line N:` не попадают. У остальных движков разбираем только их
// собственные ошибки — `ENOENT: …` у BPMN иначе прочитался бы как id элемента.
const errorDiagnostics = (abs: string, engine: Engine | null, e: unknown): Diagnostic[] => {
    const at = { file: abs, engine, severity: 'error' as const };
    if (e instanceof D2Error) return e.problems.map((p) => ({ ...at, ...p, rule: null, element: null }));
    if (e instanceof BpmnError || e instanceof MermaidError || e instanceof WireflowError)
        return e.problems.map((p) => ({ ...at, ...parseProblem(engine, p) }));
    const message = (e as Error).message;
    return [{ ...at, ...parseProblem(engine === 'plantuml' ? engine : null, message) }];
};

// Машинный формат: замечания копятся и печатаются одним отчётом в конце (json и gitlab — один
// массив). В stdout — только отчёт: предупреждения перехвачены, строк ✓/✗/⚠ нет.
const checkMachine = async (
    files: string[],
    format: Exclude<Format, 'text'>,
    strict: boolean
): Promise<void> => {
    logToStderr = true;
    const all: Diagnostic[] = [];
    let failed = false;
    let current: { abs: string; engine: Engine | null; list: Diagnostic[] } | null = null;
    captureDiagramWarnings((_file, message) => {
        // Путь из рендерера — относительный для печати; берём абсолютный проверяемого файла.
        if (current)
            current.list.push({
                file: current.abs,
                engine: current.engine,
                severity: 'warning',
                ...parseProblem(current.engine, message)
            });
    });
    try {
        for (const file of files) {
            const abs = path.resolve(file);
            const checker = checkerFor(abs);
            current = { abs, engine: checker?.engine ?? null, list: [] };
            try {
                if (!checker) throw new Error(`unsupported extension (expected ${EXPECTED})`);
                await checker.run(abs);
            } catch (e) {
                current.list.push(...errorDiagnostics(abs, current.engine, e));
            }
            if (current.list.some((d) => d.severity === 'error' || strict)) failed = true;
            await locateElements(current.list);
            all.push(...current.list);
        }
    } finally {
        captureDiagramWarnings(null);
        await teardown();
    }
    const report = formatReport(format, all, reportBase(format));
    if (report) process.stdout.write(`${report}\n`);
    if (failed) process.exitCode = 1;
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

export default async (
    files: string[],
    opts: { strict?: boolean; format?: Format; json?: boolean } = {}
): Promise<void> => {
    const format = opts.format ?? (opts.json ? 'json' : 'text');
    if (format !== 'text') return checkMachine(files, format, !!opts.strict);
    if (files.length === 0) {
        console.log(chalk.red(`usage: c4builder check [--strict] <file...>  (${EXTENSIONS.join(' | ')})`));
        process.exit(1);
    }
    let failed = 0;
    // ponytail: последовательно — на сотнях файлов добавить пул как в generateImages.
    for (const file of files) {
        const abs = path.resolve(file);
        const checker = checkerFor(abs);
        const warningsBefore = diagramWarningCount();
        try {
            if (!checker) throw new Error(`unsupported extension (expected ${EXPECTED})`);
            await checker.run(abs);
            const warnings = diagramWarningCount() - warningsBefore;
            if (opts.strict && warnings) {
                failed++;
                console.error(chalk.red(`✗ ${file}: ${warnings} warning(s), failing with --strict`));
            } else console.log(chalk.green(`✓ ${file}`));
        } catch (e) {
            failed++;
            for (const p of problemsOf(e)) console.error(chalk.red(`✗ ${file}: ${p}`));
        }
    }
    await teardown();
    if (failed) process.exit(1);
};
