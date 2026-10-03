import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { goldenDir } from './helpers.mjs';

// Сайт шаблонного проекта не ходит на внешние домены. Сканируем эталон default — golden-тест
// гарантирует, что он равен фактическому выходу сборки. Вендорные .js не сканируются: их
// внешние адреса выключены конфигурацией (nativeEmoji, без docsify-plantuml).
const ROOT = path.join(goldenDir('default'), 'tree');

// index.html и CSS: любой абсолютный или protocol-relative адрес загрузки.
const ANY_URL = /https?:\/\/[^\s"'()<>]+|(?:url\(\s*["']?|(?:src|href)=["'])\/\/[^\s"'()<>]+/gi;
// Страницы: только изображения — гиперссылки из текста автора браузер сам не грузит.
const MD_IMAGE =
    /!\[[^\]]*\]\(\s*<?((?:https?:)?\/\/[^\s)>]+)|<img\b[^>]*\bsrc=["']?((?:https?:)?\/\/[^\s"'>]+)/gi;

const files = fs
    .readdirSync(ROOT, { recursive: true })
    .map((f) => String(f).split(path.sep).join('/'))
    .filter((f) => /^index\.html$|\.css$|\.md$/.test(f));

describe('офлайн-сайт: эталон default без внешних адресов', () => {
    it('сканируются index.html, тема и страницы', () => {
        expect(files).toContain('index.html');
        expect(files).toContain('vendor/vue.css');
        expect(files.some((f) => f.endsWith('.md'))).toBe(true);
    });

    it('нет адресов внешних доменов', () => {
        const found = files.flatMap((rel) => {
            const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            if (rel.endsWith('.md'))
                return [...text.matchAll(MD_IMAGE)].map((m) => `${rel}: ${m[1] ?? m[2]}`);
            // repo — ссылка-уголок на репозиторий, а не загрузка ресурса.
            return [...text.replace(/"repo":\s*"[^"]*"/, '').matchAll(ANY_URL)].map((m) => `${rel}: ${m[0]}`);
        });
        expect(found).toEqual([]);
    });
});
