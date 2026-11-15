# Tasks

## 1. Конфиг

- [x] 1.1 `schema.ts`: в `commentsLogFields` — `approve` (`heading`: строка или список, `who`, `set`: словарь строк) и `push` (`enabled` по умолчанию `true`, `message` по умолчанию `review {change}: {action} — {author}`); в `buttons` — `approve` и `push`; проброс через `options.ts`/`dispatch.ts` в `site -w`; проверка — `test/config.test.mjs`: `push: {}` включён, `push: { enabled: false }` выключен, `approve.heading` строкой и списком, неизвестные поля молча отбрасываются

## 2. Git-операции над файлом журнала

- [x] 2.1 `src/core/reviewgit.ts`: проверка репозитория, ветки и `@{upstream}`; коммит `--only` одного файла с сообщением по шаблону (`{change}`, `{action}`, `{author}`, `{file}`); fetch, rebase `--autostash` на upstream только если он ушёл вперёд, `rebase --abort` при ошибке; push `HEAD:<branch>` в remote upstream, только если HEAD опережает; `execFile` без shell, `GIT_TERMINAL_PROMPT=0`, таймауты; ошибки — английский текст с хвостом stderr; проверка — новый `test/reviewgit.test.mjs` на временном репозитории с bare-remote: посторонние правки (в индексе и нет) не попадают в коммит и не теряются; upstream впереди без конфликта — rebase и push; конфликт — abort, рабочая копия как была, коммит локальный; нет upstream / detached HEAD — ошибка без коммита; нечего коммитить и не впереди — «nothing to push»; повтор после отклонённого пуша пушит без нового коммита
- [x] 2.2 Очередь: git-операции сервера выполняются строго по одной; проверка — тест в `test/reviewgit.test.mjs`: два одновременных вызова завершаются оба, без ошибки `index.lock`

## 3. Апрув строки на сервере

- [x] 3.1 `sections.ts`/`reviewlog.ts`: найти в таблице раздела (варианты `heading`) ровно одну строку по всем ячейкам (через `plain`), индексы колонок по заголовкам; записать ячейки `set` с подстановками `{date}` и `{author}` (= ячейка `who`), экранирование как у ячеек журнала; ошибки «строка не найдена / несколько» и «нет колонки <name>»; проверка — `test/reviewlog.test.mjs`: строка `| Аналитик | | Иванов Иван | |` → `| Аналитик | Approved | Иванов Иван | 2026-11-15 |`, остальной файл байт в байт прежний; дубль строки — ошибка; нет колонки — ошибка, файл не изменён
- [x] 3.2 `site.ts`: `POST /__c4builder/review-log/approve` (только с `comments.approve`): `fromSite`/`localHost`, страница — сам журнал, проверка git до правки файла, запись ячеек, коммит с `{action}` = `approved`, синхронизация и пуш; ответы 403/404/409 по спеке; проверка — `test/cli-site.test.mjs`: успех на репозитории с bare-remote (в remote коммит с сообщением `review <dir>: approved — <имя>`), 403 без `Origin`, 404 без ключа и для страницы не-журнала, 409 на устаревшей строке без изменения файла

## 4. Push на сервере

- [x] 4.1 `site.ts`: `POST /__c4builder/review-log/push` (только с включённым `comments.push`): `fromSite`/`localHost`, журнал по странице (`findReviewFile`), коммит с `{action}` = `comments` и `{author}` = автор комментариев, синхронизация и пуш; ответ `{ file, commit, pushed }`; проверка — `test/cli-site.test.mjs`: три комментария и один push дают один коммит в remote; посторонний изменённый файл не попал; `enabled: false` и отсутствие ключа — 404; 403 с чужим `Origin`

## 5. Клиент

- [x] 5.1 `site.i18n.ts`: Approve row / «Одобрить строку», Push / «Запушить», тексты тостов успеха, «nothing to push» и подсказки кнопок (en/ru, одинаковые ключи); проверка — тест `cli-language` и тест словаря зелёные
- [x] 5.2 `site.comments.ts`: кнопка **Approve row** у выделения на странице журнала — оба конца выделения в одном `tr` таблицы раздела `approve.heading`, ячейка `who` не пуста и не `—`/`-`, литеральные значения `set` ещё не стоят; подпись `buttons.approve` или словарь; запрос с `page` и ячейками строки, тост с результатом; проверка — `test/site-comments-client.test.mjs`: кнопка есть в строке с именем, нет при выделении через две строки, в строке без имени, в уже одобренной строке, в разделе «Замечания», на странице не-журнала, без ключа `approve`; подпись из `buttons.approve`
- [x] 5.3 `site.comments.ts`: тост после **Add comment** с кнопками **Push** и «×» без таймера при включённом `push`; состояние в `sessionStorage` под ключом проекта — тост восстанавливается после перезагрузки; повторный **Add comment** обновляет тот же тост; после успеха — обычный тост с таймером; проверка — `test/site-comments-client.test.mjs`: тост с **Push** не исчезает по таймеру, переживает перезагрузку, без ключа `push` тост прежний; подпись из `buttons.push`

## 6. Актуализация

- [x] 6.1 Сайт: `docs/ru/src/05 CLI и конфигурация` и `docs/en/src/05 CLI and configuration` — ключи `comments.approve`, `comments.push`, `buttons.approve`, `buttons.push` в таблице ключей и пример; `docs/ru/src/08 Агенты` и `docs/en/src/08 Agents` (раздел журнала ревью) — апрув строки и Push, что коммитится только журнал, поведение при конфликте и отсутствии upstream, предупреждение, что правки агента в том же файле уйдут вместе; проверка — тест `docs-parity` зелёный, сборка сайта `cd docs/ru && NO_UPDATE_NOTIFIER=1 node ../../dist/index.js --site` без ошибок
- [x] 6.2 Скиллы `skills/c4builder/SKILL.md`, `skills/c4builder/references/config.md`, `skills/c4builder-review/SKILL.md` и `template/AGENTS.md` — новые ключи и кнопки; проверка — тест `skills` зелёный, grep `approve` находит новые ключи в `references/config.md`
- [x] 6.3 `CHANGELOG.md`, `## Unreleased`: кнопка апрува строки таблицы статусов и **Push** в тосте комментария, ключи `comments.approve`, `comments.push`, `buttons.approve`, `buttons.push`; проверка — строка есть
- [x] 6.4 Полный прогон: `npm run build && npm test && npm run check`; ручная проверка в `site -w` на копии проекта с OpenSpec-журналом с локальным bare-remote: апрув строки и Push комментариев доходят до remote
