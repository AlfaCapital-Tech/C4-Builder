import { findServer } from '../server-state.ts';

// `c4builder status [--json]` (change site-server-state, D8): работает ли dev-сервер этого проекта.
// Код 0/1 — скилл проверяет сервер одним вызовом вместо curl. Только читает: без Configstore, файлов
// не создаёт и недействительный файл состояния не удаляет — его перезапишет следующий сервер.
export default async (configPath: string, opts: { port?: number; json?: boolean }): Promise<void> => {
    const found = await findServer(configPath, { port: opts.port });
    const { port, source, url } = found;
    // Не отвечающий вовремя сервер из файла — работает (pid жив, порт занят им): второй не поднять,
    // и `running: false` отправило бы агента запускать его.
    const running = found.kind === 'own' || found.kind === 'unresponsive';
    process.exitCode = running ? 0 : 1;

    if (opts.json) {
        const report =
            found.kind === 'own'
                ? {
                      running,
                      url,
                      port,
                      source,
                      pid: found.status.pid,
                      version: found.status.version,
                      watch: found.status.watch,
                      agent: found.status.agent,
                      listeners: found.status.listeners,
                      unaddressed: found.status.unaddressed
                  }
                : found.kind === 'unresponsive'
                  ? {
                        running,
                        responding: false,
                        url,
                        port,
                        source,
                        pid: found.state.pid,
                        version: found.state.version,
                        watch: found.state.watch
                    }
                  : {
                        running,
                        port,
                        source,
                        busy: found.kind !== 'free',
                        ...(found.kind === 'other-project' && { otherProject: found.status.project })
                    };
        console.log(JSON.stringify(report, null, 2));
        return;
    }
    switch (found.kind) {
        case 'free':
            console.log(`no c4builder site on ${url} — start it with c4builder site -w`);
            return;
        case 'busy':
            console.log(`no c4builder site on ${url} — the port is in use by another process`);
            return;
        case 'other-project':
            console.log(
                `no c4builder site of this project on ${url} — the port is used by the c4builder site of another project${found.status.project ? ` (${found.status.project})` : ''}`
            );
            return;
        case 'unresponsive':
            console.log(
                `site is running at ${url} (pid ${found.state.pid}) but did not answer in time — it may be busy; run c4builder status again`
            );
            return;
    }
    const { status } = found;
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
