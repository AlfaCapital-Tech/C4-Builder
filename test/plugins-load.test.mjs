// biome-ignore-all lint/suspicious/noTemplateCurlyInString: тесты подстановки ${ENV} в опциях
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { configSchema, expandEnv, loadPlugins, pluginWatchPaths } from './dist.mjs';

// Загрузчик плагинов: резолв идентификаторов, схема опций, подстановка окружения.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4b-plugins-load-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const writePlugin = (name, body) => {
    const file = path.join(tmp, `${name}.mjs`);
    fs.writeFileSync(file, body);
    return `./${name}.mjs`;
};
const opts = () => ({ EXECUTE_SCRIPT: false });

describe('configSchema: ключ plugins', () => {
    it('строка и пара — валидны, дефолт — пустой список', () => {
        expect(configSchema.parse({}).plugins).toEqual([]);
        expect(configSchema.parse({ plugins: ['openspec', ['openapi', { glob: 'x' }]] }).plugins).toEqual([
            'openspec',
            ['openapi', { glob: 'x' }]
        ]);
    });
    it('неверная форма — ошибка с путём ключа и позицией', () => {
        const r = configSchema.safeParse({ plugins: ['ok', 42] });
        expect(r.success).toBe(false);
        expect(r.error.issues[0].path.join('.')).toBe('plugins.1');
        expect(configSchema.safeParse({ plugins: 'openspec' }).success).toBe(false);
        expect(configSchema.safeParse({ plugins: [['x']] }).success).toBe(false);
    });
});

describe('loadPlugins', () => {
    it('строка = пара с пустыми опциями (встроенный openspec, дефолты схемы)', async () => {
        const [a] = await loadPlugins(['openspec'], tmp, opts());
        const [b] = await loadPlugins([['openspec', {}]], tmp, opts());
        expect(a.plugin.name).toBe('openspec');
        expect(a.opts).toEqual(b.opts);
        expect(a.opts).toEqual({
            dir: 'openspec',
            mount: 'OpenSpec',
            artifacts: ['proposal', 'design', 'tasks']
        });
    });

    it('неизвестный ключ у строгой схемы встроенного плагина — ошибка с именем плагина и ключом', async () => {
        await expect(loadPlugins([['openspec', { dirr: 'x' }]], tmp, opts())).rejects.toThrow(
            /plugins\[0\] openspec: .*dirr/
        );
    });

    it('неверный тип опции — ошибка называет ключ', async () => {
        await expect(loadPlugins([['openspec', { mount: 5 }]], tmp, opts())).rejects.toThrow(
            /openspec: mount — /
        );
    });

    it('плагин без схемы получает опции как есть; подстановка ${ENV}', async () => {
        const id = writePlugin('noschema', 'export default { name: "noschema" };');
        process.env.C4B_TEST_TOKEN = 'secret-1';
        const [p] = await loadPlugins(
            [
                [
                    id,
                    {
                        token: '${C4B_TEST_TOKEN}',
                        missing: '${C4B_NOPE}',
                        nested: { a: ['${C4B_TEST_TOKEN}'] }
                    }
                ]
            ],
            tmp,
            opts()
        );
        expect(p.opts).toEqual({ token: 'secret-1', missing: '', nested: { a: ['secret-1'] } });
    });

    it('requires.executeScript включает EXECUTE_SCRIPT', async () => {
        const id = writePlugin('req', 'export default { name: "req", requires: { executeScript: true } };');
        const o = opts();
        await loadPlugins([id], tmp, o);
        expect(o.EXECUTE_SCRIPT).toBe(true);
    });

    it('несуществующий модуль — ошибка с идентификатором', async () => {
        await expect(loadPlugins(['./nope.mjs'], tmp, opts())).rejects.toThrow(
            /plugins\[0\] "\.\/nope\.mjs"/
        );
        await expect(loadPlugins(['no-such-npm-plugin-xyz'], tmp, opts())).rejects.toThrow(
            /"no-such-npm-plugin-xyz".*встроенных/
        );
    });

    it('модуль без объекта плагина — ошибка', async () => {
        const id = writePlugin('bad', 'export default 42;');
        await expect(loadPlugins([id], tmp, opts())).rejects.toThrow(/полем name/);
    });
});

describe('expandEnv / pluginWatchPaths', () => {
    it('expandEnv не трогает не-строки', () => {
        expect(expandEnv({ n: 1, b: true, x: null })).toEqual({ n: 1, b: true, x: null });
    });
    it('несуществующие пути наблюдения отбрасываются', () => {
        const plugins = [{ plugin: { name: 'p', watchPaths: () => ['a', '/abs/b'] }, opts: {} }];
        expect(pluginWatchPaths(plugins, '/cwd', (p) => p === '/cwd/a')).toEqual(['/cwd/a']);
    });
});
