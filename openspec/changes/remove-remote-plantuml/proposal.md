# Proposal

## Why

Исходник диаграммы — это описание архитектуры. В онлайн-режиме (`generateLocalImages: false`) он уходит
закодированным в URL картинки на `plantumlServerUrl`, по умолчанию `www.plantuml.com`, причём запрос
шлёт браузер каждого читателя сайта. Режим не выключить конфигурацией: `null`/`false`/отсутствие
`plantumlServerUrl` подменяются публичным адресом, а мастер переспрашивает пустое значение и по Enter
записывает его в конфиг (issue #33). Исходная причина режима — сборка без Java — ушла: JRE резолвится
и скачивается сам, а D2, BPMN, mermaid и wireflow онлайн-режим и так не поддерживают.

## What Changes

- **BREAKING (config):** онлайн-рендер PlantUML удалён. Диаграммы всегда рендерятся локально; путь
  «картинка — URL сервера с исходником» в compose удалён вместе с кодировщиком URL.
- **BREAKING (config):** ключи `plantumlServerUrl` и `generateLocalImages` удалены из дефолтов, мастера,
  `--list` и шаблона `new -y`. `generateLocalImages: false` в старом `.c4builder` даёт предупреждение
  и обычную локальную сборку (код 0); `true` и `plantumlServerUrl` молча игнорируются. Конфиг не
  мутируется.
- Мастер больше не спрашивает адрес PlantUML-сервера и пункт «Generate diagram images locally»;
  `doctor` перестаёт считать эти ключи недостающими для сборки без мастера.
- Вендорный `docsify-plantuml.min.js` больше не поставляется и не копируется в выход (после рендера
  блоков ```` ```plantuml ```` при сборке плагин бесполезен, а по умолчанию ходит на plantuml.com).
  Пользовательский `docsifyTemplate`, который его подключает, даёт предупреждение; сборка проходит.
- Пункт issue #33 про код выхода мастера без терминала уже исправлен (`ExitPromptError` → код 1) и в
  объём не входит.

## Capabilities

### New Capabilities

_нет_

### Modified Capabilities

- `offline-site`: новое требование — исходники диаграмм никогда не уходят на внешние сервисы рендера
  (включая файлы `.puml`, а не только блоки в тексте страниц), конфиг не может это включить, старые
  ключи дают предупреждение; сценарий совместимости шаблона с `docsify-plantuml` меняется с «файл есть,
  нет 404» на «предупреждение, сборка проходит».
- `output-formats`: из требования к `llms-full.txt` убирается упоминание удалённого `generateLocalImages`.
- `regression-testing`: из контракта варианта `default` golden-теста убирается `generateLocalImages=true` —
  ключа больше нет, рендер всегда локальный; ключ удаляется и из `test/fixtures/*.c4builder.json`.

## Impact

- Код: `src/config/{defaults,schema,options}.ts`, `src/cli/dispatch.ts`, `src/cli/wizard/collect.ts`,
  `src/cli/commands/list.ts`, `src/core/scan/tree.ts` (`remoteRender`, `engineSupportsRemote`),
  `src/core/build.ts`, `src/core/plugins/tree.ts`, `src/core/compose/markdown.ts`, `src/util/utils.ts`.
- Vendor: удаление `vendor/docsify/docsify-plantuml.min.js` и его записи в `LICENSES.md`.
- Тесты: пять тестов (`compose-h1`, `compose-adjacent-embeds`, `llms`, `cli-site`, `plugins-tree`)
  обходили Java онлайн-режимом — переводятся на локальный режим; `page-fences`/`offline-site` —
  на новый сценарий шаблона с `docsify-plantuml`.
- Пользователи: проекты с `generateLocalImages: false` начинают требовать Java (резолвится
  автоматически); главный потребитель (arch, `generateLocalImages: true`) не затронут.
- Доки ru/en, `skills/c4builder` (`SKILL.md`, `references/`), `docs/{ru,en}/.c4builder`, CHANGELOG.
