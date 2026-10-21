import { describe, expect, it } from 'vitest';

import { commentsSnippet } from '../dist/cli/commands/site.comments.js';

// Клиентский сниппет комментариев (change site-comments, D5) в jsdom: подсветка цитат из
// раздела вопросов — через <code>, по префиксу обрезанной цитаты, в своём разделе, с
// номером-ссылкой; раздел вопросов сам не подсвечивается.
const H = 'Open questions';

const render = async (body) => {
    const { JSDOM } = await import('jsdom');
    const html = `<!DOCTYPE html><html><head></head><body>
<script>window.$docsify = { plugins: [] };</script>
<section class="markdown-section">${body}</section>
${commentsSnippet(H)}
</body></html>`;
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
    const { window } = dom;
    const plugin = window.$docsify.plugins.find((p) => typeof p === 'function');
    expect(plugin).toBeTypeOf('function');
    let done;
    plugin({ doneEach: (fn) => (done = fn) });
    done();
    await new Promise((r) => setTimeout(r, 150));
    return window.document;
};

describe('подсветка цитат вопросов', () => {
    it('таблица с номерами: цитата через <code> и границу абзаца, ссылка на строку', async () => {
        const doc = await render(`
<h2 id="flow">Flow</h2>
<p>Call <code>foo</code> then bar.</p>
<p>Second paragraph here.</p>
<h2 id="open-questions">${H}</h2>
<table><thead><tr><th>#</th><th>Q</th><th>Owner</th></tr></thead><tbody>
<tr><td>1</td><td>Why? — «foo then bar» (§ Flow)</td><td></td></tr>
<tr><td>2</td><td>Really? — «paragraph here. Second…» (§ Flow)</td><td></td></tr>
<tr><td>3</td><td>No quote here</td><td></td></tr>
</tbody></table>`);
        const marks = [...doc.querySelectorAll('mark.c4b-hl')];
        expect(marks.map((m) => m.textContent)).toEqual(['foo', ' then bar']);
        const refs = [...doc.querySelectorAll('sup.c4b-ref a')];
        expect(refs.map((a) => a.textContent)).toEqual(['1']);
        expect(refs[0].getAttribute('href')).toBeNull();
        expect(refs[0].getAttribute('role')).toBe('button');
        expect(refs[0].title).toBe('Why?');
        expect(doc.getElementById('c4b-q-1').tagName).toBe('TR');
        // таблица вопросов сама не подсвечена
        expect(doc.querySelector('table mark')).toBeNull();
    });

    it('список и обрезанная цитата: поиск по префиксу, номер — порядковый', async () => {
        const doc = await render(`
<h2>Intro</h2>
<p>Alpha beta gamma delta.</p>
<h2>${H}</h2>
<ul><li>First — «beta gam…»</li><li>Second — «delta.» (§ Nope)</li></ul>`);
        const marks = [...doc.querySelectorAll('mark.c4b-hl')];
        expect(marks.map((m) => m.textContent)).toEqual(['beta gam', 'delta.']);
        expect([...doc.querySelectorAll('sup.c4b-ref a')].map((a) => a.textContent)).toEqual(['1', '2']);
        expect(doc.querySelectorAll('li.c4b-qrow').length).toBe(2);
    });

    it('« — «» в комментарии: цитата — первый кандидат, найденный на странице', async () => {
        const doc = await render(`
<p>Alpha beta gamma delta.</p>
<h2>${H}</h2>
<ul><li>Is it — «x» or not — «beta gamma»</li></ul>`);
        expect([...doc.querySelectorAll('mark.c4b-hl')].map((m) => m.textContent)).toEqual(['beta gamma']);
        expect(doc.querySelector('sup.c4b-ref a').title).toBe('Is it — «x» or not');
    });

    it('без раздела вопросов — ничего не меняется', async () => {
        const doc = await render('<h2>Intro</h2><p>text «quoted» text</p>');
        expect(doc.querySelector('mark.c4b-hl')).toBeNull();
    });
});

