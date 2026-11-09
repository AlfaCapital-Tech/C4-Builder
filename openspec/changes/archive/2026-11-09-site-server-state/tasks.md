# Tasks

## 1. Файл состояния и выбор порта

- [x] 1.1 `src/cli/server-state.ts`: путь `<конфиг>.server.json`, атомарная запись (tmp + `rename`),
  удаление только своего `pid`, чтение с проверкой живости (`pid` + `GET /__c4builder/status` с тем
  же `pid`, таймаут 1 с), выбор порта `-p` → файл → `webPort` с источником (design D1–D4, D6).
  Проверка: юнит-тесты на действительный, мёртвый (`pid` не жив), чужой (другой `pid` на порту) и
  битый файл, приоритет `-p`.

## 2. Сервер

- [x] 2.1 `site.ts`: вынести `localHost`/`fromFeedbackCommand` из блока `-w`, добавить
  `GET /__c4builder/status` во всех режимах (D5). Проверка: тест в `test/cli-site.test.mjs` — 200 с
  `pid` и слушателем `foo` для запроса команды, 403 с `Origin`, ответ без `-w` с пустыми списками.
- [x] 2.2 `site.ts` + `dispatch.ts`: запись файла после `listen`, удаление на `exit`, обработчики
  `SIGINT`/`SIGTERM`/`SIGHUP` в режиме сервера; на занятом порту файл не пишется; ошибка записи —
  одна строка предупреждения (D2, D3). Проверка: тест — файл с `port`/`url`/`pid`/`watch` после
  `serving`, удалён после `SIGINT` и после `SIGTERM`; при занятом порту файла нет.
- [x] 2.3 `dispatch.ts`: до лока и сборки — действительный файл этого конфига → сообщение
  `c4builder site is already running for this project at <url> (pid N)` и код 1; с `--open` /
  `--open-change <id>` — открыть адрес работающего (с проверкой страницы через `PAGE_PATH`) и код 0
  (D7). Проверка: тесты — повторный запуск (код 1, сборки нет, первый жив), `--open-change` при
  `BROWSER=none` (код 0), другой `-c` поднимает второй сервер.

## 3. Клиенты

- [x] 3.1 `feedback.ts`: порт через `server-state` (D6). Проверка: тест в `test/cli-feedback.test.mjs` —
  сервер на `-p`, отличном от `webPort`, `feedback --as foo` без `-p` получает пачку.
- [x] 3.2 `doctor.ts`, группа `runtime`: порт через `server-state`, адрес в сообщении (D9). Проверка:
  тест в `test/cli-doctor.test.mjs` — сервер на другом порту даёт `ok` «site -w is running» с этим
  адресом.
- [x] 3.3 `src/cli/commands/status.ts` + регистрация в `COMMANDS` (`dispatch.ts`) до Configstore,
  опция `--json` для `status` в `--help` (D8). Проверка: новый `test/cli-status.test.mjs` — работает
  (код 0, адрес, pid, слушатели), нет сервера (`--json` с `running: false`, код 1), пустой каталог
  остаётся пустым.
- [x] 3.4 Прогон: `npm run build && npm run test:unit && npm run check` зелёные (включая
  `cli-language` и `cli-commands`).

## 4. Актуализация

- [x] 4.1 `.gitignore` репозитория и `template/.gitignore`: `.c4builder.server.json` (и
  `*.c4builder.server.json` в репозитории для `docs/*`). Проверка: `git status` после
  `cd docs/ru && node ../../dist/index.js --site -w` не показывает файл.
- [x] 4.2 Страницы сайта в обеих версиях: `docs/ru/src/05 CLI и конфигурация`,
  `docs/en/src/05 CLI and configuration` (подкоманда `status`, файл состояния, повторный запуск,
  откуда `feedback`/`doctor` берут порт); `docs/ru/src/08 Агенты`, `docs/en/src/08 Agents` (проверка
  сервера через `c4builder status`). Проверка: тест `docs-parity` зелёный.
- [x] 4.3 Скиллы: `skills/c4builder-review/SKILL.md` — шаг 1 через `c4builder status` вместо `curl`,
  порт из её вывода, без «передай тот же `-p`»; `skills/c4builder/SKILL.md` — то же про занятый порт
  и `feedback`; `skills/c4builder/references/*` и `template/AGENTS.md` — подкоманда `status`, где
  перечисляются команды. Проверка: тест `skills` зелёный.
- [x] 4.4 `CHANGELOG.md`, `## Unreleased`: файл состояния, `c4builder status`, отказ второго
  сервера, `feedback`/`doctor` находят сервер без `-p`; совет добавить `.c4builder.server.json` в
  `.gitignore` существующих проектов. Проверка: строка есть в диффе PR.

## 5. Правки по ревью

- [x] 5.1 Идентичность проекта: `project` (realpath конфига) в `/__c4builder/status`, сверка во всех
  клиентах (`findServer`); c4builder другого проекта — `running: false`, `busy: true`, `otherProject`.
  Проверка: worktree-сценарий в `test/cli-status.test.mjs` (status код 1, feedback не подключается,
  doctor — warn), юнит в `test/server-state.test.mjs`.
- [x] 5.2 Повторный запуск с `-w`/`--agent` при работающем сервере без `-w` — код 1 и совет, даже с
  `--open*`. Проверка: тест в `test/cli-site.test.mjs`.
- [x] 5.3 `SIGHUP` не перехватывается (D3). Проверка: тест — процесс гибнет сигналом, файл остаётся.
- [x] 5.4 Живой `pid` и таймаут пробы — сервер работает (`unresponsive`): D7 отказывает, `status` —
  `running: true, responding: false`; `ECONNREFUSED` при живом `pid` — файл недействителен.
  Проверка: юнит и `test/cli-status.test.mjs`.
- [x] 5.5 Классификация порта — одна функция `findServer` для `status`, `feedback`, `doctor`.
- [x] 5.6 Обработчик `exit` снимается при `close` сервера. Проверка: юнит — число слушателей `exit`.
- [x] 5.7 Упрощения: общий хелпер анонса (`go to`, страница change'а, браузер), `ownerAlive` из
  `util/lock.ts` (pid <= 0 — не жив), `shownUrl` в feedback, doctor не разбирает конфиг дважды.

## Workflow follow-up

- Архив change'а (`/opsx:archive`) после реализации — спеки `dev-server`, `site-agent-feedback`,
  `cli-doctor`, `cli-commands`.
