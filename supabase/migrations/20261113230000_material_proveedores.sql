-- =====================================================================
-- VIMEDIC · Material de proveedores (MaterialProveedores.gs) — Issue #30 parte 3
--   Marketing pide a un proveedor fichas técnicas, manuales, certificaciones y videos
--   de sus productos; el proveedor los sube por un enlace temporal, sin cuenta.
--   · material_contexto, material_crear, material_actualizar (vmMatContexto/Crear/Actualizar)
--   · material_publico y material_guardar_enlace por el código del enlace (vmMatPublico/GuardarEnlace)
--   · La subida de archivos a Drive la hace la función "drive" (acciones material_*).
-- =====================================================================

create or replace function app.mat_txt(v text, n int)
returns text language sql immutable as $$ select left(btrim(regexp_replace(coalesce(v, ''), '[\x00-\x1f]', ' ', 'g')), n) $$;

-- Un producto de la solicitud: qué se pide, si está abierto, modelo y código interno (matLimpiarProducto_)
create or replace function app.mat_producto(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cod text := upper(app.mat_txt(p ->> 'codigo', 30)); v_clave text := app.mat_txt(coalesce(nullif(p ->> 'clave', ''), p ->> 'codigo'), 40); v_pide jsonb := '{}'::jsonb; k text; pr public.productos;
begin
  if v_clave = '' then raise exception 'Producto sin código.'; end if;
  foreach k in array array['ficha', 'manual', 'cert', 'video'] loop
    if coalesce((p -> 'pide' ->> k), '') in ('1', 'true') then v_pide := v_pide || jsonb_build_object(k, 1); end if;
  end loop;
  if v_pide = '{}'::jsonb then v_pide := '{"ficha":1,"manual":1,"cert":1,"video":1}'::jsonb; end if;
  if v_cod <> '' then select * into pr from public.productos where upper(codigo) = v_cod and deleted_at is null; end if;
  return jsonb_build_object('clave', v_clave, 'codigo', v_cod, 'nombre', coalesce(nullif(app.mat_txt(p ->> 'nombre', 160), ''), pr.nombre, ''),
    'modelo', coalesce(nullif(app.mat_txt(p ->> 'modelo', 120), ''), pr.referencia_proveedor, ''),
    'codInterno', coalesce(nullif(upper(app.mat_txt(p ->> 'codInterno', 60)), ''), case when upper(coalesce(pr.codigo_unico, '')) <> v_cod then pr.codigo_unico end, ''),
    'marca', coalesce(nullif(app.mat_txt(p ->> 'marca', 80), ''), pr.marca, ''),
    'imagen', case when (p ->> 'imagen') ~ '^https://[^\s"''<>]+$' then left(p ->> 'imagen', 400) else coalesce(pr.imagen_url, '') end,
    'abierto', coalesce((p ->> 'abierto')::boolean, true), 'pide', v_pide, 'nota', app.mat_txt(p ->> 'nota', 300));
end $$;

create or replace function app.mat_vigente(s public.material_solicitudes)
returns boolean language sql stable as $$
  select s.deleted_at is null and s.estado = 'Abierta' and (s.vence is null or (s.vence at time zone 'America/Guayaquil')::date >= (now() at time zone 'America/Guayaquil')::date)
$$;

-- ---------------------------------------------------------------------
-- Marketing: contexto, crear y actualizar
-- ---------------------------------------------------------------------
create or replace function public.material_contexto()
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.puede('marketing', 'ver') then raise exception 'Necesitas acceso a Marketing.'; end if;
  return jsonb_build_object(
    -- Equipos nuevos de las importaciones de los últimos 12 meses, con su código asignado o reservado
    'nuevos', coalesce((select jsonb_agg(x order by x ->> 'importacion' desc) from (
      select distinct on (coalesce(nullif(coalesce(p.codigo, nullif(i.codigo_reservado, ''), nullif(i.codigo_deseado, '')), ''), i.codigo))
        jsonb_build_object('clave', coalesce(nullif(upper(coalesce(p.codigo, nullif(i.codigo_reservado, ''), nullif(i.codigo_deseado, ''))), ''), i.codigo),
          'codigo', upper(coalesce(p.codigo, nullif(i.codigo_reservado, ''), nullif(i.codigo_deseado, ''), '')), 'nombre', coalesce(p.nombre, nullif(i.descripcion, ''), i.modelo, ''),
          'modelo', coalesce(p.referencia_proveedor, ''), 'codInterno', case when coalesce(i.modelo, '') <> '' and i.modelo <> coalesce(i.descripcion, '') and length(i.modelo) <= 60 then i.modelo else coalesce(p.codigo_unico, '') end,
          'marca', coalesce(i.marca, p.marca, ''), 'proveedor', coalesce(e.proveedor_texto, ''), 'importacion', e.codigo, 'imagen', coalesce(p.imagen_url, i.imagen_referencia, ''),
          'identificado', p.id is not null) as x
        from public.imp_items i join public.imp_expedientes e on e.codigo = i.pedido_codigo and e.deleted_at is null
        left join public.productos p on p.deleted_at is null and p.codigo = coalesce(nullif(e.compra -> i.codigo ->> 'producto', ''), nullif(i.codigo_producto, ''))
       where i.deleted_at is null and i.cantidad > 0 and coalesce(i.tipo_linea, '') = 'Nuevo' and i.updated_at > now() - interval '365 days') q), '[]'::jsonb),
    'solicitudes', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'codigo', s.codigo, 'token', s.token, 'proveedor', coalesce(s.proveedor_texto, ''), 'titulo', s.titulo, 'estado', s.estado,
        'vence', to_char(s.vence at time zone 'America/Guayaquil', 'YYYY-MM-DD'), 'vigente', app.mat_vigente(s), 'nota', coalesce(s.nota, ''), 'creado', s.created_at,
        'creadoPor', (select nombre from public.empleados where id = s.creado_por),
        'productos', (select coalesce(jsonb_agg(pp || jsonb_build_object('recibidos', (select coalesce(jsonb_object_agg(t.tipo, t.n), '{}'::jsonb) from (select a.tipo, count(*) as n from public.material_archivos a
            where a.solicitud_id = s.id and a.clave = pp ->> 'clave' and a.deleted_at is null group by a.tipo) t))), '[]'::jsonb)
          from jsonb_array_elements(case when jsonb_typeof(s.productos) = 'array' then s.productos else '[]'::jsonb end) pp),
        'archivos', (select count(*) from public.material_archivos a where a.solicitud_id = s.id and a.deleted_at is null)) order by s.created_at desc)
      from public.material_solicitudes s where s.deleted_at is null), '[]'::jsonb),
    'hoy', to_char(now() at time zone 'America/Guayaquil', 'YYYY-MM-DD'));
