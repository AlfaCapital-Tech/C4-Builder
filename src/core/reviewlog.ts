// Замечание со страницы `site -w` в журнал ревью (change site-review-log): строка таблицы
// раздела `heading` файла `file`, который лежит рядом с исходником страницы или выше по дереву
// (у OpenSpec — `review.md` в каталоге change'а, страницы дельт — на два уровня ниже). Состав
// ячеек задаёт проект шаблоном `cells`; без него — строка `formatEntry` (текст, цитата, раздел).
import fs from 'node:fs';
import path from 'node:path';

import { escapeRegExp } from '../util/text.ts';
import {
    clipQuote,
    collapse,
    deleteRow,
    escapeHtml,
    formatEntry,
    markdownHasHeading,
    plain,
    type RowRef,
    type RemoveResult,
    tableRows,
    writeRow
} from './sections.ts';

/** Ключ `comments` (прежде `reviewLog`) в `.c4builder`; нет ключа — кнопки на странице нет. */
export interface ReviewLogOptions {
    file: string;
    /** Варианты заголовка раздела: первый найденный в файле, иначе создаётся первый. */
    heading: string[];
    cells?: string[];
    author?: string;
    label?: string;
}

export interface RemarkInput {
    comment: string;
    quote?: string;
    section?: string;
    /** Исходник страницы (абсолютный путь) — для `{artifact}` и `{page}`. */
    source: string;
    author: string;
    date?: string;
}

// Каталог с таким именем — не журнал: поиск идёт дальше вверх.
const isFile = (p: string): boolean => {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
};

/**
 * Файл журнала: ближайший `file` от каталога исходника страницы вверх до `root` включительно.
 * Пути вне `root` не рассматриваются — `..` в `file` не выведет за проект.
 */
export const findReviewFile = (fromDir: string, file: string, root: string): string | undefined => {
    const top = path.resolve(root);
    let dir = path.resolve(fromDir);
    if (dir !== top && !dir.startsWith(top + path.sep)) return undefined;
    for (;;) {
        const candidate = path.resolve(dir, file);
        if ((candidate === top || candidate.startsWith(top + path.sep)) && isFile(candidate))
            return candidate;
        if (dir === top) return undefined;
        dir = path.dirname(dir);
    }
};

// Локальная дата ревьюера: UTC в ночные часы даёт вчерашнее число.
const today = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// `{artifact}`: имя исходника без расширения; у страницы-папки (README.md) — имя папки, иначе у
// обычного сайта все строки звались бы `README`.
const artifactName = (source: string): string => {
    const base = path.basename(source).replace(/\.[^.]+$/, '');
    return /^readme$/i.test(base) ? path.basename(path.dirname(source)) : base;
};

/**
 * Значения подстановок шаблона `cells`: `{comment}`, `{quote}` (до 200 символов), `{text}`
 * (комментарий с цитатой), `{section}`, `{artifact}` (имя исходника без расширения; у README.md —
 * имя папки), `{page}` (исходник относительно каталога журнала), `{author}`, `{date}` (ГГГГ-ММ-ДД,
 * локальная). HTML экранирован: docsify отрисовал бы теги из комментария. `{number}` подставляет
 * запись строки.
 */
export const remarkVars = (input: RemarkInput, reviewFile: string): Record<string, string> => {
    const quote = clipQuote(input.quote);
    const comment = collapse(input.comment);
    return {
        comment: escapeHtml(comment),
        quote: escapeHtml(quote),
        text: escapeHtml(quote ? `${comment} — «${quote}»` : comment),
        section: escapeHtml(collapse(input.section ?? '')),
        artifact: artifactName(input.source),
        page: path.relative(path.dirname(reviewFile), input.source).split(path.sep).join('/'),
        author: escapeHtml(collapse(input.author)),
        date: input.date ?? today()
    };
};

/** Подстановка `{key}` в ячейки шаблона; неизвестные ключи остаются как есть. */
export const fillCells = (template: string[], vars: Record<string, string>): string[] =>
    template.map((cell) => cell.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m)));

/** Раздел журнала в тексте: первый из вариантов, который там есть; нет ни одного — undefined. */
export const findHeading = (markdown: string, headings: string[]): string | undefined =>
    headings.find((h) => markdownHasHeading(markdown, h));

const readLog = (reviewFile: string): string => fs.readFileSync(reviewFile, 'utf8');

/** Замечание журнала для подсветки на странице: номер строки, комментарий, цитата, раздел. */
export interface RemarkRef {
    number: number | null;
    comment: string;
    quote: string;
    section: string;
}

