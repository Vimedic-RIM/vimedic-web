-- =====================================================================
-- VIMEDIC · Módulo Artículos a importar (reposición)
-- Análisis de productos visibles al público: stock, tránsito, ventas,
-- cotizaciones, último costo y proveedor. Se calcula en la base.
-- =====================================================================
create table if not exists public.imp_notas_articulos (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references public.productos(id) on delete cascade,
  nota         text not null default ''
);
select app.estandarizar('public.imp_notas_articulos');
select app.aplicar_rls('public.imp_notas_articulos', array['importaciones'], array['importaciones']);
create index if not exists imp_notas_articulos_producto_idx on public.imp_notas_articulos (producto_id, created_at desc);

create or replace function public.art_analisis()
returns jsonb language sql stable security invoker set search_path = public as $$
  with vis as (
    select p.id, p.codigo, p.nombre, coalesce(c.nombre, '') as categoria, coalesce(p.imagen_url, '') as imagen, p.stock, p.stock_por_reparar as por_reparar,
           coalesce(p.pvp, 0) as pvp, coalesce(p.precio_dis, 0) as dis, coalesce(pc.costo_importacion, 0) as costo, coalesce(pc.ultima_importacion, '') as imp_costo,
           coalesce(btrim(p.reservaciones), '') as obs_stock
    from public.productos p
    left join public.categorias c on c.id = p.categoria_id
    left join public.productos_costos pc on pc.producto_id = p.id and pc.deleted_at is null
    where p.deleted_at is null and p.en_catalogo and not p.oculto
  ),
  mov as (
    select m.producto_id, m.tipo, m.fecha, abs(m.cantidad) as cant, m.precio, m.descuento, m.cliente_texto, m.bodega
    from public.movimientos_inventario m
    where m.deleted_at is null and m.producto_id in (select id from vis) and m.cantidad <> 0
  ),
  ventas as (
    select producto_id,
      coalesce(sum(cant) filter (where fecha >= now() - interval '90 days'), 0) as v90,
      coalesce(sum(cant) filter (where fecha >= now() - interval '180 days'), 0) as v180,
      coalesce(sum(cant) filter (where fecha >= now() - interval '365 days'), 0) as v365,
      max(fecha) as ultima,
      coalesce(sum(cant * coalesce(precio, 0) * (1 - case when coalesce(descuento, 0) > 1 then descuento / 100.0 else coalesce(descuento, 0) end)) filter (where fecha >= now() - interval '365 days'), 0) as monto12,
      count(*) filter (where fecha >= now() - interval '365 days') as ops12,
      count(distinct lower(btrim(cliente_texto))) filter (where fecha >= now() - interval '365 days' and coalesce(btrim(cliente_texto), '') <> '') as clientes12
    from mov where tipo = 'SALIDA' group by producto_id
  ),
  vm as (
    select producto_id, ((extract(year from now()) - extract(year from fecha)) * 12 + (extract(month from now()) - extract(month from fecha)))::int as k, sum(cant) as q
    from mov where tipo = 'SALIDA' and fecha >= date_trunc('month', now()) - interval '11 months' group by 1, 2
  ),
  ing as (
    select distinct on (producto_id) producto_id, fecha, cant from mov
    where tipo = 'INGRESO' and coalesce(bodega, '') !~* 'reparar' order by producto_id, fecha desc
  ),
  cot as (
    select it->>'codigo' as cod, count(*) as n,
           coalesce(sum(case when it->>'cantidad' ~ '^[0-9]+(\.[0-9]+)?$' then (it->>'cantidad')::numeric else 1 end), 0) as u,
           count(*) filter (where q.estado_crm ilike '%ganad%') as ganadas,
           count(*) filter (where q.estado_crm not ilike '%ganad%' and q.estado_crm not ilike '%perdid%') as abiertas
    from public.cotizaciones q, jsonb_array_elements(q.items) it
    where q.deleted_at is null and q.fecha > now() - interval '90 days' group by 1
  ),
  trans as (
    select i.producto_id, sum(i.cantidad) as total,
           jsonb_agg(jsonb_build_object('codigo', e.codigo, 'cantidad', i.cantidad, 'etapa', coalesce(nullif(e.flujo->>'etapa', ''), e.estado, ''), 'eta', coalesce(e.flujo->>'eta', ''), 'proveedor', coalesce(e.proveedor_texto, ''))) as det
    from public.imp_items i join public.imp_expedientes e on e.codigo = i.pedido_codigo
    where i.deleted_at is null and e.deleted_at is null and i.producto_id in (select id from vis)
      and coalesce(nullif(e.flujo->>'etapa', ''), e.estado, '') not in ('Borrador', 'Ingresado', 'Ingresada', 'En bodega', 'Cerrada')
    group by i.producto_id
  ),
  ultima as (
    select distinct on (i.producto_id) i.producto_id, e.codigo, coalesce(e.proveedor_texto, '') as proveedor
    from public.imp_items i join public.imp_expedientes e on e.codigo = i.pedido_codigo
    where i.deleted_at is null and e.deleted_at is null and i.producto_id in (select id from vis) and coalesce(e.flujo->>'etapa', e.estado, '') <> 'Borrador'
    order by i.producto_id, e.created_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'codigo', v.codigo, 'nombre', v.nombre, 'categoria', v.categoria, 'imagen', v.imagen, 'stock', v.stock, 'porReparar', v.por_reparar, 'pvp', v.pvp, 'precioDis', v.dis, 'costo', v.costo,
    'obsStock', left(v.obs_stock, 400),
    'v90', coalesce(s.v90, 0), 'v180', coalesce(s.v180, 0), 'v365', coalesce(s.v365, 0),
    'ventasMes', (select coalesce(jsonb_agg(coalesce(x.q, 0) order by g.k desc), '[]'::jsonb) from generate_series(0, 11) g(k) left join vm x on x.producto_id = v.id and x.k = g.k),
    'ultimaVenta', to_char(s.ultima, 'YYYY-MM-DD'), 'ultimoIngreso', to_char(i.fecha, 'YYYY-MM-DD'), 'ultimoIngresoCant', coalesce(i.cant, 0),
    'monto12', round(coalesce(s.monto12, 0)::numeric, 2), 'ops12', coalesce(s.ops12, 0), 'clientes12', coalesce(s.clientes12, 0),
    'cot90', coalesce(ct.n, 0), 'cotU90', coalesce(ct.u, 0), 'cotAbiertas', coalesce(ct.abiertas, 0), 'cotGanadas', coalesce(ct.ganadas, 0),
    'transito', coalesce(t.total, 0), 'transitoDetalle', coalesce(t.det, '[]'::jsonb),
    'proveedor', coalesce(u.proveedor, ''), 'ultimaImportacion', coalesce(u.codigo, ''),
    'nota', coalesce((select n.nota from public.imp_notas_articulos n where n.producto_id = v.id and n.deleted_at is null order by n.created_at desc limit 1), ''),
    'notaPor', coalesce((select em.nombre from public.imp_notas_articulos n left join public.empleados em on em.id = n.creado_por where n.producto_id = v.id and n.deleted_at is null order by n.created_at desc limit 1), ''),
    'notaFecha', (select n.updated_at from public.imp_notas_articulos n where n.producto_id = v.id and n.deleted_at is null order by n.created_at desc limit 1)
  ) order by v.nombre), '[]'::jsonb)
  from vis v left join ventas s on s.producto_id = v.id left join ing i on i.producto_id = v.id left join cot ct on ct.cod = v.codigo
  left join trans t on t.producto_id = v.id left join ultima u on u.producto_id = v.id
$$;
grant execute on function public.art_analisis() to authenticated;
revoke execute on function public.art_analisis() from anon, public;
