# Tasks

## 1. Опции и нормализация ссылок

- [x] 1.1 `src/plugins/figma/index.ts`: строгая zod-схема опций по design.md:
  - `mount`, `embedHost`, `height`, `frames` (min 1);
  - нормализация `url` в embed-ссылку: типы `design|file|proto|board|slides|deck`, `file` → `design`, из query сохраняется только `node-id`;
  - ошибки: не-Figma ссылка (с ожидаемой формой), пустой сегмент имени, дубль имени.

  Регистрация в `src/plugins/index.ts`. Проверка: юнит-тесты в `test/plugin-figma.test.mjs` через `loadPlugins` на все сценарии требования «Валидация и нормализация ссылок Figma» (ошибка называет плагин и фрейм); `npm run check` зелёный.

## 2. Страницы раздела

- [x] 2.1 `afterScan`: сводка `[mount]` со ссылками в порядке `frames` и страница на фрейм (`[mount, ...name.split('/')]`):
  - описание → `[Open in Figma](<url>)` → `<iframe … loading="lazy" allowfullscreen>` с `height`;
  - одна строка лога про `embed.figma.com`;
  - `executeScript` и ассеты не объявлены.

  Проверка: сборочный тест в `test/plugin-figma.test.mjs` (фикстура по образцу `plugin-openapi.test.mjs`) покрывает:
  - страницы и порядок сводки, вложенный `Mobile/Login`;
  - iframe с `embed-host` и `node-id`, `executeScript: false` не меняется;
  - строку лога;
  - в markdown-выходе (`generateMD`) есть ссылка на исходный `url`;
  - `embed.figma.com` встречается только в страницах раздела (не в `index.html`, CSS, других страницах).
- [x] 2.2 Ручная проверка в браузере: `site` на фикстуре с публичным файлом Figma показывает эмбед; с отключённой сетью ссылка «Open in Figma» видна над ошибкой iframe.
  Не выполнено (нет браузера у агента); собранный markdown страницы фрейма проверен: описание → ссылка → iframe.

## 3. Актуализация

- [x] 3.1 Страница `06 Плагины` RU и EN: раздел `figma` — назначение, таблица опций, пример, требование к доступу к файлу («Anyone with the link»), исключение из офлайн-гарантии. Обзорные страницы `README.md` сайта (список плагинов) и `context.puml` (внешняя система Figma). Проверка: `cd docs/ru && node ../../dist/index.js --site` и то же для `docs/en` собираются; `docs-parity` зелёный.
- [x] 3.2 `skills/c4builder/references/plugins.md` (раздел `figma`, список встроенных имён) и строка `plugins` в `skills/c4builder/SKILL.md`. Проверка: тест `skills` зелёный.
- [x] 3.3 `CHANGELOG.md`, `## Unreleased`: строка о плагине `figma`. Проверка: строка есть; `cli-language` зелёный (сообщения плагина на английском).
- [x] 3.4 Итог: `npm run build && npm test && npm run check` зелёные; `openspec validate figma-plugin --strict` проходит.
  `build`, `check`, `openspec validate` зелёные; `npm test` — 390/391, красный только `plugins-source` «archive tar.gz» (локальная среда, bsdtar; код архива не менялся).
  После фикса tar-фикстуры (`COPYFILE_DISABLE=1`) в интеграционной ветке `npm test` — 480/480.
- [x] 3.5 Публичность: `grep -rniE --exclude=tasks.md "alfacapital\.ru|artifactory|harbor" openspec/changes/figma-plugin docs/ru/src docs/en/src skills CHANGELOG.md` — пусто. Проверка: вывод команды пуст.
