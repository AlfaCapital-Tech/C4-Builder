# Tasks

## 1. Конфиг и легаси-детект

- [x] 1.1 Удалить `plantumlServerUrl` и `generateLocalImages` из `defaultConfig` и из схемы (нестрогая схема их отбрасывает, D1) — `npm run build` проходит, `new -y` пишет конфиг без обоих ключей
- [x] 1.2 В `dispatch.ts` убрать `GENERATE_LOCAL_IMAGES`/`PLANTUML_SERVER_URL` из `BuildOptions`; предупреждение — в `configWarnings(raw)` (`raw.generateLocalImages === false`, имена обоих ключей), печатается при старте до сборки, один раз за процесс, конфиг не мутируется (D1) — тест: `false` → предупреждение до сборки и код 0, `.c4builder` побайтно не изменён; юнит `configWarnings`: `true`, одиночный URL и отсутствие ключей → без предупреждения
- [x] 1.3 Мастер: убрать вопрос `plantumlServerUrl`, чекбокс `generateLocalImages` и оба ключа из `WIZARD_KEYS`; `--list`: убрать две строки (D4) — тест: `doctor` на конфиге без этих ключей даёт `project.complete: ok`, сборка без TTY не запускает мастер

## 2. Удаление онлайн-рендера

- [x] 2.1 Удалить `remoteRender` из `DIAGRAM_ENGINES` и `engineSupportsRemote`; в `build.ts` удалить проверку «no online render server» и схлопнуть ветки `GENERATE_LOCAL_IMAGES` (рендер, восстановление бэкапа); в `scan/tree.ts` и `plugins/tree.ts` — условие создания каталогов выхода — `npm run build` и `npm run check` проходят
- [x] 2.2 В `compose/markdown.ts` удалить ветку `isRemoteUrl` и условие `GENERATE_LOCAL_IMAGES` у `imgContent`; в `util/utils.ts` удалить `plantUmlServerUrl` и кодировщик (`urlTextFrom` и помощники, если больше нигде не используются) — `grep -rn "plantuml.com\|plantUmlServerUrl" src` пуст
- [x] 2.3 Перевести `compose-h1` и `compose-adjacent-embeds` на локальный режим с заранее записанным фиктивным SVG (D5) — тесты зелёные, проверки alt/порядка/ссылок сохранены
- [x] 2.4 Перевести `llms`, `cli-site`, `plugins-tree` на конфиг без онлайн-режима: убрать `.puml` из фикстур, где диаграмма не предмет теста, иначе полагаться на JRE — `npm run test:unit` зелёный
- [x] 2.5 Тест сценария «Старый конфиг»: проект с `.puml` и `.d2` на конфиге golden-фикстуры, `generateLocalImages: false` + `plantumlServerUrl` → код 0, обе диаграммы локальные, в выходах нет `plantuml.com`, предупреждение называет оба ключа (одна сборка CLI, D5) — тест зелёный

## 3. Клиентский рендер PlantUML

- [x] 3.1 Удалить `vendor/docsify/docsify-plantuml.min.js` и его запись в `vendor/docsify/LICENSES.md` (D3) — в выходе шаблонного проекта нет файла `docsify-plantuml.min.js`
- [x] 3.2 При заданном `docsifyTemplate` после вызова шаблона искать в готовом `index.html` тег `<script …docsify-plantuml…>`, признак вернуть из `generateWebMD`, `WARNING:` печатать в `build.ts` (D2), опцию `plantuml` в шаблон оставить — тест в `page-fences`: пользовательский шаблон с тегом → предупреждение, код 0, файла в выходе нет, опции содержат `nativeEmoji: true`; встроенный шаблон с `docsify-plantuml` в имени проекта → без предупреждения
- [x] 3.3 Обновить комментарии, ссылающиеся на `docsify-plantuml` как на поставляемый файл (`scan/fences.ts`, `scan/tree.ts`, `render/diagrams.ts`, `test/offline-site.test.mjs`) — `npm test` зелёный, `npm run test:golden` без изменений эталонов

## 4. Актуализация

- [x] 4.1 Сайт ru/en: удалить раздел «Онлайн-сервер PlantUML» на страницах «Диаграммы», строки `generateLocalImages`/`plantumlServerUrl` из таблиц конфига на «CLI и конфигурация», переписать абзац о внешних адресах на «Выводы» (без онлайн-режима и с предупреждением о `docsify-plantuml`) — тест `docs-parity` зелёный, `grep -rn "plantumlServerUrl\|generateLocalImages" docs/ru/src docs/en/src` пуст
- [x] 4.2 Удалить оба ключа из `docs/ru/.c4builder` и `docs/en/.c4builder` — сайт документации собирается без предупреждения о ключах
- [x] 4.3 `skills/c4builder`: `SKILL.md` и `references/` (`config.md`, `diagrams.md`, `bpmn.md`, `mermaid.md`, `wireflow.md`) — убрать ключи из таблиц и примера конфига и упоминания онлайн-рендера; в `config.md` ключи названы только как удалённые (предупреждает лишь `generateLocalImages: false`); проверить `template/AGENTS.md` — тест `skills` зелёный
- [x] 4.4 CHANGELOG `## Unreleased`: **BREAKING (config)** — онлайн-рендер удалён, `generateLocalImages: false` даёт предупреждение и локальную сборку (нужна Java или Docker-образ), ключи можно удалить, синтаксически битый `.puml` теперь роняет сборку (совет — `c4builder check` до обновления); `docsify-plantuml.min.js` больше не поставляется — запись присутствует
- [x] 4.5 Delta-спека `regression-testing`: из контракта варианта `default` убран `generateLocalImages=true`; ключи удалены из `test/fixtures/*.c4builder.json`, из описания потребителя arch в `openspec/config.yaml` — `openspec validate remove-remote-plantuml --strict` проходит
- [x] 4.6 Итоговая проверка: `npm run build && npm run check && npm test` зелёные

## Workflow follow-up

- В описании PR закрыть issue #33 и отметить, что пункт про код выхода мастера без терминала исправлен ранее.
- Архивировать change после ревью и мержа.
