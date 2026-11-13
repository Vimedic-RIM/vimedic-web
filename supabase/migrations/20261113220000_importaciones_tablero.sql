-- =====================================================================
-- VIMEDIC · Tablero de Importaciones (ImportacionesTablero.gs / PedidoImportacion.gs) — Issue #30 parte 2
--   · Resumen por importación con la etapa real (Ingresado / En bodega salen de la recepción)
--   · Detalle con el avance por línea y los gráficos (daños, revisiones por día, días en Servicio Técnico,
--     tasa de daño del proveedor)
--   · Equipos nuevos en la lista (prefijo, código deseado) y reserva de códigos al confirmar
--   · Confirmar lista → se envía a Marketing; reabrir libera los códigos no usados
--   · Con la lista confirmada solo se puede AGREGAR o aumentar cantidades hasta que ingrese (versión 4)
--   · Cambiar el código reservado, códigos libres de un prefijo, panel general y de equipos, papelera
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Prefijos reales de los códigos (pedAnalizarPrefijos_) y códigos libres
-- ---------------------------------------------------------------------
create or replace function app.imp_codigos_usados()
returns table (codigo text, item_id uuid, pedido text, estado text)
language sql stable security definer set search_path = public as $$
  select upper(p.codigo), null::uuid, null::text, 'Producto' from public.productos p   -- también los eliminados: su código sigue ocupado
  union all
  select upper(r.codigo), r.item_id, r.pedido_codigo, coalesce(r.estado, 'Reservado') from public.imp_codigos_reservados r where r.deleted_at is null and coalesce(r.estado, '') <> 'Liberado'
$$;

-- Reserva un código (un código liberado antes se vuelve a usar: la tabla no repite códigos)
create or replace function app.imp_reservar(p_cod text, p_pref text, p_pedido text, p_item uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.imp_codigos_reservados (id, codigo, prefijo, pedido_codigo, item_id, fecha, reservado_por, estado)
  values (gen_random_uuid(), upper(p_cod), p_pref, p_pedido, p_item, now(), app.rec_quien(), 'Reservado')
  on conflict (codigo) do update set prefijo = excluded.prefijo, pedido_codigo = excluded.pedido_codigo, item_id = excluded.item_id, fecha = now(),
    reservado_por = excluded.reservado_por, estado = 'Reservado', deleted_at = null
  where public.imp_codigos_reservados.estado = 'Liberado' or public.imp_codigos_reservados.deleted_at is not null
$$;

-- Formato del código (pedFormato_): rellena con ceros hasta el ancho, nunca recorta un número más largo
create or replace function app.imp_formato(p_pref text, p_sep text, p_ancho int, p_n int)
returns text language sql immutable as $$
  select p_pref || coalesce(p_sep, '') || case when length(p_n::text) >= coalesce(p_ancho, 0) then p_n::text else lpad(p_n::text, p_ancho, '0') end
$$;

-- Siguiente código libre del prefijo (pedSiguienteCodigo_). Corrige la versión anterior: con códigos
-- de 3 cifras y otros más largos (EQM999 y EQM11815) recortaba el número al rellenar con ceros.
create or replace function app.imp_siguiente_codigo(p_prefijo text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_pref text := upper(btrim(coalesce(p_prefijo, ''))); v_sep text; v_ancho int; v_max int; n int; c text;
begin
  if v_pref !~ '^[A-Z]{1,8}$' then return ''; end if;
  select coalesce(m[2], ''), length(m[3]) into v_sep, v_ancho
    from (select regexp_match(upper(codigo), '^(' || v_pref || ')([-_.]?)(\d+)$') m from public.productos where deleted_at is null) z
   where m is not null group by 1, 2 order by count(*) desc limit 1;
  if v_ancho is null then return ''; end if;
  select coalesce(max((regexp_match(u.codigo, '^' || v_pref || '[-_.]?(\d+)$'))[1]::int), 0) into v_max
    from app.imp_codigos_usados() u where u.codigo ~ ('^' || v_pref || '[-_.]?\d+$');
  n := v_max + 1;
  loop
    c := app.imp_formato(v_pref, v_sep, v_ancho, n);
    exit when not exists (select 1 from app.imp_codigos_usados() u where u.codigo = c);
    n := n + 1;
  end loop;
  return c;
end $$;

create or replace function public.imp_prefijos()
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.puede('importaciones', 'ver') then raise exception 'Necesitas acceso a Importaciones.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('prefijo', x.pref, 'total', x.total, 'mayor', x.mayor, 'siguiente', app.imp_siguiente_codigo(x.pref),
      'categorias', (select coalesce(jsonb_agg(distinct c.nombre), '[]'::jsonb) from public.productos p2 join public.categorias c on c.id = p2.categoria_id
                      where p2.deleted_at is null and upper(p2.codigo) ~ ('^' || x.pref || '[-_.]?\d+$'))) order by x.total desc)
    from (select m[1] as pref, count(*) as total, max(m[3]::int) as mayor
            from (select regexp_match(upper(codigo), '^([A-Z]{1,8})([-_.]?)(\d+)$') m from public.productos where deleted_at is null) z
           where m is not null group by m[1] having count(*) >= 2) x), '[]'::jsonb);
end $$;

