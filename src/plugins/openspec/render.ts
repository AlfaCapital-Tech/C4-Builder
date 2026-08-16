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
    if (!changes.length) return '_No changes._';
    const rows = [...changes]
        .sort((a, b) => b.mtime - a.mtime)
        .map(
            (c) =>
                `| [${c.id}](${pageLink([mount, 'Changes', c.id], options)}) | ${c.schema ?? '—'} | ${fmtProgress(c)} | ${fmtDate(c.mtime)} |`
        );
    return ['| Change | Schema | Tasks | Updated |', '|---|---|---|---|', ...rows].join('\n');
};

/** Сводка store (страница mount): счётчики, суммарный прогресс, таблица активных change'ов. */
export const renderSummary = (store: Store, mount: string, options: BuildOptions): string => {
    const withProgress = store.changes.filter((c) => c.progress);
    const done = withProgress.reduce((s, c) => s + (c.progress?.done ?? 0), 0);
    const total = withProgress.reduce((s, c) => s + (c.progress?.total ?? 0), 0);
    const link = (section: string): string => pageLink([mount, section], options);
    return [
        `**Active changes:** [${store.changes.length}](${link('Changes')}) · ` +
            `**Specs:** [${store.specs.length}](${link('Specs')}) · ` +
            `**Archived:** [${store.archive.length}](${link('Archive')}) · ` +
            `**Tasks:** ${total ? progressBar(done, total) : '—'}`,
        '',
        '## Active changes',
        '',
        renderChangesIndex(store.changes, mount, options)
    ].join('\n');
};

export const renderArchiveIndex = (archive: Change[], mount: string, options: BuildOptions): string =>
    archive.length
        ? archive.map((c) => `- [${c.id}](${pageLink([mount, 'Archive', c.id], options)})`).join('\n')
        : '_Archive is empty._';

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
    if (!under.length) return '_No specs._';
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

/** Файл, на который ссылается страница: `from` — posix-путь от корня источника, `to` — от каталога страницы. */
export interface PageFile {
    from: string;
    to: string;
}

export interface RenderedPage {
    path: string[];
    markdown: string;
    diagrams: PageDiagram[];
    files: PageFile[];
}

// Ссылки markdown: `[text](href "title")` и `![alt](src)`. Текст ссылки может содержать
// вложенную картинку (`[![alt](img)](href)`) — альтернатива с ней стоит первой, чтобы
// не оборваться на её `)`.
const LINK_RE = /(!?)\[((?:!\[[^\]\n]*\]\([^)\n]*\)|[^\]\n])*)\]\(([^)\s]+)(\s+[^)]*)?\)/g;

