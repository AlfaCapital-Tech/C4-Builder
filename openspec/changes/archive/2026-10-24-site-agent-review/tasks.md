# Tasks

## 1. Переадресации в ядре плагинов

- [x] 1.1 `ScanCtx.addRedirect(from, to)` в `src/core/plugins/types.ts` и сбор карты в `src/core/plugins/tree.ts`/`build.ts`; дубль пути — ошибка с именем плагина и пути. Проверка: юнит-тест в `test/plugins-tree.test.mjs` (две переадресации, дубль → ошибка с путём и плагином).
- [x] 1.2 Карта в опциях docsify (`c4builder.redirects`) в `src/core/compose/markdown.ts`; `vendor/docsify/c4builder-redirects.js` (load + hashchange → `location.replace`), инъекция через `injectHtml` только при непустой карте. Проверка: тест сборки — `index.html` содержит карту и `<script src="vendor/docsify/c4builder-redirects.js">` при переадресациях и не содержит без них; `offline-site` зелёный; сборка `docs/ru` с `docsify-template.mjs` содержит карту.
  Примечание: в dist скрипт лежит как `vendor/c4builder-redirects.js` (vendor/docsify копируется в `dist/vendor/` без подпапки; файлы `c4builder-*` исключены из общего копирования и кладутся только при непустой карте — golden не меняется). Проверка срабатывает сразу при выполнении скрипта (до инициализации docsify) и на `hashchange`; отдельный `load` не нужен.
- [x] 1.3 Ручная проверка в браузере: `#/change/<id>` → страница change'а, адрес заменён, «назад» ведёт на предыдущую страницу, картинки страницы грузятся.
  Без браузера: dev-сервер `docs/ru` на :3105 с `docsify-template.mjs` — `index.html` содержит карту и `<script src="vendor/c4builder-redirects.js">`, скрипт отдаётся (200); логика скрипта (сразу, на `hashchange`, срез `?id=`, раскодированный hash, чужие пути) — vm-тест в `test/plugins-tree.test.mjs`. Не проверено вживую: замена адреса в браузере, «назад», загрузка картинок после переадресации.

## 2. Адреса change'ей в плагине openspec

- [x] 2.1 `src/plugins/openspec/index.ts`: объявление `change/<originalId>` для активных, вложенных и архивных change'ей; приоритет активного, среди архивных — новейший. Проверка: `test/plugin-openspec.test.mjs` — карта в `index.html` для фикстур `addFamily` (группа + `nameKey` с кириллицей → ключ ASCII, значение — закодированный путь), вложенный `…-ios`, архивный, активный+архивный с одним id.
- [x] 2.2 Документация плагина: страница `06 Плагины` RU и EN — схема адресов страниц change'ей и короткий адрес `#/change/<id>`; `skills/c4builder/references/plugins.md`. Проверка: `docs-parity` и `skills` зелёные.

## 3. CLI: `--open [id]` и адрес в feedback

- [x] 3.1 `dispatch.ts`/`site.ts`: `-o, --open [page]`, открытие `#/change/<id>`, предупреждение в stderr при отсутствии ключа; `--help` показывает необязательное значение. Проверка: `test/cli-site.test.mjs` с `BROWSER=none` — вывод содержит адрес `#/change/<id>`; для неизвестного id — предупреждение в stderr и код 0 при остановке.
- [x] 3.2 Эндпоинт `GET /__c4builder/page?as=<name>` с той же защитой, что у `feedback/next`; `feedback.ts` печатает `Change page: …` в stderr до цикла. Проверка: `test/cli-feedback.test.mjs` через in-process `start()` с картой переадресаций — строка в stderr при совпадении, отсутствует без него, stdout — только пачка; запрос с `Origin` → 403, как у соседних эндпоинтов; `cli-language` зелёный.
- [x] 3.3 Документация команд RU и EN: `05 CLI и конфигурация` (`--open [id]`, строка `Change page`), `08 Агенты` (цикл ревью со ссылкой `#/change/<id>`); `skills/c4builder/SKILL.md` (превью, feedback); `template/AGENTS.md`. Проверка: `docs-parity` и `skills` зелёные.
- [x] 3.4 `skills/c4builder-review/SKILL.md` §2 Link: ссылка по схеме `http://localhost:<port>/#/change/<id>` вместо `find` по `dist`; `curl` проверять по `/#/…` нельзя — проверять `/` и наличие строки `Change page` из `feedback`. Проверка: тест `skills` зелёный; ручной прогон `/c4builder-review <id>` на `docs/ru` даёт рабочую ссылку с первого раза.
  Прогон шагов скилла на `docs/ru` (:3105) без браузера: `curl /` → 200, `c4builder feedback --as site-agent-review -p 3105` печатает `Change page: http://localhost:3105/#/change/site-agent-review` в stderr, `--as review-2` — без строки. Открытие ссылки в браузере не проверено.

## 4. Фиксация реализованного поведения

- [x] 4.1 Сверить сценарии ADDED-требований «Dev-сервер не подменяет неизвестные пути главной» и «Прогресс сборки вне терминала» с тестами `test/cli-site.test.mjs` (404 для `/nope/`) и `test/cli-progress.test.mjs` (нет `\r`); если сценарий не покрыт тестом дословно — добавить проверку. Проверка: оба теста зелёные, каждая строка сценариев соответствует assert'у.
  Сверка: 404 — `cli-site` «неизвестные пути» (`/` и `/index.html` → 200, `/nope/` → 404; в сценарии путь `/changes/nope/` — тот же случай); прогресс — `cli-progress` (нет `\r`, `^processed 2 images$`, `^processed 1 files$`). Строка сценария «подсказка агентского режима стоит отдельной строкой» не была покрыта — добавлен assert в `cli-site` («агентский режим»): подсказка в начале строки, в выводе `site -w` нет `\r`.

## 5. Актуализация и интеграция

- [x] 5.1 `CHANGELOG.md`, `## Unreleased`: короткий адрес `#/change/<id>`, `--open <id>`, строка `Change page` в `feedback`. Проверка: строка есть.
- [x] 5.2 `npm run build && npm test && npm run check` зелёные; `openspec validate site-agent-review --strict` проходит; в issue #32 — комментарий со ссылкой на PR и пометкой, что пункт 1 (холодная сборка) не входит.
  Сделано: build, check и `openspec validate --strict` зелёные; `npm test` — 393/394, единственное красное — `plugins-source` «archive tar.gz» (macOS `tar` кладёт в архив AppleDouble `._repo-abc123`, снятие единственного корневого каталога не срабатывает; с `COPYFILE_DISABLE=1` зелёный; файлы резолвера не менялись). Осталось человеку: комментарий в issue #32 после открытия PR.
- [x] 5.3 Публичность: `grep -rniE --exclude=tasks.md "alfacapital\.ru|artifactory|harbor" openspec/changes/site-agent-review docs/ru/src docs/en/src skills template CHANGELOG.md` — пусто. Проверка: вывод команды пуст.
