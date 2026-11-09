import chalk from 'chalk';
import { LISTENER_NAME } from '../../core/feedback.ts';
import { findServer } from '../server-state.ts';
import { FEEDBACK_HEADER, FEEDBACK_PATH, PAGE_PATH } from './site.comments.ts';

// `c4builder feedback` (change site-agent-feedback, design D9): забирает пачку замечаний у `site -w`.
// Конфиг читается как JSON без Configstore — тот создал бы `.c4builder` в любом каталоге. Ошибки —
// через exitCode, а не process.exit: напечатанная в pipe пачка должна успеть уйти целиком.
export default async (
    configPath: string,
    opts: { port?: number; wait?: boolean; as?: string }
): Promise<void> => {
    // Имя обязательно и без умолчания (change feedback-mailboxes, D2): с ним два агента со старой
    // инструкцией молча делили бы один ящик. Код 2, а не 1: код 1 инструкции агентов читают как
    // «нет сервера, перезапусти сайт».
    if (!opts.as || !LISTENER_NAME.test(opts.as)) {
        console.error(
            chalk.red(
                '--as <name> is required: name this listener after your change or task (1-64 letters, digits, ".", "_" or "-"), e.g. "c4builder feedback --wait --as add-dark-mode"; use the same name after each batch'
            )
        );
        process.exitCode = 2;
        return;
    }
    // Сервер: `-p` → живой файл состояния → `webPort` (change site-server-state, D6) — сайт мог подняться
    // на другом `-p`, когда порт из конфига занят. Сервер другого проекта на этом порту (соседний worktree)
    // не наш: его пачки — с исходниками чужого дерева.
    const found = await findServer(configPath, { port: opts.port });
    const { port } = found;
    const shown = found.url;
    const fail = (message: string): void => {
        console.error(chalk.red(message));
        process.exitCode = 1;
    };
    // 127.0.0.1, а не localhost: сервер слушает только IPv4, а `localhost` → `::1` на части машин
    // подвешивает соединение.
    const url = `http://127.0.0.1:${port}${FEEDBACK_PATH}/next?as=${opts.as}${opts.wait ? '' : '&wait=0'}`;
    if (found.kind === 'other-project')
        return fail(
            `no c4builder site -w of this project on ${shown} — the port is used by the c4builder site of another project${found.status.project ? ` (${found.status.project})` : ''}; start this project's site with c4builder site -w`
        );
    // Адрес страницы change'а, если имя слушателя — change сайта (change site-agent-review, D6):
    // один запрос до цикла, строка — в stderr, stdout агент читает как пачку. Нет сервера, старый
    // сервер без эндпоинта (404) или не change — молча, дальше цикл скажет своё.
    try {
        const page = await fetch(`http://127.0.0.1:${port}${PAGE_PATH}?as=${opts.as}`, {
            headers: { [FEEDBACK_HEADER]: '1' }
        });
        if (page.status === 200) {
            const body = (await page.json()) as { url?: unknown };
            if (typeof body?.url === 'string') console.error(`Change page: ${shown}${body.url}`);
        }
    } catch {}
    for (;;) {
        let res: Response;
        try {
            res = await fetch(url, { headers: { [FEEDBACK_HEADER]: '1' } });
        } catch {
            return fail(`no c4builder site -w on ${shown} — start it first`);
        }
        if (res.status === 200) {
            process.stdout.write(await res.text());
            return;
        }
        if (res.status === 204) {
            if (opts.wait) continue;
            return;
        }
        if (res.status === 404)
            return fail(
                `agent feedback is disabled on ${shown} — the server runs without -w or with --no-agent`
            );
        const error: unknown = await res.json().then(
            (body) => body?.error,
            () => undefined
        );
        return fail(
            `unexpected response ${res.status} from ${shown}${typeof error === 'string' ? `: ${error}` : ''}`
        );
    }
};
