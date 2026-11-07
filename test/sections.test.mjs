import { describe, expect, it } from 'vitest';

import { appendRow, formatEntry, removeRow } from './dist.mjs';

// Движок строк раздела (журнал ревью; раньше и вопросы — change site-comments, design D4): форма
// раздела определяется по содержимому — таблица с номерами / без, список, проза, пустой раздел,
// раздела нет.
const H = 'Remarks';

describe('formatEntry', () => {
    it('комментарий, цитата и раздел', () => {
        expect(formatEntry({ comment: ' Why? ', quote: 'foo\n  bar', section: 'Flow' })).toBe(
            'Why? — «foo bar» (§ Flow)'
        );
    });
    it('без цитаты и раздела — только комментарий', () => {
        expect(formatEntry({ comment: 'Why?' })).toBe('Why?');
    });
    it('цитата режется до 200 символов с многоточием', () => {
        const text = formatEntry({ comment: 'q', quote: 'x'.repeat(300) });
        expect(text).toBe(`q — «${'x'.repeat(199)}…»`);
    });
    it('HTML экранируется: docsify отрисовал бы теги из комментария и цитаты', () => {
        expect(formatEntry({ comment: '<img onerror=x> & co', quote: 'List<String>' })).toBe(
            '&lt;img onerror=x&gt; &amp; co — «List&lt;String&gt;»'
        );
    });
});

describe('appendRow: таблица', () => {
    it('числовая первая колонка → следующий номер, текст во второй, остальные пустые', () => {
        const md = `# Doc\n\n## ${H}\n\n| # | Question | Owner |\n|---|----------|-------|\n| 1 | a | x |\n| 2 | b | y |\n\nTail.\n\n## Links\n`;
        const { markdown, number } = appendRow(md, H, 'Why?');
        expect(number).toBe(3);
        expect(markdown).toBe(
            `# Doc\n\n## ${H}\n\n| # | Question | Owner |\n|---|----------|-------|\n| 1 | a | x |\n| 2 | b | y |\n| 3 | Why? |  |\n\nTail.\n\n## Links\n`
        );
    });
    it('строка-заглушка шаблона заменяется первым вопросом', () => {
        const md = `## ${H}\n\n| № | Вопрос | Раздел | Кому |\n|---|---|---|---|\n| 1 | ... | ... | Аналитик |\n`;
        const { markdown, number } = appendRow(md, H, 'Why?');
        expect(number).toBe(1);
        expect(markdown).toBe(
            `## ${H}\n\n| № | Вопрос | Раздел | Кому |\n|---|---|---|---|\n| 1 | Why? |  | Аналитик |\n`
        );
    });
    it('пустая таблица с заголовком № — номер 1', () => {
        const md = `## ${H}\n\n| № | Вопрос |\n|---|---|\n`;
        expect(appendRow(md, H, 'Why?')).toEqual({
            markdown: `## ${H}\n\n| № | Вопрос |\n|---|---|\n| 1 | Why? |\n`,
            number: 1
        });
    });
    it('первая колонка не числовая → текст в первую, номера нет', () => {
        const md = `## ${H}\n\n| Question | Owner |\n|---|---|\n| a | x |\n`;
        expect(appendRow(md, H, 'Why?')).toEqual({
            markdown: `## ${H}\n\n| Question | Owner |\n|---|---|\n| a | x |\n| Why? |  |\n`,
            number: null
        });
    });
    it('| в тексте экранируется', () => {
        const md = `## ${H}\n\n| # | Q |\n|---|---|\n| 1 | a |\n`;
        expect(appendRow(md, H, 'a | b').markdown).toContain('| 2 | a \\| b |');
    });
});

