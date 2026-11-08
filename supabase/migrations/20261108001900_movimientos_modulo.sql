-- Módulo Movimientos: lista filtrable en el servidor, indicadores, saldo por producto y recálculo de stock.

create view public.v_movimientos
with (security_invoker = true)
as
select m.id,
       m.codigo,
       m.fecha,
       m.tipo,
       case when m.tipo in ('INGRESO', 'DEVOLUCION') then abs(m.cantidad) else -abs(m.cantidad) end as cantidad,
       m.producto_id,
       coalesce(p.codigo, m.producto_codigo)  as item,
       coalesce(m.nombre, p.nombre)           as nombre,
       p.imagen_url,
       m.cliente_texto                        as cliente,
       m.factura_texto                        as factura,
       m.factura_url,
       m.operacion_codigo                     as operacion,
       m.responsable_texto                    as responsable,
       m.observacion,
       m.factura_id,
       m.ingreso_id,
       m.created_at,
       concat_ws(' ', coalesce(p.codigo, m.producto_codigo), coalesce(m.nombre, p.nombre), m.cliente_texto, m.factura_texto,
                 m.operacion_codigo, m.codigo, m.responsable_texto, m.tipo, m.observacion) as texto
from public.movimientos_inventario m
left join public.productos p on p.id = m.producto_id
where m.deleted_at is null;

-- Stock acumulado después de cada movimiento (se consulta solo cuando se elige un producto).
create view public.v_movimientos_saldo
with (security_invoker = true)
as
select m.id,
       m.producto_id,
       sum(case when m.tipo in ('INGRESO', 'DEVOLUCION') then abs(m.cantidad) else -abs(m.cantidad) end)
         over (partition by m.producto_id order by m.fecha, m.created_at) as saldo
from public.movimientos_inventario m
where m.deleted_at is null and m.producto_id is not null;

-- Indicadores de lo que se está viendo (mismos filtros que la lista).
create or replace function public.mov_kpis(p_q text, p_tipo text, p_item text, p_resp text, p_desde timestamptz, p_hasta timestamptz)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'n', count(*),
    'ing', coalesce(sum(cantidad) filter (where cantidad > 0), 0),
    'sal', coalesce(sum(-cantidad) filter (where cantidad < 0), 0),
    'productos', count(distinct item))
  from public.v_movimientos v
  where (coalesce(p_tipo, '') = '' or (p_tipo = 'in' and v.cantidad > 0) or (p_tipo = 'out' and v.cantidad < 0))
    and (coalesce(p_item, '') = '' or upper(v.item) = upper(p_item))
    and (coalesce(p_resp, '') = '' or v.responsable = p_resp)
    and (p_desde is null or v.fecha >= p_desde)
    and (p_hasta is null or v.fecha <= p_hasta)
    and (coalesce(trim(p_q), '') = '' or not exists (
          select 1 from unnest(string_to_array(trim(p_q), ' ')) w where w <> '' and v.texto not ilike '%' || w || '%'));
$$;

-- Recalcula el stock de un producto desde sus movimientos (solo si tiene movimientos).
create or replace function public.recalcular_stock_producto(p_producto uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_n numeric; v_hay boolean;
begin
  if not app.puede_alguno(array['movimientos', 'inventario'], 'editar') then raise exception 'Sin permiso para recalcular el stock'; end if;
  select count(*) > 0, coalesce(sum(case when tipo in ('INGRESO', 'DEVOLUCION') then abs(cantidad) else -abs(cantidad) end), 0)
    into v_hay, v_n from public.movimientos_inventario where producto_id = p_producto and deleted_at is null;
  if v_hay then update public.productos set stock = v_n where id = p_producto; end if;
  return v_n;
end $$;

-- Recalcula el stock de todos los productos que tienen movimientos. Los que no tienen no se tocan.
create or replace function public.recalcular_stock_general()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_cambios jsonb; v_huerfanos jsonb; v_prod integer;
begin
  if not app.puede_alguno(array['movimientos', 'inventario'], 'editar') then raise exception 'Sin permiso para recalcular el stock'; end if;
  with neto as (
    select producto_id, sum(case when tipo in ('INGRESO', 'DEVOLUCION') then abs(cantidad) else -abs(cantidad) end) as n
    from public.movimientos_inventario where deleted_at is null and producto_id is not null group by producto_id),
  calc as (
    select p.id, p.codigo, p.nombre, coalesce(p.stock, 0) as antes, n.n as despues
    from public.productos p join neto n on n.producto_id = p.id where p.deleted_at is null),
  cambios as (select * from calc where antes is distinct from despues),
  upd as (update public.productos p set stock = c.despues from cambios c where p.id = c.id returning p.id)
  select coalesce(jsonb_agg(jsonb_build_object('id', c.codigo, 'nombre', c.nombre, 'antes', c.antes, 'despues', c.despues)), '[]'::jsonb),
         (select count(*) from calc)
    into v_cambios, v_prod
  from cambios c;
  select coalesce(jsonb_agg(jsonb_build_object('item', x.item, 'neto', x.neto)), '[]'::jsonb) into v_huerfanos
  from (select coalesce(producto_codigo, '(sin item)') as item, sum(case when tipo in ('INGRESO', 'DEVOLUCION') then abs(cantidad) else -abs(cantidad) end) as neto
        from public.movimientos_inventario where deleted_at is null and producto_id is null group by 1 limit 50) x;
  return jsonb_build_object('productos', v_prod, 'cambios', v_cambios, 'huerfanos', v_huerfanos);
end $$;

revoke all on public.v_movimientos, public.v_movimientos_saldo from anon;
grant select on public.v_movimientos, public.v_movimientos_saldo to authenticated;
revoke all on function public.mov_kpis(text, text, text, text, timestamptz, timestamptz), public.recalcular_stock_producto(uuid), public.recalcular_stock_general() from anon, public;
grant execute on function public.mov_kpis(text, text, text, text, timestamptz, timestamptz), public.recalcular_stock_producto(uuid), public.recalcular_stock_general() to authenticated;
