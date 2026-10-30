// Собственные скрипты c4builder для docsify-сайта. Живут в src, а не в vendor/ (там только
// чужой вендорный код), и пишутся в `dist/vendor/` строкой: комментарии остаются здесь и не
// попадают в выход, в том числе на англоязычные сайты. Внешних ресурсов скрипты не грузят.

/**
 * Переадресации коротких адресов (change site-agent-review): карта
 * `window.$docsify.c4builder.redirects` — путь из hash (`/change/<id>`) → путь страницы.
 * Совпадение заменяет адрес через location.replace: страница получает свой родной маршрут
 * (относительные ссылки, картинки, подсветка sidebar), а «назад» не возвращает на короткий
 * адрес. Query (`?id=<якорь>` docsify) переносится на целевую страницу — иначе ссылка на
 * раздел change'а открыла бы его начало. Браузер мог раскодировать hash или закодировать иначе —
 * при промахе сравниваем ещё и в виде карты (encodeURI). Скрипт подключён после
 * docsify.min.js, но до его инициализации на DOMContentLoaded, поэтому первая проверка —
 * сразу, дальше — на каждое hashchange.
 */
export const REDIRECTS_JS = `(function () {
    var redirects = window.$docsify && window.$docsify.c4builder && window.$docsify.c4builder.redirects;
    if (!redirects) return;
    var lookup = function (route) {
        if (Object.prototype.hasOwnProperty.call(redirects, route)) return redirects[route];
        try {
            var normalized = encodeURI(decodeURIComponent(route));
            if (Object.prototype.hasOwnProperty.call(redirects, normalized)) return redirects[normalized];
        } catch (e) {}
        return undefined;
    };
    var check = function () {
        var hash = location.hash;
        if (hash.charAt(0) !== '#') return;
        var route = hash.slice(1);
        var query = route.indexOf('?');
        var search = query >= 0 ? route.slice(query) : '';
        if (query >= 0) route = route.slice(0, query);
        if (route.charAt(0) !== '/') route = '/' + route;
        var target = lookup(route);
        if (target) location.replace('#' + target + search);
    };
    check();
    window.addEventListener('hashchange', check);
})();
`;

/**
 * Страховка localStorage для вендорного docsify-sidebar-collapse: на узком экране он пишет в
 * localStorage без try/catch — уже после CSS, свернувшего вложенные разделы, и до регистрации
 * плагина. При заблокированном хранилище (Safari «Block All Cookies», запрет site data) это
 * SecurityError: плагин не регистрируется, и в sidebar виден только корень. Если хранилище
 * недоступно, подменяем его хранилищем в памяти (на время вкладки) — вендорный файл не правим.
 * Не переопределяемое свойство window.localStorage оставляем как есть (прежнее поведение).
 * Подключается в <head>, раньше любых скриптов страницы.
 */
export const STORAGE_GUARD_JS = `(function () {
    try {
        var probe = '__c4builder_storage_probe__';
        window.localStorage.setItem(probe, probe);
        window.localStorage.removeItem(probe);
        return;
    } catch (e) {}
    var data = {};
    var has = function (k) {
        return Object.prototype.hasOwnProperty.call(data, k);
    };
    var memory = {
        getItem: function (k) {
            return has(String(k)) ? data[String(k)] : null;
        },
        setItem: function (k, v) {
            data[String(k)] = String(v);
        },
        removeItem: function (k) {
            delete data[String(k)];
        },
        clear: function () {
            data = {};
        },
        key: function (i) {
            var keys = Object.keys(data);
            return i < keys.length ? keys[i] : null;
        }
    };
    Object.defineProperty(memory, 'length', {
        get: function () {
            return Object.keys(data).length;
        }
    });
    try {
        Object.defineProperty(window, 'localStorage', { value: memory, configurable: true });
    } catch (e) {}
})();
`;

