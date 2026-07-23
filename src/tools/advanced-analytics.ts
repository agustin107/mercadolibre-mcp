import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mlFetch, mlGetAll } from '../client.js'
import type { MLOrder } from '../types.js'

export function registerPriceToWin(server: McpServer) {
  server.tool(
    'price_to_win',
    'Consulta el precio sugerido para ganar la Buy Box / catálogo en una publicación.',
    {
      item_id: z.string().describe('ID de la publicación'),
    },
    async ({ item_id }) => {
      const data = await mlFetch<{
        price_to_win?: number
        current_price?: number
        status?: string
        currency_id?: string
      }>(`/items/${item_id}/price_to_win`).catch(async () => {
        return mlFetch<Record<string, unknown>>(`/items/${item_id}`, {
          params: { attributes: 'id,price,currency_id,catalog_listing' },
        })
      })

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(data, null, 2),
        }],
      }
    }
  )
}

export function registerPriceHistory(server: McpServer) {
  server.tool(
    'price_history',
    'Historial de precios de venta inferido desde órdenes pagadas recientes de un item.',
    {
      seller_id: z.string().describe('ID numérico del vendedor'),
      item_id: z.string().describe('ID de la publicación'),
      days: z.number().min(1).max(90).optional().describe('Días hacia atrás (default: 30)'),
    },
    async ({ seller_id, item_id, days = 30 }) => {
      const since = new Date()
      since.setDate(since.getDate() - days)

      const orders = await mlGetAll<MLOrder>('/orders/search', {
        seller: seller_id,
        'order.date_created.from': since.toISOString(),
        'order.status': 'paid',
      })

      const prices: Array<{ date: string; unit_price: number; quantity: number }> = []
      for (const order of orders) {
        for (const oi of order.order_items) {
          if (oi.item.id === item_id) {
            prices.push({
              date: order.date_created.slice(0, 10),
              unit_price: oi.unit_price,
              quantity: oi.quantity,
            })
          }
        }
      }

      if (prices.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `Sin ventas del item ${item_id} en los últimos ${days} días.` }],
        }
      }

      const avg = prices.reduce((s, p) => s + p.unit_price, 0) / prices.length
      const min = Math.min(...prices.map(p => p.unit_price))
      const max = Math.max(...prices.map(p => p.unit_price))

      return {
        content: [{
          type: 'text' as const,
          text: [
            `Historial de precios — ${item_id} (últimos ${days} días)`,
            `  Ventas registradas: ${prices.length}`,
            `  Precio promedio:   ${avg.toFixed(2)}`,
            `  Mín / Máx:         ${min.toFixed(2)} / ${max.toFixed(2)}`,
            '',
            JSON.stringify(prices.slice(0, 50), null, 2),
          ].join('\n'),
        }],
      }
    }
  )
}

