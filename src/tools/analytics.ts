import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mlFetch, mlGetAll } from '../client.js'
import type { MLOrder, MLProduct } from '../types.js'

function isoFromDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

async function fetchAllOrders(sellerId: string, params: Record<string, string | number | undefined>): Promise<MLOrder[]> {
  return mlGetAll<MLOrder>('/orders/search', { seller: sellerId, ...params })
}

export function registerGetRevenueSummary(server: McpServer) {
  server.tool(
    'get_revenue_summary',
    'Resumen de ingresos: total, promedio por pedido y cantidad de órdenes en los últimos N días (paridad TN).',
    {
      seller_id: z.string().describe('ID numérico del vendedor'),
      days: z.number().min(1).max(365).optional().describe('Días hacia atrás (default: 30)'),
    },
    async ({ seller_id, days = 30 }) => {
      const since = isoFromDaysAgo(days)
      const orders = await fetchAllOrders(seller_id, {
        'order.date_created.from': since,
        'order.status': 'paid',
      })

      if (orders.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `Sin órdenes pagadas en los últimos ${days} días.` }],
        }
      }

      const currency = orders[0].currency_id
      const total = orders.reduce((sum, o) => sum + o.total_amount, 0)
      const avg = total / orders.length

      return {
        content: [{
          type: 'text' as const,
          text: [
            `Resumen de ingresos — últimos ${days} días`,
            '',
            `  Ingresos totales:    ${currency} ${total.toFixed(2)}`,
            `  Órdenes:            ${orders.length}`,
            `  Promedio por orden: ${currency} ${avg.toFixed(2)}`,
            `  Período:            desde ${since.slice(0, 10)} hasta hoy`,
          ].join('\n'),
        }],
      }
    }
  )
}

export function registerGetSalesByPeriod(server: McpServer) {
  server.tool(
    'get_sales_by_period',
    'Ingresos y cantidad de órdenes agrupados por día (paridad TN).',
    {
      seller_id: z.string().describe('ID numérico del vendedor'),
      from: z.string().describe('Fecha inicio YYYY-MM-DD'),
      to: z.string().describe('Fecha fin YYYY-MM-DD'),
    },
    async ({ seller_id, from, to }) => {
      const orders = await fetchAllOrders(seller_id, {
        'order.date_created.from': `${from}T00:00:00.000-03:00`,
        'order.date_created.to': `${to}T23:59:59.000-03:00`,
        'order.status': 'paid',
      })

      const byDay: Record<string, { revenue: number; count: number }> = {}
      for (const order of orders) {
        const day = order.date_created.slice(0, 10)
        if (!byDay[day]) byDay[day] = { revenue: 0, count: 0 }
        byDay[day].revenue += order.total_amount
        byDay[day].count++
      }

      const currency = orders[0]?.currency_id ?? ''
      const rows = Object.entries(byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, { revenue, count }]) =>
          `  ${date}  ${currency} ${revenue.toFixed(2).padStart(12)}  ${String(count).padStart(6)} órdenes`)

      const totalRevenue = orders.reduce((s, o) => s + o.total_amount, 0)

      return {
        content: [{
          type: 'text' as const,
          text: [
            `Ventas por día — ${from} al ${to}`,
            '',
            ...rows,
            `  TOTAL          ${currency} ${totalRevenue.toFixed(2).padStart(12)}  ${String(orders.length).padStart(6)} órdenes`,
          ].join('\n'),
        }],
      }
    }
  )
}

export function registerGetBestSellingProducts(server: McpServer) {
  server.tool(
    'get_best_selling_products',
    'Top N productos más vendidos por unidades (paridad TN).',
    {
      seller_id: z.string().describe('ID numérico del vendedor'),
      days: z.number().min(1).max(365).optional().describe('Días hacia atrás (default: 30)'),
      limit: z.number().min(1).max(50).optional().describe('Cuántos productos (default: 10)'),
    },
    async ({ seller_id, days = 30, limit = 10 }) => {
      const since = isoFromDaysAgo(days)
      const orders = await fetchAllOrders(seller_id, {
        'order.date_created.from': since,
        'order.status': 'paid',
      })

      const byItem: Record<string, { title: string; units: number; revenue: number }> = {}
      for (const order of orders) {
        for (const oi of order.order_items) {
          if (!byItem[oi.item.id]) {
            byItem[oi.item.id] = { title: oi.item.title, units: 0, revenue: 0 }
          }
          byItem[oi.item.id].units += oi.quantity
          byItem[oi.item.id].revenue += oi.unit_price * oi.quantity
        }
      }

      const ranked = Object.entries(byItem)
        .sort(([, a], [, b]) => b.units - a.units)
        .slice(0, limit)

      if (ranked.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `Sin ventas pagadas en los últimos ${days} días.` }],
        }
      }

      const rows = ranked.map(([id, { title, units, revenue }], i) =>
        `  ${String(i + 1).padStart(2)}. ${id}  ${title.slice(0, 40).padEnd(40)}  ${String(units).padStart(6)} uds  ${revenue.toFixed(2).padStart(10)}`)

      return {
        content: [{
          type: 'text' as const,
          text: [`Top ${ranked.length} productos — últimos ${days} días`, '', ...rows].join('\n'),
        }],
      }
    }
  )
}

