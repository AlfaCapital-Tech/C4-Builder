# Разработка

Страница для тех, кто меняет сам c4builder. Репозиторий:
[AlfaCapital-Tech/C4-Builder](https://github.com/AlfaCapital-Tech/C4-Builder).

## Как устроен

![Контейнеры C4-Builder](container.puml)

Сборка идёт фазами: **scan** обходит `src/` и строит дерево страниц, **плагины** добавляют
в него виртуальные страницы, **render** рендерит диаграммы (с кэшем по чексуммам), **compose**
пишет markdown, sidebar и `index.html`. CLI — тонкий слой поверх: разбор аргументов, мастер,
отдельные команды `check` и `jre`. Всё, что влияет на результат рендера (PlantUML-jar, шрифты,
docsify, swagger-ui), лежит в `vendor/` и руками не правится.

## Сборка и тесты

```bash
npm ci
npm run build          # tsc → dist/
npm test               # все тесты, включая golden
npm run test:unit      # без golden: быстро и без Java
npm run check          # biome: линт и формат
```

TypeScript, ESM, Node 20.19+. Тесты запускают собранный CLI из `dist/`, поэтому `npm test`
сначала компилирует.

**Язык вывода.** Всё, что CLI печатает пользователю, — на английском, комментарии в коде — на
русском. Тест `test/cli-language.test.mjs` падает на кириллице в строковых литералах `src/`.

**Golden-снапшоты.** `test/golden.test.mjs` собирает шаблон `template/src` в нескольких
конфигурациях и сравнивает весь выход с эталоном в `test/golden/` — побайтно, включая SVG.
Рендер закреплён на конкретной JRE (Temurin), которую тест скачивает в кэш сам. Изменили
рендер или шаблон — пересоберите эталоны `npm run test:golden:update` и приложите дифф
`test/golden/` к pull request'у. На некоторых дистрибутивах Linux SVG расходятся из-за
системного fontconfig; в CI на Ubuntu эталон стабилен.

**Сайт документации.** Исходники — `docs/ru/src` и `docs/en/src`, лендинг — `docs/landing`.
Тест `test/docs-parity.test.mjs` проверяет, что у RU и EN одинаковый набор страниц: папки
сопоставляются по числовому префиксу, файлы — по имени. Локальный просмотр:

```bash
npm run build
cd docs/ru && node ../../dist/index.js --site -w
```

## Процесс: OpenSpec

Изменения поведения сначала описываются в [OpenSpec](https://github.com/Fission-AI/OpenSpec):
`openspec/changes/<имя>/` — proposal (зачем), design (как и почему так), спеки (требования со
сценариями) и tasks. После реализации change архивируется, а его требования переходят в
`openspec/specs/`. Артефакты пишутся по-русски, код и идентификаторы — по-английски.

Весь store опубликован на этом сайте в разделе **Журнал решений**: активные change'и, спеки
и архив — офлайн-шаблон, отказ от Graphviz, локальный рендер D2 и PNG, переход на TypeScript, система
плагинов.

## Журнал изменений

Каждое пользовательское изменение (фича, исправление, поведение CLI) добавляет строку в
секцию `## Unreleased` файла
[CHANGELOG.md](https://github.com/AlfaCapital-Tech/C4-Builder/blob/master/CHANGELOG.md) в том же
pull request'е. Если меняется поведение, правится и страница этого сайта — в обеих языковых
версиях.

## Релизы

Публикацию запускает только пуш git-тега `v<версия>`. Merge в `master` ничего не публикует,
кроме Docker-тега `edge` и обновления этого сайта.

**Релиз-кандидат** — из `master`, сколько угодно раз; кто подписан на `rc`, получает каждый:

```bash
npm version X.Y.Z-rc.1 -m "rc: %s"      # первый кандидат
npm version prerelease -m "rc: %s"      # следующие: rc.2, rc.3, …
git push --follow-tags
```

Публикуется в npm-тег `rc` и Docker-тег `rc`; `latest` не меняется.

**Финальный релиз** — сначала переименовать `## Unreleased` в `## vX.Y.Z` в `CHANGELOG.md`:

```bash
npm version X.Y.Z -m "release: %s"
git push --follow-tags
```

Публикуется в npm-тег `latest` и Docker-теги `X.Y.Z`, `X.Y`, `latest`. npm публикуется через
OIDC (trusted publishing) с provenance, образ — в GHCR.
