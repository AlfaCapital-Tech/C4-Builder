import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

import { VENDOR_DIR } from '../../util/paths.ts';
import { DEFAULT_FONT_NAME } from './fonts.ts';
import { ASCENT, DESCENT, escapeXml, textWidth } from './textmetrics.ts';
import { type EdgePath, getBezierPath, getSmoothStepPath } from './xyflowpaths.ts';

// Пятый бэкенд рендера: экспорт редактора Wireflow (`*.wireflow.json`, github.com/vanila-io/wireflow,
// MIT) → SVG напрямую из модели файла, без браузера, jsdom и npm-зависимостей. Шаблоны
// экранов — вендорный каталог vendor/wireflow (scripts/update-wireflow-catalog.mjs), геометрия
// и цвета — константы редактора (components/editor/editor.css, lib/diagram/model.ts,
// lib/diagram/groups.ts), пути рёбер — перенос функций React Flow (xyflowpaths.ts). Текст
// меряется вендорным Nimbus Sans (textmetrics), поэтому SVG детерминирован на любой машине.

export const WIREFLOW_DIR = path.join(VENDOR_DIR, 'wireflow');
// Версии формата файла, которые читаются: 2 — первая с полем `format`, 4 — текущая
// (lib/diagram/file.ts редактора). Версия 1 и файлы без `format` — старый gg-editor/G6.
export const WIREFLOW_VERSIONS = { min: 2, max: 4 };

// Ошибка конвейера: problems — по строке на нарушение без пути файла (check печатает их
// как `✗ <file>: <problem>`), message — те же строки с путём для сборки.
export class WireflowError extends Error {
    readonly problems: string[];
    constructor(file: string, problems: string[]) {
        super(problems.map((p) => `${file}: ${p}`).join('\n'));
        this.problems = problems;
    }
}

// --- модель файла после валидации -------------------------------------------------------

interface Card {
    kind: 'flow';
    id: string;
    parentId?: string;
    x: number;
    y: number;
    graphicId: string;
    src?: string;
    headerText: string;
    showHeader: boolean;
    ratio?: number;
}
interface Note {
    kind: 'note';
    id: string;
    parentId?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
}
interface Group {
    kind: 'group';
    id: string;
    parentId?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    label: string;
}
export type WireflowNode = Card | Note | Group;
export interface WireflowEdge {
    id: string;
    source: string;
    target: string;
    shape: 'bezier' | 'step' | 'smoothstep';
    label?: string;
    color?: string;
    width: number;
}
export interface WireflowDiagram {
    nodes: WireflowNode[];
    edges: WireflowEdge[];
}
export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

// --- константы редактора ------------------------------------------------------------------

const CARD_WIDTH = 220;
const PORTRAIT_CARD_WIDTH = 124; // мобильные шаблоны (240×440) рисуются уже, в масштабе прочих
const BORDER = 1;
const HEADER = 24;
const DEFAULT_RATIO = 0.7872; // медиана пропорций альбомных шаблонов
const OWN_IMAGE = 'own-image';
const IMAGE_RATIO = { min: 0.2, max: 5 };
const IMAGE_SRC_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const NOTE_SIZE = { width: 220, height: 120 };
const EMPTY_GROUP = { width: 252, height: 120 };
const GROUP_PADDING = { top: 36, right: 16, bottom: 16, left: 16 };
const DEFAULT_EDGE_COLOR = '#a3a8c3';
const DEFAULT_EDGE_WIDTH = 2;
const EXPORT_PADDING = 40; // поля экспорта картинки в редакторе (export-image.ts)
const HEADER_MAX_CHARS = 23; // flow-node.tsx: длиннее — 20 символов и «...»

// --- каталог шаблонов ---------------------------------------------------------------------

interface Catalog {
    version: string;
    // Map, а не объект: graphicId из файла вроде `constructor` иначе нашёл бы член прототипа.
    sizes: Map<string, number>;
    files: Map<string, string>;
}

