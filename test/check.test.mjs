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
const check = (...files) =>
    spawnSync(process.execPath, [CLI, 'check', ...files], { cwd: dir, encoding: 'utf8' });

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(REPO_ROOT, 'test', '.tmp-check-'));
    const write = (name, content) => fs.writeFileSync(path.join(dir, name), content);
    write('ok.puml', '@startuml\nAlice -> Bob : hi\n@enduml\n');
    write('bad.puml', '@startuml\nAlice -> Bob : hi\nfoo bar baz\n@enduml\n');
    write('lib.iuml', '!procedure $x()\nAlice -> Bob\n!endprocedure\n');
    write('bad.iuml', '!procedure $x(\nAlice -> Bob\n');
    write('uses-lib.puml', '@startuml\n!include lib.iuml\n$x()\n@enduml\n');
    write('ok.d2', 'a -> b\n');
    write('bad.d2', 'a -> \n');
    write('what.txt', 'x');
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
        expect(res.stderr).toMatch(/✗ bad\.puml: строка 3: Syntax Error/);
        expect(res.stdout).toMatch(/✓ ok\.puml/); // остальные файлы всё равно проверены
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
        expect(res.stderr).toMatch(/✗ what\.txt: неизвестное расширение/);
        expect(res.stderr).toMatch(/✗ missing\.puml: ENOENT/);
        expect(check().status).toBe(1);
    });
});
