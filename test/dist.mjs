// Единая точка импорта собранного dist/ в тестах: будущая смена раскладки сборки
// (build-split) правится здесь, а не глубокими путями по всем тестам.
export { cachedJava, resolveJava } from '../dist/core/render/jre.js';
export { isPathInside } from '../dist/util/archive.js';
export { configSchema, isValidPort } from '../dist/config/schema.js';
export { parseConfig } from '../dist/config/options.js';
export { rasterizeSvgToPng, resvgFontOptions } from '../dist/core/render/pngraster.js';
export { renderArgv, fontCacheTag } from '../dist/core/render/diagrams.js';
export { acquireBuildLock, BuildLockHeldError } from '../dist/util/lock.js';
export { loadPlugins, expandEnv, pluginWatchPaths } from '../dist/core/plugins/load.js';
export { addPage, isVirtual } from '../dist/core/plugins/tree.js';
export { injectHtml, injectPluginAssets } from '../dist/core/plugins/assets.js';
export { resolveSource } from '../dist/core/plugins/source.js';
export { extractZip, extractTarGz } from '../dist/util/archive.js';
export { globToRegExp, globFiles } from '../dist/util/glob.js';
export { BUILTIN_PLUGINS } from '../dist/plugins/index.js';
