#!/usr/bin/env node
/**
 * Enriquece publicaciones ML desde TN + carpetas locales KitMaq.
 *
 *   node scripts/enrich-ml-from-tn.mjs --audit
 *   node scripts/enrich-ml-from-tn.mjs --apply --no-images --sku=VC22-220
 *   node scripts/enrich-ml-from-tn.mjs --apply --sku=I140-6-220   # create + imgs
 *   node scripts/enrich-ml-from-tn.mjs --validate
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadAllEnv, mlToken, ML_BASE, TN_BASE, KITMAQ_DIR,
} from './lib/env.mjs'
import {
  pickLocalized, stripHtml, loadSpecsIndex, resolveFolder, packageDimensions,
  buildEnrichmentAttrs, predictCategory, mergeAttributes, buildDescription,
  mlPrice, normalizeTitle, getCategorySchema, filterUpdatableAttributes,
} from './lib/tn-ml-mapper.mjs'
import { resolveLocalImages, uploadGallery } from './lib/kitmaq-images.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dir, '..')
const REPORTS = join(ROOT, 'reports')
const OVERRIDES = JSON.parse(readFileSync(join(__dir, 'category-overrides.json'), 'utf8'))

loadAllEnv()

const args = process.argv.slice(2)
const MODE = args.includes('--apply') ? 'apply' : args.includes('--validate') ? 'validate' : 'audit'
const DRY = args.includes('--dry-run')
const NO_IMAGES = args.includes('--no-images')
const SKU_FILTER = args.find(a => a.startsWith('--sku='))?.split('=')[1]?.toUpperCase()

async function fetchTnProducts() {
  const tnToken = process.env.TN_ACCESS_TOKEN
  const tnStore = process.env.TN_STORE_ID
  const tnUA = process.env.TN_APP_NAME && process.env.TN_CONTACT_EMAIL
    ? `${process.env.TN_APP_NAME} (${process.env.TN_CONTACT_EMAIL})`
    : 'enrich-script (dev@local)'
  if (!tnToken || !tnStore) throw new Error('Faltan TN_ACCESS_TOKEN o TN_STORE_ID')

  const products = []
  let page = 1
  while (true) {
    const r = await fetch(`${TN_BASE}/${tnStore}/products?published=true&per_page=200&page=${page}`, {
      headers: { Authentication: `bearer ${tnToken}`, 'User-Agent': tnUA },
    })
    const batch = await r.json()
    if (!Array.isArray(batch) || !batch.length) break
    for (const p of batch) {
      products.push(await fetch(`${TN_BASE}/${tnStore}/products/${p.id}`, {
        headers: { Authentication: `bearer ${tnToken}`, 'User-Agent': tnUA },
      }).then(x => x.json()))
    }
    if (page * 200 >= parseInt(r.headers.get('x-total-count') || '0', 10)) break
    page++
  }
  return products
}

async function fetchMlActive(token, sellerId) {
  const bySku = new Map()
  const items = []
  const allIds = []
  const limit = 50

  for (const status of [null, 'active']) {
    let offset = 0
    while (true) {
      const qs = status ? `status=${status}&` : ''
      const search = await fetch(
        `${ML_BASE}/users/${sellerId}/items/search?${qs}limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } },
      ).then(r => r.json())
      if (!search.results?.length) break
      allIds.push(...search.results)
      if (offset + search.results.length >= (search.paging?.total ?? search.results.length)) break
      offset += limit
    }
  }

  const uniqueIds = [...new Set(allIds)]

  for (let i = 0; i < uniqueIds.length; i += 20) {
    const batch = uniqueIds.slice(i, i + 20)
    const rows = await fetch(`${ML_BASE}/items?ids=${batch.join(',')}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json())
    if (!Array.isArray(rows)) {
      throw new Error(`ML items multiget: ${JSON.stringify(rows).slice(0, 200)}`)
    }
    for (const row of rows) {
      if (row.code !== 200) continue
      const item = row.body
      if (!['active', 'under_review'].includes(item.status)) continue
      items.push(item)
      const skuAttr = item.attributes?.find(a => a.id === 'SELLER_SKU')?.value_name
      const modelAttr = item.attributes?.find(a => a.id === 'MODEL')?.value_name
      const sku = (item.seller_custom_field || skuAttr || '').toUpperCase()
      if (sku) bySku.set(sku, item)
      if (modelAttr) {
        bySku.set(modelAttr.toUpperCase(), item)
        bySku.set(modelAttr.replace(/[^A-Z0-9]/gi, '').toUpperCase(), item)
      }
    }
  }
  return { bySku, items }
}

function matchSkuToMl(sku, mlBySku, tnTitle) {
  if (mlBySku.has(sku)) return mlBySku.get(sku)
  const norm = sku.replace(/[^A-Z0-9]/g, '')
  for (const [k, v] of mlBySku) {
    if (k.replace(/[^A-Z0-9]/g, '') === norm) return v
  }
  return null
}

async function buildPlan(token, tnProducts, mlBySku) {
  const specsIndex = loadSpecsIndex()
  const plans = []

  for (const tn of tnProducts) {
    const v = tn.variants?.[0]
    const sku = (v?.sku || '').trim().toUpperCase()
    if (!sku) continue
    if (SKU_FILTER && sku !== SKU_FILTER) continue

    const folder = resolveFolder(sku, specsIndex)
    const mlItem = matchSkuToMl(sku, mlBySku, pickLocalized(tn.name))
    const lote = mlItem ? 'A' : 'B'
    const title = normalizeTitle(tn.name)

    const categoryId = OVERRIDES[sku]
      || (mlItem?.category_id)
      || await predictCategory(token, title, OVERRIDES)
    await new Promise(r => setTimeout(r, 150))

    const specRows = folder?.rows || {}
    let enrichAttrs = buildEnrichmentAttrs(specRows, tn, categoryId)
    const pkg = packageDimensions(v || {})
    if (pkg) {
      for (const [id, value_name] of Object.entries(pkg)) {
        enrichAttrs.push({ id, value_name })
      }
    }
    enrichAttrs.push({ id: 'SELLER_SKU', value_name: sku })

    // COLOR en variaciones, no en item.attributes
    if (mlItem?.variations?.length) {
      const varAttrIds = new Set(
        mlItem.variations.flatMap(vr => (vr.attribute_combinations || []).map(a => a.id)),
      )
      for (let i = enrichAttrs.length - 1; i >= 0; i--) {
        if (varAttrIds.has(enrichAttrs[i].id)) enrichAttrs.splice(i, 1)
      }
    }
    // SELLER_SKU como attr falla en algunos items; usar seller_custom_field
    if (mlItem) {
      enrichAttrs = enrichAttrs.filter(a => a.id !== 'SELLER_SKU')
    }

    const mergedAttrs = mlItem
      ? mergeAttributes(mlItem.attributes, enrichAttrs)
      : enrichAttrs

    const folderPath = folder ? join(KITMAQ_DIR, folder.folderKey) : null
    const imgs = lote === 'B' ? resolveLocalImages(folderPath || '') : { gallery: [], warnings: ['Lote A: no modificar imgs'] }

    const schemaRaw = categoryId ? await getCategorySchema(token, categoryId) : []
    const schema = Array.isArray(schemaRaw) ? schemaRaw : []
    const required = schema.filter(a => a.tags?.required || a.tags?.catalog_required)
    const filled = new Set(mergedAttrs.map(a => a.id))
    const missingRequired = required.filter(a => !filled.has(a.id)).map(a => a.name)

    plans.push({
      sku,
      lote,
      tn_id: tn.id,
      ml_id: mlItem?.id || null,
      titulo: title,
      category_id: categoryId,
      folder_key: folder?.folderKey || null,
      precio_ml: mlPrice(v?.price),
      stock: v?.stock ?? 1,
      warranty: 'Garantía del vendedor: 3 meses',
      seller_custom_field: sku,
      description: buildDescription(tn),
      attributes: mergedAttrs,
      missing_required: missingRequired,
      images: {
        local_count: imgs.gallery?.length || 0,
        paths: imgs.gallery || [],
        warnings: imgs.warnings || [],
      },
      actions: {
        update_item: mlItem ? {
          title,
          seller_custom_field: sku,
          warranty: 'Garantía del vendedor: 3 meses',
          attributes: mergedAttrs,
        } : null,
        create_item: !mlItem ? {
          title,
          category_id: categoryId,
          price: mlPrice(v?.price),
          available_quantity: v?.stock ?? 1,
          listing_type_id: 'gold_pro',
          condition: 'new',
          buying_mode: 'buy_it_now',
          currency_id: 'ARS',
          shipping: { mode: 'me2', local_pick_up: false, free_shipping: true },
          seller_custom_field: sku,
          warranty: 'Garantía del vendedor: 3 meses',
          attributes: mergedAttrs,
          picture_count: imgs.gallery?.length || 0,
        } : null,
        description: { plain_text: buildDescription(tn) },
        skip_images: lote === 'A' || NO_IMAGES,
      },
    })
  }

  return plans
}

async function applyPlan(token, plan) {
  const results = { sku: plan.sku, steps: [] }

  if (plan.lote === 'A' && plan.ml_id) {
    const body = {
      title: plan.actions.update_item.title,
      seller_custom_field: plan.seller_custom_field,
      attributes: filterUpdatableAttributes(plan.actions.update_item.attributes),
    }
    if (DRY) {
      results.steps.push({ op: 'PUT item', dry: true, body })
    } else {
      const r = await fetch(`${ML_BASE}/items/${plan.ml_id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(`PUT item ${plan.ml_id}: ${JSON.stringify(data).slice(0, 300)}`)
      results.steps.push({ op: 'PUT item', ok: true, id: plan.ml_id })
    }

    const desc = plan.actions.description.plain_text
    if (DRY) {
      results.steps.push({ op: 'PUT description', dry: true, chars: desc.length })
    } else {
      const r = await fetch(`${ML_BASE}/items/${plan.ml_id}/description`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plain_text: desc }),
      })
      if (!r.ok) {
        const err = await r.text()
        throw new Error(`PUT description: ${err.slice(0, 200)}`)
      }
      results.steps.push({ op: 'PUT description', ok: true })
    }
    return results
  }

  if (plan.lote === 'B') {
    if (plan.images.local_count < 1) {
      throw new Error(`Sin imágenes locales para create: ${plan.sku}`)
    }
    let pictures = []
    if (!plan.actions.skip_images) {
      if (DRY) {
        pictures = plan.images.paths.map(p => ({ source: p }))
      } else {
        const uploaded = await uploadGallery(token, plan.images.paths)
        pictures = uploaded.map(p => ({ id: p.id }))
      }
    }

    const createBody = {
      ...plan.actions.create_item,
      pictures,
    }
    // GTIN obligatorio en varias categorías; declarar vacío si no hay código
    const hasGtin = createBody.attributes.some(a => a.id === 'GTIN')
    if (!hasGtin) {
      createBody.attributes.push(
        { id: 'EMPTY_GTIN_REASON', value_id: '17055160', value_name: 'El producto no tiene código registrado' },
      )
    }
    createBody.attributes.push(
      { id: 'ITEM_CONDITION', value_id: '2230284', value_name: 'Nuevo' },
    )
    createBody.title = createBody.title.slice(0, 60)
    delete createBody.picture_count
    delete createBody.warranty

    if (DRY) {
      results.steps.push({ op: 'POST item', dry: true, body: createBody })
      return results
    }

    const r = await fetch(`${ML_BASE}/items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    })
    const created = await r.json()
    if (!r.ok) throw new Error(`POST item: ${JSON.stringify(created).slice(0, 400)}`)
    results.steps.push({ op: 'POST item', ok: true, id: created.id, permalink: created.permalink })

    const desc = plan.actions.description.plain_text
    await fetch(`${ML_BASE}/items/${created.id}/description`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plain_text: desc }),
    })
    results.steps.push({ op: 'PUT description', ok: true })
    return results
  }

  return results
}

async function main() {
  mkdirSync(REPORTS, { recursive: true })
  const token = await mlToken()
  const me = await fetch(`${ML_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json())

  const tnProducts = await fetchTnProducts()
  const { bySku: mlBySku } = await fetchMlActive(token, me.id)
  const plans = await buildPlan(token, tnProducts, mlBySku)

  const summary = {
    mode: MODE,
    fecha: new Date().toISOString(),
    tn_total: tnProducts.length,
    ml_activos: mlBySku.size,
    lote_a: plans.filter(p => p.lote === 'A').length,
    lote_b: plans.filter(p => p.lote === 'B').length,
    con_missing_required: plans.filter(p => p.missing_required.length).length,
  }

  if (MODE === 'audit') {
    const out = join(REPORTS, `tn-ml-gap-${Date.now()}.json`)
    const slim = plans.map(p => ({
      sku: p.sku,
      lote: p.lote,
      ml_id: p.ml_id,
      category_id: p.category_id,
      missing_required: p.missing_required,
      attrs_count: p.attributes.length,
      imgs: p.images.local_count,
      img_warnings: p.images.warnings,
      titulo: p.titulo,
    }))
    writeFileSync(out, JSON.stringify({ summary, productos: slim, plans }, null, 2))
    console.log(JSON.stringify({ summary, report: out, productos: slim }, null, 2))
    return
  }

  if (MODE === 'apply') {
    const results = []
    for (const plan of plans) {
      try {
        results.push(await applyPlan(token, plan))
        console.log(`OK ${plan.sku} (${plan.lote})`)
        await new Promise(r => setTimeout(r, 800))
      } catch (err) {
        results.push({ sku: plan.sku, error: err.message })
        console.error(`FAIL ${plan.sku}: ${err.message}`)
      }
    }
    const out = join(REPORTS, `apply-${Date.now()}.json`)
    writeFileSync(out, JSON.stringify({ summary, results }, null, 2))
    console.log(`Apply log: ${out}`)
    return
  }

  if (MODE === 'validate') {
    const { bySku } = await fetchMlActive(token, me.id)
    const checks = plans.map(p => ({
      sku: p.sku,
      en_ml: bySku.has(p.sku),
      ml_id: bySku.get(p.sku)?.id || p.ml_id,
    }))
    const out = join(REPORTS, 'enrichment-result.json')
    writeFileSync(out, JSON.stringify({ summary, checks, matched: checks.filter(c => c.en_ml).length }, null, 2))
    console.log(JSON.stringify({ summary, matched: checks.filter(c => c.en_ml).length, total: checks.length }, null, 2))
  }
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
