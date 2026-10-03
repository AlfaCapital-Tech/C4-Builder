// `node --import hide-bpmn.mjs …`: пакеты BPMN-движка «не установлены» (как после
// npm i --omit=optional) — резолв import() и require() падает.
import { registerHooks } from 'node:module';

const HIDDEN = /^(bpmn-js|bpmn-moddle|bpmnlint|bpmn-auto-layout|jsdom)(\/|$)/;

registerHooks({
    resolve(specifier, context, next) {
        if (HIDDEN.test(specifier))
            throw Object.assign(new Error(`Cannot find package '${specifier}'`), {
                code: 'ERR_MODULE_NOT_FOUND'
            });
        return next(specifier, context);
    }
});
