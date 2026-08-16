import chalk from 'chalk';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { VENDOR_DIR } from '../../util/paths.ts';
import { VENDORED_JAR } from '../../util/utils.ts';
import { resolveJava } from '../../core/render/jre.ts';
import { renderDiagram } from '../../core/render/diagrams.ts';
import { renderD2, teardownD2 } from '../../core/render/d2renderer.ts';

// `c4builder check <file...>` — валидация отдельных диаграмм ТЕМ ЖЕ движком, что и
// сборка (вендорный PlantUML jar + системная/managed java, бандл D2), без проекта и
// `.c4builder`. Рендер идёт в память и выбрасывается: проверяем ровно то, что упало бы
// в сборке (системный `plantuml` может отличаться версией). Код выхода 0 — все файлы ок,
// 1 — есть ошибка (движка, неизвестного расширения или чтения файла).

// stderr PlantUML в -pipe: `ERROR` / позиция / описание. Позиция — 0-based строка
// диаграммы, для файла с одной диаграммой это file:N+1.
// ponytail: в файле с несколькими @startuml позиция считается от начала блока — смещение
// не учитываем, добавить, если такие файлы станут проверять.
const PUML_ERROR = /^ERROR\n(\d+)\n(.*)$/m;

const JAR_PATH = path.join(VENDOR_DIR, VENDORED_JAR.jar);

// JRE резолвится лениво и один раз: список только из .d2 java не трогает.
let javaPromise: Promise<string> | null = null;
const getJava = (): Promise<string> => {
    javaPromise ??= resolveJava({ log: (m) => console.log(chalk.gray(m)) }).then((r) => r.path);
    return javaPromise;
};

const checkPlantUml = async (abs: string): Promise<void> => {
    // .iuml — библиотека без @startuml: сам по себе PlantUML «рендерит» его без ошибок,
    // поэтому проверяем через включение в пустую диаграмму.
    const isLib = path.extname(abs) === '.iuml';
    const content = isLib ? `@startuml\n!include ${abs}\n@enduml\n` : await readFile(abs);
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
    } catch (e) {
        const m = (e as Error).message.match(PUML_ERROR);
        if (!m) throw e;
        // Для .iuml позиция относится к обёртке, а не к файлу — не показываем.
        throw new Error(isLib ? m[2] : `строка ${Number(m[1]) + 1}: ${m[2]}`);
    }
};

const CHECKERS: Record<string, (abs: string) => Promise<unknown>> = {
    '.puml': checkPlantUml,
    '.iuml': checkPlantUml,
    '.d2': (abs) => renderD2(abs)
};

export default async (files: string[]): Promise<void> => {
    if (files.length === 0) {
        console.log(chalk.red('использование: c4builder check <file...>  (.puml | .iuml | .d2)'));
        process.exit(1);
    }
    let failed = 0;
    // ponytail: последовательно — на сотнях файлов добавить пул как в generateImages.
    for (const file of files) {
        const abs = path.resolve(file);
        const check = CHECKERS[path.extname(abs).toLowerCase()];
        try {
            if (!check) throw new Error('неизвестное расширение (ожидается .puml, .iuml или .d2)');
            await check(abs);
            console.log(chalk.green(`✓ ${file}`));
        } catch (e) {
            failed++;
            console.error(chalk.red(`✗ ${file}: ${(e as Error).message}`));
        }
    }
    await teardownD2();
    if (failed) process.exit(1);
};
