## Context

Кодовая база — 100% CommonJS: 15 плоских `*.js` в корне, `build.js` — монолит
(875 строк: скан + рендер + компоуз + оркестрация). `dev-toolchain` уже дал Biome,
`files`-whitelist и `engines >=20.19`; golden-матрица из трёх fixture-конфигов
(`default`/`links-top`/`embed-png`) на пиновом managed-JRE фиксирует поведение.

Это звено ставит каркас порта: конфиг `tsc`, сборку в `dist/`, доменную раскладку
`src/` и единый модульный формат. Типизация и дробление монолита — в последующих
кластерах (`util+config` → `scan+render` → `compose` → `cli+wizard`).

## Goals / Non-Goals

**Goals:**
- Компиляция `tsc → dist/` без бандлера; исходники — честный TypeScript/ESM.
- Атомарный перевод всей базы CommonJS → ESM за один шаг.
- Доменная раскладка `src/` (cli / core / config / util), в которую лягут порты.
- Паритет поведения: golden-набор зелёный до и после; ноль правок логики CLI.

**Non-Goals:**
- Переименование `.js → .ts` и типизация (кластеры порта).
- Дробление `build.js` (переезжает в `core/build.js` целиком).
- Починка легаси-дефектов, апгрейды зависимостей, `zod`, TeaVM.

## Decisions

**Стойка 2: `rewriteRelativeImportExtensions`.** Пишем `import './x.ts'`, `tsc`
переписывает в `./x.js` на выходе — единственное исключение из правила «TS не
трогает пути импорта» (подтверждено дока́ми компилятора: `allowImportingTsExtensions`
разрешён с эмитом только при этом флаге). Исходник выглядит на 100% как TS.
- *Альтернативы:* Стойка 1 (plain `tsc`, `.js` в импортах) — работает, но `.js`
  в `.ts`-файле режет глаз; Стойка 3 (нативный TS-стрип Node, без сборки) —
  требует Node ≥22.18, рвёт `engines >=20.19` и совместимость потребителей на
  Node 20. Держим Node 20 → Стойка 2. Требует `typescript >= 5.7` (пин в devDeps).

**Доменная раскладка, глубокие слои.**
```
src/index.ts
src/cli/{dispatch, commands/*, wizard/*}
src/core/{build, scan/*, render/*, compose/*}
src/config/*  src/util/*
```
Плоский префиксный `src/` отвергнут — пользователь за глубокие домены.

**Атомарный ESM-флип внутри scaffold.** `"type": "module"` — глобальный рубильник:
как только он стоит, каждый оставшийся `.js` обязан быть ESM. Поэтому флип
`require`/`module.exports` → `import`/`export` делается разом по всей базе, не по
файлу. Интероп на время порта безопасен: `require(esm)` доступен с Node 20.19
(нижняя планка выбрана под это). CJS-зависимости (`chalk@2`, `inquirer@8`,
`fs-extra`, `configstore`, `open`) импортируются как default — ESM-интероп это
покрывает; они всё равно уходят в звене `deps`.

**Централизованный резолвер путей к ресурсам.** `vendor/` (JAR, шрифты, docsify),
`template/`, `package.json` лежат в корне пакета и **не компилируются** в `dist/`.
После переезда модулей в `dist/**` наивный `path.join(__dirname, 'vendor')`
сломается (укажет внутрь `dist/`). Решение: единый `src/util/paths.ts` вычисляет
корень пакета от `import.meta.url` и экспортирует `VENDOR_DIR`, `TEMPLATE_DIR`,
`packageJson`; все восемь текущих `__dirname`-обращений (`cli.new.js`,
`pngraster.js`, `build.js`) идут через него. Заодно централизует то, что сейчас
размазано. `require('./package.json')` → чтение через `createRequire`/`fs` там же.

**Scaffold механический; `build.js` целиком.** Дробление монолита — это дизайн и
типы, его место в кластере `scan+render`/`compose`. Здесь `build.js` только
переезжает в `core/build.js` (ещё `.js`, уже ESM). `allowJs: true` держит смесь
`.ts`/`.js` компилируемой на всём протяжении порта.

**Сборка и запуск из `dist/`.** `bin`/`main` → `dist/index.js`; npm-скрипт `build`
(`tsc`); golden гоняет собранный CLI — тест-хелпер и CI делают `tsc` перед тестами.
Shebang `#!/usr/bin/env node` сохраняется в `src/index.ts` (tsc переносит ведущий
shebang в эмит).

## Risks / Trade-offs

- **Пути к ресурсам после переезда в `dist/`** → централизованный `paths.ts`
  (см. выше); golden покрывает рендер (JAR+шрифты) и `new` (template), даёт
  сигнал сразу.
- **ESM-мины при флипе** (`__dirname`/`__filename`, `require(json)`, интероп
  CJS-депов) → перечислены поимённо выше; конверсия механическая, golden +
  ручной smoke `--help`/`--new` ловят регрессию.
- **Тесты теперь зависят от шага сборки** → `pretest`/CI-шаг `tsc`; забыли
  собрать — тест падает явно, не втихую на старом `dist/`.
- **`typescript` как новая devDependency + пин ≥5.7** → фиксируем версию, как
  Biome; фича `rewriteRelativeImportExtensions` стабильна с 5.7.

## Migration Plan

Порядок задач звена (golden зелёный после каждого блока):
1. `tsconfig.json` (Стойка 2, `allowJs`), devDependency `typescript`, скрипт `build`.
2. Атомарный CJS→ESM флип всех файлов + `paths.ts` (снимает `__dirname`/JSON) —
   ещё в корне, проверка golden.
3. Переезд файлов в `src/<домены>`, правка относительных импортов — golden.
4. `package.json` (`type`, `bin`/`main`/`files` → `dist/`), Docker build-стадия,
   охват Biome `src/`, CI-шаг сборки, тест-хелпер на `dist/` — golden + `npm pack`.

Откат — обратимо на уровне git до влития; звено самодостаточно.

## Open Questions

- Нет открытых развилок: форма, тулчейн (Стойка 2), процесс (4 кластера) и
  размещение ESM-флипа согласованы в explore-сессии 2026-07-05.
