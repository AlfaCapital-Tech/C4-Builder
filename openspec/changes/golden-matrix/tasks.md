# tasks — golden-matrix

## 1. Пин managed-JVM в golden-обвязке

- [ ] 1.1 `test/helpers.mjs`: хелпер `ensureManagedJre()` — `cachedJava() ?? resolveJava({ force: true })` из `jre.js`, вычислить `JAVA_HOME` (`<root>` из `<root>/bin/java`), закешировать на прогон
- [ ] 1.2 `runBuild`: передавать `env` с подставленным `JAVA_HOME` managed-JRE в `spawnSync`
- [ ] 1.3 Проверить локально: golden проходит на машине, где системная java ≠ Temurin (или с временно скрытой java в PATH)

## 2. Матрица fixture-конфигураций

- [ ] 2.1 Создать `test/fixtures/`: перенести `test/fixture.c4builder.json` → `test/fixtures/default.c4builder.json`
- [ ] 2.2 Добавить `test/fixtures/links-top.c4builder.json` (includeLinkToDiagram, diagramsOnTop, excludeOtherFiles = true; navigation/TOC/breadcrumbs = false)
- [ ] 2.3 Добавить `test/fixtures/embed-png.c4builder.json` (embedDiagram = true, diagramFormat = png)
- [ ] 2.4 `test/helpers.mjs`: параметризовать вариантом (`createFixture(variant)`, `goldenDir(variant)`, `actualDir(variant)`, `updateGolden(tree, variant)`, `compareWithGolden(tree, variant)`)

## 3. Тесты по матрице

- [ ] 3.1 `test/golden.test.mjs`: цикл по вариантам — сборка, сравнение с эталоном варианта, запись actual по вариантам
- [ ] 3.2 Сохранить контентные проверки default (stdlib/iuml SVG, кириллица, D2) как сейчас
- [ ] 3.3 Добавить контентные проверки `links-top`: ссылки вместо `![diagram]`, диаграммы перед текстом, отсутствие скопированных «прочих» файлов и chrome-блока
- [ ] 3.4 Добавить контентные проверки `embed-png`: `.png`-выходы вместо `.svg` (кроме vendor), `data:image/png;base64` в md, ditaa-PNG на месте
- [ ] 3.5 Тест тёплого кэша — только вариант `default`

## 4. Эталоны

- [ ] 4.1 `UPDATE_GOLDEN=1`: сгенерировать `test/golden/{default,links-top,embed-png}/`, удалить старые `test/golden/{manifest.json,tree/}`
- [ ] 4.2 Просмотреть дифф эталонов: default идентичен старому (только путь), в links-top/embed-png ветки видны глазами

## 5. CI и документация

- [ ] 5.1 `.github/workflows/ci.yml`: шаг `node index.js jre install --force` до `npm test` + `actions/cache` на `~/.cache/c4builder/jre` (ключ от `TEMURIN_FEATURE` и os/arch)
- [ ] 5.2 Проверить упаковку артефакта: `test/.tmp/actual/<variant>/` попадают в `golden-actual.tar.gz`
- [ ] 5.3 `test/README.md`: матрица вариантов, пин JVM (как и зачем), обновлённая процедура регенерации эталона
- [ ] 5.4 Прогнать CI на ветке: golden зелёный на node 22 и 24, время джобы приемлемо
