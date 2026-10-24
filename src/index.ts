#!/usr/bin/env node

//entry point
import cli from './cli/dispatch.ts';

// Закрытый промпт (Ctrl+C или EOF без терминала) — отмена, а не сбой: одна строка вместо
// стектрейса inquirer. Код выставляем сами: на EOF процесс уже выходил с кодом 0, и CI
// принимал несобранный сайт за успех.
cli().catch((e: unknown) => {
    if (!(e instanceof Error && e.name === 'ExitPromptError')) throw e;
    console.error(
        `aborted: the prompt was closed${process.stdin.isTTY ? '' : ' (no terminal for the wizard)'}`
    );
    process.exit(1);
});
