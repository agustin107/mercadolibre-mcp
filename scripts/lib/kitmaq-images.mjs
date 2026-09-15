import { readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ML_BASE } from './env.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const CACHE_PATH = resolve(__dir, '../../reports/picture-upload-cache.json')

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {}
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) } catch { return {} }
}

function saveCache(cache) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true })
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2))
}

function fileHash(path) {
  return createHash('md5').update(readFileSync(path)).digest('hex')
}

/** @param {string} name */
function classifyRootFile(name) {
  const lower = name.toLowerCase()
  if (lower.endsWith('_tn.jpg') || lower.includes('_tn.')) return null
  if (lower.startsWith('energy_-_catalogo')) return null
  if (lower.endsWith('.heic') || lower.endsWith('.pdf')) return null
  if (lower.endsWith('_datos-tecnicos.jpg') || lower.endsWith('_datos-tecnicos.jpeg')) {
    return { kind: 'ficha', priority: 5 }
  }
  if (/^d_nq_np_2x_.*-f\.webp$/i.test(name)) return { kind: 'product', priority: 1 }
  if (/^img_\d+\.jpe?g$/i.test(name)) return { kind: 'product', priority: 3 }
  if (/^_?mg[\s_].*\.jpe?g$/i.test(name) || /^_mg_.*\.jpe?g$/i.test(name)) {
    return { kind: 'product', priority: 2 }
  }
  if (lower.endsWith('.webp') && !name.includes('_fondo')) return { kind: 'product', priority: 4 }
  if (/\.jpe?g$/i.test(name) && !lower.includes('_tn')) return { kind: 'product', priority: 4 }
  return null
}

/**
 * @param {string} folderPath absolute path to product folder
 * @returns {{ product: string[], ficha: string|null, warnings: string[] }}
 */
export function resolveLocalImages(folderPath) {
  const warnings = []
  let entries
  try {
    entries = readdirSync(folderPath).filter(n => !n.startsWith('.') && n !== 'TN' && n !== 'TN-fondo')
  } catch {
    return { product: [], ficha: null, warnings: [`carpeta no encontrada: ${folderPath}`] }
  }

  const product = []
  let ficha = null

  for (const name of entries) {
    const full = join(folderPath, name)
    if (!statSync(full).isFile()) continue
    if (statSync(full).size > 9 * 1024 * 1024) {
      warnings.push(`omitido por tamaño >9MB: ${name}`)
      continue
    }
    const cls = classifyRootFile(name)
    if (!cls) continue
    if (cls.kind === 'ficha') ficha = full
    else product.push({ path: full, priority: cls.priority, name })
  }

  product.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  const productPaths = product.map(p => p.path)

  if (productPaths.length === 0) warnings.push('sin fotos producto en raíz')
  if (productPaths.length < 3) warnings.push(`solo ${productPaths.length} foto(s) producto (< 3 ideal)`)

  const gallery = [...productPaths.slice(0, 11)]
  if (ficha) gallery.push(ficha)

  return { product: productPaths, ficha, gallery: gallery.slice(0, 12), warnings }
}

/** @param {string} token @param {string} filePath */
export async function uploadPicture(token, filePath) {
  const hash = fileHash(filePath)
  const cache = loadCache()
  if (cache[hash]) return cache[hash]

  const buf = readFileSync(filePath)
  const blob = new Blob([buf])
  const fd = new FormData()
  fd.append('file', blob, basename(filePath))

  const r = await fetch(`${ML_BASE}/pictures`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`POST /pictures failed ${r.status}: ${err.slice(0, 200)}`)
  }
  const data = await r.json()
  const entry = { id: data.id, url: data.secure_url || data.variations?.[0]?.secure_url }
  cache[hash] = entry
  saveCache(cache)
  return entry
}

/** @param {string} token @param {string[]} filePaths */
export async function uploadGallery(token, filePaths) {
  const pictures = []
  for (const p of filePaths) {
    pictures.push(await uploadPicture(token, p))
    await new Promise(r => setTimeout(r, 300))
  }
  return pictures
}
