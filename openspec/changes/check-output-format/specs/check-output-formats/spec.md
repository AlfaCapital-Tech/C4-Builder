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

### Requirement: Опции проверки только у check
`--format` и `--files-from` SHALL действовать только с командой `check`. С любой другой командой или без команды (сборка) они MUST завершаться ошибкой на английском с кодом 1, а не молча игнорироваться.

#### Scenario: --format у doctor
- **WHEN** выполняется `c4builder doctor --format json`
- **THEN** в stderr печатается `--format is only supported by check (use --json for doctor)`, stdout пуст, код 1

#### Scenario: --files-from у сборки
- **WHEN** выполняется `c4builder --files-from list.txt`
- **THEN** печатается ошибка `--files-from is only supported by check`, сборка не запускается, код 1

### Requirement: Список файлов из файла или stdin
`c4builder check` SHALL принимать `--files-from <file>`, где `-` означает stdin: пути по одному на строку, пустые строки пропускаются, список добавляется после позиционных аргументов. Проверка MUST идти одним вызовом и печатать один отчёт. Пустой список MUST давать пустой отчёт машинного формата и код 0, в `text` — код 0 без вывода. Нечитаемый файл списка MUST завершаться ошибкой на английском с кодом 1.

#### Scenario: Изменённые файлы из git diff
- **WHEN** выполняется `git diff --name-only … | c4builder check --format gitlab --files-from -`
- **THEN** stdout — один JSON-массив замечаний по всем файлам списка

#### Scenario: Объединение с аргументами
- **WHEN** выполняется `c4builder check --format json what.txt --files-from -` со stdin `ok.puml\n\nbad.puml\n`
- **THEN** отчёт содержит замечания `what.txt` и `bad.puml` в этом порядке, пустая строка пропущена, код 1

#### Scenario: Пустой stdin
- **WHEN** выполняется `c4builder check --format json --files-from -` с пустым stdin
- **THEN** stdout равен `[]`, код 0

#### Scenario: Нет файла списка
- **WHEN** выполняется `c4builder check --format json --files-from nope.txt`, а файла нет
- **THEN** в stderr печатается `--files-from: cannot read nope.txt: …`, stdout пуст, код 1

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

### Requirement: Поля замечания из структуры движка
Поля замечания SHALL браться из структуры, которую отдаёт движок, а не из разбора печатной строки. `message` MUST NOT содержать позицию: ни префикса `line N:`, ни строки и колонки, которые движок вписал в текст ошибки, — позиция MUST быть в `line`/`column`. id элемента BPMN — только в `element`; у wireflow и связи C4 id остаётся и в `message`.

#### Scenario: Позиция внутри текста ошибки движка
- **WHEN** проверяется `broken.bpmn` с битым XML (парсер пишет `line: 3, column: 0` в текст) или `.wireflow.json` с битым JSON (`at position 12 (line 4 column 1)`)
- **THEN** замечание имеет `line: 4`, `column: 1`, а `message` не содержит позиции; текстовый вывод `check` остаётся прежним, с позицией внутри

#### Scenario: Брошено не Error
- **WHEN** проверка файла бросает значение, не являющееся `Error` (строку, `undefined`)
- **THEN** замечание имеет `message`, равный строковому представлению значения, отчёт печатается целиком

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

### Requirement: Без повторов в отчёте
Замечания, совпадающие по всем полям модели, SHALL попадать в отчёт машинного формата один раз — первым появлением. Текстовый формат печатает ошибку по каждому проверяемому файлу, как раньше.

#### Scenario: Общий импортируемый .d2 с ошибкой
- **WHEN** выполняется `c4builder check --format json use1.d2 use2.d2`, и оба импортируют `lib/broken.d2` с ошибкой в `1:1`
- **THEN** отчёт содержит одно замечание `file: "lib/broken.d2"`, `line: 1`, `column: 1`, код 1

### Requirement: Формат json
`--format json` SHALL печатать в stdout один JSON-массив замечаний по всем файлам в порядке проверки и больше ничего. Если замечаний нет, печатается `[]`. Пути MUST быть относительны текущему каталогу.

#### Scenario: Все файлы корректны
- **WHEN** выполняется `c4builder check --format json ok.puml ok.d2`
- **THEN** stdout разбирается как JSON и равен `[]`, код 0

#### Scenario: Ошибки и предупреждения вместе
- **WHEN** выполняется `c4builder check --format json bad.puml warn.bpmn`
- **THEN** stdout — массив с ошибкой `bad.puml` и предупреждениями `warn.bpmn`, без строк `✓`, `⚠`, `✗` и без управляющих последовательностей цвета

### Requirement: Формат github
`--format github` SHALL печатать по строке на замечание: `::error` или `::warning`, свойства `file`, `line` и `col` (при наличии) и `title` вида `c4builder <engine>` с правилом в скобках, если оно есть. Текст — `message`, при необходимости с префиксом `<element>: `. `%`, CR, LF в тексте и дополнительно `:` и `,` в свойствах MUST экранироваться по правилам workflow-команд. Путь — относительно `GITHUB_WORKSPACE`, если переменная задана, иначе относительно текущего каталога.

