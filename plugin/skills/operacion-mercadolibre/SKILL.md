---
name: operacion-mercadolibre
description: Referencia para operar la cuenta de MercadoLibre de KitMaq a traves del server MCP "mercadolibre" (36 tools de lectura, escritura y analytics). Usar cuando se pida listar o editar publicaciones, precio o stock; gestionar ordenes, envios y tracking; responder preguntas o mensajes post-venta; ver reputacion, competencia o metricas de ventas; o sincronizar catalogo entre TiendaNube y MercadoLibre. Indica que tool invocar para cada tarea, el modelo de pricing MeLi de KitMaq y las reglas de marca que aplican a todo el contenido de cara al cliente.
---

# Operar MercadoLibre (KitMaq)

El server MCP `mercadolibre` expone **36 tools** contra la API de MercadoLibre de la cuenta de KitMaq (site `MLA`, Argentina). Corre en modo stdio via `run-mcp.sh` y auto-renueva el token. Esta skill dice que tool usar para cada tarea, el pricing MeLi de KitMaq y que reglas respetar.

## ⛔ Tokens: NO refrescar manualmente

El server **auto-renueva el `access_token`** con `ML_REFRESH_TOKEN` (single-flight, persiste en `.env.local`). **Nunca** pedir refresh manual, ni sugerir `curl` a `/oauth/token`, cron, n8n o "pegá el access token". Si una tool falla por auth: **reintentar la tool**. Única excepción: `invalid_grant` persistente → el OAuth inicial está roto, guiar el re-OAuth (una sola vez), no un refresh manual.

## Resolver contexto antes de llamar tools

Casi todas las tools piden `seller_id` (y muchas `item_id`):

- `seller_id`: inferirlo del token/config antes de pedirlo al usuario.
- `item_id`: `list_products` o `get_item_by_sku(seller_id, sku)`.
- `order_id`: `list_orders` → `get_order` (de ahí sale `pack_id` para mensajes post-venta).
- `category_id`: `get_categories(site_id)` antes de `create_item`.

En MercadoLibre el SKU interno de KitMaq viaja en `seller_custom_field`; sirve para matchear con TiendaNube.

## Tools por dominio

### Productos (publicaciones)

- `list_products` — listar publicaciones (filtros: `status`, `limit`). Base para casi todo.
- `get_item` — detalle de una publicación por `item_id`.
- `get_item_by_sku` — buscar publicación por SKU interno.
- `update_item` — editar varios campos (título, precio, stock, status, sku). Escritura.
- `create_item` — nueva publicación. Escritura. **Confirmar antes.**
- `close_item` — pausar o cerrar (`action: pause|close`). Escritura. **Confirmar antes** si está activa.
- `update_price` — cambiar solo precio de una publicación. Escritura.
- `update_stock` — cambiar solo stock (`available_quantity`). Escritura.
- `batch_update_stock_price` — actualizar precio y/o stock de muchas publicaciones (hasta 50, secuencial). **Ideal para sincronizar precios desde el tracker.** Escritura.

### Preguntas y mensajes

- `list_questions` — preguntas pre-venta (filtros: `status` p.ej. `UNANSWERED`, `item_id`).
- `answer_question` — responder una pregunta (`question_id`, `text`). Escritura.
- `list_message_threads` — hilos de mensajería post-venta del seller.
- `get_message_thread` — un hilo por `pack_id` u `order_id`.
- `send_message` — enviar mensaje post-venta al comprador. Escritura.

### Órdenes y envíos

- `list_orders` — listar órdenes (filtros: `status`, `date_from`). Preferir sobre `get_orders` (alias legacy).
- `get_order` — detalle de una orden (incluye `pack_id`).
- `get_order_payments` — pagos de una orden.
- `list_shipments` — envíos de una orden.
- `get_shipment` — detalle de un envío por `shipment_id`.
- `update_shipment_tracking` — cargar `tracking_number` + `carrier`. Escritura.

### Analytics y pricing competitivo

- `get_revenue_summary` — ingresos de los últimos N días.
- `get_sales_by_period` — ventas entre `from` y `to`.
- `get_best_selling_products` — top N más vendidos (priorizar catálogo).
- `get_orders_dashboard` — resumen tipo dashboard de órdenes.
- `get_inventory_alerts` — publicaciones con stock bajo (`threshold`).
- `get_pending_payments` — órdenes con pago pendiente.
- `price_to_win` — precio sugerido para ganar el catálogo/Buy Box de un item.
- `price_history` — histórico de precio de un item.
- `stockout_risk` — riesgo de quiebre de stock.
- `forecast_demand` — proyección de demanda de un item.

