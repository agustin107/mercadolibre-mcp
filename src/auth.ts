// OAuth2 para Mercado Libre — soporta 2 modos:
// 1. Token directo (ML_ACCESS_TOKEN) — solo si renovás externamente (NO recomendado)
// 2. Auto-refresh (ML_CLIENT_ID + ML_CLIENT_SECRET + ML_REFRESH_TOKEN) — RECOMENDADO; refresh interno cada ~6h
//
// ⛔ REGLA PARA AGENTES/LLMs: NUNCA pedir refresh manual. Este módulo refresca solo (single-flight).
// Única excepción: invalid_grant → re-OAuth inicial, no curl refresh.
//
// REGLA DE LOGGING: JAMÁS se loguea el valor de un token (ni truncado).
// Single-flight in-process: el refresh_token de ML rota en cada refresh.

import { persistEnvVar } from './env-file.js'
import type { MLConfig, TokenData } from './types.js'

const ML_AUTH_URL = 'https://api.mercadolibre.com/oauth/token'

let cachedToken: TokenData | null = null
let skipDirectToken = false
let refreshInflight: Promise<TokenData> | null = null

export function getConfig(): MLConfig {
  return {
    clientId: process.env.ML_CLIENT_ID || '',
    clientSecret: process.env.ML_CLIENT_SECRET || '',
    refreshToken: process.env.ML_REFRESH_TOKEN || '',
    siteId: process.env.ML_SITE_ID || 'MLA',
  }
}

export async function getAccessToken(): Promise<string> {
  const config = getConfig()
  const canRefresh = Boolean(config.clientId && config.clientSecret && config.refreshToken)

  const directToken = process.env.ML_ACCESS_TOKEN
  if (directToken && !skipDirectToken) {
    return directToken
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedToken.accessToken
  }

  if (!canRefresh) {
    throw new Error(
      'Configurá ML_ACCESS_TOKEN (token directo) o ML_CLIENT_ID + ML_CLIENT_SECRET + ML_REFRESH_TOKEN (auto-refresh).'
    )
  }

  if (refreshInflight) {
    const tok = await refreshInflight
    return tok.accessToken
  }

  const p = refreshTokenOAuth().finally(() => {
    refreshInflight = null
  })
  refreshInflight = p
  const tok = await p
  return tok.accessToken
}

async function refreshTokenOAuth(): Promise<TokenData> {
  const config = getConfig()

  const response = await fetch(ML_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Error renovando token ML (HTTP ${response.status}). ` +
      'Verificá ML_CLIENT_ID, ML_CLIENT_SECRET y ML_REFRESH_TOKEN.'
    )
  }

  const data = await response.json() as {
    access_token: string
    expires_in: number
    refresh_token: string
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }

  skipDirectToken = false
  persistEnvVar('ML_ACCESS_TOKEN', data.access_token)

  if (data.refresh_token && data.refresh_token !== config.refreshToken) {
    persistEnvVar('ML_REFRESH_TOKEN', data.refresh_token)
    console.error('[ml-mcp] Refresh token rotado (persistido en .env.local, valor no logueado).')
  }

  console.error('[ml-mcp] Access token refrescado ok.')
  return cachedToken
}

export function clearTokenCache(): void {
  cachedToken = null
  refreshInflight = null
  skipDirectToken = true
}
