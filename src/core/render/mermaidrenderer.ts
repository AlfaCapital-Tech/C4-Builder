import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { DEFAULT_FONT_NAME } from './fonts.ts';
import { getResvg, resvgFontOptions } from './pngraster.ts';
import { ASCENT, DESCENT, X_HEIGHT, clearTextWidths, textWidth } from './textmetrics.ts';

// Четвёртый бэкенд рендера: настоящий mermaid (официальная однофайловая сборка
// @mermaid-js/tiny) в окне jsdom → SVG. Геометрию, которой у jsdom нет (getBBox), считает
// resvg по вендорному шрифту. Пакет — optionalDependency, грузится лениво при первой
// mermaid-диаграмме: проекты без mermaid его не трогают (как D2 и BPMN).

// Версия пакета идёт в ключ кэша (render/diagrams): апгрейд mermaid обязан перерисовать.
export const MERMAID_PACKAGE = '@mermaid-js/tiny';

// problems — строка без пути файла (check печатает `✗ <file>: <problem>`), message — с путём.
export class MermaidError extends Error {
    readonly problems: string[];
    constructor(file: string, problem: string) {
        super(`${file}: ${problem}`);
        this.problems = [problem];
    }
}

interface MermaidApi {
    initialize(config: Record<string, unknown>): void;
    render(id: string, text: string): Promise<{ svg: string }>;
}
type MermaidWindow = Window & typeof globalThis & { mermaid: MermaidApi };
interface Dom {
    window: MermaidWindow;
    getInternalVMContext(): vm.Context;
}

