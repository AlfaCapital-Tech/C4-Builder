# agent-skills Specification

## Purpose
Скиллы для coding-агентов (Claude Code, Codex, Cursor и др.), поставляемые вместе с c4builder: их состав, формат, способ установки и автоматическая проверка на соответствие реальному CLI.

## Requirements

### Requirement: Состав набора скиллов
Набор SHALL включать три скилла:
- `c4builder` — работа с проектом c4builder: структура проекта и `.c4builder`, конвенции C4-PlantUML (stdlib-инклюды `<C4/...>`, общие `.iuml`, кириллица, офлайн-рендер), цикл «правка → `c4builder check` → сборка / `c4builder --site -w`», D2, BPMN, mermaid, встроенные плагины `openspec` и `openapi`, реакция на уведомление о новой версии и на уведомление о скиллах; для замечаний со страницы — отсылка к `c4builder-review`;
- `c4builder-setup` — установка, обновление (`c4builder update`) и диагностика: npm (каналы `latest` и `rc`, реестр или зеркало организации) или Docker-образ, Node.js версии из `engines` в `package.json`, системная java или managed JRE (`c4builder jre install` / `jre info`), функциональная проверка сборкой шаблонного проекта, установка скиллов в проект (`c4builder skills`);
- `c4builder-review` — ревью страниц на `c4builder --site -w` с замечаниями агенту: проверка, что сервер отвечает, ссылка на страницу change или раздела, цикл `c4builder feedback --wait --as <name>` в фоне, правка исходников по пачке, отчёт в чате, повтор до решения `approved`, отличие замечания агенту от вопроса в разделе `questionsHeading`. Скилл вызывается и пользователем как `/c4builder-review [change-id|page]`.

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

#### Scenario: Агент видит уведомление о скиллах
- **WHEN** stderr c4builder содержит строку уведомления о скиллах
- **THEN** скилл `c4builder` предписывает сообщить об этом пользователю и запускать `c4builder skills` или удалять личную копию скилла только с его согласия

#### Scenario: Скилл описывает цикл замечаний со страницы
- **WHEN** агент загружает скилл `c4builder-review`, а пользователь просит показать ему страницы и ждать замечаний
- **THEN** скилл предписывает убедиться, что `c4builder --site -w` отвечает, дать ссылку на страницу, запустить `c4builder feedback --wait --as <name>` в фоне, по каждой пачке править исходники, а не каталог сборки, не записывать замечания в раздел вопросов, снова запускать `c4builder feedback --wait --as <name>` с тем же именем и остановиться на `Decision: approved`

#### Scenario: Скиллы без внутренней специфики
- **WHEN** просматривается текст `c4builder-review` и `c4builder-setup`
- **THEN** в них нет адресов внутренних реестров, прокси и хостов организации, а зеркало npm описано как настройка `--registry`/npmrc пользователя

### Requirement: Метаданные скилла валидны
Frontmatter каждого `SKILL.md` MUST содержать `name` и `description`. `name` MUST совпадать с именем каталога скилла, иметь длину 1–64 символа, состоять из `a-z`, `0-9` и `-`, не начинаться и не заканчиваться дефисом и не содержать `--`. `description` MUST быть непустым, не длиннее 1024 символов и описывать, что делает скилл и когда его применять. Проверка MUST выполняться автоматическими тестами на каждом прогоне CI.

#### Scenario: Имя скилла расходится с каталогом
- **WHEN** в `skills/c4builder/SKILL.md` указано `name: c4-builder`
- **THEN** тесты падают с сообщением, называющим файл и ожидаемое имя

#### Scenario: Пустое описание
- **WHEN** у скилла нет `description` или он пустой
- **THEN** тесты падают с сообщением, называющим файл

### Requirement: Скиллы ссылаются только на существующие команды CLI
Каждый флаг (`--x`, `-x`) и каждая подкоманда, упомянутые в командах `c4builder …` внутри скиллов и `template/AGENTS.md`, MUST существовать в CLI текущей версии: флаги — в выводе `c4builder --help`, подкоманды — в списке позиционных подкоманд (capability `cli-commands`). Проверка MUST выполняться автоматическими тестами против собранного `dist/`.

#### Scenario: Скилл упоминает несуществующий флаг
- **WHEN** в скилле есть команда `c4builder --serve`, а флага `--serve` в CLI нет
- **THEN** тесты падают с сообщением, называющим файл и неизвестный флаг

