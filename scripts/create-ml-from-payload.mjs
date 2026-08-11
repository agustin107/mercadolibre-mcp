#!/usr/bin/env node
/**
 * Ejecuta ml_payload_29.json — crea publicaciones pausadas en ML.
 *
 *   node scripts/create-ml-from-payload.mjs --validate
 *   node scripts/create-ml-from-payload.mjs --apply
 *   node scripts/create-ml-from-payload.mjs --apply --sku=AG115-1-220
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAllEnv, mlToken, ML_BASE } from './lib/env.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dir, '..')
const PAYLOAD_PATH = process.env.ML_PAYLOAD_PATH
  || `${process.env.HOME}/Documents/Claude/Projects/kitmaq/ml_payload_29.json`
const REPORTS = join(ROOT, 'reports')
const LOGO = 'https://d1a9qnv764bsoo.cloudfront.net/stores/007/734/059/themes/common/logo-8531118524227162197-1779406341-c025c59dc1c8be397db2d8551acff7401779406341.png'

const CATEGORY_MAP = {
  CONFIRMAR: null,
  'MLA-BRUSH_CUTTERS': 'MLA457101',
  'MLA-LEVELING_LASERS': 'MLA372006',
  'MLA-CHAINSAWS_nafta': 'MLA411889',
  'MLA-LADDERS': 'MLA48891',
}

/** @param {string} raw */
function cleanValueId(raw) {
  if (raw == null) return undefined
  const s = String(raw)
  const m = s.match(/^(\d+)/)
  return m ? m[1] : undefined
}

/** ponytail: regex cleanup for ML number_unit attrs — strips prose, keeps first number+unit */
function normalizeUnit(value, unitHint) {
  if (!value) return value
  let s = String(value).replace(/≈.*$/i, '').replace(/hasta\s+/i, '').trim()
  s = s.replace(/N·m|N\.m|Nm/gi, 'N*m').replace(/,/g, '.')
  if (unitHint && !/\d\s*[a-zA-Z]/.test(s)) return s
  const m = s.match(/([\d.]+)\s*([a-zA-Z*°%]+)?/)
  if (!m) return s
  const unit = m[2] || unitHint || ''
  return unit ? `${m[1]} ${unit}`.trim() : m[1]
}