// Конфигурация фиксирована (design §4): подписи — SVG <text> (foreignObject resvg не
// рисует), классический вид без фильтров neo, ширина gantt вместо нулевой ширины контейнера
// jsdom. Ключи, ломающие офлайн-рендер, закреплены через secure — %%{init}%% и frontmatter
// их не переопределят; остальное (тема, flowchart.curve…) mermaid применяет сам.
const CONFIG = {
    startOnLoad: false,
    securityLevel: 'strict',
    look: 'classic',
    theme: 'default',
    // Метрики считаются по Nimbus Sans; он метрически совместим с Helvetica/Arial — в
    // браузере без него SVG показывается ими с теми же размерами.
    fontFamily: `"${DEFAULT_FONT_NAME}", Helvetica, Arial, sans-serif`,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    journey: { textPlacement: 'tspan' },
    gantt: { useWidth: 800 },
    deterministicIds: true,
    suppressErrorRendering: true,
    secure: [
        'secure',
        'securityLevel',
        'startOnLoad',
        'maxTextSize',
        'suppressErrorRendering',
        'maxEdges',
        'look',
        'htmlLabels',
        'fontFamily',
        'themeCSS'
    ]
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT_SIZE = 16;

// Мини-каскад CSS для раскладки текста: getComputedStyle в jsdom не применяет стили mermaid
// к SVG (отдаёт начальные значения), а от text-anchor, кегля и baseline зависят все размеры.
const TEXT_PROPS = ['font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'alignment-baseline'];

const declarations = (css: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [, name, value] of css.matchAll(/([\w-]+)\s*:\s*([^;]+)/g))
        if (TEXT_PROPS.includes(name.toLowerCase()))
            out[name.toLowerCase()] = value.replace(/!important/, '').trim();
    return out;
};

const specificity = (selector: string): number =>
    (selector.match(/#[\w-]+/g)?.length ?? 0) * 10_000 +
    (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g)?.length ?? 0) * 100 +
    (selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?/g, ' ').match(/[a-z][\w-]*/gi)
        ?.length ?? 0);

interface Rule {
    selector: string;
    decls: Record<string, string>;
}
// Правила одного <style>, отсортированные по специфичности и порядку — побеждает последнее
// совпавшее. Кэш по элементу: mermaid пишет стили диаграммы один раз.
const rulesMemo = new WeakMap<Element, Rule[]>();
const styleRules = (style: Element): Rule[] => {
    let rules = rulesMemo.get(style);
    if (!rules) {
        const ranked: (Rule & { rank: number })[] = [];
        for (const [, selectors, body] of (style.textContent ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            const decls = declarations(body);
            if (!Object.keys(decls).length) continue;
            for (const selector of selectors.split(/,(?![^(]*\))/))
                ranked.push({
                    selector: selector.trim(),
                    decls,
                    rank: specificity(selector) * 1e4 + ranked.length
                });
        }
        rules = ranked.sort((a, b) => a.rank - b.rank);
        rulesMemo.set(style, rules);
    }
    return rules;
};
// Стили mermaid — прямые дети корневого <svg>; обход всего дерева на каждый замер давал
// минуту на диаграмму в тысячи узлов.
const cssRules = (el: Element): Rule[] => {
    const svg = el.closest('svg');
    return svg ? [...svg.children].filter((c) => c.localName === 'style').flatMap(styleRules) : [];
};

const matches = (el: Element, selector: string): boolean => {
    try {
        return el.matches(selector);
    } catch {
        return false; // селектор, который nwsapi не разбирает, браузерный и здесь не нужен
    }
};

// Значения на время одного замера: getBBox группы раскладывает все её тексты с общими
// предками. Между замерами mermaid меняет DOM — там кэш не живёт.
let valueMemo: Map<Element, Map<string, string>> | undefined;
const measure = <T>(fn: () => T): T => {
    if (valueMemo) return fn();
    valueMemo = new Map();
    try {
        return fn();
    } finally {
        valueMemo = undefined;
    }
};

// Значение у самого элемента: inline style > CSS > атрибут представления.
const ownValue = (el: Element, name: string): string => {
    const memo = valueMemo?.get(el);
    const cached = memo?.get(name);
    if (cached !== undefined) return cached;
    let value = declarations(el.getAttribute('style') ?? '')[name] ?? '';
    if (!value) {
        for (const rule of cssRules(el))
            if (rule.decls[name] && matches(el, rule.selector)) value = rule.decls[name];
        value ||= el.getAttribute(name) ?? '';
    }
    if (valueMemo) valueMemo.set(el, (memo ?? new Map()).set(name, value));
    return value;
};

const inherited = (el: Element | null, name: string): string => {
    for (let e = el; e; e = e.parentElement) {
        const value = ownValue(e, name);
        if (value) return value;
    }
    return '';
};

const fontSize = (el: Element | null): number => {
    for (let e = el; e; e = e.parentElement) {
        const value = ownValue(e, 'font-size');
        const n = Number.parseFloat(value);
        if (Number.isNaN(n)) continue;
        if (value.endsWith('%')) return (n / 100) * fontSize(e.parentElement);
        return value.endsWith('em') ? n * fontSize(e.parentElement) : n;
    }
    return FONT_SIZE;
};

const isBold = (el: Element): boolean => {
    const weight = inherited(el, 'font-weight');
    return weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
};

const length = (value: string | null, size: number): number => {
    const n = Number.parseFloat(value ?? '');
    if (Number.isNaN(n)) return 0;
    return value?.trim().endsWith('em') ? n * size : n;
};

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}
const EMPTY: Box = { x: 0, y: 0, width: 0, height: 0 };
// Округление гасит f32-шум resvg между платформами: из bbox считаются координаты SVG.
const round2 = (v: number): number => Math.round(v * 100) / 100;

interface Line {
    x: number;
    y: number;
    el: Element;
    runs: { text: string; size: number; bold: boolean }[];
}

// Bbox <text>, как у браузера: advance-ширина строк и em-box по ascent/descent шрифта,
// округлённым до пикселя (так делает Chrome; mermaid центрирует подписи по этой высоте).
// Строка — фрагмент от элемента с абсолютными x/y (так mermaid раскладывает переносы).
// ponytail: tspan только с dy без x продолжает строку по x в браузере, здесь — нет; у mermaid
// таких нет.
const textBox = (text: Element): Box => {
    const lines: Line[] = [];
    let x = 0;
    let y = 0;
    let line: Line | undefined;
    const walk = (node: Node): void => {
        if (node.nodeType === node.TEXT_NODE) {
            const el = node.parentElement;
            const value = (node.nodeValue ?? '').replace(/\s+/g, ' ');
            if (!el || (!line && !value.trim())) return;
            if (!line) {
                line = { x, y, el, runs: [] };
                lines.push(line);
            }
            line.runs.push({ text: value, size: fontSize(el), bold: isBold(el) });
            return;
        }
        if (node.nodeType !== node.ELEMENT_NODE) return;
        const el = node as Element;
        const size = fontSize(el);
        const ax = el.getAttribute('x');
        const ay = el.getAttribute('y');
        if (ax !== null) x = length(ax, size);
        if (ay !== null) y = length(ay, size);
        x += length(el.getAttribute('dx'), size);
        y += length(el.getAttribute('dy'), size);
        if (ax !== null || ay !== null) line = undefined;
        for (const child of el.childNodes) walk(child);
    };
    walk(text);
    let box: { x0: number; y0: number; x1: number; y1: number } | undefined;
    for (const l of lines) {
        // Пробелы по краям строки браузер схлопывает.
        const runs = l.runs.map((r, i) => ({
            ...r,
            text: i === 0 ? r.text.trimStart() : r.text
        }));
        const last = runs[runs.length - 1];
        last.text = last.text.trimEnd();
        const width = runs.reduce((sum, r) => sum + textWidth(r.text, r.size, r.bold), 0);
        if (width <= 0) continue;
        const size = runs[0].size;
        const anchor = inherited(l.el, 'text-anchor');
        const x0 = l.x - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0);
        const ascent = Math.round(ASCENT * size);
        const descent = Math.round(DESCENT * size);
        const baseline = inherited(l.el, 'dominant-baseline') || inherited(l.el, 'alignment-baseline');
        const shift =
            baseline === 'central'
                ? (ascent - descent) / 2
                : baseline === 'middle'
                  ? (X_HEIGHT * size) / 2
                  : 0;
        const b = { x0, y0: l.y + shift - ascent, x1: x0 + width, y1: l.y + shift + descent };
        box = box
            ? {
                  x0: Math.min(box.x0, b.x0),
                  y0: Math.min(box.y0, b.y0),
                  x1: Math.max(box.x1, b.x1),
                  y1: Math.max(box.y1, b.y1)
              }
            : b;
    }
    return box
        ? {
              x: round2(box.x0),
              y: round2(box.y0),
              width: round2(box.x1 - box.x0),
              height: round2(box.y1 - box.y0)
          }
        : EMPTY;
};

