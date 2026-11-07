import chalk from 'chalk';

// Предупреждения рендера диаграмм — общий канал всех движков: рендер не прерывают, печатаются
// строкой `⚠ <file>: <message>` (её разбирают агенты и хуки). Счётчик нужен `check --strict`:
// движки печатают сами, а код возврата решает команда. В worker-потоке (dev-сервер) счётчик
// свой — его там никто не читает.
let count = 0;

type WarningListener = (file: string, message: string) => void;
let listener: WarningListener | null = null;

export const warnDiagram = (file: string, message: string): void => {
    count++;
    if (listener) listener(file, message);
    else console.log(chalk.yellow(`⚠ ${file}: ${message}`));
};

export const diagramWarningCount = (): number => count;

/**
 * Перехват предупреждений вместо печати: машинный формат `check` (stdout — только отчёт).
 * null возвращает печать. Счётчик растёт и при перехвате — `--strict` работает одинаково.
 */
export const captureDiagramWarnings = (next: WarningListener | null): void => {
    listener = next;
};
