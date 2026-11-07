import fs from 'node:fs';
import http from 'node:http';
import { defaultConfig } from '../config/defaults.ts';
import { parseConfig } from '../config/options.ts';
import { FEEDBACK_HEADER, type MailboxState } from './commands/site.comments.ts';

// Файл состояния dev-сервера (change site-server-state): клиенты CLI (`status`, `feedback`, `doctor`,
// повторный `site`) находят по нему сервер своего проекта без `-p`. Лежит рядом с конфигом, как
// `.lock` и `.cache`: у каждого worktree и у каждого `-c` свой файл, агент может прочитать его сам.

export const STATUS_PATH = '/__c4builder/status';

export interface ServerState {
    port: number;
    url: string;
    pid: number;
    version: string;
    watch: boolean;
    startedAt: string;
}

// Ответ `GET /__c4builder/status`: без `-w` агентского режима нет — списки пусты.
export interface ServerStatus {
    pid: number;
    port: number;
    version: string;
    watch: boolean;
    agent: { on: boolean; name: string };
    listeners: MailboxState[];
    unaddressed: number;
}

export type PortSource = 'flag' | 'state' | 'config';

export const stateFile = (configPath: string): string => `${configPath}.server.json`;

// Сервер слушает только IPv4; `localhost` — лишь в печатаемом адресе, как в `go to`.
const HOST = '127.0.0.1';
export const shownUrl = (port: number): string => `http://localhost:${port}`;

// Запись — во временный файл и rename: читатель не увидит половину JSON. Имя временного файла
// начинается с пути конфига — watch его игнорирует, как и сам файл состояния.
export const writeServerState = (configPath: string, state: ServerState): void => {
    const file = stateFile(configPath);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
        fs.renameSync(tmp, file);
    } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
    }
};

const isPort = (v: unknown): v is number =>
    Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 65535;

// Битый или чужой по форме файл — как отсутствующий: его перезапишет следующий сервер.
export const readServerState = (configPath: string): ServerState | undefined => {
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(fs.readFileSync(stateFile(configPath), 'utf8'));
    } catch {
        return undefined;
    }
    if (!raw || typeof raw !== 'object' || !isPort(raw.port) || !Number.isInteger(raw.pid)) return undefined;
    return {
        port: raw.port,
        url: typeof raw.url === 'string' ? raw.url : shownUrl(raw.port),
        pid: raw.pid as number,
        version: typeof raw.version === 'string' ? raw.version : '',
        watch: raw.watch === true,
        startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : ''
    };
};

// Синхронно — зовётся из обработчика `exit`. Только свой pid: проигравший гонку двух запусков
// не должен удалить файл победителя.
export const removeServerState = (configPath: string, pid = process.pid): void => {
    try {
        if (readServerState(configPath)?.pid === pid) fs.rmSync(stateFile(configPath), { force: true });
    } catch {}
};

// EPERM = процесс есть, но сигналить ему нельзя (чужой пользователь) — жив, как в util/lock.ts.
const pidAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
};

export type StatusProbe =
    | { kind: 'status'; status: ServerStatus }
    | { kind: 'refused' }
    // Порт отвечает, но не эндпоинтом состояния: старая версия c4builder или чужой процесс.
    | { kind: 'other'; code?: number };

// Запрос команды CLI (служебный заголовок, без Origin) — иначе сервер ответит 403.
export const probeStatus = async (port: number, timeoutMs = 1000): Promise<StatusProbe> => {
    let res: Response;
    try {
        res = await fetch(`http://${HOST}:${port}${STATUS_PATH}`, {
            headers: { [FEEDBACK_HEADER]: '1' },
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (e) {
        const code = ((e as Error).cause as NodeJS.ErrnoException | undefined)?.code;
        return code === 'ECONNREFUSED' ? { kind: 'refused' } : { kind: 'other' };
    }
    const body = (await res.json().catch(() => undefined)) as ServerStatus | undefined;
    if (res.status === 200 && body && Number.isInteger(body.pid)) return { kind: 'status', status: body };
    return { kind: 'other', code: res.status };
};

// Чем занят порт: `site -w` отвечает на /__livereload потоком SSE, любой другой ответ — чужой процесс.
// Так узнаём и сервер версии без эндпоинта состояния.
export const probeLivereload = (port: number): Promise<'free' | 'site' | 'busy'> =>
    new Promise((resolve) => {
        const req = http.get({ host: HOST, port, path: '/__livereload', timeout: 1000 }, (res) => {
            resolve(String(res.headers['content-type']).startsWith('text/event-stream') ? 'site' : 'busy');
            req.destroy();
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'ECONNREFUSED' ? 'free' : 'busy'));
    });

// Живой сервер этого конфига: pid из файла жив И сервер на порту из файла отвечает тем же pid.
// Только kill(pid, 0) — ложное «жив» при переиспользованном pid; только проба порта — не отличить
// сервер соседнего worktree на том же порту.
export const liveServer = async (
    configPath: string
): Promise<{ state: ServerState; status: ServerStatus } | undefined> => {
    const state = readServerState(configPath);
    if (!state || !pidAlive(state.pid)) return undefined;
    const probe = await probeStatus(state.port);
    return probe.kind === 'status' && probe.status.pid === state.pid
        ? { state, status: probe.status }
        : undefined;
};

// Конфиг — как JSON без Configstore: тот создал бы `.c4builder` в любом каталоге.
export const configPort = (configPath: string): number => {
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {}
    const config = parseConfig(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
    return Number((config.ok ? config.value : config.salvaged).webPort ?? defaultConfig.webPort);
};

// Порт клиента: `-p` → живой файл состояния → `webPort`. Явный `-p` побеждает файл: человек мог
// намеренно указать другой сервер.
export const resolvePort = async (
    configPath: string,
    flag?: number
): Promise<{ port: number; source: PortSource; live?: { state: ServerState; status: ServerStatus } }> => {
    if (flag !== undefined) return { port: flag, source: 'flag' };
    const live = await liveServer(configPath);
    if (live) return { port: live.state.port, source: 'state', live };
    return { port: configPort(configPath), source: 'config' };
};
