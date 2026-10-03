import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Паритет структуры сайта документации: RU и EN — независимые c4builder-проекты, и без
// проверки страница, добавленная в одну версию, молча не появится в другой. Названия
// папок переведены, поэтому папку сопоставляем по числовому префиксу порядка, а имена
// .md/.puml/.d2 — как есть (их не переводим). Содержание текста не сравнивается.
const DOCS = fileURLToPath(new URL('../docs/', import.meta.url));
const PAGE_FILE = /\.(md|puml|d2)$/;

const collect = (lang) => {
    const keys = new Map(); // ключ сопоставления → путь для сообщения
    const unprefixed = [];
    const walk = (dir, key) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const rel = path.relative(DOCS, path.join(dir, e.name));
            if (e.isDirectory()) {
                const n = e.name.match(/^\d+/)?.[0];
                if (n === undefined) {
                    unprefixed.push(rel);
                    continue;
                }
                keys.set(`${key}${n}/`, rel);
                walk(path.join(dir, e.name), `${key}${n}/`);
            } else if (PAGE_FILE.test(e.name)) keys.set(key + e.name, rel);
        }
    };
    walk(path.join(DOCS, lang, 'src'), '');
    return { keys, unprefixed };
};

it('docs/ru и docs/en имеют одинаковую структуру страниц', () => {
    const ru = collect('ru');
    const en = collect('en');
    const unpaired = (a, b) => [...a.keys].filter(([k]) => !b.keys.has(k)).map(([, rel]) => rel);
    const problems = [
        ...[...ru.unprefixed, ...en.unprefixed].map((p) => `${p}: папка без числового префикса`),
        ...[...unpaired(ru, en), ...unpaired(en, ru)].map((p) => `${p}: нет пары в другой версии`)
    ];
    expect(problems).toEqual([]);
});
