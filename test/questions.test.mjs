import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { TMP_ROOT } from './helpers.mjs';
import { appendQuestion, formatQuestion, pickSource, removeQuestion } from './dist.mjs';

// Правка раздела вопросов (change site-comments, design D4): форма раздела определяется по
// содержимому — таблица с номерами / без, список, проза, пустой раздел, раздела нет.
const H = 'Open questions';

describe('formatQuestion', () => {
    it('комментарий, цитата и раздел', () => {
        expect(formatQuestion({ comment: ' Why? ', quote: 'foo\n  bar', section: 'Flow' })).toBe(
            'Why? — «foo bar» (§ Flow)'
        );
    });
    it('без цитаты и раздела — только комментарий', () => {
        expect(formatQuestion({ comment: 'Why?' })).toBe('Why?');
    });
    it('цитата режется до 200 символов с многоточием', () => {
        const text = formatQuestion({ comment: 'q', quote: 'x'.repeat(300) });
        expect(text).toBe(`q — «${'x'.repeat(199)}…»`);
    });
});

describe('appendQuestion: таблица', () => {
    it('числовая первая колонка → следующий номер, текст во второй, остальные пустые', () => {
        const md = `# Doc\n\n## ${H}\n\n| # | Question | Owner |\n|---|----------|-------|\n| 1 | a | x |\n| 2 | b | y |\n\nTail.\n\n## Links\n`;
        const { markdown, number } = appendQuestion(md, H, 'Why?');
        expect(number).toBe(3);
        expect(markdown).toBe(
            `# Doc\n\n## ${H}\n\n| # | Question | Owner |\n|---|----------|-------|\n| 1 | a | x |\n| 2 | b | y |\n| 3 | Why? |  |\n\nTail.\n\n## Links\n`
        );
    });
    it('строка-заглушка шаблона заменяется первым вопросом', () => {
        const md = `## ${H}\n\n| № | Вопрос | Раздел | Кому |\n|---|---|---|---|\n| 1 | ... | ... | Аналитик |\n`;
        const { markdown, number } = appendQuestion(md, H, 'Why?');
        expect(number).toBe(1);
        expect(markdown).toBe(
            `## ${H}\n\n| № | Вопрос | Раздел | Кому |\n|---|---|---|---|\n| 1 | Why? |  | Аналитик |\n`
        );
    });
    it('пустая таблица с заголовком № — номер 1', () => {
        const md = `## ${H}\n\n| № | Вопрос |\n|---|---|\n`;
        expect(appendQuestion(md, H, 'Why?')).toEqual({
            markdown: `## ${H}\n\n| № | Вопрос |\n|---|---|\n| 1 | Why? |\n`,
            number: 1
        });
    });
    it('первая колонка не числовая → текст в первую, номера нет', () => {
        const md = `## ${H}\n\n| Question | Owner |\n|---|---|\n| a | x |\n`;
        expect(appendQuestion(md, H, 'Why?')).toEqual({
            markdown: `## ${H}\n\n| Question | Owner |\n|---|---|\n| a | x |\n| Why? |  |\n`,
            number: null
        });
    });
    it('| в тексте экранируется', () => {
        const md = `## ${H}\n\n| # | Q |\n|---|---|\n| 1 | a |\n`;
        expect(appendQuestion(md, H, 'a | b').markdown).toContain('| 2 | a \\| b |');
    });
});

describe('appendQuestion: список, проза, нет раздела', () => {
    it('список — пункт после последнего, хвост раздела остаётся', () => {
        const md = `## ${H}\n\n- a\n- b\n\n## Next\n\ntext\n`;
        expect(appendQuestion(md, H, 'Why?').markdown).toBe(
            `## ${H}\n\n- a\n- b\n- Why?\n\n## Next\n\ntext\n`
        );
    });
    it('проза — пункт после неё', () => {
        const md = `## ${H}\n\nNone.\n`;
        expect(appendQuestion(md, H, 'Why?').markdown).toBe(`## ${H}\n\nNone.\n- Why?\n`);
    });
    it('пустой раздел перед следующим заголовком', () => {
        const md = `## ${H}\n\n## Next\n`;
        expect(appendQuestion(md, H, 'Why?').markdown).toBe(`## ${H}\n\n- Why?\n\n## Next\n`);
    });
    it('раздела нет — создаётся в конце файла', () => {
        expect(appendQuestion('# Doc\n\ntext\n\n\n', H, 'Why?')).toEqual({
            markdown: `# Doc\n\ntext\n\n## ${H}\n\n- Why?\n`,
            number: null
        });
    });
    it('заголовок другого уровня и регистра, CRLF сохраняется', () => {
        const md = `# Doc\r\n\r\n### OPEN QUESTIONS\r\n\r\n- a\r\n\r\n## Next\r\n`;
        expect(appendQuestion(md, H, 'Why?').markdown).toBe(
            `# Doc\r\n\r\n### OPEN QUESTIONS\r\n\r\n- a\r\n- Why?\r\n\r\n## Next\r\n`
        );
    });
    it('заголовок внутри кода не считается разделом', () => {
        const md = `\`\`\`md\n## ${H}\n\`\`\`\n`;
        expect(appendQuestion(md, H, 'Why?').markdown).toBe(
            `\`\`\`md\n## ${H}\n\`\`\`\n\n## ${H}\n\n- Why?\n`
        );
    });
});

describe('pickSource', () => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'questions-'));
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
    const a = path.join(dir, 'a.md');
    const b = path.join(dir, 'b.md');
    fs.writeFileSync(a, '# A\n');
    fs.writeFileSync(b, `# B\n\n## ${H}\n`);
    it('первый файл с разделом', () => expect(pickSource([a, b], H)).toBe(b));
    it('без раздела — первый существующий', () =>
        expect(pickSource([path.join(dir, 'missing.md'), a], 'Other')).toBe(a));
    it('ничего нет — undefined', () => expect(pickSource([path.join(dir, 'missing.md')], H)).toBeUndefined());
});

describe('removeQuestion', () => {
    const table = `## ${H}\n\n| # | Q | Owner |\n|---|---|---|\n| 1 | a \\| b | x |\n| 2 | **Why?** — «foo» (§ Flow) | y |\n| 3 | Why? — «foo» (§ Flow) | z |\n\nTail.\n`;
    it('числовая таблица — по номеру и тексту, номера остальных не меняются', () => {
        expect(removeQuestion(table, H, { number: 2, text: 'Why? — «foo» (§ Flow)' })).toEqual({
            markdown: `## ${H}\n\n| # | Q | Owner |\n|---|---|---|\n| 1 | a \\| b | x |\n| 3 | Why? — «foo» (§ Flow) | z |\n\nTail.\n`
        });
    });
    it('экранированный | сравнивается с текстом страницы', () => {
        expect(removeQuestion(table, H, { number: 1, text: 'a | b' }).markdown).not.toContain('a \\| b');
    });
    it('одинаковый текст без номера — ambiguous; чужой текст — not-found', () => {
        expect(removeQuestion(table, H, { text: 'Why? — «foo» (§ Flow)' })).toEqual({ error: 'ambiguous' });
        expect(removeQuestion(table, H, { number: 9, text: 'nope' })).toEqual({ error: 'not-found' });
        expect(removeQuestion('# Doc\n', H, { text: 'x' })).toEqual({ error: 'not-found' });
    });
    it('список — по тексту', () => {
        const md = `## ${H}\n\n- a\n- b — «q»\n- c\n`;
        expect(removeQuestion(md, H, { number: 2, text: 'b — «q»' })).toEqual({
            markdown: `## ${H}\n\n- a\n- c\n`
        });
    });
});