describe('appendRow: готовые ячейки', () => {
    const T = `| # | Where | What | Who | Status |\n|---|---|---|---|---|\n`;
    it('числовая таблица: номер в первой колонке, ячейки от фабрики по номеру', () => {
        const md = `## ${H}\n\n${T}| 1 | a | b | c | d |\n`;
        const { markdown, number } = appendRow(md, H, 'ignored', (n) => [
            '',
            'design → Flow',
            `Why? #${n}`,
            'Me'
        ]);
        expect(number).toBe(2);
        expect(markdown).toBe(
            `## ${H}\n\n${T}| 1 | a | b | c | d |\n| 2 | design → Flow | Why? #2 | Me |  |\n`
        );
    });
    it('заглушка `...` заменяется: пустые ячейки шаблона берут заполненные ячейки заглушки', () => {
        const md = `## ${H}\n\n${T}| 1 | ... | ... | ... | Open |\n`;
        const { markdown, number } = appendRow(md, H, 'ignored', ['', 'spec', 'Why?', 'Me', '']);
        expect(number).toBe(1);
        expect(markdown).toBe(`## ${H}\n\n${T}| 1 | spec | Why? | Me | Open |\n`);
    });
    it('таблица без номеров: фабрика получает null, `|` в ячейке экранируется', () => {
        const md = `## ${H}\n\n| Where | What |\n|---|---|\n`;
        const { markdown, number } = appendRow(md, H, 'ignored', (n) => [`a${n ?? ''}`, 'x | y']);
        expect(number).toBeNull();
        expect(markdown).toBe(`## ${H}\n\n| Where | What |\n|---|---|\n| a | x \\| y |\n`);
    });
    it('список и отсутствие раздела — текст, а не ячейки', () => {
        expect(appendRow(`## ${H}\n\n- a\n`, H, 'Why?', ['x', 'y']).markdown).toBe(
            `## ${H}\n\n- a\n- Why?\n`
        );
        expect(appendRow('# Doc\n', H, 'Why?', ['x']).markdown).toBe(`# Doc\n\n## ${H}\n\n- Why?\n`);
    });
});

describe('appendRow: список, проза, нет раздела', () => {
    it('список — пункт после последнего, хвост раздела остаётся', () => {
        const md = `## ${H}\n\n- a\n- b\n\n## Next\n\ntext\n`;
        expect(appendRow(md, H, 'Why?').markdown).toBe(`## ${H}\n\n- a\n- b\n- Why?\n\n## Next\n\ntext\n`);
    });
    it('нумерованный список продолжается своим маркером', () => {
        const md = `## ${H}\n\n1) a\n2) b\n   continued\n`;
        expect(appendRow(md, H, 'Why?').markdown).toBe(`## ${H}\n\n1) a\n2) b\n   continued\n3) Why?\n`);
    });
    it('проза — пункт после неё', () => {
        const md = `## ${H}\n\nNone.\n`;
        expect(appendRow(md, H, 'Why?').markdown).toBe(`## ${H}\n\nNone.\n- Why?\n`);
    });
    it('пустой раздел перед следующим заголовком', () => {
        const md = `## ${H}\n\n## Next\n`;
        expect(appendRow(md, H, 'Why?').markdown).toBe(`## ${H}\n\n- Why?\n\n## Next\n`);
    });
    it('раздела нет — создаётся в конце файла', () => {
        expect(appendRow('# Doc\n\ntext\n\n\n', H, 'Why?')).toEqual({
            markdown: `# Doc\n\ntext\n\n## ${H}\n\n- Why?\n`,
            number: null
        });
    });
    it('заголовок другого уровня и регистра, CRLF сохраняется', () => {
        const md = `# Doc\r\n\r\n### REMARKS\r\n\r\n- a\r\n\r\n## Next\r\n`;
        expect(appendRow(md, H, 'Why?').markdown).toBe(
            `# Doc\r\n\r\n### REMARKS\r\n\r\n- a\r\n- Why?\r\n\r\n## Next\r\n`
        );
    });
    it('заголовок внутри кода не считается разделом', () => {
        const md = `\`\`\`md\n## ${H}\n\`\`\`\n`;
        expect(appendRow(md, H, 'Why?').markdown).toBe(`\`\`\`md\n## ${H}\n\`\`\`\n\n## ${H}\n\n- Why?\n`);
    });
});

