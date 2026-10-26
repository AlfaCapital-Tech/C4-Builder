import { DEFAULT_FONT_NAME } from './fonts.ts';
import { getResvg, resvgFontOptions } from './pngraster.ts';

// Метрики вендорного Nimbus Sans для движков, которые в jsdom раскладывают текст сами
// (BPMN, mermaid): jsdom не умеет ни canvas.measureText, ни getBBox. Меряем тем же resvg,
// что растрирует PNG. Режим системных шрифтов на них не влияет (как и на D2): детерминизм
// важнее.

// hhea и OS/2 Nimbus Sans Regular на 1000 единиц (vendor/fonts): ascender 729,
// descender −271, sxHeight 516.
export const ASCENT = 0.729;
export const DESCENT = 0.271;
export const X_HEIGHT = 0.516;

const widthMemo = new Map<string, number>();

// Символы, запрещённые в XML 1.0: управляющие C0, кроме \t \n \r, U+FFFE/U+FFFF и одиночные
// суррогаты (JSON.parse пропускает их из `\uD800`). resvg на любом из них отвергает весь SVG.
// biome-ignore lint/suspicious/noControlCharactersInRegex: управляющие символы — ровно то, что ищем
const INVALID_XML_RE = /[\0-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|\p{Cs}/gu;

export const stripInvalidXml = (s: string): string => s.replace(INVALID_XML_RE, '');

// Вырезание недопустимых символов — здесь, а не у вызывающих: этой же функцией текст идёт и
// в замер (inkWidth), и в выход, поэтому ширина всегда считается по той строке, что попадёт
// в SVG, и ни один текст не может сделать SVG невалидным.
export const escapeXml = (s: string): string =>
    stripInvalidXml(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);

const inkWidth = (text: string, size: number, bold: boolean): number => {
    const { Resvg } = getResvg();
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><text y="${size}" ` +
        `font-family="${DEFAULT_FONT_NAME}" font-size="${size}"${bold ? ' font-weight="bold"' : ''} ` +
        `xml:space="preserve">${escapeXml(text)}</text></svg>`;
    return new Resvg(svg, { font: resvgFontOptions(false) }).getBBox()?.width ?? 0;
};

// Advance-ширина строки, как у браузера: bbox «|текст|» минус bbox «||» — с пробелами по
// краям, а не ширина чернил.
export const textWidth = (text: string, size: number, bold = false): number => {
    if (!text) return 0;
    const key = `${size}\0${bold}\0${text}`;
    let width = widthMemo.get(key);
    if (width === undefined) {
        // Округление гасит f32-шум resvg между платформами: координаты текста в SVG
        // считаются из этой ширины и должны совпадать побайтно.
        width = Math.round((inkWidth(`|${text}|`, size, bold) - inkWidth('||', size, bold)) * 100) / 100;
        widthMemo.set(key, width);
    }
    return width;
};

export const clearTextWidths = (): void => widthMemo.clear();
