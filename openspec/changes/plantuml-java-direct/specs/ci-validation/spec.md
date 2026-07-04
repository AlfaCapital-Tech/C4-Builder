# ci-validation

## MODIFIED Requirements

### Requirement: Тесты выполняются на каждый PR и push в master
Репозиторий SHALL содержать GitHub Actions workflow (`.github/workflows/ci.yml`),
запускающий полный тестовый набор на события `pull_request` и `push` в `master`.
Workflow MUST выполнять тесты на матрице Node.js 22 и 24, с установленной Java
(Temurin), на пинованном образе раннера (`ubuntu-24.04`). Workflow MUST NOT
устанавливать внешний graphviz — рендер диаграмм выполняется Java-движком Smetana.

#### Scenario: Открыт pull request
- **WHEN** открыт или обновлён PR
- **THEN** workflow устанавливает зависимости (`npm ci`) и запускает тесты на Node 22 и Node 24

#### Scenario: Push в master
- **WHEN** выполнен push в ветку master
- **THEN** workflow запускает тот же тестовый набор

#### Scenario: graphviz не устанавливается
- **WHEN** выполняется job workflow
- **THEN** среди шагов нет установки graphviz, а тесты рендера при этом проходят
