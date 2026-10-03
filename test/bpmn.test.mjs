import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { BpmnModdle } from 'bpmn-moddle';
import { layoutProcess } from 'bpmn-auto-layout';
import { afterAll, describe, expect, it } from 'vitest';

import { layoutBpmn, lintBpmn, parseBpmn, renderBpmn, resvgFontOptions, teardownBpmn } from './dist.mjs';
import { REPO_ROOT } from './helpers.mjs';

// Конвейер BPMN (change bpmn-diagrams): разбор и нормализация → bpmnlint → раскладка →
// рендер bpmn-js в jsdom. Эталон «хорошей» модели — пример шаблона (2 пула, 3 дорожки,
// граничный таймер, message flow, кириллица); нарушители — минимальные модели ниже.
const TEMPLATE = fs.readFileSync(
    path.join(REPO_ROOT, 'template', 'src', '5 BPMN Example', 'account-opening.bpmn'),
    'utf8'
);
const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
const defs = (body) =>
    `<bpmn:definitions ${NS} id="D" targetNamespace="https://example.com/t">${body}</bpmn:definitions>`;
const proc = (body, id = 'P') => `<bpmn:process id="${id}" name="${id}">${body}</bpmn:process>`;
const CHAIN =
    '<bpmn:startEvent id="S" name="s"/><bpmn:task id="T" name="t"/><bpmn:endEvent id="E" name="e"/>' +
    '<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="E"/>';
// Произвольный DI: обязан отбрасываться, раскладка всегда своя.
const GARBAGE_DI =
    '<bpmndi:BPMNDiagram id="Dia" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" ' +
    'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"><bpmndi:BPMNPlane id="Plane" ' +
    'bpmnElement="Collaboration_AccountOpening"><bpmndi:BPMNShape id="Junk" bpmnElement="Task_Assess">' +
    '<dc:Bounds x="9999" y="-500" width="10" height="10"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>';
const withDi = (xml) => xml.replace('</bpmn:definitions>', `${GARBAGE_DI}</bpmn:definitions>`);

const rejection = async (promise) => {
    try {
        await promise;
    } catch (e) {
        return e;
    }
    throw new Error('ожидалась ошибка');
};

afterAll(() => teardownBpmn());

describe('разбор и нормализация', () => {
    it('incoming/outgoing восстанавливаются из sourceRef/targetRef', async () => {
        const d = await parseBpmn(defs(proc(CHAIN)), 'x.bpmn');
        const t = d.rootElements[0].flowElements.find((e) => e.id === 'T');
        expect(t.incoming.map((f) => f.id)).toEqual(['F1']);
        expect(t.outgoing.map((f) => f.id)).toEqual(['F2']);
    });

    it('DI источника отбрасывается', async () => {
        expect((await parseBpmn(withDi(TEMPLATE), 'x.bpmn')).diagrams).toEqual([]);
    });

    it('висячая ссылка и битый XML → ошибка с путём файла и причиной', async () => {
        const dangling = await rejection(
            parseBpmn(
                defs(proc('<bpmn:task id="T"/><bpmn:sequenceFlow id="F" sourceRef="T" targetRef="Ghost"/>')),
                'a/b.bpmn'
            )
        );
        expect(dangling.message).toBe('a/b.bpmn: F: unresolved reference <Ghost>');
        const broken = await rejection(parseBpmn('<bpmn:definitions', 'a/c.bpmn'));
        expect(broken.message).toMatch(/^a\/c\.bpmn: invalid BPMN XML: /);
        const unknown = await rejection(parseBpmn(defs(proc('<bpmn:fooTask id="X"/>')), 'a/d.bpmn'));
        expect(unknown.message).toMatch(/^a\/d\.bpmn: .*unknown type <bpmn:FooTask>/);
    });
});

