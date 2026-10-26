# Design

## Context

`src/plugins/openapi/index.ts` отбирает спеки регэкспом ключа верхнего уровня (`readSpec`), строит
страницы по папкам и на странице спеки вызывает `SwaggerUIBundle` inline-скриптом; swagger-ui
подключён статическим ассетом плагина (`assets`) — в `index.html` каждого сайта с плагином. docsify
с `executeScript` выполняет первый `<script>` страницы при её показе.

`@asyncapi/react-component` 3.2.2 (Apache-2.0) поставляет `browser/standalone/index.js` (2,9 МБ,
UMD, глобал `AsyncApiStandalone`, парсер AsyncAPI внутри) и `styles/default.min.css` (28 КБ).
API: `AsyncApiStandalone.render({ schema: { url }, config }, element)`. Строки `http://asyncapi.com`
и `json-schema.org` в бандле — идентификаторы встроенных JSON-схем, не загрузки.

## Goals / Non-Goals

**Goals:**
- AsyncAPI-спека — полноправная спека плагина: те же правила раскладки, сводка, оглавление.
- Сайты без AsyncAPI не меняются ни байтом и не тянут 3 МБ.

**Non-Goals:**
- Отдельная опция включения AsyncAPI: файл попадает в отбор только через `glob`, по умолчанию
  `**/openapi.{yaml,yml,json}` — AsyncAPI не совпадёт; кто расширил `glob`, получил предупреждение
  о пропуске и ждёт страницу.
- Внешние `$ref` AsyncAPI-спек на другие файлы: компонент резолвит их относительно URL спеки, как
  swagger-ui; отдельно не тестируем.

## Decisions

**1. Отбор.** `readSpec` возвращает `kind: 'openapi' | 'asyncapi'`: YAML — `^(openapi|swagger)\s*:`
либо `^asyncapi\s*:`, JSON — ключ объекта. Порядок в оглавлении папки не меняется (`openapi.*`
первым, остальные по имени).

**2. Вендор.** `vendor/asyncapi/asyncapi-standalone.js`, `asyncapi.css` (из `default.min.css`),
`LICENSE` (Apache-2.0), `THIRD-PARTY-LICENSES.txt` (из `index.js.LICENSE.txt`), `README.md` с
версией и способом обновления — по образцу `vendor/swagger-ui/README.md`. Отдельно от
`vendor/docsify/`, который копируется в каждый сайт целиком.

**3. Копирование только при наличии AsyncAPI.** Не через `assets` (те инжектятся в `index.html`
всегда): плагин в `afterScan` при хотя бы одной AsyncAPI-спеке копирует оба файла в
`<dist>/vendor/plugins/openapi/` — туда же, куда ядро кладёт ассеты плагина; спеки он уже копирует
в `afterScan` тем же способом.

**4. Ленивая загрузка на странице.** Inline-скрипт страницы (единственный `<script>`, без пустых
строк — иначе markdown разорвёт HTML-блок) один раз на окно создаёт промис загрузки: `<link>` стиля
и `<script src>` бандла, затем `render`. Повторные переходы между AsyncAPI-страницами используют
уже загруженный глобал. `config.show.sidebar: false` — у docsify свой sidebar. `id` контейнера —
`asyncapi-<путь страницы>` по тем же правилам, что `swagger-…`.

## Risks / Trade-offs

- [Размер npm-пакета +3 МБ] → допустимо (jar PlantUML крупнее); в выход сайта бандл попадает только
  при AsyncAPI-спеках.
- [Стили компонента (tailwind) пересекаются с темой docsify] → проверка глазами; стиль компонента
  подключается после темы, только на AsyncAPI-страницах.
- [Офлайн не проверяем автоматически в браузере] → grep бандла на `fetch`/`XMLHttpRequest` к
  абсолютным адресам при вендоринге; ручная проверка без сети.

## Migration Plan

Флагов нет. Проекты с широким `glob` получают страницы AsyncAPI вместо предупреждения.
