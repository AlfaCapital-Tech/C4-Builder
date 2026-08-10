import { describe, it, expect } from 'vitest';

import { rasterizeSvgToPng } from './dist.mjs';

const svg = (inner) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60">` +
    `<rect width="220" height="60" fill="#ffffff"/>${inner}</svg>`;
const TEXT_SVG = svg(
    `<text x="10" y="38" font-family="Nimbus Sans" font-size="22" fill="#000000">Клиент API</text>`
);
const BLANK_SVG = svg('');

const PNG_SIGNATURE = '89504e470d0a1a0a';

// Растеризация SVG→PNG вендорным шрифтом (resvg) — детерминированная стадия PNG-выхода
// поверх SVG обоих движков (см. change resvg-png). Без байт-эталона под CI: проверяем
// сигнатуру, повторяемость и что кириллица реально рисуется (иначе выход = пустой холст).
describe('pngraster: SVG→PNG (resvg)', () => {
    it('выдаёт валидный PNG', async () => {
        const png = await rasterizeSvgToPng(Buffer.from(TEXT_SVG));
        expect(png.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
        expect(png.length).toBeGreaterThan(100);
    });

    it('детерминирован: два прогона одного SVG байт-в-байт идентичны', async () => {
        const a = await rasterizeSvgToPng(Buffer.from(TEXT_SVG));
        const b = await rasterizeSvgToPng(Buffer.from(TEXT_SVG));
        expect(a.equals(b)).toBe(true);
    });

    it('кириллица отрисована вендорным шрифтом (рендер отличается от пустого холста)', async () => {
        const withText = await rasterizeSvgToPng(Buffer.from(TEXT_SVG));
        const blank = await rasterizeSvgToPng(Buffer.from(BLANK_SVG));
        expect(withText.equals(blank)).toBe(false);
    });
});
