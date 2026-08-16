## 1. Конфиг и контракт плагина

- [x] 1.1 `config/schema.ts`: ключ `plugins` — массив `string | [string, Record<string, unknown>]`, дефолт `[]`; ошибка формы с путём ключа; `BuildOptions`/`getOptions` пробрасывают сырой список
- [x] 1.2 `core/plugins/types.ts`: `definePlugin`, типы `Plugin`, `ScanCtx`, `BuildCtx`, `PageSpec` (сегменты пути, markdown, диаграммы), `SourceSpec` (`dir` | `archive`+`subdir`+`headers`)
- [x] 1.3 `core/plugins/load.ts`: резолв идентификатора (встроенный → путь от cwd → npm через `createRequire`), `import()`, подстановка `${ENV}` в опциях, `safeParse` схемы с сообщением `plugins[i] <name>: <path> — <issue>`, применение `requires.executeScript` с логом
- [x] 1.4 Тесты `test/plugins-load.test.mjs`: строка = пара, ошибка формы, неизвестный ключ у строгой схемы, плагин без схемы, подстановка окружения, несуществующий модуль

## 2. Виртуальные страницы и хуки в сборке

- [x] 2.1 `core/plugins/tree.ts`: `addPage()` — вычисление `dir`/`level`/`parent`, обновление `descendants`, вставка в конец поддерева родителя (DFS), автосоздание промежуточных узлов-оглавлений, ошибка при коллизии с реальной папкой
- [x] 2.2 `core/build.ts`: третий аргумент `plugins`; вызов `afterScan` после `generateTree` (по порядку, ошибка с именем плагина), `afterBuild` после выходов; `dispatch.ts` грузит плагины до `build()` и передаёт их
- [x] 2.3 Проверить `render/diagrams.ts` на виртуальном `item.dir` (инклюды, пути вывода, checksum-восстановление из бэкапа) — без `fs`-доступа к несуществующему каталогу
- [x] 2.4 Тесты `test/plugins-tree.test.mjs`: виртуальный раздел в `_sidebar.md` и страницах сайта, в `generateMD`/complete, диаграмма виртуальной страницы рендерится (PlantUML на stdlib), порядок DFS, ошибка хука прерывает сборку

## 3. Ассеты, watch, источники

- [x] 3.1 `core/plugins/assets.ts`: копирование `assets` в `dist/vendor/plugins/<name>/`, пост-инъекция `<link>`/`<script>` в `index.html` (перед `</head>`/`</body>`, фолбэк — конец файла); вызов после `generateWebMD`
- [x] 3.2 `dispatch.ts`: `watchPaths` плагинов добавляются в `node-watch` (массив путей), несуществующие — предупреждение
- [x] 3.3 `util/archive.ts`: вынести `extractZip` из `render/jre.ts` (zip-slip-guard общий), добавить `extractTarGz`; `jre.ts` использует новый модуль
- [x] 3.4 `core/plugins/source.ts`: `resolveSource` — `dir` (существование), `archive` (httpGet с `headers` без пустых значений → `os.tmpdir()/c4builder-src-<sha1>/` через `.tmp`+rename → снятие единственного корневого каталога → `subdir`), кэш `Map` на процесс, ошибки с URL/кодом
- [x] 3.5 Тесты: инъекция в шаблон с/без `</head>`, `resolveSource` на локальном tar.gz/zip-фикстуре и http-сервере из теста (успех, 404, zip-slip)

## 4. Плагин openspec

- [x] 4.1 `plugins/openspec/scan.ts`: сканер store — активные change'ы (артефакты, `.openspec.yaml` построчно, дельты `specs/**/spec.md`, прогресс чекбоксов, max mtime), архив, спеки (одно-/двухуровневые)
- [x] 4.2 `plugins/openspec/render.ts`: сводка (счётчики, таблица по mtime desc), страница change'а (шапка с метаданными и прогрессом; разделы proposal → design → tasks → прочие → дельты; переписывание ссылок на артефакты в якоря; копирование картинок), страницы спек и промежуточных папок, сводка архива
- [x] 4.3 `plugins/openspec/fences.ts`: извлечение ```plantuml/```d2 в `Diagram` (обёртка `@startuml/@enduml`), замена на `![…](name.ext)`
- [x] 4.4 `plugins/openspec/index.ts`: схема опций `{ dir: 'openspec', mount: 'OpenSpec' }` `.strict()`, `watchPaths`, `afterScan` через `addPage`; регистрация в `plugins/index.ts`
- [x] 4.5 Тесты `test/plugin-openspec.test.mjs` на мини-фикстуре store (2 change'а с tasks/дельтами/plantuml, 1 архивный, двухуровневые спеки, кастомный артефакт `plan.md`): sidebar, сводка, прогресс, отрендеренная диаграмма, пустой store, отсутствующий `dir`

## 5. Плагин openapi

- [x] 5.1 `util/glob.ts`: glob → RegExp (`**`, `*`, `{a,b}`) + рекурсивный обход; тест
- [x] 5.2 `vendor/docsify/swagger-ui.css` той же версии, что `swagger-ui-bundle.js` (версия зафиксирована в README «Vendored»); проверить whitelist `files`
- [x] 5.3 `plugins/openapi/index.ts`: схема `{ mount: 'API', dir?, archive?, subdir?, headers?, glob }` `.strict()` + refine «ровно один источник»; `requires.executeScript`; `assets.styles`; `afterScan`: источник → glob → копия спек в `dist/<mount>/_specs/<relpath>` (через `afterBuild`) → страницы swagger-ui + сводка; ошибки: пустое совпадение, коллизии имён; `watchPaths` при `dir`
- [x] 5.4 Тесты `test/plugin-openapi.test.mjs`: локальная папка с 3 спеками и относительным `$ref`, страница без CDN-ссылок, `executeScript` принудительно, пустой glob — ошибка, `dir`+`archive` — ошибка

## 6. Документация и завершение

- [ ] 6.1 README: раздел «Plugins» — ключ `plugins`, встроенные `openspec`/`openapi` с опциями и примером для repo с `openspec/` и репо контрактов, контракт стороннего плагина (`definePlugin`, хуки, источники), совместимость со старыми версиями
- [ ] 6.2 CLAUDE.md репо: строка про `src/plugins/` и `src/core/plugins/`
- [ ] 6.3 `npm run check`, `npm run test:unit`, `npm run test:golden` — эталоны без изменений
- [ ] 6.4 Прогон на arch локально (`c4builder --site` с `plugins` в `.c4builder`), проверка sidebar/поиска/диаграмм design.md и раздела API; затем rc-релиз и MR в arch/arch-biba2boba с правкой `.c4builder`
