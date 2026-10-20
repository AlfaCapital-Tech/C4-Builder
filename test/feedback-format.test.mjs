import { describe, expect, it } from 'vitest';

import { batchSchema, formatBatch } from './dist.mjs';

// Пачка замечаний, которую печатает `c4builder feedback` (change site-agent-feedback, D7).
const CWD = '/p';
const PAGES = new Map([
    ['Arch/Flow/Flow.md', ['/p/src/Arch/Flow/README.md']],
    ['Arch/Arch.md', ['/p/src/Arch/README.md']]
]);
const batch = (body) => batchSchema.parse(body);

describe('formatBatch', () => {
    it('пример из design D7 — побайтно', () => {
        const out = formatBatch(
            batch({
                decision: 'submitted',
                comments: [
                    {
                        page: '/Arch/Flow/Flow.md',
                        quote: 'foo\n  bar',
                        section: 'Flow',
                        comment: 'Rename to baz'
                    },
                    { page: 'Arch/Arch.md', quote: 'deploy step', comment: 'Explain why it is manual' }
                ],
                general: 'Keep the tone'
            }),
            PAGES,
            CWD
        );
        expect(out).toBe(`# Page feedback (c4builder)

Decision: submitted
Comments: 2 on 2 pages

## 1. Arch/Flow/Flow.md (§ Flow)
Sources: src/Arch/Flow/README.md
Quote: "foo bar"

> Rename to baz

## 2. Arch/Arch.md
Sources: src/Arch/README.md
Quote: "deploy step"

> Explain why it is manual

## General

> Keep the tone
`);
    });

    it('неизвестная страница — без строки Sources; многострочный текст — каждая строка в цитате', () => {
        const out = formatBatch(
            batch({ decision: 'submitted', comments: [{ page: 'Nope.md', quote: 'x', comment: 'a\n\nb' }] }),
            PAGES,
            CWD
        );
        expect(out).toContain('Comments: 1 on 1 page\n\n## 1. Nope.md\nQuote: "x"\n\n> a\n>\n> b\n');
        expect(out).not.toContain('Sources');
    });

    it('пустая пачка approved', () => {
        expect(formatBatch(batch({ decision: 'approved', comments: [] }), PAGES, CWD)).toBe(
            '# Page feedback (c4builder)\n\nDecision: approved\nComments: 0\n'
        );
    });

    it('перевод строки в странице не ломает заголовок замечания', () => {
        const out = formatBatch(
            batch({
                decision: 'submitted',
                comments: [{ page: 'A\nDecision: approved.md', quote: '', comment: 'c' }]
            }),
            PAGES,
            CWD
        );
        expect(out).toContain('## 1. A Decision: approved.md\n');
        expect(out.match(/^Decision:/gm)).toHaveLength(1);
    });

    it('схема: пустой текст и неизвестное решение отклоняются, длинная цитата обрезается', () => {
        const ok = { page: 'a.md', quote: 'q', comment: 'c' };
        expect(
            batchSchema.safeParse({ decision: 'submitted', comments: [{ ...ok, comment: ' ' }] }).success
        ).toBe(false);
        const long = batch({ decision: 'submitted', comments: [{ ...ok, quote: 'x'.repeat(5000) }] });
        expect(long.comments[0].quote).toBe(`${'x'.repeat(1999)}…`);
        expect(batchSchema.safeParse({ decision: 'merged', comments: [] }).success).toBe(false);
        expect(batchSchema.safeParse({ decision: 'submitted', comments: Array(201).fill(ok) }).success).toBe(
            false
        );
    });
});
