// Markdown страниц раздела OpenSpec: сводка, change, индексы подразделов.
import fs from 'node:fs';
import path from 'node:path';

import type { BuildOptions } from '../../config/options.ts';
import type { PageDiagram } from '../../core/plugins/types.ts';
import { encodeURIPath } from '../../util/utils.ts';
import { createFenceExtractor, mapOutsideFences } from './fences.ts';
import type { Change, Spec, Store } from './scan.ts';

// Порядок стандартных артефактов на странице change'а; прочие — по алфавиту после них.
const ARTIFACT_ORDER = ['proposal', 'design', 'tasks'];

// Якорь заголовка как его считает docsify 4.13 (slugify): пунктуация выкидывается,
// пробелы → «-», ведущая цифра экранируется. Нужен для ссылок между артефактами.
export const docsifySlug = (text: string): string =>
    text
        .trim()
        .toLowerCase()
        .replace(/<[^>]+>/g, '')
        .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '')
        .replace(/\s/g, '-')
        .replace(/-+/g, '-')
        .replace(/^(\d)/, '_$1');

// Ссылка на страницу сайта от корня (без ведущего «/»): так же строится sidebar,
// а docsify без relativePath резолвит ссылки от корня сайта.
export const pageLink = (segments: string[], options: BuildOptions): string =>
    encodeURIPath(path.posix.join(...segments, options.WEB_FILE_NAME || segments[segments.length - 1]));

const shiftHeadings = (md: string, by: number): string =>
    mapOutsideFences(md, (t) =>
        t.replace(/^(#{1,6})(?=[ \t])/gm, (h) => '#'.repeat(Math.min(6, h.length + by)))
    );

const fmtDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const fmtProgress = (c: Change): string => (c.progress ? `${c.progress.done}/${c.progress.total}` : '—');
const deltaTitle = (relPath: string): string =>
    relPath
        .replace(/^specs\//, '')
        .replace(/\/spec\.md$/, '')
        .split('/')
        .join(' / ');

const changesTable = (changes: Change[], section: string, mount: string, options: BuildOptions): string => {
    if (!changes.length) return "_Нет change'ов._";
    const rows = [...changes]
        .sort((a, b) => b.mtime - a.mtime)
        .map(
            (c) =>
                `| [${c.id}](${pageLink([mount, section, c.id], options)}) | ${c.schema ?? '—'} | ${fmtProgress(c)} | ${fmtDate(c.mtime)} |`
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
            `**Задачи:** ${total ? `${done}/${total}` : '—'}`,
        '',
        "## Активные change'ы",
        '',
        changesTable(store.changes, 'Changes', mount, options)
    ].join('\n');
};

export const renderChangesIndex = (changes: Change[], mount: string, options: BuildOptions): string =>
    changesTable(changes, 'Changes', mount, options);

export const renderArchiveIndex = (archive: Change[], mount: string, options: BuildOptions): string =>
    archive.length
        ? archive.map((c) => `- [${c.id}](${pageLink([mount, 'Archive', c.id], options)})`).join('\n')
        : '_Архив пуст._';

/** Индекс папки спек (Specs и промежуточные папки): вложенный список папок и спек под ней. */
export const renderSpecIndex = (specs: Spec[], prefix: string[], mount: string, options: BuildOptions): string => {
    const under = specs.filter((s) => prefix.every((p, i) => s.path[i] === p) && s.path.length > prefix.length);
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
            lines.push(`${indent}- [${segs[depth - 1]}](${pageLink([mount, 'Specs', ...segs], options)})`);
        }
    }
    return lines.join('\n');
};

export interface RenderedChange {
    markdown: string;
    diagrams: PageDiagram[];
    /** Файлы change'а (относительные posix-пути), на которые ссылаются артефакты — копируются к странице. */
    files: string[];
}

/**
 * Страница change'а: шапка (метаданные, прогресс) → proposal → design → tasks → прочие
 * артефакты по алфавиту → дельты спек. Заголовки артефактов сдвигаются под h2 раздела,
 * fenced-диаграммы вырезаются, ссылки на артефакты того же change'а — на якоря разделов,
 * прочие относительные ссылки на существующие файлы — копируются к странице.
 */
export const renderChange = (change: Change, segments: string[]): RenderedChange => {
    const fences = createFenceExtractor();
    const diagrams: PageDiagram[] = [];
    const files = new Set<string>();
    const artifactNames = new Set(change.artifacts.map((a) => a.name));
    const deltaAnchors = new Map(change.deltas.map((d) => [d.relPath, docsifySlug(deltaTitle(d.relPath))]));

    const rewriteLinks = (md: string): string =>
        mapOutsideFences(md, (t) =>
            t.replace(
                /(!?)\[([^\]\n]*)\]\(([^)\s]+)(\s+[^)]*)?\)/g,
                (whole, bang: string, text: string, target: string, title = '') => {
                    if (/^[a-z][a-z0-9+.-]*:|^[#/]/i.test(target)) return whole; // абсолютные, якоря, от корня
                    const [rawPath, hash] = target.split('#');
                    const rel = path.posix.normalize(decodeURI(rawPath));
                    if (rel.startsWith('../')) return whole;
                    const md = rel.match(/^([^/]+)\.md$/i);
                    if (md && artifactNames.has(md[1]))
                        return `${bang}[${text}](#${hash ?? docsifySlug(md[1])}${title})`;
                    if (deltaAnchors.has(rel))
                        return `${bang}[${text}](#${hash ?? deltaAnchors.get(rel)}${title})`;
                    const abs = path.join(change.dir, rel);
                    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return whole;
                    files.add(rel);
                    // Картинки docsify грузит относительно страницы; обычные ссылки — от корня сайта.
                    return bang
                        ? whole
                        : `[${text}](${encodeURIPath(path.posix.join(...segments, rel))} ':ignore'${title})`;
                }
            )
        );

    const section = (title: string, base: string, content: string, level: number): string => {
        const { markdown, diagrams: d } = fences.extract(content, base);
        diagrams.push(...d);
        return `${'#'.repeat(level)} ${title}\n\n${rewriteLinks(shiftHeadings(markdown, level - 1)).trim()}`;
    };

    const ordered = [...change.artifacts].sort((a, b) => {
        const ia = ARTIFACT_ORDER.indexOf(a.name);
        const ib = ARTIFACT_ORDER.indexOf(b.name);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a.name.localeCompare(b.name);
    });

    const head = [
        change.schema && `**Схема:** ${change.schema}`,
        change.created && `**Создан:** ${change.created}`,
        `**Задачи:** ${fmtProgress(change)}`,
        `**Изменён:** ${fmtDate(change.mtime)}`
    ]
        .filter(Boolean)
        .join(' · ');

    const parts = [head, ...ordered.map((a) => section(a.name, a.name, a.content, 2))];
    if (change.deltas.length) {
        parts.push('## Дельты спек');
        for (const d of change.deltas)
            parts.push(section(deltaTitle(d.relPath), docsifySlug(deltaTitle(d.relPath)), d.content, 3));
    }
    return { markdown: parts.join('\n\n'), diagrams, files: [...files] };
};
