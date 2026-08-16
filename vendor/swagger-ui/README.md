# swagger-ui

`swagger-ui.css` — стили swagger-ui-dist **5.32.1** (та же версия, что `docsify/swagger-ui-bundle.js`,
sha256 бандла совпадает с npm-пакетом). Подключается только плагином `openapi` (ассет →
`dist/vendor/plugins/openapi/`), поэтому лежит отдельно от `docsify/`, который копируется в каждый сайт целиком.
Обновлять парой с бандлом: `npm pack swagger-ui-dist@<v>` → `swagger-ui-bundle.js` и `swagger-ui.css`.
