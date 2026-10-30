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
 * после загрузки скрипта. Действует только шире 768px: на узком экране sidebar — выезжающая
 * панель. Выбранная ширина хранится в localStorage (в try/catch: хранилище может быть закрыто).
 * Стили вставляются самим скриптом, чтобы не плодить отдельный css-файл в dist.
 */
export const SIDEBAR_RESIZE_JS = `(function () {
    var KEY = 'c4builder-sidebar-width';
    var MIN = 180;
    var root = document.documentElement;
    var clamp = function (w) {
        return Math.max(MIN, Math.min(w, Math.round(window.innerWidth * 0.7)));
    };
    var apply = function (w) {
        root.style.setProperty('--c4-sw', w + 'px');
    };
    var DEFAULT = 300;
    var saved = null;
    try {
        saved = parseInt(window.localStorage.getItem(KEY), 10);
    } catch (e) {}
    if (saved) apply(clamp(saved));
    var style = document.createElement('style');
    style.textContent =
        ':root{--c4-sw:' + DEFAULT + 'px}' +
        '@media screen and (min-width:769px){' +
        '.sidebar{width:var(--c4-sw)}' +
        '.content{left:var(--c4-sw)}' +
        '.sidebar-toggle{width:calc(var(--c4-sw) - 16px)}' +
        'body.close .sidebar{transform:translateX(calc(-1 * var(--c4-sw)))}' +
        'body.close .content{left:0}' +
        '.c4-resizer{position:fixed;top:0;bottom:0;left:var(--c4-sw);width:6px;cursor:col-resize;z-index:40;touch-action:none}' +
        '.c4-resizer:hover,.c4-resizer.active{background:rgba(66,185,131,.35)}' +
        'body.close .c4-resizer{display:none}' +
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
        return parseInt(getComputedStyle(root).getPropertyValue('--c4-sw'), 10) || DEFAULT;
    };
    var save = function () {
        try {
            window.localStorage.setItem(KEY, String(width()));
        } catch (e) {}
    };
    handle.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        handle.setPointerCapture(ev.pointerId);
        handle.classList.add('active');
        document.body.classList.add('c4-resizing');
    });
    handle.addEventListener('pointermove', function (ev) {
        if (!handle.classList.contains('active')) return;
        apply(clamp(ev.clientX));
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
        root.style.removeProperty('--c4-sw');
        try {
            window.localStorage.removeItem(KEY);
        } catch (e) {}
    });
    window.addEventListener('resize', function () {
        var w = width();
        if (w > clamp(w)) apply(clamp(w));
    });
})();
`;

/** Скрипты c4builder по имени файла в `dist/vendor/`. */
export const SITE_SCRIPTS: Record<string, string> = {
    'c4builder-redirects.js': REDIRECTS_JS,
    'c4builder-storage-guard.js': STORAGE_GUARD_JS,
    'c4builder-sidebar-resize.js': SIDEBAR_RESIZE_JS
};
