#!/usr/bin/env node

// Mercado Libre MCP Server — operaciones diarias de seller (lectura + escritura).
// Tools alineadas con tiendanube-mcp para futura sincronización cross-platform.
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
import {
  registerPriceToWin,
  registerPriceHistory,
  registerStockoutRisk,
  registerForecastDemand,
} from './tools/advanced-analytics.js'
import { registerGetItemMetrics } from './tools/metrics.js'
import { registerManageAds } from './tools/ads.js'
import { registerGetReputation } from './tools/reputation.js'
import { registerSearchCompetitors } from './tools/competitors.js'
import { registerGetCategories, registerGetCategoryAttributes } from './tools/categories.js'

export const PACKAGE_VERSION = '2.5.0'

const server = new McpServer({
  name: 'mercadolibre',
  version: PACKAGE_VERSION,
})

// Productos (16)
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

// Preguntas (2)
registerListQuestions(server)
registerAnswerQuestion(server)

// Órdenes (4)
registerGetOrders(server)
registerListOrders(server)
registerGetOrder(server)
registerGetOrderPayments(server)

// Envíos (3)
registerListShipments(server)
registerGetShipment(server)
registerUpdateShipmentTracking(server)

// Mensajes post-venta (3)
registerListMessageThreads(server)
registerGetMessageThread(server)
registerSendMessage(server)

// Analytics (6)
registerGetRevenueSummary(server)
registerGetSalesByPeriod(server)
registerGetBestSellingProducts(server)
registerGetOrdersDashboard(server)
registerGetInventoryAlerts(server)
registerGetPendingPayments(server)

// Analytics avanzados (4)
registerPriceToWin(server)
registerPriceHistory(server)
registerStockoutRisk(server)
registerForecastDemand(server)

// Lectura existente (4)
// (get_category_attributes registrado junto a get_categories)
registerGetItemMetrics(server)
registerManageAds(server)
registerGetReputation(server)
registerSearchCompetitors(server)
registerGetCategories(server)
registerGetCategoryAttributes(server)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[ml-mcp] Server iniciado v${PACKAGE_VERSION} — 40 tools disponibles`)
}

main().catch((error) => {
  console.error('[ml-mcp] Error fatal:', error)
  process.exit(1)
})