-- ¿Se puede usar este código? '' si sí; si no, el motivo (pedMotivoCodigoOcupado_)
create or replace function app.imp_motivo_codigo(p_cod text, p_item uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text := upper(btrim(coalesce(p_cod, ''))); r record; pn text;
begin
  if v !~ '^[A-Z]{1,8}[-_.]?\d{1,9}$' then return 'El código ' || v || ' no tiene el formato prefijo + número (ej. EQM11817).'; end if;
  select nombre into pn from public.productos where upper(codigo) = v limit 1;
  if pn is not null then return 'El código ' || v || ' ya existe en Productos (' || coalesce(nullif(pn, ''), 'sin nombre') || ').'; end if;
  select * into r from public.imp_codigos_reservados where upper(codigo) = v and coalesce(estado, '') <> 'Liberado' and deleted_at is null and item_id is distinct from p_item limit 1;
  if found then return 'El código ' || v || ' ya está reservado en la importación ' || coalesce(r.pedido_codigo, '') || '.'; end if;
  return '';
end $$;

create or replace function public.imp_verificar_codigo(p_codigo text, p_item text default null)
returns text language plpgsql stable security definer set search_path = public, app as $$
declare v_item uuid;
begin
  if not app.puede('importaciones', 'ver') then raise exception 'Necesitas acceso a Importaciones.'; end if;
  if p_item is not null then select id into v_item from public.imp_items where codigo = p_item and deleted_at is null; end if;
  return app.imp_motivo_codigo(p_codigo, v_item);
end $$;

-- Siguiente y huecos libres del prefijo (los más altos primero)
create or replace function public.imp_codigos_libres(p_prefijo text)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare v_pref text := upper(btrim(coalesce(p_prefijo, ''))); v_sep text; v_ancho int; v_max int; v_libres jsonb;
begin
  if not app.puede('importaciones', 'ver') then raise exception 'Necesitas acceso a Importaciones.'; end if;
  select coalesce(m[2], ''), length(m[3]) into v_sep, v_ancho
    from (select regexp_match(upper(codigo), '^(' || v_pref || ')([-_.]?)(\d+)$') m from public.productos where deleted_at is null) z
   where m is not null group by 1, 2 order by count(*) desc limit 1;
  if v_ancho is null then return jsonb_build_object('siguiente', '', 'libres', '[]'::jsonb); end if;
  select max((regexp_match(u.codigo, '^' || v_pref || '[-_.]?(\d+)$'))[1]::int) into v_max from app.imp_codigos_usados() u where u.codigo ~ ('^' || v_pref || '[-_.]?\d+$');
  with usados as (select ((regexp_match(u.codigo, '^' || v_pref || '[-_.]?(\d+)$'))[1])::int as n from app.imp_codigos_usados() u where u.codigo ~ ('^' || v_pref || '[-_.]?\d+$'))
  select coalesce(jsonb_agg(c order by n desc), '[]'::jsonb) into v_libres from (
    select g.n, app.imp_formato(v_pref, v_sep, v_ancho, g.n) as c from generate_series(greatest(1, coalesce(v_max, 0) - 400), coalesce(v_max, 0)) g(n)
     where g.n not in (select n from usados where n is not null)
     order by g.n desc limit 12) q;
  return jsonb_build_object('siguiente', app.imp_siguiente_codigo(v_pref), 'libres', v_libres);
end $$;

-- ---------------------------------------------------------------------
-- 2) Resumen del tablero (tabResumen_) y detalle (vmTabDetalle)
-- ---------------------------------------------------------------------
create or replace function app.imp_lineas_detalle(p_codigo text)
returns table (item_id text, tipo text, producto text, producto_id uuid, nombre text, imagen text, categoria text, modelo text, descripcion text, marca text, prefijo text,
  codigo_reservado text, codigo_deseado text, cantidad int, obs text, stock numeric, recibida int, faltante int, por_recibir int, pendiente int, aprobada int, en_st int, devuelta int, no_reparable int)
language sql stable security definer set search_path = public as $$
  select i.codigo, coalesce(nullif(i.tipo_linea, ''), case when p.id is null then 'Nuevo' else 'Existente' end), p.codigo, p.id,
    coalesce(p.nombre, nullif(i.nombre_snapshot, ''), nullif(i.descripcion, ''), i.modelo, ''), coalesce(nullif(p.imagen_url, ''), i.imagen_referencia, ''),
    coalesce(nullif(i.categoria, ''), (select c.nombre from public.categorias c where c.id = p.categoria_id), ''), coalesce(i.modelo, ''), coalesce(i.descripcion, ''), coalesce(nullif(i.marca, ''), p.marca, ''),
    coalesce(i.prefijo, ''), coalesce(i.codigo_reservado, ''), coalesce(i.codigo_deseado, ''), i.cantidad, coalesce(i.observaciones, ''), p.stock,
    l.recibida, l.faltante, l.por_recibir, l.pendiente, l.aprobada, l.en_st, l.devuelta, l.no_reparable
  from public.imp_expedientes e
  join public.imp_items i on i.pedido_codigo = e.codigo and i.deleted_at is null and i.cantidad > 0
  left join public.productos p on p.codigo = coalesce(nullif(e.compra -> i.codigo ->> 'producto', ''), nullif(i.codigo_producto, '')) and p.deleted_at is null
  left join app.rec_lineas(p_codigo) l on l.item_uuid = i.id
  where e.codigo = p_codigo
$$;
revoke all on function app.imp_lineas_detalle(text) from public, anon, authenticated;

