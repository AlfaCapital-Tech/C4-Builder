# Design

## Context

- Скиллы ставит `c4builder skills` (`src/cli/commands/skills.ts`) в `.agents/skills` и под
  Claude Code ещё в `.claude/skills`, вписывая `metadata.generatedBy: "<version>"` после
  `description`. `skillsNotice` проверяет только `c4builder/SKILL.md` действующей копии: личная
  `~/<dir>/skills`, иначе ближайшая проектная до корня git; `<dir>` — `.claude` для Claude Code,
  `.agents` для остальных.
- Агент — `detectAgent` (`src/cli/agent.ts`): `C4BUILDER_AGENT`, `CLAUDECODE`, `CODEX_THREAD_ID`,
  `GEMINI_CLI`, `OPENCODE`, `COPILOT_CLI`, `AI_AGENT`.
- Новая версия — `npm view <pkg> dist-tags --json` (`VIEW` в `update.ts`) с реестром и
  сертификатами из npmrc; `newestVersion` выбирает версию по каналу; `disabled()` выключает
  проверку в `CI`, с `NO_UPDATE_NOTIFIER` и в Docker-образе.
- Java — `resolveJava`/`cachedJava` (`core/render/jre.ts`), `c4builder jre info` печатает JSON.
- `c4builder check` проверяет файлы движками сборки без `.c4builder`.
- Codex (openai/codex, 11.2026) читает скиллы из `.agents/skills`, `.codex/skills`,
  `~/.agents/skills` и `$CODEX_HOME/skills` (последний помечен устаревшим). Порядок приоритета
  между ними в документации не описан.
- Скиллы плагинов Claude Code лежат в кэше `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/`;
  раскладка — не публичный контракт.

## Goals / Non-Goals

**Goals:**
- Одна команда показывает, что мешает работе: среда, скиллы агента, проект, запуск — с командой
  исправления у каждой проблемы.
- Вывод пригоден для агента (`--json`, стабильные id) и для issue (без путей пользователя и
  значений переменных).

**Non-Goals:**
- Исправлять самой (`--fix`): команда только читает. Исправления — подсказки, их выполняют
  пользователь или агент с его согласия.
- Знать, что загрузила сессия агента: CLI видит только файлы.
- Каталоги скиллов агентов, кроме Claude Code, Codex и общего `.agents` (Cursor и др.) — позже.
- Зависшая блокировка сборки: `acquireBuildLock` сам перехватывает лок мёртвого процесса.

## Decisions

### D1. Группы, id и статусы
Группы — `env`, `skills`, `render`, `project`, `runtime`, в этом порядке. Id проверки —
`<group>.<name>` (`env.node`, `env.java`, `skills.claude.project`, `runtime.port`); id не
меняются между версиями — на них опираются агенты и `--json`. Статусы: `ok`, `warn`, `error`,
`skipped` (проверка не применима или не выполнена: нет сети, нет `.d2` в проекте). У `warn` и
`error` — `fix`: одна команда или ссылка; для команд, меняющих файлы проекта или удаляющих
личные копии, — с пометкой `(ask the user first)`, как в уведомлениях.

`c4builder doctor skills project` — только перечисленные группы. Неизвестная группа — сообщение
со списком групп и код 2, как ошибка использования у `feedback`.

### D2. Коды возврата
`0` — нет ошибок (предупреждения допустимы); `1` — есть хотя бы одна `error`; `--strict` — `1`
и при `warn` (для CI). `skipped` код не меняет. Так `doctor` в pre-commit или CI не падает от
сети, а строгость включается флагом. Альтернатива «ненулевой код и на предупреждениях», как у
`brew doctor`, отвергнута: предупреждения (нет сети, нет D2) не мешают работе.

### D3. Текст и JSON
Текст — заголовок с версией и каналом, группы с проверками `✓` / `!` / `✗` / `–`, под проблемой —
`fix: …`, в конце — `N errors, M warnings`. Все строки на английском (тест `cli-language`).

```text
c4builder doctor 0.14.0 (latest)
Environment
  ✓ Node.js 26.5.0
  ✓ c4builder 0.14.0 — newest
  ✓ Java 21 (system)
Skills (claude-code)
  ✗ .claude/skills/c4builder-review — from 0.12.0, CLI 0.14.0
      fix: c4builder skills   (ask the user first)
  ! plugin c4builder@<marketplace>: c4builder-review differs from this package and duplicates the project skill
  – what the agent session loaded is not visible to the CLI
Render
  ✓ plantuml 0.4 s
Project
  ✓ .c4builder valid, non-interactive build ready
Runtime
  ✓ port 3000 free
1 error, 1 warning
```

`--json` — один объект в stdout, ничего больше:

```json
{
  "version": "0.14.0",
  "channel": "latest",
  "agent": "claude-code",
  "checks": [
    { "id": "env.node", "status": "ok", "message": "Node.js 26.5.0" },
    {
      "id": "skills.claude.project",
      "status": "error",
      "message": ".claude/skills/c4builder-review — from 0.12.0, CLI 0.14.0",
      "fix": "c4builder skills",
      "askUser": true
    }
  ],
  "summary": { "errors": 1, "warnings": 1 }
}
```

### D4. Скиллы
- Каталоги: `.agents/skills` (все агенты); Claude Code — `.claude/skills` от текущего каталога
  вверх до корня git и `~/.claude/skills`; Codex — ещё `.codex/skills`, `~/.agents/skills`,
  `$CODEX_HOME/skills`. Без агента проверяются все каталоги, с агентом — его и `.agents`.
