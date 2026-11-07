// Единая zod-схема формы `.c4builder` — единственный источник ключей, типов и
// значений по умолчанию конфигурации (дефолты берутся из `defaultConfig`). На неё
// опирается загрузка опций сборки (`getOptions` в cli/dispatch): сырой конфиг
// валидируется `safeParse` — неверный тип значения отклоняется понятной ошибкой с
// путём ключа, отсутствующие поля дополняются дефолтами.
//
// Числа в строковых полях коэрсятся (`webPort: 8000` из рукописного конфига → строка),
// булевы поля строгие (`z.boolean`: строка вместо булева — ошибка, а не тихое truthy).
import { z } from 'zod';
import { defaultConfig } from './defaults.ts';

// В JSON-конфиге `null` означает «ключ не задан» (а не строку "null"): гоним его в
// `undefined` до внутренней схемы, чтобы срабатывал `.default`/`.optional`, а не строгий тип.
const nullish = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === null ? undefined : v), s);

// Строковое поле: null И false = «не задано» → дефолт (false — легаси-идиома отключения,
// напр. `docsifyTemplate: false` в конфигах 0.2.x); число коэрсится в строку. Прочие типы
// (true, объекты) — понятная ошибка, а не тихая строка 'true' (z.coerce.string превращал
// false в 'false', и сборка падала на require('<cwd>/false')).
const strPre = (v: unknown): unknown =>
    v === null || v === false ? undefined : typeof v === 'number' ? String(v) : v;
const str = (def: string) => z.preprocess(strPre, z.string().default(def));
const optStr = () => z.preprocess(strPre, z.string().optional());
const bool = (def: boolean) => nullish(z.boolean().default(def));
const optBool = () => nullish(z.boolean().optional());

// TCP-порт: нечисловая строка ('30OO') иначе доехала бы до app.listen(), который
// трактует её как имя unix-сокета. Экспортируется для проверки CLI-флага -p.
export const isValidPort = (s: string): boolean => /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 65535;

// Поля журнала комментариев — общие для ключа `comments` и его прежнего имени `reviewLog`.
// `heading` — один заголовок или список (шаблоны разных схем называют раздел по-разному):
// пишется в первый найденный в файле, нет ни одного — создаётся первый. `cells` — шаблон ячеек
// с подстановками `{comment}`, `{quote}`, `{text}`, `{section}`, `{artifact}`, `{page}`,
// `{author}`, `{date}`, `{number}`; `author` — вместо git user.name; `enabled: false` выключает
// кнопку, не удаляя настройку.
const commentsLogFields = {
    enabled: bool(true),
    file: str('review.md'),
    heading: z.preprocess(
        (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.map(String) : strPre(v)),
        z.array(z.string().min(1)).min(1).default(['Review'])
    ),
    cells: nullish(
        z.preprocess(
            (v) => (Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))) : v),
            z.array(z.string()).optional()
        )
    ),
    author: optStr()
};

