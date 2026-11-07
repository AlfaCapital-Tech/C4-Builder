// Правка раздела исходного markdown по комментарию со страницы `site -w`: добавление и
// удаление строки. Пользуется журнал комментариев (ключ `comments`). Чистые функции + запись файла;
// формат раздела (таблица / список / его отсутствие) определяется по содержимому, чтобы не
// навязывать проектам одну форму таблицы.
import fs from 'node:fs';

export const QUOTE_MAX = 200;

export interface EntryInput {
    comment: string;
    quote?: string;
    section?: string;
}

export const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

// docsify рендерит HTML из markdown как есть: без экранирования цитата `List<String>` теряет
// `<String>` на странице, а `<img onerror>` из комментария становится скриптом и в dist.
export const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Цитата выделения: схлопнутые пробелы, не длиннее 200 символов (с многоточием). */
export const clipQuote = (quote: string | undefined): string => {
    const q = collapse(quote ?? '');
    return q.length > QUOTE_MAX ? `${q.slice(0, QUOTE_MAX - 1).trimEnd()}…` : q;
};

/** Текст записи: комментарий, цитата (до 200 символов) и раздел страницы, где сделано выделение. */
export const formatEntry = ({ comment, quote, section }: EntryInput): string => {
    const q = clipQuote(quote);
    const s = collapse(section ?? '');
    return escapeHtml(`${collapse(comment)}${q ? ` — «${q}»` : ''}${s ? ` (§ ${s})` : ''}`);
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
// (docsify отрисовал markdown, клиент прислал textContent). Применяется к обеим сторонам:
// сущности декодируются до срезания тегов, чтобы `&lt;T&gt;` из файла и `<T>` со страницы
// свелись к одному.
export const plain = (s: string): string =>
    collapse(
        s
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
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

/** Готовые ячейки строки либо их фабрика по номеру строки (номер известен только здесь). */
export type Cells = string[] | ((number: number | null) => string[]);

// Ячейки новой строки: заготовка `given` (пустые ячейки берут значения заглушки — например
// «Кому: Аналитик» из строки шаблона) либо текст в колонку текста; заглушки `...` очищаются.
const rowCells = (
    cells: Cells | undefined,
    text: string,
    cols: number,
    number: number | null,
    textCol: number,
    placeholder?: string[]
): string[] => {
    const keep = (c: number): string => {
        const v = placeholder?.[c] ?? '';
        return isPlaceholder(v) ? '' : v;
    };
    const given = typeof cells === 'function' ? cells(number) : cells;
    const out = Array.from({ length: cols }, (_, c) => {
        const v = given?.[c] ?? '';
        return v ? escapeCell(v) : keep(c);
    });
    if (number !== null) out[0] = String(number);
    if (!given) out[textCol] = escapeCell(text);
    return out;
};

/** Строка таблицы раздела: номер (числовая первая колонка) и ячейки как в файле. */
export interface TableRow {
    number: number | null;
    cells: string[];
}

/** Строки таблицы раздела `heading` (пустой список — нет раздела или таблицы). */
export const tableRows = (markdown: string, heading: string): TableRow[] => {
    const lines = markdown.split(/\r?\n/);
    const section = findSection(lines, heading);
    if (!section) return [];
    const table = findTable(lines, section.start, section.end);
    if (!table) return [];
    const rows: TableRow[] = [];
    for (let i = table.header + 2; i <= table.last; i++) {
        const cells = splitRow(lines[i]);
        rows.push({ number: table.numeric ? Number(cells[0]) : null, cells });
    }
    return rows;
};

/** Результат правки: новый текст и номер строки таблицы (null — список или таблица без номеров). */
export interface AppendResult {
    markdown: string;
    number: number | null;
}

/**
 * Дописывает запись в раздел `heading`: строкой таблицы (с номером, если первая колонка
 * числовая; заглушка `1 | ... | ...` заменяется), иначе пунктом списка в конце раздела;
 * нет раздела — создаёт его в конце файла. Перевод строки файла сохраняется.
 * `cells` — готовые ячейки строки таблицы (журнал ревью, change site-review-log) либо фабрика
 * по номеру строки; числовая первая колонка всё равно получает номер; для списка и
 * отсутствующего раздела используется `text`.
 */
export const appendRow = (markdown: string, heading: string, text: string, cells?: Cells): AppendResult => {
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
        // Единственная строка шаблона с `...` в ячейке текста — заглушка: заменяем её, сохраняя
        // заполненные ячейки (например, «Кому: Аналитик»), остальные `...` очищаем.
        const placeholder = rows.length === 1 && isPlaceholder(rows[0][textCol] ?? '');
        const number = numeric
            ? placeholder
                ? 1
                : rows.reduce((max, r) => Math.max(max, Number(r[0])), 0) + 1
            : null;
        const row = `| ${rowCells(cells, text, cols, number, textCol, placeholder ? rows[0] : undefined).join(' | ')} |`;
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
        return { markdown: lines.join(eol), number: null };
    }
    // Нумерованный список продолжаем его же маркером: `-` после `2.` начал бы второй список.
    const ordered = lines
        .slice(start + 1, lastText + 1)
        .reverse()
        .find((l) => /^([-*+]|\d+[.)])\s/.test(l))
        ?.match(/^(\d+)([.)])\s/);
    lines.splice(lastText + 1, 0, ordered ? `${Number(ordered[1]) + 1}${ordered[2]} ${text}` : `- ${text}`);
    return { markdown: lines.join(eol), number: null };
};

