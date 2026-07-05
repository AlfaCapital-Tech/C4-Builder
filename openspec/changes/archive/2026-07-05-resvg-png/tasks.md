# Tasks: resvg-png

> Предусловие: change выполняется ТОЛЬКО после `plantuml-java-direct` и `d2-backend`
> (оба в архиве/реализованы). resvg опирается на их SVG-выход и вендорный шрифт.

## 1. Зависимость растеризатора

- [x] 1.1 Добавить `@resvg/resvg-js` в `dependencies`; зафиксировать (пин) версию
- [x] 1.2 Проверить установку prebuilt-бинаря в офлайн/корп-среде (Artifactory npm,
      linux-x64-gnu); задокументировать в README при необходимости

## 2. Модуль растеризации

- [x] 2.1 Создать `pngraster.js`: ленивый `require('@resvg/resvg-js')`, при отсутствии
      пакета — понятная ошибка с подсказкой установки
- [x] 2.2 Экспорт `rasterizeSvgToPng(svgBuffer)` с конфигом шрифта
      (`fontDirs: [vendor/fonts]`, `defaultFontFamily`, `loadSystemFonts: false`), масштаб 1:1
- [x] 2.3 Убедиться, что вход — валидный SVG обоих движков (PlantUML по имени шрифта,
      D2 со вшитым `@font-face`), кириллица отрисована

## 3. Встраивание в generateImages (build.js)

- [x] 3.1 Для PlantUML не-ditaa при `DIAGRAM_FORMAT=png` рендерить внутри `svg`
      (не `-tpng`), затем `rasterizeSvgToPng` перед `writeFile`; имя/формат выхода
      (`diagramOutputFormat` → png) и кэш не менять
- [x] 3.2 Для D2 при `png`: SVG-выход `renderD2` прогонять через `rasterizeSvgToPng`
- [x] 3.3 ditaa-ветку не трогать (нативный `png`, без растеризатора)
- [x] 3.4 Лениво инициализировать растеризатор только при наличии не-ditaa диаграмм
      и `png`; для svg/только-ditaa — не грузить

## 4. Кэш

- [x] 4.1 Проверить, что PNG кэшируется/восстанавливается как PNG (ключ по
      контенту+инклюдам, имя выхода уже учитывает формат) — регрессий нет

## 5. Верификация

- [x] 5.1 Прогон проекта с `DIAGRAM_FORMAT=png`: не-ditaa `.puml` и `.d2` дают
      валидные PNG, ссылки в md/site указывают на `.png`
- [x] 5.2 ditaa при `png` — нативный PNG, байт-в-байт как прежде (сверить с golden `ditaa.png`)
- [x] 5.3 Детерминизм: два прогона `png` дают идентичные PNG (при пине resvg)
- [x] 5.4 Кириллица в PNG корректна на машине без установленного Liberation Sans
- [x] 5.5 Основной golden (`diagramFormat=svg`) зелёный и неизменен
- [x] 5.6 (open) Решить и при необходимости добавить PNG-покрытие в тест
      (отдельный прогон/проверка идентичности), см. design Open Questions
- [x] 5.7 `openspec validate resvg-png --strict` проходит
