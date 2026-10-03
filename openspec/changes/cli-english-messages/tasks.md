# Tasks

## 1. Подготовка и тест против регресса

- [x] 1.1 Убедиться, что `cli-fixes` влит в базу ветки (`git log --oneline | grep -i cli-fixes` или переведённый вывод `check` в `src/cli/commands/check.ts`); иначе остановиться и сообщить. `npm run build`. Проверка: `node dist/index.js check /nonexistent.txt` печатает английское сообщение
- [x] 1.2 Добавить `test/cli-language.test.mjs` по design §3: обход `src/**/*.ts`, AST через `typescript`, литералы `StringLiteral`/`NoSubstitutionTemplateLiteral`/`TemplateHead|Middle|Tail` без кириллицы, сообщение — список `файл:строка: литерал`. Проверка: тест красный на текущем коде и перечисляет литералы из инвентаря design (в том числе `core/render/jre.ts`, `cli/wizard/collect.ts`), но НЕ комментарии `jre.ts:60` и `dispatch.ts:163`

## 2. Перевод: CLI и конфиг

- [x] 2.1 `cli/dispatch.ts`, `cli/commands/{new,jre,list,help}.ts` (в `help.ts` — «(по-русски)» → «(in Russian)»), `cli/wizard/collect.ts` (сообщения валидаторов), `config/schema.ts`, `config/options.ts` («(корень)» → «(root)»); тесты с русскими ожиданиями этих сообщений (`cli-commands`, `config`) — на английские. Проверка: `npx vitest run test/cli-commands.test.mjs test/config.test.mjs` зелёный; в `cli-language` больше нет литералов из этих файлов

## 3. Перевод: ядро сборки и рендер

- [x] 3.1 `core/build.ts`, `core/scan/tree.ts`, `core/compose/markdown.ts`; тесты (`llms` — предупреждение `generateLLMS`/`generateWEB`, `compose-h1`) — на английские ожидания. Проверка: `npx vitest run test/llms.test.mjs test/compose-h1.test.mjs` зелёный
- [x] 3.2 `core/render/{diagrams,jre,d2renderer,pngraster}.ts`, включая заглушку «диаграмма не отрендерена»; тесты `plugin-openspec` (текст заглушки), `jre`, `pngraster` — на английские ожидания. Проверка: `npx vitest run test/plugin-openspec.test.mjs test/jre.test.mjs test/pngraster.test.mjs` зелёный

## 4. Перевод: плагины и утилиты

- [x] 4.1 `core/plugins/{load,hooks,tree,source}.ts`, `plugins/{openapi,openspec}/index.ts`; тесты `plugins-load`, `plugins-tree`, `plugins-source`, `plugin-openapi`, `plugin-openspec` — на английские ожидания. Проверка: эти тесты зелёные
- [x] 4.2 `util/{lock,http,archive,paths}.ts`; тест `lock` при наличии русских ожиданий — на английские. Проверка: `npx vitest run test/lock.test.mjs` зелёный; `npx vitest run test/cli-language.test.mjs` зелёный (литералов с кириллицей в `src/` не осталось)

## 5. Актуализация

- [x] 5.1 Сайт: в `docs/en/src` убрать оговорки о русском выводе (например `03 Diagrams` — «messages are printed in Russian for now»), в RU и EN поправить цитаты сообщений CLI, если они есть (`grep -rnP '[А-Яа-яЁё]' docs/en/src` и поиск процитированных сообщений в `docs/ru/src`). Проверка: `npx vitest run test/docs-parity.test.mjs` зелёный; сборка `cd docs/ru && node ../../dist/index.js` и `docs/en` — код 0
- [x] 5.2 `skills/c4builder/**` и `template/AGENTS.md`: убрать оговорки о русских сообщениях CLI, если остались после `cli-fixes`. Проверка: `grep -rniE 'russian|строка' skills template/AGENTS.md` — только осознанные упоминания; `npx vitest run test/skills.test.mjs` зелёный
- [x] 5.3 `CLAUDE.md`: в «Правила» — пользовательский вывод CLI только на английском (тест `cli-language`), комментарии — по-прежнему на русском. Строка в `## Unreleased` `CHANGELOG.md`: весь вывод CLI на английском, скриптам, разбиравшим русские сообщения, — обновиться. Проверка: ревью глазами

## 6. Интеграция

- [x] 6.1 `npm run build`, `npm test` (golden — эталоны без изменений), `npm run check`, `openspec validate cli-english-messages --strict` — всё зелёное
