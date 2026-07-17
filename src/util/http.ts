import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';

// Общий HTTP GET рендер-слоя (embed онлайн-рендера) и JRE-резолвера (скачивание с
// Adoptium). Следует редиректам и держит два таймаута — коннекта и простоя приёма:
// 3xx не роняет сборку, а молча повисший сокет не подвешивает её навсегда. Таймауты
// переопределяются env (в т.ч. для тестов); имена C4BUILDER_JRE_* поддержаны для
// обратной совместимости со старыми знобами JRE-резолвера.
const posInt = (v: string | undefined, dflt: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : dflt;
};
const env = process.env;
const CONNECT_TIMEOUT_MS = posInt(
    env.C4BUILDER_HTTP_CONNECT_TIMEOUT_MS ?? env.C4BUILDER_JRE_CONNECT_TIMEOUT_MS,
    30_000
);
const IDLE_TIMEOUT_MS = posInt(
    env.C4BUILDER_HTTP_IDLE_TIMEOUT_MS ?? env.C4BUILDER_JRE_IDLE_TIMEOUT_MS,
    60_000
);
const MAX_REDIRECTS = 5;

export interface HttpGetOptions {
    headers?: Record<string, string>;
    redirectsLeft?: number;
}

// Возвращает поток успешного (2xx) ответа. Редиректы (assets-эндпоинт Adoptium
// 307-редиректит на github) следуются с лимитом против петель; не-2xx — reject.
export const httpGetStream = (url: string, opts: HttpGetOptions = {}): Promise<IncomingMessage> => {
    const { headers = {}, redirectsLeft = MAX_REDIRECTS } = opts;
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, { headers, timeout: CONNECT_TIMEOUT_MS }, (res) => {
            const status = res.statusCode as number; // ответ всегда со статусом
            const location = res.headers.location;
            if (status >= 300 && status < 400 && location) {
                res.resume();
                if (redirectsLeft <= 0) {
                    return reject(new Error(`Слишком много редиректов (>${MAX_REDIRECTS}) для ${url}`));
                }
                const next = new URL(location, url).toString();
                return resolve(httpGetStream(next, { headers, redirectsLeft: redirectsLeft - 1 }));
            }
            if (status < 200 || status > 299) {
                res.resume();
                return reject(new Error(`Не удалось загрузить ${url}, код ответа: ${status}`));
            }
            // Коннект установлен → с таймаута коннекта переключаемся на таймаут простоя
            // приёма (крупный ответ тянется дольше): молчащий сокет уронит таймаут.
            req.setTimeout(IDLE_TIMEOUT_MS);
            resolve(res);
        });
        req.on('timeout', () => req.destroy(new Error(`Таймаут сети (${url})`)));
        req.on('error', reject);
    });
};

// Тело ответа целиком в Buffer.
export const httpGetBuffer = async (url: string, opts: HttpGetOptions = {}): Promise<Buffer> => {
    const res = await httpGetStream(url, opts);
    const chunks: Buffer[] = [];
    for await (const c of res) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
};

// Тело ответа как JSON.
export const httpGetJson = async (url: string, opts: HttpGetOptions = {}): Promise<unknown> =>
    JSON.parse((await httpGetBuffer(url, opts)).toString('utf8'));
