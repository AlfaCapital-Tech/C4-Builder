//
//
export const COMMENTS_PATH = '/__c4builder/comments';

const CSS = [
    '.c4b-cbtn{position:absolute;z-index:1001;padding:4px 10px;border:1px solid #42b983;border-radius:4px;background:#fff;color:#2c3e50;font:13px/1.4 sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.15)}',
    '.c4b-cpop{position:absolute;z-index:1002;width:380px;max-width:calc(100vw - 32px);padding:10px;border:1px solid #ddd;border-radius:6px;background:#fff;color:#2c3e50;font:13px/1.4 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2)}',
    '.c4b-cpop blockquote{margin:0 0 8px;padding:4px 8px;border-left:3px solid #42b983;background:#f8f8f8;max-height:80px;overflow:auto;font-size:12px;white-space:pre-wrap}',
    '.c4b-cpop textarea{width:100%;box-sizing:border-box;min-height:70px;padding:6px;border:1px solid #ccc;border-radius:4px;font:13px/1.4 sans-serif;resize:vertical}',
    '.c4b-cpop .c4b-row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px}',
    '.c4b-cpop small{color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.c4b-cpop button{padding:4px 12px;border:1px solid #ccc;border-radius:4px;background:#fff;color:#2c3e50;cursor:pointer;font:13px sans-serif}',
    '.c4b-cpop button.c4b-primary{border-color:#42b983;background:#42b983;color:#fff}',
    '.c4b-cpop button:disabled{opacity:.6;cursor:default}',
    '.c4b-ctoast{position:fixed;left:16px;bottom:16px;z-index:1003;max-width:420px;padding:8px 14px;border-radius:6px;background:#2c3e50;color:#fff;font:13px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)}',
    '.c4b-ctoast.c4b-err{background:#c0392b}',
    'mark.c4b-hl{background:#fff3a0;color:inherit;padding:0;border-radius:2px}',
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

export const commentsSnippet = (heading: string): string => `
<script>
(function () {
    if (window.__c4builderComments) return;
    window.__c4builderComments = true;
    var ENDPOINT = '${COMMENTS_PATH}';
    var HEADING = ${jsString(heading)};
    var TOAST_KEY = '__c4builderCommentToast';
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

    var parseQuestion = function (text) {
        var m = collapse(text).match(/^(.*?) \\u2014 \\u00ab([\\s\\S]*)\\u00bb(?: \\(\\u00a7 (.*)\\))?$/);
        if (!m || !m[2]) return null;
        var quote = m[2], prefix = false;
        if (/\\u2026$/.test(quote)) { quote = quote.slice(0, -1).trim(); prefix = true; }
        return { comment: m[1], quote: quote, section: m[3] || '', prefix: prefix };
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
    var wrapRange = function (idx, from, to, title) {
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
            if (!mid.nodeValue.trim()) continue;
            var mark = document.createElement('mark');
            mark.className = 'c4b-hl';
            mark.title = title;
            mid.parentNode.insertBefore(mark, mid);
            mark.appendChild(mid);
            marks.unshift(mark);
        }
        return marks;
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
        var pageIdx = null;
        items.forEach(function (item) {
            item.row.classList.add('c4b-qrow');
            item.row.id = item.row.id || 'c4b-q-' + item.number;
            addDelete(item);
            var q = parseQuestion(item.text);
            if (!q) return;
            var marks = null;
            var tryIn = function (idx) {
                var at = idx.text.indexOf(q.quote);
                return at < 0 ? null : wrapRange(idx, at, at + q.quote.length, q.comment);
            };
            if (q.section) {
                var sh = findHeading(root, q.section);
                if (sh && skip.indexOf(sh) < 0) marks = tryIn(textIndex(sectionOf(sh), skip));
            }
            if (!marks) {
                pageIdx = textIndex([root], skip);
                marks = tryIn(pageIdx);
            }
            if (!marks || !marks.length) return;
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
    var schedule = function () { setTimeout(function () { try { highlight(); } catch (e) {} }, 50); };
    var docsifyVm = null;
    if (window.$docsify) {
        window.$docsify.plugins = [].concat(window.$docsify.plugins || [], function (hook, vm) {
            docsifyVm = vm || null;
            hook.doneEach(schedule);
        });
    }
    window.addEventListener('hashchange', function () { setTimeout(schedule, 300); });
    window.addEventListener('load', function () { setTimeout(schedule, 500); });

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'c4b-cbtn';
    btn.textContent = 'Comment';
    btn.hidden = true;
    document.body.appendChild(btn);
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
        if (!s) { btn.hidden = true; return; }
        btn.hidden = false;
        place(btn, anchorRect(s.range));
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
    var send = function (body, method) {
        return fetch(ENDPOINT, {
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

    var close = function () {
        if (pop) { pop.remove(); pop = null; }
        btn.hidden = true;
    };
    var open = function (data, rect) {
        close();
        pop = document.createElement('div');
        pop.className = 'c4b-cpop';
        var quote = document.createElement('blockquote');
        quote.textContent = data.quote;
        var ta = document.createElement('textarea');
        ta.placeholder = 'Your question or comment (Ctrl+Enter to add, Esc to cancel)';
        var row = document.createElement('div');
        row.className = 'c4b-row';
        var hint = document.createElement('small');
        hint.textContent = 'To: ' + HEADING + (data.section ? ' / ' + data.section : '');
        hint.title = hint.textContent;
        var actions = document.createElement('span');
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        var ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'c4b-primary';
        ok.textContent = 'Add';
        actions.appendChild(cancel);
        actions.appendChild(document.createTextNode(' '));
        actions.appendChild(ok);
        row.appendChild(hint);
        row.appendChild(actions);
        pop.appendChild(quote);
        pop.appendChild(ta);
        pop.appendChild(row);
        document.body.appendChild(pop);
        place(pop, rect);
        ta.focus();
        var submit = function () {
            var comment = ta.value.trim();
            if (!comment) { ta.focus(); return; }
            ok.disabled = true;
            cancel.disabled = true;
            send({ page: pageFile(), quote: data.quote, section: data.section, comment: comment }).then(function (r) {
                var msg = 'Added to ' + r.file + (r.number ? ' as #' + r.number : '');
                try { sessionStorage.setItem(TOAST_KEY, msg); } catch (e) {}
                close();
                toast(msg);
            }, function (err) {
                ok.disabled = false;
                cancel.disabled = false;
                toast('Comment failed: ' + (err && err.message ? err.message : err), true);
            });
        };
        ok.addEventListener('click', submit);
        cancel.addEventListener('click', close);
        ta.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
        });
    };

    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function () {
        var s = selection();
        if (s) open({ quote: s.text, section: headingBefore(s.range) }, anchorRect(s.range));
    });
    document.addEventListener('mousedown', function (e) {
        if (pop && !pop.contains(e.target) && e.target !== btn) close();
    });
    window.addEventListener('hashchange', close);
})();
</script>`;
