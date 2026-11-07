#!/usr/bin/env node

//entry point
import chalk from 'chalk';
import { program } from 'commander';

import cli from './cli/dispatch.ts';
import { isVerbose } from './cli/verbose.ts';
import { DiagramBuildError, diagramErrorLines } from './core/render/errors.ts';

// Выход после того, как stdout/stderr дописаны: в pipe (CI, лог агента) на macOS запись
// асинхронна, и голый process.exit обрезал бы хвост — ровно строки ошибок.
const exitAfterFlush = (code: number): void => {
    process.exitCode = code;
    process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
};

cli().catch((e: unknown) => {
    // Сломанные диаграммы — ошибка входа, а не сбой CLI: строки `✗` уже напечатаны сборкой,
    // стек Node здесь только шум. Полный вывод движка и стек — по --verbose / DEBUG=c4builder.
    if (e instanceof DiagramBuildError) {
        if (!e.reported)
            for (const line of diagramErrorLines(e.failures)) console.error(chalk.red(`✗ ${line}`));
        if (isVerbose(program.opts())) {
            for (const { file, cause } of e.failures) {
                console.error(chalk.gray(`\n${file}:`));
                console.error(chalk.gray((cause as Error)?.stack ?? `${cause}`));
            }
        }
        return exitAfterFlush(1);
    }
    // Закрытый промпт (Ctrl+C или EOF без терминала) — отмена, а не сбой: одна строка вместо
    // стектрейса inquirer. Код выставляем сами: на EOF процесс уже выходил с кодом 0, и CI
    // принимал несобранный сайт за успех.
    if (!(e instanceof Error && e.name === 'ExitPromptError')) throw e;
    console.error(
        `aborted: the prompt was closed${process.stdin.isTTY ? '' : ' (no terminal for the wizard)'}`
    );
    process.exit(1);
});
