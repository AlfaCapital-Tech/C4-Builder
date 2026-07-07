// Опорные типы конфигурации c4builder. Объявлены здесь (первой группой порта),
// потому что результат getOptions() (BuildOptions) потребляет build() — он
// портируется раньше, чем cli/dispatch, где getOptions() физически живёт.

/**
 * Ключи файла `.c4builder` (camelCase). Супертип `defaultConfig`: базовые поля
 * обязательны (их пишет `--new --yes`, ими же дефолтится wizard), а задаваемые
 * вне дефолтов и легаси-ключи — опциональны.
 */
export interface C4ConfigFile {
    homepageName: string;
    rootFolder: string;
    distFolder: string;
    generateMD: boolean;
    generateCompleteMD: boolean;
    generateWEB: boolean;
    includeNavigation: boolean;
    includeTableOfContents: boolean;
    webTheme: string;
    supportSearch: boolean;
    repoUrl: string;
    executeScript: boolean;
    docsifyTemplate: string;
    webPort: string;
    includeBreadcrumbs: boolean;
    includeLinkToDiagram: boolean;
    diagramsOnTop: boolean;
    embedDiagram: boolean;
    excludeOtherFiles: boolean;
    generateLocalImages: boolean;
    plantumlServerUrl: string;
    diagramFormat: string;
    charset: string;

    // Задаётся явно (флаг --name / промпт), в defaultConfig не входит.
    projectName?: string;
    // Тонкая настройка, только правкой .c4builder.
    d2Layout?: string;
    webFileName?: string;
    excludeSidebarFolderByPath?: string[];
    hasRun?: boolean;

    // Легаси-ключи старых .c4builder — читаются лишь для однократного предупреждения.
    plantumlVersion?: string;
    generatePDF?: boolean;
    generateCompletePDF?: boolean;
    checksums?: unknown;
}

/**
 * Опции сборки (SCREAMING_CASE), собираемые `getOptions()` из `.c4builder`.
 * Оптимистичный тип: базовые поля обязательны и не `undefined` — wizard и
 * `--new --yes` гарантируют полный конфиг; честная рантайм-валидация неполных
 * (рукописных) конфигов — отдельное звено `zod`. Поля-исключения помечены
 * опциональными: они реально бывают `undefined` и защищены проверками в рантайме.
 */
export interface BuildOptions {
    GENERATE_MD: boolean;
    GENERATE_WEBSITE: boolean;
    GENERATE_COMPLETE_MD_FILE: boolean;
    GENERATE_LOCAL_IMAGES: boolean;
    EMBED_DIAGRAM: boolean;
    INCLUDE_NAVIGATION: boolean;
    INCLUDE_BREADCRUMBS: boolean;
    INCLUDE_TABLE_OF_CONTENTS: boolean;
    INCLUDE_LINK_TO_DIAGRAM: boolean;
    DIAGRAMS_ON_TOP: boolean;
    SUPPORT_SEARCH: boolean;
    EXECUTE_SCRIPT: boolean;
    EXCLUDE_OTHER_FILES: boolean;

    ROOT_FOLDER: string;
    DIST_FOLDER: string;
    PROJECT_NAME: string;
    REPO_NAME: string;
    HOMEPAGE_NAME: string;
    WEB_THEME: string;
    DOCSIFY_TEMPLATE: string;
    CHARSET: string;
    WEB_PORT: string;
    PLANTUML_SERVER_URL: string;
    DIAGRAM_FORMAT: string;
    D2_LAYOUT: string;
    MD_FILE_NAME: string;

    // Опциональные/легаси — бывают undefined, потребители защищают их проверками.
    WEB_FILE_NAME?: string;
    EXCLUDE_SIDEBAR_FOLDER_BY_PATH?: string[];
    LEGACY_PLANTUML_VERSION?: string;
    LEGACY_PDF_KEYS?: string[];
    HAS_RUN?: boolean;
}
