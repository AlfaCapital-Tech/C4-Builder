## 1. Каркас компиляции

- [x] 1.1 Добавить devDependency `typescript` (пин точной версии ≥5.7)
- [x] 1.2 Создать `tsconfig.json`: `module`/`moduleResolution` `nodenext`, `target es2022`, `rootDir: src`, `outDir: dist`, `allowImportingTsExtensions: true`, `rewriteRelativeImportExtensions: true`, `allowJs: true`, `strict: true`; `include: ["src"]`
- [x] 1.3 npm-скрипт `build` (`tsc`); добавить `dist/` в `.gitignore` и `.dockerignore`

## 2. Атомарный CJS → ESM флип (в корне, до переезда)

- [x] 2.1 Проставить `"type": "module"` в `package.json`
- [x] 2.2 Перевести все модули `require`/`module.exports` → `import`/`export` (единым проходом)
- [x] 2.3 Создать модуль резолва путей (`import.meta.url` → корень пакета): экспорт `VENDOR_DIR`, `TEMPLATE_DIR`, `packageJson`
- [x] 2.4 Заменить восемь `__dirname`-обращений (`cli.new.js`, `pngraster.js`, `build.js`) на импорт из модуля путей
- [x] 2.5 Заменить `require('./package.json')` в `cli.js` на чтение из модуля путей (`createRequire`/`fs`)
- [x] 2.6 `d2renderer`: сохранить ленивый `import()` для `@terrastruct/d2`, убрать CJS-обходной комментарий
- [x] 2.7 Golden зелёный + ручной smoke `--help` и `--new` (флип не изменил поведение)

## 3. Доменная раскладка src/

- [x] 3.1 Создать дерево `src/{cli/{commands,wizard},core/{scan,render,compose},config,util}` и переместить модули по слоям (`build.js` → `core/build.js` целиком, `index.js` → `src/index.js` с сохранением shebang)
- [x] 3.2 Поправить относительные импорты под новую вложенность
- [x] 3.3 Golden зелёный (переезд не изменил поведение)

## 4. Сборка, упаковка, CI, Docker

- [x] 4.1 `package.json`: `bin`/`main` → `dist/index.js`; `files` → `dist/`, `template/`, `vendor/`, README, license
- [x] 4.2 `biome.json`: включить охват `src/**/*.ts`, добавить `dist/` в ignore
- [x] 4.3 `.github/workflows/ci.yml`: шаг `npm run build` перед тестами в node-матрице
- [x] 4.4 Тест-хелпер `test/helpers.mjs`: запускать CLI из `dist/`; гарантировать сборку перед golden (`pretest`/CI-шаг)
- [x] 4.5 `Dockerfile`: build-стадия на `node:24`, запуск из `dist/`
- [x] 4.6 Golden зелёный на собранном из `dist/` CLI; `npm pack --dry-run` — в пакете `dist/`+`vendor/`+`template/`, нет `src/`/openspec/test

## 5. Валидация звена

- [x] 5.1 `npm run build` без ошибок, `npm run lint` зелёный, весь golden зелёный
- [x] 5.2 Smoke: `node dist/index.js --help` и `node dist/index.js --new --name demo -y`
- [x] 5.3 `openspec validate ts-scaffold --strict` проходит