end $$;

create or replace function public.material_crear(d jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare v_prods jsonb; v_vence date; v_anio text := to_char(now() at time zone 'America/Guayaquil', 'YYYY'); v_n int; v_cod text; v_id uuid := gen_random_uuid(); v_tok text := replace(gen_random_uuid()::text, '-', '');
begin
  if not app.puede('marketing', 'editar') and not app.puede('marketing', 'crear') then raise exception 'Necesitas permiso en Marketing.'; end if;
  select coalesce(jsonb_agg(app.mat_producto(x)), '[]'::jsonb) into v_prods
    from (select x from jsonb_array_elements(case when jsonb_typeof(d -> 'productos') = 'array' then d -> 'productos' else '[]'::jsonb end) with ordinality t(x, n) where n <= 150) z;
  if jsonb_array_length(v_prods) = 0 then raise exception 'Elige al menos un producto.'; end if;
  v_vence := case when (d ->> 'vence') ~ '^\d{4}-\d{2}-\d{2}$' then (d ->> 'vence')::date else ((now() at time zone 'America/Guayaquil')::date + 30) end;
  if v_vence < (now() at time zone 'America/Guayaquil')::date then raise exception 'La fecha de vencimiento ya pasó.'; end if;
  perform pg_advisory_xact_lock(hashtext('material_solicitudes'));
  select coalesce(max((regexp_match(codigo, '^MS-' || v_anio || '-(\d+)$'))[1]::int), 0) + 1 into v_n from public.material_solicitudes where codigo like 'MS-' || v_anio || '-%';
  v_cod := 'MS-' || v_anio || '-' || lpad(v_n::text, 3, '0');
  insert into public.material_solicitudes (id, codigo, token, proveedor_texto, titulo, estado, vence, nota, productos, actualizado_por)
  values (v_id, v_cod, v_tok, nullif(app.mat_txt(d ->> 'proveedor', 120), ''), coalesce(nullif(app.mat_txt(d ->> 'titulo', 160), ''), 'Material de productos — ' || app.mat_txt(d ->> 'proveedor', 120)),
    'Abierta', (v_vence::text || ' 23:59:59')::timestamp at time zone 'America/Guayaquil', nullif(app.mat_txt(d ->> 'nota', 1000), ''), v_prods, app.empleado_id());
  return jsonb_build_object('id', v_id, 'codigo', v_cod, 'token', v_tok);
end $$;

create or replace function public.material_actualizar(p_id uuid, c jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare s public.material_solicitudes; v_prods jsonb; x jsonb; i int; k text; v_pide jsonb; t text; v_nuevo jsonb;
begin
  if not app.puede('marketing', 'editar') then raise exception 'Necesitas permiso para editar en Marketing.'; end if;
  select * into s from public.material_solicitudes where id = p_id and deleted_at is null for update;
  if not found then raise exception 'No se encontró la solicitud.'; end if;
  v_prods := case when jsonb_typeof(s.productos) = 'array' then s.productos else '[]'::jsonb end;
  if c ? 'estado' and c ->> 'estado' not in ('Abierta', 'Cerrada') then raise exception 'Estado no válido.'; end if;
  if c ? 'vence' and coalesce(c ->> 'vence', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Fecha no válida.'; end if;
  for x in select y from jsonb_array_elements(case when jsonb_typeof(c -> 'productos') = 'array' then c -> 'productos' else '[]'::jsonb end) y loop
    k := x ->> 'clave';
    if coalesce((x ->> 'quitar')::boolean, false) then
      select coalesce(jsonb_agg(p), '[]'::jsonb) into v_prods from jsonb_array_elements(v_prods) p where p ->> 'clave' is distinct from k; continue;
    end if;
    if x ? 'agregar' then
      v_nuevo := app.mat_producto(x -> 'agregar');
      if not exists (select 1 from jsonb_array_elements(v_prods) p where p ->> 'clave' = v_nuevo ->> 'clave') then v_prods := v_prods || jsonb_build_array(v_nuevo); end if;
      continue;
    end if;
    i := null;
    select n - 1 into i from jsonb_array_elements(v_prods) with ordinality q(p, n) where p ->> 'clave' = k;
    if i is null then continue; end if;
    if x ? 'abierto' then v_prods := jsonb_set(v_prods, array[i::text, 'abierto'], to_jsonb(coalesce((x ->> 'abierto')::boolean, true))); end if;
    if jsonb_typeof(x -> 'pide') = 'object' then
      v_pide := '{}'::jsonb;
      foreach t in array array['ficha', 'manual', 'cert', 'video'] loop if coalesce(x -> 'pide' ->> t, '') in ('1', 'true') then v_pide := v_pide || jsonb_build_object(t, 1); end if; end loop;
      if v_pide <> '{}'::jsonb then v_prods := jsonb_set(v_prods, array[i::text, 'pide'], v_pide); end if;
    end if;
    if x ? 'nota' then v_prods := jsonb_set(v_prods, array[i::text, 'nota'], to_jsonb(app.mat_txt(x ->> 'nota', 300))); end if;
    if x ? 'modelo' then v_prods := jsonb_set(v_prods, array[i::text, 'modelo'], to_jsonb(app.mat_txt(x ->> 'modelo', 120))); end if;
    if x ? 'codInterno' then
      v_prods := jsonb_set(v_prods, array[i::text, 'codInterno'], to_jsonb(upper(regexp_replace(app.mat_txt(x ->> 'codInterno', 60), '[<>"''=]', '', 'g'))));
      -- Opcional: también al código interno del producto en el inventario
      if coalesce((x ->> 'alInventario')::boolean, false) and coalesce(v_prods -> i ->> 'codigo', '') <> '' and app.mat_txt(x ->> 'codInterno', 60) <> '' then
        update public.productos set codigo_unico = upper(app.mat_txt(x ->> 'codInterno', 60)) where upper(codigo) = upper(v_prods -> i ->> 'codigo') and deleted_at is null;
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_prods) = 0 then raise exception 'La solicitud debe tener al menos un producto.'; end if;
  if jsonb_array_length(v_prods) > 150 then raise exception 'Una solicitud admite hasta 150 productos.'; end if;
  update public.material_solicitudes set productos = v_prods,
    estado = coalesce(c ->> 'estado', estado),
    vence = case when c ? 'vence' then ((c ->> 'vence') || ' 23:59:59')::timestamp at time zone 'America/Guayaquil' else vence end,
    nota = case when c ? 'nota' then nullif(app.mat_txt(c ->> 'nota', 1000), '') else nota end,
    proveedor_texto = case when c ? 'proveedor' then nullif(app.mat_txt(c ->> 'proveedor', 120), '') else proveedor_texto end,
    titulo = case when c ? 'titulo' and app.mat_txt(c ->> 'titulo', 160) <> '' then app.mat_txt(c ->> 'titulo', 160) else titulo end,
    actualizado_por = app.empleado_id()
  where id = s.id;
end $$;

-- ---------------------------------------------------------------------
-- Proveedor (sin sesión): ver la solicitud y dejar un enlace de descarga
-- ---------------------------------------------------------------------
create or replace function app.mat_por_token(p_token text)
returns public.material_solicitudes language plpgsql stable security definer set search_path = public as $$
declare s public.material_solicitudes;
begin
  if coalesce(p_token, '') !~ '^[a-f0-9]{32}$' then raise exception 'Enlace no válido.'; end if;
  select * into s from public.material_solicitudes where token = p_token and deleted_at is null;
  if not found then raise exception 'Enlace no válido.'; end if;
  return s;
end $$;
revoke all on function app.mat_por_token(text) from public, anon, authenticated;

create or replace function public.material_publico(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare s public.material_solicitudes := app.mat_por_token(p_token); v boolean := app.mat_vigente(s);
begin
  return jsonb_build_object('codigo', s.codigo, 'proveedor', coalesce(s.proveedor_texto, ''), 'titulo', s.titulo, 'vence', to_char(s.vence at time zone 'America/Guayaquil', 'YYYY-MM-DD'),
    'nota', coalesce(s.nota, ''), 'vigente', v, 'estado', s.estado,
    'productos', case when not v then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('clave', p ->> 'clave', 'codigo', p ->> 'codigo', 'nombre', p ->> 'nombre', 'modelo', p ->> 'modelo',
        'codInterno', coalesce(p ->> 'codInterno', ''), 'marca', p ->> 'marca', 'imagen', p ->> 'imagen', 'pide', p -> 'pide', 'nota', p ->> 'nota',
        'archivos', (select coalesce(jsonb_agg(jsonb_build_object('tipo', a.tipo, 'nombre', a.nombre, 'tam', a.tamano, 'fecha', a.fecha, 'enlace', a.origen = 'Enlace') order by a.fecha), '[]'::jsonb)
          from public.material_archivos a where a.solicitud_id = s.id and a.clave = p ->> 'clave' and a.deleted_at is null))), '[]'::jsonb)
      from jsonb_array_elements(case when jsonb_typeof(s.productos) = 'array' then s.productos else '[]'::jsonb end) p where coalesce((p ->> 'abierto')::boolean, true)) end);
