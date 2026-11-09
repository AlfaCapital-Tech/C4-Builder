// Единая точка импорта собранного dist/ в тестах: будущая смена раскладки сборки
// (build-split) правится здесь, а не глубокими путями по всем тестам.
export { cachedJava, detectSystemJava, resolveJava } from '../dist/core/render/jre.js';
export { isPathInside } from '../dist/util/archive.js';
export { watchTree } from '../dist/util/watch.js';
export { commentsLog, configSchema, configWarnings, isValidPort } from '../dist/config/schema.js';
export { parseConfig } from '../dist/config/options.js';
export { defaultConfig } from '../dist/config/defaults.js';
export { rasterizeSvgToPng, resvgFontOptions } from '../dist/core/render/pngraster.js';
export { textWidth } from '../dist/core/render/textmetrics.js';
export {
    renderArgv,
    fontCacheTag,
    renderKey,
    DiagramQueue,
    generateImages,
    pendingPlaceholderSvg,
    plantUmlFailure,
    PlantUmlInputError
} from '../dist/core/render/diagrams.js';
export { build } from '../dist/core/build.js';
export {
    describeRenderError,
    DiagramBuildError,
    placeholderText,
    VERBOSE_HINT
} from '../dist/core/render/errors.js';
export { exitAfterWrite } from '../dist/util/exit.js';
export { debugEnabled } from '../dist/cli/verbose.js';
export { teardownD2 } from '../dist/core/render/d2renderer.js';
export { renderOffThread, teardownOffThread } from '../dist/core/render/offthread.js';
export { acquireBuildLock, BuildLockHeldError, waitBuildLock } from '../dist/util/lock.js';
export { loadPlugins, expandEnv, pluginWatchPaths } from '../dist/core/plugins/load.js';
export { addPage, addRedirect, isVirtual, redirectKey } from '../dist/core/plugins/tree.js';
export { injectHtml, injectSiteAssets } from '../dist/core/plugins/assets.js';
export { resolveSource, tlsHint } from '../dist/core/plugins/source.js';
export { extractZip, extractTarGz } from '../dist/util/archive.js';
export { BUILTIN_PLUGINS } from '../dist/plugins/index.js';
export { DIAGRAM_ZOOM_JS, REDIRECTS_JS, STORAGE_GUARD_JS } from '../dist/core/compose/site.scripts.js';
export { createFenceExtractor, mapOutsideCode, mapOutsideFences } from '../dist/core/scan/fences.js';
export { embedFigmaImages } from '../dist/plugins/figma/index.js';
export { artifactColumnValues } from '../dist/plugins/openspec/render.js';
export { CHANGES_FILTER_JS } from '../dist/plugins/openspec/filter.script.js';
export {
    foldIncludes,
    clearIncludeCache,
    engineForFile,
    diagramBaseName,
    diagramExt
} from '../dist/core/scan/tree.js';
export {
    foldD2Imports,
    d2LocalImports,
    clearD2FileCache,
    D2Error,
    renderD2
} from '../dist/core/render/d2renderer.js';
export {
    errorDiagnostics,
    locate,
    toDiagnostic,
    uniqueDiagnostics
} from '../dist/cli/commands/check.problems.js';
export { formatGithub, formatGitlab, formatJson, reportBase } from '../dist/cli/commands/check.report.js';
export { DiagramError, problemText } from '../dist/core/render/problem.js';
export { diagramRefRegex, generateLlmsFull, stripEmbeddedImages } from '../dist/core/compose/markdown.js';
export { compareVersions, newestVersion } from '../dist/cli/update.js';
export { detectAgent } from '../dist/cli/agent.js';
export { installKind, nodeCheck } from '../dist/cli/commands/doctor.js';
export { default as cmdSite } from '../dist/cli/commands/site.js';
export {
    readServerState,
    removeServerState,
    findServer,
    liveServer,
    stateFile,
    writeServerState
} from '../dist/cli/server-state.js';
export { UI_STRINGS } from '../dist/cli/commands/site.i18n.js';
export { batchSchema, formatBatch } from '../dist/core/feedback.js';
export {
    deleteRemark,
    fillCells,
    findReviewFile,
    isReviewFile,
    parseRemarks,
    remarkVars,
    writeRemark
} from '../dist/core/reviewlog.js';
export {
    BpmnError,
    BPMN_CACHE_PACKAGES,
    layoutBpmn,
    lintBpmn,
    parseBpmn,
    renderBpmn,
    teardownBpmn
} from '../dist/core/render/bpmnrenderer.js';
export { appendRow, formatEntry, removeRow, writeRow } from '../dist/core/sections.js';
export {
    MermaidError,
    MERMAID_PACKAGE,
    renderMermaid,
    teardownMermaid
} from '../dist/core/render/mermaidrenderer.js';
export { renderChange, renderMarkdown } from '../dist/plugins/openspec/render.js';
export {
    WireflowError,
    WIREFLOW_VERSIONS,
    layoutWireflow,
    parseWireflow,
    renderWireflow,
    renderWireflowSvg,
    wireflowCatalogVersion
} from '../dist/core/render/wireflowrenderer.js';
export { getBezierPath, getSmoothStepPath } from '../dist/core/render/xyflowpaths.js';