create or replace function public.imp_tablero()
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.puede('importaciones', 'ver') then raise exception 'Necesitas acceso a Importaciones.'; end if;
  return coalesce((select jsonb_object_agg(e.codigo, jsonb_build_object(
      'etapa', app.imp_etapa(e), 'unidades', coalesce(s.unidades, 0), 'lineas', coalesce(s.lineas, 0), 'aprobada', coalesce(s.aprobada, 0), 'enST', coalesce(s.en_st, 0),
      'devuelta', coalesce(s.devuelta, 0), 'noReparable', coalesce(s.no_reparable, 0), 'faltante', coalesce(s.faltante, 0), 'porRecibir', coalesce(s.por_recibir, 0),
      'pendiente', coalesce(s.pendiente, 0), 'sinIdentificar', case when coalesce(e.flujo -> 'enviado', 'null'::jsonb) <> 'null'::jsonb then coalesce(s.sin_ident, 0) else 0 end,
      'nuevos', coalesce(s.nuevos, 0),
      'novedades', coalesce((select sum(case when (o.cantidades ->> 'st') ~ '^\d+' then (o.cantidades ->> 'st')::int else 0 end) from public.imp_recepciones o where o.pedido_codigo = e.codigo and o.tipo = 'REVISION' and o.deleted_at is null), 0),
      'miniaturas', coalesce(s.minis, '[]'::jsonb)))
    from public.imp_expedientes e
    left join lateral (
      select sum(d.cantidad) as unidades, count(*) as lineas, sum(d.aprobada) as aprobada, sum(d.en_st) as en_st, sum(d.devuelta) as devuelta, sum(d.no_reparable) as no_reparable,
             sum(d.faltante) as faltante, sum(d.por_recibir) as por_recibir, sum(d.pendiente) as pendiente, count(*) filter (where d.producto_id is null) as sin_ident,
             count(*) filter (where d.tipo = 'Nuevo') as nuevos, (select jsonb_agg(x) from (select d2.imagen as x from app.imp_lineas_detalle(e.codigo) d2 where d2.imagen <> '' limit 3) q) as minis
        from app.imp_lineas_detalle(e.codigo) d) s on true
   where e.deleted_at is null), '{}'::jsonb);
end $$;

