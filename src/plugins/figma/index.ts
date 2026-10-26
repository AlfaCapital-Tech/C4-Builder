// Встроенный плагин figma: список фреймов Figma из опций → раздел сайта со страницей-эмбедом
// на фрейм (Embed Kit 2.0, embed.figma.com) и ссылкой «Open in Figma»; картинка-ссылка на
// Figma (`![подпись](https://www.figma.com/…)`) в любой странице — такой же эмбед на месте.
// Единственный плагин, страницы которого грузят внешний сервис в браузере читателя: ни
// ассетов, ни executeScript, сама сборка в сеть не ходит. Вся логика ссылок — в одной функции
// нормализации.
import path from 'node:path';
import chalk from 'chalk';
import { z } from 'zod';

import { mapOutsideCode } from '../../core/scan/fences.ts';
import { definePlugin } from '../../core/plugins/types.ts';
import { encodeURIPath } from '../../util/utils.ts';

const EMBED_HOST = 'embed.figma.com';
// `file` — старое имя типа `design`: Figma переименовала его, а Embed Kit 2.0 эмбед `file` не
// поддерживает, поэтому старые ссылки приводятся к `design`.
const FIGMA_TYPES: Record<string, string> = {
    design: 'design',
    file: 'design',
    proto: 'proto',
    board: 'board',
    slides: 'slides',
    deck: 'deck'
};
const FIGMA_HOSTS = new Set(['figma.com', 'www.figma.com', EMBED_HOST]);
const EXPECTED = `https://www.figma.com/<${Object.keys(FIGMA_TYPES).join('|')}>/<key>/<name>?node-id=…`;

/**
 * Ссылка «Share» из Figma → адрес эмбеда `https://embed.figma.com/<тип>/<ключ>?node-id=…&embed-host=…`.
 * Из query сохраняется только `node-id`: `t=`, `p=` и прочее — трекинг, в эмбеде не нужны.
 * Бросает Error с ожидаемой формой ссылки — схема превращает его в issue с индексом фрейма.
 */
export const figmaEmbedUrl = (raw: string, embedHost: string): string => {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`not a Figma link, expected ${EXPECTED}`);
    }
    const [kind, key] = url.pathname.split('/').filter(Boolean);
    // hasOwn: сегмент пути вроде `constructor` не должен находить член прототипа.
    const type = kind && Object.hasOwn(FIGMA_TYPES, kind) ? FIGMA_TYPES[kind] : undefined;
    if (!FIGMA_HOSTS.has(url.hostname) || !type || !key || !/^[\w-]+$/.test(key))
        throw new Error(`not a Figma link, expected ${EXPECTED}`);
    const embed = new URL(`https://${EMBED_HOST}/${type}/${key}`);
    const nodeId = url.searchParams.get('node-id');
    if (nodeId) embed.searchParams.set('node-id', nodeId);
    embed.searchParams.set('embed-host', embedHost);
    return embed.href;
};

const frameSchema = z
    .object({
        name: z.string().min(1),
        url: z.string().min(1),
        description: z.string().optional()
    })
    .strict();

// Нормализация в transform, а не в afterScan: битая ссылка или дубль имени — ошибка
// конфигурации, и она должна остановить сборку до старта штатным путём «плагин + ключ».
const optionsSchema = z
    .object({
        mount: z.string().min(1).default('Figma'),
        embedHost: z.string().min(1).default('c4builder'),
        height: z.number().int().positive().default(600),
        // Без фреймов раздела нет — плагин нужен ради эмбедов в страницах.
        frames: z.array(frameSchema).default([])
    })
    .strict()
    .transform((o, ctx) => {
        const seen = new Set<string>();
        const frames = o.frames.map((frame, i) => {
            const segments = frame.name.split('/');
            if (segments.some((s) => !s.trim()))
                ctx.addIssue({
                    code: 'custom',
                    path: ['frames', i, 'name'],
                    message: `empty segment in frame name "${frame.name}"`
                });
            if (seen.has(frame.name))
                ctx.addIssue({
                    code: 'custom',
                    path: ['frames', i, 'name'],
                    message: `duplicate frame name "${frame.name}"`
                });
            seen.add(frame.name);
            let embed = '';
            try {
                embed = figmaEmbedUrl(frame.url, o.embedHost);
            } catch (e) {
                ctx.addIssue({ code: 'custom', path: ['frames', i, 'url'], message: (e as Error).message });
            }
            return { ...frame, segments, embed };
        });
        return { ...o, frames };
    });

