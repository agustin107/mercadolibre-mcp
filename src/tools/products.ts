import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mlFetch } from '../client.js'
import type { MLProduct } from '../types.js'
import { getConfig } from '../auth.js'

export function registerListProducts(server: McpServer) {
  server.tool(
    'list_products',
    'Lista los productos/publicaciones de un vendedor en Mercado Libre. Retorna título, precio, stock, estado, link y thumbnail.',
    {
      seller_id: z.string().describe('ID numérico del vendedor en ML'),
      status: z.enum(['active', 'paused', 'closed', 'under_review']).optional()
        .describe('Filtrar por estado de la publicación'),
      limit: z.number().min(1).max(100).optional()
        .describe('Cantidad máxima de productos (default 50)'),
      offset: z.number().min(0).optional()
        .describe('Offset para paginación'),
    },
    async ({ seller_id, status, limit = 50, offset = 0 }) => {
      const searchResult = await mlFetch<{
        results: string[]
        paging: { total: number; offset: number; limit: number }
      }>(`/users/${seller_id}/items/search`, {
        params: {
          status: status,
          limit: Math.min(limit, 50),
          offset,
        },
      })

      if (searchResult.results.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `No se encontraron productos para el vendedor ${seller_id}` +
              (status ? ` con estado "${status}"` : '') + '.',
          }],
        }
      }

      const itemIds = searchResult.results
      const products: MLProduct[] = []

      for (let i = 0; i < itemIds.length; i += 20) {
        const batch = itemIds.slice(i, i + 20)
        const items = await mlFetch<Array<{ code: number; body: MLProduct }>>(
          '/items',
          { params: { ids: batch.join(',') } }
        )
        for (const item of items) {
          if (item.code === 200) products.push(item.body)
        }
      }

      const summary = products.map(p => ({
        id: p.id,
        titulo: p.title,
        precio: `${p.currency_id} ${p.price}`,
        stock: p.available_quantity,
        vendidos: p.sold_quantity,
        estado: p.status,
        link: p.permalink,
        thumbnail: p.thumbnail,
        tipo: p.listing_type_id,
        catalogo: p.catalog_listing ?? false,
        sku: p.seller_custom_field ?? null,
      }))

      return {
        content: [{
          type: 'text' as const,
          text: `${products.length} productos encontrados (de ${searchResult.paging.total} total):\n\n` +
            JSON.stringify(summary, null, 2),
        }],
      }
    }
  )
}

export function registerGetItem(server: McpServer) {
  server.tool(
    'get_item',
    'Obtiene el detalle completo de una publicación por ID, incluida su descripción (paridad TN get_product). La descripción de ML vive en un recurso aparte (/items/{id}/description); el array `descriptions` del ítem viene vacío, por eso se trae explícitamente y se expone en el campo `description_text`.',
    {
      item_id: z.string().describe('ID de la publicación (ej: MLA1234567890)'),
    },
    async ({ item_id }) => {
      const item = await mlFetch<MLProduct & {
        description?: string
        pictures?: Array<{ id: string; url: string }>
        seller_custom_field?: string
        attributes?: Array<{ id: string; name: string; value_name: string }>
      }>(`/items/${item_id}`)

      // La descripción NO viene en el payload del ítem (el array `descriptions`
      // está vacío). Se obtiene del recurso /items/{id}/description, que puede
      // devolver 404 si la publicación no tiene descripción cargada.
      let description_text: string | null = null
      try {
        const desc = await mlFetch<{ plain_text?: string; text?: string }>(
          `/items/${item_id}/description`
        )
        description_text = desc.plain_text || desc.text || null
      } catch {
        description_text = null
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ...item, description_text }, null, 2),
        }],
      }
    }
  )
}

