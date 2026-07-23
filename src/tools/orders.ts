import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mlFetch } from '../client.js'
import type { MLOrder } from '../types.js'

const orderListSchema = {
  seller_id: z.string().describe('ID numérico del vendedor en ML'),
  status: z.enum(['paid', 'shipped', 'delivered', 'cancelled']).optional()
    .describe('Filtrar por estado de la orden'),
  date_from: z.string().optional()
    .describe('Fecha desde (ISO 8601, ej: 2026-03-01T00:00:00.000-03:00)'),
  date_to: z.string().optional()
    .describe('Fecha hasta (ISO 8601)'),
  limit: z.number().min(1).max(50).optional()
    .describe('Cantidad máxima de órdenes (default 20)'),
  offset: z.number().min(0).optional()
    .describe('Offset para paginación'),
}

async function fetchOrdersList(args: {
  seller_id: string
  status?: 'paid' | 'shipped' | 'delivered' | 'cancelled'
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}) {
  const { seller_id, status, date_from, date_to, limit = 20, offset = 0 } = args

  const params: Record<string, string | number | undefined> = {
    seller: seller_id,
    'order.status': status,
    'order.date_created.from': date_from,
    'order.date_created.to': date_to,
    limit,
    offset,
    sort: 'date_desc',
  }

  const result = await mlFetch<{
    results: MLOrder[]
    paging: { total: number; offset: number; limit: number }
  }>('/orders/search', { params })

  if (result.results.length === 0) {
    return {
      content: [{
        type: 'text' as const,
        text: 'No se encontraron órdenes con los filtros indicados.',
      }],
    }
  }

  const orders = result.results.map(o => ({
    id: o.id,
    estado: o.status,
    fecha: o.date_created,
    total: `${o.currency_id} ${o.total_amount}`,
    comprador: o.buyer.nickname,
    items: o.order_items.map(oi => ({
      id: oi.item.id,
      titulo: oi.item.title,
      cantidad: oi.quantity,
      precio_unitario: oi.unit_price,
    })),
    envio_id: o.shipping?.id || null,
    envio_estado: o.shipping?.status || 'sin envío',
    pago_estado: o.payments?.[0]?.status || 'sin pago',
  }))

  return {
    content: [{
      type: 'text' as const,
      text: `${result.results.length} órdenes (de ${result.paging.total} total):\n\n` +
        JSON.stringify(orders, null, 2),
    }],
  }
}

export function registerGetOrders(server: McpServer) {
  server.tool(
    'get_orders',
    'Obtiene las órdenes/ventas de un vendedor. Incluye comprador, items, envío y pagos. (Alias legacy — preferir list_orders)',
    orderListSchema,
    fetchOrdersList
  )
}

export function registerListOrders(server: McpServer) {
  server.tool(
    'list_orders',
    'Lista las órdenes/ventas de un vendedor (paridad TN list_orders). Incluye comprador, items, envío y pagos.',
    orderListSchema,
    fetchOrdersList
  )
}

export function registerGetOrder(server: McpServer) {
  server.tool(
    'get_order',
    'Obtiene el detalle completo de una orden por ID (paridad TN get_order).',
    {
      order_id: z.number().describe('ID numérico de la orden'),
    },
    async ({ order_id }) => {
      const order = await mlFetch<MLOrder & { pack_id?: number }>(`/orders/${order_id}`)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(order, null, 2),
        }],
      }
    }
  )
}

export function registerGetOrderPayments(server: McpServer) {
  server.tool(
    'get_order_payments',
    'Lista los pagos de una orden con montos y estados (paridad TN list_order_transactions).',
    {
      order_id: z.number().describe('ID numérico de la orden'),
    },
    async ({ order_id }) => {
      const order = await mlFetch<MLOrder>(`/orders/${order_id}`)
      const payments = order.payments ?? []

      if (payments.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `Orden #${order_id} sin pagos registrados.` }],
        }
      }

      const summary = payments.map(p => ({
        id: p.id,
        status: p.status,
        total_paid_amount: p.total_paid_amount,
      }))

      return {
        content: [{
          type: 'text' as const,
          text: `${payments.length} pago(s) en orden #${order_id}:\n\n` +
            JSON.stringify(summary, null, 2),
        }],
      }
    }
  )
}
