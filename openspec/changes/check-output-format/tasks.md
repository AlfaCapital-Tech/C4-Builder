# Tasks

## 1. Модель замечания и разбор текста движков

- [x] 1.1 (Разбор текста `parseProblem` заменён структурой у источника — группа 5.) Новый модуль `src/cli/commands/check.problems.ts`: тип `Diagnostic` (`file` абсолютный, `line`, `column`, `engine`, `severity`, `rule`, `element`, `message`), `parseProblem(engine, text)` по грамматикам design §1 и `locate(source, element, engine)` (design §4). `plantumllint.ts` экспортирует шаблон строки undeclared-rel, и разбор использует его. Проверка: юнит-тест `test/check-report.test.mjs` на каждую грамматику (puml `line N:`, undeclared-element, bpmn `id [rule] msg` и `-`, bpmn `id: msg`, `ENOENT: …` у не-BPMN без element, wireflow `card "a": …` и `edge #0`, mermaid без строки) и на `locate` (BPMN атрибут с `'`/`"`, wireflow минифицированный и форматированный JSON, id не найден → `null`).
- [x] 1.2 `d2renderer.ts`: `D2Error` с `problems: {file, line, column, message}[]` из `range`/`errmsg`; `message` не меняется. Проверка: существующий тест `check` на `bad.d2` зелёный; юнит-тест на `renderD2` битого файла даёт две позиции `1:1` и `2:4` с абсолютным путём.

## 2. Форматтеры

- [x] 2.1 `src/cli/commands/check.report.ts`: `formatJson`, `formatGithub`, `formatGitlab` (design §5). Проверка: юнит-тесты — пустой список (`[]`, пустая строка, `[]`); экранирование `%`, `\n`, `:`, `,`; `title` с правилом и без; префикс element, только если id нет в сообщении; base из `GITHUB_WORKSPACE`/`CI_PROJECT_DIR`; `lines.begin` = 1 без строки; fingerprint не зависит от строки и различает повторы.

## 3. check и CLI

- [x] 3.1 `warnings.ts`: `captureDiagramWarnings(listener | null)`, счётчик растёт и при перехвате. Проверка: тесты `--strict` из #76 зелёные.
- [x] 3.2 `check.ts`: `CHECKERS` → `{ engine, run }`; в машинном формате — слушатель предупреждений, сбор `Diagnostic` из ошибок (design §4), `locate` для BPMN/wireflow, лог JRE в stderr, без `✓/✗/⚠`, печать отчёта в конце; без файлов — пустой отчёт и код 0. Текстовая ветка без изменений. Проверка: весь `test/check.test.mjs` зелёный без правок существующих ожиданий.
- [x] 3.3 `dispatch.ts`: `--format` с `choices`, описание `--json` «for `doctor` and `check`», передача в `cmdCheck`. Проверка: e2e из 3.4 на неизвестный формат.
- [x] 3.4 E2E в `test/check.test.mjs`: `--format json` на `bad.puml`, `lonely.bpmn` (rule, element, строка из `locate`), `bad.d2` (две позиции), `bad.mmd`, `bad.wireflow.json` (element `e1`), `warn.bpmn` (severity warning), dangling `.puml` из #76 (`undeclared-element`), `what.txt` (engine `null`); stdout — валидный JSON без `✓`/ANSI; коды возврата как у `text`; `--json` = `--format json`; `--format github` — строка `::error file=bad.puml,line=3,title=c4builder plantuml::…` и `::warning` у `warn.bpmn`, `--strict` → код 1; `--format gitlab` — `check_name`, `severity`, `location`; без файлов → `[]`, код 0; `--format xml` → код 1 со списком форматов; `GITHUB_WORKSPACE` на родителе каталога → путь с подкаталогом. Проверка: `npx vitest run test/check.test.mjs`.

## 4. Актуализация

