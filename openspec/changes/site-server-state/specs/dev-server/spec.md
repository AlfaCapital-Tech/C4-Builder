## ADDED Requirements

### Requirement: Файл состояния сервера
`c4builder site` и `--site [-w]` SHALL после успешного запуска сервера записывать рядом с конфигом
файл состояния `<конфиг>.server.json` (по умолчанию `.c4builder.server.json`) с полями `port`,
`url`, `pid`, `version`, `watch`, `startedAt`, и MUST удалять его при завершении — по Ctrl+C,
`SIGTERM` или обычному выходу. Читатели MUST считать файл недействительным, если сервер на его порту
не отвечает тем же `pid`. Пересборки в watch MUST NOT реагировать на этот файл.

#### Scenario: Сервер запущен
- **WHEN** выполняется `c4builder --site -w -p 3001` и в выводе появилось `serving your docsify site`
- **THEN** в каталоге проекта есть `.c4builder.server.json` с `"port": 3001`, `"url": "http://localhost:3001"`, `pid` процесса сервера и `"watch": true`

#### Scenario: Сервер остановлен
- **WHEN** работающий `c4builder --site -w` получает `SIGINT` или `SIGTERM`
- **THEN** процесс завершается, `.c4builder.server.json` удалён

#### Scenario: Сервер убит без завершения
- **WHEN** процесс сервера убит `SIGKILL`, файл состояния остался
- **THEN** `c4builder status` сообщает, что сервер не запущен, а следующий `c4builder --site -w` запускается и перезаписывает файл

#### Scenario: Занятый порт
- **WHEN** `c4builder --site -w` завершается с ошибкой занятого порта
- **THEN** файл состояния не создаётся, а файл уже работающего сервера этого проекта не меняется

### Requirement: Один сервер на конфиг проекта
Если для того же конфига уже работает сервер (действительный файл состояния), `c4builder site` и
`--site [-w]` MUST NOT собирать сайт и поднимать второй сервер: сообщение на английском с адресом и
pid работающего, код 1. С `--open` или `--open-change <id>` команда SHALL вместо этого открыть
соответствующий адрес работающего сервера в браузере (кроме `BROWSER=none`) и завершиться с кодом 0.

#### Scenario: Повторный запуск
- **WHEN** в проекте работает `c4builder --site -w` на порту 3001, и выполняется `c4builder --site -w`
- **THEN** вывод содержит `c4builder site is already running for this project at http://localhost:3001` и pid, сборка не запускается, код выхода 1, первый сервер продолжает работать

#### Scenario: Открыть change на работающем сервере
- **WHEN** в проекте работает `c4builder --site -w` на порту 3001, и выполняется `c4builder site --open-change add-dark-mode`
- **THEN** в браузере открывается `http://localhost:3001/#/change/add-dark-mode`, второй сервер не поднимается, код выхода 0

#### Scenario: Другой конфиг
- **WHEN** работает сервер с конфигом `.c4builder`, и выполняется `c4builder --site -w -c other.c4builder -p 3002`
- **THEN** второй сервер поднимается и пишет `other.c4builder.server.json`

### Requirement: Эндпоинт состояния сервера
Сервер (с `-w` и без) SHALL отвечать на `GET /__c4builder/status` JSON с полями `pid`, `port`,
`version`, `watch`, `agent` (`on`, `name`), `listeners` (`name`, `state` — `listening` или
`reconnecting`, `queued`) и `unaddressed` (пачки без адресата); без `-w` списки пусты. Запрос MUST
приниматься только как запрос команды CLI (как у `c4builder feedback`), иначе 403.

#### Scenario: Запрос команды
- **WHEN** `site -w` работает, слушатель `foo` ждёт пачку, и команда CLI запрашивает `/__c4builder/status`
- **THEN** ответ 200 с `pid` сервера и `listeners`, где есть `{"name": "foo", "state": "listening", "queued": 0}`

#### Scenario: Запрос страницы
- **WHEN** страница в браузере запрашивает `/__c4builder/status` с заголовком `Origin`
- **THEN** ответ 403

### Requirement: Команда состояния сервера
`c4builder status` SHALL сообщать, работает ли сервер этого проекта: адрес, pid, версию, watch,
агентский режим, слушателей `feedback` с очередями и число пачек без адресата; код 0 — работает, 1 —
нет. Порт — из `-p`, иначе из действительного файла состояния, иначе из `webPort`. `--json` SHALL
печатать один JSON-объект с полем `running`. Команда MUST NOT создавать файлы и запускать сборку.

#### Scenario: Сервер работает
- **WHEN** в проекте работает `c4builder --site -w -p 3001`, и выполняется `c4builder status`
- **THEN** вывод содержит `http://localhost:3001`, pid сервера и слушателей, код выхода 0

#### Scenario: Сервера нет
- **WHEN** сервер проекта не запущен, и выполняется `c4builder status --json`
- **THEN** вывод — JSON с `"running": false` и проверенным портом, код выхода 1

#### Scenario: Сервер старой версии
- **WHEN** на порту `webPort` работает `site -w` версии без эндпоинта состояния и без файла состояния
- **THEN** `c4builder status` сообщает, что сервер работает по этому адресу, без подробностей, код выхода 0

#### Scenario: Вне проекта
- **WHEN** в пустом каталоге выполняется `c4builder status`
- **THEN** проверяется порт по умолчанию, мастер настройки и сборка не запускаются, каталог остаётся пустым

## MODIFIED Requirements

### Requirement: Занятый порт — ошибка с подсказкой свободного порта
Если порт сервера (`-p` или `webPort`) занят, `c4builder site` и `--site [-w]` MUST завершаться с
кодом 1, не печатая `serving your docsify site` и `go to`, не создавая файла состояния, и MUST NOT
переходить на другой порт: сервер слушает ровно порт из `-p`/`webPort`. Сообщение SHALL называть
порт из нескольких следующих, свободный на `127.0.0.1` и `::1`: `port <p> is already in use —
pass a different one, e.g. -p <free>`; свободного нет — прежнее `… pass a different one with -p
<port>`.

#### Scenario: Следующий порт свободен
- **WHEN** порт 3000 занят, 3001 свободен, и запущен `c4builder --site -w`
- **THEN** вывод содержит `port 3000 is already in use — pass a different one, e.g. -p 3001`, процесс завершается с кодом 1, сервер на 3001 не поднят

#### Scenario: Несколько следующих портов заняты
- **WHEN** заняты порты 3000 и 3001, 3002 свободен
- **THEN** подсказка — `e.g. -p 3002`

#### Scenario: Следующий порт занят только на ::1
- **WHEN** порт 3000 занят, 3001 занят только на `::1`, 3002 свободен
- **THEN** подсказка — `e.g. -p 3002`: печатаемый `localhost` часто резолвится в `::1` и увёл бы на
  чужой сервер; нет IPv6 на машине — `::1` не в счёт

#### Scenario: Свободного среди следующих нет
- **WHEN** заняты порт сервера и все проверяемые следующие порты
- **THEN** вывод содержит `port <p> is already in use — pass a different one with -p <port>`, код выхода 1
