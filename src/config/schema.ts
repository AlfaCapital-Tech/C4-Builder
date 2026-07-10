// Единая zod-схема формы `.c4builder` — единственный источник ключей, типов и
// значений по умолчанию конфигурации (дефолты берутся из `defaultConfig`). На неё
// опирается загрузка опций сборки (`getOptions` в cli/dispatch): сырой конфиг
// валидируется `safeParse` — неверный тип значения отклоняется понятной ошибкой с
// путём ключа, отсутствующие поля дополняются дефолтами.
//
// Строки коэрсятся (`z.coerce.string`: число `webPort` из рукописного конфига → строка),
// булевы поля строгие (`z.boolean`: строка вместо булева — ошибка, а не тихое truthy).
import { z } from 'zod';
import { defaultConfig } from './defaults.ts';

// В JSON-конфиге `null` означает «ключ не задан» (а не строку "null"): гоним его в
// `undefined` до внутренней схемы, чтобы срабатывал `.default`/`.optional`, а не
// `z.coerce.string()` (иначе null → "null") и не строгий тип (иначе null → ошибка).
const nullish = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === null ? undefined : v), s);

export const configSchema = z.object({
    // Базовые поля: опциональны в файле, но с дефолтом из defaultConfig — частичный
    // или пустой конфиг остаётся валидным (недостающее берёт значение по умолчанию).
    homepageName: nullish(z.coerce.string().default(defaultConfig.homepageName)),
    rootFolder: nullish(z.coerce.string().default(defaultConfig.rootFolder)),
    distFolder: nullish(z.coerce.string().default(defaultConfig.distFolder)),
    generateMD: nullish(z.boolean().default(defaultConfig.generateMD)),
    generateCompleteMD: nullish(z.boolean().default(defaultConfig.generateCompleteMD)),
    generateWEB: nullish(z.boolean().default(defaultConfig.generateWEB)),
    includeNavigation: nullish(z.boolean().default(defaultConfig.includeNavigation)),
    includeTableOfContents: nullish(z.boolean().default(defaultConfig.includeTableOfContents)),
    webTheme: nullish(z.coerce.string().default(defaultConfig.webTheme)),
    supportSearch: nullish(z.boolean().default(defaultConfig.supportSearch)),
    repoUrl: nullish(z.coerce.string().default(defaultConfig.repoUrl)),
    executeScript: nullish(z.boolean().default(defaultConfig.executeScript)),
    docsifyTemplate: nullish(z.coerce.string().default(defaultConfig.docsifyTemplate)),
    webPort: nullish(z.coerce.string().default(defaultConfig.webPort)),
    includeBreadcrumbs: nullish(z.boolean().default(defaultConfig.includeBreadcrumbs)),
    includeLinkToDiagram: nullish(z.boolean().default(defaultConfig.includeLinkToDiagram)),
    diagramsOnTop: nullish(z.boolean().default(defaultConfig.diagramsOnTop)),
    embedDiagram: nullish(z.boolean().default(defaultConfig.embedDiagram)),
    excludeOtherFiles: nullish(z.boolean().default(defaultConfig.excludeOtherFiles)),
    generateLocalImages: nullish(z.boolean().default(defaultConfig.generateLocalImages)),
    plantumlServerUrl: nullish(z.coerce.string().default(defaultConfig.plantumlServerUrl)),
    diagramFormat: nullish(z.coerce.string().default(defaultConfig.diagramFormat)),
    d2Layout: nullish(z.coerce.string().default(defaultConfig.d2Layout)),
    charset: nullish(z.coerce.string().default(defaultConfig.charset)),

    // Задаются явно (флаг/промпт) либо тонкой правкой файла — в defaultConfig не входят.
    projectName: nullish(z.coerce.string().optional()),
    webFileName: nullish(z.coerce.string().optional()),
    excludeSidebarFolderByPath: nullish(z.array(z.string()).optional()),
    hasRun: nullish(z.boolean().optional()),

    // Легаси-ключи старых `.c4builder` — читаются лишь для однократного предупреждения.
    plantumlVersion: nullish(z.coerce.string().optional()),
    generatePDF: nullish(z.boolean().optional()),
    generateCompletePDF: nullish(z.boolean().optional()),
    checksums: z.unknown().optional()
});

/**
 * Форма `.c4builder` (camelCase), выведенная из схемы — единый тип ключей файла.
 * Базовые поля обязательны в выводе (их гарантирует дефолт), задаваемые вне
 * дефолтов и легаси-ключи — опциональны.
 */
export type C4ConfigFile = z.infer<typeof configSchema>;
