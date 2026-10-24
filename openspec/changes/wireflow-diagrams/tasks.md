# Tasks

## 1. Каталог шаблонов и реестр по суффиксу

- [x] 1.1 `scripts/update-wireflow-catalog.mjs <sha>` по design.md (решение 4): `vendor/wireflow/` с `graphics/`, `graphics.json`, `graphic-sizes.json`, `LICENSE`, `VERSION`; прогнать на текущем SHA `main` vanila-io/wireflow. Проверка: 125 SVG на месте, `VERSION` содержит SHA, `npm pack --dry-run` включает `vendor/wireflow/`.
- [x] 1.2 Реестр по суффиксу (решение 1): `engineForFile`, `diagramBaseName`, запись `.wireflow.json` + имя `wireflow.json`; перевод всех мест поиска (скан, фильтр прочих файлов, коллизии, `plugins/tree.ts`, путь выхода в `diagrams.ts` и `markdown.ts`, `FENCE_LANG`, `CHECKERS`). Пока без рендера: ветка движка бросает «not implemented». Проверка: юнит-тесты `engineForFile`/`diagramBaseName` (`x.wireflow.json`, `X.WIREFLOW.JSON`, `wireflow.json`, `data.json`, `a.puml`); `data.json` копируется как прочий файл; существующие unit- и golden-тесты зелёные без пересъёмки.

## 2. Рендер

- [x] 2.1 `src/core/render/wireflowrenderer.ts`: parse и валидация (решение 7), `WireflowError`; экспорт в `test/dist.mjs`. Проверка: `test/wireflow.test.mjs` — версии 2–4 принимаются; v1, без `format`, v5, не-JSON, ребро на несуществующий узел, `parentId` на несуществующую группу, цикл групп, дубль `id` дают ошибку с id элемента; неизвестный `graphicId` — предупреждение.
- [x] 2.2 Раскладка: абсолютные координаты по `parentId`, размеры карточек по `graphic-sizes.json` (220/124, заголовок 24px), подгонка групп (36/16/16/16, вложенность). Проверка: юнит-тесты на геометрию примера из README редактора и вложенной группы.
- [x] 2.3 SVG: карточки (символы шаблонов в `<defs>` с префиксованными id, заголовок с обрезкой), заметки с переносом, группы, `own-image`, заглушка неизвестного шаблона; цвета и размеры из `editor.css`. Проверка: тесты на наличие элементов и текста (кириллица), отсутствие внешних URL в SVG, уникальность id при двух карточках одного шаблона; визуальная сверка с экспортом редактора на 2–3 файлах (ручная, итог — в заметке к задаче).
  - Заметка: сверки с экспортом редактора не было (нет браузера и сети). Вместо неё SVG шаблона и страницы `03 Диаграммы` растеризованы resvg в PNG и просмотрены: группа, карточки, заметка, три вида рёбер, подписи и кириллица на месте. При этом найден и исправлен дефект: 12 Inkscape-шаблонов несли `<metadata>`/`sodipodi:`/`inkscape:` без объявлений пространств имён — SVG диаграммы с ними был невалидным XML (resvg падал); теперь вырезаются при вставке в `<symbol>`, тест рендерит все 125 шаблонов в одной диаграмме и растеризует.
- [x] 2.4 Рёбра: перенос `getBezierPath`/`getSmoothStepPath` из `@xyflow/system` с атрибуцией MIT, `step`/`smoothstep`/кривая, маркеры по цвету, подпись на плашке. Проверка: юнит-тесты путей на эталонных координатах (значения — из `@xyflow/system` той же версии), маркер один на цвет.
- [x] 2.5 Интеграция в `diagrams.ts`: ветка, `runPool(…, 1)`, `renderKey` с `VERSION` каталога; PNG через `rasterizeSvgToPng`; проверка WebP в resvg (решение 6). Проверка: сборка проекта с `.wireflow.json` даёт `checkout.svg` и `checkout.png` (`diagramFormat: png`); правка `VERSION` перерисовывает только wireflow (тест кэша); битый файл дерева — exit 1 с именем файла; двойной рендер байт-в-байт одинаков.
  - Заметка: «правка `VERSION` перерисовывает только wireflow» проверена на уровне ключа кэша (`renderKey` несёт `VERSION` каталога, формат и шрифт), отдельного сборочного теста кэша нет.

