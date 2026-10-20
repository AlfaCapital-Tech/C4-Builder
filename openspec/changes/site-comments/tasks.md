# Tasks

## 1. Источники страниц

- [x] 1.1 `TreeItem.sources` в `src/core/scan/tree.ts` (абсолютные пути `.md` папки), `PageSpec.sources` в `src/core/plugins/types.ts`, перенос в `addPage` (`src/core/plugins/tree.ts`). `RenderedPage.sources` в `src/plugins/openspec/render.ts`: `renderMarkdown` — свой файл + источники `:include`; `renderChange` — источники первого артефакта на странице change'а; `renderSpecTree` — пустой массив у папок; `addPages` в `src/plugins/openspec/index.ts` передаёт `sources`. Проверка: `test/plugin-openspec.test.mjs` — у страницы артефакта `sources` = путь артефакта, у страницы с `:include` — оба файла, у индекса Changes — пусто.
- [x] 1.2 `generateWebMD` возвращает карту `страница → sources` (posix-путь `.md` от корня dist); `build()` возвращает `{ pages }`; `dispatch` хранит карту последней успешной сборки (первой и каждой из watch) и передаёт `cmdSite` функцией-геттером. Проверка: `npm run build` без ошибок типов.

## 2. Конфиг и правка раздела

- [x] 2.1 Ключ `questionsHeading` (`Open questions`) в `src/config/{defaults,schema,options}.ts` и `getOptions` (`QUESTIONS_HEADING`). Проверка: `test/config.test.mjs` (или существующий тест схемы) — дефолт и пользовательское значение.
- [x] 2.2 `src/core/questions.ts`: `formatQuestion(comment, quote, section)`, `appendQuestion(markdown, heading, text)`, `pickSource(files, heading)` по design D4. Экспорт в `test/dist.mjs`. Проверка: `test/questions.test.mjs` — таблица с номерами (`# | Вопрос | Кому`), заглушка `1 | ... | ...` заменяется, таблица без номеров, список, раздел с прозой, раздела нет, заголовок другого уровня/регистра, `\r\n`, экранирование `|`, обрезка цитаты.

## 3. Dev-сервер и клиент

- [x] 3.1 `POST /__c4builder/comments` в `src/cli/commands/site.ts` по design D3: только при `-w`, `express.json()` на маршруте, проверка `Origin`, нормализация `page`, выбор файла, запись, ответ `{ file, number }`; лог в терминал `comment added to <file>`. Проверка: `test/cli-site.test.mjs` — POST с верным `Origin` пишет в `src/README.md` раздел и пункт, ответ 200 с `file`; без `Origin` — 403, файл не изменён; неизвестная страница — 404; без `-w` маршрута нет (404).
- [x] 3.2 Клиентский сниппет `src/cli/commands/site.comments.ts` по design D5, подключение в `inject()`. Проверка: в `test/cli-site.test.mjs` `GET /` при `-w` содержит `__c4builderComments`, `index.html` на диске — нет; ручная проверка в браузере на store `product-spec` (`questionsHeading: Открытые вопросы`): вопрос попадает строкой таблицы `design.md`, страница перезагружается.
- [x] 3.3 Подсветка цитат вопросов по design D5: `<mark>` + `<sup>`-ссылка на строку; проверка — `test/site-comments-client.test.mjs` (jsdom): цитата через `<code>` и границу абзаца, префикс обрезанной цитаты, список без номеров, раздел вопросов не подсвечивается.
- [x] 3.4 Удаление: `removeQuestion`/`deleteQuestion` в `src/core/questions.ts` (общие `findSection`/`findTable` с добавлением), `DELETE /__c4builder/comments` в `site.ts` (общий `resolveTarget` с POST), кнопка `×` в сниппете. Проверка: `test/questions.test.mjs` (по номеру и тексту, экранированный `|`, ambiguous, not-found, список), `test/cli-site.test.mjs` (DELETE удаляет пункт, без Origin — 403), `test/site-comments-client.test.mjs` (клик шлёт DELETE с номером и текстом).
- [x] 3.5 Watch при занятом локе (второй `site -w` на той же папке) ждёт освобождения (`waitBuildLock`, до минуты) вместо пропуска ребилда — иначе после записи вопроса браузер не получает reload. Проверка: `test/lock.test.mjs`.

## 4. Актуализация

- [x] 4.1 Страницы `05 CLI и конфигурация` / `05 CLI and configuration`: подраздел о комментариях в `site -w` и строка `questionsHeading` в таблице ключей. Проверка: `npx vitest run test/docs-parity.test.mjs` зелёный.
- [x] 4.2 `skills/c4builder/references/config.md` — строка `questionsHeading`; `skills/c4builder/SKILL.md` — фраза о комментариях в `site -w`. Проверка: `npx vitest run test/skills.test.mjs` зелёный.
- [x] 4.3 Строка в `## Unreleased` `CHANGELOG.md`. Проверка: `git diff CHANGELOG.md`.
- [x] 4.4 Итог: `npm run check`, `npm run test:unit`, `openspec validate site-comments --strict` зелёные.
