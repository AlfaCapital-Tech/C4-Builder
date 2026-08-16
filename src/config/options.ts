// Опорные типы конфигурации c4builder. Объявлены здесь (первой группой порта),
// потому что результат getOptions() (BuildOptions) потребляет build() — он
// портируется раньше, чем cli/dispatch, где getOptions() физически живёт.

// Форма файла `.c4builder` (camelCase) — единый тип задаёт zod-схема (config/schema),
// её же валидацией опирается загрузка опций сборки. Ре-экспорт: потребители типа
// (defaults, dispatch) продолжают импортировать его отсюда.
import path from 'node:path';

import { configSchema } from './schema.ts';
import type { C4ConfigFile, PluginEntry } from './schema.ts';
export type { C4ConfigFile, PluginEntry };

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
    USE_SYSTEM_FONTS: boolean;

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
    // Сырой список плагинов из конфига; загружаются и валидируются в cli/dispatch
    // (core/plugins/load) и передаются в build() отдельным аргументом.
    PLUGINS: PluginEntry[];

    // Опциональные/легаси — бывают undefined, потребители защищают их проверками.
    WEB_FILE_NAME?: string;
    EXCLUDE_SIDEBAR_FOLDER_BY_PATH?: string[];
    LEGACY_PLANTUML_VERSION?: string;
    LEGACY_PDF_KEYS?: string[];
    HAS_RUN?: boolean;
}

/** Один невалидный ключ `.c4builder`: имя ключа верхнего уровня, его сырое значение и причина. */
/** Суффикс бэкапа выходного каталога на время сборки (`docs` → `docs_bk`). */
export const DIST_BACKUP_FOLDER_SUFFIX = '_bk';

/** Выходные каталоги сборки (абсолютные): dist и его бэкап — их нельзя ни сканировать, ни наблюдать. */
export const outputDirs = (options: BuildOptions): string[] =>
    [options.DIST_FOLDER, options.DIST_FOLDER + DIST_BACKUP_FOLDER_SUFFIX].map((d) => path.resolve(d));

export interface ConfigIssue {
    key: string;
    value: unknown;
    message: string;
}

/**
 * Результат разбора `.c4builder` zod-схемой (config/schema).
 * - `ok:true`  — конфиг валиден, `value` дополнен дефолтами схемы (путь сборки).
 * - `ok:false` — есть невалидные ключи (`issues`). `salvaged` — тот же конфиг, но с
 *   ВЫБРОШЕННЫМИ битыми ключами: их значения трактуются как «не заданы» (получат
 *   дефолт схемы), чтобы `--list`/визард работали, а визард мог их перезаписать.
 */
export type ConfigParseResult =
    | { ok: true; value: C4ConfigFile }
    | { ok: false; issues: ConfigIssue[]; salvaged: C4ConfigFile };

/**
 * Разбирает сырой объект `.c4builder`, разделяя строгий и щадящий пути. Сам НЕ печатает
 * и НЕ завершает процесс — решение (ошибка+выход либо предупреждение) принимает CLI.
 * Битые ключи определяются по первому сегменту `issue.path`; `salvaged` получается
 * повторным разбором очищенного от них конфига — без дублирования схемы.
 */
export function parseConfig(raw: Record<string, unknown>): ConfigParseResult {
    const parsed = configSchema.safeParse(raw);
    if (parsed.success) return { ok: true, value: parsed.data };

    const issues: ConfigIssue[] = [];
    const brokenKeys = new Set<string>();
    for (const issue of parsed.error.issues) {
        const key = issue.path.length ? String(issue.path[0]) : '(корень)';
        if (brokenKeys.has(key)) continue; // один ключ — одно сообщение (напр. массив с N битых элементов)
        brokenKeys.add(key);
        issues.push({ key, value: raw[key], message: issue.message });
    }

    const cleaned = Object.fromEntries(Object.entries(raw).filter(([k]) => !brokenKeys.has(k)));
    const salvagedParse = configSchema.safeParse(cleaned);
    // cleaned свободен от всех проблемных ключей → валиден; фолбэк на пустой конфиг — страховка.
    const salvaged = salvagedParse.success ? salvagedParse.data : configSchema.parse({});
    return { ok: false, issues, salvaged };
}
