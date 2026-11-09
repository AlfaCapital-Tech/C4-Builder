# Spec Delta

## MODIFIED Requirements

### Requirement: Формат вывода проверки диаграмм
`c4builder check <file...>` SHALL печатать результат по каждому файлу в стабильном англоязычном формате: успешный файл — `✓ <file>`, ошибочный — `✗ <file>: line <N>: <message>` для `.puml` (номер строки — от начала файла, начиная с 1), `✗ <file>: <message>` для `.iuml` (позиция относится к обёртке, номер не печатается). Предупреждения движков и смысловых проверок (см. capability `diagram-semantic-checks`) печатаются в stdout строками `⚠ <file>: <message>` перед строкой результата файла. Сообщения об использовании команды без аргументов и о неподдерживаемом расширении MUST быть на английском. Код возврата MUST быть 0, если все файлы прошли проверку, и 1 иначе. Предупреждения код возврата не меняют, кроме режима `--strict`: с ним файл, у которого есть хотя бы одно предупреждение, MUST считаться непрошедшим, вместо `✓` в stderr печатается `✗ <file>: <K> warning(s), failing with --strict`, код возврата — 1.

#### Scenario: Ошибка в диаграмме
- **WHEN** выполняется `c4builder check bad.puml`, где в строке 3 синтаксическая ошибка
- **THEN** в stderr печатается `✗ bad.puml: line 3: <сообщение движка>`, процесс завершается с кодом 1

#### Scenario: Неподдерживаемое расширение
- **WHEN** выполняется `c4builder check notes.txt`
- **THEN** печатается сообщение на английском о неподдерживаемом расширении со списком `.puml`, `.iuml`, `.d2`, процесс завершается с кодом 1

#### Scenario: Без аргументов
- **WHEN** выполняется `c4builder check` без файлов
- **THEN** печатается строка использования на английском с флагом `--strict` (`usage: c4builder check [--strict] <file...>  (…)`), процесс завершается с кодом 1

#### Scenario: Предупреждение без --strict
- **WHEN** выполняется `c4builder check dangling.puml`, где `Rel` ведёт на необъявленный алиас
- **THEN** печатаются `⚠ dangling.puml: line <N>: Rel to undeclared element "<alias>"` и `✓ dangling.puml`, процесс завершается с кодом 0

#### Scenario: Предупреждение с --strict
- **WHEN** выполняется `c4builder check --strict dangling.puml ok.puml`
- **THEN** для `dangling.puml` печатаются строка `⚠ …` и `✗ dangling.puml: 1 warning(s), failing with --strict`, для `ok.puml` — `✓ ok.puml`, процесс завершается с кодом 1

#### Scenario: --strict и предупреждения других движков
- **WHEN** выполняется `c4builder check --strict warn.bpmn`, где у BPMN-модели есть только нарушения уровня warning
- **THEN** файл считается непрошедшим, процесс завершается с кодом 1
