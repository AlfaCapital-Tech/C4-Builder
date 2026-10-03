import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import chalk from 'chalk';

import { DEFAULT_FONT_NAME } from './fonts.ts';
import { getResvg, resvgFontOptions } from './pngraster.ts';

// Третий бэкенд рендера: BPMN 2.0 XML без координат → валидация (bpmnlint) → раскладка
// (bpmn-auto-layout) → рендер bpmn-js в jsdom → SVG. Все пакеты — optionalDependencies,
// грузятся лениво при первом .bpmn: проекты без BPMN их не трогают (как D2).

const require = createRequire(import.meta.url);

// Версии этих пакетов идут в ключ кэша (render/diagrams): сдвиг раскладки, рендера или
// правил валидации обязан перерисовать диаграмму.
export const BPMN_CACHE_PACKAGES = ['bpmn-js', 'bpmn-auto-layout', 'bpmnlint'];

// Ошибка конвейера: problems — по строке на нарушение без пути файла (check печатает их
// как `✗ <file>: <problem>`), message — те же строки с путём для сборки.
export class BpmnError extends Error {
    readonly problems: string[];
    constructor(file: string, problems: string[]) {
        super(problems.map((p) => `${file}: ${p}`).join('\n'));
        this.problems = problems;
    }
}

// Минимальные контракты внешних пакетов (своих типов у них нет) — только используемое.
interface BpmnElement {
    $type: string;
    id: string;
    name?: string;
    $parent?: BpmnElement;
    $instanceOf(type: string): boolean;
    rootElements?: BpmnElement[];
    diagrams?: BpmnDiagram[];
    flowElements?: BpmnElement[];
    laneSets?: BpmnElement[];
    lanes?: BpmnElement[];
    childLaneSet?: BpmnElement;
    flowNodeRef?: BpmnElement[];
    participants?: BpmnElement[];
    messageFlows?: BpmnElement[];
    processRef?: BpmnElement;
    sourceRef?: BpmnElement;
    targetRef?: BpmnElement;
    incoming?: BpmnElement[];
    outgoing?: BpmnElement[];
    default?: BpmnElement;
}
interface BpmnDiagram {
    plane?: { planeElement?: { bpmnElement?: BpmnElement }[] };
}
interface ParseResult {
    rootElement: BpmnElement;
    warnings: { message: string; element?: { id?: string } }[];
}
interface Moddle {
    fromXML(xml: string): Promise<ParseResult>;
    toXML(root: BpmnElement): Promise<{ xml: string }>;
}
interface LintReport {
    id?: string;
    message: string;
    category: string;
}
interface Linter {
    lint(root: BpmnElement): Promise<Record<string, LintReport[]>>;
}
type LayoutFn = (
    xml: string
) => Promise<{ xml: string; warnings: { code?: string; elementId?: string; message: string }[] }>;
interface DiElement {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    waypoints?: { x: number; y: number }[];
}
interface Viewer {
    importXML(xml: string): Promise<{ warnings: { message: string; element?: { id?: string } }[] }>;
    saveSVG(): Promise<{ svg: string }>;
    get(name: 'elementRegistry'): { getAll(): DiElement[] };
    destroy(): void;
}
interface DomNode {
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    remove(): void;
}
interface BpmnWindow {
    eval(code: string): void;
    close(): void;
    document: { createElement(tag: string): DomNode; body: { appendChild(node: DomNode): void } };
    BpmnJS: new (options: unknown) => Viewer;
    [key: string]: unknown;
}
interface Engine {
    moddle: Moddle;
    createLinter: () => Linter;
    layoutProcess: LayoutFn;
    window: BpmnWindow;
}

// Имя пакета переменной: у пакетов нет типов, а import() по литералу потребовал бы их.
const load = <T>(name: string): Promise<T> => import(name) as Promise<T>;

// Набор правил фиксирован (design §4): recommended без no-bpmndi (DI в источнике не нужен
// и всё равно отбрасывается) + правила c4builder. Проектного .bpmnlintrc нет сознательно:
// что проверил агент через check, то же проверит CI.
const lintConfig = (recommended: Record<string, string>) => ({
    rules: {
        ...recommended,
        'no-bpmndi': 'off',
        'c4builder/lane-membership': 'error',
        'c4builder/sequence-flow-in-pool': 'error',
        'c4builder/message-flow-between-pools': 'error',
        'c4builder/gateway-flow-labels': 'warn'
    }
});

