# KitMaq · MercadoLibre

Plugin de Cowork para operar la cuenta de MercadoLibre de KitMaq desde Claude: publicaciones, precio, stock, órdenes, envíos, preguntas, mensajes post-venta y analytics — con las reglas de marca y el modelo de pricing MeLi de KitMaq incorporados.

## Qué incluye

- **Conexión al MCP `mercadolibre`** (server local, 36 tools). Se levanta con `run-mcp.sh` en modo stdio.
- **Skill `operacion-mercadolibre`** — referencia que le dice a Claude qué tool usar para cada tarea, el pricing MeLi de KitMaq y las reglas de marca de cara al cliente. Se activa sola cuando hablás de MercadoLibre / Meli / publicaciones / órdenes ML.
- **Comando `/meli-ventas`** — reporte de ventas (ingresos, top productos, pagos pendientes, stock bajo).
- **Comando `/meli-precios`** — calcular/sincronizar precios aplicando el markup MeLi (×1.371).

## Requisitos

El plugin apunta al server local en:

```
/Users/anrr/code/github/mercadolibre-mcp/scripts/run-mcp.sh
```

Ese repo debe estar clonado y compilado (`npm install && npm run build`). Las credenciales de MercadoLibre viven en su propio `.env.local` (`ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REFRESH_TOKEN`, `ML_SITE_ID=MLA`). El plugin **no** pide ni maneja tokens.

Si movés el repo a otra ruta, actualizá el path en `.mcp.json`.

## ⛔ Tokens: no se refrescan a mano

El server auto-renueva el `access_token` (single-flight, persiste en `.env.local`). Nunca hay que pedir refresh manual, curl a `/oauth/token`, cron ni n8n. Si una tool falla por auth, se reintenta. Solo si hay `invalid_grant` persistente se rehace el OAuth inicial (una vez).

## Pricing MeLi (KitMaq)

```
Precio MeLi = Precio TiendaNube × 1.371   (markup plano +37,1%)
Precio Redondeado = MROUND(Precio MeLi, 100)
```

Hay tiers por rango de precio para el caso de envío gratis con costo fijo (ver el Excel `KitMaq_markup_MeLi_astroselling.xlsx`). El markup puede cambiar: confirmar contra el tracker antes de aplicar masivamente.

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
