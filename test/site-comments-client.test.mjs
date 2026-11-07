import { describe, expect, it } from 'vitest';

import { buttonLabels, commentsSnippet } from '../dist/cli/commands/site.comments.js';

// Клиентский сниппет страницы `site -w` в jsdom: кнопки у выделения — журнал ревью (Comment) и
// агент (Tell agent), поповер, черновик для агента и панель (changes site-comments,
// site-agent-feedback, site-review-log, site-button-names).
describe('страница для запроса', () => {
    it('берётся из route.file docsify, а не из hash (hash может быть якорем)', async () => {
        const { JSDOM } = await import('jsdom');
        const html = `<!DOCTYPE html><html><head></head><body>
<script>
window.$docsify = { plugins: [] };
window.__calls = [];
window.fetch = function (url, init) {
    window.__calls.push({ method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ file: 'f' }); } });
};
Range.prototype.getClientRects = function () { return []; };
Range.prototype.getBoundingClientRect = function () { return { top: 0, bottom: 10, left: 0, right: 10 }; };
</script>
<section class="markdown-section"><h2>Flow</h2><p id="t">foo bar</p></section>
${commentsSnippet({ reviewLog: { file: 'review.md', heading: ['Remarks'] } })}
</body></html>`;
        const { window } = new JSDOM(html, {
            runScripts: 'dangerously',
            pretendToBeVisual: true,
            url: 'http://localhost/#c4b-r-1'
        });
        let done;
        const vm = { route: { file: '/X/Y%20Z/Y%20Z.md' } };
        window.$docsify.plugins.find((p) => typeof p === 'function')({ doneEach: (fn) => (done = fn) }, vm);
        done();
        await new Promise((r) => setTimeout(r, 150));
        const doc = window.document;
        const range = doc.createRange();
        range.selectNodeContents(doc.getElementById('t'));
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        const byText = (root, text) =>
            [...root.querySelectorAll('button')].find((b) => b.textContent === text);
        byText(doc.querySelector('.c4b-cbtns'), 'Comment').click();
        const pop = doc.querySelector('.c4b-cpop');
        pop.querySelector('textarea').value = 'Why?';
        byText(pop, 'Add comment').click();
        await new Promise((r) => setTimeout(r, 20));
        expect(window.__calls.find((c) => c.method === 'POST').body.page).toBe('X/Y Z/Y Z.md');
    });
});

// Подписи кнопок: `buttons` из конфига, `reviewLog.label` — прежний способ для кнопки журнала.
describe('buttonLabels', () => {
    it('buttons.comment сильнее reviewLog.label; пусто — словарь', () => {
        expect(buttonLabels({ agent: 'Fix it' }, 'Журнал')).toEqual({ agent: 'Fix it', comment: 'Журнал' });
        expect(buttonLabels({ comment: 'Note' }, 'Журнал')).toEqual({ agent: undefined, comment: 'Note' });
        expect(buttonLabels({ agent: '', comment: '' }, '')).toEqual({
            agent: undefined,
            comment: undefined
        });
        expect(buttonLabels(undefined, undefined)).toEqual({ agent: undefined, comment: undefined });
    });
});

// Замечания агенту (change site-agent-feedback, D5, D8): кнопки у выделения, поповер Tell agent,
// отложенные замечания в localStorage и панель агента.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOW = '<h2>Flow</h2><p id="t">foo bar</p><h2>Other</h2><p id="u">baz qux</p>';
const DONE = 'Done — no changes';