// Атрибуты оформления, которых нет в getBBox браузера (обводки, маркеры, фильтры);
// классы и стили mermaid в изолированном поддереве всё равно не применяются.
const PAINT_ATTRS =
    /\s(?:fill|stroke|stroke-width|stroke-dasharray|marker-start|marker-mid|marker-end|filter|opacity|fill-opacity|stroke-opacity|style|class)="[^"]*"/g;

// Bbox поддерева (design §3): тексты заменяются прямоугольниками своей раскладки, остальную
// геометрию в координатах элемента (без его transform) считает resvg. Тонкая обводка
// оставляет в bbox и линии без заливки.
const subtreeBox = (window: MermaidWindow, el: Element): Box => {
    const tag = el.localName;
    if (tag === 'text' || tag === 'tspan') return textBox(el);
    const live = [...el.querySelectorAll('text')];
    const clone = el.cloneNode(true) as Element;
    clone.removeAttribute('transform');
    for (const [i, t] of [...clone.querySelectorAll('text')].entries()) {
        const rect = window.document.createElementNS(SVG_NS, 'rect');
        for (const [k, v] of Object.entries(textBox(live[i]))) rect.setAttribute(k, String(v));
        const transform = t.getAttribute('transform');
        if (transform) rect.setAttribute('transform', transform);
        t.replaceWith(rect);
    }
    for (const style of clone.querySelectorAll('style')) style.remove();
    const serializer = new window.XMLSerializer();
    const inner = (tag === 'svg' ? [...clone.childNodes] : [clone])
        .map((n) => serializer.serializeToString(n))
        .join('')
        .replace(PAINT_ATTRS, '');
    const { Resvg } = getResvg();
    const b = new Resvg(
        `<svg xmlns="${SVG_NS}" fill="black" stroke="black" stroke-width="0.001">${inner}</svg>`,
        { font: resvgFontOptions(false) }
    ).getBBox();
    return b ? { x: round2(b.x), y: round2(b.y), width: round2(b.width), height: round2(b.height) } : EMPTY;
};