/** @param {Record<string, unknown>} item */
function normalizeAttributes(item) {
  const brandName = item.attributes?.find(a => a.id === 'BRAND')?.value_name
  const isCombo = item.sku.includes('-') && /COMBO|Kit|Combo/i.test(item.title)
  /** @type {Array<Record<string, unknown>>} */
  const out = []
  for (const a of item.attributes || []) {
    if (a.id === 'SELLER_SKU') continue
    const row = { id: a.id }
    const vid = cleanValueId(a.value_id)
    // Energy/Neo/Gladiator value_ids often invalid per category — use value_name for BRAND when needed
    if (a.id === 'BRAND' && ['Energy', 'Neo', 'Obra', 'Forest & Garden'].includes(String(a.value_name))) {
      row.value_name = a.value_name
    } else if (vid) {
      row.value_id = vid
      if (a.value_name) row.value_name = a.value_name
    } else if (a.value_name) {
      row.value_name = a.value_name
    }
    out.push(row)
  }
  if (!out.some(a => a.id === 'IMPORT_DUTY')) {
    out.push({ id: 'IMPORT_DUTY', value_id: '49553239', value_name: '0 %' })
  }
  if (!out.some(a => a.id === 'EMPTY_GTIN_REASON') && !out.some(a => a.id === 'GTIN')) {
    out.push({
      id: 'EMPTY_GTIN_REASON',
      value_id: isCombo ? '17055159' : '17055160',
      value_name: isCombo ? 'El producto es un kit o un pack' : 'El producto no tiene código registrado',
    })
  }
  for (const a of out) {
    if (a.id === 'MAX_TORQUE') a.value_name = normalizeUnit(a.value_name, 'Nm').replace(/N\*m/i, 'Nm')
    if (a.id === 'MAX_AMPERAGE') a.value_name = normalizeUnit(a.value_name, 'A')
    if (a.id === 'MIN_AMPERAGE') a.value_name = normalizeUnit(a.value_name, 'A')
    if (a.id === 'POWER') a.value_name = normalizeUnit(a.value_name, 'W')
    if (a.id === 'NO_LOAD_SPEED') a.value_name = normalizeUnit(String(a.value_name).replace(/rpm.*$/i, 'rpm'), 'rpm')
  }
  const cat = resolveCategoryId(item)
  if (cat === 'MLA4337' && !out.some(a => a.id === 'COLOR')) {
    out.push({ id: 'COLOR', value_name: 'Negro' })
  }
  if (['MLA48869', 'MLA456971'].includes(cat) && !out.some(a => a.id === 'POWER_SUPPLY_TYPE')) {
    out.push({ id: 'POWER_SUPPLY_TYPE', value_name: 'Corriente doméstica' })
  }
  if (cat === 'MLA30803' && !out.some(a => a.id === 'POWER_SUPPLY_TYPE')) {
    out.push({ id: 'POWER_SUPPLY_TYPE', value_name: /20V|batería/i.test(item.title) ? 'Batería' : 'Corriente doméstica' })
  }
  if (cat === 'MLA5229' && /20V|Inalámbrica/i.test(item.title) && !out.some(a => a.id === 'POWER_SUPPLY_TYPE')) {
    out.push({ id: 'POWER_SUPPLY_TYPE', value_name: 'Batería' })
  }
  // Escaleras MLA48891
  if (cat === 'MLA48891' || item.domain === 'MLA-LADDERS') {
    if (!out.some(a => a.id === 'STEPS_NUMBER')) {
      const steps = /16 Escalones/i.test(item.title) ? '16' : '4'
      out.push({ id: 'STEPS_NUMBER', value_name: steps })
    }
    if (!out.some(a => a.id === 'IS_FOLDABLE')) {
      out.push({ id: 'IS_FOLDABLE', value_id: '242085', value_name: 'Sí' })
    }
  }
  // Amoladoras cable
  if (item.category_id === 'MLA5229' && brandName === 'Energy' && !/20V|Inalámbrica/i.test(item.title)) {
    if (!out.some(a => a.id === 'POWER_SUPPLY_TYPE')) {
      out.push({ id: 'POWER_SUPPLY_TYPE', value_name: 'Corriente doméstica' })
    }
  }
  return out
}

/** @param {Record<string, unknown>} item */
function resolveCategoryId(item) {
  if (item.category_id && item.category_id !== 'CONFIRMAR') return item.category_id
  return CATEGORY_MAP[item.domain] || null
}

/** @param {Record<string, unknown>} item */
function buildBody(item) {
  const category_id = resolveCategoryId(item)
  if (!category_id) throw new Error(`Sin category_id para ${item.sku}`)
  return {
    title: String(item.title).slice(0, 60),
    category_id,
    price: item.price,
    currency_id: 'ARS',
    available_quantity: item.available_quantity ?? 5,
    buying_mode: 'buy_it_now',
    listing_type_id: item.listing_type_id || 'gold_pro',
    condition: item.condition || 'new',
    seller_custom_field: item.seller_custom_field || item.sku,
    shipping: { mode: 'me2', local_pick_up: false, free_shipping: true },
    pictures: [{ source: LOGO }],
    attributes: normalizeAttributes(item),
  }
}

