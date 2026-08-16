// Мини-glob без зависимостей: `**` (любые каталоги), `*` (в пределах сегмента),
// `?`, `{a,b}`; остальное — буквально. Покрывает `*/openapi.yaml` и
// `**/openapi.{yaml,yml,json}`; `fs.glob` появился только в Node 22, engines — ≥20.19.
import fs from 'node:fs';
import path from 'node:path';

export const globToRegExp = (glob: string): RegExp => {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                // `**/` — ноль и более каталогов; одиночное `**` в конце — что угодно
                i++;
                if (glob[i + 1] === '/') {
                    i++;
                    re += '(?:.*/)?';
                } else re += '.*';
            } else re += '[^/]*';
        } else if (c === '?') re += '[^/]';
        else if (c === '{') {
            const end = glob.indexOf('}', i);
            if (end === -1) re += '\\{';
            else {
                re += `(?:${glob
                    .slice(i + 1, end)
                    .split(',')
                    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                    .join('|')})`;
                i = end;
            }
        } else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`);
};

/**
 * Файлы под root, чьи относительные posix-пути совпадают с glob (сортировано).
 * `.git`/`node_modules` и абсолютные каталоги `skipDirs` не обходятся.
 */
export const globFiles = (root: string, glob: string, skipDirs: string[] = []): string[] => {
    const re = globToRegExp(glob);
    const skip = new Set(skipDirs.map((d) => path.resolve(d)));
    const out: string[] = [];
    const walk = (rel: string): void => {
        for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                if (e.name === '.git' || e.name === 'node_modules' || skip.has(path.resolve(root, r)))
                    continue;
                walk(r);
            } else if (re.test(r)) out.push(r);
        }
    };
    walk('');
    return out.sort();
};
