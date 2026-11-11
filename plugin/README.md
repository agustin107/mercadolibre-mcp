# KitMaq · MercadoLibre

Plugin de Cowork para operar la cuenta de MercadoLibre de KitMaq desde Claude: consultar publicaciones, órdenes, envíos, reputación y analytics; responder preguntas y mensajes post-venta; cargar tracking — con las reglas de marca de KitMaq. Precio, stock, altas y fichas se cambian en el sistema interno de KitMaq y los lleva al canal el runner.

## Qué incluye

- **Conexión al MCP `mercadolibre`** (server local, 40 tools). Se levanta con `run-mcp.sh` en modo stdio.
- **Skill `operacion-mercadolibre`** — referencia que le dice a Claude qué tool usar para cada tarea, qué cambios van al sistema interno y las reglas de marca de cara al cliente. Se activa sola cuando hablás de MercadoLibre / Meli / publicaciones / órdenes ML.
- **Comando `/meli-ventas`** — reporte de ventas (ingresos, top productos, pagos pendientes, stock bajo).
- **Comando `/meli-precios`** — ver precios publicados contra el motor y proponer cambios en el sistema interno.

## Requisitos

El plugin apunta al server local en:

```
/Users/anrr/code/github/mercadolibre-mcp/scripts/run-mcp.sh
```

Ese repo debe estar clonado y compilado (`npm install && npm run build`). Las credenciales de MercadoLibre viven en su propio `.env.local` (`ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REFRESH_TOKEN`, `ML_SITE_ID=MLA`). El plugin **no** pide ni maneja tokens.

Si movés el repo a otra ruta, actualizá el path en `.mcp.json`.

## ⛔ Tokens: no se refrescan a mano

El server auto-renueva el `access_token` (single-flight, persiste en `.env.local`). Nunca hay que pedir refresh manual, curl a `/oauth/token`, cron ni n8n. Si una tool falla por auth, se reintenta. Solo si hay `invalid_grant` persistente se rehace el OAuth inicial (una vez).

## Precios, stock, publicaciones y fichas

Los escribe el runner del sistema interno de KitMaq (conector `kitmaq-internal`), con vista previa, OK y tope por corrida. Las tools del server que los tocan (`update_price`, `update_stock`, `batch_update_stock_price`, `update_item`, `create_item`, `close_item`, `update_attributes`) se niegan salvo `KITMAQ_ESCRITURAS_MOTOR=permitir` en el `.env.local` del server. El precio de MercadoLibre es la lista L3 del motor; el plugin no trae fórmulas.

## Estructura

```
kitmaq-mercadolibre/
├── .claude-plugin/plugin.json
├── .mcp.json
├── commands/
│   ├── meli-ventas.md
│   └── meli-precios.md
├── skills/
│   └── operacion-mercadolibre/SKILL.md
└── README.md
```
