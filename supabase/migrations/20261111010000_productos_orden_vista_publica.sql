-- =====================================================================
-- Orden consistente de productos: primero los que están en la vista
-- pública del catálogo (en_catalogo y no oculto), por su número de
-- orden; después el resto. Antes "orden" mezclaba productos públicos
-- y no públicos en una sola secuencia, así que en varias listas
-- (cotizador, importaciones, biblioteca de marketing...) aparecían
-- intercalados sin ningún criterio claro.
-- =====================================================================

alter table public.productos
  add column if not exists en_vista_publica boolean
  generated always as (en_catalogo and not oculto) stored;

create index if not exists productos_vista_publica_orden_idx
  on public.productos (en_vista_publica desc, orden, nombre)
  where deleted_at is null;
