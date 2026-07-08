## 1. zod-валидация конфига

- [x] 1.1 Добавить `zod`; создать `src/config/schema.ts`: схема `.c4builder` (camelCase-ключи, все опциональны с дефолтами из `defaultConfig`, coercion типов) + вывод типа формы конфига
- [x] 1.2 `cli/dispatch.ts`: `getOptions()` валидирует сырой конфиг схемой (`safeParse`) — при неверном типе понятная ошибка с ключом (exit ≠ 0), затем маппинг в `BuildOptions` (существующая логика дефолтов/спец-кейсов сохранена); снять «оптимистичность» типа `BuildOptions`
- [x] 1.3 Проверить первый запуск/`--new` (пустой конфиг проходит на дефолтах) и невалидный конфиг (понятная ошибка); golden зелёный; коммит

## 2. joi → zod в визарде

- [x] 2.1 `cli/wizard/collect.ts`: заменить `joi`-валидаторы на zod (`safeParse` → boolean / строка ошибки для inquirer), удалить мёртвую `joi.validate`-ветку
- [x] 2.2 Удалить `joi` из зависимостей; `npm audit` без joi-уязвимости; прогон визарда вручную; коммит

## 3. Апгрейд inquirer 8 → 12

- [x] 3.1 Поднять `inquirer` до 12, снять `@types/inquirer`; адаптировать `collect.ts` под ESM/типы v12 (легаси `.prompt([...])`-API, типы ответов через `Awaited<ReturnType<typeof inquirer.prompt>>`)
- [x] 3.2 Убедиться, что транзитивный `lodash` ушёл (`npm ls lodash` / audit); tsc + biome зелёные; прогон визарда; коммит

## 4. Апгрейд express 4 → 5

- [ ] 4.1 Поднять `express` до 5 (+ `@types/express` в лад); в `cli/commands/site.ts` заменить `app.get('/*', express.static(dist))` на `app.use(express.static(dist))`; сверить остальные вызовы по гайду 4→5
- [ ] 4.2 Ручная проверка `c4builder --site` (раздача статики, `-w` livereload, `--open`); `qs`/`body-parser`-уязвимости закрыты; tsc; коммит

## 5. ESM-апгрейды и минорные

- [ ] 5.1 Поднять `chalk` 2→5, `open` 8→10, `configstore` 4→7 (+ `@types/configstore`), `commander` 14→15; починить несовместимые вызовы (проверка tsc; сверить commander 14→15 breaking по changelog)
- [ ] 5.2 Подтянуть `figlet`, `fs-extra`, `@types/*`; tsc + golden зелёные; коммит

## 6. CI аудит-гейт и финальная проверка

- [ ] 6.1 Добавить джобу `audit` в `.github/workflows/ci.yml` (`npm audit --audit-level=high`); `npm audit` чистый локально
- [ ] 6.2 Финальная проверка: `npm run build`, весь vitest (golden без регрессий), `biome ci`, `npm pack --dry-run`; коммит
