import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';

import type { BuildOptions, PluginEntry } from '../../config/options.ts';
import { BUILTIN_PLUGINS } from '../../plugins/index.ts';
import type { LoadedPlugin, Plugin } from './types.ts';

// Подстановка `${NAME}` из окружения во всех строках опций (рекурсивно). Незаданная
// переменная → пустая строка: так `headers: { 'PRIVATE-TOKEN': '${GITLAB_TOKEN}' }`
// без токена даёт пустой заголовок, который резолвер источников отбрасывает.
export const expandEnv = (value: unknown): unknown => {
    if (typeof value === 'string')
        return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] ?? '');
    if (Array.isArray(value)) return value.map(expandEnv);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandEnv(v)]));
    return value;
};

const isPathId = (id: string): boolean => id.startsWith('./') || id.startsWith('../') || path.isAbsolute(id);

// Идентификатор → модуль плагина: встроенный по имени → путь от cwd → npm-пакет,
// резолвится от cwd проекта (а не от установки c4builder — глобальный бинарь иначе
// не видел бы локальные node_modules).
const importPlugin = async (id: string, cwd: string): Promise<Plugin> => {
    if (Object.hasOwn(BUILTIN_PLUGINS, id)) return BUILTIN_PLUGINS[id]();
    let mod: unknown;
    if (isPathId(id)) {
        mod = await import(pathToFileURL(path.resolve(cwd, id)).href);
    } else {
        const require = createRequire(path.join(cwd, 'package.json'));
        let resolved: string;
        try {
            resolved = require.resolve(id);
        } catch (e) {
            throw new Error(
                `не найден ни среди встроенных (${Object.keys(BUILTIN_PLUGINS).join(', ')}), ` +
                    `ни как npm-пакет от ${cwd}: ${(e as Error).message}`
            );
        }
        mod = await import(pathToFileURL(resolved).href);
    }
    const plugin = (mod as { default?: unknown }).default ?? mod;
    if (!plugin || typeof plugin !== 'object' || typeof (plugin as Plugin).name !== 'string')
        throw new Error('модуль должен экспортировать по умолчанию объект плагина с полем name');
    return plugin as Plugin;
};

/**
 * Загружает плагины из `plugins` конфига: резолв, импорт, подстановка окружения и
 * валидация опций схемой плагина. Fail-fast — любая ошибка прерывает до старта сборки
 * с указанием позиции записи и имени плагина. `requires.executeScript` включает
 * `EXECUTE_SCRIPT` в опциях сборки (с одной строкой в лог, если ключ был выключен).
 */
export const loadPlugins = async (
    entries: PluginEntry[],
    cwd: string,
    options: BuildOptions
): Promise<LoadedPlugin[]> => {
    const loaded: LoadedPlugin[] = [];
    for (const [i, entry] of entries.entries()) {
        const [id, rawOpts] = typeof entry === 'string' ? [entry, {}] : entry;
        let plugin: Plugin;
        try {
            plugin = await importPlugin(id, cwd);
        } catch (e) {
            throw new Error(`plugins[${i}] "${id}": ${(e as Error).message}`);
        }
        let opts = expandEnv(rawOpts);
        if (plugin.options) {
            const parsed = plugin.options.safeParse(opts);
            if (!parsed.success) {
                const issues = parsed.error.issues.map(
                    (iss) => `${iss.path.length ? iss.path.join('.') : '(опции)'} — ${iss.message}`
                );
                throw new Error(`plugins[${i}] ${plugin.name}: ${issues.join('; ')}`);
            }
            opts = parsed.data;
        }
        if (plugin.requires?.executeScript && !options.EXECUTE_SCRIPT) {
            options.EXECUTE_SCRIPT = true;
            console.log(chalk.gray(`плагин ${plugin.name} требует executeScript — включён для этой сборки`));
        }
        loaded.push({ plugin, opts });
    }
    return loaded;
};

/** Существующие пути наблюдения всех плагинов (абсолютные); несуществующие — предупреждение. */
export const pluginWatchPaths = (
    plugins: LoadedPlugin[],
    cwd: string,
    exists: (p: string) => boolean
): string[] =>
    plugins.flatMap(({ plugin, opts }) =>
        (plugin.watchPaths?.(opts) ?? [])
            .map((p) => path.resolve(cwd, p))
            .filter((p) => {
                if (exists(p)) return true;
                console.log(chalk.yellow(`плагин ${plugin.name}: путь наблюдения не существует — ${p}`));
                return false;
            })
    );