#### Scenario: Скилл упоминает неподдерживаемую подкоманду
- **WHEN** в скилле есть команда `c4builder serve`, а позиционной подкоманды `serve` в CLI нет
- **THEN** тесты падают с сообщением, называющим файл и подкоманду

### Requirement: Скиллы не содержат внутренней инфраструктуры
Скиллы и `template/AGENTS.md` MUST NOT содержать адреса внутренних хостов и приватных реестров организации; установка MUST описываться только через публичные источники (npm registry, GHCR). Проверка MUST выполняться автоматическими тестами.

#### Scenario: Внутренний хост в скилле
- **WHEN** в тексте скилла встречается адрес в домене `alfacapital.ru`
- **THEN** тесты падают с сообщением, называющим файл и найденный адрес

### Requirement: Скиллы поставляются в пакете в формате Agent Skills
Репозиторий SHALL содержать скиллы в `skills/<name>/SKILL.md` в формате Agent Skills, и каталог `skills/` MUST входить в публикуемый npm-пакет. Установка из репозитория командой `npx skills add AlfaCapital-Tech/C4-Builder/skills` (весь набор) или с `--skill <name>` (один скилл) SHALL оставаться рабочей альтернативой.

#### Scenario: Скиллы находятся в стандартном месте
- **WHEN** просматривается дерево репозитория
- **THEN** каждый поставляемый скилл лежит в `skills/<name>/SKILL.md`, где `<name>` — имя скилла

#### Scenario: Скиллы входят в npm-пакет
- **WHEN** выполняется `npm pack --dry-run`
- **THEN** в списке файлов пакета есть `skills/<name>/SKILL.md` каждого поставляемого скилла и файлы их `references/`

### Requirement: Команда установки скиллов
`c4builder skills` SHALL ставить все скиллы пакета в текущий каталог: в `.agents/skills/<name>/` всегда, в `.claude/skills/<name>/` — если CLI запущен из Claude Code (`CLAUDECODE`) или в текущем каталоге уже есть `.claude/`. Команда печатает установленные пути и MUST NOT читать или создавать `.c4builder` и `.c4builder.cache`.

#### Scenario: Установка из терминала
- **WHEN** в каталоге без `.claude/` и без переменной `CLAUDECODE` выполняется `c4builder skills`
- **THEN** появляются `.agents/skills/<name>/SKILL.md` всех скиллов пакета; `.claude/`, `.c4builder` и `.c4builder.cache` не появляются; код выхода 0

#### Scenario: Установка из Claude Code
- **WHEN** `c4builder skills` выполняется с `CLAUDECODE=1`
- **THEN** скиллы появляются и в `.agents/skills/`, и в `.claude/skills/`

### Requirement: Установка заменяет скиллы пакета целиком
Каталог каждого скилла пакета MUST заменяться целиком: файлы, которых нет в пакете, удаляются. Скиллы с другими именами MUST NOT затрагиваться. Повторный запуск SHALL давать тот же результат, отдельной команды обновления нет.

#### Scenario: Обновление убирает устаревшее
- **WHEN** в `.agents/skills/c4builder/` лежат `SKILL.md` прошлой версии и файл, которого нет в пакете, а рядом — чужой скилл `.agents/skills/other/`
- **THEN** после `c4builder skills` `SKILL.md` совпадает с пакетным (кроме отметки версии), лишнего файла нет, `.agents/skills/other/` не изменился

### Requirement: Отметка версии в установленном скилле
Во frontmatter каждого `SKILL.md`, поставленного c4builder, MUST быть `metadata.generatedBy` с версией CLI, который его поставил. Остальной текст SHALL совпадать с пакетным.

#### Scenario: Отметка равна версии CLI
- **WHEN** выполняется `c4builder skills`
- **THEN** `metadata.generatedBy` в каждом установленном `SKILL.md` равен выводу `c4builder --version`

### Requirement: Предупреждение о личной копии
Если под Claude Code есть личная копия `~/.claude/skills/c4builder`, у которой `metadata.generatedBy` не задан или старше CLI, `c4builder skills` MUST предупредить в stderr, что она перекрывает проектные скиллы, назвать её путь и не изменять её.

