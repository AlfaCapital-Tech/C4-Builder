## 1. Удаление вопросов

- [x] 1.1 `src/core/questions.ts` → `src/core/sections.ts` с нейтральными именами функций; удалить `pickSource`, `hasHeading` и прочее, что нужно только вопросам; `reviewlog.ts` импортирует из `sections.ts`; `test/questions.test.mjs` → `test/sections.test.mjs` без сценариев вопросов; проверка — `npx vitest run test/sections.test.mjs test/reviewlog.test.mjs`
- [x] 1.2 `site.ts`: убрать маршруты `COMMENTS_PATH` (POST/DELETE) и `QUESTIONS_HEADING`; `COMMENTS_PATH` удалить из `site.comments.ts`; проверка — `POST /__c4builder/comments` отвечает 404 в `test/cli-site.test.mjs`
- [x] 1.3 Клиент `site.comments.ts`: удалить кнопку вопроса, ветку подсветки и удаления вопросов (`QUESTIONS`, `HEADING`, `ENDPOINT`), строки вопросов из `site.i18n.ts`; подсветка и «×» журнала работают как раньше; проверка — `npx vitest run test/site-comments-client.test.mjs`
- [x] 1.4 Конфиг: убрать `questions`/`questionsHeading` из `schema.ts`, `defaults.ts`, `options.ts`, `dispatch.ts`; проверка — `test/config.test.mjs`: конфиг с `questions: false` и `questionsHeading` проходит без ошибок

## 2. Подписи и ключ `buttons`

- [x] 2.1 `site.i18n.ts`: Comment / «Комментарий», Add comment / «Добавить комментарий», Tell agent / «Сказать агенту»; панель — Send to agent, Add / «Добавить», «To agent: N pending (M pages)», «To agent: nothing pending», Remove / «Убрать» и русские пары; короткие статичные подсказки (откатить подсказки с файлом/агентом и ключ `feedbackTitleTo`); проверка — тест `cli-language`
- [x] 2.2 Ключ `buttons` (`agent`, `comment`) в `schema.ts`/`defaults.ts`/`options.ts`/`dispatch.ts`, передача в `commentsSnippet`; приоритет `buttons.comment` → `reviewLog.label` → словарь; проверка — тесты клиента на три сценария из спеки `site-comments` «Подписи кнопок у выделения»
- [x] 2.3 `test/site-comments-client.test.mjs`: новые подписи en/ru, сценарии «одна Comment без агента», «Tell agent и Comment», «без журнала и агента кнопок нет»; проверка — тест зелёный

## 3. Актуализация

- [x] 3.1 Сайт: `docs/ru/src/05 CLI и конфигурация`, `docs/ru/src/08 Агенты` и их EN-пары — убрать вопросы и ключи `questions`/`questionsHeading`, новые подписи, ключ `buttons` в таблице ключей; проверка — grep по `Question`, `questionsHeading`, `Submit review`, `Add to review`, `**Feedback**`, `**Review**` в `docs/*/src` пуст, тест `docs-parity` зелёный
- [x] 3.2 Скиллы `skills/c4builder` (SKILL.md, `references/config.md`), `skills/c4builder-review/SKILL.md`, `template/AGENTS.md` — без вопросов, новые подписи, ключ `buttons`; проверка — тест `skills` зелёный, тот же grep пуст
- [x] 3.3 `docs/ru/.c4builder`, `docs/en/.c4builder`, `template/` — убрать `questions`/`questionsHeading`, если есть; проверка — grep
- [x] 3.4 `CHANGELOG.md`, `## Unreleased`: **BREAKING** — вопросы удалены (замена — `reviewLog` или Tell agent); новые подписи кнопок и панели; ключ `buttons`
- [x] 3.5 Полный прогон: `npm run build && npm test && npm run check`

## 4. Ключ comments

- [x] 4.1 Схема: ключ `comments` (`enabled`, `file`, `heading`, `cells`, `author`), `reviewLog` — синоним с `label`; функция выбора `commentsLog` (comments → reviewLog), `dispatch.ts` передаёт её результат в `REVIEW_LOG` и `reviewLog.label` для подписи; проверка — `test/config.test.mjs`: только `comments`, только `reviewLog`, оба (побеждает `comments`), `comments.label` отбрасывается
- [x] 4.2 Сервер и клиент: журнал работает с `comments` так же, как с `reviewLog`; проверка — `test/cli-site.test.mjs` с ключом `comments`, клиентские тесты подписей зелёные
- [x] 4.3 Актуализация: `docs/ru/src`, `docs/en/src` (таблица ключей, раздел журнала, якоря), `skills/*` (включая `references/`), `template/AGENTS.md`, строка в `## Unreleased` CHANGELOG.md; проверка — grep `reviewLog` в docs/skills/template остаётся только в упоминании синонима, тесты `docs-parity` и `skills` зелёные
- [x] 4.4 Полный прогон: `npm run build && npm test`, `npx biome ci src test skills docs/docsify-template.mjs`

## 5. Правки по ревью

- [x] 5.1 `commentsLog`: `label` только у журнала из `reviewLog`; проверка — `test/config.test.mjs` (перекрытый и выключенный `reviewLog` не дают подпись)
- [x] 5.2 Предупреждение CLI о `comments.label` (`configWarnings` в `schema.ts`, вывод в `dispatch.ts`); документация RU/EN (05) и `skills/c4builder/references/config.md`; проверка — `test/config.test.mjs`
- [x] 5.3 Упрощения клиента: без мёртвой ветки подсказки и параметра `skip`; один ключ `sendFailed` вместо `reviewFailed`/`feedbackFailed`; комментарии без упоминаний вопросов; проверка — `npx vitest run test/site-comments-client.test.mjs test/cli-language.test.mjs`
- [x] 5.4 Прогон: `npm run build && npm test`, `npx biome ci src test skills docs/docsify-template.mjs`

## Workflow follow-up

- После merge — архив change'а (`/opsx:archive`): при синхронизации обновить `## Purpose` спеки `site-comments` (теперь это кнопки у выделения и журнал, а не вопросы).