describe('удаление вопроса', () => {
    it('кнопка × у каждой строки; клик шлёт DELETE с номером и текстом', async () => {
        const { JSDOM } = await import('jsdom');
        const html = `<!DOCTYPE html><html><head></head><body>
<script>
window.$docsify = { plugins: [] };
window.__calls = [];
window.fetch = function (url, init) {
    window.__calls.push({ url: url, method: init.method, body: JSON.parse(init.body) });
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ file: 'src/x.md' }); } });
};
</script>
<section class="markdown-section">
<h2>Flow</h2><p>foo bar</p>
<h2>${H}</h2>
<table><thead><tr><th>#</th><th>Q</th></tr></thead><tbody>
<tr><td>1</td><td>Why? — «foo» (§ Flow)</td></tr>
<tr><td>2</td><td>Manual <b>question</b></td></tr>
</tbody></table></section>
${commentsSnippet(H)}
</body></html>`;
        const dom = new JSDOM(html, {
            runScripts: 'dangerously',
            pretendToBeVisual: true,
            url: 'http://localhost/#/A/B'
        });
        const { window } = dom;
        let done;
        window.$docsify.plugins.find((p) => typeof p === 'function')({ doneEach: (fn) => (done = fn) });
        done();
        await new Promise((r) => setTimeout(r, 150));
        const doc = window.document;
        const dels = [...doc.querySelectorAll('button.c4b-del')];
        expect(dels.length).toBe(2);
        // текст строки захвачен до вставки кнопки
        dels[1].click();
        await new Promise((r) => setTimeout(r, 20));
        expect(window.__calls).toEqual([
            {
                url: '/__c4builder/comments',
                method: 'DELETE',
                body: { page: 'A/B.md', number: 2, text: 'Manual question' }
            }
        ]);
    });
});

describe('страница для запроса', () => {
    it('берётся из route.file docsify, а не из hash (hash может быть якорем)', async () => {
        const { JSDOM } = await import('jsdom');
        const html = `<!DOCTYPE html><html><head></head><body>
<script>
window.$docsify = { plugins: [] };
window.__calls = [];
window.fetch = function (url, init) { window.__calls.push(JSON.parse(init.body)); return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ file: 'f' }); } }); };
</script>
<section class="markdown-section"><h2>${H}</h2><ul><li>Manual</li></ul></section>
${commentsSnippet(H)}
</body></html>`;
        const { window } = new JSDOM(html, {
            runScripts: 'dangerously',
            pretendToBeVisual: true,
            url: 'http://localhost/#c4b-q-1'
        });
        let done;
        const vm = { route: { file: '/X/Y%20Z/Y%20Z.md' } };
        window.$docsify.plugins.find((p) => typeof p === 'function')({ doneEach: (fn) => (done = fn) }, vm);
        done();
        await new Promise((r) => setTimeout(r, 150));
        window.document.querySelector('button.c4b-del').click();
        await new Promise((r) => setTimeout(r, 20));
        expect(window.__calls[0].page).toBe('X/Y Z/Y Z.md');
    });
});

