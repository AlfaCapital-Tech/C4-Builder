## Context

Формат выхода диаграммы задаёт `diagramOutputFormat(diagram, options)`:
D2 → всегда `svg`, ditaa → всегда `png`, иначе → `DIAGRAM_FORMAT`. `renderDiagram`
зовёт `java ... -t${format} -pipe`, то есть PlantUML сейчас растеризует PNG сам
(AWT). D2 (`renderD2`) отдаёт только SVG. Итог: при `png` PlantUML даёт PNG, а D2 —
SVG (непоследовательно), и PlantUML-PNG недетерминирован по JVM/платформе.

Этот change идёт **строго после** `plantuml-java-direct` (java-direct + Smetana +
вендорный шрифт → детерминированный SVG) и `d2-backend` (D2→SVG со вшитыми шрифтами).
Оба уже в архиве. resvg — тонкая стадия поверх их SVG-выхода.

## Goals / Non-Goals

**Goals:**
- Единый детерминированный SVG→PNG для обоих движков без браузера.
- D2 начинает честно поддерживать `DIAGRAM_FORMAT=png`.
- Кириллица и повторяемость PNG за счёт вендорного шрифта.
- Ленивая загрузка растеризатора: SVG-проекты и «только ditaa» его не тянут.

**Non-Goals:**
- Трогать ditaa (остаётся нативный PlantUML-PNG; golden `ditaa.png` неизменен).
- Конфигурируемый DPI/масштаб PNG (стартуем с 1:1; при спросе — отдельная фича).
- Расширять основной golden-fixture на PNG (fixture остаётся svg; для PNG —
  отдельная проверка детерминизма, см. Open Questions).

## Decisions

### Единый растеризатор поверх SVG вместо нативного PNG
PlantUML для не-ditaa при `png` рендерится в **SVG** (`-tsvg`), затем resvg → PNG.
D2-SVG так же → PNG. Одна стадия, один растеризатор, одинаковый результат для обоих
движков и детерминизм лучше AWT.
*Альтернатива* — оставить нативный PlantUML `-tpng` и добавить SVG→PNG только для D2:
отвергнута — два разных PNG-рендера, D2 и PlantUML визуально расходятся, недетерминизм
AWT сохраняется.

### resvg-js, а не sharp/canvas/headless
`@resvg/resvg-js` — Rust + napi, prebuilt-бинари, без браузера и без системных
зависимостей, ~120 мс/диаграмма (замерено). Согласуется с линией «ноль внешних
зависимостей».
*Альтернатива* — puppeteer/headless (только что выпилили с PDF) или node-canvas
(нужен нативный toolchain/cairo): отвергнуты.

### Шрифт: vendor/fonts + loadSystemFonts:false
resvg должен рисовать текст сам. PlantUML-SVG ссылается на шрифт по имени
(`Liberation Sans`) — resvg обязан загрузить файл из `vendor/fonts/`. D2-SVG несёт
шрифт во вшитом `@font-face` (base64), но `loadSystemFonts:false` фиксируем всё равно,
чтобы исключить платформенный fallback. Конфиг: `font: { fontDirs: [FONTS_DIR],
defaultFontFamily: DEFAULT_FONT_NAME, loadSystemFonts: false }`.

### Ленивая загрузка и «нужен ли PNG вообще»
Растеризатор грузится (`require`) лениво в модуле `pngraster.js`, только если в дереве
есть хотя бы одна не-ditaa диаграмма при `DIAGRAM_FORMAT=png`. Отсутствие пакета в этот
момент — понятная ошибка с подсказкой (по образцу ленивого D2).

### Точка вклинивания в generateImages
В `generateImages` после получения буфера рендера: если целевой формат PNG и диаграмма
не ditaa — прогнать SVG-буфер через resvg перед `writeFile`. Для PlantUML это значит
рендерить `svg` внутри, а имя/формат выхода (`diagramOutputFormat` → `png`) и кэш
остаются как есть. ditaa-ветка (`isDitaa` → нативный `png`) не меняется.

## Risks / Trade-offs

- **PNG существующих png-проектов визуально изменится** (resvg vs AWT) → приемлемо и
  осознанно: детерминированнее и единообразнее; png — вторичный формат («коллеги
  иногда»). Отметить в change-логе.
- **Native prebuilt-бинарь в офлайн-корпсреде** (`@resvg/resvg-js-linux-x64-gnu`) →
  зеркало Artifactory npm должно отдавать нужный платформенный пакет; проверить, что
  ставится без сети после первого `npm ci`. Возможен musl/gnu-нюанс.
- **Детерминизм PNG завязан на версию resvg** (растровый выход может дрогнуть между
  версиями resvg, как `ditaa.png` между JRE) → пинуем версию resvg; PNG в golden — с
  оглядкой (см. Open Questions).
- **Забыли развести svg-рендер и png-выход для PlantUML** → тест: при `png` не-ditaa
  `.puml` даёт валидный PNG, ditaa — прежний байт-в-байт.

## Open Questions

- Покрывать ли PNG golden-эталоном? Вариант: отдельный мини-прогон с `png` +
  проверка «два прогона идентичны», без калибровки байтов под CI (или с пином resvg).
  Решить при написании теста.
- Дефолтный масштаб PNG: 1:1 к SVG-размеру против фикс-DPI. Стартуем с 1:1;
  конфигурируемость — вне объёма.
