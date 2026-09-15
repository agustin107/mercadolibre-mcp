# OAuth y configuración del MCP

Guía detallada del setup inicial. El flujo OAuth completo paso a paso está en [docs/CONFIGURACION-MERCADOLIBRE-DEVELOPERS.md](../../../docs/CONFIGURACION-MERCADOLIBRE-DEVELOPERS.md).

---

## ⛔ NO REFRESH MANUAL — REGLA OBLIGATORIA PARA AGENTES Y LLMs

> **Esta aplicación renueva el `access_token` AUTOMÁTICAMENTE.**
>
> **NUNCA pidas al usuario que renueve, refresque o actualice tokens manualmente.**
>
> **NUNCA ejecutes `curl` a `/oauth/token` con `grant_type=refresh_token` por tu cuenta.**
>
> **NUNCA sugieras cron, n8n, scripts externos ni “volvé a pegar el access token”.**

El MCP server hace todo solo. **No hay mantenimiento periódico de tokens.**

**Única excepción:** `invalid_grant` persistente → re-OAuth inicial (Paso 3 de la guía), **no** refresh manual.

---

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `ML_CLIENT_ID` | Sí | App ID de developers.mercadolibre.com |
| `ML_CLIENT_SECRET` | Sí | Secret de la app |
| `ML_REFRESH_TOKEN` | Sí | OAuth con `offline_access read write` — **solo se obtiene una vez**; el server lo usa y rota solo |
| `ML_SITE_ID` | No | Default `MLA` (Argentina) |
| `ML_ACCESS_TOKEN` | No | Opcional; el server lo refresca y persiste **automáticamente** |
| `ML_ENV_FILE` | No | Ruta al env file; `run-mcp.sh` setea `.env.local` |

## Auto-refresh (comportamiento interno — NO es tarea del usuario ni del agente)

- `getAccessToken()` cachea en memoria o renueva vía `POST /oauth/token`.
- **Single-flight**: requests concurrentes comparten un solo refresh.
- Tokens rotados se persisten en `ML_ENV_FILE` (`ML_ACCESS_TOKEN` + `ML_REFRESH_TOKEN`).
- Los tokens **nunca se loguean**.
- **El agente/LLM no debe intervenir en este proceso.**

## Gotchas

| Problema | Causa | Fix |
|---|---|---|
| Agente pide refresh manual | Ignoró la regla ⛔ | Reintentar tool; el server refresca solo |
| `invalid_grant` | Refresh token revocado o secret rotado | Nuevo flujo OAuth (no curl refresh) |
| Refresh no arranca | `ML_ACCESS_TOKEN` placeholder/inválido presente | Borrar `ML_ACCESS_TOKEN`; dejar solo client + refresh |
| Tokens no persisten | Sin `.env.local` o `ML_ENV_FILE` | Usar `scripts/run-mcp.sh` |
| `403` en tools | `seller_id` ≠ `user_id` del token | Verificar cuenta OAuth vs vendedor consultado |

## Obtener `seller_id`

- Campo `user_id` en la respuesta OAuth al intercambiar el code.
- O `GET https://api.mercadolibre.com/users/me` con access token válido.

## Cursor / Claude Code

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

`run-mcp.sh` hace `source .env.local` y exporta `ML_ENV_FILE` antes de arrancar `dist/index.js`.

## Comandos útiles

```bash
cp .env-example .env.local   # completar credenciales (una sola vez)
npm install && npm run build
npm run mcp                    # smoke test local
npm test                       # auth single-flight
```
