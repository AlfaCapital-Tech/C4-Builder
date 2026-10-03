// Единая точка импорта собранного dist/ в тестах: будущая смена раскладки сборки
// (build-split) правится здесь, а не глубокими путями по всем тестам.
export { cachedJava, resolveJava } from '../dist/core/render/jre.js';
export { isPathInside } from '../dist/util/archive.js';
export { configSchema, isValidPort } from '../dist/config/schema.js';
export { parseConfig } from '../dist/config/options.js';
export { defaultConfig } from '../dist/config/defaults.js';
export { rasterizeSvgToPng, resvgFontOptions } from '../dist/core/render/pngraster.js';
export { renderArgv, fontCacheTag, renderKey } from '../dist/core/render/diagrams.js';
export { acquireBuildLock, BuildLockHeldError } from '../dist/util/lock.js';
export { loadPlugins, expandEnv, pluginWatchPaths } from '../dist/core/plugins/load.js';
export { addPage, isVirtual } from '../dist/core/plugins/tree.js';
export { injectHtml, injectPluginAssets } from '../dist/core/plugins/assets.js';
export { resolveSource, tlsHint } from '../dist/core/plugins/source.js';
export { extractZip, extractTarGz } from '../dist/util/archive.js';
export { BUILTIN_PLUGINS } from '../dist/plugins/index.js';
export { createFenceExtractor, mapOutsideFences } from '../dist/core/scan/fences.js';
export { foldIncludes, clearIncludeCache } from '../dist/core/scan/tree.js';
export { foldD2Imports, d2LocalImports, clearD2FileCache } from '../dist/core/render/d2renderer.js';
export { generateLlmsFull } from '../dist/core/compose/markdown.js';
export {
    BpmnError,
    BPMN_CACHE_PACKAGES,
    layoutBpmn,
    lintBpmn,
    parseBpmn,
    renderBpmn,
    teardownBpmn
} from '../dist/core/render/bpmnrenderer.js';
