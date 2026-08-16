// Markdown страниц раздела OpenSpec: сводка, change и его подстраницы, индексы подразделов.
import fs from 'node:fs';
import path from 'node:path';

import type { BuildOptions } from '../../config/options.ts';
import type { PageDiagram } from '../../core/plugins/types.ts';
import { encodeURIPath } from '../../util/utils.ts';
import { createFenceExtractor, mapOutsideFences } from './fences.ts';
import type { Artifact, Change, Spec, Store } from './scan.ts';

// Ссылка на страницу сайта от корня (без ведущего «/»): так же строится sidebar,
// а docsify без relativePath резолвит ссылки от корня сайта.
export const pageLink = (segments: string[], options: BuildOptions): string =>
    encodeURIPath(path.posix.join(...segments, options.WEB_FILE_NAME || segments[segments.length - 1]));

const fmtDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
// Прогресс задач: нативный <progress> (docsify рендерит HTML в markdown) + числа и процент.
const progressBar = (done: number, total: number): string =>
    `<progress value="${done}" max="${total}"></progress> ${done}/${total} (${Math.round((done / total) * 100)}%)`;
const fmtProgress = (c: Change): string =>
    c.progress ? progressBar(c.progress.done, c.progress.total) : '—';

/** Таблица change'ов (сводка и индекс Changes): по дате изменения от новых к старым. */
export const renderChangesIndex = (changes: Change[], mount: string, options: BuildOptions): string => {
    if (!changes.length) return "_Нет change'ов._";
    const rows = [...changes]
        .sort((a, b) => b.mtime - a.mtime)
        .map(
            (c) =>
                `| [${c.id}](${pageLink([mount, 'Changes', c.id], options)}) | ${c.schema ?? '—'} | ${fmtProgress(c)} | ${fmtDate(c.mtime)} |`
        );
    return ['| Change | Схема | Задачи | Изменён |', '|---|---|---|---|', ...rows].join('\n');
};

/** Сводка store (страница mount): счётчики, суммарный прогресс, таблица активных change'ов. */
export const renderSummary = (store: Store, mount: string, options: BuildOptions): string => {
    const withProgress = store.changes.filter((c) => c.progress);
    const done = withProgress.reduce((s, c) => s + (c.progress?.done ?? 0), 0);
    const total = withProgress.reduce((s, c) => s + (c.progress?.total ?? 0), 0);
    const link = (section: string): string => pageLink([mount, section], options);
    return [
        `**Активных change'ов:** [${store.changes.length}](${link('Changes')}) · ` +
            `**Спек:** [${store.specs.length}](${link('Specs')}) · ` +
            `**В архиве:** [${store.archive.length}](${link('Archive')}) · ` +
            `**Задачи:** ${total ? progressBar(done, total) : '—'}`,
        '',
        "## Активные change'ы",
        '',
        renderChangesIndex(store.changes, mount, options)
    ].join('\n');
};

export const renderArchiveIndex = (archive: Change[], mount: string, options: BuildOptions): string =>
    archive.length
        ? archive.map((c) => `- [${c.id}](${pageLink([mount, 'Archive', c.id], options)})`).join('\n')
        : '_Архив пуст._';

/** Индекс папки спек (Specs, промежуточные папки, дельты change'а): вложенный список под prefix. */
export const renderSpecIndex = (
    specs: Spec[],
    prefix: string[],
    base: string[],
    options: BuildOptions
): string => {
    const under = specs.filter(
        (s) => prefix.every((p, i) => s.path[i] === p) && s.path.length > prefix.length
    );
    if (!under.length) return '_Нет спек._';
    // Папки — тоже строки списка (со ссылкой на свою страницу-индекс), чтобы вложенность читалась.
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const s of under) {
        for (let depth = prefix.length + 1; depth <= s.path.length; depth++) {
            const segs = s.path.slice(0, depth);
            const key = segs.join('/');
            if (seen.has(key)) continue;
            seen.add(key);
            const indent = '  '.repeat(depth - prefix.length - 1);
            lines.push(`${indent}- [${segs[depth - 1]}](${pageLink([...base, ...segs], options)})`);
        }
    }
    return lines.join('\n');
};

/** Промежуточные папки набора спек (для индексов): ['a'], ['a','b'], …, сортировано. */
export const specFolders = (specs: Spec[]): string[][] => {
    const folders = new Set<string>();
    for (const s of specs) for (let i = 1; i < s.path.length; i++) folders.add(s.path.slice(0, i).join('/'));
    return [...folders].sort().map((f) => f.split('/'));
};

export interface RenderedPage {
    path: string[];
    markdown: string;
    diagrams: PageDiagram[];
    /** Файлы change'а (относительные posix-пути), на которые ссылается страница — копируются к ней. */
    files: string[];
}

