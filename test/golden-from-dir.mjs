#!/usr/bin/env node
// Регенерация эталона test/golden из нормализованного дерева выходов,
// например из CI-артефакта golden-actual-node22 (см. test/README.md):
//   node test/golden-from-dir.mjs <каталог-с-деревом>
import { collectNormalizedTree, updateGolden } from './helpers.mjs';

const dir = process.argv[2];
if (!dir) {
    console.error('usage: node test/golden-from-dir.mjs <normalized-output-dir>');
    process.exit(1);
}
updateGolden(collectNormalizedTree(dir));
console.log(`test/golden обновлён из ${dir}`);
