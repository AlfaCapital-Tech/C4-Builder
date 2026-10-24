# Tasks

## 1. Вендор и конфиг

- [x] 1.1 `vendor/docsify/docsify-sidebar-collapse.min.js`, `vendor/docsify/sidebar-collapse.css` (из `docsify-sidebar-collapse@1.3.5`, `dist/sidebar.min.css`), `vendor/docsify/LICENSES.md` с MIT-атрибуцией и версией. Проверка: в файлах нет `http://`, `https://`, `//cdn`; `npm pack --dry-run` включает их.
- [x] 1.2 Ключ `sidebarCollapse` (`schema.ts`, `defaults.ts`, `options.ts` → `SIDEBAR_COLLAPSE`); `template/.c4builder`, `docs/ru/.c4builder`, `docs/en/.c4builder` получают явный `"sidebarCollapse": true`. Проверка: `test/config.test.mjs` — дефолт `true`, `false` принимается, неверный тип — ошибка с именем ключа.

## 2. Подключение в сайт

- [x] 2.1 `DocsifyOptions.sidebarDisplayLevel` (передаётся только при `SIDEBAR_COLLAPSE`); `injectPluginAssets` → `injectSiteAssets` с ассетами ядра (`<link>` + `<script>` при включённом ключе). Проверка: тест сборки — `index.html` содержит оба тега и `"sidebarDisplayLevel": 1` по умолчанию; при `sidebarCollapse: false` — ни тегов, ни ключа; с пользовательским `docsifyTemplate` (фикстура, спредящая опции) теги есть; `offline-site` зелёный (новый CSS сканируется как `vendor/*.css`).
- [x] 2.2 Golden: пересъёмка `UPDATE_GOLDEN=1`. Проверка: diff эталонов — только `index.html` и новые записи `vendor/`; повторный прогон без `UPDATE_GOLDEN` зелёный.
- [ ] 2.3 Ручная проверка на `docs/ru` (`--site -w`): свёрнуто до первого уровня, путь к текущей странице раскрыт, клик сворачивает/раскрывает, кириллические пути подсвечиваются, длинный sidebar прокручивается без рывков (`sidebar-pin`); livereload после правки не ломает состояние. Итог — заметкой к задаче.
  > Итог (без браузера): собрана `docs/ru` (`node ../../dist/index.js`, exit 0). В `dist/index.html` пользовательского шаблона `docs/docsify-template.mjs`: `<link vendor/sidebar-collapse.css>` перед `</head>`, `<script vendor/docsify-sidebar-collapse.min.js>` после `docsify.min.js` перед `</body>`, в `window.$docsify` есть `"sidebarDisplayLevel":1`; в `dist/vendor/` лежат оба файла и `LICENSES.md`. `_sidebar.md` (270 строк, глубина 6, кириллические пути percent-encoded) — корень `Обзор` на уровне 1 раскрыт плагином по `sidebarDisplayLevel`, разделы `01…09`/`Журнал решений` перечислены свёрнутыми. По исходнику плагина: `.active` ставит сам docsify, fallback `a[href=decodeURIComponent(hash)]` нужен редко. **В браузере не проверено**: клики, подсветка кириллических путей, прокрутка с `sidebar-pin` (он активен только при ширине ≤ 768px) и поведение после livereload требуют ручной проверки `--site -w`.

## 3. Актуализация

- [x] 3.1 Страницы `05 CLI и конфигурация` (таблица ключей) и `04 Выводы` (описание сайта) RU и EN; `skills/c4builder/references/config.md`. Проверка: `docs-parity` и `skills` зелёные; сборка `docs/ru` и `docs/en`.
- [x] 3.2 `CHANGELOG.md`, `## Unreleased`: сворачивание sidebar по умолчанию, ключ `sidebarCollapse`, совет убрать ручное подключение плагина из своих шаблонов. Проверка: строка есть.
- [x] 3.3 `npm run build && npm test && npm run check` зелёные; `openspec validate sidebar-collapse --strict` проходит.
  > Итог: `npm run build` и `npm run check` зелёные, `openspec validate sidebar-collapse --strict` проходит. `npm test`: 391 passed, 1 failed — `plugins-source › archive tar.gz` (resolveSource распаковывает архив, собранный bsdtar macOS, и не находит корневой каталог); код `src/core/plugins/source.ts`, `src/util/archive.ts` и сам тест в change не трогались, падение воспроизводится до изменений — локальная среда (macOS), не регресс change.
- [x] 3.4 Публичность: `grep -rniE --exclude=tasks.md "alfacapital\.ru|artifactory|harbor" openspec/changes/sidebar-collapse docs/ru/src docs/en/src skills template CHANGELOG.md` — пусто. Проверка: вывод команды пуст.
