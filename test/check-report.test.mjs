import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
    D2Error,
    DiagramError,
    errorDiagnostics,
    formatGithub,
    formatGitlab,
    formatJson,
    locate,
    parseBpmn,
    parseWireflow,
    problemText,
    renderD2,
    renderMermaid,
    reportBase,
    teardownBpmn,
    teardownD2,
    teardownMermaid,
    uniqueDiagnostics
} from './dist.mjs';

// `check --format` (issue #65): структура замечаний у источника (рендереры), сборка модели
// замечания и форматтеры отчёта — без запуска CLI.

afterAll(async () => {
    await teardownBpmn();
    await teardownMermaid();
});

const rejection = async (promise) => {
    try {
        await promise;
    } catch (e) {
        return e;
    }
    throw new Error('expected a rejection');
};
const thrown = (fn) => {
    try {
        fn();
    } catch (e) {
        return e;
    }
    throw new Error('expected a throw');
};

describe('problemText — печатная форма из структуры', () => {
    it('`line N:`, `<id> [<rule>]` (`-` без элемента), `<id>:`; id в тексте — без префикса', () => {
        expect(problemText({ line: 3, message: 'Syntax Error?' })).toBe('line 3: Syntax Error?');
        expect(
            problemText({ rule: 'no-disconnected', element: 'Lonely', message: 'Element is not connected' })
        ).toBe('Lonely [no-disconnected] Element is not connected');
        expect(problemText({ rule: 'layout:x', message: 'whole model' })).toBe('- [layout:x] whole model');
        expect(problemText({ element: 'F1', message: 'unresolved reference <X>' })).toBe(
            'F1: unresolved reference <X>'
        );
        const rel = {
            line: 6,
            rule: 'undeclared-element',
            element: 'nope',
            elementInMessage: true,
            message: 'Rel_D to undeclared element "nope"'
        };
        expect(problemText(rel)).toBe('line 6: Rel_D to undeclared element "nope"');
        expect(problemText({ element: 'e1', elementInMessage: true, message: 'edge "e1": bad' })).toBe(
            'edge "e1": bad'
        );
        // Позиция, вписанная движком в текст: печать — text, message — без позиции.
        expect(problemText({ line: 2, message: 'm', text: 'raw at line 2' })).toBe('raw at line 2');
    });
});

describe('позиция из текста движка — у источника, не в message', () => {
    it('BPMN: XML-парсер moddle `line: L, column: C` (с 0) → line/column с 1; печать прежняя', async () => {
        const e = await rejection(parseBpmn('<?xml version="1.0"?>\n<a>\n<b>\n</a>\n', 'x.bpmn'));
        expect(e.problems).toEqual([
            'invalid BPMN XML: unparsable content </a> detected, line: 3, column: 0, nested error: closing tag mismatch'
        ]);
        expect(e.details).toEqual([
            {
                line: 4,
                column: 1,
                message:
                    'invalid BPMN XML: unparsable content </a> detected, nested error: closing tag mismatch',
                text: e.problems[0]
            }
        ]);
    });

    it('wireflow: JSON.parse `at position N (line L column C)` → line/column; message без позиции', () => {
        const e = thrown(() => parseWireflow('{\n "a": 1,\n\n}\n', 'x.wireflow.json'));
        expect(e.problems).toEqual([
            expect.stringMatching(/^invalid JSON: .* at position 12 \(line 4 column 1\)$/)
        ]);
        const [p] = e.details;
        expect(p).toMatchObject({ line: 4, column: 1 });
        expect(p.message).toMatch(/^invalid JSON: /);
        expect(p.message).not.toMatch(/position|line|column/);
    });

    it('wireflow: id узла или ребра — element, id остаётся в тексте; duplicate id — тоже с element', () => {
        const wf = (nodes, edges = []) =>
            JSON.stringify({ format: 'wireflow', version: 4, diagram: { nodes, edges } });
        const card = (id) => ({ id, type: 'flow', position: { x: 0, y: 0 }, data: { graphicId: 'g' } });
        const e = thrown(() =>
            parseWireflow(wf([card('a'), card('a')], [{ id: 'e', source: 'a', target: 'x9' }]), 'x')
        );
        expect(e.details).toEqual([
            { element: 'a', elementInMessage: true, message: 'duplicate id "a"' },
            { element: 'e', elementInMessage: true, message: 'edge "e": target "x9" is not a node' }
        ]);
        expect(e.problems).toEqual(['duplicate id "a"', 'edge "e": target "x9" is not a node']);
        const noId = thrown(() => parseWireflow(wf([], [{ source: 'a' }]), 'x'));
        expect(noId.details).toEqual([{ message: 'edge #0: missing "id"' }]);
    });

    it('mermaid: `on line N, column M` и `at offset` внутри текста → line/column, message без них', async () => {
        const e = await rejection(renderMermaid('pie\n "a" : x\n', 'p.mmd'));
        expect(e.problems[0]).toMatch(/^line 2: Parsing failed: Lexer error on line 2, column 8: /);
        const [p] = e.details;
        expect(p).toMatchObject({ line: 2, column: 8 });
        expect(p.message).toMatch(/^Parsing failed: Lexer error: unexpected character/);
        expect(p.message).not.toMatch(/\bline \d|offset/);
        // jison: строка из заголовка, в message её нет и не было.
        const jison = await rejection(renderMermaid('flowchart LR\n  A -->> ((B', 'f.mmd'));
        expect(jison.details[0].line).toBe(2);
        expect(jison.problems[0]).toBe(`line 2: ${jison.details[0].message}`);
    });
});