### Otros

- `get_item_metrics` — visitas/conversión/health de una publicación.
- `manage_ads` — Product Ads de un item (`action`). Escritura.
- `get_reputation` — reputación del seller (color, métricas, reclamos).
- `search_competitors` — buscar publicaciones de la competencia por query.
- `get_categories` — árbol/predicción de categorías de MeLi.

## Patrones comunes

- **Cambiar precio/stock de un item**: `get_item_by_sku` o `list_products` → mostrar valor actual → `update_price` / `update_stock` (mostrar antes/después) → confirmar.
- **Sincronizar precios desde el tracker**: armar el lote y usar `batch_update_stock_price` (hasta 50 por llamada).
- **Responder compradores**: pre-venta `list_questions(status=UNANSWERED)` → `answer_question`; post-venta `list_message_threads` → `get_message_thread` → `send_message`.
- **Despachar**: `get_order` → `list_shipments` → `update_shipment_tracking`.
- **Reporte de ventas**: `get_revenue_summary` / `get_sales_by_period` / `get_orders_dashboard`; detalle puntual `list_orders` → `get_order`.
- **Sync TN↔ML**: matchear por SKU (`seller_custom_field` en ML = SKU en TiendaNube); comparar precio, descripción, imágenes, atributos y marca.

## Reglas de operación

- **Escrituras siempre confirmadas**: cualquier tool de crear/editar/cerrar/enviar modifica la cuenta en vivo. Mostrar el cambio propuesto y esperar el OK. Extra cuidado con `create_item`, bulk >10 items y `close_item` sobre publicaciones activas.
- **Paginar lecturas**: usar `limit`/`status`; no volcar el catálogo entero si solo se busca un item.
- **No inventar datos**: si falta un precio o costo, decirlo. No completar con estimaciones.
- **Nunca**: loguear tokens, eliminar órdenes, modificar datos de compradores, pedir refresh manual de tokens.

## Reglas de marca KitMaq (aplican a TODO contenido de cara al cliente)

Valen para títulos y descripciones de publicaciones, respuestas a preguntas, mensajes post-venta y cualquier copy que vea el comprador.

- **Capitalización**: la marca siempre se escribe **KitMaq** (K y M mayúsculas). Nunca "Kitmaq", "KITMAQ" ni "kitmaq".
- **Nunca mencionar "Litoralmaq"** en copy de cara al cliente. Es la tienda física relacionada y referencia interna; el comprador no la necesita conocer. KitMaq se posiciona como marca propia.
- **Web y handles**: dominio `kitmaq.com` (nunca `kitmaq.com.ar`). Mail `ventas@kitmaq.com`. Redes `kitmaqcom`.
- **Garantía**: 3 meses de fábrica por defecto. (Nota interna: la ley argentina exige mínimo 6 meses para bienes nuevos.)
- **Envío**: gratis dentro de Corrientes Capital; resto del NEA 24-48h con costo. En MeLi el envío se rige por Mercado Envíos según la publicación.
- **Idioma**: español argentino, voseo, tono profesional pero informal.
- **Nombres de producto del proveedor** (mayúsculas con códigos): mantenerlos tal cual, no traducir.
- **Solo máquinas y herramientas**: KitMaq no vende consumibles (alambres, discos, electrodos). No publicarlos.

## Modelo de pricing MeLi (KitMaq)

MercadoLibre tiene su **propio markup** distinto al de la web/TiendaNube, porque absorbe la comisión de MeLi y las cuotas sin interés.

**Escenario por defecto — Premium + 3 cuotas sin interés (markup plano):**

```
Precio MeLi = Precio TiendaNube × 1.371     (markup plano +37,1%)
Precio Redondeado = MROUND(Precio MeLi, 100)
```

Referencia real corroborada: P20 TN $65.000 → ML $89.115 ≈ **+37,1%**.

**Escenario alternativo — envío gratis con costo fijo:** el Excel de KitMaq (`KitMaq_markup_MeLi_astroselling.xlsx`) define markups por rango de precio (más alto en productos baratos). Usar los tiers solo si se está trabajando con envío gratis; ante la duda, usar el markup plano de 37,1%.

Al fijar/verificar un precio puntual, mostrar: precio TiendaNube base, markup aplicado y precio MeLi redondeado. Si el parámetro parece desactualizado respecto del tracker maestro, confirmar antes de aplicar.

> El multiplicador 1.371 puede haber cambiado. Ante la duda, confirmar el markup MeLi vigente con el tracker/Excel de KitMaq antes de aplicarlo masivamente.
