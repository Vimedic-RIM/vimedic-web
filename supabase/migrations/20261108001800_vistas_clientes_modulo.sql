-- Módulo Clientes: lista con contacto, asesor y actividad (filtrable y paginable en el servidor) + indicadores.
create view public.v_clientes_lista
with (security_invoker = true)
as
select c.id,
       c.empresa,
       c.identificacion,
       c.nombre,
       c.institucion,
       c.ciudad,
       c.telefono,
       c.email,
       c.asesor_id,
       d.nombre as asesor,
       coalesce(c.fecha_registro, c.created_at) as registro,
       r.total_cotizaciones,
       r.total_ventas,
       r.monto_ventas,
       r.ultima_cotizacion,
       r.ultima_venta,
       greatest(r.ultima_venta::timestamptz, r.ultima_cotizacion) as ultima_actividad
from public.clientes c
left join public.v_clientes_resumen r on r.id = c.id
left join public.v_directorio_empleados d on d.id = c.asesor_id
where c.deleted_at is null;

create view public.v_clientes_kpis
with (security_invoker = true)
as
select count(*)                                                                                   as clientes,
       count(*) filter (where total_ventas > 0)                                                   as con_compras,
       coalesce(sum(monto_ventas), 0)                                                             as facturado,
       count(*) filter (where ultima_actividad < now() - interval '182 days')                     as inactivos,
       count(*) filter (where coalesce(total_ventas, 0) = 0 and total_cotizaciones > 0)           as solo_cotizaron,
       count(*) filter (where coalesce(total_ventas, 0) = 0 and coalesce(total_cotizaciones, 0) = 0) as sin_gestiones
from public.v_clientes_lista;

revoke all on public.v_clientes_lista, public.v_clientes_kpis from anon;
grant select on public.v_clientes_lista, public.v_clientes_kpis to authenticated;