// Полифилы окна: ровно то, что mermaid зовёт при раскладке. getBoundingClientRect нужен pie
// (ширина легенды); позиция без CTM — mermaid берёт от него только размеры.
const installPolyfills = (window: MermaidWindow): void => {
    Object.assign(window.SVGElement.prototype, {
        getBBox(this: Element) {
            return measure(() => subtreeBox(window, this));
        },
        getComputedTextLength(this: Element) {
            return measure(() => textBox(this).width);
        },
        getBoundingClientRect(this: Element) {
            const b = measure(() => subtreeBox(window, this));
            return { ...b, left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
        }
    });
    window.structuredClone = structuredClone;
};

interface Engine {
    window: MermaidWindow;
}

// Имя пакета переменной: у jsdom нет типов, а import() по литералу потребовал бы их.
const load = <T>(name: string): Promise<T> => import(name) as Promise<T>;

let enginePromise: Promise<Engine> | null = null;

const getEngine = (): Promise<Engine> => {
    enginePromise ??= (async () => {
        let JSDOM: new (html: string, options: unknown) => Dom;
        let VirtualConsole: new () => unknown;
        let bundle: string;
        try {
            ({ JSDOM, VirtualConsole } = await load<{
                JSDOM: typeof JSDOM;
                VirtualConsole: typeof VirtualConsole;
            }>('jsdom'));
            // import.meta.resolve, а не require.resolve: на Node 22 только он проходит через
            // хуки резолва module.registerHooks (тесты «пакет не установлен»).
            bundle = readFileSync(new URL(import.meta.resolve(MERMAID_PACKAGE)), 'utf8');
        } catch (err) {
            enginePromise = null; // провал импорта не кешируем — даём повторить
            throw new Error(
                `Rendering mermaid diagrams requires the optional packages ${MERMAID_PACKAGE} and jsdom.\n` +
                    'Reinstall without --omit=optional: npm i -g @alfacapital-tech/c4builder\n' +
                    `Original error: ${(err as Error).message || err}`
            );
        }
        // Консоль окна глушим: mermaid пишет туда отладку, ошибки мы берём из исключений.
        const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            runScripts: 'outside-only',
            virtualConsole: new VirtualConsole()
        });
        installPolyfills(dom.window);
        // Бандл исполняется в VM-контексте окна: глобальные объекты процесса Node не трогаются.
        // Не window.eval: бандл в strict-режиме, и его var в strict-eval не попал бы в window.
        vm.runInContext(bundle, dom.getInternalVMContext());
        dom.window.mermaid.initialize(CONFIG);
        return { window: dom.window };
    })();
    return enginePromise;
};

// Окно jsdom одно на процесс; закрывается после одиночной сборки и в check (как у BPMN),
// чтобы CLI завершался. Не бросает — иначе затёр бы исходную причину падения.
export const teardownMermaid = async (): Promise<void> => {
    if (!enginePromise) return;
    const pending = enginePromise;
    enginePromise = null;
    clearTextWidths();
    try {
        (await pending).window.close();
    } catch {
        // движок не поднялся — закрывать нечего
    }
};

