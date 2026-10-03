# Tasks

## 1. Экстрактор блоков в ядре

- [x] 1.1 Перенести `src/plugins/openspec/fences.ts` в `src/core/scan/fences.ts`, `createFenceExtractor(langs)` с набором языков (design §3); плагин `openspec` вызывает с `plantuml`, `puml`, `d2`, импорты (включая `test/plugin-openspec-fences.test.mjs`, `test/dist.mjs`) обновить. Проверка: `npm run build && npx vitest run test/plugin-openspec-fences.test.mjs test/plugin-openspec.test.mjs` зелёные без изменения ожиданий.
- [x] 1.2 `scan/tree.ts`: для каждого `.md` страницы — `extract(content, <stem .md>, <путь .md от cwd>)` с набором `{plantuml}`, извлечённые диаграммы (`soft: true`) — в `item.diagrams` до сортировки, контент — с заменой блока на ссылку. Проверка: новый `test/page-fences.test.mjs` (spawn CLI на temp-проекте, рендер системной java как в `check.test.mjs`): блок ```` ```plantuml ```` в `src/README.md` → в выходе сайта, markdown-коллекции и complete-markdown картинка и нет текста блока; ```` ```puml ```` и ```` ```d2 ```` остаются кодом; битый блок → код 0, предупреждение с путём `.md`; относительный `!include ../x.iuml` в блоке резолвится от каталога страницы.
- [x] 1.3 Проверить связку с `llms-full.txt`: блок страницы попадает туда исходником в fence `plantuml`. Проверка: кейс в `test/page-fences.test.mjs` с `generateLLMS: true`.

## 2. Шаблон и тема без внешних ресурсов

- [x] 2.1 `compose/docsify.template.ts`: убрать `<script src="vendor/docsify-plantuml.min.js">`; в объект опций `generateWebMD` (и `DocsifyOptions`) добавить `nativeEmoji: true`; копирование `vendor/docsify` в выход сохранить целиком (`docsify-plantuml.min.js` остаётся для пользовательских шаблонов). Проверка: `node dist/index.js` на шаблонном проекте → в `index.html` нет `docsify-plantuml`, есть `"nativeEmoji": true`, файл `vendor/docsify-plantuml.min.js` в выходе есть.
- [x] 2.2 После копирования вендора вырезать ведущий `@import url(...)` из `dist/vendor/vue.css` (design §2). Проверка: в выходе `vue.css` без `fonts.googleapis`, `git diff vendor/` пуст.
- [x] 2.3 Ручная проверка в браузере (devtools → Network) собранного шаблонного проекта: нет запросов к внешним доменам, `:smile:` на временной странице показан символом, шрифты системные. Проверка: отметка в отчёте с перечнем увиденных доменов (должен быть только localhost).

## 3. openapi без валидатора

- [x] 3.1 `plugins/openapi/index.ts`: `SwaggerUIBundle({ url, dom_id, validatorUrl: null })`. Проверка: `test/plugin-openapi.test.mjs` — ожидание строки инициализации с `validatorUrl: null`; тест зелёный.

## 4. Автопроверка и golden

- [ ] 4.1 `npm run test:golden:update`: осознанно переснять `index.html` и `vendor/vue.css` во всех вариантах (`default`, `links-top`, `embed-png`). Проверка: `git diff --stat test/golden` — меняются только эти файлы и их строки в `manifest.json`; страницы `.md`, `.svg`, `llms*.txt` без изменений (SVG-шум fontconfig на Arch не коммитить).
- [ ] 4.2 `test/offline-site.test.mjs` по design §6: скан `test/golden/default/tree` (`index.html`, `**/*.css`, `**/*.md`), исключение — значение `repo` в `$docsify`, в `.md` — только адреса в изображениях; сообщение называет файл и адрес. Проверка: тест зелёный; временная вставка `<script src="https://cdn.example/x.js">` во встроенный шаблон + `test:golden:update` даёт красный тест с `index.html` и адресом (откатить).
- [ ] 4.3 Полный прогон: `npm run build`, `npm test`, `npm run check`, `openspec validate offline-site-assets --strict` — всё зелёное.

## 5. Актуализация

- [ ] 5.1 Сайт документации: `docs/docsify-template.mjs` — убрать инлайн темы и `noEmoji`, тема через `<link href="${options.stylesheet}">`, оставить `lang` и `nameLink` (design §7). Проверка: сборка `docs/ru` и `docs/en` → код 0; в `dist/index.html` и `dist/vendor/vue.css` нет внешних адресов.
- [ ] 5.2 Страницы сайта RU и EN: «03 Диаграммы» — блоки ```` ```plantuml ```` в страницах рендерятся при сборке, ```` ```puml ````/```` ```text ```` — для показа исходника; «04 Выводы» или «02 Проект» — сайт работает без интернета (что именно не загружается извне), оговорка про `generateLocalImages: false`; «06 Плагины» — openapi без валидатора. Проверка: `npx vitest run test/docs-parity.test.mjs` зелёный, сборка RU/EN → 0.
- [ ] 5.3 `skills/c4builder` (`SKILL.md` или `references/diagrams.md`): блоки ```` ```plantuml ```` в `.md` рендерятся при сборке, исходник показывать через `puml`; `template/AGENTS.md` — без изменений, если там нет упоминания блоков. Проверка: `npx vitest run test/skills.test.mjs` зелёный.
- [ ] 5.4 `CHANGELOG.md`, `## Unreleased`: сайт без внешних запросов (шрифты, emoji, клиентский PlantUML, валидатор swagger-ui); **BREAKING (вывод):** блоки ```` ```plantuml ```` в страницах теперь картинки во всех выходах, для исходника — `puml`/`text`. Проверка: ревью глазами.
