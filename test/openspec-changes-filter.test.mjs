import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { CHANGES_FILTER_JS } from './dist.mjs';

// Фильтр таблиц Changes (plugins/openspec/filter.script.ts) в jsdom: страница с двумя секциями
// групп, обёртки с data-c4b-filter="2,5,6" (Schema, Assignee, Awaiting). Хук doneEach docsify
// зовётся руками — им скрипт строит выпадающие списки и применяет сохранённый выбор.
const SCRIPT = CHANGES_FILTER_JS;

const HEAD =
    '<thead><tr><th>Change</th><th>Schema</th><th>Tasks</th><th>Updated</th><th>Assignee</th><th>Awaiting</th></tr></thead>';
const row = (id, change, schema, assignee, awaiting = '—') =>
    `<tr id="${id}"><td>${change}</td><td>${schema}</td><td>1/2</td><td>2026-11-07</td><td>${assignee}</td><td>${awaiting}</td></tr>`;
const table = (rows) =>
    `<div class="c4b-openspec-changes c4b-openspec-changes--extra" data-c4b-filter="2,5,6"><table>${HEAD}<tbody>${rows.join('')}</tbody></table></div>`;
const article = (body) =>
    `<!DOCTYPE html><html><head></head><body><article class="markdown-section">${body}</article></body></html>`;

const PAGE = article(`<h2>Active changes</h2>
<h3 id="service">Service</h3>
${table([
    row('root', '<a href="#/x">dig-3-root</a>', 'spec-driven', 'Alice'),
    row('ios', '↳ <a href="#/y">ios</a>', 'spec-driven', 'Bob'),
    row('orphan', 'dig-4-orphan', 'analytics', 'Carol', 'Dana<br>Eve<br>-')
])}
<h3 id="innovation">Innovation</h3>
${table([row('alpha', 'dig-1-alpha', 'analytics', 'Alice')])}`);

const mount = (html, { storage = {}, blockedStorage = false, patchStorage } = {}) => {
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/#/' });
    const { window } = dom;
    for (const [title, values] of Object.entries(storage))
        window.localStorage.setItem(`c4b-openspec-filter:${title}`, JSON.stringify(values));
    if (blockedStorage)
        Object.defineProperty(window, 'localStorage', {
            get() {
                throw new Error('blocked');
            },
            configurable: true
        });
    if (patchStorage) patchStorage(window);
    window.eval(SCRIPT);
    const doneEach = () => {
        for (const plugin of window.$docsify.plugins) plugin({ doneEach: (fn) => fn() });
    };
    doneEach();
    const { document } = window;
    const $ = (sel) => document.querySelector(sel);
    const menu = (title) =>
        [...document.querySelectorAll('.c4b-openspec-filter-menu')].find(
            (m) => m.querySelector('.c4b-openspec-filter-title').textContent === title
        );
    const values = (title) =>
        [...menu(title).querySelectorAll('.c4b-openspec-filter-option span')].map((s) => s.textContent);
    const input = (title, value) => menu(title).querySelector(`input[data-value="${value}"]`);
    // клик по флажку — jsdom переключает checked и шлёт change, как браузер
    const pick = (title, value) => input(title, value).click();
    const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const hidden = (id) => $(`#${id}`).classList.contains('c4b-openspec-changes-row--hidden');
    const context = (id) => $(`#${id}`).classList.contains('c4b-openspec-changes-row--context');
    const count = () => $('.c4b-openspec-filter-count').textContent;
    const badge = (title) => menu(title).querySelector('.c4b-openspec-filter-badge');
    const stored = (title) => window.localStorage.getItem(`c4b-openspec-filter:${title}`);
    return {
        window,
        document,
        $,
        menu,
        values,
        input,
        pick,
        click,
        hidden,
        context,
        count,
        badge,
        stored,
        doneEach
    };
};
const page = (opts) => mount(PAGE, opts);

