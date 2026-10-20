export const COMMENTS_PATH = '/__c4builder/comments';
export const FEEDBACK_PATH = '/__c4builder/feedback';
export const FEEDBACK_HEADER = 'X-C4builder-Feedback';

const CSS = [
    '.c4b-cbtns{position:absolute;z-index:1001;white-space:nowrap}',
    '.c4b-cbtns button{margin-right:4px;padding:4px 10px;border:1px solid #42b983;border-radius:4px;background:#fff;color:#2c3e50;font:13px/1.4 sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.15)}',
    '.c4b-cbtns button.c4b-fb{border-color:#3b82f6}',
    '.c4b-cpop{position:absolute;z-index:1002;width:380px;max-width:calc(100vw - 32px);padding:10px;border:1px solid #ddd;border-radius:6px;background:#fff;color:#2c3e50;font:13px/1.4 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2)}',
    '.c4b-cpop blockquote{margin:0 0 8px;padding:4px 8px;border-left:3px solid #42b983;background:#f8f8f8;max-height:80px;overflow:auto;font-size:12px;white-space:pre-wrap}',
    '.c4b-cpop textarea,.c4b-review textarea{width:100%;box-sizing:border-box;min-height:70px;padding:6px;border:1px solid #ccc;border-radius:4px;font:13px/1.4 sans-serif;resize:vertical}',
    '.c4b-cpop .c4b-row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px}',
    '.c4b-cpop small{color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.c4b-cpop button,.c4b-review button{padding:4px 12px;border:1px solid #ccc;border-radius:4px;background:#fff;color:#2c3e50;cursor:pointer;font:13px sans-serif}',
    '.c4b-cpop button.c4b-primary,.c4b-review button.c4b-primary{border-color:#42b983;background:#42b983;color:#fff}',
    '.c4b-cpop button:disabled,.c4b-review button:disabled{opacity:.6;cursor:default}',
    // Панель review — ниже кнопок у выделения и поповера: она прибита к низу экрана и иначе
    // перекрывает их у выделения в нижних строках.
    '.c4b-review{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:1000;width:520px;max-width:calc(100vw - 32px);box-sizing:border-box;padding:8px 12px;border:1px solid #3b82f6;border-radius:6px;background:#fff;color:#2c3e50;font:13px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2)}',
    '.c4b-review .c4b-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}',
    '.c4b-review .c4b-row small{flex:1;color:#888;white-space:nowrap}',
    '.c4b-review button.c4b-link{padding:0;border:0;background:none;color:#2c3e50;font-weight:700;text-decoration:underline dotted}',
    '.c4b-review ul{margin:6px 0;padding:0;list-style:none;max-height:40vh;overflow:auto}',
    '.c4b-review li{padding:3px 0;border-top:1px solid #eee;overflow-wrap:anywhere}',
    '.c4b-review textarea{margin-top:6px}',
    '.c4b-review .c4b-del{opacity:1}',
    '.c4b-ctoast{position:fixed;left:16px;bottom:16px;z-index:1003;max-width:420px;padding:8px 14px;border-radius:6px;background:#2c3e50;color:#fff;font:13px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)}',
    '.c4b-ctoast.c4b-err{background:#c0392b}',
    'mark.c4b-hl{background:#fff3a0;color:inherit;padding:0;border-radius:2px}',
    'mark.c4b-dhl{background:#cfe3ff;color:inherit;padding:0;border-radius:2px}',
    'sup.c4b-ref{font-size:.7em;line-height:0;margin-left:1px;user-select:none}',
    'sup.c4b-ref a{color:#b58900;text-decoration:none;font-weight:700;cursor:pointer}',
    '.c4b-qrow{transition:background .3s}',
    '.c4b-qflash{background:#fff3a0!important}',
    '.c4b-del{margin-left:6px;padding:0 5px;border:1px solid transparent;border-radius:3px;background:none;color:#999;font:12px/1.4 sans-serif;cursor:pointer;opacity:0;vertical-align:middle}',
    '.c4b-qrow:hover .c4b-del{opacity:1}',
    '.c4b-del:hover{color:#fff;background:#c0392b;border-color:#c0392b}',
    '.c4b-del:disabled{opacity:.5;cursor:default}'
].join('');

const jsString = (s: string): string =>
    JSON.stringify(s)
        .replace(/</g, '\\u003c')
        .replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