/** @param {string} token @param {Record<string, unknown>} body */
async function validateBody(token, body) {
  const r = await fetch(`${ML_BASE}/items/validate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, data: await r.json() }
}

/** @param {string} token @param {Record<string, unknown>} item @param {Record<string, unknown>} body */
async function createOne(token, item, body) {
  const r = await fetch(`${ML_BASE}/items`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(data).slice(0, 500))

  await fetch(`${ML_BASE}/items/${data.id}/description`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ plain_text: item.description }),
  })

  const saleTerms = (item.sale_terms || []).map(t => ({
    id: t.id,
    ...(cleanValueId(t.value_id) ? { value_id: cleanValueId(t.value_id) } : {}),
    ...(t.value_name ? { value_name: t.value_name } : {}),
  })).filter(t => t.id !== 'INSTALLMENTS_CAMPAIGN')

  if (saleTerms.length) {
    await fetch(`${ML_BASE}/items/${data.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sale_terms: saleTerms }),
    })
  }

  await fetch(`${ML_BASE}/items/${data.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'paused' }),
  })

  return data
}

async function main() {
  loadAllEnv()
  mkdirSync(REPORTS, { recursive: true })
  const apply = process.argv.includes('--apply')
  const validateOnly = process.argv.includes('--validate') || !apply
  const skuFilter = process.argv.find(a => a.startsWith('--sku='))?.split('=')[1]?.toUpperCase()

  const payload = JSON.parse(readFileSync(PAYLOAD_PATH, 'utf8'))
  const items = skuFilter ? payload.filter(p => p.sku.toUpperCase() === skuFilter) : payload
  const token = await mlToken()
  const sellerId = process.env.ML_SELLER_ID || '3217686517'

  /** @type {Array<Record<string, unknown>>} */
  const results = []

  for (const item of items) {
    let body
    try {
      body = buildBody(item)
    } catch (err) {
      results.push({ sku: item.sku, ok: false, phase: 'build', error: err.message })
      continue
    }

    const { status, data } = await validateBody(token, body)
    const blockers = (data.cause || [])
      .filter(c => c.type === 'error' && !String(c.code).startsWith('shipping.') && c.code !== 'item.shipping.mandatory_free_shipping')
      .map(c => ({ code: c.code, message: c.message }))

    const needsGtin = blockers.some(c => c.message?.includes('[GTIN]'))
    const row = {
      sku: item.sku,
      category_id: body.category_id,
      ok: blockers.length === 0,
      needs_gtin: needsGtin,
      blockers,
    }

    if (validateOnly) {
      results.push(row)
      await new Promise(r => setTimeout(r, 250))
      continue
    }

    if (needsGtin) {
      results.push({ ...row, ok: false, phase: 'validate', error: 'GTIN obligatorio para esta marca/categoría' })
      continue
    }
    if (blockers.length) {
      results.push({ ...row, ok: false, phase: 'validate', error: blockers.map(b => b.code).join(', ') })
      continue
    }

    // skip if exists
    const search = await fetch(
      `${ML_BASE}/users/${sellerId}/items/search?seller_sku=${encodeURIComponent(item.sku)}&limit=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    ).then(r => r.json())
    if (search.results?.length) {
      results.push({ sku: item.sku, ok: true, skipped: true, ml_id: search.results[0] })
      continue
    }

    try {
      const created = await createOne(token, item, body)
      results.push({ sku: item.sku, ok: true, ml_id: created.id, permalink: created.permalink })
      console.log(`OK ${item.sku} → ${created.id}`)
    } catch (err) {
      results.push({ sku: item.sku, ok: false, phase: 'create', error: err.message })
      console.error(`FAIL ${item.sku}: ${err.message}`)
    }
    await new Promise(r => setTimeout(r, 900))
  }

  const out = join(REPORTS, `${validateOnly ? 'validate' : 'create'}-payload-29-${Date.now()}.json`)
  const summary = {
    total: results.length,
    ok: results.filter(r => r.ok && !r.skipped).length,
    skipped: results.filter(r => r.skipped).length,
    needs_gtin: results.filter(r => r.needs_gtin).length,
    failed: results.filter(r => !r.ok).length,
  }
  writeFileSync(out, JSON.stringify({ summary, results }, null, 2))
  console.log(JSON.stringify({ summary, report: out }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