describe('плагин openspec: фильтр таблиц Changes', () => {
    it('одна строка над первой секцией: список на колонку, значения по алфавиту, строки ячейки — отдельно, — не значение', () => {
        const p = page();
        const bar = p.$('.c4b-openspec-filter');
        // перед заголовком первой секции, а не между ним и таблицей
        expect(bar.nextElementSibling.id).toBe('service');
        const titles = [...p.document.querySelectorAll('.c4b-openspec-filter-title')].map(
            (t) => t.textContent
        );
        expect(titles).toEqual(['Schema', 'Assignee', 'Awaiting']);
        expect(p.values('Schema')).toEqual(['analytics', 'spec-driven']);
        expect(p.values('Assignee')).toEqual(['Alice', 'Bob', 'Carol']);
        // `—` и `-` — не значения
        expect(p.values('Awaiting')).toEqual(['Dana', 'Eve']);
        expect(p.count()).toBe('4 / 4');
        expect(p.$('.c4b-openspec-filter-reset').disabled).toBe(true);
        expect(p.$('.c4b-openspec-filter-reset').textContent).toBe('Reset');
        expect(p.badge('Assignee').hidden).toBe(true);
        // короткие списки — без поля поиска
        expect(p.$('.c4b-openspec-filter-search')).toBeNull();
    });

    it('подчейндж совпал — он виден, родитель приглушён; секция без строк скрыта с заголовком; бейдж и хранилище', () => {
        const p = page();
        p.pick('Assignee', 'Bob');
        expect(p.input('Assignee', 'Bob').checked).toBe(true);
        expect(p.badge('Assignee').textContent).toBe('1');
        expect(p.badge('Assignee').hidden).toBe(false);
        expect(
            p
                .menu('Assignee')
                .querySelector('summary')
                .classList.contains('c4b-openspec-filter-summary--active')
        ).toBe(true);
        expect(p.hidden('ios')).toBe(false);
        expect(p.context('root')).toBe(true);
        expect(p.hidden('root')).toBe(false);
        expect(p.hidden('orphan')).toBe(true);
        expect(p.hidden('alpha')).toBe(true);
        expect(p.$('#innovation').classList.contains('c4b-openspec-filter-hidden')).toBe(true);
        expect(p.$('#innovation').nextElementSibling.classList.contains('c4b-openspec-changes--empty')).toBe(
            true
        );
        expect(p.$('#service').classList.contains('c4b-openspec-filter-hidden')).toBe(false);
        expect(p.count()).toBe('1 / 4');
        expect(p.$('.c4b-openspec-filter-reset').disabled).toBe(false);
        expect(JSON.parse(p.stored('Assignee'))).toEqual(['Bob']);
    });

    it('две колонки — И; несколько значений ячейки; сброс снимает всё и флажки', () => {
        const p = page();
        p.pick('Assignee', 'Bob');
        p.pick('Assignee', 'Carol');
        expect(p.count()).toBe('2 / 4');
        expect(p.badge('Assignee').textContent).toBe('2');
        expect(p.hidden('orphan')).toBe(false);
        p.pick('Schema', 'spec-driven');
        // orphan — analytics: не проходит Schema, хотя Carol выбрана
        expect(p.hidden('orphan')).toBe(true);
        expect(p.hidden('ios')).toBe(false);
        expect(p.count()).toBe('1 / 4');
        p.pick('Schema', 'spec-driven');
        p.pick('Awaiting', 'Eve');
        // Eve — вторая строка ячейки orphan; ios без ожидающих не проходит Awaiting
        expect(p.hidden('orphan')).toBe(false);
        expect(p.hidden('ios')).toBe(true);
        expect(p.context('root')).toBe(false);
        expect(p.count()).toBe('1 / 4');
        p.click(p.$('.c4b-openspec-filter-reset'));
        for (const id of ['root', 'ios', 'orphan', 'alpha']) {
            expect(p.hidden(id)).toBe(false);
            expect(p.context(id)).toBe(false);
        }
        expect(p.$('#innovation').classList.contains('c4b-openspec-filter-hidden')).toBe(false);
        expect(p.count()).toBe('4 / 4');
        expect(p.stored('Assignee')).toBeNull();
        expect(p.stored('Awaiting')).toBeNull();
        for (const i of p.document.querySelectorAll('input[data-value]')) expect(i.checked).toBe(false);
        expect(p.badge('Assignee').hidden).toBe(true);
    });

    it('сохранённый выбор применяется сразу; значения без строк на странице — в списке выбранными, их можно снять', () => {
        const p = page({ storage: { Assignee: ['Alice'] } });
        expect(p.input('Assignee', 'Alice').checked).toBe(true);
        expect(p.hidden('root')).toBe(false);
        expect(p.hidden('alpha')).toBe(false);
        expect(p.hidden('ios')).toBe(true);
        expect(p.count()).toBe('2 / 4');

        const q = page({ storage: { Assignee: ['Zed'], Schema: 'junk' } });
        expect(q.values('Assignee')).toEqual(['Alice', 'Bob', 'Carol', 'Zed']);
        expect(q.input('Assignee', 'Zed').checked).toBe(true);
        expect(q.count()).toBe('0 / 4');
        for (const id of ['root', 'ios', 'orphan', 'alpha']) expect(q.hidden(id)).toBe(true);
        q.pick('Assignee', 'Zed');
        expect(q.count()).toBe('4 / 4');
        expect(q.stored('Assignee')).toBeNull();
    });

    it('открыт один список: открытие другого, клик вне и Esc закрывают', () => {
        const p = page();
        const schema = p.menu('Schema');
        const assignee = p.menu('Assignee');
        schema.open = true;
        p.click(assignee.querySelector('summary'));
        expect(schema.open).toBe(false);
        expect(assignee.open).toBe(true);
        // клик по флажку внутри списка не закрывает его
        p.pick('Assignee', 'Bob');
        expect(assignee.open).toBe(true);
        p.click(p.$('h2'));
        expect(assignee.open).toBe(false);
        assignee.open = true;
        p.document.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(assignee.open).toBe(false);
    });

    it('длинный список — поле поиска по подстроке без учёта регистра', () => {
        const names = ['Alice', 'Bob', 'Boris', 'Carol', 'Dana', 'Eve', 'Frank', 'Gus', 'Hank'];
        const html = article(
            `<h3>Service</h3>${table(names.map((n, i) => row(`r${i}`, `dig-${i}`, 'spec-driven', n)))}`
        );
        const p = mount(html);
        const search = p.menu('Assignee').querySelector('.c4b-openspec-filter-search');
        expect(search).not.toBeNull();
        expect(p.menu('Schema').querySelector('.c4b-openspec-filter-search')).toBeNull();
        search.value = 'bO';
        search.dispatchEvent(new p.window.Event('input', { bubbles: true }));
        const shown = [...p.menu('Assignee').querySelectorAll('.c4b-openspec-filter-option')]
            .filter((o) => !o.hidden)
            .map((o) => o.textContent);
        expect(shown).toEqual(['Bob', 'Boris']);
        search.value = '';
        search.dispatchEvent(new p.window.Event('input', { bubbles: true }));
        expect(
            [...p.menu('Assignee').querySelectorAll('.c4b-openspec-filter-option')].every((o) => !o.hidden)
        ).toBe(true);
    });

    it('недоступное хранилище — фильтр работает в пределах страницы', () => {
        const p = page({ blockedStorage: true });
        expect(p.count()).toBe('4 / 4');
        p.pick('Schema', 'analytics');
        expect(p.count()).toBe('2 / 4');
        expect(p.hidden('root')).toBe(true);
        expect(p.hidden('orphan')).toBe(false);
    });

    it('запись в хранилище бросает (quota) — чтение работает, фильтр в пределах страницы', () => {
        const p = page({
            storage: { Schema: ['analytics'] },
            patchStorage: (window) => {
                const real = window.localStorage;
                Object.defineProperty(window, 'localStorage', {
                    value: {
                        getItem: (k) => real.getItem(k),
                        setItem() {
                            throw new Error('quota');
                        },
                        removeItem() {
                            throw new Error('quota');
                        }
                    },
                    configurable: true
                });
            }
        });
        expect(p.count()).toBe('2 / 4');
        p.pick('Assignee', 'Bob');
        expect(p.count()).toBe('0 / 4');
        p.click(p.$('.c4b-openspec-filter-reset'));
        expect(p.count()).toBe('4 / 4');
    });

    it('повторный doneEach и повторная загрузка скрипта — одна панель, выбор из хранилища, документ размечен раз', () => {
        const p = page();
        p.pick('Schema', 'analytics');
        p.doneEach();
        p.doneEach();
        expect(p.document.querySelectorAll('.c4b-openspec-filter')).toHaveLength(1);
        expect(p.input('Schema', 'analytics').checked).toBe(true);
        expect(p.count()).toBe('2 / 4');
        expect(p.document.documentElement.hasAttribute('data-c4b-openspec-filter')).toBe(true);
        // скрипт подключён второй раз (копия шаблона): плагинов два, панель одна, клик вне закрывает список один раз
        p.window.eval(SCRIPT);
        expect(p.window.$docsify.plugins).toHaveLength(2);
        p.doneEach();
        expect(p.document.querySelectorAll('.c4b-openspec-filter')).toHaveLength(1);
        const schema = p.menu('Schema');
        schema.open = true;
        p.click(p.$('h2'));
        expect(schema.open).toBe(false);
    });

    it('выбор действует на всех страницах: сохранённый на одной — применён на другой', () => {
        const first = page();
        first.pick('Assignee', 'Bob');
        const saved = { Assignee: JSON.parse(first.stored('Assignee')) };
        const second = mount(
            article(
                `<h2>Active changes</h2>${table([
                    row('root', 'dig-3-root', 'spec-driven', 'Alice'),
                    row('ios', '↳ ios', 'spec-driven', 'Bob')
                ])}`
            ),
            { storage: saved }
        );
        expect(second.input('Assignee', 'Bob').checked).toBe(true);
        expect(second.hidden('ios')).toBe(false);
        expect(second.context('root')).toBe(true);
        expect(second.count()).toBe('1 / 2');
    });

    it('Esc в непустом поле поиска не закрывает список, в пустом — закрывает', () => {
        const names = ['Alice', 'Bob', 'Boris', 'Carol', 'Dana', 'Eve', 'Frank', 'Gus', 'Hank'];
        const p = mount(
            article(
                `<h3>Service</h3>${table(names.map((n, i) => row(`r${i}`, `dig-${i}`, 'spec-driven', n)))}`
            )
        );
        const menu = p.menu('Assignee');
        const search = menu.querySelector('.c4b-openspec-filter-search');
        menu.open = true;
        search.value = 'bo';
        search.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(menu.open).toBe(true);
        search.value = '';
        search.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(menu.open).toBe(false);
    });

    it('страница без h3 (сводка): панель перед обёрткой, таблица без строк скрыта, счётчик 0 / M', () => {
        const p = mount(
            article(`<h2>Active changes</h2>${table([row('root', 'dig-3-root', 'spec-driven', 'Alice')])}`),
            { storage: { Assignee: ['Zed'] } }
        );
        const bar = p.$('.c4b-openspec-filter');
        expect(bar.previousElementSibling.tagName).toBe('H2');
        expect(bar.nextElementSibling.classList.contains('c4b-openspec-changes')).toBe(true);
        expect(bar.nextElementSibling.classList.contains('c4b-openspec-changes--empty')).toBe(true);
        expect(p.count()).toBe('0 / 1');
        expect(p.$('.c4b-openspec-filter-reset').title).toBe('Reset filter');
    });

    it('страница без data-c4b-filter — фильтра нет', () => {
        const p = mount(
            article(
                '<div class="c4b-openspec-changes"><table><thead><tr><th>Change</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table></div>'
            )
        );
        expect(p.$('.c4b-openspec-filter')).toBeNull();
    });
});
