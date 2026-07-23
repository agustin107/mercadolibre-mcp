# Mercado Libre MCP Server

> MCP server **operativo** para Mercado Libre. 36 tools de consulta, escritura y analytics para la operatoria diaria del seller.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

Hecho por [TRAID Agency](https://traid.agency).

## Tools incluidas

### Productos (9)
| Tool | Tipo |
|------|------|
| `list_products` | Lectura |
| `get_item` | Lectura |
| `get_item_by_sku` | Lectura |
| `update_item` | Escritura |
| `create_item` | Escritura |
| `close_item` | Escritura |
| `batch_update_stock_price` | Escritura |
| `update_price` | Escritura |
| `update_stock` | Escritura |

### Preguntas y mensajes (5)
| Tool | Tipo |
|------|------|
| `list_questions` | Lectura |
| `answer_question` | Escritura |
| `list_message_threads` | Lectura |
| `get_message_thread` | Lectura |
| `send_message` | Escritura |

### Órdenes y envíos (7)
| Tool | Tipo |
|------|------|
| `list_orders` / `get_orders` | Lectura |
| `get_order` | Lectura |
| `get_order_payments` | Lectura |
| `list_shipments` | Lectura |
| `get_shipment` | Lectura |
| `update_shipment_tracking` | Escritura |

### Analytics (10)
| Tool | Tipo |
|------|------|
| `get_revenue_summary` | Lectura |
| `get_sales_by_period` | Lectura |
| `get_best_selling_products` | Lectura |
| `get_orders_dashboard` | Lectura |
| `get_inventory_alerts` | Lectura |
| `get_pending_payments` | Lectura |
| `price_to_win` | Lectura |
| `price_history` | Lectura |
| `stockout_risk` | Lectura |
| `forecast_demand` | Lectura |

### Otros (4)
| Tool | Tipo |
|------|------|
| `get_item_metrics` | Lectura |
| `manage_ads` | Escritura |
| `get_reputation` | Lectura |
| `search_competitors` | Lectura |
| `get_categories` | Lectura |

Nombres alineados con [tiendanube-mcp](https://github.com/MarcosNahuel/tiendanube-mcp) donde la operación es equivalente, para futura sincronización cross-platform.

## Instalación

```bash
git clone https://github.com/MarcosNahuel/mercadolibre-mcp-read
cd mercadolibre-mcp-read
npm install
npm run build
```

## Configuración

> ## ⛔ NO REFRESH MANUAL
>
> **El MCP renueva el `access_token` automáticamente.** No hace falta cron, n8n, curl periódico ni que el usuario/agente pegue tokens cada 6 horas. Configurá OAuth **una vez** y listo.
>
> Ver [references/oauth-setup.md](./references/oauth-setup.md) y la guía completa abajo.

Guía OAuth (scopes `read` + `write` + `offline_access`): **[docs/CONFIGURACION-MERCADOLIBRE-DEVELOPERS.md](./docs/CONFIGURACION-MERCADOLIBRE-DEVELOPERS.md)**.

### Opción A (recomendada): `.env.local` + script bash

1. Copiá `.env-example` → `.env.local` y completá las variables.
2. `npm install && npm run build`
3. Configurá Cursor / Claude Code:

```json
{
  "mcpServers": {
    "mercadolibre": {
      "command": "bash",
      "args": ["/ruta/absoluta/a/mercadolibre-mcp/scripts/run-mcp.sh"]
    }
  }
}
```

## Comandos

```bash
npm run dev     # desarrollo
npm run mcp     # producción con .env.local
npm run build   # compilar
npm test        # tests de auth
```

## Ejemplos de uso

```
User: ¿cuántas preguntas sin responder tengo?
Agent: [list_questions con status UNANSWERED]

User: actualizá el stock del MLA1234567890 a 15 unidades
Agent: [update_stock]

User: dame el resumen de ingresos del último mes
Agent: [get_revenue_summary]
```

## Spec

Ver [SPEC.md](./SPEC.md) para arquitectura, fases y boundaries.

## Licencia

MIT © 2026 TRAID Agency
