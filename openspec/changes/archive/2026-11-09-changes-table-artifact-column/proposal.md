# Proposal

## Why

Таблица Changes показывает только метаданные `.openspec.yaml` (опция `columns`). Кто должен
сделать ревью change'а, записано в таблице статусов `review.md` (строка — ревьюер, статус,
имя, дата), и чтобы узнать, на ком висит ревью, приходится открывать каждый change.

## What Changes

- Второй вид элемента `columns`: `{ title, artifact, column, whenEmpty?, exclude? }` — значения
  колонки `column` первой markdown-таблицы артефакта `artifact`, у строк с пустой колонкой
  `whenEmpty` (без неё — все строки), кроме значений по regex `exclude` (например имена
  инструментов), каждое с новой строки; нет артефакта, таблицы или значений — `—`.
  Пример: `{ "title": "Awaiting review", "artifact": "review", "column": "Who", "whenEmpty": "Status" }`.
- Прежний вид `{ key, title }` без изменений.
- Раскладка таблиц Changes: обёртка `<div class="c4b-openspec-changes">` и CSS-ассет плагина
  `vendor/openspec/changes.css` — фиксированные ширины служебных колонок, остаток — Change,
  одна раскладка во всех секциях; с длинными именами change'ов и новой колонкой браузер иначе
  сжимал и переносил все колонки, по-своему в каждой секции.

## Capabilities

### Modified Capabilities
- `openspec-plugin`: требование «Колонки таблицы из `.openspec.yaml`» — колонка из таблицы артефакта.

## Impact

- Код: `src/plugins/openspec/index.ts` (схема опции, ассет), `src/plugins/openspec/render.ts`
  (разбор таблицы, значение ячейки, обёртка таблицы), `vendor/openspec/changes.css`.
- Тесты: `test/plugin-openspec.test.mjs`, describe `опция columns`.
- Документация: `docs/{ru,en}/src/06 …/README.md`, `skills/c4builder/references/plugins.md`,
  `CHANGELOG.md`.
