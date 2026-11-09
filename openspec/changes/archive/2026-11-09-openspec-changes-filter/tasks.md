# Tasks

## 1. Реализация

- [x] 1.1 `index.ts`: опция `filter` — массив заголовков, `superRefine`: каждый — `Schema` или `title` элемента `columns`, иначе ошибка с перечнем допустимых; скрипт — ассет `{ name: 'changes-filter.js', content }` из `filter.script.ts`. Проверка: `plugins-load` — `filter: ["Tasks"]` и неизвестный заголовок отклоняются, `["Schema", "Assignee"]` проходит.
- [x] 1.2 `render.ts`: `renderChangesIndex` и `renderSummary` получают `filter`, обёртка — `data-c4b-filter` с номерами колонок в порядке таблицы. Проверка: `plugin-openspec` — атрибут `2,5` (Schema, Assignee в порядке таблицы), страница группы и секции с `filter: ['Schema']` без `columns` — `2`, без опции атрибута нет; скрипт в `dist/vendor/plugins/openspec/`, ссылка в `index.html`; `offline-site` зелёный.
- [x] 1.3 `src/plugins/openspec/filter.script.ts` (строка, ассет `{ name, content }`): docsify-плагин (`doneEach`) — строка выпадающих списков (`<details>`, флажки, поиск от восьми значений, один открытый), значения по строкам ячейки, выбор в `localStorage`, И между колонками, `↳` и приглушённый родитель, скрытие пустой секции с `h3`, счётчик, сброс; стили списков и приглушённой строки — строкой в `filter.style.ts`, ассет `changes-filter.css`. Проверка: новый `test/openspec-changes-filter.test.mjs` (jsdom) — сценарии спеки, включая поиск, один открытый список, недоступное хранилище и повторный `doneEach`.
- [x] 1.4 `src/core/plugins/types.ts`, `assets.ts`: ассет `{ name, content }` рядом с путём файла — запись в `dist/vendor/plugins/<plugin>/<name>`. Проверка: `plugins-tree` — `inline.js` в выходе и в `index.html`; шаблон, уже подключивший это имя, — файл записан, тег не задвоен.
- [x] 1.5 Стиль раскладки таблиц `vendor/openspec/changes.css` → строка `CHANGES_CSS` в `src/plugins/openspec/changes.style.ts`, ассет `{ name: 'changes.css', content }`; в `vendor/` у плагина ничего не остаётся. Проверка: `plugin-openspec` — `vendor/plugins/openspec/changes.css` в выходе и в `index.html`.

## 2. Актуализация

- [x] 2.1 `docs/ru/src/06 Плагины/README.md`, `docs/en/src/06 Plugins/README.md` (абзац `filter`, строка таблицы опций, пример контракта плагина), `skills/c4builder/references/plugins.md`, `CHANGELOG.md` `## Unreleased`. Проверка: `docs-parity`, `skills` зелёные.
- [x] 2.2 `npm run build && npm test && npm run check`, `openspec validate openspec-changes-filter --strict`.
