#!/usr/bin/env node

// Mercado Libre MCP Server — operaciones diarias de seller (lectura + escritura)
// + TRAID ML Hub (knowledge tools, proxy oficial, candados).
//
// ⛔ Auth: auto-refresh interno (src/auth.ts). Agentes/LLMs: NUNCA pedir refresh manual de tokens.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import {
  registerListProducts,
  registerGetItem,
  registerGetItemDescription,
  registerGetItemBySku,
  registerUpdateItem,
  registerUpdateAttributes,
  registerUpdateSaleTerms,
  registerCreateItem,
  registerCloseItem,
  registerBatchUpdateStockPrice,
} from './tools/products.js'
import { registerUpdatePrice } from './tools/pricing.js'
import { registerUpdateStock } from './tools/stock.js'
import { registerListQuestions, registerAnswerQuestion } from './tools/questions.js'
import {
  registerGetOrders,
  registerListOrders,
  registerGetOrder,
  registerGetOrderPayments,
} from './tools/orders.js'
import {
  registerListShipments,
  registerGetShipment,
  registerUpdateShipmentTracking,
} from './tools/shipments.js'
import {
  registerListMessageThreads,
  registerGetMessageThread,
  registerSendMessage,
} from './tools/messages.js'
import {
  registerGetRevenueSummary,
  registerGetSalesByPeriod,
  registerGetBestSellingProducts,
  registerGetOrdersDashboard,
  registerGetInventoryAlerts,
  registerGetPendingPayments,
} from './tools/analytics.js'
import { registerForecastDemand } from './tools/advanced-analytics.js'
import { registerGetItemMetrics } from './tools/metrics.js'
import { registerManageAds } from './tools/ads.js'
import { registerGetReputation } from './tools/reputation.js'
import { registerSearchCompetitors } from './tools/competitors.js'
import { registerGetCategories, registerGetCategoryAttributes } from './tools/categories.js'
import { registerPriceToWin } from './tools/price_to_win.js'
import { registerPriceHistory } from './tools/price_history.js'
import { registerStockoutRisk } from './tools/stockout_risk.js'
import { registerUpstreamProxy } from './upstream-proxy.js'
import { registerTraidLayer } from './layers/traid/index.js'
import { guardServer } from './tool-guard.js'

export const PACKAGE_VERSION = '2.7.0'

const rawServer = new McpServer({
  name: 'mercadolibre',
  version: PACKAGE_VERSION,
})

const server = guardServer(rawServer)

const disabledLayers = new Set(
  (process.env.TRAID_DISABLE_LAYERS || '').split(',').map((s) => s.trim()).filter(Boolean)
)
const skipUpstream = process.env.ML_SKIP_UPSTREAM_PROXY === '1' || disabledLayers.has('official')
const skipMl = disabledLayers.has('ml')
const skipTraid = disabledLayers.has('traid')
const skipFlow = disabledLayers.has('flow') || !process.env.TRAID_FLOWS_ENABLED

if (!skipMl) {
  registerListProducts(server)
  registerGetItem(server)
  registerGetItemDescription(server)
  registerGetItemBySku(server)
  registerUpdateItem(server)
  registerUpdateAttributes(server)
  registerUpdateSaleTerms(server)
  registerCreateItem(server)
  registerCloseItem(server)
  registerBatchUpdateStockPrice(server)
  registerUpdatePrice(server)
  registerUpdateStock(server)

  registerListQuestions(server)
  registerAnswerQuestion(server)

  registerGetOrders(server)
  registerListOrders(server)
  registerGetOrder(server)
  registerGetOrderPayments(server)

  registerListShipments(server)
  registerGetShipment(server)
  registerUpdateShipmentTracking(server)

  registerListMessageThreads(server)
  registerGetMessageThread(server)
  registerSendMessage(server)

  registerGetRevenueSummary(server)
  registerGetSalesByPeriod(server)
  registerGetBestSellingProducts(server)
  registerGetOrdersDashboard(server)
  registerGetInventoryAlerts(server)
  registerGetPendingPayments(server)

  registerPriceToWin(server)
  registerPriceHistory(server)
  registerStockoutRisk(server)
  registerForecastDemand(server)

  registerGetItemMetrics(server)
  registerManageAds(server)
  registerGetReputation(server)
  registerSearchCompetitors(server)
  registerGetCategories(server)
  registerGetCategoryAttributes(server)
}

if (!skipTraid) {
  try {
    registerTraidLayer(server)
  } catch (err) {
    console.error('[ml-mcp] Capa TRAID (knowledge tools) falló al registrar:', (err as Error).message)
    console.error('[ml-mcp]   → las otras capas siguen funcionando.')
  }
}

async function main() {
  let proxiedCount = 0
  if (!skipUpstream) {
    proxiedCount = await registerUpstreamProxy(server)
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)

  const capaStatus = [
    !skipUpstream ? `0:official(${proxiedCount})` : '0:off',
    !skipMl ? '1:ml' : '1:off',
    !skipTraid ? '2:traid' : '2:off',
    !skipFlow ? '3:flow(0)' : '3:off',
  ].join(' ')

  console.error(`[ml-mcp] v${PACKAGE_VERSION} iniciado · capas: ${capaStatus}`)
}

main().catch((error) => {
  console.error('[ml-mcp] Error fatal:', error)
  process.exit(1)
})