- [x] 4.1 Сайт, обе версии: `05 CLI и конфигурация` — флаг `--format`, модель замечания, `--json`; `07 Docker и CI` — фрагменты GitHub Actions (изменённые файлы PR → `--format github`) и GitLab CI (`--format gitlab` → `artifacts: reports: codequality`, `when: always`), замена `find … -exec check` на вариант с отчётом; `08 Агенты` — `check --format json` для разбора. Проверка: тест `docs-parity` зелёный, сайт собирается (`cd docs/ru && NO_UPDATE_NOTIFIER=1 node ../../dist/index.js`).
- [x] 4.2 `skills/c4builder/SKILL.md` (цикл check: `--format json` как стабильный разбор вместо пяти форм строки), `skills/c4builder-setup` — если там есть CI, `template/AGENTS.md`. Проверка: тест `skills` зелёный.
- [x] 4.3 Строка в `## Unreleased` `CHANGELOG.md` (issue #65).
- [x] 4.4 Полный прогон: `npm run build`, `npm run check`, `npm test`. Golden не меняется.

## 5. Правки по ревью

- [x] 5.1 Структура у источника (design §1 переписан): `src/core/render/problem.ts` — `DiagramProblem`, `problemText` (печатная строка байт в байт прежняя), базовый `DiagramError` (`details` + `problems`), guard `isDiagramError`, `errorText`. `warnDiagram(file, problem)`, слушатель `(file, problem)`, `check` берёт путь из слушателя. `BpmnError`/`MermaidError`/`WireflowError`/`D2Error` — `DiagramError`; `lintBpmn`, раскладка BPMN, `renderWireflowSvg`, `plantumllint` отдают структуры; PlantUML — `line`/`message` из `PUML_ERROR`. `parseProblem` и экспорт `UNDECLARED_REL_RE` удалены. Проверка: ожидания `bpmn`/`mermaid`/`wireflow`/`check` не менялись (в `bpmn.test`/`wireflow.test` помощник переводит структуру в строки через `problemText`).
- [x] 5.2 Префикс `<element>: ` в github/gitlab — по `elementInMessage`, а не по подстроке. Проверка: юнит-тест с id `e`/`a`.
- [x] 5.3 Позиция, вписанная движком в текст (XML moddle, `JSON.parse`, mermaid `on line N, column M`/`at offset`), — в `line`/`column`, из `message` убрана, печать прежняя (`text`). Проверка: юнит-тесты на каждый случай, e2e `broken.bpmn`/`broken.wireflow.json`.
- [x] 5.4 `reportBase` и каталоги файлов — физический путь (`realpath` с fallback). Проверка: юнит-тест и e2e с `GITHUB_WORKSPACE` через симлинк.
- [x] 5.5 `--files-from <file>` (`-` — stdin), объединение с аргументами, пустой список → пустой отчёт и код 0 (в `text` — 0 без вывода). Проверка: e2e stdin, файл, пустой stdin, объединение, нет файла.
- [x] 5.6 `--format`/`--files-from` с другой командой или сборкой — ошибка на английском и код 1. Проверка: e2e `doctor --format json`, `--files-from` без команды.
- [x] 5.7 Явный выход в обоих режимах и при коде 0 — `process.exit` из колбэка записи stdout/stderr.
- [x] 5.8 Дедуп замечаний отчёта по всем полям. Проверка: юнит-тест и e2e — два `.d2` импортируют битый lib → одно замечание.
- [x] 5.9 Брошенное не-`Error` — `String(e)`. Проверка: юнит-тест `errorDiagnostics`.
- [x] 5.10 Лог JRE передаётся в проверку параметром, модульного `logToStderr` нет.
- [x] 5.11 Общий `src/util/text.ts`: `escapeRegExp` (вместо копий в `markdown.ts`, `reviewlog.ts`, `check.problems.ts`) и `positionAt` (вместо `lineOf` mermaid и подсчёта в `locate`).
- [x] 5.12 Один цикл по файлам для `text` и машинного формата (`checkFiles`); D2 — ответ движка разбирается один раз (`d2Failure`) и для `message`, и для `details`.
- [x] 5.13 Сайт RU+EN: `07 Docker и CI` — `git -c core.quotePath=false diff --name-only … | c4builder check --format … --files-from -` (GitLab — от `$CI_MERGE_REQUEST_DIFF_BASE_SHA`, `node:24`), pathspec wireflow как в `03 Диаграммы`, версия закреплена `0.15.0` с пометкой; `05 CLI и конфигурация` — `--files-from`, описание `line`/`column`/`message`, fingerprint, дедуп. `skills/c4builder*`, `template/AGENTS.md`, CHANGELOG. Проверка: `docs-parity`, `skills`, `openspec validate check-output-format --strict`.

## Workflow follow-up

- PR закрывает issue #65 и строится поверх PR #76. После merge #76 перебазировать на master,
  после merge этого PR — заархивировать change (после архива `check-undeclared-rel`).
