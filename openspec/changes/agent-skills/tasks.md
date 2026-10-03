# Tasks

## 0. CLI: позиционные `new` и `config`

- [x] 0.1 `src/cli/dispatch.ts` по design §7: `new` → `opts.new`, `config` → `opts.config`; первый позиционный аргумент вне `check|jre|site|new|config` → `unknown command: <x>` со списком команд в stderr, код 1, без сборки и без промптов. Проверка: тест `test/cli-commands.test.mjs` (spawn `node dist/index.js`) — `new --name demo -y` в temp-каталоге создаёт проект как `--new`; `nwe` → код 1 и сообщение; `check`/`jre info`/`site` не затронуты (существующие тесты зелёные)
- [x] 0.2 README: строки 57/125 (`c4builder new`, `c4builder config`) теперь корректны — сверить, добавить `new`/`config` в описание команд; строка changelog `## Unreleased`. Проверка: ревью глазами

## 1. Скилл `c4builder-setup` и проверка скиллов

- [x] 1.1 Подготовить worktree: `npm ci && npm run build`; проверка — `node dist/index.js --help` печатает список опций
- [x] 1.2 Написать `skills/c4builder-setup/SKILL.md` на английском по design §3 (Node ≥ 20.19 → канал `latest`/`rc`, даунгрейд только с подтверждения → `npm i -g @alfacapital-tech/c4builder@<tag>` или Docker-образ `ghcr.io/alfacapital-tech/c4builder` → java / `c4builder jre install`, `c4builder jre info` → smoke `c4builder --new --name smoke -y` + `c4builder` во временном каталоге). Без внутренних хостов и `--registry`; проверка — файл существует, frontmatter `name: c4builder-setup`, описание говорит «что и когда»
- [x] 1.3 Добавить `test/skills.test.mjs` по design §4: разбор frontmatter `skills/*/SKILL.md` (правила `name`/`description` из спеки), извлечение флагов и подкоманды из строк `c4builder …` и сверка с `node dist/index.js --help` и списком `check|jre|site|new|config`, денайлист `alfacapital\.ru`; сообщения об ошибке называют файл и найденное значение. Проверка — `npx vitest run test/skills.test.mjs` зелёный; временная порча (`name: c4-builder-setup`, команда `c4builder serve`, адрес `x.alfacapital.ru`) даёт красный тест с понятным сообщением, после отката — снова зелёный
- [x] 1.4 README: раздел «Agent skills» (что это, `npx skills add AlfaCapital-Tech/C4-Builder/skills`, `--skill <name>`, список скиллов) и строка в changelog `## Unreleased` (создать секцию над `## v0.4.0`; если change `docs-site` уже вмержен — в `CHANGELOG.md`); проверка — команды раздела совпадают с командами в `SKILL.md` (ревью глазами)

## 2. Общий скилл `c4builder`

- [ ] 2.1 Написать `skills/c4builder/SKILL.md` (≤ ~200 строк, английский) по design §2: когда применять, раскладка проекта (`.c4builder`, `src/`, выходы), цикл правка → `c4builder check <file...>` → `c4builder --site -w` / `c4builder`, разбор ошибки `file: line N`, частые ошибки; ссылки на references с условием загрузки. Проверка — `test/skills.test.mjs` зелёный
- [ ] 2.2 Написать `skills/c4builder/references/config.md` (ключи `.c4builder` по `node dist/index.js --docs` и `src/config/schema.ts`, `plugins`), `references/diagrams.md` (C4-PlantUML stdlib `<C4/...>`, общий `.iuml`, кириллица, D2, офлайн-рендер, `useSystemFonts`), `references/plugins.md` (`openspec`, `openapi` — опции из README «Plugins»). Проверка — каждый ключ/опция, упомянутые в references, есть в `src/config/schema.ts` или схеме плагина (сверка grep'ом), тест зелёный
- [ ] 2.3 Расширить `test/skills.test.mjs`: входы — также `skills/*/references/*.md`; ожидаемый набор скиллов ровно `c4builder`, `c4builder-setup`. Проверка — тест зелёный; удаление одного каталога скилла даёт красный тест
- [ ] 2.4 Дополнить раздел README «Agent skills» описанием `c4builder` и строку changelog; проверка — ревью глазами

## 3. `AGENTS.md` в шаблоне

- [ ] 3.1 Написать `template/AGENTS.md` (английский, ~40 строк): `c4builder` (сборка), `c4builder check <file...>`, `c4builder --site -w`, исходники в `src/`, конвенции (stdlib `<C4/...>`, общий `styles.iuml`, офлайн), `npx skills add AlfaCapital-Tech/C4-Builder/skills`. Проверка — файл есть
- [ ] 3.2 Добавить `template/AGENTS.md` во входы `test/skills.test.mjs` (флаги, подкоманды, денайлист). Проверка — тест зелёный
- [ ] 3.3 Тест на шаблон (в `test/skills.test.mjs` или рядом): `node dist/index.js --new --name demo -y` во временном каталоге → `demo/AGENTS.md` существует; после сборки в `demo` (managed JRE, как в golden) в выходах нет `AGENTS.md`. Проверка — тест зелёный; `npm run test:golden` без изменений эталонов
- [ ] 3.4 README: упомянуть `AGENTS.md` в описании `--new` и строку changelog; проверка — ревью глазами

## 4. Интеграция

- [ ] 4.1 `npm test` и `npm run check` зелёные; `npm pack --dry-run` не содержит `skills/` и содержит `template/AGENTS.md`
- [ ] 4.2 Ручная проверка установки (нужна сеть): в пустом каталоге `npx skills add <путь к worktree>` (после мержа — `AlfaCapital-Tech/C4-Builder/skills`) находит оба скилла и ставит их в `.claude/skills/`; при отсутствии сети — отметить задачу как ожидающую мейнтейнера в отчёте
- [ ] 4.3 Зависит от change'а `llms-txt`: после его реализации добавить в `skills/c4builder/SKILL.md` (и `references/config.md`) упоминание `llms.txt`/`llms-full.txt` как точки входа для чтения архитектуры агентом; проверка — `test/skills.test.mjs` зелёный, ключ конфига совпадает с реализованным