let catalog: Catalog | null = null;
const loadCatalog = (): Catalog => {
    if (catalog) return catalog;
    const read = (name: string): string => fs.readFileSync(path.join(WIREFLOW_DIR, name), 'utf8');
    const graphics = JSON.parse(read('graphics.json')) as { id: string; src: string }[];
    catalog = {
        version: read('VERSION').trim(),
        sizes: new Map(Object.entries(JSON.parse(read('graphic-sizes.json')) as Record<string, number>)),
        files: new Map(graphics.map((g) => [g.id, path.join(WIREFLOW_DIR, g.src.replace(/^\//, ''))]))
    };
    return catalog;
};

// SHA коммита-источника каталога — в ключ кэша рендера: обновление шаблонов обязано
// перерисовать wireflow-диаграммы.
export const wireflowCatalogVersion = (): string => loadCatalog().version;

// Шаблон как <symbol>: корневые атрибуты, кроме viewBox, отбрасываются (Illustrator-пролог,
// enable-background, xml:space), внутренние id и ссылки на них префиксуются — шаблоны
// экспортированы с одинаковыми id (Layer_1), а два шаблона в одном SVG иначе бы спорили.
const symbolMemo = new Map<string, string>();
const templateSymbol = (graphicId: string, symbolId: string): string | undefined => {
    const key = `${symbolId}\0${graphicId}`;
    const cached = symbolMemo.get(key);
    if (cached !== undefined) return cached;
    const file = loadCatalog().files.get(graphicId);
    if (!file) return undefined;
    const raw = fs
        .readFileSync(file, 'utf8')
        .replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, '')
        .trim();
    const open = /<svg\b([^>]*)>/.exec(raw);
    const close = raw.lastIndexOf('</svg>');
    if (!open || close === -1) return undefined;
    const viewBox = /\bviewBox="([^"]*)"/.exec(open[1])?.[1] ?? '0 0 425 334.57';
    const inner = raw
        .slice(open.index + open[0].length, close)
        // Inkscape-шаблоны несут <metadata> (rdf/dc/cc), <sodipodi:namedview> и атрибуты
        // inkscape:/sodipodi:. Их пространства имён объявлены на корневом <svg> шаблона, который
        // в <symbol> не переносится, — без объявлений XML диаграммы невалиден: resvg падает,
        // браузер не показывает картинку в <img>. На отрисовку они не влияют — вырезаем;
        // `xml:` объявлен всегда, `xlink:` переводим в SVG2-`href`.
        .replace(/<metadata\b[\s\S]*?<\/metadata>/g, '')
        .replace(/<([a-zA-Z]+:[\w.-]+)\b[^>]*?\/>|<([a-zA-Z]+:[\w.-]+)\b[^>]*>[\s\S]*?<\/\2>/g, '')
        .replace(/\bxlink:href=/g, 'href=')
        .replace(/\s(?!xml:)[a-zA-Z]+:[\w.-]+="[^"]*"/g, '')
        .replace(/\bid="([^"]*)"/g, (_, id: string) => `id="${symbolId}-${id}"`)
        .replace(/url\(#([^)]*)\)/g, (_, id: string) => `url(#${symbolId}-${id})`)
        .replace(/\bhref="#([^"]*)"/g, (_, id: string) => `href="#${symbolId}-${id}"`)
        .trim();
    const symbol = `<symbol id="${symbolId}" viewBox="${viewBox}">${inner}</symbol>`;
    symbolMemo.set(key, symbol);
    return symbol;
};

// --- разбор и валидация -------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const q = (v: unknown): string => JSON.stringify(v);

const RESAVE = 'open and re-save the file in the current Wireflow editor (wireflow.co)';

export interface Parsed {
    diagram: WireflowDiagram;
}

// Разбор файла с проверкой структуры (design §7): все нарушения собираются в одну ошибку с id
// элементов. Неизвестные поля игнорируются — формат молодой и растёт. Неизвестный шаблон и
// картинка не из файла — предупреждения рендера (cardImage), не ошибки разбора.
export const parseWireflow = (text: string, file: string): Parsed => {
    const fail = (...problems: string[]): never => {
        throw new WireflowError(file, problems);
    };
    let json: unknown;
    try {
        json = JSON.parse(text.replace(/^﻿/, ''));
    } catch (err) {
        return fail(`invalid JSON: ${(err as Error).message}`);
    }
    if (!isObject(json)) return fail('not a Wireflow file (expected a JSON object)');
    if (!('format' in json))
        return fail(
            Array.isArray(json.nodes)
                ? `old Wireflow format (no "format" field): ${RESAVE}`
                : 'not a Wireflow file (no "format" field)'
        );
    if (json.format !== 'wireflow') return fail(`not a Wireflow file (format ${q(json.format)})`);
    const version = json.version;
    if (!Number.isInteger(version)) return fail(`unknown file version ${q(version)}`);
    if ((version as number) < WIREFLOW_VERSIONS.min)
        return fail(`old Wireflow format (version ${version}): ${RESAVE}`);
    if ((version as number) > WIREFLOW_VERSIONS.max)
        return fail(
            `file version ${version} is newer than supported (${WIREFLOW_VERSIONS.min}-${WIREFLOW_VERSIONS.max}); update c4builder`
        );
    const diagram = json.diagram;
    if (!isObject(diagram) || !Array.isArray(diagram.nodes))
        return fail('no diagram: "diagram.nodes" must be an array');
    const rawEdges = diagram.edges ?? [];
    if (!Array.isArray(rawEdges)) return fail('"diagram.edges" must be an array');

    const problems: string[] = [];
    const ids = new Set<string>();
    const nodes: WireflowNode[] = [];
    const parents = new Map<string, string>();
    const str = (v: unknown, what: string, who: string): string | undefined => {
        if (v === undefined || v === null) return undefined;
        if (typeof v !== 'string') problems.push(`${who}: ${what} must be a string`);
        return typeof v === 'string' ? v : undefined;
    };
    const size = (v: unknown, fallback: number): number => (isNum(v) && v > 0 ? v : fallback);

    diagram.nodes.forEach((raw, i) => {
        if (!isObject(raw) || !isId(raw.id)) {
            problems.push(`node #${i}: missing "id"`);
            return;
        }
        const id = raw.id;
        if (ids.has(id)) {
            problems.push(`duplicate id ${q(id)}`);
            return;
        }
        ids.add(id);
        const type = raw.type;
        if (type !== 'flow' && type !== 'note' && type !== 'group') {
            problems.push(`node ${q(id)}: unknown type ${q(type)} (expected flow, note or group)`);
            return;
        }
        const who = `${type === 'flow' ? 'card' : type} ${q(id)}`;
        const pos = raw.position;
        if (!isObject(pos) || !isNum(pos.x) || !isNum(pos.y)) {
            problems.push(`${who}: missing "position" {x, y}`);
            return;
        }
        let parentId: string | undefined;
        if (raw.parentId !== undefined && raw.parentId !== null) {
            if (!isId(raw.parentId)) problems.push(`${who}: "parentId" must be a node id`);
            else {
                parentId = raw.parentId;
                parents.set(id, parentId);
            }
        }
        const data = isObject(raw.data) ? raw.data : {};
        const base = { id, parentId, x: pos.x, y: pos.y };
        if (type === 'group') {
            nodes.push({
                kind: 'group',
                ...base,
                width: isNum(raw.width) && raw.width > 0 ? raw.width : undefined,
                height: isNum(raw.height) && raw.height > 0 ? raw.height : undefined,
                label: str(data.label, '"data.label"', who) ?? ''
            });
            return;
        }
        if (type === 'note') {
            nodes.push({
                kind: 'note',
                ...base,
                width: size(raw.width, NOTE_SIZE.width),
                height: size(raw.height, NOTE_SIZE.height),
                text: str(data.text, '"data.text"', who) ?? ''
            });
            return;
        }
        if (!isId(data.graphicId)) {
            problems.push(`${who}: missing "data.graphicId" (screen template)`);
            return;
        }
        const label = str(data.label, '"data.label"', who);
        const headerText = str(data.headerText, '"data.headerText"', who);
        const src = str(data.src, '"data.src"', who);
        nodes.push({
            kind: 'flow',
            ...base,
            graphicId: data.graphicId,
            src,
            headerText: headerText ?? label ?? '',
            showHeader: data.showHeader !== false,
            ratio: isNum(data.ratio) ? data.ratio : undefined
        });
    });

    // Родитель — существующая группа, цепочка родителей без циклов.
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const [id, parentId] of parents) {
        const parent = byId.get(parentId);
        if (parent?.kind !== 'group') {
            problems.push(`node ${q(id)}: "parentId" ${q(parentId)} is not a group`);
            continue;
        }
        let p: string | undefined = parentId;
        for (let steps = 0; p !== undefined; steps++) {
            if (p === id || steps > nodes.length) {
                problems.push(`group ${q(parentId)} is inside itself`);
                break;
            }
            p = parents.get(p);
        }
    }

    const edges: WireflowEdge[] = [];
    rawEdges.forEach((raw, i) => {
        if (!isObject(raw) || !isId(raw.id)) {
            problems.push(`edge #${i}: missing "id"`);
            return;
        }
        const id = raw.id;
        if (ids.has(id)) {
            problems.push(`duplicate id ${q(id)}`);
            return;
        }
        ids.add(id);
        const who = `edge ${q(id)}`;
        let ok = true;
        for (const end of ['source', 'target'] as const) {
            const ref = raw[end];
            if (!isId(ref)) {
                problems.push(`${who}: "${end}" must be a node id`);
                ok = false;
                continue;
            }
            const node = byId.get(ref);
            if (!node) {
                problems.push(`${who}: ${end} ${q(ref)} is not a node`);
                ok = false;
            } else if (node.kind === 'group') {
                problems.push(`${who}: ${end} ${q(ref)} is a group (connect cards or notes)`);
                ok = false;
            }
        }
        if (!ok) return;
        const style = isObject(raw.style) ? raw.style : {};
        const stroke = typeof style.stroke === 'string' ? style.stroke.trim() : '';
        edges.push({
            id,
            source: raw.source as string,
            target: raw.target as string,
            shape: raw.type === 'step' || raw.type === 'smoothstep' ? raw.type : 'bezier',
            label: str(raw.label, '"label"', who) || undefined,
            color: stroke ? (/^#[0-9a-f]{3,8}$/i.test(stroke) ? stroke.toLowerCase() : stroke) : undefined,
            width: isNum(style.strokeWidth) && style.strokeWidth > 0 ? style.strokeWidth : DEFAULT_EDGE_WIDTH
        });
    });

    if (problems.length) fail(...problems);
    return { diagram: { nodes, edges } };
};

// --- раскладка ----------------------------------------------------------------------------

const cardRatio = (card: Card): number => {
    if (card.graphicId === OWN_IMAGE)
        return card.ratio === undefined
            ? DEFAULT_RATIO
            : Math.min(IMAGE_RATIO.max, Math.max(IMAGE_RATIO.min, card.ratio));
    return loadCatalog().sizes.get(card.graphicId) ?? DEFAULT_RATIO;
};

// Размер карточки не хранится в файле (model.ts cardSize): ширина от шаблона, высота — рамка,
// заголовок и картинка по пропорции шаблона.
const cardSize = (card: Card): { width: number; height: number; header: number; ratio: number } => {
    const ratio = cardRatio(card);
    const width = card.graphicId !== OWN_IMAGE && ratio > 1 ? PORTRAIT_CARD_WIDTH : CARD_WIDTH;
    const header = card.showHeader ? HEADER : 0;
    return { width, height: 2 * BORDER + header + (width - 2 * BORDER) * ratio, header, ratio };
};

const sizeOf = (node: WireflowNode): { width: number; height: number } => {
    if (node.kind === 'flow') {
        const { width, height } = cardSize(node);
        return { width, height };
    }
    if (node.kind === 'note') return { width: node.width, height: node.height };
    return { width: node.width ?? EMPTY_GROUP.width, height: node.height ?? EMPTY_GROUP.height };
};

/**
 * Абсолютные рамки узлов: позиции членов группы — относительно группы (`parentId`), рамка
 * группы подгоняется под вложенные узлы с отступами редактора, внутренние группы первыми
 * (lib/diagram/groups.ts fitGroups). Пустая группа сохраняет размер из файла.
 */
export const layoutWireflow = (diagram: WireflowDiagram): Map<string, Box> => {
    const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
    const abs = new Map<string, { x: number; y: number }>();
    const resolve = (node: WireflowNode, seen: Set<string>): { x: number; y: number } => {
        const known = abs.get(node.id);
        if (known) return known;
        const parent = node.parentId === undefined ? undefined : byId.get(node.parentId);
        let pos = { x: node.x, y: node.y };
        if (parent && !seen.has(parent.id)) {
            const p = resolve(parent, new Set([...seen, node.id]));
            pos = { x: p.x + node.x, y: p.y + node.y };
        }
        abs.set(node.id, pos);
        return pos;
    };
    for (const n of diagram.nodes) resolve(n, new Set());

    const size = new Map(diagram.nodes.map((n) => [n.id, sizeOf(n)]));
    const children = new Map<string, string[]>();
    for (const n of diagram.nodes)
        if (n.parentId !== undefined) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
    const depth = (n: WireflowNode): number => {
        let d = 0;
        for (let p = n.parentId; p !== undefined && d <= diagram.nodes.length; p = byId.get(p)?.parentId) d++;
        return d;
    };
    const groups = diagram.nodes.filter((n) => n.kind === 'group').sort((a, b) => depth(b) - depth(a));
    for (const g of groups) {
        const kids = children.get(g.id) ?? [];
        if (!kids.length) continue;
        const boxes = kids.map((id) => ({
            ...(abs.get(id) as { x: number; y: number }),
            ...(size.get(id) as Box)
        }));
        const minX = Math.min(...boxes.map((b) => b.x)) - GROUP_PADDING.left;
        const minY = Math.min(...boxes.map((b) => b.y)) - GROUP_PADDING.top;
        const maxX = Math.max(...boxes.map((b) => b.x + b.width)) + GROUP_PADDING.right;
        const maxY = Math.max(...boxes.map((b) => b.y + b.height)) + GROUP_PADDING.bottom;
        abs.set(g.id, { x: minX, y: minY });
        size.set(g.id, { width: maxX - minX, height: maxY - minY });
    }
    return new Map(
        diagram.nodes.map((n) => [
            n.id,
            { ...(abs.get(n.id) as { x: number; y: number }), ...(size.get(n.id) as Box) }
        ])
    );
};

// --- SVG ----------------------------------------------------------------------------------

// Числа — до 2 знаков, без -0 и хвостов плавающей точки: одинаковая геометрия должна давать
// одинаковый текст.
const n = (v: number): string => {
    const r = Math.round(v * 100) / 100;
    return String(r === 0 ? 0 : r);
};
const attr = (s: string): string => escapeXml(s).replace(/"/g, '&quot;');
const hash = (s: string): string => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);

// Обрезка по ширине с многоточием (CSS text-overflow: ellipsis).
const fitText = (text: string, size: number, bold: boolean, maxWidth: number): string => {
    if (textWidth(text, size, bold) <= maxWidth) return text;
    const chars = [...text];
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (textWidth(`${chars.slice(0, mid).join('')}…`, size, bold) <= maxWidth) lo = mid;
        else hi = mid - 1;
    }
    return `${chars.slice(0, lo).join('').trimEnd()}…`;
};

// Перенос текста заметки: по пробелам в ширину, слово шире строки — по символам
// (overflow-wrap: anywhere), явные переводы строк сохраняются (white-space: pre-wrap).
const wrapText = (text: string, size: number, maxWidth: number): string[] => {
    const lines: string[] = [];
    for (const paragraph of text.replace(/\r\n/g, '\n').split('\n')) {
        let line = '';
        const push = (): void => {
            lines.push(line);
            line = '';
        };
        for (const word of paragraph.split(' ')) {
            const candidate = line ? `${line} ${word}` : word;
            if (textWidth(candidate, size) <= maxWidth) {
                line = candidate;
                continue;
            }
            if (line) push();
            if (textWidth(word, size) <= maxWidth) {
                line = word;
                continue;
            }
            for (const ch of [...word]) {
                if (line && textWidth(line + ch, size) > maxWidth) push();
                line += ch;
            }
        }
        lines.push(line);
    }
    return lines;
};

// Вертикальная позиция базовой линии: em-квадрат шрифта по центру строки высотой lineHeight.
const baseline = (top: number, lineHeight: number, size: number): number =>
    top + (lineHeight - (ASCENT + DESCENT) * size) / 2 + ASCENT * size;

const text = (x: number, y: number, body: string, style: string): string =>
    `<text x="${n(x)}" y="${n(y)}" ${style}>${escapeXml(body)}</text>`;

export interface RenderOptions {
    /** SVG пойдёт в растеризацию resvg: WebP он не декодирует — заглушка вместо картинки. */
    raster?: boolean;
}

interface Placeholder {
    lines: string[];
}

// Картинка карточки: шаблон каталога, встроенное изображение или заглушка с причиной.
const cardImage = (
    card: Card,
    box: { x: number; y: number; width: number; height: number },
    symbols: Map<string, string>,
    warnings: string[],
    options: RenderOptions
): string => {
    const placeholder = ({ lines }: Placeholder): string => {
        const cx = box.x + box.width / 2;
        const top = box.y + box.height / 2 - (lines.length * 14) / 2;
        return (
            `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" fill="#f4f5f7"/>` +
            lines
                .map((l, i) =>
                    text(
                        cx,
                        baseline(top + i * 14, 14, 10),
                        fitText(l, 10, false, box.width - 12),
                        'text-anchor="middle" font-size="10" fill="#94a4a5"'
                    )
                )
                .join('')
        );
    };
    const geometry = `x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}"`;
    if (card.graphicId === OWN_IMAGE) {
        const src = card.src ?? '';
        const m = IMAGE_SRC_RE.exec(src);
        if (!m) {
            warnings.push(
                /^https?:/i.test(src)
                    ? `card ${q(card.id)}: external image URL is not loaded (no network at build time)`
                    : `card ${q(card.id)}: "data.src" is not an embedded JPEG, PNG or WebP image`
            );
            return placeholder({ lines: [/^https?:/i.test(src) ? 'external image' : 'no image', card.id] });
        }
        if (m[1] === 'webp' && options.raster) {
            warnings.push(`card ${q(card.id)}: WebP image cannot be rasterized to PNG (use JPEG or PNG)`);
            return placeholder({ lines: ['WebP image', card.id] });
        }
        return `<image ${geometry} preserveAspectRatio="none" href="${src}"/>`;
    }
    const symbolId = `wf-${hash(card.graphicId)}`;
    if (!symbols.has(symbolId)) {
        const symbol = templateSymbol(card.graphicId, symbolId);
        if (!symbol) {
            warnings.push(`card ${q(card.id)}: unknown screen template ${q(card.graphicId)}`);
            return placeholder({ lines: ['template not found', card.graphicId] });
        }
        symbols.set(symbolId, symbol);
    }
    return `<use href="#${symbolId}" ${geometry}/>`;
};

const renderCard = (
    card: Card,
    box: Box,
    symbols: Map<string, string>,
    warnings: string[],
    options: RenderOptions
): string => {
    const { width: w, height: h, header } = cardSize(card);
    const parts: string[] = [
        `<rect x="0.5" y="0.5" width="${n(w - 1)}" height="${n(h - 1)}" rx="6" fill="#fff" stroke="#bcc2c6"/>`
    ];
    if (header) {
        // Заголовок 24px с верхними углами 5px (flow-node-header), текст 10px/600 по центру,
        // обрезка как в редакторе; три точки справа — декор меню.
        parts.push(
            `<path d="M1,${HEADER + 1} V6 Q1,1 6,1 H${n(w - 6)} Q${n(w - 1)},1 ${n(w - 1)},6 V${HEADER + 1} Z" fill="#ebeff0"/>`
        );
        const raw = card.headerText;
        const cut = [...raw].length > HEADER_MAX_CHARS ? `${[...raw].slice(0, 20).join('')}...` : raw;
        parts.push(
            text(
                w / 2,
                baseline(1, HEADER, 10),
                fitText(cut, 10, true, w - 16 - 20),
                'text-anchor="middle" font-size="10" font-weight="600" fill="#94a4a5"'
            )
        );
        for (const dx of [10, 17, 24])
            parts.push(`<circle cx="${n(w - dx)}" cy="${n(1 + HEADER / 2)}" r="2" fill="#c4cbd1"/>`);
    }
    const imgBox = { x: BORDER, y: BORDER + header, width: w - 2 * BORDER, height: h - 2 * BORDER - header };
    parts.push(cardImage(card, imgBox, symbols, warnings, options));
    return `<g transform="translate(${n(box.x)} ${n(box.y)})">${parts.join('')}</g>`;
};

const renderNote = (note: Note, box: Box): string => {
    const size = 12;
    const lineHeight = 18;
    const padX = 12;
    const padY = 8;
    const maxLines = Math.max(1, Math.floor((box.height - 2 * padY) / lineHeight));
    let lines = wrapText(note.text, size, box.width - 2 * padX);
    if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        lines[maxLines - 1] = fitText(`${lines[maxLines - 1]}…`, size, false, box.width - 2 * padX);
    }
    const body = lines
        .filter((l) => l !== '' || lines.length > 1)
        .map((l, i) =>
            l === ''
                ? ''
                : `<tspan x="${padX}" y="${n(baseline(padY + i * lineHeight, lineHeight, size))}">${escapeXml(l)}</tspan>`
        )
        .join('');
    return (
        `<g transform="translate(${n(box.x)} ${n(box.y)})">` +
        `<rect x="0.5" y="0.5" width="${n(box.width - 1)}" height="${n(box.height - 1)}" rx="6" fill="#fffcf0" stroke="#e8dcaa"/>` +
        (body ? `<text font-size="${size}" fill="#2d2b33">${body}</text>` : '') +
        '</g>'
    );
};

