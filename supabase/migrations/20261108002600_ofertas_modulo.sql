-- =====================================================================
-- VIMEDIC · Módulo Ofertas y Liquidación
-- Análisis de stock dormido (PEPS desde movimientos), resultados por oferta
-- y ajustes del estratega. Todo se calcula en la base, no en el navegador.
-- =====================================================================
alter table public.ofertas add column if not exists motivo_eliminacion text;

create table if not exists public.ofertas_config (
  id uuid primary key default gen_random_uuid(),
  valor jsonb not null default '{"margenMinimo":10,"desc36":8,"desc612":15,"desc12":25,"descObs":30,"diasOferta":30}'::jsonb
);
select app.estandarizar('public.ofertas_config');
select app.aplicar_rls('public.ofertas_config', array['ofertas'], array['ofertas']);
insert into public.ofertas_config (id) select gen_random_uuid() where not exists (select 1 from public.ofertas_config);

-- Productos con stock dormido o con observaciones, con sus lotes en bodega (primero en entrar, primero en salir)
create or replace function public.of_analisis()
returns jsonb language sql stable security invoker set search_path = public as $$
  with mov as (
    select m.producto_id, m.fecha, m.created_at, m.tipo, m.precio, m.descuento,
           case when m.tipo in ('INGRESO', 'DEVOLUCION') then abs(m.cantidad) else -abs(m.cantidad) end as q
    from public.movimientos_inventario m
    where m.deleted_at is null and m.producto_id is not null and coalesce(m.bodega, '') <> 'Por reparar' and m.cantidad <> 0
  ),
  ing as (
    select producto_id, fecha, q,
           sum(q) over (partition by producto_id order by fecha desc, created_at desc rows between unbounded preceding and current row) as acum
    from mov where q > 0
  ),
  ventas as (
    select producto_id,
           max(fecha) as ult, 
           coalesce(sum(-q) filter (where fecha >= now() - interval '90 days'), 0) as v90,
           coalesce(sum(-q) filter (where fecha >= now() - interval '365 days'), 0) as v365,
           coalesce(sum(-q * coalesce(nullif(precio, 0), 0)), 0) as monto
    from mov where q < 0 and tipo not like 'TRASLADO%' group by producto_id
  ),
  norep as (
    select producto_id, count(*) as n from public.imp_unidades where deleted_at is null and estado = 'No reparable' and producto_id is not null group by producto_id
  ),
  base as (
    select p.id, p.codigo, p.nombre, coalesce(c.nombre, '') as categoria, coalesce(p.marca, '') as marca, coalesce(p.imagen_url, '') as imagen,
           p.stock, coalesce(p.pvp, 0) as pvp, coalesce(p.precio_dis, 0) as dis, coalesce(pc.costo_importacion, 0) as costo,
           coalesce(btrim(p.reservaciones), '') as obs, p.stock_no_disponible_nc as nc, p.stock_por_reparar as rep, coalesce(n.n, 0) as norep, p.oculto,
           (select coalesce(jsonb_agg(jsonb_build_array(to_char(i.fecha, 'YYYY-MM-DD'), least(i.q, p.stock - (i.acum - i.q))) order by i.fecha desc), '[]'::jsonb)
              from ing i where i.producto_id = p.id and i.acum - i.q < p.stock) as lotes,
           (select min(i.fecha) from ing i where i.producto_id = p.id and i.acum - i.q < p.stock) as mas_viejo,
           (select min(i.fecha) from ing i where i.producto_id = p.id) as primer_ingreso,
           v.ult, coalesce(v.v90, 0) as v90, coalesce(v.v365, 0) as v365, coalesce(v.monto, 0) as monto
    from public.productos p
    left join public.categorias c on c.id = p.categoria_id
    left join public.productos_costos pc on pc.producto_id = p.id and pc.deleted_at is null
    left join ventas v on v.producto_id = p.id
    left join norep n on n.producto_id = p.id
    where p.deleted_at is null
  ),
  cand as (
    select * from base
    where (stock > 0 and coalesce(mas_viejo, primer_ingreso) is not null and coalesce(mas_viejo, primer_ingreso) <= now() - interval '90 days')
       or (stock > 0 and coalesce(mas_viejo, primer_ingreso) is null)
       or obs <> '' or nc > 0 or rep > 0 or norep > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'codigo', codigo, 'nombre', nombre, 'categoria', categoria, 'marca', marca, 'img', imagen, 'stock', stock, 'pvp', pvp, 'dis', dis, 'costo', costo,
    'obs', obs, 'nc', nc, 'rep', rep, 'noRep', norep, 'oculto', oculto, 'lotes', lotes,
    'masViejo', to_char(coalesce(mas_viejo, primer_ingreso), 'YYYY-MM-DD'),
    'ultVenta', to_char(ult, 'YYYY-MM-DD'), 'v90', v90, 'v365', v365, 'monto', monto,
    'interes', (select count(*) from public.cotizaciones q
                where q.deleted_at is null and q.tipo_registro <> 'Venta' and q.estado_crm not ilike '%ganado%' and q.fecha > now() - interval '540 days'
                  and q.items @> jsonb_build_array(jsonb_build_object('codigo', cand.codigo)))
  )), '[]'::jsonb) from cand
$$;
grant execute on function public.of_analisis() to authenticated;
revoke execute on function public.of_analisis() from anon, public;

-- Ventas de cada oferta dentro de su vigencia (según movimientos)
create or replace view public.v_ofertas_resultados with (security_invoker = true) as
select o.id as oferta_id,
       coalesce(sum(-q) , 0)::int as vendidas,
       round(coalesce(sum(-q * coalesce(nullif(m.precio, 0), o.precio_oferta) * (1 - coalesce(m.descuento, 0) / 100.0)), 0)::numeric, 2) as recuperado,
       greatest(0, round(extract(epoch from (least(now(), case when o.estado = 'Cancelada' then o.updated_at else o.fin::timestamptz + interval '1 day' end) - o.inicio::timestamptz)) / 86400))::int as dias
from public.ofertas o
left join lateral (
  select case when m.tipo in ('INGRESO', 'DEVOLUCION') then abs(m.cantidad) else -abs(m.cantidad) end as q, m.precio, m.descuento
  from public.movimientos_inventario m
  where m.producto_id = o.producto_id and m.deleted_at is null and m.tipo not in ('INGRESO', 'DEVOLUCION') and m.tipo not like 'TRASLADO%'
    and m.fecha >= o.inicio::timestamptz
    and m.fecha <= least(now(), case when o.estado = 'Cancelada' then o.updated_at else o.fin::timestamptz + interval '1 day' end)
) m on true
where o.deleted_at is null
group by o.id, o.updated_at, o.estado, o.fin, o.inicio, o.precio_oferta;
grant select on public.v_ofertas_resultados to authenticated;