## 3. check и llms

- [x] 3.1 `c4builder check` для `.wireflow.json`/`wireflow.json`: `CHECKERS`, usage и сообщение о неподдерживаемом расширении. Проверка: `test/check.test.mjs` — валидный файл (0), ошибка структуры (`✗ … `, 1), только предупреждение (`⚠ …`, 0); `cli-language` зелёный.
- [x] 3.2 `llms-full.txt`: блок `json`, замена `data:`-строк на `"<embedded image>"`; строка-перечисление движков в `llms.txt` (`markdown.ts`). Проверка: `test/llms.test.mjs` — сценарий «Wireflow-диаграмма исходником» из спеки `output-formats`.

## 4. Шаблон и golden

- [x] 4.1 `template/src/7 Wireflow Example/` (решение 10): `checkout.wireflow.json` и страница-пояснение. Проверка: `c4builder check` на файле — 0; `c4builder --new --name demo -y` и сборка показывают картинку.
- [x] 4.2 Golden: проверки содержимого wireflow в `test/golden.test.mjs` (группа, карточки, кириллица), пересъёмка `UPDATE_GOLDEN=1`. Проверка: diff эталонов затрагивает только новый раздел, навигацию и complete-документы; повторный прогон без `UPDATE_GOLDEN` зелёный.

## 5. Актуализация

- [x] 5.1 Страница `03 Диаграммы` RU и EN: раздел Wireflow с живым `.wireflow.json` (экспорт редактора, имена файлов, поддерживаемые версии, заглушки, старые форматы); `docs-parity` `PAGE_FILE` += `.wireflow.json`, `.mmd`. Проверка: `cd docs/ru && node ../../dist/index.js --site` и то же для `docs/en` собираются, диаграмма видна картинкой; `docs-parity` зелёный.
- [x] 5.2 Обзорные страницы RU и EN: корневой `README.md` сайта (движки), `05 CLI и конфигурация` (таблица `check`), `07 Docker и CI` (пример `find … -exec c4builder check`), `08 Агенты`; лендинг `docs/landing/{index,en}.html`; pitch в `README.MD`. Проверка: `grep -L -i wireflow` по этим файлам пуст; `docs-parity` зелёный.
- [x] 5.3 Агенты: `skills/c4builder/references/wireflow.md` (новый: источник, `check`, ограничения), ссылки из `references/diagrams.md` и `SKILL.md` (описание, цикл `check`, коллизии имён); `template/AGENTS.md` (источники, `check`). Проверка: тест `skills` зелёный.
- [x] 5.4 `CHANGELOG.md`, `## Unreleased`: строка о wireflow-диаграммах. Проверка: строка есть.

## 6. Интеграция

- [x] 6.1 `npm run build && npm test && npm run check` зелёные; `openspec validate wireflow-diagrams --strict` проходит; `npm pack --dry-run` — размер пакета вырос не больше чем на ~2 МБ.
  - Заметка: `npm test` — один красный тест вне change: `plugins-source` (архив tar.gz) на macOS падает из-за AppleDouble-записей bsdtar, с `COPYFILE_DISABLE=1` зелёный. Линт — `npx biome ci src test` (полный `npm run check` из worktree цепляет чужие `biome.json`). `npm pack --dry-run`: 29,3 → 29,6 МБ (распаковано 32,7 → 34,0 МБ).
- [x] 6.2 Watch-режим: `site -w` на шаблоне — правка `checkout.wireflow.json` перерисовывает только его. Проверка: ручной прогон.
  - Заметка: прогон без браузера — `c4builder site -w` на проекте из `--new`, правка `checkout.wireflow.json`: пересборка за 0,02 с, новый текст в `checkout.svg`; остальные диаграммы взяты из кэша (их рендер занял бы секунды). Livereload в браузере не проверялся.
- [x] 6.3 Публичность: `grep -rniE --exclude=tasks.md "alfacapital\.ru|artifactory|harbor" openspec/changes/wireflow-diagrams docs/ru/src docs/en/src skills template CHANGELOG.md` — пусто. Проверка: вывод команды пуст.
