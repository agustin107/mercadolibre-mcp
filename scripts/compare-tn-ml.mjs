#!/usr/bin/env node
/**
 * Compara productos TN vs ML por SKU. Uso:
 *   source ../tiendanube-mcp/.env.local 2>/dev/null; source .env.local; node scripts/compare-tn-ml.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')
const tnEnvPath = resolve(root, '../tiendanube-mcp/.env.local')

function loadEnv(path) {
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

loadEnv(resolve(root, '.env.local'))
loadEnv(tnEnvPath)

const ML_BASE = 'https://api.mercadolibre.com'
const TN_BASE = 'https://api.tiendanube.com/v1'

async function mlToken() {
  const direct = process.env.ML_ACCESS_TOKEN
  if (direct) return direct
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
  const d = await r.json()
  return d.access_token
}

function pickLocalized(v, lang = 'es') {
  if (!v) return ''
  if (typeof v === 'string') return v
  return v[lang] || Object.values(v)[0] || ''
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function descLen(text) {
  return stripHtml(text).length
}

function countImages(arr) {
  return Array.isArray(arr) ? arr.length : 0
}

function hasValue(v) {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (typeof v === 'number') return true
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'boolean') return v
  return false
}

async function main() {
  const mlTokenVal = await mlToken()
  const tnToken = process.env.TN_ACCESS_TOKEN
  const tnStore = process.env.TN_STORE_ID
  const tnUA = process.env.TN_APP_NAME && process.env.TN_CONTACT_EMAIL
    ? `${process.env.TN_APP_NAME} (${process.env.TN_CONTACT_EMAIL})`
    : 'compare-script (dev@local)'

  if (!tnToken || !tnStore) throw new Error('Faltan TN_ACCESS_TOKEN o TN_STORE_ID')

  const me = await fetch(`${ML_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${mlTokenVal}` },
  }).then(r => r.json())
  const sellerId = String(me.id)

  const itemIds = []
  let offset = 0
  while (true) {
    const search = await fetch(
      `${ML_BASE}/users/${sellerId}/items/search?status=active&limit=50&offset=${offset}`,
      { headers: { Authorization: `Bearer ${mlTokenVal}` } },
    ).then(r => r.json())
    itemIds.push(...(search.results || []))
    if (offset + 50 >= search.paging.total) break
    offset += 50
  }

  const mlItems = []
  for (let i = 0; i < itemIds.length; i += 20) {
    const batch = itemIds.slice(i, i + 20)
    const rows = await fetch(`${ML_BASE}/items?ids=${batch.join(',')}`, {
      headers: { Authorization: `Bearer ${mlTokenVal}` },
    }).then(r => r.json())
    for (const row of rows) {
      if (row.code === 200) mlItems.push(row.body)
    }
  }

  for (const item of mlItems) {
    try {
      const desc = await fetch(`${ML_BASE}/items/${item.id}/description`, {
        headers: { Authorization: `Bearer ${mlTokenVal}` },
      }).then(r => r.json())
      item._description = desc.plain_text || desc.text || ''
    } catch {
      item._description = ''
    }
  }

  const tnProducts = []
  let page = 1
  while (true) {
    const r = await fetch(`${TN_BASE}/${tnStore}/products?published=true&per_page=200&page=${page}`, {
      headers: {
        Authentication: `bearer ${tnToken}`,
        'User-Agent': tnUA,
      },
    })
    const batch = await r.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    tnProducts.push(...batch)
    const total = parseInt(r.headers.get('x-total-count') || '0', 10)
    if (page * 200 >= total) break
    page++
  }

  const tnBySku = new Map()
  for (const p of tnProducts) {
    for (const v of p.variants || []) {
      if (v.sku) tnBySku.set(v.sku.trim().toUpperCase(), { product: p, variant: v })
    }
  }

  const matched = []
  const mlOnly = []
  const tnOnlySkus = new Set(tnBySku.keys())

  for (const ml of mlItems) {
    const sku = (ml.seller_custom_field || '').trim().toUpperCase()
    if (!sku) {
      mlOnly.push({ ml_id: ml.id, titulo: ml.title, motivo: 'sin SKU en ML' })
      continue
    }
    const tn = tnBySku.get(sku)
    if (!tn) {
      mlOnly.push({ ml_id: ml.id, sku, titulo: ml.title, motivo: 'SKU no encontrado en TN' })
      continue
    }
    tnOnlySkus.delete(sku)

    const p = tn.product
    const v = tn.variant
    const tnDesc = pickLocalized(p.description)
    const mlDesc = ml._description || ''
    const mlAttrs = ml.attributes || []
    const mlFilledAttrs = mlAttrs.filter(a => hasValue(a.value_name))
    const tnAttrs = (p.attributes || []).map(a => pickLocalized(a)).filter(Boolean)

    const gaps = []

    const checks = [
      ['descripcion', descLen(tnDesc), descLen(mlDesc), descLen(tnDesc) > 100 && descLen(mlDesc) < descLen(tnDesc) * 0.5],
      ['imagenes', countImages(p.images), countImages(ml.pictures), countImages(p.images) > countImages(ml.pictures)],
      ['marca', hasValue(p.brand), mlFilledAttrs.some(a => /marca|brand/i.test(a.name || a.id)), !hasValue(p.brand) ? false : !mlFilledAttrs.some(a => /marca|brand/i.test(a.name || a.id))],
      ['tags', hasValue(p.tags), false, hasValue(p.tags)],
      ['video', hasValue(p.video_url), hasValue(ml.video_id), hasValue(p.video_url) && !hasValue(ml.video_id)],
      ['seo_title', hasValue(pickLocalized(p.seo_title)), false, hasValue(pickLocalized(p.seo_title))],
      ['seo_description', hasValue(pickLocalized(p.seo_description)), false, hasValue(pickLocalized(p.seo_description))],
      ['precio_promocional', hasValue(v.promotional_price), false, hasValue(v.promotional_price)],
      ['peso_variante', hasValue(v.weight), mlFilledAttrs.some(a => /peso|weight/i.test(a.name || a.id)), hasValue(v.weight) && !mlFilledAttrs.some(a => /peso|weight/i.test(a.name || a.id))],
      ['variantes', (p.variants || []).length, 1, (p.variants || []).length > 1],
      ['categorias_tn', (p.categories || []).length, 1, (p.categories || []).length > 0],
      ['envio_gratis_flag', p.free_shipping, ml.shipping?.free_shipping ?? false, p.free_shipping && !(ml.shipping?.free_shipping)],
    ]

    for (const [campo, tnVal, mlVal, faltaEnMl] of checks) {
      if (faltaEnMl) gaps.push({ campo, tn: tnVal, ml: mlVal })
    }

    if (ml.health !== undefined && ml.health < 0.7) {
      gaps.push({ campo: 'health_ml_bajo', tn: '-', ml: ml.health })
    }
    if (!ml.seller_custom_field) {
      gaps.push({ campo: 'sku_ml', tn: v.sku, ml: null })
    }
    if (tnAttrs.length > mlFilledAttrs.length) {
      gaps.push({ campo: 'atributos', tn: tnAttrs.length, ml: mlFilledAttrs.length })
    }

    matched.push({
      sku,
      ml_id: ml.id,
      tn_id: p.id,
      titulo_ml: ml.title,
      titulo_tn: pickLocalized(p.name),
      titulos_coinciden: ml.title.trim().toLowerCase() === pickLocalized(p.name).trim().toLowerCase(),
      precio_tn: v.price,
      precio_ml: ml.price,
      stock_tn: v.stock,
      stock_ml: ml.available_quantity,
      desc_chars_tn: descLen(tnDesc),
      desc_chars_ml: descLen(mlDesc),
      imgs_tn: countImages(p.images),
      imgs_ml: countImages(ml.pictures),
      atributos_tn: tnAttrs,
      atributos_ml: mlFilledAttrs.map(a => ({ name: a.name, value: a.value_name })),
      tags_tn: p.tags || '',
      marca_tn: p.brand,
      video_tn: p.video_url,
      envio_gratis_tn: p.free_shipping,
      envio_gratis_ml: ml.shipping?.free_shipping,
      health_ml: ml.health,
      listing_type: ml.listing_type_id,
      gaps,
      link_ml: ml.permalink,
      link_tn: p.canonical_url,
    })
  }

  const tnOnly = [...tnOnlySkus].map(sku => {
    const { product: p, variant: v } = tnBySku.get(sku)
    return { sku, tn_id: p.id, nombre: pickLocalized(p.name), motivo: 'publicado en TN, no matchea ML activo' }
  })

  const gapCounts = {}
  for (const m of matched) {
    for (const g of m.gaps) {
      gapCounts[g.campo] = (gapCounts[g.campo] || 0) + 1
    }
  }

  const report = {
    resumen: {
      productos_ml_activos: mlItems.length,
      productos_tn_publicados: tnProducts.length,
      emparejados_por_sku: matched.length,
      solo_ml: mlOnly.length,
      solo_tn: tnOnly.length,
      brechas_mas_frecuentes: Object.entries(gapCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([campo, count]) => ({ campo, productos_afectados: count, pct: Math.round((count / matched.length) * 100) })),
    },
    emparejados: matched.map(m => ({
      sku: m.sku,
      titulo: m.titulo_tn,
      ml_id: m.ml_id,
      brechas: m.gaps.map(g => g.campo),
      desc: `${m.desc_chars_ml}/${m.desc_chars_tn} chars`,
      imgs: `${m.imgs_ml}/${m.imgs_tn}`,
      health_ml: m.health_ml,
    })),
    detalle_emparejados: matched,
    solo_ml: mlOnly,
    solo_tn: tnOnly.slice(0, 20),
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