type Reporter = { report(id: string, message: string): void };
type Rule = () => { check(node: BpmnElement, reporter: Reporter): void };

const processOf = (el: BpmnElement | undefined): BpmnElement | undefined => {
    let cur = el;
    while (cur && !cur.$instanceOf('bpmn:Process')) cur = cur.$parent;
    return cur;
};

// Листовые дорожки: у вложенной дорожки родитель по стандарту перечисляет те же узлы.
const leafLanes = (laneSets: BpmnElement[] = []): BpmnElement[] =>
    laneSets
        .flatMap((s) => s.lanes ?? [])
        .flatMap((l) => (l.childLaneSet?.lanes?.length ? leafLanes([l.childLaneSet]) : [l]));

const C4BUILDER_RULES: Record<string, Rule> = {
    'lane-membership': () => ({
        check(node, reporter) {
            if (!node.$instanceOf('bpmn:Process')) return;
            const lanes = leafLanes(node.laneSets);
            if (!lanes.length) return;
            const member = new Map<BpmnElement, string[]>();
            for (const lane of lanes)
                for (const ref of lane.flowNodeRef ?? [])
                    member.set(ref, [...(member.get(ref) ?? []), lane.id]);
            for (const el of node.flowElements ?? []) {
                if (!el.$instanceOf('bpmn:FlowNode')) continue;
                const of = member.get(el) ?? [];
                // Граничное событие рисуется на границе своей задачи — дорожку берёт от неё.
                if (!of.length && !el.$instanceOf('bpmn:BoundaryEvent'))
                    reporter.report(el.id, 'Flow node is not in any lane of its process');
                if (of.length > 1) reporter.report(el.id, `Flow node is in several lanes: ${of.join(', ')}`);
            }
        }
    }),
    'sequence-flow-in-pool': () => ({
        check(node, reporter) {
            if (!node.$instanceOf('bpmn:SequenceFlow')) return;
            const own = processOf(node);
            if (processOf(node.sourceRef) !== own || processOf(node.targetRef) !== own)
                reporter.report(
                    node.id,
                    'Sequence flow crosses a pool boundary; connect pools with a message flow'
                );
        }
    }),
    'message-flow-between-pools': () => ({
        check(node, reporter) {
            if (!node.$instanceOf('bpmn:MessageFlow')) return;
            const participants = node.$parent?.participants ?? [];
            const poolOf = (el: BpmnElement | undefined): BpmnElement | undefined =>
                el?.$instanceOf('bpmn:Participant')
                    ? el
                    : participants.find((p) => p.processRef && p.processRef === processOf(el));
            const source = poolOf(node.sourceRef);
            if (source && source === poolOf(node.targetRef))
                reporter.report(
                    node.id,
                    'Message flow connects elements of the same pool; use a sequence flow'
                );
        }
    }),
    'gateway-flow-labels': () => ({
        check(node, reporter) {
            if (!node.$instanceOf('bpmn:ExclusiveGateway') && !node.$instanceOf('bpmn:InclusiveGateway'))
                return;
            const outgoing = node.outgoing ?? [];
            if (outgoing.length < 2) return;
            for (const flow of outgoing)
                if (!flow.name?.trim() && flow !== node.default)
                    reporter.report(flow.id, 'Outgoing flow of a diverging gateway has no label');
        }
    })
};

// Ширины строк для переноса подписей: diagram-js меряет текст только через
// canvas.measureText, а jsdom канваса не умеет. Меряем вендорный Nimbus Sans тем же
// resvg, что растрирует PNG: ширина = bbox «|текст|» минус bbox «||» — так получается
// advance-ширина с пробелами по краям, а не ширина чернил. Режим системных шрифтов на
// BPMN не влияет (как и на D2): детерминизм важнее.
const widthMemo = new Map<string, number>();
const escapeXml = (s: string): string =>
    s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