describe('removeRow: cells', () => {
    const md = `## ${H}\n\n| Status | Where | What |\n|---|---|---|\n| open | design → Flow | a |\n| open | design → Flow | b |\n`;
    it('строка целиком: общая ячейка у двух строк не мешает', () => {
        expect(removeRow(md, H, { number: null, text: 'design → Flow' }, { anyCell: true })).toEqual({
            error: 'ambiguous'
        });
        expect(
            removeRow(
                md,
                H,
                { number: null, text: 'design → Flow' },
                { anyCell: true, cells: ['open', 'design → Flow', 'b'] }
            )
        ).toEqual({
            markdown: `## ${H}\n\n| Status | Where | What |\n|---|---|---|\n| open | design → Flow | a |\n`
        });
        expect(removeRow(md, H, { number: null, text: 'x' }, { cells: ['open', 'design → Flow'] })).toEqual({
            error: 'not-found'
        });
    });
});

describe('removeRow: anyCell', () => {
    const md = `## ${H}\n\n| # | Where | What |\n|---|---|---|\n| 1 | design | a |\n| 2 | design | b |\n`;
    it('текст ищется в любой ячейке, номер выбирает строку', () => {
        expect(removeRow(md, H, { number: 2, text: 'design' }, { anyCell: true })).toEqual({
            markdown: `## ${H}\n\n| # | Where | What |\n|---|---|---|\n| 1 | design | a |\n`
        });
        expect(removeRow(md, H, { number: null, text: 'b' }, { anyCell: true })).toEqual({
            markdown: `## ${H}\n\n| # | Where | What |\n|---|---|---|\n| 1 | design | a |\n`
        });
    });
    it('без номера одинаковый текст в двух строках — ambiguous; без anyCell чужая колонка — not-found', () => {
        expect(removeRow(md, H, { number: null, text: 'design' }, { anyCell: true })).toEqual({
            error: 'ambiguous'
        });
        expect(removeRow(md, H, { number: 1, text: 'a' })).toEqual({ error: 'not-found' });
    });
});

describe('removeRow', () => {
    const table = `## ${H}\n\n| # | Q | Owner |\n|---|---|---|\n| 1 | a \\| b | x |\n| 2 | **Why?** — «foo» (§ Flow) | y |\n| 3 | Why? — «foo» (§ Flow) | z |\n\nTail.\n`;
    it('числовая таблица — по номеру и тексту, номера остальных не меняются', () => {
        expect(removeRow(table, H, { number: 2, text: 'Why? — «foo» (§ Flow)' })).toEqual({
            markdown: `## ${H}\n\n| # | Q | Owner |\n|---|---|---|\n| 1 | a \\| b | x |\n| 3 | Why? — «foo» (§ Flow) | z |\n\nTail.\n`
        });
    });
    it('экранированный | сравнивается с текстом страницы', () => {
        expect(removeRow(table, H, { number: 1, text: 'a | b' }).markdown).not.toContain('a \\| b');
    });
    it('сущности из файла сравниваются с декодированным текстом страницы', () => {
        const md = `## ${H}\n\n- why — «List&lt;String&gt; &amp; co»\n- c\n`;
        expect(removeRow(md, H, { text: 'why — «List<String> & co»' })).toEqual({
            markdown: `## ${H}\n\n- c\n`
        });
    });
    it('одинаковый текст без номера — ambiguous; чужой текст — not-found', () => {
        expect(removeRow(table, H, { text: 'Why? — «foo» (§ Flow)' })).toEqual({ error: 'ambiguous' });
        expect(removeRow(table, H, { number: 9, text: 'nope' })).toEqual({ error: 'not-found' });
        expect(removeRow('# Doc\n', H, { text: 'x' })).toEqual({ error: 'not-found' });
    });
    it('список — по тексту', () => {
        const md = `## ${H}\n\n- a\n- b — «q»\n- c\n`;
        expect(removeRow(md, H, { number: 2, text: 'b — «q»' })).toEqual({
            markdown: `## ${H}\n\n- a\n- c\n`
        });
    });
});