type Opts = z.output<typeof optionsSchema>;

// Ссылка над iframe: без сети или доступа к файлу iframe показывает ошибку браузера или логин
// Figma, и ссылка не должна теряться под ним. В markdown-выходах HTML вырежут хостинги —
// ссылка остаётся. lazy — эмбед не грузится, пока не прокрутили.
const iframe = (embed: string, height: number): string =>
    `<iframe src="${embed}" width="100%" height="${height}" loading="lazy" allowfullscreen></iframe>`;

// Картинка markdown: `![alt](url)` или `![alt](url "title")`.
const IMAGE_RE = /!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)/g;
const FIGMA_URL_RE = /^https:\/\/(?:www\.|embed\.)?figma\.com\//i;

/**
 * Картинки-ссылки на Figma в markdown страницы → эмбеды. Картинка одна на строке — блок
 * «ссылка + iframe» (HTML-блок отделён пустыми строками, иначе markdown его не распознает);
 * внутри текста iframe не встанет — там обычная ссылка. Код (```, `…`, отступ) не трогается. Ссылка, которую
 * не удалось разобрать, остаётся как есть и попадает в `bad`.
 */
export const embedFigmaImages = (
    md: string,
    embedHost: string,
    height: number,
    bad: string[] = []
): { md: string; count: number } => {
    let count = 0;
    const out = mapOutsideCode(md, (line) => {
        const alone = /^\s*!\[[^\]]*\]\(\S+?(?:\s+"[^"]*")?\)\s*$/.test(line);
        return line.replace(IMAGE_RE, (whole, alt: string, url: string) => {
            if (!FIGMA_URL_RE.test(url)) return whole;
            let embed: string;
            try {
                embed = figmaEmbedUrl(url, embedHost);
            } catch {
                bad.push(url);
                return whole;
            }
            count++;
            const label = alt.trim() ? `Open in Figma: ${alt.trim()}` : 'Open in Figma';
            if (!alone) return `[${alt.trim() || 'Figma'}](${url})`;
            return `\n[${label}](${url})\n\n${iframe(embed, height)}\n`;
        });
    });
    return { md: out, count };
};

export default definePlugin<Opts>({
    name: 'figma',
    options: optionsSchema,

    afterScan(ctx, o) {
        const { mount, height } = o;
        if (o.frames.length) {
            const link = (segments: string[]): string =>
                encodeURIPath(
                    path.posix.join(mount, ...segments, ctx.options.WEB_FILE_NAME || segments.at(-1) || '')
                );
            // Сводка — в порядке списка, а не по алфавиту: порядок фреймов задаёт пользователь.
            ctx.addPage({
                path: [mount],
                markdown: o.frames
                    .map((f) => {
                        const summary = f.description?.split('\n').find((l) => l.trim());
                        return `- [${f.name}](${link(f.segments)})${summary ? ` — ${summary.trim()}` : ''}`;
                    })
                    .join('\n')
            });
            for (const f of o.frames) {
                ctx.addPage({
                    path: [mount, ...f.segments],
                    markdown: [
                        ...(f.description ? [f.description, ''] : []),
                        `[Open in Figma](${f.url})`,
                        '',
                        iframe(f.embed, height)
                    ].join('\n')
                });
            }
        }

        // Эмбеды в страницах: дерево к этому моменту содержит страницы проекта и плагинов,
        // объявленных в plugins раньше figma (хуки идут в порядке списка).
        let embeds = 0;
        const bad: string[] = [];
        for (const item of ctx.tree) {
            item.mdFiles = item.mdFiles.map((md) => {
                const text = md.toString();
                if (!text.includes('figma.com')) return md;
                const r = embedFigmaImages(text, o.embedHost, height, bad);
                embeds += r.count;
                return r.count ? r.md : md;
            });
        }
        for (const url of bad)
            console.log(chalk.yellow(`⚠ figma: ${url}: not a Figma link, expected ${EXPECTED} — left as is`));

        // Одна строка, не предупреждение: внешний эмбед — назначение подключённого плагина.
        console.log(
            chalk.gray(
                `figma: ${o.frames.length} frame page(s), ${embeds} embed(s) in pages load ${EMBED_HOST} — readers need network access to Figma`
            )
        );
    }
});
