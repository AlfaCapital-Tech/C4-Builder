# Tasks: template-offline

## 1. Инклюды

- [x] 1.1 Заменить URL-инклюды на stdlib `!include <C4/...>` в 6 файлах `template/src/**/*.puml` (context, system, 2×container, dynamic, deployment)
- [x] 1.2 Перевести `vendor/C4-PlantUML/C4.code-snippets` (5 вхождений) на stdlib-инклюды

## 2. Новый контент демо

- [x] 2.1 Добавить общий `template/src/styles.iuml` (тема/цвета) и подключить его относительным `!include` из двух существующих диаграмм
- [x] 2.2 Добавить страницу с кириллицей: md с русским текстом + C4-диаграмма с русскими подписями элементов
- [x] 2.3 Упомянуть stdlib-инклюды и `.iuml`-паттерн в `template/readme.md`

## 3. Проверка

- [x] 3.1 Создать проект из шаблона (вручную скопировать `template/src` + конфиг), собрать локальным JAR без сети, глазами проверить SVG (stdlib, .iuml-стили, кириллица, ditaa)
- [x] 3.2 Убедиться `grep -r "include http" template/ vendor/C4-PlantUML/` пуст; при проблеме с ditaa — заменить диаграмму и зафиксировать в design
