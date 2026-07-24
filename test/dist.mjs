// Единая точка импорта собранного dist/ в тестах: будущая смена раскладки сборки
// (build-split) правится здесь, а не глубокими путями по всем тестам.
export { cachedJava, resolveJava, isPathInside } from '../dist/core/render/jre.js';
export { configSchema, isValidPort } from '../dist/config/schema.js';
export { parseConfig } from '../dist/config/options.js';
export { rasterizeSvgToPng, resvgFontOptions } from '../dist/core/render/pngraster.js';
export { renderArgv, fontCacheTag } from '../dist/core/render/diagrams.js';
export { acquireBuildLock, BuildLockHeldError } from '../dist/util/lock.js';
