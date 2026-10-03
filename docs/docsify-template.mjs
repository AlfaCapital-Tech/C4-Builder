// Шаблон index.html сайта документации — ключ docsifyTemplate в docs/<lang>/.c4builder.
// Внешних ресурсов нет и во встроенном шаблоне c4builder; здесь — только специфика сайта:
// язык страницы (по папке проекта: docs/ru, docs/en), ссылка с названия на лендинг и цвет.
import path from 'node:path';

export default (options) => {
    const lang = path.basename(process.cwd());
    // Название в sidebar ведёт на лендинг своего языка (в _site: ../ — RU, ../en.html — EN).
    const nameLink = lang === 'en' ? '../en.html' : '../';
    const config = { ...options, nameLink, themeColor: '#1168bd' };
    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="UTF-8">
    <title>${options.name}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${options.stylesheet}">
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
