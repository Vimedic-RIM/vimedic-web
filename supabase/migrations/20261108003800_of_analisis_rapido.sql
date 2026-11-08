-- of_analisis tardaba ~35 s con los datos reales: recorría la lista de ingresos y las cotizaciones una vez POR PRODUCTO.
-- Ahora calcula los lotes y el interés en una sola pasada. El resultado es el mismo.
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
  lot as (
    select i.producto_id,
           jsonb_agg(jsonb_build_array(to_char(i.fecha, 'YYYY-MM-DD'), least(i.q, p.stock - (i.acum - i.q))) order by i.fecha desc) as lotes,
           min(i.fecha) as mas_viejo
    from ing i join public.productos p on p.id = i.producto_id
    where i.acum - i.q < p.stock
    group by i.producto_id
  ),
  primer as (select producto_id, min(fecha) as primer_ingreso from ing group by producto_id),
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
  interes as (
    select it->>'codigo' as codigo, count(distinct q.id) as n
    from public.cotizaciones q, jsonb_array_elements(q.items) it
    where q.deleted_at is null and q.tipo_registro <> 'Venta' and q.estado_crm not ilike '%ganado%' and q.fecha > now() - interval '540 days'
    group by 1
  ),
  base as (
    select p.id, p.codigo, p.nombre, coalesce(c.nombre, '') as categoria, coalesce(p.marca, '') as marca, coalesce(p.imagen_url, '') as imagen,
           p.stock, coalesce(p.pvp, 0) as pvp, coalesce(p.precio_dis, 0) as dis, coalesce(pc.costo_importacion, 0) as costo,
           coalesce(btrim(p.reservaciones), '') as obs, p.stock_no_disponible_nc as nc, p.stock_por_reparar as rep, coalesce(n.n, 0) as norep, p.oculto,
           coalesce(l.lotes, '[]'::jsonb) as lotes, l.mas_viejo, pr.primer_ingreso,
           v.ult, coalesce(v.v90, 0) as v90, coalesce(v.v365, 0) as v365, coalesce(v.monto, 0) as monto
    from public.productos p
    left join public.categorias c on c.id = p.categoria_id
    left join public.productos_costos pc on pc.producto_id = p.id and pc.deleted_at is null
    left join ventas v on v.producto_id = p.id
    left join norep n on n.producto_id = p.id
    left join lot l on l.producto_id = p.id
    left join primer pr on pr.producto_id = p.id
    where p.deleted_at is null
  ),
  cand as (
    select * from base
    where (stock > 0 and coalesce(mas_viejo, primer_ingreso) is not null and coalesce(mas_viejo, primer_ingreso) <= now() - interval '90 days')
       or (stock > 0 and coalesce(mas_viejo, primer_ingreso) is null)
       or obs <> '' or nc > 0 or rep > 0 or norep > 0
  )
  select jsonb_build_object('productos', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'codigo', codigo, 'nombre', nombre, 'categoria', categoria, 'marca', marca, 'img', imagen, 'stock', stock, 'pvp', pvp, 'dis', dis, 'costo', costo,
    'obs', obs, 'nc', nc, 'rep', rep, 'noRep', norep, 'oculto', oculto, 'lotes', lotes,
    'masViejo', to_char(coalesce(mas_viejo, primer_ingreso), 'YYYY-MM-DD'),
    'ultVenta', to_char(ult, 'YYYY-MM-DD'), 'v90', v90, 'v365', v365, 'monto', monto,
    'interes', coalesce((select n from interes where interes.codigo = cand.codigo), 0)
  )), '[]'::jsonb) from cand),
  'estrellas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'nombre', nombre, 'categoria', categoria)), '[]'::jsonb) from (
     select id, codigo, nombre, categoria, row_number() over (partition by categoria order by monto desc) rn from base where stock > 0 and not oculto and monto > 0) e where rn <= 3))
$$;
grant execute on function public.of_analisis() to authenticated;
