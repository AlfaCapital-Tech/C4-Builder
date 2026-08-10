# Tasks: golden-test-ci

## 1. Инфраструктура тестов

- [x] 1.1 Добавить vitest в devDependencies, завести `vitest.config` и npm-скрипты `test`, `test:golden`, `test:golden:update` в package.json
- [x] 1.2 Обновить `.gitignore`/`.npmignore`: временные выходы тестов не попадают в git и в пакет, `test/golden/` — попадает в git

## 2. Fixture из шаблона

- [x] 2.1 Убедиться, что `template-offline` применён: `template/src` собирается офлайн (нет URL-инклюдов), содержит `.iuml` и кириллицу
- [x] 2.2 Подготовить эталонный конфиг `.c4builder` для тестов: `diagramFormat=svg`, `generateLocalImages=true`, `PLANTUML_VERSION` пинован на вендорный 1.2025.2, включены выходы site/md/complete-md, PDF выключен

## 3. Golden-тест

- [x] 3.1 Реализовать хелперы: копирование `template/src` в tmp + подкладывание `.c4builder` (неинтерактивный эквивалент `new`), запуск `node index.js` с `cwd=tmp`, рекурсивный сбор дерева файлов, нормализация (SVG-комментарии, LF)
- [x] 3.2 Реализовать сравнение с эталоном (список файлов + нормализованное содержимое, внятный дифф) и режим `UPDATE_GOLDEN=1`
- [x] 3.3 Тест-кейс: сборка fixture совпадает с эталоном; проверка наличия SVG для stdlib- и .iuml-диаграмм и сохранности кириллицы
- [x] 3.4 Тест-кейс: повторная сборка с тёплым кэшем (`.c4builder.cache`) идентична первой
- [x] 3.5 Сгенерировать и закоммитить эталон `test/golden/`, убедиться в детерминизме двух подряд чистых прогонов

## 4. GitHub Actions

- [x] 4.1 Создать `.github/workflows/ci.yml`: `pull_request` + `push` в master, runner `ubuntu-24.04`, матрица Node 22/24, setup-java Temurin 21, установка graphviz, `npm ci --ignore-scripts`, `npm test`, concurrency с cancel-in-progress
- [x] 4.2 Прогнать workflow на ветке (push/PR), при расхождении эталона из-за окружения CI — регенерировать эталон по артефакту CI и зафиксировать процедуру в test/README
