# Proposal

## Why

Пользовательские сценарии (экраны и переходы между ними) рисуют в редакторе Wireflow
(wireflow.co, MIT) и хранят его экспорт `wireflow.json`. На архитектурном сайте их сейчас можно
показать только скриншотом, который расходится с исходником. c4builder уже рендерит при сборке
BPMN и mermaid — wireflow-файлы должны рендериться так же: из файла в репозитории, офлайн,
детерминированно.

## What Changes

- Новый источник диаграмм: файлы `*.wireflow.json` (и `wireflow.json` — имя экспорта редактора)
  в дереве `src/`. Рендер в SVG при сборке (PNG — через существующую растеризацию), выход —
  `<имя>.svg` без суффикса `.wireflow`.
- Рендер без браузера, без сети и без новых npm-зависимостей: SVG строится напрямую из модели
  файла — карточки экранов с шаблонами Wireflow, заметки, группы, рёбра со стрелками и
  подписями в геометрии редактора.
- Каталог шаблонов экранов Wireflow (SVG + метаданные размеров, MIT) вендорится в пакет.
- Поддерживается текущий формат файла (`"format": "wireflow"`, версии 2–4). Старые форматы
  (gg-editor/G6, файлы без `format`) и файлы новее v4 — понятная ошибка; неизвестный шаблон
  экрана — карточка-заглушка с предупреждением.
- `c4builder check` принимает `.wireflow.json`.
- `llms-full.txt`: wireflow-диаграмма — fenced-блок `json` с исходником, встроенные картинки
  (`data:`-URL) заменены пометкой.
- Шаблон `--new` и golden-fixture получают wireflow-пример; документация, skills, CHANGELOG.

## Capabilities

### New Capabilities
- `wireflow-diagrams`: источник `*.wireflow.json`, поддерживаемые версии формата, состав и вид
  рендера, ошибки и предупреждения, детерминизм, проверка `check`, кэш.

### Modified Capabilities
- `diagram-rendering`: требование «Второй бэкенд рендера выбирается по расширению» — движок
  выбирается по суффиксу `.wireflow.json`, имя выхода — без `.wireflow`.
- `output-formats`: требование «Полный текст llms-full.txt с исходниками диаграмм» — язык
  блока `json` для wireflow и замена встроенных картинок.
- `project-template`: шаблон демонстрирует wireflow.
- `regression-testing`: golden-тест покрывает wireflow-рендер.

## Impact

- Код: `src/core/scan/tree.ts` (реестр движков с поиском по суффиксу вместо `extname`),
  `src/core/plugins/tree.ts`, `src/core/render/diagrams.ts` (ветка, очередь, `renderKey`),
  новый `src/core/render/wireflowrenderer.ts`, `src/core/compose/markdown.ts` (llms),
  `src/cli/commands/check.ts`.
- Вендор: `vendor/wireflow/` (~1,5 МБ SVG + JSON + LICENSE) — растёт размер npm-пакета.
- Тесты: новый `test/wireflow.test.mjs`, `check`, `llms`, `docs-parity` (`PAGE_FILE`), golden
  (пересъёмка эталонов).
- Документация: `docs/{ru,en}/src` (Диаграммы, CLI, Агенты, обзор), лендинг, README-pitch,
  `skills/c4builder/*`, `template/AGENTS.md`, `CHANGELOG.md`.
