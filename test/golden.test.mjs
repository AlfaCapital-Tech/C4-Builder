import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
    collectNormalizedTree,
    compareWithGolden,
    createFixture,
    decodeXmlEntities,
    goldenExists,
    isDiffable,
    readGoldenTreeFile,
    runBuild,
    updateGolden,
    writeActualTree
} from './helpers.mjs';

const UPDATE = process.env.UPDATE_GOLDEN === '1';

let fixtureDir;
let docsDir;
let firstRun;

beforeAll(() => {
    fixtureDir = createFixture();
    runBuild(fixtureDir);
    docsDir = path.join(fixtureDir, 'docs');
    firstRun = collectNormalizedTree(docsDir);
    writeActualTree(firstRun);
});

describe('golden-сборка fixture (template/src)', () => {
    it(UPDATE ? 'обновление эталона (UPDATE_GOLDEN=1)' : 'дерево выходов совпадает с эталоном', () => {
        if (UPDATE) {
            updateGolden(firstRun);
            return;
        }

        expect(goldenExists(), 'эталон отсутствует — сгенерируйте: npm run test:golden:update').toBe(true);

        const report = compareWithGolden(firstRun);
        for (const rel of report.changed) {
            if (isDiffable(rel)) {
                expect(firstRun[rel].text, `содержимое ${rel} расходится с эталоном`).toBe(
                    readGoldenTreeFile(rel)
                );
            }
        }
        expect(
            report,
            'выход сборки расходится с эталоном (missing — файла нет в сборке, extra — лишний файл, changed — другое содержимое)'
        ).toEqual({ missing: [], extra: [], changed: [] });
    });

    it('SVG для stdlib- и .iuml-диаграмм присутствуют, кириллица сохранена', () => {
        const files = Object.keys(firstRun);
        // stdlib-инклюд <C4/C4_Context> + локальный styles.iuml из корня src
        expect(files).toContain('context.svg');
        // stdlib-инклюд <C4/C4_Deployment>
        expect(files).toContain('2 Deployment/deployment.svg');
        // .iuml-инклюд из вложенной папки (!include ../styles.iuml) + кириллица
        expect(files).toContain('3 Локализация/localization.svg');

        expect(firstRun['3 Локализация/README.md'].text).toMatch(/[А-Яа-яЁё]/);
        expect(firstRun['golden-fixture.md'].text).toMatch(/[А-Яа-яЁё]/);

        const svg = decodeXmlEntities(firstRun['3 Локализация/localization.svg'].text);
        expect(svg).toContain('Клиент');
        expect(svg).toMatch(/[А-Яа-яЁё]/);
    });

    it('D2-диаграмма отрендерена, импорт _c4lib применён, кириллица сохранена', () => {
        const files = Object.keys(firstRun);
        // .d2 рендерится вторым бэкендом (D2/WASM) → SVG рядом с прочими выходами
        expect(files).toContain('4 D2 Example/landscape.svg');
        // общая библиотека _c4lib.d2 импортируется, но (как _-файл) не рендерится
        expect(files).not.toContain('_c4lib.svg');
        expect(files).not.toContain('4 D2 Example/_c4lib.svg');

        const svg = decodeXmlEntities(firstRun['4 D2 Example/landscape.svg'].text);
        expect(svg).toContain('Клиент'); // кириллица в D2-SVG
        expect(svg).toMatch(/#0b4884/i); // C4-класс person из импортированного ../_c4lib.d2
    });
});

describe('повторная сборка с тёплым кэшем (.c4builder.cache)', () => {
    it('выход второго прогона идентичен первому', () => {
        const cache = JSON.parse(fs.readFileSync(path.join(fixtureDir, '.c4builder.cache'), 'utf8'));
        expect(cache.checksums?.length, 'кэш чексумм не наполнился после первой сборки').toBeGreaterThan(0);

        runBuild(fixtureDir);
        const secondRun = collectNormalizedTree(docsDir);

        expect(Object.keys(secondRun)).toEqual(Object.keys(firstRun));
        const changed = Object.keys(firstRun).filter((rel) => firstRun[rel].sha !== secondRun[rel].sha);
        expect(changed, 'файлы второго прогона, отличающиеся от первого').toEqual([]);
    });
});
