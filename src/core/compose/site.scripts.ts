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
 * и кнопкой сворачивания (30) и прячется, пока открыт zoom-image (`body.medium-zoom--opened`),
 * чтобы не торчать поверх увеличенной диаграммы.
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
        'body.close .c4-resizer,body.medium-zoom--opened .c4-resizer{display:none}' +
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

/** Скрипты c4builder по имени файла в `dist/vendor/`. */
export const SITE_SCRIPTS: Record<string, string> = {
    'c4builder-redirects.js': REDIRECTS_JS,
    'c4builder-storage-guard.js': STORAGE_GUARD_JS,
    'c4builder-sidebar-resize.js': SIDEBAR_RESIZE_JS
};