/** Артефакты в порядке опции `artifacts`; не перечисленные — после, по алфавиту. */
const orderArtifacts = (artifacts: Artifact[], order: string[]): Artifact[] =>
    [...artifacts].sort((a, b) => {
        const ia = order.indexOf(a.name);
        const ib = order.indexOf(b.name);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a.name.localeCompare(b.name);
    });

/**
 * Страницы change'а: главная (шапка с метаданными, прогрессом и ссылками на подстраницы +
 * первый артефакт из `order`, если он есть), подстраницы остальных артефактов и подраздел
 * `specs` дельт (страница на capability, структура папок). Fenced-диаграммы вырезаются,
 * ссылки на артефакты/дельты того же change'а — на их страницы (`#x` → `?id=x`), прочие
 * относительные ссылки на существующие файлы — копируются к странице, где встречены.
 */
export const renderChange = (
    change: Change,
    segments: string[],
    order: string[],
    options: BuildOptions
): RenderedPage[] => {
    const ordered = orderArtifacts(change.artifacts, order);
    const inline = ordered[0]?.name === order[0] ? ordered[0] : undefined;
    const deltas: Spec[] = change.deltas.map((d) => ({
        path: d.relPath
            .replace(/^specs\//, '')
            .replace(/\/spec\.md$/, '')
            .split('/'),
        content: d.content
    }));
    const specsBase = [...segments, 'specs'];
    // Страница сайта для относительной ссылки на артефакт/дельту change'а.
    const target = (rel: string): string[] | undefined => {
        const md = rel.match(/^([^/]+)\.md$/i);
        if (md && change.artifacts.some((a) => a.name === md[1]))
            return md[1] === inline?.name ? segments : [...segments, md[1]];
        const delta = deltas.find((d) => `specs/${d.path.join('/')}/spec.md` === rel);
        return delta && [...specsBase, ...delta.path];
    };

    const render = (pagePath: string[], base: string, content: string): RenderedPage => {
        const { markdown, diagrams } = createFenceExtractor().extract(content, base);
        const files = new Set<string>();
        const rewritten = mapOutsideFences(markdown, (t) =>
            t.replace(
                /(!?)\[([^\]\n]*)\]\(([^)\s]+)(\s+[^)]*)?\)/g,
                (whole, bang: string, text: string, href: string, title = '') => {
                    if (/^[a-z][a-z0-9+.-]*:|^[#/]/i.test(href)) return whole; // абсолютные, якоря, от корня
                    const [rawPath, hash] = href.split('#');
                    const rel = path.posix.normalize(decodeURI(rawPath));
                    if (rel.startsWith('../')) return whole;
                    const page = target(rel);
                    if (page)
                        return `${bang}[${text}](${pageLink(page, options)}${hash ? `?id=${hash}` : ''}${title})`;
                    const abs = path.join(change.dir, rel);
                    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return whole;
                    files.add(rel);
                    // Картинки docsify грузит относительно страницы; обычные ссылки — от корня сайта.
                    return bang
                        ? whole
                        : `[${text}](${encodeURIPath(path.posix.join(...pagePath, rel))} ':ignore'${title})`;
                }
            )
        );
        return { path: pagePath, markdown: rewritten.trim(), diagrams, files: [...files] };
    };

    const subpages = ordered
        .filter((a) => a !== inline)
        .map((a) => render([...segments, a.name], a.name, a.content));
    const links = [
        ...subpages.map((p) => `[${p.path[p.path.length - 1]}](${pageLink(p.path, options)})`),
        ...(deltas.length ? [`[specs](${pageLink(specsBase, options)})`] : [])
    ];
    const head = [
        change.schema && `**Схема:** ${change.schema}`,
        change.created && `**Создан:** ${change.created}`,
        `**Задачи:** ${fmtProgress(change)}`,
        `**Изменён:** ${fmtDate(change.mtime)}`
    ]
        .filter(Boolean)
        .join(' · ');
    const main = inline ? render(segments, inline.name, inline.content) : undefined;
    const pages: RenderedPage[] = [
        {
            path: segments,
            markdown: [head, links.join(' · '), main?.markdown].filter(Boolean).join('\n\n'),
            diagrams: main?.diagrams ?? [],
            files: main?.files ?? []
        },
        ...subpages
    ];
    if (deltas.length) {
        const index = (prefix: string[]): RenderedPage => ({
            path: [...specsBase, ...prefix],
            markdown: renderSpecIndex(deltas, prefix, specsBase, options),
            diagrams: [],
            files: []
        });
        pages.push(index([]), ...specFolders(deltas).map(index));
        for (const [i, d] of deltas.entries())
            pages.push(render([...specsBase, ...d.path], `spec-${i + 1}`, d.content));
    }
    return pages;
};
