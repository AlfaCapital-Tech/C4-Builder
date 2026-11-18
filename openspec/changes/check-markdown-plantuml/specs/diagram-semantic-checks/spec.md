# Spec Delta

## ADDED Requirements

### Requirement: Предупреждение для блока Markdown в check
`c4builder check` SHALL печатать предупреждение о связи C4 на необъявленный элемент и для блоков `plantuml` файла `.md`: `⚠ <file>: line <N>: <Macro> to undeclared element "<alias>"`, где `<file>` — путь файла `.md`, а N — строка файла `.md`. Обёртка `@startuml`/`@enduml`, добавленная блоку без неё, номер MUST NOT сдвигать. С `--strict` файл `.md` с таким предупреждением MUST считаться непрошедшим.

#### Scenario: Опечатка в алиасе в блоке
- **WHEN** в `design.md` блок `plantuml` без `@startuml` вызывает `Rel(u, ghost1, …)` в строке 8 файла, а блок с `@startuml` — `Rel(u, ghost2, …)` в строке 15
- **THEN** `c4builder check design.md` печатает `⚠ design.md: line 8: Rel to undeclared element "ghost1"`, `⚠ design.md: line 15: Rel to undeclared element "ghost2"` и `✓ design.md`, код 0

#### Scenario: --strict
- **WHEN** выполняется `c4builder check --strict design.md` с тем же файлом
- **THEN** вместо `✓` печатается `✗ design.md: 2 warning(s), failing with --strict`, код 1

#### Scenario: Машинный формат
- **WHEN** выполняется `c4builder check --format json design.md` с тем же файлом
- **THEN** отчёт содержит два замечания `severity: "warning"`, `rule: "undeclared-element"`, `engine: "plantuml"` с `line: 8` и `line: 15`
