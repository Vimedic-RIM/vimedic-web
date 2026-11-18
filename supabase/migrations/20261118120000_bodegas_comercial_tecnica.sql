-- =====================================================================
-- VIMEDIC · Dos bodegas: Bodega Comercial y Bodega Técnica (18-nov-2026)
--
-- Proceso: lo que llega de importación pasa por la revisión de Bodega.
--   · Aprobado        → Bodega Comercial (lo que se vende; lo ven todos).
--   · Con defecto     → Bodega Técnica (Servicio Técnico). Al repararse y
--                       aprobarse vuelve: traslado Técnica → Comercial.
--   · Devoluciones por nota de crédito: si no se había despachado vuelve
--     directo a la Bodega Comercial; si ya se despachó queda «Por verificar»
--     y Bodega decide a qué bodega va.
-- Stock comercial = Bodega Comercial (productos.stock, igual que antes).
-- Stock total     = Bodega Comercial + Bodega Técnica (productos.stock_por_reparar).
--
-- Los valores guardados en movimientos_inventario.bodega NO cambian (los usan
-- los cálculos de stock): vacío o 'Principal' = Bodega Comercial,
-- 'Por reparar' = Bodega Técnica, 'Por verificar' (nuevo) = devolución que
-- Bodega aún no verifica (no suma a ningún stock).
-- =====================================================================

-- 1) Regla del stock: lo que está «Por verificar» no suma
create or replace function app.stock_mov(p_tipo text, p_bodega text, p_cantidad numeric, p_disponible boolean)
returns numeric language sql immutable as $$
  select case when coalesce(p_bodega, '') in ('Por reparar', 'Por verificar') or p_disponible is false then 0
              when coalesce(p_bodega, '') = 'Principal' then coalesce(p_cantidad, 0)
              when p_tipo in ('INGRESO', 'DEVOLUCION') then abs(coalesce(p_cantidad, 0))
              else -abs(coalesce(p_cantidad, 0)) end
$$;

-- 2) Nombre visible de cada bodega
create or replace function app.bodega_nombre(p_bodega text)
returns text language sql immutable as $$
  select case coalesce(p_bodega, '') when 'Por reparar' then 'Bodega Técnica' when 'Por verificar' then 'Por verificar' else 'Bodega Comercial' end
$$;

-- 3) Quién ve la Bodega Técnica y el stock total: Movimientos, Servicio Técnico, Bodega, Importaciones,
--    quien edita Inventario y la administración. Los asesores ven solo el stock comercial.
create or replace function app.ve_bodega_tecnica()
returns boolean language sql stable as $$
  select app.es_superadmin()
      or app.puede_alguno(array['movimientos', 'servicio_tecnico', 'bodega', 'importaciones'], 'ver')
      or app.puede('inventario', 'editar')
$$;
grant execute on function app.bodega_nombre(text), app.ve_bodega_tecnica() to authenticated;

-- 4) Proveedor de importación abreviado en los movimientos (cuidado de la información):
--    «HEALICOM MEDICAL EQUIPMENT CO LTD» → «HME». La factura del movimiento es el código de la importación (PI-…).
create or replace function app.abreviar_proveedor(p text)
returns text language sql immutable as $$
  with w as (
    select x, ord
      from regexp_split_to_table(upper(coalesce(p, '')), '[^A-Z0-9ÁÉÍÓÚÑÜ]+') with ordinality as t(x, ord)
     where x <> '' and x not in ('CO', 'LTD', 'LIMITED', 'INC', 'LLC', 'CORP', 'CORPORATION', 'COMPANY', 'SA', 'S', 'A', 'DE', 'CV', 'SAS', 'CIA',
                                 'GMBH', 'AG', 'PLC', 'THE', 'AND', 'Y', 'OF', 'DEL', 'LA', 'EL', 'LTDA', 'SRL', 'IMP', 'EXP')
  )
  select case when not exists (select 1 from w) then nullif(left(trim(coalesce(p, '')), 3), '')
              when (select count(*) from w) = 1 then (select left(x, 4) from w)
              else (select string_agg(left(x, 1), '' order by ord) from w) end
