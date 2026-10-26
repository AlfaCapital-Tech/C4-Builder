import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
    WireflowError,
    WIREFLOW_VERSIONS,
    diagramBaseName,
    diagramExt,
    engineForFile,
    getBezierPath,
    getSmoothStepPath,
    layoutWireflow,
    parseWireflow,
    rasterizeSvgToPng,
    renderKey,
    renderWireflowSvg,
    stripEmbeddedImages,
    wireflowCatalogVersion
} from './dist.mjs';
import { REPO_ROOT, TMP_ROOT } from './helpers.mjs';

// Движок wireflow (change wireflow-diagrams): реестр движков по суффиксу, разбор и валидация
// экспорта редактора Wireflow, раскладка (группы, размеры карточек), SVG без браузера,
// перенос путей рёбер React Flow, кэш и сборка проекта.
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');
const VENDOR = path.join(REPO_ROOT, 'vendor', 'wireflow');

const file = (nodes, edges = [], version = 4) =>
    JSON.stringify({ format: 'wireflow', version, diagram: { nodes, edges } });
const card = (id, x = 0, y = 0, extra = {}, data = {}) => ({
    id,
    type: 'flow',
    position: { x, y },
    data: {
        graphicId: 'article-article-1',
        label: 'Article',
        headerText: 'Article',
        showHeader: true,
        ...data
    },
    ...extra
});
const group = (id, x = 0, y = 0, extra = {}) => ({
    id,
    type: 'group',
    position: { x, y },
    data: { label: 'Group' },
    ...extra
});
const note = (id, x, y, text, extra = {}) => ({
    id,
    type: 'note',
    position: { x, y },
    width: 220,
    height: 120,
    data: { text },
    ...extra
});
const edge = (id, source, target, extra = {}) => ({
    id,
    source,
    target,
    markerEnd: { type: 'arrowclosed' },
    ...extra
});

// Пример формата из README редактора (группа, карточка в группе, заметка, ребро с подписью).
const README_EXAMPLE = file(
    [
        group('g1', -16, -36, { width: 572, height: 270, data: { label: 'Checkout' } }),
        card(
            'c1',
            16,
            36,
            { parentId: 'g1' },
            { graphicId: 'e-commerce-cart', label: 'Cart', headerText: 'My cart' }
        ),
        card('c2', 316, 36, { parentId: 'g1' }, { graphicId: 'e-commerce-checkout', showHeader: false }),
        note('n1', 620, 520, 'Поле купона: необязательное')
    ],
    [
        edge('e1', 'c1', 'c2', {
            type: 'smoothstep',
            label: 'Оформить',
            style: { stroke: '#e8590c', strokeWidth: 3 }
        }),
        edge('e2', 'c2', 'n1')
    ]
);

const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAYAAAD+Bd/7AAAAEklEQVR4nGP8z8AARLjBkFAAAEp6C/uDRjYPAAAAAElFTkSuQmCC';
const WEBP = 'UklGRiAAAABXRUJQVlA4TBQAAAAvB0ABAAcQ/Y/+BwCC8L9tIqL/IQ==';

const problemsOf = (text) => {
    try {
        parseWireflow(text, 'x.wireflow.json');
    } catch (e) {
        expect(e).toBeInstanceOf(WireflowError);
        expect(e.message).toMatch(/^x\.wireflow\.json: /);
        return e.problems;
    }
    throw new Error('ожидалась ошибка');
};

