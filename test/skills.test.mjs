import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { BUILD_TIMEOUT_MS, REPO_ROOT, TMP_ROOT } from './helpers.mjs';

// Скиллы (skills/*) и template/AGENTS.md учат агентов командам CLI — дрейф «текст ↔ CLI»
// и утечка внутренних хостов ловятся здесь, в обычном `npm test`, против собранного dist/.
const CLI = path.join(REPO_ROOT, 'dist', 'index.js');
const AGENTS_MD = path.join(REPO_ROOT, 'template', 'AGENTS.md');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const SKILLS = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
const skillFile = (name) => path.join(SKILLS_DIR, name, 'SKILL.md');
const references = (name) => {
    const dir = path.join(SKILLS_DIR, name, 'references');
    return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : [];
};
const INPUTS = [...SKILLS.flatMap((name) => [skillFile(name), ...references(name)]), AGENTS_MD];
const rel = (file) => path.relative(REPO_ROOT, file);

const COMMANDS = ['check', 'jre', 'site', 'new', 'config'];
const FLAG = /(?<![\w-])--?[a-zA-Z][\w-]*/g;
const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).stdout;
const KNOWN_FLAGS = new Set(help.match(FLAG));

// Frontmatter Agent Skills — плоские `key: value` между `---`; YAML-парсера в зависимостях
// нет, а вложенные структуры спеке не нужны.
const frontmatter = (text) => {
    const block = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    return Object.fromEntries(
        block
            .split('\n')
            .map((l) => l.match(/^([\w-]+):\s*(.*)$/))
            .filter(Boolean)
            .map(([, k, v]) => [k, v.replace(/^(['"])(.*)\1$/, '$2').trim()])
    );
};

// Команды CLI в тексте: строки fenced-блоков и inline-код, начинающиеся с `c4builder`.
// Конвенция скиллов — команда всегда в коде и с `c4builder` в начале (см. design §4).
const cliCommands = (text) => {
    const fenced = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].flatMap((m) => m[1].split('\n'));
    const inline = [...text.replace(/^```[\s\S]*?^```/gm, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
    return [...fenced, ...inline]
        .map((s) => s.replace(/\s#.*$/, '').trim())
        .filter((s) => /^c4builder(\s|$)/.test(s));
};

describe('скиллы', () => {
    it('help CLI разобран', () => expect(KNOWN_FLAGS.has('--site')).toBe(true));

    it('набор скиллов — ровно поставляемый (README, AGENTS.md ссылаются на него)', () =>
        expect(SKILLS).toEqual(['c4builder', 'c4builder-setup']));

    it.each(SKILLS)('%s: frontmatter по спеке Agent Skills', (name) => {
        const file = rel(skillFile(name));
        const { name: declared, description } = frontmatter(fs.readFileSync(skillFile(name), 'utf8'));
        expect(declared, `${file}: name должен совпадать с каталогом «${name}»`).toBe(name);
        expect(name, `${file}: name — 1..64 символа a-z0-9 и одиночные дефисы`).toMatch(
            /^(?=.{1,64}$)[a-z0-9]+(-[a-z0-9]+)*$/
        );
        expect(description, `${file}: нет description`).toBeTruthy();
        expect(description?.length, `${file}: description длиннее 1024`).toBeLessThanOrEqual(1024);
    });

    it.each(INPUTS.map(rel))('%s: только существующие флаги и подкоманды CLI', (file) => {
        const unknown = cliCommands(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')).flatMap((cmd) => {
            const [, sub] = cmd.split(/\s+/);
            const flags = (cmd.match(FLAG) ?? []).filter((f) => !KNOWN_FLAGS.has(f));
            return sub && !sub.startsWith('-') && !COMMANDS.includes(sub) ? [sub, ...flags] : flags;
        });
        expect(unknown, `${file}: неизвестные CLI-флаги/подкоманды`).toEqual([]);
    });

    it.each(INPUTS.map(rel))('%s: нет внутренних хостов', (file) => {
        const found = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').match(/[\w.-]*alfacapital\.ru/gi);
        expect(found, `${file}: внутренний хост`).toBeNull();
    });
});

// AGENTS.md лежит в корне шаблона, вне src/: `--new` копирует его в проект, а сборка
// публикует только rootFolder. Java — как у пользователя (системная или managed): здесь
// важен состав выходов, а не детерминизм рендера, пин JRE как в golden не нужен.
describe('AGENTS.md в шаблоне', () => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'agents-md-'));
    const project = path.join(dir, 'demo');
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
    const marker = 'npx skills add AlfaCapital-Tech/C4-Builder/skills';
    const run = (cwd, ...args) =>
        spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS });

    it('`--new -y` кладёт AGENTS.md в корень проекта', () => {
        const res = run(dir, '--new', '--name', 'demo', '-y');
        expect(res.status, res.stderr).toBe(0);
        expect(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')).toContain(marker);
    });

    it('сборка не публикует AGENTS.md и его текст', () => {
        const res = run(project);
        expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
        const out = path.join(project, 'docs');
        const leaks = fs
            .readdirSync(out, { recursive: true })
            .filter(
                (f) =>
                    path.basename(f) === 'AGENTS.md' ||
                    (/\.(md|html)$/.test(f) && fs.readFileSync(path.join(out, f), 'utf8').includes(marker))
            );
        expect(leaks).toEqual([]);
    });
});