$$;

create or replace function app.rec_movimiento(p_tipo text, p_bodega text, p_cantidad numeric, p_prod public.productos, p_exp public.imp_expedientes, p_precio numeric, p_obs text)
returns void language sql security definer set search_path = public as $$
  insert into public.movimientos_inventario (id, codigo, tipo, operacion_codigo, producto_id, producto_codigo, nombre, cliente_texto, factura_texto, cantidad, precio,
    responsable_id, responsable_texto, fecha, bodega, observacion)
  values (gen_random_uuid(), 'MOV-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 10)), p_tipo, p_exp.codigo, p_prod.id, p_prod.codigo, p_prod.nombre,
    app.abreviar_proveedor(p_exp.proveedor_texto), p_exp.codigo, p_cantidad, coalesce(p_precio, 0), app.empleado_id(), app.rec_quien(), now(), p_bodega, left(p_obs, 1000))
$$;

-- 5) Datos ya registrados (revisiones hechas antes de esta decisión)
-- 5a) Movimientos de importación: proveedor abreviado y la importación como factura
update public.movimientos_inventario m
   set cliente_texto = app.abreviar_proveedor(e.proveedor_texto), factura_texto = e.codigo
  from public.imp_expedientes e
 where m.operacion_codigo = e.codigo and m.deleted_at is null and e.proveedor_texto is not null
   and (m.cliente_texto = e.proveedor_texto or m.factura_texto = e.referencia);

-- 5b) Traslado Técnica → Comercial registrado en la app original como «SALIDA» con cantidad positiva:
--     es una entrada a la Bodega Comercial (el stock no cambia; solo el tipo y el acumulado).
update public.movimientos_inventario set tipo = 'INGRESO'
 where deleted_at is null and tipo = 'SALIDA' and bodega in ('Principal', 'Por reparar') and cantidad > 0;
update public.movimientos_inventario set tipo = 'SALIDA'
 where deleted_at is null and tipo = 'INGRESO' and bodega in ('Principal', 'Por reparar') and cantidad < 0;

-- 5c) Ventas copiadas del Excel con «disponible» vacío guardado como falso: una salida de venta no lleva esa marca
--     (el stock guardado ya las tenía descontadas; así el recálculo coincide).
update public.movimientos_inventario set disponible = null
 where deleted_at is null and tipo = 'SALIDA' and disponible is false and nota_credito_id is null and recepcion_nc_id is null;

-- 5d) Devoluciones por nota de crédito que esperaban recepción: pasan a «Por verificar» (Bodega decide la bodega)
update public.movimientos_inventario set bodega = 'Por verificar', estado_nc = 'Pendiente de verificación'
 where deleted_at is null and tipo = 'DEVOLUCION' and nota_credito_id is not null and recepcion_nc_id is null and bodega is null
   and coalesce(estado_nc, '') ilike 'pendiente%';

-- 6) Movimientos con su bodega (nueva columna al final; el texto de búsqueda incluye la bodega)
create or replace view public.v_movimientos
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
                 m.operacion_codigo, m.codigo, m.responsable_texto, m.tipo, m.observacion, app.bodega_nombre(m.bodega)) as texto,
       app.bodega_nombre(m.bodega)            as bodega
from public.movimientos_inventario m
left join public.productos p on p.id = m.producto_id
where m.deleted_at is null;

-- Acumulado por bodega: comercial (igual que el stock), técnica y total (comercial + técnica; «Por verificar» no suma)
create or replace view public.v_movimientos_saldo
with (security_invoker = true)
as
select m.id,
       m.producto_id,
       sum(case when coalesce(m.bodega, '') = 'Por verificar' then 0
                when m.tipo in ('INGRESO', 'DEVOLUCION') then abs(m.cantidad) else -abs(m.cantidad) end)
         over w as saldo,
       sum(app.stock_mov(m.tipo, m.bodega, m.cantidad, m.disponible)) over w as saldo_comercial,
       sum(case when m.bodega = 'Por reparar' then m.cantidad else 0 end) over w as saldo_tecnica
