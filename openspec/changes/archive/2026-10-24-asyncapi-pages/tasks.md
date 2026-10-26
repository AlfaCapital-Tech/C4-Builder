# Tasks

## 1. Вендор и плагин

- [x] 1.1 `vendor/asyncapi/` из `@asyncapi/react-component@3.2.2`: `asyncapi-standalone.js`, `asyncapi.css`, `LICENSE`, `THIRD-PARTY-LICENSES.txt`, `README.md` (версия, обновление). Проверка: `npm pack --dry-run` включает файлы; в бандле нет загрузок с CDN (`unpkg`, `jsdelivr`, `cdnjs`).
- [x] 1.2 `src/plugins/openapi/index.ts`: `readSpec` с `kind`, копирование бандла и стиля в `vendor/plugins/openapi/` только при AsyncAPI-спеках, страница AsyncAPI с ленивой загрузкой, текст предупреждения. Проверка: тесты 1.3.
- [x] 1.3 `test/plugin-openapi.test.mjs`: AsyncAPI рядом с OpenAPI в одной папке — оглавление, страница с `AsyncApiStandalone.render` и спекой по относительному пути, бандл и стиль в выходе, `index.html` их не подключает; сайт без AsyncAPI — файлов компонента нет; предупреждение только для файлов без ключей. Проверка: `npx vitest run test/plugin-openapi.test.mjs` зелёный.

## 2. Актуализация

- [x] 2.1 «06 Плагины» RU/EN (раздел `openapi`), `skills/c4builder/references/plugins.md`, `CHANGELOG.md`. Проверка: `docs-parity`, `skills` зелёные.
- [x] 2.2 `npm run build && npm test && npx biome ci src test` зелёные; `openspec validate asyncapi-pages --strict`; публичность: `grep -rniE --exclude=tasks.md "alfacapital\.ru|artifactory|harbor" openspec/changes/asyncapi-pages docs/ru/src docs/en/src skills CHANGELOG.md` пуст.
- [x] 2.3 Ручная проверка в браузере на рабочем проекте с AsyncAPI-спекой: страница отрисована, без сети работает.
