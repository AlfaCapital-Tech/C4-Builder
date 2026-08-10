# Вендорные шрифты

## Nimbus Sans

`NimbusSans-{Regular,Bold,Italic,BoldItalic}.otf`

- **Назначение:** детерминизм метрик текста в SVG. Ширина текста (`textLength`)
  считается PlantUML из AWT-метрик шрифта; системный `sans-serif` резолвится
  по-разному на разных машинах. Шрифт отдаётся JVM через
  `-Dsun.java2d.fontpath=prepend:` + `-SdefaultFontName=Nimbus Sans` и resvg через
  `fontDirs` (см. `src/core/render/fonts.ts`). Пин снимается ключом `useSystemFonts`
  в `.c4builder` / флагом `--system-fonts` — тогда рендер идёт системным шрифтом и
  перестаёт быть машинонезависимым.
- **Происхождение:** URW base35 (Artifex), релиз 20200910 — файлы побайтно совпадают
  с пакетом `gsfonts` этой версии. Метрически совместим с Helvetica, содержит
  кириллицу и греческий. Апстрим:
  <https://github.com/ArtifexSoftware/urw-base35-fonts>.
- **Лицензия:** AGPL-3.0-only с шрифтовым исключением
  (`PS-or-PDF-font-exception-20170817`): встраивание шрифта в документы не делает их
  производными работами. Полный текст — в апстрим-репозитории (`LICENSE`).