// Начальное состояние агентского режима и ключ проекта вставляет сервер, дальше его обновляют
// события `c4builder:agent` от сниппета livereload (change site-agent-feedback, design D4, D8).
export const commentsSnippet = (
    heading: string,
    { agent = false, listening = false, project = '' } = {}
): string => `
<script>
(function () {
    if (window.__c4builderComments) return;
    window.__c4builderComments = true;
    var ENDPOINT = '${COMMENTS_PATH}';
    var FEEDBACK = '${FEEDBACK_PATH}';
    var HEADING = ${jsString(heading)};
    var TOAST_KEY = '__c4builderCommentToast';
    var DRAFT_KEY = '__c4builderReview:' + ${jsString(project)};
    var AGENT = { on: ${agent}, listening: ${listening} };
    var BLOCKS = 'p,li,td,th,h1,h2,h3,h4,h5,h6,pre,blockquote,dd,dt,div,section,details,summary';
    var style = document.createElement('style');
    style.textContent = ${jsString(CSS)};
    document.head.appendChild(style);

    var collapse = function (s) { return String(s).replace(/\\s+/g, ' ').trim(); };
    var same = function (a, b) { return collapse(a).toLowerCase() === collapse(b).toLowerCase(); };

    var toastEl = null, toastTimer = 0;
    var toast = function (msg, err) {
        if (toastEl) toastEl.remove();
        toastEl = document.createElement('div');
        toastEl.className = 'c4b-ctoast' + (err ? ' c4b-err' : '');
        toastEl.textContent = msg;
        document.body.appendChild(toastEl);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { if (toastEl) { toastEl.remove(); toastEl = null; } }, err ? 8000 : 5000);
    };
    try {
        var saved = sessionStorage.getItem(TOAST_KEY);
        if (saved) { sessionStorage.removeItem(TOAST_KEY); toast(saved); }
    } catch (e) {}

    var content = function () { return document.querySelector('.markdown-section'); };
    var headingLevel = function (el) { return /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 0; };
    var sectionOf = function (h) {
        var out = [], lvl = headingLevel(h);
        for (var el = h.nextElementSibling; el; el = el.nextElementSibling) {
            var l = headingLevel(el);
            if (l && l <= lvl) break;
            out.push(el);
        }
        return out;
    };
    var findHeading = function (root, text) {
        var hs = root.querySelectorAll('h1,h2,h3,h4,h5,h6');
        for (var i = 0; i < hs.length; i++) if (same(hs[i].textContent, text)) return hs[i];
        return null;
    };

    var SEP = ' \\u2014 \\u00ab';
    var parseQuestions = function (text) {
        var s = collapse(text), out = [];
        for (var at = s.indexOf(SEP); at >= 0; at = s.indexOf(SEP, at + 1)) {
            var m = s.slice(at + SEP.length).match(/^([\\s\\S]*)\\u00bb(?: \\(\\u00a7 (.*)\\))?$/);
            var quote = m ? m[1].replace(/\\u2026$/, '').trim() : '';
            if (quote) out.push({ comment: s.slice(0, at), quote: quote, section: m[2] || '' });
        }
        return out;
    };
    var textIndex = function (roots, skip) {
        var chars = [], map = [], lastBlock = null, prevSpace = true;
        var walk = function (node) {
            if (node.nodeType === 1) {
                if (skip.indexOf(node) >= 0 || (node.tagName === 'SUP' && node.classList.contains('c4b-ref'))) return;
                if (/^(SCRIPT|STYLE)$/.test(node.tagName)) return;
                for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
                return;
            }
            if (node.nodeType !== 3) return;
            var block = node.parentNode.closest ? node.parentNode.closest(BLOCKS) : null;
            if (block !== lastBlock && !prevSpace && chars.length) { chars.push(' '); map.push(null); prevSpace = true; }
            lastBlock = block;
            var s = node.nodeValue;
            for (var i = 0; i < s.length; i++) {
                var ch = s[i];
                if (/\\s/.test(ch)) {
                    if (prevSpace) continue;
                    chars.push(' '); map.push(null); prevSpace = true;
                } else {
                    chars.push(ch); map.push({ node: node, offset: i }); prevSpace = false;
                }
            }
        };
        for (var r = 0; r < roots.length; r++) walk(roots[r]);
        return { text: chars.join(''), map: map };
    };
    var wrapRange = function (idx, from, to, title, cls) {
        var first = null, last = null, i;
        for (i = from; i < to && !first; i++) first = idx.map[i];
        for (i = to - 1; i >= from && !last; i--) last = idx.map[i];
        if (!first || !last) return null;
        var nodes = [], cur = first.node;
        var walker = document.createTreeWalker(content(), NodeFilter.SHOW_TEXT);
        walker.currentNode = cur;
        while (cur) { nodes.push(cur); if (cur === last.node) break; cur = walker.nextNode(); }
        var marks = [];
        for (i = nodes.length - 1; i >= 0; i--) {
            var n = nodes[i];
            var start = n === first.node ? first.offset : 0;
            var end = n === last.node ? last.offset + 1 : n.nodeValue.length;
            if (end < n.nodeValue.length) n.splitText(end);
            var mid = start > 0 ? n.splitText(start) : n;
            // Overlapping quotes: the number link of a question is not part of the text.
            if (!mid.nodeValue.trim() || mid.parentNode.closest('sup.c4b-ref')) continue;
            var mark = document.createElement('mark');
            mark.className = cls;
            mark.title = title;
            mid.parentNode.insertBefore(mark, mid);
            mark.appendChild(mid);
            marks.unshift(mark);
        }
        return marks;
    };
    var tryIn = function (idx, quote, cls, title) {
        var at = idx.text.indexOf(quote);
        var marks = at < 0 ? null : wrapRange(idx, at, at + quote.length, title, cls);
        return marks && marks.length ? marks : null;
    };
    // The quote is searched in its own section first: the same words may repeat on the page.
    var locate = function (root, q, skip, cls, title) {
        var marks = null;
        if (q.section) {
            var sh = findHeading(root, q.section);
            if (sh && skip.indexOf(sh) < 0) marks = tryIn(textIndex(sectionOf(sh), skip), q.quote, cls, title);
        }
        return marks || tryIn(textIndex([root], skip), q.quote, cls, title);
    };
    var flash = function (row) {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row.classList.add('c4b-qflash');
        setTimeout(function () { row.classList.remove('c4b-qflash'); }, 1500);
    };
    var highlight = function () {
        var root = content();
        if (!root || root.querySelector('mark.c4b-hl, .c4b-del')) return;
        var h = findHeading(root, HEADING);
        if (!h) return;
        var section = sectionOf(h);
        var items = [];
        section.forEach(function (el) {
            if (el.tagName === 'TABLE') {
                var rows = el.querySelectorAll('tbody tr');
                for (var i = 0; i < rows.length; i++) {
                    var cells = rows[i].querySelectorAll('td');
                    if (!cells.length) continue;
                    var numeric = /^\\d+$/.test(collapse(cells[0].textContent));
                    var textCell = numeric && cells.length > 1 ? cells[1] : cells[0];
                    if (!collapse(textCell.textContent)) continue;
                    items.push({ row: rows[i], cell: textCell, number: numeric ? collapse(cells[0].textContent) : String(items.length + 1), text: textCell.textContent });
                }
            } else if (/^[UO]L$/.test(el.tagName)) {
                var lis = el.children;
                for (var j = 0; j < lis.length; j++) items.push({ row: lis[j], cell: lis[j], number: String(items.length + 1), text: lis[j].textContent });
            }
        });
        var addDelete = function (item) {
            var del = document.createElement('button');
            del.type = 'button';
            del.className = 'c4b-del';
            del.textContent = '\\u00d7';
            del.title = 'Remove this question';
            del.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                del.disabled = true;
                send({ page: pageFile(), number: Number(item.number) || null, text: collapse(item.text) }, 'DELETE').then(function (r) {
                    var msg = 'Removed from ' + r.file;
                    try { sessionStorage.setItem(TOAST_KEY, msg); } catch (e) {}
                    toast(msg);
                }, function (err) {
                    del.disabled = false;
                    toast('Remove failed: ' + (err && err.message ? err.message : err), true);
                });
            });
            item.cell.appendChild(del);
        };
        var skip = [h].concat(section);
        items.forEach(function (item) {
            item.row.classList.add('c4b-qrow');
            item.row.id = item.row.id || 'c4b-q-' + item.number;
            addDelete(item);
            // Index is rebuilt per try: wrapping splits text nodes and stales the previous map.
            var q = null, marks = null;
            parseQuestions(item.text).some(function (c) {
                marks = locate(root, c, skip, 'c4b-hl', c.comment);
                q = marks ? c : null;
                return !!marks;
            });
            if (!marks) return;
            var sup = document.createElement('sup');
            sup.className = 'c4b-ref';
            var a = document.createElement('a');
            a.setAttribute('role', 'button');
            a.tabIndex = 0;
            a.textContent = item.number;
            a.title = q.comment;
            a.addEventListener('click', function (e) { e.preventDefault(); flash(item.row); });
            sup.appendChild(a);
            var lastMark = marks[marks.length - 1];
            lastMark.parentNode.insertBefore(sup, lastMark.nextSibling);
        });
    };
    var schedule = function () {
        setTimeout(function () {
            try { highlight(); } catch (e) {}
            try { highlightDraft(); } catch (e) {}
        }, 50);
    };
    var docsifyVm = null;
    if (window.$docsify) {
        window.$docsify.plugins = [].concat(window.$docsify.plugins || [], function (hook, vm) {
            docsifyVm = vm || null;
            hook.doneEach(schedule);
        });
    }
    window.addEventListener('hashchange', function () { setTimeout(schedule, 300); });
    window.addEventListener('load', function () { setTimeout(schedule, 500); });

    var button = function (label, onClick, cls) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (cls) b.className = cls;
        if (onClick) b.addEventListener('click', onClick);
        return b;
    };
    var btns = document.createElement('div');
    btns.className = 'c4b-cbtns';
    btns.hidden = true;
    var fbBtn = button('Feedback', null, 'c4b-fb');
    fbBtn.title = 'Tell the agent what to change';
    var qBtn = button('Question');
    qBtn.title = 'Add a question to the ' + HEADING + ' section of the source file';
    btns.appendChild(fbBtn);
    btns.appendChild(qBtn);
    document.body.appendChild(btns);
    var pop = null;

    var selection = function () {
        var sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
        var range = sel.getRangeAt(0);
        var root = content();
        if (!root) return null;
        var node = range.commonAncestorContainer;
        var el = node.nodeType === 1 ? node : node.parentNode;
        if (!root.contains(el) || (pop && pop.contains(el))) return null;
        var text = sel.toString().trim();
        return text ? { range: range, text: text } : null;
    };
    var headingBefore = function (range) {
        var root = content();
        if (!root) return '';
        var hs = root.querySelectorAll('h1,h2,h3,h4,h5,h6');
        var found = '';
        for (var i = 0; i < hs.length; i++) {
            if (hs[i].compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING)
                found = hs[i].textContent.trim();
            else break;
        }
        return found;
    };
    var anchorRect = function (range) {
        var rects = range.getClientRects();
        return rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    };
    var place = function (el, rect) {
        el.style.top = (rect.bottom + window.scrollY + 6) + 'px';
        el.style.left = Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - el.offsetWidth - 8)) + 'px';
    };
    var update = function () {
        if (pop) return;
        var s = selection();
        if (!s) { btns.hidden = true; return; }
        btns.hidden = false;
        place(btns, anchorRect(s.range));
    };
    document.addEventListener('selectionchange', function () { setTimeout(update, 0); });

    var pageFile = function () {
        var file = docsifyVm && docsifyVm.route && docsifyVm.route.file;
        if (typeof file === 'string' && file) {
            try { file = decodeURIComponent(file); } catch (e) {}
            file = file.replace(/^https?:\\/\\/[^/]+/, '').replace(/^\\/+/, '');
            if (file) return file;
        }
        var p = location.hash.replace(/^#/, '').split('?')[0];
        try { p = decodeURIComponent(p); } catch (e) {}
        p = p.replace(/^\\/+/, '').replace(/\\/+$/, '');
        if (!p) return (window.$docsify && window.$docsify.homepage) || 'README.md';
        return /\\.md$/i.test(p) ? p : p + '.md';
    };
    var send = function (body, method, url) {
        return fetch(url || ENDPOINT, {
            method: method || 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
                if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
                return data;
            });
        });
    };
    var failure = function (what) {
        return function (err) { toast(what + ' failed: ' + (err && err.message ? err.message : err), true); };
    };

    // Feedback to the agent: "Delivered" only after the server handed the batch to
    // "c4builder feedback"; the event may outrun the POST response, hence both maps.
    var delivered = {}, pending = {};
    var sendBatch = function (decision, comments, general) {
        return send({ decision: decision, comments: comments, general: general }, 'POST', FEEDBACK).then(function (r) {
            if (delivered[r.id]) return toast('Delivered to the agent');
            pending[r.id] = true;
            toast(r.queued ? 'Queued \\u2014 agent is not listening' : 'Sent to the agent');
        });
    };
    window.addEventListener('c4builder:delivered', function (e) {
        var id = e.detail && e.detail.id;
        delivered[id] = true;
        if (pending[id]) { delete pending[id]; toast('Delivered to the agent'); }
    });

    // Review draft lives in localStorage per project: it survives livereload and a closed tab;
    // without storage it lives until the page reloads.
    var memDraft = [];
    var draft = function () {
        try {
            var v = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]');
            return Array.isArray(v) ? v : [];
        } catch (e) { return memDraft; }
    };
    var saveDraft = function (items) {
        memDraft = items;
        try {
            if (items.length) localStorage.setItem(DRAFT_KEY, JSON.stringify(items));
            else localStorage.removeItem(DRAFT_KEY);
        } catch (e) {}
        renderPanel();
        highlightDraft();
    };
    var highlightDraft = function () {
        var root = content();
        if (!root) return;
        var marks = root.querySelectorAll('mark.c4b-dhl');
        for (var i = 0; i < marks.length; i++) {
            var m = marks[i], parent = m.parentNode;
            while (m.firstChild) parent.insertBefore(m.firstChild, m);
            parent.removeChild(m);
            parent.normalize();
        }
        var page = pageFile();
        var h = findHeading(root, HEADING);
        var skip = h ? [h].concat(sectionOf(h)) : [];
        draft().forEach(function (it) {
            if (it.page === page) locate(root, { quote: collapse(it.quote), section: it.section }, skip, 'c4b-dhl', it.comment);
        });
    };

    var panel = document.createElement('div');
    panel.className = 'c4b-review';
    var expanded = false, busy = false;
    var count = button('', function () { expanded = !expanded; renderPanel(); }, 'c4b-link');
    var listen = document.createElement('small');
    listen.className = 'c4b-listen';
    var list = document.createElement('ul');
    var general = document.createElement('textarea');
    general.placeholder = 'Overall comment (optional, Ctrl+Enter to submit, Esc to hide)';
    general.hidden = true;
    var finish = function (decision) {
        var items = draft(), ids = items.map(function (it) { return it.id; });
        busy = true;
        renderPanel();
        sendBatch(decision, items, general.hidden ? '' : general.value.trim()).then(function () {
            general.value = '';
            general.hidden = true;
            expanded = false;
            saveDraft(draft().filter(function (it) { return ids.indexOf(it.id) < 0; }));
        }, failure('Review')).then(function () { busy = false; renderPanel(); });
    };
    var discard = button('Discard', function () {
        var n = draft().length;
        if (n && !window.confirm('Discard ' + n + ' pending comment' + (n === 1 ? '' : 's') + '?')) return;
        general.value = '';
        general.hidden = true;
        saveDraft([]);
    });
    var approve = button('Approve', function () { finish('approved'); });
    approve.title = 'Tell the agent there is nothing more to change (pending comments go along)';
    var submit = button('Submit review', function () {
        if (!general.hidden) return finish('submitted');
        general.hidden = false;
        general.focus();
    }, 'c4b-primary');
    general.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); general.hidden = true; }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit.click(); }
    });
    var head = document.createElement('div');
    head.className = 'c4b-row';
    [count, listen, discard, approve, submit].forEach(function (el) { head.appendChild(el); });
    panel.appendChild(head);
    panel.appendChild(list);
    panel.appendChild(general);
    document.body.appendChild(panel);
    var renderPanel = function () {
        panel.hidden = !AGENT.on;
        var items = draft(), pages = {};
        items.forEach(function (it) { pages[it.page] = true; });
        var n = Object.keys(pages).length;
        count.textContent = items.length
            ? 'Review: ' + items.length + ' pending (' + n + (n === 1 ? ' page)' : ' pages)')
            : 'Review: nothing pending';
        count.disabled = !items.length;
        list.textContent = '';
        items.forEach(function (it) {
            var li = document.createElement('li');
            var q = collapse(it.quote);
            li.textContent = it.page + ' \\u2014 \\u00ab' + (q.length > 60 ? q.slice(0, 59) + '\\u2026' : q) + '\\u00bb: ' + it.comment;
            var del = button('\\u00d7', function () {
                saveDraft(draft().filter(function (x) { return x.id !== it.id; }));
            }, 'c4b-del');
            del.title = 'Remove from the review';
            li.appendChild(del);
            list.appendChild(li);
        });
        list.hidden = !expanded || !items.length;
        discard.disabled = busy;
        approve.disabled = busy;
        submit.disabled = busy || !items.length;
    };
    var renderAgent = function () {
        fbBtn.hidden = !AGENT.on;
        renderPanel();
        var text = 'agent: ' + (AGENT.listening ? 'listening \\u25cf' : 'not listening \\u25cb');
        var els = document.querySelectorAll('.c4b-listen');
        for (var i = 0; i < els.length; i++) { els[i].textContent = text; els[i].title = text; }
    };
    window.addEventListener('c4builder:agent', function (e) {
        var d = e.detail || {};
        AGENT.on = !!d.on;
        AGENT.listening = !!d.listening;
        renderAgent();
    });
    window.addEventListener('storage', function (e) {
        if (e.key === DRAFT_KEY) { renderPanel(); highlightDraft(); }
    });

    var close = function () {
        if (pop) { pop.remove(); pop = null; }
        btns.hidden = true;
    };
    var open = function (data, rect, feedback) {
        close();
        pop = document.createElement('div');
        pop.className = 'c4b-cpop';
        var quote = document.createElement('blockquote');
        quote.textContent = data.quote;
        var ta = document.createElement('textarea');
        ta.placeholder = (feedback ? 'What should the agent change?' : 'Your question') + ' (Ctrl+Enter to send, Esc to cancel)';
        var row = document.createElement('div');
        row.className = 'c4b-row';
        var hint = document.createElement('small');
        if (feedback) hint.className = 'c4b-listen';
        else hint.textContent = hint.title = 'To: ' + HEADING + (data.section ? ' / ' + data.section : '');
        var actions = document.createElement('span');
        var buttons = [button('Cancel', close)];
        var run = function (action) {
            return function () {
                var comment = ta.value.trim();
                if (!comment) { ta.focus(); return; }
                buttons.forEach(function (b) { b.disabled = true; });
                action(comment).then(close, function (err) {
                    buttons.forEach(function (b) { b.disabled = false; });
                    failure(feedback ? 'Feedback' : 'Question')(err);
                });
            };
        };
        var item = function (comment) {
            return { page: pageFile(), quote: data.quote, section: data.section, comment: comment };
        };
        var primary;
        if (feedback) {
            var add = button('Add to review', run(function (c) {
                var it = item(c);
                it.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                saveDraft(draft().concat([it]));
                return Promise.resolve();
            }));
            var now = button('Send now', run(function (c) { return sendBatch('submitted', [item(c)], ''); }));
            buttons.push(add, now);
            // As in a GitLab merge request: once a review is started, comments go into it.
            primary = draft().length ? add : now;
        } else {
            primary = button('Add question', run(function (c) {
                return send(item(c)).then(function (r) {
                    var msg = 'Added to ' + r.file + (r.number ? ' as #' + r.number : '');
                    try { sessionStorage.setItem(TOAST_KEY, msg); } catch (e) {}
                    toast(msg);
                });
            }));
            buttons.push(primary);
        }
        primary.className = 'c4b-primary';
        buttons.forEach(function (b) {
            actions.appendChild(b);
            actions.appendChild(document.createTextNode(' '));
        });
        row.appendChild(hint);
        row.appendChild(actions);
        pop.appendChild(quote);
        pop.appendChild(ta);
        pop.appendChild(row);
        document.body.appendChild(pop);
        renderAgent();
        place(pop, rect);
        ta.focus();
        ta.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); primary.click(); }
        });
    };

    var openFor = function (feedback) {
        return function () {
            var s = selection();
            if (s) open({ quote: s.text, section: headingBefore(s.range) }, anchorRect(s.range), feedback);
        };
    };
    btns.addEventListener('mousedown', function (e) { e.preventDefault(); });
    fbBtn.addEventListener('click', openFor(true));
    qBtn.addEventListener('click', openFor(false));
    document.addEventListener('mousedown', function (e) {
        if (pop && !pop.contains(e.target) && !btns.contains(e.target)) close();
    });
    window.addEventListener('hashchange', close);
    renderAgent();
})();
</script>`;
