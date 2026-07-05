# Tasks: remove-pdf

## 1. Рендер в build.js

- [ ] 1.1 Удалить `require('md-to-pdf')` (строка 9)
- [ ] 1.2 Удалить функцию `generateCompletePDF()` целиком
- [ ] 1.3 Удалить функцию `generatePDF()` целиком
- [ ] 1.4 В оркестрации заменить `if (options.GENERATE_PDF)` / `if (options.GENERATE_COMPLETE_PDF_FILE)`
      единой веткой-предупреждением (см. задачу 4)
- [ ] 1.5 В gate создания dist-папок убрать дизъюнкт `|| options.GENERATE_PDF` (оставить MD/WEBSITE)
- [ ] 1.6 В gate копирования прочих файлов убрать `|| options.GENERATE_PDF`; проверить, что
      `GENERATE_COMPLETE_PDF_FILE`-ветка копирования в корень уходит вместе с complete-PDF

## 2. Конфиг и опции (cli.js)

- [ ] 2.1 Убрать из `getOptions` ключи `GENERATE_PDF`, `GENERATE_COMPLETE_PDF_FILE`, `PDF_CSS`
- [ ] 2.2 Убрать упоминание PDF из предупреждения watch-режима (строки 147-148)

## 3. Мастер настройки (cli.collect.js)

- [ ] 3.1 Убрать оба PDF-пункта (`generatePDF`, `generateCompletePDF`) из чекбокса форматов
      и соответствующие `conf.set(...)`
- [ ] 3.2 Убрать PDF-ключи из `undefined`-гейта, решающего, показывать ли вопрос формата,
      и из массива `defaults`
- [ ] 3.3 Удалить блок вопроса про `pdfCss` и его `conf.set('pdfCss', ...)`

## 4. Предупреждение для легаси-конфига

- [ ] 4.1 В точке 1.4 собрать список truthy PDF-ключей из конфига
      (`generatePDF`, `generateCompletePDF`) — только реально присутствующие/истинные
- [ ] 4.2 Если список непуст — напечатать предупреждение: PDF-вывод удалён, перечислить
      эти ключи, подсказать удалить их из `.c4builder` вручную; сборку не прерывать (exit 0)
- [ ] 4.3 Убедиться, что конфиг НЕ мутируется (никаких `conf.delete`/`conf.set`)
- [ ] 4.4 На `false`/отсутствующих ключах предупреждение не печатается

## 5. Docs и list

- [ ] 5.1 `cli.help.js`: удалить блоки про «Generate multiple pdf files»,
      «Generate a single complete pdf file», «Custom PDF CSS»
- [ ] 5.2 `cli.list.js`: удалить строки вывода `GENERATE_PDF`, `GENERATE_COMPLETE_PDF_FILE`,
      `PDF_CSS`

## 6. Зависимости и ассеты

- [ ] 6.1 Удалить `md-to-pdf` из `dependencies` в `package.json`; `npm install` для обновления lock
- [ ] 6.2 Убрать «PDF» из `description` и `keywords` в `package.json`
- [ ] 6.3 Удалить файл `pdf.css`

## 7. Верификация

- [ ] 7.1 `grep -rniE "pdf|md-to-pdf|puppeteer"` по `*.js`/`package.json` — не осталось
      живого PDF-кода (кроме осознанного текста предупреждения)
- [ ] 7.2 Прогнать golden-тест: дерево выходов и эталон не изменились, тест зелёный
- [ ] 7.3 Ручная проверка: конфиг с `generatePDF: true` → печатается предупреждение,
      md/website собираются, exit 0, `.c4builder` не изменён; конфиг с `false` → тишина
- [ ] 7.4 `openspec validate remove-pdf --strict` проходит
