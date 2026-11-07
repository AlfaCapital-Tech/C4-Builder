# Spec Delta

## MODIFIED Requirements

### Requirement: Уведомление в терминале
Если обновление доступно, CLI SHALL при завершении процесса печатать в stderr одну строку `c4builder <new> is available (current <current>). Run: c4builder update`. Строка MUST печататься независимо от того, подключён ли терминал (TTY), чтобы её видел агент, запустивший CLI. Уведомление MUST NOT менять stdout и код возврата команды. Команды `c4builder update`, `--version` и любая форма справки (`--help`, `-h`, `<command> --help`, `help [command]`) уведомление не печатают.

#### Scenario: Агент запускает проверку диаграммы
- **WHEN** в кэше известна версия `0.6.0`, текущая `0.5.1`, агент выполняет `c4builder check ok.puml` без TTY
- **THEN** stdout и код возврата те же, что без уведомления, последняя строка stderr — `c4builder 0.6.0 is available (current 0.5.1). Run: c4builder update`

#### Scenario: Версия актуальна
- **WHEN** в кэше нет версии новее текущей
- **THEN** строка уведомления не печатается

#### Scenario: Справка команды без уведомления
- **WHEN** в кэше известна версия новее текущей и выполняется `c4builder check --help` или `c4builder help check`
- **THEN** печатается только справка, строки уведомления в stderr нет
