# Spec Delta

## MODIFIED Requirements

### Requirement: Полный текст llms-full.txt с исходниками диаграмм
При включённых `generateLLMS` и `generateWEB` сборка SHALL записывать в корень
выходного каталога `llms-full.txt`: текст всех страниц проекта в том же составе и
порядке, что complete-markdown. Каждая диаграмма MUST быть вставлена исходным текстом
в fenced-блок с языком движка на том же месте, где на странице стоит изображение, а не
ссылкой на изображение и не base64. Язык блока: `plantuml` для `.puml` (включая ditaa),
`d2` для `.d2`, `mermaid` для mermaid-диаграмм (файлов `.mmd` и fenced-блоков). Представление
диаграмм в `llms-full.txt` MUST NOT зависеть от `diagramFormat`, `embedDiagram`,
`includeLinkToDiagram` и `generateLocalImages`. Fenced-блок MUST оставаться корректным, даже
если исходник содержит обратные кавычки.

#### Scenario: PlantUML-диаграмма исходником
- **WHEN** страница содержит `context.puml`
- **THEN** в `llms-full.txt` на месте диаграммы стоит блок ```` ```plantuml ```` с текстом `context.puml` без изменений, а ссылки на `context.svg` нет

#### Scenario: D2-диаграмма исходником
- **WHEN** страница содержит `.d2`-диаграмму
- **THEN** в `llms-full.txt` она представлена блоком ```` ```d2 ```` с её исходным текстом

#### Scenario: Mermaid-диаграмма исходником
- **WHEN** страница содержит `.mmd`-диаграмму или блок ```` ```mermaid ````
- **THEN** в `llms-full.txt` на её месте стоит блок ```` ```mermaid ```` с исходным текстом, а ссылки на картинку нет

#### Scenario: Диаграмма из fenced-блока артефакта плагина
- **WHEN** артефакт OpenSpec содержит fenced-блок `plantuml`, превращённый плагином в диаграмму страницы
- **THEN** в `llms-full.txt` на его месте стоит fenced-блок `plantuml` с тем же исходником

#### Scenario: Независимость от настроек изображений
- **WHEN** проект собирается с `embedDiagram: true` и `diagramFormat: png`
- **THEN** `llms-full.txt` не содержит `data:image` и ссылок на PNG диаграмм — только исходники
