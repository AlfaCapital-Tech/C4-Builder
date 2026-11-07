import chalk from 'chalk';

// Предупреждения рендера диаграмм — общий канал всех движков: рендер не прерывают, печатаются
// строкой `⚠ <file>: <message>` (её разбирают агенты и хуки). Счётчик нужен `check --strict`:
// движки печатают сами, а код возврата решает команда. В worker-потоке (dev-сервер) счётчик
// свой — его там никто не читает.
let count = 0;

export const warnDiagram = (file: string, message: string): void => {
    count++;
    console.log(chalk.yellow(`⚠ ${file}: ${message}`));
};

export const diagramWarningCount = (): number => count;
