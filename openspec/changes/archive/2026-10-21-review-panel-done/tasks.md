## 1. Панель review

- [x] 1.1 В `src/cli/commands/site.comments.ts` кнопки панели зависят от черновика: при пустом черновике видна только основная кнопка «Done — no changes» (то же действие `approved`, что у Approve), Discard и Submit review скрыты; при замечаниях — Discard, Approve, Submit review, основная — Submit review. Проверка: тесты 1.2.
- [x] 1.2 В `test/site-comments-client.test.mjs` обновить тест «Approve при пустом черновике»: на пустой панели есть «Done — no changes», нет видимых Discard и Submit review, клик шлёт `{ decision: 'approved', comments: [] }`. Добавить: после Discard с подтверждением панель показывает Done, запросов агенту нет; Approve с одним замечанием шлёт его с `approved`; после Submit review панель возвращается к Done. Проверка: `npx vitest run test/site-comments-client.test.mjs` зелёный.

## 2. Актуализация

- [x] 2.1 Страница «08 Агенты» в `docs/ru/src` и `docs/en/src`: описать кнопку «Done — no changes» на пустой панели и то, что Discard только очищает черновик. Проверка: тест `docs-parity` зелёный.
- [x] 2.2 Строка в `## Unreleased` CHANGELOG.md: пустая панель review завершается кнопкой «Done — no changes», Discard и Submit review появляются, когда в черновике есть замечания. Проверка: `npm test` и `npm run check` зелёные.
