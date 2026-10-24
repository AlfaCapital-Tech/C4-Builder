# Spec Delta

## ADDED Requirements

### Requirement: Адрес страницы change'а в команде feedback
`c4builder feedback --as <name>` (с `--wait` и без) SHALL перед ожиданием пачки спросить у
dev-сервера, есть ли на сайте страница с коротким адресом `change/<name>`, и при наличии
печатать в stderr одну строку на английском с полным адресом `http://localhost:<port>/#/change/<name>`.
Строка MUST NOT попадать в stdout (там — только пачка). Нет такой страницы — строка не
печатается, поведение прежнее.

#### Scenario: Имя слушателя — id change'а
- **WHEN** на сайте есть change `add-dark-mode` и выполняется `c4builder feedback --wait --as add-dark-mode`
- **THEN** в stderr сразу печатается строка с `http://localhost:<port>/#/change/add-dark-mode`, stdout пуст до прихода пачки

#### Scenario: Имя слушателя — не change
- **WHEN** выполняется `c4builder feedback --wait --as review-2`, а change'а `review-2` нет
- **THEN** строка с адресом не печатается, команда ждёт пачку как раньше
