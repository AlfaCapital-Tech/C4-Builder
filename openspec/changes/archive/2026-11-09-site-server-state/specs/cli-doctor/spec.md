## MODIFIED Requirements

### Requirement: Проект и запуск
Группа `project` SHALL проверять, что `.c4builder` найден, проходит валидацию и полон для сборки без мастера, а каталоги исходников и пути плагинов существуют. Группа `runtime` SHALL проверять порт сервера (`-p`, иначе из действительного файла состояния сервера, иначе `webPort`) на `127.0.0.1`: соединение отклонено — `ok` «free»; сервер этого проекта (`/__c4builder/status` с тем же `project`) — `ok` «site -w is running» с адресом; c4builder другого проекта или чужой процесс — `warn` с подсказкой `-p <port>`; и сообщать, какой агент определён и включён ли агентский режим.

#### Scenario: Порт занят чужим процессом
- **WHEN** на порту 3000 слушает не c4builder и выполняется `c4builder doctor runtime`
- **THEN** проверка порта — `warn` с подсказкой `-p <port>`

#### Scenario: Запущен site -w
- **WHEN** на порту 3000 работает `c4builder site -w` и выполняется `c4builder doctor runtime`
- **THEN** проверка порта — `ok` «site -w is running» с адресом

#### Scenario: Сервер запущен на другом порту
- **WHEN** сервер проекта запущен с `-p 3001` при `webPort` 3000, и выполняется `c4builder doctor runtime`
- **THEN** проверка порта — `ok` «site -w is running» с адресом `http://localhost:3001`

#### Scenario: Порт занят сервером другого проекта
- **WHEN** на `webPort` работает `c4builder site -w` соседнего worktree, своего сервера нет, и выполняется `c4builder doctor runtime`
- **THEN** проверка порта — `warn` «port <p> is used by the c4builder site of another project» с подсказкой `-p <port>`
