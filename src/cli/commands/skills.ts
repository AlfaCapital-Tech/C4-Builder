import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectAgent } from '../agent.ts';
import { compareVersions, disabled } from '../update.ts';
import { PACKAGE_ROOT, packageJson as pkg } from '../../util/paths.ts';

// Скиллы агентов (change skills-install): входят в пакет, поэтому ставятся офлайн и той же версии,
// что и CLI. По основному скиллу судим обо всём наборе — ставятся все сразу (D3).
const SKILLS_DIR = path.join(PACKAGE_ROOT, 'skills');
const MAIN = 'c4builder';
const RUN = 'c4builder skills';

// Отметка версии из frontmatter `<root>/c4builder/SKILL.md` регуляркой, без YAML-парсера (D4):
// undefined — скилла нет, '' — скилл без отметки (поставлен `npx skills add` или руками).
const stampIn = (root: string): string | undefined => {
    let text: string;
    try {
        text = fs.readFileSync(path.join(root, MAIN, 'SKILL.md'), 'utf8');
    } catch {
        return undefined;
    }
    const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
    return front.match(/^\s+generatedBy:\s*["']?([^"'\s]+)/m)?.[1] ?? '';
};

// Копия новее CLI не устаревшая: о старом CLI скажет уведомление о новой версии (D4).
const outdated = (stamp: string): boolean => !stamp || compareVersions(stamp, pkg.version) < 0;

const personalRoot = (dir: string): string => path.join(os.homedir(), dir, 'skills');
const overrides = (dir: string, stamp: string): string =>
    `~/${dir}/skills/${MAIN} (${stamp || 'no version'}) overrides project skills. Ask the user to remove it`;

// `c4builder skills` и `--new` (D2, D6): каталог каждого скилла пакета заменяется целиком — так уходят
// файлы прошлых версий, а чужие скиллы рядом не трогаются. `.claude` — только под Claude Code или если
// он уже есть: Claude Code не читает `.agents`, а создавать `.claude/` в чужом проекте незачем.
export default (root = process.cwd()): void => {
    const names = fs
        .readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    const dirs = ['.agents'];
    if (process.env.CLAUDECODE || fs.existsSync(path.join(root, '.claude'))) dirs.push('.claude');
    for (const dir of dirs) {
        for (const name of names) {
            const target = path.join(root, dir, 'skills', name);
            fs.rmSync(target, { recursive: true, force: true });
            fs.cpSync(path.join(SKILLS_DIR, name), target, { recursive: true });
            const file = path.join(target, 'SKILL.md');
            const text = fs.readFileSync(file, 'utf8');
            fs.writeFileSync(
                file,
                text.replace(/^description:.*$/m, `$&\nmetadata:\n  generatedBy: "${pkg.version}"`)
            );
            console.log(`installed ${path.relative(process.cwd(), target)}`);
        }
        // Личную копию не трогаем: её поставил пользователь, удалять — ему (D3).
        const personal = stampIn(personalRoot(dir));
        if (personal !== undefined && outdated(personal)) console.error(overrides(dir, personal));
    }
};

// Строка о скиллах при старте сборки и `site` под агентом (D3–D5), undefined — молчим. Агент — только
// по окружению: флаги --agent/--no-agent управляют замечаниями со страницы, а не этим.
export const skillsNotice = (cwd = process.cwd()): string | undefined => {
    const agent = detectAgent(process.env, {});
    if (!agent.on || disabled()) return undefined;
    const dir = agent.name === 'claude-code' ? '.claude' : '.agents';
    // Личная копия побеждает проектную при одинаковом имени (так выбирает Claude Code).
    const personal = stampIn(personalRoot(dir));
    if (personal !== undefined)
        return outdated(personal) ? `${overrides(dir, personal)}, then run: ${RUN}` : undefined;
    // Проектная — ближайшая от cwd вверх до корня git-репозитория: агента обычно запускают в корне
    // репозитория, а сборку — в подкаталоге документации, и он видит скиллы обоих уровней.
    let stamp: string | undefined;
    for (let d = path.resolve(cwd); stamp === undefined; d = path.dirname(d)) {
        stamp = stampIn(path.join(d, dir, 'skills'));
        if (fs.existsSync(path.join(d, '.git')) || path.dirname(d) === d) break;
    }
    if (stamp === undefined)
        return `c4builder agent skills are not installed here. Ask the user, then run: ${RUN}`;
    if (!outdated(stamp)) return undefined;
    return `c4builder agent skills here are from ${stamp || 'an unknown version'} (current ${pkg.version}). Ask the user, then run: ${RUN}`;
};