describe('реестр движков по суффиксу', () => {
    it('engineForFile: суффикс .wireflow.json и имя wireflow.json без учёта регистра, прочие .json — нет', () => {
        expect(engineForFile('x.wireflow.json')).toBe('wireflow');
        expect(engineForFile('X.WIREFLOW.JSON')).toBe('wireflow');
        expect(engineForFile('wireflow.json')).toBe('wireflow');
        expect(engineForFile('dir/sub/wireflow.json')).toBe('wireflow');
        expect(engineForFile('data.json')).toBeUndefined();
        expect(engineForFile('a.puml')).toBe('plantuml');
        expect(engineForFile('A.D2')).toBe('d2');
        expect(engineForFile('puml')).toBeUndefined(); // точное имя — только для составных суффиксов
        expect(engineForFile('README.md')).toBeUndefined();
    });

    it('diagramBaseName/diagramExt: выход без суффикса движка', () => {
        expect(diagramBaseName('checkout.wireflow.json')).toBe('checkout');
        expect(diagramBaseName('Checkout.WireFlow.JSON')).toBe('Checkout');
        expect(diagramBaseName('wireflow.json')).toBe('wireflow');
        expect(diagramBaseName('a.puml')).toBe('a');
        expect(diagramBaseName('flow-1a2b.mmd')).toBe('flow-1a2b');
        expect(diagramBaseName('data.json')).toBe('data');
        expect(diagramExt('checkout.wireflow.json')).toBe('.wireflow.json');
        expect(diagramExt('wireflow.json')).toBe('.wireflow.json');
        expect(diagramExt('a.puml')).toBe('.puml');
        expect(diagramExt('data.json')).toBeUndefined();
    });
});

describe('разбор и валидация', () => {
    it('версии 2–4 принимаются, settings и неизвестные поля игнорируются', () => {
        for (const v of [2, 3, 4]) {
            const { diagram, warnings } = parseWireflow(
                JSON.stringify({
                    format: 'wireflow',
                    version: v,
                    diagram: {
                        nodes: [card('a', 0, 0, { selected: true, measured: { width: 1 } })],
                        edges: [],
                        settings: { hourlyRate: 90 }
                    },
                    future: true
                }),
                'x.wireflow.json'
            );
            expect(diagram.nodes).toHaveLength(1);
            expect(warnings).toEqual([]);
        }
        expect(WIREFLOW_VERSIONS).toEqual({ min: 2, max: 4 });
    });

    it('старые форматы → совет пересохранить, новее v4 → версия в ошибке, не JSON → причина', () => {
        expect(problemsOf(file([card('a')], [], 1))).toEqual([
            expect.stringMatching(/old Wireflow format \(version 1\).*re-save/)
        ]);
        expect(problemsOf('{"nodes":[],"edges":[]}')).toEqual([
            expect.stringMatching(/old Wireflow format \(no "format" field\).*re-save/)
        ]);
        expect(problemsOf(file([], [], 5))).toEqual([
            expect.stringMatching(/version 5 is newer than supported \(2-4\)/)
        ]);
        expect(problemsOf(file([], [], '2'))).toEqual([expect.stringMatching(/unknown file version "2"/)]);
        expect(problemsOf('{"format":"excalidraw","version":2}')).toEqual([
            expect.stringMatching(/not a Wireflow file \(format "excalidraw"\)/)
        ]);
        expect(problemsOf('{"name":"wireflow","version":"1.0.0"}')).toEqual([
            expect.stringMatching(/not a Wireflow file/)
        ]);
        expect(problemsOf('{nope')).toEqual([expect.stringMatching(/^invalid JSON: /)]);
        expect(problemsOf('{"format":"wireflow","version":2}')).toEqual([
            expect.stringMatching(/"diagram\.nodes" must be an array/)
        ]);
    });

    it('структура: id элемента в каждой проблеме, все проблемы разом', () => {
        expect(problemsOf(file([card('a')], [edge('e', 'a', 'x9')]))).toEqual([
            'edge "e": target "x9" is not a node'
        ]);
        expect(problemsOf(file([card('a', 0, 0, { parentId: 'nope' })]))).toEqual([
            'node "a": "parentId" "nope" is not a group'
        ]);
        expect(problemsOf(file([card('b'), card('a', 0, 0, { parentId: 'b' })]))).toEqual([
            'node "a": "parentId" "b" is not a group'
        ]);
        expect(
            problemsOf(file([group('g1', 0, 0, { parentId: 'g2' }), group('g2', 0, 0, { parentId: 'g1' })]))
        ).toEqual(['group "g2" is inside itself', 'group "g1" is inside itself']);
        expect(problemsOf(file([card('a'), card('a')]))).toEqual(['duplicate id "a"']);
        expect(problemsOf(file([card('a')], [edge('a', 'a', 'a')]))).toEqual(['duplicate id "a"']);
        expect(problemsOf(file([{ ...card('a'), position: { x: 'left' } }]))).toEqual([
            'card "a": missing "position" {x, y}'
        ]);
        expect(problemsOf(file([{ ...card('a'), id: 1 }]))).toEqual(['node #0: missing "id"']);
        expect(problemsOf(file([{ ...card('a'), type: 'input' }]))).toEqual([
            'node "a": unknown type "input" (expected flow, note or group)'
        ]);
        expect(problemsOf(file([{ ...card('a'), data: {} }]))).toEqual([
            'card "a": missing "data.graphicId" (screen template)'
        ]);
        expect(problemsOf(file([card('a', 0, 0, {}, { label: 5 })]))).toEqual([
            'card "a": "data.label" must be a string'
        ]);
        expect(problemsOf(file([group('g'), card('a')], [edge('e', 'g', 'a')]))).toEqual([
            'edge "e": source "g" is a group (connect cards or notes)'
        ]);
        // Несколько нарушений — одной ошибкой.
        expect(problemsOf(file([card('a'), card('a')], [edge('e', 'a', 'zz')]))).toHaveLength(2);
    });

    it('неизвестный шаблон — предупреждение рендера, не ошибка', () => {
        const { svg, warnings } = renderWireflowSvg(
            file([card('a', 0, 0, {}, { graphicId: 'no-such-template' })]),
            'x.wireflow.json'
        );
        expect(warnings).toEqual(['card "a": unknown screen template "no-such-template"']);
        expect(svg).toContain('template not found');
        expect(svg).toContain('no-such-template');
    });
});

