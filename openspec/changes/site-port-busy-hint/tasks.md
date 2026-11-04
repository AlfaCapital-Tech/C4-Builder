# Tasks

## 1. Подсказка свободного порта

- [x] 1.1 `src/cli/commands/site.ts`: на `EADDRINUSE` найти свободный порт пробным `listen` на `127.0.0.1` среди `port+1 … port+10` и напечатать `port <p> is already in use — pass a different one, e.g. -p <free>`; свободного нет — прежнее сообщение; сервер на другой порт не переходит. Проверка: `npm run build`, `npm run check`.
- [x] 1.2 `test/cli-site.test.mjs`: кейс «занятый порт» занимает порт и следующий за ним, ждёт код 1, подсказку `e.g. -p <port+2>` и отсутствие `go to`. Проверка: `npx vitest run test/cli-site.test.mjs` зелёный.
- [x] 1.3 Ручная проверка: занять порт, `node dist/index.js site` в `docs/ru` — подсказка в выводе, код 1. Проверка: вывод команды.
  > Итог: `docs/ru`, порт 3000 занят `python3 -m http.server` → `port 3000 is already in use — pass a different one, e.g. -p 3001`, код 1. Заняты 28400–28410, `-p 28400` → `… pass a different one with -p <port>`, код 1.

## 2. Актуализация

- [x] 2.1 Раздел dev-сервера на странице `05 CLI …` RU и EN: занятый порт — ошибка с подсказкой, на другой порт сервер сам не переходит. Проверка: `docs-parity` зелёный.
- [x] 2.2 `skills/c4builder/SKILL.md`, `skills/c4builder-review/SKILL.md`: увидел подсказку — перезапусти с этим `-p` и тот же `-p` передавай `c4builder feedback`. `template/AGENTS.md` про выбор порта молчит — не трогаем. Проверка: тест `skills` зелёный.
- [x] 2.3 `CHANGELOG.md`, `## Unreleased`: одна строка. Проверка: строка есть.
- [x] 2.4 `npm run build && npm run test:unit && npm run check` зелёные, `openspec validate site-port-busy-hint --strict` проходит; в изменённых файлах нет внутренних хостов и локальных путей. Проверка: вывод команд.
  > Итог: `npm run build` и `npm run check` зелёные (одно info biome в `test/plugin-openspec.test.mjs` — было до change), `npm run test:unit` — 42 файла, 569 тестов зелёные, `openspec validate site-port-busy-hint --strict` проходит; внутренних хостов и локальных путей в изменённых файлах нет.

## Workflow follow-up

- Архив change отдельным коммитом в том же PR (`openspec archive site-port-busy-hint`).
