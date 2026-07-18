import { describe, expect, it } from 'vitest';

import { configSchema, isValidPort, parseConfig } from './dist.mjs';

// Регрессии конфига против 0.2.x (max-ревью PR #8): легаси-значения из рукописных
// `.c4builder` не должны ни падать, ни превращаться в мусорные строки.
describe('configSchema: легаси-значения', () => {
    it('false в строковом поле = «не задано» → дефолт (docsifyTemplate: false из 0.2.x)', () => {
        const r = configSchema.safeParse({ docsifyTemplate: false, webPort: false });
        expect(r.success).toBe(true);
        expect(r.data.docsifyTemplate).toBe('');
        expect(r.data.webPort).toBe('3000');
    });

    it('null в любом поле = «не задано» → дефолт', () => {
        const r = configSchema.safeParse({ rootFolder: null, generateMD: null });
        expect(r.success).toBe(true);
        expect(r.data.rootFolder).toBe('src');
        expect(r.data.generateMD).toBe(true);
    });

    it('число в строковом поле коэрсится (webPort: 8000)', () => {
        const r = configSchema.safeParse({ webPort: 8000 });
        expect(r.success).toBe(true);
        expect(r.data.webPort).toBe('8000');
    });

    it('true в строковом поле — ошибка, а не тихая строка "true"', () => {
        expect(configSchema.safeParse({ docsifyTemplate: true }).success).toBe(false);
    });

    it('webPort с опечаткой/вне диапазона — ошибка (иначе app.listen слушал бы unix-сокет)', () => {
        expect(configSchema.safeParse({ webPort: '30OO' }).success).toBe(false);
        expect(configSchema.safeParse({ webPort: '99999' }).success).toBe(false);
        expect(configSchema.safeParse({ webPort: '0' }).success).toBe(false);
    });

    it('не-строки внутри excludeSidebarFolderByPath отбрасываются молча', () => {
        const r = configSchema.safeParse({ excludeSidebarFolderByPath: ['a', null, 42, 'b'] });
        expect(r.success).toBe(true);
        expect(r.data.excludeSidebarFolderByPath).toEqual(['a', 'b']);
    });

    it('excludeSidebarFolderByPath не-массив — ошибка', () => {
        expect(configSchema.safeParse({ excludeSidebarFolderByPath: 'docs' }).success).toBe(false);
    });
});

describe('isValidPort', () => {
    it('принимает 1..65535, отклоняет мусор', () => {
        expect(isValidPort('3000')).toBe(true);
        expect(isValidPort('1')).toBe(true);
        expect(isValidPort('65535')).toBe(true);
        expect(isValidPort('0')).toBe(false);
        expect(isValidPort('65536')).toBe(false);
        expect(isValidPort('30OO')).toBe(false);
        expect(isValidPort('')).toBe(false);
        expect(isValidPort('-1')).toBe(false);
    });
});

describe('parseConfig: salvage битых ключей', () => {
    it('битый ключ уходит в issues, salvaged несёт дефолт схемы', () => {
        const r = parseConfig({ includeNavigation: 'yes', projectName: 'demo' });
        expect(r.ok).toBe(false);
        expect(r.issues.map((i) => i.key)).toEqual(['includeNavigation']);
        expect(r.salvaged.includeNavigation).toBe(false); // дефолт
        expect(r.salvaged.projectName).toBe('demo'); // валидное сохранено
    });
});
