import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { DIAGRAM_ZOOM_JS } from './dist.mjs';

// Просмотр диаграмм с зумом (compose/site.scripts.ts) в jsdom: раскладки нет, поэтому
// натуральный размер картинки задаётся свойством, а без него берётся запасной (300×150).
// Хук doneEach docsify вызывается руками — им скрипт размечает картинки страницы.
// Прокрутки в jsdom тоже нет: scrollX/scrollY — геттеры над `pos` (меняется через `scrollAt`),
// а window.scrollTo — шпион, который запоминает координаты, `behavior` объектной формы и был ли
// ещё на <html> класс блокировки (заодно пропадает «Not implemented: window.scrollTo» в выводе).
// Под классом блокировки геттеры отдают 0 — как браузер с темой, где body всё же обрезает
// содержимое: так проверяется страховочный возврат. `legacyScroll` — старый движок, который на
// незнакомое значение `behavior` бросает исключение.
const page = ({ width = 1024, height = 768, legacyScroll = false } = {}) => {
    const dom = new JSDOM(
        `<!DOCTYPE html><html><head></head><body>
<input id="search">
<article class="markdown-section">
  <img id="diagram" src="data:image/svg+xml;base64,PHN2Zy8+" alt="relations">
  <img id="emoji" class="emoji" src="x.png">
  <img id="nozoom" data-no-zoom src="x.png">
  <a href="#/other"><img id="linked" src="x.png"></a>
  <button><img id="inbutton" src="x.png"></button>
  <details><summary><img id="insummary" src="x.png"></summary></details>
  <label><img id="inlabel" src="x.png"></label>
</article>
<img id="outside" src="x.png">
</body></html>`,
        { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/#/' }
    );
    const { window } = dom;
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
    const pos = { x: 0, y: 0 };
    const scrolls = [];
    const locked = () => window.document.documentElement.classList.contains('c4-zoom-open');
    Object.defineProperty(window, 'scrollX', { get: () => (locked() ? 0 : pos.x), configurable: true });
    Object.defineProperty(window, 'scrollY', { get: () => (locked() ? 0 : pos.y), configurable: true });
    window.scrollTo = (a, b) => {
        if (typeof a !== 'object') return scrolls.push({ x: a, y: b, locked: locked() });
        if (legacyScroll) throw new window.TypeError(`Unknown behavior: ${a.behavior}`);
        scrolls.push({ x: a.left, y: a.top, behavior: a.behavior, locked: locked() });
    };
    const scrollAt = (x, y) => {
        pos.x = x;
        pos.y = y;
    };
    window.eval(DIAGRAM_ZOOM_JS);
    const doneEach = () => {
        for (const plugin of window.$docsify.plugins) plugin({ doneEach: (fn) => fn() });
    };
    doneEach();
    const { document } = window;
    const $ = (sel) => document.querySelector(sel);
    const click = (el, init = {}) =>
        el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    const key = (k, target = document.activeElement || document) =>
        target.dispatchEvent(
            new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
        );
    const natural = (el, w, h) => {
        Object.defineProperty(el, 'naturalWidth', { value: w });
        Object.defineProperty(el, 'naturalHeight', { value: h });
    };
    const frame = () => new Promise((r) => window.requestAnimationFrame(() => r()));
    const isOpen = () => !!$('.c4-zoom.open');
    const pct = () => $('.c4-zoom-pct').textContent;
    return { window, document, $, click, key, natural, frame, isOpen, pct, doneEach, scrollAt, scrolls };
};

describe('просмотр диаграмм с зумом', () => {
    it('клик по картинке страницы открывает просмотр и не доходит до обработчика на img', () => {
        const { $, click, isOpen, document } = page();
        let medium = 0;
        $('#diagram').addEventListener('click', () => medium++);
        click($('#diagram'));
        expect(isOpen()).toBe(true);
        expect(medium).toBe(0);
        expect($('.c4-zoom-img').getAttribute('src')).toBe($('#diagram').getAttribute('src'));
        expect($('.c4-zoom-img').alt).toBe('relations');
        expect(document.documentElement.classList.contains('c4-zoom-open')).toBe(true);
    });

    it('клик с модификатором тоже открывает новый просмотр, а не medium-zoom пользовательского шаблона', () => {
        for (const mod of ['shiftKey', 'altKey', 'metaKey', 'ctrlKey']) {
            const { $, click, isOpen } = page();
            let medium = 0;
            $('#diagram').addEventListener('click', () => medium++);
            click($('#diagram'), { [mod]: true });
            expect(isOpen(), mod).toBe(true);
            expect(medium, mod).toBe(0);
        }
    });

    it('emoji, data-no-zoom, картинки в ссылках, button, summary, label и вне статьи — не перехватываются', () => {
        const { $, click, isOpen } = page();
        for (const id of ['emoji', 'nozoom', 'linked', 'inbutton', 'insummary', 'inlabel', 'outside']) {
            let own = 0;
            $(`#${id}`).addEventListener('click', () => own++);
            click($(`#${id}`));
            expect(isOpen(), id).toBe(false);
            expect(own, id).toBe(1);
            expect($(`#${id}`).hasAttribute('data-c4-zoom'), id).toBe(false);
        }
    });

    it('картинка, добавленная после doneEach (Swagger UI), не перехватывается до следующего doneEach', () => {
        const { document, $, click, isOpen, doneEach } = page();
        const late = document.createElement('img');
        late.src = 'late.png';
        $('.markdown-section').appendChild(late);
        click(late);
        expect(isOpen()).toBe(false);
        doneEach();
        click(late);
        expect(isOpen()).toBe(true);
    });

    it('исходно вписано не крупнее 1:1; клавиши и кнопки меняют масштаб, 0 — вписать', () => {
        const { $, click, key, pct } = page();
        click($('#diagram'));
        expect(pct()).toBe('100%');
        key('+');
        expect(pct()).toBe('125%');
        key('-');
        key('-');
        expect(pct()).toBe('80%');
        key('0');
        expect(pct()).toBe('100%');
        click($('.c4-zoom-bar button[title^="Zoom in"]'));
        expect(pct()).toBe('125%');
        for (let i = 0; i < 20; i++) key('+');
        expect(pct()).toBe('400%');
        key('1');
        expect(pct()).toBe('100%');
    });

    it('большая схема: вписана мельче 1:1, двойной клик — 1:1 и обратно; предел зума по площади растра', () => {
        const { window, $, click, key, natural, pct } = page();
        natural($('#diagram'), 7051, 2511);
        click($('#diagram'));
        expect(pct()).toBe('14%');
        const stage = $('.c4-zoom-stage');
        const dbl = () =>
            stage.dispatchEvent(
                new window.MouseEvent('dblclick', { bubbles: true, clientX: 500, clientY: 300 })
            );
        dbl();
        expect(pct()).toBe('100%');
        dbl();
        expect(pct()).toBe('14%');
        // 7051×2511 ≈ 17.7 Мпикс: предел — √(64e6 / 17.7e6) ≈ 1.9×, а не 4×.
        for (let i = 0; i < 20; i++) key('+');
        expect(pct()).toBe('190%');
    });

    it('схема крупнее предела площади в натуральную величину — зум всё равно доходит до 1:1', () => {
        const { $, click, key, natural, pct } = page();
        natural($('#diagram'), 10000, 8000);
        click($('#diagram'));
        for (let i = 0; i < 30; i++) key('+');
        expect(pct()).toBe('100%');
    });

    it('схема, видная целиком в натуральную величину: двойной клик — 2× и обратно', () => {
        const { window, $, click, pct } = page();
        click($('#diagram'));
        const stage = $('.c4-zoom-stage');
        stage.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, clientX: 500, clientY: 300 }));
        expect(pct()).toBe('200%');
        stage.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, clientX: 500, clientY: 300 }));
        expect(pct()).toBe('100%');
    });

    it('очень низкое окно: «вписать» — по всему окну, а не натуральный размер', () => {
        const { $, click, natural, pct } = page({ width: 800, height: 80 });
        natural($('#diagram'), 3000, 1000);
        click($('#diagram'));
        expect(pct()).toBe('8%');
    });

    it('размер и сдвиг картинки пишутся раз в кадр, после колеса — крупнее', async () => {
        const { window, $, click, frame, pct } = page();
        click($('#diagram'));
        await frame();
        expect($('.c4-zoom-img').style.width).toBe('300px');
        const wheel = new window.WheelEvent('wheel', {
            deltaY: -100,
            clientX: 10,
            clientY: 10,
            bubbles: true,
            cancelable: true
        });
        $('.c4-zoom-stage').dispatchEvent(wheel);
        expect(wheel.defaultPrevented).toBe(true);
        expect(Number.parseInt(pct(), 10)).toBeGreaterThan(100);
        expect($('.c4-zoom-img').style.width).toBe('300px');
        await frame();
        expect(Number.parseFloat($('.c4-zoom-img').style.width)).toBeGreaterThan(300);
        expect($('.c4-zoom-img').style.transform).toMatch(/^translate\(/);
    });

    it('фокус удерживается в просмотре; клавиши из поля за оверлеем зум не меняют', () => {
        const { $, click, key, isOpen, pct, document } = page();
        click($('#diagram'));
        $('#search').focus();
        expect($('.c4-zoom').contains(document.activeElement)).toBe(true);
        // Событие из поля (например, фокус не перенёсся) — не наше.
        const ev = key('1', $('#search'));
        expect(ev).toBe(true);
        key('+', $('#search'));
        expect(pct()).toBe('100%');
        key('Escape');
        expect(isOpen()).toBe(false);
    });

    it('закрывается по Esc, кнопке, клику мимо картинки и переходу на другую страницу', () => {
        const { window, $, click, key, isOpen, document } = page();
        click($('#diagram'));
        key('Escape');
        expect(isOpen()).toBe(false);
        expect(document.documentElement.classList.contains('c4-zoom-open')).toBe(false);
        expect($('.c4-zoom-img').hasAttribute('src')).toBe(false);

        click($('#diagram'));
        click($('.c4-zoom-bar button[title^="Close"]'));
        expect(isOpen()).toBe(false);

        // Клик по самой картинке (вписана по центру окна) не закрывает, мимо — закрывает.
        click($('#diagram'));
        click($('.c4-zoom-stage'), { clientX: 512, clientY: 360 });
        expect(isOpen()).toBe(true);
        click($('.c4-zoom-stage'), { clientX: 5, clientY: 5 });
        expect(isOpen()).toBe(false);

        click($('#diagram'));
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(isOpen()).toBe(false);
    });

    it('закрытие читателем (Esc, кнопка, клик мимо) возвращает позицию прокрутки по обеим осям', () => {
        const { $, click, key, isOpen, scrollAt, scrolls } = page();
        const closers = {
            Escape: () => key('Escape'),
            button: () => click($('.c4-zoom-bar button[title^="Close"]')),
            outside: () => click($('.c4-zoom-stage'), { clientX: 5, clientY: 5 })
        };
        let n = 0;
        for (const [name, closeIt] of Object.entries(closers)) {
            n++;
            scrollAt(10 * n, 1000 * n);
            click($('#diagram'));
            closeIt();
            expect(isOpen(), name).toBe(false);
            expect(scrolls.length, name).toBe(n);
            expect(scrolls.at(-1), name).toEqual({
                x: 10 * n,
                y: 1000 * n,
                behavior: 'instant',
                locked: false
            });
        }
    });

    it('повторное открытие с другого места — возвращается позиция второго открытия', () => {
        const { $, click, key, scrollAt, scrolls } = page();
        scrollAt(0, 500);
        click($('#diagram'));
        key('Escape');
        scrollAt(40, 2500);
        click($('#diagram'));
        key('Escape');
        expect(scrolls).toEqual([
            { x: 0, y: 500, behavior: 'instant', locked: false },
            { x: 40, y: 2500, behavior: 'instant', locked: false }
        ]);
    });

    it('закрытие по hashchange позицию не восстанавливает', () => {
        const { window, $, click, isOpen, scrollAt, scrolls } = page();
        scrollAt(0, 1200);
        click($('#diagram'));
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(isOpen()).toBe(false);
        expect(scrolls).toEqual([]);
    });

    it('закрытие по popstate (routerMode history) позицию не восстанавливает, повтор по hashchange безопасен', () => {
        const { window, $, click, key, isOpen, scrollAt, scrolls } = page();
        scrollAt(0, 1200);
        click($('#diagram'));
        window.dispatchEvent(new window.PopStateEvent('popstate'));
        expect(isOpen()).toBe(false);
        window.dispatchEvent(new window.HashChangeEvent('hashchange'));
        expect(scrolls).toEqual([]);
        click($('#diagram'));
        key('Escape');
        expect(scrolls).toEqual([{ x: 0, y: 1200, behavior: 'instant', locked: false }]);
    });

    it('фокус возвращается до снятия блокировки, возврат позиции — после', () => {
        const { window, $, click, key, scrollAt, scrolls } = page();
        const order = [];
        const locked = () => window.document.documentElement.classList.contains('c4-zoom-open');
        const focus = window.HTMLElement.prototype.focus;
        window.HTMLElement.prototype.focus = function (opts) {
            if (this === window.document.body) order.push(`focus locked=${locked()}`);
            return focus.call(this, opts);
        };
        scrollAt(0, 900);
        click($('#diagram'));
        key('Escape');
        order.push(`scrollTo locked=${scrolls.at(-1).locked}`);
        expect(order).toEqual(['focus locked=true', 'scrollTo locked=false']);
    });

    it('старый движок бросает на behavior: instant — возврат запасной формой scrollTo(x, y)', () => {
        const { $, click, key, isOpen, scrollAt, scrolls } = page({ legacyScroll: true });
        scrollAt(30, 800);
        click($('#diagram'));
        key('Escape');
        expect(isOpen()).toBe(false);
        expect(scrolls).toEqual([{ x: 30, y: 800, locked: false }]);
    });

    it('блокировка прокрутки — overflow:hidden на html, а body под ней не обрезает содержимое', () => {
        // Причина сброса позиции: overflow:hidden на body при height:100% темы обрезает страницу
        // по высоте окна. Раскладки в jsdom нет — проверяется сам набор правил.
        const { document } = page();
        const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
        expect(css).toContain('html.c4-zoom-open{overflow:hidden}');
        expect(css).toContain('html.c4-zoom-open body{overflow:visible}');
        expect(css).not.toMatch(/html\.c4-zoom-open body\{[^}]*overflow:hidden/);
    });

    it('в выходной строке нет комментариев, кириллицы и внешних адресов', () => {
        expect(DIAGRAM_ZOOM_JS).not.toMatch(/\/\/|\/\*|[Ѐ-ӿ]|https?:/);
    });
});