from public.movimientos_inventario m
where m.deleted_at is null and m.producto_id is not null
-- Los movimientos del mismo instante (los dos lados de un traslado) muestran el mismo acumulado
window w as (partition by m.producto_id order by m.fecha, m.created_at);

drop function if exists public.mov_kpis(text, text, text, text, timestamptz, timestamptz);
create or replace function public.mov_kpis(p_q text, p_tipo text, p_item text, p_resp text, p_desde timestamptz, p_hasta timestamptz, p_bodega text default '')
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'n', count(*),
    'ing', coalesce(sum(cantidad) filter (where cantidad > 0), 0),
    'sal', coalesce(sum(-cantidad) filter (where cantidad < 0), 0),
    'productos', count(distinct item))
  from public.v_movimientos v
  where (coalesce(p_tipo, '') = '' or (p_tipo = 'in' and v.cantidad > 0) or (p_tipo = 'out' and v.cantidad < 0))
    and (coalesce(p_item, '') = '' or upper(v.item) = upper(p_item))
    and (coalesce(p_resp, '') = '' or v.responsable = p_resp)
    and (coalesce(p_bodega, '') = '' or v.bodega = p_bodega)
    and (p_desde is null or v.fecha >= p_desde)
    and (p_hasta is null or v.fecha <= p_hasta)
    and (coalesce(trim(p_q), '') = '' or not exists (
          select 1 from unnest(string_to_array(trim(p_q), ' ')) w where w <> '' and v.texto not ilike '%' || w || '%'));
$$;
grant execute on function public.mov_kpis(text, text, text, text, timestamptz, timestamptz, text) to authenticated;

-- 7) Traslado manual entre bodegas (con permiso de edición en Bodega). Mueve unidades sin tocar el stock total.
create or replace function public.mov_trasladar(p_producto uuid, p_cantidad numeric, p_destino text, p_motivo text)
returns text language plpgsql security definer set search_path = public as $$
declare
  pr public.productos;
  v_op text; v_origen text; v_dest text; v_disp numeric; v_txt text;
