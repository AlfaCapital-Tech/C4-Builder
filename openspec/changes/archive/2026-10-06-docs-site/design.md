# Design

## Context

Мотивация — в proposal.md. Ограничения, которые определяют подход:

- Проект c4builder — это папка с `.c4builder`. `rootFolder`, `distFolder`, путь конфига
  (`-c`) и `dir` плагинов разрешаются **от cwd**. Заголовок страницы в sidebar — имя
  папки как есть, порядок — порядок `readdir` (числовые префиксы `1 …` видны в заголовке,
  как в шаблоне).
- Одна сборка = один язык: i18n внутри одного проекта ядро не умеет.
- Сайт docsify офлайновый: `index.html` грузит `vendor/*` из dist, внешних CDN нет.
  Сборка пишет `.nojekyll`.
- `generateLocalImages` переименовывает старый dist в `<dist>_bk`. Если dist указать вне
  проекта, `_bk` попадёт в Pages-артефакт.
- CI уже собирает CLI (`npm run build`) и ставит Temurin 21 (`setup-java`). Юнит-тесты
  vitest (`test/*.test.mjs`) идут в обеих ногах матрицы.
- Ссылки на upstream: `src/cli/commands/help.ts` (`--docs`), `template/readme.md`,
  картинки README из `docs/images/`. Ссылки на upstream-PR в changelog — историческая
  атрибуция.

## Goals / Non-Goals

**Goals:**
- Минимум новой инфраструктуры: два c4builder-проекта, одна статическая страница, один
  workflow, один тест.
- Сайт как демонстрация продукта: собственные C4-диаграммы c4builder, локальный рендер,
  плагин `openspec`.

**Non-Goals:**
- Docsify-i18n, переключатель языка внутри docsify, общий sidebar на два языка.
- Новые GIF и скриншоты: в первой итерации их нет, демонстрацию дают живые диаграммы.
- D2 на сайте: опциональная зависимость ~60 МБ, ради сайта её в CI не ставим.
- Версионирование документации по релизам: сайт отражает `master`.
- Автоматический перевод и проверка содержательной эквивалентности RU/EN (проверяется
  только структура).

## Decisions

### D1. Два независимых проекта `docs/ru` и `docs/en`

```
docs/
  landing/        index.html (RU), en.html (EN), landing.css
  ru/             .c4builder + src/   (dist → docs/ru/dist, в .gitignore)
  en/             .c4builder + src/   (dist → docs/en/dist)
```

Каждый `.c4builder` — полный headless-конфиг (форма `new --yes`, `hasRun: true`):
`generateWEB: true`, `generateMD: false`, `generateLocalImages: true`, `diagramFormat: svg`,
`repoUrl` на GitHub-репозиторий, `homepageName` «Обзор» / «Overview», `projectName`
«C4-Builder». `distFolder: dist` внутри проекта, чтобы `_bk` не попадал в артефакт:
workflow копирует в артефакт только `dist`. В `.gitignore` добавляются `docs/*/dist*/`
и `docs/*/.c4builder.cache`.

*Альтернативы:* один проект и docsify-i18n — нужно править шаблон и sidebar ядра, а это
фича продукта, а не документации. `distFolder: ../../_site/ru` — тащит `_bk` в Pages.

### D2. Плагин `openspec` в обоих проектах

`plugins: [["openspec", {"dir": "../../openspec", "mount": "<имя раздела>"}]]`.
`mount`: «Журнал решений» (RU) и «Design log» (EN). EN-версия получает страницу-заглушку
в `src/` с пометкой «artifacts are in Russian». Пометка ставится через `.md` в корне EN,
а не в плагине, чтобы не трогать ядро. Плагин подписи сводки и таблиц уже выводит
по-английски, это допустимо для обеих версий.

### D3. Лендинг — две статические страницы и общий CSS

`docs/landing/index.html` (RU, корень сайта), `docs/landing/en.html` (EN),
`docs/landing/landing.css`. Без JS, без сборщика, без внешних шрифтов (системный стек).
Цвета на CSS-переменных, тёмная тема через `prefers-color-scheme`, вёрстка от 360px.
Содержание: позиционирование форка, агентский цикл (правка → `check` → `--site -w`),
quickstart (npm, docker), блоки «отличия от upstream» и «для агентов» (ссылки на
`llms.txt` и скиллы появляются в последней группе задач), ссылки на `ru/` и `en/`,
благодарность upstream и MIT.

*Альтернатива:* одна страница с JS-переключателем языка — меньше файлов, но нужен JS,
и на конкретный язык нельзя дать прямую ссылку.

### D4. Workflow `pages.yml`

```
on: push [master], pull_request, workflow_dispatch
job build:  checkout → setup-node 24 → npm ci --ignore-scripts → npm run build
            → setup-java temurin 21
            → (cd docs/ru && node ../../dist/index.js)  ; то же для docs/en
            → сборка _site/: landing/* → _site/, ru/dist → _site/ru, en/dist → _site/en
            → upload-pages-artifact (_site)
job deploy: needs build, if push в master или dispatch на master
            → deploy-pages (permissions pages: write, id-token: write,
              environment github-pages, concurrency group pages)
```