const agentPage = async ({
    agent = true,
    mailboxes = [],
    project = 'p1',
    storage = {},
    session = {},
    body = FLOW,
    language,
    languages,
    reviewLog = null,
    labels = {},
    // Ошибка/ответ fetch с первого запроса страницы (GET журнала), а не выставленные после загрузки.
    error = '',
    reply = null
} = {}) => {
    const { JSDOM } = await import('jsdom');
    const fill = (store, entries) =>
        Object.entries(entries).map(
            ([k, v]) => `${store}.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`
        );
    const seed = fill('localStorage', storage)
        .concat(fill('sessionStorage', session))
        .concat(
            languages
                ? [`Object.defineProperty(navigator, 'languages', { value: ${JSON.stringify(languages)} });`]
                : []
        )
        .concat(error ? [`window.__error = ${JSON.stringify(error)};`] : [])
        .concat(reply ? [`window.__reply = ${JSON.stringify(reply)};`] : [])
        .join('\n');
    const html = `<!DOCTYPE html><html><head></head><body>
<script>
window.$docsify = { plugins: [] };
window.__calls = [];
window.__reply = { id: 'b1', queued: true };
window.__error = '';
window.fetch = function (url, init) {
    init = init || {};
    window.__calls.push({ url: url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    var reply = window.__error ? { error: window.__error } : window.__reply;
    return Promise.resolve({ ok: !window.__error, status: 400, json: function () { return Promise.resolve(reply); } });
};
Range.prototype.getClientRects = function () { return []; };
Range.prototype.getBoundingClientRect = function () { return { top: 0, bottom: 10, left: 0, right: 10 }; };
${seed}
</script>
<section class="markdown-section">${body}</section>
${commentsSnippet({ agent, mailboxes, project, language, reviewLog, labels })}
</body></html>`;
    const { window } = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'http://localhost/#/A'
    });
    let done;
    window.$docsify.plugins.find((p) => typeof p === 'function')({ doneEach: (fn) => (done = fn) });
    done();
    await sleep(100);
    const doc = window.document;
    const buttons = () =>
        [...doc.querySelectorAll('.c4b-cbtns button')].filter((b) => !b.hidden).map((b) => b.textContent);
    const byText = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);
    // Выделение текста элемента и кнопка у него: Tell agent или Comment.
    const openFor = async (id, label) => {
        const range = doc.createRange();
        range.selectNodeContents(doc.getElementById(id));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        byText(doc.querySelector('.c4b-cbtns'), label).click();
        return doc.querySelector('.c4b-cpop');
    };
    const write = async (id, label, text, action) => {
        const pop = await openFor(id, label);
        pop.querySelector('textarea').value = text;
        byText(pop, action).click();
        await sleep(20);
    };
    const panel = doc.querySelector('.c4b-review');
    const panelButtons = () =>
        [...panel.querySelectorAll('.c4b-acts > button')].filter((b) => !b.hidden).map((b) => b.textContent);
    const toast = () => doc.querySelector('.c4b-ctoast')?.textContent;
    const stored = (key = '__c4builderReview:p1') => JSON.parse(window.localStorage.getItem(key) || '[]');
    // Хранилище вкладки — для «перезагрузки» и второй вкладки с общим localStorage.
    const dump = (store) => Object.fromEntries(Object.entries(window[store]));
    const agentEvent = (detail) =>
        window.dispatchEvent(new window.CustomEvent('c4builder:agent', { detail }));
    return {
        window,
        doc,
        buttons,
        byText,
        openFor,
        write,
        panel,
        panelButtons,
        toast,
        stored,
        dump,
        agentEvent
    };
};