// Регэксп из ячейки шаблона: литералы как есть, подстановки — именованные группы (повтор имени —
// безымянная группа, RegExp не падает). Пробелы по краям литерала необязательны: ячейки в файле
// обрезаны, и `design →` с пустым разделом тоже должен совпасть. Ячейки без подстановок о странице
// и цитате (номер, автор, дата, литералы вроде статуса — их правят руками) строку не ограничивают.
const USEFUL = /\{(artifact|page|quote|text|section|comment)\}/;
const cellPattern = (template: string): RegExp | null => {
    if (!USEFUL.test(template)) return null;
    const seen = new Set<string>();
    const body = template
        .split(/(\{\w+\})/)
        .map((part) => {
            const m = part.match(/^\{(\w+)\}$/);
            if (!m)
                return (
                    escapeRegExp(part.trim()).replace(/^/, part.match(/^\s/) ? '\\s*' : '') +
                    (part.match(/\s$/) ? '\\s*' : '')
                );
            if (seen.has(m[1])) return '[\\s\\S]*?';
            seen.add(m[1]);
            return `(?<${m[1]}>[\\s\\S]*?)`;
        })
        .join('');
    return new RegExp(`^${body}$`);
};

// «комментарий — «цитата»» (хвост `(§ раздел)` — у строк без шаблона, `formatEntry`).
const splitText = (text: string): { comment: string; quote: string; section: string } => {
    const m = text.match(/^([\s\S]*?) — «([\s\S]*)»(?: \(§ (.*)\))?$/);
    return m
        ? { comment: m[1], quote: m[2], section: m[3] ?? '' }
        : { comment: text, quote: '', section: '' };
};

/**
 * Замечания журнала, сделанные со страницы `source`: строки таблицы раздела разбираются по
 * шаблону `cells` (ячейка с `{artifact}`/`{page}` отбирает строки этой страницы; без таких
 * подстановок берутся все), цитата — из `{quote}` или хвоста `{text}`. Без шаблона — как у
 * `formatEntry`: текст во второй колонке. Строки без цитаты пропускаются — подсвечивать нечего.
 */
export const parseRemarks = (reviewFile: string, opts: ReviewLogOptions, source: string): RemarkRef[] => {
    const markdown = readLog(reviewFile);
    const heading = findHeading(markdown, opts.heading);
    if (!heading) return [];
    const rows = tableRows(markdown, heading);
    const patterns = opts.cells?.length ? opts.cells.map(cellPattern) : undefined;
    // Обе стороны через plain: он снимает `_` и `*`, иначе `_front/front.md` никогда не совпадёт.
    const mine = {
        artifact: plain(artifactName(source)),
        page: plain(path.relative(path.dirname(reviewFile), source).split(path.sep).join('/'))
    };
    const out: RemarkRef[] = [];
    for (const row of rows) {
        const vars: Record<string, string> = {};
        if (patterns) {
            let ok = true;
            patterns.forEach((re, i) => {
                if (!re) return;
                const m = (row.cells[i] ?? '').match(re);
                if (!m) ok = false;
                else Object.assign(vars, m.groups);
            });
            if (!ok) continue;
            if (vars.artifact !== undefined && plain(vars.artifact) !== mine.artifact) continue;
            if (vars.page !== undefined && plain(vars.page) !== mine.page) continue;
        } else {
            vars.text = row.cells[row.number === null ? 0 : 1] ?? '';
        }
        const text =
            vars.text !== undefined
                ? splitText(vars.text)
                : { comment: vars.comment ?? '', quote: '', section: '' };
        // Хвост `…` обрезанной цитаты на странице искать нельзя — на странице она обрезана.
        const quote = plain(vars.quote ?? text.quote)
            .replace(/…$/, '')
            .trim();
        if (!quote) continue;
        out.push({
            number: row.number,
            comment: plain(vars.comment ?? text.comment),
            quote,
            section: plain(vars.section ?? text.section)
        });
    }
    return out;
};

/**
 * Исходник страницы — сам журнал: тот файл, который нашёл бы поиск от его каталога (не любой
 * одноимённый). На такой странице строки замечаний получают кнопку удаления.
 */
export const isReviewFile = (source: string, file: string, root: string): boolean =>
    findReviewFile(path.dirname(source), file, root) === path.resolve(source);

/**
 * Удаляет строку журнала: по номеру (числовая таблица) и тексту любой ячейки — колонка текста
 * задана шаблоном `cells`, страница её не знает и шлёт ячейку, которую показывает как текст.
 */
export const deleteRemark = (
    reviewFile: string,
    headings: string[],
    ref: RowRef,
    cells?: string[]
): RemoveResult => {
    const heading = findHeading(readLog(reviewFile), headings);
    return heading ? deleteRow(reviewFile, heading, ref, { anyCell: true, cells }) : { error: 'not-found' };
};

/** Дописывает замечание в журнал и возвращает номер строки таблицы (null — список). */
export const writeRemark = (
    reviewFile: string,
    opts: ReviewLogOptions,
    input: RemarkInput
): number | null => {
    const text = formatEntry({ comment: input.comment, quote: input.quote, section: input.section });
    const template = opts.cells;
    // `{number}` — через vars, а не заменой по готовым ячейкам: текст пользователя не трогаем.
    const cells = template?.length
        ? (n: number | null) =>
              fillCells(template, { ...remarkVars(input, reviewFile), number: n === null ? '' : String(n) })
        : undefined;
    return writeRow(
        reviewFile,
        findHeading(readLog(reviewFile), opts.heading) ?? opts.heading[0],
        text,
        cells
    );
};