create or replace function public.imp_detalle(p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare e public.imp_expedientes; v_danos jsonb; v_dia jsonb; v_diasst numeric; v_rev int; v_dan int;
begin
  if not app.puede('importaciones', 'ver') then raise exception 'Necesitas acceso a Importaciones.'; end if;
  select * into e from public.imp_expedientes where codigo = p_codigo;
  if not found then raise exception 'No se encontró la importación %.', p_codigo; end if;
  -- Daños por tipo (y faltantes) y unidades revisadas por día
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_danos from (
    select k, sum(n) as n from (
      select d.key as k, (case when d.value::text ~ '^\d+$' then d.value::text::int else 0 end) as n
        from public.imp_recepciones o, jsonb_each(case when jsonb_typeof(o.cantidades -> 'danos') = 'object' then o.cantidades -> 'danos' else '{}'::jsonb end) d
       where o.pedido_codigo = p_codigo and o.tipo in ('REVISION', 'REREVISION') and o.deleted_at is null
      union all select 'Faltante', app.rec_num(o.cantidades -> 'falt') from public.imp_recepciones o where o.pedido_codigo = p_codigo and o.tipo = 'REVISION' and o.deleted_at is null
      union all select 'Sin clasificar', app.rec_num(o.cantidades -> 'st') from public.imp_recepciones o
        where o.pedido_codigo = p_codigo and o.tipo in ('REVISION', 'REREVISION') and o.deleted_at is null and not (jsonb_typeof(o.cantidades -> 'danos') = 'object' and o.cantidades -> 'danos' <> '{}'::jsonb)
    ) z where n > 0 group by k) q;
  select coalesce(jsonb_object_agg(dia, n order by dia), '{}'::jsonb) into v_dia from (
    select to_char(o.fecha at time zone 'America/Guayaquil', 'YYYY-MM-DD') as dia, sum(app.rec_num(o.cantidades -> 'aprob') + app.rec_num(o.cantidades -> 'st') + app.rec_num(o.cantidades -> 'falt')) as n
      from public.imp_recepciones o where o.pedido_codigo = p_codigo and o.tipo = 'REVISION' and o.deleted_at is null group by 1 having sum(app.rec_num(o.cantidades -> 'aprob') + app.rec_num(o.cantidades -> 'st') + app.rec_num(o.cantidades -> 'falt')) > 0) q;
  select round(avg(extract(epoch from (o.fecha_devolucion - o.fecha)) / 86400)::numeric, 1) into v_diasst from public.imp_ordenes_st o
   where o.pedido_codigo = p_codigo and o.estado <> 'Abierta' and o.fecha_devolucion is not null and o.deleted_at is null;
  -- Tasa de daño histórica del proveedor (otras importaciones)
  select coalesce(sum(app.rec_num(o.cantidades -> 'aprob') + app.rec_num(o.cantidades -> 'st') + app.rec_num(o.cantidades -> 'falt')), 0), coalesce(sum(app.rec_num(o.cantidades -> 'st') + app.rec_num(o.cantidades -> 'falt')), 0)
    into v_rev, v_dan
    from public.imp_recepciones o join public.imp_expedientes x on x.codigo = o.pedido_codigo
   where o.tipo = 'REVISION' and o.deleted_at is null and x.codigo <> p_codigo and btrim(coalesce(x.proveedor_texto, '')) = btrim(coalesce(e.proveedor_texto, '')) and btrim(coalesce(e.proveedor_texto, '')) <> '';
  return jsonb_build_object(
    'etapa', app.imp_etapa(e), 'enviado', e.flujo -> 'enviado', 'etapas', coalesce(case when jsonb_typeof(e.flujo -> 'etapas') = 'array' then e.flujo -> 'etapas' end, '[]'::jsonb),
    'version', coalesce((e.flujo ->> 'version')::int, 0),
    'reabrible', app.imp_etapa(e) not in ('Borrador', 'Ingresado') and coalesce(e.flujo ->> 'origen', '') = 'interno'
                 and not exists (select 1 from public.imp_recepciones o where o.pedido_codigo = p_codigo and o.tipo in ('REVISION', 'REREVISION') and o.deleted_at is null),
    'lineas', coalesce((select jsonb_agg(jsonb_build_object('itemId', d.item_id, 'tipo', d.tipo, 'producto', coalesce(d.producto, ''), 'productoId', d.producto_id, 'nombre', d.nombre, 'imagen', d.imagen,
        'categoria', d.categoria, 'modelo', d.modelo, 'descripcion', d.descripcion, 'marca', d.marca, 'prefijo', d.prefijo, 'codigoReservado', d.codigo_reservado, 'codigoDeseado', d.codigo_deseado,
        'cantidad', d.cantidad, 'obs', d.obs, 'stock', d.stock, 'recibida', coalesce(d.recibida, 0), 'faltante', coalesce(d.faltante, 0), 'porRecibir', coalesce(d.por_recibir, d.cantidad),
        'pendiente', coalesce(d.pendiente, 0), 'aprobada', coalesce(d.aprobada, 0), 'enST', coalesce(d.en_st, 0), 'devuelta', coalesce(d.devuelta, 0), 'noReparable', coalesce(d.no_reparable, 0)) order by d.nombre)
      from app.imp_lineas_detalle(p_codigo) d), '[]'::jsonb),
    'ordenes', coalesce((select jsonb_agg(jsonb_build_object('id', o.codigo, 'fecha', o.fecha, 'producto', o.producto, 'modelo', o.modelo, 'cantidad', o.cantidad, 'defecto', o.defecto, 'estado', o.estado,
        'reparadas', o.reparadas, 'noReparables', o.no_reparables, 'devolucion', o.fecha_devolucion) order by o.fecha desc) from public.imp_ordenes_st o where o.pedido_codigo = p_codigo and o.deleted_at is null), '[]'::jsonb),
    'graficos', jsonb_build_object('danos', v_danos, 'porDia', v_dia, 'diasST', v_diasst, 'tasaProveedor', case when v_rev > 0 then round(v_dan::numeric / v_rev * 100, 1) end, 'revisionesProveedor', v_rev));
end $$;

-- ---------------------------------------------------------------------
-- 3) Cambios a la lista (vmTabCambios): producto existente o equipo nuevo
--    Borrador: libre. Lista confirmada: solo agregar o aumentar hasta que ingrese.
-- ---------------------------------------------------------------------
create or replace function public.imp_linea(p_codigo text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare e public.imp_expedientes; it public.imp_items; pr public.productos; v_borrador boolean; v_cant int; v_prev int := 0; v_item text := nullif(btrim(coalesce(p ->> 'item', '')), '');
  v_pref text; v_des text; v_mot text; v_compra jsonb; v_nota text := ''; v_id uuid;
begin
  if not app.puede('importaciones', 'editar') then raise exception 'Necesitas permiso para editar Importaciones.'; end if;
  select * into e from public.imp_expedientes where codigo = p_codigo and deleted_at is null for update;
  if not found then raise exception 'No se encontró la importación %.', p_codigo; end if;
  if app.imp_etapa(e) = 'Ingresado' then raise exception 'La importación ya ingresó al inventario: no se pueden agregar productos.'; end if;
  v_borrador := app.imp_etapa(e) = 'Borrador';
  if coalesce(p ->> 'cantidad', '') !~ '^\d{1,6}$' then raise exception 'Cantidad no válida.'; end if;
  v_cant := (p ->> 'cantidad')::int;
  if v_item is not null then
    select * into it from public.imp_items where codigo = v_item and pedido_codigo = p_codigo and deleted_at is null;
    if not found then raise exception 'No se encontró la línea.'; end if;
    v_prev := it.cantidad;
  end if;
  v_compra := coalesce(case when jsonb_typeof(e.compra) = 'object' then e.compra end, '{}'::jsonb);
  if p ->> 'op' = 'linea' then
    select * into pr from public.productos where upper(codigo) = upper(btrim(coalesce(p ->> 'producto', ''))) and deleted_at is null;
    if not found then raise exception 'El producto % no existe en el Inventario.', p ->> 'producto'; end if;
    if it.id is null then   -- mismo producto: una sola línea
      select * into it from public.imp_items where pedido_codigo = p_codigo and deleted_at is null and cantidad > 0 and (producto_id = pr.id or upper(codigo_producto) = upper(pr.codigo)) limit 1;
      if found then v_prev := it.cantidad; v_cant := v_prev + v_cant; end if;   -- agregar desde la barra suma
    end if;
    if not v_borrador and v_cant < v_prev then raise exception 'La lista ya está confirmada: solo se puede agregar o aumentar la cantidad de %.', pr.codigo; end if;
    if not v_borrador and v_cant > v_prev then v_nota := '+' || (v_cant - v_prev) || ' ' || pr.codigo; end if;
    if it.id is null then
      v_id := gen_random_uuid();
      insert into public.imp_items (id, codigo, pedido_codigo, expediente_id, producto_id, codigo_producto, nombre_snapshot, imagen_referencia, marca, modelo, descripcion, cantidad, origen, tipo_linea, observaciones)
      values (v_id, 'IT-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 8)), p_codigo, e.id, pr.id, pr.codigo, pr.nombre, pr.imagen_url, pr.marca, coalesce(pr.codigo_unico, pr.codigo), pr.nombre, v_cant, 'Interno', 'Existente', nullif(app.rec_txt(p ->> 'obs', 300), ''));
      select * into it from public.imp_items where id = v_id;
    else
      update public.imp_items set cantidad = v_cant, observaciones = coalesce(nullif(app.rec_txt(p ->> 'obs', 300), ''), observaciones) where id = it.id;
    end if;
    if v_cant > 0 then v_compra := jsonb_set(v_compra, array[it.codigo], coalesce(v_compra -> it.codigo, jsonb_build_object('fob', null)) || jsonb_build_object('producto', pr.codigo));
    else v_compra := v_compra - it.codigo; update public.imp_items set deleted_at = now() where id = it.id; end if;
  elsif p ->> 'op' = 'nuevo' then
    if not v_borrador and v_cant < v_prev then raise exception 'La lista ya está confirmada: solo se puede agregar o aumentar cantidades.'; end if;
    v_pref := upper(left(btrim(coalesce(p ->> 'prefijo', '')), 8));
    v_des := upper(regexp_replace(btrim(coalesce(p ->> 'codigo', '')), '\s+', '', 'g'));
    if v_cant > 0 and v_des <> '' then
      v_mot := app.imp_motivo_codigo(v_des, it.id); if v_mot <> '' then raise exception '%', v_mot; end if;
      v_pref := coalesce((regexp_match(v_des, '^([A-Z]{1,8})'))[1], v_pref);
    end if;
    if v_cant > 0 and v_pref = '' then raise exception 'Elige el prefijo del código del equipo nuevo.'; end if;
    if v_cant > 0 and app.rec_txt(p ->> 'descripcion') = '' and app.rec_txt(p ->> 'modelo') = '' then raise exception 'Escribe la descripción del proveedor.'; end if;
    if not v_borrador and v_cant > v_prev then v_nota := '+' || (v_cant - v_prev) || ' equipo nuevo ' || coalesce(nullif(app.rec_txt(p ->> 'modelo', 60), ''), app.rec_txt(p ->> 'descripcion', 60)); end if;
    if it.id is null then
      v_id := gen_random_uuid();
      insert into public.imp_items (id, codigo, pedido_codigo, expediente_id, modelo, descripcion, marca, categoria, cantidad, origen, tipo_linea, prefijo, codigo_deseado, observaciones, imagen_referencia)
      values (v_id, 'IT-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 8)), p_codigo, e.id, coalesce(nullif(app.rec_txt(p ->> 'modelo', 120), ''), app.rec_txt(p ->> 'descripcion', 120)),
        app.rec_txt(p ->> 'descripcion', 300), nullif(app.rec_txt(p ->> 'marca', 80), ''), nullif(app.rec_txt(p ->> 'categoria', 80), ''), v_cant, 'Interno', 'Nuevo', v_pref, nullif(v_des, ''),
        nullif(app.rec_txt(p ->> 'obs', 300), ''), nullif(app.rec_txt(p ->> 'imagen', 500), ''));
      select * into it from public.imp_items where id = v_id;
    else
      if it.producto_id is not null then raise exception 'Marketing ya creó este producto: edítalo como producto existente.'; end if;
      update public.imp_items set cantidad = v_cant, modelo = coalesce(nullif(app.rec_txt(p ->> 'modelo', 120), ''), app.rec_txt(p ->> 'descripcion', 120)), descripcion = app.rec_txt(p ->> 'descripcion', 300),
        marca = nullif(app.rec_txt(p ->> 'marca', 80), ''), categoria = nullif(app.rec_txt(p ->> 'categoria', 80), ''), prefijo = v_pref, codigo_deseado = nullif(v_des, ''),
        observaciones = nullif(app.rec_txt(p ->> 'obs', 300), ''), imagen_referencia = coalesce(nullif(app.rec_txt(p ->> 'imagen', 500), ''), imagen_referencia)
      where id = it.id;
    end if;
    if v_cant > 0 then v_compra := jsonb_set(v_compra, array[it.codigo], coalesce(v_compra -> it.codigo, jsonb_build_object('fob', null)) || jsonb_build_object('producto', ''));
    else v_compra := v_compra - it.codigo; update public.imp_items set deleted_at = now() where id = it.id; end if;
  else raise exception 'Cambio no reconocido.';
  end if;
  update public.imp_expedientes set compra = v_compra, flujo = jsonb_set(flujo, '{version}', to_jsonb(coalesce((flujo ->> 'version')::int, 0) + 1)) where id = e.id;
  if v_nota <> '' then perform app.imp_evento(e.id, 'Agregó a la importación (lista confirmada): ' || v_nota || '.'); end if;
  return jsonb_build_object('ok', true, 'item', it.codigo);
end $$;

-- ---------------------------------------------------------------------
-- 4) Confirmar lista: reserva códigos de equipos nuevos y envía a Marketing (vmTabConfirmar + vmRecEnviarMarketing)
-- ---------------------------------------------------------------------
create or replace function public.imp_confirmar(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare e public.imp_expedientes; it record; v_compra jsonb; v_cod text; v_mot text; v_res text[] := '{}'; n int := 0; v_auto int := 0; v_faltan int; k int := 0; ex text;
begin
  if not app.puede('importaciones', 'editar') then raise exception 'Necesitas permiso para editar Importaciones.'; end if;
  select * into e from public.imp_expedientes where codigo = p_codigo and deleted_at is null for update;
  if not found then raise exception 'No se encontró la importación.'; end if;
  if coalesce(e.flujo -> 'enviado', 'null'::jsonb) <> 'null'::jsonb then return jsonb_build_object('ok', true, 'yaConfirmada', true); end if;
  if coalesce(e.flujo ->> 'origen', 'interno') <> 'interno' then raise exception 'Esta importación viene del portal de proveedores.'; end if;
  if btrim(coalesce(e.proveedor_texto, '')) = '' then raise exception 'Falta el proveedor.'; end if;
  v_compra := coalesce(case when jsonb_typeof(e.compra) = 'object' then e.compra end, '{}'::jsonb);
  for it in select i.*, p.codigo as pcod from public.imp_items i left join public.productos p on p.id = i.producto_id or (i.producto_id is null and upper(p.codigo) = upper(i.codigo_producto))
             where i.pedido_codigo = p_codigo and i.deleted_at is null and i.cantidad > 0 order by i.created_at loop
    n := n + 1; k := k + 1;
    if it.pcod is not null then
      v_compra := jsonb_set(v_compra, array[it.codigo], coalesce(v_compra -> it.codigo, jsonb_build_object('fob', null)) || jsonb_build_object('producto', it.pcod));
    else
      if v_compra -> it.codigo is null then v_compra := jsonb_set(v_compra, array[it.codigo], jsonb_build_object('producto', '', 'fob', null)); end if;
      if coalesce(it.codigo_reservado, '') = '' and coalesce(it.prefijo, '') <> '' then
        v_cod := upper(coalesce(it.codigo_deseado, ''));
        if v_cod <> '' then
          v_mot := app.imp_motivo_codigo(v_cod, it.id);
          if v_mot <> '' then raise exception 'Línea % (%): % Elige otro código.', k, coalesce(nullif(it.descripcion, ''), it.modelo), v_mot; end if;
        else
          v_cod := app.imp_siguiente_codigo(it.prefijo);
          if v_cod = '' then raise exception 'El prefijo % no existe en Productos. Elige un prefijo de la lista.', it.prefijo; end if;
        end if;
        perform app.imp_reservar(v_cod, upper(it.prefijo), p_codigo, it.id);
        update public.imp_items set codigo_reservado = v_cod where id = it.id;
        v_res := v_res || v_cod;
      elsif coalesce(it.codigo_reservado, '') = '' then
        -- Línea sin producto ni prefijo: si el modelo coincide con un código existente, se vincula sola
        select p.codigo into ex from public.productos p where upper(p.codigo) = upper(btrim(coalesce(it.modelo, ''))) and p.deleted_at is null;
        if ex is not null then v_compra := jsonb_set(v_compra, array[it.codigo], (v_compra -> it.codigo) || jsonb_build_object('producto', ex)); v_auto := v_auto + 1; ex := null;
        else raise exception 'Línea % (%): falta el prefijo del código.', k, coalesce(nullif(it.descripcion, ''), it.modelo); end if;
      end if;
    end if;
  end loop;
  if n = 0 then raise exception 'Agrega al menos un producto.'; end if;
  select count(*) into v_faltan from public.imp_items i where i.pedido_codigo = p_codigo and i.deleted_at is null and i.cantidad > 0 and coalesce(v_compra -> i.codigo ->> 'producto', '') = '';
  update public.imp_expedientes set compra = v_compra, estado = 'Registrado',
    flujo = (flujo || jsonb_build_object('etapa', 'Registrado', 'enviado', jsonb_build_object('fecha', now(), 'por', app.rec_quien()), 'version', coalesce((flujo ->> 'version')::int, 0) + 1,
      'etapas', coalesce(case when jsonb_typeof(flujo -> 'etapas') = 'array' then flujo -> 'etapas' end, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('etapa', 'Registrado', 'fecha', now(), 'por', app.rec_quien()))))
      || case when v_faltan = 0 then jsonb_build_object('identificado', jsonb_build_object('fecha', now(), 'por', app.rec_quien(), 'auto', true)) else '{}'::jsonb end
  where id = e.id;
  perform app.imp_evento(e.id, 'Lista confirmada: ' || n || ' producto(s)' || case when cardinality(v_res) > 0 then ', códigos ' || array_to_string(v_res, ', ') else '' end || '.');
  perform app.imp_evento(e.id, 'Listado enviado a Marketing: ' || n || ' línea(s), ' || v_faltan || ' producto(s) nuevo(s) por identificar' || case when v_auto > 0 then ', ' || v_auto || ' vinculada(s) por código' else '' end || '.');
  return jsonb_build_object('ok', true, 'reservados', to_jsonb(v_res), 'porIdentificar', v_faltan);
end $$;

-- ---------------------------------------------------------------------
-- 5) Reabrir lista (solo si Bodega no revisó nada) y cambiar el código reservado
-- ---------------------------------------------------------------------
create or replace function public.imp_reabrir(p_codigo text)
returns void language plpgsql security definer set search_path = public, app as $$
declare e public.imp_expedientes; it record; v_prod text;
begin
  if not app.puede('importaciones', 'editar') then raise exception 'Necesitas permiso para editar Importaciones.'; end if;
  select * into e from public.imp_expedientes where codigo = p_codigo and deleted_at is null for update;
  if not found then raise exception 'No se encontró la importación.'; end if;
  if coalesce(e.flujo -> 'enviado', 'null'::jsonb) = 'null'::jsonb then return; end if;
  if coalesce(e.flujo ->> 'origen', 'interno') <> 'interno' then raise exception 'Esta importación viene del portal de proveedores.'; end if;
  if coalesce(e.recepcion ->> 'confirmada', '') = 'true' then raise exception 'La importación ya ingresó al inventario.'; end if;
  if exists (select 1 from public.imp_recepciones where pedido_codigo = p_codigo and tipo in ('REVISION', 'REREVISION') and deleted_at is null) then
    raise exception 'Bodega ya empezó a revisar esta importación: la lista no se puede reabrir.';
  end if;
  for it in select * from public.imp_items where pedido_codigo = p_codigo and deleted_at is null and coalesce(codigo_reservado, '') <> '' loop
    v_prod := nullif(e.compra -> it.codigo ->> 'producto', '');
    if v_prod is not null then   -- Marketing ya creó el producto: queda como producto existente
      update public.imp_items set tipo_linea = 'Existente', codigo_producto = v_prod, codigo_reservado = null where id = it.id;
    else
      update public.imp_codigos_reservados set estado = 'Liberado' where item_id = it.id and coalesce(estado, '') = 'Reservado';
      update public.imp_items set codigo_reservado = null where id = it.id;
    end if;
  end loop;
  update public.imp_expedientes set estado = 'Borrador',
    flujo = (flujo - 'enviado' - 'identificado') || jsonb_build_object('etapa', 'Borrador', 'version', coalesce((flujo ->> 'version')::int, 0) + 1,
      'etapas', coalesce(case when jsonb_typeof(flujo -> 'etapas') = 'array' then flujo -> 'etapas' end, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('etapa', 'Borrador', 'fecha', now(), 'por', app.rec_quien())))
  where id = e.id;
  perform app.imp_evento(e.id, 'Lista reabierta para editar.');
end $$;

create or replace function public.imp_cambiar_codigo(p_codigo text, p_item text, p_nuevo text)
returns void language plpgsql security definer set search_path = public, app as $$
declare it public.imp_items; e public.imp_expedientes; v text := upper(regexp_replace(btrim(coalesce(p_nuevo, '')), '\s+', '', 'g')); v_mot text; v_ant text;
begin
  if not app.puede('importaciones', 'editar') then raise exception 'Necesitas permiso para editar Importaciones.'; end if;
  select * into e from public.imp_expedientes where codigo = p_codigo and deleted_at is null for update;
  select * into it from public.imp_items where pedido_codigo = p_codigo and codigo = p_item and deleted_at is null;
  if it.id is null then raise exception 'No se encontró la línea.'; end if;
  if it.producto_id is not null or coalesce(e.compra -> it.codigo ->> 'producto', '') <> '' then
    raise exception 'Marketing ya creó este producto; el código ya no se puede cambiar aquí.';
  end if;
  v_ant := coalesce(nullif(it.codigo_reservado, ''), it.codigo_deseado, '');
  if v = upper(v_ant) then return; end if;
  v_mot := app.imp_motivo_codigo(v, it.id); if v_mot <> '' then raise exception '%', v_mot; end if;
  if coalesce(it.codigo_reservado, '') <> '' then
    update public.imp_codigos_reservados set estado = 'Liberado' where item_id = it.id and coalesce(estado, '') = 'Reservado';
    perform app.imp_reservar(v, coalesce((regexp_match(v, '^([A-Z]{1,8})'))[1], it.prefijo), p_codigo, it.id);
    update public.imp_items set codigo_reservado = v, codigo_deseado = v where id = it.id;
  else
    update public.imp_items set codigo_deseado = v where id = it.id;
  end if;
  update public.imp_expedientes set flujo = jsonb_set(flujo, '{version}', to_jsonb(coalesce((flujo ->> 'version')::int, 0) + 1)) where id = e.id;
  perform app.imp_evento(e.id, 'Código cambiado: ' || coalesce(nullif(v_ant, ''), '(sin reservar)') || ' → ' || v || '.');
end $$;

-- ---------------------------------------------------------------------
-- 6) Panel general (vmTabPanel) y panel de equipos (vmTabEquiposPanel)
-- ---------------------------------------------------------------------
create or replace function public.imp_panel()
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.puede('importaciones', 'ver') then raise exception 'Necesitas acceso a Importaciones.'; end if;
  return jsonb_build_object(
    'proveedores', coalesce((select jsonb_agg(jsonb_build_object('nombre', x.nombre, 'importaciones', x.imps, 'revisadas', x.rev, 'danadas', x.dan, 'faltantes', x.falt,
        'tasa', case when x.rev > 0 then round((x.dan + x.falt)::numeric / x.rev * 100, 1) end, 'diasLlegada', x.dias) order by x.imps desc) from (
      select coalesce(nullif(btrim(e.proveedor_texto), ''), '—') as nombre, count(distinct e.codigo) as imps,
             coalesce(sum(app.rec_num(o.cantidades -> 'aprob') + app.rec_num(o.cantidades -> 'st') + app.rec_num(o.cantidades -> 'falt')), 0) as rev,
             coalesce(sum(app.rec_num(o.cantidades -> 'st')), 0) as dan, coalesce(sum(app.rec_num(o.cantidades -> 'falt')), 0) as falt,
             (select round(avg(d)) from (select extract(epoch from (min(o2.fecha) - ((e2.flujo -> 'enviado' ->> 'fecha')::timestamptz))) / 86400 as d
                from public.imp_expedientes e2 join public.imp_recepciones o2 on o2.pedido_codigo = e2.codigo and o2.tipo = 'REVISION' and o2.deleted_at is null
               where e2.deleted_at is null and coalesce(nullif(btrim(e2.proveedor_texto), ''), '—') = coalesce(nullif(btrim(e.proveedor_texto), ''), '—') and (e2.flujo -> 'enviado' ->> 'fecha') is not null
               group by e2.codigo, e2.flujo) z where d >= 1 and d < 400) as dias
        from public.imp_expedientes e left join public.imp_recepciones o on o.pedido_codigo = e.codigo and o.tipo = 'REVISION' and o.deleted_at is null
       where e.deleted_at is null group by 1, e.proveedor_texto) x), '[]'::jsonb),
    'productos', coalesce((select jsonb_agg(z order by (z ->> 'danadas')::int desc) from (
      select jsonb_build_object('producto', o.producto, 'nombre', coalesce(max(p.nombre), o.producto), 'revisadas', sum(app.rec_num(o.cantidades -> 'aprob') + app.rec_num(o.cantidades -> 'st') + app.rec_num(o.cantidades -> 'falt')),
        'danadas', sum(app.rec_num(o.cantidades -> 'st') + app.rec_num(o.cantidades -> 'falt')),
        'tasa', round(sum(app.rec_num(o.cantidades -> 'st') + app.rec_num(o.cantidades -> 'falt'))::numeric / nullif(sum(app.rec_num(o.cantidades -> 'aprob') + app.rec_num(o.cantidades -> 'st') + app.rec_num(o.cantidades -> 'falt')), 0) * 100, 1)) as z
        from public.imp_recepciones o left join public.productos p on p.codigo = o.producto
       where o.tipo = 'REVISION' and o.deleted_at is null group by o.producto
      having sum(app.rec_num(o.cantidades -> 'st') + app.rec_num(o.cantidades -> 'falt')) > 0
       order by sum(app.rec_num(o.cantidades -> 'st') + app.rec_num(o.cantidades -> 'falt')) desc limit 10) q), '[]'::jsonb),
    'meses', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'unidades', u) order by mes) from (
      select left(e.flujo -> 'enviado' ->> 'fecha', 7) as mes, sum(i.cantidad) as u
        from public.imp_expedientes e join public.imp_items i on i.pedido_codigo = e.codigo and i.deleted_at is null and i.cantidad > 0
       where e.deleted_at is null and (e.flujo -> 'enviado' ->> 'fecha') is not null group by 1 order by 1 desc limit 12) q), '[]'::jsonb));
