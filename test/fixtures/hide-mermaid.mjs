// `node --import hide-mermaid.mjs …`: пакет mermaid-движка «не установлен» (как после
// npm i --omit=optional) — резолв import() и require() падает.
import { registerHooks } from 'node:module';

const HIDDEN = /^@mermaid-js\/tiny(\/|$)/;

registerHooks({
    resolve(specifier, context, next) {
        if (HIDDEN.test(specifier))
            throw Object.assign(new Error(`Cannot find package '${specifier}'`), {
                code: 'ERR_MODULE_NOT_FOUND'
            });
        return next(specifier, context);
    }
});
