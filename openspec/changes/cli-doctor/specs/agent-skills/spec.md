## MODIFIED Requirements

### Requirement: Состав набора скиллов
Набор SHALL включать три скилла:
- `c4builder` — работа с проектом c4builder: структура проекта и `.c4builder`, конвенции C4-PlantUML (stdlib-инклюды `<C4/...>`, общие `.iuml`, кириллица, офлайн-рендер), цикл «правка → `c4builder check` → сборка / `c4builder --site -w`», D2, BPMN, mermaid, встроенные плагины `openspec` и `openapi`, реакция на уведомление о новой версии и на уведомление о скиллах; для замечаний со страницы — отсылка к `c4builder-review`;
- `c4builder-setup` — установка, обновление (`c4builder update`) и диагностика, начиная с `c4builder doctor` и его исправлений: npm (каналы `latest` и `rc`, реестр или зеркало организации) или Docker-образ, Node.js версии из `engines` в `package.json`, системная java или managed JRE (`c4builder jre install` / `jre info`), функциональная проверка сборкой шаблонного проекта (`c4builder doctor render --full`), установка скиллов в проект (`c4builder skills`);
- `c4builder-review` — ревью страниц на `c4builder --site -w` с замечаниями агенту: проверка, что сервер отвечает, ссылка на страницу change или раздела, цикл `c4builder feedback --wait --as <name>` в фоне, правка исходников по пачке, отчёт в чате, повтор до решения `approved`, отличие замечания агенту от вопроса в разделе `questionsHeading`. Скилл вызывается и пользователем как `/c4builder-review [change-id|page]`.

Тексты скиллов MUST быть на английском языке.

#### Scenario: Общий скилл описывает цикл проверки
- **WHEN** агент загружает скилл `c4builder`
- **THEN** скилл предписывает после правки `.puml`/`.iuml`/`.d2` запускать `c4builder check <file...>` и исправлять ошибки по коду возврата и сообщению `file: line N`

#### Scenario: Скилл установки проверяет работоспособность, а не только версию
- **WHEN** агент выполняет скилл `c4builder-setup`
- **THEN** скилл начинается с `c4builder doctor` и завершается функциональной проверкой `c4builder doctor render --full` (сборка шаблонного проекта во временном каталоге), а не только проверкой `c4builder --version`

#### Scenario: Агент видит уведомление о новой версии
- **WHEN** вывод c4builder содержит строку `c4builder <new> is available (current <current>). Run: c4builder update`
- **THEN** скилл `c4builder` предписывает сообщить об этом пользователю и запускать `c4builder update` только по его просьбе

#### Scenario: Агент видит уведомление о скиллах
- **WHEN** stderr c4builder содержит строку уведомления о скиллах
- **THEN** скилл `c4builder` предписывает сообщить об этом пользователю и запускать `c4builder skills` или удалять личную копию скилла только с его согласия

#### Scenario: Скилл описывает цикл замечаний со страницы
- **WHEN** агент загружает скилл `c4builder-review`, а пользователь просит показать ему страницы и ждать замечаний
- **THEN** скилл предписывает убедиться, что `c4builder --site -w` отвечает, дать ссылку на страницу, запустить `c4builder feedback --wait --as <name>` в фоне, по каждой пачке править исходники, а не каталог сборки, не записывать замечания в раздел вопросов, снова запускать `c4builder feedback --wait --as <name>` с тем же именем и остановиться на `Decision: approved`

#### Scenario: Скиллы без внутренней специфики
- **WHEN** просматривается текст `c4builder-review` и `c4builder-setup`
- **THEN** в них нет адресов внутренних реестров, прокси и хостов организации, а зеркало npm описано как настройка `--registry`/npmrc пользователя

### Requirement: Уведомление о скиллах под агентом
Сборка (`c4builder` без подкоманды) и `c4builder site` / `--site`, запущенные агентом, SHALL при старте печатать в stderr одну строку на английском с командой `c4builder skills` и ссылкой на `c4builder doctor skills` для подробностей, если действующей копии скилла `c4builder` нет или её `metadata.generatedBy` не задан или старше версии CLI. Копия новее CLI строки не вызывает. Строка MUST NOT менять stdout и код выхода.

#### Scenario: Скиллов нет
- **WHEN** агент с `CLAUDECODE=1` запускает сборку в проекте, где нет ни `.claude/skills/c4builder`, ни `~/.claude/skills/c4builder`
- **THEN** в stderr одна строка о том, что скиллы не установлены, с командой `c4builder skills` и ссылкой на `c4builder doctor skills`; stdout и код выхода те же, что без строки

#### Scenario: Скиллы актуальны
- **WHEN** в проекте выполнен `c4builder skills` той же версией CLI и агент запускает сборку
- **THEN** строки о скиллах нет

#### Scenario: Скиллы старше CLI
- **WHEN** у `.claude/skills/c4builder/SKILL.md` `metadata.generatedBy` старше версии CLI и агент с `CLAUDECODE=1` запускает `c4builder site -w`
- **THEN** при старте в stderr одна строка с версией скилла, версией CLI и командой `c4builder skills`
