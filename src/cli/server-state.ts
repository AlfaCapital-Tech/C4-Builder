import fs from 'node:fs';
import path from 'node:path';
import { defaultConfig } from '../config/defaults.ts';
import { parseConfig } from '../config/options.ts';
import { LISTENER_NAME } from '../core/feedback.ts';
import { ownerAlive } from '../util/lock.ts';
import { FEEDBACK_HEADER, type MailboxState, PAGE_PATH } from './commands/site.comments.ts';

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

// Ответ `GET /__c4builder/status`: без `-w` агентского режима нет — списки пусты. `project` — realpath
// конфига сервера: по нему клиент отличает сервер своего проекта от сервера соседнего worktree на том
// же порту; null — сервер запущен без конфига (встроен в чужой процесс, тесты): проекта он не сообщает,
// и клиент считает его своим, как явно указанный ему порт.
export interface ServerStatus {
    pid: number;
    port: number;
    version: string;
    watch: boolean;
    project: string | null;
    agent: { on: boolean; name: string };
    listeners: MailboxState[];
    unaddressed: number;
}

export type PortSource = 'flag' | 'state' | 'config';

export const stateFile = (configPath: string): string => `${configPath}.server.json`;

// Идентичность проекта — realpath конфига: симлинки и относительные пути не должны давать «чужой»
// проект. Конфига нет (status вне проекта) — просто абсолютный путь.
export const projectId = (configPath: string): string => {
    try {
        return fs.realpathSync(configPath);
    } catch {
        return path.resolve(configPath);
    }
};

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

export type StatusProbe =
    | { kind: 'status'; status: ServerStatus }
    | { kind: 'refused' }
    // Порт принял соединение, но не ответил за отведённое время: сервер занят (синхронная работа
    // в event loop) или завис.
    | { kind: 'timeout' }
    // Порт отвечает, но не эндпоинтом состояния: старая версия c4builder или чужой процесс.
    | { kind: 'other' };

// Запрос команды CLI (служебный заголовок, без Origin) — иначе сервер ответит 403.
export const probeStatus = async (port: number, timeoutMs = 1000): Promise<StatusProbe> => {
    let res: Response;
    try {
        res = await fetch(`http://${HOST}:${port}${STATUS_PATH}`, {
            headers: { [FEEDBACK_HEADER]: '1' },
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (e) {
        if ((e as Error).name === 'TimeoutError') return { kind: 'timeout' };
        const code = ((e as Error).cause as NodeJS.ErrnoException | undefined)?.code;
        return code === 'ECONNREFUSED' ? { kind: 'refused' } : { kind: 'other' };
    }
    const body = (await res.json().catch(() => undefined)) as ServerStatus | undefined;
    if (res.status === 200 && body && Number.isInteger(body.pid)) return { kind: 'status', status: body };
    return { kind: 'other' };
};

// Сервер из файла состояния: `running` — отвечает тем же pid; `unresponsive` — pid жив, порт принял
// соединение, но ответа нет за таймаут (сервер занят) — для D7 он всё равно работает: второй сервер
// пересобрал бы его dist.
export type LiveServer =
    | { kind: 'running'; state: ServerState; status: ServerStatus }
    | { kind: 'unresponsive'; state: ServerState };

// Живой сервер этого конфига: pid из файла жив И сервер на порту из файла отвечает тем же pid.
// Только kill(pid, 0) — ложное «жив» при переиспользованном pid; только проба порта — не отличить
// сервер соседнего worktree на том же порту. Отказ в соединении при живом pid — pid переиспользован.
export const liveServer = async (configPath: string): Promise<LiveServer | undefined> => {
    const state = readServerState(configPath);
    if (!state || !ownerAlive(state.pid)) return undefined;
    const probe = await probeStatus(state.port);
    if (probe.kind === 'timeout') return { kind: 'unresponsive', state };
    return probe.kind === 'status' && probe.status.pid === state.pid
        ? { kind: 'running', state, status: probe.status }
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

// Что на порту с точки зрения клиента этого проекта — одна классификация для `status`, `feedback` и
// `doctor`, чтобы они не противоречили друг другу:
// - `own` — c4builder этого проекта (тот же realpath конфига), `unresponsive` — он же по файлу
//   состояния, но не ответил вовремя;
// - `other-project` — c4builder другого проекта (соседний worktree на том же порту): не наш;
// - `busy` — чужой процесс, `free` — порт свободен.
export type ServerLookup = { port: number; source: PortSource; url: string } & (
    | { kind: 'own'; status: ServerStatus }
    | { kind: 'unresponsive'; state: ServerState }
    | { kind: 'other-project'; status: ServerStatus }
    | { kind: 'busy' }
    | { kind: 'free' }
);

// Порт клиента: `-p` → живой файл состояния → `webPort` (готовое значение — `webPort`, если конфиг уже
// прочитан). Явный `-p` побеждает файл: человек мог намеренно указать другой порт, но и на нём сервер
// чужого проекта своим не считается.
export const findServer = async (
    configPath: string,
    opts: { port?: number; webPort?: number } = {}
): Promise<ServerLookup> => {
    if (opts.port === undefined) {
        const live = await liveServer(configPath);
        if (live) {
            const at = { port: live.state.port, source: 'state' as const, url: shownUrl(live.state.port) };
            return live.kind === 'running'
                ? { ...at, kind: 'own', status: live.status }
                : { ...at, kind: 'unresponsive', state: live.state };
        }
    }
    const port = opts.port ?? opts.webPort ?? configPort(configPath);
    const at = {
        port,
        source: opts.port === undefined ? ('config' as const) : ('flag' as const),
        url: shownUrl(port)
    };
    const probe = await probeStatus(port);
    if (probe.kind === 'status')
        return probe.status.project === null || probe.status.project === projectId(configPath)
            ? { ...at, kind: 'own', status: probe.status }
            : { ...at, kind: 'other-project', status: probe.status };
    // Не ответил эндпоинтом состояния — чужой процесс (или c4builder до site-server-state).
    return { ...at, kind: probe.kind === 'refused' ? 'free' : 'busy' };
};

// Есть ли на работающем сервере страница change'а — тем же запросом, что у `feedback`.
export const hasChangePage = async (port: number, id: string): Promise<boolean> => {
    if (!LISTENER_NAME.test(id)) return false;
    const res = await fetch(`http://${HOST}:${port}${PAGE_PATH}?as=${id}`, {
        headers: { [FEEDBACK_HEADER]: '1' },
        signal: AbortSignal.timeout(1000)
    }).catch(() => undefined);
    return res?.status === 200;
};
