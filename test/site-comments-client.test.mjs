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

const agentPage = async ({
    agent = true,
    listening = false,
    project = 'p1',
    storage = {},
    body = FLOW
} = {}) => {
    const { JSDOM } = await import('jsdom');
    const seed = Object.entries(storage)
        .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
        .join('\n');
    const html = `<!DOCTYPE html><html><head></head><body>
<script>
window.$docsify = { plugins: [] };
window.__calls = [];
window.__reply = { id: 'b1', queued: true };
window.fetch = function (url, init) {
    window.__calls.push({ url: url, method: init.method, body: JSON.parse(init.body) });
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(window.__reply); } });
};
Range.prototype.getClientRects = function () { return []; };
Range.prototype.getBoundingClientRect = function () { return { top: 0, bottom: 10, left: 0, right: 10 }; };
${seed}
</script>
<section class="markdown-section">${body}</section>
${commentsSnippet(H, { agent, listening, project })}
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
    const toast = () => doc.querySelector('.c4b-ctoast')?.textContent;
    const stored = () => JSON.parse(window.localStorage.getItem('__c4builderReview:p1') || '[]');
    return { window, doc, buttons, byText, openFor, write, panel, toast, stored };
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
        p.window.dispatchEvent(
            new p.window.CustomEvent('c4builder:agent', { detail: { on: true, listening: true } })
        );
        expect(p.buttons()).toEqual(['Feedback', 'Question']);
        expect(p.panel.textContent).toContain('agent: listening');
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
        const p = await agentPage({ listening: true });
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
    });

    it('Approve при пустом черновике шлёт approved без замечаний', async () => {
        const p = await agentPage();
        expect(p.byText(p.panel, 'Submit review').disabled).toBe(true);
        p.byText(p.panel, 'Approve').click();
        await sleep(20);
        expect(p.window.__calls).toEqual([
            {
                url: '/__c4builder/feedback',
                method: 'POST',
                body: { decision: 'approved', comments: [], general: '' }
            }
        ]);
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
        expect(p.window.__calls).toEqual([]);
    });
});
