// Пачка замечаний агенту со страницы `site -w` (change site-agent-feedback, design D6–D7):
// схема тела запроса страницы и markdown, который печатает `c4builder feedback`.
import path from 'node:path';
import { z } from 'zod';

const TEXT_MAX = 2000;
const text = z.string().max(TEXT_MAX);
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();
// Цитата — только ориентир для агента: длинное выделение обрезается, а не валит всю пачку.
const clip = (s: string): string => {
    const q = collapse(s);
    return q.length > TEXT_MAX ? `${q.slice(0, TEXT_MAX - 1).trimEnd()}…` : q;
};

// Имя слушателя `c4builder feedback --as` и адресат пачки (change feedback-mailboxes, D1).
export const LISTENER_NAME = /^[A-Za-z0-9._-]{1,64}$/;

export const batchSchema = z.object({
    to: z.string().regex(LISTENER_NAME).optional(),
    decision: z.enum(['submitted', 'approved']),
    comments: z
        .array(
            z.object({
                // Ключ карты «страница → исходники»: тот же вид, что у вопросов (без ведущего «/»).
                page: z
                    .string()
                    .max(1000)
                    .transform((p) => path.posix.normalize(p.replace(/^\/+/, ''))),
                quote: z.string().transform(clip),
                section: text.default(''),
                comment: text.trim().min(1)
            })
        )
        .max(200),
    general: text.trim().default('')
});

export type FeedbackBatch = z.infer<typeof batchSchema>;

const quoted = (s: string): string =>
    s
        .split('\n')
        .map((l) => (l.trim() ? `> ${l}` : '>'))
        .join('\n');
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

// Исходники — относительно cwd: агент правит их из каталога проекта.
export const formatBatch = (batch: FeedbackBatch, pages: Map<string, string[]>, cwd: string): string => {
    const { comments, general } = batch;
    const pageCount = new Set(comments.map((c) => c.page)).size;
    const out = [
        '# Page feedback (c4builder)',
        '',
        `Decision: ${batch.decision}`,
        `Comments: ${comments.length}${comments.length ? ` on ${plural(pageCount, 'page')}` : ''}`
    ];
    comments.forEach((c, i) => {
        const section = collapse(c.section);
        const sources = (pages.get(c.page) ?? []).map((s) => path.relative(cwd, s).split(path.sep).join('/'));
        // Страница схлопывается только в заголовке: перевод строки в ней сломал бы формат пачки,
        // а ключ карты исходников остаётся как есть.
        out.push('', `## ${i + 1}. ${collapse(c.page)}${section ? ` (§ ${section})` : ''}`);
        if (sources.length) out.push(`Sources: ${sources.join(', ')}`);
        if (c.quote) out.push(`Quote: "${c.quote}"`);
        out.push('', quoted(c.comment));
    });
    if (general) out.push('', '## General', '', quoted(general));
    return `${out.join('\n')}\n`;
};
