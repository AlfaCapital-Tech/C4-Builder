# Tasks

## 1. Спайк на целевом GitLab (блокирует остальное)

- [ ] 1.1 Проверить на GitLab потребителя (design, риск CORS): preflight `OPTIONS` с `Origin` Pages к `/oauth/token` и `/api/v4/projects/:id/merge_requests/:iid/discussions` отвечает `Access-Control-Allow-Origin`; публичное OAuth-приложение со scope `api` и PKCE S256 выдаёт токен из браузера (страница-заглушка на Pages); у Pages проекта включён unique domain. Проверка: результаты (без адресов хостов) дописаны в `design.md` → Risks; при отсутствии CORS change остановлен и вопрос вынесен владельцу.

## 2. Карта страниц в afterBuild

- [ ] 2.1 `BuildCtx.pages: PageSources` в `src/core/plugins/types.ts`, проброс карты из `build.ts` в `runAfterBuild` (`hooks.ts`); без сайта — пустая карта (design D3). Проверка: `test/page-sources.test.mjs` — тестовый плагин в `afterBuild` получает для склеенной страницы оба `.md` в порядке склейки и пустой список для сводки (сценарий спеки `plugin-system`).

## 3. Общий клиентский модуль выделения и подсветки

- [ ] 3.1 Вынести из `commentsSnippet` выделение, поповер, захват цитаты/раздела и `textIndex`/`wrapRange`/`locate` в статический ассет `site-annotate.js` с адресатами-кнопками (design D4); dev-сервер подключает его с Question/Feedback и ставит `window.__c4builderDevServer` в `<head>`. Проверка: `test/site-comments-client.test.mjs` и `test/cli-site.test.mjs` зелёные без правок ожиданий; `npm run test:golden` без изменений снапшотов (в `dist` ассета нет без плагина).

## 4. Плагин: опции и выходы сборки

- [ ] 4.1 `src/plugins/gitlab-review/` и запись в реестре `src/plugins/index.ts`: zod-схема опций, умолчания из `CI_SERVER_URL`/`CI_PROJECT_ID`/`CI_MERGE_REQUEST_IID`/`CI_COMMIT_SHA`/`CI_PAGES_URL`, ошибка без `clientId`/`gitlabUrl`. Проверка: новый `test/plugin-gitlab-review.test.mjs` — минимальный конфиг с переменными CI даёт полные опции; без `clientId` сборка падает с `gitlab-review: clientId`.
- [ ] 4.2 `afterBuild`: `c4b-oauth.html` в корне всегда; при непустом `mr` — `review.json` (поля спеки, пути от `CI_PROJECT_DIR`/cwd, внешние отброшены) и ассеты плагина + `site-annotate.js` в `index.html`. Проверка: тот же тест — без `mr` в `dist` есть `c4b-oauth.html`, нет `review.json` и подключений ассетов; с `mr` — `review.json` сопоставляет `Changes/foo/design.md` с `openspec/changes/foo/design.md`, в файле нет полей, кроме перечисленных в спеке.

## 5. Клиент: вход OAuth PKCE

- [ ] 5.1 Вход по design D5: `code_verifier`/`state`/адрес возврата в `sessionStorage`, переход на `/oauth/authorize` (`code_challenge_method=S256`, `scope=api`); `c4b-oauth.html` меняет код на токен, сверяет `state`, возвращает только на тот же origin; 401 → повторный вход с сохранением черновика. Проверка: jsdom-тест с подменой `fetch` и `location` — URL авторизации содержит challenge от verifier; чужой `state` → ошибка без токена; адрес возврата другого origin отклонён; после входа токена нет в `localStorage` и в URL; черновик переживает 401 и повторный вход.

## 6. Клиент: чтение и показ

- [ ] 6.1 Загрузка versions и discussions с пагинацией по `x-next-page`, отбор по блоку `c4builder-review`, кэш на загрузку и **Refresh** (design D6); панель тредов страницы (автор, время, ответы, resolve, фильтр «открытые / все»), список других страниц, плашка устаревшей сборки. Проверка: jsdom-тест с подменой `fetch` — две страницы выдачи склеиваются; discussion без блока не показан; два треда текущей страницы подсвечены с номерами, третий — в списке других страниц; `head_commit_sha` ≠ `sha` → плашка `This preview is behind the merge request`.

