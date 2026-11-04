# Spec Delta

## ADDED Requirements

### Requirement: Занятый порт — ошибка с подсказкой свободного порта
Если порт сервера (`-p` или `webPort`) занят, `c4builder site` и `--site [-w]` MUST завершаться с
кодом 1, не печатая `serving your docsify site` и `go to`, и MUST NOT переходить на другой порт:
`feedback`, `--open-change` и скиллы берут порт из `-p`/`webPort`. Сообщение SHALL называть
свободный порт из нескольких следующих: `port <p> is already in use — pass a different one, e.g.
-p <free>`; свободного нет — прежнее `… pass a different one with -p <port>`.

#### Scenario: Следующий порт свободен
- **WHEN** порт 3000 занят, 3001 свободен, и запущен `c4builder --site -w`
- **THEN** вывод содержит `port 3000 is already in use — pass a different one, e.g. -p 3001`, процесс завершается с кодом 1, сервер на 3001 не поднят

#### Scenario: Несколько следующих портов заняты
- **WHEN** заняты порты 3000 и 3001, 3002 свободен
- **THEN** подсказка — `e.g. -p 3002`

#### Scenario: Свободного среди следующих нет
- **WHEN** заняты порт сервера и все проверяемые следующие порты
- **THEN** вывод содержит `port <p> is already in use — pass a different one with -p <port>`, код выхода 1
