-- =====================================================================
-- VIMEDIC · Recepción de importaciones (RecepcionImportacion.gs) — Issue #30
-- Flujo por línea y por cantidad: Importación → Marketing → Bodega ⇄
-- Servicio Técnico → Inventario. Las cantidades de cada línea salen de
-- sumar sus operaciones (imp_recepciones); nada se edita ni se borra.
--   · Bodega revisa por partes: recibidas, aprobadas (INGRESO "Principal"),
--     con defecto (INGRESO "Por reparar" + orden a Servicio Técnico),
--     faltantes; lo demás queda pendiente para revisarlo después.
--   · Servicio Técnico devuelve reparadas (vuelven a Bodega) o no reparables.
--   · Bodega revisa lo devuelto: TRASLADO "Por reparar" → "Principal".
--   · Marketing identifica los productos nuevos (crea el producto en 0).
-- Stock: se corrige la regla al original: "Por reparar" no es stock
-- disponible (va a stock_por_reparar) y "Principal" usa la cantidad con signo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Regla de stock (Productos inventario.gs · actualizarStockInventarioInt_)
-- ---------------------------------------------------------------------
create or replace function app.stock_mov(p_tipo text, p_bodega text, p_cantidad numeric, p_disponible boolean)
returns numeric language sql immutable as $$
  select case when coalesce(p_bodega, '') = 'Por reparar' or p_disponible is false then 0
              when coalesce(p_bodega, '') = 'Principal' then coalesce(p_cantidad, 0)
              when p_tipo in ('INGRESO', 'DEVOLUCION') then abs(coalesce(p_cantidad, 0))
              else -abs(coalesce(p_cantidad, 0)) end
$$;

create or replace function app.rec_recalcular(p_producto uuid)
returns void language sql security definer set search_path = public as $$
  update public.productos p set
    stock = coalesce((select sum(app.stock_mov(m.tipo, m.bodega, m.cantidad, m.disponible)) from public.movimientos_inventario m where m.producto_id = p.id and m.deleted_at is null), p.stock),
    stock_por_reparar = coalesce((select sum(m.cantidad) from public.movimientos_inventario m where m.producto_id = p.id and m.deleted_at is null and m.bodega = 'Por reparar'), 0)
  where p.id = p_producto
$$;
revoke all on function app.rec_recalcular(uuid) from public, anon, authenticated;

create or replace function public.recalcular_stock_producto(p_producto uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_n numeric; v_hay boolean;
begin
  if not app.puede_alguno(array['movimientos', 'inventario'], 'editar') then raise exception 'Sin permiso para recalcular el stock'; end if;
  select count(*) > 0, coalesce(sum(app.stock_mov(tipo, bodega, cantidad, disponible)), 0)
    into v_hay, v_n from public.movimientos_inventario where producto_id = p_producto and deleted_at is null;
  if v_hay then perform app.rec_recalcular(p_producto); end if;
  return v_n;
end $$;

create or replace function public.recalcular_stock_general()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cambios jsonb; v_huerfanos jsonb; v_prod integer;
begin
  if not app.puede_alguno(array['movimientos', 'inventario'], 'editar') then raise exception 'Sin permiso para recalcular el stock'; end if;
  with neto as (
    select producto_id, sum(app.stock_mov(tipo, bodega, cantidad, disponible)) as n,
           coalesce(sum(cantidad) filter (where bodega = 'Por reparar'), 0) as rep
    from public.movimientos_inventario where deleted_at is null and producto_id is not null group by producto_id),
  calc as (
    select p.id, p.codigo, p.nombre, coalesce(p.stock, 0) as antes, n.n as despues, coalesce(p.stock_por_reparar, 0) as rep_antes, n.rep as rep_despues
    from public.productos p join neto n on n.producto_id = p.id where p.deleted_at is null),
  cambios as (select * from calc where antes is distinct from despues or rep_antes is distinct from rep_despues),
  upd as (update public.productos p set stock = c.despues, stock_por_reparar = c.rep_despues from cambios c where p.id = c.id returning p.id)
  select coalesce(jsonb_agg(jsonb_build_object('id', c.codigo, 'nombre', c.nombre, 'antes', c.antes, 'despues', c.despues)) filter (where c.antes is distinct from c.despues), '[]'::jsonb),
         (select count(*) from calc)
    into v_cambios, v_prod
  from cambios c;
  select coalesce(jsonb_agg(jsonb_build_object('item', x.item, 'neto', x.neto)), '[]'::jsonb) into v_huerfanos
  from (select coalesce(producto_codigo, '(sin item)') as item, sum(app.stock_mov(tipo, bodega, cantidad, disponible)) as neto
        from public.movimientos_inventario where deleted_at is null and producto_id is null group by 1 limit 50) x;
  return jsonb_build_object('productos', v_prod, 'cambios', v_cambios, 'huerfanos', v_huerfanos);
end $$;

-- ---------------------------------------------------------------------
-- 1) Permisos por área (recUsuario_)
-- ---------------------------------------------------------------------
create or replace function app.rec_area_ok(p_area text, p_accion text default 'ver')
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case p_area
    when 'importacion' then app.puede('importaciones', p_accion)
    when 'bodega' then app.puede_alguno(array['importaciones', 'bodega'], p_accion)
    when 'st' then app.puede_alguno(array['importaciones', 'servicio_tecnico'], p_accion)
    when 'marketing' then app.puede('marketing', p_accion)
    else false end, false)
$$;

create or replace function app.rec_quien()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(nombre, ''), email) from public.empleados where id = app.empleado_id()), 'Sistema')
$$;

create or replace function app.rec_num(v jsonb)
returns int language sql immutable as $$
  select case when v is null or jsonb_typeof(v) = 'null' then 0
              when (v #>> '{}') ~ '^\s*\d+(\.\d+)?\s*$' then greatest(0, floor((v #>> '{}')::numeric))::int else 0 end
$$;

create or replace function app.rec_txt(v text, n int default 600)
returns text language sql immutable as $$ select left(btrim(coalesce(v, '')), n) $$;

create or replace function app.rec_serie(v text)
returns text language sql immutable as $$ select left(upper(regexp_replace(btrim(coalesce(v, '')), '\s+', ' ', 'g')), 80) $$;

-- Fotos / adjuntos: rutas del espacio "importaciones" o enlaces https
create or replace function app.rec_fotos(v jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(x) filter (where x ~ '^(https://[^\s"''<>]+|[A-Za-z0-9][A-Za-z0-9/_.-]{4,240})$'), '[]'::jsonb)
  from (select btrim(e) as x from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) with ordinality t(e, n) where n <= 12) z
$$;

-- ---------------------------------------------------------------------
-- 2) Líneas de las importaciones con sus cantidades (recLineas_ / recEstados_)
-- ---------------------------------------------------------------------
create or replace function app.rec_lineas(p_codigo text default null)
returns table (codigo text, item_uuid uuid, item_id text, modelo text, descripcion text, marca text, esperada int, codigo_reservado text, categoria text,
  origen text, obs text, imagen text, producto text, producto_id uuid, producto_nombre text, recibida int, por_recibir int, pendiente int, aprobada int,
  en_st int, devuelta int, no_reparable int, faltante int, sin_serie boolean, resuelta boolean, fob numeric)
language sql stable security definer set search_path = public as $$
  select e.codigo, i.id, i.codigo, coalesce(i.modelo, ''), coalesce(i.descripcion, ''), coalesce(i.marca, ''), i.cantidad, coalesce(i.codigo_reservado, ''), coalesce(i.categoria, ''),
    coalesce(i.origen, ''), coalesce(i.observaciones, ''), coalesce(nullif(p.imagen_url, ''), i.imagen_referencia, ''),
    p.codigo, p.id, p.nombre,
    s.rec, greatest(0, i.cantidad - s.rec - s.falt), s.pend, s.aprob, s.st, s.dev, s.norep, s.falt, s.sin_serie,
    greatest(0, i.cantidad - s.rec - s.falt) = 0 and s.pend = 0 and s.st = 0 and s.dev = 0 and s.norep = 0,
    case when (e.compra -> i.codigo ->> 'fob') ~ '^-?\d+(\.\d+)?$' then (e.compra -> i.codigo ->> 'fob')::numeric end
  from public.imp_expedientes e
  join public.imp_items i on i.pedido_codigo = e.codigo and i.deleted_at is null and i.cantidad > 0
  left join public.productos p on p.codigo = coalesce(nullif(e.compra -> i.codigo ->> 'producto', ''), nullif(i.codigo_producto, '')) and p.deleted_at is null
  left join lateral (
    select coalesce(sum(app.rec_num(o.cantidades -> 'rec')), 0)::int as rec, coalesce(sum((o.cantidades ->> 'pend')::numeric) filter (where (o.cantidades ->> 'pend') ~ '^-?\d+'), 0)::int as pend,
           coalesce(sum((o.cantidades ->> 'aprob')::numeric) filter (where (o.cantidades ->> 'aprob') ~ '^-?\d+'), 0)::int as aprob,
           coalesce(sum((o.cantidades ->> 'st')::numeric) filter (where (o.cantidades ->> 'st') ~ '^-?\d+'), 0)::int as st,
           coalesce(sum((o.cantidades ->> 'dev')::numeric) filter (where (o.cantidades ->> 'dev') ~ '^-?\d+'), 0)::int as dev,
           coalesce(sum((o.cantidades ->> 'noRep')::numeric) filter (where (o.cantidades ->> 'noRep') ~ '^-?\d+'), 0)::int as norep,
           coalesce(sum(app.rec_num(o.cantidades -> 'falt')), 0)::int as falt,
           (array_agg((o.series ->> 'sinSerie')::boolean order by o.fecha desc) filter (where o.tipo in ('REVISION', 'REREVISION') and jsonb_typeof(o.series) = 'object' and (o.series ->> 'sinSerie') in ('true', 'false')))[1] as sin_serie
      from public.imp_recepciones o where o.item_id = i.id and o.deleted_at is null) s on true
  where e.deleted_at is null and (p_codigo is null or e.codigo = p_codigo)
