# Changelog

Todas las versiones de `@agustin107/mercadolibre-mcp` en orden inverso.

## [2.7.0] — 2026-09-15

Merge de la línea operativa local (v2.6.0: create_item, mensajes, envíos, analytics, scripts TN↔ML) con el fork TRAID ML Hub (`1.2.0-alpha.2`: token-store Supabase, lease CAS, knowledge tools, proxy oficial, candados).

### Added
- Tools operativas de recover: `get_item`, `create_item`, `update_attributes`, mensajes, envíos, `list_orders`, `forecast_demand`, scripts TN↔ML.
- Del fork: Capa TRAID (`traid_feature_lookup`, `traid_client_context`), proxy MCP oficial, `src/token-store.ts`, lease CAS, `tool-guard`.
- Auth combinado: persistencia en `.env.local` + skip de `ML_ACCESS_TOKEN` stale tras 401 + lease Supabase.

## [2.6.0] — 2026-08-11

### Changed
- `create_item` ampliado: ahora acepta `attributes`, `pictures`, `sale_terms`, `description` y `shipping` básico.
- `mlFetch`: los errores de validación de ML ahora muestran el detalle real de `cause`.

## [1.2.0-alpha.2] — Fusión `meli-seller-mcp` (2026-07-18, publicado 2026-07-31)

Absorbe lo mejor del repo hermano `meli-seller-mcp`. Aditivo: 3 analytics read-only (`price_to_win`, `price_history`, `stockout_risk`), helper `mlGetAll`, lease CAS cross-proceso, candados de tools.

## [1.2.0-alpha.1] — 2026-07-01

TRAID ML Hub: knowledge snapshot, capas, `traid_feature_lookup` / `traid_client_context`.

## [1.1.0] — 2026-05-28

Supabase token-store + proxy al MCP oficial de ML.

## [1.0.0] — 2026-04-17

Release inicial con tools de seller operations.
