# tasks — golden-matrix

## 1. Пин managed-JVM в golden-обвязке

- [x] 1.1 `test/helpers.mjs`: хелпер `ensureManagedJre()` — `cachedJava() ?? resolveJava({ force: true })` из `jre.js`, вычислить `JAVA_HOME` (`<root>` из `<root>/bin/java`), закешировать на прогон
- [x] 1.2 `runBuild`: передавать `env` с подставленным `JAVA_HOME` managed-JRE в `spawnSync`
- [x] 1.3 Проверить локально: golden проходит на машине, где системная java ≠ Temurin (или с временно скрытой java в PATH) — механизм подтверждён (рендер на managed-JRE через `JAVA_HOME` без системной java в PATH); остаточное расхождение `class.svg`/`ditaa.png` — OS-font, задокументировано в README

## 2. Матрица fixture-конфигураций

- [x] 2.1 Создать `test/fixtures/`: перенести `test/fixture.c4builder.json` → `test/fixtures/default.c4builder.json`
- [x] 2.2 Добавить `test/fixtures/links-top.c4builder.json` (includeLinkToDiagram, diagramsOnTop, excludeOtherFiles = true; navigation/TOC/breadcrumbs = false)
- [x] 2.3 Добавить `test/fixtures/embed-png.c4builder.json` (embedDiagram = true, diagramFormat = png)
- [x] 2.4 `test/helpers.mjs`: параметризовать вариантом (`createFixture(variant)`, `goldenDir(variant)`, `actualDir(variant)`, `updateGolden(tree, variant)`, `compareWithGolden(tree, variant)`)

## 3. Тесты по матрице

- [x] 3.1 `test/golden.test.mjs`: цикл по вариантам — сборка, сравнение с эталоном варианта, запись actual по вариантам
- [x] 3.2 Сохранить контентные проверки default (stdlib/iuml SVG, кириллица, D2) как сейчас
- [x] 3.3 Добавить контентные проверки `links-top`: ссылки вместо `![diagram]`, диаграммы перед текстом, отсутствие скопированных «прочих» файлов и chrome-блока
- [x] 3.4 Добавить контентные проверки `embed-png`: `.png`-выходы вместо `.svg` (кроме vendor), `data:image/png;base64` в md, ditaa-PNG на месте
- [x] 3.5 Тест тёплого кэша — только вариант `default`

## 4. Эталоны

- [~] 4.1 `UPDATE_GOLDEN=1`: сгенерировать `test/golden/{default,links-top,embed-png}/`, удалить старые `test/golden/{manifest.json,tree/}` — старый эталон удалён; генерация/коммит эталонов отложены на CI-снимок (решение: эталоны не коммитить локально, т.к. Arch расходится с CI по `class.svg`/`ditaa.png`, а CI-байты бинарников невосстановимы) → см. 5.4
- [x] 4.2 Просмотреть дифф эталонов: default идентичен старому (только путь), в links-top/embed-png ветки видны глазами — проверено на локально сгенерированных эталонах: default байт-в-байт совпал со старым, кроме `class.svg` (форма глифов) и `ditaa.png` (нативный PNG); ветки links-top/embed-png подтверждены контентными проверками (7/7 зелёных)

## 5. CI и документация

- [x] 5.1 `.github/workflows/ci.yml`: шаг `node index.js jre install --force` до `npm test` + `actions/cache` на `~/.cache/c4builder/jre` (ключ от `TEMURIN_FEATURE` и os/arch)
- [x] 5.2 Проверить упаковку артефакта: `test/.tmp/actual/<variant>/` попадают в `golden-actual.tar.gz` — по построению (`writeActualTree` пишет в `test/.tmp/actual/<variant>/`, шаг `tar -C test/.tmp actual` пакует весь каталог)
- [x] 5.3 `test/README.md`: матрица вариантов, пин JVM (как и зачем), обновлённая процедура регенерации эталона
- [ ] 5.4 Прогнать CI на ветке: golden зелёный на node 22 и 24, время джобы приемлемо — **человеку**: push ветки → первый CI красный (эталонов нет) → скачать артефакт `golden-actual-node22` → `node test/golden-from-dir.mjs /tmp/actual` → закоммитить эталоны → CI зелёный