$$;
revoke all on function app.rec_lineas(text) from public, anon, authenticated;

-- Etapa de la importación (tabEtapa_), la misma regla que usa inv_estado_stock
create or replace function app.imp_etapa(e public.imp_expedientes)
returns text language sql stable security definer set search_path = public as $$
  select case
    when coalesce(e.recepcion ->> 'confirmada', '') = 'true' then 'Ingresado'
    when e.flujo ->> 'origen' = 'interno' and coalesce(e.flujo -> 'enviado', 'null'::jsonb) = 'null'::jsonb then 'Borrador'
    when exists (select 1 from public.imp_recepciones o where o.pedido_codigo = e.codigo and o.tipo in ('REVISION', 'REREVISION') and o.deleted_at is null) then 'En bodega'
    when e.flujo ->> 'etapa' in ('Registrado', 'En tránsito', 'En aduana', 'En bodega') then e.flujo ->> 'etapa'
    else 'Registrado' end
$$;

-- Registro en el historial de la importación
create or replace function app.imp_evento(p_exp uuid, p_nota text)
returns void language sql security definer set search_path = public as $$
  update public.imp_expedientes set eventos = (case when jsonb_typeof(eventos) = 'array' then eventos else '[]'::jsonb end)
    || jsonb_build_array(jsonb_build_object('fecha', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'por', app.rec_quien(), 'nota', left(p_nota, 1500)))
  where id = p_exp and coalesce(p_nota, '') <> ''
$$;

-- Movimiento de inventario de la recepción
create or replace function app.rec_movimiento(p_tipo text, p_bodega text, p_cantidad numeric, p_prod public.productos, p_exp public.imp_expedientes, p_precio numeric, p_obs text)
returns void language sql security definer set search_path = public as $$
  insert into public.movimientos_inventario (id, codigo, tipo, operacion_codigo, producto_id, producto_codigo, nombre, cliente_texto, factura_texto, cantidad, precio,
    responsable_id, responsable_texto, fecha, bodega, observacion)
  values (gen_random_uuid(), 'MOV-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 10)), p_tipo, p_exp.codigo, p_prod.id, p_prod.codigo, p_prod.nombre,
    p_exp.proveedor_texto, p_exp.referencia, p_cantidad, coalesce(p_precio, 0), app.empleado_id(), app.rec_quien(), now(), p_bodega, left(p_obs, 1000))
$$;

