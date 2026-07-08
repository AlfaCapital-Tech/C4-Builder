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

export const configSchema = z.object({
    // Базовые поля: опциональны в файле, но с дефолтом из defaultConfig — частичный
    // или пустой конфиг остаётся валидным (недостающее берёт значение по умолчанию).
    homepageName: z.coerce.string().default(defaultConfig.homepageName),
    rootFolder: z.coerce.string().default(defaultConfig.rootFolder),
    distFolder: z.coerce.string().default(defaultConfig.distFolder),
    generateMD: z.boolean().default(defaultConfig.generateMD),
    generateCompleteMD: z.boolean().default(defaultConfig.generateCompleteMD),
    generateWEB: z.boolean().default(defaultConfig.generateWEB),
    includeNavigation: z.boolean().default(defaultConfig.includeNavigation),
    includeTableOfContents: z.boolean().default(defaultConfig.includeTableOfContents),
    webTheme: z.coerce.string().default(defaultConfig.webTheme),
    supportSearch: z.boolean().default(defaultConfig.supportSearch),
    repoUrl: z.coerce.string().default(defaultConfig.repoUrl),
    executeScript: z.boolean().default(defaultConfig.executeScript),
    docsifyTemplate: z.coerce.string().default(defaultConfig.docsifyTemplate),
    webPort: z.coerce.string().default(defaultConfig.webPort),
    includeBreadcrumbs: z.boolean().default(defaultConfig.includeBreadcrumbs),
    includeLinkToDiagram: z.boolean().default(defaultConfig.includeLinkToDiagram),
    diagramsOnTop: z.boolean().default(defaultConfig.diagramsOnTop),
    embedDiagram: z.boolean().default(defaultConfig.embedDiagram),
    excludeOtherFiles: z.boolean().default(defaultConfig.excludeOtherFiles),
    generateLocalImages: z.boolean().default(defaultConfig.generateLocalImages),
    plantumlServerUrl: z.coerce.string().default(defaultConfig.plantumlServerUrl),
    diagramFormat: z.coerce.string().default(defaultConfig.diagramFormat),
    charset: z.coerce.string().default(defaultConfig.charset),

    // Задаются явно (флаг/промпт) либо тонкой правкой файла — в defaultConfig не входят.
    projectName: z.coerce.string().optional(),
    d2Layout: z.coerce.string().optional(),
    webFileName: z.coerce.string().optional(),
    excludeSidebarFolderByPath: z.array(z.string()).optional(),
    hasRun: z.boolean().optional(),

    // Легаси-ключи старых `.c4builder` — читаются лишь для однократного предупреждения.
    plantumlVersion: z.coerce.string().optional(),
    generatePDF: z.boolean().optional(),
    generateCompletePDF: z.boolean().optional(),
    checksums: z.unknown().optional()
});

/**
 * Форма `.c4builder` (camelCase), выведенная из схемы — единый тип ключей файла.
 * Базовые поля обязательны в выводе (их гарантирует дефолт), задаваемые вне
 * дефолтов и легаси-ключи — опциональны.
 */
export type C4ConfigFile = z.infer<typeof configSchema>;
