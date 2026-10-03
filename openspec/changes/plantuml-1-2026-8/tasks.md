# Tasks

## 1. Обновление JAR

- [x] 1.1 Скачать `plantuml-1.2026.8.jar` из релиза `v1.2026.8`, сверить sha256 `5e1ecfa8…c462`, положить в `vendor/` вместо `plantuml-1.2025.2.jar`; в `vendor/` ровно один PlantUML-JAR
- [x] 1.2 Проверить совместимость с JRE ≥ 17 (минимум резолвера): `Build-Jdk-Spec: 21`, но ядро PlantUML собрано под Java 11 и работает на JRE 17; байткод Java 21 только у ELK (`!pragma layout elk`) и openpdf, а c4builder рендерит через Smetana. `MAJOR_MIN` не меняем
- [x] 1.3 `VENDORED_JAR` в `src/util/utils.ts` → `1.2026.8`; `grep -rn 1.2025.2 src test` пуст; `npm run build` и `npm run check` зелёные

## 2. Регрессия рендера

- [x] 2.1 `npm run test:unit` зелёный
- [x] 2.2 `UPDATE_GOLDEN=1 npm run test:golden`, затем просмотр диффа эталонов: наконечники связей C4 залиты, кириллица и ditaa на месте, нет пустых или битых SVG; повторный `npm run test:golden` без UPDATE зелёный
- [x] 2.3 Строка в README changelog `## Unreleased`: PlantUML обновлён до 1.2026.8 (залитые наконечники `>>` в Smetana, closes #14)

## 3. Релиз

- [ ] 3.1 PR в `master`, CI зелёный (включая golden на пиновом runner), merge закрывает #14
- [ ] 3.2 `npm version prerelease` → `v0.4.0-rc.4`, push тега; npm dist-tag `rc` = 0.4.0-rc.4
- [ ] 3.3 Прогон rc.4 на `arch` (`c4builder --site`): диаграммы рендерятся, стрелки залиты; закрывает задачу 6.4 `plugin-system`
- [ ] 3.4 Финальный релиз: `## Unreleased` → `## v0.4.0`, `npm version 0.4.0`, push тега; npm `latest` = 0.4.0
