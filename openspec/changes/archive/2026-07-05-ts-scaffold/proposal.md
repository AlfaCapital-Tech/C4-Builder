# ts-scaffold — каркас TypeScript/ESM: tsc → dist, доменная раскладка src/

## Why

Стартовое звено собственно порта на TypeScript (после `dev-toolchain`). Прежде
чем типизировать код по кластерам, нужен каркас, в который они лягут: конфиг
компилятора, сборка `tsc → dist/`, доменная раскладка `src/` и единый модульный
формат. Сейчас весь код — CommonJS (`module.exports`, 15 плоских файлов в корне,
`build.js` — монолит на 875 строк). Переход на ESM — глобальный рубильник
(`"type": "module"` в `package.json`), его нельзя делать по одному файлу, поэтому
он входит сюда как атомарный шаг. Само звено поведение CLI **не меняет**: golden
зелёный до и после.

## What Changes

- **Каркас компиляции (Стойка 2).** `tsconfig.json`: `module`/`moduleResolution`
  `nodenext`, `outDir: dist`, `rootDir: src`, `allowImportingTsExtensions` +
  `rewriteRelativeImportExtensions` — исходники пишутся с `.ts` в относительных
  импортах, `tsc` переписывает их в `.js` на выходе. Без бандлера. `allowJs: true`
  на время порта (пока часть модулей ещё `.js`).
- **Атомарный CJS → ESM флип.** `"type": "module"` в `package.json`; все файлы
  переводятся `require`/`module.exports` → `import`/`export` за один шаг
  (механически, golden зелёный). Интероп на время порта безопасен: `require(esm)`
  доступен с Node 20.19 (нижняя планка `engines`).
- **Доменная раскладка `src/`.** Плоский корень разъезжается по слоям:
  `cli/` (dispatch + `commands/` + `wizard/`), `core/` (`build.ts` +
  `scan/` + `render/` + `compose/`), `config/`, `util/`. `build.js` на этом
  шаге переезжает в `core/build.js` целиком — дробление монолита идёт в
  звеньях порта, не здесь.
- **Сборка и запуск из `dist/`.** npm-скрипт `build` (`tsc`); `bin`/`main` →
  `dist/index.js`; `files` → `dist/` (вместо перечня `cli*.js`); тест-хелпер и
  CI собирают `tsc` перед golden (тесты гоняют собранный CLI).
- **Docker.** Build-стадия на `node:24`, рантайм — как есть; итоговый образ
  запускает `dist/`.

Не входит (следующие звенья порта): переименование `.js → .ts` и типизация,
дробление `build.js` по фазам, починка известных легаси-дефектов
(implicit-глобал `responses` и мёртвая joi-валидация в `cli.collect.js`,
опечатка `EXECUTE_SCRIPT`), апгрейды зависимостей, `zod`, TeaVM-движок.

## Capabilities

### New Capabilities

- `build-pipeline`: как исходники пакета превращаются в поставляемый артефакт —
  язык и модульная система (TypeScript + ESM), шаг компиляции (`tsc → dist/`
  без бандлера, правило импортов Стойки 2), состав npm-пакета (`dist/` + `vendor/`
  + `template/`), точка входа (`bin` → `dist/index.js`), паритет поведения
  (golden зелёный).

### Modified Capabilities

- `ci-validation`: workflow собирает проект (`tsc`) перед прогоном тестов;
  ошибка компиляции — красный статус PR наравне с линтом и тестами.
- `dev-toolchain`: `files`-whitelist переезжает на `dist/` (в пакет больше не
  попадают корневые `cli*.js`); зона покрытия Biome включает `src/**/*.ts`.

## Impact

- Новые файлы: `tsconfig.json`, дерево `src/**` (переезд существующих модулей).
- Правки: `package.json` (`type`, `scripts.build`, `bin`/`main`, `files`,
  devDependency `typescript`), `.github/workflows/ci.yml` (шаг сборки),
  `Dockerfile` (build-стадия), `biome.json` (охват `src/`), тест-хелпер
  (`test/helpers.mjs` — запуск собранного CLI из `dist/`).
- Поведение CLI не меняется: golden-тест зелёный до и после каждого коммита звена.
- Потребители пакета (`arch` и др.): CLI запускается из `dist/`, конфиг
  `.c4builder` и вывод не затронуты.
