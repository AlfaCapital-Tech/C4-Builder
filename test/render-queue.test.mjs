import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    build,
    DiagramQueue,
    generateImages,
    pendingPlaceholderSvg,
    rasterizeSvgToPng,
    renderBpmn,
    renderMermaid,
    renderOffThread,
    teardownBpmn,
    teardownMermaid,
    teardownOffThread
} from './dist.mjs';
import { ensureManagedJre, REPO_ROOT, runBuild, TMP_ROOT } from './helpers.mjs';

// Очередь рендера с приоритетом, инкрементальная запись кэша и отложенный рендер
// (change site-warm-start, design 1, 2, 4, 5).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Задача, которая завершается только по внешнему сигналу — чтобы управлять порядком вручную.
const gate = () => {
    let open;
    const opened = new Promise((r) => (open = r));
    return { open, opened };
};

describe('DiagramQueue', () => {
    const queue = (width = 1) => new DiagramQueue({ width: () => width });
    const task = (out, log, lane = 'plantuml', wait) => ({
        out,
        lane,
        run: async () => {
            if (wait) await wait;
            log.push(out);
        }
    });

    it('без prioritize — порядок добавления, ведущий слэш в путях не важен', async () => {
        const log = [];
        const q = queue();
        for (const out of ['/A/a.svg', 'b.svg', '/C/c.svg']) q.add(task(out, log));
        expect(q.size).toBe(3);
        await q.run();
        expect(log).toEqual(['/A/a.svg', 'b.svg', '/C/c.svg']);
    });

    it('prioritize(pageMd) переставляет диаграммы папки страницы в голову, остальные — в прежнем порядке', async () => {
        const log = [];
        const q = queue();
        for (const out of ['/A/a1.svg', '/A/a2.svg', 'root.svg', '/B/b1.svg', '/B/b2.svg'])
            q.add(task(out, log));
        q.prioritize('/B/B.md');
        await q.run();
        expect(log).toEqual(['/B/b1.svg', '/B/b2.svg', '/A/a1.svg', '/A/a2.svg', 'root.svg']);
    });

    it('страница корня (dirname ".") поднимает диаграммы корня', async () => {
        const log = [];
        const q = queue();
        for (const out of ['/A/a.svg', 'root.svg']) q.add(task(out, log));
        q.prioritize('Overview.md');
        await q.run();
        expect(log).toEqual(['root.svg', '/A/a.svg']);
    });

    it('выполняющаяся задача не прерывается; приоритет действует на ещё не начатые', async () => {
        const log = [];
        const q = queue();
        const g = gate();
        q.add(task('/A/a.svg', log, 'plantuml', g.opened));
        q.add(task('/A/a2.svg', log));
        q.add(task('/B/b.svg', log));
        const done = [];
        q.onDone((out) => done.push(out));
        const run = q.run();
        await sleep(20); // a.svg уже взята воркером и ждёт
        q.prioritize('/B/B.md');
        g.open();
        await run;
        expect(log).toEqual(['/A/a.svg', '/B/b.svg', '/A/a2.svg']);
        // onDone отдаёт путь относительно dist без ведущего слэша — им страница ищет <img>
        expect(done).toEqual(['A/a.svg', 'B/b.svg', 'A/a2.svg']);
    });

    it('дорожки независимы: ширина per-lane, задачи разных движков идут параллельно', async () => {
        const log = [];
        const q = new DiagramQueue({ width: (lane) => (lane === 'plantuml' ? 2 : 1) });
        const g = gate();
        q.add(task('p1.svg', log, 'plantuml', g.opened));
        q.add(task('p2.svg', log, 'plantuml', g.opened));
        q.add(task('p3.svg', log, 'plantuml'));
        q.add(task('d1.svg', log, 'd2'));
        const run = q.run();
        await sleep(20);
        // Две PlantUML-задачи заняты, третья ждёт; D2 — своя дорожка, уже выполнена.
        expect(log).toEqual(['d1.svg']);
        g.open();
        await run;
        expect(log.sort()).toEqual(['d1.svg', 'p1.svg', 'p2.svg', 'p3.svg']);
    });

    it('ошибка: новые задачи дорожки не стартуют, начатые дожидаются, бросается первая; onSettled — всегда', async () => {
        const log = [];
        let settled = 0;
        const q = new DiagramQueue({ width: () => 2, onSettled: () => settled++ });
        const g = gate();
        q.add({ out: 'slow.svg', lane: 'plantuml', run: () => g.opened.then(() => log.push('slow')) });
        q.add({
            out: 'bad.svg',
            lane: 'plantuml',
            run: async () => {
                throw new Error('boom');
            }
        });
        q.add(task('never.svg', log));
        const run = q.run();
        await sleep(20);
        g.open();
        await expect(run).rejects.toThrow('boom');
        expect(log).toEqual(['slow']);
        expect(settled).toBe(1);
    });
});

