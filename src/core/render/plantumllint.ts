import { warnDiagram } from './warnings.ts';

// Связь C4 на необъявленный алиас (`Rel(u, nope, …)` с опечаткой): PlantUML не падает, а
// молча создаёт по алиасу сущность — диаграмма «рендерится», проверка зелёная.
//
// Неявную сущность выдаёт SVG: PlantUML рисует её кружком интерфейса с подписью-алиасом
// (`<ellipse>` и `<text>` с последним сегментом data-qualified-name), а элементы C4 —
// прямоугольниками и контурами, в т. ч. с HIDE_STEREOTYPE(). Так учитываются объявления из
// `!include`, процедур и границ без разбора грамматики PlantUML. Номера строк связей в SVG
// для этого не годятся: при раскладке Smetana у рёбер нет data-source-line.
//
// Строку для сообщения и принадлежность к макросам связей берём из текста файла: в обычных
// диаграммах `A --> B` без объявлений — норма PlantUML, поэтому предупреждаем только о
// связях макросами C4. Связи из подключаемых файлов не видны — для них молчим. Ложное
// срабатывание — явный `interface x` без подписи, на который ведёт Rel: в C4 почти не встречается.

// Rel, Rel_D, Rel_Back_Neighbor, BiRel_L, RelIndex_U, Lay_R, Lay_Distance… Граница слова слева
// без `$`: `myRel(` и `$Rel(` — чужие функции, а не макрос C4.
const MACRO = String.raw`(?<![\w$])((?:Bi)?Rel(Index)?(?:_\w+)?|Lay_\w+)[ \t]*\(`;
// Дешёвый отсев до разбора: в большинстве диаграмм макросов связей нет вовсе.
const HAS_MACRO = new RegExp(MACRO);
// Вызов ищем в любом месте строки (после `/' … '/`, продолжение `\` на следующих строках),
// пропуская строки в кавычках и комментарии: `Rel(` в подписи или в `' Rel(a, b)` — не вызов.
const TOKEN = new RegExp(String.raw`"[^"\n]*"|\/'[\s\S]*?'\/|^[ \t]*'[^\n]*|${MACRO}`, 'gm');
const ALIAS = /^[\w.]+$/;

// Аргументы вызова от позиции сразу после `(` до парной `)`. Запятые и скобки внутри кавычек
// и вложенных вызовов не делят аргументы: у `RelIndex(SetIndex(3), a, b)` индекс — вызов
// функции. Незакрытый вызов — null: PlantUML на нём и так упадёт.
const callArgs = (src: string, from: number): string[] | null => {
    const args: string[] = [];
    let depth = 0;
    let quoted = false;
    let start = from;
    for (let i = from; i < src.length; i++) {
        const c = src[i];
        if (quoted) quoted = c !== '"';
        else if (c === '"') quoted = true;
        else if (c === '(') depth++;
        else if (c === ')' && depth > 0) depth--;
        else if (c === ')' || (c === ',' && depth === 0)) {
            args.push(src.slice(start, i));
            if (c === ')') return args;
            start = i + 1;
        }
    }
    return null;
};

// Алиасы from и to: позиционно — первые два аргумента (у RelIndex — после индекса), именованные
// `$from=` / `$to=` — где бы ни стояли; прочие именованные (`$label=`) алиасами не бывают.
const endpoints = (args: string[], indexed: boolean): string[] => {
    const first = indexed ? 1 : 0;
    const out: string[] = [];
    for (const [i, raw] of args.entries()) {
        const arg = raw.replace(/\\\r?\n/g, ' ').trim();
        const named = arg.match(/^\$(\w+)\s*=\s*([\s\S]*)$/);
        if (named) {
            if (named[1] === 'from' || named[1] === 'to') out.push(named[2].trim());
        } else if (i >= first && i < first + 2) out.push(arg);
    }
    return out;
};

interface RelCall {
    line: number;
    macro: string;
    aliases: string[];
}

const relCalls = (source: string): RelCall[] => {
    const calls: RelCall[] = [];
    // Номер строки — инкрементально: совпадения идут по возрастанию позиции.
    let line = 1;
    let counted = 0;
    for (const m of source.matchAll(TOKEN)) {
        if (!m[1]) continue;
        const args = callArgs(source, m.index + m[0].length);
        if (!args) continue;
        for (; counted < m.index; counted++) if (source[counted] === '\n') line++;
        calls.push({ line, macro: m[1], aliases: [...new Set(endpoints(args, !!m[2]))] });
    }
    return calls;
};

