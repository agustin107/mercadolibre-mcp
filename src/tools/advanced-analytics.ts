import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mlGetAll } from '../client.js'
import type { MLOrder } from '../types.js'

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