describe('кнопки у выделения', () => {
    const LOG = { file: 'review.md', heading: ['Remarks'] };

    it('журнал без агента — одна Comment, панели агента нет', async () => {
        const p = await agentPage({ agent: false, reviewLog: LOG });
        expect(p.buttons()).toEqual(['Comment']);
        expect(p.panel.hidden).toBe(true);
    });

    it('агент и журнал — Tell agent и Comment, панель агента видна', async () => {
        const p = await agentPage({ reviewLog: LOG });
        expect(p.buttons()).toEqual(['Tell agent', 'Comment']);
        expect(p.panel.hidden).toBe(false);
        // панель прибита к низу экрана — кнопки у выделения и поповер должны быть над ней
        const z = (el) => Number(p.window.getComputedStyle(el).zIndex);
        expect(z(p.panel)).toBeLessThan(z(p.doc.querySelector('.c4b-cbtns')));
        expect(z(p.panel)).toBeLessThan(z(await p.openFor('t', 'Tell agent')));
    });

    it('событие agent { on: true } добавляет Tell agent без перезагрузки', async () => {
        const p = await agentPage({ agent: false, reviewLog: LOG });
        p.agentEvent({ on: true, mailboxes: [{ name: 'foo', state: 'listening', queued: 0 }] });
        expect(p.buttons()).toEqual(['Tell agent', 'Comment']);
        expect(p.panel.textContent).toContain('foo: listening ●');
    });

    it('ни агента, ни журнала — у выделения кнопок нет', async () => {
        const p = await agentPage({ languages: ['en'], agent: false });
        expect(p.buttons()).toEqual([]);
        const range = p.doc.createRange();
        range.selectNodeContents(p.doc.getElementById('t'));
        const sel = p.window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        p.doc.dispatchEvent(new p.window.Event('selectionchange'));
        await sleep(20);
        expect(p.doc.querySelector('.c4b-cbtns').hidden).toBe(true);
    });

    it('подписи из buttons — на любом языке интерфейса', async () => {
        const p = await agentPage({
            languages: ['ru'],
            reviewLog: LOG,
            labels: { agent: 'Fix it', comment: 'Note' }
        });
        expect(p.buttons()).toEqual(['Fix it', 'Note']);
        await p.write('t', 'Fix it', 'Rename', 'Отправить');
        expect(p.window.__calls.at(-1).body.comments[0].comment).toBe('Rename');
    });
});

describe('поповер Tell agent', () => {
    it('Send now шлёт одно замечание submitted; тост «в очереди», по delivered — «доставлено»', async () => {
        const p = await agentPage();
        const pop = await p.openFor('t', 'Tell agent');
        expect(pop.querySelector('.c4b-primary').textContent).toBe('Send now');
        expect(pop.textContent).toContain('agent: not listening');
        await p.write('t', 'Tell agent', 'Rename to baz', 'Send now');
        expect(p.window.__calls).toEqual([
            {
                url: '/__c4builder/feedback',
                method: 'POST',
                body: {
                    decision: 'submitted',
                    comments: [{ page: 'A.md', quote: 'foo bar', section: 'Flow', comment: 'Rename to baz' }],
                    general: ''
                }
            }
        ]);
        expect(p.toast()).toBe('Queued — agent is not listening');
        expect(p.doc.querySelector('.c4b-cpop')).toBeNull();
        p.window.dispatchEvent(new p.window.CustomEvent('c4builder:delivered', { detail: { id: 'b1' } }));
        expect(p.toast()).toBe('Delivered to the agent');
    });

    it('delivered раньше ответа на POST — сразу «доставлено»', async () => {
        const p = await agentPage();
        p.window.__reply = { id: 'b2', queued: false };
        p.window.dispatchEvent(new p.window.CustomEvent('c4builder:delivered', { detail: { id: 'b2' } }));
        await p.write('t', 'Tell agent', 'x', 'Send now');
        expect(p.toast()).toBe('Delivered to the agent');
    });

    it('при непустом review основная кнопка и Ctrl+Enter — Add to review', async () => {
        const p = await agentPage();
        await p.write('t', 'Tell agent', 'first', 'Add');
        expect(p.window.__calls).toEqual([]);
        const pop = await p.openFor('u', 'Tell agent');
        expect(pop.querySelector('.c4b-primary').textContent).toBe('Add');
        const ta = pop.querySelector('textarea');
        ta.value = 'second';
        ta.dispatchEvent(
            new p.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
        );
        await sleep(20);
        expect(p.window.__calls).toEqual([]);
        expect(p.stored().map((i) => [i.quote, i.section, i.comment])).toEqual([
            ['foo bar', 'Flow', 'first'],
            ['baz qux', 'Other', 'second']
        ]);
    });
});

