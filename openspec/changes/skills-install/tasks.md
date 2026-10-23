# Tasks

## 1. Скиллы в пакете и команда `skills`

- [ ] 1.1 `package.json`: `skills/` в `files`. `test/skills.test.mjs`: сценарий «Скиллы не входят в npm-пакет» заменить на «входят» (`npm pack --dry-run --json` содержит `SKILL.md` и `references/` каждого скилла). Проверка: `npx vitest run test/skills.test.mjs` зелёный.
- [ ] 1.2 `src/cli/commands/skills.ts`: установка в целевой каталог по design D2 (замена каталога каждого скилла пакета целиком, `metadata.generatedBy`, `.agents` всегда, `.claude` под `CLAUDECODE` или при существующем `./.claude/`), вывод путей; предупреждение о личной копии `~/.claude/skills/c4builder` без версии или старше CLI (D3–D4). `dispatch.ts`: `skills` в `COMMANDS` и разводка до `Configstore`. Проверка: тесты 1.3.
- [ ] 1.3 `test/cli-skills.test.mjs` по требованиям «Команда установки скиллов», «Установка заменяет скиллы пакета целиком», «Отметка версии в установленном скилле», «Предупреждение о личной копии» и сценарию «Команда skills вне проекта»: из терминала — только `.agents`, отметка равна `--version`, нет `.c4builder`; с `CLAUDECODE=1` — оба каталога; повтор удаляет лишний файл и не трогает чужой скилл; личная копия без версии (`HOME` во временном каталоге) — предупреждение в stderr, копия не изменена. `COMMANDS` в `test/skills.test.mjs` дополнить `skills`. Проверка: `npx vitest run test/cli-skills.test.mjs test/skills.test.mjs test/cli-commands.test.mjs` зелёный.

## 2. Уведомление под агентом и `--new`

- [ ] 2.1 Проверка действующей копии (D3–D4) и строка при старте сборки и `site` (D5) в `dispatch.ts`; под `disabled()` из `update.ts` и без агента — молчит. Проверка: тесты 2.3.
- [ ] 2.2 `commands/new.ts`: после копии шаблона — установка скиллов в каталог проекта той же функцией (D6). Проверка: тесты 2.3.
- [ ] 2.3 Тесты в `test/cli-skills.test.mjs` по требованиям «Уведомление о скиллах под агентом», «Действующая копия скилла», «Когда уведомление о скиллах не печатается» и «Новый проект получает скиллы»: нет скиллов — строка, stdout и код выхода как без неё; после `c4builder skills` — строки нет; отметка старше — строка с версиями при старте `site -w`; личная копия без версии — строка с путём; Codex при скиллах только в `.claude` — строка; скиллы в корне git, сборка в подкаталоге — строки нет; без агента, с `CI=true`, у `check` — строки нет; `--new --name demo -y` с `CLAUDECODE=1` — скиллы в обоих каталогах, в каталоге выходов сборки их нет. Проверка: `npx vitest run test/cli-skills.test.mjs` зелёный, `test/cli-language.test.mjs` зелёный (новые строки на английском).

## 3. Скиллы

- [ ] 3.1 `skills/c4builder-review/SKILL.md` по D7 (английский, вызов `/c4builder-review [change-id|page]`, без внутренних адресов и названий). Тест «набор скиллов — ровно поставляемый» — три скилла. Проверка: `npx vitest run test/skills.test.mjs` зелёный.
- [ ] 3.2 `skills/c4builder/SKILL.md`: цикл замечаний — коротко со ссылкой на `c4builder-review`; раздел «Skills notice» по образцу «New version notice» (три строки из D5, сообщить пользователю, `c4builder skills` и удаление личной копии — только с согласия); `description` без дублирования триггеров ревью. Проверка: тест `skills` зелёный.
- [ ] 3.3 `skills/c4builder-setup/SKILL.md`: зеркало реестра — через `--registry`/npmrc пользователя без адресов; последний шаг — `c4builder skills` в рабочем проекте; в отчёте — скиллы. Проверка: тест `skills` зелёный.

## 4. Актуализация

- [ ] 4.1 `template/AGENTS.md`: раздел «Agent skills» — `c4builder skills` (новый проект уже получает их через `--new`), `npx skills add` — альтернатива. Проверка: тест `skills` зелёный.
- [ ] 4.2 Страницы «08 Агенты» (RU/EN): раздел скиллов — `c4builder skills`, каталоги `.agents`/`.claude`, отметка версии, уведомление под агентом и личная копия, три скилла в таблице, `npx skills add` — альтернатива для личной установки и других агентов; цикл замечаний — упоминание `/c4builder-review`. «05 CLI и конфигурация» (RU/EN): подкоманда `skills`. README — только если там команда установки скиллов. Проверка: тест `docs-parity` зелёный.
- [ ] 4.3 CHANGELOG `## Unreleased`: скиллы в пакете, `c4builder skills`, уведомление под агентом, скиллы в `--new`, скилл `c4builder-review`. Проверка: `npm test` и `npm run check` зелёные.
- [ ] 4.4 Публичность: `grep -rniE "alfacapital\.ru|artifactory|harbor" openspec/changes/skills-install skills template docs/ru/src docs/en/src README.MD CHANGELOG.md` — пусто. Проверка: вывод команды пуст.
