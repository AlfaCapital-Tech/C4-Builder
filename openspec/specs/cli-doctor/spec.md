# cli-doctor Specification

## Purpose
Команда `c4builder doctor`: одна проверка среды, скиллов агента, пробного рендера, проекта и запуска — только чтением, с исправлением у каждой проблемы, стабильными id для агентов (`--json`) и выводом, безопасным для публикации в issue.

## Requirements

### Requirement: Команда диагностики
CLI SHALL предоставлять подкоманду `c4builder doctor [group...]`, которая выполняет проверки групп `env`, `skills`, `render`, `project`, `runtime` (все — без аргументов, перечисленные — с ними) и печатает результат. Неизвестное имя группы MUST приводить к сообщению со списком групп и коду возврата 2 без выполнения проверок.

#### Scenario: Одна группа
- **WHEN** выполняется `c4builder doctor skills`
- **THEN** печатается только группа `skills`

#### Scenario: Опечатка в группе
- **WHEN** выполняется `c4builder doctor skils`
- **THEN** печатается сообщение о неизвестной группе `skils` со списком групп, код возврата 2

### Requirement: Диагностика только читает
`c4builder doctor` MUST NOT создавать, менять или удалять файлы, кроме временного каталога `--full`, который удаляется при любом исходе; MUST NOT скачивать JRE и ставить что-либо; MUST NOT читать конфиг через мастер настройки. Команда MUST работать без терминала и без `.c4builder`.

#### Scenario: Вне проекта
- **WHEN** в пустом каталоге выполняется `c4builder doctor --offline`
- **THEN** печатаются группы проверок, проверки группы `project` — `skipped` с подсказкой `c4builder --new`, каталог остаётся пустым

#### Scenario: Вне проекта без терминала
- **WHEN** в пустом каталоге без `.c4builder` выполняется `c4builder doctor --offline` со stdin не терминалом (CI, агент)
- **THEN** проверки выполняются, сообщения «no .c4builder … run c4builder --new» и выхода с кодом 1 до проверок нет

### Requirement: Id и статусы проверок
Каждая проверка SHALL иметь стабильный id вида `<group>.<rest>` — имя группы и один или несколько сегментов через точку латиницей в нижнем регистре (`env.node`, `skills.claude.project`) — и статус `ok`, `warn`, `error` или `skipped`. Текстовый вывод SHALL показывать статусы символами `✓`, `!`, `✗`, `–` и заканчиваться строкой с числом ошибок и предупреждений; все строки — на английском.

#### Scenario: Итог в конце
- **WHEN** выполняется `c4builder doctor` и есть одна ошибка и одно предупреждение
- **THEN** последняя строка вывода — `1 error, 1 warning`

### Requirement: Исправления у проблем
У проверки со статусом `error` MUST быть исправление — одна команда или ссылка; у `warn` исправление MUST быть, когда у проблемы есть действие, а информационный `warn` MAY быть без исправления. Исправление, которое меняет файлы проекта или удаляет личные копии скиллов, MUST быть помечено как требующее согласия пользователя.

#### Scenario: Проблема с исправлением
- **WHEN** скиллы проекта старше CLI и выполняется `c4builder doctor skills`
- **THEN** проверка помечена `✗`, под ней строка `fix: c4builder skills` с пометкой `(ask the user first)`

#### Scenario: Информационное предупреждение
- **WHEN** скилл плагина Claude Code дублирует проектный и выполняется `c4builder doctor skills --json`
- **THEN** у этой проверки статус `warn` и нет поля `fix`

### Requirement: Коды возврата диагностики
`c4builder doctor` SHALL завершаться с кодом 0, если нет проверок со статусом `error`, и с кодом 1, если они есть. С флагом `--strict` код MUST быть 1 и при наличии проверок со статусом `warn`. Статус `skipped` MUST NOT влиять на код возврата.

#### Scenario: Только предупреждения
- **WHEN** единственная проблема — `warn` и выполняется `c4builder doctor`
- **THEN** код возврата 0

#### Scenario: Строгий режим
- **WHEN** единственная проблема — `warn` и выполняется `c4builder doctor --strict`
- **THEN** код возврата 1

#### Scenario: Нет сети
- **WHEN** реестр npm недоступен и выполняется `c4builder doctor`
- **THEN** проверка новой версии — `skipped`, код возврата от неё не зависит

### Requirement: Машиночитаемый вывод диагностики
С флагом `--json` команда SHALL печатать в stdout ровно один JSON-объект с полями `version`, `channel`, `agent`, `checks` (массив `{ id, status, message, fix?, askUser?, details? }`) и `summary` (`errors`, `warnings`) и ничего больше — в том числе с `--full`: вывод пробной сборки MUST NOT попадать в stdout, его хвост MAY быть в `details`. Id проверок MUST оставаться неизменными между версиями CLI; новые проверки добавляются с новыми id.