end $$;

create or replace function app.mat_puede_subir(s public.material_solicitudes, p_clave text)
returns void language plpgsql stable security definer set search_path = public as $$
declare p jsonb; n int;
begin
  if s.estado <> 'Abierta' then raise exception 'CERRADO: Este enlace ya fue cerrado por VIMEDIC. / This link has been closed.'; end if;
  if not app.mat_vigente(s) then raise exception 'VENCIDO: Este enlace venció el %. / This link expired on %.', to_char(s.vence, 'YYYY-MM-DD'), to_char(s.vence, 'YYYY-MM-DD'); end if;
  select x into p from jsonb_array_elements(case when jsonb_typeof(s.productos) = 'array' then s.productos else '[]'::jsonb end) x where x ->> 'clave' = coalesce(p_clave, '');
  if p is null then raise exception 'Producto no encontrado en esta solicitud. / Product not found.'; end if;
  if not coalesce((p ->> 'abierto')::boolean, true) then raise exception 'Este producto ya fue cerrado por VIMEDIC. / This product is closed.'; end if;
  select count(*) into n from public.material_archivos where solicitud_id = s.id and clave = p_clave and deleted_at is null;
  if n >= 60 then raise exception 'Este producto ya tiene % archivos. / Too many files for this product.', n; end if;