describe('errorDiagnostics / uniqueDiagnostics', () => {
    it('не-Error (строка, undefined, объект) → одно замечание с текстом, без падения', () => {
        for (const [thrownValue, message] of [
            ['boom', 'boom'],
            [undefined, 'undefined'],
            [{ code: 1 }, '[object Object]'],
            [new Error('ENOENT: no such file'), 'ENOENT: no such file']
        ])
            expect(errorDiagnostics(thrownValue, '/w/a.puml', 'plantuml')).toEqual([
                {
                    file: '/w/a.puml',
                    line: null,
                    column: null,
                    engine: 'plantuml',
                    severity: 'error',
                    rule: null,
                    element: null,
                    message,
                    elementInMessage: false
                }
            ]);
    });

    it('ошибка движка → details; file замечания (импорт D2) важнее проверяемого', () => {
        const e = new DiagramError('x', [
            { file: '/w/lib.d2', line: 1, column: 1, message: 'bad' },
            { message: 'm' }
        ]);
        expect(errorDiagnostics(e, '/w/a.d2', 'd2').map((d) => [d.file, d.line, d.message])).toEqual([
            ['/w/lib.d2', 1, 'bad'],
            ['/w/a.d2', null, 'm']
        ]);
    });

    it('повтор по всем полям схлопывается, отличие в любом поле — нет', () => {
        const d = errorDiagnostics(
            new DiagramError('x', [{ line: 1, message: 'bad' }]),
            '/w/lib.d2',
            'd2'
        )[0];
        expect(uniqueDiagnostics([d, { ...d }, { ...d, line: 2 }, { ...d, severity: 'warning' }])).toEqual([
            d,
            { ...d, line: 2 },
            { ...d, severity: 'warning' }
        ]);
    });
});

describe('locate', () => {
    it('BPMN: атрибут id в двойных и одинарных кавычках', () => {
        const xml = '<a>\n  <task id="T"/>\n  <task  id = \'Lonely\'/>\n</a>';
        expect(locate(xml, 'T', 'bpmn')).toEqual({ line: 2, column: 9 });
        expect(locate(xml, 'Lonely', 'bpmn')).toEqual({ line: 3, column: 10 });
        // bpmnElement="T" и id с префиксом — не объявление
        expect(locate('<s bpmnElement="Lonely" id="Lonely_di"/>', 'Lonely', 'bpmn')).toBeNull();
    });

    it('wireflow: минифицированный и форматированный JSON; id не найден → null', () => {
        const min = JSON.stringify({ edges: [{ id: 'e1' }] });
        expect(locate(min, 'e1', 'wireflow')).toEqual({ line: 1, column: 12 });
        const pretty = JSON.stringify({ edges: [{ id: 'e1' }] }, null, 2);
        expect(locate(pretty, 'e1', 'wireflow')).toEqual({ line: 4, column: 7 });
        expect(locate(pretty, 'nope', 'wireflow')).toBeNull();
        expect(locate(pretty, 'e1', 'plantuml')).toBeNull();
    });
});

const diag = (over) => ({
    file: '/w/docs/src/a.puml',
    line: 3,
    column: null,
    engine: 'plantuml',
    severity: 'error',
    rule: null,
    element: null,
    message: 'Syntax Error',
    ...over
});
const base = '/w/docs';

