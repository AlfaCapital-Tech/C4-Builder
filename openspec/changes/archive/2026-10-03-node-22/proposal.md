# Proposal

## Why

Поддержка Node 20 закончилась 30.04.2026, а `engines` по-прежнему `>=20.19`. Требование «не
использовать возможности вне 20.19» держит в коде самописный glob (`src/util/glob.ts`) вместо
стабильного `fs.globSync` и закрывает дорогу зависимостям, которые уже требуют Node 22 (jsdom 30,
следующие релизы `bpmn-auto-layout` для change'а `bpmn-diagrams`). CI и Docker-образ уже
работают на Node 22/24, так что фактически поддерживаемая линейка расходится с декларируемой.

## What Changes

- **BREAKING**: `engines.node` поднимается до `>=22.17` (первая версия линейки 22, где
  `fs.glob`/`fs.globSync` объявлены стабильными). На Node 20 npm предупреждает о
  несовместимости (или отказывает при `engine-strict`).
- Самописный glob `src/util/glob.ts` заменяется на `fs.globSync` из стандартной библиотеки;
  поведение плагина `openapi` (шаблон `glob`, сортировка, пропуск `.git`, `node_modules` и
  выходных каталогов) не меняется.
- Упоминания минимальной версии Node актуализируются: README, `CLAUDE.md`, комментарии в
  коде, страницы сайта `docs/ru` и `docs/en`, скилл `c4builder-setup`, `template/AGENTS.md`;
  запись — в `CHANGELOG.md`.
- CI-матрица (Node 22 и 24) и Docker-образ (`node:24-alpine`) не меняются — они уже
  соответствуют новой границе.

## Capabilities

### New Capabilities
- (нет)

### Modified Capabilities
- `dev-toolchain`: требование «Минимальная поддерживаемая версия Node зафиксирована» —
  граница `>=20.19` меняется на `>=22.17`.

## Impact

- `package.json` (`engines`), `package-lock.json` (корневой `engines`).
- `src/util/glob.ts` — удаляется; `src/plugins/openapi/index.ts` переходит на `fs.globSync`;
  `test/plugins-source.test.mjs` и `test/dist.mjs` — тесты glob переписываются на поведение
  плагина, а не утилиты.
- Документация: README, `CLAUDE.md`, `docs/ru`, `docs/en`, `skills/c4builder-setup/SKILL.md`,
  `template/AGENTS.md`; строка в `CHANGELOG.md`.
- Потребители: арх-репа собирается Docker-образом на Node 24 — не затронута. Локальные
  установки на Node 20 получат предупреждение `EBADENGINE`.
- Change `bpmn-diagrams` зависит от этого change'а.
- Новых npm-зависимостей нет.
