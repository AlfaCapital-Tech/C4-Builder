## ADDED Requirements

### Requirement: Группы change'ов по ключу
Плагин SHALL поддерживать опцию `groupKey` — ключ `.openspec.yaml` с группой change'а. Опция не
задана — раздел MUST выводиться как без неё. При заданной опции change верхнего уровня со значением
ключа SHALL выводиться страницей `<раздел>/<группа>/<id>` (раздел — Changes или Archive), у группы
SHALL быть своя страница с таблицей её change'ов; в sidebar группы SHALL идти по алфавиту, затем
change'ы без группы. Вложенный change (`parentKey`) SHALL выводиться за родителем, в его группе,
независимо от собственного значения ключа. Таблица Changes, сводка и список архива SHALL делиться
на секции `### <группа>`, change'ы без группы — последней секцией `### Ungrouped`. Значение со `/`,
`\`, `#`, `?`, равное `.` или `..` или совпадающее с id change'а без группы MUST NOT становиться группой — change остаётся без группы,
сборка не падает.

#### Scenario: Change'ы двух команд
- **WHEN** при `groupKey: "x-team"` у `dig-4-orphan` `x-team: Innovation`, у `dig-3-root` `x-team: Service`, у `dig-1-alpha` ключа нет
- **THEN** sidebar раздела Changes показывает `Innovation → dig-4-orphan`, затем `Service → dig-3-root`, затем `dig-1-alpha`; страница `dig-3-root` — `Changes/Service/dig-3-root`

#### Scenario: Вложенные — в группе родителя
- **WHEN** у `dig-3-root` `x-team: Service`, а `dig-3-root-ios` ссылается на него через `parentKey`
- **THEN** страница вложенного — `Changes/Service/dig-3-root/ios`, в таблице он — строкой `↳` в секции `Service`

#### Scenario: Секции таблицы и страница группы
- **WHEN** в разделе есть change'ы групп `Innovation`, `Service` и без группы
- **THEN** таблица Changes содержит секции `### Innovation`, `### Service`, `### Ungrouped` в этом порядке, страница `Changes/Service` — таблицу change'ов `Service` без секций

#### Scenario: Коллизия с id change'а
- **WHEN** у change'а значение группы совпадает с id другого change'а без группы
- **THEN** change выводится без группы, страница группы с таким именем не создаётся

#### Scenario: Архив
- **WHEN** у архивного `2026-08-02-dig-5-old` `x-team: Service`
- **THEN** список архива содержит секцию `### Service`, страница change'а — `Archive/Service/2026-08-02-dig-5-old`

### Requirement: Имя change'а по ключу
Плагин SHALL поддерживать опцию `nameKey` — ключ `.openspec.yaml` с человеческим именем change'а.
Опция не задана — подписи и адреса MUST быть прежними (id). При заданной опции у change'а верхнего
уровня (активного и архивного) со значением ключа это значение SHALL быть подписью в sidebar, в
таблице Changes, в списке архива и в ссылках `Parent` / `Sub-changes`, а также сегментом пути его
страницы; вложенные change'ы SHALL выводиться под этим путём со своей подписью-хвостом id. Значение
со `/`, `\`, `#`, `?`, равное `.` или `..`, а также повторяющее подпись другого change'а в той же папке (группе)
MUST NOT использоваться — подписью остаётся id.

#### Scenario: Имя вместо id
- **WHEN** при `nameKey: "x-name"` у `dig-3-root` (группа `Service`) `x-name: Корень задачи`
- **THEN** sidebar показывает `Корень задачи` под `Service`, страница — `Changes/Service/Корень задачи`, вложенный `ios` — `Changes/Service/Корень задачи/ios`

#### Scenario: То же имя в разных группах
- **WHEN** у change'ов групп `Service` и `Innovation` одинаковое `x-name`
- **THEN** оба выводятся с этим именем, каждый в своей группе

#### Scenario: Повтор имени в одной папке
- **WHEN** у двух change'ов без группы одинаковое `x-name`
- **THEN** первый по порядку подписан именем, второй — id

#### Scenario: Недопустимое имя
- **WHEN** `x-name: a/b` или `x-name: "Задача #6"`
- **THEN** change подписан id, страница — `<раздел>/<id>`

### Requirement: Колонки таблицы из `.openspec.yaml`
Плагин SHALL поддерживать опцию `columns` — список `{ key, title }`. Для каждого элемента таблица
Changes, таблица сводки и таблицы страниц групп SHALL получать колонку `title` после стандартных
(`Change`, `Schema`, `Tasks`, `Updated`), значение — `meta[key]` change'а строки, у вложенных — их
собственное; нет значения — `—`. Значение в кавычках SHALL читаться целиком, `#` внутри кавычек
не комментарий. Символ `|` в значении или заголовке MUST экранироваться. Опция пуста —
таблицы MUST быть прежними.

#### Scenario: Исполнитель в таблице
- **WHEN** `columns: [{ key: "x-assignee", title: "Assignee" }, { key: "x-jira", title: "Jira" }]`, у `dig-3-root` `x-assignee: Alice`, `x-jira: DIG-3`, у вложенного `ios` — `x-assignee: Bob | Carol`
- **THEN** заголовок таблицы — `| Change | Schema | Tasks | Updated | Assignee | Jira |`, строка корня — `… | Alice | DIG-3 |`, строка `ios` — `… | Bob \| Carol | — |`

#### Scenario: Значение в кавычках
- **WHEN** `x-assignee: "Alice #1" # lead`
- **THEN** в колонке — `Alice #1`
