# Proposal

## Why

`c4builder doctor skills` ищет дубли скиллов пакета в плагинах Claude Code обходом всего кэша
`~/.claude/plugins/cache`. Кэш хранит и удалённые плагины (Claude Code помечает их каталоги файлом
`.orphaned_at`, а из `~/.claude/plugins/installed_plugins.json` убирает запись), и старые версии, и
плагины, поставленные в другие проекты. Итог — ложное `! plugin <name>@<marketplace> duplicates
project skills …` у всех, у кого плагин когда-то стоял, хотя `claude plugin uninstall` его уже не
находит (issue #74).

## What Changes

- Источник плагинов — реестр `~/.claude/plugins/installed_plugins.json`, а не обход кэша: в счёт
  идут только установленные плагины.
- Установка с областью проекта (`project`/`local`) учитывается, только если текущий каталог —
  этот проект или вложен в него; область пользователя — всегда.
- Проверяется каталог установленной версии (`installPath`); без него — версии плагина в кэше,
  кроме помеченных `.orphaned_at`. Каталоги с `.orphaned_at` не учитываются никогда.
- Реестра нет — проверки `skills.claude.plugins` нет (плагины не установлены). Реестр не читается
  или его формат не распознан — `skipped`, а не `error` и не ложный `warn`: формат файла не
  публичный контракт Claude Code.
- Сообщение `warn` и id проверки не меняются.

## Capabilities

### New Capabilities
Нет.

### Modified Capabilities
- `cli-doctor`: требование «Скиллы плагинов Claude Code» — источник плагинов (реестр установленных
  вместо кэша), учёт области установки и `.orphaned_at`, `skipped` при нераспознанном реестре.

## Impact

- Код: `src/cli/commands/doctor.ts` (`pluginCheck`).
- Тесты: `test/cli-doctor.test.mjs` (кейсы плагинов: установленный, удалённый с `.orphaned_at`,
  чужой проект, нераспознанный реестр).
- Документация: `docs/ru/src/08 Агенты/README.md`, `docs/en/src/08 Agents/README.md`,
  `CHANGELOG.md`. Скиллы и `template/AGENTS.md` не затронуты: флаги, команды и формулировка
  «copies in Claude Code plugins» не меняются.