describe('черновик review', () => {
    const twoDrafts = async () => {
        const p = await agentPage();
        await p.write('t', 'Tell agent', 'first', 'Add');
        await p.write('u', 'Tell agent', 'second', 'Add');
        return p.window.localStorage.getItem('__c4builderReview:p1');
    };

    it('переживает повторный рендер страницы; цитаты подсвечены своим классом', async () => {
        const saved = await twoDrafts();
        const p = await agentPage({ storage: { '__c4builderReview:p1': saved } });
        expect(p.panel.textContent).toContain('To agent: 2 pending (1 page)');
        expect([...p.doc.querySelectorAll('mark.c4b-dhl')].map((m) => m.textContent)).toEqual([
            'foo bar',
            'baz qux'
        ]);
    });

    it('другой projectKey черновик не видит', async () => {
        const saved = await twoDrafts();
        const p = await agentPage({ project: 'p2', storage: { '__c4builderReview:p1': saved } });
        expect(p.panel.textContent).toContain('To agent: nothing pending');
        expect(p.doc.querySelector('mark.c4b-dhl')).toBeNull();
    });

    it('Submit review шлёт одну пачку с общим комментарием и очищает черновик', async () => {
        const saved = await twoDrafts();
        const p = await agentPage({ storage: { '__c4builderReview:p1': saved } });
        const submit = p.byText(p.panel, 'Send to agent');
        submit.click();
        const general = p.panel.querySelector('textarea');
        expect(general.hidden).toBe(false);
        general.value = 'Keep the tone';
        submit.click();
        await sleep(20);
        expect(p.window.__calls.length).toBe(1);
        const { url, body } = p.window.__calls[0];
        expect(url).toBe('/__c4builder/feedback');
        expect(body.decision).toBe('submitted');
        expect(body.comments.map((c) => c.comment)).toEqual(['first', 'second']);
        expect(body.general).toBe('Keep the tone');
        expect(p.window.localStorage.getItem('__c4builderReview:p1')).toBeNull();
        expect(p.panel.textContent).toContain('To agent: nothing pending');
        expect(p.doc.querySelector('mark.c4b-dhl')).toBeNull();
        expect(p.panelButtons()).toEqual([DONE]);
    });

    it('пустой черновик: одна основная Done — no changes, она шлёт approved без замечаний', async () => {
        const p = await agentPage();
        expect(p.panelButtons()).toEqual([DONE]);
        const done = p.byText(p.panel, DONE);
        expect(done.className).toBe('c4b-primary');
        done.click();
        await sleep(20);
        expect(p.window.__calls).toEqual([
            {
                url: '/__c4builder/feedback',
                method: 'POST',
                body: { decision: 'approved', comments: [], general: '' }
            }
        ]);
    });

    it('с замечаниями — Discard, Approve и основная Submit review; Approve шлёт замечание с approved', async () => {
        const p = await agentPage();
        await p.write('t', 'Tell agent', 'first', 'Add');
        expect(p.panelButtons()).toEqual(['Discard', 'Approve', 'Send to agent']);
        expect(p.panel.querySelector('.c4b-primary').textContent).toBe('Send to agent');
        p.byText(p.panel, 'Approve').click();
        await sleep(20);
        expect(p.window.__calls.map((c) => [c.body.decision, c.body.comments.map((i) => i.comment)])).toEqual(
            [['approved', ['first']]]
        );
        expect(p.stored()).toEqual([]);
        expect(p.panelButtons()).toEqual([DONE]);
    });

    it('× удаляет одно замечание, Discard — весь черновик после подтверждения', async () => {
        const saved = await twoDrafts();
        const p = await agentPage({ storage: { '__c4builderReview:p1': saved } });
        p.panel.querySelector('.c4b-link').click();
        const dels = p.panel.querySelectorAll('li .c4b-del');
        expect(dels.length).toBe(2);
        dels[0].click();
        expect(p.stored().map((i) => i.comment)).toEqual(['second']);
        p.window.confirm = () => false;
        p.byText(p.panel, 'Discard').click();
        expect(p.stored().length).toBe(1);
        p.window.confirm = () => true;
        p.byText(p.panel, 'Discard').click();
        expect(p.stored()).toEqual([]);
        expect(p.doc.querySelector('mark.c4b-dhl')).toBeNull();
        expect(p.panelButtons()).toEqual([DONE]);
        await sleep(20);
        expect(p.window.__calls).toEqual([]);
    });
});