/**
 * Перетаскиваемая граница между sidebar и содержимым: на небольших экранах фиксированные
 * 300px съедают место и не дают разглядеть глубокую структуру папок. Ширина живёт в
 * CSS-переменной `--c4-sw` (её читают sidebar, сдвиг `.content` и кнопка сворачивания),
 * ручка — отдельный элемент поверх границы, потому что sidebar и content создаёт docsify уже
 * после загрузки скрипта. Правила ширины включаются только атрибутом `data-c4-sw` на `<html>`,
 * который ставится, когда ширина реально выбрана (сохранена или тянут): наш `<style>` идёт
 * после CSS темы и иначе перебивал бы ширину пользовательской `webTheme`. Пока ширина не
 * выбрана, ручка следует за фактической шириной `.sidebar`; dblclick возвращает ширину темы.
 * Действует только шире 768px: на узком экране sidebar — выезжающая панель. Выбранная ширина
 * хранится в localStorage (в try/catch: хранилище может быть закрыто). Стили вставляются
 * самим скриптом, чтобы не плодить отдельный css-файл в dist. Ручка стоит между sidebar (20)
 * и кнопкой сворачивания (30) и прячется, пока открыт просмотр диаграмм (`html.c4-zoom-open`,
 * c4builder-diagram-zoom.js) или medium-zoom из пользовательского шаблона
 * (`body.medium-zoom--opened`), чтобы не торчать поверх увеличенной диаграммы.
 * Заодно, как «Select Opened File» в IDE, после каждой навигации докручивает sidebar к активной
 * странице — только если её ссылка ушла за край видимой области, иначе скролл дёргался бы при
 * каждом клике; меряется ссылка, а не `li`, в который входит всё раскрытое поддерево; с
 * задержкой, потому что плагин сворачивания раскрывает ветки своим doneEach и высоты известны
 * позже. Комментариев внутри самой строки нет: она целиком уходит в dist.
 */
export const SIDEBAR_RESIZE_JS = `(function () {
    var KEY = 'c4builder-sidebar-width';
    var ATTR = 'data-c4-sw';
    var MIN = 180;
    var root = document.documentElement;
    var wide = function () {
        return window.innerWidth > 768;
    };
    var clamp = function (w) {
        return Math.max(MIN, Math.min(w, Math.round(window.innerWidth * 0.7)));
    };
    var set = function (w) {
        root.style.setProperty('--c4-sw', w + 'px');
    };
    var choose = function (w) {
        set(w);
        root.setAttribute(ATTR, '');
    };
    var chosen = function () {
        return root.hasAttribute(ATTR);
    };
    var themeWidth = function () {
        var bar = document.querySelector('.sidebar');
        return bar ? Math.round(bar.getBoundingClientRect().width) : 0;
    };
    var follow = function () {
        if (chosen()) return;
        var w = themeWidth();
        if (w) set(w);
    };
    var saved = null;
    try {
        saved = parseInt(window.localStorage.getItem(KEY), 10);
    } catch (e) {}
    if (saved) choose(wide() ? clamp(saved) : saved);
    var style = document.createElement('style');
    style.textContent =
        '@media screen and (min-width:769px){' +
        'html[data-c4-sw] .sidebar{width:var(--c4-sw)}' +
        'html[data-c4-sw] .content{left:var(--c4-sw)}' +
        'html[data-c4-sw] .sidebar-toggle{width:calc(var(--c4-sw) - 16px)}' +
        'html[data-c4-sw] body.close .sidebar{transform:translateX(calc(-1 * var(--c4-sw)))}' +
        '.c4-resizer{position:fixed;top:0;bottom:0;left:var(--c4-sw,-10px);width:6px;cursor:col-resize;z-index:25;touch-action:none}' +
        '.c4-resizer:hover,.c4-resizer.active{background:rgba(66,185,131,.35)}' +
        'body.close .c4-resizer,body.medium-zoom--opened .c4-resizer,html.c4-zoom-open .c4-resizer{display:none}' +
        'body.c4-resizing,body.c4-resizing *{transition:none!important;user-select:none!important;cursor:col-resize!important}' +
        '}' +
        '@media screen and (max-width:768px){.c4-resizer{display:none}}' +
        '@media print{.c4-resizer{display:none}}';
    document.head.appendChild(style);
    var handle = document.createElement('div');
    handle.className = 'c4-resizer';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    document.body.appendChild(handle);
    var width = function () {
        return parseInt(getComputedStyle(root).getPropertyValue('--c4-sw'), 10) || themeWidth() || 300;
    };
    var save = function () {
        if (!chosen()) return;
        try {
            window.localStorage.setItem(KEY, String(width()));
        } catch (e) {}
    };
    var grab = 0;
    handle.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0 || !ev.isPrimary) return;
        ev.preventDefault();
        try {
            handle.setPointerCapture(ev.pointerId);
        } catch (e) {}
        grab = ev.clientX - width();
        handle.classList.add('active');
        document.body.classList.add('c4-resizing');
    });
    handle.addEventListener('pointermove', function (ev) {
        if (!handle.classList.contains('active')) return;
        choose(clamp(ev.clientX - grab));
    });
    var stop = function () {
        if (!handle.classList.contains('active')) return;
        handle.classList.remove('active');
        document.body.classList.remove('c4-resizing');
        save();
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('dblclick', function () {
        root.removeAttribute(ATTR);
        try {
            window.localStorage.removeItem(KEY);
        } catch (e) {}
        follow();
    });
    window.addEventListener('resize', function () {
        if (!wide()) return;
        if (!chosen()) return follow();
        var w = width();
        if (w > clamp(w)) set(clamp(w));
    });
    var reveal = function () {
        var item = document.querySelector('.sidebar-nav li.active');
        var bar = document.querySelector('.sidebar');
        if (!item || !bar) return;
        var r = (item.querySelector(':scope > a') || item).getBoundingClientRect();
        var b = bar.getBoundingClientRect();
        if (!r.height || (r.top >= b.top && r.bottom <= b.bottom)) return;
        bar.scrollTop += r.top - b.top - (b.height - r.height) / 2;
    };
    var $d = (window.$docsify = window.$docsify || {});
    $d.plugins = [].concat($d.plugins || [], function (hook) {
        hook.doneEach(function () {
            follow();
            setTimeout(reveal, 50);
        });
    });
})();
`;

