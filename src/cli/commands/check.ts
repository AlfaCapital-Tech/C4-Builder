import chalk from 'chalk';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { VENDOR_DIR } from '../../util/paths.ts';
import { exitAfterFlush } from '../../util/exit.ts';
import { VENDORED_JAR } from '../../util/utils.ts';
import { resolveJava } from '../../core/render/jre.ts';
import { renderDiagram } from '../../core/render/diagrams.ts';
import { renderD2, teardownD2 } from '../../core/render/d2renderer.ts';
import { renderBpmn, teardownBpmn } from '../../core/render/bpmnrenderer.ts';
import { renderMermaid, teardownMermaid } from '../../core/render/mermaidrenderer.ts';
import { renderWireflow } from '../../core/render/wireflowrenderer.ts';
// Разбор ошибки движка — общий со сборкой: один файл даёт один и тот же текст в обоих местах.
import { describeRenderError, errorDetails, plantUmlInputError } from '../../core/render/errors.ts';

// `c4builder check <file...>` — валидация отдельных диаграмм ТЕМ ЖЕ движком, что и
// сборка (вендорный PlantUML jar + системная/managed java, бандл D2, конвейер BPMN, mermaid,
// wireflow), без проекта и
// `.c4builder`. Рендер идёт в память и выбрасывается: проверяем ровно то, что упало бы
// в сборке (системный `plantuml` может отличаться версией). Код выхода 0 — все файлы ок,
// 1 — есть ошибка (движка, неизвестного расширения или чтения файла).

const JAR_PATH = path.join(VENDOR_DIR, VENDORED_JAR.jar);

// JRE резолвится лениво и один раз: список только из .d2 java не трогает.
let javaPromise: Promise<string> | null = null;
const getJava = (): Promise<string> => {
    javaPromise ??= resolveJava({ log: (m) => console.log(chalk.gray(m)) }).then((r) => r.path);
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
            await renderDiagram(content, {
                javaBin: await getJava(),
                jarPath: JAR_PATH,
                includePath: path.dirname(abs),
                format: isDitaa ? 'png' : 'svg',
                charset: 'UTF-8',
                isDitaa,
                useSystemFonts: false
            });
            return;
        } catch (e) {
            // Повтор — только на ошибке входа: сбой процесса java контекстом C4 не лечится.
            // Текст разбирает describeRenderError (для .iuml — без позиции обёртки).
            if (plantUmlInputError(e) && i < attempts.length - 1) continue;
            throw e;
        }
    }
};

const relative = (abs: string): string => path.relative(process.cwd(), abs);

// Суффикс имени файла (с точкой) → проверка. Суффиксы из нескольких расширений
// (`.wireflow.json`) совпадают и точным именем файла (`wireflow.json`), как в scan;
// файл `puml`/`d2`/`mmd` без расширения диаграммой не считается — тоже как в scan.
const CHECKERS: Record<string, (abs: string) => Promise<unknown>> = {
    '.puml': checkPlantUml,
    '.iuml': checkPlantUml,
    '.d2': (abs) => renderD2(abs),
    '.bpmn': async (abs) => renderBpmn(await readFile(abs, 'utf8'), relative(abs)),
    '.mmd': async (abs) => renderMermaid(await readFile(abs, 'utf8'), relative(abs)),
    '.wireflow.json': async (abs) => renderWireflow(await readFile(abs, 'utf8'), relative(abs))
};
const EXTENSIONS = Object.keys(CHECKERS);
const EXPECTED = `${EXTENSIONS.slice(0, -1).join(', ')} or ${EXTENSIONS[EXTENSIONS.length - 1]}`;

const checkerFor = (abs: string): ((abs: string) => Promise<unknown>) | undefined => {
    const lower = path.basename(abs).toLowerCase();
    const isExactName = (e: string): boolean => e.indexOf('.', 1) !== -1 && lower === e.slice(1);
    const ext = EXTENSIONS.filter((e) => lower.endsWith(e) || isExactName(e)).sort(
        (a, b) => b.length - a.length
    )[0];
    return ext === undefined ? undefined : CHECKERS[ext];
};

export default async (files: string[], { verbose = false }: { verbose?: boolean } = {}): Promise<void> => {
    if (files.length === 0) {
        console.log(chalk.red(`usage: c4builder check <file...>  (${EXTENSIONS.join(' | ')})`));
        return exitAfterFlush(1);
    }
    let failed = 0;
    // ponytail: последовательно — на сотнях файлов добавить пул как в generateImages.
    for (const file of files) {
        const abs = path.resolve(file);
        const check = checkerFor(abs);
        try {
            if (!check) throw new Error(`unsupported extension (expected ${EXPECTED})`);
            await check(abs);
            console.log(chalk.green(`✓ ${file}`));
        } catch (e) {
            failed++;
            const lib = path.extname(abs) === '.iuml';
            for (const p of describeRenderError(e, { lib })) console.error(chalk.red(`✗ ${file}: ${p}`));
            // Сбой процесса PlantUML в короткой строке обещает подробности по --verbose.
            if (verbose) console.error(chalk.gray(errorDetails(e)));
        }
    }
    await teardownD2();
    await teardownBpmn();
    await teardownMermaid();
    // Строки `✗` в pipe должны дописаться до выхода (см. exitAfterFlush).
    if (failed) exitAfterFlush(1);
};
