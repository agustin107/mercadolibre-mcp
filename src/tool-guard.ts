// Candados del registro de tools.
//
// Este paquete EXPONE tools de escritura a propósito (precio, stock, respuestas,
// ads) — no es read-only. Pero hay una clase de operaciones que NUNCA debe
// registrarse ni exponerse: compras y operaciones destructivas (comprar, pagar,
// borrar, cancelar, reembolsar). Este gate corta el arranque si una tool con ese
// tipo de nombre intentara registrarse, por más que alguien la agregue por error.
//
// Cómo se aplica: index.ts envuelve el `McpServer` con `guardServer(...)` antes de
// pasarlo a los `register*`. Todo `server.tool(name, ...)` / `server.registerTool(name, ...)`
// pasa primero por `assertToolAllowed(name)`.
//
// Second lock: the tools that write fields owned by KitMaq's pricing engine (price,
// stock, listing creation/closing, listing content) stay registered but refuse at
// call time unless KITMAQ_ESCRITURAS_MOTOR=permitir. The internal system's runner is
// the only writer of those fields; a session writing them here would diverge the
// channel from the engine.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * Superficie de ESCRITURA permitida a propósito (documental). Estas tools tocan
 * la cuenta pero son operaciones de gestión que el motor de KitMaq no cubre.
 */
export const WRITE_TOOL_ALLOWLIST = [
  'answer_question',
  'send_message',
  'update_shipment_tracking',
  'update_sale_terms',
  'manage_ads',
] as const

/** Environment switch: engine-owned writes run only when it equals ENGINE_WRITES_ALLOW. */
export const ENGINE_WRITES_ENV = 'KITMAQ_ESCRITURAS_MOTOR'
export const ENGINE_WRITES_ALLOW = 'permitir'

const PRECIO =
  'El precio lo define el motor de precios del sistema interno de KitMaq (conector kitmaq-internal). ' +
  'Proponelo ahí: cambiar_precio_fijo o cambiar_parametros_precios con confirmar=false muestran la vista previa, ' +
  'y el cambio queda en la propuesta pendiente (aprobar_propuesta_precios o /precios/propuesta). El runner lo lleva a MercadoLibre (L3).'
const STOCK =
  'El stock sale de POSBerry (depósitos de KitMaq) y el runner lo lleva a MercadoLibre. Corregilo en POSBerry, no en la publicación.'
const PUBLICACION =
  'Las publicaciones las coordina el sistema interno de KitMaq: las altas se aprueban en /precios/mercadolibre ' +
  '(con su OK y tope por corrida) y el runner las crea. Crear, pausar o cerrar a mano deja el canal distinto del motor; pedilo ahí.'
const FICHA =
  'El título, la descripción, los atributos y las fotos de la publicación salen de la ficha aprobada en el sistema interno de KitMaq ' +
  '(/precios/fichas y /precios/mercadolibre/datos). Cambiala y aprobala ahí; el runner la escribe en MercadoLibre.'

/** Tools that write fields owned by the engine, with the reason given when they refuse. */
export const ENGINE_OWNED_TOOLS: Readonly<Record<string, string>> = {
  update_price: PRECIO,
  batch_update_stock_price: `${PRECIO} ${STOCK}`,
  update_stock: STOCK,
  update_item: `${PRECIO} ${STOCK} ${FICHA}`,
  create_item: PUBLICACION,
  close_item: PUBLICACION,
  update_attributes: FICHA,
}

export function engineWritesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ENGINE_WRITES_ENV] === ENGINE_WRITES_ALLOW
}

/** Refusal returned instead of calling the API. */
export function engineWriteRefusal(name: string) {
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text:
        `'${name}' no escribe en MercadoLibre desde esta sesión. ${ENGINE_OWNED_TOOLS[name]} ` +
        `(Para habilitarla a propósito: ${ENGINE_WRITES_ENV}=${ENGINE_WRITES_ALLOW} en el entorno del server.)`,
    }],
  }
}

/** Wraps the handler (last argument) of an engine-owned tool so it refuses while the switch is off. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK boundary
function guardEngineHandler(name: string, args: any[]): any[] {
  const handler = args[args.length - 1]
  if (!(name in ENGINE_OWNED_TOOLS) || typeof handler !== 'function') return args
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- passthrough to the SDK
  const guarded = (...callArgs: any[]) =>
    engineWritesAllowed() ? handler(...callArgs) : engineWriteRefusal(name)
  return [...args.slice(0, -1), guarded]
}

/**
 * Patrones de operaciones DESTRUCTIVAS / de COMPRA prohibidas. Si el nombre de una
 * tool matchea alguno, el registro falla (fail-fast al boot). Deliberadamente
 * conservador: cubre comprar/pagar/checkout, borrar/destruir/eliminar, cancelar y
 * reembolsar, en inglés y español.
 */
export const DESTRUCTIVE_TOOL_PATTERNS: RegExp[] = [
  /(^|_)buy(_|$)/i,
  /(^|_)purchase(_|$)/i,
  /(^|_)checkout(_|$)/i,
  /(^|_)comprar(_|$)/i,
  /(^|_)delete(_|$)/i,
  /(^|_)destroy(_|$)/i,
  /(^|_)remove(_|$)/i,
  /(^|_)borrar(_|$)/i,
  /(^|_)eliminar(_|$)/i,
  /(^|_)cancel(_|$)/i,
  /(^|_)cancelar(_|$)/i,
  /(^|_)refund(_|$)/i,
  /(^|_)reembolso(_|$)/i,
  /(^|_)pay(ment)?(_|$)/i,
]

/** ¿El nombre de la tool cae en la clase destructiva/compra? */
export function isDestructiveToolName(name: string): boolean {
  return DESTRUCTIVE_TOOL_PATTERNS.some((re) => re.test(name))
}

/** Corta el arranque si una tool destructiva/de compra intenta registrarse. */
export function assertToolAllowed(name: string): void {
  if (isDestructiveToolName(name)) {
    throw new Error(
      `[gate] tool '${name}' bloqueada: operación destructiva o de compra no permitida en este servidor.`
    )
  }
}

/**
 * Envuelve el server para que TODO registro de tool pase por el gate. Devuelve un
 * proxy que delega en el server real, interceptando `tool` y `registerTool` (el
 * nombre es el primer argumento en ambas APIs del SDK).
 */
export function guardServer(server: McpServer): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === 'tool' || prop === 'registerTool') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- frontera con el SDK
        const orig = Reflect.get(target, prop, receiver) as (...args: any[]) => unknown
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- passthrough al SDK
        return (...args: any[]) => {
          const name = args[0]
          if (typeof name !== 'string') return orig.apply(target, args)
          assertToolAllowed(name)
          return orig.apply(target, guardEngineHandler(name, args))
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as McpServer
}
