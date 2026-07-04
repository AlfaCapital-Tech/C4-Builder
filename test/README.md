# Тесты c4builder

## Golden-тест

`golden.test.mjs` фиксирует текущее поведение сборки как контракт:

1. Копирует демо-шаблон `template/src` во временную директорию (`test/.tmp/fixture-*`)
   и кладёт готовый конфиг [`fixture.c4builder.json`](fixture.c4builder.json) —
   неинтерактивный эквивалент `c4builder new` (svg, локальный рендер,
   PlantUML пинован на вендорный 1.2025.2, выходы site/md/complete-md, без PDF).
2. Запускает реальный CLI (`node index.js`) с `cwd` во временной директории.
3. Сравнивает полное дерево `docs/` с эталоном `test/golden/` после нормализации:
   из SVG вырезаются XML-комментарии (метаданные PlantUML), переводы строк — LF.
4. Отдельные кейсы: SVG для stdlib- и `.iuml`-диаграмм, сохранность кириллицы,
   идемпотентность повторной сборки с тёплым кэшем `.c4builder.cache`.

Правка `template/src` или логики сборки — это осознанное изменение контракта:
регенерируйте эталон в том же PR, дифф `test/golden/` покажет эффект правки.

## Устройство эталона

- `golden/manifest.json` — полный список файлов выхода + sha256 нормализованного
  содержимого каждого (включая копии `vendor/` и бинарные файлы).
- `golden/tree/` — полные нормализованные копии текстовых файлов (md/svg/html…)
  для внятного диффа; vendor-копии docsify и бинарники в tree не хранятся.

## Команды

```bash
npm test                    # весь набор
npm run test:golden         # только golden-тест
npm run test:golden:update  # перегенерировать эталон (UPDATE_GOLDEN=1)
```

## CI — источник истины для эталона

Layout диаграмм зависит от версий graphviz/шрифтов, поэтому эталон, сгенерированный
локально, может расходиться с CI (`ubuntu-24.04`). Каноничным считается выход CI.

Если golden-тест упал в CI из-за различий окружения:

1. Скачайте артефакт `golden-actual-node22` упавшего прогона
   (нормализованный фактический выход, упакован в tar — tar сохраняет
   пустые файлы вроде `.nojekyll`, которые upload-artifact дропает):
   ```bash
   gh run download <run-id> -n golden-actual-node22 -D /tmp/dl
   tar -xzf /tmp/dl/golden-actual.tar.gz -C /tmp
   ```
2. Регенерируйте эталон из него и закоммитьте:
   ```bash
   node test/golden-from-dir.mjs /tmp/actual
   git add test/golden && git commit
   ```

После этого локальный запуск `npm test` на машине с другим graphviz может падать —
это ожидаемо; проверяйте по CI или через docker-образ проекта.
