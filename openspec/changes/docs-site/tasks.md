# Tasks

## 1. Каркас: удаление старого docs/, проекты RU/EN, проверка паритета

- [x] 1.1 Удалить старый `docs/` целиком (`_coverpage.md`, `index.html`, `README.MD`, `images/`, `vendor/`). Проверка: `git ls-files docs/` пуст до добавления новых файлов.
- [x] 1.2 Создать `docs/ru/.c4builder` и `docs/en/.c4builder` по design D1/D2 (полный headless-конфиг, `distFolder: dist`, плагин `openspec` с `dir: ../../openspec` и mount «Журнал решений» / «Design log»), минимальный `src/README.md` в каждом. В `.gitignore` добавить `docs/*/dist*/`, `docs/*/.c4builder.cache`. Проверка: `npm run build && (cd docs/ru && node ../../dist/index.js)` и то же для `docs/en` завершаются с кодом 0 без вопросов, в `dist/` есть `index.html` и раздел журнала решений; `git status` не показывает dist/cache.
- [x] 1.3 Добавить `test/docs-parity.test.mjs` по design D5 (нормализация папок по числовому префиксу, имена `.md`/`.puml`/`.d2` как есть, папка без префикса — ошибка, сообщение со списком путей без пары). Проверка: `npx vitest run test/docs-parity.test.mjs` зелёный; временно добавленная папка `docs/ru/src/99 Тест` роняет тест с этим путём в сообщении (затем удалить).

## 2. Контент RU

- [ ] 2.1 Обзор (`docs/ru/src/README.md`): что такое C4-Builder, чем форк отличается от upstream (поддержка, локальный детерминированный рендер, `check`, плагины, агентская разработка), агентский цикл, благодарность upstream. Плюс `context.puml`: C4-контекст c4builder (разработчик/агент → c4builder → PlantUML/D2, docsify-сайт, markdown, OpenSpec-store, OpenAPI-контракты) через stdlib `!include <C4/...>`. Проверка: `node dist/index.js check docs/ru/src/context.puml` → 0; сборка RU → 0, диаграмма есть на странице.
- [ ] 2.2 Страницы `01 Быстрый старт` … `07 Docker и CI` по таблице design D6 из соответствующих разделов README, переведённые и актуализированные: без упоминаний PDF, vscode-plantuml, `C4Builder-Demo`, «Future plans»; локальный рендер как основной режим. Проверка: сборка RU → 0; `grep -rniE 'pdf|vscode|C4Builder-Demo|adrianvlupu' docs/ru/src` пусто.
- [ ] 2.3 Страница `08 Агенты` (базовая часть): цикл правка → `c4builder check` (exit-код, формат ошибки `✗ file: line N`) → `--site -w`, pre-commit-хук, офлайн-рендер как свойство для агентов. Без `llms.txt` и скиллов: они в группе 7. Проверка: сборка RU → 0.
- [ ] 2.4 Страница `09 Разработка`: сборка/тесты/golden, процесс OpenSpec (артефакты на русском, ссылка на раздел журнала решений), релизы rc/final из README «Releasing», правило `CHANGELOG.md`, `container.puml` с контейнерами c4builder (CLI, scan/compose/render, плагины, vendor). Проверка: `check` диаграммы → 0, сборка RU → 0.

## 3. Контент EN

- [ ] 3.1 Перевести все страницы и диаграммы группы 2 в `docs/en/src` с теми же числовыми префиксами и именами файлов; в корень EN добавить пометку, что раздел Design log на русском (design D2). Проверка: `npx vitest run test/docs-parity.test.mjs` зелёный; сборка EN → 0; `check` всех `.puml` EN → 0.

## 4. Лендинг

- [ ] 4.1 Создать `docs/landing/index.html` (RU), `docs/landing/en.html` (EN), `docs/landing/landing.css` по design D3: позиционирование, агентский цикл, quickstart (npm, docker), «отличия от upstream», ссылки на `ru/`, `en/` и вторую языковую версию лендинга, credits upstream и MIT; без JS и внешних ресурсов; токены цветов в `:root` и тёмная тема через `prefers-color-scheme`. Проверка: `grep -nE '<(script|link)[^>]+(src|href)="https?://' docs/landing/*` пусто; страница без горизонтального скролла на ширине 360px (devtools); ссылки `ru/`, `en/`, `en.html`/`index.html` работают в собранном `_site/` (задача 5.1).

## 5. Публикация

