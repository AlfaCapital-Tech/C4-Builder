# Design

## Context

`index.html` строит `src/core/compose/docsify.template.ts` (или пользовательский
`docsifyTemplate`) из `DocsifyOptions`, целиком сериализуемых в `window.$docsify`; `vendor/docsify/`
копируется в `dist/vendor/` целиком (`markdown.ts`), а ассеты плагинов вставляются пост-обработкой
`injectHtml` (`src/core/plugins/assets.ts`): `<link>` перед `</head>`, `<script>` перед `</body>`
— после `docsify.min.js`, но до его инициализации на `DOMContentLoaded`. Golden-манифесты
перечисляют файлы `vendor/` и хэш `index.html`.

`docsify-sidebar-collapse` 1.3.5 (MIT, iPeng6): `dist/docsify-sidebar-collapse.min.js` (4,7 КБ)
регистрирует себя в `$docsify.plugins` при загрузке, сам вставляет базовый `<style>` (скрытие
вложенных `ul`), читает `sidebarDisplayLevel`; стрелки — отдельный `dist/sidebar.min.css`
(476 байт), есть альтернатива с иконками папок. Внешних запросов нет. В бандл входит и
`sidebar-pin-plugin` (закрепление sidebar) — побочная функция, не мешает.

## Goals / Non-Goals

**Goals:**
- Сворачивание включено по умолчанию и работает с любым шаблоном, выводящим опции.
- Ни одного нового сетевого ресурса; тест `offline-site` ловит регресс.

**Non-Goals:**
- Настройка уровня раскрытия и стиля стрелок/папок: фиксируем `sidebarDisplayLevel: 1` и
  стрелки; кому нужно иначе — свой `docsifyTemplate` с другим значением (опции доходят).
- Запоминание состояния sidebar между перезагрузками (livereload в `-w` раскроет путь к
  текущей странице заново — этого достаточно).

## Decisions

**1. Вендорить, не ставить зависимость.** Файлы кладутся в `vendor/docsify/` рядом с
`docsify.min.js`: `docsify-sidebar-collapse.min.js` и `sidebar-collapse.css` (переименованный
`sidebar.min.css`, чтобы имя говорило, чей он), плюс `vendor/docsify/LICENSES.md` с
атрибуцией MIT и версией. Копирование в `dist/vendor/` уже есть. Альтернатива — npm-зависимость
с копированием из `node_modules` — отвергнута: сайт должен собираться из пакета без
`node_modules` пользователя, как и прочие вендорные ассеты.

**2. Подключение — пост-обработкой, а не в шаблоне.** `injectPluginAssets` обобщается до
`injectSiteAssets`: к ассетам плагинов добавляются «ассеты сайта» ядра — при `sidebarCollapse`
это `<link href="vendor/sidebar-collapse.css">` и `<script src="vendor/docsify-sidebar-collapse.min.js">`.
Так плагин попадает и в пользовательские шаблоны (включая `docs/docsify-template.mjs` сайта
документации и шаблоны-копии в проектах команд), и его не нужно дублировать в каждом. Скрипт
регистрируется в `$docsify.plugins` до `DOMContentLoaded`, порядок `docsify.min.js` → плагин
сохраняется, потому что инъекция идёт перед `</body>`.

**3. Уровень — через опции.** `DocsifyOptions.sidebarDisplayLevel: 1` добавляется в объект,
который сериализуется в `$docsify` при `sidebarCollapse: true`; при `false` ключ не передаётся
и ассеты не инжектятся (чтобы `index.html` был прежним — сценарий «Отключение»).

**4. Ключ конфига.** `sidebarCollapse: bool(true)` в схеме, `SIDEBAR_COLLAPSE` в `BuildOptions`;
мастер `--config` не спрашивает (как `supportSearch`/`nativeEmoji` — значение по умолчанию
устраивает большинство). Имя — по существующему стилю ключей сайта (`supportSearch`,
`includeBreadcrumbs`).

**5. Golden.** Пересъёмка всех вариантов: меняются `index.html` и список `vendor/`; страницы и
диаграммы не меняются — это проверяется в задаче по diff манифестов.

## Risks / Trade-offs

- [Плагин ищет активный пункт по `a[href]` с `decodeURIComponent(hash)` — пути с кириллицей и
  пробелами] → docsify сам ставит `.active`, fallback плагина нужен редко; ручная проверка на
  `docs/ru` (кириллические папки) в задачах.
- [Пользователи привыкли к развёрнутому дереву] → `sidebarCollapse: false`, строка в CHANGELOG.
- [Обновление плагина — руками] → версия и источник в `LICENSES.md`; как у остальных вендорных
  файлов docsify.
- [`sidebar-pin-plugin` в бандле меняет поведение прокрутки sidebar] → проверить на длинном
  sidebar в задаче; при проблемах — собрать `docsify-sidebar-collapse.js` без pin (исходник в
  пакете, `src/index.js`).

## Migration Plan

Ключ со значением по умолчанию — конфиги не меняются. Проекты с собственным шаблоном,
подключавшим плагин вручную, после обновления получат его дважды: в CHANGELOG — совет убрать
ручное подключение (двойная регистрация плагина не ломает сайт, но лишняя).
