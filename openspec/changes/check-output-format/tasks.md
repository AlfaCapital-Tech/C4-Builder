# Tasks

## 1. Модель замечания и разбор текста движков

- [x] 1.1 Новый модуль `src/cli/commands/check.problems.ts`: тип `Diagnostic` (`file` абсолютный, `line`, `column`, `engine`, `severity`, `rule`, `element`, `message`), `parseProblem(engine, text)` по грамматикам design §1 и `locate(source, element, engine)` (design §4). `plantumllint.ts` экспортирует шаблон строки undeclared-rel, и разбор использует его. Проверка: юнит-тест `test/check-report.test.mjs` на каждую грамматику (puml `line N:`, undeclared-element, bpmn `id [rule] msg` и `-`, bpmn `id: msg`, `ENOENT: …` у не-BPMN без element, wireflow `card "a": …` и `edge #0`, mermaid без строки) и на `locate` (BPMN атрибут с `'`/`"`, wireflow минифицированный и форматированный JSON, id не найден → `null`).
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

## Workflow follow-up

- PR закрывает issue #65 и строится поверх PR #76. После merge #76 перебазировать на master,
  после merge этого PR — заархивировать change (после архива `check-undeclared-rel`).
