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

/** Скрипты c4builder по имени файла в `dist/vendor/`. */
export const SITE_SCRIPTS: Record<string, string> = {
    'c4builder-redirects.js': REDIRECTS_JS,
    'c4builder-storage-guard.js': STORAGE_GUARD_JS
};