/** Какую запись удалять: номер (строка числовой таблицы) и текст, как он виден на странице. */
export interface RowRef {
    number?: number | null;
    text: string;
}

export type RemoveResult = { markdown: string } | { error: 'not-found' | 'ambiguous' };

/**
 * `anyCell` — текст ищется в любой ячейке строки (журнал ревью: колонка текста задана шаблоном);
 * `cells` — все ячейки строки, как их видит страница: совпасть должна строка целиком (таблицы
 * без номеров, где одна ячейка повторяется у нескольких строк).
 */
export interface RemoveOptions {
    anyCell?: boolean;
    cells?: string[];
}

/**
 * Удаляет запись из раздела `heading`: строку таблицы (по номеру и тексту; без совпадения
 * номера — только по тексту) или пункт списка по тексту. Текст сравнивается без inline-разметки.
 * Номера остальных строк не меняются — на них ссылаются другие документы.
 */
export const removeRow = (
    markdown: string,
    heading: string,
    ref: RowRef,
    { anyCell = false, cells }: RemoveOptions = {}
): RemoveResult => {
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
        const wantCells = cells?.map(plain);
        const byText = rows.filter((r) =>
            wantCells
                ? wantCells.length === r.cells.length && wantCells.every((c, i) => plain(r.cells[i]) === c)
                : anyCell
                  ? r.cells.some((c) => plain(c) === want)
                  : plain(r.cells[textCol] ?? '') === want
        );
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

/** Есть ли в тексте раздел с таким заголовком (любой уровень, без учёта регистра). */
export const markdownHasHeading = (markdown: string, heading: string): boolean =>
    markdown.split(/\r?\n/).some((l) => headingLevel(l, heading) > 0);

/** Дописывает запись (или строку `cells`) в файл и возвращает номер строки таблицы (null — список). */
export const writeRow = (file: string, heading: string, text: string, cells?: Cells): number | null => {
    const { markdown, number } = appendRow(fs.readFileSync(file, 'utf8'), heading, text, cells);
    fs.writeFileSync(file, markdown);
    return number;
};

/** Удаляет запись из файла; ошибка поиска возвращается, не бросается. */
export const deleteRow = (
    file: string,
    heading: string,
    ref: RowRef,
    options?: RemoveOptions
): RemoveResult => {
    const result = removeRow(fs.readFileSync(file, 'utf8'), heading, ref, options);
    if ('markdown' in result) fs.writeFileSync(file, result.markdown);
    return result;
};
