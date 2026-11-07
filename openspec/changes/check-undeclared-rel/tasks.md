# Tasks

## 1. Общий канал предупреждений

- [x] 1.1 `src/core/render/warnings.ts`: `warnDiagram(file, message)` печатает `⚠ <file>: <message>` и увеличивает счётчик, `diagramWarningCount()` возвращает счётчик. `bpmnrenderer.ts` и `wireflowrenderer.ts` печатают предупреждения через него. Проверка: существующие тесты `check.test.mjs` на `⚠ warn.bpmn` и `⚠ warn.wireflow.json` зелёные, `npm run check` чистый.

## 2. Детект связи на необъявленный элемент

- [x] 2.1 `src/core/render/plantumllint.ts`: `undeclaredRelWarnings(source, svg)` находит неявные сущности в SVG (только `ellipse` и `text`, подпись — суффикс имени по сегментам) и вызовы `Rel*`/`BiRel*`/`RelIndex*`/`Lay_*` в любом месте текста (аргументы — до парной скобки, комментарии и строки пропускаются) и возвращает строки `line N: <Macro> to undeclared element "<alias>"`. Проверка: тесты из 3.2.

## 3. `c4builder check`

- [x] 3.1 `check.ts`: для `.puml` (не `.iuml`, не ditaa) после рендера печатать предупреждения из 2.1 через `warnDiagram`. Флаг `--strict`: файл с предупреждениями даёт `✗ <file>: <K> warning(s), failing with --strict` и код 1. `dispatch.ts` передаёт `opts` в `cmdCheck`, справка `--strict` упоминает `check`. Проверка: ручной `check` на примере из issue выводит `⚠ … line 6 …` и код 0.
- [x] 3.2 Тесты в `test/check.test.mjs`. Фикстура с `HIDE_STEREOTYPE()`, границей, опечатками в `Rel` (снаружи и внутри границы) и `Lay_R`, корректными `Rel_D`: ровно три `⚠` с верными строками и макросами, код 0. `A --> B` без C4 даёт `✓` без `⚠`. С `--strict` у dangling и `warn.bpmn` строка `✗ … failing with --strict`, код 1. Проверка: `npx vitest run test/check.test.mjs`.

## 4. Сборка

- [x] 4.1 `diagrams.ts`, ветка рендера PlantUML: при выходе SVG (или растеризации SVG) и не ditaa печатать предупреждения через общий `warnUndeclaredRels` с путём файла или страницы; для блока в markdown строка — строка страницы (`lineOffset` из `fences.ts`). Код возврата не меняется.
- [x] 4.2 Сборочный тест: проект с `a.puml` с опечаткой. Первая сборка выводит `⚠ …a.puml: line N: Rel to undeclared element "nope"` с кодом 0, SVG создан. Блоки ```` ```plantuml ```` в `README.md` (с `@startuml` и без) дают строку страницы. Повторная сборка без изменений (из кэша) предупреждения не печатает. Проверка: `npx vitest run` на новом тесте.

## 5. Актуализация

- [x] 5.1 Страницы сайта о `check` и `--strict` в обеих версиях: `docs/ru/src/03 Диаграммы`, `05 CLI и конфигурация`, `07 Docker и CI`, `08 Агенты` и их EN-аналоги. Нужно описать предупреждение, его ограничения (связи из include, кэш сборки) и `--strict` для CI и pre-commit. Проверка: тест `docs-parity` зелёный, сайт собирается (`cd docs/ru && node ../../dist/index.js --site`).
- [x] 5.2 `skills/c4builder/SKILL.md`, `skills/c4builder/references/diagrams.md`, `skills/c4builder-setup/SKILL.md` (если там описан pre-commit или CI), `template/AGENTS.md`: `check --strict` и что `⚠ … undeclared element` значит опечатку в алиасе. Проверка: тест `skills` зелёный.
- [x] 5.3 Строка в `## Unreleased` `CHANGELOG.md`.
- [x] 5.4 Полный прогон: `npm run build`, `npm run check`, `npm test`. Golden не должен измениться.

## Workflow follow-up

- Закрыть issue #60 PR'ом, после merge заархивировать change.
