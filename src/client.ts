// HTTP client con rate limiting y retry para la API de Mercado Libre

import { getAccessToken } from './auth.js'
import type { MLError } from './types.js'

const ML_API_BASE = 'https://api.mercadolibre.com'
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1000
const DEFAULT_PAGE_LIMIT = 50
/** ML corta el paginado por offset alrededor de 10k; guardamos contra loops. */
const MAX_OFFSET = 10_000

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: Record<string, unknown>
  params?: Record<string, string | number | undefined>
}

/** Respuesta paginada estándar de los endpoints de búsqueda de ML. */
interface MLPaginated<T> {
  results?: T[]
  paging?: { total?: number; offset?: number; limit?: number }
}

export async function mlFetch<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, params } = options

  let url = `${ML_API_BASE}${path}`
  if (params) {
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value))
      }
    }
    const qs = searchParams.toString()
    if (qs) url += `?${qs}`
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const token = await getAccessToken()

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : RETRY_DELAY_MS * (attempt + 1)
        console.error(`[ml-mcp] Rate limited. Esperando ${waitMs}ms...`)
        await sleep(waitMs)
        continue
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => null) as MLError | null
        const errorMsg = errorData?.message || errorData?.error || `HTTP ${response.status}`
        // ML devuelve `cause` como array, string u objeto según el endpoint: normalizar antes de mapear
        const rawCause = (errorData as { cause?: unknown } | null)?.cause
        const causeList: unknown[] = Array.isArray(rawCause) ? rawCause : (rawCause ? [rawCause] : [])
        const cause = causeList
          .map((c: unknown) => (typeof c === 'string' ? c : JSON.stringify(c)))
          .join('; ')

        if (response.status === 401 && attempt < MAX_RETRIES) {
          const { clearTokenCache } = await import('./auth.js')
          clearTokenCache()
          continue
        }

        // 24/9: adjuntar el body crudo del error (recortado) para no perder detalle (cause_id, references, etc.)
        let raw = ''
        try { raw = JSON.stringify(errorData).slice(0, 800) } catch { raw = '' }
        throw new Error(
          `Error API ML: ${errorMsg}${cause ? ` (${cause})` : ''} [${method} ${path}]${raw ? ` raw=${raw}` : ''}`
        )
      }

      return await response.json() as T
    } catch (error) {
      lastError = error as Error
      if (attempt < MAX_RETRIES && isRetryable(error as Error)) {
        await sleep(RETRY_DELAY_MS * (attempt + 1))
        continue
      }
      throw error
    }
  }

  throw lastError || new Error('Error inesperado en mlFetch')
}

/** Ids por llamada que admite `/items/bulk`. */
export const ITEMS_BULK_CHUNK = 20

/** Entrada de `/items/bulk`: `{ status_code, body }` (el multiget viejo usaba `code`). */
export interface MlItemsBulkEntry<T> {
  status_code: number
  body: T
}

/**
 * Params de `GET /items/bulk`. Los atributos van con prefijo `body.`; `status_code`
 * se pide siempre porque `attributes` filtra el elemento entero y, si no, se pierde.
 * Sin `attributes` ML devuelve el ítem completo.
 */
export function buildItemsBulkParams(ids: string[], attributes?: string): Record<string, string> {
  const params: Record<string, string> = { ids: ids.join(',') }
  if (attributes) {
    params.attributes = ['status_code', ...attributes.split(',').map(a => `body.${a.trim()}`)].join(',')
  }
  return params
}

/** Bodies de las entradas con `status_code === 200`. Falla ante un formato inesperado. */
export function parseItemsBulk<T>(data: unknown): T[] {
  if (!Array.isArray(data) || data.some(e => !e || typeof e !== 'object' || !('status_code' in e))) {
    throw new Error(`/items/bulk respondió en un formato inesperado: ${JSON.stringify(data).slice(0, 200)}`)
  }
  return (data as MlItemsBulkEntry<T>[]).filter(e => e.status_code === 200).map(e => e.body)
}

/**
 * Lee publicaciones en lotes de 20 con `GET /items/bulk` (reemplaza al multiget
 * `/items?ids=`, deprecado por ML: 403). Devuelve solo los bodies con status 200.
 */
export async function mlItemsBulk<T>(ids: string[], attributes?: string): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += ITEMS_BULK_CHUNK) {
    const data = await mlFetch<unknown>('/items/bulk', {
      params: buildItemsBulkParams(ids.slice(i, i + ITEMS_BULK_CHUNK), attributes),
    })
    out.push(...parseItemsBulk<T>(data))
  }
  return out
}

/**
 * GET paginado: sigue offset/limit hasta agotar `paging.total` y devuelve el array
 * completo de `results`. Para endpoints de búsqueda de ML (órdenes, items del seller).
 * Corta en MAX_OFFSET (~10k) para no loopear (límite de paginado de ML).
 */
export async function mlGetAll<T>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T[]> {
  const limit = Number(params.limit ?? DEFAULT_PAGE_LIMIT)
  let offset = Number(params.offset ?? 0)
  const all: T[] = []

  for (;;) {
    const page = await mlFetch<MLPaginated<T>>(path, { params: { ...params, limit, offset } })
    const results = page.results ?? []
    all.push(...results)

    const total = page.paging?.total ?? all.length
    offset += limit

    if (results.length === 0 || all.length >= total || offset >= total) break
    if (offset >= MAX_OFFSET) {
      console.error(`[ml-mcp] mlGetAll cortó en offset ${offset} (límite de paginado ML) para ${path}.`)
      break
    }
  }
  return all
}

function isRetryable(error: Error): boolean {
  const msg = error.message.toLowerCase()
  return (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('timeout')
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
