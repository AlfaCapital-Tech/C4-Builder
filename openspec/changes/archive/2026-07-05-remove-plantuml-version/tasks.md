# Tasks: remove-plantuml-version

> Реконсайл: согласовать с `new-noninteractive` (флаг `--plantuml-version`). Рекомендуется
> этот change раньше — тогда new-noninteractive не добавляет флаг версии.

## 1. Вендорный JAR

- [x] 1.1 Удалить 5 старых JAR из `vendor/`, оставить `plantuml-1.2025.2.jar`
- [x] 1.2 Проверить размер vendor (~21 МБ) и что в пакет попадает только один JAR

## 2. utils.js и build.js

- [x] 2.1 Заменить `plantumlVersions[6]` на единственную константу JAR (version+jar)
- [x] 2.2 `build.js`: заменить резолв `PLANTUML_VERSION`→JAR (стр. 263-265) прямым путём;
      убрать импорт `plantumlVersions`

## 3. CLI: опция и вывод

- [x] 3.1 `cli.js`: убрать опцию `PLANTUML_VERSION` из `getOptions`
- [x] 3.2 `cli.list.js`: убрать строку вывода версии

## 4. Wizard'ы

- [x] 4.1 `cli.new.js`: убрать промпт версии, latest-warning, `conf.set('plantumlVersion')`,
      импорт `plantumlVersions`, мёртвый `{{plantumlVersion}}`-replace (стр. 54, 180)
- [x] 4.2 `cli.collect.js`: убрать промпт версии и warning про C4-PlantUML include URL
      (стр. 238-281), импорт `plantumlVersions`

## 5. Легаси-конфиг

- [x] 5.1 В начале рендера (`generateImages`) собрать `plantumlVersion` из конфига;
      если задан конкретной версией ≠ `latest` и ≠ версии вендорного JAR — однократный warn
- [x] 5.2 На `latest`/текущей/отсутствии — тихо; сборка всегда единственным JAR
- [x] 5.3 Убедиться, что конфиг не мутируется и сборка не падает из-за ключа

## 6. Fixture и верификация

- [x] 6.0 Убрать поле `plantumlVersion` из `test/fixture.c4builder.json` (no-op после удаления)
- [x] 6.1 Сборка проекта с `plantumlVersion: "latest"` (как `arch`) → без warn, рендер ок
- [x] 6.2 Сборка с `plantumlVersion: "1.2021.7"` → однократный warn, exit 0, конфиг не изменён
- [x] 6.3 Golden (`diagramFormat=svg`, fixture без версии) зелёный и неизменный — тот же JAR
- [x] 6.4 `grep -rniE "plantumlVersions|PLANTUML_VERSION|\{\{plantumlVersion\}\}"` — не
      осталось живых ссылок (кроме осознанной обработки легаси-ключа)
- [x] 6.5 `openspec validate remove-plantuml-version --strict` проходит