/**
 * Просмотр диаграмм с зумом и перетаскиванием: прежний вендорный zoom-image (medium-zoom)
 * вписывал картинку в окно, и большая схема (карта зависимостей на сотню контейнеров)
 * становилась нечитаемо мелкой без возможности приблизить. Клик по картинке страницы открывает
 * полноэкранный просмотр: колесо и щипок трекпада/тачскрина — зум к курсору, перетаскивание —
 * сдвиг, двойной клик — «вписать» ↔ 1:1 в точке клика (если схема и так видна в натуральную
 * величину — ↔ 2×), кнопки и клавиши (+ − 0 1 стрелки Esc).
 * Набор картинок фиксируется на doneEach, как у zoom-image: `.markdown-section img`, кроме emoji,
 * `data-no-zoom` и картинок внутри ссылок и элементов со своим кликом (button, summary, label) —
 * им атрибут `data-c4-zoom`. Проверять картинку в момент клика нельзя: перехват заберёт клик и у
 * картинок, добавленных позже чужим кодом (Swagger UI), и у раскрывашек. Встроенные шаблоны
 * zoom-image больше не грузят, но пользовательский docsifyTemplate (копия старого шаблона) может:
 * medium-zoom вешает click на сам img, поэтому клик по размеченной картинке перехватывается на
 * document в фазе capture при любых модификаторах — иначе Shift+клик открыл бы старый просмотр.
 * Масштаб меняется шириной/высотой img, а не transform: scale — иначе браузер (Safari) растягивает
 * уже растеризованную SVG и текст мылится; сдвиг — translate. Поэтому запись в DOM — раз в кадр
 * (requestAnimationFrame): события колеса и щипка приходят чаще кадров, а каждая смена размера —
 * это перерастеризация большой SVG. Исходное положение — вписать в окно, но не крупнее
 * натурального размера; предел зума — 4× натурального, но растр не больше MAX_AREA пикселей
 * (иначе Safari/iOS рисуют пустоту или роняют вкладку) и не меньше 1:1. На очень низком или
 * узком окне поля и место под панель не вычитаются — иначе «вписать» вышло бы ≤ 0. Пока просмотр
 * открыт, фокус удерживается в нём (aria-modal), а клавиши обрабатываются, только когда фокус
 * внутри (по цели события): иначе ввод в поле за оверлеем менял бы зум. Стили вставляет сам скрипт (как у
 * резайзера sidebar). Комментариев внутри строки нет: она целиком уходит в dist.
 */
