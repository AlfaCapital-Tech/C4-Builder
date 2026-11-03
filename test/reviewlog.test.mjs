import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
    deleteRemark,
    fillCells,
    findReviewFile,
    isReviewFile,
    parseRemarks,
    remarkVars,
    writeRemark
} from './dist.mjs';
import { TMP_ROOT } from './helpers.mjs';

// Журнал ревью (change site-review-log): поиск файла вверх по дереву в пределах проекта,
// подстановки шаблона ячеек, запись строки.
fs.mkdirSync(TMP_ROOT, { recursive: true });
const root = fs.mkdtempSync(path.join(TMP_ROOT, 'reviewlog-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const change = path.join(root, 'openspec', 'changes', 'c1');
const deltaDir = path.join(change, 'specs', 'cap');
fs.mkdirSync(deltaDir, { recursive: true });
const review = path.join(change, 'review.md');
const TABLE =
    '# Review\n\n## Remarks\n\n| # | Where | Remark | Author | Status | Reply |\n|---|---|---|---|---|---|\n';
fs.writeFileSync(review, TABLE);
fs.writeFileSync(path.join(change, 'design.md'), '# D\n');
fs.writeFileSync(path.join(deltaDir, 'spec.md'), '# S\n');

describe('findReviewFile', () => {
    it('рядом с исходником и на два уровня выше (дельта спеки)', () => {
        expect(findReviewFile(change, 'review.md', root)).toBe(review);
        expect(findReviewFile(deltaDir, 'review.md', root)).toBe(review);
    });
    it('выше корня проекта не ищет; каталог вне корня — undefined', () => {
        fs.writeFileSync(path.join(root, 'other.md'), '');
        expect(findReviewFile(deltaDir, 'missing.md', root)).toBeUndefined();
        expect(findReviewFile(deltaDir, 'other.md', change)).toBeUndefined();
        expect(findReviewFile(path.dirname(root), 'other.md', root)).toBeUndefined();
    });
    it('каталог с именем журнала пропускается, поиск идёт выше', () => {
        fs.mkdirSync(path.join(deltaDir, 'review.md'));
        expect(findReviewFile(deltaDir, 'review.md', root)).toBe(review);
        fs.rmdirSync(path.join(deltaDir, 'review.md'));
    });
    it('`..` в имени не выводит за корень', () => {
        expect(findReviewFile(change, path.join('..', '..', '..', '..', 'etc'), root)).toBeUndefined();
    });
});

describe('remarkVars и fillCells', () => {
    const vars = remarkVars(
        {
            comment: ' Bad <b>idea</b> ',
            quote: 'foo\n bar',
            section: 'Flow',
            source: path.join(deltaDir, 'spec.md'),
            author: 'Me',
            date: '2026-11-03'
        },
        review
    );
    it('подстановки: HTML экранирован, artifact — имя файла, page — от каталога журнала', () => {
        expect(vars).toEqual({
            comment: 'Bad &lt;b&gt;idea&lt;/b&gt;',
            quote: 'foo bar',
            text: 'Bad &lt;b&gt;idea&lt;/b&gt; — «foo bar»',
            section: 'Flow',
            artifact: 'spec',
            page: 'specs/cap/spec.md',
            author: 'Me',
            date: '2026-11-03'
        });
    });
    it('без цитаты text — только комментарий; цитата режется до 200; дата — сегодня', () => {
        const v = remarkVars({ comment: 'x', quote: 'y'.repeat(300), source: 'a.md', author: '' }, review);
        expect(v.quote).toBe(`${'y'.repeat(199)}…`);
        expect(remarkVars({ comment: 'x', source: 'a.md', author: '' }, review).text).toBe('x');
        const d = new Date();
        expect(v.date).toBe(
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        );
    });
    it('fillCells: неизвестный ключ остаётся', () => {
        expect(fillCells(['{artifact} → {section}', '{text}', '{nope}', ''], vars)).toEqual([
            'spec → Flow',
            'Bad &lt;b&gt;idea&lt;/b&gt; — «foo bar»',
            '{nope}',
            ''
        ]);
    });
});

describe('artifact', () => {
    it('README.md — имя папки, иначе имя файла', () => {
        const v = (src) => remarkVars({ comment: 'x', source: src, author: '' }, review).artifact;
        expect(v(path.join(root, 'Change', 'README.md'))).toBe('Change');
        expect(v(path.join(root, 'Change', 'design.md'))).toBe('design');
    });
});

describe('parseRemarks', () => {
    const log = path.join(root, 'parse.md');
    const cells = ['', '{artifact} → {section}', '{text}', '{author}', ''];
    const opts = { file: 'parse.md', heading: ['Remarks'], cells };
    fs.writeFileSync(
        log,
        [
            '## Remarks',
            '',
            '| # | Where | What | Who | Status |',
            '|---|---|---|---|---|',
            '| 1 | design → Flow | Bad &amp; co — «foo `bar`» | Me |  |',
            '| 2 | spec → Other | Other page — «baz» | Me |  |',
            '| 3 | design → Flow | No quote here | AI | Fixed |',
            '| 4 | design, п. 3 | Does not match the template | AI |  |',
            ''
        ].join('\n')
    );
    it('по шаблону: только строки этой страницы, цитата из {text}, сущности и разметка сняты', () => {
        expect(parseRemarks(log, opts, path.join(root, 'design.md'))).toEqual([
            { number: 1, comment: 'Bad & co', quote: 'foo bar', section: 'Flow' }
        ]);
        expect(parseRemarks(log, opts, path.join(root, 'spec.md'))).toEqual([
            { number: 2, comment: 'Other page', quote: 'baz', section: 'Other' }
        ]);
    });
    it('обрезанная цитата без хвоста `…`, пустой раздел в конце ячейки, `_` в пути, повтор подстановки', () => {
        fs.writeFileSync(
            log,
            [
                '## Remarks',
                '',
                '| # | Where | What | Who | Status |',
                '|---|---|---|---|---|',
                `| 1 | design → | Long — «${'y'.repeat(199)}…» | Me |  |`,
                '| 2 | _front → Flow | Front — «foo» | Me |  |',
                ''
            ].join('\n')
        );
        expect(parseRemarks(log, opts, path.join(root, 'design.md'))).toEqual([
            { number: 1, comment: 'Long', quote: 'y'.repeat(199), section: '' }
        ]);
        expect(parseRemarks(log, opts, path.join(root, '_front', 'README.md'))).toEqual([
            { number: 2, comment: 'Front', quote: 'foo', section: 'Flow' }
        ]);
        const twice = { ...opts, cells: ['', '{artifact} ({artifact}) → {section}', '{text}'] };
        expect(() => parseRemarks(log, twice, path.join(root, 'design.md'))).not.toThrow();
    });
    it('без шаблона — вторая колонка как у вопроса, страница не фильтруется', () => {
        expect(
            parseRemarks(log, { file: 'parse.md', heading: ['Remarks'] }, path.join(root, 'x.md'))
        ).toEqual([]);
        fs.writeFileSync(log, '## Remarks\n\n| # | Q |\n|---|---|\n| 1 | Why? — «foo» (§ Flow) |\n');
        expect(
            parseRemarks(log, { file: 'parse.md', heading: ['Remarks'] }, path.join(root, 'x.md'))
        ).toEqual([{ number: 1, comment: 'Why?', quote: 'foo', section: 'Flow' }]);
    });
    it('нет раздела — пусто', () => {
        expect(parseRemarks(log, { file: 'parse.md', heading: ['Nope'] }, path.join(root, 'x.md'))).toEqual(
            []
        );
    });
});

describe('writeRemark', () => {
    const input = {
        comment: 'Why?',
        quote: 'foo',
        section: 'Flow',
        source: path.join(change, 'design.md'),
        author: 'Me'
    };
    it('строка таблицы по шаблону cells с номером', () => {
        const n = writeRemark(
            review,
            {
                file: 'review.md',
                heading: ['Remarks'],
                cells: ['', '{artifact} → {section}', '{text}', '{author}', '', '']
            },
            input
        );
        expect(n).toBe(1);
        expect(fs.readFileSync(review, 'utf8')).toBe(
            `${TABLE}| 1 | design → Flow | Why? — «foo» | Me |  |  |\n`
        );
    });
    it('без cells — как вопрос: текст во второй колонке', () => {
        expect(writeRemark(review, { file: 'review.md', heading: ['Remarks'] }, input)).toBe(2);
        expect(fs.readFileSync(review, 'utf8').trim().split('\n').pop()).toBe(
            '| 2 | Why? — «foo» (§ Flow) |  |  |  |  |'
        );
    });
    it('deleteRemark: по номеру и тексту любой ячейки; с cells — строка целиком', () => {
        // строка целиком: номер и текст не совпадают, но все ячейки — да
        expect(
            deleteRemark(review, ['Remarks'], { number: null, text: 'nope' }, [
                '2',
                '',
                'Why? — «foo» (§ Flow)',
                '',
                '',
                ''
            ])
        ).toEqual({
            error: 'not-found'
        });
        expect(
            deleteRemark(review, ['Remarks'], { number: null, text: 'nope' }, [
                '2',
                'Why? — «foo» (§ Flow)',
                '',
                '',
                '',
                ''
            ])
        ).toEqual({
            markdown: expect.any(String)
        });
        expect(fs.readFileSync(review, 'utf8')).not.toContain('| 2 | Why?');
        expect(deleteRemark(review, ['Nope', 'Remarks'], { number: 1, text: 'design → Flow' })).toEqual({
            markdown: expect.any(String)
        });
        expect(fs.readFileSync(review, 'utf8')).not.toContain('| 1 | design → Flow |');
        expect(deleteRemark(review, ['Nope', 'Remarks'], { number: 9, text: 'nope' })).toEqual({
            error: 'not-found'
        });
    });
    it('isReviewFile — тот файл, который нашёл бы поиск', () => {
        expect(isReviewFile(review, 'review.md', root)).toBe(true);
        expect(isReviewFile(path.join(change, 'design.md'), 'review.md', root)).toBe(false);
        // одноимённый файл не там, где его нашёл бы поиск от своего каталога, — не журнал
        fs.mkdirSync(path.join(root, 'notes'));
        fs.writeFileSync(path.join(root, 'notes', 'log.md'), '# x\n');
        fs.mkdirSync(path.join(root, 'review'));
        fs.writeFileSync(path.join(root, 'review', 'log.md'), '# log\n');
        expect(isReviewFile(path.join(root, 'review', 'log.md'), 'review/log.md', root)).toBe(true);
        expect(isReviewFile(path.join(root, 'notes', 'log.md'), 'review/log.md', root)).toBe(false);
    });
    it('несколько вариантов заголовка — пишется в тот, что есть в файле', () => {
        expect(writeRemark(review, { file: 'review.md', heading: ['Nope', 'Remarks'] }, input)).toBe(1);
        expect(fs.readFileSync(review, 'utf8')).not.toContain('## Nope');
        expect(deleteRemark(review, ['Nope'], { number: 1, text: 'x' })).toEqual({ error: 'not-found' });
    });
    it('нет раздела — создаётся первый из списка', () => {
        expect(
            writeRemark(review, { file: 'review.md', heading: ['Other', 'Nope'], cells: ['{text}'] }, input)
        ).toBeNull();
        expect(fs.readFileSync(review, 'utf8')).toContain('## Other\n\n- Why? — «foo» (§ Flow)\n');
    });
});