Сборка из `docs/<lang>` как cwd: так относительные пути `.c4builder` и `dir` плагина
работают одинаково локально (`cd docs/ru && c4builder --site -w`) и в CI. Деплой через
Actions-артефакт обходит Jekyll, `.nojekyll` не обязателен, но не мешает.

*Альтернатива:* setup-java не ставить, пусть c4builder скачает managed JRE. Выходит
медленнее и требует отдельного кэша. Для сайта пиксельный детерминизм golden не нужен.

### D5. Проверка паритета — vitest-тест

`test/docs-parity.test.mjs`. Обходит `docs/ru/src` и `docs/en/src`, нормализует каждый
путь (сегмент папки → её числовой префикс `^\d+`, имя файла `.md`/`.puml`/`.d2` →
как есть), сравнивает множества и при расхождении падает со списком путей без пары.
Папки без числового префикса — тоже ошибка: без префикса сопоставить RU и EN нельзя.
Файлы с префиксом `_` (инклюды) включаются в сравнение. Тест идёт в существующих
`npm test` / `test:unit`, workflow CI не меняется.

*Альтернатива:* отдельный скрипт и шаг CI — лишний файл и шаг ради того же.

### D6. Структура страниц (одинаковая для RU/EN)

| # | RU | EN | Источник (раздел README) |
|---|---|---|---|
| — | Обзор (`README.md` корня) | Overview | Overview, позиционирование, C4-контекст c4builder (`context.puml`) |
| 01 | Быстрый старт | Getting started | Getting started, Requirements, Installing a release candidate |
| 02 | Проект | Project | The project, The build (`_`-файлы, позиционирование диаграмм) |
| 03 | Диаграммы | Diagrams | Локальный рендер/Smetana, `plantumlServerUrl`, D2, PNG/resvg, шрифты, Validating single diagrams (`check`, pre-commit) |
| 04 | Выводы | Outputs | The output (markdown с навигацией, complete markdown, сайт, опции) |
| 05 | CLI и конфигурация | CLI & configuration | Available Commands, `jre`, справочник ключей `.c4builder` (по `--docs`) |
| 06 | Плагины | Plugins | Plugins: `openspec`, `openapi`, Writing a plugin |
| 07 | Docker и CI | Docker & CI | Docker (теги образа, использование в CI) |
| 08 | Агенты | Agents | новое: агентский цикл; `llms.txt` и скиллы — последняя группа задач |
| 09 | Разработка | Development | Releasing (rc/final), правило changelog, OpenSpec-процесс, тесты/golden, C4-контейнеры c4builder (`container.puml`) |

Не переносятся: «Future plans» (первое лицо upstream), картинки `docs/images/*`
(PDF, мастер, vscode, GitHub Pages UI), ссылка на `C4Builder-Demo`. Раздел «Generate
diagrams locally» переписывается: локальный рендер — основной режим, онлайн-сервер —
опция.

### D7. README и CHANGELOG

README (EN, ≤150 строк): название и однострочник, строка ссылок
«Документация на русском · English docs», 4–6 пунктов «чем отличается от upstream»,
quickstart (`npm i -g`, `new`, `c4builder`, `--site -w`, `check`), docker-однострочник,
ссылки (сайт, CHANGELOG, раздел Development), credits upstream и лицензия. Только
абсолютные ссылки на сайт, без относительных картинок: README уходит в npm-пакет.

`CHANGELOG.md` = секции `## Unreleased`/`## vX.Y.Z` из README без изменений, включая
ссылки на upstream-PR. В npm-пакет не входит (`files` не меняется). `CLAUDE.md`:
правило «строка в README, changelog» → «строка в `CHANGELOG.md` `## Unreleased`; при
изменении поведения — правка страницы сайта в обеих языковых версиях»; ссылка
«README Releasing» → страница сайта «Разработка».

### D8. Адрес сайта

`https://alfacapital-tech.github.io/C4-Builder/` — адрес проектного сайта GitHub Pages.
Используется в README, `--docs`, `template/readme.md`, homepage репозитория и
`homepage` в `package.json`. Свой домен не нужен.

## Risks / Trade-offs

- [Расхождение текста RU/EN при одинаковой структуре] → тест ловит только структуру.
  Правило в `CLAUDE.md`: правка страницы — в обеих версиях в том же PR.
- [Числовые префиксы видны в заголовках sidebar] → поведение ядра, как в шаблоне. Убирать
  префиксы — отдельная фича продукта, не этого change'а.
- [Pages не включён в настройках репо] → первый деплой упадёт. Задача включения Pages
  (Source: GitHub Actions) стоит до первого merge workflow и требует подтверждения
  мейнтейнера.
- [Кириллица в URL RU-страниц] → docsify и GitHub Pages работают с percent-encoding.
  Проверяется на первом деплое (задача smoke).
- [Сборка сайта удлиняет CI на PR] → отдельный workflow параллельно тестам, рендер
  ~10–20 диаграмм.

## Migration Plan

1. Включить Pages (Source: GitHub Actions). Ручной шаг мейнтейнера.
2. Merge PR: удаление `docs/`, новые исходники, workflow, README/CHANGELOG.
3. Первый деплой с `master`, smoke опубликованного сайта.
4. `gh repo edit`: description, homepage, topics. Ручной шаг с подтверждением.

Откат: revert PR. Старый `docs/` нигде не публиковался (Pages был выключен), так что
откатывать на сайте нечего.