export const DIAGRAM_ZOOM_JS = `(function () {
    var MAX = 4;
    var MAX_AREA = 64e6;
    var PAD = 24;
    var BAR = 72;
    var KEEP = 48;
    var ATTR = 'data-c4-zoom';
    var SKIP = 'a,button,summary,label';
    var style = document.createElement('style');
    style.textContent =
        'img[data-c4-zoom]{cursor:zoom-in}' +
        '.c4-zoom{position:fixed;top:0;right:0;bottom:0;left:0;z-index:1000;display:none;background:#fff;outline:none}' +
        '.c4-zoom.open{display:block}' +
        'html.c4-zoom-open,html.c4-zoom-open body{overflow:hidden}' +
        '.c4-zoom-stage{position:absolute;top:0;right:0;bottom:0;left:0;overflow:hidden;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}' +
        '.c4-zoom-stage.grabbing{cursor:grabbing}' +
        '.c4-zoom-img{position:absolute;left:0;top:0;max-width:none!important;max-height:none!important;margin:0!important;transform-origin:0 0;pointer-events:none;-webkit-user-drag:none}' +
        '.c4-zoom-bar{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:2px;padding:4px;background:#fff;border:1px solid rgba(0,0,0,.12);border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.12);font:14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}' +
        '.c4-zoom-bar button{min-width:34px;height:32px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:#34495e;font:inherit;cursor:pointer}' +
        '.c4-zoom-bar button:hover,.c4-zoom-bar button:focus-visible{background:rgba(66,185,131,.15);outline:none}' +
        '.c4-zoom-pct{min-width:52px;text-align:center;color:#7f8c8d;font-variant-numeric:tabular-nums}' +
        '@media print{.c4-zoom{display:none!important}}';
    document.head.appendChild(style);
    var mark = function () {
        var list = document.querySelectorAll('.markdown-section img');
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (el.classList.contains('emoji') || el.hasAttribute('data-no-zoom') || el.closest(SKIP)) continue;
            el.setAttribute(ATTR, '');
        }
    };
    var overlay, stage, img, pct;
    var st = { s: 1, x: 0, y: 0, w: 0, h: 0, fit: 1, atFit: true };
    var pointers = {};
    var drag = null;
    var pinch = null;
    var moved = false;
    var lastFocus = null;
    var frame = 0;
    var view = function () {
        return { w: window.innerWidth, h: window.innerHeight };
    };
    var area = function () {
        var v = view();
        var padX = v.w > 4 * PAD ? PAD : 0;
        var roomy = v.h > 2 * (PAD + BAR);
        return {
            x: padX,
            y: roomy ? PAD : 0,
            w: v.w - 2 * padX,
            h: roomy ? v.h - PAD - BAR : v.h
        };
    };
    var bounds = function () {
        var max = Math.min(MAX, Math.max(1, Math.sqrt(MAX_AREA / (st.w * st.h))));
        return { min: st.fit / 2, max: max };
    };
    var clampPos = function () {
        var v = view();
        var W = st.w * st.s;
        var H = st.h * st.s;
        st.x = Math.min(Math.max(st.x, KEEP - W), v.w - KEEP);
        st.y = Math.min(Math.max(st.y, KEEP - H), v.h - KEEP);
    };
    var paint = function () {
        frame = 0;
        img.style.width = st.w * st.s + 'px';
        img.style.height = st.h * st.s + 'px';
        img.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px)';
    };
    var apply = function () {
        clampPos();
        pct.textContent = Math.round(st.s * 100) + '%';
        if (!frame) frame = window.requestAnimationFrame(paint);
    };
    var computeFit = function () {
        var a = area();
        st.fit = Math.min(a.w / st.w, a.h / st.h, 1);
        if (!(st.fit > 0)) st.fit = 1;
    };
    var fit = function () {
        var a = area();
        computeFit();
        st.s = st.fit;
        st.x = a.x + (a.w - st.w * st.s) / 2;
        st.y = a.y + (a.h - st.h * st.s) / 2;
        st.atFit = true;
        apply();
    };
    var zoomTo = function (s, cx, cy) {
        var b = bounds();
        var v = view();
        if (cx === undefined) {
            cx = v.w / 2;
            cy = v.h / 2;
        }
        s = Math.min(Math.max(s, b.min), b.max);
        st.x = cx - (cx - st.x) * (s / st.s);
        st.y = cy - (cy - st.y) * (s / st.s);
        st.s = s;
        st.atFit = false;
        apply();
    };
    var panBy = function (dx, dy) {
        st.x += dx;
        st.y += dy;
        st.atFit = false;
        apply();
    };
    var onImage = function (cx, cy) {
        var W = st.w * st.s;
        var H = st.h * st.s;
        return cx >= st.x && cx <= st.x + W && cy >= st.y && cy <= st.y + H;
    };
    var toggle = function (cx, cy) {
        if (Math.abs(st.s - st.fit) < 0.001) zoomTo(st.fit < 1 ? 1 : 2, cx, cy);
        else fit();
    };
    var button = function (text, title, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.title = title;
        b.setAttribute('aria-label', title);
        b.addEventListener('click', function (ev) {
            ev.stopPropagation();
            fn();
        });
        return b;
    };
    var count = function () {
        return Object.keys(pointers).length;
    };
    var startPinch = function () {
        var ids = Object.keys(pointers);
        var a = pointers[ids[0]];
        var c = pointers[ids[1]];
        var cx = (a.x + c.x) / 2;
        var cy = (a.y + c.y) / 2;
        pinch = {
            d: Math.max(1, Math.hypot(a.x - c.x, a.y - c.y)),
            s: st.s,
            px: (cx - st.x) / st.s,
            py: (cy - st.y) / st.s
        };
        drag = null;
    };
    var startDrag = function (p) {
        drag = { x: p.x - st.x, y: p.y - st.y, sx: p.x, sy: p.y };
        pinch = null;
    };
    var build = function () {
        overlay = document.createElement('div');
        overlay.className = 'c4-zoom';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Image viewer');
        overlay.tabIndex = -1;
        stage = document.createElement('div');
        stage.className = 'c4-zoom-stage';
        img = document.createElement('img');
        img.className = 'c4-zoom-img';
        img.draggable = false;
        stage.appendChild(img);
        var bar = document.createElement('div');
        bar.className = 'c4-zoom-bar';
        pct = document.createElement('span');
        pct.className = 'c4-zoom-pct';
        bar.appendChild(button('\\u2212', 'Zoom out (-)', function () {
            zoomTo(st.s / 1.25);
        }));
        bar.appendChild(pct);
        bar.appendChild(button('+', 'Zoom in (+)', function () {
            zoomTo(st.s * 1.25);
        }));
        bar.appendChild(button('Fit', 'Fit to screen (0)', fit));
        bar.appendChild(button('1:1', 'Actual size (1)', function () {
            zoomTo(1);
        }));
        bar.appendChild(button('\\u00d7', 'Close (Esc)', close));
        overlay.appendChild(stage);
        overlay.appendChild(bar);
        stage.addEventListener('pointerdown', function (ev) {
            if (ev.pointerType === 'mouse' && ev.button !== 0) return;
            ev.preventDefault();
            try {
                stage.setPointerCapture(ev.pointerId);
            } catch (e) {}
            pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
            if (count() === 1) moved = false;
            if (count() >= 2) startPinch();
            else startDrag(pointers[ev.pointerId]);
            stage.classList.add('grabbing');
        });
        stage.addEventListener('pointermove', function (ev) {
            var p = pointers[ev.pointerId];
            if (!p) return;
            p.x = ev.clientX;
            p.y = ev.clientY;
            if (pinch && count() >= 2) {
                var ids = Object.keys(pointers);
                var a = pointers[ids[0]];
                var c = pointers[ids[1]];
                var cx = (a.x + c.x) / 2;
                var cy = (a.y + c.y) / 2;
                var b = bounds();
                var s = pinch.s * (Math.hypot(a.x - c.x, a.y - c.y) / pinch.d);
                st.s = Math.min(Math.max(s, b.min), b.max);
                st.x = cx - pinch.px * st.s;
                st.y = cy - pinch.py * st.s;
                st.atFit = false;
                moved = true;
                apply();
            } else if (drag) {
                if (Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy) > 3) moved = true;
                st.x = p.x - drag.x;
                st.y = p.y - drag.y;
                st.atFit = false;
                apply();
            }
        });
        var release = function (ev) {
            if (!pointers[ev.pointerId]) return;
            delete pointers[ev.pointerId];
            var ids = Object.keys(pointers);
            if (ids.length >= 2) startPinch();
            else if (ids.length === 1) startDrag(pointers[ids[0]]);
            else {
                drag = null;
                pinch = null;
                stage.classList.remove('grabbing');
            }
        };
        stage.addEventListener('pointerup', release);
        stage.addEventListener('pointercancel', release);
        stage.addEventListener('click', function (ev) {
            if (moved || onImage(ev.clientX, ev.clientY)) return;
            close();
        });
        stage.addEventListener('dblclick', function (ev) {
            ev.preventDefault();
            toggle(ev.clientX, ev.clientY);
        });
        stage.addEventListener(
            'wheel',
            function (ev) {
                ev.preventDefault();
                var unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? view().h : 1;
                var dx = ev.deltaX * unit;
                var dy = ev.deltaY * unit;
                if (!ev.ctrlKey && !ev.metaKey && Math.abs(dx) > Math.abs(dy)) return panBy(-dx, 0);
                var k = ev.ctrlKey ? 0.01 : 0.002;
                zoomTo(st.s * Math.exp(-dy * k), ev.clientX, ev.clientY);
            },
            { passive: false }
        );
        document.body.appendChild(overlay);
    };
    var isOpen = function () {
        return !!overlay && overlay.classList.contains('open');
    };
    var focusOverlay = function () {
        try {
            overlay.focus({ preventScroll: true });
        } catch (e) {}
    };
    var open = function (el) {
        if (!overlay) build();
        lastFocus = document.activeElement;
        pointers = {};
        drag = null;
        pinch = null;
        var measure = function (w, h) {
            var r = el.getBoundingClientRect();
            st.w = w || r.width || 300;
            st.h = h || r.height || 150;
            fit();
        };
        img.onload = null;
        img.alt = el.alt || '';
        img.src = el.currentSrc || el.src;
        overlay.classList.add('open');
        document.documentElement.classList.add('c4-zoom-open');
        if (el.naturalWidth) measure(el.naturalWidth, el.naturalHeight);
        else {
            measure(0, 0);
            img.onload = function () {
                img.onload = null;
                measure(img.naturalWidth, img.naturalHeight);
            };
        }
        focusOverlay();
    };
    var close = function () {
        if (!isOpen()) return;
        overlay.classList.remove('open');
        document.documentElement.classList.remove('c4-zoom-open');
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        img.onload = null;
        img.removeAttribute('src');
        if (lastFocus && lastFocus.focus) {
            try {
                lastFocus.focus({ preventScroll: true });
            } catch (e) {}
        }
    };
    document.addEventListener(
        'click',
        function (ev) {
            var el = ev.target;
            if (ev.button !== 0 || !el || el.tagName !== 'IMG' || !el.hasAttribute(ATTR)) return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            open(el);
        },
        true
    );
    document.addEventListener('focusin', function (ev) {
        if (isOpen() && !overlay.contains(ev.target)) focusOverlay();
    });
    document.addEventListener('keydown', function (ev) {
        if (!isOpen() || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        var t = ev.target;
        if (t !== document && t !== document.body && t !== document.documentElement && !overlay.contains(t)) return;
        var step = 60;
        var k = ev.key;
        if (k === 'Escape') close();
        else if (k === '+' || k === '=') zoomTo(st.s * 1.25);
        else if (k === '-' || k === '_') zoomTo(st.s / 1.25);
        else if (k === '0') fit();
        else if (k === '1') zoomTo(1);
        else if (k === 'ArrowLeft') panBy(step, 0);
        else if (k === 'ArrowRight') panBy(-step, 0);
        else if (k === 'ArrowUp') panBy(0, step);
        else if (k === 'ArrowDown') panBy(0, -step);
        else return;
        ev.preventDefault();
        ev.stopPropagation();
    });
    window.addEventListener('resize', function () {
        if (!isOpen()) return;
        if (st.atFit) fit();
        else {
            computeFit();
            apply();
        }
    });
    window.addEventListener('hashchange', close);
    var $d = (window.$docsify = window.$docsify || {});
    $d.plugins = [].concat($d.plugins || [], function (hook) {
        hook.doneEach(mark);
    });
})();
`;

/** Скрипты c4builder по имени файла в `dist/vendor/`. */
export const SITE_SCRIPTS: Record<string, string> = {
    'c4builder-redirects.js': REDIRECTS_JS,
    'c4builder-storage-guard.js': STORAGE_GUARD_JS,
    'c4builder-sidebar-resize.js': SIDEBAR_RESIZE_JS,
    'c4builder-diagram-zoom.js': DIAGRAM_ZOOM_JS
};