describe('форматтеры', () => {
    it('пустой список: `[]`, пустая строка, `[]`', () => {
        expect(formatJson([], { base })).toBe('[]');
        expect(formatGithub([], { base })).toBe('');
        expect(formatGitlab([], { base })).toBe('[]');
    });

    it('json: поля модели в порядке, путь относительно base', () => {
        const [d] = JSON.parse(formatJson([diag({ elementInMessage: true })], { base }));
        expect(Object.keys(d)).toEqual([
            'file',
            'line',
            'column',
            'engine',
            'severity',
            'rule',
            'element',
            'message'
        ]);
        expect(d.file).toBe('src/a.puml');
    });

    it('github: title с правилом и без, col, экранирование данных и свойств', () => {
        expect(formatGithub([diag()], { base })).toBe(
            '::error file=src/a.puml,line=3,title=c4builder plantuml::Syntax Error'
        );
        expect(
            formatGithub(
                [
                    diag({
                        file: '/w/docs/a:b,c.bpmn',
                        engine: 'bpmn',
                        severity: 'warning',
                        line: 2,
                        column: 5,
                        rule: 'c4builder/x',
                        message: '100% bad\r\nnext'
                    })
                ],
                { base }
            )
        ).toBe(
            '::warning file=a%3Ab%2Cc.bpmn,line=2,col=5,title=c4builder bpmn [c4builder/x]::100%25 bad%0D%0Anext'
        );
        // Без строки и движка — свойств line/col нет, title без движка.
        expect(formatGithub([diag({ engine: null, line: null, message: 'm' })], { base })).toBe(
            '::error file=src/a.puml,title=c4builder::m'
        );
    });

    it('префикс element — по структуре (id не входит в message), а не по подстроке', () => {
        const lint = diag({ engine: 'bpmn', element: 'Lonely', message: 'Element is not connected' });
        expect(formatGithub([lint], { base })).toMatch(/::Lonely: Element is not connected$/);
        const wf = diag({
            engine: 'wireflow',
            element: 'e1',
            elementInMessage: true,
            message: 'edge "e1": bad'
        });
        expect(formatGithub([wf], { base })).toMatch(/::edge "e1": bad$/);
        expect(JSON.parse(formatGitlab([lint], { base }))[0].description).toBe(
            'Lonely: Element is not connected'
        );
        // Короткие id `e` и `a` встречаются в тексте как буквы — префикс всё равно нужен.
        for (const id of ['e', 'a'])
            expect(
                formatGithub([diag({ engine: 'bpmn', element: id, message: 'Element is not connected' })], {
                    base
                })
            ).toMatch(new RegExp(`::${id}: Element is not connected$`));
        const short = diag({
            engine: 'wireflow',
            element: 'e',
            elementInMessage: true,
            message: 'edge "e": bad'
        });
        expect(formatGithub([short], { base })).toMatch(/::edge "e": bad$/);
    });

    it('gitlab: check_name, severity, location; без строки begin = 1', () => {
        const [err, warn] = JSON.parse(
            formatGitlab(
                [
                    diag(),
                    diag({ severity: 'warning', line: null, rule: 'undeclared-element', element: 'nope' })
                ],
                { base }
            )
        );
        expect(err).toMatchObject({
            check_name: 'plantuml',
            severity: 'major',
            location: { path: 'src/a.puml', lines: { begin: 3 } }
        });
        expect(warn).toMatchObject({
            check_name: 'plantuml/undeclared-element',
            severity: 'minor',
            location: { lines: { begin: 1 } }
        });
        expect(err.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    });

    it('gitlab: fingerprint не зависит от строки и различает повторы', () => {
        const fp = (list) => JSON.parse(formatGitlab(list, { base })).map((x) => x.fingerprint);
        const [a] = fp([diag({ line: 3 })]);
        const [b] = fp([diag({ line: 4 })]);
        expect(a).toBe(b);
        const [x, y] = fp([diag(), diag()]);
        expect(x).toBe(a);
        expect(y).not.toBe(x);
    });

    it('reportBase: GITHUB_WORKSPACE для github, CI_PROJECT_DIR для gitlab, иначе cwd', () => {
        const env = { GITHUB_WORKSPACE: '/gh', CI_PROJECT_DIR: '/gl' };
        expect(reportBase('github', env, '/cwd')).toBe('/gh');
        expect(reportBase('gitlab', env, '/cwd')).toBe('/gl');
        expect(reportBase('json', env, '/cwd')).toBe('/cwd');
        expect(reportBase('github', {}, '/cwd')).toBe('/cwd');
    });

    it('reportBase: каталог через симлинк → физический путь (пути файлов строятся от физического cwd)', () => {
        const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4b-base-')));
        const link = `${real}-link`;
        fs.symlinkSync(real, link);
        try {
            expect(reportBase('github', { GITHUB_WORKSPACE: link }, '/cwd')).toBe(real);
            expect(reportBase('gitlab', { CI_PROJECT_DIR: link }, '/cwd')).toBe(real);
            expect(reportBase('json', {}, link)).toBe(real);
        } finally {
            fs.rmSync(link);
            fs.rmSync(real, { recursive: true, force: true });
        }
    });
});

describe('renderD2: позиции ошибок компиляции', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4b-d2err-'));
    afterAll(async () => {
        await teardownD2();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('две ошибки → D2Error.details с абсолютным путём и позициями с 1; message прежний', async () => {
        const file = path.join(dir, 'bad.d2');
        fs.writeFileSync(file, 'a -> \nb: {\n');
        const err = await renderD2(file).catch((e) => e);
        expect(err).toBeInstanceOf(D2Error);
        expect(err.message).toMatch(/^D2 compile error \(.*bad\.d2\):\nbad\.d2:1:1: connection missing/);
        expect(err.problems).toEqual([err.message]);
        expect(err.details.map(({ file, line, column }) => [file, line, column])).toEqual([
            [file, 1, 1],
            [file, 2, 4]
        ]);
        expect(err.details[0].message).toBe('connection missing destination');
    });

    it('ошибка в импортированном файле → путь импорта', async () => {
        fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
        const lib = path.join(dir, 'lib', 'x.d2');
        fs.writeFileSync(lib, 'a -> \n');
        const main = path.join(dir, 'main.d2');
        fs.writeFileSync(main, 'b: @lib/x\n');
        const err = await renderD2(main).catch((e) => e);
        expect(err.details).toEqual([
            { file: lib, line: 1, column: 1, message: 'connection missing destination' }
        ]);
    });
});
