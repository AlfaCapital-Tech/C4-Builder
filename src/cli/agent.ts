// Агентский режим `site -w` (change site-agent-feedback, design D2): порядок как у plannotator —
// флаги, своя переменная, переменные известных агентов. `explicit` — решение принято флагом или
// C4BUILDER_AGENT: явно выключенный режим не включается подключением `c4builder feedback`.
export interface AgentMode {
    on: boolean;
    name: string;
    explicit: boolean;
}

const AGENT_VARS: [string, string][] = [
    ['CLAUDECODE', 'claude-code'],
    ['CODEX_THREAD_ID', 'codex'],
    ['GEMINI_CLI', 'gemini-cli'],
    ['OPENCODE', 'opencode'],
    ['COPILOT_CLI', 'copilot-cli']
];

const fromEnv = (env: NodeJS.ProcessEnv): AgentMode => {
    const own = env.C4BUILDER_AGENT;
    if (own) return { on: own !== '0', name: own, explicit: true };
    const known = AGENT_VARS.find(([key]) => env[key]);
    const name = known ? known[1] : env.AI_AGENT;
    return { on: !!name, name: name ?? '', explicit: false };
};

export const detectAgent = (env: NodeJS.ProcessEnv, flags: { agent?: boolean }): AgentMode => {
    const found = fromEnv(env);
    if (flags.agent === undefined) return found;
    return { on: flags.agent, name: found.on ? found.name : 'agent', explicit: true };
};
