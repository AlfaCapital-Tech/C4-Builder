# Активные OpenSpec-changes: порядок реализации

Это карта незаархивированных пропозалов линии модернизации C4-Builder для того, кто
берёт их в реализацию. Каждый change — самодостаточный proposal + design + specs +
tasks в своей папке; реализуется через `/opsx:apply` (или вручную по `tasks.md`).
Все проходят `openspec validate <name> --strict`.

Предыдущая волна (template-offline → golden-test-ci → java-direct/d2 → remove-pdf,
remove-plantuml-version, new-noninteractive, resvg-png, remove-vscode-snippets,
jre-resolver) целиком в `archive/`.

## Текущая волна: переход на современный стек (TS)

Решения explore-сессии 2026-07-05: Biome 2 (один линтер/форматтер), чистый
`tsc → dist/` без бандлера, ESM-синтаксис, engines `>=20.19`, npm остаётся;
рефакторинг структуры ведётся вместе с портом («структура свободна, поведение
фиксировано»), апгрейды зависимостей — после порта отдельными change'ами.

```
 PENDING:
   golden-matrix ──▶ dev-toolchain ──▶ (далее, ещё не пропозалы:)
   сетка ×3 конфига    Biome, lint-CI,     ts-scaffold (src/dist, tsc, ESM, Docker 24)
   + пин JVM           files/engines       → порт по кластерам: config → scan/render
                                             → compose → cli+wizard
                                           → deps-модернизация (chalk@5, @inquirer,
                                             свой config-store, joi→zod, express)
                                           → teavm-движок (экспериментальный флаг)
```

## Рекомендованный порядок

| # | Change | Зависит от | Capability | Ветка |
|---|--------|-----------|-----------|-------|
| 1 | `golden-matrix` | — | regression-testing (mod) | refactor/phoenix |
| 2 | `dev-toolchain` | 1 (желательно) | dev-toolchain (new) + ci-validation (mod) | refactor/phoenix |

`dev-toolchain` формально не зависит от `golden-matrix`, но порядок 1 → 2 держит
правило волны: сначала страховочная сетка, потом правки (формат-коммит и
lint-автофиксы уже проверяются расширенной матрицей).

## Ключевые сцепки и решения

- **`golden-matrix` — страховка всей волны.** Три fixture-конфига (default,
  links-top, embed-png) фиксируют ветки compose-слоя ДО рефакторинга build.js;
  golden-сборки идут на пиновом managed-JRE (кеш jre-резолвера, `JAVA_HOME`) —
  закрывает периодические расхождения SVG локально/CI из-за разных JVM.
- **`dev-toolchain` не меняет поведение.** Формат-коммит и автофиксы — с зелёным
  golden после каждого коммита; правила, требующие рефакторинга, откладываются
  до звеньев порта (`TODO(ts-port)`).
- **Известные дефекты легаси-кода** (implicit-глобал `responses` и мёртвая
  joi-валидация в cli.collect.js, `EXECUTE_SCRIPT`-опечатка) чинятся НЕ здесь,
  а в звене порта wizard — списком в его proposal, по каждому отдельное решение.
- **Wizard тестируется без TTI**: шаги-данные + инъекция prompt-runner'а
  (решение сессии) — оформится в звене порта cli+wizard.

## Вне объёма этой волны

- Онлайн-сервер `PLANTUML_SERVER_URL` (`generateLocalImages=false`) — путь под
  удаление, golden его сознательно не фиксирует.
- Флаги выбора форматов для `new` — тонкая настройка правкой `.c4builder`.