describe('валидация', () => {
    const lint = async (xml) => lintBpmn(await parseBpmn(xml, 'x.bpmn'));

    it('корректная модель шаблона — без ошибок и предупреждений; sourceRef-only не даёт ложных no-disconnected', async () => {
        expect(await lint(TEMPLATE)).toEqual({ errors: [], warnings: [] });
    });

    it('несвязанный узел — error no-disconnected с id', async () => {
        const { errors } = await lint(defs(proc(`${CHAIN}<bpmn:task id="Lonely" name="l"/>`)));
        expect(errors).toContain('Lonely [no-disconnected] Element is not connected');
    });

    it('lane-membership: узел вне дорожки и узел в двух дорожках', async () => {
        const lanes =
            '<bpmn:laneSet id="LS"><bpmn:lane id="L1" name="a"><bpmn:flowNodeRef>S</bpmn:flowNodeRef>' +
            '<bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane><bpmn:lane id="L2" name="b">' +
            '<bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>';
        const { errors } = await lint(defs(proc(lanes + CHAIN)));
        expect(errors).toContain('T [c4builder/lane-membership] Flow node is not in any lane of its process');
        expect(errors).toContain('E [c4builder/lane-membership] Flow node is in several lanes: L1, L2');
    });

    it('sequence-flow-in-pool: sequence flow между пулами → error с подсказкой про message flow', async () => {
        const xml = defs(
            '<bpmn:collaboration id="C"><bpmn:participant id="PA" name="a" processRef="A"/>' +
                '<bpmn:participant id="PB" name="b" processRef="B"/></bpmn:collaboration>' +
                proc(
                    '<bpmn:startEvent id="S" name="s"/><bpmn:endEvent id="E" name="e"/>' +
                        '<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="E"/><bpmn:sequenceFlow id="Cross" sourceRef="S" targetRef="E2"/>',
                    'A'
                ) +
                proc(
                    '<bpmn:startEvent id="S2" name="s"/><bpmn:endEvent id="E2" name="e"/>' +
                        '<bpmn:sequenceFlow id="F2" sourceRef="S2" targetRef="E2"/>',
                    'B'
                )
        );
        const { errors } = await lint(xml);
        expect(errors).toContainEqual(
            expect.stringMatching(/^Cross \[c4builder\/sequence-flow-in-pool\] .*message flow/)
        );
    });

    it('message-flow-between-pools: message flow внутри одного пула → error', async () => {
        const xml = defs(
            '<bpmn:collaboration id="C"><bpmn:participant id="PA" name="a" processRef="A"/>' +
                '<bpmn:messageFlow id="Inside" sourceRef="T" targetRef="E"/></bpmn:collaboration>' +
                proc(CHAIN, 'A')
        );
        const { errors } = await lint(xml);
        expect(errors).toContainEqual(
            expect.stringMatching(/^Inside \[c4builder\/message-flow-between-pools\] /)
        );
    });

    it('gateway-flow-labels: неподписанная ветка XOR — только warning', async () => {
        const { errors, warnings } = await lint(
            defs(
                proc(
                    '<bpmn:startEvent id="S" name="s"/><bpmn:exclusiveGateway id="G" name="ok?"/>' +
                        '<bpmn:endEvent id="E1" name="a"/><bpmn:endEvent id="E2" name="b"/>' +
                        '<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="G"/>' +
                        '<bpmn:sequenceFlow id="F2" name="yes" sourceRef="G" targetRef="E1"/>' +
                        '<bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="E2"/>'
                )
            )
        );
        expect(errors).toEqual([]);
        expect(warnings).toEqual([
            'F3 [c4builder/gateway-flow-labels] Outgoing flow of a diverging gateway has no label'
        ]);
    });
});