describe('раскладка', () => {
    const CARD_H = 2 + 24 + 218 * 0.7872; // рамка + заголовок + картинка по пропорции шаблона

    it('пример README: позиции в группе относительные, рамка группы подогнана под карточки', () => {
        const boxes = layoutWireflow(parseWireflow(README_EXAMPLE, 'x').diagram);
        expect(boxes.get('c1')).toEqual({ x: 0, y: 0, width: 220, height: CARD_H });
        expect(boxes.get('c2')).toEqual({ x: 300, y: 0, width: 220, height: 2 + 218 * 0.7872 }); // без заголовка
        expect(boxes.get('n1')).toEqual({ x: 620, y: 520, width: 220, height: 120 });
        // Группа: отступы 36/16/16/16 вокруг членов, размер из файла не используется.
        expect(boxes.get('g1')).toEqual({ x: -16, y: -36, width: 520 + 32, height: CARD_H + 36 + 16 });
    });

    it('вложенные группы: внутренняя подгоняется первой, внешняя — вокруг неё', () => {
        const boxes = layoutWireflow(
            parseWireflow(
                file([
                    group('g1', 100, 100),
                    group('g2', 50, 50, { parentId: 'g1' }),
                    card('a', 10, 10, { parentId: 'g2' }),
                    card('b', 400, 0, { parentId: 'g1' }, { graphicId: 'mobile-home' })
                ]),
                'x'
            ).diagram
        );
        expect(boxes.get('a')).toMatchObject({ x: 160, y: 160, width: 220 });
        expect(boxes.get('g2')).toEqual({ x: 144, y: 124, width: 252, height: CARD_H + 52 });
        // Портретный (мобильный) шаблон — карточка 124px, высота по пропорции 1.8333.
        expect(boxes.get('b')).toEqual({ x: 500, y: 100, width: 124, height: 2 + 24 + 122 * 1.8333 });
        // Внешняя группа — вокруг рамки внутренней (ниже карточки b) и карточки b (правее).
        expect(boxes.get('g1')).toEqual({
            x: 128,
            y: 64,
            width: 624 + 16 - 128,
            height: 124 + CARD_H + 52 + 16 - 64
        });
    });

    it('пустая группа и заметка без размера — размеры по умолчанию, own-image — 220 на пропорцию', () => {
        const boxes = layoutWireflow(
            parseWireflow(
                file([
                    group('g', 5, 5),
                    { id: 'n', type: 'note', position: { x: 0, y: 0 }, data: { text: '' } },
                    card(
                        'i',
                        0,
                        0,
                        {},
                        {
                            graphicId: 'own-image',
                            src: `data:image/png;base64,${PNG}`,
                            ratio: 2.16,
                            showHeader: false
                        }
                    )
                ]),
                'x'
            ).diagram
        );
        expect(boxes.get('g')).toEqual({ x: 5, y: 5, width: 252, height: 120 });
        expect(boxes.get('n')).toEqual({ x: 0, y: 0, width: 220, height: 120 });
        expect(boxes.get('i')).toEqual({ x: 0, y: 0, width: 220, height: 2 + 218 * 2.16 });
    });
});

