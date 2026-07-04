# Tasks: plantuml-java-direct

## 1. Спайки (снять остаточную неопределённость до правки кода)

- [ ] 1.1 Подтвердить, что vendored TTF (`vendor/fonts/LiberationSans*`) подхватывается
      через `-Dsun.java2d.fontpath=prepend:` и даёт те же метрики, что системный
      Liberation Sans (сравнить отпечаток геометрии)
- [ ] 1.2 Проверить резолвинг инклюдов в `-pipe`-режиме: stdlib `<C4/...>`, локальный
      `!include styles.iuml` и `!include ../styles.iuml` из вложенной папки — на копии
      `template/src`, до правки продуктового кода
- [ ] 1.3 Спайк детерминизма между мажорами JDK: метрики Liberation Sans на двух
      JDK-мажорах — решить, ослаблять ли `test/README.md` полностью

## 2. Вендорный шрифт

- [ ] 2.1 Добавить `vendor/fonts/LiberationSans-{Regular,Bold,Italic,BoldItalic}.ttf`
      (OFL) в git; зафиксировать лицензию/происхождение
- [ ] 2.2 Убедиться, что `.npmignore`/пакет включает `vendor/fonts/`

## 3. Прямой вызов java + Smetana

- [ ] 3.1 Реализовать в `build.js` прямой `spawn('java', argv)`: headless,
      `-Dplantuml.include.path`, `-Dsun.java2d.fontpath=prepend:vendor/fonts`,
      `-jar <vendor jar>`, `-Playout=smetana`, `-SdefaultFontName=Liberation Sans`,
      `-charset`, `-t{svg|png}`, `-pipe`; stdout → целевой файл
- [ ] 3.2 Сохранить выбор JAR по `PLANTUML_VERSION` (маппинг version→jar); убрать
      `PLANTUML_HOME`-хак
- [ ] 3.3 Отфильтровать диагностический шум Smetana (`UNSURE_ABOUT…`) из stderr, не
      показывать пользователю; реальные ошибки рендера пробрасывать
- [ ] 3.4 ditaa (`@startditaa` → png): рендерить тем же путём, проверить, что PNG-выход
      не изменился
- [ ] 3.5 Удалить `node-plantuml` из `dependencies`, прогнать `npm install`, убедиться,
      что nailgun-транзитив ушёл

## 4. CI и документация

- [ ] 4.1 Убрать из `.github/workflows/ci.yml` шаг установки graphviz
- [ ] 4.2 README/доки: java обязательна, graphviz не требуется; обновить `test/README.md`
      согласно итогу спайка 1.3

## 5. Golden-эталон

- [ ] 5.1 Пересоздать `test/golden/` под Smetana+шрифт (`npm run test:golden:update`),
      дифф в PR — визуальный аудит перелёта диаграмм
- [ ] 5.2 Прогнать CI (Node 22/24) без graphviz: тесты зелёные, эталон совпадает
- [ ] 5.3 Проверить локально `npm test` на совпадающем JDK-мажоре: совпадает с CI
      (инвариант «эталон не зависит от машины»)
