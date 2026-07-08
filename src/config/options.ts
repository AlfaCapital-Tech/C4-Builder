// Опорные типы конфигурации c4builder. Объявлены здесь (первой группой порта),
// потому что результат getOptions() (BuildOptions) потребляет build() — он
// портируется раньше, чем cli/dispatch, где getOptions() физически живёт.

// Форма файла `.c4builder` (camelCase) — единый тип задаёт zod-схема (config/schema),
// её же валидацией опирается загрузка опций сборки. Ре-экспорт: потребители типа
// (defaults, dispatch) продолжают импортировать его отсюда.
export type { C4ConfigFile } from './schema.ts';

/**
 * Опции сборки (SCREAMING_CASE), собираемые `getOptions()` из `.c4builder`.
 * Базовые поля обязательны и не `undefined`: сырой конфиг проходит через zod-схему,
 * которая дополняет отсутствующие поля дефолтами (см. config/schema). Поля-исключения
 * помечены опциональными: их нет в дефолтах и они реально бывают `undefined`.
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
