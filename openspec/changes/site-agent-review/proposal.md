# Proposal

## Why

Ревью OpenSpec-change через `c4builder --site -w` (issue #32): чтобы дать человеку ссылку на
страницу change'а, агент грепает `_sidebar.md` и восстанавливает схему адреса
`#/OpenSpec/Changes/<группа>/<x-name>/<x-name>`. С кириллицей в `x-name` адрес после кодирования
занимает ~600 символов, терминал режет его при клике, и агент дважды отдаёт нерабочую ссылку.
Два других пункта issue — честный 404 dev-сервера и прогресс вне терминала — уже исправлены в
master (`## Unreleased` CHANGELOG), но ни одно требование их не описывает.

## What Changes

- Короткий постоянный адрес страницы change'а: `#/change/<id>` — только ASCII, не зависит от
  `mount`, `groupKey`, `nameKey` и переживает архивацию (после архива ведёт на страницу в
  архиве). Открытие такого адреса переадресует на настоящий путь страницы, так что относительные
  ссылки, картинки и подсветка sidebar работают как обычно.
- Механизм переадресаций в ядре плагинов: плагин объявляет пары «короткий путь → страница», ядро
  кладёт карту в `index.html` и подключает скрипт переадресации — работает и на опубликованном
  сайте, и с пользовательским `docsifyTemplate`.
- `c4builder feedback --wait --as <id>` печатает в stderr адрес страницы change'а, если `<id>` —
  change текущего сайта; `c4builder --site -w --open <id>` открывает в браузере её, а не главную.
- Схема адреса — в документации плагина `openspec`; скилл `c4builder-review` даёт ссылку по
  схеме вместо поиска по `dist`.
- Спеки для уже реализованного: dev-сервер отвечает 404 на неизвестные пути с `/`; прогресс
  сборки вне терминала — одна строка на фазу. Кода и тестов для них не добавляется.

## Capabilities

### New Capabilities
—

### Modified Capabilities
- `openspec-plugin`: ADDED — короткий адрес `#/change/<id>` для активных, вложенных и
  архивных change'ов.
- `plugin-system`: ADDED — переадресации страниц, объявляемые плагином, и их попадание в сайт.
- `site-agent-feedback`: ADDED — адрес страницы change'а в выводе `feedback --wait --as`.
- `cli-commands`: MODIFIED «Позиционные подкоманды CLI» — `site --open [<id>]`; ADDED —
  dev-сервер не подменяет неизвестные пути главной (уже реализовано, фиксация).
- `build-pipeline`: ADDED — прогресс сборки вне терминала (уже реализовано, фиксация).

## Impact

- Код: `src/core/plugins/types.ts` (`ScanCtx.addRedirect`), `src/core/compose/markdown.ts` и
  `docsify.template.ts` (карта в `$docsify`), `src/core/plugins/assets.ts` (инъекция скрипта),
  новый `vendor/docsify/c4builder-redirects.js`, `src/plugins/openspec/index.ts` (объявление
  адресов), `src/cli/dispatch.ts` и `src/cli/commands/site.ts` (`--open [id]`, эндпоинт адреса
  страницы), `src/cli/commands/feedback.ts` (печать адреса).
- Тесты: `plugin-openspec`, `plugins-load`/`plugins-tree`, `cli-site`, `cli-feedback`,
  `offline-site` (новый скрипт — локальный).
- Документация: `docs/{ru,en}/src` (05 CLI, 06 Плагины, 08 Агенты), `skills/c4builder-review`,
  `skills/c4builder` (+`references/plugins.md`), `template/AGENTS.md`, `CHANGELOG.md`.
