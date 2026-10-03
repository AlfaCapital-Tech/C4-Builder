# Tasks

## 1. `check`: `.iuml` с C4 и английский вывод

- [x] 1.1 Тест сначала (`test/check.test.mjs`): фикстура `c4-styles.iuml` (`skinparam` + `UpdateElementStyle("person", $bgColor="#000")`) → `✓`, код 0; ожидание `строка 3` → `line 3`; `неизвестное расширение` → `unsupported extension`; без аргументов — stdout содержит `usage: c4builder check`. Проверка: `npm run build && npx vitest run test/check.test.mjs` — новые ожидания красные на текущем коде.
- [x] 1.2 `src/cli/commands/check.ts` по design §1–2: для `.iuml` при ошибке движка повтор с обёрткой `!include <C4/C4_Dynamic>` + `!include <C4/C4_Deployment>` перед файлом, ошибка — от повтора; сообщения `line N`, `usage: …`, `unsupported extension (…)`; комментарий про повтор — почему (контекст C4 задаёт потребитель). Проверка: `npx vitest run test/check.test.mjs` зелёный, включая существующий кейс `bad.iuml` → `Error in function definition`; `node dist/index.js check template/src/styles.iuml` → `✓`, код 0.

## 2. Справочные команды без побочных эффектов

- [x] 2.1 Тест сначала (`test/cli-commands.test.mjs`): в пустом temp-каталоге `--docs` → код 0, каталог пуст; `--list` и `--reset` → код ≠ 0, stderr содержит `no .c4builder`, каталог пуст; в каталоге проекта (`new --name demo -y`, затем `cd demo`) `--list` → код 0 и печатает `projectName`. Проверка: новые кейсы красные на текущем коде.
- [x] 2.2 `src/cli/dispatch.ts` по design §3: `if (opts.docs) return cmdHelp();` до создания `Configstore`; для `--list`/`--reset` без файла `configPath` — сообщение в stderr и `process.exit(1)` до `Configstore`. Проверка: `npx vitest run test/cli-commands.test.mjs` зелёный; ручной прогон в `mktemp -d`: `node dist/index.js --docs; ls -A` — пусто.

## 3. CHANGELOG

- [ ] 3.1 В `CHANGELOG.md` заменить `(see [Docker](#docker))` и `(see «Plugins»)` на относительные ссылки `docs/en/src/07%20Docker%20and%20CI/README.md` и `docs/en/src/06%20Plugins/README.md` (design §4). Проверка: `grep -n '](#\|see «' CHANGELOG.md` пусто; оба целевых файла существуют.

## 4. Актуализация

- [ ] 4.1 Сайт RU/EN, страница «03 Диаграммы» / «03 Diagrams»: пример вывода `строка 4` → `line 4`, убрать абзац «`.iuml` с макросами C4 отдельно не проходит» (заменить: `.iuml` с макросами C4 проверяется в контексте C4-stdlib), в pre-commit-хук вернуть `'*.iuml'`; в EN убрать пояснения «`строка` means "line"» / «messages are printed in Russian». Страница «08 Агенты» / «08 Agents»: пример вывода и пояснение про `строка`. Страница «05 CLI и конфигурация» / «05 CLI and configuration»: у `--list`/`--reset` — «в каталоге проекта; вне проекта — ошибка». Проверка: `grep -rn 'строка [0-9N<]' docs/*/src` пусто; сборка docs/ru и docs/en → код 0; `npx vitest run test/docs-parity.test.mjs` зелёный.
- [ ] 4.2 `skills/c4builder/SKILL.md` (шаг check: формат `✗ <file>: line <N>: <message>`, убрать пояснение про `строка` и совет не проверять `.iuml` отдельно) и `template/AGENTS.md` (формат ошибки, `.iuml` можно проверять напрямую). Проверка: `grep -rn 'строка' skills template/AGENTS.md` пусто; `npx vitest run test/skills.test.mjs` зелёный.
- [ ] 4.3 `README.MD` строка 52: `"✗ file: line N: message"`. Проверка: `grep -n 'строка' README.MD` пусто.
- [ ] 4.4 `CHANGELOG.md`, `## Unreleased`: `check` печатает `line N` и английские сообщения (смена формата вывода); `.iuml` с макросами C4 проходит `check`; `--docs` не создаёт файлов, `--list`/`--reset` вне проекта — ошибка без создания `.c4builder`. Проверка: ревью глазами.
- [ ] 4.5 Полный прогон: `npm run build`, `npm test`, `npm run check`, `openspec validate cli-fixes --strict` — всё зелёное.