// Адресат вкладки и черновик по адресату (change feedback-mailboxes, D5–D6).
describe('адресат вкладки', () => {
    const box = (name, state = 'listening', queued = 0) => ({ name, state, queued });
    const TWO = [box('foo'), box('bar', 'reconnecting', 2)];
    const sendTo = (p) => p.panel.querySelector('.c4b-to');
    const pick = (p, name) => {
        const select = p.panel.querySelector('select');
        select.value = name;
        select.dispatchEvent(new p.window.Event('change'));
    };

    it('один ящик: без Send to, имя в статусе, to в POST; тосты с именем', async () => {
        const p = await agentPage({ mailboxes: [box('foo')] });
        expect(sendTo(p).hidden).toBe(true);
        expect(p.panel.querySelector('.c4b-listen').textContent).toBe('foo: listening ●');
        expect(p.window.sessionStorage.getItem('__c4builderTarget:p1')).toBe('foo');
        p.window.__reply = { id: 'b1', queued: true, to: 'foo' };
        await p.write('t', 'Tell agent', 'x', 'Send now');
        expect(p.window.__calls[0].body.to).toBe('foo');
        expect(p.toast()).toBe('Queued for foo — not listening');
        p.window.dispatchEvent(
            new p.window.CustomEvent('c4builder:delivered', { detail: { id: 'b1', to: 'foo' } })
        );
        expect(p.toast()).toBe('Delivered to foo');
    });

    it('два ящика без выбора: Send to со состоянием, отправка недоступна', async () => {
        const p = await agentPage({ mailboxes: TWO });
        expect(sendTo(p).hidden).toBe(false);
        expect([...p.panel.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
            'choose an agent',
            'foo: listening ●',
            'bar: reconnecting ○, 2 queued'
        ]);
        expect(p.byText(p.panel, DONE).disabled).toBe(true);
        const pop = await p.openFor('t', 'Tell agent');
        expect(p.byText(pop, 'Send now').disabled).toBe(true);
        expect(p.byText(pop, 'Add').disabled).toBe(false);
        expect(pop.querySelector('.c4b-listen').textContent).toBe('choose an agent');
        p.byText(pop, 'Send now').click();
        p.byText(p.panel, DONE).click();
        await sleep(20);
        expect(p.window.__calls).toEqual([]);
    });

    it('выбор bar переживает перезагрузку и уходит в to', async () => {
        const first = await agentPage({ mailboxes: TWO });
        pick(first, 'bar');
        expect(first.byText(first.panel, DONE).disabled).toBe(false);
        const p = await agentPage({ mailboxes: TWO, session: first.dump('sessionStorage') });
        expect(p.panel.querySelector('select').value).toBe('bar');
        expect([...p.panel.querySelectorAll('option')].map((o) => o.value)).toEqual(['foo', 'bar']);
        p.byText(p.panel, DONE).click();
        await sleep(20);
        expect(p.window.__calls[0].body).toEqual({
            decision: 'approved',
            comments: [],
            general: '',
            to: 'bar'
        });
    });

    it('две вкладки с foo и bar: черновики не смешиваются', async () => {
        const a = await agentPage({ mailboxes: TWO, session: { '__c4builderTarget:p1': 'foo' } });
        await a.write('t', 'Tell agent', 'one', 'Add');
        await a.write('u', 'Tell agent', 'two', 'Add');
        const b = await agentPage({
            mailboxes: TWO,
            storage: a.dump('localStorage'),
            session: { '__c4builderTarget:p1': 'bar' }
        });
        expect(b.panel.textContent).toContain('To agent: nothing pending');
        expect(b.doc.querySelector('mark.c4b-dhl')).toBeNull();
        await b.write('t', 'Tell agent', 'three', 'Add');
        b.byText(b.panel, 'Send to agent').click();
        b.byText(b.panel, 'Send to agent').click();
        await sleep(20);
        expect(b.window.__calls.map((c) => [c.body.to, c.body.comments.map((i) => i.comment)])).toEqual([
            ['bar', ['three']]
        ]);
        expect(b.stored('__c4builderReview:p1:foo').map((i) => i.comment)).toEqual(['one', 'two']);
        expect(b.stored('__c4builderReview:p1:bar')).toEqual([]);
    });

    it('черновик без адресата переезжает к первому адресату', async () => {
        const p = await agentPage();
        await p.write('t', 'Tell agent', 'early', 'Add');
        p.agentEvent({ on: true, mailboxes: [box('foo')] });
        expect(p.stored()).toEqual([]);
        expect(p.stored('__c4builderReview:p1:foo').map((i) => i.comment)).toEqual(['early']);
        expect(p.panel.textContent).toContain('To agent: 1 pending (1 page)');
        // второй агент не забирает вкладку у первого
        p.agentEvent({ on: true, mailboxes: [box('foo'), box('bar')] });
        expect(p.panel.querySelector('select').value).toBe('foo');
    });

    it('смена адресата перерисовывает панель и подсветку; ящик адресата удалён — он остаётся', async () => {
        const p = await agentPage({
            mailboxes: TWO,
            storage: {
                '__c4builderReview:p1:foo': JSON.stringify([
                    { id: 'a', page: 'A.md', quote: 'foo bar', section: 'Flow', comment: 'x' }
                ])
            },
            session: { '__c4builderTarget:p1': 'bar' }
        });
        expect(p.doc.querySelector('mark.c4b-dhl')).toBeNull();
        pick(p, 'foo');
        expect(p.panel.textContent).toContain('To agent: 1 pending (1 page)');
        expect(p.doc.querySelector('mark.c4b-dhl').textContent).toBe('foo bar');
        p.agentEvent({ on: true, mailboxes: [box('bar')] });
        expect([...p.panel.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
            'bar: listening ●',
            'foo: reconnecting ○'
        ]);
        expect(p.panel.querySelector('select').value).toBe('foo');
    });
});

