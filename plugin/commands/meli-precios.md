---
description: Ver precios de KitMaq en MercadoLibre y proponer cambios en el sistema interno (el runner los lleva al canal).
---

Ayuda a revisar o cambiar precios de las publicaciones de KitMaq en MercadoLibre. Los precios **no se escriben desde acá**: el precio de MercadoLibre es la lista L3 del motor de precios del sistema interno de KitMaq (conector `kitmaq-internal`), y un runner es el único que lo escribe en el canal.

Entrada del usuario: "$ARGUMENTS" (puede ser un SKU, una lista, "todas", o un pedido tipo "subí 5% las soldadoras").

Pasos:

1. Identificá los productos: `ver_precios` del sistema interno (`sku` o `buscar`) da costo, L1, L3, el origen de cada precio y si hay una propuesta pendiente. Si sirve, sumá del server `mercadolibre` el precio publicado (`get_item_by_sku`) y el contexto del canal (`price_to_win`, `search_competitors`, `price_history`).
2. Mostrá por producto: precio publicado en ML, L3 vigente del motor, su origen y, si hay diferencia entre canal y motor, señalala (la corrige el runner, no vos).
3. Si piden un cambio:
   - Un ajuste por producto o grupo de productos → `cambiar_precio_fijo` con `confirmar=false` para ver qué precios cambiarían. Aclará que un precio fijo no sigue al costo, y que `cambiar_precio_fijo` reemplaza todo el precio fijo del SKU: mirá antes con `ver_precios` los valores fijos que tiene y reenviá los que tienen que quedar.
   - Un cambio de criterio para todo el canal → `cambiar_parametros_precios` con `confirmar=false` (mueve todos los productos).
   - Mostrá la vista previa y **esperá el OK explícito** antes de `confirmar=true`. El cambio queda en la propuesta pendiente.
4. La propuesta se aprueba con `aprobar_propuesta_precios` (vista previa, después `confirmar=true` con el `propuestaId` que se vio) o en `/precios/propuesta`. Ahí el runner lo lleva a MercadoLibre y Tienda Nube.
5. Si las herramientas de escritura del sistema interno no están disponibles, explicá el cambio y mandá a `/precios`. No uses `update_price` ni `batch_update_stock_price`: se niegan a propósito. No calcules precios con fórmulas propias ni inventes valores.

Reglas: español argentino, voseo. Marca siempre **KitMaq**.
