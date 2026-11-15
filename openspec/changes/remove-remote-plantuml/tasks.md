# Tasks

## 1. Конфиг и легаси-детект

- [x] 1.1 Удалить `plantumlServerUrl` и `generateLocalImages` из `defaultConfig`; в схеме удалить `plantumlServerUrl`, `generateLocalImages` перевести в `optBool()` без дефолта (D1) — `npm run build` проходит, `new -y` пишет конфиг без обоих ключей
- [x] 1.2 В `dispatch.ts` убрать `GENERATE_LOCAL_IMAGES`/`PLANTUML_SERVER_URL` из `BuildOptions`, добавить `LEGACY_LOCAL_IMAGES_OFF` (`generateLocalImages === false`); в `build.ts` — `WARNING:` с именами обоих ключей рядом с PDF-предупреждением, конфиг не мутируется — тест: `false` → предупреждение и код 0, `.c4builder` побайтно не изменён; `true` → без предупреждения
- [x] 1.3 Мастер: убрать вопрос `plantumlServerUrl`, чекбокс `generateLocalImages` и оба ключа из `WIZARD_KEYS`; `--list`: убрать две строки (D4) — тест: `doctor` на конфиге без этих ключей даёт `project.complete: ok`, сборка без TTY не запускает мастер

## 2. Удаление онлайн-рендера

- [x] 2.1 Удалить `remoteRender` из `DIAGRAM_ENGINES` и `engineSupportsRemote`; в `build.ts` удалить проверку «no online render server» и схлопнуть ветки `GENERATE_LOCAL_IMAGES` (рендер, восстановление бэкапа); в `scan/tree.ts` и `plugins/tree.ts` — условие создания каталогов выхода — `npm run build` и `npm run check` проходят
- [x] 2.2 В `compose/markdown.ts` удалить ветку `isRemoteUrl` и условие `GENERATE_LOCAL_IMAGES` у `imgContent`; в `util/utils.ts` удалить `plantUmlServerUrl` и кодировщик (`urlTextFrom` и помощники, если больше нигде не используются) — `grep -rn "plantuml.com\|plantUmlServerUrl" src` пуст
- [x] 2.3 Перевести `compose-h1` и `compose-adjacent-embeds` на локальный режим с заранее записанным фиктивным SVG (D5) — тесты зелёные, проверки alt/порядка/ссылок сохранены
- [x] 2.4 Перевести `llms`, `cli-site`, `plugins-tree` на конфиг без онлайн-режима: убрать `.puml` из фикстур, где диаграмма не предмет теста, иначе полагаться на JRE — `npm run test:unit` зелёный
- [x] 2.5 Тест сценария «Старый конфиг»: проект с `.puml` и `.d2`, `generateLocalImages: false` + `plantumlServerUrl` → код 0, обе диаграммы локальные, в выходах нет `plantuml.com`, предупреждение называет оба ключа — тест зелёный

## 3. Клиентский рендер PlantUML

- [x] 3.1 Удалить `vendor/docsify/docsify-plantuml.min.js` и его запись в `vendor/docsify/LICENSES.md` (D3) — в выходе шаблонного проекта нет файла `docsify-plantuml.min.js`
- [x] 3.2 В compose после вызова `docsifyTemplate(...)` проверять готовый `index.html` на `docsify-plantuml` и печатать `WARNING:` (D2), опцию `plantuml` в шаблон оставить — тест в `page-fences`: пользовательский шаблон с тегом → предупреждение, код 0, файла в выходе нет, опции содержат `nativeEmoji: true`
- [x] 3.3 Обновить комментарии, ссылающиеся на `docsify-plantuml` как на поставляемый файл (`scan/fences.ts`, `scan/tree.ts`, `render/diagrams.ts`, `test/offline-site.test.mjs`) — `npm test` зелёный, `npm run test:golden` без изменений эталонов

## 4. Актуализация

- [ ] 4.1 Сайт ru/en: удалить раздел «Онлайн-сервер PlantUML» на страницах «Диаграммы», строки `generateLocalImages`/`plantumlServerUrl` из таблиц конфига на «CLI и конфигурация», переписать абзац о внешних адресах на «Выводы» (без онлайн-режима и с предупреждением о `docsify-plantuml`) — тест `docs-parity` зелёный, `grep -rn "plantumlServerUrl\|generateLocalImages" docs/ru/src docs/en/src` пуст
- [ ] 4.2 Удалить оба ключа из `docs/ru/.c4builder` и `docs/en/.c4builder` — сайт документации собирается без предупреждения о ключах
- [ ] 4.3 `skills/c4builder`: `SKILL.md` и `references/` (`config.md`, `diagrams.md`, `bpmn.md`, `mermaid.md`, `wireflow.md`) — убрать ключи и упоминания онлайн-рендера; проверить `template/AGENTS.md` — тест `skills` зелёный, `grep -rn "plantumlServerUrl\|generateLocalImages" skills template` пуст
- [ ] 4.4 CHANGELOG `## Unreleased`: **BREAKING (config)** — онлайн-рендер удалён, `generateLocalImages: false` даёт предупреждение и локальную сборку (нужна Java или Docker-образ), ключи можно удалить; `docsify-plantuml.min.js` больше не поставляется — запись присутствует
- [ ] 4.5 Итоговая проверка: `npm run build && npm run check && npm test` зелёные

## Workflow follow-up

- В описании PR закрыть issue #33 и отметить, что пункт про код выхода мастера без терминала исправлен ранее.
- Архивировать change после ревью и мержа.
