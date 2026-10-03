## Context

Мотивация — в proposal.md, требования — в `specs/output-formats` и `specs/project-scaffold`.
Что уже есть в коде и на что опирается решение:

- `compose/markdown.ts`: `generateWebMD` пишет страницу каждого элемента дерева в
  `<dist>/<путь от rootFolder>/<item.name | webFileName>.md` и `_sidebar.md` (порядок —
  порядок дерева, фильтр `excludeSidebarFolderByPath`); `generateCompleteMD` собирает
  все страницы в один документ. Обе идут через приватный `compileDocument(md, item,
  options, getDiagram)`, где подстановка диаграммы — **стратегия** `getDiagram`.
- Виртуальные страницы плагинов (`plugins/tree.ts addPage`) встают в дерево до compose,
  fence-диаграммы артефактов OpenSpec — обычные `Diagram` с `content`. Отдельной ветки
  для плагинов не нужно.
- Граф локальных зависимостей уже резолвится для чексуммы кэша: PlantUML —
  `foldIncludes` (`scan/tree.ts`, пропускает `<stdlib>` и URL), D2 — `collectFilesCached`
  (`render/d2renderer.ts`). Оба возвращают «материал» строкой, а не список файлов.
- Конфиг: `defaultConfig` питает `new --yes` и wizard; схема (`config/schema.ts`) даёт
  дефолт отсутствующему ключу; wizard переспрашивает форматы, только если какой-то из
  `generateMD/CompleteMD/WEB` не задан в файле (`readLenientConfig`).
- Golden: вариант `default` собирает шаблон (`styles.iuml` в двух диаграммах, D2 с
  импортом `_c4lib.d2`) и сверяет всё дерево `docs/`.

## Goals / Non-Goals

**Goals:**
- `llms.txt` и `llms-full.txt` одним ключом, без новых зависимостей и сети.
- Ноль изменений вывода для существующих конфигов (arch собирается побайтно так же).
- Один резолвер зависимостей диаграмм на кэш и на llms — без второй копии regex-ов.

**Non-Goals:**
- Абсолютные URL в `llms.txt` (базовый адрес сайта сборке неизвестен).
- Пользовательское описание проекта для blockquote (см. Open Questions).
- Разворачивание OpenAPI-спек в `llms-full.txt`: страница плагина `openapi` попадает
  туда как есть (HTML swagger-ui), сама спека лежит в dist статикой.
- Перекодирование исходников в не-UTF-8 `charset`: исходники читаются как UTF-8.

## Decisions

### Ключ `generateLLMS`, дефолт «вкл» для новых проектов, «выкл» для старых
Имя — в ряду `generateMD`/`generateWEB` (`GENERATE_LLMS` в `BuildOptions`).
`defaultConfig.generateLLMS = true` → `new --yes` пишет `true`, wizard отмечает пункт.
В схеме — **явное исключение** `bool(false)` вместо `bool(defaultConfig.generateLLMS)`
с комментарием: отсутствующий ключ = выкл, иначе существующие `.c4builder` (arch)
внезапно получили бы новые файлы. Это не ломает `project-scaffold` «единый источник
дефолтов»: `new --yes` и wizard по-прежнему берут значение из `defaultConfig`; схема
задаёт поведение *легаси-конфига без ключа* — то же, что уже сделано для PDF-ключей.
Альтернатива «дефолт true везде» — проще на одну строку, но меняет вывод arch и golden.

### Wizard: пункт в чекбоксе форматов, не в условии переспроса
Четвёртый пункт «llms.txt for AI agents (needs website)» в существующем checkbox
`Compilation format`, дефолт — `checkedKey(GENERATE_LLMS, defaultConfig.generateLLMS)`.
`GENERATE_LLMS === undefined` в условие показа вопроса **не** добавляется — иначе
каждый старый конфиг заново прогонял бы wizard. `--list` и `--docs` показывают ключ.

### llms.txt: плоский список, заголовок — путь страницы
Формат llmstxt.org: `# <projectName>`, blockquote, `## Pages`, строки
`- [Путь / Страницы](url)`. Плоский список выбран потому, что парсеры llms.txt
(`llms_txt2ctx` и др.) читают строки `- [..](..)` от начала строки, вложенные списки
теряются; иерархию несёт заголовок `A / B / C`. URL — тот же путь, что ссылка sidebar
(`path.relative(ROOT_FOLDER, item.dir)` + имя веб-файла), плюс `.md`, через
`encodeURIPath`. Фильтр исключений sidebar выносится из `generateWebMD` в общий
предикат, чтобы оглавление и sidebar не разъехались.
Blockquote — фиксированный английский текст: «Architecture documentation built with
c4builder. Pages are markdown; full text with diagram sources (PlantUML/D2):
[llms-full.txt](llms-full.txt).»

