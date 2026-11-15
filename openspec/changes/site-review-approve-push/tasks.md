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
- [x] 5.3 ~~`site.comments.ts`: липкий тост с **Push** и состоянием в `sessionStorage`~~ — заменён плашкой журнала (группа 7)

## 6. Актуализация

- [x] 6.1 Сайт: `docs/ru/src/05 CLI и конфигурация` и `docs/en/src/05 CLI and configuration` — ключи `comments.approve`, `comments.push`, `buttons.approve`, `buttons.push` в таблице ключей и пример; `docs/ru/src/08 Агенты` и `docs/en/src/08 Agents` (раздел журнала ревью) — апрув строки и Push, что коммитится только журнал, поведение при конфликте и отсутствии upstream, предупреждение, что правки агента в том же файле уйдут вместе; проверка — тест `docs-parity` зелёный, сборка сайта `cd docs/ru && NO_UPDATE_NOTIFIER=1 node ../../dist/index.js --site` без ошибок
- [x] 6.2 Скиллы `skills/c4builder/SKILL.md`, `skills/c4builder/references/config.md`, `skills/c4builder-review/SKILL.md` и `template/AGENTS.md` — новые ключи и кнопки; проверка — тест `skills` зелёный, grep `approve` находит новые ключи в `references/config.md`
- [x] 6.3 `CHANGELOG.md`, `## Unreleased`: кнопка апрува строки таблицы статусов и плашка **Push** журнала, ключи `comments.approve`, `comments.push`, `buttons.approve`, `buttons.push`; проверка — строка есть
- [x] 6.4 Полный прогон: `npm run build && npm test && npm run check`; ручная проверка в `site -w` на копии проекта с OpenSpec-журналом с локальным bare-remote: апрув строки и Push комментариев доходят до remote

## 7. Плашка Push журнала вместо липкого тоста

- [x] 7.1 Сервер: GET `/__c4builder/review-log?page=` при включённом `push` отвечает `pending: { changed, unpushed } | null` (`reviewPending`: `git status` файла журнала и число незапушенных коммитов журнала; null — не git, нет upstream, отказ preflight); чтение — через очередь git-операций, GET во время пуша ждёт его конца; проверка — `test/cli-site.test.mjs`: чисто → `{ changed: false, unpushed: 0 }`, правка руками → `changed: true`, отклонённый пуш → `unpushed: 1`, после пуша снова чисто, GET во время медленного пуша видит итог, страница вне change — 404, `push.enabled: false` — поля нет
- [x] 7.2 Клиент: плашка в общем нижнем ряду справа от панели агента (цвет журнала), текст `logPending` (en/ru) и кнопка `buttons.push` или словарь; без кнопки закрытия; обновляется GET'ом при отрисовке и после комментария, удаления, апрува, пуша; липкий тост и его `sessionStorage` убраны, тост после **Add comment** снова обычный; проверка — `test/site-comments-client.test.mjs`: плашка по `pending` (изменён / незапушенный коммит), нет при чистом, null, 404, без `push`; после **Add comment** — обычный тост и плашка; плашка справа от панели в общем ряду; подпись из `buttons.push`, русский текст
- [x] 7.3 Кнопки после действия: Push и Approve row неактивны на время запроса; после успешного Push или «nothing to push» плашка скрывается сразу и не возвращается; после Approve кнопка скрыта у этой строки до перерисовки; при ошибке кнопка снова активна, плашка остаётся; проверка — jsdom-тесты «Push: на время запроса кнопка неактивна…», ««нечего пушить» тоже скрывает плашку…», «Approve row после успеха»
- [x] 7.4 Спека (требование «Плашка Push журнала» со сценариями), design (решение, причина остававшейся кнопки, отвергнутые варианты), proposal, docs ru/en стр. 05 и 08, skills, CHANGELOG; проверка — `openspec validate site-review-approve-push --strict`, `docs-parity`, `skills`, `npm run build && npm test && npm run check`
- [x] 7.5 Раскладка: общий нижний ряд `.c4b-dock` (flex, `wrap-reverse`, по низу) — панель агента и плашка рядом, на узком экране плашка над панелью; плашка компактная — «Review log has unpushed changes» / «Журнал ревью не запушен», путь в подсказке; у `.markdown-section` нижний отступ = высота ряда + 32px (ResizeObserver с фолбэком), без панелей — снят; проверка — jsdom: порядок [панель, плашка] в общем контейнере, CSS ряда с `wrap-reverse`, отступ появляется и снимается для панели агента и для плашки (высоты заданы вручную); `openspec validate --strict`, `npm run build && npm test && npm run check`

## 8. Второй раунд code review