// Язык интерфейса страницы (change site-ui-language): по navigator.languages или по uiLanguage.
describe('язык интерфейса', () => {
    // С журналом у выделения обе кнопки: и агенту, и в журнал.
    const page = (opts) => agentPage({ reviewLog: { file: 'review.md', heading: ['Remarks'] }, ...opts });
    const RU = ['Сказать агенту', 'Комментарий'];
    const EN = ['Tell agent', 'Comment'];
    const items = (pages) =>
        JSON.stringify(
            pages.map((page, i) => ({ id: `i${i}`, page, quote: 'foo', section: '', comment: 'x' }))
        );

    it('ru-RU, en при auto — русские подписи у выделения, в поповере и в панели', async () => {
        const p = await page({ languages: ['ru-RU', 'en'] });
        expect(p.buttons()).toEqual(RU);
        expect(p.panel.textContent).toContain('Агенту: замечаний нет');
        expect(p.panel.textContent).toContain('агент: не слушает ○');
        expect(p.panelButtons()).toEqual(['Готово, правок нет']);
        const pop = await p.openFor('t', 'Сказать агенту');
        expect([...pop.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
            'Отмена',
            'Добавить',
            'Отправить'
        ]);
        expect(pop.querySelector('.c4b-primary').textContent).toBe('Отправить');
        // пачка агенту — в том же формате, что с английского интерфейса
        await p.write('t', 'Сказать агенту', 'Rename', 'Отправить');
        expect(p.window.__calls.at(-1).body).toEqual({
            decision: 'submitted',
            comments: [{ page: 'A.md', quote: 'foo bar', section: 'Flow', comment: 'Rename' }],
            general: ''
        });
        expect(p.toast()).toBe('В очереди: агент не слушает');
        await p.write('t', 'Сказать агенту', 'first', 'Добавить');
        expect(p.panelButtons()).toEqual(['Очистить', 'Одобрить', 'Отправить агенту']);
    });

    it('de-DE, fr — английские; de-DE, ru, en — русские', async () => {
        expect((await page({ languages: ['de-DE', 'fr'] })).buttons()).toEqual(EN);
        expect((await page({ languages: ['de-DE', 'ru', 'en'] })).buttons()).toEqual(RU);
    });

    it('uiLanguage: en при русском браузере — английские', async () => {
        const p = await page({ language: 'en', languages: ['ru-RU'] });
        expect(p.buttons()).toEqual(EN);
        expect(p.panel.textContent).toContain('To agent: nothing pending');
    });

    it('uiLanguage: ru при английском браузере — русские', async () => {
        const p = await page({ language: 'ru', languages: ['en-US'] });
        expect(p.buttons()).toEqual(RU);
        expect(p.panel.textContent).toContain('Агенту: замечаний нет');
    });

    it('счётчик панели склоняется по обоим числам', async () => {
        const counter = async (pages) =>
            (
                await page({ languages: ['ru'], storage: { '__c4builderReview:p1': items(pages) } })
            ).panel.querySelector('.c4b-link').textContent;
        expect(await counter(['A.md'])).toBe('Агенту: 1 замечание на 1 странице');
        expect(await counter(['A.md', 'B.md'])).toBe('Агенту: 2 замечания на 2 страницах');
        expect(await counter(['A.md', 'A.md', 'B.md', 'C.md', 'D.md'])).toBe(
            'Агенту: 5 замечаний на 4 страницах'
        );
    });

    it('ошибка сервера в тосте — русский префикс и текст ошибки как есть', async () => {
        const p = await page({ languages: ['ru'] });
        p.window.__error = 'Comment is too long';
        await p.write('t', 'Комментарий', 'Why?', 'Добавить комментарий');
        expect(p.toast()).toBe('Не удалось добавить комментарий: Comment is too long');
        expect(p.window.__calls.at(-1).body.comment).toBe('Why?');
    });
});

