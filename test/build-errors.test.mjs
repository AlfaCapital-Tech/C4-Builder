import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import figlet from 'figlet';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    BpmnError,
    DiagramBuildError,
    debugEnabled,
    defaultConfig,
    describeRenderError,
    MermaidError,
    plantUmlInputError,
    VERBOSE_HINT,
    WireflowError
} from './dist.mjs';
import { ensureManagedJre, REPO_ROOT, TMP_ROOT } from './helpers.mjs';

// Ошибки диаграмм в строгой сборке (issue #62, change build-diagram-errors): формат check,
// все сломанные за прогон, код 1 без стеков; подробности — по --verbose / DEBUG; баннер — в TTY.

const CLI = path.join(REPO_ROOT, 'dist', 'index.js');

// stderr PlantUML из issue: Java-стек, а суть — в хвостовом блоке ERROR / позиция / описание.
const ISSUE_STDERR = [
    'PlantUML exited with code 200',
    'java.lang.StringIndexOutOfBoundsException: Index 16 out of bounds for length 16',
    '\tat java.base/java.lang.String.charAt(String.java:1624)',
    '\tat net.sourceforge.plantuml.tim.Eater.eatOneChar(Eater.java:247)',
    '\tat net.sourceforge.plantuml.Run.main(Run.java:183)',
    'ERROR',
    '3',
    'Fatal parsing error'
].join('\n');

describe('describeRenderError — общий разбор для check и сборки', () => {
    it('PlantUML с блоком ERROR → `line N+1: msg`, Java-стек отброшен', () => {
        expect(describeRenderError(new Error(ISSUE_STDERR))).toEqual(['line 4: Fatal parsing error']);
        expect(plantUmlInputError(new Error(ISSUE_STDERR))).toEqual({
            line: 4,
            message: 'Fatal parsing error'
        });
    });

    it('.iuml (lib) — без номера строки: позиция относится к обёртке', () => {
        expect(describeRenderError(new Error(ISSUE_STDERR), { lib: true })).toEqual(['Fatal parsing error']);
    });

    it('BPMN / mermaid / wireflow → их problems по строке', () => {
        expect(describeRenderError(new BpmnError('a.bpmn', ['T [rule] x', 'U [rule] y']))).toEqual([
            'T [rule] x',
            'U [rule] y'
        ]);
        expect(describeRenderError(new MermaidError('a.mmd', 'line 2: Expecting X'))).toEqual([
            'line 2: Expecting X'
        ]);
        expect(
            describeRenderError(new WireflowError('a.json', ['edge "e": target "x9" is not a node']))
        ).toEqual(['edge "e": target "x9" is not a node']);
    });

    it('сбой процесса PlantUML без ERROR → первая строка и подсказка про --verbose', () => {
        const err = new Error(
            'PlantUML exited with code 1\njava.lang.OutOfMemoryError: Java heap space\n\tat x'
        );
        expect(describeRenderError(err)).toEqual([`PlantUML exited with code 1 ${VERBOSE_HINT}`]);
        // Без хвоста подсказывать нечего.
        expect(describeRenderError(new Error('PlantUML exited with code 1\n'))).toEqual([
            'PlantUML exited with code 1\n'
        ]);
    });

    it('прочее — message целиком (как check), не-Error — строкой', () => {
        const d2 = new Error('D2 compile error (a.d2):\na.d2:1:1: connection missing destination');
        expect(describeRenderError(d2)).toEqual([d2.message]);
        expect(describeRenderError('boom')).toEqual(['boom']);
    });

    it('DiagramBuildError — порядок обхода, а не завершения', () => {
        const e = new DiagramBuildError([
            { index: 5, file: 'b.d2', problems: ['bad'], cause: new Error('bad') },
            { index: 1, file: 'a.puml', problems: ['line 4: x'], cause: new Error('x') }
        ]);
        expect(e.failures.map((f) => f.file)).toEqual(['a.puml', 'b.d2']);
        expect(e.message).toBe('2 diagrams failed to render:\na.puml: line 4: x\nb.d2: bad');
        expect(e.reported).toBe(false);
    });

    it('DEBUG: c4builder или * в списке через запятую/пробел', () => {
        expect(debugEnabled('c4builder')).toBe(true);
        expect(debugEnabled('express:*,c4builder')).toBe(true);
        expect(debugEnabled('foo *')).toBe(true);
        expect(debugEnabled('c4builder-x,foo')).toBe(false);
        expect(debugEnabled('')).toBe(false);
        expect(debugEnabled(undefined)).toBe(false);
    });
});

