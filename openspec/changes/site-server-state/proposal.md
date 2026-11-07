# Proposal

## Why

Клиенты dev-сервера не знают, где он на самом деле слушает: `c4builder feedback`, `doctor runtime` и
скилл `c4builder-review` берут порт из `-p` или `webPort`, а не у запущенного сервера. Сайт запущен
с `-p 3001` (3000 занят — подсказка change'а `site-port-busy-hint`) → `feedback --wait --as x` без
`-p` идёт на 3000 и падает с `no c4builder site -w on http://localhost:3000`; скилл проверяет сервер
`curl` по угаданному порту. Несколько агентов в одном проекте вынуждены передавать друг другу `-p`
на словах (issue #64, п. 2–3; п. 1 сделан в `site-port-busy-hint`).

## What Changes

- Сервер (`c4builder site` / `--site [-w]`) после успешного `listen` пишет файл состояния рядом с
  конфигом — `.c4builder.server.json` (для `-c <file>` — `<file>.server.json`): порт, адрес, pid,
  версия CLI, режим watch. При выходе (Ctrl+C, `SIGTERM`, обычное завершение) файл удаляется;
  оставшийся от убитого процесса файл читатели считают недействительным.
- Новый служебный эндпоинт сервера `GET /__c4builder/status` (только для команд CLI, как у
  `feedback`): pid, порт, версия, watch, агентский режим, слушатели `feedback` и их очереди, пачки
  без адресата. По нему клиенты отличают живой сервер этого проекта от чужого процесса на порту.
- `c4builder feedback` и `c4builder doctor runtime` берут порт так: `-p` → живой файл состояния →
  `webPort`.
- Запуск второго сервера для того же конфига, пока первый жив, не поднимает новый: сообщение с
  адресом и pid работающего, код 1. С `--open` / `--open-change <id>` — открывает браузер на
  работающем сервере и выходит с кодом 0.
- Новая подкоманда `c4builder status [--json]`: запущен ли сервер этого проекта, адрес, pid, версия,
  watch, агентский режим, слушатели и очереди пачек. Код 0 — сервер работает, 1 — нет. Без
  Configstore, файлов не создаёт.
- Скиллы `c4builder` и `c4builder-review`: проверка сервера — `c4builder status` вместо `curl`, порт
  и адрес — из её вывода, `-p` в `feedback` передавать больше не нужно.
- Сервер по-прежнему не переходит на другой порт сам (non-goal, см. design).

## Capabilities

### New Capabilities
Нет.

### Modified Capabilities
- `dev-server`: файл состояния сервера; один сервер на конфиг проекта; эндпоинт состояния; команда
  `c4builder status`; требование о занятом порте — клиенты берут порт из файла состояния.
- `site-agent-feedback`: `c4builder feedback` берёт порт из файла состояния, если не передан `-p`.
- `cli-doctor`: проверка `runtime` берёт порт из файла состояния, если не передан `-p`.
- `cli-commands`: подкоманда `status` в списке позиционных.

## Impact

- Код: новый модуль файла состояния (`src/cli/server-state.ts`: запись, чтение, проверка живости,
  выбор порта); `src/cli/commands/site.ts` (запись/удаление файла, эндпоинт `/__c4builder/status`);
  `src/cli/dispatch.ts` (подкоманда `status`, проверка работающего сервера до сборки, обработчики
  сигналов); `src/cli/commands/feedback.ts`, `src/cli/commands/doctor.ts`; новый
  `src/cli/commands/status.ts`.
- Файлы проекта: `.c4builder.server.json` в корне проекта, пока сервер работает — в `.gitignore`
  шаблона и репозитория.
- Тесты: `test/cli-site.test.mjs`, тесты `feedback`, `doctor`, новый тест `status`.
- Документация: `docs/{ru,en}/src/05 CLI и конфигурация`, `docs/{ru,en}/src/08 Агенты`,
  `skills/c4builder/SKILL.md`, `skills/c4builder-review/SKILL.md`, `template/AGENTS.md`,
  `CHANGELOG.md`.
