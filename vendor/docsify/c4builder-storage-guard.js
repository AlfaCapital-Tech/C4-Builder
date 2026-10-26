// Страховка localStorage для вендорного docsify-sidebar-collapse: на узком экране он пишет в
// localStorage без try/catch — уже после CSS, свернувшего вложенные разделы, и до регистрации
// плагина. При заблокированном хранилище (Safari «Block All Cookies», запрет site data) это
// SecurityError: плагин не регистрируется, и в sidebar виден только корень. Если хранилище
// недоступно, подменяем его хранилищем в памяти (на время вкладки) — вендорный файл не правим.
// Подключается в <head>, раньше любых скриптов страницы. Внешних ресурсов нет.
(function () {
    try {
        var probe = '__c4builder_storage_probe__';
        window.localStorage.setItem(probe, probe);
        window.localStorage.removeItem(probe);
        return;
    } catch (e) {
        // недоступно — ниже подмена
    }
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
    } catch (e) {
        // свойство не переопределяется — остаёмся с исходным поведением
    }
})();
