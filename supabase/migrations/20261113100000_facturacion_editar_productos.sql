-- =====================================================================
-- Facturación: editar los productos de una venta ganada que aún NO está
-- facturada (vmFactEditarProductos de "Compras Ventas.gs").
-- Igual que el original:
--   · solo antes de facturar; con notas de crédito o con inventario ya
--     descontado en Movimientos no se permite (se usa una nota de crédito);
--   · motivo obligatorio;
--   · el cambio se aplica en los dos lados: la venta de Facturación y la
--     cotización / venta del CRM (productos, detalle de equipos y total),
--     con una versión nueva en el historial de la proforma y una nota en
--     el historial de la gestión.
-- =====================================================================
create or replace function public.fact_editar_productos(p_factura uuid, p_items jsonb, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f record;
  v_cot record;
  v_it jsonb;
  v_prev jsonb;
  v_items jsonb := '[]'::jsonb;
  v_items_cot jsonb := '[]'::jsonb;
  v_cambios text[] := '{}';
  v_antes jsonb := '{}'::jsonb;
  v_cant numeric;
  v_precio numeric;
  v_desc numeric;
  v_iva_aplica boolean;
  v_base numeric;
  v_sub numeric := 0;
  v_iva numeric := 0;
  v_total numeric;
  v_clave text;
  v_nombre text;
  v_yo uuid := app.empleado_id();
  v_yo_nombre text := (select nombre from public.empleados where id = app.empleado_id());
  v_ahora timestamptz := now();
  v_version int;
  i int := 0;
begin
  if not app.puede('facturacion', 'editar') then
    raise exception 'No tienes permiso para editar productos en Facturación.';
  end if;
  p_motivo := left(btrim(coalesce(p_motivo, '')), 500);
  if p_motivo = '' then raise exception 'Escribe el motivo del cambio.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un producto.';
  end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Demasiados productos.'; end if;

  select * into v_f from public.facturas where id = p_factura and deleted_at is null for update;
  if v_f.id is null then raise exception 'Venta no encontrada.'; end if;
  if v_f.estado ilike 'facturad%' then
    raise exception 'Esta venta ya está facturada. Para cambiar productos usa una nota de crédito.';
  end if;
  if exists (select 1 from public.notas_credito n where n.factura_id = p_factura and n.deleted_at is null) then
    raise exception 'Esta venta tiene notas de crédito; no se pueden editar sus productos.';
  end if;
  if exists (select 1 from public.movimientos_inventario m
              where m.deleted_at is null and m.cantidad < 0
                and (m.factura_id = p_factura or upper(coalesce(m.operacion_codigo, '')) in (upper(v_f.codigo), 'PRO' || upper(v_f.codigo)))) then
    raise exception 'Esta venta ya descontó inventario en Movimientos; no se pueden editar sus productos aquí.';
  end if;

  -- Cantidades anteriores (para el resumen de cambios).
  for v_prev in select * from jsonb_array_elements(coalesce(v_f.items, '[]'::jsonb)) loop
    v_antes := v_antes || jsonb_build_object(coalesce(nullif(v_prev->>'id', ''), v_prev->>'codigo', v_prev->>'nombre'),
                                             jsonb_build_object('n', abs(coalesce(nullif(v_prev->>'cantidad', '')::numeric, 0)), 'nombre', v_prev->>'nombre'));
  end loop;

  -- La cotización / venta del CRM de esta operación (para conservar categoría, ficha, etc.).
  select c.id, c.items, c.nombre, c.identificacion, c.email, c.telefono, c.nota_cotizacion into v_cot
    from public.cotizaciones c
   where c.deleted_at is null and (c.id = v_f.cotizacion_id or (v_f.cotizacion_id is null and c.codigo = v_f.codigo))
   limit 1;

  for v_it in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    v_nombre := left(btrim(coalesce(v_it->>'nombre', '')), 300);
    v_clave := coalesce(nullif(v_it->>'id', ''), nullif(v_it->>'codigo', ''));
    if v_nombre = '' or v_clave is null then raise exception 'Línea %: falta el producto.', i; end if;
    v_cant := nullif(v_it->>'cantidad', '')::numeric;
    v_precio := nullif(v_it->>'precio', '')::numeric;
    v_desc := coalesce(nullif(v_it->>'descuento', '')::numeric, 0);
    v_iva_aplica := coalesce((v_it->>'iva')::boolean, true);
    if v_cant is null or v_cant <= 0 or v_cant <> trunc(v_cant) then
      raise exception '%', '"' || v_nombre || '": la cantidad debe ser un número entero mayor a 0.';
    end if;
    if v_precio is null or v_precio < 0 then raise exception '%', '"' || v_nombre || '": el precio no es válido.'; end if;
    if v_desc < 0 or v_desc > 100 then raise exception '%', '"' || v_nombre || '": el descuento debe estar entre 0 y 100.'; end if;

    v_base := round(v_cant * v_precio * (1 - v_desc / 100), 2);
    v_sub := v_sub + v_base;
    if v_iva_aplica then v_iva := v_iva + round(v_base * 0.15, 2); end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'id', v_it->>'id', 'codigo', v_it->>'codigo', 'nombre', v_nombre, 'imagen', coalesce(v_it->>'imagen', ''),
      'precio', round(v_precio, 4), 'cantidad', v_cant, 'descuento', round(v_desc, 2), 'iva', v_iva_aplica,
      'observacion', left(coalesce(v_it->>'observacion', ''), 500)));
    -- En el CRM se conservan los datos extra de la línea (categoría, ficha, carpeta…).
    v_items_cot := v_items_cot || jsonb_build_array(
      coalesce((select x from jsonb_array_elements(coalesce(v_cot.items, '[]'::jsonb)) x
                 where coalesce(nullif(x->>'id', ''), x->>'codigo') = v_clave limit 1), '{}'::jsonb)
      || jsonb_build_object('id', v_it->>'id', 'codigo', v_it->>'codigo', 'nombre', v_nombre, 'imagen', coalesce(v_it->>'imagen', ''),
                            'precio', round(v_precio, 4), 'cantidad', v_cant, 'descuento', round(v_desc, 2), 'iva', v_iva_aplica,
                            'observacion', left(coalesce(v_it->>'observacion', ''), 500)));

    if v_antes ? v_clave then
      if (v_antes->v_clave->>'n')::numeric <> v_cant then
        v_cambios := array_append(v_cambios, '~ ' || v_nombre || ' ' || (v_antes->v_clave->>'n') || '→' || v_cant);
      end if;
      v_antes := v_antes - v_clave;
    else
      v_cambios := array_append(v_cambios, '+ ' || v_nombre || ' ×' || v_cant);
    end if;
  end loop;
  select v_cambios || coalesce(array_agg('− ' || (value->>'nombre')), '{}') into v_cambios from jsonb_each(v_antes);

  v_total := round(v_sub + v_iva, 2);

  -- 1) Facturación
  update public.facturas set
    items = v_items,
    items_original = case when items_original is not null then v_items else items_original end,
    subtotal = round(v_sub, 2), iva = round(v_iva, 2), total = v_total, total_neto = v_total - coalesce(total_notas_credito, 0),
    observacion = concat_ws(E'\n', nullif(btrim(coalesce(observacion, '')), ''),
                            '[' || to_char(v_ahora at time zone 'America/Guayaquil', 'DD/MM/YYYY HH24:MI') || '] Productos editados por ' || coalesce(v_yo_nombre, 'Facturación') || ': ' || p_motivo),
    historial = coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'fecha', v_ahora, 'por', coalesce(v_yo_nombre, 'Facturación'), 'accion', 'Productos editados',
      'detalle', p_motivo || case when array_length(v_cambios, 1) > 0 then ' · ' || array_to_string(v_cambios, ' · ') else '' end))
  where id = p_factura;

  -- 2) CRM: la cotización / venta de origen
  if v_cot.id is not null then
    update public.cotizaciones set
      items = v_items_cot,
      detalle_equipos = (select string_agg((x->>'nombre') || ' (Cant: ' || (x->>'cantidad') || ')', ', ') from jsonb_array_elements(v_items) x),
      total = v_total, ultima_actividad = v_ahora
    where id = v_cot.id;
    select coalesce(max(version), 0) + 1 into v_version from public.cotizaciones_historial where cotizacion_id = v_cot.id;
    insert into public.cotizaciones_historial (cotizacion_id, version, cambios, items, total, nota, cliente, empleado_id, usuario_texto)
    values (v_cot.id, v_version, array_prepend('Productos editados desde Facturación: ' || p_motivo, v_cambios), v_items_cot, v_total, v_cot.nota_cotizacion,
            jsonb_build_object('nombre', v_cot.nombre, 'identificacion', v_cot.identificacion, 'email', v_cot.email, 'telefono', v_cot.telefono),
            v_yo, v_yo_nombre);
    insert into public.interacciones (id, codigo, ref_tipo, ref_codigo, cotizacion_id, tipo, nota, empleado_id, usuario_texto)
    values (gen_random_uuid(), 'INT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'Venta', v_f.codigo, v_cot.id, 'Facturación',
            'Productos editados desde Facturación por ' || coalesce(v_yo_nombre, 'Facturación') || '. Motivo: ' || p_motivo
            || case when array_length(v_cambios, 1) > 0 then E'\n' || array_to_string(v_cambios, E'\n') else '' end,
            v_yo, v_yo_nombre);
  end if;

  perform app.auditar('facturacion', 'Editar productos de la venta', v_f.codigo, 'OK', left(p_motivo, 300));
  return jsonb_build_object('success', true, 'items', v_items, 'total', v_total, 'cambios', to_jsonb(v_cambios),
                            'aviso', case when v_cot.id is null then 'Esta venta no viene de una cotización del CRM: solo se actualizó Facturación.' else null end);
end;
$$;
revoke all on function public.fact_editar_productos(uuid, jsonb, text) from public, anon;
grant execute on function public.fact_editar_productos(uuid, jsonb, text) to authenticated;