begin
  if not app.puede('bodega', 'editar') then raise exception 'Necesitas permiso de edición en Bodega para trasladar entre bodegas.'; end if;
  if p_destino not in ('comercial', 'tecnica') then raise exception 'Elige la bodega de destino.'; end if;
  if coalesce(p_cantidad, 0) <= 0 or p_cantidad <> trunc(p_cantidad) then raise exception 'La cantidad debe ser un número entero mayor que cero.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo del traslado.'; end if;
  select * into pr from public.productos where id = p_producto and deleted_at is null for update;
  if not found then raise exception 'Producto no encontrado.'; end if;

  v_origen := case when p_destino = 'comercial' then 'Por reparar' else 'Principal' end;
  v_dest   := case when p_destino = 'comercial' then 'Principal' else 'Por reparar' end;
  v_disp   := case when p_destino = 'comercial' then coalesce(pr.stock_por_reparar, 0) else coalesce(pr.stock, 0) end;
  if p_cantidad > v_disp then
    raise exception 'Solo hay % unidad(es) en la %.', greatest(v_disp, 0), app.bodega_nombre(v_origen);
  end if;

  v_op := 'TRA-' || to_char(now() at time zone 'America/Guayaquil', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
  v_txt := 'Traslado ' || app.bodega_nombre(v_origen) || ' → ' || app.bodega_nombre(v_dest) || ' · ' || left(trim(p_motivo), 400);
  insert into public.movimientos_inventario (id, codigo, tipo, operacion_codigo, producto_id, producto_codigo, nombre, cliente_texto, factura_texto, cantidad, precio,
    responsable_id, responsable_texto, fecha, bodega, observacion, creado_por)
  values
    (gen_random_uuid(), 'MOV-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 10)), 'SALIDA', v_op, pr.id, pr.codigo, pr.nombre, 'Traslado interno', v_op, -p_cantidad, 0,
     app.empleado_id(), app.rec_quien(), now(), v_origen, v_txt, app.empleado_id()),
    (gen_random_uuid(), 'MOV-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 10)), 'INGRESO', v_op, pr.id, pr.codigo, pr.nombre, 'Traslado interno', v_op, p_cantidad, 0,
     app.empleado_id(), app.rec_quien(), now(), v_dest, v_txt, app.empleado_id());

  -- Se mueve solo lo trasladado (no se recalcula todo el producto)
  if p_destino = 'comercial' then
    update public.productos set stock = coalesce(stock, 0) + p_cantidad, stock_por_reparar = coalesce(stock_por_reparar, 0) - p_cantidad where id = pr.id;
  else
    update public.productos set stock = coalesce(stock, 0) - p_cantidad, stock_por_reparar = coalesce(stock_por_reparar, 0) + p_cantidad where id = pr.id;
  end if;
  perform app.registrar_bitacora('movimientos', 'traslado_bodega', pr.codigo || ' · ' || p_cantidad || ' u. · ' || v_txt);
  return v_op;
end;
$$;
revoke all on function public.mov_trasladar(uuid, numeric, text, text) from public, anon;
grant execute on function public.mov_trasladar(uuid, numeric, text, text) to authenticated;

-- 8) Notas de crédito: ¿el producto ya se había despachado?
--    No despachado → vuelve directo a la Bodega Comercial (suma al stock).
--    Despachado    → queda «Por verificar»: Bodega lo revisa y decide (Comercial, Técnica o no se recibió).
drop function if exists public.nc_registrar(uuid, text, date, text, text, jsonb);
create or replace function public.nc_registrar(
  p_factura uuid, p_numero text, p_fecha date, p_motivo text, p_pdf_url text, p_lineas jsonb, p_despachado boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_total numeric := 0;
  v_linea jsonb;
  v_mov public.movimientos_inventario;
  v_cantidad numeric; v_base numeric; v_iva numeric; v_tipo text; v_mov_id uuid;
  v_vistos uuid[] := '{}';
  v_emp uuid := app.empleado_id();
begin
  if not app.puede('facturacion', 'editar') then raise exception 'No tienes permiso para registrar notas de crédito.'; end if;
  if not app.exigir_mfa() then raise exception 'Completa la verificación en dos pasos para registrar una nota de crédito.'; end if;
  if coalesce(trim(p_numero), '') = '' or length(p_numero) > 80 then raise exception 'Indica el número de la nota.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo de la nota.'; end if;
  if p_pdf_url !~* '^https://' then raise exception 'El enlace al documento debe empezar con https://'; end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then raise exception 'Selecciona al menos un producto.'; end if;
  if exists (select 1 from public.notas_credito where numero = p_numero and tipo = 'nota_credito' and deleted_at is null) then
    raise exception 'Ese número de nota ya está registrado.';
  end if;
  if p_despachado is null and exists (select 1 from jsonb_array_elements(p_lineas) x where x ->> 'tipo' = 'CANTIDAD') then
    raise exception 'Indica si el producto ya se había despachado al cliente.';
  end if;

  -- La nota se crea primero: las devoluciones la referencian (antes fallaba por eso)
  insert into public.notas_credito (id, codigo, tipo, factura_id, numero, fecha, usuario_id, estado, registrado, datos, creado_por)
  values (
    v_id, 'NC-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'nota_credito', p_factura, p_numero, p_fecha, v_emp, 'Aplicada', true,
    jsonb_build_object('motivo', p_motivo, 'pdf_url', p_pdf_url, 'lineas', p_lineas, 'total', 0, 'despachado', p_despachado), v_emp
  );

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_mov_id := (v_linea ->> 'movimiento_id')::uuid;
    if v_mov_id = any(v_vistos) then raise exception 'Hay un producto repetido en la nota.'; end if;
    v_vistos := array_append(v_vistos, v_mov_id);

    select * into v_mov from public.movimientos_inventario where id = v_mov_id and factura_id = p_factura and tipo = 'SALIDA' and deleted_at is null;
    if not found then raise exception 'Uno de los productos no pertenece a esta factura.'; end if;

    v_tipo := v_linea ->> 'tipo';
    v_cantidad := coalesce((v_linea ->> 'cantidad')::numeric, 0);
    v_base := coalesce((v_linea ->> 'base')::numeric, 0);
    v_iva := coalesce((v_linea ->> 'iva')::numeric, 0);
    if v_tipo not in ('CANTIDAD', 'PRECIO') then raise exception 'Tipo de ajuste inválido.'; end if;
    if v_tipo = 'PRECIO' and v_cantidad <> 0 then raise exception 'Un ajuste de precio no devuelve unidades.'; end if;
    if v_tipo = 'CANTIDAD' and (v_cantidad <= 0 or v_cantidad > (abs(v_mov.cantidad) - coalesce(v_mov.cantidad_acreditada_nc, 0))) then
      raise exception 'Cantidad superior a la pendiente de acreditar en %.', coalesce(v_mov.nombre, v_mov.producto_codigo);
    end if;
    if v_base < 0 or v_iva < 0 or (v_base + v_iva) <= 0 then raise exception 'El importe a acreditar debe ser mayor que cero.'; end if;
    if v_base > (round(abs(v_mov.cantidad) * coalesce(v_mov.precio, 0) * (1 - coalesce(v_mov.descuento, 0) / 100), 2) - coalesce(v_mov.base_acreditada_nc, 0) + 0.01)
       or v_iva > (round(abs(v_mov.cantidad) * coalesce(v_mov.precio, 0) * (1 - coalesce(v_mov.descuento, 0) / 100) * (case when coalesce(v_mov.aplica_iva, true) then 0.15 else 0 end), 2) - coalesce(v_mov.iva_acreditado_nc, 0) + 0.01) then
      raise exception 'El crédito en % supera lo vigente de ese renglón.', coalesce(v_mov.nombre, v_mov.producto_codigo);
    end if;

    update public.movimientos_inventario set
      cantidad_acreditada_nc = coalesce(cantidad_acreditada_nc, 0) + v_cantidad,
      base_acreditada_nc = coalesce(base_acreditada_nc, 0) + v_base,
      iva_acreditado_nc = coalesce(iva_acreditado_nc, 0) + v_iva,
      cantidad_vigente_nc = abs(cantidad) - (coalesce(cantidad_acreditada_nc, 0) + v_cantidad),
      estado_nc = case
        when abs(cantidad) - (coalesce(cantidad_acreditada_nc, 0) + v_cantidad) <= 0 then 'Acreditado total'
        when v_cantidad > 0 then 'Acreditado parcial'
        else 'Ajuste de precio' end
    where id = v_mov.id;

    if v_tipo = 'CANTIDAD' then
      if p_despachado then
        insert into public.movimientos_inventario (
          id, tipo, operacion_codigo, factura_id, producto_id, producto_codigo, nombre, cliente_texto, factura_texto,
          cantidad, responsable_id, observacion, nota_credito_id, movimiento_original_id, estado_nc, bodega, creado_por
        ) values (
          gen_random_uuid(), 'DEVOLUCION', v_mov.operacion_codigo, p_factura, v_mov.producto_id, v_mov.producto_codigo, v_mov.nombre, v_mov.cliente_texto, v_mov.factura_texto,
          v_cantidad, v_emp, 'Ya se había despachado: Bodega lo verifica y decide la bodega · NC ' || p_numero, v_id, v_mov.id, 'Pendiente de verificación', 'Por verificar', v_emp
        );
      else
        insert into public.movimientos_inventario (
          id, tipo, operacion_codigo, factura_id, producto_id, producto_codigo, nombre, cliente_texto, factura_texto,
          cantidad, responsable_id, observacion, nota_credito_id, movimiento_original_id, disponible, estado_nc, bodega, creado_por
        ) values (
          gen_random_uuid(), 'DEVOLUCION', v_mov.operacion_codigo, p_factura, v_mov.producto_id, v_mov.producto_codigo, v_mov.nombre, v_mov.cliente_texto, v_mov.factura_texto,
          v_cantidad, v_emp, 'No se había despachado: vuelve a la Bodega Comercial · NC ' || p_numero, v_id, v_mov.id, true, 'Devuelto sin despachar', 'Principal', v_emp
        );
        if v_mov.producto_id is not null then
          update public.productos set stock = coalesce(stock, 0) + v_cantidad where id = v_mov.producto_id;
        end if;
      end if;
    end if;
    v_total := v_total + v_base + v_iva;
  end loop;

  update public.notas_credito set datos = jsonb_set(datos, '{total}', to_jsonb(v_total)) where id = v_id;

  update public.facturas set
    total_notas_credito = coalesce(total_notas_credito, 0) + v_total,
    total_neto = coalesce(total, 0) - (coalesce(total_notas_credito, 0) + v_total)
  where id = p_factura;

  perform app.registrar_bitacora('facturacion', 'nota_credito', 'NC ' || p_numero || ' aplicada por $' || v_total
    || case when p_despachado is true then ' · devolución por verificar en Bodega' when p_despachado is false then ' · no se había despachado: vuelve a la Bodega Comercial' else '' end, p_factura);
  return v_id;
end;
$$;
revoke all on function public.nc_registrar(uuid, text, date, text, text, jsonb, boolean) from public, anon;
grant execute on function public.nc_registrar(uuid, text, date, text, text, jsonb, boolean) to authenticated;

-- 9) Bodega verifica la devolución y decide la bodega
--    DISPONIBLE → Bodega Comercial · NO_DISPONIBLE → Bodega Técnica · NO_ENTREGADO → no se recibió (no vuelve al stock)
create or replace function public.nc_registrar_recepcion(
  p_devolucion_id uuid, p_cantidad numeric, p_destino text, p_fecha date, p_observacion text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dev public.movimientos_inventario;
  v_recibido numeric;
  v_emp uuid := app.empleado_id();
  v_rec_id uuid := gen_random_uuid();
  v_bod text;
  v_txt text;
begin
  if not app.puede('bodega', 'editar') then raise exception 'La devolución la verifica Bodega: necesitas permiso de edición en Bodega.'; end if;
  if p_destino not in ('DISPONIBLE', 'NO_DISPONIBLE', 'NO_ENTREGADO') then raise exception 'Destino inválido.'; end if;
  if coalesce(trim(p_observacion), '') = '' then raise exception 'Indica una observación de la verificación.'; end if;

  select * into v_dev from public.movimientos_inventario
   where id = p_devolucion_id and tipo = 'DEVOLUCION' and nota_credito_id is not null and bodega = 'Por verificar' and deleted_at is null
   for update;
  if not found then raise exception 'Devolución no encontrada o ya verificada.'; end if;

  select coalesce(sum((datos ->> 'cantidad')::numeric), 0) into v_recibido
  from public.notas_credito where tipo = 'recepcion' and (datos ->> 'devolucion_id')::uuid = p_devolucion_id and deleted_at is null;

  if p_cantidad <= 0 or p_cantidad <> trunc(p_cantidad) or p_cantidad > (abs(v_dev.cantidad) - v_recibido) then
    raise exception 'Cantidad inválida: hay % u. por verificar.', (abs(v_dev.cantidad) - v_recibido);
  end if;

  insert into public.notas_credito (id, codigo, tipo, factura_id, numero, fecha, usuario_id, estado, registrado, datos, creado_por)
  values (
    v_rec_id, 'REC-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'recepcion', v_dev.factura_id, v_dev.operacion_codigo, p_fecha, v_emp, 'Aplicada', true,
    jsonb_build_object('devolucion_id', p_devolucion_id, 'nota_credito_id', v_dev.nota_credito_id, 'cantidad', p_cantidad, 'destino', p_destino, 'observacion', p_observacion), v_emp
  );

  v_bod := case p_destino when 'DISPONIBLE' then 'Principal' when 'NO_DISPONIBLE' then 'Por reparar' else null end;
  v_txt := case p_destino when 'DISPONIBLE' then 'Verificado por Bodega → Bodega Comercial' when 'NO_DISPONIBLE' then 'Verificado por Bodega → Bodega Técnica'
                          else 'No se recibió el producto (no vuelve al stock)' end || ' · ' || left(trim(p_observacion), 400);

  -- Sale de «Por verificar»…
  insert into public.movimientos_inventario (
    id, tipo, operacion_codigo, factura_id, producto_id, producto_codigo, nombre, cliente_texto, factura_texto, cantidad, responsable_id, observacion,
    nota_credito_id, movimiento_original_id, recepcion_nc_id, estado_nc, bodega, creado_por
  ) values (
    gen_random_uuid(), 'SALIDA', v_dev.operacion_codigo, v_dev.factura_id, v_dev.producto_id, v_dev.producto_codigo, v_dev.nombre, v_dev.cliente_texto, v_dev.factura_texto,
    -p_cantidad, v_emp, v_txt, v_dev.nota_credito_id, v_dev.id, v_rec_id, 'Verificado', 'Por verificar', v_emp
  );
  -- …y entra a la bodega que decidió Bodega
  if v_bod is not null then
    insert into public.movimientos_inventario (
      id, tipo, operacion_codigo, factura_id, producto_id, producto_codigo, nombre, cliente_texto, factura_texto, cantidad, responsable_id, observacion,
      nota_credito_id, movimiento_original_id, recepcion_nc_id, disponible, estado_nc, bodega, creado_por
    ) values (
      gen_random_uuid(), 'DEVOLUCION', v_dev.operacion_codigo, v_dev.factura_id, v_dev.producto_id, v_dev.producto_codigo, v_dev.nombre, v_dev.cliente_texto, v_dev.factura_texto,
      p_cantidad, v_emp, v_txt, v_dev.nota_credito_id, v_dev.id, v_rec_id, p_destino = 'DISPONIBLE', case when p_destino = 'DISPONIBLE' then 'Recibido disponible' else 'Recibido con defecto' end, v_bod, v_emp
    );
    if v_dev.producto_id is not null then
      if v_bod = 'Principal' then
        update public.productos set stock = coalesce(stock, 0) + p_cantidad where id = v_dev.producto_id;
      else
        update public.productos set stock_por_reparar = coalesce(stock_por_reparar, 0) + p_cantidad where id = v_dev.producto_id;
      end if;
    end if;
  end if;

  if (v_recibido + p_cantidad) >= abs(v_dev.cantidad) then
    update public.movimientos_inventario set estado_nc = 'Verificado por Bodega' where id = p_devolucion_id;
  end if;

  perform app.registrar_bitacora('bodega', 'verificacion_devolucion', p_cantidad || ' u. ' || coalesce(v_dev.producto_codigo, '') || ' · ' || v_txt, v_dev.factura_id);
  return v_rec_id;
end;
$$;
revoke all on function public.nc_registrar_recepcion(uuid, numeric, text, date, text) from public, anon;
grant execute on function public.nc_registrar_recepcion(uuid, numeric, text, date, text) to authenticated;

-- 10) Resumen de la factura: solo lo que sigue «Por verificar»
create or replace function public.nc_resumen_factura(p_factura uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'notas', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'codigo', n.codigo, 'numero', n.numero, 'fecha', n.fecha, 'datos', n.datos, 'creado_por', e.nombre) order by n.fecha desc)
      from public.notas_credito n left join public.empleados e on e.id = n.usuario_id
      where n.factura_id = p_factura and n.tipo = 'nota_credito' and n.deleted_at is null), '[]'::jsonb),
    'devoluciones_pendientes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'nombre', m.nombre, 'producto_codigo', m.producto_codigo, 'cantidad', abs(m.cantidad),
        'recibido', coalesce((select sum((r.datos ->> 'cantidad')::numeric) from public.notas_credito r where r.tipo = 'recepcion' and (r.datos ->> 'devolucion_id')::uuid = m.id and r.deleted_at is null), 0),
        'estado_nc', m.estado_nc) order by m.created_at)
      from public.movimientos_inventario m
      where m.factura_id = p_factura and m.tipo = 'DEVOLUCION' and m.nota_credito_id is not null and m.recepcion_nc_id is null and m.deleted_at is null
        and m.bodega = 'Por verificar'
        and coalesce((select sum((r.datos ->> 'cantidad')::numeric) from public.notas_credito r where r.tipo = 'recepcion' and (r.datos ->> 'devolucion_id')::uuid = m.id and r.deleted_at is null), 0) < abs(m.cantidad)
      ), '[]'::jsonb)
  )
  where app.puede('facturacion', 'ver');
