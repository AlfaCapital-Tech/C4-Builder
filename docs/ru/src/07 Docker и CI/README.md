# Docker и CI

## Docker-образ

В образе есть всё для сборки: Node, JRE, PlantUML-jar, шрифты, D2, движки BPMN, mermaid и wireflow с каталогом шаблонов экранов. Смонтируйте проект в
`/pwd`:

```bash
docker run --rm -v "$PWD:/pwd" ghcr.io/alfacapital-tech/c4builder:latest c4builder
```

Проверка диаграмм без установки чего-либо:

```bash
docker run --rm -v "$PWD:/pwd" ghcr.io/alfacapital-tech/c4builder:latest c4builder check src/context.puml
```

Теги образа синхронны с npm-тегами:

| Тег | Что это |
|---|---|
| `X.Y.Z`, `sha-…` | неизменяемые: конкретный релиз или коммит |
| `X.Y` | последний патч стабильной ветки |
| `latest` | последний стабильный релиз |
| `rc` | последний релиз-кандидат |
| `edge` | последний коммит в `master` |
| `pr-N` | сборки pull request'ов |

Для воспроизводимой сборки в CI закрепляйте `X.Y.Z`: другая версия PlantUML может сдвинуть
раскладку диаграмм.

В образе задана переменная `C4BUILDER_DOCKER=1`: проверка новой версии не запускается, а
`c4builder update` вместо установки печатает команду обновления образа —
`docker pull ghcr.io/alfacapital-tech/c4builder:latest` (или смените закреплённый тег).

## Сборка в CI

Образ можно взять образом job'а напрямую: `c4builder` лежит в `PATH`.

GitLab CI, проверка диаграмм и публикация в GitLab Pages (в `.c4builder` задан
`"distFolder": "public"`):

```yaml
check:
  image: node:24
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    GIT_DEPTH: 0  # коммит базы MR для git diff
  script:
    - npm i -g @alfacapital-tech/c4builder@0.15.0
    - git -c core.quotePath=false diff --name-only --diff-filter=d "$CI_MERGE_REQUEST_DIFF_BASE_SHA" HEAD
      -- '*.puml' '*.iuml' '*.d2' '*.bpmn' '*.mmd' '*.wireflow.json' 'wireflow.json' '*/wireflow.json'
      | c4builder check --strict --format gitlab --files-from - > gl-code-quality-report.json
  artifacts:
    when: always
    reports:
      codequality: gl-code-quality-report.json

pages:
  image: ghcr.io/alfacapital-tech/c4builder:0.9.0
  script:
    - c4builder
  artifacts:
    paths: [public]
```

Джоба `check` проверяет диаграммы, изменённые в MR, и кладёт замечания в отчёт GitLab Code
Quality: они видны в виджете MR и в diff на нужной строке, а не только в логе. `when: always`
сохраняет отчёт и при упавшей джобе. В образе c4builder нет `git`, поэтому джоба идёт на
`node:24`, а JRE c4builder скачает сам. `--format` и `--files-from` — с c4builder 0.15.0:
версия закреплена, на более ранней джоба упадёт на неизвестной опции.

GitHub Actions, проверка изменённых в PR диаграмм с аннотациями в diff:

```yaml
on: pull_request
jobs:
  diagrams:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm i -g @alfacapital-tech/c4builder@0.15.0
      - run: >
          git -c core.quotePath=false diff --name-only --diff-filter=d "origin/${{ github.base_ref }}...HEAD"
          -- '*.puml' '*.iuml' '*.d2' '*.bpmn' '*.mmd' '*.wireflow.json' 'wireflow.json' '*/wireflow.json'
          | c4builder check --strict --format github --files-from -
```

Список изменённых файлов идёт в `check` одним вызовом через `--files-from -`, а не через
`xargs`: тот делит длинный список на несколько вызовов, и отчёт GitLab стал бы несколькими
JSON-массивами подряд. `core.quotePath=false` — чтобы `git` не экранировал кириллицу в путях.
Если диаграммы в PR не менялись, список пуст: машинный формат печатает пустой отчёт и
завершается с кодом 0. Java шагу не нужна заранее — c4builder скачает JRE сам, и
сообщения об этом уйдут в stderr, не смешиваясь с аннотациями. Формат и поля замечаний — в
[CLI и конфигурация](05%20CLI%20и%20конфигурация/05%20CLI%20и%20конфигурация.md).

GitHub Actions без Docker: Node из `setup-node`, Java из `setup-java` (или пусть c4builder
скачает JRE сам):

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 24 }
- uses: actions/setup-java@v4
  with: { distribution: temurin, java-version: 21 }
- run: npm i -g @alfacapital-tech/c4builder
- run: c4builder
```

Если Java на раннере нет, c4builder скачает JRE при первой сборке. Чтобы не качать её
каждый раз, кэшируйте каталог из `c4builder jre info` (поле `cacheDir`), а при промахе кэша
прогревайте его командой `c4builder jre install`.

### Тёплый старт: кэш рендера между джобами

Каждая джоба стартует с чистого клона и рендерит все диаграммы заново — на большом проекте это
минуты. Кэш рендера переносим: сохраните между джобами папку выхода (`distFolder`) и
`.c4builder.cache`, и следующая сборка отрендерит только изменённые диаграммы, остальные
возьмёт из прошлого выхода (в логе — `processed N images` без запуска Java). Условия: та же
версия c4builder (версии PlantUML и движков входят в чексуммы) и тот же режим шрифтов. В ключ
кэша включите версию пакета или lock-файл, чтобы обновление c4builder не отдавало старые
картинки.

GitLab CI:

```yaml
pages:
  variables:
    C4BUILDER_VERSION: "0.9.0"
  image: ghcr.io/alfacapital-tech/c4builder:$C4BUILDER_VERSION
  cache:
    key: c4builder-$C4BUILDER_VERSION-$CI_COMMIT_REF_SLUG
    paths: [public, .c4builder.cache]
  script:
    - c4builder
  artifacts:
    paths: [public]
```

GitHub Actions:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      docs
      .c4builder.cache
    key: c4builder-${{ hashFiles('package-lock.json') }}-${{ github.sha }}
    restore-keys: c4builder-${{ hashFiles('package-lock.json') }}-
- run: c4builder
```

`C4BUILDER_RENDER_CONCURRENCY` задаёт число параллельных процессов PlantUML (по умолчанию
`min(4, CPU − 1)`): на раннере с большим числом ядер и памяти его можно поднять, на слабом —
опустить до `1`. Выход от него не зависит.

Фоновая проверка новой версии в CI выключается сама по переменной `CI`: ни процесса, ни
обращений к реестру, сборка без интернета идёт столько же, сколько и раньше.

Сборка ведёт себя в CI так же, как локально: код выхода не 0, если не собралась хотя бы одна
диаграмма. Отдельный быстрый шаг `c4builder check` на изменённых файлах даёт понятную ошибку
раньше полной сборки. С `--strict` шаг падает и на предупреждениях — например, на связи C4 к
необъявленному элементу, которую сборка только печатает. С `--format github` или
`--format gitlab` ошибки и предупреждения попадают прямо в diff PR/MR (фрагменты выше).

## Как собирается этот сайт

Workflow `.github/workflows/pages.yml` в репозитории c4builder: собирает CLI из того же
коммита, затем `docs/ru` и `docs/en` как два отдельных проекта, складывает их вместе с
лендингом в один артефакт и публикует в GitHub Pages только из `master`. На pull request'ах
сайт собирается, но не публикуется — битая диаграмма в документации видна до merge.
