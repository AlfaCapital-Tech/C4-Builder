# Удаление PDF-вывода

> **Зависит от:** — (независимый cleanup; можно параллельно с `remove-plantuml-version`).
> **Порядок:** до `new-noninteractive`.

## Why

PDF-вывод в c4builder держится на `md-to-pdf`, а тот тянет headless-браузер
(puppeteer/Chromium) — тяжёлую бинарную зависимость, несовместимую с линией
модернизации «ноль внешних зависимостей, офлайн, без браузера». При этом сам
формат перестал быть востребованным: документация потребляется как сайт/markdown
(в т.ч. AI-агентами), PDF-выходы не используются. Дешевле убрать целиком, чем
тащить Chromium через TS-порт и корпоративную офлайн-сборку.

## What Changes

- **PDF-вывод удаляется полностью** (`generatePDF` и `generateCompletePDF`).
  **BREAKING** для тех, кто ещё генерирует PDF: этот тип вывода больше недоступен.
- **Зависимость `md-to-pdf` (и транзитивный puppeteer/Chromium) выкидывается** из
  `package.json`; удаляется дефолтный стиль `pdf.css` и опция `pdfCss`.
- **Совместимость легаси-конфига без падений.** При truthy `generatePDF` /
  `generateCompletePDF` в существующем `.c4builder` сборка **не падает**: печатает
  предупреждение со списком **только реально присутствующих truthy PDF-ключей** и
  подсказкой удалить их вручную, затем собирает остальные выходы (md/website) и
  завершается с кодом 0. На `false`/отсутствующих ключах — тишина. Конфиг при этом
  **не мутируется** (файл в git не «дёргается»).
- **Wizard больше не предлагает PDF.** Из чекбокса форматов уходят оба PDF-пункта,
  исчезает вопрос про `pdfCss`; PDF-ключи убираются из логики «спросить ли формат»
  (`undefined`-гейт), чтобы конфиг без PDF-ключей не ре-триггерил промпт.
- **Docs/list очищаются** от PDF-описаний и строк вывода конфигурации.

## Capabilities

### New Capabilities
- `output-formats`: какие типы вывода поддерживает сборка (multiple-md,
  complete-md, website) и как обрабатывается легаси-конфиг с удалённым PDF-выводом
  (предупреждение без падения, без мутации конфига).

### Modified Capabilities
<!-- нет: regression-testing и ci-validation уже написаны «без PDF»,
     их требования не меняются -->

## Impact

- `build.js`: удаляются `generatePDF()`, `generateCompletePDF()` и `require('md-to-pdf')`;
  оркестрация PDF заменяется веткой-предупреждением; из gate'ов создания папок и
  копирования файлов убирается `|| GENERATE_PDF`.
- `cli.js`: убираются опции `GENERATE_PDF`, `GENERATE_COMPLETE_PDF_FILE`, `PDF_CSS`
  и упоминание PDF в предупреждении watch-режима.
- `cli.collect.js`: PDF-пункты чекбокса, `undefined`-гейт и блок `pdfCss`.
- `cli.help.js` / `cli.list.js`: блоки, описывающие PDF.
- `package.json`: удаляется зависимость `md-to-pdf`; из `description`/`keywords`
  убирается PDF.
- Файл `pdf.css` удаляется.
- **Не затрагивается**: golden-fixture (`test/fixture.c4builder.json` уже с
  `generatePDF: false`, `.pdf` в эталоне нет), спеки `regression-testing` и
  `ci-validation` (уже сформулированы «без PDF»). Golden-эталон не перегенерируется.
- Место в цепочке: следует за `golden-test-ci`, предшествует TS-порту (меньше кода
  тащить в TypeScript).
