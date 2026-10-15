# Tasks

## 1. Раскладка и рендер

- [x] 1.1 `scan.ts`: `readMeta` читает все скаляры верхнего уровня `.openspec.yaml` в `Change.meta`, `schema`/`created` — как раньше (design D1). Проверка: существующие тесты `test/plugin-openspec.test.mjs` зелёные без правок.
- [x] 1.2 `layout.ts`: `layoutChanges` и `pageOrder` по design D2–D5 (путь, подпись-хвост с откатом на полный id, один уровень, архив без даты). Проверка: `npm run build && npx vitest run test/plugin-openspec.test.mjs` — сценарии «Корень и подзадачи», «Хвост совпадает с подстраницей родителя», «Родитель не найден», «Архив» из `specs/openspec-plugin`.
- [x] 1.3 `render.ts`: `renderChangesIndex`, `renderSummary`, `renderArchiveIndex`, `renderChange` принимают раскладку последним необязательным параметром; строки `↳`, пункты архива под родителем, `**Parent:**` / `**Sub-changes:**`. Проверка: сценарий «Таблица и связи на страницах».
- [x] 1.4 `index.ts`: опция `parentKey` (`z.string().min(1).optional()`), раскладки для Changes и Archive, страницы — в порядке `pageOrder`. Проверка: сценарий «Опция не задана» — та же фикстура без опции даёт плоский список; `npx biome ci .` и `npx tsc --noEmit` без ошибок.

## 2. Актуализация

- [x] 2.1 Страница «Плагины» в `docs/ru/src/06 Плагины` и `docs/en/src/06 Plugins`: пункт о `parentKey` и строка таблицы опций. Проверка: тест `docs-parity` зелёный.
- [x] 2.2 `skills/c4builder/references/plugins.md` — строка таблицы опций `openspec`. Проверка: тест `skills` зелёный.
- [x] 2.3 `CHANGELOG.md` — строка в `## Unreleased`. Проверка: `npm test` зелёный (кроме известного падения `plugins-source` → «archive tar.gz» на macOS, не связанного с изменением).
