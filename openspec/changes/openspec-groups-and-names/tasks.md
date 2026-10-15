# Tasks

## 1. Раскладка и рендер

- [x] 1.1 `layout.ts`: `Placement.group`, опция `groupKey` в `layoutChanges` (D1, D2), `groupNames`, порядок групп в `pageOrder` (D3). Проверка: `npm run build && npx vitest run test/plugin-openspec.test.mjs` — сценарии «Change'ы двух команд», «Вложенные — в группе родителя», «Коллизия с id change'а».
- [x] 1.2 `render.ts`: секции `### <группа>` / `### Ungrouped` в `renderChangesIndex` и `renderArchiveIndex`, параметр `sections` (D4). Проверка: сценарии «Секции таблицы и страница группы», «Архив».
- [x] 1.3 `index.ts`: опция `groupKey`, страница группы перед первым её change'ем. Проверка: прежние тесты плагина зелёные без правок; `npx biome ci .` и `npx tsc --noEmit` без ошибок.
- [x] 1.4 `layout.ts` и `index.ts`: опция `nameKey` — подпись и сегмент пути change'а верхнего уровня, уникальность в папке, откат на id (D5). Проверка: сценарии «Имя вместо id», «То же имя в разных группах», «Повтор имени в одной папке», «Недопустимое имя».
- [x] 1.5 `render.ts` и `index.ts`: опция `columns` — колонки таблицы Changes, сводки и страниц групп, экранирование `|`, прочерк без значения (D6). Проверка: сценарий «Исполнитель в таблице».
- [x] 1.6 `scan.ts`: значение `.openspec.yaml` в кавычках читается целиком, `#` внутри — не комментарий; `layout.ts`: `#` и `?` в группе и имени — недопустимы (D2). Проверка: сценарии «Значение в кавычках», «Недопустимое имя».

## 2. Актуализация

- [x] 2.1 Страница «Плагины» в `docs/ru/src/06 Плагины` и `docs/en/src/06 Plugins`: пункты о `groupKey` и `nameKey`, строки таблицы опций. Проверка: тест `docs-parity` зелёный.
- [x] 2.2 `skills/c4builder/references/plugins.md` — строка таблицы опций. Проверка: тест `skills` зелёный.
- [x] 2.3 `CHANGELOG.md` — строка в `## Unreleased`. Проверка: `npm test` зелёный (кроме известного падения `plugins-source` → «archive tar.gz» на macOS).
