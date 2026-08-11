# Changelog

Todas las versiones de `@traid/mercadolibre-mcp-read` en orden inverso.

## [2.6.0] — 2026-08-11

### Changed
- `create_item` ampliado: ahora acepta `attributes` (BRAND, MODEL, etc. — obligatorios en la mayoría de las categorías), `pictures` (múltiples fotos), `sale_terms` (garantía), `description` (se carga en un 2do paso vía POST /items/{id}/description) y `shipping` básico (`local_pick_up`, `free_shipping`). Antes el POST mínimo fallaba con "Validation error" en categorías con atributos requeridos.
- `mlFetch`: los errores de validación de ML ahora muestran el detalle real de `cause` (antes salía "[object Object]").

## [1.0.0] — 2026-04-17

### Added
- Release inicial con 7 tools read-only
- OAuth2 con dos modos: token directo o auto-refresh
- Soporte para MLA (Argentina), MLM (México), MLB (Brasil) y resto de sitios Mercado Libre
- Compatibilidad con Claude Code, Cursor, Continue y cualquier cliente MCP
- SKILL.md con metadata para distribución en marketplace

### Tools
- `list_products` — publicaciones del seller
- `get_orders` — órdenes con detalle
- `list_questions` — preguntas recibidas (sin `answer_question`)
- `get_item_metrics` — métricas de publicación
- `get_reputation` — reputación del vendedor
- `search_competitors` — competencia por keyword
- `get_categories` — árbol de categorías

### Notes
- Subset estrictamente read-only del paquete comercial `@traid/mercadolibre-mcp`.
- Sin write-back: no incluye `update_price`, `update_stock`, `answer_question`, `manage_ads`.
