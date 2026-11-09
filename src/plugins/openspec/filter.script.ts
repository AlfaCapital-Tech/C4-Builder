// Скрипт фильтра таблиц Changes (опция `filter` плагина openspec). Живёт строкой в src,
// как скрипты ядра в compose/site.scripts.ts: комментарии остаются здесь и не попадают в выход.
// Плагин отдаёт его ассетом `{ name, content }`, ядро пишет в
// `dist/vendor/plugins/openspec/changes-filter.js`. Внешних ресурсов не грузит; текста —
// кнопка сброса, её подсказка и плейсхолдер поиска, по-английски, как поиск docsify и зум диаграмм.

/**
 * Обёртка каждой таблицы change'ов несёт `data-c4b-filter` с номерами колонок фильтра (от 1);
 * над первой обёрткой страницы скрипт строит одну строку: выпадающий список на колонку
 * (`<details>`: кнопка — заголовок колонки и число выбранных; внутри — все значения колонки на
 * странице, по строкам ячейки, плюс сохранённый выбор, флажками по алфавиту; от SEARCH_FROM
 * значений — поле поиска по подстроке), счётчик и кнопку сброса, неактивную без выбора. Открыт
 * один список: открытие другого (обработчик клика на документе), клик вне и Esc закрывают; Esc в
 * непустом поле поиска оставлен браузеру — он очищает поле. Строка проходит колонку, если одно
 * из её значений выбрано, и видна, если проходит каждую колонку с непустым выбором; `↳` — по
 * своим значениям, родитель с видимым подчейнджем остаётся приглушённым; таблица без видимых
 * строк прячется вместе с заголовком секции (`h3` перед обёрткой). Выбор — в localStorage по
 * заголовку колонки (недоступное хранилище — фильтр живёт на странице). Хук docsify `doneEach`
 * на каждом рендере строит панель заново из хранилища, обработчики на документе вешаются один раз.
 * Регулярные выражения в строке — с удвоенным `\\`, иначе шаблонная строка съест экранирование.
 */
