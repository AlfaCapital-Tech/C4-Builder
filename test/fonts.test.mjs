import { describe, it, expect } from 'vitest';

import { fontCacheTag, renderArgv, resvgFontOptions } from './dist.mjs';

const argv = (useSystemFonts) =>
    renderArgv({
        jarPath: '/tmp/plantuml.jar',
        includePath: '/tmp/src',
        format: 'svg',
        charset: 'UTF-8',
        isDitaa: false,
        useSystemFonts
    });

const FONT_ARGS = /^(-Dsun\.java2d\.fontpath|-SdefaultFontName|-SCircledCharacterFontName)/;

describe('режим шрифта: вендорный пин vs системные шрифты', () => {
    it('по умолчанию JVM получает все три шрифтовых аргумента', () => {
        const pinned = argv(false).filter((a) => FONT_ARGS.test(a));
        expect(pinned).toHaveLength(3);
        expect(pinned[0]).toMatch(/^-Dsun\.java2d\.fontpath=prepend:.+[/\\]vendor[/\\]fonts$/);
    });

    it('в системном режиме шрифтовых аргументов нет, остальной argv не меняется', () => {
        expect(argv(true).filter((a) => FONT_ARGS.test(a))).toEqual([]);
        expect(argv(true)).toEqual(argv(false).filter((a) => !FONT_ARGS.test(a)));
    });

    it('растеризатор: пин каталога/семейства только в режиме по умолчанию', () => {
        expect(resvgFontOptions(false)).toMatchObject({ loadSystemFonts: false });
        expect(resvgFontOptions(false).fontDirs).toHaveLength(1);
        expect(resvgFontOptions(true)).toEqual({ loadSystemFonts: true });
    });

    it('ключ кеша различает режимы', () => {
        expect(fontCacheTag({ USE_SYSTEM_FONTS: true })).not.toBe(fontCacheTag({ USE_SYSTEM_FONTS: false }));
    });
});
