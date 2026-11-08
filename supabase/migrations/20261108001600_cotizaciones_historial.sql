-- Historial de versiones de cada cotización/venta: quién, cuándo y qué cambió (con foto de los productos de esa versión).
-- Reemplaza la necesidad de guardar cada PDF: la proforma se regenera desde la versión.
create table public.cotizaciones_historial (
  id            uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references public.cotizaciones(id),
  version       integer not null,
  cambios       text[] not null default '{}',
  items         jsonb not null default '[]'::jsonb,
  total         numeric(12,2) not null default 0,
  nota          text,
  cliente       jsonb,
  empleado_id   uuid references public.empleados(id),
  usuario_texto text,
  unique (cotizacion_id, version)
);
select app.estandarizar('public.cotizaciones_historial');
create index cotizaciones_historial_cot_idx on public.cotizaciones_historial (cotizacion_id, version desc);
select app.aplicar_rls('public.cotizaciones_historial', array['crm','femedics','clientes'], array['crm','femedics']);
