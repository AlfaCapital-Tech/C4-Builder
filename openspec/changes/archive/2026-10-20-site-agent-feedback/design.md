# Design

## Context

- Dev-сервер `src/cli/commands/site.ts` — express на `127.0.0.1`, порт фиксирован (`-p` / `webPort`;
  занят — ошибка, а не другой порт). В `-w` каждую HTML-страницу пропускает через `inject()`, у
  страницы уже есть один `EventSource` на `/__livereload` (событие `reload`).
- site-comments (`site.comments.ts`, `core/questions.ts`): инлайн-сниппет выделения, подсветка цитат
  (`textIndex`/`wrapRange`), `POST/DELETE /__c4builder/comments` с белым списком `Host` и проверкой
  `Origin` (`resolveTarget`), карта «страница → исходники» `pages()` из последней сборки.
- `src/cli/dispatch.ts`: позиционные подкоманды из `COMMANDS`; `check`/`jre`/`update` выполняются до
  Configstore, который создаёт `.c4builder` в каталоге; уведомление о новой версии печатается в stderr
  на выходе.
- Доставка в Claude Code (исследование 20.10): Bash `run_in_background` будит агента по завершении
  процесса, срока жизни нет; `Monitor` живёт ≤ 30 мин, выключен при `DISABLE_TELEMETRY` /
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, WebSocket на приватные адреса не открывает; Channels —
  research preview с dev-флагом запуска. `CLAUDECODE=1` документирован для подпроцессов Bash.
- Прецедент plannotator: `plannotator annotate --gate` блокирует до решения и печатает feedback в stdout,
  агент определяется по `PLANNOTATOR_ORIGIN` → `CODEX_THREAD_ID`/`GEMINI_CLI`/`OPENCODE`/`COPILOT_CLI`;
  сервер — Host allowlist + проверка Origin.

## Goals / Non-Goals

**Goals:**
- Не зависеть от `Monitor` и Channels: одна блокирующая команда работает в любом агенте, умеющем
  запускать shell-команды (в Claude Code — в фоне).
- Ни одной новой зависимости и ни одного нового постоянного соединения у страницы.
- Путь вопроса людям (site-comments) не меняется, кроме подписей кнопок.

**Non-Goals:**
- Ответ агента обратно в браузер (треды, тосты от агента) — его реакция видна по livereload.
- Хранение очереди между рестартами `site -w`; маршрутизация пачек между несколькими агентами.
- MCP / Channels / WebSocket-транспорт.

## Decisions

### D1. Доставка — long-poll и одноразовая команда

`GET /__c4builder/feedback/next` держит запрос до 25 с: есть пачка — `200 text/markdown`, нет — `204`.
`c4builder feedback --wait` повторяет запрос на `204` и завершается на первом `200`; без `--wait` —
один запрос с `?wait=0`, сервер отвечает сразу.

Альтернативы: поток в stdout `site -w` под `Monitor` — шум сборки, разрывы при переподключении
монитора каждые ≤ 30 мин и зависимость от телеметрийных флагов; WebSocket — новая зависимость, а
`Monitor` к localhost по ws не ходит; Channels — preview. 25 с, а не бесконечное ожидание: окно
меньше таймаутов `fetch`/прокси (300 с у undici) и служит пульсом присутствия (D4).

### D2. Определение агентского режима

Одна чистая функция `detectAgent(env, flags)` → `{ on, name, explicit }`, порядок как у plannotator:
1. `--no-agent` / `--agent` (commander, пара флагов, по умолчанию `undefined`);
2. `C4BUILDER_AGENT`: `0` — выкл, иное непустое — вкл, значение — имя;
3. переменные агентов: `CLAUDECODE` → `claude-code`, `CODEX_THREAD_ID` → `codex`, `GEMINI_CLI` →
   `gemini-cli`, `OPENCODE` → `opencode`, `COPILOT_CLI` → `copilot-cli`, `AI_AGENT` → его значение.

Без явного выключения первый запрос `feedback/next` включает режим на лету (человек поднял сервер,
агент подключился). Подсказка в stdout печатается при старте, если режим включён флагом или
окружением: `agent mode (<name>): page feedback goes to "c4builder feedback --wait" — run it in the
background and again after each batch`. Явно выключенный режим: оба эндпоинта `404`.

### D3. Очередь

FIFO пачек в памяти: `{ id, decision, comments[], general }`. `POST /__c4builder/feedback` принимает
пачку от страницы, сразу отдаёт ожидающему long-poll'у или ставит в очередь и отвечает
`{ id, queued }`. Пачка снимается с очереди, когда ответ команде записан (`finish`); обрыв до этого —
пачка возвращается в голову очереди. Так пачка выдаётся не более одного раза и не теряется при
обрыве ожидания; потеря возможна только если команда умерла после получения, до печати.

Несколько ожидающих — пачку получает самый ранний запрос, остальные ждут дальше.

### D4. Состояние слушателя и доставка — через существующий SSE

Слушатель считается подключённым, пока открыт long-poll или с последнего прошло < 30 с (зазор между
повторами). На тот же `/__livereload` сервер шлёт события `agent` (`{ on, listening }`, также сразу при
подключении) и `delivered` (`{ id }`). Второй `EventSource` не нужен; без `-w` событий нет, как и
livereload.

