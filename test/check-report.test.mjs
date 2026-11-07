import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
    D2Error,
    formatGithub,
    formatGitlab,
    formatJson,
    locate,
    parseProblem,
    renderD2,
    reportBase,
    teardownD2
} from './dist.mjs';

// `check --format` (issue #65): разбор текста движков в модель замечания и форматтеры отчёта —
// без запуска движков (кроме D2: позиции берутся из его ответа).

const none = { line: null, column: null, rule: null, element: null };

describe('parseProblem', () => {
    it('PlantUML: `line N:` → line и message; undeclared-element → rule и element', () => {
        expect(parseProblem('plantuml', 'line 3: Syntax Error?')).toEqual({
            ...none,
            line: 3,
            message: 'Syntax Error?'
        });
        expect(parseProblem('plantuml', 'line 6: Rel_D to undeclared element "nope"')).toEqual({
            ...none,
            line: 6,
            rule: 'undeclared-element',
            element: 'nope',
            message: 'Rel_D to undeclared element "nope"'
        });
        // .iuml — без строки
        expect(parseProblem('plantuml', 'Error in function definition')).toEqual({
            ...none,
            message: 'Error in function definition'
        });
    });

    it('BPMN: `id [rule] msg`, `-` без элемента, `id: msg`', () => {
        expect(parseProblem('bpmn', 'Lonely [no-disconnected] Element is not connected')).toEqual({
            ...none,
            rule: 'no-disconnected',
            element: 'Lonely',
            message: 'Element is not connected'
        });
        expect(parseProblem('bpmn', '- [layout:x] whole model')).toEqual({
            ...none,
            rule: 'layout:x',
            message: 'whole model'
        });
        expect(parseProblem('bpmn', 'F1: unresolved reference <X>')).toEqual({
            ...none,
            element: 'F1',
            message: 'unresolved reference <X>'
        });
        expect(parseProblem('bpmn', 'invalid BPMN XML: unparsable content')).toEqual({
            ...none,
            message: 'invalid BPMN XML: unparsable content'
        });
    });

    it('`ENOENT: …` у не-BPMN — без element', () => {
        const text = "ENOENT: no such file or directory, open 'x.puml'";
        expect(parseProblem('plantuml', text)).toEqual({ ...none, message: text });
        expect(parseProblem(null, text)).toEqual({ ...none, message: text });
    });

    it('wireflow: id из `card "a": …`, message — вся строка; `edge #0` без element', () => {
        const card = 'card "a\\"b": unknown screen template "x"';
        expect(parseProblem('wireflow', card)).toEqual({ ...none, element: 'a"b', message: card });
        expect(parseProblem('wireflow', 'edge "e1": target "x9" is not a node').element).toBe('e1');
        expect(parseProblem('wireflow', 'edge #0: missing "id"')).toEqual({
            ...none,
            message: 'edge #0: missing "id"'
        });
    });

    it('mermaid: со строкой и без', () => {
        expect(parseProblem('mermaid', 'line 2: Parse error')).toEqual({
            ...none,
            line: 2,
            message: 'Parse error'
        });
        expect(parseProblem('mermaid', "diagram type 'x' uses HTML labels")).toEqual({
            ...none,
            message: "diagram type 'x' uses HTML labels"
        });
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
        const [d] = JSON.parse(formatJson([diag()], { base }));
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

    it('префикс element — только если id нет в сообщении', () => {
        const lint = diag({ engine: 'bpmn', element: 'Lonely', message: 'Element is not connected' });
        expect(formatGithub([lint], { base })).toMatch(/::Lonely: Element is not connected$/);
        const wf = diag({ engine: 'wireflow', element: 'e1', message: 'edge "e1": bad' });
        expect(formatGithub([wf], { base })).toMatch(/::edge "e1": bad$/);
        expect(JSON.parse(formatGitlab([lint], { base }))[0].description).toBe(
            'Lonely: Element is not connected'
        );
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
});

describe('renderD2: позиции ошибок компиляции', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4b-d2err-'));
    afterAll(async () => {
        await teardownD2();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('две ошибки → D2Error.problems с абсолютным путём и позициями с 1; message прежний', async () => {
        const file = path.join(dir, 'bad.d2');
        fs.writeFileSync(file, 'a -> \nb: {\n');
        const err = await renderD2(file).catch((e) => e);
        expect(err).toBeInstanceOf(D2Error);
        expect(err.message).toMatch(/^D2 compile error \(.*bad\.d2\):\nbad\.d2:1:1: connection missing/);
        expect(err.problems.map(({ file, line, column }) => [file, line, column])).toEqual([
            [file, 1, 1],
            [file, 2, 4]
        ]);
        expect(err.problems[0].message).toBe('connection missing destination');
    });

    it('ошибка в импортированном файле → путь импорта', async () => {
        fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
        const lib = path.join(dir, 'lib', 'x.d2');
        fs.writeFileSync(lib, 'a -> \n');
        const main = path.join(dir, 'main.d2');
        fs.writeFileSync(main, 'b: @lib/x\n');
        const err = await renderD2(main).catch((e) => e);
        expect(err.problems).toEqual([
            { file: lib, line: 1, column: 1, message: 'connection missing destination' }
        ]);
    });
});
