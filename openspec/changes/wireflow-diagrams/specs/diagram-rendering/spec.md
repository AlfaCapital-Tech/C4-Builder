# Spec Delta

## MODIFIED Requirements

### Requirement: Второй бэкенд рендера выбирается по расширению
Сборка SHALL поддерживать `.d2`-, `.bpmn`-, `.mmd`- и wireflow-диаграммы наравне с `.puml` и
выбирать движок рендера по расширению файла:
- `.puml` — PlantUML;
- `.d2` — D2;
- `.bpmn` — BPMN-движок (см. capability `bpmn-diagrams`);
- `.mmd` — mermaid-движок (см. capability `mermaid-diagrams`);
- `.wireflow.json` и имя `wireflow.json` — wireflow-движок (см. capability `wireflow-diagrams`);
  расширение определяется по полному суффиксу, прочие `.json` диаграммами не являются.

Добавление движков MUST NOT менять поведение существующих `.puml`-проектов. Выходной файл
диаграммы именуется по имени исходного файла без расширения движка (для wireflow — без
`.wireflow.json`). Формат рендера всех движков — SVG. При `DIAGRAM_FORMAT=png` SVG
растеризуется в PNG отдельной стадией (см. требование о PNG-выводе).

#### Scenario: Смешанное дерево .puml и .d2
- **WHEN** в дереве проекта присутствуют и `.puml`, и `.d2` файлы
- **THEN** `.puml` рендерятся PlantUML, `.d2` рендерятся D2, при формате по умолчанию
  (svg) оба дают SVG рядом с прочими выходами, ссылки в markdown работают для обоих

#### Scenario: BPMN рядом с другими движками
- **WHEN** в дереве проекта присутствуют `.puml`, `.d2` и `.bpmn` файлы
- **THEN** каждый файл рендерится своим движком, `.bpmn` даёт SVG (или PNG при
  `DIAGRAM_FORMAT=png`) с именем по исходному файлу, ссылки в markdown работают для всех

#### Scenario: Mermaid рядом с другими движками
- **WHEN** в дереве проекта присутствуют `.puml`, `.d2`, `.bpmn` и `.mmd` файлы
- **THEN** каждый файл рендерится своим движком, `.mmd` даёт SVG (или PNG при
  `DIAGRAM_FORMAT=png`) с именем по исходному файлу, ссылки в markdown работают для всех

#### Scenario: Wireflow рядом с другими движками
- **WHEN** в дереве проекта присутствуют `.puml`, `.mmd` и `checkout.wireflow.json`
- **THEN** каждый файл рендерится своим движком, `checkout.wireflow.json` даёт `checkout.svg`
  (или `checkout.png` при `DIAGRAM_FORMAT=png`), ссылка `![](checkout.wireflow.json)` в
  markdown заменяется картинкой

#### Scenario: Проект только из .puml не затронут
- **WHEN** в проекте нет ни одного `.d2`-, `.bpmn`-, `.mmd`- и wireflow-файла и ни одного блока
  ```` ```mermaid ````
- **THEN** сборка и её выход идентичны прежнему поведению, а зависимости D2, BPMN и mermaid
  не загружаются
