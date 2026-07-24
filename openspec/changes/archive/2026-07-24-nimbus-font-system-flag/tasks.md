# Tasks: heros-font-system-flag

## 1. Вендоринг Nimbus Sans

- [x] 1.1 Скачать Nimbus Sans (regular, bold, italic, bolditalic; OTF) из urw-base35 (Artifex), положить в `vendor/fonts/`, удалить LiberationSans-*.ttf
- [x] 1.2 Сверить имя семейства в name-таблице (`fc-scan`) с константой `Nimbus Sans`, кириллицу — по `%{lang}`
- [x] 1.3 Обновить `vendor/fonts/README.md`: происхождение, версия, лицензия AGPL-3.0 + font exception

## 2. Опция useSystemFonts

- [x] 2.1 `src/config/schema.ts` + `defaults.ts` + `options.ts`: ключ `useSystemFonts` (bool, default `false`) → опция сборки `USE_SYSTEM_FONTS`
- [x] 2.2 `src/cli/dispatch.ts`: флаг `--system-fonts`, переопределяющий значение из конфига (флаг сильнее ключа)

## 3. Рендер

- [x] 3.1 `src/core/render/fonts.ts`: `DEFAULT_FONT_NAME = 'Nimbus Sans'`
- [x] 3.2 `src/core/render/diagrams.ts`: три шрифтовых аргумента JVM добавляются в argv только при выключенном `USE_SYSTEM_FONTS`; ключ кеша — `font=system` в системном режиме
- [x] 3.3 `src/core/render/pngraster.ts`: при `USE_SYSTEM_FONTS` — `loadSystemFonts: true`, без `fontDirs`/`defaultFontFamily`
- [x] 3.4 Unit-тест: argv рендера и опции растеризатора в обоих режимах (пин присутствует/отсутствует), кеш-ключи различаются

## 4. Golden и CI

- [x] 4.1 Пересобрать golden-эталоны под Nimbus Sans, закоммитить
- [x] 4.2 Golden прогнан на linux (контур CI, ubuntu-24.04) — зелёный, метрики Nimbus применились. Матрицы windows/macos в CI нет и не добавляем: риск CFF на них принят, план Б (конвертация OTF→TTF fontforge + повтор 1.2–4.1) выполняется по факту жалобы
- [x] 4.3 README: абзац про `useSystemFonts`/`--system-fonts` и оговорку о машинозависимости системного режима
