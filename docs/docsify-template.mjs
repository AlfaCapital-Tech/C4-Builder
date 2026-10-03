// Шаблон index.html сайта документации — ключ docsifyTemplate в docs/<lang>/.c4builder.
// Отличается от встроенного шаблона c4builder тем, что сайт не ходит на внешние домены:
//  - тема vue.css инлайнится без своего @import Google Fonts (шрифты — системные);
//  - noEmoji: иначе docsify превращает `:имя:` в картинки с github.githubassets.com;
//  - без docsify-plantuml: диаграммы рендерит сборка, блоки ```plantuml не уходят на plantuml.com.
// Плюс язык страницы (по папке проекта: docs/ru, docs/en) и ссылка с названия на лендинг.
import fs from 'node:fs';
import path from 'node:path';

const theme = () =>
    fs
        .readFileSync(new URL('../vendor/docsify/vue.css', import.meta.url), 'utf8')
        .replace(/^@import url\([^)]*\);/, '');

export default (options) => {
    const lang = path.basename(process.cwd());
    // Название в sidebar ведёт на лендинг своего языка (в _site: ../ — RU, ../en.html — EN).
    const nameLink = lang === 'en' ? '../en.html' : '../';
    const config = { ...options, nameLink, noEmoji: true, themeColor: '#1168bd' };
    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="UTF-8">
    <title>${options.name}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>${theme()}</style>
</head>
<body>
    <div id="app"></div>
    <script>window.$docsify = ${JSON.stringify(config)};</script>
    <script src="vendor/docsify.min.js"></script>
    <script src="vendor/zoom-image.min.js"></script>
    ${options.supportSearch ? '<script src="vendor/search.min.js"></script>' : ''}
</body>
</html>
`;
};
