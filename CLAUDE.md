# C4-Builder

CLI-генератор архитектурной документации: markdown + PlantUML/D2 → docsify-сайт / markdown.
TypeScript, ESM, Node ≥ 22.17. Публичный репозиторий — никаких внутренних хостов и секретов.

## Команды

```bash
npm run build        # tsc → dist/
npm test             # vitest, все тесты (golden требует java или скачает JRE)
npm run test:unit    # без golden
npm run test:golden  # golden-снапшоты рендера; UPDATE_GOLDEN=1 — переснять
npm run check        # biome ci (линт + формат)
```

## Структура

- `src/cli/` — commander, диспетчер и команды (`--site`, `jre`, `check`, `--new`…)
- `src/config/` — `.c4builder`: schema (zod), defaults, options
- `src/core/` — scan (дерево исходников) → compose (markdown) → render
  (plantuml.ts — прямой java+Smetana; d2renderer.ts — WASM; pngraster.ts — resvg)
- `src/core/plugins/` — система плагинов: контракт (`types.ts`), загрузчик (`load.ts`),
  виртуальные страницы (`tree.ts`), хуки, ассеты, резолвер источников (`source.ts`)
- `src/plugins/` — встроенные плагины (`openspec`, `openapi`); реестр — `index.ts`
- `vendor/` — PlantUML jar, шрифты Nimbus Sans, docsify — вендорено, руками не трогать
- `template/` — шаблон `--new`; `test/golden.test.mjs` — эталонные снапшоты
- `docs/` — сайт документации, собирается самим c4builder: `ru/` (основной) и `en/` —
  отдельные проекты (`.c4builder` + `src/`), `landing/` — лендинг, `docsify-template.mjs` —
  шаблон без внешних ресурсов; сборка и публикация — `.github/workflows/pages.yml`.
  Локально: `cd docs/ru && node ../../dist/index.js --site -w`

## Правила

- Комментарии в коде — на русском, объясняют «почему», а не «что».
- Пользовательский вывод CLI (сообщения, ошибки, тексты, которые сборка вставляет в выходы) —
  только на английском; кириллица в строковых литералах `src/` ловится тестом `cli-language`.
- Рендер детерминирован: вендорный шрифт, пин версий jar/d2. Любое изменение рендера —
  прогнать `test:golden` (на Arch golden может краснеть из-за fontconfig — известно).
- Конфиг-схема нестрогая: неизвестные ключи `.c4builder` молча отбрасываются.
- Релиз — только пуш тега `v*` (npm через OIDC + docker в GHCR), см. страницу сайта
  «Разработка» (`docs/ru/src/09 Разработка`). Merge в master сам по себе пакет не публикует
  (только docker-тег `edge` и обновление сайта).
- Пользовательское изменение (фича, фикс, поведение CLI) — строка в `## Unreleased` файла
  `CHANGELOG.md` в том же PR; релизный коммит переименует секцию в `## vX.Y.Z`.
- Изменение поведения — правка страницы сайта в обеих версиях (`docs/ru/src`, `docs/en/src`)
  в том же PR. Набор страниц RU и EN одинаков (тест `docs-parity`); README — только питч,
  quickstart и ссылки, справочник туда не возвращать.
- Изменились флаги, подкоманды, ключи `.c4builder` или требования (Node, Java) — в том же PR
  актуализировать `skills/*` (включая `references/`) и `template/AGENTS.md`. Тест `skills`
  ловит только ссылки на несуществующее, новое за тебя не допишет. `llms.txt` руками не
  трогать — он генерируется сборкой сайта.
- Коммиты без номеров задач (публичный репо), сообщения — на русском.
