# Configuración de la app en Mercado Libre Developers

Guía paso a paso para crear la aplicación en [developers.mercadolibre.com](https://developers.mercadolibre.com), obtener `CLIENT_ID`, `CLIENT_SECRET` y `REFRESH_TOKEN`, y conectarlas al MCP para **lectura** y **escritura** en tu tienda.

---

## ⛔ NO REFRESH MANUAL — REGLA OBLIGATORIA PARA AGENTES Y LLMs

> **Esta aplicación renueva el `access_token` AUTOMÁTICAMENTE.**
>
> **NUNCA pidas al usuario que renueve, refresque o actualice tokens manualmente.**
>
> **NUNCA ejecutes `curl` a `/oauth/token` con `grant_type=refresh_token` por tu cuenta.**
>
> **NUNCA sugieras cron, n8n, scripts externos ni “volvé a pegar el access token”.**

Con `ML_CLIENT_ID` + `ML_CLIENT_SECRET` + `ML_REFRESH_TOKEN` configurados, el MCP:

1. Usa el access token en memoria o en `.env.local`.
2. Ante expiración o `401`, refresca **solo** (single-flight).
3. Persiste el nuevo `ML_ACCESS_TOKEN` y `ML_REFRESH_TOKEN` en `.env.local`.

**No hay mantenimiento periódico de tokens.** El OAuth inicial (Paso 3) es **una sola vez**, salvo `invalid_grant`.

---

## Resumen rápido

| Credencial | Dónde se obtiene |
|---|---|
| `ML_CLIENT_ID` | DevCenter → tu app → **App ID** |
| `ML_CLIENT_SECRET` | DevCenter → tu app → **Secret Key** |
| `ML_REFRESH_TOKEN` | Flujo OAuth (autorización del vendedor + intercambio de código) — **una sola vez**; el MCP lo rota automáticamente |
| `ML_SITE_ID` | País de la tienda (`MLA` Argentina, `MLM` México, `MLB` Brasil, etc.) |

---

## Mercado Libre vs Mercado Pago: ¿son lo mismo?

**No.** Para este MCP necesitás una app en **Mercado Libre Developers**, no en Mercado Pago Developers.

| Plataforma | Portal | Para qué sirve |
|---|---|---|
| **Mercado Libre** | [developers.mercadolibre.com](https://developers.mercadolibre.com) | Publicaciones, órdenes, preguntas, stock, precios, reputación |
| **Mercado Pago** | [developers.mercadopago.com](https://www.mercadopago.com.ar/developers) | Pagos, checkout, suscripciones |

Muchas cuentas usan el **mismo login** de Mercado Libre para entrar también a Mercado Pago (mismo ecosistema), pero la **aplicación OAuth se crea en Mercado Libre**, no en Mercado Pago.

---

## ¿La app debe crearse desde otra cuenta distinta a la de la tienda?

**No es obligatorio.** Podés usar la misma cuenta o cuentas distintas según tu caso:

### Opción A — Misma cuenta (recomendada para uso personal)

Usás **una sola cuenta** de Mercado Libre que sea:

1. **Dueña/administradora** de la tienda (no operador/colaborador).
2. La que **crea la app** en DevCenter.
3. La que **autoriza la app** en el flujo OAuth.

**Ventaja:** más simple, menos pasos.  
**Ideal para:** vendedores que configuran el MCP para su propia tienda.

### Opción B — Cuentas distintas (típico para agencias o integradores)

1. **Cuenta desarrollador** (tuya o de tu agencia): crea y mantiene la app en DevCenter.
2. **Cuenta vendedor** (cliente): inicia sesión en el flujo OAuth y autoriza el acceso a **su** tienda.

**Ventaja:** un solo `CLIENT_ID` / `CLIENT_SECRET` puede servir a múltiples vendedores (cada uno con su propio `REFRESH_TOKEN`).  
**Ideal para:** integraciones B2B, agencias, software que atiende varios sellers.

### Reglas importantes (aplican en ambos casos)

- Quien **autoriza** la app debe ser el **usuario principal/administrador** de la tienda.
- Si autoriza un **operador o colaborador**, el OAuth falla con `invalid_operator_user_id`.
- El `REFRESH_TOKEN` queda ligado al **vendedor que autorizó**, no al que creó la app.
- El `CLIENT_SECRET` pertenece a la **app**; el `REFRESH_TOKEN` pertenece al **vendedor + app**.

---

## Scopes necesarios según el uso

Al autorizar la app, Mercado Libre otorga permisos según los scopes configurados:

| Uso del MCP | Scopes requeridos |
|---|---|
| Solo lectura (productos, órdenes, métricas, etc.) | `read` + `offline_access` |
| Lectura **y** escritura (precios, stock, responder preguntas, ads) | `read` + `write` + `offline_access` |

- **`read`**: consultar datos privados del vendedor.
- **`write`**: modificar publicaciones, responder preguntas, etc.
- **`offline_access`**: obtener `refresh_token` para que **el MCP** renueve el access token automáticamente (sin intervención del vendedor ni del agente cada 6 horas).

> Sin `offline_access` no recibirás `refresh_token` y el MCP no podrá renovar tokens automáticamente.

---

## Requisitos previos

Antes de empezar, verificá que:

- [ ] Tenés una cuenta de Mercado Libre con acceso de **administrador** a la tienda.
- [ ] La cuenta no tiene validaciones pendientes (documentos, datos personales, inhabilitaciones).
- [ ] Sabés el **site_id** de tu país (ver [países soportados](https://developers.mercadolibre.com.ar/en_us/standard-countries)).
- [ ] Tenés Node.js ≥ 18 instalado (para correr el MCP).

---

## Paso 1 — Crear la aplicación en DevCenter

1. Entrá a [developers.mercadolibre.com](https://developers.mercadolibre.com) e iniciá sesión con la cuenta que **creará** la app (puede ser la del vendedor o la del desarrollador).

2. Andá a **Mis aplicaciones** / **DevCenter**:
   - Argentina: [developers.mercadolibre.com.ar/devcenter](https://developers.mercadolibre.com.ar/devcenter)
   - Otros países: el enlace equivalente en tu dominio (`.com.mx`, `.com.br`, etc.)

3. Clic en **Crear aplicación** / **Create an app**.

4. Completá los datos básicos:

   | Campo | Qué poner |
   |---|---|
   | **Nombre** | Ej: `Mi MCP MercadoLibre` |
   | **Descripción breve** | Ej: `Integración MCP para consulta y gestión de tienda` |
   | **Redirect URI** | URL **estática** y exacta (ver sección siguiente) |

5. En **Permisos / Scopes**, activá:
   - `read`
   - `write` (solo si necesitás escritura)
   - `offline_access` (**obligatorio** para refresh token)

6. Guardá la aplicación.

### Elegir el Redirect URI

El `redirect_uri` debe ser **idéntico** en tres lugares:

1. Configuración de la app en DevCenter.
2. URL de autorización OAuth.
3. Request de intercambio `authorization_code → token`.

**Opciones comunes para desarrollo personal:**

```
https://localhost
```

o

```
https://www.google.com
```

> **Truco práctico:** con `https://www.google.com`, después de autorizar Mercado Libre redirige a Google con `?code=TG-...` en la URL. Copiás el valor de `code` de la barra de direcciones aunque la página no cargue tu app.

**No uses** URLs con parámetros variables (ej: `https://misitio.com/callback?shop=123`) — Mercado Libre las rechaza.

### PKCE (si tu app lo exige)

Algunas apps nuevas tienen habilitado **PKCE**. Si al autorizar te pide `code_challenge`:

1. Generá un `code_verifier` aleatorio (43–128 caracteres).
2. Calculá `code_challenge = BASE64URL(SHA256(code_verifier))` con método `S256`.
3. Incluí en la URL de autorización: `code_challenge=...&code_challenge_method=S256`.
4. Al intercambiar el código, enviá también `code_verifier`.

Si PKCE **no** está habilitado en tu app, omití esos parámetros.

---

## Paso 2 — Obtener Client ID y Client Secret

1. En DevCenter, abrí la aplicación que creaste.

2. En la sección **Credenciales** / **Authentication and Security** verás:

   | En DevCenter | Variable de entorno del MCP |
   |---|---|
   | **App ID** | `ML_CLIENT_ID` |
   | **Secret Key** | `ML_CLIENT_SECRET` |

3. Copiá ambos valores y guardalos en un gestor de secretos (1Password, Bitwarden, variables de entorno del sistema). **Nunca** los subas a Git.

### Renovar el Client Secret

Mercado Libre permite programar o forzar la renovación del Secret Key. Si lo renovás:

- El secret anterior **expira**.
- Todos los `REFRESH_TOKEN` existentes pueden invalidarse.
- Debés actualizar `ML_CLIENT_SECRET` en tu config y, si hace falta, repetir el flujo OAuth.

---

## Paso 3 — Obtener el Refresh Token (flujo OAuth)

Este es el paso más importante. El refresh token solo se obtiene **una vez** cuando el vendedor autoriza la app.

### 3.1 — Construir la URL de autorización

Reemplazá los valores entre `< >`:

```
https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=<TU_APP_ID>&redirect_uri=<TU_REDIRECT_URI_EXACTO>&scope=offline_access%20read%20write
```

> **Crítico:** sin `scope=offline_access` en esta URL, la respuesta de `/oauth/token` **no incluye `refresh_token`**. Solo devuelve `access_token` con scope `read write`.

**Dominio de auth por país:**

| País | URL base de autorización |
|---|---|
| Argentina (MLA) | `https://auth.mercadolibre.com.ar/authorization` |
| México (MLM) | `https://auth.mercadolibre.com.mx/authorization` |
| Brasil (MLB) | `https://auth.mercadolibre.com.br/authorization` |
| Chile (MLC) | `https://auth.mercadolibre.cl/authorization` |
| Colombia (MCO) | `https://auth.mercadolibre.com.co/authorization` |
| Uruguay (MLU) | `https://auth.mercadolibre.com.uy/authorization` |

**Ejemplo concreto (Argentina):**

```
https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=1234567890123456&redirect_uri=https://www.google.com&scope=offline_access%20read%20write
```

Solo lectura (sin escritura):

```
&scope=offline_access%20read
```

Opcional pero recomendado — parámetro `state` para seguridad:

```
&state=mi-estado-aleatorio-123
```

### 3.2 — Autorizar con la cuenta del vendedor

1. Abrí la URL en el navegador.
2. Iniciá sesión con la cuenta **administradora de la tienda** (la que querés leer/escribir).
3. Aceptá los permisos que solicita la app.
4. Mercado Libre redirige a tu `redirect_uri` con un parámetro `code`:

```
https://www.google.com/?code=TG-XXXXXXXX-123456789
```

5. Copiá el valor de `code` **inmediatamente** — expira en pocos minutos y es de **un solo uso**.

> Si ves *"Lo sentimos, la aplicación no puede conectarse a tu cuenta"*, revisá: redirect_uri exacto, cuenta administradora (no colaborador), datos pendientes de validación en la cuenta.

### 3.3 — Intercambiar el code por tokens

Ejecutá este comando reemplazando los valores (incluí PKCE solo si aplica):

```bash
curl -X POST \
  -H 'accept: application/json' \
  -H 'content-type: application/x-www-form-urlencoded' \
  'https://api.mercadolibre.com/oauth/token' \
  -d 'grant_type=authorization_code' \
  -d 'client_id=TU_APP_ID' \
  -d 'client_secret=TU_SECRET_KEY' \
  -d 'code=TG-XXXXXXXX-123456789' \
  -d 'redirect_uri=https://www.google.com'
```

Respuesta esperada:

```json
{
  "access_token": "APP_USR-123456-090515-8cc4448aac10d5105474e1351-1234567",
  "token_type": "bearer",
  "expires_in": 10800,
  "scope": "offline_access read write",
  "user_id": 1234567,
  "refresh_token": "TG-5b9032b4e23464aed1f959f-1234567"
}
```

Guardá:

| Campo de la respuesta | Para qué sirve |
|---|---|
| `refresh_token` | → `ML_REFRESH_TOKEN` (el MCP lo usa para renovar) |
| `access_token` | → `ML_ACCESS_TOKEN` (opcional, expira en ~6 h) |
| `user_id` | ID del vendedor (útil para `seller_id` en las tools) |

### 3.4 — Verificar que el token funciona

```bash
curl -H "Authorization: Bearer TU_ACCESS_TOKEN" \
  https://api.mercadolibre.com/users/me
```

Deberías ver tu nickname, email parcial y `id` del vendedor.

---

## Paso 4 — Configurar el MCP en Cursor / Claude Code

### Modo `.env.local` + bash (recomendado para desarrollo local)

Guardá las credenciales en `.env.local` (no se commitea) y apuntá el MCP al script del repo:

```bash
cp .env.local.example .env.local
# editar .env.local con tus credenciales
npm install && npm run build
chmod +x scripts/run-mcp.sh
```

`.env.local`:

```env
ML_CLIENT_ID=1234567890123456
ML_CLIENT_SECRET=tu-secret-key
ML_REFRESH_TOKEN=TG-...
ML_ACCESS_TOKEN=APP_USR-...
ML_SITE_ID=MLA
```

Config MCP (sin secretos en el JSON):

```json
{
  "mcpServers": {
    "mercadolibre": {
      "command": "bash",
      "args": ["/Users/tu-usuario/code/mercadolibre-mcp/scripts/run-mcp.sh"]
    }
  }
}
```

El script `run-mcp.sh`:

1. Carga `.env.local` del proyecto.
2. Arranca el MCP con las credenciales cargadas.
3. **El server** (no el usuario, no el agente) refresca tokens ante `401` y persiste en `.env.local`.

> **⛔ No hace falta renovar tokens manualmente.** Ni cron, ni n8n, ni curl periódico.

### Modo recomendado: auto-refresh integrado (npx o bash)

El MCP renueva el access token automáticamente cada ~6 horas usando el refresh token:

```json
{
  "mcpServers": {
    "mercadolibre": {
      "command": "npx",
      "args": ["-y", "@traid/mercadolibre-mcp-read"],
      "env": {
        "ML_CLIENT_ID": "1234567890123456",
        "ML_CLIENT_SECRET": "tu-secret-key",
        "ML_REFRESH_TOKEN": "TG-5b9032b4e23464aed1f959f-1234567",
        "ML_SITE_ID": "MLA",
        "ML_ENV_FILE": "/ruta/absoluta/a/.env.local"
      }
    }
  }
}
```

> `ML_ENV_FILE` hace que los tokens renovados se guarden en disco. **Todo automático — sin intervención manual.**

### Modo token directo (alternativa avanzada — NO recomendado)

Si renovás el token **externamente** con tu propia infra (n8n, cron, script propio) — **no es el flujo normal**:

```json
{
  "mcpServers": {
    "mercadolibre": {
      "command": "npx",
      "args": ["-y", "@traid/mercadolibre-mcp-read"],
      "env": {
        "ML_ACCESS_TOKEN": "APP_USR-...",
        "ML_SITE_ID": "MLA"
      }
    }
  }
}
```

> **Preferí siempre** `ML_CLIENT_ID` + `ML_CLIENT_SECRET` + `ML_REFRESH_TOKEN`. El modo token directo requiere que **vos** renueves `ML_ACCESS_TOKEN` cada 6 h — el MCP **no** lo hace en ese modo.

---

### Dónde poner la config

| Cliente | Archivo |
|---|---|
| Cursor | `.cursor/mcp.json` o Settings → MCP |
| Claude Code | `.mcp.json` o `claude.json` |
| Continue | config de MCP del IDE |

Reiniciá el cliente después de guardar.

---

## Lectura vs escritura en el MCP

| Versión | Paquete | Capacidades |
|---|---|---|
| Read-only | `@traid/mercadolibre-mcp-read` | 7 tools de consulta (productos, órdenes, preguntas, métricas, reputación, competencia, categorías) |
| Completa | `@traid/mercadolibre-mcp` | 11 tools incluyendo write-back (responder preguntas, actualizar precio/stock, ads) |

**La configuración OAuth es la misma** para ambas versiones. La diferencia está en los scopes de la app (`write` necesario para operaciones de modificación) y en el paquete MCP que instalés.

---

## Auto-refresh interno (NO hacer manualmente)

> **⛔ Esta sección describe qué hace el MCP por dentro. No es una tarea para el usuario ni para el agente/LLM.**

Con `ML_CLIENT_ID` + `ML_CLIENT_SECRET` + `ML_REFRESH_TOKEN`, el server llama internamente a `POST /oauth/token` con `grant_type=refresh_token` cuando hace falta. **Vos no tenés que ejecutar ese curl.** Los agentes tampoco.

Reglas de Mercado Libre (el MCP las cumple solo):

- Cada refresh devuelve un **nuevo** `refresh_token`; el anterior queda inválido.
- Solo vale el **último** refresh token generado.
- El refresh token expira si no se usa durante **~6 meses**.
- Si el vendedor revoca permisos o cambia contraseña, debés repetir el flujo OAuth completo.

---

## No me llegó el `refresh_token` en `/oauth/token`

Revisá en este orden:

### 1. Mirá el campo `scope` de la respuesta JSON

```json
{
  "access_token": "APP_USR-...",
  "scope": "read write",
  "user_id": 1234567
}
```

| `scope` en la respuesta | Significado |
|---|---|
| `"read write"` (sin `offline_access`) | Autorizaste **sin** offline → **no hay refresh_token** |
| `"offline_access read write"` | Correcto → debería venir `refresh_token` |

### 2. Agregá `scope` a la URL de autorización

La URL **debe** incluir `offline_access`:

```
https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=TU_APP_ID&redirect_uri=TU_REDIRECT_URI&scope=offline_access%20read%20write
```

Los espacios van URL-encoded como `%20`.

### 3. Activá offline access en DevCenter

En **Mis aplicaciones → tu app → Configurar**:

- Scopes: **Lectura** + **Escritura** (si aplica)
- Tipo de app: **Offline read/write** (acceso cuando el usuario no está conectado)

Si la app solo tiene scopes de lectura/escritura “online”, ML no emite refresh token.

### 4. Revocá la autorización anterior y repetí el flujo

Si ya autorizaste **sin** `offline_access`, ML puede reutilizar el grant viejo.

1. DevCenter → tu app → **Administrar permisos**
2. Revocá el acceso del vendedor (o eliminá la autorización)
3. Cerrá sesión de ML en el navegador o usá ventana incógnito
4. Abrí la URL **nueva** con `&scope=offline_access%20read%20write`
5. Autorizá de nuevo → copiá el **nuevo** `code` → intercambiá por token

### 5. Verificá que el `code` sea nuevo

El `authorization_code` es de **un solo uso**. Si el curl falló y reintentaste con el mismo code, la respuesta puede ser incompleta o dar `invalid_grant`. Generá un code nuevo desde cero.

### Respuesta correcta (debe verse así)

```json
{
  "access_token": "APP_USR-...",
  "token_type": "bearer",
  "expires_in": 10800,
  "scope": "offline_access read write",
  "user_id": 1234567,
  "refresh_token": "TG-..."
}
```

---

## Errores frecuentes y solución

| Error | Causa probable | Qué hacer |
|---|---|---|
| Sin `refresh_token` en respuesta | Falta `scope=offline_access` en URL o en DevCenter | Ver sección anterior |
| `invalid_operator_user_id` | Autorizó un colaborador, no el admin | Repetir OAuth con cuenta dueña de la tienda |
| `invalid_grant` | Code expirado, refresh ya usado, o redirect_uri distinto | Generar nuevo code; verificar redirect_uri exacto |
| `invalid_client` | Client ID o Secret incorrectos | Revisar credenciales en DevCenter |
| `unauthorized_client` | App sin scope `write` pero intentás escribir | Agregar scope `write` y re-autorizar |
| `403 Forbidden` | Token de otro usuario o scopes insuficientes | Verificar `user_id` del token vs seller consultado |
| App no conecta | Redirect URI mal configurado | Debe coincidir carácter por carácter |
| Token expira a las 6 h | Normal | **Nada.** El MCP auto-refresca con `ML_REFRESH_TOKEN` — no intervención manual |

---

## Seguridad — buenas prácticas

1. **Nunca** commitees `CLIENT_SECRET` ni `REFRESH_TOKEN` al repositorio.
2. Usá variables de entorno o un secret manager.
3. Rotá el `CLIENT_SECRET` si sospechás filtración.
4. Revocá permisos desde DevCenter → **Administrar permisos** si dejás de usar la integración.
5. Limitá quién puede autorizar la app (solo admins de la tienda).
6. Para producción con múltiples vendedores, guardá un refresh token **por vendedor**, no compartido.

---

## Checklist final

- [ ] App creada en Mercado Libre DevCenter (no Mercado Pago)
- [ ] Scopes: `read` + `write` (si aplica) + `offline_access`
- [ ] Redirect URI estático configurado y usado consistentemente
- [ ] `ML_CLIENT_ID` y `ML_CLIENT_SECRET` copiados
- [ ] OAuth completado con cuenta **administradora** del vendedor
- [ ] `ML_REFRESH_TOKEN` guardado de forma segura
- [ ] `ML_SITE_ID` correcto para tu país
- [ ] MCP configurado y reiniciado
- [ ] Prueba: `curl .../users/me` o pedir al agente "listá mis últimas órdenes"

---

## Referencias oficiales

- [Autenticación y autorización (OAuth 2.0)](https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion)
- [Registrar tu aplicación](https://developers.mercadolibre.com.pa/en_us/register-your-application)
- [Países y site_id](https://developers.mercadolibre.com.ar/en_us/standard-countries)
- [DevCenter Argentina](https://developers.mercadolibre.com.ar/devcenter)