export function registerGetItemDescription(server: McpServer) {
  server.tool(
    'get_item_description',
    'Obtiene solo la descripción (texto) de una publicación por ID. La descripción vive en /items/{id}/description, separada del ítem; devuelve aviso si no hay descripción cargada.',
    {
      item_id: z.string().describe('ID de la publicación (ej: MLA1234567890)'),
    },
    async ({ item_id }) => {
      try {
        const desc = await mlFetch<{ plain_text?: string; text?: string }>(
          `/items/${item_id}/description`
        )
        const text = desc.plain_text || desc.text || ''
        return {
          content: [{
            type: 'text' as const,
            text: text
              ? `Descripción de ${item_id}:\n\n${text}`
              : `La publicación ${item_id} no tiene descripción cargada.`,
          }],
        }
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `La publicación ${item_id} no tiene descripción cargada o no se pudo obtener (${(err as Error).message}).`,
          }],
        }
      }
    }
  )
}

export function registerGetItemBySku(server: McpServer) {
  server.tool(
    'get_item_by_sku',
    'Busca una publicación por SKU del vendedor (paridad TN get_product_by_sku).',
    {
      seller_id: z.string().describe('ID numérico del vendedor'),
      sku: z.string().describe('SKU / seller_custom_field de la publicación'),
    },
    async ({ seller_id, sku }) => {
      const search = await mlFetch<{ results: string[] }>(
        `/users/${seller_id}/items/search`,
        { params: { seller_sku: sku, limit: 5 } }
      )

      if (search.results.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No se encontró publicación con SKU "${sku}".` }],
        }
      }

      const itemId = search.results[0]
      const item = await mlFetch<MLProduct>(`/items/${itemId}`)

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(item, null, 2),
        }],
      }
    }
  )
}

export function registerUpdateItem(server: McpServer) {
  server.tool(
    'update_item',
    'Actualiza atributos de una publicación: título, precio, stock, estado, descripción o SKU (paridad TN update_product).',
    {
      item_id: z.string().describe('ID de la publicación'),
      title: z.string().min(1).optional().describe('Nuevo título'),
      price: z.number().positive().optional().describe('Nuevo precio'),
      available_quantity: z.number().int().min(0).optional().describe('Nuevo stock'),
      status: z.enum(['active', 'paused']).optional().describe('Estado de la publicación'),
      seller_custom_field: z.string().optional().describe('SKU del vendedor'),
      description: z.string().optional().describe('Nueva descripción (texto plano). Se guarda en el recurso aparte /items/{id}/description, no en el ítem.'),
    },
    async ({ item_id, ...fields }) => {
      const body: Record<string, unknown> = {}
      if (fields.title !== undefined) body.title = fields.title
      if (fields.price !== undefined) body.price = fields.price
      if (fields.available_quantity !== undefined) body.available_quantity = fields.available_quantity
      if (fields.status !== undefined) body.status = fields.status
      if (fields.seller_custom_field !== undefined) body.seller_custom_field = fields.seller_custom_field

      if (Object.keys(body).length === 0 && fields.description === undefined) {
        return {
          content: [{ type: 'text' as const, text: 'No se enviaron campos para actualizar.' }],
        }
      }

      const result: Record<string, unknown> = { id: item_id }
      const notes: string[] = []

      // Campos directos del ítem (título, precio, stock, estado, SKU).
      if (Object.keys(body).length > 0) {
        const updated = await mlFetch<MLProduct>(`/items/${item_id}`, {
          method: 'PUT',
          body,
        })
        result.title = updated.title
        result.price = updated.price
        result.available_quantity = updated.available_quantity
        result.status = updated.status
        notes.push('campos del ítem actualizados')
      }

      // La descripción va a un recurso aparte. PUT lo crea o lo reemplaza.
      if (fields.description !== undefined) {
        await mlFetch(`/items/${item_id}/description`, {
          method: 'PUT',
          body: { plain_text: fields.description },
        })
        result.description_updated = true
        notes.push('descripción actualizada')
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Publicación ${item_id} — ${notes.join(' y ')}:\n` + JSON.stringify(result, null, 2),
        }],
      }
    }
  )
}

