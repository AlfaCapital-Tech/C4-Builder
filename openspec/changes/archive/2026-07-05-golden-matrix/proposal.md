# golden-matrix — матрица golden-конфигураций + пин JVM

## Why

Два триггера, оба блокируют предстоящий TS-порт с рефакторингом compose-слоя:

1. **Односторонняя сетка.** Golden-тест гоняет один fixture-конфиг (website + md +
   complete-md, svg, navigation/TOC/breadcrumbs). Ветки `embedDiagram`,
   `includeLinkToDiagram`, `diagramsOnTop`, `excludeOtherFiles` и png-растеризация
   (resvg) эталоном не зафиксированы. Рефакторинг `build.js` (три копии замыкания
   `getDiagram` — build.js:459/587/687) без покрытия этих веток — прыжок веры.
2. **Периодические расхождения локально/CI.** Требование «локальный прогон совпадает
   с CI» нарушается: одинакового мажора JDK недостаточно. Дистрибутивные сборки
   OpenJDK (напр. Arch линкует системный freetype) дают иные метрики шрифта, чем
   Temurin на CI, → другие `textLength`/координаты в SVG → ложные диффы эталона.

## What Changes

- Golden-тест параметризуется **матрицей fixture-конфигураций** поверх одних и тех же
  исходников `template/src`:
  - `default` — текущий конфиг (website + md + complete-md, svg, navigation/TOC/breadcrumbs);
  - `links-top` — `includeLinkToDiagram` + `diagramsOnTop` + `excludeOtherFiles`,
    без navigation/TOC/breadcrumbs (противоположные значения переключателей default);
  - `embed-png` — `embedDiagram` + `diagramFormat=png` (растеризация SVG→PNG через
    resvg, нативный ditaa-PNG, base64-встраивание в md).
- Эталон реорганизуется: `test/golden/<variant>/` (manifest.json + tree/) вместо
  единого `test/golden/`. `UPDATE_GOLDEN=1` регенерирует все варианты разом.
- **Golden-сборки идут на пиновом managed JRE**: тест-хелпер прогревает кеш
  jre-резолвера (Temurin 21) и подставляет `JAVA_HOME` на него при запуске CLI —
  одна и та же JVM локально и на CI, системная java в golden больше не участвует.
  Продуктовый код не меняется (`JAVA_HOME`-приоритет уже есть в jre-resolution).
- Тест идемпотентности (тёплый кэш `.c4builder.cache`) остаётся только для `default` —
  кэш-механика одна на все варианты, время CI не утраиваем.
- CI: артефакт `golden-actual` включает все варианты; setup-java остаётся только как
  среда для `jre install` (не как источник JVM рендера).
- Онлайн-рендер (`generateLocalImages=false`) сознательно **не** покрывается:
  путь помечен на удаление (решение июля 2026).

## Capabilities

### New Capabilities

— нет.

### Modified Capabilities

- `regression-testing`:
  - golden-сборка расширяется с одного конфига до матрицы вариантов (требование
    «Golden-сборка fixture соответствует эталону» и устройство эталона);
  - требование воспроизводимости усиливается: вместо «одинаковой мажорной версии JDK»
    — пин конкретной managed-JVM через кеш jre-резолвера (`JAVA_HOME`).

## Impact

- Код: только тестовая обвязка и CI — `test/helpers.mjs`, `test/golden.test.mjs`,
  fixture-конфиги (`test/fixtures/*.c4builder.json`), `test/golden/**`
  (реорганизация + новые эталоны), `test/README.md`, `.github/workflows/ci.yml`.
- Продуктовый код и публичное поведение CLI не меняются.
- Время golden-джобы растёт ~×3 (три сборки fixture); смягчение — идемпотентность
  только на `default`.
- Первый прогон на новой машине скачивает Temurin JRE с Adoptium (допущение о
  доступности Adoptium уже зафиксировано в change `jre-resolver`); в CI кеш
  прогревается шагом `c4builder jre install --force` и кешируется между запусками.
