# Docker и CI

## Docker-образ

В образе есть всё для сборки: Node, JRE, PlantUML-jar, шрифты и D2. Смонтируйте проект в
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

## Сборка в CI

Образ можно взять образом job'а напрямую: `c4builder` лежит в `PATH`.

GitLab CI, проверка диаграмм и публикация в GitLab Pages (в `.c4builder` задан
`"distFolder": "public"`):

```yaml
check:
  image: ghcr.io/alfacapital-tech/c4builder:0.4.0
  script:
    - find src \( -name '*.puml' -o -name '*.d2' \) -exec c4builder check {} +

pages:
  image: ghcr.io/alfacapital-tech/c4builder:0.4.0
  script:
    - c4builder
  artifacts:
    paths: [public]
```

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

Сборка ведёт себя в CI так же, как локально: код выхода не 0, если не собралась хотя бы одна
диаграмма. Отдельный быстрый шаг `c4builder check` на изменённых файлах даёт понятную ошибку
раньше полной сборки.

## Как собирается этот сайт

Workflow `.github/workflows/pages.yml` в репозитории c4builder: собирает CLI из того же
коммита, затем `docs/ru` и `docs/en` как два отдельных проекта, складывает их вместе с
лендингом в один артефакт и публикует в GitHub Pages только из `master`. На pull request'ах
сайт собирается, но не публикуется — битая диаграмма в документации видна до merge.
