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
    write('ok.d2', 'a -> b\n');
    write('bad.d2', 'a -> \n');
    write('what.txt', 'x');
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
            /✗ what\.txt: unsupported extension \(expected \.puml, \.iuml, \.d2 or \.bpmn\)/
        );
        expect(res.stderr).toMatch(/✗ missing\.puml: ENOENT/);
        const usage = check();
        expect(usage.status).toBe(1);
        expect(usage.stdout).toMatch(/usage: c4builder check/);
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
});
