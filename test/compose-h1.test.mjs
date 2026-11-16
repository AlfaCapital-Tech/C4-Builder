import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { composeReadme, REPO_ROOT } from './helpers.mjs';

// 4.2: при пользовательском h1 + diagramsOnTop нессылочная диаграмма НЕ должна вставать
// выше заголовка. Проверяется compose, а не рендер: scan → compose вызываются напрямую,
// а на месте отрендеренной картинки лежит заглушка — java не нужна, тест быстрый.
let dir;
let readme;

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(REPO_ROOT, 'test', '.tmp-h1-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'index.md'), '# My Own Title\n\nBody text.\n');
    fs.writeFileSync(path.join(dir, 'src', 'a.puml'), '@startuml\nAlice -> Bob\n@enduml\n');
    fs.writeFileSync(path.join(dir, 'docs', 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    readme = await composeReadme(dir, { DIAGRAMS_ON_TOP: true });
});

afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('4.2: пользовательский h1 + diagramsOnTop', () => {
    it('заголовок остаётся первым, диаграмма — под ним', () => {
        const h1Pos = readme.indexOf('# My Own Title');
        const diagramPos = readme.indexOf('![diagram]');
        const bodyPos = readme.indexOf('Body text.');
        expect(h1Pos).toBeGreaterThanOrEqual(0);
        expect(diagramPos).toBeGreaterThanOrEqual(0);
        expect(h1Pos).toBeLessThan(diagramPos); // h1 выше диаграммы (регрессия была наоборот)
        expect(diagramPos).toBeLessThan(bodyPos); // diagramsOnTop: диаграмма выше тела
    });

    it('картинка — локальный файл рядом со страницей', () => {
        expect(readme).toContain('![diagram](a.svg)');
        expect(fs.existsSync(path.join(dir, 'docs', 'a.svg'))).toBe(true);
    });

    it('ровно один h1 в документе', () => {
        expect(readme.match(/^#\s+/gm)?.length).toBe(1);
    });
});
