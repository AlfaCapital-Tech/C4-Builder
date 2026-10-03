# Spec Delta

## ADDED Requirements

### Requirement: Шаблон содержит инструкции для агента
Проект, созданный `c4builder --new`, SHALL содержать в корне файл `AGENTS.md` на английском языке, который описывает: сборку (`c4builder`), проверку отдельных диаграмм (`c4builder check <file...>`), живой просмотр (`c4builder --site -w`), расположение исходников (`src/`) и конвенции диаграмм (stdlib-инклюды `<C4/...>`, общий `.iuml`, офлайн-рендер), а также команду установки скиллов `npx skills add AlfaCapital-Tech/C4-Builder`. `AGENTS.md` MUST NOT попадать в выходы сборки (сайт, markdown, complete-markdown).

#### Scenario: AGENTS.md в новом проекте
- **WHEN** проект создан командой `c4builder --new --name demo -y`
- **THEN** в каталоге `demo/` есть `AGENTS.md` с командами `c4builder`, `c4builder check` и `npx skills add AlfaCapital-Tech/C4-Builder`

#### Scenario: AGENTS.md не попадает в выходы
- **WHEN** новый проект собран командой `c4builder`
- **THEN** в каталоге выходов нет файла `AGENTS.md`, а сгенерированные страницы не содержат его текста
