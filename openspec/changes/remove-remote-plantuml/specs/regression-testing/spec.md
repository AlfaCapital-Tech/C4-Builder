# Spec Delta

## MODIFIED Requirements

### Requirement: Fixture — демо-шаблон проекта
Fixture'ом golden-теста SHALL служить существующий демо-шаблон `template/src` (stdlib-инклюды, локальный `.iuml`, `.d2` с импортом, кириллица). Тест-хелпер MUST копировать шаблон во временную директорию и класть готовый `.c4builder` выбранного варианта из `test/fixtures/<variant>.c4builder.json`. Вариант `default` MUST сохранять текущий контракт: `diagramFormat=svg`, выходы site/md/complete-md, navigation/TOC/breadcrumbs.

#### Scenario: Сборка fixture из шаблона
- **WHEN** golden-тест собирает копию шаблона с конфигом варианта `default`
- **THEN** в выходе присутствуют SVG для stdlib-диаграмм и для диаграмм с `.iuml`-инклюдом, а кириллица сохранена в выходных md и SVG