- Для каждого найденного каталога — все скиллы пакета (`c4builder`, `c4builder-review`,
  `c4builder-setup`): нет части набора — `warn`.
- Версия `metadata.generatedBy`: старше CLI — `error` (fix `c4builder skills`); новее CLI —
  `warn` (fix `c4builder update`); нет отметки — `warn` (поставлено `npx skills` или руками).
- Текст: SHA-256 файлов скилла (`SKILL.md` и `references/`) против файлов пакета; из
  установленного `SKILL.md` перед сравнением вырезается блок `metadata.generatedBy`, который
  вписывает `c4builder skills`. Не совпало при той же версии — `warn` «edited copy».
- Перекрытие: у Claude Code личная копия побеждает проектную (как в `skillsNotice`) — `warn` с
  путём личной копии.
- Плагины Claude Code — по возможности: обход `~/.claude/plugins/cache/*/*/*/skills/<name>` для
  имён скиллов пакета; найдено — `warn` «duplicates project skills», текст отличается — так и
  сказать. Ошибка обхода — `skipped`, не `error`: раскладка кэша не контракт.
- Последняя строка группы — всегда `–` «what the agent session loaded is not visible to the CLI».

Логика «действующей копии» берётся из `skillsNotice` (выносится в общую функцию), а не пишется
заново: строка при сборке и doctor не должны расходиться.

### D5. Среда
`env.node` (≥ `engines.node`), `env.cli` (версия, канал `latest`/`rc` по версии, новее ли — сеть,
D6), `env.install` (глобальный npm, зависимость проекта, Docker по `C4BUILDER_DOCKER`; несколько
`c4builder` в `PATH` — `warn`), `env.java` (системная ≥ 17 или managed JRE; нет ни той, ни
другой — `warn` с fix `c4builder jre install`: JRE скачается при первой сборке), `env.d2` (только
если в проекте есть `.d2`), `env.fonts` (встроенный шрифт или `--system-fonts`), `env.proxy`
(заданы ли `HTTPS_PROXY`/`NODE_EXTRA_CA_CERTS` — только факт, без значений).

### D6. Сеть
Проверка новой версии — по умолчанию, тот же `npm view` (`VIEW`), что у фоновой проверки, но
синхронно с таймаутом 3 с. Нет ответа — `skipped` «registry not reachable», не ошибка.
`--offline` — не ходить в сеть. `disabled()` doctor не выключает: его запускают явно.

### D7. Пробный рендер
По умолчанию — крошечная PlantUML-диаграмма с C4 stdlib тем же путём, что `check` (~1–2 с); D2 и
Mermaid — только если такие файлы есть в проекте. `--full` — проект `--new --name doctor -y` во
временном каталоге и его сборка, как шаг «Smoke build» скилла `c4builder-setup`; временный
каталог удаляется.

### D8. Проект и запуск
`project.config` — `.c4builder` найден и проходит `parseConfig`; `project.complete` — сборка
пройдёт без мастера; `project.paths` — каталоги исходников и пути плагинов (например, store
`openspec`) существуют. Вне проекта — `skipped` с подсказкой `c4builder --new`.
`runtime.port` — `webPort` (или `-p`) свободен, или на нём отвечает `c4builder site -w`
(`ok` «site -w is running»); занят другим процессом — `warn`. Когда появится `c4builder status`
(#64), проверка берёт данные из неё. `runtime.agent` — какой агент определён и включён ли
агентский режим.
Предупреждение о watcher (#53) не делаем: к релизу doctor #53 должен быть исправлен.

### D9. Безопасный вывод
Без `-v`: домашний каталог — `~`, абсолютные пути внутри проекта — относительные, значения
переменных окружения не печатаются ни в тексте, ни в JSON. `-v` добавляет абсолютные пути и
подробности (путь к java, файлы, не совпавшие по хэшу). Шаблон issue на GitHub просит вывод
`c4builder doctor` без `-v`.

### D10. Быстро
Проверки групп — параллельно; цель — < 3 с без `--full` и с ответом реестра. Разводится в
`dispatch.ts` до `Configstore`, как `check` и `skills`: doctor не создаёт `.c4builder`.

### D11. Связь со скиллами и уведомлением
`c4builder-setup` начинается с `c4builder doctor` и идёт по его `fix`, а не по своим шагам
проверки; функциональная проверка — `c4builder doctor render --full`. Строка о скиллах под
агентом получает хвост ` Details: c4builder doctor skills`.

## Risks / Trade-offs

- [Раскладка кэша плагинов Claude Code сменится] → только `warn`/`skipped`, ни одной `error` из
  этой проверки; тест на фикстуре текущей раскладки.
- [Сеть медленная, doctor ждёт] → таймаут 3 с, `--offline`.
- [В выводе утекут пути и переменные] → D9 и тест: вывод без `-v` не содержит `HOME` и значений
  `HTTPS_PROXY`/`NODE_EXTRA_CA_CERTS`.
- [Хэш ругается на любую правку скиллов] → это и есть цель: правки скиллов — в репозиторий
  c4builder; `warn`, не `error`.

## Migration Plan

Релиз с `doctor`. Скилл `c4builder-setup` переходит на него в том же релизе; уведомление о
скиллах начинает ссылаться на `doctor skills`. Внешние обёртки над диагностикой c4builder
(командные doctor-скрипты) могут вызывать `c4builder doctor --json` вместо своих проверок.