#### Scenario: Аннотация ошибки PlantUML
- **WHEN** выполняется `c4builder check --format github bad.puml`
- **THEN** stdout содержит строку `::error file=bad.puml,line=3,title=c4builder plantuml::<сообщение>`

#### Scenario: Замечание без движка
- **WHEN** выполняется `c4builder check --format github notes.txt`
- **THEN** аннотация имеет `title=c4builder` без имени движка

#### Scenario: Многострочное сообщение
- **WHEN** сообщение замечания содержит перевод строки или `%`
- **THEN** они выводятся как `%0A` и `%25`, и вся аннотация остаётся одной строкой

#### Scenario: Запуск из подкаталога в GitHub Actions
- **WHEN** `GITHUB_WORKSPACE=/w`, команда запущена в `/w/docs` с файлом `src/a.puml`
- **THEN** в аннотации `file=docs/src/a.puml`

### Requirement: Префикс элемента в тексте аннотации
Текст аннотации `github` и `description` в `gitlab` SHALL начинаться с `<element>: `, если у замечания есть `element` и id не входит в `message` по форме движка (bpmnlint). Решение MUST приниматься по структуре замечания, а не поиском id в тексте.

#### Scenario: Короткий id элемента
- **WHEN** у нарушения bpmnlint `element: "e"`, а `message: "Element is not connected"` содержит букву `e`
- **THEN** текст аннотации — `e: Element is not connected`

#### Scenario: id в тексте wireflow
- **WHEN** у замечания wireflow `element: "e"` и `message: "edge \"e\": bad"`
- **THEN** текст аннотации — `edge "e": bad` без префикса

### Requirement: Физический путь базы отчёта
Каталог базы отчёта (`GITHUB_WORKSPACE`, `CI_PROJECT_DIR` или текущий) и каталоги файлов SHALL приводиться к физическому пути (симлинки раскрыты); если каталога нет, путь берётся как есть.

#### Scenario: GITHUB_WORKSPACE через симлинк
- **WHEN** `GITHUB_WORKSPACE` указывает на симлинк к каталогу репозитория (на macOS `/tmp` → `/private/tmp`)
- **THEN** путь в аннотации считается от физического каталога и не начинается с `../`

### Requirement: Формат gitlab
`--format gitlab` SHALL печатать в stdout JSON-массив GitLab Code Quality. Каждое замечание содержит `description`, `check_name` (`<engine>` или `<engine>/<rule>`; без движка — `c4builder`), `fingerprint`, `severity` (`major` для ошибки, `minor` для предупреждения), `location.path` и `location.lines.begin` (без строки — 1). Путь — относительно `CI_PROJECT_DIR`, если переменная задана, иначе относительно текущего каталога.

#### Scenario: Отчёт для артефакта codequality
- **WHEN** выполняется `c4builder check --format gitlab bad.puml > gl-code-quality-report.json`
- **THEN** файл содержит массив с одним объектом: `check_name: "plantuml"`, `severity: "major"`, `location: { path: "bad.puml", lines: { begin: 3 } }`

#### Scenario: Стабильный fingerprint
- **WHEN** над ошибкой в `bad.puml` добавлена пустая строка, и `check --format gitlab` запущен снова
- **THEN** `fingerprint` замечания не меняется (строки нет ни в хэше, ни в `message`), а у двух одинаковых замечаний в одном файле fingerprint разный

### Requirement: Чистый stdout машинного формата
В машинных форматах stdout SHALL содержать только отчёт. Строки результата файла (`✓`, `✗`, `⚠`, сводка `--strict`) MUST NOT печататься, служебные сообщения (выбор и загрузка JRE) MUST уходить в stderr, цветовые последовательности MUST NOT использоваться. Процесс MUST завершаться явно с кодом проверки, в том числе 0, после записи отчёта целиком — висящий handle движка не должен задерживать выход, а отчёт в pipe не должен обрезаться.

#### Scenario: Первый запуск со скачиванием JRE
- **WHEN** `c4builder check --format json a.puml` выбирает или скачивает JRE
- **THEN** сообщения об этом печатаются в stderr, а stdout разбирается как JSON

### Requirement: Машинный формат без файлов
Машинный формат без файлов SHALL выводить пустой отчёт (`[]` для `json` и `gitlab`, ничего для `github`) и завершаться с кодом 0. Текстовый формат без файлов и без `--files-from` по-прежнему печатает строку использования и завершается с кодом 1.

#### Scenario: Пустой список изменённых файлов
- **WHEN** выполняется `c4builder check --format gitlab` без файлов (в PR не менялись диаграммы)
- **THEN** stdout равен `[]`, код 0