// Кнопка журнала ревью (change site-review-log): есть только с `reviewLog`, подпись — из
// конфига (`buttons.comment`, раньше `reviewLog.label`) или словаря, POST — на свой маршрут.
describe('кнопка журнала ревью', () => {
    const LOG = { file: 'review.md', heading: ['Remarks'] };

    it('без reviewLog кнопки нет', async () => {
        expect((await agentPage({ languages: ['en'] })).buttons()).toEqual(['Tell agent']);
    });

    it('с reviewLog — кнопка Comment, комментарий уходит на /__c4builder/review-log', async () => {
        const p = await agentPage({ languages: ['en'], reviewLog: LOG });
        expect(p.buttons()).toEqual(['Tell agent', 'Comment']);
        expect(p.byText(p.doc.querySelector('.c4b-cbtns'), 'Comment').title).toBe(
            'Add a comment to the review log'
        );
        const pop = await p.openFor('t', 'Comment');
        expect(pop.querySelector('small').textContent).toBe('To: review.md / Remarks / Flow');
        expect([...pop.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
            'Cancel',
            'Add comment'
        ]);
        p.window.__reply = { file: 'src/review.md', number: 4 };
        await p.write('t', 'Comment', 'Wrong', 'Add comment');
        // первый вызов — GET синхронизации страницы с журналом
        expect(p.window.__calls).toEqual([
            { url: '/__c4builder/review-log?page=A.md', method: 'GET', body: undefined },
            {
                url: '/__c4builder/review-log',
                method: 'POST',
                body: { page: 'A.md', quote: 'foo bar', section: 'Flow', comment: 'Wrong' }
            }
        ]);
        expect(p.toast()).toBe('Added to src/review.md as #4');
    });

    it('подпись из конфига вместо словаря; ошибка — свой префикс', async () => {
        const p = await agentPage({ languages: ['ru'], reviewLog: LOG, labels: { comment: 'Журнал' } });
        expect(p.buttons()).toEqual(['Сказать агенту', 'Журнал']);
        p.window.__error = 'review.md not found';
        await p.write('t', 'Журнал', 'Нет', 'Добавить комментарий');
        expect(p.toast()).toBe('Не удалось добавить комментарий: review.md not found');
    });

    it('страница журнала: строки раздела получают «×», DELETE уходит на маршрут журнала', async () => {
        const body = `<h2>Flow</h2><p id="t">foo bar</p><h2>Remarks</h2>
<table><thead><tr><th>#</th><th>Where</th><th>What</th></tr></thead><tbody>
<tr><td>1</td><td>design → Flow</td><td>Why?</td></tr>
<tr><td>2</td><td>spec → Other</td><td>Really?</td></tr>
</tbody></table>`;
        const p = await agentPage({
            languages: ['en'],
            reviewLog: LOG,
            body,
            reply: { file: 'src/review.md', log: true }
        });
        await sleep(50);
        expect(p.window.__calls).toEqual([
            { url: '/__c4builder/review-log?page=A.md', method: 'GET', body: undefined }
        ]);
        const dels = [...p.doc.querySelectorAll('.c4b-del')];
        expect(dels.length).toBe(2);
        expect(dels[0].title).toBe('Remove this comment');
        expect([...p.doc.querySelectorAll('tr.c4b-qrow')].map((r) => r.id)).toEqual(['c4b-r-1', 'c4b-r-2']);
        p.window.__reply = { file: 'src/review.md' };
        dels[1].click();
        await sleep(20);
        expect(p.window.__calls[1]).toEqual({
            url: '/__c4builder/review-log',
            method: 'DELETE',
            body: { page: 'A.md', number: 2, text: 'spec → Other', cells: ['2', 'spec → Other', 'Really?'] }
        });
        expect(p.toast()).toBe('Removed from src/review.md');
    });

    it('не страница журнала (GET 404) и без reviewLog — кнопок «×» в разделе нет', async () => {
        const body = `<h2>Remarks</h2><ul><li>one</li></ul>`;
        const p = await agentPage({ languages: ['en'], reviewLog: LOG, body, error: 'not the log' });
        await sleep(50);
        expect(p.window.__calls.length).toBe(1);
        expect(p.doc.querySelectorAll('.c4b-del').length).toBe(0);
        const q = await agentPage({ languages: ['en'], body });
        await sleep(50);
        expect(q.window.__calls).toEqual([]);
        expect(q.doc.querySelectorAll('.c4b-del').length).toBe(0);
    });

    it('другая страница: цитаты замечаний подсвечены, номер — ссылка на строку журнала', async () => {
        const reply = {
            file: 'src/review.md',
            log: false,
            logPage: 'Change/review/review.md',
            remarks: [
                { number: 7, comment: 'Bad', quote: 'foo bar', section: 'Flow' },
                { number: 8, comment: 'Nope', quote: 'missing text', section: '' }
            ]
        };
        const p = await agentPage({ languages: ['en'], reviewLog: LOG, reply });
        await sleep(50);
        const marks = [...p.doc.querySelectorAll('mark.c4b-rhl')];
        expect(marks.map((m) => m.textContent)).toEqual(['foo bar']);
        expect(marks[0].classList.contains('c4b-hl')).toBe(true);
        const refs = [...p.doc.querySelectorAll('sup.c4b-rref a')];
        expect(refs.map((a) => a.textContent)).toEqual(['7']);
        expect(refs[0].getAttribute('href')).toBe('#/Change/review/review?id=c4b-r-7');
        expect(refs[0].title).toBe('Bad');
        // повторный проход (doneEach ещё раз) не дублирует подсветку
        p.window.dispatchEvent(new p.window.Event('hashchange'));
        await sleep(400);
        expect(p.doc.querySelectorAll('mark.c4b-rhl').length).toBe(1);
        expect(p.window.__calls.length).toBe(1);
    });

    it('без label — подпись словаря по языку', async () => {
        expect((await agentPage({ languages: ['ru'], reviewLog: LOG })).buttons()).toEqual([
            'Сказать агенту',
            'Комментарий'
        ]);
    });
});
