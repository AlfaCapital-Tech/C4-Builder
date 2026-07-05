import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Единый резолвер путей к ресурсам пакета. vendor/ (JAR, шрифты, docsify),
// template/ и package.json лежат в корне пакета и НЕ компилируются в dist/.
// После сборки этот модуль исполняется из dist/, поэтому корень ищем не по
// глубине файла, а поднимаясь от import.meta.url до ближайшего package.json —
// одинаково работает и из корня (до переезда), и из dist/util/ (после сборки).
const findPackageRoot = (startDir) => {
    let dir = startDir;
    for (;;) {
        if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) throw new Error(`package.json не найден вверх от ${startDir}`);
        dir = parent;
    }
};

export const PACKAGE_ROOT = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
export const VENDOR_DIR = path.join(PACKAGE_ROOT, 'vendor');
export const TEMPLATE_DIR = path.join(PACKAGE_ROOT, 'template');
export const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
