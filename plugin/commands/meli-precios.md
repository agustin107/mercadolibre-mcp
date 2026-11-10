---
description: Calcular/actualizar precios de KitMaq en MercadoLibre aplicando el markup MeLi.
---

Ayuda a fijar o sincronizar precios de las publicaciones de KitMaq en MercadoLibre usando el server MCP `mercadolibre` y el modelo de pricing MeLi de KitMaq.

Entrada del usuario: "$ARGUMENTS" (puede ser un SKU, una lista, "todas", o un pedido tipo "subí 5% las soldadoras").

Modelo de pricing MeLi (KitMaq):

```
Precio MeLi = Precio TiendaNube × 1.371     (markup plano +37,1%, Premium + 3 cuotas s/interés)
Precio Redondeado = MROUND(Precio MeLi, 100)
```

Pasos:

1. Identificá las publicaciones objetivo: `get_item_by_sku` para un SKU puntual, o `list_products` para varias.
2. Para cada una, mostrá: **precio actual en ML**, precio TiendaNube base (si se conoce o se pasa), markup aplicado y **precio MeLi propuesto redondeado**. Desglosá la fórmula.
3. **Confirmá con el usuario antes de escribir.** Nunca actualices precios sin OK explícito.
4. Al aplicar: `update_price` para un item, o `batch_update_stock_price` para varios (hasta 50 por llamada). Mostrá antes/después.
5. Si falta el precio base o el markup vigente parece desactualizado respecto del tracker de KitMaq, avisá y confirmá antes de aplicar masivamente. No inventes precios.

Reglas: español argentino, voseo. Marca siempre **KitMaq**. Todo cambio de precio es una escritura en vivo → confirmación obligatoria.
