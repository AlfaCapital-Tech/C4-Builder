import { describe, expect, it } from 'vitest';

import { detectAgent } from './dist.mjs';

// Агентский режим site -w (change site-agent-feedback, D2): флаги сильнее C4BUILDER_AGENT,
// та — сильнее переменных агентов.
describe('detectAgent', () => {
    it.each([
        ['пусто → выкл', {}, {}, { on: false, explicit: false }],
        ['CLAUDECODE=1 → claude-code', { CLAUDECODE: '1' }, {}, { on: true, name: 'claude-code' }],
        ['CODEX_THREAD_ID → codex', { CODEX_THREAD_ID: 't' }, {}, { on: true, name: 'codex' }],
        [
            'C4BUILDER_AGENT=0 при CLAUDECODE → выкл',
            { CLAUDECODE: '1', C4BUILDER_AGENT: '0' },
            {},
            {
                on: false,
                explicit: true
            }
        ],
        ['--agent без переменных → вкл', {}, { agent: true }, { on: true, name: 'agent', explicit: true }],
        [
            '--no-agent при C4BUILDER_AGENT=codex → выкл',
            { C4BUILDER_AGENT: 'codex' },
            { agent: false },
            {
                on: false,
                explicit: true
            }
        ],
        ['AI_AGENT=x → x', { AI_AGENT: 'x' }, {}, { on: true, name: 'x', explicit: false }],
        ['C4BUILDER_AGENT=mine → mine', { C4BUILDER_AGENT: 'mine' }, {}, { on: true, name: 'mine' }]
    ])('%s', (_, env, flags, expected) => expect(detectAgent(env, flags)).toMatchObject(expected));
});
