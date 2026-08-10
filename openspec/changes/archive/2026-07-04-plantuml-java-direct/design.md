# Design: plantuml-java-direct

## Context

c4builder рендерит `.puml` в SVG/PNG через `node-plantuml.generate(file, {...})`,
который спавнит `java -jar <vendor JAR>` с жёстко ограниченным argv. JAR подменяется
на вендорный через `PLANTUML_HOME`. Layout считает **внешний graphviz/dot** →
результат зависит от версии dot на машине. Главный потребитель — репо `arch`
(C4-PlantUML stdlib, локальные `.iuml`, кириллица, `diagramFormat=svg`).

Место в цепочке модернизации: после `template-offline` и `golden-test-ci`
(страховочная сеть уже стоит), реализует пункт плана «java напрямую + Smetana».

## Спайки (проведены в explore, легли в основу решений)

1. **Активация Smetana.** `-Playout=smetana` = глобальный `!pragma layout smetana`
   из CLI, без правки пользовательских `.puml`.
2. **graphviz реально уходит.** Рендер с заведомо битым `dot` (`/nonexistent/dot`):
   без Smetana — `IOException: Cannot run program`; со Smetana — SVG отрендерился,
   dot не вызывался. Все 7 типов диаграмм шаблона — OK, кириллица цела.
3. **Аудит `arch`.** 42 реальных C4-диаграммы (`src/c4`, один JVM, Smetana):
   0 ошибок рендера, 0 `UNSURE`, 0 exceptions, viewBox в норме (max 2003×1008).
4. **Шрифт → детерминизм.** Отпечаток геометрии (`textLength`/`width`/`height`)
   context.puml:
   - дефолт `sans-serif` (Arch) ≠ `Liberation Sans` ≠ `FreeSans` — шрифт меняет числа;
   - `Liberation Sans` два прогона подряд — идентичны (детерминизм при фиксации);
   - `DejaVu Sans` (нет на Arch) == дефолт → **PlantUML молча уходит в fallback**.
     Вывод: одного `-SdefaultFontName` мало, шрифт должен физически присутствовать.

## Goals / Non-Goals

**Goals:**
- Убрать внешний graphviz из зависимостей рантайма и CI.
- Убрать заброшенный `node-plantuml`, вызывать `java` напрямую.
- Сделать golden-эталон воспроизводимым на любой машине (пин шрифта).

**Non-Goals:**
- Смена формата/структуры выходов, поведения CLI.
- Порт на TypeScript (отдельный change).
- Замена PlantUML на D2/иной движок (отдельный change).
- Удаление старых вендорных JAR (`vendor-cleanup` — отдельно).
- Поддержка онлайн-рендера (`plantumlServerUrl`) — вне scope, не трогаем.

## Decisions

1. **Прямой `spawn('java', argv)` в `build.js`.** Базовый argv:
   ```
   -Djava.awt.headless=true
   -Dplantuml.include.path=<cwd>
   -Dsun.java2d.fontpath=prepend:<repo>/vendor/fonts   # vendored-шрифт
   -jar <repo>/vendor/plantuml-1.2025.2.jar
   -Playout=smetana
   -SdefaultFontName=Liberation Sans
   -charset UTF-8
   -t{svg|png}                                         # png для ditaa
   -pipe                                               # источник — stdin/stdout
   ```
   `.puml` подаётся в stdin, SVG читается из stdout и пишется в целевой путь —
   как сейчас делает `node-plantuml`.

2. **Сохраняем `-pipe`, не `-o`.** PlantUML с `-o` именует файл по `@startuml <name>`
   (в `arch` видели `Selling Agent Sequence.svg`), а c4builder кладёт результат по
   имени `.puml`-файла. `-pipe` разрывает эту связь: имя выхода задаёт c4builder.
   Include (`!include ../styles.iuml`) при `-pipe` резолвится от `-Dplantuml.include.path`
   и `-Dplantuml.include.path`-каталога — проверяется, что стилевые/`.iuml`-инклюды и
   stdlib `<C4/...>` резолвятся так же, как раньше (это ключевой риск pipe-режима).

3. **Vendored Liberation Sans.** Кладём `LiberationSans-{Regular,Bold,Italic,BoldItalic}.ttf`
   в `vendor/fonts/`, отдаём JVM через `-Dsun.java2d.fontpath=prepend:` и включаем
   `-SdefaultFontName=Liberation Sans`. Liberation Sans — метрически-совместим с Arial,
   лицензия OFL (можно вендорить), присутствует и на Ubuntu-раннере. Alternative —
   `skinparam` без vendoring: отвергнут (спайк показал молчаливый fallback при
   отсутствии шрифта). Спайк в tasks: подтвердить, что vendored TTF реально
   подхватывается (метрики == системной установке).

4. **Golden — регенерация в этом же change.** Дифф `test/golden/` в PR = аудит того,
   как Smetana переложила каждую диаграмму. После пина шрифта эталон воспроизводим
   локально и на CI одинаково → в `regression-testing` фиксируем инвариант
   «эталон не зависит от машины», а костыль «CI — источник истины» из `test/README.md`
   ослабляется до «при смене JDK-мажора возможна регенерация».

5. **`node-plantuml` вон.** Удаляется из `dependencies`; исчезает и `PLANTUML_HOME`-хак.
   Выбор вендорного JAR по `PLANTUML_VERSION` остаётся (маппинг version→jar в utils).

## Risks / Trade-offs

- **[pipe-режим и резолвинг include]** — главный риск: `<C4/...>` (stdlib из JAR),
  `!include styles.iuml`/`../styles.iuml` (локальные) должны резолвиться идентично.
  Проверяется golden-диффом по шаблону (в нём есть оба вида) до регенерации.
- **[Детерминизм между JDK]** — advance-widths берутся из TTF (`hmtx`) и оказались
  стабильны: метрики/layout совпали и между мажорами OpenJDK 17/21, и между
  дистрибутивами (локальный OpenJDK vs Temurin на CI) — все C4-диаграммы байт-в-байт.
  Остаточное расхождение только между **дистрибутивами** JDK — тесселяция глифов
  (буквенные иконки class-диаграммы: кубические vs квадратичные Безье, метрики те же).
  Поэтому канон эталона — CI (Temurin 21); закрывается регенерацией из CI-артефакта.
- **[Качество Smetana vs graphviz]** — на плотных графах Smetana исторически слабее
  (перекрытия рёбер). Аудит `arch` (42 диаграммы) расхождений не выявил; будущие
  тяжёлые диаграммы отлавливаются golden-диффом.
- **[`UNSURE_ABOUT` в stderr]** — Smetana печатает диагностику на некоторых
  диаграммах (воспроизвелось на class-диаграмме шаблона, не на `arch`). SVG корректен;
  нужно не выводить этот шум пользователю (фильтрация stderr рендера).
- **[ditaa]** — спайк показал: `-Playout=smetana` на `@startditaa` **не** безвреден —
  меняет размер холста PNG (390×154 → 510×182). Решение: для ditaa флаг не передаётся;
  тогда PNG-выход байт-в-байт совпадает с историческим (вендорный шрифт на ditaa не
  влияет — у него собственный движок текста).

## Open Questions

- ~~Ослаблять ли `test/README.md` полностью?~~ Решено по итогу CI: layout/метрики
  воспроизводимы cross-machine, но тесселяция глифов различается между дистрибутивами
  JDK → раздел «CI — источник истины» ослаблен до «канон = CI (Temurin 21), процедура
  регенерации на случай другого дистрибутива JDK».
