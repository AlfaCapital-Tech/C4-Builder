# Spec Delta

## ADDED Requirements

### Requirement: Golden-тест покрывает wireflow-рендер
Golden-fixture SHALL включать файл `.wireflow.json` с группой, карточками (с заголовком и без),
заметкой и рёбрами всех трёх видов с подписями; подписи кириллические. Golden-тест MUST
сравнивать SVG-выход (вариант `default`) и PNG-выход (вариант `embed-png`) этой диаграммы с
эталонами наравне с остальными движками.

#### Scenario: Wireflow в fixture совпадает с эталоном
- **WHEN** golden-тест собирает fixture, содержащий `.wireflow.json`
- **THEN** его SVG (после нормализации) и PNG совпадают с закоммиченными эталонами

#### Scenario: Повторный прогон wireflow идентичен
- **WHEN** сборка fixture с wireflow выполняется дважды
- **THEN** SVG-выходы wireflow-диаграммы байт-в-байт совпадают между прогонами
