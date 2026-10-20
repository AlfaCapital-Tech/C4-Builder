// Правка раздела вопросов исходного markdown по комментарию со страницы `site -w`
// (см. change site-comments, design D4): добавление и удаление. Чистые функции + запись
// файла; формат раздела (таблица / список / его отсутствие) определяется по содержимому,
// чтобы не навязывать проектам одну форму таблицы.
import fs from 'node:fs';

const QUOTE_MAX = 200;

export interface QuestionInput {
    comment: string;
    quote?: string;
    section?: string;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Текст вопроса: комментарий, цитата (до 200 символов) и раздел страницы, где сделано выделение. */
export const formatQuestion = ({ comment, quote, section }: QuestionInput): string => {
    let q = collapse(quote ?? '');
    if (q.length > QUOTE_MAX) q = `${q.slice(0, QUOTE_MAX - 1).trimEnd()}…`;
    const s = collapse(section ?? '');
    return `${collapse(comment)}${q ? ` — «${q}»` : ''}${s ? ` (§ ${s})` : ''}`;
};

// Заголовок раздела: любой уровень, без учёта регистра и лишних пробелов, с необязательными
// закрывающими `#`.
const headingLevel = (line: string, heading: string): number => {
    const m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!m) return 0;
    return collapse(m[2]).toLowerCase() === collapse(heading).toLowerCase() ? m[1].length : 0;
};

const isFence = (line: string): boolean => /^\s*(```|~~~)/.test(line);
const isRow = (line: string): boolean => line.trim().startsWith('|');
const isSeparator = (line: string): boolean => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
const isListItem = (line: string): boolean => /^\s*([-*+]|\d+[.)])\s+/.test(line);
const splitRow = (line: string): string[] =>
    line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split(/(?<!\\)\|/)
        .map((c) => c.trim());
const isPlaceholder = (cell: string): boolean => /^(\.{3}|…|)$/.test(cell);
const escapeCell = (s: string): string => s.replace(/\|/g, '\\|');

// Текст ячейки/пункта без inline-разметки — для сравнения с тем, что видно на странице
// (docsify отрисовал markdown, клиент прислал textContent).
const plain = (s: string): string =>
    collapse(
        s
            .replace(/\\\|/g, '|')
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/<[^>]+>/g, '')
            .replace(/[`*_~]/g, '')
    );

