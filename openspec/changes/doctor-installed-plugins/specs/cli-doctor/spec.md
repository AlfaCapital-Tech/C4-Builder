## MODIFIED Requirements

### Requirement: Скиллы плагинов Claude Code
Группа `skills` SHALL искать скиллы с именами скиллов пакета только в установленных плагинах Claude Code — по реестру `~/.claude/plugins/installed_plugins.json` — и сообщать о найденных как о дублях проектных скиллов (`warn`), указывая, отличается ли их текст от пакета. Установка с областью проекта MUST учитываться только в этом проекте; каталоги кэша с `.orphaned_at` MUST NOT учитываться. Нет реестра — проверки нет; реестр не читается или не распознан — `skipped`, а не `error`.

#### Scenario: Плагин дублирует скилл
- **WHEN** в реестре установлен плагин с областью пользователя, а в его каталоге есть `skills/c4builder-review/SKILL.md` с текстом, отличным от пакета
- **THEN** `warn`: скилл плагина дублирует проектный и отличается от пакета

#### Scenario: Удалённый плагин остался в кэше
- **WHEN** в `~/.claude/plugins/cache` есть каталог плагина с `.orphaned_at` и `skills/c4builder-review/SKILL.md`, а в реестре записи этого плагина нет
- **THEN** проверки `skills.claude.plugins` в отчёте нет

#### Scenario: Плагин установлен в другой проект
- **WHEN** плагин со скиллом пакета установлен в реестре с областью `project` для каталога, который не совпадает с текущим и не содержит его
- **THEN** проверки `skills.claude.plugins` в отчёте нет

#### Scenario: Реестр не распознан
- **WHEN** `~/.claude/plugins/installed_plugins.json` не JSON или в нём нет объекта `plugins`
- **THEN** `skills.claude.plugins` — `skipped`, код выхода не меняется
