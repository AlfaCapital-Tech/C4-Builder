import path from 'node:path';
import { VENDOR_DIR } from '../../util/paths.ts';

// Единая точка детерминизма рендера текста. Вендорный шрифт пинуется в ОБА движка:
// JVM/PlantUML (`-Dsun.java2d.fontpath`, `-SdefaultFontName`) и resvg/PNG
// (`fontDirs`, `defaultFontFamily`). Значения обязаны совпадать — иначе метрики
// текста разъедутся и PNG-golden покраснеют. НЕ менять без пересбора эталонов.
export const FONTS_DIR = path.join(VENDOR_DIR, 'fonts');
export const DEFAULT_FONT_NAME = 'Liberation Sans';
