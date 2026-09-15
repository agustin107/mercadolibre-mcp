import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mlFetch } from '../client.js'

async function resolveShipmentId(orderId: number): Promise<number | null> {
  const order = await mlFetch<{ shipping?: { id: number } }>(`/orders/${orderId}`)
  return order.shipping?.id ?? null
}

export function registerListShipments(server: McpServer) {
  server.tool(
    'list_shipments',
    'Obtiene el envío asociado a una orden (paridad TN list_fulfillment_orders). ML tiene un envío por orden en la mayoría de casos.',
    {
      order_id: z.number().describe('ID de la orden'),
    },
    async ({ order_id }) => {
      const shipmentId = await resolveShipmentId(order_id)
      if (!shipmentId) {
        return {
          content: [{ type: 'text' as const, text: `Orden #${order_id} no tiene envío asociado.` }],
        }
      }

      const shipment = await mlFetch<Record<string, unknown>>(`/shipments/${shipmentId}`)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify([{ order_id, shipment_id: shipmentId, ...shipment }], null, 2),
        }],
      }
    }
  )
}

export function registerGetShipment(server: McpServer) {
  server.tool(
    'get_shipment',
    'Detalle de un envío por ID (paridad TN get_fulfillment_order).',
    {
      shipment_id: z.number().describe('ID del envío'),
    },
    async ({ shipment_id }) => {
      const shipment = await mlFetch<Record<string, unknown>>(`/shipments/${shipment_id}`)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(shipment, null, 2),
        }],
      }
    }
  )
}

export function registerUpdateShipmentTracking(server: McpServer) {
  server.tool(
    'update_shipment_tracking',
    'Actualiza tracking number y carrier de un envío (paridad TN update_fulfillment_order).',
    {
      shipment_id: z.number().describe('ID del envío'),
      tracking_number: z.string().describe('Número de seguimiento'),
      tracking_method: z.string().optional().describe('Carrier / método (ej: Andreani, OCA)'),
    },
    async ({ shipment_id, tracking_number, tracking_method }) => {
      const body: Record<string, unknown> = { tracking_number }
      if (tracking_method) body.tracking_method = tracking_method

      await mlFetch(`/shipments/${shipment_id}`, {
        method: 'PUT',
        body,
      })

      return {
        content: [{
          type: 'text' as const,
          text: `Envío #${shipment_id} actualizado con tracking: ${tracking_number}` +
            (tracking_method ? ` (${tracking_method})` : ''),
        }],
      }
    }
  )
}
