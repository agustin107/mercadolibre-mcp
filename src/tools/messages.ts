import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mlFetch } from '../client.js'

async function resolvePackId(orderId: number, sellerId: string): Promise<number | null> {
  const order = await mlFetch<{ pack_id?: number }>(`/orders/${orderId}`)
  if (order.pack_id) return order.pack_id

  const unread = await mlFetch<{ paging: { total: number }; results?: Array<{ id: number; order_id?: number }> }>(
    '/messages/unread',
    { params: { role: 'seller', tag: 'post_sale', limit: 50 } }
  ).catch(() => ({ paging: { total: 0 }, results: [] }))

  const match = unread.results?.find(r => r.order_id === orderId)
  return match?.id ?? null
}

export function registerListMessageThreads(server: McpServer) {
  server.tool(
    'list_message_threads',
    'Lista conversaciones post-venta no leídas del vendedor.',
    {
      limit: z.number().min(1).max(50).optional().describe('Cantidad máxima (default 20)'),
    },
    async ({ limit = 20 }) => {
      const data = await mlFetch<{
        results: Array<{
          id: number
          last_message?: { text: string; date_created: string }
          order_id?: number
        }>
        paging: { total: number }
      }>('/messages/unread', {
        params: { role: 'seller', tag: 'post_sale', limit },
      })

      if (!data.results?.length) {
        return {
          content: [{ type: 'text' as const, text: 'Sin mensajes post-venta no leídos.' }],
        }
      }

      const threads = data.results.map(t => ({
        pack_id: t.id,
        order_id: t.order_id,
        ultimo_mensaje: t.last_message?.text?.substring(0, 100),
        fecha: t.last_message?.date_created,
      }))

      return {
        content: [{
          type: 'text' as const,
          text: `${threads.length} conversaciones (total: ${data.paging.total}):\n\n` +
            JSON.stringify(threads, null, 2),
        }],
      }
    }
  )
}

export function registerGetMessageThread(server: McpServer) {
  server.tool(
    'get_message_thread',
    'Obtiene los mensajes de una conversación post-venta por pack_id o order_id.',
    {
      seller_id: z.string().describe('ID numérico del vendedor'),
      pack_id: z.number().optional().describe('ID del pack de mensajes'),
      order_id: z.number().optional().describe('ID de la orden (resuelve pack_id automáticamente)'),
    },
    async ({ seller_id, pack_id, order_id }) => {
      let resolvedPackId = pack_id
      if (!resolvedPackId && order_id) {
        resolvedPackId = (await resolvePackId(order_id, seller_id)) ?? undefined
      }
      if (!resolvedPackId) {
        return {
          content: [{ type: 'text' as const, text: 'Indicá pack_id o order_id válido.' }],
        }
      }

      const messages = await mlFetch<{ messages: Array<{ id: string; text: string; date_created: string; from: { user_id: number } }> }>(
        `/messages/packs/${resolvedPackId}/sellers/${seller_id}`,
        { params: { tag: 'post_sale', mark_as_read: 'false' } }
      )

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ pack_id: resolvedPackId, messages: messages.messages ?? messages }, null, 2),
        }],
      }
    }
  )
}

export function registerSendMessage(server: McpServer) {
  server.tool(
    'send_message',
    'Envía un mensaje privado post-venta al comprador.',
    {
      seller_id: z.string().describe('ID numérico del vendedor'),
      text: z.string().min(1).max(3500).describe('Texto del mensaje'),
      pack_id: z.number().optional().describe('ID del pack de mensajes'),
      order_id: z.number().optional().describe('ID de la orden (resuelve pack_id y buyer_id automáticamente)'),
      buyer_id: z.number().optional().describe('ID numérico del comprador (se resuelve solo si se pasa order_id)'),
    },
    async ({ seller_id, text, pack_id, order_id, buyer_id }) => {
      let resolvedPackId = pack_id
      let resolvedBuyerId = buyer_id
      if (order_id && (!resolvedPackId || !resolvedBuyerId)) {
        const order = await mlFetch<{ pack_id?: number; buyer?: { id: number } }>(`/orders/${order_id}`)
        if (!resolvedPackId) {
          resolvedPackId = order.pack_id ?? (await resolvePackId(order_id, seller_id)) ?? undefined
        }
        if (!resolvedBuyerId) resolvedBuyerId = order.buyer?.id
      }
      if (!resolvedPackId) {
        return {
          content: [{ type: 'text' as const, text: 'No se pudo resolver pack_id. Indicá pack_id o order_id con mensajes activos.' }],
        }
      }
      if (!resolvedBuyerId) {
        return {
          content: [{ type: 'text' as const, text: 'No se pudo resolver buyer_id. Indicá buyer_id o pasá order_id para resolverlo automáticamente.' }],
        }
      }

      try {
        await mlFetch(
          `/messages/packs/${resolvedPackId}/sellers/${seller_id}`,
          {
            method: 'POST',
            params: { tag: 'post_sale' },
            body: {
              from: { user_id: Number(seller_id) },
              to: { user_id: resolvedBuyerId },
              text,
            },
          }
        )
      } catch (error) {
        const msg = (error as Error).message
        // ME2: el vendedor no puede iniciar conversación con texto libre directo.
        // Fallback: action_guide con option OTHER (texto libre, máx 350 chars, cap 1).
        if (msg.includes('conversation_initiated_by_seller_limited')) {
          if (text.length > 350) {
            return {
              content: [{
                type: 'text' as const,
                text: `El comprador aún no escribió: ML exige iniciar por action_guide (opción OTHER), que acepta máx 350 caracteres. Tu mensaje tiene ${text.length}. Acortalo y reintentá.`,
              }],
            }
          }
          await mlFetch(
            `/messages/action_guide/packs/${resolvedPackId}/option`,
            {
              method: 'POST',
              params: { tag: 'post_sale' },
              body: { option_id: 'OTHER', text },
            }
          )
          return {
            content: [{
              type: 'text' as const,
              text: `Mensaje enviado en pack #${resolvedPackId} vía action_guide (opción OTHER — conversación iniciada por el vendedor; cap 1 hasta que el comprador responda).\n` +
                `Texto: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`,
            }],
          }
        }
        throw error
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Mensaje enviado en pack #${resolvedPackId}.\n` +
            `Texto: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`,
        }],
      }
    }
  )
}