describe('строгая сборка со сломанными диаграммами (CLI)', () => {
    let dir;
    let env;
    const BROKEN_PUML = '@startuml\n!include <C4/C4_Context>\nPerson(u, "User")\nRel(u, s, "uses"\n@enduml\n';
    const GOOD_PUML = '@startuml\nA -> B: ok\n@enduml\n';

    beforeAll(async () => {
        env = { ...process.env, JAVA_HOME: await ensureManagedJre() };
        delete env.DEBUG;
        fs.mkdirSync(TMP_ROOT, { recursive: true });
        dir = fs.mkdtempSync(path.join(TMP_ROOT, 'build-errors-'));
    });
    afterAll(() => {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    const project = (name, files, config = {}) => {
        const root = path.join(dir, name);
        for (const [rel, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        }
        fs.writeFileSync(
            path.join(root, '.c4builder'),
            JSON.stringify({ ...defaultConfig, projectName: name, hasRun: true, ...config })
        );
        return root;
    };
    const run = (cwd, args = [], extraEnv = {}) => {
        const res = spawnSync(process.execPath, [CLI, ...args], {
            cwd,
            encoding: 'utf8',
            input: '',
            timeout: 240_000,
            env: { ...env, ...extraEnv }
        });
        return { ...res, out: `${res.stdout}${res.stderr}` };
    };

    it('фикстура из issue: строка как у check, все сломанные в порядке обхода, корректная отрендерена, код 1 без стеков', () => {
        const root = project('issue', {
            'src/README.md': '# Home\n',
            'src/dangling.puml': GOOD_PUML,
            'src/ok.puml': GOOD_PUML,
            'src/zz.d2': 'a -> b\n'
        });
        // Первая удачная сборка — чтобы был бэкап и строка `build aborted`.
        const first = run(root);
        expect(first.status, first.out).toBe(0);

        fs.writeFileSync(path.join(root, 'src', 'dangling.puml'), BROKEN_PUML);
        fs.writeFileSync(path.join(root, 'src', 'zz.d2'), 'a -> \n');
        fs.writeFileSync(path.join(root, 'src', 'ok.puml'), '@startuml\nA -> B: changed\n@enduml\n');
        const res = run(root);
        expect(res.status, res.out).toBe(1);
        expect(res.stderr).toMatch(/^✗ src\/dangling\.puml: line 4: Fatal parsing error$/m);
        expect(res.stderr).toMatch(/^✗ src\/zz\.d2: D2 compile error/m);
        expect(res.stderr.indexOf('dangling.puml')).toBeLessThan(res.stderr.indexOf('zz.d2'));
        // Корректная диаграмма дорендерена, несмотря на соседние ошибки.
        expect(fs.readFileSync(path.join(root, 'docs', 'ok.svg'), 'utf8')).toContain('changed');
        expect(res.out).not.toContain('java.lang.');
        expect(res.out).not.toContain('at render (');
        expect(res.out).not.toMatch(/Node\.js v\d/);
        expect(res.out).toContain('build aborted');

        // Та же строка, что печатает check для этого файла.
        const check = run(root, ['check', 'src/dangling.puml']);
        expect(check.status).toBe(1);
        expect(check.stderr.trim()).toBe('✗ src/dangling.puml: line 4: Fatal parsing error');

        // ✗ раньше `build aborted` в общем потоке (stderr → stdout, как в логе CI).
        const merged = spawnSync('/bin/sh', ['-c', `"${process.execPath}" "${CLI}" 2>&1`], {
            cwd: root,
            encoding: 'utf8',
            input: '',
            timeout: 240_000,
            env
        });
        expect(merged.status).toBe(1);
        const at = merged.stdout.indexOf('✗ src/dangling.puml');
        expect(at, merged.stdout).toBeGreaterThan(-1);
        expect(at).toBeLessThan(merged.stdout.indexOf('build aborted'));
        expect(merged.stdout.trimEnd().split('\n').pop()).not.toMatch(/Node\.js v/);

        // Подробности — только по запросу: --verbose и DEBUG=c4builder дают stderr движка со стеком.
        const verbose = run(root, ['--verbose']);
        expect(verbose.status).toBe(1);
        expect(verbose.stderr).toMatch(/^✗ src\/dangling\.puml: line 4: Fatal parsing error$/m);
        expect(verbose.stderr).toContain('java.lang.');
        const debug = run(root, [], { DEBUG: 'other,c4builder' });
        expect(debug.status).toBe(1);
        expect(debug.stderr).toContain('java.lang.');
    }, 600_000);

    it('нет java: сообщение один раз на все диаграммы, код 1', () => {
        const root = project('nojava', {
            'src/README.md': '# Home\n',
            'src/a.puml': GOOD_PUML,
            'src/b.puml': GOOD_PUML,
            'src/c.puml': GOOD_PUML
        });
        // Ни системной java (пустой PATH, без JAVA_HOME), ни кэша JRE, скачивание падает сразу.
        const empty = path.join(dir, 'nojava-env');
        fs.mkdirSync(path.join(empty, 'bin'), { recursive: true });
        const noJavaEnv = {
            ...env,
            PATH: path.join(empty, 'bin'),
            XDG_CACHE_HOME: path.join(empty, 'cache')
        };
        delete noJavaEnv.JAVA_HOME;
        delete noJavaEnv.LOCALAPPDATA;
        const res = spawnSync(process.execPath, [CLI], {
            cwd: root,
            encoding: 'utf8',
            input: '',
            timeout: 120_000,
            env: { ...noJavaEnv, C4BUILDER_HTTP_CONNECT_TIMEOUT_MS: '1', C4BUILDER_HTTP_IDLE_TIMEOUT_MS: '1' }
        });
        const out = `${res.stdout}${res.stderr}`;
        expect(res.status, out).toBe(1);
        expect(out.match(/Could not get Java to render PlantUML diagrams/g), out).toHaveLength(1);
    }, 180_000);

    it('stdout не терминал: ни баннера, ни очистки экрана (первый запуск и --docs)', () => {
        const banner = figlet
            .textSync('c4builder')
            .split('\n')
            .find((l) => l.trim());
        // Первый запуск (без hasRun) раньше чистил экран перед мастером.
        const root = project('pipe', { 'src/README.md': '# Home\n' }, { hasRun: false });
        const res = run(root);
        expect(res.status, res.out).toBe(0);
        expect(res.stdout).not.toContain(banner);
        expect(res.stdout).not.toContain('Blow up your software documentation');
        expect(res.stdout).not.toContain('\x1b[2J');
        const docs = run(dir, ['--docs']);
        expect(docs.status).toBe(0);
        expect(docs.stdout).not.toContain(banner);
        expect(docs.stdout).toContain('CONFIGURATION OPTIONS');
    }, 240_000);
});