#### Scenario: Личная копия без версии
- **WHEN** с `CLAUDECODE=1` выполняется `c4builder skills`, а в `~/.claude/skills/c4builder/SKILL.md` нет `metadata.generatedBy`
- **THEN** проектные скиллы ставятся, в stderr — предупреждение с путём личной копии, личная копия не изменена

### Requirement: Уведомление о скиллах под агентом
Сборка (`c4builder` без подкоманды) и `c4builder site` / `--site`, запущенные агентом, SHALL при старте печатать в stderr одну строку на английском с командой `c4builder skills`, если действующей копии скилла `c4builder` нет или её `metadata.generatedBy` не задан или старше версии CLI. Копия новее CLI строки не вызывает. Строка MUST NOT менять stdout и код выхода.

#### Scenario: Скиллов нет
- **WHEN** агент с `CLAUDECODE=1` запускает сборку в проекте, где нет ни `.claude/skills/c4builder`, ни `~/.claude/skills/c4builder`
- **THEN** в stderr одна строка о том, что скиллы не установлены, с командой `c4builder skills`; stdout и код выхода те же, что без строки

#### Scenario: Скиллы актуальны
- **WHEN** в проекте выполнен `c4builder skills` той же версией CLI и агент запускает сборку
- **THEN** строки о скиллах нет

#### Scenario: Скиллы старше CLI
- **WHEN** у `.claude/skills/c4builder/SKILL.md` `metadata.generatedBy` старше версии CLI и агент с `CLAUDECODE=1` запускает `c4builder site -w`
- **THEN** при старте в stderr одна строка с версией скилла, версией CLI и командой `c4builder skills`

### Requirement: Действующая копия скилла
Каталог скиллов агента — `.claude/skills` для Claude Code и `.agents/skills` для остальных агентов. Действующей копией SHALL считаться личная (`~/<каталог>/skills/c4builder`), если она есть, иначе ближайшая проектная — в текущем каталоге или в родительских до корня git-репозитория. Строка уведомления об устаревшей личной копии MUST называть её путь и говорить, что она перекрывает проектные скиллы.

#### Scenario: Устаревшая личная копия
- **WHEN** в `~/.claude/skills/c4builder/SKILL.md` нет `metadata.generatedBy`, в проекте скиллы актуальны и агент с `CLAUDECODE=1` запускает сборку
- **THEN** в stderr одна строка с путём личной копии: она перекрывает проектные скиллы

#### Scenario: Другой агент
- **WHEN** скиллы стоят только в `.claude/skills/`, а сборку запускает Codex (`CODEX_THREAD_ID`)
- **THEN** печатается строка о том, что скиллы не установлены

#### Scenario: Проект в подкаталоге репозитория
- **WHEN** скиллы стоят в `.claude/skills/` корня git-репозитория, а агент с `CLAUDECODE=1` запускает сборку в его подкаталоге `docs/`
- **THEN** строки о скиллах нет

### Requirement: Когда уведомление о скиллах не печатается
Уведомление о скиллах MUST NOT печататься, если CLI запущен не агентом (переменные окружения агентов из capability `site-agent-feedback`; `C4BUILDER_AGENT=0` выключает), в условиях, где отключена проверка новой версии (capability `cli-update`: `CI`, `NO_UPDATE_NOTIFIER`, Docker-образ), и в командах, кроме сборки и `site`.

#### Scenario: Не агент или CI
- **WHEN** сборку запускает человек без переменных агентов, или агент с `CI=true`
- **THEN** строки о скиллах нет

#### Scenario: Проверка диаграммы
- **WHEN** агент запускает `c4builder check ok.puml` в проекте без скиллов
- **THEN** строки о скиллах нет

### Requirement: Новый проект получает скиллы
`c4builder --new` (и `c4builder new`) SHALL ставить скиллы пакета в каталог нового проекта по правилам команды `c4builder skills`: `.agents/skills/` всегда, `.claude/skills/` — под Claude Code.

#### Scenario: Новый проект из Claude Code
- **WHEN** с `CLAUDECODE=1` выполняется `c4builder --new --name demo -y`
- **THEN** в `demo/` есть `.agents/skills/c4builder/SKILL.md` и `.claude/skills/c4builder/SKILL.md` с `metadata.generatedBy` текущей версии, а сборка `demo` не публикует их в каталог выходов