#### Scenario: JSON для агента
- **WHEN** выполняется `c4builder doctor --json --offline`
- **THEN** stdout разбирается как один JSON-объект, у каждой проверки есть `id` вида `<group>.<rest>` и `status`

#### Scenario: JSON с пробной сборкой
- **WHEN** на машине с Java выполняется `c4builder doctor render --full --json --offline`
- **THEN** stdout разбирается как один JSON-объект с проверкой `render.full`, логов сборки в stdout нет

### Requirement: Каталоги скиллов агента
Группа `skills` SHALL искать скиллы пакета (`c4builder`, `c4builder-review`, `c4builder-setup`) в `.agents/skills`; для Claude Code — в `.claude/skills` от текущего каталога вверх до корня git и в `~/.claude/skills`; для Codex — в `.codex/skills`, `~/.agents/skills` и `$CODEX_HOME/skills`. Под агентом проверяются каталоги этого агента и `.agents`, без агента — все. Группа MUST заканчиваться проверкой `skills.session` со статусом `skipped`: CLI не видит, какие скиллы загрузила сессия агента.

#### Scenario: Скиллы Codex
- **WHEN** скиллы стоят только в `.claude/skills/`, а `c4builder doctor skills` выполняет Codex (`CODEX_THREAD_ID`)
- **THEN** проверка сообщает, что скиллов для Codex нет, исправление — `c4builder skills`

#### Scenario: Оговорка о сессии
- **WHEN** выполняется `c4builder doctor skills`
- **THEN** последняя строка группы говорит, что CLI не видит, какие скиллы загрузила сессия агента

### Requirement: Состояние копии скилла
Для каждого найденного каталога скиллов группа `skills` MUST сообщать: неполный набор скиллов пакета (`warn`); отметку `metadata.generatedBy` старше CLI (`error`), новее CLI или её отсутствие (`warn`); текст, не совпадающий с файлами пакета той же версии без учёта вписанной отметки (`warn`); перекрытие проектной копии личной у Claude Code (`warn`).

#### Scenario: Скиллы актуальны
- **WHEN** в проекте выполнен `c4builder skills` той же версией CLI и агент с `CLAUDECODE=1` выполняет `c4builder doctor skills`
- **THEN** проверки скиллов — `ok`, код возврата 0

#### Scenario: Изменённая копия
- **WHEN** в `.claude/skills/c4builder/SKILL.md` с отметкой текущей версии дописана строка
- **THEN** проверка этого скилла — `warn` «edited copy»

#### Scenario: Личная копия без версии
- **WHEN** в `~/.claude/skills/c4builder/SKILL.md` нет `metadata.generatedBy`, а в проекте скиллы актуальны
- **THEN** `warn` с путём личной копии: она перекрывает проектные скиллы; исправление — удалить её, с пометкой о согласии пользователя

### Requirement: Скиллы плагинов Claude Code
Группа `skills` SHALL искать в кэше плагинов Claude Code (`~/.claude/plugins/cache`) скиллы с именами скиллов пакета и сообщать о найденных как о дублях проектных скиллов (`warn`), указывая, отличается ли их текст от пакета. Ошибка обхода кэша MUST давать `skipped`, а не `error`.

#### Scenario: Плагин дублирует скилл
- **WHEN** в кэше плагинов есть `.../skills/c4builder-review/SKILL.md` с текстом, отличным от пакета
- **THEN** `warn`: скилл плагина дублирует проектный и отличается от пакета

### Requirement: Проверки Node.js и версии CLI
Группа `env` SHALL выполнять проверки: `env.node` — версия Node.js не ниже нижней границы `engines.node` пакета вида `>=X[.Y[.Z]]` (`ok`; ниже — `error`; другая форма диапазона — `skipped`); `env.cli` — версия и канал (`rc` для пререлиза, иначе `latest`); `env.update` — нет новее (`ok`), есть (`warn` с исправлением `c4builder update`), `--offline` или реестр не ответил (`skipped`).

#### Scenario: Node.js ниже границы
- **WHEN** версия Node.js ниже нижней границы `engines.node` и выполняется `c4builder doctor env --offline`
- **THEN** `env.node` — `error`

#### Scenario: Есть новая версия
- **WHEN** реестр npm отдаёт версию новее текущей и выполняется `c4builder doctor env`
- **THEN** `env.update` — `warn` с исправлением `c4builder update`

### Requirement: Проверки Java, D2 и шрифта
Группа `env` SHALL выполнять проверки: `env.java` — системная Java ≥ 17 или JRE в кэше (`ok`), нет ни той, ни другой (`warn` с исправлением `c4builder jre install`); `env.d2` — нет `.d2` в проекте (`skipped`), движок загружается (`ok`), нет (`error`); `env.fonts` — встроенный шрифт (`ok`), `useSystemFonts: true` в `.c4builder` (`warn`). Java MUST определяться без скачивания JRE.

#### Scenario: Нет Java
- **WHEN** нет ни системной Java, ни JRE в кэше и выполняется `c4builder doctor env`
- **THEN** `env.java` — `warn` с исправлением `c4builder jre install`, JRE не скачивается