// mulberry32: детерминированная замена Math.random на время рендера.
const prng = (seed: number): (() => number) => {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

// Детерминизм (design §5): Math.random (кривые связей ER и др.) — от seed источника,
// «сегодня» (маркер текущего дня gantt) — эпоха 0, иначе SVG менялся бы от сборки к сборке.
// Глобальный конфиг mermaid и подмены на параллельность не рассчитаны: рендеры строго
// последовательные (очередь mermaid в render/diagrams, check — по файлу).
const renderSvg = async (
    window: MermaidWindow,
    id: string,
    seed: number,
    source: string
): Promise<string> => {
    const { Math: math, Date: RealDate } = window;
    const random = math.random;
    math.random = prng(seed);
    window.Date = new Proxy(RealDate, {
        construct: (target, args) => Reflect.construct(target, args.length ? args : [0]),
        get: (target, key) => (key === 'now' ? () => 0 : Reflect.get(target, key))
    });
    try {
        return (await window.mermaid.render(id, source)).svg;
    } finally {
        math.random = random;
        window.Date = RealDate;
    }
};

// Строки источника, которые разбирает mermaid, — по номерам файла: mermaid вырезает
// frontmatter, директивы %%{…}%%, комментарии %% (вместе с пустыми строками перед ними) и
// пустые строки в начале, а номера строк в ошибках считает от остатка.
// ponytail: многострочная директива в середине диаграммы сдвинет номера — такие не встречались.
const FRONTMATTER = /^-{3}\s*[\n\r](.*?)[\n\r]-{3}\s*[\n\r]+/s;
const parsedLines = (source: string): number[] => {
    const fm = FRONTMATTER.exec(source)?.[0] ?? '';
    const offset = fm.split('\n').length - 1;
    const body = source
        .slice(fm.length)
        .replace(/%%\{[\s\S]*?\}%%/g, (d) => '\n'.repeat(d.split('\n').length - 1));
    const kept: number[] = [];
    let blanks: number[] = [];
    for (const [i, line] of body.split(/\r?\n/).entries()) {
        if (/^\s*%%(?!\{)./.test(line)) blanks = [];
        else if (!line.trim()) blanks.push(offset + i + 1);
        else {
            if (kept.length) kept.push(...blanks);
            blanks = [];
            kept.push(offset + i + 1);
        }
    }
    return kept;
};

const UNSUPPORTED = /^(mindmap|architecture[\w-]*)$/;
const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, '; ').trim();

// Ошибка движка → `line N: …` с номером строки файла (design §7). Ошибки из окна — объекты
// другого realm, instanceof Error для них ложен.
const problemOf = (err: unknown, lines: number[], type: string): string => {
    const raw = String((err as { message?: unknown } | undefined)?.message ?? err);
    const toFile = (n: string): number => lines[Number(n) - 1] ?? Number(n);
    if (/No diagram type detected/.test(raw))
        return `line ${lines[0] ?? 1}: unknown mermaid diagram type '${type || '(empty)'}'`;
    // jison: «Parse error on line N:», фрагмент, строка-указатель «---^», ожидаемые токены.
    const jison = /^Parse error on line (\d+):\n([\s\S]*)$/.exec(raw);
    if (jison)
        return `line ${toFile(jison[1])}: ${oneLine(
            jison[2]
                .split('\n')
                .filter((l) => !/^-*\^$/.test(l.trim()))
                .join('\n')
        )}`;
    const at = /\bline (\d+)/.exec(raw);
    const message = oneLine(raw.replace(/\bline (\d+)/g, (_, n: string) => `line ${toFile(n)}`));
    return at ? `line ${toFile(at[1])}: ${message}` : message;
};

// Постобработка SVG: id внутри документа — по порядку появления от корня (счётчики mermaid
// растут между рендерами в одном окне), ссылки url(#…) без кавычек (в кавычках resvg их
// игнорирует), без фильтров (resvg не рисует узел с невалидным фильтром).
const finalizeSvg = (svg: string, root: string): string => {
    const ids = new Map<string, string>();
    for (const [, id] of svg.matchAll(/\sid="([^"]+)"/g))
        if (id !== root && !ids.has(id)) ids.set(id, `${root}-${ids.size}`);
    const rename = (id: string): string => ids.get(id) ?? id;
    return svg
        .replace(/<filter\b[\s\S]*?<\/filter>|<filter\b[^>]*\/>/g, '')
        .replace(/\sfilter="[^"]*"/g, '')
        .replace(/(\sid=")([^"]+)"/g, (_, attr: string, id: string) => `${attr}${rename(id)}"`)
        .replace(/url\((['"]?)#([^)'"]+)\1\)/g, (_, _q, id: string) => `url(#${rename(id)})`)
        .replace(/(\s(?:xlink:)?href="#)([^"]+)"/g, (_, attr: string, id: string) => `${attr}${rename(id)}"`)
        .replace(
            /(\saria-(?:labelledby|describedby)=")([^"]+)"/g,
            (_, attr: string, list: string) => `${attr}${list.split(' ').map(rename).join(' ')}"`
        )
        .replace(/<style>([\s\S]*?)<\/style>/g, (_, css: string) => `<style>${resvgCss(css)}</style>`)
        .replace(/rgba?\(([\d.\s,]+)\)/g, (whole: string, args: string) =>
            whole.replace(
                args,
                args
                    .split(',')
                    .map((a, i) => (i < 3 ? String(Math.round(Number.parseFloat(a))) : a.trim()))
                    .join(', ')
            )
        );
};

// CSS под resvg: правило со списком селекторов, где хоть один ему непонятен
// ([id$=…]), выбрасывается целиком — разносим список по правилам. Дробные каналы rgba()
// resvg не разбирает и красит чёрным — округляем (выше, для всего SVG).
const resvgCss = (css: string): string =>
    css
        .replace(/filter:[^;}]*;?/g, '')
        .replace(/([^{}]+)\{([^{}]*)\}/g, (whole: string, selectors: string, body: string) => {
            const list = selectors.split(/,(?![^(]*\))/);
            return list.length > 1 ? list.map((s) => `${s.trim()}{${body}}`).join('') : whole;
        });

