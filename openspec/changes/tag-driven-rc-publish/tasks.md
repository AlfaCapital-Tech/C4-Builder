## 1. Переписать workflow публикации

- [x] 1.1 В `.github/workflows/publish.yml` заменить триггер: убрать `push: branches: [master]`, поставить `push: tags: ['v*']`; сохранить `workflow_dispatch`
- [x] 1.2 Добавить шаг-гейт синхронизации: `test "v$(node -p 'require("./package.json").version')" = "$GITHUB_REF_NAME"`, иначе `exit 1` (D3)
- [x] 1.3 Реализовать выбор dist-tag: версия содержит `-` → `npm publish --tag rc --provenance --access public`; иначе → `npm publish --provenance --access public` (latest) (D2)
- [x] 1.4 Уточнить гейт идемпотентности: проверять присутствие конкретной версии (`npm view <pkg>@<version> version`), а не `latest`; при наличии — skip (D4)
- [x] 1.5 Сохранить `permissions: id-token: write`, `registry-url`, `--provenance`, `npm ci --ignore-scripts` (D5)

## 2. Документация

- [x] 2.1 Добавить в `README.MD` короткую секцию: установка релиз-кандидата `npm i @alfacapital-tech/c4builder@rc` и что `npm install` без тега ставит стабильную версию
- [x] 2.2 Добавить в `README.MD` секцию `## Releasing`: выпуск rc (`npm version 0.3.0-rc.N -m "rc: %s"` + `git push --follow-tags` с ветки `refactor/phoenix`, без мержа в master) и финала (`npm version 0.3.0` + тег → `latest`)
- [x] 2.3 Исправить неверное имя пакета в install-секции `README.MD` (строка ~31): `npm i -g c4builder` → `npm i -g @alfacapital-tech/c4builder` (пре-существующий баг, чинится заодно)

## 3. Проверка вживую

- [ ] 3.1 С ветки `refactor/phoenix`: `npm version 0.3.0-rc.1 -m "rc: %s"` + `git push --follow-tags`
- [ ] 3.2 Убедиться, что workflow опубликовал пакет под dist-tag `rc`, а `latest` остался `0.2.25` (`npm view @alfacapital-tech/c4builder dist-tags`)
- [ ] 3.3 Проверить, что `npm install @alfacapital-tech/c4builder@rc` ставит `0.3.0-rc.1`, а `npm install` без тега — `0.2.25`
- [ ] 3.4 Проверить гейты: повторный запуск для той же версии → skip без ошибки; тег с несовпадающей версией → workflow падает
