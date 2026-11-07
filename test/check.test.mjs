import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');

// `c4builder check <file...>` (issue #13): валидация отдельных диаграмм без проекта —
// тем же вендорным jar / бандлом D2, что и сборка. Проверяем контракт для хуков и CI:
// код выхода, ошибка с именем файла и строкой, работа вне `.c4builder`.
let dir;
// Таймаут: зависшее окно jsdom/воркер D2 не дали бы процессу завершиться — ловим это здесь.
const check = (...files) =>
    spawnSync(process.execPath, [CLI, 'check', ...files], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
// Машинные форматы: база путей из переменных CI задаётся явно — тест сам может идти в CI.
const checkEnv = (env, ...args) => {
    const clean = { ...process.env };
    delete clean.GITHUB_WORKSPACE;
    delete clean.CI_PROJECT_DIR;
    return spawnSync(process.execPath, [CLI, 'check', ...args], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...clean, ...env }
    });
};

const BPMN_NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"';
const bpmn = (body) =>
    `<?xml version="1.0"?>\n<bpmn:definitions ${BPMN_NS} id="D" targetNamespace="https://example.com/t">` +
    `<bpmn:process id="P" name="P">${body}</bpmn:process></bpmn:definitions>\n`;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(REPO_ROOT, 'test', '.tmp-check-'));
    const write = (name, content) => fs.writeFileSync(path.join(dir, name), content);
    write('ok.puml', '@startuml\nAlice -> Bob : hi\n@enduml\n');
    write('bad.puml', '@startuml\nAlice -> Bob : hi\nfoo bar baz\n@enduml\n');
    write('lib.iuml', '!procedure $x()\nAlice -> Bob\n!endprocedure\n');
    write('bad.iuml', '!procedure $x(\nAlice -> Bob\n');
    // Стили на макросах C4 без своего @startuml — контекст C4 задаёт подключающая диаграмма.
    write('c4-styles.iuml', 'skinparam shadowing false\nUpdateElementStyle("person", $bgColor="#000")\n');
    write('uses-lib.puml', '@startuml\n!include lib.iuml\n$x()\n@enduml\n');
    // Связь C4 на необъявленный алиас (#60): PlantUML молча создаёт сущность — предупреждение.
    write(
        'dangling.puml',
        '@startuml\n!include <C4/C4_Container>\nHIDE_STEREOTYPE()\nPerson(u, "User")\n' +
            'System_Boundary(b, "B") {\n  Container(c1, "C1", "java")\n  Rel(c1, typo, "inside")\n}\n' +
            'Rel(u, nope, "typo alias")\nRel_D(u, c1, "ok")\nLay_R(u, ghost)\n@enduml\n'
    );
    // BiRel и RelIndex: имя макроса в сообщении, индекс RelIndex за алиас не принимается.
    write(
        'rel-variants.puml',
        '@startuml\n!include <C4/C4_Dynamic>\nPerson(u, "User")\nSystem(s, "S")\n' +
            'BiRel(u, bogus, "x")\nRelIndex(1, s, missing, "y")\n@enduml\n'
    );
    // Формы вызова: индекс RelIndex — вызов функции со своими скобками, продолжение строки `\`,
    // вызов после блочного комментария. Закомментированный вызов и чужая процедура `myRel` (её
    // `-->` тоже создаёт неявную сущность) — не связи C4.
    write(
        'rel-forms.puml',
        [
            '@startuml',
            '!include <C4/C4_Dynamic>',
            'Person(u, "User")',
            'Container(a, "A")',
            'RelIndex(Index(), u, nope1, "x")',
            'RelIndex(SetIndex(3), a, nope2, "y")',
            'RelIndex(LastIndex(), u, a, "ok")',
            'RelIndex(LastIndex(), u, nope3, "z")',
            'Rel(u, \\',
            '  nope4, "continued")',
            `/' note '/ Rel(u, nope5, "after comment")`,
            `' Rel(u, nope5, "commented out")`,
            '!procedure myRel($a, $b)',
            '$a --> $b',
            '!endprocedure',
            'myRel(u, plain)',
            '@enduml',
            ''
        ].join('\n')
    );
    // Опечатка в квалифицированном алиасе внутри границы даёт неявную `b2.b9.db`; короткий `db`
    // при объявленной `db` PlantUML разрешает к ней — эта связь верна и не помечается.
    write(
        'rel-qualified.puml',
        '@startuml\n!include <C4/C4_Container>\nPerson(u, "User")\nContainerDb(db, "DB")\n' +
            'System_Boundary(b2, "B2") {\n  Container(c2, "C2")\n  Rel(c2, b9.db, "typo")\n}\n' +
            'Rel(u, db, "ok")\n@enduml\n'
    );
    // Без C4: `A --> B` без объявлений — норма PlantUML, не предупреждение.
    write('implicit.puml', '@startuml\nA --> B\nB --> C\n@enduml\n');
    write('ok.d2', 'a -> b\n');
    // Две ошибки: 1:1 и 2:4 — позиции для `check --format`.
    write('bad.d2', 'a -> \nb: {\n');
    write('what.txt', 'x');
    // Имя совпадает с расширением, но расширения нет — не диаграмма (как в scan).
    for (const name of ['d2', 'mmd', 'puml']) write(name, 'a -> b\n');
    const wf = (nodes, edges = []) =>
        JSON.stringify({ format: 'wireflow', version: 4, diagram: { nodes, edges } });
    const wfCard = (id, graphicId = 'e-commerce-cart') => ({
        id,
        type: 'flow',
        position: { x: 0, y: 0 },
        data: { graphicId }
    });
    write('ok.wireflow.json', wf([wfCard('a'), wfCard('b')], [{ id: 'e1', source: 'a', target: 'b' }]));
    write('wireflow.json', wf([wfCard('a')]));
    write('bad.wireflow.json', wf([wfCard('a')], [{ id: 'e1', source: 'a', target: 'x9' }]));
    write('warn.wireflow.json', wf([wfCard('a', 'no-such-template')]));
    // Разрыв строки из Word (U+000B) в заметке и U+0001 в цвете ребра — не ошибка рендера.
    write(
        'ctrl.wireflow.json',
        wf(
            [
                wfCard('a'),
                { id: 'n', type: 'note', position: { x: 300, y: 0 }, data: { text: 'Первая\u000bвторая' } }
            ],
            [{ id: 'e1', source: 'a', target: 'n', style: { stroke: '#e8590c\u0001' } }]
        )
    );
    write('ok.mmd', 'flowchart LR\n  A[Клиент] --> B\n');
    write('bad.mmd', 'flowchart LR\n  A -->> ((B\n');
    write('mind.mmd', 'mindmap\n  root\n');
    // Потоки заданы только sourceRef/targetRef — incoming/outgoing восстанавливает сборка.
    const chain =
        '<bpmn:startEvent id="S" name="s"/><bpmn:task id="T" name="t"/><bpmn:endEvent id="E" name="e"/>' +
        '<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="E"/>';
    write('ok.bpmn', bpmn(chain));
    write('lonely.bpmn', bpmn(`${chain}<bpmn:task id="Lonely" name="lonely"/>`));
    write(
        'warn.bpmn',
        bpmn(
            '<bpmn:startEvent id="S" name="s"/><bpmn:exclusiveGateway id="G" name="ok?"/>' +
                '<bpmn:endEvent id="E1" name="a"/><bpmn:endEvent id="E2" name="b"/>' +
                '<bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="G"/>' +
                '<bpmn:sequenceFlow id="F2" name="yes" sourceRef="G" targetRef="E1"/>' +
                '<bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="E2"/>'
        )
    );
});

afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('c4builder check', () => {
    it('валидные .puml/.iuml/.d2 (с !include из папки файла) → код 0', () => {
        const res = check('ok.puml', 'uses-lib.puml', 'lib.iuml', 'ok.d2');
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toMatch(/✓ ok\.puml/);
        expect(res.stdout).toMatch(/✓ ok\.d2/);
    });

    it('битый .puml → код 1, файл и строка ошибки движка', () => {
        const res = check('ok.puml', 'bad.puml');
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(/✗ bad\.puml: line 3: Syntax Error/);
        expect(res.stdout).toMatch(/✓ ok\.puml/); // остальные файлы всё равно проверены
    });

    it('.iuml с макросами C4 → проверяется в контексте C4-stdlib, код 0', () => {
        const res = check('c4-styles.iuml');
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toMatch(/✓ c4-styles\.iuml/);
    });

    it('битый .iuml → ошибка без строки (позиция относится к обёртке)', () => {
        const res = check('bad.iuml');
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(/✗ bad\.iuml: Error in function definition/);
    });

    it('битый .d2 → код 1, ошибка d2 с позицией', () => {
        const res = check('bad.d2');
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(/✗ bad\.d2: .*\n.*bad\.d2:1:1: connection missing destination/);
    });

    it('неизвестное расширение / отсутствующий файл / без аргументов → код 1', () => {
        const res = check('what.txt', 'missing.puml');
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(
            /✗ what\.txt: unsupported extension \(expected \.puml, \.iuml, \.d2, \.bpmn, \.mmd or \.wireflow\.json\)/
        );
        expect(res.stderr).toMatch(/✗ missing\.puml: ENOENT/);
        const bare = check('d2', 'mmd', 'puml');
        expect(bare.status).toBe(1);
        for (const name of ['d2', 'mmd', 'puml'])
            expect(bare.stderr).toMatch(new RegExp(`^✗ ${name}: unsupported extension`, 'm'));
        const usage = check();
        expect(usage.status).toBe(1);
        expect(usage.stdout).toMatch(
            /usage: c4builder check \[--strict\] <file\.\.\.> .*\| \.mmd \| \.wireflow\.json\)/
        );
    });

    it('корректный .bpmn → код 0, процесс завершается (окно jsdom закрыто)', () => {
        const res = check('ok.bpmn');
        expect(res.error, 'check завис — окно jsdom не закрыто?').toBeUndefined();
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toMatch(/✓ ok\.bpmn/);
    });

    it('несвязанная задача в .bpmn → код 1, строка «файл: id [правило] описание»', () => {
        const res = check('lonely.bpmn');
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(/^✗ lonely\.bpmn: Lonely \[no-disconnected\] Element is not connected$/m);
    });

    it('только warning в .bpmn → код 0, предупреждение в выводе', () => {
        const res = check('warn.bpmn');
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toMatch(/⚠ warn\.bpmn: F3 \[c4builder\/gateway-flow-labels\]/);
        expect(res.stdout).toMatch(/✓ warn\.bpmn/);
    });

    it('корректный .mmd → ✓ и код 0, процесс завершается (окно jsdom закрыто)', () => {
        const res = check('ok.mmd');
        expect(res.error, 'check завис — окно jsdom не закрыто?').toBeUndefined();
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toMatch(/✓ ok\.mmd/);
    });

    it('ошибка в строке 2 .mmd → `✗ bad.mmd: line 2: …`, код 1; mindmap — тип в сообщении', () => {
        const res = check('bad.mmd', 'mind.mmd');
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(/^✗ bad\.mmd: line 2: .*Expecting /m);
        expect(res.stderr).toMatch(/^✗ mind\.mmd: line 1: unsupported mermaid diagram type 'mindmap'$/m);
    });

    it('wireflow: валидный файл и wireflow.json → 0; ребро в никуда → ✗ с id ребра, 1; неизвестный шаблон → ⚠, 0; управляющие символы → ✓', () => {
        const ok = check('ok.wireflow.json', 'wireflow.json');
        expect(ok.status, ok.stderr).toBe(0);
        expect(ok.stdout).toMatch(/✓ ok\.wireflow\.json/);
        expect(ok.stdout).toMatch(/✓ wireflow\.json/);
        const bad = check('bad.wireflow.json');
        expect(bad.status).toBe(1);
        expect(bad.stderr).toMatch(/^✗ bad\.wireflow\.json: .*e1.*x9/m);
        const warn = check('warn.wireflow.json');
        expect(warn.status, warn.stderr).toBe(0);
        expect(warn.stdout).toMatch(/⚠ warn\.wireflow\.json: .*no-such-template/);
        expect(warn.stdout).toMatch(/✓ warn\.wireflow\.json/);
        const ctrl = check('ctrl.wireflow.json');
        expect(ctrl.status, ctrl.stderr).toBe(0);
        expect(ctrl.stdout).toMatch(/✓ ctrl\.wireflow\.json/);
    });

    it('Rel/Lay на необъявленный алиас → ⚠ с номером строки, код 0; с --strict → ✗, код 1', () => {
        const res = check('dangling.puml', 'implicit.puml');
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toMatch(/^⚠ dangling\.puml: line 7: Rel to undeclared element "typo"$/m);
        expect(res.stdout).toMatch(/^⚠ dangling\.puml: line 9: Rel to undeclared element "nope"$/m);
        expect(res.stdout).toMatch(/^⚠ dangling\.puml: line 11: Lay_R to undeclared element "ghost"$/m);
        expect(res.stdout.match(/⚠/g)).toHaveLength(3); // объявленные u и c1 не задеты
        expect(res.stdout).toMatch(/✓ implicit\.puml/);

        const variants = check('rel-variants.puml');
        expect(variants.status, variants.stderr).toBe(0);
        expect(variants.stdout).toMatch(
            /^⚠ rel-variants\.puml: line 5: BiRel to undeclared element "bogus"$/m
        );
        expect(variants.stdout).toMatch(
            /^⚠ rel-variants\.puml: line 6: RelIndex to undeclared element "missing"$/m
        );
        expect(variants.stdout.match(/⚠/g)).toHaveLength(2);

        const forms = check('rel-forms.puml');
        expect(forms.status, forms.stderr).toBe(0);
        for (const [line, alias] of [
            [5, 'nope1'],
            [6, 'nope2'],
            [8, 'nope3']
        ])
            expect(forms.stdout).toMatch(
                new RegExp(
                    `^⚠ rel-forms\\.puml: line ${line}: RelIndex to undeclared element "${alias}"$`,
                    'm'
                )
            );
        // Многострочный вызов — строка имени макроса.
        expect(forms.stdout).toMatch(/^⚠ rel-forms\.puml: line 9: Rel to undeclared element "nope4"$/m);
        expect(forms.stdout).toMatch(/^⚠ rel-forms\.puml: line 11: Rel to undeclared element "nope5"$/m);
        expect(forms.stdout.match(/⚠/g)).toHaveLength(5);

        const qualified = check('rel-qualified.puml');
        expect(qualified.status, qualified.stderr).toBe(0);
        expect(qualified.stdout).toMatch(
            /^⚠ rel-qualified\.puml: line 7: Rel to undeclared element "b9\.db"$/m
        );
        expect(qualified.stdout.match(/⚠/g)).toHaveLength(1);

        const strict = check('--strict', 'dangling.puml', 'implicit.puml', 'warn.bpmn');
        expect(strict.status).toBe(1);
        expect(strict.stderr).toMatch(/^✗ dangling\.puml: 3 warning\(s\), failing with --strict$/m);
        expect(strict.stderr).toMatch(/^✗ warn\.bpmn: \d+ warning\(s\), failing with --strict$/m);
        expect(strict.stdout).toMatch(/✓ implicit\.puml/);
    });
});