// Фикстура: дерево из N PlantUML-диаграмм по папкам, одна может быть битой.
const makeTree = (root, names, broken = new Set()) => {
    const tree = [];
    for (const name of names) {
        const dir = path.join(root, name);
        fs.mkdirSync(dir, { recursive: true });
        const content = broken.has(name)
            ? '@startuml\nAlice -> \nfoo bar baz\n@enduml\n'
            : `@startuml\ntitle ${name}\nA -> B: ${name}\n@enduml\n`;
        fs.writeFileSync(path.join(dir, `${name}.puml`), content);
        fs.writeFileSync(path.join(dir, `${name}.md`), `# ${name}\n\n![diagram](${name}.puml)\n`);
        tree.push({
            dir,
            name,
            level: 1,
            parent: root,
            mdFiles: [],
            pumlFiles: [],
            diagrams: [{ dir: `${name}.puml`, ext: '.puml', engine: 'plantuml', content, isDitaa: false }],
            descendants: []
        });
    }
    return tree;
};

const memCache = () => {
    const store = new Map();
    const calls = [];
    return {
        calls,
        get: (k) => store.get(k),
        set: (k, v) => {
            store.set(k, v);
            calls.push(v);
        }
    };
};

const OPTIONS = (dir) => ({
    ROOT_FOLDER: path.join(dir, 'src'),
    DIST_FOLDER: path.join(dir, 'docs'),
    GENERATE_LOCAL_IMAGES: true,
    GENERATE_MD: false,
    GENERATE_WEBSITE: false,
    GENERATE_LLMS: false,
    GENERATE_COMPLETE_MD_FILE: false,
    EMBED_DIAGRAM: false,
    HOMEPAGE_NAME: 'Overview',
    DIAGRAM_FORMAT: 'svg',
    CHARSET: 'UTF-8',
    USE_SYSTEM_FONTS: false,
    EXCLUDE_OTHER_FILES: false,
    INCLUDE_LINK_TO_DIAGRAM: false,
    INCLUDE_BREADCRUMBS: false,
    INCLUDE_NAVIGATION: false,
    INCLUDE_TABLE_OF_CONTENTS: false,
    DIAGRAMS_ON_TOP: false,
    D2_LAYOUT: 'dagre',
    PLUGINS: []
});

