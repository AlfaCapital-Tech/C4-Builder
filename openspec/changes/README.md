# Активные OpenSpec-changes: порядок реализации

Это карта незаархивированных пропозалов линии модернизации C4-Builder для того, кто
берёт их в реализацию. Каждый change — самодостаточный proposal + design + specs +
tasks в своей папке; реализуется через `/opsx:apply` (или вручную по `tasks.md`).
Все проходят `openspec validate <name> --strict`.

Предыдущие волны в `archive/`: template-offline → golden-test-ci → java-direct/d2
→ remove-pdf, remove-plantuml-version, new-noninteractive, resvg-png,
remove-vscode-snippets, jre-resolver → **golden-matrix, dev-toolchain**
(страховочная сетка ×3 конфига + Biome/lint-CI/files/engines — оба реализованы).

## Текущая волна: собственно порт на TypeScript

Решения explore-сессии 2026-07-05: **Стойка 2** — чистый `tsc → dist/` без бандлера,
`rewriteRelativeImportExtensions` + `allowImportingTsExtensions` (пишем `.ts` в
импортах, эмит — `.js`; `typescript >= 5.7`), ESM, `engines >=20.19` (Node 20
держим — `require(esm)` доступен с 20.19). Глубокая доменная раскладка `src/`
(cli / core{scan,render,compose} / config / util). Рефакторинг вместе с портом
(«структура свободна, поведение фиксировано»); каждый шаг под зелёным golden.

```
 АКТИВНО (proposal готов):
   ts-scaffold ── tsconfig(Стойка 2) + атомарный CJS→ESM флип + переезд в
   │              src/<домены> + сборка dist/ + Docker. build.js едет целиком.
   │              Поведение: 0 правок.
   ▼
 PENDING (ещё не пропозалы) — порт по кластерам, .js→.ts + типы:
   port·util+config ─▶ port·scan+render ─▶ port·compose ─▶ port·cli+wizard
                          дробим build.js по фазам           чиним 3 легаси-дефекта
   ▼
   deps-модернизация (chalk@5, @inquirer, свой config-store, joi→zod)
   ▼
   teavm-движок (экспериментальный флаг)
```

## Рекомендованный порядок

| # | Change | Зависит от | Capability | Ветка |
|---|--------|-----------|-----------|-------|
| 1 | `ts-scaffold` | — (golden-matrix/dev-toolchain в архиве) | build-pipeline (new) + ci-validation, dev-toolchain (mod) | refactor/phoenix |
| 2 | `port·util+config` | 1 | — (рефактор, поведение фикс.) | refactor/phoenix |
| 3 | `port·scan+render` | 2 | — | refactor/phoenix |
| 4 | `port·compose` | 3 | — | refactor/phoenix |
| 5 | `port·cli+wizard` | 4 | — | refactor/phoenix |

Кластеры 2–5 — пока не оформлены пропозалами; оформляются по мере подхода.

## Ключевые сцепки и решения

- **`ts-scaffold` механический.** ESM-флип атомарен (`"type":"module"` — глобальный
  рубильник), `build.js` переезжает в `core/build.js` целиком; дробление монолита
  и типы — в кластерах порта. Мины ESM (`__dirname`, `require(json)`, пути к
  `vendor/`/`template/` после переезда в `dist/`) сняты единым `util/paths.ts`
  (резолв корня пакета от `import.meta.url`) — см. `ts-scaffold/design.md`.
- **Дробление `build.js`** идёт в кластере `scan+render` (tree/foldIncludes→scan;
  renderDiagram/images/d2/png/jre→render) и `compose` (compile/MD/CompleteMD/WebMD
  + тонкий `build()`), под зелёным golden-матрицей.
- **Известные дефекты легаси-кода** (implicit-глобал `responses` и мёртвая
  joi-валидация в cli.collect.js, `EXECUTE_SCRIPT`-опечатка) чинятся в кластере
  порта `cli+wizard` — списком в его proposal, по каждому отдельное решение.
- **Wizard тестируется без TTY**: шаги-данные {when, buildPrompt, apply} + инъекция
  prompt-runner'а — оформится в кластере `cli+wizard`.

## Вне объёма этой волны

- Онлайн-сервер `PLANTUML_SERVER_URL` (`generateLocalImages=false`) — путь под
  удаление, golden его сознательно не фиксирует.
- Флаги выбора форматов для `new` — тонкая настройка правкой `.c4builder`.
