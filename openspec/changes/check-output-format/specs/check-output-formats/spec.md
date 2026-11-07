# Spec Delta

## Purpose

Машиночитаемые форматы вывода `c4builder check`. Через них ошибки и предупреждения диаграмм
попадают в diff PR/MR (аннотации GitHub, GitLab Code Quality), а агенты и скрипты
разбирают их стабильно, независимо от формата строки конкретного движка.

## ADDED Requirements

### Requirement: Выбор формата вывода проверки
`c4builder check` SHALL принимать `--format <format>` со значениями `text`, `json`, `github`, `gitlab`; по умолчанию — `text`, его вывод не меняется. `--json` MUST работать как `--format json`. Другое значение MUST завершаться ошибкой на английском со списком допустимых и кодом 1 без проверки файлов. Код возврата MUST NOT зависеть от формата: те же правила, что для `text`, включая `--strict`.

#### Scenario: Формат по умолчанию
- **WHEN** выполняется `c4builder check bad.puml` без `--format`
- **THEN** вывод совпадает с текстовым форматом: `✗ bad.puml: line 3: …` в stderr, код 1

#### Scenario: Неизвестный формат
- **WHEN** выполняется `c4builder check --format xml ok.puml`
- **THEN** печатается ошибка на английском, в которой перечислены `text`, `json`, `github`, `gitlab`, процесс завершается с кодом 1

#### Scenario: Код возврата в машинном формате
- **WHEN** выполняется `c4builder check --format json ok.puml bad.puml`
- **THEN** процесс завершается с кодом 1, как и `c4builder check ok.puml bad.puml`

#### Scenario: --strict в машинном формате
- **WHEN** выполняется `c4builder check --format github --strict warn.bpmn`, где у модели есть только предупреждения
- **THEN** предупреждения печатаются как `::warning`, процесс завершается с кодом 1

#### Scenario: --json как синоним
- **WHEN** выполняется `c4builder check --json bad.puml`
- **THEN** вывод совпадает с `c4builder check --format json bad.puml`

### Requirement: Модель замечания
Каждое замечание машинного формата SHALL иметь поля `file`, `line`, `column`, `engine`, `severity`, `rule`, `element`, `message`. `file` — путь с `/` относительно каталога отчёта; `line` и `column` — с 1; `engine` — `plantuml`, `d2`, `bpmn`, `mermaid`, `wireflow` или `null` (неподдерживаемое расширение); `severity` — `error` или `warning`; `rule` — правило движка или проверки. Поле, которого у движка нет, MUST быть `null`.

#### Scenario: Ошибка PlantUML
- **WHEN** проверяется `bad.puml` с синтаксической ошибкой в строке 3
- **THEN** замечание: `file: "bad.puml"`, `line: 3`, `column: null`, `engine: "plantuml"`, `severity: "error"`, `rule: null`, `element: null`, `message` — текст движка без префикса `line N:`

#### Scenario: Нарушение bpmnlint
- **WHEN** проверяется `lonely.bpmn` с несвязанной задачей `Lonely`
- **THEN** замечание имеет `engine: "bpmn"`, `rule: "no-disconnected"`, `element: "Lonely"`, `message: "Element is not connected"`, `severity: "error"`

#### Scenario: Предупреждение смысловой проверки
- **WHEN** проверяется `.puml`, где `Rel` ведёт на необъявленный алиас `nope` в строке 6
- **THEN** замечание имеет `severity: "warning"`, `line: 6`, `rule: "undeclared-element"`, `element: "nope"`

#### Scenario: Неподдерживаемое расширение
- **WHEN** проверяется `notes.txt`
- **THEN** замечание имеет `engine: null`, `severity: "error"` и сообщение о неподдерживаемом расширении

### Requirement: Позиция замечания по id элемента
Если у замечания есть `element`, но нет строки (BPMN, wireflow), `check` SHALL найти в исходнике первое объявление этого id (атрибут `id` в BPMN XML, ключ `"id"` в wireflow JSON) и подставить его строку и колонку. Если объявление не найдено, `line` и `column` MUST остаться `null`.

#### Scenario: BPMN-элемент на строке 7
- **WHEN** в `lonely.bpmn` элемент `id="Lonely"` объявлен в строке 7
- **THEN** замечание о `Lonely` имеет `line: 7` и колонку начала `id="Lonely"`

#### Scenario: Ребро wireflow
- **WHEN** ребро `e1` в `bad.wireflow.json` ссылается на несуществующий узел
- **THEN** замечание имеет `element: "e1"` и строку объявления `"id": "e1"`

