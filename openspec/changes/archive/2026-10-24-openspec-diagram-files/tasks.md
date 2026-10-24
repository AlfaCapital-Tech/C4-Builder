# Tasks

## 1. Плагин

- [x] 1.1 `src/plugins/openspec/render.ts`: картинка-ссылка на файл диаграммы (`engineForFile`) → `PageDiagram` (`soft`), источник страницы, имя с хэшем пути при совпадении имён. Проверка: `test/plugin-openspec.test.mjs` — `.puml` рендерится, исходник не копируется, битый `.mmd` — заглушка.

## 2. Актуализация

- [x] 2.1 «06 Плагины» RU/EN (раздел `openspec`), `skills/c4builder/references/plugins.md`, `CHANGELOG.md`. Проверка: `docs-parity`, `skills` зелёные.
- [x] 2.2 `npm run build && npm test && npx biome ci src test` зелёные; `openspec validate openspec-diagram-files --strict`.
- [x] 2.3 Ручная проверка: wireflow в design.md OpenSpec-change'а рабочего проекта отображается картинкой.
