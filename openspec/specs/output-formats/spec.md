# output-formats Specification

## Purpose
TBD - created by archiving change remove-pdf. Update Purpose after archive.
## Requirements
### Requirement: Поддерживаемые типы вывода
Сборка SHALL поддерживать три типа вывода: множественные markdown-файлы
(`generateMD`), единый complete-markdown (`generateCompleteMD`) и website
(`generateWEB`). PDF-вывод (множественные PDF-файлы и единый complete-PDF)
MUST NOT поддерживаться, а зависимость `md-to-pdf` и связанный headless-браузер
MUST отсутствовать в зависимостях пакета.

#### Scenario: Сборка доступных выходов
- **WHEN** в `.c4builder` включены `generateMD`, `generateCompleteMD` и/или `generateWEB`
- **THEN** сборка формирует соответствующие выходы и не порождает PDF-файлов

#### Scenario: PDF-зависимость отсутствует
- **WHEN** просматриваются зависимости пакета
- **THEN** `md-to-pdf` (и транзитивный headless-браузер) в них отсутствует, файла `pdf.css` в пакете нет

### Requirement: Мастер настройки не предлагает PDF
Интерактивный мастер настройки (`c4builder config`) MUST NOT предлагать PDF-форматы
в выборе типов вывода и MUST NOT спрашивать про пользовательский PDF-CSS. Наличие
или отсутствие PDF-ключей в конфиге MUST NOT влиять на то, показывается ли вопрос
о выборе форматов.

#### Scenario: Выбор форматов в мастере
- **WHEN** пользователь запускает мастер настройки
- **THEN** в списке форматов присутствуют только markdown, complete-markdown и website, а вопрос про PDF-CSS не задаётся

#### Scenario: Конфиг без PDF-ключей не ре-триггерит вопрос
- **WHEN** запускается сборка с конфигом, где выбраны форматы, но PDF-ключи отсутствуют
- **THEN** мастер выбора форматов не показывается повторно из-за отсутствия PDF-ключей

### Requirement: Легаси-конфиг с PDF не ломает сборку
Сборка SHALL продолжаться и завершаться успешно (код возврата 0), собрав все прочие
включённые выходы, при наличии в существующем `.c4builder` истинного (truthy)
значения `generatePDF` и/или `generateCompletePDF`. Сборка MUST напечатать
предупреждение, что PDF-вывод удалён, перечислив в нём **только реально
присутствующие truthy PDF-ключи**, и подсказать удалить их из `.c4builder` вручную.
Сборка MUST NOT изменять файл конфигурации.

#### Scenario: Truthy PDF-ключ в конфиге
- **WHEN** в `.c4builder` `generatePDF: true` и включены другие выходы
- **THEN** печатается предупреждение с ключом `generatePDF` и подсказкой удалить его, markdown/website собираются, процесс завершается с кодом 0, а `.c4builder` остаётся без изменений

#### Scenario: В предупреждении только присутствующие ключи
- **WHEN** truthy только `generateCompletePDF`, а `generatePDF` равен `false` или отсутствует
- **THEN** предупреждение перечисляет `generateCompletePDF` и не упоминает `generatePDF`

#### Scenario: PDF выключен или не задан
- **WHEN** `generatePDF` и `generateCompletePDF` равны `false` или отсутствуют в конфиге
- **THEN** предупреждение о PDF не печатается