const renderGroup = (group: Group, box: Box): string => {
    const label = fitText(group.label.toUpperCase(), 11, true, box.width - 24);
    return (
        `<g transform="translate(${n(box.x)} ${n(box.y)})">` +
        `<rect x="0.75" y="0.75" width="${n(box.width - 1.5)}" height="${n(box.height - 1.5)}" rx="10" ` +
        'fill="#eef0ff" fill-opacity="0.45" stroke="#b8bfd6" stroke-width="1.5" stroke-dasharray="4.5 4.5"/>' +
        (label
            ? text(
                  12,
                  baseline(8, 13, 11),
                  label,
                  'font-size="11" font-weight="700" letter-spacing="0.44" fill="#6b6875"'
              )
            : '') +
        '</g>'
    );
};

interface Bounds {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}
const extend = (b: Bounds, x: number, y: number): void => {
    b.x0 = Math.min(b.x0, x);
    b.y0 = Math.min(b.y0, y);
    b.x1 = Math.max(b.x1, x);
    b.y1 = Math.max(b.y1, y);
};

const edgePath = (e: WireflowEdge, source: Box, target: Box): EdgePath => {
    // Хендлы фиксированы: источник — низ по центру, цель — верх по центру (flow-node.tsx).
    const params = {
        sourceX: source.x + source.width / 2,
        sourceY: source.y + source.height,
        targetX: target.x + target.width / 2,
        targetY: target.y
    };
    if (e.shape === 'bezier') return getBezierPath(params);
    return getSmoothStepPath({ ...params, borderRadius: e.shape === 'step' ? 0 : 5 });
};

