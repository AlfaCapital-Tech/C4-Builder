// {
//     name: '{{name}}',
//     repo: '',
//     loadSidebar: true,
//     auto2top: true,
//     homepage: 'index.md',
//     plantuml: {
//       skin: 'classic'
//     },
//     stylesheet: ''
//   }
// Параметры по вызову из core/build (generateWebMD): сериализуются целиком в
// window.$docsify, поэтому интерфейс перечисляет весь передаваемый объект.
export interface DocsifyOptions {
    name: string;
    repo: string;
    loadSidebar: boolean;
    auto2top: boolean;
    homepage: string;
    plantuml: { skin: string };
    stylesheet: string;
    alias?: Record<string, string>;
    supportSearch: boolean;
    executeScript: boolean;
}

export default (options: DocsifyOptions): string => {
    return `<!DOCTYPE html>
    <html lang="en">
    
    <head>
        <meta charset="UTF-8">
        <title>${options.name}</title>
        <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1" />
        <meta name="description" content="Description">
        <meta name="viewport"
        content="width=device-width, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0">
        <link rel="stylesheet" href="${options.stylesheet}">
    </head>
    
    <body>
        <div id="app"></div>
        <script>
        window.$docsify = ${JSON.stringify(options, null, 2)};
        </script>
        <script src="vendor/docsify.min.js"></script>
        <script src="vendor/docsify-plantuml.min.js"></script>
        <script src="vendor/zoom-image.min.js"></script>
        ${options.supportSearch ? `<script src="vendor/search.min.js"></script>` : ''}
        ${options.executeScript ? `<script src="vendor/swagger-ui-bundle.js"></script>` : ''}
    </body>
    
    </html>`;
};
