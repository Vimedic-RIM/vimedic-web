-- Con los datos reales (1.5 mil clientes, 5.5 mil cotizaciones, 2.6 mil facturas) la lista de Clientes agotaba el tiempo:
-- la vista calculaba 5 subconsultas por cliente. Ahora agrega cotizaciones y facturas una sola vez.
create or replace view public.v_clientes_resumen
with (security_invoker = true)
as
with q as (
  select cliente_id,
         count(*) filter (where tipo_registro <> 'Venta') as total_cotizaciones,
         max(fecha) as ultima_cotizacion
  from public.cotizaciones
  where deleted_at is null and cliente_id is not null
  group by cliente_id
), f as (
  select cliente_id,
         count(*) as total_ventas,
         coalesce(sum(coalesce(total_neto, total)), 0) as monto_ventas,
         max(fecha_facturacion) as ultima_venta
  from public.facturas
  where deleted_at is null and cliente_id is not null
  group by cliente_id
)
select c.id,
       c.empresa,
       c.identificacion,
       c.nombre,
       c.institucion,
       c.ciudad,
       c.tipo_cliente,
       c.asesor_id,
       coalesce(q.total_cotizaciones, 0) as total_cotizaciones,
       q.ultima_cotizacion,
       coalesce(f.total_ventas, 0) as total_ventas,
       coalesce(f.monto_ventas, 0) as monto_ventas,
       f.ultima_venta
from public.clientes c
left join q on q.cliente_id = c.id
left join f on f.cliente_id = c.id
where c.deleted_at is null;

-- Índices para todas las llaves foráneas que no tenían (excepto creado_por, que solo sirve para auditoría).
do $$
declare r record;
begin
  for r in
    select t.relname as tabla, a.attname as columna
    from pg_constraint k
    join pg_class t on t.oid = k.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = k.conkey[1]
    where k.contype = 'f' and n.nspname = 'public' and array_length(k.conkey, 1) = 1 and a.attname <> 'creado_por'
      and not exists (select 1 from pg_index i where i.indrelid = t.oid and i.indkey[0] = k.conkey[1])
  loop
    execute format('create index if not exists %I on public.%I (%I)', 'idx_' || left(r.tabla, 30) || '_' || left(r.columna, 25), r.tabla, r.columna);
  end loop;
end $$;

analyze;
