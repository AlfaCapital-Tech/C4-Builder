#!/usr/bin/env node
// Регенерация эталонов test/golden/<variant> из нормализованного дерева выходов,
// например из CI-артефакта golden-actual-node22 (см. test/README.md):
//   node test/golden-from-dir.mjs <actual-root> [variant]
// <actual-root> — каталог с поддиректориями вариантов (default/, links-top/, …).
// Без variant регенерируются все варианты матрицы.
import fs from 'node:fs';
import path from 'node:path';
import { VARIANTS, collectNormalizedTree, updateGolden } from './helpers.mjs';

const root = process.argv[2];
const only = process.argv[3];
if (!root) {
    console.error('usage: node test/golden-from-dir.mjs <actual-root> [variant]');
    process.exit(1);
}
if (only && !VARIANTS.includes(only)) {
    console.error(`неизвестный вариант '${only}'; допустимые: ${VARIANTS.join(', ')}`);
    process.exit(1);
}

for (const variant of only ? [only] : VARIANTS) {
    const dir = path.join(root, variant);
    if (!fs.existsSync(dir)) {
        console.error(`нет каталога варианта: ${dir}`);
        process.exit(1);
    }
    updateGolden(collectNormalizedTree(dir), variant);
    console.log(`test/golden/${variant} обновлён из ${dir}`);
}