// `check --format` (issue #65): машиночитаемые замечания для агентов и CI.
describe('c4builder check --format', () => {
    const json = (...args) => {
        const res = checkEnv({}, '--format', 'json', ...args);
        // stdout — только отчёт: без строк результата и цвета.
        expect(res.stdout).not.toMatch(/[✓✗⚠]/);
        expect(res.stdout).not.toContain('\u001b[');
        return { res, list: JSON.parse(res.stdout) };
    };
    const pick = ({ file, line, column, engine, severity, rule, element }) => ({
        file,
        line,
        column,
        engine,
        severity,
        rule,
        element
    });

    it('json: PlantUML, D2 (две позиции), mermaid, неподдерживаемое расширение; код 1', () => {
        const { res, list } = json('ok.puml', 'bad.puml', 'bad.d2', 'bad.mmd', 'what.txt');
        expect(res.status).toBe(1);
        expect(list.map(pick)).toEqual([
            {
                file: 'bad.puml',
                line: 3,
                column: null,
                engine: 'plantuml',
                severity: 'error',
                rule: null,
                element: null
            },
            {
                file: 'bad.d2',
                line: 1,
                column: 1,
                engine: 'd2',
                severity: 'error',
                rule: null,
                element: null
            },
            {
                file: 'bad.d2',
                line: 2,
                column: 4,
                engine: 'd2',
                severity: 'error',
                rule: null,
                element: null
            },
            {
                file: 'bad.mmd',
                line: 2,
                column: null,
                engine: 'mermaid',
                severity: 'error',
                rule: null,
                element: null
            },
            {
                file: 'what.txt',
                line: null,
                column: null,
                engine: null,
                severity: 'error',
                rule: null,
                element: null
            }
        ]);
        expect(list[0].message).toMatch(/^Syntax Error/);
        expect(list[1].message).toBe('connection missing destination');
        expect(list[4].message).toMatch(/^unsupported extension/);
    });

    it('json: BPMN и wireflow — элемент и строка по объявлению id; предупреждения — warning', () => {
        const { res, list } = json('lonely.bpmn', 'bad.wireflow.json', 'warn.bpmn');
        expect(res.status).toBe(1);
        const at = (name, needle) => {
            const src = fs.readFileSync(path.join(dir, name), 'utf8');
            const i = src.indexOf(needle);
            const before = src.slice(0, i);
            return { line: before.split('\n').length, column: i - before.lastIndexOf('\n') };
        };
        const lonely = list.find((d) => d.file === 'lonely.bpmn');
        expect(lonely).toEqual({
            file: 'lonely.bpmn',
            ...at('lonely.bpmn', 'id="Lonely"'),
            engine: 'bpmn',
            severity: 'error',
            rule: 'no-disconnected',
            element: 'Lonely',
            message: 'Element is not connected'
        });
        const edge = list.find((d) => d.file === 'bad.wireflow.json');
        expect(edge).toMatchObject({
            engine: 'wireflow',
            element: 'e1',
            ...at('bad.wireflow.json', '"id":"e1"')
        });
        const warns = list.filter((d) => d.file === 'warn.bpmn');
        expect(warns.length).toBeGreaterThan(0);
        expect(warns.every((d) => d.severity === 'warning')).toBe(true);
        expect(warns).toContainEqual(
            expect.objectContaining({ element: 'F3', rule: 'c4builder/gateway-flow-labels' })
        );
    });

    it('json: связь на необъявленный алиас → warning undeclared-element, код 0; --json — синоним', () => {
        const { res, list } = json('dangling.puml');
        expect(res.status, res.stderr).toBe(0);
        expect(list.map(pick)).toContainEqual({
            file: 'dangling.puml',
            line: 9,
            column: null,
            engine: 'plantuml',
            severity: 'warning',
            rule: 'undeclared-element',
            element: 'nope'
        });
        expect(list).toHaveLength(3);
        const alias = checkEnv({}, '--json', 'dangling.puml');
        expect(alias.status).toBe(0);
        expect(alias.stdout).toBe(res.stdout);
    });

    it('json: все файлы корректны → `[]`, код 0', () => {
        const { res, list } = json('ok.puml', 'ok.d2');
        expect(res.status, res.stderr).toBe(0);
        expect(list).toEqual([]);
    });

    it('github: ::error со строкой, ::warning; --strict → код 1; путь от GITHUB_WORKSPACE', () => {
        const res = checkEnv({}, '--format', 'github', 'bad.puml', 'warn.bpmn');
        expect(res.status).toBe(1);
        expect(res.stdout).toMatch(/^::error file=bad\.puml,line=3,title=c4builder plantuml::Syntax Error/m);
        expect(res.stdout).toMatch(
            /^::warning file=warn\.bpmn,line=\d+,col=\d+,title=c4builder bpmn \[c4builder\/gateway-flow-labels\]::F3: /m
        );
        expect(res.stdout).not.toMatch(/[✓✗⚠]/);
        const loose = checkEnv({}, '--format', 'github', 'warn.bpmn');
        expect(loose.status, loose.stderr).toBe(0);
        const strict = checkEnv({}, '--format', 'github', '--strict', 'warn.bpmn');
        expect(strict.status).toBe(1);
        expect(strict.stdout).toBe(loose.stdout);
        const ws = checkEnv({ GITHUB_WORKSPACE: path.dirname(dir) }, '--format', 'github', 'bad.puml');
        expect(ws.stdout).toMatch(new RegExp(`^::error file=${path.basename(dir)}/bad\\.puml,line=3,`, 'm'));
    });

    it('gitlab: Code Quality с check_name, severity, location; без файлов → `[]`, код 0', () => {
        const res = checkEnv({}, '--format', 'gitlab', 'bad.puml');
        expect(res.status).toBe(1);
        const [issue, ...rest] = JSON.parse(res.stdout);
        expect(rest).toEqual([]);
        expect(issue).toMatchObject({
            check_name: 'plantuml',
            severity: 'major',
            location: { path: 'bad.puml', lines: { begin: 3 } }
        });
        const empty = checkEnv({}, '--format', 'gitlab');
        expect(empty.status, empty.stderr).toBe(0);
        expect(empty.stdout).toBe('[]\n');
        const ghEmpty = checkEnv({}, '--format', 'github');
        expect(ghEmpty.status).toBe(0);
        expect(ghEmpty.stdout).toBe('');
    });

    it('неизвестный формат → код 1 со списком форматов', () => {
        const res = checkEnv({}, '--format', 'xml', 'ok.puml');
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(/text, json, github, gitlab/);
        expect(res.stdout).toBe('');
    });
});
