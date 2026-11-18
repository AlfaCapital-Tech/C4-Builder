# Tasks

## 1. Проверка `.md` в `check`

- [x] 1.1 В `src/cli/commands/check.ts` выделить из `checkPlantUml` общий рендер текста PlantUML
  (`content`, `includePath`, `log`; ditaa → PNG) без изменения поведения `.puml`/`.iuml`.
  Проверка: `npm run build && npx vitest run test/check.test.mjs` — зелёный без правок тестов.
- [x] 1.2 Добавить проверку `.md` и запись `'.md'` (движок `plantuml`) последним ключом
  `CHECKERS`: блоки через `createFenceExtractor(['plantuml'])`, `includePath` — папка файла,
  строка ошибки `+ lineOffset`, `warnUndeclaredRels` с `lineOffset`, ошибки входа всех блоков —
  одной `DiagramError`, сбой не по входу — сразу (design, решения 1–5). Комментарии — на
  русском, сообщения — на английском. Проверка: тесты 1.3.
- [x] 1.3 Тесты текстового режима в `test/check.test.mjs` по сценариям
  `specs/cli-commands`: корректный блок; блок без `@startuml`; строка файла в ошибке (блок с
  обёрткой и без — номер одинаков); три блока, два с ошибкой → две строки `✗`; одинаковые
  блоки → одна строка; `.md` без диаграмм → `✓`; битые `puml`/`d2`/`mermaid`/`text` не
  проверяются; `!include` из папки файла; блок в пункте списка; каталог после запуска без новых
  файлов. Проверка: `npx vitest run test/check.test.mjs`.
- [x] 1.4 Тесты предупреждений по `specs/diagram-semantic-checks`: `⚠ <file>.md: line N` для
  блока с обёрткой и без, `--strict` → `✗ … 2 warning(s), failing with --strict`, код 1.
  Проверка: тот же прогон.
- [x] 1.5 Обновить ожидаемый список расширений в тесте неподдерживаемого расширения
  (`test/check.test.mjs`, сейчас `…\.mmd or \.wireflow\.json`) и убедиться, что остальные
  тесты `check` для прежних расширений проходят без правок. Проверка: тот же прогон.

## 2. Машинные форматы

- [x] 2.1 Тесты `--format json` и `--format github` для `.md` по сценариям
  `specs/check-output-formats` и `specs/diagram-semantic-checks`: `file` — путь `.md`, `line` —
  строка файла, `engine: "plantuml"`, два блока → два замечания по порядку, `.md` без диаграмм
  → `[]`, предупреждение → `severity: "warning"`, `rule: "undeclared-element"`. Если тест
  краснеет — поправить сборку замечаний в `check.ts`. Проверка: `npx vitest run test/check.test.mjs`.

## 3. Справка

- [x] 3.1 `src/cli/help.ts`, команда `check`: в `about` — что в `.md` проверяются только блоки
  ` ```plantuml `; в таблице вывода — что строка ошибки блока считается от начала файла `.md`.
  Проверка: `node dist/index.js check --help` содержит `.md`; тесты справки и `cli-language`
  зелёные (`npm run test:unit`).

## 4. Актуализация

- [x] 4.1 Страница «Диаграммы», раздел о `check`, в `docs/ru/src/03 Диаграммы/README.md` и
  `docs/en/src/03 Diagrams/README.md`: `.md` в списке расширений; абзац о блоках `plantuml`
  (только этот язык, строка ошибки — строка файла `.md`, `!include` от папки файла, все блоки за
  один запуск); `'*.md'` в примере pre-commit. Проверка: тест `docs-parity` зелёный.
- [x] 4.2 Строка `c4builder check` в таблице команд «CLI и конфигурация» (RU и EN) — `.md`
  (блоки `plantuml`). Проверка: `docs-parity`, сборка сайта как в `pages.yml` —
  `cd docs/ru && NO_UPDATE_NOTIFIER=1 node ../../dist/index.js` (и то же в `docs/en`) без ошибок.
- [x] 4.3 `skills/c4builder/SKILL.md` (шаг проверки: `.md` с блоками `plantuml`, например
  артефакты OpenSpec) и `template/AGENTS.md` (список расширений в строке `c4builder check`).
  Проверка: тест `skills` зелёный.
- [x] 4.4 `CHANGELOG.md`: секция `## Unreleased` со строкой о проверке блоков `plantuml` в `.md`
  командой `check` (issue #91). README не трогаем — quickstart не меняется.
- [ ] 4.5 Итоговая проверка: `npm run build && npm run test:unit && npm run check` зелёные;
  рендер сборки не менялся — `test:golden` не обязателен. Вручную:
  `node dist/index.js check openspec/changes/check-markdown-plantuml/design.md` → `✓`, код 0.

## 5. Правки по ревью

- [x] 5.1 Строка `.md` в ошибке блока: позиция движка считается от `@start…` —
  `plantUmlLineBase` в `src/core/render/diagrams.ts` (чистая функция, поле `line` у
  `PlantUmlInputError`), применяется в `checkMarkdown`; `.puml` и сборка не меняются.
  Проверка: тесты `lead.md`/`mention.md`/`indent.md` в `test/check.test.mjs`, юнит-тест
  `plantUmlLineBase` в `test/build-errors.test.mjs`.
- [x] 5.2 Обёртка `@startuml` в `src/core/scan/fences.ts` — по директиве в начале строки.
  Проверка: тест экстрактора в `test/plugin-openspec-fences.test.mjs`, страница `D` в
  `test/page-fences.test.mjs`, `npm run test:golden`.
- [x] 5.3 Машинный отчёт: замечания одного `.md` — по возрастанию строки (`byLine` у записи
  `.md`), текстовый режим прежний. Проверка: тест `mix.md` в `test/check.test.mjs`.
- [x] 5.4 Сбой процесса на блоке — замечание блока со строкой его начала, проверка остальных
  блоков продолжается; java резолвится один раз до цикла. Проверка: тест `crash.md` с подставной
  `java` (через `JAVA_HOME`, на Windows пропускается) в `test/check.test.mjs`.
- [x] 5.5 Уборка: мёртвая ветка `p.line === undefined`, лишний аргумент `source` у `extract`,
  один `lineOf` на уровне модуля в `test/check.test.mjs`. Проверка: `npx vitest run
  test/check.test.mjs`, biome.
- [x] 5.6 Дельта-спеки и design: сценарии «строки перед `@startuml`», «упоминание `@startuml` в
  тексте блока», требования «Сбой рендера блока не прерывает проверку файла» и «Порядок
  замечаний файла Markdown»; решения 3, 4, 7, 8 в `design.md`. Проверка:
  `openspec validate check-markdown-plantuml --strict`.
