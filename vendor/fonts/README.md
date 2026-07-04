# Вендорные шрифты

## Liberation Sans

`LiberationSans-{Regular,Bold,Italic,BoldItalic}.ttf`

- **Назначение:** детерминизм метрик текста в SVG. Ширина текста (`textLength`)
  считается PlantUML из AWT-метрик шрифта; системный `sans-serif` резолвится
  по-разному на разных машинах. Шрифт отдаётся JVM через
  `-Dsun.java2d.fontpath=prepend:` + `-SdefaultFontName=Liberation Sans`, чтобы
  метрики не зависели от машины (см. `build.js`).
- **Происхождение:** пакет `ttf-liberation` / `fonts-liberation`, версия 2.1.5
  (font version 2.1). Метрически совместим с Arial; та же версия поставляется на
  CI-раннере `ubuntu-24.04`.
- **Лицензия:** SIL Open Font License 1.1 (разрешает вендоринг и распространение).
  Полный текст: <https://openfontlicense.org/> · апстрим:
  <https://github.com/liberationfonts/liberation-fonts>.
