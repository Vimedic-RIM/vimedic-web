-- =====================================================================
-- "Guía de envío" (etiqueta simple remitente/destinatario, ya existía) y
-- "guía de despacho" (documento con QR y productos, Issue #4) son dos
-- cosas distintas — se habían mezclado en la misma columna por error.
-- =====================================================================
alter table public.facturas add column if not exists guia_despacho_url text;
comment on column public.facturas.guia_envio_url is 'Etiqueta de envío (remitente/destinatario) para el paquete del courier. No confundir con guia_despacho_url.';
comment on column public.facturas.guia_despacho_url is 'Guía de despacho interna con QR de seguimiento y detalle de productos (Issue #4). No confundir con guia_envio_url.';
