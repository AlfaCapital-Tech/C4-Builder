# Proposal

## Why

`c4builder check` печатает только текст, и у каждого движка своя форма строки: PlantUML —
`line N: …`, D2 — блок `file:line:col: …`, BPMN — `<id> [<rule>] …`, mermaid — `line N: …`,
wireflow — `node "<id>": …`. Скилл `c4builder` перечисляет все пять, чтобы агент мог их
разобрать. В CI ошибку диаграммы нельзя показать прямо в diff PR/MR: её видно только в логе
джобы. Агенту и скриптам нужен стабильный машиночитаемый вывод. С #60 (PR #76) у `check`
появились смысловые предупреждения; они тоже должны попадать в CI-отчёт (issue #65). Тот же
JSON потом возьмёт `validate` (#59).

## What Changes

- Новый флаг `c4builder check --format <text|json|github|gitlab>`, по умолчанию `text`.
  Текстовый вывод не меняется.
- `json`: в stdout печатается JSON-массив замечаний
  `{ file, line, column, engine, severity, rule, element, message }`. Если у движка поля
  нет, значение `null`. Ошибки имеют `severity: "error"`, предупреждения — `"warning"`.
  Если замечаний нет, печатается `[]`.
- `github`: по строке workflow-команды на замечание,
  `::error file=src/context.puml,line=6,title=c4builder plantuml::Syntax Error` (для
  предупреждений `::warning`). GitHub Actions показывает их аннотациями в diff PR.
- `gitlab`: отчёт Code Quality (JSON-массив `description`, `check_name`, `fingerprint`,
  `severity`, `location.path`, `location.lines.begin`) для артефакта
  `reports: codequality`. GitLab показывает замечания в виджете и diff MR.
- У замечаний BPMN и wireflow есть id элемента, но нет строки. Строку и колонку `check`
  находит сам по объявлению `id` в исходнике, поэтому аннотация встаёт на нужную строку.
  Ошибка D2 в импортированном файле указывает на этот файл.
- В машинных форматах stdout содержит только отчёт: строки `✓`/`⚠`, служебные сообщения
  (например, о выборе JRE) и цвет туда не попадают. Служебные сообщения уходят в stderr.
- Код возврата не зависит от формата: 0 или 1, как в `text`, `--strict` (#60) действует так же.
- Машинный формат без файлов печатает пустой отчёт и завершается с кодом 0. Так джоба над
  списком изменённых файлов проходит, если диаграммы в PR/MR не менялись. В `text` без файлов
  по-прежнему печатается строка использования и код 1.
- `--json` у `check` работает как синоним `--format json`, по аналогии с `doctor --json`.
- На странице «Docker и CI» появятся готовые фрагменты для GitHub Actions и GitLab CI:
  проверка изменённых диаграмм в PR/MR с аннотациями и отчётом Code Quality.

## Capabilities

### New Capabilities
- `check-output-formats`: машиночитаемые форматы вывода `c4builder check` (json, аннотации
  GitHub, отчёт GitLab Code Quality), модель замечания и привязка к файлу и строке.

### Modified Capabilities
<!-- нет: текстовый формат и коды возврата `check` (cli-commands) не меняются; поведение
     без файлов в машинных форматах описано в новой capability как отдельное требование -->

## Impact

- Код: `src/cli/commands/check.ts` собирает замечания вместо печати; новый модуль с моделью
  замечания и форматтерами; `src/core/render/warnings.ts` получает перехват предупреждений,
  чтобы они не печатались в stdout; `src/core/render/d2renderer.ts` отдаёт структурные позиции
  ошибок компиляции (файл, строка, колонка); `src/cli/dispatch.ts` получает опцию `--format`
  со списком значений, а `--json` теперь работает и для `check`.
- Зависимость: change строится поверх PR #76 (`check-undeclared-rel`, общий канал
  предупреждений и `--strict`). Если #76 изменится, этот change нужно перебазировать.
- Тесты: `test/check.test.mjs` (форматы end-to-end) и юнит-тесты форматтеров.
- Документация: страницы сайта `05 CLI и конфигурация`, `07 Docker и CI`, `08 Агенты`
  (RU и EN), `skills/c4builder` (агенту удобнее `--format json`), `template/AGENTS.md`,
  `CHANGELOG.md`.
- Рендер и golden-снапшоты не меняются.
