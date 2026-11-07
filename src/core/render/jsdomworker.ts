import { parentPort } from 'node:worker_threads';

import { BpmnError, renderBpmn } from './bpmnrenderer.ts';
import { MermaidError, renderMermaid } from './mermaidrenderer.ts';

// Точка входа worker-потока offthread.ts. Запросы одного движка приходят по одному (дорожка
// очереди шириной 1), поэтому глобальные подмены mermaid/bpmn-js не пересекаются — как и в
// главном потоке, где обе дорожки тоже чередуются на await.
parentPort?.on('message', async ({ id, engine, source, file }) => {
    try {
        const svg = await (engine === 'mermaid' ? renderMermaid : renderBpmn)(source, file);
        parentPort?.postMessage({ id, svg });
    } catch (err) {
        // Класс ошибки через границу потока не проходит (structured clone даёт голый Error):
        // шлём вид и problems, offthread.ts собирает ту же типизированную ошибку — иначе вывод
        // `site -w` разошёлся бы с check (путь файла дважды, строки без `✗`).
        const kind = err instanceof BpmnError ? 'bpmn' : err instanceof MermaidError ? 'mermaid' : undefined;
        parentPort?.postMessage({
            id,
            error: `${(err as Error)?.message ?? err}`,
            ...(kind ? { kind, problems: (err as BpmnError | MermaidError).problems } : {})
        });
    }
});