describe('раскладка', () => {
    const bounds = (el) => el.bounds;
    const inside = (a, b) =>
        a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

    it('узлы шаблона лежат в полосах своих дорожек, повторная раскладка идентична', async () => {
        const first = await layoutBpmn(await parseBpmn(TEMPLATE, 'x.bpmn'), 'x.bpmn');
        const second = await layoutBpmn(await parseBpmn(TEMPLATE, 'x.bpmn'), 'x.bpmn');
        expect(second.xml).toBe(first.xml);

        const { rootElement } = await new BpmnModdle().fromXML(first.xml);
        const shapes = new Map(
            rootElement.diagrams[0].plane.planeElement
                .filter((p) => p.bounds)
                .map((p) => [p.bpmnElement.id, p])
        );
        const process = rootElement.rootElements.find((e) => e.$type === 'bpmn:Process');
        const lanes = process.laneSets[0].lanes;
        expect(lanes).toHaveLength(3);
        for (const lane of lanes)
            for (const node of lane.flowNodeRef) {
                // Граничный таймер сидит на нижней границе задачи и может свисать за полосу.
                if (node.$type === 'bpmn:BoundaryEvent') continue;
                expect(
                    inside(bounds(shapes.get(node.id)), bounds(shapes.get(lane.id))),
                    `${node.id} в ${lane.id}`
                ).toBe(true);
            }
        // Горизонтальные полосы: дорожки во всю ширину пула, друг под другом.
        const [a, b] = lanes.map((l) => bounds(shapes.get(l.id)));
        expect(a.width).toBe(b.width);
        expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    });

    it('исключение раскладчика → ошибка с путём файла', async () => {
        const failing = async () => {
            throw Object.assign(new Error('boom'), { elementId: 'Task_Assess' });
        };
        const e = await rejection(layoutBpmn(await parseBpmn(TEMPLATE, 'p/q.bpmn'), 'p/q.bpmn', failing));
        expect(e.message).toBe('p/q.bpmn: layout failed: Task_Assess: boom');
    });

    it('раскладчик молча потерял фигуру (bpmn-auto-layout#154) → ошибка с id', async () => {
        const lossy = async (xml) => {
            const res = await layoutProcess(xml);
            const shape = /<bpmndi:BPMNShape [^>]*bpmnElement="Task_Escalate"[\s\S]*?<\/bpmndi:BPMNShape>/;
            expect(res.xml).toMatch(shape);
            return { ...res, xml: res.xml.replace(shape, '') };
        };
        const e = await rejection(layoutBpmn(await parseBpmn(TEMPLATE, 'p/q.bpmn'), 'p/q.bpmn', lossy));
        expect(e.message).toMatch(/^p\/q\.bpmn: layout lost 1 element\(s\): Task_Escalate /);
    });
});

describe('рендер', () => {
    it('SVG: пулы, дорожки, таймер, message flow, кириллица; детерминирован; DI источника игнорируется', async () => {
        const svg = (await renderBpmn(TEMPLATE, 'x.bpmn')).toString();
        for (const id of [
            'Pool_Bank',
            'Pool_CreditBureau',
            'Lane_Client',
            'Lane_BackOffice',
            'Timer_AssessOverdue'
        ])
            expect(svg).toContain(`data-element-id="${id}"`);
        expect(svg).toMatch(/data-element-id="Message_CreditReport"[\s\S]*?stroke-dasharray: 10, 11/);
        for (const label of ['Банк', 'Фронт-офис', 'Одобрить?']) expect(svg).toContain(label);

        expect((await renderBpmn(TEMPLATE, 'x.bpmn')).toString()).toBe(svg);
        expect((await renderBpmn(withDi(TEMPLATE), 'x.bpmn')).toString()).toBe(svg);

        // id маркеров — по порядку, url() без кавычек (иначе resvg теряет стрелки)
        expect(svg).not.toContain("url('#");
        expect([...svg.matchAll(/id="(marker-[^"]+)"/g)].every(([, id]) => /^marker-\d+$/.test(id))).toBe(
            true
        );
    });

    it('PNG-растеризация рисует наконечник стрелки', async () => {
        const svg = (
            await renderBpmn(
                defs(
                    proc(
                        '<bpmn:startEvent id="S" name="s"/><bpmn:endEvent id="E" name="e"/><bpmn:sequenceFlow id="F" sourceRef="S" targetRef="E"/>'
                    )
                ),
                'x.bpmn'
            )
        ).toString();
        const [vx, vy] = /viewBox="(-?\d+) (-?\d+)/.exec(svg).slice(1).map(Number);
        const [x2, y2] = /data-element-id="F"[\s\S]*?d="M[\d.]+,[\d.]+L([\d.]+),([\d.]+)"/
            .exec(svg)
            .slice(1)
            .map(Number);
        const img = new Resvg(svg, { font: resvgFontOptions(false) }).render();
        // Альфа точки внутри треугольника наконечника, в стороне от самой линии (фон прозрачный).
        const alpha = (x, y) => img.pixels[(Math.round(y - vy) * img.width + Math.round(x - vx)) * 4 + 3];
        expect(alpha(x2 - 9, y2 + 3)).toBeGreaterThan(128);
        expect(alpha(x2 - 30, y2 + 3)).toBe(0);
    });
});
