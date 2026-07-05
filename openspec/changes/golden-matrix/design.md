# design — golden-matrix

## Context

Golden-обвязка (`test/helpers.mjs`, `test/golden.test.mjs`) собирает копию
`template/src` реальным CLI с одним конфигом `test/fixture.c4builder.json` и
сверяет дерево `docs/` с эталоном `test/golden/{manifest.json,tree/}`. Константы
`FIXTURE_CONFIG`, `GOLDEN_DIR`, `ACTUAL_DIR` — жёсткие, один вариант.

JVM для рендера берётся «системная» (`detectSystemJava`: `JAVA_HOME` → `PATH`,
мажор ≥17). На CI это Temurin 21 из setup-java, локально — что стоит у
разработчика (на Arch — дистрибутивная сборка OpenJDK с системным freetype).
Разные растеризаторы/метрики шрифта → разные `textLength` в SVG → периодические
ложные диффы эталона, хотя мажор JDK совпадает.

Это звено 0 цепочки TS-порта: расширенная сетка должна встать ДО рефакторинга
compose-слоя (`build.js`).

## Goals / Non-Goals

**Goals:**
- Зафиксировать эталоном ветки compose-слоя: `includeLinkToDiagram`,
  `diagramsOnTop`, `excludeOtherFiles`, `embedDiagram`, png-растеризация (resvg + ditaa).
- Устранить зависимость golden от локальной JVM: одна пиновая managed-JVM везде.
- Сохранить рабочий процесс: `npm test`, `test:golden`, `test:golden:update`
  работают как раньше, но покрывают все варианты.

**Non-Goals:**
- Онлайн-рендер (`generateLocalImages=false`) — путь под удаление, эталоном не фиксируем.
- Изменения продуктового кода (build.js, jre.js) — ноль правок.
- Полная комбинаторика опций — берём три осмысленных профиля, не 2^n.
- Тест wizard'а и `--site`/`--watch` — вне объёма (позже, в звеньях TS-порта).

## Decisions

### D1. Три варианта матрицы, одни исходники

| Вариант | Отличия от default | Что фиксирует |
|---|---|---|
| `default` | текущий fixture-конфиг | базовый контракт (как сейчас) |
| `links-top` | `includeLinkToDiagram=true`, `diagramsOnTop=true`, `excludeOtherFiles=true`, `includeNavigation=false`, `includeTableOfContents=false`, `includeBreadcrumbs=false` | ветку «ссылка вместо картинки», порядок диаграмм, исключение прочих файлов, отсутствие chrome-блока |
| `embed-png` | `embedDiagram=true`, `diagramFormat=png` | resvg-растеризацию (PlantUML+D2), нативный ditaa-PNG, base64-встраивание |

Каждый вариант — отдельный JSON в `test/fixtures/<variant>.c4builder.json`
(текущий `test/fixture.c4builder.json` переезжает в `test/fixtures/default.c4builder.json`).
`links-top` инвертирует все булевы переключатели default'а — две точки на каждую
ветку if/else compose-слоя. Детерминизм png: resvg пинован (2.6.2), шрифты
вендорные (`loadSystemFonts:false`), ditaa-PNG воспроизводим (уже в эталоне).

Альтернатива «отдельные исходники на вариант» отвергнута: одни исходники — один
дифф при правке `template/src`, меньше сущностей.

### D2. Раскладка эталона: `test/golden/<variant>/`

`test/golden/default/{manifest.json,tree/}`, `.../links-top/`, `.../embed-png/`.
Хелперы параметризуются вариантом (`goldenDir(variant)` и т.п.), `ACTUAL_DIR` →
`test/.tmp/actual/<variant>/`. `UPDATE_GOLDEN=1` перегенерирует все варианты за
один прогон (частичное обновление не нужно — сборки всё равно идут все).

Миграция: старые `test/golden/{manifest.json,tree}` удаляются в этом же PR,
эталоны всех вариантов генерируются заново (то же содержимое default, новый путь).

### D3. Пин JVM через кеш jre-резолвера, без правок продуктового кода

Тест-хелпер перед первой сборкой резолвит managed-JVM:

```js
import { cachedJava, resolveJava } from '../jre.js';
const jre = cachedJava() ?? (await resolveJava({ force: true })); // force ⇒ мимо системной
const javaHome = path.dirname(path.dirname(jre.path));            // <root>/bin/java → <root>
```

и передаёт `env: { ...process.env, JAVA_HOME: javaHome }` в `spawnSync` CLI.
`detectSystemJava` проверяет `JAVA_HOME` первым → рендер гарантированно идёт на
кешированном Temurin 21 (одна и та же сборка Adoptium с вшитым freetype локально
и на CI). Правок jre.js не нужно: `cachedJava`/`resolveJava` уже экспортируются.

Альтернативы: env-флаг `C4BUILDER_JRE_MODE=managed` в продуктовом коде (лишняя
поверхность ради тестов); docker-обёртка для локального прогона (тяжело, но
остаётся как escape hatch — см. Risks).

### D4. CI: прогрев кеша JRE + кеш между запусками

Шаг `node index.js jre install --force` до `npm test` (сеть под контролем,
таймауты теста не тратятся на скачивание) + `actions/cache` на
`~/.cache/c4builder/jre` с ключом от `TEMURIN_FEATURE`. setup-java остаётся
(vitest-юнитам jre.js нужна системная java для веток detectSystemJava), но
golden от него больше не зависит.

### D5. Идемпотентность — только `default`

Тест тёплого кэша (`.c4builder.cache`, второй прогон) остаётся на `default`:
механика чексумм одна на все варианты, а каждая лишняя сборка — десятки JVM-спавнов.

## Risks / Trade-offs

- [Кеш-чексумма не зависит от формата вывода] Варианты работают в изолированных
  временных директориях со своими `.c4builder.cache` → взаимного влияния нет.
- [Время CI ×3] Приемлемо (сборка fixture ~десятки секунд); смягчение — D5 и
  параллельность vitest на уровне файлов: каждый вариант — свой тест-файл или
  `describe.concurrent` не используем, оставляем последовательный прогон ради
  предсказуемости логов. Если станет больно — режем матрицу CI по node.
- [embed-png эталон бинарнее: PNG хранится только sha в manifest] Дифф по PNG
  нечитаем — но задача сетки «поймать расхождение», а не объяснить его; SVG-до-
  растеризации покрыт другими вариантами. Base64 в md — текстовый, диффуемый.
- [Adoptium недоступен в среде запуска] Тогда golden не прогонится — поведение
  честное (ошибка резолва с понятным сообщением от jre-resolver). Escape hatch:
  локальный docker-прогон образа CI; отдельный скрипт не заводим, пока не понадобился.
- [jre.js — CJS, тесты — ESM] `import ... from '../jre.js'` работает (Node CJS-
  interop для named exports через cjs-module-lexer — статический module.exports).

## Migration Plan

1. Хелперы: параметризация вариантом + пин JAVA_HOME (тесты ещё на старом эталоне default).
2. Новые fixture-конфиги + перенос текущего в `test/fixtures/default.c4builder.json`.
3. `UPDATE_GOLDEN=1` — генерация трёх эталонов, коммит вместе с удалением старого пути.
4. CI: шаг прогрева JRE + actions/cache + пути артефактов.
5. `test/README.md` — матрица, пин JVM, процедура обновления эталона.

Откат: revert PR (эталон и обвязка самодостаточны, продуктовый код не тронут).

## Open Questions

— нет (все решения зафиксированы выше; матрица расширяема новыми вариантами
по мере надобности, напр. под будущий TeaVM-флаг).
