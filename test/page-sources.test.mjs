import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { TMP_ROOT } from './helpers.mjs';
import { addPage, renderChange } from './dist.mjs';

// Источники страниц (change site-comments, D1): виртуальные страницы через addPage и
// страницы openspec — артефакт со своими ':include', страница change'а — первый артефакт.
fs.mkdirSync(TMP_ROOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'page-sources-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (rel, content) => {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
};
const rel = (p) => path.relative(process.cwd(), path.join(dir, p)).split(path.sep).join('/');

describe('addPage: sources', () => {
    const options = { ROOT_FOLDER: 'src', DIST_FOLDER: 'docs' };
    const root = {
        dir: 'src',
        name: 'Overview',
        level: 1,
        mdFiles: [],
        sources: [],
        diagrams: [],
        descendants: []
    };
    const tree = [root];
    it('переданные пути становятся абсолютными; без sources — пусто', () => {
        const a = addPage(tree, options, { path: ['A'], markdown: 'a', sources: ['src/a.md', '/abs/b.md'] });
        expect(a.sources).toEqual([path.resolve('src/a.md'), path.resolve('/abs/b.md')]);
        const b = addPage(tree, options, { path: ['B'], markdown: 'b' });
        expect(b.sources).toEqual([]);
    });
});

describe('openspec renderChange: sources', () => {
    write('changes/dig-1/proposal.md', '## Why\n\nbecause\n');
    write('changes/dig-1/design.md', "## Context\n\n[Backend](_back/back.md ':include')\n");
    write('changes/dig-1/_back/back.md', '# Backend\n\ntext\n');
    const change = {
        id: 'dig-1',
        dir: path.join(dir, 'changes', 'dig-1'),
        artifacts: [
            {
                name: 'proposal',
                content: fs.readFileSync(path.join(dir, 'changes/dig-1/proposal.md'), 'utf8')
            },
            { name: 'design', content: fs.readFileSync(path.join(dir, 'changes/dig-1/design.md'), 'utf8') }
        ],
        deltas: [],
        meta: {},
        mtime: Date.now()
    };
    const pages = renderChange(change, ['OpenSpec', 'Changes', 'dig-1'], ['proposal', 'design', 'tasks'], {});
    const byPath = (p) => pages.find((x) => x.path.join('/') === p);

    it('страница change — файл первого артефакта', () => {
        expect(byPath('OpenSpec/Changes/dig-1').sources).toEqual([rel('changes/dig-1/proposal.md')]);
    });
    it('артефакт со встраиванием — свой файл и :include по порядку', () => {
        expect(byPath('OpenSpec/Changes/dig-1/design').sources).toEqual([
            rel('changes/dig-1/design.md'),
            rel('changes/dig-1/_back/back.md')
        ]);
    });
});
