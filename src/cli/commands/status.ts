import { probeLivereload, probeStatus, resolvePort, type ServerStatus, shownUrl } from '../server-state.ts';

// `c4builder status [--json]` (change site-server-state, D8): работает ли dev-сервер этого проекта.
// Код 0/1 — скилл проверяет сервер одним вызовом вместо curl. Только читает: без Configstore, файлов
// не создаёт и недействительный файл состояния не удаляет — его перезапишет следующий сервер.
export default async (configPath: string, opts: { port?: number; json?: boolean }): Promise<void> => {
    const { port, source, live } = await resolvePort(configPath, opts.port);
    const url = shownUrl(port);
    // Файла нет (или он недействителен) — спрашиваем порт напрямую: сервер мог не записать файл
    // (каталог только для чтения) или запущен с другим `-c`.
    let status: ServerStatus | undefined = live?.status;
    let running = !!status;
    let busy = false;
    if (!status) {
        const probe = await probeStatus(port);
        if (probe.kind === 'status') {
            status = probe.status;
            running = true;
        } else if (probe.kind === 'other') {
            // Сервер версии без эндпоинта состояния узнаём по SSE на /__livereload — без подробностей.
            running = (await probeLivereload(port)) === 'site';
            busy = !running;
        }
    }
    process.exitCode = running ? 0 : 1;

    if (opts.json) {
        const report = !running
            ? { running, port, source, busy }
            : status
              ? {
                    running,
                    url,
                    port,
                    source,
                    pid: status.pid,
                    version: status.version,
                    watch: status.watch,
                    agent: status.agent,
                    listeners: status.listeners,
                    unaddressed: status.unaddressed
                }
              : { running, url, port, source };
        console.log(JSON.stringify(report, null, 2));
        return;
    }
    if (!running) {
        console.log(
            busy
                ? `no c4builder site on ${url} — the port is in use by another process`
                : `no c4builder site on ${url} — start it with c4builder site -w`
        );
        return;
    }
    if (!status) {
        console.log(`site is running at ${url} (an older c4builder without status details)`);
        return;
    }
    const lines = [
        `site is running at ${url} (pid ${status.pid}, c4builder ${status.version}${status.watch ? ', watch' : ''})`,
        status.agent.on
            ? `agent mode: on${status.agent.name ? ` (${status.agent.name})` : ''}`
            : 'agent mode: off'
    ];
    if (status.listeners.length) {
        lines.push('listeners:');
        for (const l of status.listeners) lines.push(`  ${l.name} — ${l.state}, ${l.queued} queued`);
    } else if (status.watch) lines.push('listeners: none');
    if (status.unaddressed) lines.push(`unaddressed batches: ${status.unaddressed}`);
    console.log(lines.join('\n'));
};
