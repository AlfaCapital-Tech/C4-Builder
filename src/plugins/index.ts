// Реестр встроенных плагинов: имя в `.c4builder` → ленивый импорт модуля. Ленивый —
// чтобы сборка без плагинов не тянула их код и схемы.
import type { Plugin } from '../core/plugins/types.ts';

export const BUILTIN_PLUGINS: Record<string, () => Promise<Plugin>> = {
    openspec: async () => (await import('./openspec/index.ts')).default as Plugin,
    openapi: async () => (await import('./openapi/index.ts')).default as Plugin
};