const renderEdge = (
    e: WireflowEdge,
    boxes: Map<string, Box>,
    markers: Map<string, string>,
    bounds: Bounds
): string => {
    const [raw, labelX, labelY] = edgePath(e, boxes.get(e.source) as Box, boxes.get(e.target) as Box);
    // Контрольные точки ограничивают кривую — хватает всех координат пути. Числа пути
    // округляются, как и остальные (функции React Flow отдают полный double).
    const nums = raw.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? [];
    for (let i = 0; i + 1 < nums.length; i += 2) extend(bounds, Number(nums[i]), Number(nums[i + 1]));
    const d = raw.replace(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g, (v) => n(Number(v)));
    const color = e.color ?? DEFAULT_EDGE_COLOR;
    // Маркер — один на цвет, id от цвета: resvg игнорирует url() в кавычках, а случайных id нет.
    // Суффикс — только если разные цвета дали одинаковый id (`red` и `#red`).
    let markerId = markers.get(color);
    if (!markerId) {
        const base = `wf-arrow-${color.replace(/[^a-z0-9]/gi, '') || 'x'}`;
        const taken = new Set(markers.values());
        markerId = base;
        for (let i = 1; taken.has(markerId); i++) markerId = `${base}-${i}`;
        markers.set(color, markerId);
    }
    let svg = `<path d="${d}" fill="none" stroke="${attr(color)}" stroke-width="${n(e.width)}" marker-end="url(#${markerId})"/>`;
    if (e.label) {
        // Плашка подписи React Flow (EdgeText): padding 6×3, радиус 4, текст 11px/600 #6b6875.
        const size = 11;
        const tw = textWidth(e.label, size, true);
        const th = 13;
        const gx = labelX - tw / 2;
        const gy = labelY - th / 2;
        extend(bounds, gx - 6, gy - 3);
        extend(bounds, gx + tw + 6, gy + th + 3);
        svg +=
            `<g transform="translate(${n(gx)} ${n(gy)})">` +
            `<rect x="-6" y="-3" width="${n(tw + 12)}" height="${th + 6}" rx="4" fill="#fff"/>` +
            text(0, baseline(0, th, size), e.label, `font-size="${size}" font-weight="600" fill="#6b6875"`) +
            '</g>';
    }
    return svg;
};

