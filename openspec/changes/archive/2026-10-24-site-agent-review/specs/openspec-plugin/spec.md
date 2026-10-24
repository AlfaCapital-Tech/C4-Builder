# Spec Delta

## ADDED Requirements

### Requirement: Короткий адрес страницы change'а
Плагин SHALL объявлять для каждого change'а переадресацию с короткого пути `change/<id>` на его
страницу, где `<id>` — имя папки change'а без префикса даты архива. Адрес `#/change/<id>` MUST
открывать страницу change'а независимо от `mount`, `groupKey` и `nameKey`; для вложенного
change'а — его страницу по полному id. Если активного change'а с таким id нет, адрес MUST вести
на самый новый архивный с этим id.

#### Scenario: Change с кириллическим именем и группой
- **WHEN** при `nameKey: "x-name"` и `groupKey: "x-team"` change `dig-3-root` имеет `x-name: Корень задачи` и группу `Service`
- **THEN** `#/change/dig-3-root` открывает страницу `Changes/Service/Корень задачи`, адрес в браузере меняется на её путь, картинки и относительные ссылки страницы работают

#### Scenario: Change после архивации
- **WHEN** change `site-comments` перенесён в `archive/2026-10-20-site-comments`
- **THEN** `#/change/site-comments` открывает его страницу в подразделе архива

#### Scenario: Вложенный change
- **WHEN** при `parentKey` change `dig-3-root-ios` вложен в `dig-3-root`
- **THEN** `#/change/dig-3-root-ios` открывает страницу `…/dig-3-root/ios`

#### Scenario: Неизвестный id
- **WHEN** открывается `#/change/nope`, а change'а `nope` нет
- **THEN** сайт показывает стандартную страницу «не найдено» docsify