// Feedback агенту (change site-agent-feedback, D5, D8): кнопки у выделения, поповер Feedback,
// черновик review в localStorage и панель review.
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
    languages
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
        .join('\n');
    const html = `<!DOCTYPE html><html><head></head><body>
<script>
window.$docsify = { plugins: [] };
window.__calls = [];
window.__reply = { id: 'b1', queued: true };
window.__error = '';
window.fetch = function (url, init) {
    window.__calls.push({ url: url, method: init.method, body: JSON.parse(init.body) });
    var reply = window.__error ? { error: window.__error } : window.__reply;
    return Promise.resolve({ ok: !window.__error, status: 400, json: function () { return Promise.resolve(reply); } });
};
Range.prototype.getClientRects = function () { return []; };
Range.prototype.getBoundingClientRect = function () { return { top: 0, bottom: 10, left: 0, right: 10 }; };
${seed}
</script>
<section class="markdown-section">${body}</section>
${commentsSnippet(H, { agent, mailboxes, project, language })}
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
    // Выделение текста элемента и кнопка у него: Feedback или Question.
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
    it('без агентского режима — одна Question, панели review нет', async () => {
        const p = await agentPage({ agent: false });
        expect(p.buttons()).toEqual(['Question']);
        expect(p.panel.hidden).toBe(true);
    });

    it('в агентском режиме — Feedback и Question, панель review видна', async () => {
        const p = await agentPage();
        expect(p.buttons()).toEqual(['Feedback', 'Question']);
        expect(p.panel.hidden).toBe(false);
        // панель прибита к низу экрана — кнопки у выделения и поповер должны быть над ней
        const z = (el) => Number(p.window.getComputedStyle(el).zIndex);
        expect(z(p.panel)).toBeLessThan(z(p.doc.querySelector('.c4b-cbtns')));
        expect(z(p.panel)).toBeLessThan(z(await p.openFor('t', 'Feedback')));
    });

    it('событие agent { on: true } добавляет Feedback без перезагрузки', async () => {
        const p = await agentPage({ agent: false });
        p.agentEvent({ on: true, mailboxes: [{ name: 'foo', state: 'listening', queued: 0 }] });
        expect(p.buttons()).toEqual(['Feedback', 'Question']);
        expect(p.panel.textContent).toContain('foo: listening ●');
    });

    it('Question → Add question шлёт вопрос в раздел вопросов, как раньше', async () => {
        const p = await agentPage();
        const pop = await p.openFor('t', 'Question');
        expect(pop.querySelector('.c4b-primary').textContent).toBe('Add question');
        await p.write('t', 'Question', 'Why?', 'Add question');
        expect(p.window.__calls).toEqual([
            {
                url: '/__c4builder/comments',
                method: 'POST',
                body: { page: 'A.md', quote: 'foo bar', section: 'Flow', comment: 'Why?' }
            }
        ]);
    });
});

describe('поповер Feedback', () => {
    it('Send now шлёт одно замечание submitted; тост «в очереди», по delivered — «доставлено»', async () => {
        const p = await agentPage();
        const pop = await p.openFor('t', 'Feedback');
        expect(pop.querySelector('.c4b-primary').textContent).toBe('Send now');
        expect(pop.textContent).toContain('agent: not listening');
        await p.write('t', 'Feedback', 'Rename to baz', 'Send now');
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
        await p.write('t', 'Feedback', 'x', 'Send now');
        expect(p.toast()).toBe('Delivered to the agent');
    });

    it('при непустом review основная кнопка и Ctrl+Enter — Add to review', async () => {
        const p = await agentPage();
        await p.write('t', 'Feedback', 'first', 'Add to review');
        expect(p.window.__calls).toEqual([]);
        const pop = await p.openFor('u', 'Feedback');
        expect(pop.querySelector('.c4b-primary').textContent).toBe('Add to review');
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
        await p.write('t', 'Feedback', 'first', 'Add to review');
        await p.write('u', 'Feedback', 'second', 'Add to review');
        return p.window.localStorage.getItem('__c4builderReview:p1');
    };

    it('переживает повторный рендер страницы; цитаты подсвечены своим классом', async () => {
        const saved = await twoDrafts();
        const p = await agentPage({
            storage: { '__c4builderReview:p1': saved },
            body: `${FLOW}<h2>${H}</h2><ul><li>Why? — «baz» (§ Other)</li></ul>`
        });
        expect(p.panel.textContent).toContain('Review: 2 pending (1 page)');
        // цитата вопроса внутри черновой: номер-ссылка вопроса в черновую подсветку не попадает
        expect([...p.doc.querySelectorAll('mark.c4b-dhl')].map((m) => m.textContent)).toEqual([
            'foo bar',
            'baz',
            ' qux'
        ]);
        expect([...p.doc.querySelectorAll('mark.c4b-hl')].map((m) => m.textContent)).toEqual(['baz']);
    });

    it('цитата, оставшаяся только в разделе вопросов, там не подсвечивается', async () => {
        const item = { id: 'a', page: 'A.md', quote: 'gone text', section: '', comment: 'x' };
        const p = await agentPage({
            storage: { '__c4builderReview:p1': JSON.stringify([item]) },
            body: `<h2>Flow</h2><p>foo</p><h2>${H}</h2><ul><li>Why? — «gone text»</li></ul>`
        });
        expect(p.doc.querySelectorAll('mark.c4b-dhl')).toHaveLength(0);
    });

    it('другой projectKey черновик не видит', async () => {
        const saved = await twoDrafts();
        const p = await agentPage({ project: 'p2', storage: { '__c4builderReview:p1': saved } });
        expect(p.panel.textContent).toContain('Review: nothing pending');
        expect(p.doc.querySelector('mark.c4b-dhl')).toBeNull();
    });

    it('Submit review шлёт одну пачку с общим комментарием и очищает черновик', async () => {
        const saved = await twoDrafts();
        const p = await agentPage({ storage: { '__c4builderReview:p1': saved } });
        const submit = p.byText(p.panel, 'Submit review');
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
        expect(p.panel.textContent).toContain('Review: nothing pending');
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
        await p.write('t', 'Feedback', 'first', 'Add to review');
        expect(p.panelButtons()).toEqual(['Discard', 'Approve', 'Submit review']);
        expect(p.panel.querySelector('.c4b-primary').textContent).toBe('Submit review');
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
        await p.write('t', 'Feedback', 'x', 'Send now');
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
        const pop = await p.openFor('t', 'Feedback');
        expect(p.byText(pop, 'Send now').disabled).toBe(true);
        expect(p.byText(pop, 'Add to review').disabled).toBe(false);
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
        await a.write('t', 'Feedback', 'one', 'Add to review');
        await a.write('u', 'Feedback', 'two', 'Add to review');
        const b = await agentPage({
            mailboxes: TWO,
            storage: a.dump('localStorage'),
            session: { '__c4builderTarget:p1': 'bar' }
        });
        expect(b.panel.textContent).toContain('Review: nothing pending');
        expect(b.doc.querySelector('mark.c4b-dhl')).toBeNull();
        await b.write('t', 'Feedback', 'three', 'Add to review');
        b.byText(b.panel, 'Submit review').click();
        b.byText(b.panel, 'Submit review').click();
        await sleep(20);
        expect(b.window.__calls.map((c) => [c.body.to, c.body.comments.map((i) => i.comment)])).toEqual([
            ['bar', ['three']]
        ]);
        expect(b.stored('__c4builderReview:p1:foo').map((i) => i.comment)).toEqual(['one', 'two']);
        expect(b.stored('__c4builderReview:p1:bar')).toEqual([]);
    });

    it('черновик без адресата переезжает к первому адресату', async () => {
        const p = await agentPage();
        await p.write('t', 'Feedback', 'early', 'Add to review');
        p.agentEvent({ on: true, mailboxes: [box('foo')] });
        expect(p.stored()).toEqual([]);
        expect(p.stored('__c4builderReview:p1:foo').map((i) => i.comment)).toEqual(['early']);
        expect(p.panel.textContent).toContain('Review: 1 pending (1 page)');
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
        expect(p.panel.textContent).toContain('Review: 1 pending (1 page)');
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
    const RU = ['Замечание', 'Вопрос'];
    const EN = ['Feedback', 'Question'];
    const items = (pages) =>
        JSON.stringify(
            pages.map((page, i) => ({ id: `i${i}`, page, quote: 'foo', section: '', comment: 'x' }))
        );

    it('ru-RU, en при auto — русские подписи у выделения, в поповере и в панели', async () => {
        const p = await agentPage({ languages: ['ru-RU', 'en'] });
        expect(p.buttons()).toEqual(RU);
        expect(p.panel.textContent).toContain('Ревью: замечаний нет');
        expect(p.panel.textContent).toContain('агент: не слушает ○');
        expect(p.panelButtons()).toEqual(['Готово, правок нет']);
        const pop = await p.openFor('t', 'Замечание');
        expect([...pop.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
            'Отмена',
            'В ревью',
            'Отправить'
        ]);
        expect(pop.querySelector('.c4b-primary').textContent).toBe('Отправить');
        // пачка агенту — в том же формате, что с английского интерфейса
        await p.write('t', 'Замечание', 'Rename', 'Отправить');
        expect(p.window.__calls[0].body).toEqual({
            decision: 'submitted',
            comments: [{ page: 'A.md', quote: 'foo bar', section: 'Flow', comment: 'Rename' }],
            general: ''
        });
        expect(p.toast()).toBe('В очереди: агент не слушает');
        await p.write('t', 'Замечание', 'first', 'В ревью');
        expect(p.panelButtons()).toEqual(['Очистить', 'Одобрить', 'Отправить ревью']);
    });

    it('de-DE, fr — английские; de-DE, ru, en — русские', async () => {
        expect((await agentPage({ languages: ['de-DE', 'fr'] })).buttons()).toEqual(EN);
        expect((await agentPage({ languages: ['de-DE', 'ru', 'en'] })).buttons()).toEqual(RU);
    });

    it('uiLanguage: en при русском браузере — английские', async () => {
        const p = await agentPage({ language: 'en', languages: ['ru-RU'] });
        expect(p.buttons()).toEqual(EN);
        expect(p.panel.textContent).toContain('Review: nothing pending');
    });

    it('uiLanguage: ru при английском браузере — русские', async () => {
        const p = await agentPage({ language: 'ru', languages: ['en-US'] });
        expect(p.buttons()).toEqual(RU);
        expect(p.panel.textContent).toContain('Ревью: замечаний нет');
    });

    it('счётчик панели склоняется по обоим числам', async () => {
        const counter = async (pages) =>
            (
                await agentPage({ languages: ['ru'], storage: { '__c4builderReview:p1': items(pages) } })
            ).panel.querySelector('.c4b-link').textContent;
        expect(await counter(['A.md'])).toBe('Ревью: 1 замечание на 1 странице');
        expect(await counter(['A.md', 'B.md'])).toBe('Ревью: 2 замечания на 2 страницах');
        expect(await counter(['A.md', 'A.md', 'B.md', 'C.md', 'D.md'])).toBe(
            'Ревью: 5 замечаний на 4 страницах'
        );
    });

    it('ошибка сервера в тосте — русский префикс и текст ошибки как есть', async () => {
        const p = await agentPage({ languages: ['ru'] });
        p.window.__error = 'Comment is too long';
        await p.write('t', 'Вопрос', 'Why?', 'Добавить вопрос');
        expect(p.toast()).toBe('Не удалось добавить вопрос: Comment is too long');
        expect(p.window.__calls[0].body.comment).toBe('Why?');
    });
});