### Requirement: Проверки установки и прокси
Группа `env` SHALL выполнять проверки: `env.install` — способ установки: глобальный npm, зависимость проекта, Docker (`ok`), несколько `c4builder` в `PATH` (`warn`); `env.proxy` — только факт, заданы ли `HTTPS_PROXY`, `HTTP_PROXY`, `NODE_EXTRA_CA_CERTS` (`ok`), `NODE_EXTRA_CA_CERTS` указывает на несуществующий файл (`warn`).

#### Scenario: Нет файла сертификатов
- **WHEN** `NODE_EXTRA_CA_CERTS` указывает на несуществующий файл и выполняется `c4builder doctor env --offline`
- **THEN** `env.proxy` — `warn`, путь к файлу без `-v` не печатается

### Requirement: Сеть диагностики
Наличие новой версии MUST проверяться запросом к реестру npm с таймаутом не более 3 с. С `--offline` doctor MUST NOT делать ни одного сетевого запроса. Фоновая проверка новой версии и уведомление о ней, которые CLI делает для других команд, для `doctor` MUST NOT выполняться. Переменные `CI` и `NO_UPDATE_NOTIFIER` doctor MUST NOT выключать.

#### Scenario: Без сети по флагу
- **WHEN** выполняется `c4builder doctor env --offline`
- **THEN** запросов к реестру нет — ни своих, ни фоновой проверки, проверка `env.update` — `skipped`

#### Scenario: В CI
- **WHEN** выполняется `CI=true c4builder doctor env`
- **THEN** проверки среды выполняются, как без `CI`

### Requirement: Пробный рендер
Группа `render` SHALL рендерить крошечную PlantUML-диаграмму с C4 stdlib движком сборки, а D2 и Mermaid — только если такие файлы есть в проекте. Без системной Java и JRE в кэше рендер PlantUML MUST быть `skipped` с исправлением `c4builder jre install`, без скачивания JRE.

#### Scenario: Пробный рендер
- **WHEN** выполняется `c4builder doctor render` на машине с рабочей Java
- **THEN** проверка рендера — `ok` со временем рендера

#### Scenario: Рендер без Java
- **WHEN** нет ни системной Java, ни JRE в кэше и выполняется `c4builder doctor render --offline`
- **THEN** рендер PlantUML — `skipped` с исправлением `c4builder jre install`, в кэше JRE ничего не появилось

### Requirement: Пробная сборка
С `--full` группа `render` SHALL создавать шаблонный проект во временном каталоге и собирать его дочерним процессом. Вывод сборки SHALL показываться только с `-v` или при ошибке. Без системной Java и JRE в кэше проверка `render.full` MUST быть `skipped`. Временный каталог MUST удаляться при любом исходе, включая ошибку сборки.

#### Scenario: Полная проверка
- **WHEN** выполняется `c4builder doctor render --full`
- **THEN** шаблонный проект собирается во временном каталоге, лога сборки в выводе нет, после завершения временного каталога нет

#### Scenario: Пробная сборка упала
- **WHEN** сборка шаблонного проекта при `c4builder doctor render --full` завершается ошибкой
- **THEN** `render.full` — `error` с хвостом лога сборки, временного каталога после завершения нет

### Requirement: Проект и запуск
Группа `project` SHALL проверять, что `.c4builder` найден, проходит валидацию и полон для сборки без мастера, а каталоги исходников и пути плагинов существуют. Группа `runtime` SHALL проверять порт `webPort` (или `-p`) на `127.0.0.1`: соединение отклонено — `ok` «free»; `GET /__livereload` отвечает `Content-Type: text/event-stream` — `ok` «site -w is running» с адресом; иначе — `warn` с подсказкой `-p <port>`; и сообщать, какой агент определён и включён ли агентский режим.

#### Scenario: Порт занят чужим процессом
- **WHEN** на порту 3000 слушает не c4builder и выполняется `c4builder doctor runtime`
- **THEN** проверка порта — `warn` с подсказкой `-p <port>`

#### Scenario: Запущен site -w
- **WHEN** на порту 3000 работает `c4builder site -w` и выполняется `c4builder doctor runtime`
- **THEN** проверка порта — `ok` «site -w is running» с адресом

### Requirement: Вывод диагностики безопасен для публикации
Без флага `-v` вывод (текст и JSON) MUST заменять домашний каталог на `~`, показывать пути внутри проекта относительными и MUST NOT содержать значения переменных окружения — только факт, что переменная задана. С `-v` SHALL выводиться абсолютные пути и подробности.

#### Scenario: Вывод для issue
- **WHEN** заданы `HTTPS_PROXY=http://proxy.local:8080` и `NODE_EXTRA_CA_CERTS`, выполняется `c4builder doctor --offline`
- **THEN** вывод не содержит абсолютного пути домашнего каталога и значений этих переменных (`proxy.local`, путь к сертификату), а проверка прокси сообщает только, что они заданы
