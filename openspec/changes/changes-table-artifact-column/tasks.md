# Tasks

## 1. Реализация

- [x] 1.1 `index.ts`: `columns` — union `{ key, title }` | `{ title, artifact, column, whenEmpty?, exclude? }` (strict, `exclude` — валидный regex). Проверка: `plugins-load` — неизвестный ключ элемента и невалидный `exclude` отклоняются, оба вида элементов проходят.
- [x] 1.2 `render.ts`: тип `TableColumn`, разбор markdown-таблицы артефакта (`artifactColumnValues`), значение ячейки по виду колонки. Проверка: describe `опция columns` — сценарий review.md (пустой статус → имена с новой строки; нет артефакта — `—`; `\|` в ячейке); unit `artifactColumnValues` — CRLF, `:---:`, таблица без тела, fenced-блок, `---` без `|`.
- [x] 1.3 `vendor/openspec/changes.css` + `assets.styles` плагина, обёртка `<div class="c4b-openspec-changes">` в `renderChangesIndex`. Проверка: тест — обёртка в Changes.md, файл в `dist/vendor/plugins/openspec/`, ссылка в `index.html`; `offline-site` зелёный.
- [x] 1.4 `progressBar`: класс `c4b-progress-done` при всех закрытых задачах, стиль `accent-color` цветом темы. Проверка: тест — `ios` с tasks 2/2 имеет класс, `dig-1-alpha` 1/3 — нет.

## 2. Актуализация

- [x] 2.1 `docs/ru/src/06 Плагины/README.md`, `docs/en/src/06 Plugins/README.md` (абзац `columns` и строка таблицы опций), `skills/c4builder/references/plugins.md`, `CHANGELOG.md` `## Unreleased`. Проверка: `docs-parity`, `skills` зелёные.
- [x] 2.2 `npm run build && npm test && npm run check`, `openspec validate changes-table-artifact-column --strict`.
