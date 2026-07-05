# Удаление старых JAR и выбора версии PlantUML

> **Зависит от:** — (независимый cleanup; можно параллельно с `remove-pdf`).
> **Порядок:** до `new-noninteractive` (убирает флаг `--plantuml-version`, который тот не вводит).

## Why

В `vendor/` лежат 6 PlantUML-JAR (67 МБ), но актуален лишь один — `plantuml-1.2025.2.jar`
(21.7 МБ, `isLatest`). Пять старых версий существовали ради совместимости с онлайн-сервером
PlantUML (разные кодировки); после перехода на локальный java-direct рендер этот смысл
исчез. `PLANTUML_VERSION` тянется через утилиты, CLI, оба wizard'а и вывод — лишняя
поверхность и +45 МБ в пакете. Плейсхолдер `{{plantumlVersion}}` в шаблоне уже вычищен
(template-offline), а его подстановка в `cli.new.js` работает вхолостую.

## What Changes

- **Оставляем один вендорный JAR** (`plantuml-1.2025.2.jar`), удаляем пять старых:
  vendor 67 МБ → ~21 МБ.
- **Убираем концепцию версии**: массив `plantumlVersions` в `utils.js` → одна константа
  единственного JAR; в `build.js` резолв версии заменяется на прямой путь к нему.
- **Убираем `PLANTUML_VERSION`-опцию и промпты** выбора версии в `cli.new.js` и
  `cli.collect.js`, warning про несовместимость с онлайн-сервером, warning про обновление
  C4-PlantUML include URL, строку версии в `cli.list.js`.
- **Совместимость легаси-конфига.** `plantumlVersion` в существующем `.c4builder`
  игнорируется — всегда используется единственный JAR. Если ключ пинует конкретную (не
  `latest` и не текущую) версию, сборка печатает **однократное предупреждение**, что выбор
  версии удалён, и продолжается; конфиг не мутируется. На `latest`/текущей/отсутствии — тихо.
- Убираем мёртвую подстановку `{{plantumlVersion}}` в `cli.new.js`.

## Capabilities

### Modified Capabilities
- `diagram-rendering`: фиксируется единственный вендорный PlantUML-JAR (без выбора версии)
  и обработка легаси-ключа `plantumlVersion` (игнор + предупреждение на устаревшем пине).

## Impact

- `utils.js`: `plantumlVersions[6]` → константа единственного JAR (или `{version, jar}`).
- `build.js`: резолв `PLANTUML_VERSION`→JAR (стр. 263-265) заменяется прямым путём;
  импорт `plantumlVersions` убирается.
- `cli.js`: убирается опция `PLANTUML_VERSION`.
- `cli.new.js`: промпт версии, latest-warning, мёртвый `{{plantumlVersion}}`-replace,
  `conf.set('plantumlVersion')`, импорт `plantumlVersions`.
- `cli.collect.js`: промпт версии (стр. 238-281), warning про include URL, импорт.
- `cli.list.js`: строка вывода версии.
- `vendor/`: удаление 5 JAR.
- **Совместимость `arch`** гарантирована: его `.c4builder` пинует `plantumlVersion: "latest"`
  (+`generateLocalImages:true`, `svg`) → тот же JAR, предупреждение не срабатывает.
- **Golden не трогаем**: fixture пинует `1.2025.2` = оставляемый JAR → рендер идентичен.
- **Сцепка с `new-noninteractive`**: тот change добавляет флаг `--plantuml-version`; при
  заходе этого change флаг теряет смысл — реконсайл (см. design), рекомендуется этот раньше.
- **Вне объёма**: онлайн-сервер `PLANTUML_SERVER_URL` (родственная чистка из плана,
  отдельный change; `arch` им не пользуется).
