import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { extractZip, globFiles, globToRegExp, injectHtml, resolveSource } from './dist.mjs';

// Ассеты (инъекция в HTML), резолвер источников (dir/archive по HTTP), glob.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4b-source-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('injectHtml', () => {
    it('стили перед </head>, скрипты перед </body>, регистронезависимо', () => {
        const out = injectHtml('<HTML><HEAD><title>x</title></HEAD><BODY><p>hi</p></BODY></HTML>', {
            styles: ['a.css'],
            scripts: ['b.js']
        });
        expect(out).toBe(
            '<HTML><HEAD><title>x</title><link rel="stylesheet" href="a.css">\n</HEAD><BODY><p>hi</p><script src="b.js"></script>\n</BODY></HTML>'
        );
    });
    it('без </head> и </body> — в конец файла', () => {
        expect(injectHtml('<div></div>', { styles: ['a.css'], scripts: ['b.js'] })).toBe(
            '<div></div>\n<link rel="stylesheet" href="a.css">\n<script src="b.js"></script>'
        );
    });
    it('пустые списки — HTML не меняется', () => {
        expect(injectHtml('<html></html>', { styles: [], scripts: [] })).toBe('<html></html>');
    });
});

describe('glob', () => {
    it('glob → RegExp: **, *, {a,b}, экранирование', () => {
        const re = globToRegExp('**/openapi.{yaml,yml,json}');
        expect(re.test('openapi.yaml')).toBe(true);
        expect(re.test('a/b/openapi.yml')).toBe(true);
        expect(re.test('a/openapi.txt')).toBe(false);
        expect(re.test('a/openapiXyaml')).toBe(false);
        const one = globToRegExp('*/openapi.yaml');
        expect(one.test('finch/openapi.yaml')).toBe(true);
        expect(one.test('a/b/openapi.yaml')).toBe(false);
        expect(one.test('openapi.yaml')).toBe(false);
    });
    it('globFiles обходит дерево, сортирует', () => {
        const root = path.join(tmp, 'glob');
        for (const f of ['b/openapi.yaml', 'a/openapi.json', 'a/x/openapi.yml', 'readme.md']) {
            fs.mkdirSync(path.join(root, path.dirname(f)), { recursive: true });
            fs.writeFileSync(path.join(root, f), '');
        }
        expect(globFiles(root, '**/openapi.{yaml,yml,json}')).toEqual([
            'a/openapi.json',
            'a/x/openapi.yml',
            'b/openapi.yaml'
        ]);
        expect(globFiles(root, '*/openapi.yaml')).toEqual(['b/openapi.yaml']);
    });
});

describe('resolveSource', () => {
    // Фикстура архива: <repo>-<sha>/{spec/openapi.yaml, readme} — как отдают GitLab/GitHub.
    const src = path.join(tmp, 'repo-abc123');
    let server;
    let base;
    const hits = [];
    beforeAll(async () => {
        fs.mkdirSync(path.join(src, 'spec'), { recursive: true });
        fs.writeFileSync(path.join(src, 'spec', 'openapi.yaml'), 'openapi: 3.0.0');
        fs.writeFileSync(path.join(src, 'readme'), 'r');
        execFileSync('tar', ['-czf', path.join(tmp, 'repo.tar.gz'), '-C', tmp, 'repo-abc123']);
        execFileSync('zip', ['-qr', path.join(tmp, 'repo.zip'), 'repo-abc123'], { cwd: tmp });
        // zip-slip: запись ../evil.txt (zip позволяет её собрать явно)
        fs.writeFileSync(path.join(tmp, 'evil.txt'), 'evil');
        execFileSync('zip', ['-q', path.join(tmp, 'evil.zip'), '../evil.txt'], { cwd: src });
        server = http.createServer((req, res) => {
            hits.push({ url: req.url, auth: req.headers['private-token'] });
            const file = path.join(tmp, path.basename(req.url.split('?')[0]));
            if (!fs.existsSync(file)) {
                res.statusCode = 404;
                return res.end('nope');
            }
            res.end(fs.readFileSync(file));
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        base = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(() => server?.close());

    it('dir: существующая папка → абсолютный путь; отсутствующая — ошибка с путём', async () => {
        expect(await resolveSource({ dir: 'repo-abc123' }, tmp)).toBe(src);
        await expect(resolveSource({ dir: 'nope' }, tmp)).rejects.toThrow(path.join(tmp, 'nope'));
    });

    it('archive tar.gz: скачивание, снятие корневого каталога, subdir; повтор — из кэша', async () => {
        const url = `${base}/repo.tar.gz`;
        const dir = await resolveSource({
            archive: url,
            subdir: 'spec',
            headers: { 'PRIVATE-TOKEN': 'tok', Empty: '' }
        });
        expect(fs.readFileSync(path.join(dir, 'openapi.yaml'), 'utf8')).toBe('openapi: 3.0.0');
        expect(dir.startsWith(os.tmpdir())).toBe(true);
        expect(hits.at(-1)).toEqual({ url: '/repo.tar.gz', auth: 'tok' });
        const n = hits.length;
        const again = await resolveSource({ archive: url });
        expect(again).toBe(path.dirname(dir));
        expect(hits.length).toBe(n); // второй резолв того же URL не качает
    });

    it('archive zip', async () => {
        const dir = await resolveSource({ archive: `${base}/repo.zip`, subdir: 'spec' });
        expect(fs.existsSync(path.join(dir, 'openapi.yaml'))).toBe(true);
    });

    it('404 — ошибка с URL и кодом', async () => {
        await expect(resolveSource({ archive: `${base}/missing.tar.gz` })).rejects.toThrow(
            /missing\.tar\.gz.*404/
        );
    });

    it('subdir отсутствует в архиве — ошибка', async () => {
        await expect(resolveSource({ archive: `${base}/repo.tar.gz`, subdir: 'nope' })).rejects.toThrow(
            /нет каталога nope/
        );
    });

    it('zip-slip отвергается', async () => {
        const out = path.join(tmp, 'slip-out');
        fs.mkdirSync(out);
        await expect(extractZip(path.join(tmp, 'evil.zip'), out)).rejects.toThrow(
            /Небезопасный путь|invalid relative path/
        );
        await expect(resolveSource({ archive: `${base}/evil.zip` })).rejects.toThrow(
            /Небезопасный путь|invalid relative path/
        );
    });
});
