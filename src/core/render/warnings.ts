import chalk from 'chalk';

import { type DiagramProblem, problemText } from './problem.ts';

// Предупреждения рендера диаграмм — общий канал всех движков: рендер не прерывают, печатаются
// строкой `⚠ <file>: <problemText>` (её разбирают агенты и хуки) в stderr — один поток со
// строками `✗` сборки и `check`, stdout `check` остаётся для `✓`. Счётчик нужен `check --strict`:
// движки печатают сами, а код возврата решает команда. В worker-потоке (dev-сервер) счётчик
// свой — его там никто не читает.
let count = 0;

type WarningListener = (file: string, problem: DiagramProblem) => void;
let listener: WarningListener | null = null;

export const warnDiagram = (file: string, problem: DiagramProblem): void => {
    count++;
    if (listener) listener(file, problem);
    else console.error(chalk.yellow(`⚠ ${file}: ${problemText(problem)}`));
};

export const diagramWarningCount = (): number => count;

/**
 * Перехват предупреждений вместо печати: машинный формат `check` (stdout — только отчёт).
 * Слушатель получает структуру и путь, который движку передал вызывающий. null возвращает
 * печать. Счётчик растёт и при перехвате — `--strict` работает одинаково.
 */
export const captureDiagramWarnings = (next: WarningListener | null): void => {
    listener = next;
};
