#!/usr/bin/env node
/**
 * Clips (videos) de una publicación de ML, con el auth del MCP.
 *   node scripts/clips.mjs list   MLA123
 *   node scripts/clips.mjs upload MLA123 /ruta/video.mp4
 *   node scripts/clips.mjs delete MLA123 CLIP_UUID
 * Endpoint documentado en Global Selling: /marketplace/items/{id}/clips. Video vertical 9:16, 10-60 s, ≤280 MB, con audio.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { getAccessToken } from '../dist/auth.js'
const [cmd, itemId, arg] = process.argv.slice(2)
const base = `https://api.mercadolibre.com/marketplace/items/${itemId}/clips`
const auth = { Authorization: `Bearer ${await getAccessToken()}` }
let r
if (cmd === 'list') r = await fetch(base, { headers: auth })
else if (cmd === 'upload') {
  const fd = new FormData()
  fd.append('file', new Blob([readFileSync(arg)], { type: 'video/mp4' }), basename(arg))
  r = await fetch(`${base}/upload`, { method: 'POST', headers: auth, body: fd })
} else if (cmd === 'delete') r = await fetch(`${base}/${arg}`, { method: 'DELETE', headers: auth })
else { console.error('uso: clips.mjs list|upload|delete ITEM [arg]'); process.exit(1) }
console.log(r.status, (await r.text()).slice(0, 1500))
