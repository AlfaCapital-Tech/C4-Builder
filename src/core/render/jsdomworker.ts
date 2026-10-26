import { parentPort } from 'node:worker_threads';

import { renderBpmn } from './bpmnrenderer.ts';
import { renderMermaid } from './mermaidrenderer.ts';

// Точка входа worker-потока offthread.ts. Запросы одного движка приходят по одному (дорожка
// очереди шириной 1), поэтому глобальные подмены mermaid/bpmn-js не пересекаются — как и в
// главном потоке, где обе дорожки тоже чередуются на await.
parentPort?.on('message', async ({ id, engine, source, file }) => {
    try {
        const svg = await (engine === 'mermaid' ? renderMermaid : renderBpmn)(source, file);
        parentPort?.postMessage({ id, svg });
    } catch (err) {
        parentPort?.postMessage({ id, error: `${(err as Error)?.message ?? err}` });
    }
});
