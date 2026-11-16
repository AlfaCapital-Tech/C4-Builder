import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT, TMP_ROOT } from './helpers.mjs';

// Онлайн-рендер PlantUML удалён (change remove-remote-plantuml): старый конфиг с
// `generateLocalImages: false` не ломает сборку — предупреждение до сборки, диаграммы всё равно
// рендерятся локально. `true` и конфиг без ключей проверяют юнит-тесты configWarnings
// (config.test.mjs). Java резолвит сам CLI (как в golden) — в CI она есть.
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');
const CONFIG = {
    ...JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'test', 'fixtures', 'default.c4builder.json'), 'utf8')
    ),
    // Подстрока в имени проекта попадает в index.html встроенного шаблона — это не тег клиентского
    // рендера, предупреждения о docsify-plantuml быть не должно.
    projectName: 'legacy-docsify-plantuml',
    generateLocalImages: false,
    plantumlServerUrl: 'https://www.plantuml.com/plantuml'
};

fs.mkdirSync(TMP_ROOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'legacy-local-images-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// В формате configstore (табы, без перевода строки в конце), как его пишут мастер и `new -y`:
// сборка перезаписывает файл (`hasRun`), и побайтное сравнение ловит любую правку ключей.
const CONFIG_TEXT = JSON.stringify(CONFIG, undefined, '\t');
let res;
let out;

// Проект с PlantUML и D2: D2 онлайн-сервера и раньше не имел, PlantUML уходил на plantuml.com.
beforeAll(() => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'README.md'), '# Overview\n\nBody.\n');
    fs.writeFileSync(path.join(dir, 'src', 'context.puml'), '@startuml\nAlice -> Bob: hi\n@enduml\n');
    fs.writeFileSync(path.join(dir, 'src', 'flow.d2'), 'a -> b\n');
    fs.writeFileSync(path.join(dir, '.c4builder'), CONFIG_TEXT);
    // Без терминала: если мастер решит что-то спросить, он упадёт, а не повиснет.
    res = spawnSync(process.execPath, [CLI], { cwd: dir, encoding: 'utf8', input: '', timeout: 240_000 });
    out = `${res.stdout}${res.stderr}`;
});

// Текстовые выходы сборки (страницы, index.html, llms, вендорные скрипты), где встречается адрес
// сервера рендера: имена, а не содержимое — иначе упавший expect вывалит мегабайты JS.
const leaking = () =>
    fs
        .readdirSync(path.join(dir, 'docs'), { recursive: true })
        .map(String)
        .filter((f) => /\.(md|html|js|txt)$/.test(f))
        .filter((f) => fs.readFileSync(path.join(dir, 'docs', f), 'utf8').includes('plantuml.com'));

describe('старый конфиг с generateLocalImages: false', () => {
    it('код 0, предупреждение с обоими ключами — до сборки и один раз', () => {
        expect(res.status, out).toBe(0);
        const warning = out.indexOf('generateLocalImages and plantumlServerUrl are ignored');
        expect(warning).toBeGreaterThanOrEqual(0);
        expect(warning).toBeLessThan(out.indexOf('building documentation'));
        expect(out.match(/generateLocalImages/g)).toHaveLength(1);
    });

    it('PlantUML и D2 отрендерены локально, адреса сервера в выходах нет', () => {
        expect(fs.readdirSync(path.join(dir, 'docs'))).toEqual(
            expect.arrayContaining(['context.svg', 'flow.svg'])
        );
        expect(fs.readFileSync(path.join(dir, 'docs', 'README.md'), 'utf8')).toContain('context.svg');
        expect(leaking()).toEqual([]);
    });

    it('встроенный шаблон: «docsify-plantuml» в имени проекта — не повод для предупреждения', () => {
        expect(fs.readFileSync(path.join(dir, 'docs', 'index.html'), 'utf8')).toContain(
            'legacy-docsify-plantuml'
        );
        expect(out).not.toContain('docsifyTemplate loads docsify-plantuml');
    });

    it('.c4builder побайтно не изменён', () => {
        expect(fs.readFileSync(path.join(dir, '.c4builder'), 'utf8')).toBe(CONFIG_TEXT);
    });
});
