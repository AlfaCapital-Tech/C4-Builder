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
