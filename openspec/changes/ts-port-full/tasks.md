## 1. Типы зависимостей

- [ ] 1.1 devDeps: `@types/node`, `@types/configstore`, `@types/inquirer@^8`, `@types/figlet`, `@types/fs-extra`, `@types/express@^4`; проверить, чьи типы встроены (`commander`, `chalk@2`, `@resvg/resvg-js`, `node-watch`, `@terrastruct/d2`, `joi`); несовпадения — локальный `src/types/<pkg>.d.ts`; `npm run build` зелёный

## 2. config/

- [ ] 2.1 Новый `src/config/options.ts`: `C4ConfigFile` (camelCase-ключи `.c4builder`) и `BuildOptions` (SCREAMING_CASE, оптимистичный — поля обязательны; легаси-поля с пометкой)
- [ ] 2.2 `defaults.js → defaults.ts` (`defaultConfig` типизирован через `C4ConfigFile`); golden зелёный; коммит группы

## 3. util/

- [ ] 3.1 `paths.js → paths.ts` (типизировать `packageJson` по фактическому потреблению)
- [ ] 3.2 `utils.js → utils.ts` (сигнатуры как есть: `writeOnSameLine`, `makeDirectory` не чинить); golden зелёный; коммит группы

## 4. core/

- [ ] 4.1 `render/jre.js → jre.ts`, `render/d2renderer.js → d2renderer.ts`, `render/pngraster.js → pngraster.ts`
- [ ] 4.2 `compose/docsify.template.js → docsify.template.ts` (интерфейс параметров по вызову из build)
- [ ] 4.3 `build.js → build.ts` монолитом: `build(options: BuildOptions, cacheConf)`, внутренние структуры (дерево скана и др.) — локальные интерфейсы; рантайм не менять; golden зелёный; коммит группы

## 5. cli/

- [ ] 5.1 `commands/{help,list,new,site,jre}.js → .ts`
- [ ] 5.2 `wizard/collect.js → collect.ts` (joi-обёртка `validate` как есть)
- [ ] 5.3 `dispatch.js → dispatch.ts`: `getOptions(): BuildOptions`, типизировать заглушки `conf`/`cacheConf`
- [ ] 5.4 `index.js → index.ts` (shebang сохраняется в эмите); golden зелёный; коммит группы

## 6. Финальный флип строгости

- [ ] 6.1 `tsconfig.json`: `allowJs: false`; убедиться `find src -name '*.js'` пуст; `npm run build` + golden зелёные
- [ ] 6.2 Санити состава пакета: `npm pack --dry-run` — `dist/` полон, лишнего нет; коммит
