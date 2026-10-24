import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { defaultConfig } from './dist.mjs';
import { REPO_ROOT, TMP_ROOT } from './helpers.mjs';

const CLI = path.join(REPO_ROOT, 'dist', 'index.js');

fs.mkdirSync(TMP_ROOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'cli-progress-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// Лог фонового `--site -w` читает агент: `\r`-прогресс склеивался там в одну строку
// на тысячи символов (issue #32, п. 3). D2 рендерится в WASM — java не нужна.
describe('прогресс сборки вне терминала', () => {
    it('без \\r, по итоговой строке на фазу', () => {
        for (const [rel, content] of Object.entries({
            'src/README.md': '# Home\n',
            'src/a.d2': 'a -> b\n',
            'src/b.d2': 'c -> d\n',
            '.c4builder': JSON.stringify({ ...defaultConfig, projectName: 'progress', hasRun: true })
        })) {
            fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
            fs.writeFileSync(path.join(dir, rel), content);
        }
        const res = spawnSync(process.execPath, [CLI], {
            cwd: dir,
            encoding: 'utf8',
            input: '',
            timeout: 120_000
        });
        expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
        expect(res.stdout).not.toContain('\r');
        expect(res.stdout).toMatch(/^processed 2 images$/m);
        expect(res.stdout).toMatch(/^processed 1 files$/m);
    });
});
