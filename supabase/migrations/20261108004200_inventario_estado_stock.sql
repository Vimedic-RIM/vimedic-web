-- =====================================================================
-- Inventario: dónde está el stock y qué viene en camino.
-- Equivale a vmInvEstadoStock() de la app original. Sin proveedor, país ni costos.
--   revision:   unidades que ya están en bodega (importación "En bodega") y Bodega aún no aprueba.
--   reparacion: productos.stock_por_reparar (equipos en Servicio Técnico).
--   porLlegar:  unidades en camino de importaciones confirmadas (Registrado, En tránsito, En aduana).
-- Se devuelve por id de producto (uuid) y la lista de importaciones para filtrar el Inventario.
-- =====================================================================
create or replace function public.inv_estado_stock()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  res jsonb;
begin
  if not app.puede('inventario', 'ver') then
    raise exception 'No tienes acceso al módulo Inventario.';
  end if;

  with exp as (
    select e.id, e.codigo,
           coalesce(nullif(e.flujo->>'nombre', ''), nullif(e.referencia, ''), e.codigo) as nombre,
           nullif(left(coalesce(e.flujo->>'eta', e.embarque->>'eta', ''), 10), '') as eta,
           case
             when coalesce(e.recepcion->>'confirmada', '') = 'true' then 'Ingresado'
             when e.flujo->>'origen' = 'interno' and coalesce(e.flujo->'enviado', 'null'::jsonb) = 'null'::jsonb then 'Borrador'
             when exists (select 1 from public.imp_recepciones o where o.pedido_codigo = e.codigo and o.tipo = 'REVISION' and o.deleted_at is null) then 'En bodega'
             when e.flujo->>'etapa' in ('Registrado', 'En tránsito', 'En aduana', 'En bodega') then e.flujo->>'etapa'
             else 'Registrado'
           end as etapa,
           coalesce(
             (select left(min(x->>'fecha'), 10) from jsonb_array_elements(case when jsonb_typeof(e.flujo->'etapas') = 'array' then e.flujo->'etapas' else '[]'::jsonb end) x where x->>'etapa' = 'En bodega'),
             (select left(min(o.fecha::text), 10) from public.imp_recepciones o where o.pedido_codigo = e.codigo and o.tipo = 'REVISION' and o.deleted_at is null)
           ) as llegada
      from public.imp_expedientes e
     where e.deleted_at is null
  ), lin as (
    select x.codigo, x.nombre, x.eta, x.llegada, x.etapa, i.cantidad,
           coalesce(i.producto_id, p.id) as prod_id,
           greatest(0, i.cantidad - s.rec - s.falt) as por_recibir,
           s.pend, s.st + s.dev as en_st
      from exp x
      join public.imp_items i on i.pedido_codigo = x.codigo and i.deleted_at is null and i.cantidad > 0
      left join public.productos p on p.codigo = i.codigo_producto and p.deleted_at is null
      left join lateral (
        select coalesce(sum(nullif(o.cantidades->>'rec', '')::numeric), 0) as rec,
               coalesce(sum(nullif(o.cantidades->>'pend', '')::numeric), 0) as pend,
               coalesce(sum(nullif(o.cantidades->>'st', '')::numeric), 0) as st,
               coalesce(sum(nullif(o.cantidades->>'dev', '')::numeric), 0) as dev,
               coalesce(sum(nullif(o.cantidades->>'falt', '')::numeric), 0) as falt
          from public.imp_recepciones o
         where o.item_id = i.id and o.deleted_at is null
      ) s on true
     where x.etapa <> 'Borrador'
  ), vis as (
    select l.*,
           case when l.etapa = 'En bodega' then 0 else l.por_recibir end as en_camino,
           case when l.etapa = 'En bodega' then l.pend + l.por_recibir else l.pend end as en_revision
      from lin l
     where l.etapa <> 'Ingresado'
  ), por_prod as (
    select prod_id,
           sum(en_revision)::int as revision,
           sum(en_camino)::int as por_llegar,
           min(eta) filter (where en_camino > 0) as eta,
           jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', left(nombre, 80), 'etapa', etapa, 'eta', coalesce(eta, ''), 'llegada', coalesce(llegada, ''),
                                        'enCamino', en_camino, 'enRevision', en_revision, 'enST', en_st) order by coalesce(eta, '9')) as imps
      from vis
     where prod_id is not null and (en_camino > 0 or en_revision > 0)
     group by prod_id
  ), rep as (
    select id as prod_id, stock_por_reparar as reparacion from public.productos where deleted_at is null and stock_por_reparar > 0
  ), prods as (
    select coalesce(a.prod_id, r.prod_id) as prod_id,
           jsonb_build_object('revision', coalesce(a.revision, 0), 'reparacion', coalesce(r.reparacion, 0), 'porLlegar', coalesce(a.por_llegar, 0),
                              'eta', coalesce(a.eta, ''), 'imps', coalesce(a.imps, '[]'::jsonb)) as o
      from por_prod a full join rep r on r.prod_id = a.prod_id
  ), resumen as (
    select x.codigo, x.nombre, x.etapa, x.eta, x.llegada,
           (select coalesce(jsonb_object_agg(t.prod_id, t.u), '{}'::jsonb) from (select prod_id, sum(cantidad)::int u from lin l where l.codigo = x.codigo and l.prod_id is not null group by prod_id) t) as productos,
           (select count(*) from lin l where l.codigo = x.codigo and l.prod_id is null)::int as nuevos
      from exp x
     where x.etapa <> 'Borrador'
  ), lista as (
    select * from (
      select r.*, row_number() over (partition by (r.etapa = 'Ingresado') order by case when r.etapa = 'Ingresado' then 0 end, r.codigo desc) as n from resumen r
    ) z where z.etapa <> 'Ingresado' or z.n <= 20
  )
  select jsonb_build_object(
    'productos', coalesce((select jsonb_object_agg(prod_id::text, o) from prods), '{}'::jsonb),
    'importaciones', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', left(nombre, 80), 'etapa', etapa, 'eta', coalesce(eta, ''),
                                'llegada', coalesce(llegada, ''), 'productos', productos, 'nuevos', nuevos)
                                order by (etapa = 'Ingresado'), coalesce(eta, '9'), codigo) from lista), '[]'::jsonb),
    'generado', now()
  ) into res;

  return res;
end;
$$;

revoke all on function public.inv_estado_stock() from public, anon;
grant execute on function public.inv_estado_stock() to authenticated;
