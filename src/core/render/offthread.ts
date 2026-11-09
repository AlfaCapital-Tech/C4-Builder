import { Worker } from 'node:worker_threads';

import { DiagramError, type DiagramProblem } from './problem.ts';

// BPMN и mermaid рендерятся в jsdom синхронными кусками до секунды и больше на диаграмму:
// в главном потоке dev-сервера это время молчат HTTP, SSE и события `image`. Здесь — тот
// же конвейер (renderBpmn/renderMermaid) в отдельном worker-потоке: одно окно jsdom на
// движок живёт в нём до teardown, очередь render/diagrams по-прежнему подаёт задачи по одной.

export type OffThreadEngine = 'bpmn' | 'mermaid';

interface Reply {
    id: number;
    svg?: Uint8Array;
    error?: string;
    /** Структура ошибки движка (DiagramError): замечания и их печатные строки (см. jsdomworker.ts). */
    details?: DiagramProblem[];
    problems?: string[];
}

// Ошибка движка из воркера — снова DiagramError: describeRenderError и заглушка читают её так
// же, как у check и обычной сборки (класс BpmnError/MermaidError для этого не нужен).
const engineError = ({ error = '', details, problems }: Reply): Error =>
    details ? new DiagramError(error, details, problems) : new Error(error);

/** Сбой самого worker-потока, а не движка: вход диаграммы тут ни при чём. */
export class RenderWorkerError extends Error {}

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve: (b: Buffer) => void; reject: (e: Error) => void }>();

// Воркер погиб (ошибка загрузки модуля, падение) — отклоняем ждущих и забываем его:
// следующий рендер поднимет новый.
const fail = (err: Error): void => {
    worker = null;
    for (const { reject } of waiting.values()) reject(err);
    waiting.clear();
};

const getWorker = (): Worker => {
    if (worker) return worker;
    // Расширение — как у этого модуля: из dist грузится .js, из исходников — .ts.
    const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
    const w = new Worker(new URL(`./jsdomworker${ext}`, import.meta.url));
    // Процесс держит сервер, а не воркер: одиночный CLI не должен зависать на нём.
    w.unref();
    w.on('message', (reply: Reply) => {
        const job = waiting.get(reply.id);
        if (!job) return;
        waiting.delete(reply.id);
        if (reply.error !== undefined) job.reject(engineError(reply));
        else job.resolve(Buffer.from(reply.svg ?? new Uint8Array()));
    });
    w.on('error', (err: Error) => {
        if (worker === w) fail(new RenderWorkerError(err.message));
    });
    w.on('exit', (code) => {
        if (worker === w) fail(new RenderWorkerError(`diagram render worker exited with code ${code}`));
    });
    worker = w;
    return w;
};

/** renderBpmn / renderMermaid в worker-потоке; ошибка приходит тем же классом и с тем же message. */
export const renderOffThread = (engine: OffThreadEngine, source: string, file: string): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        getWorker().postMessage({ id, engine, source, file });
    });

export const teardownOffThread = async (): Promise<void> => {
    const w = worker;
    // До terminate: обработчик exit уже не узнает воркер, и ждущие повисли бы навсегда.
    fail(new RenderWorkerError('diagram render worker terminated'));
    if (w) await w.terminate();
};
