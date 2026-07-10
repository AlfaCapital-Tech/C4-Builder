import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
    VARIANTS,
    collectNormalizedTree,
    compareWithGolden,
    createFixture,
    decodeXmlEntities,
    ensureManagedJre,
    goldenExists,
    isDiffable,
    readGoldenTreeFile,
    runBuild,
    updateGolden,
    writeActualTree
} from './helpers.mjs';

const UPDATE = process.env.UPDATE_GOLDEN === '1';
// Каталоги фикстур во временном test/.tmp по умолчанию удаляются после прогона.
// KEEP_FIXTURES=1 или падение любого теста оставляет их для отладки.
const KEEP_FIXTURES = process.env.KEEP_FIXTURES === '1';
let anyFailed = false;

// variant -> { dir, tree }
const runs = {};

beforeAll(async () => {
    await ensureManagedJre(); // пин JVM до первой сборки
    for (const variant of VARIANTS) {
        const dir = createFixture(variant);
        runBuild(dir);
        const tree = collectNormalizedTree(path.join(dir, 'docs'));
        writeActualTree(tree, variant);
        runs[variant] = { dir, tree };
    }
});

afterEach((ctx) => {
    if (ctx?.task?.result?.state === 'fail') anyFailed = true;
});

afterAll(() => {
    if (KEEP_FIXTURES || anyFailed) return; // оставляем фикстуры для отладки
    for (const { dir } of Object.values(runs)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// Сверка дерева выходов варианта с его эталоном (или регенерация при UPDATE_GOLDEN=1)
const checkGolden = (variant) => {
    const { tree } = runs[variant];
    if (UPDATE) {
        updateGolden(tree, variant);
        return;
    }

    expect(
        goldenExists(variant),
        `эталон ${variant} отсутствует — сгенерируйте: npm run test:golden:update`
    ).toBe(true);

    const report = compareWithGolden(tree, variant);
    for (const rel of report.changed) {
        if (isDiffable(rel)) {
            expect(tree[rel].text, `[${variant}] содержимое ${rel} расходится с эталоном`).toBe(
                readGoldenTreeFile(variant, rel)
            );
        }
    }
    expect(
        report,
        `[${variant}] выход расходится с эталоном (missing — нет в сборке, extra — лишний, changed — другое содержимое)`
    ).toEqual({ missing: [], extra: [], changed: [] });
};

describe.each(VARIANTS)('golden-сборка fixture (template/src) — вариант %s', (variant) => {
    it(UPDATE ? 'обновление эталона (UPDATE_GOLDEN=1)' : 'дерево выходов совпадает с эталоном', () => {
        checkGolden(variant);
    });
});

describe('контентные проверки: default', () => {
    it('SVG для stdlib- и .iuml-диаграмм присутствуют, кириллица сохранена', () => {
        const tree = runs.default.tree;
        const files = Object.keys(tree);
        // stdlib-инклюд <C4/C4_Context> + локальный styles.iuml из корня src
        expect(files).toContain('context.svg');
        // stdlib-инклюд <C4/C4_Deployment>
        expect(files).toContain('2 Deployment/deployment.svg');
        // .iuml-инклюд из вложенной папки (!include ../styles.iuml) + кириллица
        expect(files).toContain('3 Локализация/localization.svg');

        expect(tree['3 Локализация/README.md'].text).toMatch(/[А-Яа-яЁё]/);
        expect(tree['golden-fixture.md'].text).toMatch(/[А-Яа-яЁё]/);

        const svg = decodeXmlEntities(tree['3 Локализация/localization.svg'].text);
        expect(svg).toContain('Клиент');
        expect(svg).toMatch(/[А-Яа-яЁё]/);
    });

    it('D2-диаграмма отрендерена, импорт _c4lib применён, кириллица сохранена', () => {
        const tree = runs.default.tree;
        const files = Object.keys(tree);
        // .d2 рендерится вторым бэкендом (D2/WASM) → SVG рядом с прочими выходами
        expect(files).toContain('4 D2 Example/landscape.svg');
        // общая библиотека _c4lib.d2 импортируется, но (как _-файл) не рендерится
        expect(files).not.toContain('_c4lib.svg');
        expect(files).not.toContain('4 D2 Example/_c4lib.svg');

        const svg = decodeXmlEntities(tree['4 D2 Example/landscape.svg'].text);
        expect(svg).toContain('Клиент'); // кириллица в D2-SVG
        expect(svg).toMatch(/#0b4884/i); // C4-класс person из импортированного ../_c4lib.d2
    });
});

describe('контентные проверки: links-top', () => {
    it('диаграммы — ссылки, стоят перед текстом', () => {
        const overview = runs['links-top'].tree['Overview.md'].text;
        // includeLinkToDiagram: ссылка вместо изображения диаграммы
        expect(overview).toContain('[Go to context diagram](context.svg)');
        expect(overview).not.toContain('![diagram](context.svg)');
        // diagramsOnTop: блок диаграммы стоит перед текстом документа
        expect(overview.indexOf('[Go to context diagram]')).toBeLessThan(
            overview.indexOf('A System Context diagram is a good starting point')
        );
    });

    it('прочие файлы не скопированы, chrome-блок отсутствует', () => {
        const files = Object.keys(runs['links-top'].tree);
        // excludeOtherFiles: не-md/puml/d2 (png-вложение) в выход не попадают
        expect(files).not.toContain('2020-01-10-16-21-41.png');
        expect(files).not.toContain(
            '1 Internet Banking System/Single Page Application/2020-01-10-16-21-41.png'
        );
        // navigation/TOC/breadcrumbs выключены → нет chrome-блока в md
        const readme = runs['links-top'].tree['1 Internet Banking System/README.md'].text;
        expect(readme).not.toContain('[Overview (up)]'); // навигация вверх
        expect(readme).not.toContain('`/1 Internet Banking System`'); // breadcrumb
    });
});

describe('контентные проверки: embed-png', () => {
    it('не-ditaa диаграммы — PNG растеризацией, ditaa — нативный PNG, SVG нет', () => {
        const files = Object.keys(runs['embed-png'].tree);
        // PlantUML → PNG (растеризация SVG), исходного SVG нет
        expect(files).toContain('context.png');
        expect(files).not.toContain('context.svg');
        // D2 → PNG (растеризация SVG)
        expect(files).toContain('4 D2 Example/landscape.png');
        expect(files).not.toContain('4 D2 Example/landscape.svg');
        // ditaa — нативный PNG
        expect(files).toContain('1 Internet Banking System/Single Page Application/Extended Docs/ditaa.png');
        // ни одного .svg-выхода не осталось (vendor svg в шаблоне нет)
        expect(files.filter((f) => f.endsWith('.svg'))).toEqual([]);
    });

    it('диаграммы встроены в md как data:image/png;base64', () => {
        const overview = runs['embed-png'].tree['Overview.md'].text;
        expect(overview).toContain('data:image/png;base64,');
        expect(overview).not.toContain('![diagram](context.png)'); // не ссылка на файл, а встраивание
    });
});

describe('повторная сборка с тёплым кэшем (.c4builder.cache) — вариант default', () => {
    it('выход второго прогона идентичен первому', () => {
        const { dir, tree: firstRun } = runs.default;
        const cache = JSON.parse(fs.readFileSync(path.join(dir, '.c4builder.cache'), 'utf8'));
        expect(cache.checksums?.length, 'кэш чексумм не наполнился после первой сборки').toBeGreaterThan(0);

        runBuild(dir);
        const secondRun = collectNormalizedTree(path.join(dir, 'docs'));

        expect(Object.keys(secondRun)).toEqual(Object.keys(firstRun));
        const changed = Object.keys(firstRun).filter((rel) => firstRun[rel].sha !== secondRun[rel].sha);
        expect(changed, 'файлы второго прогона, отличающиеся от первого').toEqual([]);
    });
});
