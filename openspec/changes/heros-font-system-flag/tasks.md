# Tasks: heros-font-system-flag

## 1. Вендоринг TeX Gyre Heros

- [ ] 1.1 Скачать TeX Gyre Heros (regular, bold, italic, bolditalic; OTF) с GUST e-foundry, положить в `vendor/fonts/`, удалить LiberationSans-*.ttf
- [ ] 1.2 Сверить имя семейства в name-таблице (`fc-scan`) с константой `TeX Gyre Heros`
- [ ] 1.3 Обновить `vendor/fonts/README.md`: происхождение, версия, лицензия GUST FL

## 2. Опция useSystemFonts

- [ ] 2.1 `src/config/schema.ts` + `defaults.ts` + `options.ts`: ключ `useSystemFonts` (bool, default `false`) → опция сборки `USE_SYSTEM_FONTS`
- [ ] 2.2 `src/cli/dispatch.ts`: флаг `--system-fonts`, переопределяющий значение из конфига (флаг сильнее ключа)

## 3. Рендер

- [ ] 3.1 `src/core/render/fonts.ts`: `DEFAULT_FONT_NAME = 'TeX Gyre Heros'`
- [ ] 3.2 `src/core/render/diagrams.ts`: три шрифтовых аргумента JVM добавляются в argv только при выключенном `USE_SYSTEM_FONTS`; ключ кеша — `font=system` в системном режиме
- [ ] 3.3 `src/core/render/pngraster.ts`: при `USE_SYSTEM_FONTS` — `loadSystemFonts: true`, без `fontDirs`/`defaultFontFamily`
- [ ] 3.4 Unit-тест: argv рендера и опции растеризатора в обоих режимах (пин присутствует/отсутствует), кеш-ключи различаются

## 4. Golden и CI

- [ ] 4.1 Пересобрать golden-эталоны под Heros, закоммитить
- [ ] 4.2 Прогнать golden-matrix (linux/windows/macos) — зелёный; при провале CFF на какой-либо ОС выполнить план Б (конвертация OTF→TTF fontforge, повторить 1.2–4.1)
- [ ] 4.3 README: абзац про `useSystemFonts`/`--system-fonts` и оговорку о машинозависимости системного режима
