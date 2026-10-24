# Proposal

## Why

Sidebar docsify-сайта — полный вложенный список всего дерева проекта, свернуть раздел нельзя:
docsify из коробки этого не умеет, а плагин сворачивания c4builder не вендорит. На проекте в
сотню папок навигация превращается в простыню, и команды решают это своим `docsifyTemplate` с
копией старого встроенного шаблона — такая копия не получает правок шаблона c4builder.

## What Changes

- Сайт по умолчанию сворачивает sidebar: открыт только путь к текущей странице и первый уровень
  разделов; клик по разделу раскрывает/сворачивает его. Реализация — вендорный
  `docsify-sidebar-collapse` (MIT; JS + CSS со стрелками), без внешних ресурсов.
- Новый ключ `.c4builder` `sidebarCollapse` (по умолчанию `true`); `false` возвращает прежний
  полностью развёрнутый sidebar.
- Скрипт и стиль плагина подключаются пост-обработкой `index.html`, как ассеты плагинов, —
  поэтому работают и с пользовательским `docsifyTemplate`, если тот выводит опции docsify в
  `window.$docsify`. Шаблон, подключавший плагин вручную, становится не нужен.
- Golden-эталоны пересъёмаются (новые вендорные файлы и строки в `index.html`); документация
  ключа, skills, CHANGELOG, `docs/*/.c4builder`.

## Capabilities

### New Capabilities
- `site-navigation`: поведение sidebar собранного сайта — сворачивание разделов, уровень
  раскрытия по умолчанию, ключ отключения, работа с пользовательским шаблоном.

### Modified Capabilities
- `offline-site`: требование «Сайт по умолчанию не обращается к внешним доменам» — сценарий,
  что ассеты сворачивания sidebar локальны (вендорены и скопированы в выход).

## Impact

- Код: `vendor/docsify/docsify-sidebar-collapse.min.js`, `vendor/docsify/sidebar-collapse.css`
  (+ LICENSE-заметка), `src/config/{schema,defaults,options}.ts` (ключ), `src/core/compose/
  markdown.ts` и `docsify.template.ts` (`sidebarDisplayLevel` в опциях), `src/core/plugins/
  assets.ts` (инъекция ассетов сайта, не только плагинов).
- Тесты: `offline-site` (новый CSS без внешних ссылок), `config`, новый кейс сборки с
  `sidebarCollapse: false`, golden — пересъёмка.
- Документация: `docs/{ru,en}/src` (05 CLI и конфигурация — таблица ключей; 04 Выводы — сайт),
  `skills/c4builder/references/config.md`, `docs/ru/.c4builder`, `docs/en/.c4builder`,
  `template/.c4builder`, `CHANGELOG.md`.