describe('инкрементальная запись кэша и отложенный рендер (PlantUML, managed JRE)', () => {
    let dir;
    const savedEnv = { ...process.env };
    beforeAll(async () => {
        process.env.JAVA_HOME = await ensureManagedJre();
        fs.mkdirSync(TMP_ROOT, { recursive: true });
        dir = fs.mkdtempSync(path.join(TMP_ROOT, 'render-queue-'));
    });
    afterAll(() => {
        process.env.JAVA_HOME = savedEnv.JAVA_HOME;
        if (savedEnv.JAVA_HOME === undefined) delete process.env.JAVA_HOME;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('падение 3-й диаграммы из 5 оставляет в кэше чексуммы первых двух; следующий прогон берёт их из бэкапа', async () => {
        const root = path.join(dir, 'inc', 'src');
        const names = ['d1', 'd2', 'd3', 'd4', 'd5'];
        const tree = makeTree(root, names, new Set(['d3']));
        const options = { ...OPTIONS(path.join(dir, 'inc')), ROOT_FOLDER: root };
        const bk = path.join(dir, 'inc', 'docs_bk');
        // Папки dist создаёт scan (generateTree) — здесь generateImages зовётся напрямую.
        const mkDist = () => {
            for (const n of names) fs.mkdirSync(path.join(options.DIST_FOLDER, n), { recursive: true });
        };
        mkDist();
        const cache = memCache();
        const prev = process.env.C4BUILDER_RENDER_CONCURRENCY;
        process.env.C4BUILDER_RENDER_CONCURRENCY = '1'; // строго по порядку: d1, d2, затем сбой на d3
        try {
            await expect(generateImages(tree, options, undefined, cache, bk)).rejects.toThrow('d3.svg');
        } finally {
            if (prev === undefined) delete process.env.C4BUILDER_RENDER_CONCURRENCY;
            else process.env.C4BUILDER_RENDER_CONCURRENCY = prev;
        }
        const checksums = cache.get('checksums');
        expect(checksums).toHaveLength(2);
        expect(fs.existsSync(path.join(options.DIST_FOLDER, 'd1', 'd1.svg'))).toBe(true);
        expect(fs.existsSync(path.join(options.DIST_FOLDER, 'd2', 'd2.svg'))).toBe(true);
        expect(fs.existsSync(path.join(options.DIST_FOLDER, 'd3', 'd3.svg'))).toBe(false);

        // Повторный прогон: dist → бэкап с маркером вместо картинок; восстановленные из кэша
        // диаграммы несут маркер (копия), а не свежий рендер.
        fs.rmSync(bk, { recursive: true, force: true });
        fs.renameSync(options.DIST_FOLDER, bk);
        for (const n of ['d1', 'd2'])
            fs.writeFileSync(path.join(bk, n, `${n}.svg`), `<svg>restored ${n}</svg>`);
        mkDist();
        const fixed = makeTree(root, names); // d3 починена
        await generateImages(fixed, options, undefined, cache, bk);
        expect(fs.readFileSync(path.join(options.DIST_FOLDER, 'd1', 'd1.svg'), 'utf8')).toBe(
            '<svg>restored d1</svg>'
        );
        expect(fs.readFileSync(path.join(options.DIST_FOLDER, 'd2', 'd2.svg'), 'utf8')).toBe(
            '<svg>restored d2</svg>'
        );
        expect(fs.readFileSync(path.join(options.DIST_FOLDER, 'd3', 'd3.svg'), 'utf8')).toContain('<svg');
        expect(cache.get('checksums')).toHaveLength(5);
    }, 240_000);

    it('Ctrl+C посреди сборки: готовые диаграммы уже в кэше (дебаунс), следующая сборка берёт их из прошлого выхода', async () => {
        const proj = path.join(dir, 'sigint');
        const names = Array.from({ length: 8 }, (_, i) => `s${i + 1}`);
        makeTree(path.join(proj, 'src'), names);
        const config = JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/default.c4builder.json'), 'utf8')
        );
        fs.writeFileSync(path.join(proj, '.c4builder'), JSON.stringify(config));
        const cachePath = path.join(proj, '.c4builder.cache');
        const cached = () => {
            try {
                return JSON.parse(fs.readFileSync(cachePath, 'utf8')).checksums?.length ?? 0;
            } catch {
                return 0;
            }
        };
        // Обработчика SIGINT у CLI нет: процесс умирает сразу, finally не выполняется — в кэше
        // только то, что успел записать дебаунс по ходу рендера.
        const child = spawn(process.execPath, [path.join(REPO_ROOT, 'dist', 'index.js')], {
            cwd: proj,
            env: { ...process.env, C4BUILDER_RENDER_CONCURRENCY: '1', NO_UPDATE_NOTIFIER: '1' },
            stdio: 'ignore'
        });
        const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
        const deadline = Date.now() + 120_000;
        while (cached() < 2 && Date.now() < deadline) await sleep(50);
        child.kill('SIGINT');
        const { signal } = await exited;
        expect(signal).toBe('SIGINT'); // прервана, а не завершилась сама
        const kept = cached();
        expect(kept).toBeGreaterThanOrEqual(2);
        expect(kept).toBeLessThan(names.length);

        // Маркер в готовую картинку прерванного выхода: следующая сборка должна взять её из
        // бэкапа (копия), а не отрендерить заново.
        const done = names.filter((n) => fs.existsSync(path.join(proj, 'docs', n, `${n}.svg`)));
        expect(done.length).toBeGreaterThanOrEqual(kept);
        fs.writeFileSync(path.join(proj, 'docs', done[0], `${done[0]}.svg`), '<svg>marker</svg>');
        runBuild(proj);
        expect(fs.readFileSync(path.join(proj, 'docs', done[0], `${done[0]}.svg`), 'utf8')).toBe(
            '<svg>marker</svg>'
        );
        expect(cached()).toBe(names.length);
    }, 240_000);

    it('build(..., { deferImages: true }): очередь на N задач, заглушки в dist, после run() — картинки; ошибка в фоне → заглушка с ошибкой', async () => {
        const proj = path.join(dir, 'defer');
        const root = path.join(proj, 'src');
        makeTree(root, ['x1', 'x2', 'bad'], new Set(['bad']));
        const options = OPTIONS(proj);
        const cache = memCache();

        const { pending } = await build(options, cache, [], { deferImages: true });
        expect(pending).toBeDefined();
        expect(pending.size).toBe(3);
        for (const n of ['x1', 'x2', 'bad']) {
            const svg = fs.readFileSync(path.join(options.DIST_FOLDER, n, `${n}.svg`), 'utf8');
            expect(svg, n).toContain('rendering…');
        }
        const done = [];
        pending.onDone((out) => done.push(out));
        await pending.run(); // ошибка bad.puml не выбрасывается — заглушка с ошибкой и ✗ в логе
        expect(done.sort()).toEqual(['bad/bad.svg', 'x1/x1.svg', 'x2/x2.svg']);
        for (const n of ['x1', 'x2']) {
            const svg = fs.readFileSync(path.join(options.DIST_FOLDER, n, `${n}.svg`), 'utf8');
            expect(svg).not.toContain('rendering…');
            expect(svg).toContain('<svg');
        }
        const bad = fs.readFileSync(path.join(options.DIST_FOLDER, 'bad', 'bad.svg'), 'utf8');
        expect(bad).toContain('diagram not rendered');
        // чексуммы: только успешные; битая — нет, её перерисует следующая сборка
        expect(cache.get('checksums')).toHaveLength(2);

        // Обычная сборка поверх: всё из кэша, кроме bad — она снова падает (не soft), сборка — ошибка.
        await expect(build(options, cache, [])).rejects.toThrow('bad.svg');
    }, 240_000);

    it('PNG-заглушка при useSystemFonts растеризуется вендорным шрифтом, без загрузки системных', async () => {
        const proj = path.join(dir, 'defer-png');
        makeTree(path.join(proj, 'src'), ['p1']);
        const options = { ...OPTIONS(proj), DIAGRAM_FORMAT: 'png', USE_SYSTEM_FONTS: true };
        const { pending } = await build(options, memCache(), [], { deferImages: true });
        expect(pending.size).toBe(1);
        // Системные шрифты дали бы другие байты (и секунды на скан шрифтов системы).
        const expected = await rasterizeSvgToPng(Buffer.from(pendingPlaceholderSvg('p1.png')), false);
        expect(fs.readFileSync(path.join(options.DIST_FOLDER, 'p1', 'p1.png')).equals(expected)).toBe(true);
    }, 240_000);

    it('обычный build() заглушек не оставляет, pending не возвращает', async () => {
        const proj = path.join(dir, 'plain');
        makeTree(path.join(proj, 'src'), ['y1', 'y2']);
        const options = OPTIONS(proj);
        const { pending } = await build(options, memCache(), []);
        expect(pending).toBeUndefined();
        for (const n of ['y1', 'y2']) {
            expect(fs.readFileSync(path.join(options.DIST_FOLDER, n, `${n}.svg`), 'utf8')).not.toContain(
                'rendering…'
            );
        }
    }, 240_000);

    it('тёплый старт с deferImages: всё из кэша — очереди нет', async () => {
        const proj = path.join(dir, 'warm');
        makeTree(path.join(proj, 'src'), ['w1']);
        const options = OPTIONS(proj);
        const cache = memCache();
        await build(options, cache, []);
        const { pending } = await build(options, cache, [], { deferImages: true });
        expect(pending).toBeUndefined();
        expect(fs.readFileSync(path.join(options.DIST_FOLDER, 'w1', 'w1.svg'), 'utf8')).not.toContain(
            'rendering…'
        );
    }, 240_000);

    it('failedRenders: упавшая диаграмма без изменений не рендерится повторно; правка и возврат к битому — рендер', async () => {
        const proj = path.join(dir, 'failed');
        const root = path.join(proj, 'src');
        const options = OPTIONS(proj);
        const cache = memCache();
        const failedRenders = new Map();
        const badSvg = () => fs.readFileSync(path.join(options.DIST_FOLDER, 'bad', 'bad.svg'), 'utf8');
        // Пересборка dev-сервера: softErrors + общая на сессию карта упавших.
        const rebuild = async () => {
            const log = vi.spyOn(console, 'log').mockImplementation(() => {});
            try {
                await build(options, cache, [], { softErrors: true, failedRenders });
                return log.mock.calls.map((c) => c.join(' ')).join('\n');
            } finally {
                log.mockRestore();
            }
        };

        makeTree(root, ['ok', 'bad'], new Set(['bad']));
        let out = await rebuild();
        expect(out).toMatch(/✗ Diagram "bad\.svg": PlantUML exited/);
        expect(badSvg()).toContain('diagram not rendered');
        expect([...failedRenders.keys()]).toEqual(['/bad/bad.svg']);

        // Тот же вход: без JVM — заглушка с ошибкой переносится, `✗` не повторяется.
        out = await rebuild();
        expect(out).not.toContain('✗');
        expect(out).toContain('Diagram "bad.svg": unchanged since it failed, not re-rendered');
        expect(badSvg()).toContain('diagram not rendered');
        expect(cache.get('checksums')).toHaveLength(1); // упавшая в кэш не попадает

        // Починили — рендер; вернули битый вход — снова рендер (в бэкапе уже не заглушка).
        makeTree(root, ['ok', 'bad']);
        out = await rebuild();
        expect(badSvg()).not.toContain('diagram not rendered');
        expect(failedRenders.size).toBe(0);
        makeTree(root, ['ok', 'bad'], new Set(['bad']));
        out = await rebuild();
        expect(out).toMatch(/✗ Diagram "bad\.svg": PlantUML exited/);
        expect(badSvg()).toContain('diagram not rendered');
    }, 240_000);
});

it('pendingPlaceholderSvg — валидный SVG с именем и текстом rendering…, спецсимволы экранированы', () => {
    const svg = pendingPlaceholderSvg('a<b>.svg');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('a&lt;b&gt;.svg: rendering…');
});

// BPMN и mermaid в worker-потоке (dev-сервер): тот же результат, та же ошибка, а главный
// поток не замирает на время рендера.
describe('renderOffThread', () => {
    afterAll(async () => {
        await teardownOffThread();
        await teardownMermaid();
        await teardownBpmn();
    });

    // flowchart на 88 узлов и 160 рёбер — в главном потоке рендер молчит больше секунды.
    const BIG = `flowchart LR\n${[
        ...Array.from({ length: 88 }, (_, i) => `  n${i}[Node ${i}] --> n${(i * 7 + 3) % 88}`),
        ...Array.from({ length: 72 }, (_, i) => `  n${i} --> n${(i * 13 + 5) % 88}`)
    ].join('\n')}`;
    const BPMN =
        '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" ' +
        'targetNamespace="https://example.com/t"><bpmn:process id="P" name="P">' +
        '<bpmn:startEvent id="S" name="s"/><bpmn:task id="T" name="t"/><bpmn:endEvent id="E" name="e"/>' +
        '<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T"/>' +
        '<bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="E"/></bpmn:process></bpmn:definitions>';

    it('mermaid: байты как в главном потоке, event loop не блокируется', async () => {
        let last = Date.now();
        let maxGap = 0;
        const timer = setInterval(() => {
            maxGap = Math.max(maxGap, Date.now() - last);
            last = Date.now();
        }, 5);
        let off;
        try {
            off = await renderOffThread('mermaid', BIG, 'big.mmd');
        } finally {
            clearInterval(timer);
        }
        expect(maxGap).toBeLessThan(250);
        expect(Buffer.compare(off, await renderMermaid(BIG, 'big.mmd'))).toBe(0);
    }, 120_000);

    it('BPMN: байты как в главном потоке', async () => {
        const off = await renderOffThread('bpmn', BPMN, 'a.bpmn');
        expect(Buffer.compare(off, await renderBpmn(BPMN, 'a.bpmn'))).toBe(0);
    }, 120_000);

    it('ошибка движка приходит с тем же message, воркер жив', async () => {
        const bad = 'flowchart LR\n  A -->';
        const main = await renderMermaid(bad, 'bad.mmd').catch((e) => e.message);
        await expect(renderOffThread('mermaid', bad, 'bad.mmd')).rejects.toThrow(main);
        expect(
            (await renderOffThread('mermaid', 'flowchart LR\n  A --> B', 'ok.mmd')).length
        ).toBeGreaterThan(0);
    }, 120_000);

    it('teardown во время рендера: ждущий отклоняется, а не висит', async () => {
        const job = renderOffThread('mermaid', BIG, 'big.mmd');
        await teardownOffThread();
        await expect(job).rejects.toThrow('worker terminated');
    }, 120_000);
});
