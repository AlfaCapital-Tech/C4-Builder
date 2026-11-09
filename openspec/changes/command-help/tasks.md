# Tasks

## 1. Модуль справки

- [x] 1.1 Экспортировать список расширений из `src/cli/commands/check.ts` и имена групп из `src/cli/commands/doctor.ts`; проверка — `npm run build` без ошибок типов
- [x] 1.2 Создать `src/cli/help.ts`: таблица `CommandHelp` по всем командам (`site`, `check`, `jre`, `new`, `config`, `list`, `reset`, `docs`, `update`, `feedback`, `skills`, `doctor`, `help`) по распределению опций и кодам возврата из design D3; рендер общей справки и справки команды простым текстом по опциям commander; проверка — `npm run build`
- [x] 1.3 Переименовать `src/cli/commands/help.ts` → `docs.ts` (`cmdDocs`); проверка — `c4builder --docs` печатает прежний текст

- [x] 1.4 По ревью: таблицы `EXIT` в модулях `check`, `jre`, `feedback`, `doctor`, `status`, `update` (тип `ExitCodes` в `util/exit.ts`); команды выходят их кодами, `help.ts` печатает их же; команда `status` — в `COMMAND_HELP`; проверка — `npm run build`, `grep -n 'process.exit(1)' src/cli/commands/*.ts` без кодов, описанных в справке

## 2. Диспетчер

- [x] 2.1 В `src/cli/dispatch.ts`: `helpOption(false)` + опция `-h, --help`, описания опций без префиксов «for `x`:», `COMMANDS` из таблицы справки, позиционные `list`, `reset`, `docs`, `help`; справка печатается после проверки неизвестной команды и до уведомления о версии, Configstore и проверки TTY; проверка — `node dist/index.js check --help`, `help jre`, `jre install --help`, `serve --help` вручную в пустом каталоге: ожидаемый вывод и коды, каталог пуст

## 3. Тесты

- [x] 3.1 `test/cli-commands.test.mjs`: общая справка (команды и глобальные опции есть; `--wait`, `--as`, `--force`, `--name`, `--open-change`, `--json` и алиасы `--site`/`--new`/`--config`/`--list`/`--reset`/`--docs` — нет); справка каждой команды через `--help`, `-h` и `help <cmd>` — код 0, `Usage: c4builder <cmd>`, каталог пуст; `check`/`feedback`/`doctor` — форматы и коды возврата; `check bad.puml --help` не проверяет файл; `serve --help` и `help serve` — код 1; `list`/`docs` позиционно; проверка — `npx vitest run test/cli-commands.test.mjs` зелёный
- [x] 3.2 Тест полноты: каждая опция commander, кроме флаговых алиасов, встречается в общей справке или справке хотя бы одной команды; проверка — тест зелёный и падает, если убрать опцию из таблицы
- [x] 3.3 `test/skills.test.mjs`: известные флаги — из общей справки и справок всех команд, список команд дополнить `list`, `reset`, `docs`, `help`; проверка — `npx vitest run test/skills.test.mjs` зелёный
- [x] 3.4 Прогнать `npm run check` и `npm run test:unit`; проверка — оба зелёные (включая `cli-language`)

## 4. Актуализация

- [x] 4.1 Страница «CLI и конфигурация» (`docs/ru/src/05 CLI и конфигурация`, `docs/en/src/05 CLI and configuration`): команды в позиционной форме, флаговые алиасы — одной строкой примечания, таблица флагов разделена на глобальные и опции команд, описание `<command> --help` и `help`; проверка — тест `docs-parity` зелёный
- [x] 4.2 Остальные страницы сайта RU/EN, `skills/*` (включая `references/`) и `template/AGENTS.md`: `--site` → `site`, `--new` → `new`, `--config` → `config`, `--list`/`--reset`/`--docs` → позиционные; упомянуть `c4builder <command> --help` в основном скилле и AGENTS.md; README — только если quickstart использует флаговые формы; проверка — `grep -rn "c4builder --\(site\|new\|config\|list\|reset\|docs\)" docs/*/src skills template README.md` пуст, тест `skills` зелёный
- [x] 4.3 Строка в `## Unreleased` `CHANGELOG.md`; проверка — строка есть

## Workflow follow-up

- После ревью — `/opsx:archive command-help` отдельным коммитом.
