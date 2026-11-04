# Design

## Context

- Скиллы ставит `c4builder skills` (`src/cli/commands/skills.ts`) в `.agents/skills` и под
  Claude Code ещё в `.claude/skills`, вписывая `metadata.generatedBy: "<version>"` после
  `description`. `skillsNotice` проверяет только `c4builder/SKILL.md` действующей копии: личная
  `~/<dir>/skills`, иначе ближайшая проектная до корня git; `<dir>` — `.claude` для Claude Code,
  `.agents` для остальных.
- Агент — `detectAgent` (`src/cli/agent.ts`): `C4BUILDER_AGENT`, `CLAUDECODE`, `CODEX_THREAD_ID`,
  `GEMINI_CLI`, `OPENCODE`, `COPILOT_CLI`, `AI_AGENT`.
- Новая версия — `npm view <pkg> dist-tags --json` (`VIEW` в `update.ts`, `--fetch-timeout=5000`)
  с реестром и сертификатами из npmrc; `newestVersion` выбирает версию по каналу; `disabled()`
  выключает проверку в `CI`, с `NO_UPDATE_NOTIFIER` и в Docker-образе. `dispatch.ts` для всех
  команд, кроме `update` и `feedback`, печатает уведомление по кэшу прошлой проверки и запускает
  фоновый `startUpdateCheck`.
- Java (`core/render/jre.ts`): `detectSystemJava` и `cachedJava` только смотрят; `resolveJava` —
  система → кэш → **скачивание** Temurin из Adoptium. `c4builder check` берёт Java через
  `resolveJava` и пишет его лог в stdout, то есть на машине без Java скачивает JRE.
- `c4builder check` проверяет файлы движками сборки без `.c4builder`.
- `engines.node` пакета — `>=22.17`. `compareVersions` (`update.ts`) сравнивает строки версий
  численно по частям (`22.9.0` < `22.17` < `22.17.0`), диапазоны не разбирает.
- `site -w` отдаёт `GET /__livereload` с `Content-Type: text/event-stream`; без `-w` маршрута нет.
- Разводка команд в `dispatch.ts`: `skills` и другие самостоятельные команды — до `opts[cmd] = true`
  и до проверки «нет терминала и нет `.c4builder`» (выход 1).
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
`<group>.<rest>`: имя группы и один или несколько сегментов через точку, латиница в нижнем
регистре (`env.node`, `env.java`, `skills.claude.project`, `skills.session`, `runtime.port`); id не
меняются между версиями — на них опираются агенты и `--json`. Статусы: `ok`, `warn`, `error`,
`skipped` (проверка не применима или не выполнена: нет сети, нет `.d2` в проекте, CLI не может
это знать). `fix` — одна команда или ссылка: у `error` — всегда; у `warn` — когда есть действие;
информационный `warn` (скилл плагина Claude Code дублирует проектный: удалять плагин целиком
может быть нельзя — в нём другие скиллы) — без `fix`. Команды, меняющие файлы проекта или
удаляющие личные копии, — с пометкой `(ask the user first)`, как в уведомлениях.

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

`--json` — один объект в stdout, ничего больше, в том числе с `--full` (D7). `details` —
подробности (хвост лога пробной сборки и т. п.): при `error` и с `-v`.

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
    },
    {
      "id": "skills.claude.plugins",
      "status": "warn",
      "message": "plugin c4builder@<marketplace>: c4builder-review differs from this package and duplicates the project skill"
    },
    { "id": "skills.session", "status": "skipped", "message": "what the agent session loaded is not visible to the CLI" }
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
- Последняя строка группы — всегда проверка `skills.session` со статусом `skipped` (`–`) «what the
  agent session loaded is not visible to the CLI».

Логика «действующей копии» берётся из `skillsNotice` (выносится в общую функцию), а не пишется
заново: строка при сборке и doctor не должны расходиться.

### D5. Среда

| id | `ok` | `warn` / `error` | `skipped` |
|---|---|---|---|
| `env.node` | версия ≥ нижней границы `engines.node` | `error` — ниже, fix: обновить Node.js | `engines.node` не вида `>=X[.Y[.Z]]` |
| `env.cli` | версия и канал (`rc` — пререлиз, иначе `latest`) | — | — |
| `env.update` | новее нет | `warn` — есть новее, fix `c4builder update` | `--offline`, реестр не ответил |
| `env.install` | способ установки: глобальный npm, зависимость проекта, Docker (`C4BUILDER_DOCKER`) | `warn` — несколько `c4builder` в `PATH` (пути — с `-v`) | — |
| `env.java` | системная ≥ 17 или JRE в кэше | `warn` — нет ни той, ни другой, fix `c4builder jre install` | — |
| `env.d2` | движок D2 загружается | `error` — не загружается | в проекте нет `.d2` |
| `env.fonts` | встроенный шрифт | `warn` — `useSystemFonts: true` в `.c4builder` (рендер не детерминирован), fix: убрать ключ (ask the user first) | — |
| `env.proxy` | заданы ли `HTTPS_PROXY`, `HTTP_PROXY`, `NODE_EXTRA_CA_CERTS` — только факт | `warn` — `NODE_EXTRA_CA_CERTS` указывает на несуществующий файл (путь — с `-v`) | — |