export const configSchema = z.object({
    // Базовые поля: опциональны в файле, но с дефолтом из defaultConfig — частичный
    // или пустой конфиг остаётся валидным (недостающее берёт значение по умолчанию).
    homepageName: str(defaultConfig.homepageName),
    rootFolder: str(defaultConfig.rootFolder),
    distFolder: str(defaultConfig.distFolder),
    generateMD: bool(defaultConfig.generateMD),
    generateCompleteMD: bool(defaultConfig.generateCompleteMD),
    generateWEB: bool(defaultConfig.generateWEB),
    // Намеренно не defaultConfig.generateLLMS: отсутствующий ключ = выкл — легаси-конфиги
    // не меняют вывод. Новые проекты получают true из defaultConfig (new --yes, wizard).
    generateLLMS: bool(false),
    includeNavigation: bool(defaultConfig.includeNavigation),
    includeTableOfContents: bool(defaultConfig.includeTableOfContents),
    webTheme: str(defaultConfig.webTheme),
    supportSearch: bool(defaultConfig.supportSearch),
    // Сворачивание разделов sidebar (вендорный docsify-sidebar-collapse); false — прежнее
    // полностью развёрнутое дерево (change sidebar-collapse).
    sidebarCollapse: bool(defaultConfig.sidebarCollapse),
    repoUrl: str(defaultConfig.repoUrl),
    executeScript: bool(defaultConfig.executeScript),
    docsifyTemplate: str(defaultConfig.docsifyTemplate),
    webPort: z.preprocess(
        strPre,
        z
            .string()
            .refine(isValidPort, 'expected a TCP port: an integer 1..65535')
            .default(defaultConfig.webPort)
    ),
    includeBreadcrumbs: bool(defaultConfig.includeBreadcrumbs),
    includeLinkToDiagram: bool(defaultConfig.includeLinkToDiagram),
    diagramsOnTop: bool(defaultConfig.diagramsOnTop),
    embedDiagram: bool(defaultConfig.embedDiagram),
    excludeOtherFiles: bool(defaultConfig.excludeOtherFiles),
    generateLocalImages: bool(defaultConfig.generateLocalImages),
    plantumlServerUrl: str(defaultConfig.plantumlServerUrl),
    diagramFormat: str(defaultConfig.diagramFormat),
    d2Layout: str(defaultConfig.d2Layout),
    charset: str(defaultConfig.charset),
    useSystemFonts: bool(defaultConfig.useSystemFonts),
    // Журнал комментариев (change site-review-log, ключ переименован в site-button-names): кнопка
    // «Comment» на странице `site -w` дописывает комментарий строкой таблицы в раздел `heading`
    // ближайшего `file` от исходника страницы вверх по дереву. Поля — см. `commentsLogFields`.
    // Нет ключа — кнопки нет.
    comments: nullish(z.object(commentsLogFields).optional()),
    // Прежнее имя ключа `comments`: читается, только если `comments` нет (см. `commentsLog`).
    // `label` — прежний способ подписать кнопку, ниже `buttons.comment` по приоритету.
    reviewLog: nullish(z.object({ ...commentsLogFields, label: optStr() }).optional()),
    // Свои подписи кнопок у выделения в `site -w` (change site-button-names): `agent` — кнопка
    // агенту, `comment` — кнопка журнала (перекрывает старый `reviewLog.label`). Одна строка на все
    // языки интерфейса: проект обычно пишет на одном языке, а подписи по умолчанию и так
    // переводит словарь. Пусто или нет ключа — подпись словаря.
    buttons: nullish(
        z
            .object({
                agent: optStr(),
                comment: optStr()
            })
            .default({})
    ),
    // Язык интерфейса страницы `site -w`; `auto` — по языку браузера (change site-ui-language).
    uiLanguage: z.preprocess(
        strPre,
        z.enum(['auto', 'en', 'ru'], 'expected auto, en or ru').default(defaultConfig.uiLanguage)
    ),

    // Задаются явно (флаг/промпт) либо тонкой правкой файла — в defaultConfig не входят.
    projectName: optStr(),
    webFileName: optStr(),
    // Не-строки внутри массива молча отбрасываются (совместимость с master: null среди
    // путей не валит сборку) — runtime дальше работает с чистым string[].
    excludeSidebarFolderByPath: nullish(
        z.preprocess(
            (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : v),
            z.array(z.string()).optional()
        )
    ),
    hasRun: optBool(),

    // Плагины сборки: `"имя"` либо `["имя", {опции}]`. Опции здесь не валидируются —
    // это делает схема самого плагина при загрузке (core/plugins/load); верхний уровень
    // проверяет лишь форму записи, чтобы ошибка называла `plugins` и позицию.
    plugins: nullish(
        z
            .array(
                z.union([z.string(), z.tuple([z.string(), z.record(z.string(), z.unknown())])], {
                    error: 'expected "name" or ["name", {options}]'
                })
            )
            .default([])
    ),

    // Легаси-ключи старых `.c4builder` — читаются лишь для однократного предупреждения.
    plantumlVersion: optStr(),
    generatePDF: optBool(),
    generateCompletePDF: optBool(),
    checksums: z.unknown().optional()
});

/**
 * Форма `.c4builder` (camelCase), выведенная из схемы — единый тип ключей файла.
 * Базовые поля обязательны в выводе (их гарантирует дефолт), задаваемые вне
 * дефолтов и легаси-ключи — опциональны.
 */
export type C4ConfigFile = z.infer<typeof configSchema>;

/** Одна запись `plugins` в `.c4builder`: идентификатор либо пара [идентификатор, опции]. */
export type PluginEntry = C4ConfigFile['plugins'][number];

/**
 * Журнал комментариев из конфига: ключ `comments`, без него — прежний `reviewLog`. При обоих
 * действует `comments` целиком, без слияния полей: иначе непонятно, откуда взялся `file`.
 * `label` берётся из `reviewLog` в любом случае — это прежняя подпись кнопки, а не настройка
 * журнала (ниже `buttons.comment` по приоритету). `enabled: false` — журнала нет.
 */
export const commentsLog = (
    c: Pick<C4ConfigFile, 'comments' | 'reviewLog'>
): (NonNullable<C4ConfigFile['comments']> & { label?: string }) | undefined => {
    const log = c.comments ?? c.reviewLog;
    if (!log || log.enabled === false) return undefined;
    const { label: _, ...fields } = log as NonNullable<C4ConfigFile['reviewLog']>;
    const label = c.reviewLog?.label;
    return label ? { ...fields, label } : fields;
};
