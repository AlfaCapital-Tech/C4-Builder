import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { watchTree } from './dist.mjs';
import { TMP_ROOT } from './helpers.mjs';

// Наблюдатель site -w (#53): встроенный recursive fs.watch на Linux до Node 24.22 / 26.9 терял
// файл, заменённый переименованием (sed -i, safe write редакторов), и папку, пересозданную
// под тем же путём.
fs.mkdirSync(TMP_ROOT, { recursive: true });
const base = fs.mkdtempSync(path.join(TMP_ROOT, 'watch-'));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const watched = (opts = {}) => {
    const root = fs.mkdtempSync(path.join(base, 'tree-'));
    const batches = [];
    let stop = () => {};
    return {
        root,
        start: () => {
            stop = watchTree([root], { delayMs: 50, ...opts }, (paths) => batches.push(paths));
        },
        stop: () => stop(),
        // Действие после затишья — поздние события прошлого шага не засчитываются этому;
        // ждёт пачку, в которой есть путь p.
        async change(p, act) {
            await sleep(150);
            batches.length = 0;
            act();
            for (const until = Date.now() + 3000; Date.now() < until; await sleep(20)) {
                const batch = batches.find((b) => b.includes(p));
                if (batch) return batch;
            }
            throw new Error(`нет события для ${p}, пачки: ${JSON.stringify(batches)}`);
        }
    };
};

// Атомарное сохранение: новый файл рядом и rename поверх старого — новый inode под тем же путём.
const replace = (file, text) => {
    fs.writeFileSync(`${file}.tmp`, text);
    fs.renameSync(`${file}.tmp`, file);
};

describe('watchTree', () => {
    it('файл, заменённый переименованием, остаётся под наблюдением: правка, touch, vim-стиль', async () => {
        const w = watched();
        const f = path.join(w.root, 'a', 'f.md');
        fs.mkdirSync(path.dirname(f));
        fs.writeFileSync(f, 'x\n');
        w.start();
        try {
            await w.change(f, () => replace(f, 'y\n'));
            await w.change(f, () => fs.appendFileSync(f, 'z\n'));
            await w.change(f, () => fs.utimesSync(f, new Date(), new Date()));
            await w.change(f, () => {
                fs.renameSync(f, `${f}~`);
                fs.writeFileSync(f, 'v\n');
                fs.rmSync(`${f}~`);
            });
            await w.change(f, () => fs.appendFileSync(f, 'u\n'));
        } finally {
            w.stop();
        }
    });

    it('новая папка подписывается, пересозданная под тем же путём — подписывается заново', async () => {
        const w = watched();
        const dir = path.join(w.root, 'c');
        const g = path.join(dir, 'g.md');
        w.start();
        try {
            await w.change(dir, () => fs.mkdirSync(dir));
            await w.change(g, () => fs.writeFileSync(g, 'g\n'));
            // rm + mkdir подряд: номер inode папки переиспользуется, сверка inode не помогла бы.
            await w.change(dir, () => {
                fs.rmSync(dir, { recursive: true });
                fs.mkdirSync(dir);
                fs.writeFileSync(g, 'g\n');
            });
            await w.change(g, () => fs.appendFileSync(g, 'h\n'));
            await w.change(g, () => replace(g, 'q\n'));
            await w.change(g, () => fs.appendFileSync(g, 'j\n'));
        } finally {
            w.stop();
        }
    });

    it('ignore: правки в пропускаемой папке не приходят; быстрые правки — одной пачкой', async () => {
        const w = watched({ ignore: (p) => p.split(path.sep).includes('docs') });
        const out = path.join(w.root, 'docs');
        fs.mkdirSync(out);
        const a = path.join(w.root, 'a.md');
        const b = path.join(w.root, 'b.md');
        w.start();
        try {
            const batch = await w.change(a, () => {
                fs.writeFileSync(path.join(out, 'index.html'), '<html>');
                fs.writeFileSync(a, 'a\n');
                fs.writeFileSync(b, 'b\n');
            });
            expect(batch).toContain(b);
            expect(batch.filter((p) => p.startsWith(out))).toEqual([]);
        } finally {
            w.stop();
        }
    });
});
