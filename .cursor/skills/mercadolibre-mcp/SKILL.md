---
name: mercadolibre-mcp
description: Operaciones diarias de seller en Mercado Libre / Meli / MercadoLibre — 36 MCP tools de lectura, escritura y analytics (publicaciones, precio, stock, órdenes, envíos, tracking, mensajes post-venta, preguntas, Product Ads, reputación, competencia, categorías, revenue, inventario, demanda). Usá esta skill siempre que el usuario mencione Mercado Libre, Meli, publicaciones MLA/MLM/MLB, seller_id, órdenes ML, preguntas sin responder, health de items, comparar con TiendaNube, sincronizar catálogo TN↔ML, o quiera actualizar precio/stock/responder compradores/cargar tracking. ⛔ REGLA ABSOLUTA: NUNCA pedir refresh manual de tokens — el MCP server auto-renueva access_token (single-flight + persistencia en .env.local). Prohibido sugerir curl/cron/n8n para tokens. Única excepción: `invalid_grant` → re-OAuth inicial, no refresh manual.
---

# Mercado Libre MCP (operativo)

36 tools para operatoria diaria del seller. Nombres alineados con [tiendanube-mcp](https://github.com/MarcosNahuel/tiendanube-mcp) para sync cross-platform.

---

## ⛔ NO REFRESH MANUAL — REGLA OBLIGATORIA PARA AGENTES Y LLMs

> **Esta aplicación renueva el `access_token` AUTOMÁTICAMENTE.**
>
> **NUNCA pidas al usuario que renueve, refresque o actualice tokens manualmente.**
>
> **NUNCA ejecutes `curl` a `/oauth/token` con `grant_type=refresh_token` por tu cuenta.**
>
> **NUNCA sugieras cron, n8n, scripts externos ni “volvé a pegar el access token” para mantener la sesión.**

El MCP server hace todo solo:

- Detecta expiración / `401` y refresca con `ML_REFRESH_TOKEN`
- **Single-flight**: un solo refresh aunque haya muchas tools en paralelo
- Persiste tokens rotados en `.env.local` vía `ML_ENV_FILE`
- Los tokens **nunca se loguean**

**Única excepción:** `invalid_grant` persistente → el OAuth inicial está roto; guiá al [flujo OAuth completo](../../../docs/CONFIGURACION-MERCADOLIBRE-DEVELOPERS.md#paso-3--obtener-el-refresh-token-flujo-oauth), **no** a un refresh manual.

Si una tool falla con auth: **reintentá la tool** o diagnosticá config/scopes. **No** pidas tokens al usuario.

---

## Flujo de trabajo

### 1. Resolver contexto antes de llamar tools

| Necesitás | Cómo obtenerlo |
|---|---|
| `seller_id` | `user_id` del OAuth o `GET /users/me` — casi todas las tools lo piden |
| `item_id` | `list_products`, `get_item_by_sku(seller_id, sku)` o respuesta previa |
| `order_id` | `list_orders` → `get_order` para `pack_id` (mensajes post-venta) |
| `category_id` | `get_categories(site_id)` o `domain_discovery` antes de `create_item` |

Si el usuario no da `seller_id`, intentá inferirlo del token/config antes de pedirlo.

### 2. Elegir la tool correcta

| Intención del usuario | Tool(s) |
|---|---|
| Ver catálogo activo | `list_products` → `get_item` para detalle |
| Buscar por SKU interno | `get_item_by_sku` |
| Cambiar precio o stock | `update_price` / `update_stock` (confirman antes→después) |
| Cambiar varios campos | `update_item` |
| Muchos items | `batch_update_stock_price` (máx 50, secuencial) |
| Nueva publicación | `get_categories` → `create_item` (**confirmar antes**) |
| Pausar/cerrar | `close_item` (**confirmar antes**) |
| Ventas / ingresos | `get_revenue_summary`, `get_sales_by_period`, `get_orders_dashboard` |
| Stock bajo / quiebre | `get_inventory_alerts`, `stockout_risk` |
| Pricing competitivo | `price_to_win`, `price_history`, `search_competitors` |
| Post-venta | `list_message_threads` → `get_message_thread` → `send_message` |
| Preguntas pre-venta | `list_questions` → `answer_question` |
| Envío | `list_shipments(order_id)` → `update_shipment_tracking` |
| Sync TN↔ML | Matchear por SKU (`seller_custom_field` en ML = SKU TN); comparar descripción, imgs, atributos, marca |

Preferí `list_orders` sobre `get_orders` (alias legacy).

### 3. Auth — el server refresca solo (NO TOCAR)

Ver banner **⛔ NO REFRESH MANUAL** arriba. Resumen:

- El MCP renueva `access_token` con `ML_REFRESH_TOKEN` — **sin intervención humana ni del agente**
- Persiste rotaciones en `.env.local` vía `ML_ENV_FILE`
- Single-flight evita doble refresh

Detalle: [references/oauth-setup.md](./references/oauth-setup.md). OAuth inicial (una sola vez): [docs/CONFIGURACION-MERCADOLIBRE-DEVELOPERS.md](../../../docs/CONFIGURACION-MERCADOLIBRE-DEVELOPERS.md).

| Situación | Qué hacer | Qué NO hacer |
|---|---|---|
| Tool falla una vez | Reintentar la tool | Pedir refresh manual |
| `401` transitorio | Reintentar; el server refresca solo | Pedir nuevo access token |
| `invalid_grant` persistente | Guiar re-OAuth inicial | curl refresh, cron, n8n |

## Tools (36)

### Productos (9)

| Tool | Tipo | Input principal |
|---|---|---|
| `list_products` | Lectura | seller_id, status, limit |
| `get_item` | Lectura | item_id |
| `get_item_by_sku` | Lectura | seller_id, sku |
| `update_item` | Escritura | item_id, title, price, stock, status, sku |
| `create_item` | Escritura | title, category_id, price, stock, picture_url |
| `close_item` | Escritura | item_id, action (pause/close) |
| `batch_update_stock_price` | Escritura | updates[] (hasta 50) |
| `update_price` | Escritura | item_id, price |
| `update_stock` | Escritura | item_id, available_quantity |

### Preguntas y mensajes (5)

| Tool | Tipo | Input principal |
|---|---|---|
| `list_questions` | Lectura | seller_id, status, item_id |
| `answer_question` | Escritura | question_id, text |
| `list_message_threads` | Lectura | seller_id |
| `get_message_thread` | Lectura | seller_id, pack_id u order_id |
| `send_message` | Escritura | seller_id, text, pack_id u order_id |

### Órdenes y envíos (7)

| Tool | Tipo | Input principal |
|---|---|---|
| `list_orders` | Lectura | seller_id, status, date_from |
| `get_orders` | Lectura | alias legacy → usar `list_orders` |
| `get_order` | Lectura | order_id |
| `get_order_payments` | Lectura | order_id |
| `list_shipments` | Lectura | order_id |
| `get_shipment` | Lectura | shipment_id |
| `update_shipment_tracking` | Escritura | shipment_id, tracking_number, carrier |

### Analytics (10)

| Tool | Tipo | Input principal |
|---|---|---|
| `get_revenue_summary` | Lectura | seller_id, days |
| `get_sales_by_period` | Lectura | seller_id, from, to |
| `get_best_selling_products` | Lectura | seller_id, days, limit |
| `get_orders_dashboard` | Lectura | seller_id, days |
| `get_inventory_alerts` | Lectura | seller_id, threshold |
| `get_pending_payments` | Lectura | seller_id, hours |
| `price_to_win` | Lectura | seller_id, item_id |
| `price_history` | Lectura | seller_id, item_id, days |
| `stockout_risk` | Lectura | seller_id, days, limit |
| `forecast_demand` | Lectura | seller_id, item_id, days |

### Otros (5)

| Tool | Tipo | Input principal |
|---|---|---|
| `get_item_metrics` | Lectura | item_id |
| `manage_ads` | Escritura | item_id, action |
| `get_reputation` | Lectura | seller_id |
| `search_competitors` | Lectura | query, site_id |
| `get_categories` | Lectura | site_id, category_id |

## Ejemplos

```
User: "¿cuántas preguntas sin responder?"
→ list_questions({ seller_id, status: "UNANSWERED" })

User: "stock del SKU I140-6-220 a 10"
→ get_item_by_sku → update_stock (mostrar antes/después)

User: "ingresos del mes y productos con stock bajo"
→ get_revenue_summary({ days: 30 }) + get_inventory_alerts({ threshold: 5 })

User: "compará TN vs ML por SKU"
→ list_products + tiendanube list_products → matchear SKU → gap analysis
```

## Errores comunes

| Error | Acción |
|---|---|
| `401` | Reintentar tool; si persiste → [oauth-setup.md](./references/oauth-setup.md). **No pedir refresh manual** |
| `invalid_grant` | OAuth inicial de nuevo |
| `403` | `seller_id` ≠ cuenta del token, o scopes insuficientes |
| `429` | Client reintenta; esperar si persiste |

## Boundaries

Confirmar antes de: `create_item`, bulk >10 items, `close_item` en activas.

Nunca: loguear tokens, eliminar órdenes, modificar datos de compradores, **pedir refresh manual de tokens**, sugerir curl/cron/n8n para auth.

## Otros MCPs

- `mercadolibre/mercadolibre-mcp-server` → solo docs, no seller ops
- `tiendanube-mcp` → paridad de nombres para sync TN↔ML
