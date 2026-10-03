# Tasks

## 1. Граница Node

- [x] 1.1 `package.json` `engines.node` → `">=22.17"`, `npm install --package-lock-only` обновляет корневой `engines` в `package-lock.json`. Проверка: `node -p "require('./package.json').engines.node"` печатает `>=22.17`; `npm ci && npm run build && npm run test:unit` зелёные
- [ ] 1.2 Тексты в репозитории: README.MD (требования к Node, если упоминаются после переписывания в `docs-site`), `CLAUDE.md` (строка стека), комментарий в `Dockerfile` (EOL Node 20 — оставить как обоснование мажора, без противоречия новой границе); строка в `CHANGELOG.md` (`## Unreleased`) с пометкой **BREAKING**. Проверка: `grep -rn "20\.19" --exclude-dir=node_modules --exclude-dir=.claude --exclude-dir=archive .` не находит упоминаний вне `openspec/specs/dev-toolchain` (обновится при архиве) и исторических записей changelog о прошлых версиях (их не переписываем)

## 2. `fs.globSync` вместо `src/util/glob.ts`

- [x] 2.1 `src/plugins/openapi/index.ts`: оба вызова `globFiles` заменить на `fs.globSync(pattern, { cwd: root, exclude })` по design §2–3 (функция `exclude` — `.git`, `node_modules`, абсолютные `outputDirs`; пути → posix, `.sort()`). Проверка: `npm run build`; существующие тесты плагина `openapi` зелёные
- [x] 2.2 Удалить `src/util/glob.ts`, экспорт из `test/dist.mjs` и юнит-тесты `globFiles`/`globToRegExp` в `test/plugins-source.test.mjs`; при отсутствии в тестах плагина `openapi` кейса «выходной каталог внутри источника (`dir: '.'`) не считается источником» — добавить его. Проверка: `grep -rn "util/glob\|globFiles\|globToRegExp" src test` пусто; `npm run test:unit` зелёный; новый кейс падает, если убрать `outputDirs` из `exclude`
- [x] 2.3 Строка в `CHANGELOG.md`: спеки `openapi` в каталогах, начинающихся с точки, больше не находятся (design, риски). Проверка: ревью глазами

## 3. Актуализация

- [ ] 3.1 Заменить «20.19» на «22.17» в `skills/c4builder-setup/SKILL.md` (проверка `node --version`) и `template/AGENTS.md` (строка установки) — оба вмержены с `agent-skills`; а также в страницах сайта `docs/ru` и `docs/en` (быстрый старт, установка) с одинаковой правкой в обоих языках. Проверка: grep из 1.2 по всему репозиторию пуст; `npx vitest run test/skills.test.mjs` и проверка паритета RU/EN из `docs-site` зелёные
- [ ] 3.2 Интеграция: `npm test` и `npm run check` зелёные на Node 22.17 (локально через `npx -p node@22.17 node …` или nvm) и на Node 24 (CI-матрица). Проверка: CI зелёный, в выводе сборки шаблона нет `ExperimentalWarning`
