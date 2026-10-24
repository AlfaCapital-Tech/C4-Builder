# 7 Wireflow Example

`/7 Wireflow Example`

* [Overview](../README.md)
  * [1 Internet Banking System](../1%20Internet%20Banking%20System/README.md)
    * [API Application](../1%20Internet%20Banking%20System/API%20Application/README.md)
    * [API Specs](../1%20Internet%20Banking%20System/API%20Specs/README.md)
    * [Single Page Application](../1%20Internet%20Banking%20System/Single%20Page%20Application/README.md)
      * [Dynamic Diagram](../1%20Internet%20Banking%20System/Single%20Page%20Application/Dynamic%20Diagram/README.md)
      * [Extended Docs](../1%20Internet%20Banking%20System/Single%20Page%20Application/Extended%20Docs/README.md)
  * [2 Deployment](../2%20Deployment/README.md)
  * [3 Локализация](../3%20%D0%9B%D0%BE%D0%BA%D0%B0%D0%BB%D0%B8%D0%B7%D0%B0%D1%86%D0%B8%D1%8F/README.md)
  * [4 D2 Example](../4%20D2%20Example/README.md)
  * [5 BPMN Example](../5%20BPMN%20Example/README.md)
  * [6 Mermaid Example](../6%20Mermaid%20Example/README.md)
  * [**7 Wireflow Example**](../7%20Wireflow%20Example/README.md)

---

[Overview (up)](../README.md)

---

**Пользовательский сценарий Wireflow (пятый бэкенд рендера)**

Файл `checkout.wireflow.json` — экспорт редактора [Wireflow](https://github.com/vanila-io/wireflow) (кнопка «Export JSON»): сценарий оформления заказа вымышленного интернет-магазина. Группа «Оформление заказа» объединяет экраны «Корзина», «Адрес и доставка» и «Оплата» (последний — без заголовка), справа — мобильный экран «Приложение», ниже — экран «Заказ принят» и заметка. Переходы между экранами — трёх видов: скруглённая ступенька с цветом и толщиной, прямая ступенька и кривая, все с подписями.

Сборка рендерит файл сама — без браузера, сети и установки редактора: карточки экранов берутся из вендорного каталога шаблонов Wireflow, геометрия и цвета повторяют редактор, текст набирается вендорным шрифтом, поэтому картинка одинакова на любой машине. Файл так и остаётся экспортом редактора: его можно открыть в Wireflow, поправить и сохранить обратно. Отдельный файл проверяется командой `c4builder check checkout.wireflow.json`.

**Область применения**: показать, что `.wireflow.json`-файлы, их группы, карточки, заметки, рёбра и кириллица корректно попадают в собранный сайт, SVG и PNG без обращений в интернет.


![diagram](checkout.svg)