describe('SVG', () => {
    const { svg, warnings } = renderWireflowSvg(README_EXAMPLE, 'x.wireflow.json');

    it('группа с подписью, карточки с шаблонами, заметка, ребро со стрелкой и подписью; кириллица как есть', () => {
        expect(warnings).toEqual([]);
        expect(svg).toContain('>CHECKOUT</text>'); // uppercase, как в редакторе
        expect(svg).toContain('stroke-dasharray');
        expect(svg).toContain('>My cart</text>');
        expect((svg.match(/<use href="#wf-[0-9a-f]{8}"/g) ?? []).length).toBe(2);
        expect((svg.match(/<symbol id="wf-[0-9a-f]{8}"/g) ?? []).length).toBe(2);
        expect(svg).toContain('Поле купона: необязательное');
        expect(svg).toContain('>Оформить</text>');
        expect(svg).toMatch(
            /<path d="M110 197\.61L 110,212\.61Q [^"]*" fill="none" stroke="#e8590c" stroke-width="3" marker-end="url\(#wf-arrow-e8590c\)"/
        );
        expect(svg).toMatch(
            /<path d="M410,173\.61 C[^"]*" fill="none" stroke="#a3a8c3" stroke-width="2" marker-end="url\(#wf-arrow-a3a8c3\)"/
        );
        expect(svg).toMatch(
            /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox="-?\d+ -?\d+ \d+ \d+" font-family="Nimbus Sans/
        );
        expect(svg).toContain('fill="#fff"/>'); // белый фон холста, как у экспорта редактора
    });

    it('без внешних ссылок; маркер один на цвет; id уникальны при двух карточках одного шаблона', () => {
        expect(svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')).not.toMatch(/https?:/);
        expect((svg.match(/<marker /g) ?? []).length).toBe(2);
        // e-commerce-delivery: экспорт Illustrator с десятками внутренних id.
        const delivery = { graphicId: 'e-commerce-delivery' };
        const two = renderWireflowSvg(
            file(
                [card('a', 0, 0, {}, delivery), card('b', 300, 0, {}, delivery)],
                [edge('e', 'a', 'b'), edge('f', 'b', 'a')]
            ),
            'x'
        ).svg;
        expect((two.match(/<symbol /g) ?? []).length).toBe(1);
        expect((two.match(/<use /g) ?? []).length).toBe(2);
        expect((two.match(/<marker /g) ?? []).length).toBe(1);
        const ids = [...two.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.some((id) => /^wf-[0-9a-f]{8}-/.test(id))).toBe(true); // внутренние id шаблона с префиксом
    });

    it('заголовок длиннее 23 символов обрезается до 20 и «...», карточка без заголовка — без плашки', () => {
        const long = renderWireflowSvg(
            file([card('a', 0, 0, {}, { headerText: 'Оформление заказа — длинный заголовок' })]),
            'x'
        ).svg;
        expect(long).toContain('>Оформление заказа — ...</text>');
        expect(renderWireflowSvg(file([card('a', 0, 0, {}, { showHeader: false })]), 'x').svg).not.toContain(
            '<circle'
        );
    });

    it('заметка: перенос по ширине, явные переводы строк, обрезка по высоте с многоточием', () => {
        const text =
            'Первая строка\n\nОчень длинное_слово_без_пробелов_которое_не_влезает_в_строку и ещё текст, который переносится, переносится и переносится до конца заметки';
        const out = renderWireflowSvg(file([note('n', 0, 0, text)]), 'x').svg;
        const lines = [...out.matchAll(/<tspan x="12" y="([\d.]+)">([^<]*)<\/tspan>/g)];
        expect(lines[0][2]).toBe('Первая строка');
        expect(lines.length).toBe(4); // (120 − 16) / 18 = 5 строк, вторая — пустая, без tspan
        expect(lines[lines.length - 1][2]).toMatch(/…$/);
        expect(Number(lines[1][1]) - Number(lines[0][1])).toBeCloseTo(36, 5); // пустая строка сохранена
    });

    it('own-image: data:-PNG вставляется картинкой; внешний URL и WebP в PNG — заглушка с предупреждением', () => {
        const png = renderWireflowSvg(
            file([
                card(
                    'i',
                    0,
                    0,
                    {},
                    { graphicId: 'own-image', src: `data:image/png;base64,${PNG}`, ratio: 0.75 }
                )
            ]),
            'x'
        );
        expect(png.warnings).toEqual([]);
        expect(png.svg).toContain(
            `<image x="1" y="25" width="218" height="163.5" preserveAspectRatio="none" href="data:image/png;base64,${PNG}"/>`
        );

        const ext = renderWireflowSvg(
            file([card('i', 0, 0, {}, { graphicId: 'own-image', src: 'https://example.com/x.png' })]),
            'x'
        );
        expect(ext.warnings).toEqual([
            'card "i": external image URL is not loaded (no network at build time)'
        ]);
        expect(ext.svg).not.toContain('example.com');
        expect(ext.svg).toContain('external image');

        const webpSrc = `data:image/webp;base64,${WEBP}`;
        const webp = renderWireflowSvg(
            file([card('i', 0, 0, {}, { graphicId: 'own-image', src: webpSrc })]),
            'x'
        );
        expect(webp.warnings).toEqual([]);
        expect(webp.svg).toContain(`href="${webpSrc}"`);
        const raster = renderWireflowSvg(
            file([card('i', 0, 0, {}, { graphicId: 'own-image', src: webpSrc })]),
            'x',
            { raster: true }
        );
        expect(raster.warnings).toEqual([
            'card "i": WebP image cannot be rasterized to PNG (use JPEG or PNG)'
        ]);
        expect(raster.svg).not.toContain('image/webp');
        expect(raster.svg).toContain('WebP image');
    });

    it('управляющие символы: VT/FF в тексте — перевод строки, прочие недопустимые в XML вырезаны; SVG и PNG валидны', async () => {
        const out = renderWireflowSvg(
            file(
                [
                    card('a\u0001', 0, 0, {}, { headerText: 'Кор\u0000зина', graphicId: 'no-such\u0002' }),
                    note('n', 300, 0, 'Первая\u000bвторая\fтретья\u0007 \ud800\uffffконец'),
                    group('g', 0, 400, { data: { label: 'Гр\u001fуппа' } })
                ],
                [edge('e', 'a\u0001', 'n', { label: 'Да\u0008лее', style: { stroke: '#E8590C\u0001' } })]
            ),
            'x'
        );
        // Ни одного символа, запрещённого в XML 1.0, в выходе.
        // biome-ignore lint/suspicious/noControlCharactersInRegex: ищем именно управляющие символы
        expect(out.svg).not.toMatch(/[\0-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|\p{Cs}/u);
        const lines = [...out.svg.matchAll(/<tspan x="12" y="[\d.]+">([^<]*)<\/tspan>/g)].map((m) => m[1]);
        expect(lines).toEqual(['Первая', 'вторая', 'третья конец']);
        expect(out.svg).toContain('>Корзина</text>');
        expect(out.svg).toContain('>ГРУППА</text>');
        expect(out.svg).toContain('>Далее</text>');
        expect(out.svg).toContain('stroke="#e8590c"'); // цвет очищен до нормализации регистра
        expect(out.svg).toContain('marker-end="url(#wf-arrow-e8590c)"');
        expect(out.svg).toContain('>no-such</text>'); // id шаблона в заглушке — через escapeXml
        expect(out.warnings).toEqual(['card "a\\u0001": unknown screen template "no-such\\u0002"']);
        const png = await rasterizeSvgToPng(out.svg);
        expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });

    it('детерминизм: повторный рендер байт-в-байт, PNG растеризуется', async () => {
        expect(renderWireflowSvg(README_EXAMPLE, 'x.wireflow.json').svg).toBe(svg);
        const png = await rasterizeSvgToPng(svg);
        expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        expect(png.length).toBeGreaterThan(10_000);
    });
});

