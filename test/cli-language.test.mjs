import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

import { UI_STRINGS } from './dist.mjs';
import { REPO_ROOT } from './helpers.mjs';

// Вывод CLI — только на английском. Проверяем строковые литералы по AST, а не grep'ом:
// комментарии (они по правилу репо русские) узлами-литералами не являются, а `//` внутри
// строк и URL не ломают разбор. Регэкспы не проверяются — это не вывод.
const SRC = path.join(REPO_ROOT, 'src');
// Словарь интерфейса страницы site -w — текст в браузере, а не вывод CLI (change site-ui-language, D5).
const UI_DICTIONARY = path.join('cli', 'commands', 'site.i18n.ts');
const CYRILLIC = /[А-Яа-яЁё]/;
const LITERALS = new Set([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail
]);

it('строковые литералы src/**/*.ts без кириллицы', () => {
    const found = [];
    for (const rel of fs.readdirSync(SRC, { recursive: true })) {
        if (!rel.endsWith('.ts') || rel === UI_DICTIONARY) continue;
        const file = path.join(SRC, rel);
        const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
        const visit = (node) => {
            if (LITERALS.has(node.kind) && CYRILLIC.test(node.text)) {
                const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
                found.push(`src/${rel}:${line}: ${JSON.stringify(node.text)}`);
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    expect(found, 'вывод CLI — на английском').toEqual([]);
});

it('словарь интерфейса страницы: ключи en и ru совпадают, у строк с числом — все формы', () => {
    const { en, ru } = UI_STRINGS;
    const missing = (a, b) => Object.keys(a).filter((k) => !(k in b));
    expect(missing(en, ru), 'нет в ru').toEqual([]);
    expect(missing(ru, en), 'нет в en').toEqual([]);
    const forms = (dict) =>
        Object.fromEntries(
            Object.entries(dict)
                .filter(([, v]) => typeof v === 'object')
                .map(([k, v]) => [k, Object.keys(v).sort()])
        );
    const all = (keys) => Object.fromEntries(Object.keys(forms(en)).map((k) => [k, keys]));
    expect(forms(en)).toEqual(all(['one', 'other']));
    expect(forms(ru)).toEqual(all(['few', 'many', 'one']));
});
