# Активные OpenSpec-changes: порядок реализации

Это карта незаархивированных пропозалов линии модернизации C4-Builder для того, кто
берёт их в реализацию. Каждый change — самодостаточный proposal + design + specs +
tasks в своей папке; реализуется через `/opsx:apply` (или вручную по `tasks.md`).
Все проходят `openspec validate <name> --strict`.

## Граф зависимостей

```
 АРХИВ (реализовано):
   template-offline → golden-test-ci → plantuml-java-direct
                                        d2-backend

 PENDING:
   remove-pdf ─────────────┐
   (independent cleanup)   │
                           ├──▶ new-noninteractive
   remove-plantuml-version ┘    (после обоих cleanup)
   (independent cleanup)

   [java-direct ✓] ─┬─▶ resvg-png        (независим от cleanup-ветки)
   [d2-backend  ✓] ─┘
   [java-direct ✓] ───▶ jre-resolver     (⚠ отдельная ветка/PR)

 ДАЛЕЕ (ещё не пропозалы): TS-порт → teavm-движок
```

## Рекомендованный порядок

| # | Change | Зависит от | Capability | Ветка |
|---|--------|-----------|-----------|-------|
| 1 | `remove-pdf` | — | output-formats (new) | refactor/phoenix |
| 2 | `remove-plantuml-version` | — | diagram-rendering (mod) | refactor/phoenix |
| 3 | `new-noninteractive` | 1, 2 | project-scaffold (new) | refactor/phoenix |
| 4 | `resvg-png` | java-direct, d2 (архив) | diagram-rendering (mod) | refactor/phoenix |
| 5 | `jre-resolver` | java-direct (архив) | jre-resolution (new) + diagram-rendering (mod) | **openspec/jre-resolver (PR #9)** |

1–2 независимы между собой (можно параллельно). 4 независим от 1–3. 5 на отдельной
ветке — вливается отдельным PR.

## Ключевые сцепки и решения

- **`remove-plantuml-version` ↔ `new-noninteractive`.** Первый убирает выбор версии
  PlantUML; поэтому второй НЕ вводит флаг `--plantuml-version`. Порядок: сначала
  `remove-plantuml-version`. (Уже согласовано в спеках обоих.)
- **Легаси-конфиги не ломаем.** `remove-pdf`: truthy `generatePDF` → warn+exit 0, без
  мутации. `remove-plantuml-version`: `plantumlVersion` игнорируется, warn только на
  пине удалённой версии. Главный потребитель `arch` (`plantumlVersion:"latest"`,
  `generateLocalImages:true`, `svg`) проходит без предупреждений.
- **Golden неизменен** во всех cleanup-change'ах: fixture на `svg`, PDF выключен,
  версия `1.2025.2` = оставляемый JAR. `resvg-png` не трогает `ditaa.png` (нативный PNG).
- **`resvg-png` растеризует SVG→PNG** единым `@resvg/resvg-js` для обоих движков; ditaa —
  исключение (остаётся нативным PlantUML-PNG).

## Вне объёма этих change'ей

- Онлайн-сервер `PLANTUML_SERVER_URL` — отдельная чистка из плана (в `arch` не
  используется, `generateLocalImages:true`).
- Флаги выбора форматов для `new` (`--md/--website/...`) — тонкая настройка правкой
  `.c4builder`.
- TS-порт и экспериментальный TeaVM-движок — следующие звенья, пропозалы ещё не оформлены.