const marker = (color: string, id: string): string =>
    `<marker id="${id}" markerWidth="12.5" markerHeight="12.5" viewBox="-10 -10 20 20" markerUnits="strokeWidth" ` +
    `orient="auto" refX="0" refY="0"><polyline stroke="${attr(color)}" fill="${attr(color)}" stroke-width="1" ` +
    'stroke-linecap="round" stroke-linejoin="round" points="-5,-4 0,0 -5,4 -5,-4"/></marker>';

export interface Rendered {
    svg: string;
    warnings: string[];
}

/**
 * Полный конвейер одного файла (разбор → раскладка → SVG), синхронно. Порядок слоёв как в
 * редакторе: группы (внешние первыми), рёбра, карточки и заметки в порядке файла. Холст —
 * рамка всех элементов с полями экспорта редактора, фон белый.
 */
export const renderWireflowSvg = (source: string, file: string, options: RenderOptions = {}): Rendered => {
    const { diagram } = parseWireflow(source, file);
    const warnings: string[] = [];
    const boxes = layoutWireflow(diagram);
    const bounds: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const b of boxes.values()) {
        extend(bounds, b.x, b.y);
        extend(bounds, b.x + b.width, b.y + b.height);
    }
    const byId = new Map(diagram.nodes.map((nd) => [nd.id, nd]));
    const depth = (nd: WireflowNode): number => {
        let d = 0;
        for (let p = nd.parentId; p !== undefined && d <= diagram.nodes.length; p = byId.get(p)?.parentId)
            d++;
        return d;
    };
    const symbols = new Map<string, string>();
    const markers = new Map<string, string>();
    const layers: string[] = [];
    for (const g of diagram.nodes.filter((nd) => nd.kind === 'group').sort((a, b) => depth(a) - depth(b)))
        layers.push(renderGroup(g, boxes.get(g.id) as Box));
    for (const e of diagram.edges) layers.push(renderEdge(e, boxes, markers, bounds));
    for (const nd of diagram.nodes) {
        if (nd.kind === 'flow')
            layers.push(renderCard(nd, boxes.get(nd.id) as Box, symbols, warnings, options));
        else if (nd.kind === 'note') layers.push(renderNote(nd, boxes.get(nd.id) as Box));
    }
    if (bounds.x0 === Infinity) Object.assign(bounds, { x0: 0, y0: 0, x1: 0, y1: 0 });
    const x = Math.floor(bounds.x0) - EXPORT_PADDING;
    const y = Math.floor(bounds.y0) - EXPORT_PADDING;
    const w = Math.ceil(bounds.x1) - Math.floor(bounds.x0) + 2 * EXPORT_PADDING;
    const h = Math.ceil(bounds.y1) - Math.floor(bounds.y0) + 2 * EXPORT_PADDING;
    const defs =
        [...symbols.values()].join('') + [...markers].map(([color, id]) => marker(color, id)).join('');
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" ` +
        `font-family="${DEFAULT_FONT_NAME}, Helvetica, Arial, sans-serif">` +
        (defs ? `<defs>${defs}</defs>` : '') +
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff"/>` +
        layers.join('') +
        '</svg>\n';
    return { svg, warnings };
};

// Контракт движка для сборки и `c4builder check`: file — путь для сообщений; предупреждения
// (неизвестный шаблон, внешняя картинка) печатаются, рендер не прерывают.
export const renderWireflow = async (
    source: string,
    file: string,
    options: RenderOptions = {}
): Promise<Buffer> => {
    const { svg, warnings } = renderWireflowSvg(source, file, options);
    for (const w of warnings) console.log(chalk.yellow(`⚠ ${file}: ${w}`));
    return Buffer.from(svg, 'utf8');
};
