// Контракт плагина сборки. Плагин — ESM-модуль с default-экспортом объекта
// `definePlugin({...})`: декларации (схема опций, ассеты сайта, пути наблюдения,
// требования к сборке) и два хука — `afterScan` (виртуальные страницы в дереве до
// рендера) и `afterBuild` (после генерации выходов). Больше точек расширения не
// вводим, пока нет второго потребителя: две покрывают страницы, ассеты и проверки.
import type { z } from 'zod';
import type { BuildOptions } from '../../config/options.ts';
import type { TreeItem } from '../scan/tree.ts';

/** Источник данных плагина: локальная папка либо HTTP(S)-архив (tar.gz/zip). */
export interface SourceSpec {
    dir?: string;
    archive?: string;
    /** Подкаталог внутри распакованного архива (после снятия единственного корневого каталога). */
    subdir?: string;
    /** HTTP-заголовки запроса архива; пустые значения (незаданный `${ENV}`) отбрасываются. */
    headers?: Record<string, string>;
}

/** Диаграмма виртуальной страницы: имя файла с расширением движка (`.puml`/`.d2`) и исходник. */
export interface PageDiagram {
    file: string;
    content: string;
}

/** Виртуальная страница: путь сегментами от корня сайта, markdown и диаграммы. */
export interface PageSpec {
    path: string[];
    markdown?: string | string[];
    diagrams?: PageDiagram[];
}

export interface ScanCtx {
    tree: TreeItem[];
    options: BuildOptions;
    /** Добавить виртуальную страницу; недостающие промежуточные разделы создаются сами. */
    addPage(page: PageSpec): TreeItem;
    /** Резолв источника в локальный каталог (архив скачивается и кэшируется на процесс). */
    source(spec: SourceSpec): Promise<string>;
}

export interface BuildCtx {
    distFolder: string;
    options: BuildOptions;
}

export interface Plugin<O = unknown> {
    name: string;
    /** Схема опций; для встроенных плагинов — строгая (неизвестный ключ = ошибка). */
    options?: z.ZodType<O>;
    /** Дополнительные пути для watch-режима (относительно cwd либо абсолютные). */
    watchPaths?: (opts: O) => string[];
    /** Абсолютные пути файлов, копируемых в `dist/vendor/plugins/<name>/` и подключаемых в index.html. */
    assets?: { scripts?: string[]; styles?: string[] };
    requires?: { executeScript?: boolean };
    afterScan?: (ctx: ScanCtx, opts: O) => Promise<void> | void;
    afterBuild?: (ctx: BuildCtx, opts: O) => Promise<void> | void;
}

/** Identity ради вывода типа опций из схемы. */
export const definePlugin = <O>(plugin: Plugin<O>): Plugin<O> => plugin;

/** Плагин после загрузки: модуль + провалидированные опции. */
export interface LoadedPlugin {
    plugin: Plugin;
    opts: unknown;
}