const inkWidth = (text: string, size: number): number => {
    const { Resvg } = getResvg();
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><text y="${size}" ` +
        `font-family="${DEFAULT_FONT_NAME}" font-size="${size}" xml:space="preserve">${escapeXml(text)}</text></svg>`;
    return new Resvg(svg, { font: resvgFontOptions(false) }).getBBox()?.width ?? 0;
};
const textWidth = (text: string, size: number): number => {
    const key = `${size}\0${text}`;
    let width = widthMemo.get(key);
    if (width === undefined) {
        // Округление гасит f32-шум resvg между платформами: координаты текста в SVG
        // считаются из этой ширины и должны совпадать побайтно.
        width = Math.round((inkWidth(`|${text}|`, size) - inkWidth('||', size)) * 100) / 100;
        widthMemo.set(key, width);
    }
    return width;
};
// hhea Nimbus Sans Regular: ascender 729, descender −271 на 1000 единиц (vendor/fonts).
const ASCENT = 0.729;
const DESCENT = 0.271;

// Полифилы окна jsdom: ровно то, что bpmn-js зовёт при импорте и saveSVG. Трансформации
// пишутся в атрибут сразу — сериализатор берёт атрибуты, а не baseVal.
const installPolyfills = (window: BpmnWindow): void => {
    class Matrix {
        constructor(
            public a = 1,
            public b = 0,
            public c = 0,
            public d = 1,
            public e = 0,
            public f = 0
        ) {}
        multiply(m: Matrix): Matrix {
            return new Matrix(
                this.a * m.a + this.c * m.b,
                this.b * m.a + this.d * m.b,
                this.a * m.c + this.c * m.d,
                this.b * m.c + this.d * m.d,
                this.a * m.e + this.c * m.f + this.e,
                this.b * m.e + this.d * m.f + this.f
            );
        }
    }
    class Transform {
        matrix = new Matrix();
        setMatrix(m: Matrix): void {
            this.matrix = new Matrix(m.a, m.b, m.c, m.d, m.e, m.f);
        }
        setTranslate(x: number, y: number): void {
            this.matrix = new Matrix(1, 0, 0, 1, x, y);
        }
        setScale(x: number, y: number): void {
            this.matrix = new Matrix(x, 0, 0, y);
        }
        setRotate(angle: number): void {
            const r = (angle * Math.PI) / 180;
            this.matrix = new Matrix(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r));
        }
    }
    const fromMatrix = (m: Matrix): Transform => {
        const t = new Transform();
        t.setMatrix(m);
        return t;
    };
    // -0 и хвосты плавающей точки в атрибуте дали бы разный текст для одинаковой геометрии.
    const num = (v: number): number => Number(v.toFixed(6)) || 0;
    class TransformList {
        items: Transform[] = [];
        constructor(private el: DomNode) {}
        clear(): void {
            this.items = [];
            this.el.removeAttribute('transform');
        }
        appendItem(t: Transform): Transform {
            this.items.push(t);
            const m = this.items.reduce((acc, i) => acc.multiply(i.matrix), new Matrix());
            this.el.setAttribute('transform', `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map(num).join(' ')})`);
            return t;
        }
        createSVGTransformFromMatrix = fromMatrix;
        consolidate(): Transform | null {
            return this.items.length
                ? fromMatrix(this.items.reduce((acc, i) => acc.multiply(i.matrix), new Matrix()))
                : null;
        }
    }
    const polyline = (el: DomNode) => {
        const pts = [...(el.getAttribute('d') ?? '').matchAll(/[MLC]([^MLCZ]+)/gi)].map((m) => {
            const n = m[1]
                .trim()
                .split(/[\s,]+/)
                .map(Number);
            return { x: n[n.length - 2], y: n[n.length - 1] };
        });
        const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
        return {
            length: seg.reduce((a, b) => a + b, 0),
            pointAt(at: number) {
                let rest = at;
                for (const [i, len] of seg.entries()) {
                    if (rest <= len && len > 0) {
                        const t = rest / len;
                        return {
                            x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
                            y: pts[i].y + (pts[i + 1].y - pts[i].y) * t
                        };
                    }
                    rest -= len;
                }
                return pts[pts.length - 1] ?? { x: 0, y: 0 };
            }
        };
    };
    const lists = new WeakMap<object, TransformList>();
    const svgProto = (window.SVGElement as { prototype: object }).prototype;
    Object.defineProperty(svgProto, 'transform', {
        get(this: DomNode) {
            const list = lists.get(this) ?? new TransformList(this);
            lists.set(this, list);
            return { baseVal: list };
        }
    });
    Object.assign(svgProto, {
        createSVGMatrix: () => new Matrix(),
        createSVGTransform: () => new Transform(),
        createSVGTransformFromMatrix: fromMatrix,
        getCTM: () => new Matrix(),
        getScreenCTM: () => new Matrix(),
        // saveSVG зовёт его для viewBox, который пересчитывается из DI (finalizeSvg).
        // ponytail: подпись messageRef на message flow центрируется по getBBox и съезжает
        // на полширины вправо — честный bbox текста добавить, если такие подписи пойдут в ход.
        getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
        // Середина message flow для конверта messageRef: ломаная по концам сегментов
        // M/L/C пути diagram-js (скругления углов заменяются хордой).
        getTotalLength(this: DomNode) {
            return polyline(this).length;
        },
        getPointAtLength(this: DomNode, at: number) {
            return polyline(this).pointAt(at);
        }
    });
    window.SVGMatrix = Matrix;
    window.structuredClone = structuredClone;
    const ctx = {
        font: '12px sans-serif',
        measureText(text: string) {
            const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 12);
            return {
                width: textWidth(text, size),
                fontBoundingBoxAscent: ASCENT * size,
                fontBoundingBoxDescent: DESCENT * size
            };
        }
    };
    (window.HTMLCanvasElement as { prototype: { getContext: unknown } }).prototype.getContext = () => ctx;
};

let enginePromise: Promise<Engine> | null = null;

const getEngine = (): Promise<Engine> => {
    enginePromise ??= (async () => {
        let BpmnModdle: new () => Moddle;
        let LinterClass: new (options: unknown) => Linter;
        let layoutProcess: LayoutFn;
        let JSDOM: new (html: string, options: unknown) => { window: BpmnWindow };
        let VirtualConsole: new () => unknown;
        let bundlePath: string;
        // Последовательно, не Promise.all: bpmnlint (CJS) делает require() ESM-зависимостей,
        // которые параллельный import() ещё не догрузил, — Node падает на гонке.
        try {
            ({ BpmnModdle } = await load<{ BpmnModdle: typeof BpmnModdle }>('bpmn-moddle'));
            ({ Linter: LinterClass } = await load<{ Linter: typeof LinterClass }>('bpmnlint'));
            ({ layoutProcess } = await load<{ layoutProcess: LayoutFn }>('bpmn-auto-layout'));
            ({ JSDOM, VirtualConsole } = await load<{
                JSDOM: typeof JSDOM;
                VirtualConsole: typeof VirtualConsole;
            }>('jsdom'));
            bundlePath = require.resolve('bpmn-js/dist/bpmn-viewer.production.min.js');
        } catch (err) {
            enginePromise = null; // провал импорта не кешируем — даём повторить
            throw new Error(
                'Rendering .bpmn diagrams requires the optional packages bpmn-js, bpmn-moddle, bpmnlint, ' +
                    'bpmn-auto-layout and jsdom.\n' +
                    'Reinstall without --omit=optional: npm i -g @alfacapital-tech/c4builder\n' +
                    `Original error: ${(err as Error).message || err}`
            );
        }
        const recommended = (require('bpmnlint/config/recommended') as { rules: Record<string, string> })
            .rules;
        const resolver = {
            resolveRule: (pkg: string, name: string) =>
                pkg === 'bpmnlint' ? require(`bpmnlint/rules/${name}`) : C4BUILDER_RULES[name],
            resolveConfig: () => null
        };
        // Бандл Viewer исполняется внутри окна: глобальные объекты процесса Node не трогаются.
        // Консоль окна глушим: сбои импорта bpmn-js пишет туда, мы берём их из warnings.
        const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            runScripts: 'outside-only',
            virtualConsole: new VirtualConsole()
        });
        installPolyfills(window);
        window.eval(readFileSync(bundlePath, 'utf8'));
        return {
            moddle: new BpmnModdle(),
            // Линтер — на каждый прогон: правила bpmnlint (no-duplicate-sequence-flows и др.)
            // копят состояние в замыкании фабрики, и повторный lint тем же инстансом
            // объявил бы дубликатами все потоки.
            createLinter: () => new LinterClass({ config: lintConfig(recommended), resolver }),
            layoutProcess,
            window
        };
    })();
    return enginePromise;
};

// Окно jsdom одно на процесс; закрывается после одиночной сборки и в check (как воркер
// D2), чтобы CLI завершался. Не бросает — иначе затёр бы исходную причину падения.
export const teardownBpmn = async (): Promise<void> => {
    if (!enginePromise) return;
    const pending = enginePromise;
    enginePromise = null;
    widthMemo.clear();
    try {
        (await pending).window.close();
    } catch {
        // движок не поднялся — закрывать нечего
    }
};

const visit = (el: BpmnElement, fn: (el: BpmnElement) => void): void => {
    fn(el);
    for (const child of el.flowElements ?? []) visit(child, fn);
};

// Разбор и нормализация (design §3.1). bpmnlint и раскладчик опираются на
// incoming/outgoing, а агент пишет только sourceRef/targetRef — восстанавливаем их по
// потокам, иначе каскад ложных no-disconnected. DI источника отбрасываем всегда.
export const parseBpmn = async (xml: string, file: string): Promise<BpmnElement> => {
    const { moddle } = await getEngine();
    let parsed: ParseResult;
    try {
        parsed = await moddle.fromXML(xml.replace(/^﻿/, ''));
    } catch (err) {
        throw new BpmnError(file, [`invalid BPMN XML: ${oneLine((err as Error).message)}`]);
    }
    if (parsed.warnings.length)
        throw new BpmnError(
            file,
            parsed.warnings.map((w) => `${w.element?.id ? `${w.element.id}: ` : ''}${oneLine(w.message)}`)
        );
    const definitions = parsed.rootElement;
    const elements: BpmnElement[] = [];
    for (const root of definitions.rootElements ?? []) visit(root, (el) => elements.push(el));
    for (const el of elements)
        if (el.$instanceOf('bpmn:FlowNode')) {
            el.incoming = [];
            el.outgoing = [];
        }
    for (const flow of elements)
        if (flow.$instanceOf('bpmn:SequenceFlow')) {
            flow.sourceRef?.outgoing?.push(flow);
            flow.targetRef?.incoming?.push(flow);
        }
    definitions.diagrams = [];
    return definitions;
};

const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ', ');

export const lintBpmn = async (
    definitions: BpmnElement
): Promise<{ errors: string[]; warnings: string[] }> => {
    const linter = (await getEngine()).createLinter();
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const [rule, reports] of Object.entries(await linter.lint(definitions)))
        for (const r of reports)
            (r.category === 'warn' ? warnings : errors).push(`${r.id ?? '-'} [${rule}] ${r.message}`);
    return { errors, warnings };
};

// Элементы, которые обязаны получить фигуру в DI (защита от bpmn-auto-layout#154:
// раскладчик молча теряет узлы и рёбра при пустых warnings).
const expectedDi = (definitions: BpmnElement): BpmnElement[] => {
    const out: BpmnElement[] = [];
    const lanes = (sets: BpmnElement[] = []): void => {
        for (const lane of sets.flatMap((s) => s.lanes ?? [])) {
            out.push(lane);
            if (lane.childLaneSet) lanes([lane.childLaneSet]);
        }
    };
    for (const root of definitions.rootElements ?? []) {
        out.push(...(root.participants ?? []), ...(root.messageFlows ?? []));
        if (!root.$instanceOf('bpmn:Process')) continue;
        visit(root, (el) => {
            lanes(el.laneSets);
            if (el.$instanceOf('bpmn:FlowNode') || el.$instanceOf('bpmn:SequenceFlow')) out.push(el);
        });
    }
    return out;
};

export const layoutBpmn = async (
    definitions: BpmnElement,
    file: string,
    layout?: LayoutFn
): Promise<{ xml: string; warnings: string[] }> => {
    const engine = await getEngine();
    let result: Awaited<ReturnType<LayoutFn>>;
    try {
        result = await (layout ?? engine.layoutProcess)((await engine.moddle.toXML(definitions)).xml);
    } catch (err) {
        const e = err as Error & { elementId?: string };
        throw new BpmnError(file, [
            `layout failed: ${e.elementId ? `${e.elementId}: ` : ''}${oneLine(e.message || String(e))}`
        ]);
    }
    const laidOut = (await engine.moddle.fromXML(result.xml)).rootElement;
    const drawn = new Set(
        (laidOut.diagrams ?? []).flatMap((d) => (d.plane?.planeElement ?? []).map((p) => p.bpmnElement?.id))
    );
    const lost = expectedDi(laidOut)
        .map((el) => el.id)
        .filter((id) => !drawn.has(id));
    if (lost.length)
        throw new BpmnError(file, [
            `layout lost ${lost.length} element(s): ${lost.join(', ')} (bpmn-auto-layout defect; ` +
                'simplify or split the model)'
        ]);
    return {
        xml: result.xml,
        warnings: result.warnings.map(
            (w) => `${w.elementId ?? '-'} [layout${w.code ? `:${w.code}` : ''}] ${oneLine(w.message)}`
        )
    };
};

// Постобработка SVG (design §3.5): viewBox по DI вместо getBBox, детерминированные id
// маркеров (bpmn-js генерирует случайные) и url(#…) без кавычек — resvg ссылки в
// кавычках игнорирует, и стрелки в PNG пропадают.
const PADDING = 10;
const finalizeSvg = (svg: string, elements: DiElement[]): string => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const el of elements) {
        const points =
            el.waypoints ??
            (el.x === undefined || el.y === undefined
                ? []
                : [
                      { x: el.x, y: el.y },
                      { x: el.x + (el.width ?? 0), y: el.y + (el.height ?? 0) }
                  ]);
        for (const p of points) {
            x0 = Math.min(x0, p.x);
            y0 = Math.min(y0, p.y);
            x1 = Math.max(x1, p.x);
            y1 = Math.max(y1, p.y);
        }
    }
    if (x0 === Infinity) [x0, y0, x1, y1] = [0, 0, 0, 0];
    const x = Math.floor(x0) - PADDING;
    const y = Math.floor(y0) - PADDING;
    const w = Math.ceil(x1) - Math.floor(x0) + 2 * PADDING;
    const h = Math.ceil(y1) - Math.floor(y0) + 2 * PADDING;
    const ids = new Map<string, string>();
    for (const [, id] of svg.matchAll(/id="(marker-[^"]+)"/g))
        if (!ids.has(id)) ids.set(id, `marker-${ids.size + 1}`);
    return svg
        .replace(
            / width="[^"]*" height="[^"]*" viewBox="[^"]*"/,
            ` width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"`
        )
        .replace(/marker-[0-9a-z]+/g, (m) => ids.get(m) ?? m)
        .replace(/url\('#([^']+)'\)/g, 'url(#$1)');
};