// docsify-title `':ignore'` (ссылка не в роутер) поверх пользовательского title: docsify
// вырезает `:ignore` из title и оставляет остаток как обычный title.
const ignoreTitle = (title: string): string => {
    const t = title.trim().replace(/^(["'])(.*)\1$/s, '$2');
    return ` ':ignore${t ? ` ${t}` : ''}'`;
};

/** Путь файла для сообщений — от cwd, чтобы его можно было открыть как есть. */
export const relSource = (root: string, rel: string): string =>
    path.relative(process.cwd(), path.join(root, rel)).split(path.sep).join('/');

/**
 * Markdown одного исходного файла → страница сайта: fenced-диаграммы вырезаются, ссылки
 * на другие страницы источника (`target`, `#x` → `?id=x`) — на их адреса, прочие
 * относительные ссылки на существующие файлы источника регистрируются для копирования к
 * странице (картинки docsify грузит относительно страницы, обычные ссылки — от корня сайта).
 * `fromDir` — posix-каталог файла относительно `srcRoot` (ссылки в нём резолвятся от файла).
 */
export const renderMarkdown = (
    pagePath: string[],
    base: string,
    content: string,
    {
        srcRoot,
        fromDir = '',
        target = () => undefined,
        source,
        options
    }: {
        srcRoot: string;
        fromDir?: string;
        target?: (rel: string) => string[] | undefined;
        /** Исходный файл артефакта/спеки — попадёт в сообщение об ошибке диаграммы. */
        source?: string;
        options: BuildOptions;
    }
): RenderedPage => {
    const { markdown, diagrams } = createFenceExtractor().extract(content, base, source);
    const files: PageFile[] = [];
    const rewrite = (t: string): string =>
        t.replace(LINK_RE, (whole, bang: string, text: string, href: string, title = '') => {
            const inner = text.includes('![') ? rewrite(text) : text;
            if (/^[a-z][a-z0-9+.-]*:|^[#/]/i.test(href)) return `${bang}[${inner}](${href}${title})`; // абсолютные, якоря, от корня
            const [rawPath, hash] = href.split('#');
            let decoded: string;
            try {
                decoded = decodeURI(rawPath);
            } catch {
                return whole; // битый %-escape — не ссылка на файл, оставляем как есть
            }
            const rel = path.posix.normalize(path.posix.join(fromDir, decoded));
            if (rel.startsWith('../')) return whole;
            const page = target(rel);
            if (page)
                return `${bang}[${inner}](${pageLink(page, options)}${hash ? `?id=${hash}` : ''}${title})`;
            const abs = path.join(srcRoot, rel);
            if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return whole;
            files.push({ from: rel, to: decoded });
            return bang
                ? `![${inner}](${href}${title})`
                : `[${inner}](${encodeURIPath(path.posix.join(...pagePath, decoded))}${ignoreTitle(title)})`;
        });
    return { path: pagePath, markdown: mapOutsideFences(markdown, rewrite).trim(), diagrams, files };
};

/**
 * Страницы дерева спек под `base`: корень, промежуточные папки, спеки. Папка с собственной
 * spec.md — одна страница (спека + список вложенных), иначе addPage упал бы на коллизии.
 * `render` — рендер содержимого спеки в страницу с нужным источником.
 */
export const renderSpecTree = (
    specs: Spec[],
    base: string[],
    options: BuildOptions,
    render: (pagePath: string[], spec: Spec) => RenderedPage
): RenderedPage[] => {
    const byKey = new Map(specs.map((s) => [s.path.join('/'), s]));
    const keys = new Set(['', ...specFolders(specs).map((f) => f.join('/')), ...byKey.keys()]);
    return [...keys].sort().map((key) => {
        const prefix = key ? key.split('/') : [];
        const pagePath = [...base, ...prefix];
        const spec = byKey.get(key);
        const page = spec
            ? render(pagePath, spec)
            : { path: pagePath, markdown: '', diagrams: [], files: [] };
        const nested = specs.some(
            (s) => s.path.length > prefix.length && prefix.every((p, i) => s.path[i] === p)
        );
        if (nested || !spec)
            page.markdown = [page.markdown, renderSpecIndex(specs, prefix, base, options)]
                .filter(Boolean)
                .join('\n\n');
        return page;
    });
};

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
 * `specs` дельт (страница на capability, структура папок). Артефакт с именем `specs`
 * делит страницу с индексом дельт.
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
    // Страница сайта для относительной (от корня change'а) ссылки на артефакт/дельту.
    const target = (rel: string): string[] | undefined => {
        const md = rel.match(/^([^/]+)\.md$/i);
        if (md && change.artifacts.some((a) => a.name === md[1]))
            return md[1] === inline?.name ? segments : [...segments, md[1]];
        const delta = deltas.find((d) => `specs/${d.path.join('/')}/spec.md` === rel);
        return delta && [...specsBase, ...delta.path];
    };
    const render = (
        pagePath: string[],
        base: string,
        content: string,
        fromDir = '',
        file = `${base}.md`
    ): RenderedPage =>
        renderMarkdown(pagePath, base, content, {
            srcRoot: change.dir,
            fromDir,
            target,
            source: relSource(change.dir, path.posix.join(fromDir, file)),
            options
        });

    const subpages = ordered
        .filter((a) => a !== inline)
        .map((a) => render([...segments, a.name], a.name, a.content));
    const links = [
        ...subpages.map((p) => `[${p.path[p.path.length - 1]}](${pageLink(p.path, options)})`),
        ...(deltas.length && !subpages.some((p) => p.path[p.path.length - 1] === 'specs')
            ? [`[specs](${pageLink(specsBase, options)})`]
            : [])
    ];
    const head = [
        change.schema && `**Schema:** ${change.schema}`,
        change.created && `**Created:** ${change.created}`,
        `**Tasks:** ${fmtProgress(change)}`,
        `**Updated:** ${fmtDate(change.mtime)}`
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
        const tree = renderSpecTree(deltas, specsBase, options, (pagePath, spec) =>
            render(
                pagePath,
                `spec-${spec.path.join('-')}`,
                spec.content,
                `specs/${spec.path.join('/')}`,
                'spec.md'
            )
        );
        // Артефакт specs.md и корень дельт — один путь: сливаем в страницу артефакта.
        const artifact = pages.find(
            (p) => p.path.length === segments.length + 1 && p.path.at(-1) === 'specs'
        );
        for (const p of tree) {
            if (artifact && p.path.length === specsBase.length) {
                artifact.markdown = [artifact.markdown, p.markdown].filter(Boolean).join('\n\n');
            } else pages.push(p);
        }
    }
    return pages;
};