export const CHANGES_FILTER_JS = `(function () {
    var WRAP = '.c4b-openspec-changes[data-c4b-filter]';
    var KEY = 'c4b-openspec-filter:';
    var SEARCH_FROM = 8;
    var NESTED = '\\u21B3';
    var NONE = '\\u2014';
    var HIDDEN = 'c4b-openspec-changes-row--hidden';
    var CONTEXT = 'c4b-openspec-changes-row--context';
    var EMPTY = 'c4b-openspec-changes--empty';
    var HEADING_HIDDEN = 'c4b-openspec-filter-hidden';
    var MENU = 'c4b-openspec-filter-menu';
    var load = function (title) {
        try {
            var list = JSON.parse(window.localStorage.getItem(KEY + title) || '[]');
            return Array.isArray(list)
                ? list.filter(function (v) {
                      return typeof v === 'string';
                  })
                : [];
        } catch (e) {
            return [];
        }
    };
    var save = function (title, values) {
        try {
            if (values.length) window.localStorage.setItem(KEY + title, JSON.stringify(values));
            else window.localStorage.removeItem(KEY + title);
        } catch (e) {}
    };
    var cellValues = function (cell) {
        var out = [];
        var text = '';
        var flush = function () {
            var v = text.replace(/\\s+/g, ' ').trim();
            if (v && v !== NONE && v !== '-') out.push(v);
            text = '';
        };
        var walk = function (node) {
            for (var i = 0; i < node.childNodes.length; i++) {
                var n = node.childNodes[i];
                if (n.nodeType === 3) text += n.nodeValue;
                else if (n.nodeName === 'BR') flush();
                else walk(n);
            }
        };
        if (cell) walk(cell);
        flush();
        return out;
    };
    var headerRow = function (table) {
        return table.tHead && table.tHead.rows[0] ? table.tHead.rows[0] : table.rows[0];
    };
    var bodyRows = function (table) {
        var head = headerRow(table);
        var out = [];
        for (var i = 0; i < table.rows.length; i++) if (table.rows[i] !== head) out.push(table.rows[i]);
        return out;
    };
    var isNested = function (row) {
        var first = row.cells[0];
        return !!first && first.textContent.trim().charAt(0) === NESTED;
    };
    var el = function (tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    var remove = function (node) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
    };
    var collect = function () {
        var wraps = document.querySelectorAll(WRAP);
        if (!wraps.length) return null;
        var first = wraps[0].querySelector('table');
        if (!first) return null;
        var head = headerRow(first);
        if (!head) return null;
        var numbers = (wraps[0].getAttribute('data-c4b-filter') || '').split(',');
        var columns = [];
        for (var c = 0; c < numbers.length; c++) {
            var n = parseInt(numbers[c], 10);
            var th = head.cells[n - 1];
            if (!th) continue;
            var title = th.textContent.trim();
            columns.push({ index: n - 1, title: title, selected: load(title), values: [] });
        }
        if (!columns.length) return null;
        var tables = [];
        var total = 0;
        for (var w = 0; w < wraps.length; w++) {
            var table = wraps[w].querySelector('table');
            if (!table) continue;
            var rows = bodyRows(table);
            var entries = [];
            for (var r = 0; r < rows.length; r++) {
                var values = [];
                for (var k = 0; k < columns.length; k++) {
                    var v = cellValues(rows[r].cells[columns[k].index]);
                    values.push(v);
                    for (var x = 0; x < v.length; x++)
                        if (columns[k].values.indexOf(v[x]) < 0) columns[k].values.push(v[x]);
                }
                entries.push({ row: rows[r], nested: isNested(rows[r]), values: values });
            }
            total += entries.length;
            var prev = wraps[w].previousElementSibling;
            tables.push({
                wrap: wraps[w],
                heading: prev && prev.tagName === 'H3' ? prev : null,
                entries: entries
            });
        }
        for (var k2 = 0; k2 < columns.length; k2++) {
            var col = columns[k2];
            for (var s = 0; s < col.selected.length; s++)
                if (col.values.indexOf(col.selected[s]) < 0) col.values.push(col.selected[s]);
            col.values.sort(function (a, b) {
                return a.localeCompare(b);
            });
        }
        return { columns: columns, tables: tables, total: total };
    };
    var applyRows = function (columns, tables) {
        var active = [];
        for (var a = 0; a < columns.length; a++) if (columns[a].selected.length) active.push(a);
        var shown = 0;
        var empty = [];
        for (var t = 0; t < tables.length; t++) {
            var tb = tables[t];
            var pass = [];
            for (var e = 0; e < tb.entries.length; e++) {
                var ok = true;
                for (var i = 0; i < active.length && ok; i++) {
                    var selected = columns[active[i]].selected;
                    var vals = tb.entries[e].values[active[i]];
                    var hit = false;
                    for (var y = 0; y < vals.length && !hit; y++) hit = selected.indexOf(vals[y]) >= 0;
                    ok = hit;
                }
                pass.push(ok);
            }
            var any = false;
            for (var e2 = 0; e2 < tb.entries.length; e2++) {
                var entry = tb.entries[e2];
                var visible = pass[e2];
                var context = false;
                if (!visible && !entry.nested)
                    for (var j = e2 + 1; j < tb.entries.length && tb.entries[j].nested; j++)
                        if (pass[j]) context = true;
                entry.row.classList.toggle(HIDDEN, !visible && !context);
                entry.row.classList.toggle(CONTEXT, context);
                if (visible) shown++;
                if (visible || context) any = true;
            }
            empty.push(active.length > 0 && !any);
        }
        return { active: active, shown: shown, empty: empty };
    };
    var toggle = function (column, value, on) {
        var at = column.selected.indexOf(value);
        if (on && at < 0) column.selected.push(value);
        if (!on && at >= 0) column.selected.splice(at, 1);
        save(column.title, column.selected);
    };
    var syncInputs = function (column, inputs) {
        for (var i = 0; i < inputs.length; i++)
            inputs[i].checked = column.selected.indexOf(inputs[i].getAttribute('data-value')) >= 0;
    };
    var buildList = function (column, onChange) {
        var list = el('div', 'c4b-openspec-filter-list');
        var options = [];
        var inputs = [];
        if (column.values.length >= SEARCH_FROM) {
            var search = el('input', 'c4b-openspec-filter-search');
            search.type = 'search';
            search.placeholder = 'Search';
            search.setAttribute('aria-label', 'Search ' + column.title);
            search.addEventListener('input', function () {
                var q = search.value.trim().toLowerCase();
                for (var i = 0; i < options.length; i++)
                    options[i].hidden = !!q && options[i].textContent.toLowerCase().indexOf(q) < 0;
            });
            list.appendChild(search);
        }
        var handler = function (value, input) {
            return function () {
                onChange(column, value, input.checked);
            };
        };
        for (var z = 0; z < column.values.length; z++) {
            var option = el('label', 'c4b-openspec-filter-option');
            var input = el('input');
            input.type = 'checkbox';
            input.setAttribute('data-value', column.values[z]);
            input.addEventListener('change', handler(column.values[z], input));
            option.appendChild(input);
            option.appendChild(el('span', null, column.values[z]));
            list.appendChild(option);
            options.push(option);
            inputs.push(input);
        }
        syncInputs(column, inputs);
        return { el: list, inputs: inputs };
    };
    var closeMenus = function (except) {
        var open = document.querySelectorAll('.' + MENU + '[open]');
        for (var i = 0; i < open.length; i++) if (open[i] !== except) open[i].removeAttribute('open');
    };
    var render = function () {
        remove(document.querySelector('.c4b-openspec-filter'));
        var data = collect();
        if (!data) return;
        var columns = data.columns;
        var tables = data.tables;
        var bar = el('div', 'c4b-openspec-filter');
        var count = el('span', 'c4b-openspec-filter-count');
        var reset = el('button', 'c4b-openspec-filter-reset', 'Reset');
        reset.type = 'button';
        reset.title = 'Reset filter';
        var menus = [];
        var apply = function () {
            var r = applyRows(columns, tables);
            for (var t = 0; t < tables.length; t++) {
                tables[t].wrap.classList.toggle(EMPTY, r.empty[t]);
                if (tables[t].heading) tables[t].heading.classList.toggle(HEADING_HIDDEN, r.empty[t]);
            }
            count.textContent = r.shown + ' / ' + data.total;
            reset.disabled = !r.active.length;
            for (var m = 0; m < menus.length; m++) {
                var picked = columns[m].selected;
                menus[m].badge.textContent = String(picked.length);
                menus[m].badge.hidden = !picked.length;
                menus[m].summary.classList.toggle('c4b-openspec-filter-summary--active', picked.length > 0);
                syncInputs(columns[m], menus[m].inputs);
            }
        };
        var onChange = function (column, value, on) {
            toggle(column, value, on);
            apply();
        };
        reset.addEventListener('click', function () {
            for (var i = 0; i < columns.length; i++) {
                columns[i].selected = [];
                save(columns[i].title, []);
            }
            apply();
        });
        for (var m2 = 0; m2 < columns.length; m2++) {
            var details = el('details', MENU);
            var summary = el('summary', 'c4b-openspec-filter-summary');
            summary.appendChild(el('span', 'c4b-openspec-filter-title', columns[m2].title));
            var badge = el('span', 'c4b-openspec-filter-badge');
            summary.appendChild(badge);
            details.appendChild(summary);
            var built = buildList(columns[m2], onChange);
            details.appendChild(built.el);
            menus.push({ badge: badge, summary: summary, inputs: built.inputs });
            bar.appendChild(details);
        }
        var foot = el('div', 'c4b-openspec-filter-foot');
        foot.appendChild(count);
        foot.appendChild(reset);
        bar.appendChild(foot);
        var anchor = tables[0].heading || tables[0].wrap;
        anchor.parentNode.insertBefore(bar, anchor);
        apply();
    };
    var root = document.documentElement;
    if (!root.hasAttribute('data-c4b-openspec-filter')) {
        root.setAttribute('data-c4b-openspec-filter', '');
        document.addEventListener('click', function (e) {
            var target = e.target && e.target.closest ? e.target : null;
            closeMenus(target ? target.closest('.' + MENU) : null);
        });
        document.addEventListener('keydown', function (e) {
            var t = e.target;
            var clearing = t && t.classList && t.classList.contains('c4b-openspec-filter-search') && t.value;
            if (e.key === 'Escape' && !clearing) closeMenus(null);
        });
    }
    var $d = (window.$docsify = window.$docsify || {});
    $d.plugins = [].concat($d.plugins || [], function (hook) {
        hook.doneEach(render);
    });
})();
`;