end $$;

create or replace function public.imp_equipos_panel()
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.puede('importaciones', 'ver') then raise exception 'Necesitas acceso a Importaciones.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('importacion', e.codigo, 'importacionNombre', coalesce(nullif(e.flujo ->> 'nombre', ''), e.nombre, e.codigo), 'proveedor', coalesce(e.proveedor_texto, ''),
      'etapa', app.imp_etapa(e), 'itemId', i.codigo, 'tipo', coalesce(i.tipo_linea, ''), 'codigo', coalesce(p.codigo, nullif(i.codigo_reservado, ''), i.codigo_deseado, ''),
      'codigoUnico', coalesce(p.codigo_unico, ''), 'codigoReservado', coalesce(i.codigo_reservado, ''), 'modelo', coalesce(i.modelo, ''), 'marca', coalesce(i.marca, p.marca, ''),
      'nombre', coalesce(p.nombre, nullif(i.nombre_snapshot, ''), nullif(i.descripcion, ''), i.modelo, '(sin nombre)'), 'imagen', coalesce(nullif(i.imagen_referencia, ''), p.imagen_url, ''),
      'cantidad', i.cantidad, 'enInventario', p.id is not null, 'stock', coalesce(p.stock, 0)) order by e.codigo desc, coalesce(p.nombre, i.descripcion))
    from public.imp_expedientes e
    join public.imp_items i on i.pedido_codigo = e.codigo and i.deleted_at is null and i.cantidad > 0
    left join public.productos p on p.deleted_at is null and p.codigo = coalesce(nullif(e.compra -> i.codigo ->> 'producto', ''), nullif(i.codigo_producto, ''),
      (select p2.codigo from public.productos p2 where p2.deleted_at is null and (upper(p2.codigo) in (upper(i.codigo_reservado), upper(i.codigo_deseado), upper(i.modelo)) or upper(p2.codigo_unico) = upper(i.modelo)) limit 1))
   where e.deleted_at is null), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 7) Papelera de importaciones (vmPapeleraListar / vmPapeleraRestaurar)