$$;

-- 11) Bandeja de Bodega: devoluciones por verificar de todas las facturas
create or replace function public.bod_devoluciones_pendientes()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'fecha', m.created_at, 'producto_id', m.producto_id, 'codigo', coalesce(p.codigo, m.producto_codigo), 'nombre', coalesce(m.nombre, p.nombre), 'imagen', p.imagen_url,
      'cantidad', abs(m.cantidad), 'recibido', r.recibido,
      'operacion', m.operacion_codigo, 'factura', f.numero_contifico, 'cliente', coalesce(c.nombre, m.cliente_texto),
      'nota', n.numero, 'motivo', n.datos ->> 'motivo', 'registro', e.nombre) order by m.created_at), '[]'::jsonb)
  from public.movimientos_inventario m
  left join public.productos p on p.id = m.producto_id
  left join public.facturas f on f.id = m.factura_id
  left join public.clientes c on c.id = f.cliente_id
  left join public.notas_credito n on n.id = m.nota_credito_id
  left join public.empleados e on e.id = n.usuario_id
  cross join lateral (select coalesce(sum((x.datos ->> 'cantidad')::numeric), 0) as recibido from public.notas_credito x
                       where x.tipo = 'recepcion' and (x.datos ->> 'devolucion_id')::uuid = m.id and x.deleted_at is null) r
  where app.puede_alguno(array['bodega', 'facturacion'], 'ver')
    and m.tipo = 'DEVOLUCION' and m.nota_credito_id is not null and m.bodega = 'Por verificar' and m.deleted_at is null
    and r.recibido < abs(m.cantidad);
$$;
revoke all on function public.bod_devoluciones_pendientes() from public, anon;
grant execute on function public.bod_devoluciones_pendientes() to authenticated;

-- 12) Estado del stock (Inventario, CRM, Ofertas): las unidades de la Bodega Técnica solo para quien la ve
create or replace function public.inv_estado_stock()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  res jsonb;
begin
  if not app.puede_alguno(array['inventario', 'crm', 'femedics', 'ofertas', 'promociones', 'marketing'], 'ver') then
    raise exception 'No tienes acceso al estado del stock.';
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
    select id as prod_id, stock_por_reparar as reparacion from public.productos where deleted_at is null and stock_por_reparar > 0 and app.ve_bodega_tecnica()
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
$function$;
grant execute on function public.inv_estado_stock() to authenticated;
