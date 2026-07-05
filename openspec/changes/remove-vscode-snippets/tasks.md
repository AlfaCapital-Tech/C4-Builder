# Tasks: remove-vscode-snippets

> Зависит от `new-noninteractive` (архив): убирает введённые там флаги `--vscode`/`--no-vscode`.

## 1. CLI-флаги (cli.js)

- [ ] 1.1 Удалить опции `--vscode` и `--no-vscode`
- [ ] 1.2 Удалить вычисление `vscodeExplicit` и его проброс; `cmdNewProject` вызывается только с `opts`

## 2. Создание проекта (cli.new.js)

- [ ] 2.1 Удалить решение `isVSCode` (промпт «Include the VSCode autocomplete?» и ветку флага)
- [ ] 2.2 Удалить copy-шаг сниппетов в `.vscode/` (`if (isVSCode) { … C4.code-snippets … }`)
- [ ] 2.3 Интерактивный `--new` оставляет единственный промпт — имя (валидация/ре-промпт как есть)
- [ ] 2.4 Упростить логику `cmdNewProject` (без `opts.vscode`/`vscodeExplicit`)

## 3. Вендорный ассет

- [ ] 3.1 Удалить каталог `vendor/C4-PlantUML/` целиком (единственный файл — сниппеты)

## 4. Верификация

- [ ] 4.1 `grep -rniE "vscode|code-snippets" *.js` — не осталось живых ссылок (кроме source-attribution в utils.js)
- [ ] 4.2 `c4builder --new --name demo` → проект без каталога `.vscode`, вопросов нет; `--new` без `--name` → спрашивает только имя
- [ ] 4.3 `c4builder --new --yes --name demo` → как прежде, без `.vscode`
- [ ] 4.4 Golden (`diagramFormat=svg`) зелёный и неизменный
- [ ] 4.5 `openspec validate remove-vscode-snippets --strict` проходит
