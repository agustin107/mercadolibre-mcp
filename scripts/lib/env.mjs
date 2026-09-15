import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(__dir, '../..')
export const TN_ENV = resolve(ROOT, '../tiendanube-mcp/.env.local')

export function loadEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[k]) process.env[k] = v
  }
}

export function loadAllEnv() {
  loadEnv(resolve(ROOT, '.env.local'))
  loadEnv(TN_ENV)
}

export const ML_BASE = 'https://api.mercadolibre.com'
export const TN_BASE = 'https://api.tiendanube.com/v1'
export const KITMAQ_DIR = process.env.KITMAQ_PRODUCTOS_DIR
  || `${process.env.HOME}/Documents/Claude/Projects/kitmaq/productos`

export async function mlToken() {
  if (process.env.ML_ACCESS_TOKEN) return process.env.ML_ACCESS_TOKEN
  const r = await fetch(`${ML_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      refresh_token: process.env.ML_REFRESH_TOKEN,
    }),
  })
  if (!r.ok) throw new Error(`ML auth failed: ${r.status}`)
  return (await r.json()).access_token
}