describe('пути рёбер — перенос @xyflow/system 0.0.82', () => {
    // Эталонные значения получены вызовом функций пакета той же версии.
    const cases = [
        {
            c: { sourceX: 110, sourceY: 198, targetX: 410, targetY: 300 },
            bezier: ['M110,198 C110,249 410,249 410,300', 260, 249, 150, 51],
            smooth: [
                'M110 198L110 218L 110,244Q 110,249 115,249L 405,249Q 410,249 410,254L410 280L410 300',
                260,
                249,
                150,
                51
            ],
            step: [
                'M110 198L110 218L 110,249Q 110,249 110,249L 410,249Q 410,249 410,249L410 280L410 300',
                260,
                249,
                150,
                51
            ]
        },
        {
            c: { sourceX: 500, sourceY: 100, targetX: 200, targetY: 50 },
            bezier: [
                'M500,100 C500,144.19417382415924 200,5.805826175840778 200,50',
                350,
                75.00000000000001,
                150,
                24.999999999999986
            ],
            smooth: [
                'M500 100L 500,115Q 500,120 495,120L 355,120Q 350,120 350,115L 350,35Q 350,30 345,30L 205,30Q 200,30 200,35L200 50',
                350,
                75,
                150,
                25
            ],
            step: [
                'M500 100L 500,120Q 500,120 500,120L 350,120Q 350,120 350,120L 350,30Q 350,30 350,30L 200,30Q 200,30 200,30L200 50',
                350,
                75,
                150,
                25
            ]
        },
        {
            c: { sourceX: 300, sourceY: 400, targetX: 300, targetY: 100 },
            bezier: ['M300,400 C300,508.25317547305485 300,-8.253175473054839 300,100', 300, 250, 0, 150],
            smooth: ['M300 400L300 420L300 80L300 100', 300, 250, 0, 150],
            step: ['M300 400L300 420L300 80L300 100', 300, 250, 0, 150]
        },
        {
            c: { sourceX: 126, sourceY: 215.24, targetX: 450.5, targetY: 215.24 },
            bezier: ['M126,215.24 C126,215.24 450.5,215.24 450.5,215.24', 288.25, 215.24, 162.25, 0],
            smooth: [
                'M126 215.24L 126,230.24Q 126,235.24 131,235.24L 283.25,235.24Q 288.25,235.24 288.25,230.24L 288.25,200.24Q 288.25,195.24 293.25,195.24L 445.5,195.24Q 450.5,195.24 450.5,200.24L450.5 215.24',
                288.25,
                215.24,
                162.25,
                0
            ],
            step: [
                'M126 215.24L 126,235.24Q 126,235.24 126,235.24L 288.25,235.24Q 288.25,235.24 288.25,235.24L 288.25,195.24Q 288.25,195.24 288.25,195.24L 450.5,195.24Q 450.5,195.24 450.5,195.24L450.5 215.24',
                288.25,
                215.24,
                162.25,
                0
            ]
        }
    ];
    it.each(cases)('getBezierPath/getSmoothStepPath совпадают с пакетом: %j', ({
        c,
        bezier,
        smooth,
        step
    }) => {
        expect(getBezierPath(c)).toEqual(bezier);
        expect(getSmoothStepPath(c)).toEqual(smooth);
        expect(getSmoothStepPath({ ...c, borderRadius: 0 })).toEqual(step);
    });
});