/** Границы раздела: строка заголовка и индекс первой строки за разделом. */
const findSection = (lines: string[], heading: string): { start: number; end: number } | undefined => {
    let start = -1;
    let level = 0;
    let fenced = false;
    for (const [i, line] of lines.entries()) {
        if (isFence(line)) fenced = !fenced;
        if (fenced) continue;
        level = headingLevel(line, heading);
        if (level) {
            start = i;
            break;
        }
    }
    if (start < 0) return undefined;
    let end = lines.length;
    fenced = false;
    for (let i = start + 1; i < lines.length; i++) {
        if (isFence(lines[i])) fenced = !fenced;
        if (fenced) continue;
        const m = lines[i].match(/^(#{1,6})\s/);
        if (m && m[1].length <= level) {
            end = i;
            break;
        }
    }
    return { start, end };
};

/** Таблица раздела: строка заголовка, последняя строка данных, числовая ли первая колонка. */
interface Table {
    header: number;
    last: number;
    cols: number;
    numeric: boolean;
    textCol: number;
}

const findTable = (lines: string[], start: number, end: number): Table | undefined => {
    for (let i = start + 1; i + 1 < end; i++) {
        if (!isRow(lines[i]) || !isSeparator(lines[i + 1])) continue;
        let last = i + 1;
        while (last + 1 < end && isRow(lines[last + 1])) last++;
        const cols = splitRow(lines[i]).length;
        const rows = lines.slice(i + 2, last + 1).map(splitRow);
        // Числовая первая колонка: по данным, а у пустой таблицы — по заголовку (`#`, `№`, `No`).
        const numeric = rows.length
            ? rows.every((r) => /^\d+$/.test(r[0] ?? ''))
            : /^(#|№|no\.?)$/i.test(splitRow(lines[i])[0] ?? '');
        return { header: i, last, cols, numeric, textCol: numeric ? Math.min(1, cols - 1) : 0 };
    }
    return undefined;
};

/** Результат правки: новый текст и номер строки таблицы (null — список или таблица без номеров). */
export interface AppendResult {
    markdown: string;
    number: number | null;
}

/**
 * Дописывает вопрос в раздел `heading`: строкой таблицы (с номером, если первая колонка
 * числовая; заглушка `1 | ... | ...` заменяется), иначе пунктом списка в конце раздела;
 * нет раздела — создаёт его в конце файла. Перевод строки файла сохраняется.
 */
export const appendQuestion = (markdown: string, heading: string, text: string): AppendResult => {
    const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
    const lines = markdown.split(/\r?\n/);

    const section = findSection(lines, heading);
    if (!section) {
        while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
        lines.push('', `## ${heading}`, '', `- ${text}`, '');
        return { markdown: lines.join(eol), number: null };
    }
    const { start, end } = section;

    const table = findTable(lines, start, end);
    if (table) {
        const { header, last, cols, numeric, textCol } = table;
        const rows = lines.slice(header + 2, last + 1).map(splitRow);
        // Единственная строка шаблона с `...` в ячейке вопроса — заглушка: заменяем её, сохраняя
        // заполненные ячейки (например, «Кому: Аналитик»), остальные `...` очищаем.
        const placeholder = rows.length === 1 && isPlaceholder(rows[0][textCol] ?? '');
        const number = numeric
            ? placeholder
                ? 1
                : rows.reduce((max, r) => Math.max(max, Number(r[0])), 0) + 1
            : null;
        const cells: string[] = placeholder
            ? Array.from({ length: cols }, (_, c) =>
                  isPlaceholder(rows[0][c] ?? '') ? '' : (rows[0][c] ?? '')
              )
            : new Array(cols).fill('');
        if (number !== null) cells[0] = String(number);
        cells[textCol] = escapeCell(text);
        const row = `| ${cells.join(' | ')} |`;
        if (placeholder) lines.splice(last, 1, row);
        else lines.splice(last + 1, 0, row);
        return { markdown: lines.join(eol), number };
    }

    let lastText = end - 1;
    while (lastText > start && lines[lastText].trim() === '') lastText--;
    if (lastText === start) {
        // Пустой раздел: пункт через пустую строку после заголовка; перед следующим
        // заголовком — тоже пустая строка.
        const insert = ['', `- ${text}`];
        if (start + 1 < lines.length && lines[start + 1].trim() !== '') insert.push('');
        lines.splice(start + 1, 0, ...insert);
    } else lines.splice(lastText + 1, 0, `- ${text}`);
    return { markdown: lines.join(eol), number: null };
};

/** Какой вопрос удалять: номер (строка числовой таблицы) и текст, как он виден на странице. */
export interface QuestionRef {
    number?: number | null;
    text: string;
}

export type RemoveResult = { markdown: string } | { error: 'not-found' | 'ambiguous' };

/**
 * Удаляет вопрос из раздела `heading`: строку таблицы (по номеру и тексту; без совпадения
 * номера — только по тексту) или пункт списка по тексту. Текст сравнивается без inline-разметки.
 * Номера остальных строк не меняются — на них ссылаются другие документы.
 */
export const removeQuestion = (markdown: string, heading: string, ref: QuestionRef): RemoveResult => {
    const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
    const lines = markdown.split(/\r?\n/);
    const section = findSection(lines, heading);
    if (!section) return { error: 'not-found' };
    const { start, end } = section;
    const want = plain(ref.text);

    const table = findTable(lines, start, end);
    let candidates: number[] = [];
    if (table) {
        const { header, last, numeric, textCol } = table;
        const rows: { line: number; cells: string[] }[] = [];
        for (let i = header + 2; i <= last; i++) rows.push({ line: i, cells: splitRow(lines[i]) });
        const byText = rows.filter((r) => plain(r.cells[textCol] ?? '') === want);
        const byNumber =
            numeric && ref.number != null ? byText.filter((r) => Number(r.cells[0]) === ref.number) : [];
        candidates = (byNumber.length ? byNumber : byText).map((r) => r.line);
    } else {
        for (let i = start + 1; i < end; i++)
            if (isListItem(lines[i]) && plain(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')) === want)
                candidates.push(i);
    }
    if (!candidates.length) return { error: 'not-found' };
    if (candidates.length > 1) return { error: 'ambiguous' };
    lines.splice(candidates[0], 1);
    return { markdown: lines.join(eol) };
};

const hasHeading = (file: string, heading: string): boolean => {
    try {
        return fs
            .readFileSync(file, 'utf8')
            .split(/\r?\n/)
            .some((l) => headingLevel(l, heading) > 0);
    } catch {
        return false;
    }
};

/** Файл страницы для записи: первый с разделом `heading`, иначе первый существующий. */
export const pickSource = (files: string[], heading: string): string | undefined => {
    const existing = files.filter((f) => fs.existsSync(f));
    return existing.find((f) => hasHeading(f, heading)) ?? existing[0];
};

/** Дописывает вопрос в файл и возвращает номер строки таблицы (null — список). */
export const writeQuestion = (file: string, heading: string, text: string): number | null => {
    const { markdown, number } = appendQuestion(fs.readFileSync(file, 'utf8'), heading, text);
    fs.writeFileSync(file, markdown);
    return number;
};

/** Удаляет вопрос из файла; ошибка поиска возвращается, не бросается. */
export const deleteQuestion = (file: string, heading: string, ref: QuestionRef): RemoveResult => {
    const result = removeQuestion(fs.readFileSync(file, 'utf8'), heading, ref);
    if ('markdown' in result) fs.writeFileSync(file, result.markdown);
    return result;
};
