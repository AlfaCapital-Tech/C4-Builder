# Spec Delta

## MODIFIED Requirements

### Requirement: Состав набора скиллов
Набор SHALL включать два скилла:
- `c4builder` — работа с проектом c4builder: структура проекта и `.c4builder`, конвенции C4-PlantUML (stdlib-инклюды `<C4/...>`, общие `.iuml`, кириллица, офлайн-рендер), цикл «правка → `c4builder check` → сборка / `c4builder --site -w`», цикл получения замечаний со страницы (`site -w` в фоне + `c4builder feedback --wait` в фоне, правка исходников, повторный запуск до решения `approved`) и отличие замечания агенту от вопроса в разделе `questionsHeading`, D2, встроенные плагины `openspec` и `openapi`, реакция на уведомление о новой версии;
- `c4builder-setup` — установка, обновление (`c4builder update`) и диагностика: npm (каналы `latest` и `rc`) или Docker-образ, Node.js версии из `engines` в `package.json`, системная java или managed JRE (`c4builder jre install` / `jre info`), функциональная проверка сборкой шаблонного проекта.

Тексты скиллов MUST быть на английском языке.

#### Scenario: Общий скилл описывает цикл проверки
- **WHEN** агент загружает скилл `c4builder`
- **THEN** скилл предписывает после правки `.puml`/`.iuml`/`.d2` запускать `c4builder check <file...>` и исправлять ошибки по коду возврата и сообщению `file: line N`

#### Scenario: Скилл установки проверяет работоспособность, а не только версию
- **WHEN** агент выполняет скилл `c4builder-setup`
- **THEN** скилл завершается созданием проекта `c4builder --new --name <name> -y` во временном каталоге и его сборкой, а не только проверкой `c4builder --version`

#### Scenario: Агент видит уведомление о новой версии
- **WHEN** вывод c4builder содержит строку `c4builder <new> is available (current <current>). Run: c4builder update`
- **THEN** скилл `c4builder` предписывает сообщить об этом пользователю и запускать `c4builder update` только по его просьбе

#### Scenario: Скилл описывает цикл замечаний со страницы
- **WHEN** агент загружает скилл `c4builder`, а пользователь просит показать ему страницы и ждать замечаний
- **THEN** скилл предписывает запустить `c4builder --site -w` и `c4builder feedback --wait` в фоне, по каждой пачке править исходники в `src/`, а не `docs/`, не записывать замечания в раздел вопросов, снова запускать `c4builder feedback --wait` и остановиться на `Decision: approved`
