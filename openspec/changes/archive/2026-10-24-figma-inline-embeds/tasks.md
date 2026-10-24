# Tasks

## 1. Плагин

- [x] 1.1 `src/plugins/figma/index.ts`: `embedFigmaImages` (картинка одна на строке → ссылка + iframe, в тексте → ссылка, код и битые ссылки — без изменений, предупреждение), обход `ctx.tree` в `afterScan`, `frames` с `default([])`, строка лога с числом эмбедов. Проверка: `test/plugin-figma.test.mjs` — эмбед на странице проекта, inline, код, битая ссылка, markdown-выход, `frames` необязателен.

## 2. Актуализация

- [x] 2.1 «06 Плагины» RU/EN (раздел `figma`), `skills/c4builder/references/plugins.md`, `CHANGELOG.md`. Проверка: `docs-parity`, `skills` зелёные.
- [x] 2.2 `npm run build && npm test && npx biome ci src test` зелёные; `openspec validate figma-inline-embeds --strict`.
- [ ] 2.3 Ручная проверка в браузере: эмбед на странице design.md OpenSpec-change'а рабочего проекта.
