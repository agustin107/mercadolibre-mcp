import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mlFetch } from '../client.js'
import { getConfig } from '../auth.js'
import type { MLCategory } from '../types.js'

export function registerGetCategoryAttributes(server: McpServer) {
  server.tool(
    'get_category_attributes',
    'Devuelve TODOS los atributos de una categoría con su id exacto, tipo de valor, si es requerido, unidades permitidas y los valores de lista con su value_id. Usar antes de update_attributes para conocer el id del atributo y el value_id/valor válido a enviar. Admite filtro por texto para acotar la salida.',
    {
      category_id: z.string().describe('ID de categoría (ej: MLA5232)'),
      filter: z.string().optional()
        .describe('Opcional: devuelve solo atributos cuyo id o nombre contengan este texto (case-insensitive).'),
    },
    async ({ category_id, filter }) => {
      const attributes = await mlFetch<Array<{
        id: string
        name: string
        value_type: string
        tags?: Record<string, unknown>
        allowed_units?: Array<{ id: string; name: string }>
        values?: Array<{ id: string; name: string }>
      }>>(`/categories/${category_id}/attributes`)

      let list = attributes
      if (filter) {
        const f = filter.toLowerCase()
        list = attributes.filter(a =>
          a.id.toLowerCase().includes(f) || a.name.toLowerCase().includes(f))
      }

      const simplified = list.map(a => ({
        id: a.id,
        name: a.name,
        value_type: a.value_type,
        required: a.tags?.required === true ? true : undefined,
        allowed_units: a.allowed_units?.map(u => u.id),
        values: a.values?.map(v => ({ id: v.id, name: v.name })),
      }))

      return {
        content: [{
          type: 'text' as const,
          text: `Atributos de ${category_id} (${simplified.length}${filter ? `, filtro "${filter}"` : ''}):\n\n` +
            JSON.stringify(simplified, null, 2),
        }],
      }
    }
  )
}

export function registerGetCategories(server: McpServer) {
  server.tool(
    'get_categories',
    'Obtiene categorías de Mercado Libre y sus atributos. Útil para saber qué categoría usar al publicar y qué atributos son requeridos.',
    {
      category_id: z.string().optional()
        .describe('ID de categoría específica (ej: MLA1234). Si se omite, lista las categorías raíz del sitio.'),
      query: z.string().optional()
        .describe('Buscar categoría por nombre (ej: "repuestos autos"). Usa el category predictor de ML.'),
    },
    async ({ category_id, query }) => {
      const config = getConfig()

      // Si se pasa un category_id, obtener detalle + atributos
      if (category_id) {
        const [category, attributes] = await Promise.all([
          mlFetch<MLCategory>(`/categories/${category_id}`),
          mlFetch<Array<{
            id: string
            name: string
            value_type: string
            tags: { required?: boolean }
            values?: Array<{ id: string; name: string }>
          }>>(`/categories/${category_id}/attributes`).catch(() => []),
        ])

        const path = category.path_from_root.map(p => p.name).join(' > ')
        const requiredAttrs = attributes.filter(a => a.tags?.required)
        const optionalAttrs = attributes.filter(a => !a.tags?.required)

        return {
          content: [{
            type: 'text' as const,
            text: `Categoría: ${category.name} (${category_id})\n` +
              `Ruta: ${path}\n\n` +
              `Subcategorías: ${category.children_categories.length > 0
                ? category.children_categories.map(c => `${c.name} (${c.id})`).join(', ')
                : 'Ninguna (categoría hoja)'}\n\n` +
              `Atributos requeridos (${requiredAttrs.length}):\n` +
              requiredAttrs.map(a => `  - ${a.name} (${a.id}) [${a.value_type}]` +
                (a.values?.length ? ` — opciones: ${a.values.slice(0, 5).map(v => v.name).join(', ')}${a.values.length > 5 ? '...' : ''}` : '')
              ).join('\n') +
              `\n\nAtributos opcionales (${optionalAttrs.length}):\n` +
              optionalAttrs.slice(0, 10).map(a => `  - ${a.name} (${a.id}) [${a.value_type}]`).join('\n') +
              (optionalAttrs.length > 10 ? `\n  ... y ${optionalAttrs.length - 10} más` : ''),
          }],
        }
      }

      // Si se pasa query, usar el predictor de categorías
      if (query) {
        const predictions = await mlFetch<Array<{
          id?: string
          name?: string
          category_id?: string
          category_name?: string
          domain_id?: string
          domain_name?: string
          path_from_root?: Array<{ id: string; name: string }>
        }>>(`/sites/${config.siteId}/domain_discovery/search`, {
          params: { q: query, limit: 8 },
        }).catch(() =>
          // Fallback al category predictor clásico
          mlFetch<Array<{
            id: string
            name: string
            path_from_root: Array<{ id: string; name: string }>
          }>>(`/sites/${config.siteId}/category_predictor/predict`, {
            params: { title: query },
          }).catch(() => [])
        )

        if (!predictions || predictions.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No se encontraron categorías para "${query}". Probá con otros términos.`,
            }],
          }
        }

        // domain_discovery devuelve {category_id, category_name, domain_id, domain_name}; el predictor viejo {id, name, path_from_root}
        type Pred = { id?: string; name?: string; category_id?: string; category_name?: string; domain_id?: string; path_from_root?: Array<{ id: string; name: string }> }
        const lista = (Array.isArray(predictions) ? predictions : [predictions]) as Pred[]
        const cats = await Promise.all(lista.map(async p => {
          const id = p.category_id ?? p.id
          let ruta = p.path_from_root?.map(r => r.name).join(' > ') || ''
          if (!ruta && id) {
            try {
              const c = await mlFetch<{ path_from_root: Array<{ name: string }> }>(`/categories/${id}`)
              ruta = c.path_from_root.map(r => r.name).join(' > ')
            } catch { /* sin ruta */ }
          }
          return { id, nombre: p.category_name ?? p.name, dominio: p.domain_id, ruta }
        }))

        return {
          content: [{
            type: 'text' as const,
            text: `Categorías sugeridas para "${query}":\n\n` +
              JSON.stringify(cats, null, 2),
          }],
        }
      }

      // Sin parámetros: categorías raíz del sitio
      const rootCategories = await mlFetch<Array<{ id: string; name: string }>>(
        `/sites/${config.siteId}/categories`
      )

      return {
        content: [{
          type: 'text' as const,
          text: `Categorías raíz de ${config.siteId} (${rootCategories.length}):\n\n` +
            rootCategories.map(c => `  ${c.id}: ${c.name}`).join('\n'),
        }],
      }
    }
  )
}