describe('кэш и llms', () => {
    it('ключ кэша несёт версию c4builder (движок — его код), версию каталога шаблонов, формат и шрифт', () => {
        const version = fs.readFileSync(path.join(VENDOR, 'VERSION'), 'utf8').trim();
        expect(version).toMatch(/^[0-9a-f]{40}$/);
        expect(wireflowCatalogVersion()).toBe(version);
        const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
        const options = { USE_SYSTEM_FONTS: false, CHARSET: 'UTF-8', D2_LAYOUT: 'dagre' };
        expect(renderKey({ engine: 'wireflow', isDitaa: false }, options, 'svg')).toBe(
            `wireflow\0${pkg}\0${version}\0fmt=svg\0font=Nimbus Sans`
        );
        expect(renderKey({ engine: 'wireflow', isDitaa: false }, options, 'png')).not.toBe(
            renderKey({ engine: 'wireflow', isDitaa: false }, options, 'svg')
        );
    });

    it('stripEmbeddedImages: только строки data:, с экранированными кавычками, остальное как есть', () => {
        const json =
            '{"src":"data:image/png;base64,AAA\\"BBB","label":"data: not a url","x":"data:image/webp;base64,QUJD"}';
        expect(stripEmbeddedImages(json)).toBe(
            '{"src":"<embedded image>","label":"data: not a url","x":"<embedded image>"}'
        );
    });

    it('каталог: 125 шаблонов, у каждого файл и пропорция, лицензия MIT', () => {
        const graphics = JSON.parse(fs.readFileSync(path.join(VENDOR, 'graphics.json'), 'utf8'));
        const sizes = JSON.parse(fs.readFileSync(path.join(VENDOR, 'graphic-sizes.json'), 'utf8'));
        expect(graphics.length).toBe(125);
        for (const g of graphics) {
            expect(fs.existsSync(path.join(VENDOR, g.src)), g.id).toBe(true);
            expect(typeof sizes[g.id], g.id).toBe('number');
        }
        expect(fs.readFileSync(path.join(VENDOR, 'LICENSE'), 'utf8')).toMatch(/MIT License/);
    });

    it('все шаблоны каталога в одной диаграмме: XML без чужих префиксов, resvg растеризует', async () => {
        // Inkscape-шаблоны несут rdf/sodipodi/inkscape с объявлениями на своём корне — в
        // <symbol> они попадать не должны, иначе SVG диаграммы невалиден (resvg падает).
        const graphics = JSON.parse(fs.readFileSync(path.join(VENDOR, 'graphics.json'), 'utf8'));
        const nodes = graphics.map((g, i) =>
            card(`c${i}`, (i % 12) * 260, Math.floor(i / 12) * 260, {}, { graphicId: g.id })
        );
        const { svg, warnings } = renderWireflowSvg(file(nodes), 'all.wireflow.json');
        expect(warnings).toEqual([]);
        expect(svg).not.toMatch(/<\/?(?!xml:)[a-zA-Z]+:|\s(?!xml:)[a-zA-Z]+:[\w.-]+="|<metadata/);
        const png = await rasterizeSvgToPng(svg);
        expect(png.subarray(1, 4).toString()).toBe('PNG');
    });
});

describe('сборка проекта с .wireflow.json', () => {
    const CONFIG = {
        projectName: 'wf',
        homepageName: 'Overview',
        rootFolder: 'src',
        distFolder: 'docs',
        generateMD: true,
        generateCompleteMD: false,
        generateWEB: true,
        includeNavigation: false,
        includeTableOfContents: false,
        webTheme: 'vendor/vue.css',
        supportSearch: false,
        repoUrl: '',
        executeScript: false,
        docsifyTemplate: '',
        webPort: '3000',
        includeBreadcrumbs: false,
        includeLinkToDiagram: false,
        diagramsOnTop: false,
        embedDiagram: false,
        excludeOtherFiles: false,
        generateLocalImages: true,
        plantumlServerUrl: 'https://www.plantuml.com/plantuml',
        diagramFormat: 'svg',
        d2Layout: 'dagre',
        charset: 'UTF-8',
        hasRun: true
    };
    const dirs = [];
    afterAll(() => {
        for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    });
    const project = (files, config = {}) => {
        fs.mkdirSync(TMP_ROOT, { recursive: true });
        const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'wireflow-'));
        dirs.push(dir);
        for (const [rel, content] of Object.entries(files)) {
            fs.mkdirSync(path.join(dir, 'src', path.dirname(rel)), { recursive: true });
            fs.writeFileSync(path.join(dir, 'src', rel), content);
        }
        fs.writeFileSync(path.join(dir, '.c4builder'), JSON.stringify({ ...CONFIG, ...config }));
        return dir;
    };
    const build = (dir) => {
        const res = spawnSync(process.execPath, [CLI], {
            cwd: dir,
            encoding: 'utf8',
            input: '',
            timeout: 120_000
        });
        return { status: res.status, out: `${res.stdout}${res.stderr}` };
    };
    const out = (dir, rel) => path.join(dir, 'docs', rel);

    it('checkout.wireflow.json → checkout.svg, ссылка в markdown заменена; data.json скопирован; wireflow.json → wireflow.svg', () => {
        const dir = project({
            'README.md': '# Overview\n\n![Оформление](checkout.wireflow.json)\n\nТекст.\n',
            'checkout.wireflow.json': README_EXAMPLE,
            'data.json': '{"plain": true}',
            'Flows/wireflow.json': file([card('a')]),
            'Flows/README.md': '# Flows\n\n![flow](wireflow.json)\n'
        });
        const res = build(dir);
        expect(res.status, res.out).toBe(0);
        expect(fs.existsSync(out(dir, 'checkout.svg'))).toBe(true);
        expect(fs.existsSync(out(dir, 'checkout.wireflow.svg'))).toBe(false);
        expect(fs.readFileSync(out(dir, 'data.json'), 'utf8')).toBe('{"plain": true}');
        expect(fs.existsSync(out(dir, 'checkout.wireflow.json'))).toBe(false); // исходник не копируется
        expect(fs.existsSync(out(dir, 'Flows/wireflow.svg'))).toBe(true);
        const md = fs.readFileSync(out(dir, 'README.md'), 'utf8');
        expect(md).toContain('![diagram](checkout.svg)');
        expect(md).not.toContain('checkout.wireflow.json');
        expect(fs.readFileSync(out(dir, 'Flows/README.md'), 'utf8')).toContain('![diagram](wireflow.svg)');
        const svg = fs.readFileSync(out(dir, 'checkout.svg'), 'utf8');
        expect(svg).toContain('Поле купона');

        // Повторная сборка с тёплым кэшем — байт-в-байт тот же SVG, чексуммы сохранены.
        const cache = JSON.parse(fs.readFileSync(path.join(dir, '.c4builder.cache'), 'utf8'));
        expect(cache.checksums.length).toBe(2);
        expect(build(dir).status).toBe(0);
        expect(fs.readFileSync(out(dir, 'checkout.svg'), 'utf8')).toBe(svg);
    });

    it('diagramFormat: png → checkout.png растеризацией', () => {
        const dir = project(
            { 'README.md': '# Overview\n', 'checkout.wireflow.json': README_EXAMPLE },
            { diagramFormat: 'png' }
        );
        const res = build(dir);
        expect(res.status, res.out).toBe(0);
        expect(fs.existsSync(out(dir, 'checkout.png'))).toBe(true);
        expect(fs.existsSync(out(dir, 'checkout.svg'))).toBe(false);
        expect(fs.readFileSync(out(dir, 'checkout.png')).subarray(1, 4).toString()).toBe('PNG');
    });

    it('битый файл дерева → код 1 с именем файла и id элемента; коллизия имён выхода → ошибка', () => {
        const bad = project({
            'README.md': '# Overview\n',
            'Flows/bad.wireflow.json': file([card('a')], [edge('e', 'a', 'x9')])
        });
        const res = build(bad);
        expect(res.status).toBe(1);
        expect(res.out).toMatch(
            /Diagram "bad\.svg": src\/Flows\/bad\.wireflow\.json: edge "e": target "x9" is not a node/
        );

        const clash = project({
            'README.md': '# Overview\n',
            'checkout.wireflow.json': README_EXAMPLE,
            'checkout.puml': '@startuml\nA->B\n@enduml\n'
        });
        const res2 = build(clash);
        expect(res2.status).toBe(1);
        expect(res2.out).toMatch(
            /Output name collision 'checkout\.svg'.*'checkout\.puml' and 'checkout\.wireflow\.json'/
        );
    });
});
