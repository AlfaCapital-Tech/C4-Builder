## 1. Ключ uiLanguage

- [x] 1.1 `uiLanguage` в `src/config/defaults.ts` (`auto`), `schema.ts` (строка с `refine` на `auto | en | ru`, сообщение `expected auto, en or ru`), `options.ts` и `dispatch.ts` (`UI_LANGUAGE`). Проверка: в `test/config.test.mjs` без ключа — `auto`, `en` и `ru` принимаются, `de` даёт ошибку с `uiLanguage` и допустимыми значениями; golden без изменений (`npm run test:golden`).

## 2. Словарь и выбор языка

- [x] 2.1 Модуль `src/cli/commands/site.i18n.ts` с `UI_STRINGS.en` и `UI_STRINGS.ru` для всех текстов скрипта страницы, включая подписи `review-panel-done`. Русские подписи — по глоссарию design D7, строки с числом — объекты форм (D3). Проверка: тест 2.3.
- [x] 2.2 `commentsSnippet` получает `language` (`auto | en | ru`) и оба словаря, выбирает язык по D1 и берёт все тексты через `t(key, vars)` с `Intl.PluralRules`; `failure(what)` заменён ключами на действие (D4); `inject()` в `site.ts` передаёт `UI_LANGUAGE`. Проверка: тесты 2.4.
- [x] 2.3 `test/cli-language.test.mjs`: пропуск ровно `src/cli/commands/site.i18n.ts`, проверка паритета ключей `en`/`ru` и форм множественного числа (D5). Проверка: тест зелёный; кириллица в любом другом файле `src/` и удалённый из `ru` ключ роняют его (проверить вручную и откатить).
- [x] 2.4 `test/site-comments-client.test.mjs`: `navigator.languages` `ru-RU, en` при `auto` — русские подписи у выделения, в поповере и в панели; `de-DE, fr` — английские; `de-DE, ru, en` — русские; `language: 'en'` при русском браузере — английские; счётчик панели «1 замечание», «2 замечания», «5 замечаний» и «на 1 странице»; ошибка сервера в тосте — русский префикс и английский текст ошибки. Существующие английские тесты не меняются. Проверка: `npx vitest run test/site-comments-client.test.mjs` зелёный.
- [x] 2.5 Ручная проверка: `site -w --agent` в браузере с русским и с английским языком. Подписи помещаются в кнопки и панель (ширина 520px), русские тексты читаются естественно. Найденное поправить в словаре.

## 3. Актуализация

- [x] 3.1 Страница «05 CLI и конфигурация» (RU/EN): ключ `uiLanguage` в таблице ключей. Страница «08 Агенты» (RU/EN): язык интерфейса страницы и как его закрепить. Проверка: тест `docs-parity` зелёный.
- [x] 3.2 `skills/c4builder/references/config.md` — строка `uiLanguage`; `template/AGENTS.md` — одна фраза рядом с `questionsHeading`. Проверка: тест `skills` зелёный.
- [x] 3.3 Строка в `## Unreleased` CHANGELOG.md про язык интерфейса `site -w` и ключ `uiLanguage`. Проверка: `npm test` и `npm run check` зелёные.
