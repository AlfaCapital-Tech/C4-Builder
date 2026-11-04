# Tasks

## 1. Каркас команды

- [ ] 1.1 `src/cli/commands/doctor.ts`: модель проверки `{ id, status, message, fix?, askUser? }`, запуск групп параллельно, текстовый вывод (D3) и `--json`, коды возврата с `--strict` (D2), выбор групп и неизвестная группа — код 2 (D1). `dispatch.ts`: `doctor` в `COMMANDS`, разводка до `Configstore`, флаги `--json`, `-v`, `--strict`, `--full`, `--offline`. Проверка: тесты 1.2.
- [ ] 1.2 `test/cli-doctor.test.mjs` по требованиям «Команда диагностики», «Статусы проверок и исправления», «Коды возврата диагностики», «Машиночитаемый вывод диагностики» и сценарию «Команда doctor вне проекта»: пустой каталог — `project` skipped, каталог пуст; `doctor skils` — код 2; `--json --offline` — один JSON-объект, id вида `<group>.<name>`; `warn` → 0, с `--strict` → 1. `COMMANDS` в `test/skills.test.mjs` дополнить `doctor`. Проверка: `npx vitest run test/cli-doctor.test.mjs test/skills.test.mjs test/cli-commands.test.mjs` зелёный.

## 2. Скиллы

- [ ] 2.1 Вынести поиск действующей копии из `skillsNotice` в общую функцию `commands/skills.ts`; `skillsNotice` и doctor используют её (D4). Проверка: `npx vitest run test/cli-skills.test.mjs` зелёный без правок тестов.
- [ ] 2.2 Группа `skills` (D4): каталоги Claude Code, Codex и `.agents`; полнота набора; версия; SHA-256 против файлов пакета без блока `metadata.generatedBy`; перекрытие личной копией; кэш плагинов Claude Code — по возможности, ошибка обхода → `skipped`; последняя строка про сессию агента. Проверка: тесты 2.3.
- [ ] 2.3 Тесты по требованиям «Каталоги скиллов агента», «Состояние копии скилла», «Скиллы плагинов Claude Code» (`HOME` во временном каталоге, фикстура кэша плагинов текущей раскладки): актуальные — `ok`; дописанная строка — `warn` edited copy; личная копия без версии — `warn` с путём и `askUser`; Codex при скиллах только в `.claude` — нет скиллов; дубль в кэше плагинов — `warn`; битый кэш — `skipped`. Проверка: `npx vitest run test/cli-doctor.test.mjs` зелёный.

## 3. Среда, рендер, проект, запуск

- [ ] 3.1 Группа `env` (D5–D6): Node по `engines.node`, версия и канал, новая версия через `VIEW` с таймаутом 3 с (`--offline` → `skipped`, нет ответа → `skipped`), способ установки и несколько `c4builder` в `PATH`, Java через `resolveJava`/`cachedJava`, D2 при `.d2` в проекте, шрифт, факт `HTTPS_PROXY`/`NODE_EXTRA_CA_CERTS` без значений. `disabled()` не учитывать. Проверка: тесты 3.4.
- [ ] 3.2 Группа `render` (D7): крошечная PlantUML-диаграмма с `<C4/C4_Context>` путём `check`; D2/Mermaid при файлах в проекте; `--full` — `--new --name doctor -y` во временном каталоге, сборка, удаление каталога. Проверка: тесты 3.4.
- [ ] 3.3 Группы `project` и `runtime` (D8): `parseConfig`, полнота конфига, пути источников и плагинов; порт `webPort`/`-p` — свободен, отвечает `site -w`, занят чужим (`warn` с `-p <port>`); агент и агентский режим из `detectAgent`. Проверка: тесты 3.4.
- [ ] 3.4 Тесты по требованиям «Проверка среды», «Пробный рендер», «Проект и запуск», «Вывод диагностики безопасен для публикации»: `--offline` — нет запросов к реестру; `CI=true` — проверки выполняются; `render` — `ok`; `render --full` — временного каталога после выхода нет; занятый порт — `warn`; с `HTTPS_PROXY=http://user:secret@proxy:8080` вывод без `secret` и без абсолютного `HOME`. Проверка: `npx vitest run test/cli-doctor.test.mjs` зелёный, `test/cli-language.test.mjs` зелёный.

## 4. Уведомление и скиллы пакета

- [ ] 4.1 Строки уведомления о скиллах (`skillsNotice`) — хвост ` Details: c4builder doctor skills` (D11). Ожидания в `test/cli-skills.test.mjs` обновить. Проверка: `npx vitest run test/cli-skills.test.mjs` зелёный.
- [ ] 4.2 `skills/c4builder-setup/SKILL.md`: первый шаг — `c4builder doctor`, дальше — по его `fix`; функциональная проверка — `c4builder doctor render --full`; в отчёте — вывод doctor. `skills/c4builder/SKILL.md`, раздел «Skills notice»: подробности — `c4builder doctor skills`. Проверка: тест `skills` зелёный (флаги и подкоманды существуют).

## 5. Актуализация

- [ ] 5.1 `template/AGENTS.md`: строка про `c4builder doctor` (что-то не работает — сначала она). Проверка: тест `skills` зелёный.
- [ ] 5.2 Страницы «05 CLI и конфигурация» (RU/EN): подкоманда `doctor`, группы, флаги, коды возврата, пример вывода; «08 Агенты» (RU/EN): `doctor skills` в разделе скиллов. Проверка: тест `docs-parity` зелёный.
- [ ] 5.3 Новый `.github/ISSUE_TEMPLATE/bug.yml` (шаблонов issue в репозитории пока нет): поле для вывода `c4builder doctor` без `-v`. Проверка: форма открывается на GitHub при создании issue.
- [ ] 5.4 CHANGELOG `## Unreleased`: `c4builder doctor`, ссылка на него в уведомлении о скиллах, `c4builder-setup` начинается с doctor. Проверка: `npm test` и `npm run check` зелёные.
- [ ] 5.5 Публичность: `grep -rniE "alfacapital\.ru|artifactory|harbor" openspec/changes/cli-doctor skills template docs/ru/src docs/en/src CHANGELOG.md` — пусто. Проверка: вывод команды пуст.
