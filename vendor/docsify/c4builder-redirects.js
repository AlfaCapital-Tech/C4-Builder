// Переадресации коротких адресов c4builder (change site-agent-review): карта
// `window.$docsify.c4builder.redirects` — путь из hash (`/change/<id>`) → путь страницы.
// Совпадение заменяет адрес через location.replace: страница получает свой родной маршрут
// (относительные ссылки, картинки, подсветка sidebar), а «назад» не возвращает на короткий
// адрес. Скрипт подключён после docsify.min.js, но до его инициализации на DOMContentLoaded,
// поэтому первая проверка — сразу, дальше — на каждое hashchange. Внешних ресурсов нет.
(function () {
    var redirects = window.$docsify && window.$docsify.c4builder && window.$docsify.c4builder.redirects;
    if (!redirects) return;
    var lookup = function (route) {
        if (Object.prototype.hasOwnProperty.call(redirects, route)) return redirects[route];
        // Браузер мог раскодировать hash или закодировать иначе — сравниваем в виде карты (encodeURI).
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
        if (query >= 0) route = route.slice(0, query);
        if (route.charAt(0) !== '/') route = '/' + route;
        var target = lookup(route);
        if (target) location.replace('#' + target);
    };
    check();
    window.addEventListener('hashchange', check);
})();