const renderSvg = async (xml: string): Promise<string> => {
    const { window } = await getEngine();
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    const viewer = new window.BpmnJS({
        container,
        // Nimbus Sans метрически совместим с Helvetica/Arial: в браузере без него SVG
        // показывается ими с теми же переносами.
        textRenderer: { defaultStyle: { fontFamily: `${DEFAULT_FONT_NAME}, Helvetica, Arial, sans-serif` } }
    });
    try {
        // Элемент, который bpmn-js не смог нарисовать, иначе молча пропал бы из картинки.
        const { warnings } = await viewer.importXML(xml);
        if (warnings.length)
            throw new Error(
                warnings
                    .map((w) => `${w.element?.id ? `${w.element.id}: ` : ''}${oneLine(w.message)}`)
                    .join('; ')
            );
        const { svg } = await viewer.saveSVG();
        return finalizeSvg(svg, viewer.get('elementRegistry').getAll());
    } finally {
        viewer.destroy();
        container.remove();
    }
};

// Полный конвейер одного файла — общий для сборки и `c4builder check`. file — путь для
// сообщений; предупреждения валидации и раскладки печатаются, но рендер не прерывают.
export const renderBpmn = async (xml: string, file: string): Promise<Buffer> => {
    const definitions = await parseBpmn(xml, file);
    const lint = await lintBpmn(definitions);
    for (const w of lint.warnings) console.log(chalk.yellow(`⚠ ${file}: ${w}`));
    if (lint.errors.length) throw new BpmnError(file, lint.errors);
    const laidOut = await layoutBpmn(definitions, file);
    for (const w of laidOut.warnings) console.log(chalk.yellow(`⚠ ${file}: ${w}`));
    let svg: string;
    try {
        svg = await renderSvg(laidOut.xml);
    } catch (err) {
        throw new BpmnError(file, [`render failed: ${oneLine((err as Error).message || String(err))}`]);
    }
    return Buffer.from(svg, 'utf8');
};
