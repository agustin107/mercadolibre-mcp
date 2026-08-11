import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { KITMAQ_DIR, ML_BASE } from './env.mjs'

const SPECS_PATH = join(KITMAQ_DIR, '_specs.json')
const PRICING_PATH = join(import.meta.dirname, '../ml-pricing.json')

function loadPricingConfig() {
  if (!existsSync(PRICING_PATH)) return { multiplier: 1.371, round_to: 100 }
  return JSON.parse(readFileSync(PRICING_PATH, 'utf8'))
}

export function pickLocalized(v, lang = 'es') {
  if (!v) return ''
  if (typeof v === 'string') return v
  return v[lang] || Object.values(v)[0] || ''
}

export function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** @returns {Record<string, { folderKey: string, pid: number, nombre: string, rows: Record<string,string> }>} */
export function loadSpecsIndex() {
  if (!existsSync(SPECS_PATH)) throw new Error(`No existe ${SPECS_PATH}`)
  const raw = JSON.parse(readFileSync(SPECS_PATH, 'utf8'))
  /** @type {Record<string, any>} */
  const bySku = {}
  for (const [folderKey, entry] of Object.entries(raw)) {
    const rows = Object.fromEntries((entry.rows || []).map(([k, v]) => [k, String(v)]))
    const model = rows.Modelo || folderKey
    const skuGuess = model.replace(/\s+/g, '-').replace(/\//g, '-').toUpperCase()
    const keys = new Set([folderKey, model, skuGuess])
    // common TN SKU patterns from model
    if (rows.Modelo) {
      keys.add(rows.Modelo.replace(/\s/g, '-').replace(/\//g, '-'))
      keys.add(rows.Modelo.replace(/\s/g, '').replace(/\//g, '-'))
    }
    for (const pid of [entry.pid]) {
      bySku[`pid:${pid}`] = { folderKey, pid, nombre: entry.nombre, rows }
    }
    for (const k of keys) {
      bySku[k.toUpperCase()] = { folderKey, pid: entry.pid, nombre: entry.nombre, rows }
    }
  }
  return bySku
}

/** @param {string} sku @param {Record<string, any>} index */
export function resolveFolder(sku, index) {
  const u = (sku || '').trim().toUpperCase()
  if (index[u]) return index[u]
  const compact = u.replace(/[^A-Z0-9]/g, '')
  for (const [k, v] of Object.entries(index)) {
    if (k.replace(/[^A-Z0-9]/g, '') === compact) return v
  }
  return null
}

/** @param {{ width?: string|number, height?: string|number, depth?: string|number, weight?: string|number }} variant */
export function packageDimensions(variant) {
  const w = parseFloat(String(variant.width || 0).replace(',', '.'))
  const h = parseFloat(String(variant.height || 0).replace(',', '.'))
  const d = parseFloat(String(variant.depth || 0).replace(',', '.'))
  const kg = parseFloat(String(variant.weight || 0).replace(',', '.'))
  if (!w || !h || !d) return null
  const sorted = [w, h, d].sort((a, b) => a - b)
  return {
    SELLER_PACKAGE_LENGTH: `${Math.round(sorted[2] + 3)} cm`,
    SELLER_PACKAGE_WIDTH: `${Math.round(sorted[1] + 3)} cm`,
    SELLER_PACKAGE_HEIGHT: `${Math.round(sorted[0] + 3)} cm`,
    SELLER_PACKAGE_WEIGHT: `${Math.round(kg * 1000 + 300)} g`,
  }
}

function parseNumUnit(text) {
  if (!text) return null
  const s = String(text).trim()
  // ponytail: rango tipo "50-65-80W" → primer valor + unidad final
  const rangeEnd = s.match(/([\d.,]+(?:\s*[–-]\s*[\d.,]+)*)\s*([a-zA-Z°%]+)\s*$/)
  if (rangeEnd) {
    const first = rangeEnd[1].split(/[–-]/)[0].trim().replace(',', '.')
    return `${first} ${rangeEnd[2]}`
  }
  const m = s.match(/([\d.,]+)\s*([a-zA-Z°%]+)?/)
  if (!m) return null
  const n = m[1].replace(',', '.')
  const u = m[2] || ''
  return u ? `${n} ${u}` : n
}

/** Build enrichment attrs from _specs rows + TN product */
export function buildEnrichmentAttrs(specRows, tnProduct, categoryId) {
  /** @type {Array<{ id: string, value_name: string }>} */
  const attrs = []
  const r = specRows || {}
  const desc = stripHtml(pickLocalized(tnProduct?.description)).toLowerCase()

  const add = (id, value) => {
    if (value != null && value !== '') attrs.push({ id, value_name: String(value) })
  }

  add('BRAND', r.Marca || tnProduct?.brand)
  add('MODEL', (r.Modelo || '').replace(/\s+/g, '') || undefined)

  if (r.Voltaje) add('VOLTAGE', r.Voltaje.replace(/\s*monofásica/i, '').trim())
  if (r['Amperaje máx.']) add('MAX_AMPERAGE', parseNumUnit(r['Amperaje máx.']))
  if (r.Rango) {
    const m = r.Rango.match(/([\d.,]+)\s*[–-]\s*([\d.,]+)\s*A/i)
    if (m) {
      add('MIN_AMPERAGE', `${m[1]} A`)
      add('MAX_AMPERAGE', `${m[2]} A`)
    }
  }
  if (r.Potencia) add('POWER', parseNumUnit(r.Potencia))
  if (r.Peso) add('WEIGHT', parseNumUnit(r.Peso.replace('~', '')))
  if (r.Capacidad) add('VOLUME_CAPACITY', parseNumUnit(r.Capacidad))
  if (r.Tanque) add('VOLUME_CAPACITY', parseNumUnit(r.Tanque))
  if (r.Disco) add('DISC_DIAMETER', parseNumUnit(r.Disco))
  if (r.Mandril) add('MANDREL_SIZE', parseNumUnit(r.Mandril))
  if (r.Piezas) add('PIECES_NUMBER', r.Piezas.replace(/\D/g, ''))
  if (r.Presión) add('MAX_STEAM_PRESSURE', parseNumUnit(r.Presión) || r.Presión)
  if (r.Batería) {
    add('IS_WIRELESS', 'Sí')
    const ah = r.Batería.match(/([\d.,]+)\s*Ah/i)
    if (ah) add('BATTERY_AMPERAGE', `${ah[1]} Ah`)
  }

  if (/inverter|inversor/i.test(r.Tipo || '') || /inverter/i.test(desc)) {
    add('WITH_INVERTER_TECHNOLOGY', 'Sí')
  }
  if (/mig/i.test(r.Tipo || '') || /mig/i.test(desc)) {
    add('WELDING_MACHINE_TYPES', 'MIG')
    add('WITH_GAS_FUNCTION', 'Sí')
  } else if (/electrodo|mma/i.test(r.Tipo || '') || /electrodo/i.test(desc)) {
    add('WELDING_MACHINE_TYPES', 'Electrodo')
  }
  if (/monofás/i.test(r.Voltaje || '') || /220\s*v/i.test(desc)) {
    add('ELECTRICAL_PHASE', 'Monofásica')
  }
  if (/percutor/i.test(r['Función'] || '') || /percutor/i.test(desc)) {
    add('WITH_PERCUTOR_FUNCTION', 'Sí')
  }
  if (/inalámbr|recargable|20v|12v/i.test(r.Tipo || r.Batería || '') || /inalámbr/i.test(desc)) {
    add('IS_WIRELESS', 'Sí')
  }
  if (categoryId === 'MLA5229') {
    if (/recargable|20v|batería/i.test(`${r.Tipo || ''} ${r.Batería || ''}`)) {
      add('POWER_SUPPLY_TYPE', 'Batería')
    } else {
      add('POWER_SUPPLY_TYPE', 'Corriente doméstica')
    }
  }
  if (categoryId === 'MLA30803') {
    add('POWER_SUPPLY_TYPE', /batería|20v|12v/i.test(`${r.Batería || ''}`) ? 'Batería' : 'Corriente doméstica')
    if (/impacto|llave/i.test(`${r.Modelo || ''} ${r.Tipo || ''}`)) add('PRODUCT_TYPE', 'Llave de impacto')
    else add('PRODUCT_TYPE', 'Destornillador')
  }
  if (categoryId === 'MLA413410') {
    add('PART_NUMBER', r.Modelo || undefined)
    add('VEHICLE_TYPE', 'Universal')
    add('WRENCH_TYPE', 'Combinada')
  }
  if (categoryId === 'MLA372060') {
    add('SUBMERSIBLE_PUMP_TYPE', 'De achique')
  }
  if (categoryId === 'MLA30823') {
    add('MAX_POWER', parseNumUnit(r.Potencia) || r.Potencia)
  }
  if (['MLA30840', 'MLA456971', 'MLA371912', 'MLA48869'].includes(categoryId)) {
    add('POWER_SUPPLY_TYPE', 'Corriente doméstica')
  }
  if (['MLA30768', 'MLA30770', 'MLA372060', 'MLA30774'].includes(categoryId)) {
    add('MATERIAL', 'Metal')
  }
  if (/industrial|22\s*l|seco|húmedo|sopladora/i.test(desc)) {
    if (categoryId === 'MLA4337') {
      add('IS_INDUSTRIAL', 'Sí')
      add('IS_SUITABLE_FOR_LIQUID', 'Sí')
      add('ADDITIONAL_FUNCTIONS', 'Seco, húmedo y sopladora')
    }
  }

  // Category required defaults
  if (categoryId === 'MLA4337') add('COLOR', 'Negro')

  // Fiscales requeridos en creates MLA (ITEM_CONDITION se agrega en create con value_id)
  add('VALUE_ADDED_TAX', '21 %')
  add('IMPORT_DUTY', '0 %')

  return attrs
}

const catCache = new Map()

/** @param {string} token @param {string} categoryId */
export async function getCategorySchema(token, categoryId) {
  if (catCache.has(categoryId)) return catCache.get(categoryId)
  const attrs = await fetch(`${ML_BASE}/categories/${categoryId}/attributes`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json())
  catCache.set(categoryId, attrs)
  return attrs
}

/** @param {string} token @param {string} title @param {Record<string, string>} overrides */
export async function predictCategory(token, title, overrides = {}) {
  const skuKey = title // caller may pass sku-specific override key
  for (const [k, v] of Object.entries(overrides)) {
    if (title.toUpperCase().includes(k.toUpperCase()) || skuKey === k) return v
  }
  const pred = await fetch(
    `${ML_BASE}/sites/MLA/domain_discovery/search?q=${encodeURIComponent(title)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  ).then(r => r.json())
  return pred[0]?.category_id || pred[0]?.id || null
}

const UPDATABLE_ATTR_IDS = new Set([
  'BRAND', 'MODEL', 'COLOR', 'MAIN_COLOR', 'VOLTAGE', 'POWER', 'MAX_AMPERAGE', 'MIN_AMPERAGE',
  'WITH_INVERTER_TECHNOLOGY', 'WELDING_MACHINE_TYPES', 'WITH_GAS_FUNCTION', 'ELECTRICAL_PHASE',
  'WEIGHT', 'VOLUME_CAPACITY', 'IS_INDUSTRIAL', 'IS_SUITABLE_FOR_LIQUID', 'ADDITIONAL_FUNCTIONS',
  'MANDREL_SIZE', 'WITH_PERCUTOR_FUNCTION', 'IS_WIRELESS', 'BATTERY_AMPERAGE', 'INCLUDES_CHARGER',
  'DISC_DIAMETER', 'POWER_SUPPLY_TYPE', 'PRODUCT_TYPE', 'MATERIAL', 'PART_NUMBER', 'VEHICLE_TYPE',
  'WRENCH_TYPE', 'SUBMERSIBLE_PUMP_TYPE', 'MAX_POWER',
  'GTIN', 'SELLER_SKU', 'EMPTY_GTIN_REASON', 'VALUE_ADDED_TAX', 'IMPORT_DUTY', 'ITEM_CONDITION',
  'SELLER_PACKAGE_HEIGHT', 'SELLER_PACKAGE_LENGTH', 'SELLER_PACKAGE_WIDTH', 'SELLER_PACKAGE_WEIGHT',
])

/** @param {Array<{id:string,value_name?:string}>} attrs */
export function filterUpdatableAttributes(attrs) {
  return attrs.filter(a => a.id && a.value_name && UPDATABLE_ATTR_IDS.has(a.id))
}

/** @param {Array<{id:string,value_name?:string}>} existing @param {Array<{id:string,value_name:string}>} incoming */
export function mergeAttributes(existing, incoming) {
  const map = new Map()
  for (const a of existing || []) {
    if (a.id && a.value_name) map.set(a.id, { id: a.id, value_name: a.value_name })
  }
  for (const a of incoming) {
    if (a.id && a.value_name) map.set(a.id, { id: a.id, value_name: a.value_name })
  }
  return [...map.values()]
}

export function buildDescription(tnProduct) {
  const body = stripHtml(pickLocalized(tnProduct?.description))
  const seo = stripHtml(pickLocalized(tnProduct?.seo_description))
  const footer = 'Garantía del vendedor: 3 meses. Envío gratis mismo día en Corrientes Capital. Retiro en Saenz 1587.'
  const parts = [body]
  if (seo && !body.includes(seo.slice(0, 40))) parts.push(seo)
  if (!body.toLowerCase().includes('garantía')) parts.push(footer)
  return parts.join('\n\n').slice(0, 50000)
}

/** Precio ML = TN × 1.371 (+37,1 %) redondeado a $100 (KitMaq / Astroselling) */
export function mlPrice(tnPrice, margin) {
  const cfg = loadPricingConfig()
  const mult = margin ?? cfg.multiplier ?? 1.371
  const step = cfg.round_to ?? 100
  const raw = parseFloat(String(tnPrice)) * mult
  return Math.round(raw / step) * step
}

export function normalizeTitle(name) {
  return pickLocalized(name)
    .replace(/\b(\d+)a\b/gi, (_, n) => `${n}A`)
    .replace(/\b(\d+)v\b/gi, (_, n) => `${n}V`)
    .replace(/\b(\d+)w\b/gi, (_, n) => `${n}W`)
    .replace(/\bmig\+/gi, 'MIG+')
}
