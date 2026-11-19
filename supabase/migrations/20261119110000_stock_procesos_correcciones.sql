-- =====================================================================
-- Revisión de todos los procesos que mueven stock (19-nov), contra la app original:
--   Facturar (subirFactura) ............. app.fac_descargar + trigger (migración 20261119090000)
--   Compras locales (IngresosProveedores) app.registrar_ingreso_proveedor  <- NO FUNCIONABA: aquí se corrige
--   Recepción de importaciones .......... rec_revisar / rec_revisar_devuelta (app.rec_movimiento + app.rec_recalcular)
--   Notas de crédito .................... nc_registrar / nc_registrar_recepcion
--   Servicio Técnico (repuestos) ........ st_finalizar  <- salida con cantidad positiva: aquí se corrige
--   Traslados entre bodegas ............. mov_trasladar
--   Editar un movimiento ................ Movimientos + recalcular_stock_producto
-- Pruebas de todo el ciclo: supabase/tests/stock_procesos.sql
-- =====================================================================

-- 1) Adquisiciones: registrar una compra local nunca funcionó en la app nueva. Insertaba la columna actualizado_por,
--    que no existe en movimientos_inventario ni en ingresos_proveedor, así que ninguna compra subía el stock.
--    Además guardaba los movimientos antes que la compra a la que apuntan (ingreso_id) y la base los rechazaba.
--    Misma lógica que antes, sin esa columna, guardando primero la compra, con el proveedor y su factura en el movimiento y el stock vacío tomado como 0.
create or replace function app.registrar_ingreso_proveedor(
  p_proveedor_texto text, p_numero_factura text, p_fecha_factura date, p_observacion text, p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := app.empleado_id();
  v_emp_nombre text := (select nombre from public.empleados where id = app.empleado_id());
  v_id uuid := gen_random_uuid();
  v_codigo text := 'ING-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
  v_item jsonb;
  v_prod record;
  v_cantidad numeric;
  v_precio numeric;
  v_subtotal numeric := 0;
  v_errores text[] := '{}';
begin
  if not app.puede_alguno(array['facturacion', 'importaciones'], 'crear') then
    raise exception 'No autorizado para registrar ingresos de proveedor.';
  end if;
  if p_proveedor_texto is null or trim(p_proveedor_texto) = '' then raise exception 'Falta el proveedor.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agrega al menos un producto.'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select p.id, p.codigo, p.nombre into v_prod from public.productos p where p.codigo = (v_item->>'codigo') and p.deleted_at is null;
    if v_prod.id is null then v_errores := array_append(v_errores, (v_item->>'codigo') || ': producto no encontrado.'); continue; end if;
    v_cantidad := coalesce((v_item->>'cantidad')::numeric, 0);
    if v_cantidad <= 0 then v_errores := array_append(v_errores, v_prod.codigo || ': la cantidad debe ser mayor a cero.'); end if;
  end loop;
  if array_length(v_errores, 1) > 0 then raise exception '%', array_to_string(v_errores, E'\n'); end if;

  -- La compra se guarda antes que sus movimientos (movimientos_inventario.ingreso_id apunta a ella).
  select coalesce(sum(abs(coalesce((x->>'cantidad')::numeric, 0)) * coalesce((x->>'precio')::numeric, 0)), 0) into v_subtotal from jsonb_array_elements(p_items) x;
  insert into public.ingresos_proveedor (
    id, codigo, proveedor_texto, numero_factura, fecha_factura, responsable_id, observacion, items, subtotal, total, creado_por
  ) values (
    v_id, v_codigo, trim(p_proveedor_texto), nullif(trim(coalesce(p_numero_factura, '')), ''), p_fecha_factura, v_emp,
    nullif(trim(coalesce(p_observacion, '')), ''), p_items, round(v_subtotal, 2), round(v_subtotal, 2), v_emp
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    select p.id, p.codigo, p.nombre into v_prod from public.productos p where p.codigo = (v_item->>'codigo') and p.deleted_at is null;
    v_cantidad := abs(coalesce((v_item->>'cantidad')::numeric, 0));
    v_precio := coalesce((v_item->>'precio')::numeric, 0);

    insert into public.movimientos_inventario (
      id, codigo, tipo, operacion_codigo, ingreso_id, producto_id, producto_codigo, nombre, cliente_texto, factura_texto,
      cantidad, precio, aplica_iva, responsable_id, responsable_texto, fecha, observacion, creado_por
    ) values (
      gen_random_uuid(), 'MOV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), 'INGRESO', v_codigo, v_id,
      v_prod.id, v_prod.codigo, v_prod.nombre, trim(p_proveedor_texto), nullif(trim(coalesce(p_numero_factura, '')), ''),
      v_cantidad, v_precio, coalesce((v_item->>'aplicaIva')::boolean, true),
      v_emp, v_emp_nombre, now(), nullif(v_item->>'observacion', ''), v_emp
    );
    update public.productos set stock = coalesce(stock, 0) + v_cantidad where id = v_prod.id;
  end loop;

  return jsonb_build_object('success', true, 'id', v_id, 'codigo', v_codigo);
end;
$$;
revoke all on function app.registrar_ingreso_proveedor(text, text, date, text, jsonb) from public, anon;
grant execute on function app.registrar_ingreso_proveedor(text, text, date, text, jsonb) to authenticated;

-- 2) Servicio Técnico: los repuestos salían como SALIDA con cantidad positiva (el resto de la app y el original la guardan
--    negativa) y con el stock vacío el descuento quedaba en nada. Ahora: cantidad negativa, código del movimiento, solo productos
--    vigentes y stock vacío tomado como 0. El resto de la función queda igual.
CREATE OR REPLACE FUNCTION public.st_finalizar(p_id uuid, p_fin jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.st_ordenes; eq public.st_equipos; yo uuid := app.empleado_id(); quien text;
  v_final text := p_fin->>'estadoFinal'; v_faltan text[] := '{}'; v_sin int; v_firma boolean; v_prox date; v_horas numeric; v_num text; v_n int;
  r jsonb; st integer; v_facturar boolean; v_cierre timestamptz := now(); v_cod text;
begin
  if not app.puede('servicio_tecnico', 'editar') then raise exception 'Sin permiso en Servicio Técnico'; end if;
  select * into o from public.st_ordenes where id = p_id and deleted_at is null for update;
  if not found then raise exception 'No se encontró la orden.'; end if;
  if o.estado in ('Finalizada', 'Cancelada') then raise exception 'La orden ya está cerrada.'; end if;
  if o.estado = 'Esperando aprobación' then raise exception 'La cotización aún no tiene respuesta del cliente.'; end if;
  if v_final is null or v_final not in ('Operativo', 'Operativo con observaciones', 'No operativo', 'Dado de baja') then raise exception 'Indica en qué estado queda el equipo.'; end if;
  select coalesce(nombre, email) into quien from public.empleados where id = yo; quien := coalesce(quien, 'Servicio Técnico');

  if o.tipo = 'Capacitación' then
    if jsonb_array_length(o.asistentes) = 0 then v_faltan := v_faltan || 'la lista de asistentes'; end if;
  elsif btrim(coalesce(o.trabajo_realizado, '')) = '' and btrim(coalesce(o.diagnostico, '')) = '' then v_faltan := v_faltan || 'el trabajo realizado o el diagnóstico';
  end if;
  select count(*) into v_sin from jsonb_array_elements(o.checklist) x where coalesce(x->>'resultado', '') = '';
  if v_sin > 0 then v_faltan := v_faltan || (v_sin || ' actividad(es) del checklist sin resultado'); end if;
  if o.modalidad is distinct from 'Remoto' and jsonb_array_length(o.fotos) = 0 then v_faltan := v_faltan || 'al menos una foto de evidencia'; end if;
  v_firma := coalesce(p_fin->>'firma', '') like 'data:image/png;base64,%' and length(p_fin->>'firma') < 40000;
  if o.modalidad is distinct from 'Remoto' and (not v_firma or btrim(coalesce(p_fin->>'firmaNombre', '')) = '') then v_faltan := v_faltan || 'la firma y el nombre de quien recibe el servicio'; end if;
  if array_length(v_faltan, 1) > 0 then raise exception 'Para cerrar falta: %.', array_to_string(v_faltan, ', '); end if;

  -- Repuestos → inventario (una sola vez)
  if jsonb_array_length(o.repuestos) > 0 and not o.repuestos_descontados then
    for r in select * from jsonb_array_elements(o.repuestos) loop
      select coalesce(stock, 0) into st from public.productos where codigo = r->>'id' and deleted_at is null;
      if not found then raise exception 'El repuesto % no existe en Productos.', r->>'id'; end if;
      if st < (r->>'cantidad')::int then raise exception 'No hay stock suficiente de % (disponible: %).', r->>'nombre', st; end if;
    end loop;
    for r in select * from jsonb_array_elements(o.repuestos) loop
      insert into public.movimientos_inventario (id, codigo, tipo, operacion_codigo, producto_id, producto_codigo, nombre, cliente_texto, cantidad, responsable_id, responsable_texto, observacion)
      select gen_random_uuid(), 'MOV-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 10)), 'SALIDA', o.codigo, p.id, p.codigo, p.nombre, o.cliente_texto, -abs((r->>'cantidad')::numeric), yo, quien,
             'Servicio técnico ' || o.codigo || ' · ' || coalesce(o.producto_texto, '') || ' serie ' || coalesce(o.serie, '')
      from public.productos p where p.codigo = r->>'id' and p.deleted_at is null;
      update public.productos set stock = coalesce(stock, 0) - abs((r->>'cantidad')::numeric) where codigo = r->>'id' and deleted_at is null;
    end loop;
  end if;

  begin v_prox := nullif(p_fin->>'proximo', '')::date; exception when others then v_prox := null; end;
  v_horas := coalesce(nullif(p_fin->>'horas', '')::numeric, nullif(o.horas, 0), round((extract(epoch from (v_cierre - coalesce(o.inicio, v_cierre))) / 3600)::numeric, 1));
  v_facturar := o.cobertura = 'Facturable';
  select * into eq from public.st_equipos where id = o.equipo_id;

  perform pg_advisory_xact_lock(hashtext('st_informe_numero'));
  if o.informe_numero is null or o.informe_numero = '' then
    select count(*) + 1 into v_n from public.st_ordenes where informe_numero like 'IT-' || to_char(v_cierre at time zone 'America/Guayaquil', 'YYYY') || '-%';
    v_num := 'IT-' || to_char(v_cierre at time zone 'America/Guayaquil', 'YYYY') || '-' || lpad(v_n::text, 4, '0');
  else v_num := o.informe_numero; end if;

  update public.st_ordenes set
    estado = 'Finalizada', cierre = v_cierre, estado_final = v_final, inicio = coalesce(inicio, v_cierre),
    recomendaciones = case when p_fin ? 'recomendaciones' then left(p_fin->>'recomendaciones', 2000) else recomendaciones end,
    proximo_mantenimiento = v_prox, horas = greatest(0, v_horas),
    firma = case when v_firma then jsonb_build_object('png', p_fin->>'firma', 'nombre', left(p_fin->>'firmaNombre', 120), 'cedula', left(coalesce(p_fin->>'firmaCedula', ''), 20),
                                                       'cargo', left(coalesce(p_fin->>'firmaCargo', ''), 80), 'fecha', v_cierre) else '{}'::jsonb end,
    repuestos_descontados = jsonb_array_length(repuestos) > 0, facturacion = case when v_facturar then 'Pendiente' else 'No aplica' end, informe_numero = v_num,
    eventos = (eventos || jsonb_build_array(jsonb_build_object('fecha', v_cierre, 'por', quien, 'publico', true,
      'nota', 'Servicio finalizado. Tu equipo quedó ' || lower(v_final) || '. El informe técnico está disponible en este enlace.')))
  where id = p_id;

  if eq.id is not null then
    update public.st_equipos set
      estado = case v_final when 'Dado de baja' then 'Dado de baja' when 'No operativo' then 'No operativo' else 'Operativo' end,
      proximo_mantenimiento = case when o.tipo = 'Mantenimiento preventivo' then coalesce(v_prox, case when coalesce(eq.frecuencia_meses, 0) > 0 then (v_cierre::date + make_interval(months => eq.frecuencia_meses))::date end)
                                   when v_prox is not null then v_prox else proximo_mantenimiento end,
      fecha_entrega = case when o.tipo = 'Instalación' and fecha_entrega is null then v_cierre::date else fecha_entrega end
    where id = eq.id;
  end if;
  if v_facturar and o.asesor_id is not null then
    insert into public.notificaciones (para_id, modulo, evento, tipo, texto, entidad, entidad_id)
    values (o.asesor_id, 'servicio_tecnico', 'por_facturar', 'aviso', 'Servicio por facturar — ' || coalesce(o.cliente_texto, '') || ' (' || o.codigo || ')', 'st_ordenes', o.id);
  end if;
  return v_num;
end;
$function$;

revoke all on function public.st_finalizar(uuid, jsonb) from public, anon;
grant execute on function public.st_finalizar(uuid, jsonb) to authenticated;

-- 3) Control del stock, para que un proceso que deje de descargar no pase desapercibido (Movimientos lo muestra arriba):
--    · facturas registradas en la app nueva sin su salida de inventario
--    · productos cuyo stock (Comercial o Técnica) no cuadra con la suma de sus movimientos
create or replace function public.mov_control_stock()
returns jsonb language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'facturas_sin_salida', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', f.codigo, 'numero', f.numero_contifico, 'fecha', f.fecha_facturacion, 'cliente', coalesce(c.nombre, q.nombre)) order by f.fecha_facturacion desc)
        from public.facturas f
        left join public.clientes c on c.id = f.cliente_id
        left join public.cotizaciones q on q.id = f.cotizacion_id
       where f.deleted_at is null and f.estado = 'Facturado' and f.fecha_facturacion >= date '2026-11-16'
         and jsonb_typeof(f.items) = 'array' and jsonb_array_length(f.items) > 0
         and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(f.historial) = 'array' then f.historial else '[]'::jsonb end) h where h ->> 'accion' = 'Factura registrada')
         and not exists (select 1 from public.movimientos_inventario m where m.deleted_at is null and m.tipo = 'SALIDA'
                           and (m.factura_id = f.id or upper(m.operacion_codigo) in (upper(f.codigo), 'PRO' || upper(f.codigo))))), '[]'::jsonb),
    'descuadrados', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'codigo', p.codigo, 'nombre', p.nombre, 'stock', coalesce(p.stock, 0), 'segun_movimientos', m.com,
                                          'tecnica', coalesce(p.stock_por_reparar, 0), 'tecnica_segun_movimientos', m.tec) order by p.codigo)
        from public.productos p
        join (select producto_id, sum(app.stock_mov(tipo, bodega, cantidad, disponible)) as com,
                     coalesce(sum(cantidad) filter (where bodega = 'Por reparar'), 0) as tec
                from public.movimientos_inventario where deleted_at is null and producto_id is not null group by producto_id) m on m.producto_id = p.id
       where p.deleted_at is null and (coalesce(p.stock, 0) <> m.com or coalesce(p.stock_por_reparar, 0) <> m.tec)), '[]'::jsonb),
    'revisado', now()
  )
  where app.es_superadmin() or app.puede_alguno(array['movimientos', 'inventario', 'facturacion', 'bodega'], 'ver');
$$;
revoke all on function public.mov_control_stock() from public, anon;
grant execute on function public.mov_control_stock() to authenticated;
notify pgrst, 'reload schema';
