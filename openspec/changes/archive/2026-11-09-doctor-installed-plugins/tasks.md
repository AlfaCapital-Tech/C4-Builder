# Tasks

## 1. Плагины по реестру установленных

- [x] 1.1 `src/cli/commands/doctor.ts`, `pluginCheck`: читать `~/.claude/plugins/installed_plugins.json`
  вместо обхода кэша — ключи `plugins`, записи с подходящей областью (D2), каталог `installPath`
  или версии в кэше без `.orphaned_at` (D1); ошибки — по D3. Комментарий над функцией обновить
  (почему реестр, а не кэш). Проверка: `npm run build` и `npm run check` зелёные
- [x] 1.2 `test/cli-doctor.test.mjs`: существующий кейс «скилл плагина дублирует проектный» —
  с записью в реестре (`scope: user`, `installPath`); новые кейсы — удалённый плагин
  (кэш с `.orphaned_at`, нет записи) → проверки нет; запись с `scope: project` для чужого каталога
  → проверки нет, для текущего каталога → `warn`; старая версия с `.orphaned_at` рядом с
  установленной не попадает в отчёт; реестр не JSON / без `plugins` → `skipped`, код выхода 0
  (вместо кейса «кэш не обходится»). Проверка: `npx vitest run test/cli-doctor.test.mjs` зелёный

## 2. Актуализация

- [x] 2.1 `docs/ru/src/08 Агенты/README.md` и `docs/en/src/08 Agents/README.md`: пункт про плагины —
  «установленный плагин Claude Code (по `~/.claude/plugins/installed_plugins.json`; удалённые и
  поставленные в другие проекты не в счёт)». Проверка: `npx vitest run test/docs-parity.test.mjs`
  зелёный
- [x] 2.2 `CHANGELOG.md`: строка в `## Unreleased` (секцию создать над `## v0.14.0`) —
  `doctor skills` no longer reports duplicates from uninstalled Claude Code plugins (#74).
  Скиллы и `template/AGENTS.md` не меняются — сверить, что формулировки про плагины в
  `skills/c4builder/SKILL.md` и `skills/c4builder-setup/SKILL.md` остаются верными
- [x] 2.3 Полный прогон: `npm run test:unit` и `npm run check` зелёные