-- ---------------------------------------------------------------------
create or replace function public.imp_papelera()
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.puede('importaciones', 'eliminar') then raise exception 'Necesitas el permiso Eliminar en Importaciones.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('codigo', e.codigo, 'nombre', coalesce(nullif(e.flujo ->> 'nombre', ''), e.nombre, e.codigo), 'proveedor', coalesce(e.proveedor_texto, ''),
      'eliminado', e.deleted_at, 'motivo', coalesce(e.motivo_eliminacion, '')) order by e.deleted_at desc) from public.imp_expedientes e where e.deleted_at is not null), '[]'::jsonb);
end $$;

create or replace function public.imp_restaurar(p_codigo text)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not app.puede('importaciones', 'eliminar') then raise exception 'Necesitas el permiso Eliminar en Importaciones.'; end if;
  update public.imp_expedientes set deleted_at = null, motivo_eliminacion = null where codigo = p_codigo and deleted_at is not null returning id into v_id;
  if v_id is null then raise exception 'La importación ya no está en la papelera.'; end if;
  perform app.imp_evento(v_id, 'Importación restaurada desde la papelera.');
end $$;

do $$ declare f text; begin
  foreach f in array array['imp_prefijos()', 'imp_verificar_codigo(text,text)', 'imp_codigos_libres(text)', 'imp_tablero()', 'imp_detalle(text)', 'imp_linea(text,jsonb)', 'imp_confirmar(text)',
    'imp_reabrir(text)', 'imp_cambiar_codigo(text,text,text)', 'imp_panel()', 'imp_equipos_panel()', 'imp_papelera()', 'imp_restaurar(text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

notify pgrst, 'reload schema';
