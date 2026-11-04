# Proposal

## Why

Порт по умолчанию 3000 часто занят другими dev-серверами, а несколько агентов в разных worktree
одного репозитория запускают `site -w` каждый у себя. Сейчас занятый порт — сообщение
`port 3000 is already in use — pass a different one with -p <port>` и выход: человеку или агенту
приходится угадывать свободный порт (issue #64, п. 1).

Сам сервер на другой порт переходить не должен: фиксированный порт — контракт с агентом. Design
change'а `site-agent-feedback` (`openspec/changes/archive/2026-10-20-site-agent-feedback/design.md`,
Context и Risks): «порт фиксирован (`-p` / `webPort`; занят — ошибка, а не другой порт)».
`c4builder feedback`, `--open-change` и скилл `c4builder-review` берут порт из `-p`/`webPort`;
молчаливый переход увёл бы агента на чужой сервер или в пустоту. Автовыбор порта возможен только
вместе с файлом состояния сервера (issue #64, п. 2), когда все клиенты читают порт из него.

## What Changes

- `c4builder site` / `--site [-w]` на занятом порту по-прежнему печатает ошибку и завершается с
  кодом 1, но подсказывает конкретный свободный порт:
  `port 3000 is already in use — pass a different one, e.g. -p 3001`.
- Свободного среди нескольких следующих портов нет — сообщение прежнее
  (`… pass a different one with -p <port>`).
- Сервер сам на другой порт не переходит.
- Скиллы `c4builder` и `c4builder-review`: увидел подсказку — перезапусти с этим `-p` и тот же
  `-p` передавай `c4builder feedback`.

## Capabilities

### New Capabilities
Нет.

### Modified Capabilities
- `dev-server`: новое требование — поведение на занятом порту (ошибка, выход, подсказка
  свободного порта, без перехода на другой порт).

## Impact

- Код: `src/cli/commands/site.ts` (обработчик `EADDRINUSE`).
- Тесты: `test/cli-site.test.mjs` (кейс занятого порта).
- Документация: `docs/{ru,en}/src/05 CLI …/README.md` (раздел dev-сервера),
  `skills/c4builder/SKILL.md`, `skills/c4builder-review/SKILL.md`, `CHANGELOG.md`.
