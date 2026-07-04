# Tasks: plantuml-java-direct

## 1. Спайки (снять остаточную неопределённость до правки кода)

- [x] 1.1 Подтвердить, что vendored TTF (`vendor/fonts/LiberationSans*`) подхватывается
      через `-Dsun.java2d.fontpath=prepend:` и даёт те же метрики, что системный
      Liberation Sans (сравнить отпечаток геометрии)
      → шрифт применяется (геометрия ≠ дефолтного sans-serif), два прогона байт-идентичны
- [x] 1.2 Проверить резолвинг инклюдов в `-pipe`-режиме: stdlib `<C4/...>`, локальный
      `!include styles.iuml` и `!include ../styles.iuml` из вложенной папки — на копии
      `template/src`, до правки продуктового кода
      → все три вида резолвятся; кириллица цела; сломанный `GRAPHVIZ_DOT` не мешает (dot не зовётся)
- [x] 1.3 Спайк детерминизма между мажорами JDK: метрики Liberation Sans на двух
      JDK-мажорах — решить, ослаблять ли `test/README.md` полностью
      → JDK 17 и 21 дают байт-идентичный SVG → эталон воспроизводим между мажорами;
        `test/README.md` ослаблен до «регенерация только при смене JDK-мажора»

## 2. Вендорный шрифт

- [x] 2.1 Добавить `vendor/fonts/LiberationSans-{Regular,Bold,Italic,BoldItalic}.ttf`
      (OFL) в git; зафиксировать лицензию/происхождение (`vendor/fonts/README.md`)
- [x] 2.2 Убедиться, что `.npmignore`/пакет включает `vendor/fonts/`
      → `npm pack --dry-run` подтверждает: 4 TTF + README попадают в пакет

## 3. Прямой вызов java + Smetana

- [x] 3.1 Реализовать в `build.js` прямой `spawn('java', argv)`: headless,
      `-Dplantuml.include.path`, `-Dsun.java2d.fontpath=prepend:vendor/fonts`,
      `-jar <vendor jar>`, `-Playout=smetana`, `-SdefaultFontName=Liberation Sans`,
      `-charset`, `-t{svg|png}`, `-pipe`; stdout → целевой файл
- [x] 3.2 Сохранить выбор JAR по `PLANTUML_VERSION` (маппинг version→jar); убрать
      `PLANTUML_HOME`-хак
- [x] 3.3 Отфильтровать диагностический шум Smetana (`UNSURE_ABOUT…`) из stderr, не
      показывать пользователю; реальные ошибки рендера пробрасывать
- [x] 3.4 ditaa (`@startditaa` → png): рендерить тем же путём, проверить, что PNG-выход
      не изменился
      → находка: `-Playout=smetana` меняет ditaa-холст (390×154→510×182), для ditaa флаг
        не передаётся → PNG байт-в-байт совпадает с историческим (шрифт на ditaa не влияет)
- [x] 3.5 Удалить `node-plantuml` из `dependencies`, прогнать `npm install`, убедиться,
      что nailgun-транзитив ушёл (ушли и `node-nailgun-*`, `plantuml-encoder`)

## 4. CI и документация

- [x] 4.1 Убрать из `.github/workflows/ci.yml` шаг установки graphviz
- [x] 4.2 README/доки: java обязательна, graphviz не требуется; обновить `test/README.md`
      согласно итогу спайка 1.3
      → правки: `README.MD`, `docs/README.MD`, `cli.new.js` (сообщение),
        `Dockerfile` (убран graphviz + node-plantuml-хак), `test/README.md`

## 5. Golden-эталон

- [x] 5.1 Пересоздать `test/golden/` под Smetana+шрифт (`npm run test:golden:update`),
      дифф в PR — визуальный аудит перелёта диаграмм
- [ ] 5.2 Прогнать CI (Node 22/24) без graphviz: тесты зелёные, эталон совпадает
      → выполняется пушем ветки; локально `npm test` зелёный (в т.ч. со сломанным `GRAPHVIZ_DOT`)
- [x] 5.3 Проверить локально `npm test` на совпадающем JDK-мажоре: совпадает с CI
      (инвариант «эталон не зависит от машины») — JDK 21 локально == Temurin 21 на CI (мажор)
