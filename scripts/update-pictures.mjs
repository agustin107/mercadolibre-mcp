#!/usr/bin/env node
/**
 * Reemplaza la galería de fotos de una publicación de ML usando el auth del MCP (dist/auth.js, auto-refresh).
 *   set -a; source .env.local; set +a; ML_ENV_FILE=$PWD/.env.local node scripts/update-pictures.mjs MLA123 <foto>...
 * Cada <foto> puede ser: ruta local (se sube a /pictures), URL https (source) o "id:PIC_ID" (foto ya cargada).
 * Para zoom en ML las fotos tienen que tener >= 1200 px.
 */
import { existsSync } from 'node:fs'
import { mlFetch } from '../dist/client.js'
import { getAccessToken } from '../dist/auth.js'
import { uploadPicture } from './lib/kitmaq-images.mjs'
const [itemId, ...srcs] = process.argv.slice(2)
if (!itemId || !srcs.length) { console.error('uso: update-pictures.mjs ITEM_ID foto...'); process.exit(1) }
const pictures = []
for (const s of srcs) {
  if (s.startsWith('id:')) pictures.push({ id: s.slice(3) })
  else if (/^https?:\/\//.test(s)) pictures.push({ source: s })
  else if (existsSync(s)) { const up = await uploadPicture(await getAccessToken(), s); pictures.push({ id: up.id }) }
  else throw new Error(`no existe: ${s}`)
}
const res = await mlFetch(`/items/${itemId}`, { method: 'PUT', body: { pictures } })
console.log(res.status, (res.pictures || []).map(p => p.max_size).join(' '))