Нижняя граница Node — из `engines.node` регуляркой `^>=\s*(\d+(?:\.\d+)*)$`, сравнение —
`compareVersions(process.versions.node, bound) >= 0`. Другая форма диапазона — `skipped`; тест
закрепляет, что `engines.node` пакета под регулярку подходит. semver-парсер не тащим.

Java — только `detectSystemJava` и `cachedJava`, **никогда** `resolveJava`: doctor не скачивает
JRE (только чтение, `--offline`, бюджет времени).

### D6. Сеть
Проверка новой версии (`env.update`) — по умолчанию, свой синхронный `npm view` с аргументами
`VIEW`, но `--fetch-timeout=3000`, процесс снимается через 3 с. Нет ответа — `skipped` «registry
not reachable», не ошибка. `--offline` — ни одного сетевого запроса. `disabled()` doctor не
выключает: его запускают явно.

Фоновая проверка `dispatch.ts` и уведомление по её кэшу для `doctor` не запускаются (как для
`update` и `feedback`): doctor сам сообщает о новой версии, а фоновый `npm view` с таймаутом 5 с
ходил бы в сеть и при `--offline`.

### D7. Пробный рендер
По умолчанию — крошечная PlantUML-диаграмма с C4 stdlib движком сборки (~1–2 с); Java — из
`env.java` (D5), передаётся в рендер явно, не через `getJava`/`resolveJava` команды `check`. Нет
Java — `render.plantuml` `skipped` с fix `c4builder jre install`, ничего не скачивается. D2 и
Mermaid Java не нужна — только если такие файлы есть в проекте.

`--full` — проект `--new --name doctor -y` во временном каталоге и его сборка, как шаг «Smoke
build» скилла `c4builder-setup`:
- сборка — дочерним процессом (`process.execPath` и точка входа CLI) с `NO_UPDATE_NOTIFIER=1`;
  его stdout и stderr перехватываются: в тексте видны только с `-v` или при ошибке, в `--json` —
  только хвост в `details` проверки `render.full`; stdout doctor остаётся одним JSON-объектом;
- без системной Java и JRE в кэше — `render.full` `skipped` с fix `c4builder jre install`:
  дочерняя сборка иначе скачала бы JRE;
- временный каталог удаляется в `finally` — и при ошибке сборки, и по таймауту.

### D8. Проект и запуск
`project.config` — `.c4builder` найден и проходит `parseConfig`; `project.complete` — сборка
пройдёт без мастера; `project.paths` — каталоги исходников и пути плагинов (например, store
`openspec`) существуют. Вне проекта — `skipped` с подсказкой `c4builder --new`.
`runtime.port` — `webPort` (или `-p`) на `127.0.0.1`:
- соединение отклонено — `ok` «port N free»;
- `GET /__livereload` за 1 с отвечает `Content-Type: text/event-stream` — `ok` «site -w is
  running», соединение сразу закрывается;
- иначе — `warn` «port N is in use by another process», fix `-p <port>`. `c4builder site` без
  `-w` маршрута нет, он тоже попадёт сюда — приемлемо до `status`.

Когда появится `c4builder status` и файл состояния сервера (#64), проверка сначала берёт данные
оттуда. `runtime.agent` — какой агент определён и включён ли агентский режим.
Предупреждение о watcher (#53) не делаем: к релизу doctor #53 должен быть исправлен.

### D9. Безопасный вывод
Без `-v`: домашний каталог — `~`, абсолютные пути внутри проекта — относительные, значения
переменных окружения не печатаются ни в тексте, ни в JSON. `-v` добавляет абсолютные пути и
подробности (путь к java, файлы, не совпавшие по хэшу). Шаблон issue на GitHub просит вывод
`c4builder doctor` без `-v`.

### D10. Быстро
Проверки групп — параллельно; цель — < 3 с без `--full` и с ответом реестра. Разводится в
`dispatch.ts` рядом со `skills` — до `opts[cmd] = true`, до проверки «нет терминала и нет
`.c4builder`» и до `Configstore`: иначе вне проекта без терминала (CI, агент) doctor выходил бы с
кодом 1, не начав проверок, а конструктор `Configstore` создал бы `.c4builder`. Из блока фоновой
проверки версии `doctor` исключается (D6).

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
