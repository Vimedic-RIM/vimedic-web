-- =====================================================================
-- Obsequios de evangelización (Issue #8): en cada factura se entrega un
-- regalo promocional. Catálogo simple con foto + asignación por factura,
-- para que el asesor vea qué ya recibió el mismo cliente y no se repita.
-- =====================================================================
create table public.obsequios (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  imagen_url  text,
  activo      boolean not null default true
);
select app.estandarizar('public.obsequios');
select app.aplicar_rls('public.obsequios', array['facturacion'], array['facturacion']);

alter table public.facturas add column if not exists obsequio_id uuid references public.obsequios(id) on delete set null;
create index if not exists facturas_obsequio_idx on public.facturas (obsequio_id);
comment on column public.facturas.obsequio_id is 'Obsequio de evangelización entregado con este pedido (tabla obsequios).';