end $$;
revoke all on function app.mat_puede_subir(public.material_solicitudes, text) from public, anon, authenticated;

create or replace function public.material_guardar_enlace(p_token text, d jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare s public.material_solicitudes := app.mat_por_token(p_token); v_url text := app.mat_txt(d ->> 'url', 600); v_tipo text := coalesce(nullif(d ->> 'tipo', ''), 'otro');
begin
  perform app.mat_puede_subir(s, d ->> 'clave');
  if v_url !~* '^https?://[^\s"''<>]+\.[^\s"''<>]+$' then raise exception 'Escriba un enlace válido (https://…). / Please enter a valid link.'; end if;
  if v_tipo not in ('ficha', 'manual', 'cert', 'video', 'otro') then v_tipo := 'otro'; end if;
  insert into public.material_archivos (id, codigo, solicitud_id, clave, tipo, nombre, url, tamano, fecha, origen)
  values (gen_random_uuid(), 'MA-' || left(gen_random_uuid()::text, 13), s.id, d ->> 'clave', v_tipo, coalesce(nullif(app.mat_txt(d ->> 'nombre', 140), ''), 'Enlace / Link'), v_url, 0, now(), 'Enlace');
  return public.material_publico(p_token);
end $$;

-- La función "drive" registra cada archivo subido (con la clave de servicio, tras validar el enlace)
create or replace function public.material_registrar_archivo(p_token text, d jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare s public.material_solicitudes := app.mat_por_token(p_token); v_tipo text := coalesce(nullif(d ->> 'tipo', ''), 'otro');
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then raise exception 'Solo la función de Drive registra archivos.'; end if;
  perform app.mat_puede_subir(s, d ->> 'clave');
  if v_tipo not in ('ficha', 'manual', 'cert', 'video', 'otro') then v_tipo := 'otro'; end if;
  insert into public.material_archivos (id, codigo, solicitud_id, clave, tipo, nombre, url, tamano, fecha, origen)
  values (gen_random_uuid(), 'MA-' || left(gen_random_uuid()::text, 13), s.id, d ->> 'clave', v_tipo, app.mat_txt(d ->> 'nombre', 140), app.mat_txt(d ->> 'url', 600),
    coalesce(nullif(d ->> 'tamano', '')::bigint, 0), now(), 'Proveedor');
end $$;

create or replace function public.material_validar_subida(p_token text, p_clave text)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare s public.material_solicitudes := app.mat_por_token(p_token); p jsonb;
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then raise exception 'Solo la función de Drive.'; end if;
  perform app.mat_puede_subir(s, p_clave);
  select x into p from jsonb_array_elements(s.productos) x where x ->> 'clave' = p_clave;
  return jsonb_build_object('carpeta', 'Material proveedores/' || s.codigo || coalesce(' · ' || left(s.proveedor_texto, 60), '') || '/' || coalesce(nullif(p ->> 'codigo', ''), p ->> 'clave') || coalesce(' · ' || left(nullif(p ->> 'nombre', ''), 60), ''));
end $$;

revoke all on function public.material_contexto() from public, anon;
grant execute on function public.material_contexto() to authenticated;
revoke all on function public.material_crear(jsonb) from public, anon;
grant execute on function public.material_crear(jsonb) to authenticated;
revoke all on function public.material_actualizar(uuid, jsonb) from public, anon;
grant execute on function public.material_actualizar(uuid, jsonb) to authenticated;
revoke all on function public.material_publico(text) from public;
grant execute on function public.material_publico(text) to anon, authenticated;
revoke all on function public.material_guardar_enlace(text, jsonb) from public;
grant execute on function public.material_guardar_enlace(text, jsonb) to anon, authenticated;
revoke all on function public.material_registrar_archivo(text, jsonb) from public, anon, authenticated;
grant execute on function public.material_registrar_archivo(text, jsonb) to service_role;
revoke all on function public.material_validar_subida(text, text) from public, anon, authenticated;
grant execute on function public.material_validar_subida(text, text) to service_role;

notify pgrst, 'reload schema';
