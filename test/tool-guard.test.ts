// Tests de los candados: el gate debe bloquear tools destructivas/de compra y
// dejar pasar las de gestión legítimas (incluidas las de escritura permitidas).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isDestructiveToolName,
  assertToolAllowed,
  guardServer,
  WRITE_TOOL_ALLOWLIST,
  ENGINE_OWNED_TOOLS,
  ENGINE_WRITES_ENV,
  ENGINE_WRITES_ALLOW,
} from '../src/tool-guard.ts'

test('isDestructiveToolName: bloquea comprar/borrar/cancelar/pagar (en/es)', () => {
  for (const name of [
    'buy_item',
    'purchase_order',
    'checkout',
    'comprar_producto',
    'delete_item',
    'item_delete',
    'destroy_listing',
    'remove_item',
    'borrar_publicacion',
    'eliminar_orden',
    'cancel_order',
    'cancelar_envio',
    'refund_order',
    'payment_create',
    'pay_seller',
  ]) {
    assert.equal(isDestructiveToolName(name), true, `${name} debería estar bloqueada`)
  }
})

test('isDestructiveToolName: NO bloquea las tools legítimas del paquete', () => {
  for (const name of [
    'list_products',
    'get_orders',
    'update_price',
    'update_stock',
    'list_questions',
    'answer_question',
    'get_item_metrics',
    'manage_ads',
    'get_reputation',
    'search_competitors',
    'get_categories',
    'price_to_win',
    'price_history',
    'stockout_risk',
    'official_search_documentation',
  ]) {
    assert.equal(isDestructiveToolName(name), false, `${name} NO debería bloquearse`)
  }
})

test('WRITE_TOOL_ALLOWLIST: las de escritura permitidas no caen en el denylist ni en el candado del motor', () => {
  for (const name of WRITE_TOOL_ALLOWLIST) {
    assert.equal(isDestructiveToolName(name), false)
    assert.equal(name in ENGINE_OWNED_TOOLS, false)
  }
})

test('assertToolAllowed: tira para una tool destructiva', () => {
  assert.throws(() => assertToolAllowed('buy_item'), /bloqueada/)
})

test('guardServer: server.tool con nombre destructivo corta el arranque', () => {
  const calls: string[] = []
  const fakeServer = {
    tool: (name: string) => {
      calls.push(name)
    },
    registerTool: (name: string) => {
      calls.push(name)
    },
  }
  const guarded = guardServer(fakeServer as never)

  // Legítima pasa.
  ;(guarded as unknown as { tool: (n: string) => void }).tool('update_price')
  assert.deepEqual(calls, ['update_price'])

  // Destructiva tira.
  assert.throws(
    () => (guarded as unknown as { tool: (n: string) => void }).tool('buy_item'),
    /bloqueada/
  )
  // registerTool también gateado.
  assert.throws(
    () => (guarded as unknown as { registerTool: (n: string) => void }).registerTool('delete_item'),
    /bloqueada/
  )
})

// Engine-owned writes: refuse unless KITMAQ_ESCRITURAS_MOTOR=permitir.

type Handler = (...a: unknown[]) => unknown

function capture() {
  const handlers = new Map<string, Handler>()
  const fake = {
    tool: (name: string, ...rest: unknown[]) => {
      handlers.set(name, rest[rest.length - 1] as Handler)
    },
    registerTool: (name: string, ...rest: unknown[]) => {
      handlers.set(name, rest[rest.length - 1] as Handler)
    },
  }
  return { handlers, server: guardServer(fake as never) as unknown as typeof fake }
}

function withSwitch(value: string | undefined, fn: () => unknown) {
  const prev = process.env[ENGINE_WRITES_ENV]
  if (value === undefined) delete process.env[ENGINE_WRITES_ENV]
  else process.env[ENGINE_WRITES_ENV] = value
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env[ENGINE_WRITES_ENV]
    else process.env[ENGINE_WRITES_ENV] = prev
  }
}

test('engine-owned tool refuses by default without calling the API', () => {
  const { handlers, server } = capture()
  let called = 0
  server.tool('update_price', 'desc', {}, () => {
    called++
    return 'api'
  })
  for (const value of [undefined, '', '1', 'true', 'PERMITIR']) {
    const r = withSwitch(value, () => handlers.get('update_price')!({ item_id: 'MLA1', price: 1 })) as {
      isError: boolean
      content: Array<{ text: string }>
    }
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /sistema interno/)
  }
  assert.equal(called, 0)
})

test('engine-owned tool runs when the switch allows it', () => {
  const { handlers, server } = capture()
  server.registerTool('update_stock', {}, () => 'api')
  assert.equal(withSwitch(ENGINE_WRITES_ALLOW, () => handlers.get('update_stock')!({})), 'api')
})

test('tools the engine does not cover are not wrapped', () => {
  const { handlers, server } = capture()
  server.tool('answer_question', 'desc', {}, () => 'api')
  assert.equal(withSwitch(undefined, () => handlers.get('answer_question')!({})), 'api')
})

test('every engine-owned name is a registered tool', async () => {
  const registered = new Set<string>()
  const fake = {
    tool: (name: string) => registered.add(name),
    registerTool: (name: string) => registered.add(name),
  }
  const modules = await Promise.all([
    import('../src/tools/products.ts'),
    import('../src/tools/pricing.ts'),
    import('../src/tools/stock.ts'),
  ])
  for (const mod of modules) {
    for (const [key, fn] of Object.entries(mod)) {
      if (key.startsWith('register') && typeof fn === 'function') (fn as (s: unknown) => void)(fake)
    }
  }
  for (const name of Object.keys(ENGINE_OWNED_TOOLS)) {
    assert.ok(registered.has(name), `${name} is not registered`)
  }
})
