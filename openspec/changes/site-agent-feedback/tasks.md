# Tasks

## 1. Агентский режим и CLI

- [x] 1.1 `detectAgent(env, flags)` по design D2 (флаги → `C4BUILDER_AGENT` → переменные агентов) в отдельном модуле `src/cli/agent.ts`. Проверка: новый `test/agent-detect.test.mjs` — матрица: пусто → выкл; `CLAUDECODE=1` → `claude-code`; `C4BUILDER_AGENT=0` при `CLAUDECODE` → выкл; `--agent` без переменных → вкл; `--no-agent` при `C4BUILDER_AGENT=codex` → выкл; `AI_AGENT=x` → `x`.
- [x] 1.2 Флаги `--agent` / `--no-agent` в `src/cli/dispatch.ts`, проброс результата `detectAgent` в `cmdSite`; подсказка при старте `site -w` по design D2; `feedback` в `COMMANDS` (и в копии списка в `test/skills.test.mjs`). Проверка: `test/cli-site.test.mjs` — `site -w` с `CLAUDECODE=1` печатает подсказку и отдаёт страницу с флагом агентского режима, с `--no-agent` — нет; `c4builder nwe` по-прежнему перечисляет команды, теперь с `feedback`.

## 2. Очередь и эндпоинты dev-сервера

- [x] 2.1 Очередь пачек в памяти и `POST /__c4builder/feedback` (валидация по design D6, ответ `{ id, queued }`) и `GET /__c4builder/feedback/next` (long-poll 25 с, `?wait=0`, `204`/`200 text/markdown`, снятие с очереди по `finish`, возврат при обрыве) в `src/cli/commands/site.ts`; общий код проверки `Host`/`Origin` с `resolveTarget`. Проверка: `test/cli-site.test.mjs` — пачка до подключения ждёт и выдаётся следующему запросу; два ожидающих — пачку получает один; `?wait=0` при пустой очереди → `204`.
- [x] 2.2 Защита по design D6: `next` без `X-C4builder-Feedback`, с `Origin` или с чужим `Host` → `403`, пачка остаётся; `POST` без своего `Origin` → `403`; `--no-agent` → оба эндпоинта `404`; первый запрос `next` включает агентский режим без флага. Проверка: те же сценарии в `test/cli-site.test.mjs` (подмена `Host` — через `node:http`, как в тесте DNS rebinding).
- [x] 2.3 События SSE `agent` (`{ on, listening }`, при подключении и при смене) и `delivered` (`{ id }`) на `/__livereload` по design D4. Проверка: `test/cli-site.test.mjs` — подписчик `/__livereload` получает `listening: true` при открытом long-poll, `false` через 30 с без запросов (интервал вынести в параметр сервера для теста) и `delivered` с id отправленной пачки.

## 3. Формат пачки

- [x] 3.1 `formatBatch(batch, pages)` по design D7 (страница, исходники из `pages()`, раздел, цитата, многострочный текст, общий комментарий, пустой `approved`) — чистая функция в `src/core/feedback.ts`, экспорт в `test/dist.mjs`. Проверка: новый `test/feedback-format.test.mjs` — пример из design D7 побайтно, неизвестная страница без строки `Sources`, пустая пачка `approved`.

## 4. Команда `c4builder feedback`

- [x] 4.1 `src/cli/commands/feedback.ts` по design D9: порт из `-p` или `.c4builder` (чтение JSON без Configstore), запросы на `127.0.0.1` с `X-C4builder-Feedback: 1`, цикл на `204` при `--wait`, печать пачки, коды и сообщения ошибок; флаг `--wait` в `dispatch`; без уведомления о новой версии. Проверка: новый `test/cli-feedback.test.mjs` — без сервера: код 1, сообщение с адресом, каталог пуст (нет `.c4builder`); с `site -w`: `feedback --wait` печатает отправленную через `POST` пачку и выходит с 0; `feedback` при пустой очереди — пустой stdout, код 0; сервер с `--no-agent` — код 1 и сообщение про `--no-agent`.

## 5. Страница: кнопки, поповер, review

- [x] 5.1 Подписи site-comments: «Comment» → **Question**, «Add» → **Add question**; в агентском режиме рядом кнопка **Feedback** (начальное состояние — из сервера, обновление — по SSE `agent`). Проверка: `test/site-comments-client.test.mjs` — без режима одна кнопка `Question`; с режимом `Feedback` и `Question`; событие `agent { on: true }` добавляет `Feedback` без перезагрузки.
- [x] 5.2 Поповер Feedback: цитата, текст, **Send now** / **Add to review**, основная кнопка и `Ctrl/⌘+Enter` по design D8, индикатор слушателя, тосты «в очереди» / «доставлено» / ошибка. Проверка: jsdom-тест — **Send now** шлёт `POST /__c4builder/feedback` с одним замечанием и решением `submitted`; при непустом review основная кнопка — **Add to review**; событие `delivered` с id меняет тост.
- [x] 5.3 Черновик review в `localStorage` по design D5 (ключ с `projectKey`, синхронизация вкладок, `try/catch`), подсветка черновых цитат отдельным классом, панель review (**Submit review** с общим комментарием, **Approve**, **Discard**, список с «×»). Проверка: jsdom-тест — два **Add to review** переживают повторный рендер страницы с тем же `localStorage`; другой `projectKey` черновик не видит; **Submit review** шлёт одну пачку и очищает черновик; **Approve** при пустом черновике шлёт `approved` без замечаний; цитата черновика подсвечена классом, отличным от вопросов.

## 6. Актуализация

- [x] 6.1 Страницы «05 CLI и конфигурация» / «05 CLI and configuration»: подкоманда `feedback` (`--wait`, `-p`), флаги `--agent` / `--no-agent`, переменная `C4BUILDER_AGENT` и список распознаваемых переменных; в разделе о комментариях — новые подписи **Question** / **Feedback** и review. Проверка: `npx vitest run test/docs-parity.test.mjs` зелёный.
- [x] 6.2 Страницы «08 Агенты» / «08 Agents»: раздел о цикле замечаний со страницы (`site -w` + `feedback --wait` в фоне, повтор после пачки, `Decision: approved`, отличие от вопросов в `questionsHeading`), пример пачки. Проверка: `docs-parity` зелёный.
- [x] 6.3 `skills/c4builder/SKILL.md` (шаг живого просмотра → цикл feedback по сценарию спеки `agent-skills`) и `template/AGENTS.md` (команда `c4builder feedback --wait`, шаг 3). Проверка: `npx vitest run test/skills.test.mjs` зелёный (флаги и подкоманды существуют); тест шаблона на `AGENTS.md` (`project-template`) зелёный.
- [x] 6.4 Строка в `## Unreleased` `CHANGELOG.md`: feedback агенту, `c4builder feedback`, `--agent` / `--no-agent`, переименование кнопки в **Question**. Проверка: `git diff CHANGELOG.md`.
- [x] 6.5 Итог: `npm run check`, `npm run test:unit`, `openspec validate site-agent-feedback --strict` зелёные; ручная проверка в Claude Code: `site -w` и `feedback --wait` в фоне, **Send now**, review из двух страниц, **Approve** — агент правит исходники, страница перезагружается, на `approved` агент перестаёт ждать.
