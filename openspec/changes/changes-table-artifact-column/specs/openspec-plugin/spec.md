## MODIFIED Requirements

### Requirement: Колонки таблицы из `.openspec.yaml`
Плагин SHALL поддерживать опцию `columns` — список элементов двух видов. Для каждого элемента
таблица Changes, таблица сводки и таблицы страниц групп SHALL получать колонку `title` после
стандартных (`Change`, `Schema`, `Tasks`, `Updated`), у вложенных — их собственное значение;
нет значения — `—`. Символ `|` в значении или заголовке MUST экранироваться. Опция пуста —
набор колонок MUST быть прежним.

- `{ key, title }` — значение `meta[key]` change'а строки. Значение в кавычках SHALL читаться
  целиком, `#` внутри кавычек не комментарий.
- `{ title, artifact, column, whenEmpty?, exclude? }` — значения колонки `column` первой markdown-таблицы
  артефакта `artifact` (файл `<artifact>.md`), у которой есть колонки `column` и `whenEmpty`
  (заголовки — текст ячейки после trim; строки внутри fenced-блоков ``` и ~~~ не читаются, разделитель
  таблицы SHALL содержать `|`). Берутся строки, у которых ячейка `whenEmpty` пуста
  (пустая строка, `—` или `-`); без `whenEmpty` — все строки. Пустые значения и значения,
  подходящие под регулярное выражение `exclude`, пропускаются, остальные перечисляются каждое
  с новой строки (`<br>`). Нет артефакта, таблицы или значений — `—`. Невалидный `exclude` MUST отклоняться схемой опций.

#### Scenario: Исполнитель в таблице
- **WHEN** `columns: [{ key: "x-assignee", title: "Assignee" }, { key: "x-jira", title: "Jira" }]`, у `dig-3-root` `x-assignee: Alice`, `x-jira: DIG-3`, у вложенного `ios` — `x-assignee: Bob | Carol`
- **THEN** заголовок таблицы — `| Change | Schema | Tasks | Updated | Assignee | Jira |`, строка корня — `… | Alice | DIG-3 |`, строка `ios` — `… | Bob \| Carol | — |`

#### Scenario: Значение в кавычках
- **WHEN** `x-assignee: "Alice #1" # lead`
- **THEN** в колонке — `Alice #1`

#### Scenario: Ожидающие ревью из таблицы review.md
- **WHEN** `columns: [{ title: "Awaiting", artifact: "review", column: "Who", whenEmpty: "Status", exclude: "`" }]`, в `review.md` `dig-3-root` таблица `| Reviewer | Status | Who | Date |` со строками `AI | Approved | — |`, `Analyst | | Dana |`, `Tester | | Eve |`, `AI code | | \`/code-review\` |`, у `ios` `review.md` нет
- **THEN** строка корня — `… | Dana<br>Eve |`, строка `ios` — `… | — |`

## ADDED Requirements

### Requirement: Раскладка таблиц Changes
Таблицы change'ов (сводка, страница Changes, страницы групп) SHALL быть обёрнуты в
`<div class="c4b-openspec-changes">` с пустыми строками вокруг, а стиль `vendor/openspec/changes.css`
SHALL подключаться как ассет плагина: одна раскладка колонок во всех секциях страницы, переносится
только текст, который не помещается.

#### Scenario: Раскладка таблиц
- **WHEN** собран сайт с плагином
- **THEN** каждая таблица change'ов обёрнута в `<div class="c4b-openspec-changes">` с пустыми строками вокруг, в выходе есть `vendor/plugins/openspec/changes.css` и `index.html` его подключает

### Requirement: Минимальная ширина таблицы с дополнительными колонками
При непустой опции `columns` обёртка таблицы SHALL получать модификатор `c4b-openspec-changes--extra`
(минимальная ширина таблицы, ниже — прокрутка); без `columns` модификатора и минимальной ширины
MUST не быть.

#### Scenario: Таблица без дополнительных колонок
- **WHEN** опция `columns` не задана
- **THEN** у обёртки нет модификатора `c4b-openspec-changes--extra`

#### Scenario: Таблица с дополнительными колонками
- **WHEN** задана опция `columns`
- **THEN** у обёртки есть модификатор `c4b-openspec-changes--extra`

### Requirement: Прогресс закрытых задач
`<progress>` change'а, у которого закрыты все задачи, SHALL получать класс `c4b-progress-done`
(стиль плагина — цвет темы) в таблицах, сводке и на странице change'а.

#### Scenario: Все задачи закрыты
- **WHEN** у change'а в `tasks.md` все чекбоксы отмечены
- **THEN** его `<progress>` имеет класс `c4b-progress-done`; при незакрытых задачах класса нет
