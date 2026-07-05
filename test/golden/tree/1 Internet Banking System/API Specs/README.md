# API Specs

`/1 Internet Banking System/API Specs`

* [Overview](../../README.md)
  * [1 Internet Banking System](../../1%20Internet%20Banking%20System/README.md)
    * [API Application](../../1%20Internet%20Banking%20System/API%20Application/README.md)
    * [**API Specs**](../../1%20Internet%20Banking%20System/API%20Specs/README.md)
    * [Single Page Application](../../1%20Internet%20Banking%20System/Single%20Page%20Application/README.md)
      * [Dynamic Diagram](../../1%20Internet%20Banking%20System/Single%20Page%20Application/Dynamic%20Diagram/README.md)
      * [Extended Docs](../../1%20Internet%20Banking%20System/Single%20Page%20Application/Extended%20Docs/README.md)
  * [2 Deployment](../../2%20Deployment/README.md)
  * [3 Локализация](../../3%20%D0%9B%D0%BE%D0%BA%D0%B0%D0%BB%D0%B8%D0%B7%D0%B0%D1%86%D0%B8%D1%8F/README.md)
  * [4 D2 Example](../../4%20D2%20Example/README.md)

---

[1 Internet Banking System (up)](../../1%20Internet%20Banking%20System/README.md)

---

<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta
    name="description"
    content="SwaggerIU"
  />
  <title>SwaggerUI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@4.5.0/swagger-ui.css" />
</head>
<body>
<div id="swagger-ui"></div>
<script>
  window.onload = () => {
    window.ui = SwaggerUIBundle({
      url: 'https://petstore3.swagger.io/api/v3/openapi.json',
      dom_id: '#swagger-ui',
    });
  };
</script>
</body>
</html>
