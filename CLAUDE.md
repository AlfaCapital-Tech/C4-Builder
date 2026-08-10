# C4-Builder

CLI-генератор архитектурной документации: markdown + PlantUML/D2 → docsify-сайт / markdown.
TypeScript, ESM, Node ≥ 20.19. Публичный репозиторий — никаких внутренних хостов и секретов.

## Команды

```bash
npm run build        # tsc → dist/
npm test             # vitest, все тесты (golden требует java или скачает JRE)
npm run test:unit    # без golden
npm run test:golden  # golden-снапшоты рендера; UPDATE_GOLDEN=1 — переснять
npm run check        # biome ci (линт + формат)
```

## Структура

- `src/cli/` — commander, диспетчер и команды (`--site`, `jre`, `--new`…)
- `src/config/` — `.c4builder`: schema (zod), defaults, options
- `src/core/` — scan (дерево исходников) → compose (markdown) → render
  (plantuml.ts — прямой java+Smetana; d2renderer.ts — WASM; pngraster.ts — resvg)
- `vendor/` — PlantUML jar, шрифты Nimbus Sans, docsify — вендорено, руками не трогать
- `template/` — шаблон `--new`; `test/golden.test.mjs` — эталонные снапшоты

## Правила

- Комментарии в коде — на русском, объясняют «почему», а не «что».
- Рендер детерминирован: вендорный шрифт, пин версий jar/d2. Любое изменение рендера —
  прогнать `test:golden` (на Arch golden может краснеть из-за fontconfig — известно).
- Конфиг-схема нестрогая: неизвестные ключи `.c4builder` молча отбрасываются.
- Релиз — только пуш тега `v*` (npm через OIDC + docker в GHCR), см. README «Releasing».
  Merge в master сам по себе ничего не публикует (только docker-тег `edge`).
- Коммиты без номеров задач (публичный репо), сообщения — на русском.
