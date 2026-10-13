# Tasks

## 1. Версии, фоновая проверка и уведомление

- [x] 1.1 Добавить в `packageJson` (`src/util/paths.ts`) поле `name` и создать `src/cli/update.ts` с `compareVersions` и `newestVersion` по design D4. Битый или пустой вход означает «нет данных», без исключений. Экспортировать их в `test/dist.mjs`. Проверка: `test/update.test.mjs` покрывает сценарии «Выбор новейшей версии» из `specs/cli-update` (стабильный канал, пререлиз отстал от стабильной, текущая новее опубликованной, `rc.2` > `rc.1`, `0.6.0` > `0.6.0-rc.3`), битый JSON и пустую строку; `npm run build && npx vitest run test/update.test.mjs` зелёный.
- [x] 1.2 Реализовать `startUpdateCheck` и `pendingUpdate` по design D1/D2: кэш `${XDG_CONFIG_HOME:-~/.config}/c4builder/dist-tags.json`, mtime как время попытки (с `futimes`), отсоединённый `npm view` со stdout в fd кэша, `--fetch-retries=0 --fetch-timeout=5000`, `child.on('error')`, `shell` на win32, отключение при `CI`, `NO_UPDATE_NOTIFIER`, `C4BUILDER_DOCKER`. В `vitest.config.mjs` задать `test.env.NO_UPDATE_NOTIFIER = '1'`. Проверка: в `test/update.test.mjs` (POSIX, фейковый `npm` в `PATH`, временный `XDG_CONFIG_HOME`, в env ребёнка сняты `CI` и `NO_UPDATE_NOTIFIER`) зелёные кейсы:
  - фейковый `npm` спит 10 с → `c4builder --docs` завершается меньше чем за 3 с;
  - с `CI=true` фейковый `npm` не вызывается (нет файла-маркера);
  - повторный запуск в течение 24 ч не вызывает `npm`;
  - после неудачной попытки (фейковый `npm` с выходом 1) mtime кэша свежий;
  - если `npm` отсутствует в `PATH`, CLI не падает.
- [x] 1.3 Подключить в `src/cli/dispatch.ts` сразу после `program.parse`: `startUpdateCheck` (кроме `cmd === 'update'`) и при доступном обновлении `process.once('exit')` со строкой `c4builder <new> is available (current <current>). Run: c4builder update` в stderr (design D3). Проверка в `test/update.test.mjs`:
  - со свежим кэшем `{"latest":"99.0.0"}` команда `c4builder check <ok.puml>` даёт тот же stdout и код, что с `NO_UPDATE_NOTIFIER=1`, а последняя строка stderr — ровно строка уведомления;
  - с `NO_UPDATE_NOTIFIER=1` уведомления нет;
  - кэш с текущей версией не даёт уведомления;
  - `c4builder --version` без уведомления.

## 2. Команда `c4builder update`

- [x] 2.1 Реализовать `cmdUpdate` в `src/cli/update.ts` по design D6. Добавить `update` в `COMMANDS` и маршрутизацию в `dispatch.ts` рядом с `jre`/`check`, до создания `Configstore`. Проверка в `test/update.test.mjs` (фейковый `npm` отвечает на `view` и `root -g` и пишет маркер на `install`):
  - глобальная установка (`root -g` = каталог, содержащий `REPO_ROOT`) при `latest` новее → вызван `install -g @alfacapital-tech/c4builder@<new>`, код 0;
  - версия актуальна → `is up to date`, код 0, `install` не вызван;
  - установка не глобальная → печатаются `npm i -D` и `npx`, код 1, `install` не вызван;
  - `C4BUILDER_DOCKER=1` → `docker pull ghcr.io/alfacapital-tech/c4builder:latest`, код 1;
  - `npm view` с ошибкой → сообщение на английском, код 1;
  - во всех кейсах временный cwd остаётся пустым.

  В `test/cli-commands.test.mjs` добавить сценарий «Команда обновления вне проекта» из дельты `cli-commands` и убедиться, что список команд в сообщении об опечатке содержит `update`. Проверка: `npx vitest run test/update.test.mjs test/cli-commands.test.mjs` зелёный.
- [x] 2.2 Добавить в `Dockerfile` рантайм-стадии `ENV C4BUILDER_DOCKER=1` с комментарием о двойном назначении (design D2). Проверка: `grep -n C4BUILDER_DOCKER Dockerfile` находит строку в финальной стадии; `docker build` по возможности, иначе отметить, что сборка образа не прогонялась.

## 3. Плашка на сайте `site -w`

- [x] 3.1 В `src/cli/commands/site.ts` `inject()` добавляет плашку по design D5: на английском, версии и `c4builder update`, фиксированная в углу, закрытие через `sessionStorage` в `try/catch`, кэш перечитывается на каждую страницу, при признаках отключения плашки нет. Проверка в `test/cli-site.test.mjs` (env ребёнка без `NO_UPDATE_NOTIFIER` и `CI`, временный `XDG_CONFIG_HOME` со свежим кэшем `{"latest":"99.0.0"}`):
  - `GET /` отдаёт HTML с плашкой и обеими версиями;
  - `index.html` в каталоге выходов на диске плашки не содержит;
  - с `NO_UPDATE_NOTIFIER=1` плашки в ответе нет.

  `npx vitest run test/cli-site.test.mjs` зелёный.

## 4. Актуализация

- [x] 4.1 Страницы сайта в обеих версиях. `05 CLI и конфигурация` / `05 CLI and configuration`: строка `c4builder update` в таблице команд, позиционные команды с `update`, раздел об уведомлениях (раз в сутки, через npm-реестр пользователя, кэш `~/.config/c4builder/dist-tags.json`, плашка в `site -w`, отключение `NO_UPDATE_NOTIFIER=1`). `07 Docker и CI` / `07 Docker and CI`: в CI проверка отключается сама по `CI`, в образе — по `C4BUILDER_DOCKER`, обновление образа через `docker pull`. Проверка: `npx vitest run test/docs-parity.test.mjs` зелёный; `cd docs/ru && node ../../dist/index.js` и то же для `docs/en` завершаются с кодом 0.
- [x] 4.2 Скиллы и шаблон. В `skills/c4builder/SKILL.md` правило: увидел строку `c4builder <new> is available (current <current>). Run: c4builder update` — сообщи пользователю, `c4builder update` запускай только по его просьбе. В `skills/c4builder-setup/SKILL.md` (и `references/`, если там описана установка) — обновление через `c4builder update`. В `template/AGENTS.md` — та же реакция на уведомление и упоминание `c4builder update` рядом со строкой установки. Проверка: `npx vitest run test/skills.test.mjs` зелёный; `grep -n "c4builder update" skills/*/SKILL.md template/AGENTS.md` находит все три файла.
- [x] 4.3 Строка в `## Unreleased` файла `CHANGELOG.md`: уведомление о новой версии (терминал и `site -w`, раз в сутки, отключение `NO_UPDATE_NOTIFIER`, в CI и Docker выключено) и команда `c4builder update`. Проверка: `git diff CHANGELOG.md` показывает строку в секции `## Unreleased`.
- [x] 4.4 Итоговая проверка. Проверка: `npm run check` зелёный; `npm run test:unit` зелёный (в том числе `cli-language` на новые литералы); `openspec validate add-update-notice --strict` без ошибок.
