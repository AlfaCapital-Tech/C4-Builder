import { createRequire } from 'node:module';
// Шрифт-пин общий с java-direct рендером (одна точка правды, см. fonts.ts).
import { FONTS_DIR, DEFAULT_FONT_NAME } from './fonts.ts';

// @resvg/resvg-js — CJS-нативный аддон, грузим синхронно через createRequire
// (ленивая загрузка ниже сохраняет прежнюю семантику: пакет тянется при первой
// растеризации, не на импорте модуля).
const require = createRequire(import.meta.url);

// Растеризатор SVG→PNG (resvg, Rust/napi, prebuilt-бинарь, без браузера). Единая
// детерминированная стадия PNG-выхода поверх SVG обоих движков (PlantUML и D2),
// см. change resvg-png. Вендорный шрифт (тот же, что у java-direct) даёт кириллицу
// и повторяемые метрики независимо от машины; системные шрифты отключены.

// Ленивая загрузка (как у D2): resvg тянется только при первой растеризации —
// SVG-проекты и «только ditaa» его не грузят. Отсутствие пакета — понятная ошибка.
type ResvgModule = typeof import('@resvg/resvg-js');

let resvgMod: ResvgModule | null = null;
const getResvg = (): ResvgModule => {
    if (resvgMod) return resvgMod;
    try {
        resvgMod = require('@resvg/resvg-js') as ResvgModule;
    } catch (err) {
        const e = err as Error;
        throw new Error(
            'Для PNG-вывода (DIAGRAM_FORMAT=png) нужен пакет @resvg/resvg-js.\n' +
                'Установите его: npm install @resvg/resvg-js\n' +
                `Исходная ошибка: ${e.message || e}`
        );
    }
    return resvgMod;
};

// SVG (Buffer или строка) → PNG (Buffer), масштаб 1:1 к размеру SVG. Вход — валидный
// SVG движка: PlantUML ссылается на шрифт по имени (грузим из vendor/fonts), D2 несёт
// шрифт во вшитом @font-face, но loadSystemFonts:false фиксируем в обоих случаях.
// renderAsync считает в napi-пуле тредов: JS-поток не блокируется, PlantUML-пул и
// D2-очередь продолжают крутиться параллельно растеризации (прежний sync render()
// останавливал весь event loop на каждую картинку).
const rasterizeSvgToPng = async (svg: string | Buffer): Promise<Buffer> => {
    const { renderAsync } = getResvg();
    const rendered = await renderAsync(svg, {
        font: {
            fontDirs: [FONTS_DIR],
            defaultFontFamily: DEFAULT_FONT_NAME,
            loadSystemFonts: false
        }
    });
    return rendered.asPng();
};

export { rasterizeSvgToPng };