## 7. Клиент: создание, ответ, resolve

- [ ] 7.1 Тело discussion и блок метаданных по design D7 (цитата ≤ 200, `prefix`/`suffix` ≤ 32, путь заголовков). Проверка: jsdom-тест — тело для «foo bar» под «Flow» побайтно совпадает с примером в тесте; блок парсится обратно в те же поля.
- [ ] 7.2 Поиск строки цитаты в сыром файле без inline-разметки и разбор hunk'ов версии MR → множество добавленных строк; позиция только для добавленной строки, иначе без позиции; 400 на позицию → повтор без позиции (design D7). Проверка: тест чистых функций — цитата через `**жирный**` и `[ссылку](url)` находит строку; hunk `@@ -0,0 +1,12 @@` даёт строки 1–12; ответ 400 приводит ко второму `POST` без `position`.
- [ ] 7.3 Ответ в тред и переключение resolve от имени читателя; никакого автоматического resolve. Проверка: jsdom-тест — **Reply** шлёт note в discussion, **Resolve** шлёт `resolved=true` и прячет тред фильтром «открытые»; потеря привязки не порождает запросов на resolve.

## 8. Повторная привязка

- [ ] 8.1 Расширить `locate` контекстом `prefix`/`suffix` и проверкой единственности для **moved**; нечёткий поиск Селлерса с порогом 25% в разделе, при отсутствии раздела — по странице; статусы и ссылка compare для **outdated** (design D8). Проверка: тест на сценарии спеки `gitlab-review-plugin` — перенос абзаца → **moved**; замена слова → **changed** с исходной цитатой; удаление → **outdated**; два одинаковых фрагмента в разделе различаются по контексту; страница 50 000 символов с цитатой 200 обрабатывается быстрее 100 мс.

## 9. Строки интерфейса

- [ ] 9.1 Строки панели и плашек (en/ru) в `site.i18n.ts`, выбор языка как у вопросов (design D9). Проверка: `test/cli-language.test.mjs` зелёный; jsdom-тест панели с `language: ru` показывает русские подписи.

## 10. Актуализация

- [ ] 10.1 Страницы «06 Плагины» / «06 Plugins»: плагин `gitlab-review` — опции и умолчания из CI, заведение OAuth-приложения (не confidential, scope `api`, redirect URI), порядок первой публикации (ветка по умолчанию, затем MR), безопасность (`executeScript` в превью, unique domain), формат блока метаданных для агентов; примеры с `gitlab.example.com`. Проверка: `npx vitest run test/docs-parity.test.mjs` зелёный; `grep -rnoE "gitlab\.[a-z.]+" docs/*/src src/plugins/gitlab-review skills` находит только `gitlab.example.com`.
- [ ] 10.2 `skills/c4builder/references/plugins.md` и `references/config.md` — плагин и его опции. Проверка: `npx vitest run test/skills.test.mjs` зелёный.
- [ ] 10.3 Строка в `## Unreleased` `CHANGELOG.md`: плагин `gitlab-review`, карта страниц в `afterBuild`. Проверка: `git diff CHANGELOG.md`.
- [ ] 10.4 Итог: `npm run check`, `npm run test:unit`, `openspec validate site-gitlab-review --strict` зелёные; ручная проверка на тестовом MR: вход, комментарий к новому файлу change'а виден на вкладке Changes, ответ и resolve из MR видны на сайте, правка абзаца и пуш → **changed** на новом превью.

## Workflow follow-up

- Потребитель arch: OAuth-приложение GitLab, строка плагина в `.c4builder`, решение по `executeScript` для превью MR, пин версии c4builder в CI — отдельный MR в arch.
- Агентская сторона: `/c4builder-review` в плагине marketplace читает discussions MR по блоку `c4builder-review` и отвечает в тредах — отдельный change.
- Архивировать change после релиза и проверки на arch.
