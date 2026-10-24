# asyncapi

Компонент AsyncAPI для страниц AsyncAPI-спек плагина `openapi` — `@asyncapi/react-component`
**3.2.2** (Apache-2.0, см. `LICENSE`, лицензии зависимостей бандла — `THIRD-PARTY-LICENSES.txt`):

- `asyncapi-standalone.js` — `browser/standalone/index.js` (UMD, глобал `AsyncApiStandalone`,
  парсер AsyncAPI внутри);
- `asyncapi.css` — `styles/default.min.css` (правила под `.aui-root`, глобально ничего не сбрасывает).

Копируются в `dist/vendor/plugins/openapi/` только при AsyncAPI-спеках и грузятся браузером только на
их страницах, поэтому лежат отдельно от `docsify/`, который копируется в каждый сайт целиком.
Обновление: `npm pack @asyncapi/react-component@<v>` → два файла выше и лицензии.
