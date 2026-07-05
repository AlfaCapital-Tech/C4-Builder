# tasks — dev-toolchain

## 1. Biome: конфиг и скрипты

- [x] 1.1 `@biomejs/biome` в devDependencies (точная версия, без `^`)
- [x] 1.2 `biome.json`: форматтер под текущий стиль (space/4, single quotes, semicolons, lineWidth 110), линт `recommended`, ignore-зоны (`vendor/`, `template/`, `docs/`, `test/golden/`, `test/.tmp/`)
- [x] 1.3 npm-скрипты: `lint`, `lint:fix`, `format`, `check` (biome ci)
- [x] 1.4 Прогнать `npm run lint` — инвентаризация нарушений: список «тривиальный автофикс» vs «ignore/off с комментарием»

## 2. Приведение репо

- [x] 2.1 Формат-коммит: `biome format --write` без ручных правок; убедиться, что `template/`, `vendor/`, `test/golden/` не тронуты; hash коммита — в `.git-blame-ignore-revs`
- [x] 2.2 Тривиальные lint-автофиксы отдельным коммитом (мёртвый импорт joi в build.js, `new Buffer.from` → `Buffer.from` в utils.js и подобное) — только доказуемо эквивалентные правки
- [x] 2.3 Остальные нарушения: точечные `biome-ignore` с `TODO(ts-port)` либо off в конфиге с причиной; `npm run check` — чисто
- [x] 2.4 `npm test` (golden + юниты) зелёный после каждого из коммитов 2.1–2.3

## 3. CI

- [x] 3.1 Джоба `lint` в `.github/workflows/ci.yml`: checkout → setup-node 24 → `npm ci --ignore-scripts` → `npx biome ci .` (без Java, вне матрицы)
- [x] 3.2 Проверить на ветке: джоба падает на нарочно испорченном формате, проходит после фикса

## 4. Гигиена package.json

- [x] 4.1 `files`-whitelist (js-модули CLI, `template/`, `vendor/`, README, license); сверка `npm pack --dry-run` до/после
- [x] 4.2 `engines.node: ">=20.19"`
- [x] 4.3 Smoke: установить пакет из tarball (`npm pack` → `npm i -g ./…tgz` или в tmp-префикс), проверить `c4builder --help` и `c4builder --new --name demo -y` + сборку созданного проекта
