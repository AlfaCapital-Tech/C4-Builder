# Тесты c4builder

## Golden-тест

`golden.test.mjs` фиксирует поведение сборки как контракт, прогоняя один и тот же
демо-шаблон `template/src` через **матрицу fixture-конфигураций** (варианты):

| Вариант | Конфиг | Что фиксирует |
|---|---|---|
| `default` | [`fixtures/default.c4builder.json`](fixtures/default.c4builder.json) | базовый контракт: svg, локальный рендер, site/md/complete-md, navigation/TOC/breadcrumbs |
| `links-top` | [`fixtures/links-top.c4builder.json`](fixtures/links-top.c4builder.json) | `includeLinkToDiagram`+`diagramsOnTop`+`excludeOtherFiles`, chrome выключен — ссылки вместо картинок, диаграммы перед текстом, «прочие» файлы не копируются |
| `embed-png` | [`fixtures/embed-png.c4builder.json`](fixtures/embed-png.c4builder.json) | `embedDiagram`+`diagramFormat=png` — растеризация PlantUML/D2 в PNG (resvg), нативный ditaa-PNG, base64-встраивание в md |

Для каждого варианта тест:

1. Копирует `template/src` во временную директорию (`test/.tmp/fixture-<variant>-*`)
   и кладёт готовый `.c4builder` варианта — неинтерактивный эквивалент `c4builder new`.
2. Запускает реальный собранный CLI (`node dist/index.js`) с `cwd` во временной директории.
3. Сравнивает полное дерево `docs/` с эталоном варианта `test/golden/<variant>/`
   после нормализации: из SVG вырезаются XML-комментарии, переводы строк — LF.

Плюс контентные проверки на вариант (ссылки/картинки, порядок диаграмм, форматы
выходов, кириллица, D2) и тест идемпотентности тёплого кэша `.c4builder.cache`
(только на `default` — механика кэша одна на все варианты).

Правка `template/src` или логики сборки — осознанное изменение контракта:
регенерируйте эталоны в том же PR (`npm run test:golden:update`), дифф
`test/golden/` покажет эффект по каждому варианту.

## Пин JVM (воспроизводимость)

Layout считает встроенный в PlantUML Java-движок (Smetana), шрифт диаграмм
вендорится (`vendor/fonts/`) — метрики текста от машины не зависят. Но одинакового
мажора JDK для байт-в-байт мало: дистрибутивные сборки JDK и системный fontconfig
дают разные растеризаторы шрифта → разные `textLength`/координаты в SVG.

Поэтому golden-рендер **пинуется на конкретный managed-JRE**: хелпер `ensureManagedJre()`
резолвит кешированный Temurin (`jre.js`, `TEMURIN_FEATURE`; при отсутствии — качает
его, минуя системную java) и подставляет CLI через `JAVA_HOME`. Одна и та же JVM
локально и на CI, системная java в golden не участвует. Продуктовый код не меняется —
`detectSystemJava` уже проверяет `JAVA_HOME` первым.

CI прогревает кеш шагом `node dist/index.js jre install --force` и кеширует
`~/.cache/c4builder/jre` между прогонами; `setup-java` остаётся только средой для
юнит-тестов `jre.js` (веткам `detectSystemJava` нужна системная java).

### Остаточная разница дистрибутивов

Буквенные иконки class-диаграмм (кружки `C`/`M`) PlantUML рисует **кривыми** отдельного
шрифта `CircledCharacterFontName`. Без пина это логический шрифт JVM, который резолвит
системный fontconfig: Ubuntu отдаёт TrueType (квадратичные Безье, `Q`), Arch — CFF/OpenType
(кубические, `C`), и `class.svg` расходится между ОС. Поэтому рендер пинит и его:
`-SCircledCharacterFontName` рядом с `-SdefaultFontName` (см. `renderDiagram`). Шрифт
берётся из `vendor/fonts` (своих шрифтов JRE не несёт, freetype у Temurin бандлед), так
что `class.svg` теперь байт-в-байт одинаков локально и на CI.

Не лечится только нативный ditaa-PNG (`ditaa.png`): его рисует собственный AWT-движок
ditaa, который берёт шрифт мимо обеих опций, мимо `sun.java2d.fontpath` и мимо
`FONTCONFIG_FILE` (JVM его игнорирует). Поэтому `ditaa.png` **исключён из побайтной
сверки**: в манифесте у него sentinel `font-sensitive:png-ok`, проверяется наличие и
PNG-сигнатура, а встроенный в md base64 нормализуется в `<FONT-SENSITIVE>`
(см. `isFontSensitive`/`normalize` в `helpers.mjs`).

Следствие: `UPDATE_GOLDEN=1` можно запускать на любой машине — эталон детерминирован.
Процедура снятия с CI-артефакта ниже остаётся как запасной путь.

## Устройство эталона

`test/golden/<variant>/`:
- `manifest.json` — полный список файлов выхода + sha256 нормализованного содержимого
  (включая vendor-копии docsify и бинарные файлы — PNG и пр.).
- `tree/` — полные нормализованные копии текстовых файлов (md/svg/html…) для внятного
  диффа; vendor-копии и бинарники в tree не хранятся (только sha в манифесте).

## Команды

```bash
npm test                    # весь набор
npm run test:golden         # только golden-тест (все варианты)
npm run test:golden:update  # перегенерировать эталоны всех вариантов (UPDATE_GOLDEN=1)
```

## Регенерация эталона из CI-артефакта

При расхождении окружений (см. «Остаточная разница») эталон снимается с CI:

1. Скачайте артефакт `golden-actual-node22` упавшего прогона (нормализованный
   фактический выход всех вариантов, упакован в tar — tar сохраняет пустые файлы
   вроде `.nojekyll`, которые upload-artifact дропает):
   ```bash
   gh run download <run-id> -n golden-actual-node22 -D /tmp/dl
   tar -xzf /tmp/dl/golden-actual.tar.gz -C /tmp   # → /tmp/actual/<variant>/
   ```
2. Регенерируйте эталоны и закоммитьте (без второго аргумента — все варианты,
   с аргументом — только один):
   ```bash
   node test/golden-from-dir.mjs /tmp/actual            # все варианты
   node test/golden-from-dir.mjs /tmp/actual embed-png  # только embed-png
   git add test/golden && git commit
   ```
