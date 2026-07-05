const path = require('path');

// Растеризатор SVG→PNG (resvg, Rust/napi, prebuilt-бинарь, без браузера). Единая
// детерминированная стадия PNG-выхода поверх SVG обоих движков (PlantUML и D2),
// см. change resvg-png. Вендорный шрифт (тот же, что у java-direct) даёт кириллицу
// и повторяемые метрики независимо от машины; системные шрифты отключены.
const FONTS_DIR = path.join(__dirname, 'vendor', 'fonts');
const DEFAULT_FONT_NAME = 'Liberation Sans';

// Ленивая загрузка (как у D2): resvg тянется только при первой растеризации —
// SVG-проекты и «только ditaa» его не грузят. Отсутствие пакета — понятная ошибка.
let ResvgCtor = null;
const getResvg = () => {
    if (ResvgCtor) return ResvgCtor;
    try {
        ResvgCtor = require('@resvg/resvg-js').Resvg;
    } catch (err) {
        throw new Error(
            'Для PNG-вывода (DIAGRAM_FORMAT=png) нужен пакет @resvg/resvg-js.\n' +
                'Установите его: npm install @resvg/resvg-js\n' +
                `Исходная ошибка: ${err.message || err}`
        );
    }
    return ResvgCtor;
};

// SVG (Buffer или строка) → PNG (Buffer), масштаб 1:1 к размеру SVG. Вход — валидный
// SVG движка: PlantUML ссылается на шрифт по имени (грузим из vendor/fonts), D2 несёт
// шрифт во вшитом @font-face, но loadSystemFonts:false фиксируем в обоих случаях.
const rasterizeSvgToPng = (svg) => {
    const Resvg = getResvg();
    const resvg = new Resvg(svg, {
        font: {
            fontDirs: [FONTS_DIR],
            defaultFontFamily: DEFAULT_FONT_NAME,
            loadSystemFonts: false
        }
    });
    return resvg.render().asPng();
};

module.exports = { rasterizeSvgToPng };
