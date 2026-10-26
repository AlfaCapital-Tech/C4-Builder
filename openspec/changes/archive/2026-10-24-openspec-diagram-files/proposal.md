# Proposal

## Why

В артефактах OpenSpec диаграммы рендерятся только из fenced-блоков. Диаграмма отдельным файлом рядом
с артефактом (`flow.wireflow.json` — экспорт редактора, `context.puml`, `process.bpmn`) с картинкой-
ссылкой `![](flow.wireflow.json)` попадает на сайт исходником: в выход копируется файл, на странице —
битая картинка. На страницах проекта та же ссылка работает.

## What Changes

- Картинка-ссылка в артефакте на файл диаграммы (расширения движков: `.puml`, `.d2`, `.bpmn`, `.mmd`,
  `.wireflow.json`) становится диаграммой страницы: рендер локальным движком в `diagramFormat`,
  картинка на месте ссылки, исходник в выход не копируется. Битый файл — заглушка и предупреждение,
  как у fenced-блоков; сборка проходит.
- Файл диаграммы — источник страницы (комментарии `site -w`, пересборка в watch).

## Capabilities

### New Capabilities
—

### Modified Capabilities
- `openspec-plugin`: ADDED «Файлы диаграмм в артефактах».

## Impact

- Код: `src/plugins/openspec/render.ts`. Тесты: `test/plugin-openspec.test.mjs`.
- Документация: «06 Плагины» RU/EN, `skills/c4builder/references/plugins.md`, `CHANGELOG.md`.