const lineOf = (source: string, index: number): number => source.slice(0, index).split('\n').length;

// Полный конвейер одного источника — общий для сборки и `c4builder check`. file — путь для
// сообщений (у блока в markdown — его страница).
export const renderMermaid = async (source: string, file: string): Promise<Buffer> => {
    const text = source.replace(/^﻿/, '');
    const lines = parsedLines(text);
    const type = /^[\w-]+/.exec(text.split(/\r?\n/)[(lines[0] ?? 1) - 1]?.trim() ?? '')?.[0] ?? '';
    // tiny-сборка не включает эти типы и KaTeX: без проверки — невнятное «No diagram type
    // detected» или формула сырым текстом на картинке.
    if (UNSUPPORTED.test(type))
        throw new MermaidError(file, `line ${lines[0]}: unsupported mermaid diagram type '${type}'`);
    const math = /\$\$[\s\S]+?\$\$/.exec(text);
    if (math)
        throw new MermaidError(
            file,
            `line ${lineOf(text, math.index)}: unsupported mermaid feature 'KaTeX math' ($$...$$)`
        );
    const { window } = await getEngine();
    const hash = crypto.createHash('sha1').update(text).digest('hex');
    const id = `m${hash.slice(0, 8)}`;
    let svg: string;
    try {
        svg = await renderSvg(window, id, Number.parseInt(hash.slice(8, 16), 16), text);
    } catch (err) {
        throw new MermaidError(file, problemOf(err, lines, type));
    }
    // Тип, который игнорирует htmlLabels, дал бы в PNG пустые подписи.
    if (svg.includes('<foreignObject'))
        throw new MermaidError(
            file,
            `diagram type '${type}' uses HTML labels, which cannot be rendered offline`
        );
    return Buffer.from(finalizeSvg(svg, id), 'utf8');
};
