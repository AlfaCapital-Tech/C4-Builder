# Tasks: remove-vscode-snippets

> Зависит от `new-noninteractive` (архив): убирает введённые там флаги `--vscode`/`--no-vscode`.

## 1. CLI-флаги (cli.js)

- [x] 1.1 Удалить опции `--vscode` и `--no-vscode`
- [x] 1.2 Удалить вычисление `vscodeExplicit` и его проброс; `cmdNewProject` вызывается только с `opts`

## 2. Создание проекта (cli.new.js)

- [x] 2.1 Удалить решение `isVSCode` (промпт «Include the VSCode autocomplete?» и ветку флага)
- [x] 2.2 Удалить copy-шаг сниппетов в `.vscode/` (`if (isVSCode) { … C4.code-snippets … }`)
- [x] 2.3 Интерактивный `--new` оставляет единственный промпт — имя (валидация/ре-промпт как есть)
- [x] 2.4 Упростить логику `cmdNewProject` (без `opts.vscode`/`vscodeExplicit`)

## 3. Вендорный ассет

- [x] 3.1 Удалить каталог `vendor/C4-PlantUML/` целиком (единственный файл — сниппеты)

## 4. Верификация

- [x] 4.1 `grep -rniE "vscode|code-snippets" *.js` — не осталось живых ссылок (кроме source-attribution в utils.js)
- [x] 4.2 `c4builder --new --name demo` → проект без каталога `.vscode`, вопросов нет; `--new` без `--name` → спрашивает только имя
- [x] 4.3 `c4builder --new --yes --name demo` → как прежде, без `.vscode`
- [x] 4.4 Golden (`diagramFormat=svg`) неизменный от change: результат идентичен до/после правок. Тест сейчас red на `class.svg` (дрейф glyph-рендера PlantUML/шрифта) — воспроизводится на чистом HEAD без этих правок, к change отношения не имеет.
- [x] 4.5 `openspec validate remove-vscode-snippets --strict` проходит
