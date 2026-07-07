# build-pipeline Specification

## Purpose
TBD - created by archiving change ts-scaffold. Update Purpose after archive.
## Requirements
### Requirement: Исходники на TypeScript и ESM

Исходный код CLI SHALL быть написан на TypeScript в модульной системе ESM.
Все модули под `src/` MUST иметь расширение `.ts`; `package.json` MUST
декларировать `"type": "module"`; модули MUST использовать `import`/`export`
(не `require`/`module.exports`) и лежать под `src/`, организованные по доменам
(`cli/`, `core/`, `config/`, `util/`). Компиляция MUST проходить в режиме
`strict` без ошибок.

#### Scenario: Модульный формат исходников
- **WHEN** просматривается любой модуль под `src/`
- **THEN** это `.ts`-файл с ESM-синтаксисом (`import`/`export`), а `package.json` содержит `"type": "module"`

#### Scenario: Строгая компиляция
- **WHEN** выполняется `npm run build`
- **THEN** `tsc` компилирует все модули `src/` в режиме `strict` без ошибок

#### Scenario: Ресурсы вне компиляции доступны из собранного кода
- **WHEN** собранный модуль обращается к вендорным ресурсам (`vendor/`) или шаблону (`template/`)
- **THEN** путь резолвится к корню пакета через `import.meta.url`, а не к каталогу внутри `dist/`, и рендер/скаффолд находят JAR, шрифты и шаблон

### Requirement: Компиляция tsc → dist/ без бандлера

Проект SHALL компилироваться `tsc` в каталог `dist/` без бандлера. `tsconfig.json`
MUST задавать `module`/`moduleResolution` `nodenext`, `outDir: dist`, `rootDir: src`.
Относительные импорты в исходниках MUST указывать расширение `.ts`
(`allowImportingTsExtensions`), а `tsc` MUST переписывать их в `.js` в эмите
(`rewriteRelativeImportExtensions`). `allowJs` MUST быть выключен: `.js`-модули
под `src/` не допускаются.

#### Scenario: Сборка порождает dist
- **WHEN** выполняется `npm run build`
- **THEN** `tsc` компилирует `src/**` в `dist/**` с расширениями `.js`, без бандлинга

#### Scenario: Расширения импортов переписываются
- **WHEN** исходный модуль содержит `import './render/diagram.ts'`
- **THEN** в соответствующем файле `dist/` импорт эмитится как `import './render/diagram.js'`

#### Scenario: Смесь .ts/.js запрещена
- **WHEN** под `src/` появляется `.js`-модуль
- **THEN** он не входит в компиляцию (`allowJs: false`) и сборка не может на него ссылаться

### Requirement: CLI запускается из собранного dist/

Опубликованный и локально собранный CLI SHALL исполняться из `dist/`. Поля `bin`
и `main` в `package.json` MUST указывать на `dist/index.js`; точка входа MUST
сохранять shebang `#!/usr/bin/env node`.

#### Scenario: Запуск собранного CLI
- **WHEN** после `npm run build` выполняется `node dist/index.js --help`
- **THEN** CLI выводит справку (эквивалентно запуску до порта)

#### Scenario: bin установленного пакета указывает на dist
- **WHEN** пакет установлен и вызвана команда `c4builder`
- **THEN** запускается `dist/index.js`

### Requirement: Порт сохраняет наблюдаемое поведение

Переход на TypeScript/ESM MUST NOT менять наблюдаемое поведение CLI: вывод сборки
(сайт/markdown, диаграммы), формат конфига `.c4builder` и совместимость с
конфигом потребителя MUST оставаться прежними. Golden-набор MUST проходить без
регенерации эталонов.

#### Scenario: Golden-паритет
- **WHEN** golden-набор прогоняется на собранном из `dist/` CLI
- **THEN** результат совпадает с эталонами без их обновления