### llms-full.txt: тот же composer, что complete-markdown, другая стратегия диаграмм
Тело `generateCompleteMD` выносится в `composeComplete(tree, options, getDiagram):
Promise<string>`; `generateCompleteMD` = запись результата со стратегией
`buildDiagramMarkdown(..., 'complete')` — вывод побайтно прежний (проверяет golden).
`llms-full.txt` = `composeComplete` со стратегией «исходник в fence» + приложение.
Fence адаптивный: `` ` `` × max(3, самая длинная серия обратных кавычек в исходнике + 1)
и язык `plantuml`/`d2` по `diagram.engine`. Код — в `compose/markdown.ts` рядом с
`generateCompleteMD`: переиспользует приватные `compileDocument`/`encodeURIPath` без
новых экспортов и нового модуля. Альтернатива — отдельный генератор страниц для llms:
дублировал бы порядок/состав страниц и разъехался бы с complete.

### Приложение include-файлов вместо инлайна
Локальные зависимости приводятся **один раз** в конце (`## Included files`,
`### <путь>` + fence), строки `!include` в исходниках не трогаются. Инлайн (подстановка
содержимого на место `!include`) копировал бы общий `styles.iuml` в каждую из ~100
диаграмм arch — лишние токены агенту — и требовал бы эмулировать семантику
`!includesub`/`!include_many`. Путь — относительно cwd, posix (как в материале
чексуммы), язык fence по расширению (`.puml/.iuml` → `plantuml`, `.d2` → `d2`, иначе
без языка), порядок — по пути.

### Один резолвер на кэш и llms
- `scan/tree.ts`: из `foldIncludes` выделяется `collectIncludes(content, fileDir,
  searchDir, visited): {abs, content}[]` (DFS-порядок, тот же regex и тот же порядок
  поиска); `foldIncludes` становится маппингом этого списка в материал. Материал MUST
  остаться побайтно прежним — иначе у всех потребителей разом инвалидируется кэш
  картинок (перерендер, не поломка, но лишний).
- `render/d2renderer.ts`: экспорт `d2LocalImports(entryAbs, seed): [abs, content][]`
  (то, что `foldD2Imports` уже считает до склейки); `foldD2Imports` переходит на него.
- Вызов — как в `render/diagrams.ts`: PlantUML `collectIncludes(body, item.dir,
  item.dir, new Set())`, D2 — `d2LocalImports(path.join(item.dir, diagram.dir), body)`.
  Резолв идентичен рендеру, в том числе для виртуальных страниц.

### Место в сборке
В `build.ts` после `generateWebMD`/`injectPluginAssets`: `if (GENERATE_LLMS)` →
при `GENERATE_WEBSITE` пишем оба файла, иначе жёлтое предупреждение
(`generateLLMS требует generateWEB — llms.txt не создан`) и продолжаем. Кеши include
и D2-графа ещё живы (чистятся в `finally`), повторного чтения с диска почти нет.
Watch-режим перегенерирует файлы автоматически — это часть `build()`.

### Тесты
- Golden: в фикстуру `default` добавляется `generateLLMS: true` → эталон `default`
  получает ровно два новых файла (+ manifest); остальные файлы `default` и варианты
  `links-top`/`embed-png` (без ключа) не меняются — это и есть проверка совместимости.
  Отдельный вариант не заводим: он дублировал бы ~380 КБ эталона ради двух файлов.
- Vitest без java: оглавление (порядок, заголовки, кодирование, исключение, виртуальная
  страница), fence-стратегия (адаптивный fence, d2, ditaa), приложение (дедуп, вложенность,
  stdlib, D2), неизменность материала `foldIncludes`/`foldD2Imports` (тест пишется до
  рефакторинга против текущего кода).

## Risks / Trade-offs

- [Рефакторинг `foldIncludes` меняет материал чексуммы] → тест-эталон материала до
  рефакторинга; golden повторной сборки с кэшем (`regression-testing`) ловит остальное.
- [`llms-full.txt` большого проекта — мегабайты] → это его назначение; `llms.txt`
  остаётся лёгкой точкой входа, агент выбирает.
- [Схема и `defaultConfig` расходятся по `generateLLMS` намеренно] → комментарий у
  ключа в схеме + сценарий спеки «легаси-конфиг без ключа»; при следующей ревизии
  дефолтов не «чинить».
- [Golden на Arch может краснеть из-за fontconfig (известно)] → при обновлении эталона
  коммитить только `llms.txt`, `llms-full.txt` и строки manifest для них; SVG-дифф
  чужих файлов — признак окружения, не изменения.
- [Не-UTF-8 `charset`] → исходники в `llms-full.txt` декодируются как UTF-8; известное
  ограничение, вне скоупа.

## Migration Plan

Включение в существующем проекте — `"generateLLMS": true` в `.c4builder` (или
`c4builder config`). Откат — удалить ключ; старые версии c4builder ключ молча
отбрасывают (схема нестрогая), сборка не ломается.

## Open Questions

- Нужен ли ключ для пользовательского описания в blockquote (например, `projectDescription`)?
  Добавляется позже одной строкой схемы, формат и задачи не меняет.