export function registerGetOrdersDashboard(server: McpServer) {
  server.tool(
    'get_orders_dashboard',
    'Snapshot de órdenes agrupadas por estado (paridad TN).',
    {
      seller_id: z.string().describe('ID numérico del vendedor'),
      days: z.number().min(1).max(365).optional().describe('Últimos N días (omitir = todas las recientes)'),
    },
    async ({ seller_id, days }) => {
      const params: Record<string, string | number | undefined> = {}
      if (days) params['order.date_created.from'] = isoFromDaysAgo(days)

      const orders = await fetchAllOrders(seller_id, params)

      const byStatus: Record<string, number> = {}
      const byPayment: Record<string, number> = {}

      for (const order of orders) {
        byStatus[order.status] = (byStatus[order.status] ?? 0) + 1
        const ps = order.payments?.[0]?.status ?? 'unknown'
        byPayment[ps] = (byPayment[ps] ?? 0) + 1
      }

      const statusRows = Object.entries(byStatus)
        .sort(([, a], [, b]) => b - a)
        .map(([s, c]) => `  ${s.padEnd(20)} ${c}`)

      const payRows = Object.entries(byPayment)
        .sort(([, a], [, b]) => b - a)
        .map(([s, c]) => `  ${s.padEnd(20)} ${c}`)

      return {
        content: [{
          type: 'text' as const,
          text: [
            `Dashboard de órdenes${days ? ` — últimos ${days} días` : ''}`,
            `Total: ${orders.length} órdenes`,
            '',
            'Estado de orden:',
            ...statusRows,
            '',
            'Estado de pago:',
            ...payRows,
          ].join('\n'),
        }],
      }
    }
  )
}

export function registerGetInventoryAlerts(server: McpServer) {
  server.tool(
    'get_inventory_alerts',
    'Publicaciones con stock igual o menor al umbral (paridad TN).',
    {
      seller_id: z.string().describe('ID numérico del vendedor'),
      threshold: z.number().min(0).optional().describe('Umbral de stock bajo (default: 5)'),
    },
    async ({ seller_id, threshold = 5 }) => {
      const search = await mlFetch<{ results: string[] }>(
        `/users/${seller_id}/items/search`,
        { params: { status: 'active', limit: 50 } }
      )

      const alerts: Array<{ id: string; title: string; stock: number }> = []

      for (let i = 0; i < search.results.length; i += 20) {
        const batch = search.results.slice(i, i + 20)
        const items = await mlFetch<Array<{ code: number; body: MLProduct }>>(
          '/items',
          { params: { ids: batch.join(','), attributes: 'id,title,available_quantity,status' } }
        )
        for (const item of items) {
          if (item.code === 200 && item.body.available_quantity <= threshold) {
            alerts.push({
              id: item.body.id,
              title: item.body.title,
              stock: item.body.available_quantity,
            })
          }
        }
      }

      alerts.sort((a, b) => a.stock - b.stock)

      if (alerts.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `Sin alertas: ninguna publicación activa con stock <= ${threshold}.` }],
        }
      }

      const rows = alerts.map(a =>
        `  ${a.id}  ${a.title.slice(0, 40).padEnd(40)}  Stock: ${a.stock}`)

      return {
        content: [{
          type: 'text' as const,
          text: [`Alertas de stock (umbral: ${threshold}) — ${alerts.length} publicaciones`, '', ...rows].join('\n'),
        }],
      }
    }
  )
}

export function registerGetPendingPayments(server: McpServer) {
  server.tool(
    'get_pending_payments',
    'Órdenes con pago pendiente más antiguas que N horas (paridad TN).',
    {
      seller_id: z.string().describe('ID numérico del vendedor'),
      hours: z.number().min(1).optional().describe('Horas de antigüedad mínima (default: 24)'),
      limit: z.number().min(1).max(100).optional().describe('Máximo a devolver (default: 20)'),
    },
    async ({ seller_id, hours = 24, limit = 20 }) => {
      const cutoff = new Date()
      cutoff.setHours(cutoff.getHours() - hours)

      const orders = await fetchAllOrders(seller_id, {
        'order.status': 'confirmed',
      })

      const pending = orders.filter(o => {
        const payStatus = o.payments?.[0]?.status
        const created = new Date(o.date_created)
        return (payStatus === 'pending' || payStatus === 'in_process') && created < cutoff
      })

      if (pending.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `Sin pagos pendientes con más de ${hours}hs.` }],
        }
      }

      const shown = pending.slice(0, limit)
      const rows = shown.map(o => {
        const ageHours = Math.floor((Date.now() - new Date(o.date_created).getTime()) / 3600000)
        return `  #${o.id}  ${o.currency_id} ${o.total_amount.toFixed(2).padStart(10)}  ${ageHours}hs  ${o.buyer.nickname}`
      })

      return {
        content: [{
          type: 'text' as const,
          text: [
            `Pagos pendientes > ${hours}hs — ${pending.length} órdenes${pending.length > limit ? ` (mostrando ${limit})` : ''}`,
            '',
            ...rows,
          ].join('\n'),
        }],
      }
    }
  )
}