### Requirement: Ошибка в импортированном файле D2
Для ошибки компиляции D2 замечание SHALL указывать файл, строку и колонку, которые сообщил движок. Если ошибка находится в файле, импортированном проверяемым `.d2`, `file` MUST быть путём импортированного файла.

#### Scenario: Две ошибки в одном файле
- **WHEN** проверяется `bad.d2` с ошибками в `1:1` и `2:4`
- **THEN** отчёт содержит два замечания `engine: "d2"` с `line`/`column` `1`/`1` и `2`/`4`

### Requirement: Формат json
`--format json` SHALL печатать в stdout один JSON-массив замечаний по всем файлам в порядке проверки и больше ничего. Если замечаний нет, печатается `[]`. Пути MUST быть относительны текущему каталогу.

#### Scenario: Все файлы корректны
- **WHEN** выполняется `c4builder check --format json ok.puml ok.d2`
- **THEN** stdout разбирается как JSON и равен `[]`, код 0

#### Scenario: Ошибки и предупреждения вместе
- **WHEN** выполняется `c4builder check --format json bad.puml warn.bpmn`
- **THEN** stdout — массив с ошибкой `bad.puml` и предупреждениями `warn.bpmn`, без строк `✓`, `⚠`, `✗` и без управляющих последовательностей цвета

### Requirement: Формат github
`--format github` SHALL печатать по строке на замечание: `::error` или `::warning`, свойства `file`, `line` и `col` (при наличии) и `title` вида `c4builder <engine>` с правилом в скобках, если оно есть. Текст — `message`, с префиксом `<element>: `, если id в нём нет. `%`, CR, LF в тексте и дополнительно `:` и `,` в свойствах MUST экранироваться по правилам workflow-команд. Путь — относительно `GITHUB_WORKSPACE`, если переменная задана, иначе относительно текущего каталога.

#### Scenario: Аннотация ошибки PlantUML
- **WHEN** выполняется `c4builder check --format github bad.puml`
- **THEN** stdout содержит строку `::error file=bad.puml,line=3,title=c4builder plantuml::<сообщение>`

#### Scenario: Многострочное сообщение
- **WHEN** сообщение замечания содержит перевод строки или `%`
- **THEN** они выводятся как `%0A` и `%25`, и вся аннотация остаётся одной строкой

#### Scenario: Запуск из подкаталога в GitHub Actions
- **WHEN** `GITHUB_WORKSPACE=/w`, команда запущена в `/w/docs` с файлом `src/a.puml`
- **THEN** в аннотации `file=docs/src/a.puml`

### Requirement: Формат gitlab
`--format gitlab` SHALL печатать в stdout JSON-массив GitLab Code Quality. Каждое замечание содержит `description`, `check_name` (`<engine>` или `<engine>/<rule>`), `fingerprint`, `severity` (`major` для ошибки, `minor` для предупреждения), `location.path` и `location.lines.begin` (без строки — 1). Путь — относительно `CI_PROJECT_DIR`, если переменная задана, иначе относительно текущего каталога.

#### Scenario: Отчёт для артефакта codequality
- **WHEN** выполняется `c4builder check --format gitlab bad.puml > gl-code-quality-report.json`
- **THEN** файл содержит массив с одним объектом: `check_name: "plantuml"`, `severity: "major"`, `location: { path: "bad.puml", lines: { begin: 3 } }`

#### Scenario: Стабильный fingerprint
- **WHEN** над ошибкой в `bad.puml` добавлена пустая строка, и `check --format gitlab` запущен снова
- **THEN** `fingerprint` замечания не меняется (строка в него не входит), а у двух одинаковых замечаний в одном файле fingerprint разный

### Requirement: Чистый stdout машинного формата
В машинных форматах stdout SHALL содержать только отчёт. Строки результата файла (`✓`, `✗`, `⚠`, сводка `--strict`) MUST NOT печататься, служебные сообщения (выбор и загрузка JRE) MUST уходить в stderr, цветовые последовательности MUST NOT использоваться.

#### Scenario: Первый запуск со скачиванием JRE
- **WHEN** `c4builder check --format json a.puml` выбирает или скачивает JRE
- **THEN** сообщения об этом печатаются в stderr, а stdout разбирается как JSON

### Requirement: Машинный формат без файлов
Машинный формат без файлов SHALL выводить пустой отчёт (`[]` для `json` и `gitlab`, ничего для `github`) и завершаться с кодом 0. Текстовый формат без файлов по-прежнему печатает строку использования и завершается с кодом 1.

#### Scenario: Пустой список изменённых файлов
- **WHEN** выполняется `c4builder check --format gitlab` без файлов (в PR не менялись диаграммы)
- **THEN** stdout равен `[]`, код 0
