#!/usr/bin/env node

//entry point
import cli from './cli/dispatch.ts';
import { DiagramBuildError } from './core/render/errors.ts';
import { exitAfterFlush } from './util/exit.ts';

cli().catch((e: unknown) => {
    // Сломанные диаграммы — ошибка входа, а не сбой CLI: строки `✗` (и подробности по --verbose)
    // уже напечатала сборка, стек Node здесь только шум.
    if (e instanceof DiagramBuildError) return exitAfterFlush(1);
    // Закрытый промпт (Ctrl+C или EOF без терминала) — отмена, а не сбой: одна строка вместо
    // стектрейса inquirer. Код выставляем сами: на EOF процесс уже выходил с кодом 0, и CI
    // принимал несобранный сайт за успех.
    if (!(e instanceof Error && e.name === 'ExitPromptError')) throw e;
    console.error(
        `aborted: the prompt was closed${process.stdin.isTTY ? '' : ' (no terminal for the wizard)'}`
    );
    process.exit(1);
});