export function registerCreateItem(server: McpServer) {
  server.tool(
    'create_item',
    'Crea una nueva publicación en Mercado Libre (paridad TN create_product). Flujo mínimo: título, categoría, precio, stock, condición, tipo de listado y al menos una foto. Muchas categorías exigen attributes obligatorios (BRAND, MODEL, etc. — consultar get_category_attributes); se pasan en `attributes`. Admite varias fotos, descripción, sale_terms (garantía) y shipping.',
    {
      title: z.string().min(1).describe('Título de la publicación'),
      category_id: z.string().describe('ID de categoría ML (usar get_categories para obtenerlo)'),
      price: z.number().positive().describe('Precio'),
      available_quantity: z.number().int().min(1).describe('Stock inicial'),
      picture_url: z.string().url().optional().describe('URL pública de la imagen principal (alternativa simple a pictures)'),
      pictures: z.array(z.string().url()).optional().describe('URLs públicas de las imágenes (reemplaza a picture_url si se pasa)'),
      condition: z.enum(['new', 'used']).optional().describe('Condición (default: new)'),
      listing_type_id: z.enum(['gold_special', 'gold_pro', 'free']).optional()
        .describe('Tipo de listado (default: gold_special = Clásica; gold_pro = Premium)'),
      seller_custom_field: z.string().optional().describe('SKU del vendedor'),
      attributes: z.array(z.object({
        id: z.string().describe('ID del atributo (ej: BRAND, MODEL, VOLTAGE)'),
        value_name: z.string().optional().describe('Valor por nombre (ej: "Energy")'),
        value_id: z.string().optional().describe('Valor por id de catálogo (alternativa a value_name)'),
      })).optional().describe('Atributos de ficha. Las categorías suelen exigir BRAND y MODEL como mínimo (ver get_category_attributes con required=true).'),
      sale_terms: z.array(z.object({
        id: z.string().describe('ID del sale_term (ej: WARRANTY_TYPE, WARRANTY_TIME)'),
        value_name: z.string().describe('Valor (ej: "Garantía de fábrica", "3 meses")'),
      })).optional().describe('Términos de venta (garantía, etc.)'),
      description: z.string().optional().describe('Descripción en texto plano (se carga en un segundo paso vía POST /items/{id}/description)'),
      local_pick_up: z.boolean().optional().describe('Permitir retiro en persona'),
      free_shipping: z.boolean().optional().describe('Ofrecer envío gratis (si la categoría/precio no lo fuerza, dejar false)'),
    },
    async ({ title, category_id, price, available_quantity, picture_url, pictures, condition = 'new', listing_type_id = 'gold_special', seller_custom_field, attributes, sale_terms, description, local_pick_up, free_shipping }) => {
      const { siteId } = getConfig()

      const pics = (pictures && pictures.length ? pictures : picture_url ? [picture_url] : [])
      if (!pics.length) {
        return {
          content: [{ type: 'text' as const, text: 'Error: hace falta al menos una imagen (picture_url o pictures).' }],
          isError: true,
        }
      }

      const body: Record<string, unknown> = {
        title,
        category_id,
        price,
        currency_id: siteId === 'MLA' ? 'ARS' : siteId === 'MLM' ? 'MXN' : siteId === 'MLB' ? 'BRL' : 'USD',
        available_quantity,
        buying_mode: 'buy_it_now',
        listing_type_id,
        condition,
        pictures: pics.map((source) => ({ source })),
      }
      if (seller_custom_field) body.seller_custom_field = seller_custom_field
      if (attributes?.length) body.attributes = attributes
      if (sale_terms?.length) body.sale_terms = sale_terms
      if (local_pick_up !== undefined || free_shipping !== undefined) {
        body.shipping = {
          ...(local_pick_up !== undefined ? { local_pick_up } : {}),
          ...(free_shipping !== undefined ? { free_shipping } : {}),
        }
      }

      const created = await mlFetch<{ id: string; permalink: string; status: string }>('/items', {
        method: 'POST',
        body,
      })

      let descNote = ''
      if (description) {
        try {
          await mlFetch(`/items/${created.id}/description`, {
            method: 'POST',
            body: { plain_text: description },
          })
          descNote = '\n  Descripción: cargada.'
        } catch (e) {
          descNote = `\n  ⚠ Descripción NO cargada: ${(e as Error).message}`
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Publicación creada:\n` +
            `  ID: ${created.id}\n` +
            `  Estado: ${created.status}\n` +
            `  Link: ${created.permalink}` + descNote,
        }],
      }
    }
  )
}

export function registerCloseItem(server: McpServer) {
  server.tool(
    'close_item',
    'Cierra o pausa una publicación (paridad TN delete_product — ML no elimina, solo cierra/pausa).',
    {
      item_id: z.string().describe('ID de la publicación'),
      action: z.enum(['close', 'pause']).optional().describe('Acción: close (definitivo) o pause (default: pause)'),
    },
    async ({ item_id, action = 'pause' }) => {
      const status = action === 'close' ? 'closed' : 'paused'
      await mlFetch(`/items/${item_id}`, {
        method: 'PUT',
        body: { status },
      })

      return {
        content: [{
          type: 'text' as const,
          text: `Publicación ${item_id} ${action === 'close' ? 'cerrada' : 'pausada'} (status: ${status}).`,
        }],
      }
    }
  )
}

export function registerUpdateSaleTerms(server: McpServer) {
  server.tool(
    'update_sale_terms',
    'Actualiza los términos de venta de una publicación (PUT /items/{id} con {sale_terms}). Sirve para cargar la GARANTÍA (WARRANTY_TYPE = "Garantía de fábrica" o "Garantía del vendedor" + WARRANTY_TIME = ej "3 meses"). También admite otros sale_terms por id. No confundir con atributos de ficha (usar update_attributes para eso).',
    {
      item_id: z.string().describe('ID de la publicación'),
      sale_terms: z.array(z.object({
        id: z.string().describe('ID del sale_term (ej: WARRANTY_TYPE, WARRANTY_TIME)'),
        value_name: z.string().nullable().optional().describe('Valor (ej: "Garantía de fábrica", "3 meses"). null para limpiar.'),
        value_id: z.string().nullable().optional().describe('value_id si es lista cerrada. null para limpiar.'),
      })).min(1).max(20).describe('Lista de términos de venta a setear (máx 20)'),
    },
    async ({ item_id, sale_terms }) => {
      const body = {
        sale_terms: sale_terms.map(t => {
          const term: Record<string, unknown> = { id: t.id }
          if (t.value_id !== undefined) term.value_id = t.value_id
          if (t.value_name !== undefined) term.value_name = t.value_name
          return term
        }),
      }

      const updated = await mlFetch<{
        id: string
        sale_terms?: Array<{ id: string; name?: string; value_name: string | null }>
      }>(`/items/${item_id}`, { method: 'PUT', body })

      const sentIds = new Set(sale_terms.map(t => t.id))
      const affected = (updated.sale_terms ?? [])
        .filter(t => sentIds.has(t.id))
        .map(t => ({ id: t.id, name: t.name, value_name: t.value_name }))

      return {
        content: [{
          type: 'text' as const,
          text: `Publicación ${item_id} — ${sale_terms.length} término(s) de venta enviados. Estado resultante:\n` +
            JSON.stringify(affected, null, 2),
        }],
      }
    }
  )
}

export function registerUpdateAttributes(server: McpServer) {
  server.tool(
    'update_attributes',
    'Actualiza, agrega o limpia atributos de ficha de una publicación (PUT /items/{id} con {attributes}). Para SETEAR un valor único: pasar id + value_name (texto, ej "90 bar") o value_id (lista cerrada). Para atributos MULTIVALOR (ej WELDING_MACHINE_TYPES con MIG + Electrodo a la vez): pasar `values` con la lista completa de valores deseados (cada uno con value_id o value_name) — reemplaza el conjunto, así que incluí también los que ya estaban. Para LIMPIAR: id con value_name=null y value_id=null. Usar get_category_attributes(category_id) para conocer ids y value_id válidos.',
    {
      item_id: z.string().describe('ID de la publicación'),
      attributes: z.array(z.object({
        id: z.string().describe('ID del atributo ML (ej: MAX_PRESSURE, POWER_SUPPLY_TYPES, WELDING_MACHINE_TYPES)'),
        value_name: z.string().nullable().optional().describe('Valor único a setear (texto). null para limpiar.'),
        value_id: z.string().nullable().optional().describe('value_id único (lista cerrada). null para limpiar.'),
        values: z.array(z.object({
          value_id: z.string().optional().describe('value_id de una de las opciones'),
          value_name: z.string().optional().describe('nombre de una de las opciones'),
        })).optional().describe('Para atributos MULTIVALOR: lista completa de valores a dejar (reemplaza el set actual). Incluir también los ya existentes que se quieran conservar.'),
      })).min(1).max(30).describe('Lista de atributos a actualizar (máx 30)'),
    },
    async ({ item_id, attributes }) => {
      const body = {
        attributes: attributes.map(a => {
          const attr: Record<string, unknown> = { id: a.id }
          if (a.values !== undefined) {
            // Multivalor: se manda el array `values`; ML reemplaza el conjunto.
            attr.values = a.values.map(v => {
              const val: Record<string, unknown> = {}
              if (v.value_id !== undefined) val.id = v.value_id
              if (v.value_name !== undefined) val.name = v.value_name
              return val
            })
          } else {
            // Valor único (o limpieza con null). Se incluye la clave aunque sea null.
            if (a.value_id !== undefined) attr.value_id = a.value_id
            if (a.value_name !== undefined) attr.value_name = a.value_name
          }
          return attr
        }),
      }

      const updated = await mlFetch<{
        id: string
        attributes?: Array<{
          id: string
          name?: string
          value_name: string | null
          values?: Array<{ id: string | null; name: string | null }>
        }>
      }>(`/items/${item_id}`, { method: 'PUT', body })

      const affectedIds = new Set(attributes.map(a => a.id))
      const affected = (updated.attributes ?? [])
        .filter(a => affectedIds.has(a.id))
        .map(a => ({
          id: a.id,
          name: a.name,
          value_name: a.value_name,
          values: a.values && a.values.length > 1 ? a.values.map(v => v.name) : undefined,
        }))

      return {
        content: [{
          type: 'text' as const,
          text: `Publicación ${item_id} — ${attributes.length} atributo(s) enviados. Estado resultante:\n` +
            JSON.stringify(affected, null, 2),
        }],
      }
    }
  )
}

export function registerBatchUpdateStockPrice(server: McpServer) {
  server.tool(
    'batch_update_stock_price',
    'Actualiza precio y/o stock de hasta 50 publicaciones en secuencia (paridad TN update_product_stock_price).',
    {
      updates: z.array(z.object({
        item_id: z.string().describe('ID de la publicación'),
        price: z.number().positive().optional().describe('Nuevo precio'),
        available_quantity: z.number().int().min(0).optional().describe('Nuevo stock'),
      })).min(1).max(50).describe('Lista de actualizaciones (máx 50)'),
    },
    async ({ updates }) => {
      const results: Array<{ item_id: string; ok: boolean; error?: string }> = []

      for (const u of updates) {
        const body: Record<string, unknown> = {}
        if (u.price !== undefined) body.price = u.price
        if (u.available_quantity !== undefined) body.available_quantity = u.available_quantity

        if (Object.keys(body).length === 0) {
          results.push({ item_id: u.item_id, ok: false, error: 'sin campos' })
          continue
        }

        try {
          await mlFetch(`/items/${u.item_id}`, { method: 'PUT', body })
          results.push({ item_id: u.item_id, ok: true })
        } catch (err) {
          results.push({ item_id: u.item_id, ok: false, error: (err as Error).message })
        }
      }

      const ok = results.filter(r => r.ok).length
      return {
        content: [{
          type: 'text' as const,
          text: `Bulk update: ${ok}/${updates.length} exitosos.\n\n` +
            JSON.stringify(results, null, 2),
        }],
      }
    }
  )
}
