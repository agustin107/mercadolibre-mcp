# SPEC: MercadoLibre MCP — Expansión operativa

## Objective

Convertir mercadolibre-mcp en un MCP operativo diario para sellers ML: lectura + escritura (precio, stock, publicaciones, preguntas, mensajes, envíos) + analytics accionables, con naming alineado a tiendanube-mcp para futura sincronización TN↔ML.

**Target user**: vendedor/operador que gestiona Mercado Libre desde Claude Code/Cursor.

**Success criteria**:
- ≥35 tools registradas (Fases 0–5) — actual: 36
- Operaciones TN-parity críticas cubiertas (productos, órdenes, analytics, envíos)
- `npm run build` limpio; `npm test` pasa
- Scopes `read` + `write` + `offline_access` documentados
- **Auto-refresh de tokens sin intervención manual** — agentes/LLMs no deben pedir refresh

## ⛔ Regla para agentes

El MCP renueva `access_token` automáticamente. Prohibido pedir refresh manual, curl a `/oauth/token`, cron o n8n para tokens. Solo re-OAuth si `invalid_grant`.

## Tech Stack

- Node ≥18, TypeScript 5.7, ESM
- `@modelcontextprotocol/sdk` ^1.27, `zod` ^3.24
- ML API: `https://api.mercadolibre.com`

## Commands

```bash
npm run dev          # tsx src/index.ts
npm run mcp          # bash scripts/run-mcp.sh
npm run build        # tsc → dist/
npm test             # node --test tests/
```

## Project Structure

```
src/
  index.ts              # Registro de tools
  auth.ts               # OAuth + single-flight auto-refresh (sin intervención manual)
  env-file.ts           # Persistencia .env.local
  client.ts             # mlFetch + mlGetAll
  types.ts
  tools/
    products.ts         # list, get, create, update, close, batch
    pricing.ts          # update_price
    stock.ts            # update_stock
    questions.ts        # list + answer
    messages.ts         # post-venta
    orders.ts           # list_orders, get_order, payments
    shipments.ts        # envíos/tracking
    analytics.ts        # 6 tools compuestas
    advanced-analytics.ts
    metrics.ts, ads.ts, reputation.ts, competitors.ts, categories.ts
tests/
  auth-security.test.ts
docs/
  CONFIGURACION-MERCADOLIBRE-DEVELOPERS.md
```

## Code Style

- `server.tool(name, description, zodShape, handler)` → `{ content: [{ type: 'text', text }] }`
- Tool names: `snake_case`, alineados a TN donde aplique
- Validación Zod en todos los params
- Respuestas: resumen humano + JSON para writes

## Testing Strategy

- `node:test` — auth single-flight + no token logging
- Manual smoke vía MCP client por fase
- Analytics: cross-check contra panel ML seller

## Boundaries

**Always:**
- Validar inputs con Zod
- Paginar automáticamente en analytics
- Confirmar precio/stock anterior vs nuevo en writes
- Persistir tokens renovados en `.env.local`

**Ask first:**
- `create_item` en producción
- Bulk updates >10 items
- Pausar/cerrar publicaciones activas

**Never:**
- Loguear tokens o secrets
- Eliminar órdenes
- Modificar datos de compradores
- Commitear `.env.local`

## Fases de implementación

| Fase | Tools |
|------|-------|
| 0 | Foundation: auth, mlGetAll, tests |
| 1 | update_price, update_stock, answer_question, manage_ads |
| 2 | get_item, get_item_by_sku, update_item, create_item, close_item, batch_update_stock_price |
| 3 | get_order, list_orders, get_order_payments, shipments, messages |
| 4 | 6 analytics (mismos nombres TN) |
| 5 | price_to_win, price_history, stockout_risk, forecast_demand |
