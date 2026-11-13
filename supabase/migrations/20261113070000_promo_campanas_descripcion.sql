-- Descripción corta de la campaña de Promociones, visible en Marketing y en Ofertas y Liquidación.
-- (El campo "comentario" ya lo usa quien aprueba para responderle a Marketing.)
alter table public.promo_campanas add column if not exists descripcion text;