- [ ] 5.1 Добавить `.github/workflows/pages.yml` по design D4 (build на PR/push/dispatch, deploy только для `master`). Проверка: локальный прогон шагов сборки (`npm run build`, сборка RU/EN, раскладка `_site/`) даёт `_site/index.html`, `_site/en.html`, `_site/ru/index.html`, `_site/en/index.html`; в PR job build зелёный, deploy пропущен.
- [ ] 5.2 Проверить, что `pages.yml` не дублирует и не ломает `ci.yml`: тест паритета идёт в `npm test`/`test:unit`. Проверка: `npm run test:unit` зелёный; `npx biome ci .` зелёный (если biome проверяет новые файлы).

## 6. README, CHANGELOG и ссылки на upstream

- [ ] 6.1 Перенести секции changelog из README в `CHANGELOG.md` без изменения текста (`## Unreleased` сверху, если секции нет — создать); добавить в `## Unreleased` строку о новом сайте документации и ссылке в `--docs`/шаблоне. Проверка: `grep -c '^## v' CHANGELOG.md` равен числу версий в старом README; в README нет `# Change log`.
- [ ] 6.2 Переписать `README.MD` по design D7 (EN, ≤150 строк, ссылки на `https://alfacapital-tech.github.io/C4-Builder/ru/` и `/en/`). Проверка: `wc -l README.MD` ≤ 150; `grep -n 'docs/images\|adrianvlupu.github.io\|C4Builder-Demo' README.MD` пусто.
- [ ] 6.3 Заменить адрес сайта upstream на сайт форка в `src/cli/commands/help.ts` и `template/readme.md`; `homepage` в `package.json` → адрес сайта. Проверка: `npm run build && node dist/index.js --docs | grep alfacapital-tech.github.io`; `grep -rn 'adrianvlupu.github.io' src template README.MD package.json` пусто; `npm run test:golden` не меняет эталоны (`template/readme.md` не в `src/` шаблона — если меняет, переснять и объяснить в PR).
- [ ] 6.4 Обновить `CLAUDE.md` репо: правило changelog → `CHANGELOG.md`; изменение поведения → правка страницы сайта в обеих языковых версиях; ссылка «README Releasing» → страница «Разработка»; в «Структуре» — `docs/` (сайт RU/EN, лендинг). Проверка: в `CLAUDE.md` нет упоминания changelog в README.

## 7. Агентский раздел (ЗАВИСИТ от реализованных change'ей `llms-txt` и `agent-skills`)

- [ ] 7.1 [после `llms-txt`] Включить вывод `llms.txt` в обоих `.c4builder` сайта; на странице `08 Агенты` (RU и EN) описать `llms.txt`/`llms-full.txt` с адресами опубликованных файлов. Проверка: сборка RU/EN → 0, в `docs/*/dist/` есть `llms.txt` и `llms-full.txt`; тест паритета зелёный.
- [ ] 7.2 [после `agent-skills`] На странице `08 Агенты` (RU и EN) описать скиллы и установку `npx skills add AlfaCapital-Tech/C4-Builder`, `AGENTS.md` в шаблоне. Проверка: сборка RU/EN → 0; команда установки совпадает с README скиллов.
- [ ] 7.3 Добавить на лендинг (RU и EN) блок «Для агентов» со ссылками на `llms.txt` и раздел скиллов; добавить строку в README. Проверка: ссылки ведут на существующие пути в `_site/`; README ≤ 150 строк.

## 8. Ручные шаги мейнтейнера (требуют подтверждения, вне субагента)

- [ ] 8.1 Включить GitHub Pages с источником «GitHub Actions» (`gh api -X POST repos/AlfaCapital-Tech/C4-Builder/pages -f build_type=workflow`) до первого merge `pages.yml`. Проверка: `gh api repos/AlfaCapital-Tech/C4-Builder/pages` возвращает `build_type: workflow`.
- [ ] 8.2 После первого деплоя — smoke опубликованного сайта: корень (RU-лендинг), `en.html`, `ru/`, `en/`, страница с кириллическим URL, раздел журнала решений, в devtools нет запросов к внешним доменам. Проверка: все пункты открываются без 404.
- [ ] 8.3 Обновить карточку репозитория: `gh repo edit AlfaCapital-Tech/C4-Builder --description "<новое описание без pdf>" --homepage https://alfacapital-tech.github.io/C4-Builder/ --add-topic c4-model,plantuml,architecture-as-code,docsify,ai-agents`. Проверка: `gh api repos/AlfaCapital-Tech/C4-Builder --jq '.description,.homepage,.topics'`.
