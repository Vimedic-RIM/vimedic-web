-- =====================================================================
-- VIMEDIC · Notas de crédito (Issue #6)
--
-- La nota de crédito en sí se emite fuera del sistema (Contífico/SRI),
-- igual que la factura: aquí solo se registra número + enlace al PDF ya
-- emitido, y el detalle de qué se acredita contra la factura original.
--
-- Flujo en dos pasos, igual que el sistema original:
--   1) nc_registrar: aplica la nota (ajusta el monto facturado). Si alguna
--      línea es de tipo CANTIDAD (devuelve unidades), queda un movimiento
--      "DEVOLUCION" pendiente de confirmar — todavía NO suma al stock
--      vendible, porque el producto físico no ha sido revisado.
--   2) nc_registrar_recepcion: registra, después, si lo devuelto llegó
--      bien (DISPONIBLE → ahí sí se suma al stock), llegó dañado
--      (NO_DISPONIBLE) o nunca llegó (NO_ENTREGADO). Puede hacerse en
--      varias recepciones parciales.
--
-- Las tablas notas_credito y movimientos_inventario (cantidad_acreditada_nc,
-- base_acreditada_nc, iva_acreditado_nc, cantidad_vigente_nc, estado_nc,
-- nota_credito_id, movimiento_original_id, recepcion_nc_id, disponible)
-- ya existían, pensadas exactamente para esto — no hace falta tocar el
-- esquema, solo escribir la lógica.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Líneas originales de una factura, con lo ya acreditado y lo vigente.
-- ---------------------------------------------------------------------
create or replace function public.nc_lineas_factura(p_factura uuid)
returns table (
  movimiento_id uuid, producto_codigo text, nombre text, cantidad numeric, precio numeric, descuento numeric, aplica_iva boolean,
  base numeric, iva numeric, acreditado numeric, vigente numeric, base_vigente numeric, iva_vigente numeric, estado_nc text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id, coalesce(m.producto_codigo, p.codigo), coalesce(m.nombre, p.nombre), abs(m.cantidad), coalesce(m.precio, 0), coalesce(m.descuento, 0), coalesce(m.aplica_iva, true),
    round(abs(m.cantidad) * coalesce(m.precio, 0) * (1 - coalesce(m.descuento, 0) / 100), 2) as base,
    round(abs(m.cantidad) * coalesce(m.precio, 0) * (1 - coalesce(m.descuento, 0) / 100) * (case when coalesce(m.aplica_iva, true) then 0.15 else 0 end), 2) as iva,
    coalesce(m.cantidad_acreditada_nc, 0) as acreditado,
    abs(m.cantidad) - coalesce(m.cantidad_acreditada_nc, 0) as vigente,
    round(abs(m.cantidad) * coalesce(m.precio, 0) * (1 - coalesce(m.descuento, 0) / 100), 2) - coalesce(m.base_acreditada_nc, 0) as base_vigente,
    round(abs(m.cantidad) * coalesce(m.precio, 0) * (1 - coalesce(m.descuento, 0) / 100) * (case when coalesce(m.aplica_iva, true) then 0.15 else 0 end), 2) - coalesce(m.iva_acreditado_nc, 0) as iva_vigente,
    m.estado_nc
  from public.movimientos_inventario m
  left join public.productos p on p.id = m.producto_id
  where m.factura_id = p_factura and m.tipo = 'SALIDA' and m.deleted_at is null
    and app.puede('facturacion', 'ver')
  order by m.created_at;
$$;
revoke all on function public.nc_lineas_factura(uuid) from public, anon;
grant execute on function public.nc_lineas_factura(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Aplica la nota de crédito (paso 1).
--    p_lineas: [{movimiento_id, tipo: 'CANTIDAD'|'PRECIO', cantidad, base, iva}, ...]
-- ---------------------------------------------------------------------
create or replace function public.nc_registrar(
  p_factura uuid, p_numero text, p_fecha date, p_motivo text, p_pdf_url text, p_lineas jsonb
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
      insert into public.movimientos_inventario (
        id, tipo, operacion_codigo, factura_id, producto_id, producto_codigo, nombre, cliente_texto, factura_texto,
        cantidad, responsable_id, observacion, nota_credito_id, movimiento_original_id, estado_nc, creado_por
      ) values (
        gen_random_uuid(), 'DEVOLUCION', v_mov.operacion_codigo, p_factura, v_mov.producto_id, v_mov.producto_codigo, v_mov.nombre, v_mov.cliente_texto, v_mov.factura_texto,
        v_cantidad, v_emp, 'Pendiente de confirmar recepción · NC ' || p_numero, v_id, v_mov.id, 'Pendiente de recepción', v_emp
      );
    end if;
    v_total := v_total + v_base + v_iva;
  end loop;

  insert into public.notas_credito (id, codigo, tipo, factura_id, numero, fecha, usuario_id, estado, registrado, datos, creado_por)
  values (
    v_id, 'NC-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'nota_credito', p_factura, p_numero, p_fecha, v_emp, 'Aplicada', true,
    jsonb_build_object('motivo', p_motivo, 'pdf_url', p_pdf_url, 'lineas', p_lineas, 'total', v_total), v_emp
  );

  update public.facturas set
    total_notas_credito = coalesce(total_notas_credito, 0) + v_total,
    total_neto = coalesce(total, 0) - (coalesce(total_notas_credito, 0) + v_total)
  where id = p_factura;

  perform app.registrar_bitacora('facturacion', 'nota_credito', 'NC ' || p_numero || ' aplicada por $' || v_total, p_factura);
  return v_id;
end;
$$;
revoke all on function public.nc_registrar(uuid, text, date, text, text, jsonb) from public, anon;
grant execute on function public.nc_registrar(uuid, text, date, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Registra la recepción física de una devolución (paso 2, puede
--    repetirse en lotes parciales hasta completar la cantidad devuelta).
-- ---------------------------------------------------------------------
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
begin
  if not app.puede('facturacion', 'editar') then raise exception 'No tienes permiso para registrar recepciones.'; end if;
  if p_destino not in ('DISPONIBLE', 'NO_DISPONIBLE', 'NO_ENTREGADO') then raise exception 'Destino inválido.'; end if;
  if coalesce(trim(p_observacion), '') = '' then raise exception 'Indica una observación de la recepción.'; end if;

  select * into v_dev from public.movimientos_inventario where id = p_devolucion_id and tipo = 'DEVOLUCION' and nota_credito_id is not null and deleted_at is null;
  if not found then raise exception 'Devolución no encontrada.'; end if;

  select coalesce(sum((datos ->> 'cantidad')::numeric), 0) into v_recibido
  from public.notas_credito where tipo = 'recepcion' and (datos ->> 'devolucion_id')::uuid = p_devolucion_id and deleted_at is null;

  if p_cantidad <= 0 or p_cantidad > (abs(v_dev.cantidad) - v_recibido) then
    raise exception 'Cantidad superior a lo pendiente de recibir (% u. pendientes).', (abs(v_dev.cantidad) - v_recibido);
  end if;

  insert into public.notas_credito (id, codigo, tipo, factura_id, numero, fecha, usuario_id, estado, registrado, datos, creado_por)
  values (
    v_rec_id, 'REC-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'recepcion', v_dev.factura_id, v_dev.operacion_codigo, p_fecha, v_emp, 'Aplicada', true,
    jsonb_build_object('devolucion_id', p_devolucion_id, 'nota_credito_id', v_dev.nota_credito_id, 'cantidad', p_cantidad, 'destino', p_destino, 'observacion', p_observacion), v_emp
  );

  -- Solo lo recibido en buen estado vuelve a sumar al stock vendible.
  if p_destino = 'DISPONIBLE' then
    insert into public.movimientos_inventario (
      id, tipo, operacion_codigo, factura_id, producto_id, producto_codigo, nombre, cantidad, responsable_id, observacion,
      nota_credito_id, movimiento_original_id, recepcion_nc_id, disponible, estado_nc, creado_por
    ) values (
      gen_random_uuid(), 'DEVOLUCION', v_dev.operacion_codigo, v_dev.factura_id, v_dev.producto_id, v_dev.producto_codigo, v_dev.nombre, p_cantidad, v_emp,
      'Recibido disponible · ' || p_observacion, v_dev.nota_credito_id, v_dev.id, v_rec_id, true, 'Recibido disponible', v_emp
    );
    if v_dev.producto_id is not null then
      update public.productos pr set stock = (
        select coalesce(sum(case when m.tipo in ('INGRESO', 'DEVOLUCION') then abs(m.cantidad) else -abs(m.cantidad) end), 0)
        from public.movimientos_inventario m where m.producto_id = pr.id and m.deleted_at is null
      ) where pr.id = v_dev.producto_id;
    end if;
  end if;

  if (v_recibido + p_cantidad) >= abs(v_dev.cantidad) then
    update public.movimientos_inventario set estado_nc = 'Recepción completa' where id = p_devolucion_id;
  end if;

  perform app.registrar_bitacora('facturacion', 'recepcion_nc', p_destino || ' · ' || p_cantidad || ' u. · ' || p_observacion, v_dev.factura_id);
  return v_rec_id;
end;
$$;
revoke all on function public.nc_registrar_recepcion(uuid, numeric, text, date, text) from public, anon;
grant execute on function public.nc_registrar_recepcion(uuid, numeric, text, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Resumen de notas y devoluciones pendientes de recepción de una factura.
-- ---------------------------------------------------------------------
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
        and coalesce((select sum((r.datos ->> 'cantidad')::numeric) from public.notas_credito r where r.tipo = 'recepcion' and (r.datos ->> 'devolucion_id')::uuid = m.id and r.deleted_at is null), 0) < abs(m.cantidad)
      ), '[]'::jsonb)
  )
  where app.puede('facturacion', 'ver');
$$;
revoke all on function public.nc_resumen_factura(uuid) from public, anon;
grant execute on function public.nc_resumen_factura(uuid) to authenticated;
