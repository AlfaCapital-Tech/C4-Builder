# Spec Delta

## ADDED Requirements

### Requirement: Замечания блоков Markdown
Замечание о блоке `plantuml` в файле `.md` SHALL иметь `file` — путь файла `.md`, `line` — строку файла `.md` с 1, `engine: "plantuml"`; остальные поля — по общей модели замечания. Ошибочные блоки с разным содержимым MUST давать отдельные замечания. Файл `.md` без замечаний MUST NOT добавлять записей в отчёт.

#### Scenario: Ошибка блока в json
- **WHEN** выполняется `c4builder check --format json design.md`, где синтаксическая ошибка блока `plantuml` стоит в строке 13 файла
- **THEN** отчёт содержит замечание `file: "design.md"`, `line: 13`, `column: null`, `engine: "plantuml"`, `severity: "error"`, `message` — текст движка без префикса `line N:`; код 1

#### Scenario: Два ошибочных блока
- **WHEN** в `design.md` два блока `plantuml` с ошибками в строках 5 и 20 файла
- **THEN** отчёт содержит два замечания с `line: 5` и `line: 20` в этом порядке

#### Scenario: Markdown без диаграмм
- **WHEN** выполняется `c4builder check --format json notes.md`, где нет блоков `plantuml`
- **THEN** stdout равен `[]`, код 0

#### Scenario: Сбой процесса на блоке
- **WHEN** рендер блока `plantuml` завершается сбоем процесса PlantUML, а не ошибкой диаграммы
- **THEN** отчёт содержит замечание `severity: "error"`, `engine: "plantuml"`, `line` — строка начала блока в файле `.md`, `message` — вывод процесса; замечания остальных блоков файла в отчёте есть

#### Scenario: Аннотация GitHub
- **WHEN** выполняется `c4builder check --format github design.md` с ошибкой блока в строке 13
- **THEN** stdout содержит `::error file=design.md,line=13,title=c4builder plantuml::<сообщение>`

### Requirement: Порядок замечаний файла Markdown
Замечания одного файла `.md` в машинном формате SHALL идти по возрастанию строки файла, независимо от того, ошибка это или предупреждение; замечания одной строки — в порядке появления. Порядок замечаний файлов других расширений MUST NOT меняться. В текстовом формате предупреждения по-прежнему печатаются перед строкой результата файла.

#### Scenario: Ошибка в первом блоке, предупреждение во втором
- **WHEN** выполняется `c4builder check --format json design.md`, где первый блок `plantuml` содержит синтаксическую ошибку в строке 5 файла, а второй — связь на необъявленный элемент в строке 11
- **THEN** отчёт содержит замечание `severity: "error"`, `line: 5`, а за ним — `severity: "warning"`, `line: 11`