### D5. Черновики review — в localStorage страницы

Ключ `__c4builderReview:<projectKey>`, `projectKey` — короткий хеш `cwd`, сервер вставляет его в
сниппет: страницы разных проектов на одном `localhost:<port>` не смешиваются. Элемент —
`{ id, page, quote, section, comment }`; `storage`-событие синхронизирует вкладки. Чтение и запись — в
`try/catch`, без хранилища черновик живёт до перезагрузки. Альтернатива — черновик на сервере:
лишнее состояние и API, а пережить livereload и закрытие вкладки и так нужно браузеру.

### D6. Эндпоинты и защита

- `POST /__c4builder/feedback` — от страницы: `Host` из белого списка + `Origin` (общий код с
  `resolveTarget`), тело `{ decision, comments[], general? }`: замечание ≤ 2000 символов, цитата
  обрезается до 2000 с `…` (она лишь ориентир — длинное выделение не должно валить review), не
  больше 200 замечаний, `decision` ∈ `submitted|approved`. Неизвестная странице карта `pages()` — не
  ошибка: в пачке остаются страница и цитата, исходники пустые.
- `GET /__c4builder/feedback/next` — от команды: `Host` из белого списка, **без** `Origin`, с заголовком
  `X-C4builder-Feedback: 1`. Нестандартный заголовок заставляет браузер слать preflight, на который
  сервер не отвечает, — чужая страница не может ни прочитать, ни «съесть» очередь простым запросом.
  Иначе `403`, очередь не трогается.
- Команда ходит на `127.0.0.1`, не `localhost`: сервер слушает только IPv4, а резолв `localhost` в `::1`
  на части машин подвешивает соединение.

### D7. Формат пачки

Собирает сервер — у него карта исходников. Markdown на английском:

```
# Page feedback (c4builder)

Decision: submitted
Comments: 2 on 2 pages

## 1. Arch/Flow/Flow.md (§ Flow)
Sources: src/Arch/Flow/README.md
Quote: "foo bar"

> Rename to baz

## 2. Arch/Arch.md
Sources: src/Arch/README.md
Quote: "deploy step"

> Explain why it is manual

## General

> Keep the tone
```

Пустая пачка `approved` — заголовок, `Decision: approved`, `Comments: 0`. Многострочный текст —
каждая строка с `> `.

### D8. UI — вариант B

```
 selection:  [Feedback] [Question]          (без агентского режима — только [Question])

+------------------------------------------------+   +---------------------------------------------+
| "foo bar"                                      |   | Review: 3 pending (2 pages)  agent: *       |
| [textarea                                    ] |   |           [Discard] [Approve] [Submit review]|
| agent: listening *  [Add to review] [Send now] |   +---------------------------------------------+
+------------------------------------------------+     клик по счётчику — список замечаний с «×»
```

- Код — в том же сниппете `site.comments.ts`: переиспользует выделение, `textIndex`/`wrapRange`,
  тосты. Начальное состояние режима и `projectKey` вставляет сервер, дальше его обновляет SSE `agent`.
- Основная кнопка (и `Ctrl/⌘+Enter`) — **Send now**, пока review пуст, и **Add to review**, когда в
  нём есть замечания: как в merge request GitLab после начала review.
- Черновые цитаты подсвечиваются отдельным классом (синим), вопросы — как прежде (жёлтым).
- **Submit review** раскрывает поле общего комментария и отправляет; **Approve** отправляет
  `approved` вместе с черновиком; **Discard** спрашивает подтверждение только при непустом черновике.
- Тосты: `Queued — agent is not listening` / `Delivered to the agent` (по SSE `delivered`) / ошибка.
- Подписи site-comments: «Comment» → **Question**, «Add» → **Add question**.

### D9. Команда `feedback`

Обрабатывается в `dispatch` до Configstore, как `check`/`update`: порт — `-p` или `webPort` из
`.c4builder`, прочитанного как JSON без записи (нет файла — дефолт). Пачку печатает в stdout как есть.
Отказ соединения — `no c4builder site -w on http://localhost:<port> — start it first` и код 1; `404` —
`agent feedback is disabled on this server (--no-agent)` и код 1. Уведомление о новой версии для
`feedback` не печатается, как для `update`: вывод читает агент.

## Risks / Trade-offs

- [Агент не перезапустил `feedback --wait`] → правило в скилле и `AGENTS.md`, подсказка при старте,
  индикатор `agent: o` на странице; пачки ждут в очереди.
- [Рестарт `site -w` теряет недоставленные пачки] → черновики review живут в браузере; страница
  показывает «в очереди», пока не придёт `delivered`.
- [`CLAUDECODE` есть и у команд, которые человек запускает через `!` в Claude Code] → режим включится
  без слушателя: безвредно (индикатор `o`), выключается `--no-agent`.
- [Смерть команды после получения пачки, до печати] → пачка потеряна; окно — миллисекунды, принято.
- [Порт занят другим проектом] → команда ходит к чужому серверу; проекты различаются `projectKey`
  только у черновиков. Принято: один `site -w` на порт уже требование.

## Open Questions

- Окно long-poll 25 с и пульс присутствия 30 с — подобрать по ручной проверке, на спеку не влияют.
