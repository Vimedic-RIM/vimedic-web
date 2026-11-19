-- =====================================================================
-- Descargo de inventario al facturar (subirFactura del original, Compras_Ventas.gs).
-- En la app original, al subir el número de la factura se creaba una SALIDA en Movimientos por cada producto de la venta
-- (cantidad negativa, con el número y el PDF de la factura) y se descontaba el stock; si la venta ya tenía salidas no se
-- duplicaban (yaTieneSalidas). La app nueva solo marcaba la factura como «Facturado»: desde el 16-nov las facturas
-- registradas aquí no descontaban stock (y tampoco se les podía hacer nota de crédito, que parte de esas salidas).
--   1) app.fac_descargar: crea las salidas de una factura y descuenta el stock (Bodega Comercial). No duplica.
--   2) Trigger: al pasar una factura a «Facturado» desde la app (usuario con sesión) se descarga sola.
--      Las cargas de datos (sin sesión) no disparan el descargo: traen sus propios movimientos del Excel.
--   3) Descargo de las facturas ya registradas en la app nueva que quedaron sin salidas.
-- =====================================================================

create or replace function app.fac_descargar(p_factura uuid, p_fecha timestamptz default null)
returns integer language plpgsql security definer set search_path = public, app as $$
declare
  f record; it jsonb; v_prod_id uuid; v_prod_cod text; v_cant numeric; v_cliente text; v_resp text; v_n integer := 0;
begin
  select * into f from public.facturas where id = p_factura and deleted_at is null;
  if f.id is null or f.estado is distinct from 'Facturado' then return 0; end if;
  -- No duplica: si la venta ya tiene salidas (por la factura o por su código de operación, como yaTieneSalidas del original), no hace nada.
  if exists (select 1 from public.movimientos_inventario m where m.deleted_at is null and m.tipo = 'SALIDA'
             and (m.factura_id = f.id or upper(m.operacion_codigo) in (upper(f.codigo), 'PRO' || upper(f.codigo)))) then
    return 0;
  end if;
  select coalesce(c.nombre, q.nombre) into v_cliente
    from (select 1) x left join public.clientes c on c.id = f.cliente_id left join public.cotizaciones q on q.id = f.cotizacion_id;
  select e.nombre into v_resp from public.empleados e where e.id = f.facturado_por;

  for it in select * from jsonb_array_elements(case when jsonb_typeof(f.items) = 'array' then f.items else '[]'::jsonb end) loop
    v_cant := abs(coalesce(nullif(it ->> 'cantidad', '')::numeric, 0));
    if v_cant = 0 then continue; end if;
    -- El producto se busca por su id; las ventas que vienen de proformas migradas guardan el código en lugar del id.
    v_prod_id := null; v_prod_cod := null;
    select p.id, p.codigo into v_prod_id, v_prod_cod from public.productos p
     where p.deleted_at is null and (p.id::text = it ->> 'id' or p.codigo = coalesce(nullif(it ->> 'codigo', ''), it ->> 'id'))
     order by (p.id::text = it ->> 'id') desc limit 1;
    insert into public.movimientos_inventario (codigo, tipo, operacion_codigo, factura_id, producto_id, producto_codigo, nombre, cliente_texto, factura_texto,
      cantidad, precio, descuento, aplica_iva, responsable_id, responsable_texto, fecha, observacion, factura_url, imagen_url)
    values ('SAL-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 10)), 'SALIDA', f.codigo, f.id, v_prod_id,
      coalesce(v_prod_cod, nullif(it ->> 'codigo', ''), it ->> 'id'), it ->> 'nombre', v_cliente, f.numero_contifico,
      -v_cant, nullif(it ->> 'precio', '')::numeric, coalesce(nullif(it ->> 'descuento', '')::numeric, 0), (it ->> 'iva') is distinct from 'false',
      f.facturado_por, v_resp, coalesce(p_fecha, now()), nullif(btrim(coalesce(it ->> 'observacion', '')), ''), f.pdf_url, nullif(it ->> 'imagen', ''));
    -- Stock de la Bodega Comercial (app.stock_mov: SALIDA sin bodega = −cantidad)
    if v_prod_id is not null then update public.productos set stock = coalesce(stock, 0) - v_cant where id = v_prod_id; end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function app.fac_descargar(uuid, timestamptz) from public, anon, authenticated;

create or replace function app.tg_factura_descargo()
returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.estado = 'Facturado' and new.deleted_at is null and auth.uid() is not null
     and (tg_op = 'INSERT' or old.estado is distinct from 'Facturado') then
    perform app.fac_descargar(new.id);
  end if;
  return null;
end $$;

drop trigger if exists tg_factura_descargo on public.facturas;
create trigger tg_factura_descargo after insert or update of estado on public.facturas
  for each row execute function app.tg_factura_descargo();

-- 3) Facturas registradas en la app nueva (historial «Factura registrada») sin salidas. Se saltan las que ya tienen una salida
--    con el mismo número de factura (por si la venta también se registró en la app original).
do $$
declare r record; v integer; v_total integer := 0; v_fact integer := 0;
begin
  for r in
    select f.id, f.codigo, coalesce(f.facturado_en, now()) as fecha
    from public.facturas f
    where f.deleted_at is null and f.estado = 'Facturado' and f.fecha_facturacion >= date '2026-11-16'
      and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(f.historial) = 'array' then f.historial else '[]'::jsonb end) h where h ->> 'accion' = 'Factura registrada')
      and not exists (select 1 from public.movimientos_inventario m where m.deleted_at is null and m.tipo = 'SALIDA' and m.factura_id = f.id)
      and not exists (select 1 from public.movimientos_inventario m where m.deleted_at is null and m.tipo = 'SALIDA'
                        and (regexp_match(coalesce(m.factura_texto, ''), '(\d+)\D*$'))[1]::numeric = (regexp_match(coalesce(f.numero_contifico, ''), '(\d+)\D*$'))[1]::numeric)
    order by f.facturado_en nulls last
  loop
    v := app.fac_descargar(r.id, r.fecha);
    v_total := v_total + v; v_fact := v_fact + 1;
    raise notice 'Descargo % → % salida(s)', r.codigo, v;
  end loop;
  raise notice 'Descargo de % factura(s), % salida(s)', v_fact, v_total;
end $$;