export function registerStockoutRisk(server: McpServer) {
  server.tool(
    'stockout_risk',
    'Evalúa riesgo de quiebre de stock por item según velocidad de venta vs stock actual.',
    {
      seller_id: z.string().describe('ID numérico del vendedor'),
      days: z.number().min(7).max(60).optional().describe('Ventana de ventas (default: 14)'),
      limit: z.number().min(1).max(30).optional().describe('Top items en riesgo (default: 10)'),
    },
    async ({ seller_id, days = 14, limit = 10 }) => {
      const since = new Date()
      since.setDate(since.getDate() - days)

      const [search, orders] = await Promise.all([
        mlFetch<{ results: string[] }>(`/users/${seller_id}/items/search`, {
          params: { status: 'active', limit: 50 },
        }),
        mlGetAll<MLOrder>('/orders/search', {
          seller: seller_id,
          'order.date_created.from': since.toISOString(),
          'order.status': 'paid',
        }),
      ])

      const soldByItem: Record<string, number> = {}
      for (const order of orders) {
        for (const oi of order.order_items) {
          soldByItem[oi.item.id] = (soldByItem[oi.item.id] ?? 0) + oi.quantity
        }
      }

      const risks: Array<{ id: string; title: string; stock: number; sold: number; days_to_stockout: number | null }> = []

      for (let i = 0; i < search.results.length; i += 20) {
        const batch = search.results.slice(i, i + 20)
        const items = await mlFetch<Array<{ code: number; body: { id: string; title: string; available_quantity: number } }>>(
          '/items',
          { params: { ids: batch.join(','), attributes: 'id,title,available_quantity' } }
        )
        for (const item of items) {
          if (item.code !== 200) continue
          const sold = soldByItem[item.body.id] ?? 0
          const dailyRate = sold / days
          const stock = item.body.available_quantity
          const daysToStockout = dailyRate > 0 ? Math.floor(stock / dailyRate) : null
          if (daysToStockout !== null && daysToStockout <= 14) {
            risks.push({
              id: item.body.id,
              title: item.body.title,
              stock,
              sold,
              days_to_stockout: daysToStockout,
            })
          }
        }
      }

      risks.sort((a, b) => (a.days_to_stockout ?? 999) - (b.days_to_stockout ?? 999))
      const top = risks.slice(0, limit)

      if (top.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Sin items en riesgo de quiebre en los próximos 14 días.' }],
        }
      }

      const rows = top.map(r =>
        `  ${r.id}  ${r.title.slice(0, 30).padEnd(30)}  stock:${String(r.stock).padStart(4)}  vendidos:${String(r.sold).padStart(4)}  ~${r.days_to_stockout}d`)

      return {
        content: [{
          type: 'text' as const,
          text: [`Riesgo de quiebre (ventana ${days}d) — top ${top.length}`, '', ...rows].join('\n'),
        }],
      }
    }
  )
}

export function registerForecastDemand(server: McpServer) {
  server.tool(
    'forecast_demand',
    'Proyección simple de demanda por unidades/día (promedio móvil). Sin Prophet — ver ML_FORECAST_ENABLED para extensión futura.',
    {
      seller_id: z.string().describe('ID numérico del vendedor'),
      item_id: z.string().describe('ID de la publicación'),
      days: z.number().min(7).max(60).optional().describe('Histórico en días (default: 14)'),
      forecast_days: z.number().min(1).max(30).optional().describe('Días a proyectar (default: 7)'),
    },
    async ({ seller_id, item_id, days = 14, forecast_days = 7 }) => {
      if (process.env.ML_FORECAST_ENABLED === '0') {
        return {
          content: [{ type: 'text' as const, text: 'forecast_demand deshabilitado (ML_FORECAST_ENABLED=0).' }],
        }
      }

      const since = new Date()
      since.setDate(since.getDate() - days)

      const orders = await mlGetAll<MLOrder>('/orders/search', {
        seller: seller_id,
        'order.date_created.from': since.toISOString(),
        'order.status': 'paid',
      })

      const byDay: Record<string, number> = {}
      for (const order of orders) {
        for (const oi of order.order_items) {
          if (oi.item.id !== item_id) continue
          const day = order.date_created.slice(0, 10)
          byDay[day] = (byDay[day] ?? 0) + oi.quantity
        }
      }

      const dailyValues = Object.values(byDay)
      const avgDaily = dailyValues.length > 0
        ? dailyValues.reduce((a, b) => a + b, 0) / dailyValues.length
        : 0

      const forecast = Array.from({ length: forecast_days }, (_, i) => ({
        day: i + 1,
        projected_units: Math.round(avgDaily * 100) / 100,
      }))

      return {
        content: [{
          type: 'text' as const,
          text: [
            `Forecast demand — ${item_id}`,
            `  Histórico: ${days} días, ${dailyValues.length} días con ventas`,
            `  Promedio diario: ${avgDaily.toFixed(2)} uds/día`,
            `  Proyección ${forecast_days} días: ${(avgDaily * forecast_days).toFixed(1)} uds total`,
            '',
            JSON.stringify(forecast, null, 2),
          ].join('\n'),
        }],
      }
    }
  )
}
