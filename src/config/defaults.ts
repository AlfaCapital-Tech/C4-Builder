// Единый источник значений по умолчанию проекта. Используется двумя путями:
//  - `c4builder --new --yes` пишет из него полный `.c4builder` (headless-сборка без wizard'а);
//  - интерактивный wizard (`cli.collect.js`) берёт отсюда дефолты своих промптов.
// Так «полный конфиг» и дефолты wizard'а не разъезжаются (см. change new-noninteractive).
// projectName сюда не входит — он всегда задаётся явно (флагом --name или промптом).
// Единый источник формы конфига — zod-схема (config/schema) выводит из этих значений
// и типы, и дефолты; полноту набора ключей гарантируют ссылки `.default(defaultConfig.X)`.
const defaultConfig = {
    homepageName: 'Overview',
    rootFolder: 'src',
    distFolder: 'docs',
    generateMD: true,
    generateCompleteMD: false,
    generateWEB: true,
    includeNavigation: false,
    includeTableOfContents: true,
    webTheme: 'vendor/vue.css',
    supportSearch: true,
    repoUrl: '',
    executeScript: false,
    docsifyTemplate: '',
    webPort: '3000',
    includeBreadcrumbs: true,
    includeLinkToDiagram: false,
    diagramsOnTop: true,
    embedDiagram: false,
    excludeOtherFiles: false,
    generateLocalImages: true,
    plantumlServerUrl: 'https://www.plantuml.com/plantuml',
    diagramFormat: 'svg',
    d2Layout: 'dagre',
    charset: 'UTF-8',
    useSystemFonts: false
};

export { defaultConfig };
