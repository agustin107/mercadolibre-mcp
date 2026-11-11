---
name: operacion-mercadolibre
description: Referencia para operar la cuenta de MercadoLibre de KitMaq a traves del server MCP "mercadolibre" (40 tools de lectura, escritura y analytics). Usar cuando se pida ver publicaciones, ventas, ordenes, envios, reputacion, competencia o metricas; responder preguntas o mensajes post-venta; cargar tracking; o cuando se pida cambiar precio, stock, publicaciones o fichas en MercadoLibre (eso se hace en el sistema interno de KitMaq, no aca). Indica que tool invocar para cada tarea, a donde mandar los cambios del motor y las reglas de marca que aplican a todo el contenido de cara al cliente.
---

# Operar MercadoLibre (KitMaq)

El server MCP `mercadolibre` expone **40 tools** contra la API de MercadoLibre de la cuenta de KitMaq (site `MLA`, Argentina). Corre en modo stdio via `run-mcp.sh` y auto-renueva el token. Esta skill dice que tool usar para cada tarea, que cambios van al sistema interno y que reglas respetar.

## ⛔ Precio, stock, publicaciones y fichas: en el sistema interno, no acá

El **sistema interno de KitMaq** (conector `kitmaq-internal`) es la fuente de verdad de costos, precios (L1 mostrador/web, L2 revendedor, L3 MercadoLibre), stock por depósito, fichas y SKUs. Un **runner** programado es el único que escribe en MercadoLibre: precios, stock, altas de publicaciones y contenido, con vista previa, OK de una persona y tope por corrida. Si se cambia algo de eso desde acá, MercadoLibre queda distinto del motor y el runner lo pisa (o no) en la corrida siguiente.

Por eso, salvo que `KITMAQ_ESCRITURAS_MOTOR=permitir`, estas tools **se niegan** y devuelven a dónde ir: `update_price`, `update_stock`, `batch_update_stock_price`, `update_item`, `create_item`, `close_item`, `update_attributes`. No insistas ni busques otra tool que haga lo mismo.

| Pedido | Dónde se hace |
|---|---|
| Precio de uno o varios productos | Proponerlo en el sistema interno (ver «Cambios de precio» abajo) |
| Stock | En POSBerry; el runner lo lleva a MercadoLibre |
| Publicar un producto nuevo | «Altas en MercadoLibre» (`/precios/mercadolibre`): motivos, OK y tope por corrida |
| Título, descripción, atributos, fotos | La ficha en el sistema interno (`/precios/fichas`, `/precios/mercadolibre/datos`); se aprueba ahí |
| Pausar o cerrar una publicación | Consultarlo en el sistema interno antes de tocar el canal |

### Cambios de precio (ej. «subí 5 % las soldadoras»)

1. Leer en el sistema interno: `ver_precios` (con `buscar`) para ver los SKUs, su costo, el origen de cada lista y el vigente. Con `get_item_by_sku` / `price_to_win` / `search_competitors` de este server podés sumar contexto del canal.
2. El motor no tiene una regla por categoría. Para un grupo de productos, proponé un **precio fijo por SKU** con `cambiar_precio_fijo` (L1 y/o L3) **con `confirmar=false`**: devuelve la vista previa de qué precios cambiarían, sin guardar nada. Mostrásela a la persona. Ojo: el precio fijo queda puesto a mano y no sigue al costo; decilo. Además `cambiar_precio_fijo` reemplaza **todo** el precio fijo del SKU: lo que no mandes deja de estar fijo. Antes, mirá con `ver_precios` qué valores fijos tiene y reenviá los que tienen que quedar. Si lo que cambia es el criterio para todo el canal (markup o comisiones de L3), es `cambiar_parametros_precios` con vista previa, y eso mueve todos los productos.
3. Con el OK de la persona, `confirmar=true`: el cambio queda en la **propuesta pendiente**, no en el canal.
4. La propuesta se aprueba con `aprobar_propuesta_precios` (vista previa → `confirmar=true` con el `propuestaId` que se vio) o en `/precios/propuesta`. Recién ahí el runner la lleva a MercadoLibre (L3) y a Tienda Nube (L1).

Las herramientas de escritura del sistema interno piden el conector de una persona de KitMaq con escritura. Si no están disponibles, explicá el cambio y mandá a la pantalla de `/precios`.

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
- `get_item_description` — descripción de una publicación.
- `update_item`, `create_item`, `close_item`, `update_price`, `update_stock`, `batch_update_stock_price`, `update_attributes` — **del motor: se niegan** (ver arriba).
- `update_sale_terms` — garantía y otros términos de venta. Escritura, abierta. **Confirmar antes.**

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
- `get_categories` / `get_category_attributes` — árbol/predicción de categorías de MeLi y sus atributos.

## Patrones comunes

- **Cambiar precio/stock de un item**: no se hace acá. Mostrar el valor actual (`get_item_by_sku`) y seguir «Cambios de precio» arriba; el stock se corrige en POSBerry.
- **Responder compradores**: pre-venta `list_questions(status=UNANSWERED)` → `answer_question`; post-venta `list_message_threads` → `get_message_thread` → `send_message`.
- **Despachar**: `get_order` → `list_shipments` → `update_shipment_tracking`.
- **Reporte de ventas**: `get_revenue_summary` / `get_sales_by_period` / `get_orders_dashboard`; detalle puntual `list_orders` → `get_order`.
- **Comparar TN↔ML**: matchear por SKU (`seller_custom_field` en ML = SKU en TiendaNube) para encontrar diferencias. Lo que haya que corregir se corrige en el sistema interno; para ver qué falta en cada canal y por qué, `ver_faltantes_canal` del sistema interno.

## Reglas de operación

- **Escrituras siempre confirmadas**: las que siguen abiertas (`answer_question`, `send_message`, `update_shipment_tracking`, `update_sale_terms`, `manage_ads`) modifican la cuenta en vivo. Mostrar el cambio propuesto y esperar el OK.
- **No esquivar el candado**: si una tool del motor se niega, el cambio va al sistema interno. No pedir que se prenda `KITMAQ_ESCRITURAS_MOTOR` para resolver un pedido común.
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

## Precios de MercadoLibre

El precio de MercadoLibre es la **lista L3** del motor de precios del sistema interno, con sus propios parámetros (markup y comisiones). Esta skill no trae fórmulas: para saber cuánto sale un producto o por qué, `ver_precios` / `historial_precio` en el sistema interno (los parámetros, `ver_parametros_precios`, solo los ve KitMaq). No calcules precios a mano a partir del precio de Tienda Nube ni de planillas viejas.
