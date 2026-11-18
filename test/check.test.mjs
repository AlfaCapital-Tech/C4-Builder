import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
// input — stdin процесса (`--files-from -`).
const run = (args, { env = {}, input } = {}) => {
    const clean = { ...process.env };
    delete clean.GITHUB_WORKSPACE;
    delete clean.CI_PROJECT_DIR;
    return spawnSync(process.execPath, [CLI, ...args], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 60_000,
        input,
        env: { ...clean, ...env }
    });
};
const checkEnv = (env, ...args) => run(['check', ...args], { env });
// Номер строки (с 1) первой строки фикстуры с подстрокой needle: ожидания не зависят от правки
// текста вокруг блока.
const lineOf = (name, needle) =>
    fs
        .readFileSync(path.join(dir, name), 'utf8')
        .split('\n')
        .findIndex((l) => l.includes(needle)) + 1;

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
    // Общая библиотека с ошибкой, импортированная двумя диаграммами (дедуп замечаний отчёта).
    fs.mkdirSync(path.join(dir, 'lib'));
    write('lib/broken.d2', 'a -> \n');
    write('use1.d2', 'x: @lib/broken\n');
    write('use2.d2', 'y: @lib/broken\n');
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
    // Битый XML: позицию парсер вписывает в текст ошибки.
    write('broken.bpmn', '<?xml version="1.0"?>\n<a>\n<b>\n</a>\n');
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
    // Блоки ```plantuml в markdown (issue #91) — в подпапке: `!include` блока ищется от папки
    // файла, а не от cwd, и по подпапке видно, что check ничего не пишет.
    fs.mkdirSync(path.join(dir, 'md'));
    const md = (name, lines) => write(`md/${name}`, `${lines.join('\n')}\n`);
    const intro = ['# Design', '', 'Text before the diagram.', ''];
    md('ok.md', [...intro, '```plantuml', '@startuml', 'Alice -> Bob : hi', '@enduml', '```', '', 'After.']);
    // Без @startuml/@enduml — обёртку добавляет разбор блока, как в сборке.
    md('bare.md', [...intro, '```plantuml', 'Alice -> Bob : hi', '```']);
    // Блок открывается в строке 10, ошибка — в строке 13 файла: с обёрткой и без неё.
    const pad = [...intro, 'One.', '', 'Two.', '', 'Three.'];
    md('bad-wrapped.md', [
        ...pad,
        '```plantuml',
        '@startuml',
        'Alice -> Bob : hi',
        'foo bar baz',
        '@enduml',
        '```'
    ]);
    md('bad-bare.md', [...pad, '```plantuml', 'Alice -> Bob : a', 'Bob -> Alice : b', 'foo bar baz', '```']);
    // Три блока, ошибки в первом и третьем (содержимое разное — одинаковые схлопываются).
    md('multi.md', [
        ...intro,
        '```plantuml',
        'Alice -> Bob : one',
        'broken one here',
        '```',
        '',
        '```plantuml',
        'Alice -> Bob : two',
        '```',
        '',
        '~~~plantuml',
        '@startuml',
        'Alice -> Bob : three',
        'broken three here',
        '@enduml',
        '~~~'
    ]);
    const same = ['```plantuml', 'Alice -> Bob : same', 'same broken line', '```'];
    md('dup.md', [...intro, ...same, '', 'Between.', '', ...same]);
    md('plain.md', [...intro, 'No diagrams here, only `inline code` and a [link](ok.md).']);
    // Не `plantuml` — код, а не диаграмма: заведомо битое содержимое не проверяется.
    md('other.md', [
        ...intro,
        '```puml',
        'foo bar baz',
        '```',
        '',
        '```d2',
        'a -> ',
        '```',
        '',
        '```mermaid',
        'flowchart LR',
        '  A -->> ((B',
        '```',
        '',
        '```text',
        '@startuml',
        'foo bar baz',
        '```'
    ]);
    // Имя библиотеки не совпадает с файлами в cwd: в режиме -pipe PlantUML сперва ищет
    // включение в текущем каталоге и только потом — в папке файла.
    write('md/md-lib.iuml', '!procedure $hello()\nAlice -> Bob : hello\n!endprocedure\n');
    md('include.md', [...intro, '```plantuml', '!include md-lib.iuml', '$hello()', '```']);
    md('list.md', [
        '# Steps',
        '',
        '1. First step:',
        '',
        '   ```plantuml',
        '   @startuml',
        '   Alice -> Bob : in a list',
        '   @enduml',
        '   ```',
        '',
        '2. Broken step:',
        '',
        '   ```plantuml',
        '   Alice -> Bob : in a list too',
        '   list broken line',
        '   ```'
    ]);
    // Движок считает строку ошибки от `@start…`: строки блока перед директивой номер не сдвигают.
    md('lead.md', [
        ...intro,
        '```plantuml',
        '',
        "' comment before the directive",
        '@startuml',
        'Alice -> Bob : hi',
        'lead broken line',
        '@enduml',
        '```'
    ]);
    // `@startuml` в середине строки — не директива: блок получает обёртку, строка — файла.
    md('mention.md', [
        ...intro,
        '```plantuml',
        'Alice -> Bob : see @startuml docs',
        'mention broken line',
        '```'
    ]);
    // Директива с отступом внутри блока: движок её директивой не считает и оборачивает текст сам.
    md('indent.md', [
        ...intro,
        '```plantuml',
        '',
        '  @startuml',
        '  Alice -> Bob : hi',
        '  indent broken line',
        '  @enduml',
        '```'
    ]);
    // Ошибка в первом блоке, предупреждение во втором — порядок замечаний в отчёте.
    md('mix.md', [
        ...intro,
        '```plantuml',
        'Alice -> Bob : one',
        'mix broken line',
        '```',
        '',
        '```plantuml',
        '!include <C4/C4_Container>',
        'Person(u, "User")',
        'Rel(u, mixghost, "typo")',
        '```'
    ]);
    // Для подставной java (см. тест сбоя процесса): маркер в теле блока выбирает исход рендера.
    md('crash.md', [
        ...intro,
        '```plantuml',
        'FAKE_SYNTAX one',
        '```',
        '',
        '```plantuml',
        'FAKE_CRASH',
        '```',
        '',
        '```plantuml',
        'Alice -> Bob : fine',
        '```',
        '',
        '```plantuml',
        'FAKE_SYNTAX four',
        '```'
    ]);
    // Связь на необъявленный алиас: строка 8 (блок без обёртки) и строка 15 (с обёрткой).
    md('rels.md', [
        '# Rels',
        '',
        '```plantuml',
        '!include <C4/C4_Container>',
        'Person(u, "User")',
        'System(s, "S")',
        'Rel(u, s, "ok")',
        'Rel(u, ghost1, "typo")',
        '```',
        '',
        '```plantuml',
        '@startuml',
        '!include <C4/C4_Container>',
        'Person(u, "User")',
        'Rel(u, ghost2, "typo")',
        '@enduml',
        '```'
    ]);
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
            /✗ what\.txt: unsupported extension \(expected \.puml, \.iuml, \.d2, \.bpmn, \.mmd, \.wireflow\.json or \.md\)/
        );
        expect(res.stderr).toMatch(/✗ missing\.puml: ENOENT/);
        const bare = check('d2', 'mmd', 'puml');
        expect(bare.status).toBe(1);
        for (const name of ['d2', 'mmd', 'puml'])
            expect(bare.stderr).toMatch(new RegExp(`^✗ ${name}: unsupported extension`, 'm'));
        const usage = check();
        expect(usage.status).toBe(1);
        expect(usage.stdout).toMatch(
            /usage: c4builder check \[--strict\] <file\.\.\.> .*\| \.mmd \| \.wireflow\.json \| \.md\)/
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
        expect(res.stderr).toMatch(/⚠ warn\.bpmn: F3 \[c4builder\/gateway-flow-labels\]/);
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
        expect(warn.stderr).toMatch(/⚠ warn\.wireflow\.json: .*no-such-template/);
        expect(warn.stdout).toMatch(/✓ warn\.wireflow\.json/);
        const ctrl = check('ctrl.wireflow.json');
        expect(ctrl.status, ctrl.stderr).toBe(0);
        expect(ctrl.stdout).toMatch(/✓ ctrl\.wireflow\.json/);
    });

    it('Rel/Lay на необъявленный алиас → ⚠ с номером строки, код 0; с --strict → ✗, код 1', () => {
        const res = check('dangling.puml', 'implicit.puml');
        expect(res.status, res.stderr).toBe(0);
        expect(res.stderr).toMatch(/^⚠ dangling\.puml: line 7: Rel to undeclared element "typo"$/m);
        expect(res.stderr).toMatch(/^⚠ dangling\.puml: line 9: Rel to undeclared element "nope"$/m);
        expect(res.stderr).toMatch(/^⚠ dangling\.puml: line 11: Lay_R to undeclared element "ghost"$/m);
        expect(res.stderr.match(/⚠/g)).toHaveLength(3); // объявленные u и c1 не задеты
        expect(res.stdout).toMatch(/✓ implicit\.puml/);

        const variants = check('rel-variants.puml');
        expect(variants.status, variants.stderr).toBe(0);
        expect(variants.stderr).toMatch(
            /^⚠ rel-variants\.puml: line 5: BiRel to undeclared element "bogus"$/m
        );
        expect(variants.stderr).toMatch(
            /^⚠ rel-variants\.puml: line 6: RelIndex to undeclared element "missing"$/m
        );
        expect(variants.stderr.match(/⚠/g)).toHaveLength(2);

        const forms = check('rel-forms.puml');
        expect(forms.status, forms.stderr).toBe(0);
        for (const [line, alias] of [
            [5, 'nope1'],
            [6, 'nope2'],
            [8, 'nope3']
        ])
            expect(forms.stderr).toMatch(
                new RegExp(
                    `^⚠ rel-forms\\.puml: line ${line}: RelIndex to undeclared element "${alias}"$`,
                    'm'
                )
            );
        // Многострочный вызов — строка имени макроса.
        expect(forms.stderr).toMatch(/^⚠ rel-forms\.puml: line 9: Rel to undeclared element "nope4"$/m);
        expect(forms.stderr).toMatch(/^⚠ rel-forms\.puml: line 11: Rel to undeclared element "nope5"$/m);
        expect(forms.stderr.match(/⚠/g)).toHaveLength(5);

        const qualified = check('rel-qualified.puml');
        expect(qualified.status, qualified.stderr).toBe(0);
        expect(qualified.stderr).toMatch(
            /^⚠ rel-qualified\.puml: line 7: Rel to undeclared element "b9\.db"$/m
        );
        expect(qualified.stderr.match(/⚠/g)).toHaveLength(1);

        const strict = check('--strict', 'dangling.puml', 'implicit.puml', 'warn.bpmn');
        expect(strict.status).toBe(1);
        expect(strict.stderr).toMatch(/^✗ dangling\.puml: 3 warning\(s\), failing with --strict$/m);
        expect(strict.stderr).toMatch(/^✗ warn\.bpmn: \d+ warning\(s\), failing with --strict$/m);
        expect(strict.stdout).toMatch(/✓ implicit\.puml/);
    });

    // Блоки ```plantuml в `.md` (issue #91).

    it('.md: корректные блоки (с @startuml и без), !include из папки файла → ✓, код 0', () => {
        const res = check('md/ok.md', 'md/bare.md', 'md/include.md');
        expect(res.status, res.stderr).toBe(0);
        for (const name of ['ok', 'bare', 'include'])
            expect(res.stdout).toMatch(new RegExp(`^✓ md/${name}\\.md$`, 'm'));
        expect(res.stderr).not.toMatch(/[✗⚠]/);
    });

    it('.md: ошибка блока → `✗ <file>: line N` со строкой файла, с обёрткой и без — номер один; код 1', () => {
        const res = check('md/bad-wrapped.md', 'md/bad-bare.md', 'md/ok.md');
        expect(res.status).toBe(1);
        expect(lineOf('md/bad-wrapped.md', '```plantuml')).toBe(10);
        expect(lineOf('md/bad-bare.md', '```plantuml')).toBe(10);
        expect(res.stderr).toMatch(/^✗ md\/bad-wrapped\.md: line 13: Syntax Error/m);
        expect(res.stderr).toMatch(/^✗ md\/bad-bare\.md: line 13: Syntax Error/m);
        expect(res.stderr.match(/✗/g)).toHaveLength(2);
        expect(res.stdout).toMatch(/✓ md\/ok\.md/); // остальные файлы всё равно проверены
    });

    it('.md: три блока, два с ошибкой → две строки ✗; одинаковые блоки → одна, строка первого', () => {
        const multi = check('md/multi.md');
        expect(multi.status).toBe(1);
        const one = lineOf('md/multi.md', 'broken one here');
        const three = lineOf('md/multi.md', 'broken three here');
        expect(multi.stderr).toMatch(new RegExp(`^✗ md/multi\\.md: line ${one}: Syntax Error`, 'm'));
        expect(multi.stderr).toMatch(new RegExp(`^✗ md/multi\\.md: line ${three}: Syntax Error`, 'm'));
        expect(multi.stderr.match(/✗/g)).toHaveLength(2);
        expect(multi.stdout).not.toMatch(/✓/);

        const dup = check('md/dup.md');
        expect(dup.status).toBe(1);
        expect(dup.stderr).toMatch(
            new RegExp(`^✗ md/dup\\.md: line ${lineOf('md/dup.md', 'same broken line')}: Syntax Error`, 'm')
        );
        expect(dup.stderr.match(/✗/g)).toHaveLength(1);
    });

    it('.md: строки перед @startuml, упоминание @startuml в тексте, директива с отступом → строка файла', () => {
        const res = check('md/lead.md', 'md/mention.md', 'md/indent.md');
        expect(res.status).toBe(1);
        for (const name of ['lead', 'mention', 'indent']) {
            const line = lineOf(`md/${name}.md`, `${name} broken line`);
            expect(res.stderr).toMatch(new RegExp(`^✗ md/${name}\\.md: line ${line}: Syntax Error`, 'm'));
        }
        expect(res.stderr.match(/✗/g)).toHaveLength(3);
    });

    // Подставная java вместо моков процесса: `-version` проходит резолв JRE, дальше исход
    // рендера выбирает маркер во входе. Настоящий сбой JVM (таймаут 120 с, нехватка памяти)
    // в тесте не воспроизвести. Скрипт POSIX — на Windows пропускаем.
    it.skipIf(process.platform === 'win32')(
        '.md: сбой процесса на одном блоке — замечание блока, ошибки остальных не теряются',
        () => {
            const bin = path.join(dir, 'fake-jre', 'bin');
            fs.mkdirSync(bin, { recursive: true });
            fs.writeFileSync(
                path.join(bin, 'java'),
                [
                    '#!/bin/sh',
                    'if [ "$1" = "-version" ]; then echo \'openjdk version "21.0.0"\' >&2; exit 0; fi',
                    'src=$(cat)',
                    'case "$src" in',
                    "  *FAKE_CRASH*) echo 'java.lang.OutOfMemoryError: fake heap' >&2; exit 1 ;;",
                    "  *FAKE_SYNTAX*) printf 'ERROR\\n1\\nSyntax Error?\\n' >&2; exit 200 ;;",
                    '  *) echo \'<svg xmlns="http://www.w3.org/2000/svg"></svg>\' ;;',
                    'esac',
                    ''
                ].join('\n'),
                { mode: 0o755 }
            );
            const env = { JAVA_HOME: path.join(dir, 'fake-jre') };
            const one = lineOf('md/crash.md', 'FAKE_SYNTAX one');
            const crash = lineOf('md/crash.md', 'FAKE_CRASH') - 1; // строка открывающей fence
            const four = lineOf('md/crash.md', 'FAKE_SYNTAX four');

            const res = checkEnv(env, '--verbose', 'md/crash.md');
            expect(res.status).toBe(1);
            const lines = res.stderr.split('\n').filter((l) => l.startsWith('✗'));
            expect(lines).toEqual([
                `✗ md/crash.md: line ${one}: Syntax Error?`,
                `✗ md/crash.md: line ${crash}: PlantUML exited with code 1 (run with --verbose for details)`,
                `✗ md/crash.md: line ${four}: Syntax Error?`
            ]);
            // Полный вывод процесса — только по --verbose.
            expect(res.stderr).toContain('java.lang.OutOfMemoryError: fake heap');
            expect(checkEnv(env, 'md/crash.md').stderr).not.toContain('OutOfMemoryError');

            const report = checkEnv(env, '--format', 'json', 'md/crash.md');
            expect(report.status).toBe(1);
            const list = JSON.parse(report.stdout);
            expect(list.map((d) => [d.line, d.severity, d.engine])).toEqual(
                [one, crash, four].map((line) => [line, 'error', 'plantuml'])
            );
            expect(list[1].message).toMatch(/^PlantUML exited with code 1\n.*OutOfMemoryError/s);
        }
    );

    it('.md: блок в пункте списка проверяется, строка — файла', () => {
        const res = check('md/list.md');
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(
            new RegExp(`^✗ md/list\\.md: line ${lineOf('md/list.md', 'list broken line')}: Syntax Error`, 'm')
        );
        expect(res.stderr.match(/✗/g)).toHaveLength(1); // первый блок списка корректен
    });

    it('.md без блоков plantuml (в т. ч. с битыми puml/d2/mermaid/text) → ✓, код 0, java не нужна', () => {
        // Без java в окружении: резолв JRE пошёл бы в сеть и уронил тест — значит, его не было.
        const res = run(['check', 'md/plain.md', 'md/other.md'], {
            env: {
                PATH: path.join(dir, 'no-path'),
                JAVA_HOME: '',
                XDG_CACHE_HOME: path.join(dir, 'no-cache'),
                LOCALAPPDATA: path.join(dir, 'no-cache')
            }
        });
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toBe('✓ md/plain.md\n✓ md/other.md\n');
        expect(res.stderr).toBe('');
        expect(fs.existsSync(path.join(dir, 'no-cache'))).toBe(false);
    });

    it('.md: check ничего не пишет рядом с файлом', () => {
        const list = () => fs.readdirSync(path.join(dir, 'md')).sort();
        const before = list();
        check('md/ok.md', 'md/bad-bare.md', 'md/rels.md');
        expect(list()).toEqual(before);
    });

    it('.md: связь на необъявленный алиас → ⚠ со строкой файла; с --strict → ✗, код 1', () => {
        const res = check('md/rels.md');
        expect(res.status, res.stderr).toBe(0);
        expect(res.stderr).toMatch(/^⚠ md\/rels\.md: line 8: Rel to undeclared element "ghost1"$/m);
        expect(res.stderr).toMatch(/^⚠ md\/rels\.md: line 15: Rel to undeclared element "ghost2"$/m);
        expect(res.stderr.match(/⚠/g)).toHaveLength(2);
        expect(res.stdout).toMatch(/^✓ md\/rels\.md$/m);

        const strict = check('--strict', 'md/rels.md');
        expect(strict.status).toBe(1);
        expect(strict.stderr).toMatch(/^✗ md\/rels\.md: 2 warning\(s\), failing with --strict$/m);
        expect(strict.stdout).not.toMatch(/✓/);
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

    it('json: блоки plantuml в .md — файл .md, строка файла, движок plantuml; без диаграмм → `[]`', () => {
        const error = (file, line) => ({
            file,
            line,
            column: null,
            engine: 'plantuml',
            severity: 'error',
            rule: null,
            element: null
        });
        const { res, list } = json('md/ok.md', 'md/bad-wrapped.md', 'md/multi.md');
        expect(res.status).toBe(1);
        expect(list.map(pick)).toEqual([
            error('md/bad-wrapped.md', 13),
            error('md/multi.md', lineOf('md/multi.md', 'broken one here')),
            error('md/multi.md', lineOf('md/multi.md', 'broken three here'))
        ]);
        // Позиция — в line, а не в тексте.
        for (const d of list) expect(d.message).toMatch(/^Syntax Error/);

        const plain = json('md/plain.md', 'md/other.md');
        expect(plain.res.status, plain.res.stderr).toBe(0);
        expect(plain.list).toEqual([]);

        const warned = json('md/rels.md');
        expect(warned.res.status, warned.res.stderr).toBe(0);
        expect(warned.list.map(pick)).toEqual(
            [
                [8, 'ghost1'],
                [15, 'ghost2']
            ].map(([line, element]) => ({
                file: 'md/rels.md',
                line,
                column: null,
                engine: 'plantuml',
                severity: 'warning',
                rule: 'undeclared-element',
                element
            }))
        );
    });

    it('json: замечания одного .md — по возрастанию строки (ошибка блока 1 перед предупреждением блока 2)', () => {
        const { res, list } = json('md/mix.md');
        expect(res.status).toBe(1);
        expect(list.map((d) => [d.severity, d.line])).toEqual([
            ['error', lineOf('md/mix.md', 'mix broken line')],
            ['warning', lineOf('md/mix.md', 'mixghost')]
        ]);
        // Текстовый режим не меняется: предупреждения печатаются перед строкой результата файла.
        const text = check('md/mix.md');
        expect(text.stderr.indexOf('⚠ md/mix.md')).toBeLessThan(text.stderr.indexOf('✗ md/mix.md'));
    });

    it('github: ошибка блока .md → ::error со строкой файла .md', () => {
        const res = checkEnv({}, '--format', 'github', 'md/bad-wrapped.md');
        expect(res.status).toBe(1);
        expect(res.stdout).toMatch(
            /^::error file=md\/bad-wrapped\.md,line=13,title=c4builder plantuml::Syntax Error/m
        );
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

    it('json: позиция из текста движка (XML BPMN, JSON wireflow) — в line/column, не в message', () => {
        fs.writeFileSync(path.join(dir, 'broken.wireflow.json'), '{\n "a": 1,\n\n}\n');
        const { list } = json('broken.bpmn', 'broken.wireflow.json');
        expect(list.map(pick)).toEqual([
            {
                file: 'broken.bpmn',
                line: 4,
                column: 1,
                engine: 'bpmn',
                severity: 'error',
                rule: null,
                element: null
            },
            {
                file: 'broken.wireflow.json',
                line: 4,
                column: 1,
                engine: 'wireflow',
                severity: 'error',
                rule: null,
                element: null
            }
        ]);
        for (const d of list) expect(d.message).not.toMatch(/\bline\b|column|position/);
        // Текст — прежний, с позицией внутри.
        const text = check('broken.bpmn');
        expect(text.stderr).toMatch(/^✗ broken\.bpmn: invalid BPMN XML: .*line: 3, column: 0/m);
    });

    it('ошибка в общем импортируемом .d2 — одно замечание на весь отчёт', () => {
        const { res, list } = json('use1.d2', 'use2.d2');
        expect(res.status).toBe(1);
        expect(list.map(pick)).toEqual([
            {
                file: 'lib/broken.d2',
                line: 1,
                column: 1,
                engine: 'd2',
                severity: 'error',
                rule: null,
                element: null
            }
        ]);
        // В тексте — по строке на проверяемый файл, как раньше.
        expect(check('use1.d2', 'use2.d2').stderr.match(/✗ use\d\.d2: /g)).toHaveLength(2);
    });

    it('--files-from: stdin и файл, пустые строки пропускаются, объединение с аргументами', () => {
        const fromStdin = run(['check', '--format', 'json', 'what.txt', '--files-from', '-'], {
            input: 'ok.puml\n\n  \nbad.puml\r\n'
        });
        expect(fromStdin.status).toBe(1);
        expect(JSON.parse(fromStdin.stdout).map((d) => d.file)).toEqual(['what.txt', 'bad.puml']);
        fs.writeFileSync(path.join(dir, 'list.txt'), 'bad.puml\n');
        const fromFile = run(['check', '--format', 'json', '--files-from', 'list.txt']);
        expect(JSON.parse(fromFile.stdout).map((d) => d.file)).toEqual(['bad.puml']);
        // Текст: файлы из списка проверяются так же.
        const text = run(['check', '--files-from', '-'], { input: 'ok.puml\nbad.puml\n' });
        expect(text.status).toBe(1);
        expect(text.stdout).toMatch(/✓ ok\.puml/);
        expect(text.stderr).toMatch(/✗ bad\.puml: line 3: /);
    });

    it('--files-from: пустой список → пустой отчёт и код 0 (и в тексте); нет файла списка → код 1', () => {
        for (const [format, out] of [
            ['json', '[]\n'],
            ['gitlab', '[]\n'],
            ['github', '']
        ]) {
            const res = run(['check', '--format', format, '--files-from', '-'], { input: '' });
            expect(res.status, res.stderr).toBe(0);
            expect(res.stdout).toBe(out);
        }
        const text = run(['check', '--files-from', '-'], { input: '\n' });
        expect(text.status, text.stderr).toBe(0);
        expect(text.stdout).toBe('');
        const missing = run(['check', '--format', 'json', '--files-from', 'nope.txt']);
        expect(missing.status).toBe(1);
        expect(missing.stderr).toMatch(/--files-from: cannot read nope\.txt/);
        expect(missing.stdout).toBe('');
    });

    it('GITHUB_WORKSPACE через симлинк → путь от физического каталога, без `../`', () => {
        const link = path.join(fs.realpathSync(os.tmpdir()), `c4b-ws-link-${process.pid}`);
        fs.rmSync(link, { force: true });
        fs.symlinkSync(path.dirname(dir), link);
        try {
            const res = checkEnv({ GITHUB_WORKSPACE: link }, '--format', 'github', 'bad.puml');
            expect(res.stdout).toMatch(
                new RegExp(`^::error file=${path.basename(dir)}/bad\\.puml,line=3,`, 'm')
            );
        } finally {
            fs.rmSync(link, { force: true });
        }
    });

    it('--format и --files-from у другой команды или сборки → ошибка и код 1', () => {
        const doctor = run(['doctor', '--format', 'json']);
        expect(doctor.status).toBe(1);
        expect(doctor.stderr).toMatch(/--format is only supported by check \(use --json for doctor\)/);
        expect(doctor.stdout).toBe('');
        const build = run(['--files-from', 'list.txt']);
        expect(build.status).toBe(1);
        expect(build.stderr).toMatch(/--files-from is only supported by check/);
    });

    it('неизвестный формат → код 1 со списком форматов', () => {
        const res = checkEnv({}, '--format', 'xml', 'ok.puml');
        expect(res.status).toBe(1);
        expect(res.stderr).toMatch(/text, json, github, gitlab/);
        expect(res.stdout).toBe('');
    });
});
