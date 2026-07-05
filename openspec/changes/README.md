# Активные OpenSpec-changes: порядок реализации

Это карта незаархивированных пропозалов линии модернизации C4-Builder для того, кто
берёт их в реализацию. Каждый change — самодостаточный proposal + design + specs +
tasks в своей папке; реализуется через `/opsx:apply` (или вручную по `tasks.md`).
Все проходят `openspec validate <name>`.

Предыдущие волны в `archive/`: template-offline → golden-test-ci → java-direct/d2
→ remove-pdf, remove-plantuml-version, new-noninteractive, resvg-png,
remove-vscode-snippets, jre-resolver → golden-matrix, dev-toolchain →
**ts-scaffold** (ESM-флип, tsc → dist/ Стойка 2, домены src/ — реализован;
src/ теперь честный ESM, но все 16 модулей ещё `.js` под `allowJs`).

## Текущая волна: собственно порт на TypeScript

Пересмотр 2026-07-06 (explore-сессия): вместо четырёх кластеров порта
(`util+config` → `scan+render` → `compose` → `cli+wizard`) — **один change
полного порта**; база мала (~2600 строк), golden-матрица — страховочная сетка.
Дробление монолита `build.ts` отделено от порта в собственный change: в диффе
порта видно «переименовал+типизировал», в диффе дробления — «перенёс».

```
 АКТИВНО (proposal готов):
   ts-port-full ── все 16 src/**/*.js → .ts под strict, BuildOptions в
   │               config/options.ts (оптимистичный тип), @types/*,
   │               финал — allowJs:false. build.ts остаётся монолитом.
   │               Домены = группы задач: config → util → core → cli → index.
   ▼
   build-split ─── дробление build.ts по фактическим швам: scan/tree.ts,
   │               render/diagrams.ts, compose/markdown.ts; build.ts —
   │               оркестратор (~100 строк). Rename-only, поведение фикс.
   ▼
 PENDING (ещё не пропозалы):
   legacy-fixes (дефекты, вскрытые типизацией: writeOnSameLine-заглушка,
   │             makeDirectory глотает ошибки, мёртвая joi-валидация)
   ▼
   deps-модернизация (chalk@5, @inquirer, свой config-store, joi→zod —
   │                  по одному change'у; zod закрывает «оптимистичность»
   │                  типа BuildOptions рантайм-валидацией)
   ▼
   teavm-движок (экспериментальный флаг)
```

## Рекомендованный порядок

| # | Change | Зависит от | Capability | Ветка |
|---|--------|-----------|-----------|-------|
| 1 | `ts-port-full` | — (ts-scaffold в архиве) | build-pipeline (mod: всё .ts, strict, allowJs off) | refactor/phoenix |
| 2 | `build-split` | 1 (строго после) | build-pipeline (add: пофазная модульность ядра) | refactor/phoenix |

## Ключевые сцепки и решения

- **Тип `BuildOptions` оптимистичный** (поля обязательны): wizard и `--new --yes`
  гарантируют полный конфиг; честный `| undefined` потребовал бы сотни проверок
  по монолиту — риск поведенческого дрейфа. Честность на входе добавит звено zod.
- **Правило смеси на время порта**: непортированные `.js` импортируют `'./x.js'` —
  nodenext подставляет `x.ts`, потребители при переименовании цели не правятся.
  Портированные `.ts` пишут `.ts`-импорты (Стойка 2).
- **Легаси типизируется как есть** — рантайм в обоих changes не правится вообще;
  вскрытые дефекты собираются пометками в бэклог `legacy-fixes`.
- **Wizard тестируется без TTY**: шаги-данные {when, buildPrompt, apply} + инъекция
  prompt-runner'а — оформится волной deps (переезд на @inquirer/prompts).

## Вне объёма этой волны

- Онлайн-сервер `PLANTUML_SERVER_URL` (`generateLocalImages=false`) — путь под
  удаление, golden его сознательно не фиксирует.
- Флаги выбора форматов для `new` — тонкая настройка правкой `.c4builder`.