- [x] 8.1 livereload во время запроса, меняющего журнал: сервер откладывает `reload` до ответа, страница — до обработки ответа, тост сохраняется в момент перезагрузки; проверка — `cli-site`: при медленном пуше апрува `reload` приходит только после ответа (без отсрочки тест падает); jsdom: перезагрузка ждёт ответа Push, тост переживает её, без перезагрузки тост не сохраняется
- [x] 8.2 Строка по ячейкам — в ширину заголовка (`fitRow` в `findRowByCells`) для апрува и удаления; проверка — `reviewlog.test.mjs`: строка короче заголовка находится, лишняя непустая ячейка — нет
- [x] 8.3 Запись и удаление комментариев — через очередь git; откат апрува только своей версии; проверка — `reviewgit.test.mjs`: hook дописал строку и упал — правка не затёрта, ошибка поясняет; `cli-site`: комментарий во время пуша отвечает после пуша
- [x] 8.4 `--untracked-files=all` в `commitFile` и `reviewPending`; проверка — `reviewgit.test.mjs` при `status.showUntrackedFiles=no`
- [x] 8.5 Правило «одобрено» — серверное: `approvedRows` в GET страницы журнала, клиент по нему; `configWarnings` для `set` без литералов; проверка — `reviewlog.test.mjs` (регистр, без литералов), `config.test.mjs`, jsdom (кнопки по `approved` сервера)
- [x] 8.6 stdin git закрыт, ssh `BatchMode=yes` без своей команды пользователя; проверка — `reviewgit.test.mjs`: hook с `cat` не ждёт, `sshEnv` с/без `core.sshCommand` и `GIT_SSH_COMMAND`
- [x] 8.7 GET журнала без git, git-состояние — `GET /__c4builder/review-log/state` через очередь, только при push/approve; проверка — `cli-site`: в GET журнала нет `pending`, без push и approve маршрута состояния нет; jsdom: состояние не спрашивается без push/approve
- [x] 8.8 `commit-tree -S` при `commit.gpgsign`; hooks при переносе — в Risks design; проверка — `reviewgit.test.mjs` с заглушкой `gpg.program`: перенесённый коммит в remote с `gpgsig`
- [x] 8.9 `push` нормализован в `commentsLog` (`PUSH_MESSAGE`); проверка — `config.test.mjs`
- [x] 8.10 preflight один раз на пути повторного апрува, `ahead` передаётся в `syncAndPush`; проверка — прежний тест повторного апрува в `cli-site`
- [x] 8.11 Спека, design, docs ru/en; проверка — `openspec validate --strict`, `npm run build && npm test && npm run check`

## 9. Третий раунд code review

- [x] 9.1 git в своей группе процессов: таймаут и лимит вывода убивают группу (SIGTERM, затем SIGKILL), вызов не ждёт пайпов внуков; проверка — `reviewgit.test.mjs`: hook с `sleep &` завершается и очередь работает; hook висит дольше таймаута 1 с — ошибка о таймауте, правка откатана
- [x] 9.2 Серверная отсрочка livereload убрана, остаётся отсрочка на странице; проверка — jsdom: сниппет livereload откладывает reload во время запроса и сохраняет тост, без запроса — сразу; тест `cli-site` с отсрочкой сервера убран
- [x] 9.3 Литерал `set` — непустое значение без подстановок; проверка — `reviewlog.test.mjs`, `config.test.mjs` (предупреждение для пустого значения)
- [x] 9.4 Повторный апрув — только закоммиченный и не запушенный апрув строки; `unpushedRows` в state; ошибка preflight не глотается; проверка — `cli-site`: отметка строки после отклонённого пуша, дотолкивание, «не закоммичено» для правки руками; jsdom: кнопка по `unpushedRows`
- [x] 9.5 Ignored-журнал — отказ в preflight; «нечего коммитить» после правки — откат и ошибка; проверка — `reviewgit.test.mjs`
- [x] 9.6 Общая проверка колонок `statusTable`; `configError` в GET страницы журнала, тост один раз; проверка — `reviewlog.test.mjs`, jsdom
- [x] 9.7 Одна проходка `git log` в preflight; кэш state 2 с со сбросом; state не спрашивается без журнала; проверка — прежние тесты preflight, `cli-site` (повтор state из кэша, правка руками видна после пересборки), jsdom (404 — без state)
- [x] 9.8 `git fetch <remote> <ветка>`; проверка — `reviewgit.test.mjs`: чужая ветка remote не подтягивается
- [x] 9.9 Апрув: одна проверка до git, пересчёт в `edit()`, автор из записанной строки; проверка — тесты апрува `cli-site`
- [x] 9.10 `pending` убран из `Upstream`, `ahead` из одной проходки; проверка — тесты `reviewgit`
- [x] 9.11 Спека, design, docs ru/en; проверка — `openspec validate --strict`, `npm run build && npm test && npm run check`