const lastSegment = (name: string): string => name.slice(name.lastIndexOf('.') + 1);

// Неявные сущности SVG — по подписи, т. е. алиасу ровно как он написан в вызове: `typo` у
// `b.typo` (внутри границы b), `b9.db` у `b2.b9.db`. Объявленные — имена всех прочих сущностей
// и границ.
const svgEntities = (svg: string): { implicit: Set<string>; declared: string[] } => {
    const implicit = new Set<string>();
    const implicitNames = new Set<string>();
    for (const m of svg.matchAll(/<g\s[^>]*?class="entity"[^>]*>([\s\S]*?)<\/g>/g)) {
        const name = m[0].match(/data-qualified-name="([^"]*)"/)?.[1];
        if (!name) continue;
        const tags = [...m[1].matchAll(/<(\w+)/g)].map((t) => t[1]).join(',');
        const label = m[1].match(/>([^<]*)<\/text>/)?.[1];
        if (tags === 'ellipse,text' && label && (name === label || name.endsWith(`.${label}`))) {
            implicit.add(label);
            implicitNames.add(name);
        }
    }
    const declared = [...svg.matchAll(/data-qualified-name="([^"]*)"/g)]
        .map((m) => m[1])
        .filter((name) => !implicitNames.has(name));
    return { implicit, declared };
};

// Текст предупреждения — контракт: его печатает `⚠`, а `check --format` разбирает обратно в
// правило и элемент. Шаблон и разбор живут рядом, чтобы правка одного не сломала другое молча.
export const UNDECLARED_REL_RULE = 'undeclared-element';
const undeclaredRelMessage = (macro: string, alias: string): string =>
    `${macro} to undeclared element "${alias}"`;
/** Разбор `undeclaredRelMessage` (без префикса `line N: `): [, macro, alias]. */
export const UNDECLARED_REL_RE = /^(\w+) to undeclared element "(.*)"$/;

/**
 * `line N: <Macro> to undeclared element "alias"` — по одной на каждый вызов с таким алиасом.
 * N — строка source с 1 плюс lineOffset (блок в markdown: строка страницы, см. fences.ts).
 */
export const undeclaredRelWarnings = (source: string, svg: string, lineOffset = 0): string[] => {
    // Сначала текст: без вызовов макросов связей SVG не разбираем вовсе.
    if (!HAS_MACRO.test(source)) return [];
    const calls = relCalls(source);
    if (!calls.length) return [];
    const { implicit, declared } = svgEntities(svg);
    if (!implicit.size) return [];
    // Как разрешает алиасы PlantUML 1.2026.8 (проверено на вендорном jar): короткий `db` ищется
    // по всей диаграмме, в т. ч. внутри границ (`b1.db`), и неявная сущность появляется, только
    // если объявленной нет (объявление после неявной — ошибка движка). Поэтому короткий алиас
    // при объявленной сущности с таким последним сегментом не помечаем — это и страховка от
    // неожиданной формы отрисовки. Квалифицированный `b1.db` к объявленной `b1.db` не
    // разрешается никогда: движок рисует отдельный кружок с подписью `b1.db` — помечаем всегда.
    const isUndeclared = (alias: string): boolean =>
        implicit.has(alias) && (alias.includes('.') || !declared.some((name) => lastSegment(name) === alias));
    const warnings: string[] = [];
    for (const { line, macro, aliases } of calls)
        for (const alias of aliases)
            if (ALIAS.test(alias) && isUndeclared(alias))
                warnings.push(`line ${line + lineOffset}: ${undeclaredRelMessage(macro, alias)}`);
    return warnings;
};

/**
 * Печать предупреждений общим каналом (`⚠ <file>: …`, счётчик для `check --strict`). Когда
 * проверять — решает вызывающий: у `check` и сборки разные условия (см. их комментарии).
 */
export const warnUndeclaredRels = (file: string, source: string, svg: string, lineOffset = 0): void => {
    for (const w of undeclaredRelWarnings(source, svg, lineOffset)) warnDiagram(file, w);
};