-- Si ya no queda nada pendiente, la recepción queda completa (recActualizarRecepcion_)
create or replace function app.rec_actualizar_recepcion(p_codigo text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.imp_expedientes; v_total int; v_abiertas int; v_aprob int;
begin
  select * into e from public.imp_expedientes where codigo = p_codigo and deleted_at is null;
  if not found or coalesce(e.recepcion ->> 'confirmada', '') = 'true' then return; end if;
  select count(*), count(*) filter (where not l.resuelta), coalesce(sum(l.aprobada), 0) into v_total, v_abiertas, v_aprob from app.rec_lineas(p_codigo) l;
  if v_total = 0 or v_abiertas > 0 then return; end if;
  update public.imp_expedientes set recepcion = jsonb_build_object('confirmada', true, 'porLinea', true, 'fecha', now(), 'por', app.rec_quien(), 'principal', v_aprob, 'porReparar', 0, 'faltantes', 0, 'costoProvisional', true)
  where id = e.id;
  perform app.imp_evento(e.id, 'Recepción completa: todas las cantidades revisadas e ingresadas al Inventario (' || v_aprob || ' unidades).');
end $$;

-- Equipos de una revisión: serie y fotos de cada uno, o fotos del lote si no tiene serie (recEquipos_)
create or replace function app.rec_equipos(d jsonb, a int, def int, p_item uuid, p_producto uuid, p_permitidas text[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_sin boolean := coalesce((d ->> 'sinSerie')::boolean, false); u jsonb; unis jsonb := '[]'::jsonb; n_ok int := 0; n_def int := 0; vistas text[] := '{}'; s text; v_tomada text; i int := 0;
begin
  if a + def = 0 then return jsonb_build_object('sinSerie', v_sin, 'unis', '[]'::jsonb, 'sA', '[]'::jsonb, 'sD', '[]'::jsonb, 'fotosLote', '[]'::jsonb); end if;
  if v_sin then
    if jsonb_array_length(app.rec_fotos(d -> 'fotos')) = 0 then raise exception 'Sube al menos una foto de evidencia de la revisión.'; end if;
    return jsonb_build_object('sinSerie', true, 'unis', '[]'::jsonb, 'sA', '[]'::jsonb, 'sD', '[]'::jsonb, 'fotosLote', app.rec_fotos(d -> 'fotos'));
  end if;
  for u in select x from jsonb_array_elements(case when jsonb_typeof(d -> 'unidades') = 'array' then d -> 'unidades' else '[]'::jsonb end) x where x ->> 'estado' in ('ok', 'def') loop
    i := i + 1; s := app.rec_serie(u ->> 'serie');
    if s = '' then raise exception 'Falta el número de serie del equipo %.', i; end if;
    if s = any (vistas) then raise exception 'La serie % está repetida.', s; end if;
    vistas := vistas || s;
    if jsonb_array_length(app.rec_fotos(u -> 'fotos')) = 0 then raise exception 'Falta la foto de evidencia del equipo %.', s; end if;
    if u ->> 'estado' = 'def' and app.rec_txt(u ->> 'obs') = '' then raise exception 'Escribe la observación del equipo % (marcado con defecto).', s; end if;
    if p_permitidas is not null and cardinality(p_permitidas) > 0 and not (s = any (p_permitidas)) then
      raise exception 'La serie % no está entre los equipos devueltos por Servicio Técnico (%).', s, array_to_string(p_permitidas, ', ');
    end if;
    if u ->> 'estado' = 'ok' then n_ok := n_ok + 1; else n_def := n_def + 1; end if;
    unis := unis || jsonb_build_array(jsonb_build_object('serie', s, 'estado', u ->> 'estado', 'fotos', app.rec_fotos(u -> 'fotos'), 'obs', app.rec_txt(u ->> 'obs', 300),
      'tipo', case when u ->> 'estado' = 'def' then app.rec_txt(u ->> 'tipo', 60) else '' end));
  end loop;
  if n_ok <> a or n_def <> def then raise exception 'Registra la serie y las fotos de cada equipo: % equipo(s) clasificados y % registrado(s).', a + def, n_ok + n_def; end if;
  -- Una serie no puede estar en otro equipo ya revisado (de esta u otra importación)
  select x.serie into v_tomada from (
    select app.rec_serie(un.serie) as serie, un.item_id, un.estado, un.producto_id, un.pedido_codigo from public.imp_unidades un
     where un.deleted_at is null and app.rec_serie(un.serie) = any (vistas)) x
   where not (x.item_id = p_item and (p_permitidas is not null or coalesce(x.estado, '') in ('', 'Pendiente', 'Revisión bodega')))
     and not (x.item_id is distinct from p_item and x.producto_id is not null and p_producto is not null and x.producto_id <> p_producto)
   limit 1;
  if v_tomada is not null then raise exception 'La serie % ya está registrada. Revisa el número.', v_tomada; end if;
  return jsonb_build_object('sinSerie', false, 'unis', unis,
    'sA', (select coalesce(jsonb_agg(x -> 'serie'), '[]'::jsonb) from jsonb_array_elements(unis) x where x ->> 'estado' = 'ok'),
    'sD', (select coalesce(jsonb_agg(x -> 'serie'), '[]'::jsonb) from jsonb_array_elements(unis) x where x ->> 'estado' = 'def'),
    'fotosLote', '[]'::jsonb);
end $$;

-- Crea o actualiza cada equipo con su serie, estado y la evidencia (recGuardarEquipos_)
create or replace function app.rec_guardar_equipos(p_exp public.imp_expedientes, p_item public.imp_items, p_producto uuid, eq jsonb, rev jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x jsonb; un public.imp_unidades; v_estado text; v_rev jsonb; v_nota text; ahora text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  for x in select y from jsonb_array_elements(coalesce(eq -> 'unis', '[]'::jsonb)) y loop
    v_estado := case when x ->> 'estado' = 'ok' then 'Principal' else 'En servicio técnico' end;
    v_rev := coalesce(rev, '{}'::jsonb) || jsonb_build_object('fecha', ahora, 'por', app.rec_quien(), 'resultado', case when x ->> 'estado' = 'ok' then 'Aprobada' else 'Con defecto' end,
      'fotos', x -> 'fotos', 'observacion', coalesce(x ->> 'obs', ''));
    if x ->> 'estado' = 'ok' then v_rev := v_rev - 'tipoDano' - 'defecto' - 'orden';
    else v_rev := v_rev || jsonb_build_object('defecto', coalesce(nullif(x ->> 'obs', ''), rev ->> 'defecto', ''), 'tipoDano', coalesce(nullif(x ->> 'tipo', ''), rev ->> 'tipoDano', '')); end if;
    v_nota := case when x ->> 'estado' = 'ok' then 'Aprobada por Bodega' else 'Con defecto → Servicio Técnico' end || coalesce(': ' || nullif(x ->> 'obs', ''), '') ||
      coalesce(' (' || (rev ->> 'op') || ')', '') || ' · ' || jsonb_array_length(x -> 'fotos') || ' foto(s).';
    select * into un from public.imp_unidades where item_id = p_item.id and app.rec_serie(serie) = x ->> 'serie' and deleted_at is null limit 1;
    if found then
      update public.imp_unidades set estado = v_estado, producto_id = p_producto, serie = x ->> 'serie',
        revision_bodega = v_rev || jsonb_build_object('revisiones', (coalesce(case when jsonb_typeof(revision_bodega -> 'revisiones') = 'array' then revision_bodega -> 'revisiones' end, '[]'::jsonb) || jsonb_build_array(v_rev))),
        historial = (case when jsonb_typeof(historial) = 'array' then historial else '[]'::jsonb end) || jsonb_build_array(jsonb_build_object('fecha', ahora, 'por', app.rec_quien(), 'nota', v_nota))
      where id = un.id;
    else
      insert into public.imp_unidades (id, codigo, pedido_codigo, item_id, producto_id, modelo, descripcion, marca, serie, estado, revision_bodega, historial)
      values (gen_random_uuid(), 'U-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 8)), p_exp.codigo, p_item.id, p_producto, p_item.modelo, coalesce(p_item.descripcion, p_item.nombre_snapshot),
        p_item.marca, x ->> 'serie', v_estado, v_rev || jsonb_build_object('revisiones', jsonb_build_array(v_rev)),
        jsonb_build_array(jsonb_build_object('fecha', ahora, 'por', app.rec_quien(), 'nota', 'Registrada por Bodega. ' || v_nota)));
    end if;
  end loop;
end $$;

-- Marca series de una línea (recMarcarSeries_)
create or replace function app.rec_marcar_series(p_item uuid, p_series text[], p_estado text, p_nota text)
returns void language sql security definer set search_path = public as $$
  update public.imp_unidades set estado = p_estado,
    historial = (case when jsonb_typeof(historial) = 'array' then historial else '[]'::jsonb end) || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', app.rec_quien(), 'nota', p_nota))
  where item_id = p_item and deleted_at is null and app.rec_serie(serie) = any (p_series)
$$;

-- Orden de revisión para Servicio Técnico (recCrearOrden_)
create or replace function app.rec_crear_orden(p_exp public.imp_expedientes, p_item public.imp_items, p_prod public.productos, p_cant int, p_defecto text, p_op text, p_anterior text, p_series jsonb, p_evid jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_cod text := 'OST-' || to_char(now() at time zone 'America/Guayaquil', 'YYMMDD') || '-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 4));
begin
  insert into public.imp_ordenes_st (id, codigo, fecha, pedido_codigo, item_id, producto, modelo, cantidad, defecto, operacion_origen, orden_anterior, estado, series, evidencias, historial)
  values (gen_random_uuid(), v_cod, now(), p_exp.codigo, p_item.id, p_prod.codigo, p_item.modelo, p_cant, left(p_defecto, 800), p_op, nullif(p_anterior, ''), 'Abierta',
    coalesce(p_series, '[]'::jsonb), coalesce(p_evid, '[]'::jsonb),
    jsonb_build_array(jsonb_build_object('fecha', now(), 'por', app.rec_quien(), 'nota', 'Recibida de Bodega: ' || p_cant || ' unidad(es). Defecto: ' || left(p_defecto, 300))));
  return v_cod;
end $$;

-- ---------------------------------------------------------------------
-- 3) Bodega: llegada y revisión por partes (vmRecLlegada / vmRecRevisar)
-- ---------------------------------------------------------------------
create or replace function public.rec_llegada(p_codigo text)
returns void language plpgsql security definer set search_path = public, app as $$
declare e public.imp_expedientes;
begin
  if not app.rec_area_ok('bodega', 'editar') then raise exception 'Necesitas acceso a Bodega.'; end if;
  select * into e from public.imp_expedientes where codigo = p_codigo and deleted_at is null for update;
  if not found then raise exception 'No se encontró la importación.'; end if;
  if e.flujo ->> 'origen' = 'interno' and coalesce(e.flujo -> 'enviado', 'null'::jsonb) = 'null'::jsonb then raise exception 'La lista de esta importación aún no está confirmada.'; end if;
  if coalesce(e.flujo ->> 'etapa', '') <> 'En bodega' then
    update public.imp_expedientes set flujo = jsonb_set(jsonb_set(flujo, '{etapa}', '"En bodega"'), '{etapas}',
      coalesce(case when jsonb_typeof(flujo -> 'etapas') = 'array' then flujo -> 'etapas' end, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('etapa', 'En bodega', 'fecha', now(), 'por', app.rec_quien())))
    where id = e.id;
  end if;
  perform app.imp_evento(e.id, 'Bodega registró la llegada de la importación.');
end $$;

create or replace function public.rec_revisar(p_codigo text, p_item text, d jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare e public.imp_expedientes; it public.imp_items; l record; pr public.productos; v_op text := btrim(coalesce(d ->> 'opId', ''));
  rec int := app.rec_num(d -> 'recibidas'); a int := app.rec_num(d -> 'aprobadas'); def int := app.rec_num(d -> 'defectos'); falt int := app.rec_num(d -> 'faltantes');
  v_tipo text; eq jsonb; v_orden text := ''; v_base text; c jsonb; v_movs text[] := '{}'; v_dest text[] := '{}';
begin
  if not app.rec_area_ok('bodega', 'editar') then raise exception 'Necesitas acceso a Bodega.'; end if;
  if v_op !~ '^[A-Za-z0-9-]{12,64}$' then raise exception 'Solicitud inválida (falta el identificador de la operación). Recarga la página.'; end if;
  if exists (select 1 from public.imp_recepciones where codigo = v_op) then return jsonb_build_object('repetida', true); end if;
  select * into e from public.imp_expedientes where codigo = p_codigo and deleted_at is null for update;
  if not found then raise exception 'No se encontró la importación.'; end if;
  if coalesce(e.recepcion ->> 'confirmada', '') = 'true' then raise exception 'La recepción de esta importación ya está cerrada.'; end if;
  if coalesce(e.flujo -> 'enviado', 'null'::jsonb) = 'null'::jsonb then raise exception 'Importación aún no envía el listado.'; end if;
  select * into it from public.imp_items where pedido_codigo = p_codigo and codigo = p_item and deleted_at is null;
  select * into l from app.rec_lineas(p_codigo) z where z.item_id = p_item;
  if it.id is null or l.item_id is null then raise exception 'La línea no existe en la importación.'; end if;
  if l.producto_id is null then raise exception 'Marketing aún no identifica este producto.'; end if;
  select * into pr from public.productos where id = l.producto_id;
  if rec + falt > l.por_recibir then raise exception '%', 'Recibes ' || rec || case when falt > 0 then ' y marcas ' || falt || ' faltantes' else '' end || ' pero solo quedan ' || l.por_recibir || ' de ' || l.esperada || ' esperadas.'; end if;
  if a + def > l.pendiente + rec then raise exception 'Clasificas % unidades y solo hay % por revisar.', a + def, l.pendiente + rec; end if;
  if rec = 0 and a = 0 and def = 0 and falt = 0 then raise exception 'No hay cantidades que registrar.'; end if;
  if def > 0 and app.rec_txt(d ->> 'defecto') = '' then raise exception 'Describe el defecto encontrado.'; end if;
  v_tipo := coalesce(nullif(app.rec_txt(d ->> 'tipoDano', 60), ''), case when def > 0 then 'Otro' else '' end);
  eq := app.rec_equipos(d, a, def, it.id, pr.id, null);
  v_base := 'Importación ' || p_codigo || ' · revisión de bodega ' || v_op || ' · revisó ' || app.rec_quien();
  if a > 0 then
    perform app.rec_movimiento('INGRESO', 'Principal', a, pr, e, l.fob, v_base || ' · aprobadas' || coalesce(' · series: ' || nullif(left((select string_agg(x, ', ') from jsonb_array_elements_text(eq -> 'sA') x), 300), ''), ''));
    v_movs := v_movs || ('INGRESO Principal ' || a); v_dest := v_dest || ('Inventario ' || a);
  end if;
  if def > 0 then
    perform app.rec_movimiento('INGRESO', 'Por reparar', def, pr, e, l.fob, v_base || ' · con defecto (' || v_tipo || ')' || coalesce(' · series: ' || nullif(left((select string_agg(x, ', ') from jsonb_array_elements_text(eq -> 'sD') x), 300), ''), ''));
    v_orden := app.rec_crear_orden(e, it, pr, def, v_tipo || ': ' || app.rec_txt(d ->> 'defecto', 600), v_op, '', eq -> 'sD',
      case when (eq ->> 'sinSerie')::boolean then jsonb_build_array(jsonb_build_object('serie', '', 'fotos', eq -> 'fotosLote'))
           else (select coalesce(jsonb_agg(jsonb_build_object('serie', x ->> 'serie', 'fotos', x -> 'fotos', 'obs', coalesce(nullif(x ->> 'tipo', '') || ': ', '') || (x ->> 'obs'))), '[]'::jsonb) from jsonb_array_elements(eq -> 'unis') x where x ->> 'estado' = 'def') end);
    v_movs := v_movs || ('INGRESO Por reparar ' || def); v_dest := v_dest || ('Servicio Técnico ' || def || ' (' || v_tipo || ')');
  end if;
  if falt > 0 then v_dest := v_dest || ('Faltantes ' || falt); end if;
  if rec - a - def > 0 then v_dest := v_dest || ('Pendiente de revisión ' || (rec - a - def)); end if;
  c := jsonb_build_object('rec', rec, 'pend', rec - a - def, 'aprob', a, 'st', def);
  if falt > 0 then c := c || jsonb_build_object('falt', falt); end if;
  if def > 0 then c := c || jsonb_build_object('danos', jsonb_build_object(v_tipo, def)); end if;
  insert into public.imp_recepciones (id, codigo, fecha, pedido_codigo, item_id, producto, tipo, cantidades, orden_st_codigo, origen, destino, responsable, observacion, series, movimientos)
  values (gen_random_uuid(), v_op, now(), p_codigo, it.id, pr.codigo, 'REVISION', c, nullif(v_orden, ''), 'Importación ' || p_codigo, array_to_string(v_dest, ' · '), app.rec_quien(), app.rec_txt(d ->> 'obs', 600),
    case when (eq ->> 'sinSerie')::boolean then jsonb_build_object('sinSerie', true, 'fotos', eq -> 'fotosLote')
         when jsonb_array_length(eq -> 'unis') > 0 then jsonb_build_object('sinSerie', false, 'aprob', eq -> 'sA', 'def', eq -> 'sD', 'unidades', eq -> 'unis') end,
    case when cardinality(v_movs) > 0 then to_jsonb(array_to_string(v_movs, ' · ')) end);
  perform app.rec_guardar_equipos(e, it, pr.id, eq, jsonb_build_object('op', v_op, 'tipoDano', case when def > 0 then v_tipo else '' end, 'defecto', case when def > 0 then app.rec_txt(d ->> 'defecto', 300) else '' end, 'orden', v_orden));
  if coalesce(e.flujo ->> 'etapa', '') <> 'En bodega' then
    update public.imp_expedientes set flujo = jsonb_set(jsonb_set(flujo, '{etapa}', '"En bodega"'), '{etapas}',
      coalesce(case when jsonb_typeof(flujo -> 'etapas') = 'array' then flujo -> 'etapas' end, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('etapa', 'En bodega', 'fecha', now(), 'por', app.rec_quien())))
    where id = e.id;
  end if;
  perform app.imp_evento(e.id, 'Bodega revisó ' || coalesce(nullif(l.modelo, ''), l.descripcion) || ': recibidas ' || rec || ', aprobadas ' || a || ', con defectos ' || def ||
    case when falt > 0 then ', faltantes ' || falt else '' end || case when v_orden <> '' then ' (orden ' || v_orden || ')' else '' end || '.');
  perform app.rec_recalcular(pr.id);
  perform app.rec_actualizar_recepcion(p_codigo);
  return jsonb_build_object('ok', true, 'orden', nullif(v_orden, ''));
end $$;

-- ---------------------------------------------------------------------
-- 4) Servicio Técnico: resultado (vmRecResultadoST)
-- ---------------------------------------------------------------------
create or replace function public.rec_resultado_st(p_orden text, d jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare o public.imp_ordenes_st; e public.imp_expedientes; v_op text := btrim(coalesce(d ->> 'opId', '')); ok int := app.rec_num(d -> 'reparadas'); nr int := app.rec_num(d -> 'noReparables');
  v_series text[]; v_fotos jsonb := app.rec_fotos(d -> 'fotos'); v_adj jsonb;
begin
  if not app.rec_area_ok('st', 'editar') then raise exception 'Necesitas acceso a Servicio Técnico.'; end if;
  if v_op !~ '^[A-Za-z0-9-]{12,64}$' then raise exception 'Solicitud inválida (falta el identificador de la operación). Recarga la página.'; end if;
  if exists (select 1 from public.imp_recepciones where codigo = v_op) then return jsonb_build_object('repetida', true); end if;
  select * into o from public.imp_ordenes_st where codigo = p_orden and deleted_at is null for update;
  if not found then raise exception 'No se encontró la orden.'; end if;
  if o.estado <> 'Abierta' then raise exception 'La orden ya se cerró el %.', to_char(o.fecha_devolucion at time zone 'America/Guayaquil', 'DD/MM/YYYY'); end if;
  if ok + nr <> o.cantidad then raise exception 'La orden tiene % unidad(es): reparadas + no reparables deben sumar %.', o.cantidad, o.cantidad; end if;
  if app.rec_txt(d ->> 'tecnico') = '' then raise exception 'Indica el técnico responsable.'; end if;
  if app.rec_txt(d ->> 'diagnostico') = '' then raise exception 'Escribe el diagnóstico.'; end if;
  if ok > 0 and app.rec_txt(d ->> 'trabajo') = '' then raise exception 'Describe el trabajo realizado.'; end if;
  v_adj := case when (d -> 'adjunto' ->> 'url') ~ '^(https://[^\s"''<>]+|[A-Za-z0-9][A-Za-z0-9/_.-]{4,240})$'
                then jsonb_build_object('url', d -> 'adjunto' ->> 'url', 'nombre', coalesce(nullif(app.rec_txt(d -> 'adjunto' ->> 'nombre', 120), ''), 'Informe adjunto')) end;
  update public.imp_ordenes_st set evidencias_st = v_fotos, repuestos = app.rec_txt(d ->> 'repuestos', 1000), pruebas = app.rec_txt(d ->> 'pruebas', 1000),
    recomendaciones = app.rec_txt(d ->> 'recomendaciones', 1000), adjunto = v_adj, estado = 'Cerrada', tecnico = app.rec_txt(d ->> 'tecnico', 120),
    diagnostico = app.rec_txt(d ->> 'diagnostico', 1500), trabajo = app.rec_txt(d ->> 'trabajo', 1500), reparadas = ok, no_reparables = nr, fecha_devolucion = now(), cerrada_por = app.rec_quien(),
    historial = (case when jsonb_typeof(historial) = 'array' then historial else '[]'::jsonb end) || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', app.rec_quien(),
      'nota', 'Resultado: ' || ok || ' para nueva revisión de Bodega' || case when nr > 0 then ', ' || nr || ' no reparable(s)' else '' end || '.'))
  where id = o.id;
  insert into public.imp_recepciones (id, codigo, fecha, pedido_codigo, item_id, producto, tipo, cantidades, orden_st_codigo, origen, destino, responsable, observacion, series)
  values (gen_random_uuid(), v_op, now(), o.pedido_codigo, o.item_id, o.producto, 'ST_RESULTADO', jsonb_build_object('st', -(ok + nr), 'dev', ok, 'noRep', nr), o.codigo, 'Servicio Técnico',
    array_to_string(array_remove(array[case when ok > 0 then 'Bodega (nueva revisión) ' || ok end, case when nr > 0 then 'No reparable ' || nr end], null), ' · '), app.rec_quien(),
    'Técnico: ' || app.rec_txt(d ->> 'tecnico', 120) || ' · Diagnóstico: ' || app.rec_txt(d ->> 'diagnostico', 300) || case when jsonb_array_length(v_fotos) > 0 then ' · ' || jsonb_array_length(v_fotos) || ' foto(s)' else '' end,
    case when jsonb_array_length(v_fotos) > 0 then jsonb_build_object('fotos', v_fotos) end);
  select coalesce(array_agg(app.rec_serie(x) order by n), '{}') into v_series from jsonb_array_elements_text(case when jsonb_typeof(o.series) = 'array' then o.series else '[]'::jsonb end) with ordinality t(x, n);
  if cardinality(v_series) > 0 then
    perform app.rec_marcar_series(o.item_id, v_series[1:ok], 'Revisión bodega', 'Devuelta por Servicio Técnico (' || o.codigo || ').');
    perform app.rec_marcar_series(o.item_id, v_series[ok + 1:], 'No reparable', 'No reparable (' || o.codigo || '). Decisión pendiente.');
  end if;
  select * into e from public.imp_expedientes where codigo = o.pedido_codigo;
  perform app.imp_evento(e.id, 'Servicio Técnico cerró ' || o.codigo || ' (' || coalesce(o.modelo, '') || '): ' || ok || ' a Bodega para nueva revisión' ||
    case when nr > 0 then ', ' || nr || ' no reparable(s), decisión pendiente' else '' end || '.');
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 5) Bodega revisa lo devuelto por Servicio Técnico (vmRecRevisarDevuelta)
-- ---------------------------------------------------------------------
create or replace function public.rec_revisar_devuelta(p_codigo text, p_item text, d jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare e public.imp_expedientes; it public.imp_items; l record; pr public.productos; v_op text := btrim(coalesce(d ->> 'opId', ''));
  a int := app.rec_num(d -> 'aprobadas'); def int := app.rec_num(d -> 'defectos'); v_tipo text; eq jsonb; v_orden text := ''; v_ant text; v_dev text[]; v_obs text; c jsonb;
begin
  if not app.rec_area_ok('bodega', 'editar') then raise exception 'Necesitas acceso a Bodega.'; end if;
  if v_op !~ '^[A-Za-z0-9-]{12,64}$' then raise exception 'Solicitud inválida (falta el identificador de la operación). Recarga la página.'; end if;
  if exists (select 1 from public.imp_recepciones where codigo = v_op) then return jsonb_build_object('repetida', true); end if;
  select * into e from public.imp_expedientes where codigo = p_codigo and deleted_at is null for update;
  if not found then raise exception 'No se encontró la importación.'; end if;
  select * into it from public.imp_items where pedido_codigo = p_codigo and codigo = p_item and deleted_at is null;
  select * into l from app.rec_lineas(p_codigo) z where z.item_id = p_item;
  if it.id is null or l.item_id is null then raise exception 'La línea no existe en la importación.'; end if;
  if a = 0 and def = 0 then raise exception 'No hay cantidades que registrar.'; end if;
  if a + def > l.devuelta then raise exception 'Solo hay % unidad(es) devueltas por Servicio Técnico.', l.devuelta; end if;
  if def > 0 and app.rec_txt(d ->> 'defecto') = '' then raise exception 'Describe el defecto que persiste.'; end if;
  select * into pr from public.productos where id = l.producto_id;
  select coalesce(array_agg(app.rec_serie(serie)), '{}') into v_dev from public.imp_unidades where item_id = it.id and estado = 'Revisión bodega' and deleted_at is null and coalesce(serie, '') <> '';
  eq := app.rec_equipos(d, a, def, it.id, pr.id, v_dev);
  select codigo into v_ant from public.imp_ordenes_st where item_id = it.id and estado = 'Cerrada' and reparadas > 0 and deleted_at is null order by fecha_devolucion desc nulls last limit 1;
  v_tipo := coalesce(nullif(app.rec_txt(d ->> 'tipoDano', 60), ''), 'Otro');
  if a > 0 then
    v_obs := 'Importación ' || p_codigo || ' · revisión ' || v_op || ' · revisó ' || app.rec_quien() || ' tras Servicio Técnico' || coalesce(' (' || v_ant || ')', '') ||
      coalesce(' · series: ' || nullif(left((select string_agg(x, ', ') from jsonb_array_elements_text(eq -> 'sA') x), 300), ''), '');
    -- Traslado dentro del inventario (no es una nueva entrada): sale de "Por reparar" y entra a "Principal"
    perform app.rec_movimiento('SALIDA', 'Por reparar', -a, pr, e, l.fob, v_obs || ' → Bodega principal');
    perform app.rec_movimiento('INGRESO', 'Principal', a, pr, e, l.fob, v_obs || ' ← equipos por reparar');
  end if;
  if def > 0 then
    v_orden := app.rec_crear_orden(e, it, pr, def, v_tipo || ': ' || app.rec_txt(d ->> 'defecto', 600), v_op, v_ant, eq -> 'sD',
      case when (eq ->> 'sinSerie')::boolean then jsonb_build_array(jsonb_build_object('serie', '', 'fotos', eq -> 'fotosLote'))
           else (select coalesce(jsonb_agg(jsonb_build_object('serie', x ->> 'serie', 'fotos', x -> 'fotos', 'obs', x ->> 'obs')), '[]'::jsonb) from jsonb_array_elements(eq -> 'unis') x where x ->> 'estado' = 'def') end);
  end if;
  c := jsonb_build_object('dev', -(a + def), 'aprob', a, 'st', def);
  if def > 0 then c := c || jsonb_build_object('danos', jsonb_build_object(v_tipo, def)); end if;
  insert into public.imp_recepciones (id, codigo, fecha, pedido_codigo, item_id, producto, tipo, cantidades, orden_st_codigo, origen, destino, responsable, observacion, series, movimientos)
  values (gen_random_uuid(), v_op, now(), p_codigo, it.id, pr.codigo, 'REREVISION', c, nullif(v_orden, ''), 'Servicio Técnico' || coalesce(' ' || v_ant, ''),
    array_to_string(array_remove(array[case when a > 0 then 'Inventario ' || a end, case when def > 0 then 'Servicio Técnico ' || def end], null), ' · '), app.rec_quien(), app.rec_txt(d ->> 'obs', 600),
    case when (eq ->> 'sinSerie')::boolean then jsonb_build_object('sinSerie', true, 'fotos', eq -> 'fotosLote')
         when jsonb_array_length(eq -> 'unis') > 0 then jsonb_build_object('sinSerie', false, 'aprob', eq -> 'sA', 'def', eq -> 'sD', 'unidades', eq -> 'unis') end,
    case when a > 0 then to_jsonb('TRASLADO Por reparar → Principal ' || a) end);
  perform app.rec_guardar_equipos(e, it, pr.id, eq, jsonb_build_object('op', v_op, 'trasST', coalesce(v_ant, 'true'), 'tipoDano', case when def > 0 then v_tipo else '' end,
    'defecto', case when def > 0 then app.rec_txt(d ->> 'defecto', 300) else '' end, 'orden', v_orden));
  perform app.imp_evento(e.id, 'Bodega revisó lo devuelto por Servicio Técnico (' || coalesce(nullif(l.modelo, ''), l.descripcion) || '): aprobadas ' || a || ', vuelven a Servicio Técnico ' || def ||
    case when v_orden <> '' then ' (orden ' || v_orden || ')' else '' end || '.');
  perform app.rec_recalcular(pr.id);
  perform app.rec_actualizar_recepcion(p_codigo);
  return jsonb_build_object('ok', true, 'orden', nullif(v_orden, ''));
end $$;

-- ---------------------------------------------------------------------
-- 6) Marketing: identificar productos nuevos (vmRecIdentificar / vmRecSugerirCodigo)
-- ---------------------------------------------------------------------
create or replace function app.imp_siguiente_codigo(p_prefijo text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_pref text := upper(btrim(coalesce(p_prefijo, ''))); v_sep text; v_ancho int; v_max int; n int; c text;
begin
  if v_pref !~ '^[A-Z]{1,8}$' then return ''; end if;
  select coalesce(m[2], ''), length(m[3]) into v_sep, v_ancho
    from (select regexp_match(upper(codigo), '^(' || v_pref || ')([-_.]?)(\d+)$') m from public.productos where deleted_at is null) z
   where m is not null group by 1, 2 order by count(*) desc limit 1;
  if v_ancho is null then return ''; end if;
  select coalesce(max((regexp_match(upper(x), '^' || v_pref || '[-_.]?(\d+)$'))[1]::int), 0) into v_max
    from (select codigo x from public.productos where deleted_at is null union all select codigo from public.imp_codigos_reservados where coalesce(estado, '') <> 'Liberado' and deleted_at is null) u
   where upper(x) ~ ('^' || v_pref || '[-_.]?\d+$');
  n := v_max + 1;
  loop
    c := v_pref || v_sep || lpad(n::text, v_ancho, '0');
    exit when not exists (select 1 from public.productos where upper(codigo) = c) and not exists (select 1 from public.imp_codigos_reservados where upper(codigo) = c and coalesce(estado, '') <> 'Liberado' and deleted_at is null);
    n := n + 1;
  end loop;
  return c;
end $$;

create or replace function public.rec_sugerir_codigo(p_categoria text)
returns text language plpgsql stable security definer set search_path = public, app as $$
declare v_pref text;
begin
  if not app.rec_area_ok('marketing', 'ver') then raise exception 'Necesitas acceso a Marketing.'; end if;
  select (regexp_match(upper(p.codigo), '^([A-Z]{1,8})[-_.]?\d+$'))[1] into v_pref
    from public.productos p join public.categorias c on c.id = p.categoria_id
   where p.deleted_at is null and lower(btrim(c.nombre)) = lower(btrim(coalesce(p_categoria, ''))) and upper(p.codigo) ~ '^[A-Z]{1,8}[-_.]?\d+$'
   group by 1 order by count(*) desc limit 1;
  return coalesce(app.imp_siguiente_codigo(v_pref), '');
end $$;

create or replace function public.rec_identificar(p_codigo text, p_item text, d jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare e public.imp_expedientes; it public.imp_items; p public.productos; v_id uuid; v_cod text; v_nombre text; v_cat uuid; v_ref text; v_codint text; v_nota text; v_libero text := '';
  v_compra jsonb; v_faltan int;
begin
  if not app.rec_area_ok('marketing', 'editar') then raise exception 'Necesitas acceso a Marketing.'; end if;
  select * into e from public.imp_expedientes where codigo = p_codigo and deleted_at is null for update;
  if not found then raise exception 'No se encontró la importación.'; end if;
  if coalesce(e.flujo -> 'enviado', 'null'::jsonb) = 'null'::jsonb then raise exception 'Importación aún no envía este listado a Marketing.'; end if;
  select * into it from public.imp_items where pedido_codigo = p_codigo and codigo = p_item and deleted_at is null;
  if not found then raise exception 'La línea no existe en la importación.'; end if;
  if coalesce(e.compra -> it.codigo ->> 'producto', '') <> '' and exists (select 1 from public.imp_recepciones where item_id = it.id and tipo = 'REVISION' and deleted_at is null) then
    raise exception 'Bodega ya revisó esta línea; su producto no se puede cambiar.';
  end if;
  v_ref := left(btrim(concat_ws(' ', nullif(it.marca, ''), nullif(it.modelo, '')) || coalesce(' — ' || nullif(it.descripcion, ''), '')), 300);
  -- El "modelo" que escribe Importación es el código interno de la empresa (Marketing puede corregirlo)
  v_codint := btrim(coalesce(it.modelo, '')); if v_codint = '' or v_codint = btrim(coalesce(it.descripcion, '')) or length(v_codint) > 60 then v_codint := ''; end if;
  if coalesce((d ->> 'codInternoEditado')::boolean, false) then v_codint := left(upper(regexp_replace(btrim(coalesce(d ->> 'codInterno', '')), '[<>"''=]', '', 'g')), 60); end if;
  if d ->> 'modo' = 'existente' then
    select * into p from public.productos where upper(codigo) = upper(btrim(coalesce(d ->> 'producto', ''))) and deleted_at is null;
    if not found then raise exception 'Elige un producto existente de la lista.'; end if;
    v_nota := 'Vinculado al producto existente ' || p.codigo || ' · ' || p.nombre;
    if v_codint <> '' then
      if coalesce((d ->> 'codInternoEditado')::boolean, false) then update public.productos set codigo_unico = v_codint where id = p.id;
      else update public.productos set codigo_unico = v_codint where id = p.id and coalesce(btrim(codigo_unico), '') = ''; end if;
    end if;
    if coalesce(it.codigo_reservado, '') <> '' then
      update public.imp_codigos_reservados set estado = 'Liberado' where upper(codigo) = upper(it.codigo_reservado) and coalesce(estado, '') = 'Reservado';
      v_nota := v_nota || ' (se liberó el código reservado ' || it.codigo_reservado || ')';
    end if;
  else
    v_nombre := btrim(coalesce(d ->> 'nombre', ''));
    if v_nombre = '' then raise exception 'Escribe el nombre comercial.'; end if;
    v_nombre := initcap(lower(v_nombre));
    v_cod := upper(btrim(coalesce(d ->> 'codigo', '')));
    if coalesce(it.codigo_reservado, '') <> '' then
      if v_cod = '' or v_cod = upper(it.codigo_reservado) then v_cod := upper(it.codigo_reservado); else v_libero := it.codigo_reservado; end if;
    end if;
    if v_cod !~ '^[A-Z0-9][A-Z0-9-]{1,30}$' then raise exception 'El código debe tener letras, números o guiones (ej. EQM-140).'; end if;
    if exists (select 1 from public.imp_codigos_reservados r where upper(r.codigo) = v_cod and r.estado = 'Reservado' and r.item_id is distinct from it.id and r.deleted_at is null) then
      raise exception 'El código % está reservado para otra importación. Usa otro código.', v_cod;
    end if;
    select * into p from public.productos where upper(codigo) = v_cod;
    if found then raise exception 'Ya existe un producto con el código %: %. Elige "Producto existente".', v_cod, p.nombre; end if;
    select * into p from public.productos where deleted_at is null and lower(public.unaccent(nombre)) = lower(public.unaccent(v_nombre)) limit 1;
    if found then raise exception 'Ya existe "%" (%). Para no duplicarlo, elige "Producto existente".', p.nombre, p.codigo; end if;
    select c.id into v_cat from public.categorias c where lower(btrim(c.nombre)) = lower(btrim(coalesce(nullif(d ->> 'categoria', ''), it.categoria, ''))) and c.deleted_at is null limit 1;
    if v_cat is null then raise exception 'Elige la categoría.'; end if;
    v_id := gen_random_uuid();
    insert into public.productos (id, codigo, nombre, categoria_id, marca, imagen_url, codigo_unico, referencia_proveedor, en_catalogo, stock, fecha_creacion)
    values (v_id, v_cod, v_nombre, v_cat, nullif(btrim(coalesce(nullif(d ->> 'marca', ''), it.marca, '')), ''), nullif(coalesce(nullif(d ->> 'imagen', ''), it.imagen_referencia), ''),
      nullif(v_codint, ''), v_ref, false, 0, now());
    select * into p from public.productos where id = v_id;
    if coalesce(it.codigo_reservado, '') <> '' then
      update public.imp_codigos_reservados set estado = case when v_libero <> '' then 'Liberado' else 'Usado' end where upper(codigo) = upper(it.codigo_reservado) and coalesce(estado, '') = 'Reservado';
    end if;
    v_nota := 'Producto nuevo ' || p.codigo || ' · ' || p.nombre || ' (ref. proveedor: ' || left(v_ref, 120) || ')';
  end if;
  v_compra := coalesce(case when jsonb_typeof(e.compra) = 'object' then e.compra end, '{}'::jsonb);
  v_compra := jsonb_set(v_compra, array[it.codigo], coalesce(v_compra -> it.codigo, jsonb_build_object('fob', null)) || jsonb_build_object('producto', p.codigo));
  update public.imp_items set producto_id = p.id, codigo_producto = p.codigo where id = it.id;
  select count(*) into v_faltan from public.imp_items i where i.pedido_codigo = p_codigo and i.deleted_at is null and i.cantidad > 0
     and coalesce(nullif(v_compra -> i.codigo ->> 'producto', ''), nullif(i.codigo_producto, '')) is null;
  update public.imp_expedientes set compra = v_compra,
    flujo = case when v_faltan = 0 then jsonb_set(flujo, '{identificado}', jsonb_build_object('fecha', now(), 'por', app.rec_quien())) else flujo end
  where id = e.id;
  insert into public.imp_recepciones (id, codigo, fecha, pedido_codigo, item_id, producto, tipo, cantidades, origen, destino, responsable, observacion)
  values (gen_random_uuid(), 'ID-' || left(gen_random_uuid()::text, 13), now(), p_codigo, it.id, p.codigo, 'IDENTIFICACION', '{}'::jsonb, 'Marketing', 'Catálogo', app.rec_quien(), v_nota);
  perform app.imp_evento(e.id, 'Marketing identificó ' || coalesce(nullif(it.modelo, ''), it.descripcion) || ': ' || v_nota || '.');
  return jsonb_build_object('ok', true, 'producto', p.codigo);
end $$;

-- ---------------------------------------------------------------------
-- 7) Cierre autorizado y quitar importación (vmRecCierreAutorizado / vmRecEliminarImportacion)
-- ---------------------------------------------------------------------
create or replace function public.rec_cierre_autorizado(p_codigo text, p_motivo text)
returns void language plpgsql security definer set search_path = public, app as $$
declare e public.imp_expedientes; v_pend jsonb; v_aprob int;
begin
  if not app.puede('importaciones', 'aprobar') then raise exception 'Solo Gerencia (permiso "Aprobar" en Importaciones) puede cerrar la recepción con pendientes.'; end if;
  if app.rec_txt(p_motivo, 500) = '' then raise exception 'Escribe el motivo del cierre.'; end if;
  select * into e from public.imp_expedientes where codigo = p_codigo and deleted_at is null for update;
  if not found then raise exception 'No se encontró la importación.'; end if;
  if coalesce(e.recepcion ->> 'confirmada', '') = 'true' then raise exception 'La recepción ya está cerrada.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('modelo', l.modelo, 'porRecibir', l.por_recibir, 'pendiente', l.pendiente, 'enST', l.en_st, 'devuelta', l.devuelta, 'noReparable', l.no_reparable)) filter (where not l.resuelta), '[]'::jsonb),
         coalesce(sum(l.aprobada), 0) into v_pend, v_aprob from app.rec_lineas(p_codigo) l;
  update public.imp_expedientes set recepcion = jsonb_build_object('confirmada', true, 'porLinea', true, 'autorizada', true, 'motivo', app.rec_txt(p_motivo, 500), 'pendientes', v_pend,
    'fecha', now(), 'por', app.rec_quien(), 'principal', v_aprob, 'costoProvisional', true) where id = e.id;
  perform app.imp_evento(e.id, 'Cierre autorizado de la recepción con pendientes: ' || app.rec_txt(p_motivo, 500));
end $$;

create or replace function public.rec_eliminar_importacion(p_codigo text, p_motivo text)
returns void language plpgsql security definer set search_path = public, app as $$
declare e public.imp_expedientes; n int;
begin
  if not app.puede_alguno(array['importaciones', 'bodega'], 'eliminar') then raise exception 'Necesitas el permiso Eliminar en Importaciones o Bodega.'; end if;
  select * into e from public.imp_expedientes where codigo = p_codigo and deleted_at is null for update;
  if not found then raise exception 'No se encontró la importación.'; end if;
  if coalesce(e.recepcion ->> 'confirmada', '') = 'true' then raise exception 'La recepción de % ya se cerró: no se puede quitar.', p_codigo; end if;
  select count(*) into n from public.imp_recepciones where pedido_codigo = p_codigo and tipo in ('REVISION', 'REREVISION', 'ST_RESULTADO') and deleted_at is null;
  if n > 0 then raise exception 'Bodega ya revisó % línea(s) de % (hay stock ingresado). Para quitarla, primero corrige esas revisiones.', n, p_codigo; end if;
  perform app.imp_evento(e.id, 'Importación quitada desde Bodega (Papelera)' || coalesce(': ' || nullif(app.rec_txt(p_motivo, 200), ''), '') || '.');
  update public.imp_expedientes set deleted_at = now(), motivo_eliminacion = nullif(app.rec_txt(p_motivo, 300), '') where id = e.id;
end $$;

-- ---------------------------------------------------------------------
-- 8) Bandejas e historial (vmRecBandeja / vmRecHistorialLinea)
-- ---------------------------------------------------------------------
create or replace function app.sin_proveedor(p_txt text, p_prov text)
returns text language sql immutable as $$
  select case when coalesce(btrim(p_prov), '') = '' or coalesce(p_txt, '') = '' then coalesce(p_txt, '')
    else btrim(regexp_replace(regexp_replace(replace(p_txt, p_prov, ''), '\s*[·|–—-]\s*$', ''), '\s{2,}', ' ', 'g')) end
$$;

create or replace function public.rec_bandeja(p_area text)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare v_res jsonb; oculta boolean := p_area in ('bodega', 'st');
begin
  if not app.rec_area_ok(p_area, 'ver') then raise exception 'Sin acceso a esta bandeja.'; end if;
  with imps as (
    select e.*, app.imp_etapa(e) as etapa, coalesce(e.recepcion ->> 'confirmada', '') = 'true' as cerrada,
           coalesce(e.flujo -> 'enviado', 'null'::jsonb) <> 'null'::jsonb as enviado,
           coalesce(nullif(e.flujo ->> 'nombre', ''), nullif(e.referencia, ''), e.codigo) as nombre_full
      from public.imp_expedientes e
     where e.deleted_at is null and not (coalesce(e.recepcion ->> 'confirmada', '') = 'true' and coalesce(e.recepcion ->> 'porLinea', '') <> 'true')
  ), lin as (
    select l.*, i.etapa, i.cerrada, i.enviado, i.proveedor_texto,
           case when oculta then coalesce(nullif(app.sin_proveedor(i.nombre_full, i.proveedor_texto), ''), i.codigo) else i.nombre_full end as imp_nombre,
           left(coalesce(i.flujo ->> 'eta', ''), 10) as imp_eta
      from imps i cross join lateral app.rec_lineas(i.codigo) l
  ), res as (
    select i.codigo, case when oculta then coalesce(nullif(app.sin_proveedor(i.nombre_full, i.proveedor_texto), ''), i.codigo) else i.nombre_full end as nombre,
           i.etapa, left(coalesce(i.flujo ->> 'eta', ''), 10) as eta, case when oculta then '' else coalesce(i.proveedor_texto, '') end as proveedor,
           i.flujo -> 'enviado' as enviado, i.flujo -> 'identificado' as identificado, i.cerrada, coalesce(i.recepcion ->> 'autorizada', '') = 'true' as autorizada,
           count(l.item_id) as lineas, count(l.item_id) filter (where l.producto_id is null) as sin_identificar,
           coalesce(sum(l.esperada), 0) as esperada, coalesce(sum(l.recibida), 0) as recibida, coalesce(sum(l.por_recibir), 0) as por_recibir, coalesce(sum(l.pendiente), 0) as pendiente,
           coalesce(sum(l.aprobada), 0) as aprobada, coalesce(sum(l.en_st), 0) as en_st, coalesce(sum(l.devuelta), 0) as devuelta, coalesce(sum(l.no_reparable), 0) as no_reparable
      from imps i left join lin l on l.codigo = i.codigo
     group by i.codigo, i.nombre_full, i.proveedor_texto, i.etapa, i.flujo, i.cerrada, i.recepcion
  )
  select jsonb_build_object(
    'area', p_area, 'usuario', app.rec_quien(), 'aprueba', app.puede('importaciones', 'aprobar'),
    'puedeEliminar', app.puede_alguno(array['importaciones', 'bodega'], 'eliminar'), 'puedeEditar', app.rec_area_ok(p_area, 'editar'),
    'importaciones', coalesce((select jsonb_agg(jsonb_build_object('codigo', r.codigo, 'nombre', r.nombre, 'etapa', r.etapa, 'eta', r.eta, 'proveedor', r.proveedor, 'enviado', r.enviado,
        'identificado', r.identificado, 'cerrada', r.cerrada, 'autorizada', r.autorizada, 'lineas', r.lineas, 'sinIdentificar', r.sin_identificar, 'esperada', r.esperada, 'recibida', r.recibida,
        'porRecibir', r.por_recibir, 'pendiente', r.pendiente, 'aprobada', r.aprobada, 'enST', r.en_st, 'devuelta', r.devuelta, 'noReparable', r.no_reparable) order by r.codigo desc) from res r), '[]'::jsonb),
    'lineas', coalesce((select jsonb_agg(jsonb_build_object('codigo', l.codigo, 'itemId', l.item_id, 'modelo', l.modelo, 'descripcion', l.descripcion,
        'marca', case when oculta and l.marca <> '' and position(lower(l.marca) in lower(coalesce(l.proveedor_texto, ''))) > 0 then '' else l.marca end,
        'esperada', l.esperada, 'codigoReservado', l.codigo_reservado, 'categoria', l.categoria, 'obs', l.obs, 'imagen', l.imagen, 'producto', coalesce(l.producto, ''), 'productoNombre', coalesce(l.producto_nombre, ''),
        'recibida', l.recibida, 'porRecibir', l.por_recibir, 'pendiente', l.pendiente, 'aprobada', l.aprobada, 'enST', l.en_st, 'devuelta', l.devuelta, 'noReparable', l.no_reparable, 'faltante', l.faltante,
        'sinSerie', l.sin_serie, 'resuelta', l.resuelta, 'impNombre', l.imp_nombre, 'impEtapa', l.etapa, 'impEta', l.imp_eta,
        'series', (select coalesce(jsonb_agg(u.serie order by u.serie), '[]'::jsonb) from public.imp_unidades u where u.item_id = l.item_uuid and u.deleted_at is null and coalesce(u.serie, '') <> '' and coalesce(u.estado, '') in ('', 'Pendiente')),
        'seriesDevueltas', (select coalesce(jsonb_agg(u.serie order by u.serie), '[]'::jsonb) from public.imp_unidades u where u.item_id = l.item_uuid and u.deleted_at is null and coalesce(u.serie, '') <> '' and u.estado = 'Revisión bodega'))
        order by l.codigo desc, l.modelo)
      from lin l
     where (p_area = 'marketing' and l.enviado and not l.cerrada and l.producto_id is null)
        or (p_area = 'bodega' and l.enviado and not l.cerrada and l.producto_id is not null and (l.por_recibir > 0 or l.pendiente > 0 or l.devuelta > 0))
        or (p_area = 'st' and l.enviado and l.no_reparable > 0)
        or (p_area = 'importacion')), '[]'::jsonb),
    'ordenes', case when p_area in ('st', 'importacion', 'bodega') then coalesce((select jsonb_agg(z order by (z ->> 'estado') <> 'Abierta', z ->> 'fecha' desc) from (
        select jsonb_build_object('id', o.codigo, 'fecha', o.fecha, 'codigo', o.pedido_codigo, 'itemId', i.codigo, 'producto', o.producto, 'productoNombre', coalesce(p.nombre, ''), 'imagen', coalesce(p.imagen_url, ''),
          'modelo', o.modelo, 'cantidad', o.cantidad, 'defecto', o.defecto, 'tipoDano', coalesce((regexp_match(o.defecto, '^(Golpe / rayón|No funciona|Accesorios incompletos|Embalaje dañado|Otro):'))[1], ''),
          'detalle', regexp_replace(coalesce(o.defecto, ''), '^(Golpe / rayón|No funciona|Accesorios incompletos|Embalaje dañado|Otro):\s*', ''),
          'opOrigen', o.operacion_origen, 'anterior', o.orden_anterior, 'estado', o.estado, 'tecnico', o.tecnico, 'diagnostico', o.diagnostico, 'trabajo', o.trabajo, 'reparadas', o.reparadas,
          'noReparables', o.no_reparables, 'devolucion', o.fecha_devolucion, 'cerradaPor', o.cerrada_por, 'series', o.series, 'evidencias', o.evidencias, 'evidenciasST', o.evidencias_st,
          'repuestos', o.repuestos, 'pruebas', o.pruebas, 'recomendaciones', o.recomendaciones, 'adjunto', o.adjunto,
          'dias', greatest(0, round(extract(epoch from (case when o.estado = 'Abierta' then now() else coalesce(o.fecha_devolucion, now()) end) - o.fecha) / 86400))::int) as z
          from public.imp_ordenes_st o left join public.imp_items i on i.id = o.item_id left join public.productos p on p.codigo = o.producto and p.deleted_at is null
         where o.deleted_at is null and (p_area <> 'bodega' or o.estado = 'Abierta')
         order by o.fecha desc limit 200) q), '[]'::jsonb) else '[]'::jsonb end,
    'historial', case when p_area = 'importacion' then coalesce((select jsonb_agg(h order by h ->> 'fecha' desc) from (
        select jsonb_build_object('id', o.codigo, 'fecha', o.fecha, 'codigo', o.pedido_codigo, 'itemId', i.codigo, 'producto', o.producto, 'tipo', o.tipo, 'c', o.cantidades, 'orden', o.orden_st_codigo,
          'origen', o.origen, 'destino', o.destino, 'por', o.responsable, 'obs', o.observacion, 'movs', o.movimientos #>> '{}') as h
          from public.imp_recepciones o left join public.imp_items i on i.id = o.item_id where o.deleted_at is null order by o.fecha desc limit 300) q), '[]'::jsonb) else '[]'::jsonb end,
    'categorias', case when p_area = 'marketing' then coalesce((select jsonb_agg(c.nombre order by c.nombre) from public.categorias c where c.deleted_at is null), '[]'::jsonb) else '[]'::jsonb end
  ) into v_res;
  return v_res;
end $$;

create or replace function public.rec_historial_linea(p_codigo text, p_item text)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare it public.imp_items;
begin
  if not (app.rec_area_ok('importacion') or app.rec_area_ok('bodega') or app.rec_area_ok('st')) then raise exception 'Sin acceso.'; end if;
  select * into it from public.imp_items where pedido_codigo = p_codigo and codigo = p_item and deleted_at is null;
  if not found then raise exception 'La línea no existe.'; end if;
  return jsonb_build_object(
    'equipos', coalesce((select jsonb_agg(jsonb_build_object('serie', u.serie, 'estado', u.estado,
        'fotos', (select coalesce(jsonb_agg(distinct f), '[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(u.revision_bodega -> 'revisiones') = 'array' then u.revision_bodega -> 'revisiones' else jsonb_build_array(coalesce(u.revision_bodega, '{}'::jsonb)) end) r,
                  jsonb_array_elements_text(case when jsonb_typeof(r -> 'fotos') = 'array' then r -> 'fotos' else '[]'::jsonb end) f),
        'fecha', coalesce(u.revision_bodega ->> 'fecha', ''), 'por', coalesce(u.revision_bodega ->> 'por', ''), 'defecto', coalesce(nullif(u.revision_bodega ->> 'defecto', ''), u.revision_bodega ->> 'observacion', '')) order by u.serie)
      from public.imp_unidades u where u.item_id = it.id and u.deleted_at is null and coalesce(u.serie, '') <> ''), '[]'::jsonb),
    'operaciones', coalesce((select jsonb_agg(jsonb_build_object('id', o.codigo, 'fecha', o.fecha, 'tipo', o.tipo, 'c', o.cantidades, 'orden', o.orden_st_codigo, 'origen', o.origen, 'destino', o.destino,
        'por', o.responsable, 'obs', o.observacion, 'movs', o.movimientos #>> '{}') order by o.fecha) from public.imp_recepciones o where o.item_id = it.id and o.deleted_at is null), '[]'::jsonb),
    'ordenes', coalesce((select jsonb_agg(jsonb_build_object('id', o.codigo, 'fecha', o.fecha, 'cantidad', o.cantidad, 'defecto', o.defecto, 'estado', o.estado, 'tecnico', o.tecnico,
        'diagnostico', o.diagnostico, 'trabajo', o.trabajo, 'reparadas', o.reparadas, 'noReparables', o.no_reparables, 'devolucion', o.fecha_devolucion, 'adjunto', o.adjunto) order by o.fecha)
      from public.imp_ordenes_st o where o.item_id = it.id and o.deleted_at is null), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 9) Espacio privado para evidencias y adjuntos de la recepción
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit) values ('importaciones', 'importaciones', false, 26214400) on conflict (id) do nothing;
drop policy if exists importaciones_ver on storage.objects;
create policy importaciones_ver on storage.objects for select to authenticated
  using (bucket_id = 'importaciones' and app.puede_alguno(array['importaciones', 'bodega', 'servicio_tecnico', 'marketing'], 'ver'));
drop policy if exists importaciones_subir on storage.objects;
create policy importaciones_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'importaciones' and app.puede_alguno(array['importaciones', 'bodega', 'servicio_tecnico', 'marketing'], 'editar'));

-- Permisos de ejecución
do $$ declare f text; begin
  foreach f in array array['rec_llegada(text)', 'rec_revisar(text,text,jsonb)', 'rec_resultado_st(text,jsonb)', 'rec_revisar_devuelta(text,text,jsonb)', 'rec_sugerir_codigo(text)',
    'rec_identificar(text,text,jsonb)', 'rec_cierre_autorizado(text,text)', 'rec_eliminar_importacion(text,text)', 'rec_bandeja(text)', 'rec_historial_linea(text,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-- Deja el stock por reparar al día con la regla corregida (no cambia el stock disponible)
update public.productos p set stock_por_reparar = x.rep
  from (select producto_id, sum(cantidad) as rep from public.movimientos_inventario where deleted_at is null and bodega = 'Por reparar' group by 1) x
 where p.id = x.producto_id and p.stock_por_reparar is distinct from x.rep;

notify pgrst, 'reload schema';
