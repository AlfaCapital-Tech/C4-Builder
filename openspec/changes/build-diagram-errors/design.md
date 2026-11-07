# Design

## Context

- `render()` в `src/core/render/diagrams.ts` ловит ошибку движка, склеивает
  `Diagram "<name>": <reason>` (reason у PlantUML — `PlantUML exited with code N\n<весь stderr>`)
  и в строгом режиме бросает `Error`. `DiagramQueue.drain` на первой ошибке перестаёт брать
  задачи, `run()` пробрасывает её; `build.ts` в `finally` печатает `build aborted — …`;
  `dispatch` ошибку не ловит, `index.ts` перебрасывает всё, кроме `ExitPromptError` → Node
  печатает стек и `Node.js vX`.
- `check.ts` уже умеет короткий формат: regex `^ERROR\n(\d+)\n(.*)$` по stderr PlantUML →
  `line N+1: msg`; `BpmnError`/`MermaidError`/`WireflowError` дают `problems[]`; прочее — `message`.
- Файловая диаграмма передаётся в движок содержимым файла без изменений (`scan/tree.ts`), поэтому
  позиция PlantUML + 1 = строка файла — как в `check`.
- Мягкие пути: soft-диаграммы (fence-блоки, плагины) печатают `⚠ <msg>`, `softErrors`
  (`site -w`) — `✗ <msg>`; оба с сырым stderr.
- `intro()` (`dispatch.ts`) и `cmdHelp` (`help.ts`) печатают figlet безусловно;
  `-v, --verbose` объявлен глобально, описан как «for `doctor`».

## Goals / Non-Goals

**Goals:**
- Один разборщик ошибок для `check` и сборки — тексты не могут разойтись.
- Полный список ошибок за один прогон строгой сборки без изменения `DiagramQueue`.

**Non-Goals:**
- Номер строки в файле с несколькими `@startuml` и в `!include`-файлах — как в `check`
  (позиция от начала блока; ponytail уже отмечен в `check.ts`).
- Пересчёт позиции fence-блока в строку страницы markdown: у мягких диаграмм строка — внутри блока.
- Короткий формат для прочих (не диаграммных) необработанных ошибок — это баги, стек там полезен.

## Decisions

1. **Модуль `src/core/render/errors.ts`**: `describeRenderError(err, { lib?: boolean }): string[]`
   — короткие строки-проблемы (без префикса файла); `isVerbose(opts)` не здесь, а в CLI.
   PlantUML с блоком `ERROR` → `line N+1: msg` (`.iuml` — без номера); `Bpmn/Mermaid/WireflowError`
   → `problems`; ошибка процесса PlantUML без блока `ERROR` → первая строка сообщения +
   ` (run with --verbose for details)`; прочее — `message` как сейчас в `check`. Перенос
   PUML-regex из `check.ts` сюда; `check.ts` вызывает этот же разборщик (его вывод не меняется —
   проверяется существующими тестами `check`).
   *Альтернатива*: парсить в `renderDiagram` и бросать типизированную ошибку — отвергнуто:
   `check` для `.iuml` делает повтор с C4-контекстом по сырому тексту, проще разбирать на краю.

2. **Сбор ошибок без изменения очереди.** В строгом режиме `render()` ошибку входа не бросает,
   а кладёт `{ index, file, problems, cause }` в массив `failures` замыкания `generateImages` и
   завершается успешно (картинка не пишется, чексумма не сохраняется — как сейчас при падении).
   Ошибка окружения (`environmentFailure`, `RenderWorkerError`) по-прежнему бросается → очередь
   останавливается (fail-fast, одно сообщение). После `queue.run()` при непустом `failures` —
   `throw new DiagramBuildError(failures)` с сортировкой по `index` (порядок обхода дерева, не
   порядок завершения параллельных воркеров).
   *Альтернатива*: режим «continue on error» в `DiagramQueue` — отвергнуто: очередь общая с
   dev-сервером, а классификация окружение/вход уже живёт в `render()`.
   `onDone`-слушатели для упавших задач не вызываются (как сейчас).

3. **Где печатать.** `build.ts` ловит `DiagramBuildError` в `catch` перед `finally` и печатает
   строки `✗ <file>: <problem>` в stderr (`console.error`) — так они идут до `build aborted`.
   Ошибку перебрасывает с флагом «уже сообщено». `index.ts`: для `DiagramBuildError` — без
   стека, `process.exit(1)`; в verbose-режиме перед выходом — `cause.message` (полный stderr
   движка) и `cause.stack` каждой ошибки. Путь `<file>`: `source ?? relative(cwd, entryPath)`
   (POSIX-разделители) — тот же, что уже вычисляется в `render()` для сообщений движков.
   Teardown D2/BPMN/mermaid остаётся в `finally` `dispatch` и выполняется до выхода.

4. **Verbose.** Флаг `--verbose` или `DEBUG` (токены через `,`/пробел; `c4builder` или `*`).
   Вычисляется в `dispatch` и передаётся в `build`/обработчик в `index.ts` (через свойство
   ошибки или модульную переменную `util`) — без нового глобального состояния в ядре рендера.
   Описание опции: `for doctor: absolute paths and details; for a build: full engine output on
   diagram errors`.

5. **Мягкие пути.** `⚠`/`✗` в `render()` печатают `<file>: <problem>` из того же разборщика
   (для fence-блока `<page> (<image>)`, т.к. строка относится к блоку). Текст заглушки
   (`errorPlaceholderSvg`) получает тот же короткий текст — без Java-стека в картинке.
   `rebuild()` в `dispatch` для `DiagramBuildError` (не должно случаться при softErrors, но
   на всякий случай) печатает строки, а не `e.stack`.

6. **Баннер.** `intro()` и баннер в `cmdHelp` — под `process.stdout.isTTY`; `clearConsole()` —
   no-op вне TTY. Слоган идёт вместе с баннером.

## Risks / Trade-offs

- [Полный прогон дольше на проекте со многими поломками] → рендер параллельный, кэш успешных
  сохраняется (`onSettled`); в обмен — все ошибки за один прогон, как в `check`.
- [Регресс текста `check`] → разборщик покрывается юнит-тестами, существующие тесты `check`
  остаются без изменений.
- [Подсказка «--verbose» без деталей для D2/прочих движков] → у них `message` уже короткий и
  печатается целиком, подсказка добавляется только к ошибке процесса PlantUML.
- [Заглушка в `site -w` теряет стек] → полный текст доступен с `--verbose` в логе.
