-- Módulo "Bases de Datos": panel de tablas, consulta, tablas propias con esquema, exportación y respaldos.
-- Permisos del módulo 'basedatos': ver, crear, editar, eliminar, exportar, respaldar, restaurar, administrar.

-- 0) Correcciones de la migración anterior ------------------------------------------------------------
-- aplicar_rls recibe nombres de módulo (no "modulo_ver"): se vuelve a aplicar en seg_revisiones.
select app.aplicar_rls('public.seg_revisiones', array['seguridad'], array['seguridad']);
-- Las verificaciones que escriben en la bitácora no pueden ser "stable".
create or replace function app.seg_exigir_admin() returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.puede('seguridad', 'administrar') then
    perform app.auditar('seguridad', 'Acción denegada', null, 'Denegado', 'Requiere administrar Seguridad');
    raise exception 'Solo un Superadministrador o quien administra Seguridad puede hacer esto.';
  end if;
end; $$;
create or replace function app.seg_exigir_sobre(p_empleado uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.es_superadmin() and exists (
    select 1 from public.empleados e left join public.roles r on r.id = e.rol_id
    where e.id = p_empleado and (e.es_superadmin or coalesce(r.es_superadmin, false))
  ) then
    perform app.auditar('seguridad', 'Acción denegada', p_empleado::text, 'Denegado', 'Intento de modificar a un Superadministrador');
    raise exception 'Solo un Superadministrador puede modificar a otro Superadministrador.';
  end if;
end; $$;

-- 1) Tablas propias (esquema + registros) y respaldos -------------------------------------------------
create table public.bd_tablas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  base text not null default 'General',
  modulo text not null default 'Tablas propias',
  descripcion text,
  campos jsonb not null default '[]'::jsonb
);
select app.estandarizar('public.bd_tablas');
select app.aplicar_rls('public.bd_tablas', array['basedatos'], array['basedatos']);

create table public.bd_registros (
  id uuid primary key default gen_random_uuid(),
  tabla_id uuid not null references public.bd_tablas(id) on delete cascade,
  datos jsonb not null default '{}'::jsonb,
  activo boolean not null default true
);
select app.estandarizar('public.bd_registros');
create index bd_registros_tabla_idx on public.bd_registros (tabla_id, activo);
select app.aplicar_rls('public.bd_registros', array['basedatos'], array['basedatos']);

create table public.bd_respaldos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  tipo text not null default 'manual',
  archivo text,
  nombre text,
  tamano bigint not null default 0,
  tablas text[] not null default '{}',
  filas integer not null default 0,
  sha256 text,
  verificado text not null default 'Pendiente' check (verificado in ('Pendiente', 'SI', 'NO')),
  estado text not null default 'Completo',
  por_nombre text,
  detalle text
);
select app.estandarizar('public.bd_respaldos');
drop policy if exists bd_respaldos_ver on public.bd_respaldos;
create policy bd_respaldos_ver on public.bd_respaldos for select to authenticated
  using (app.puede('basedatos', 'respaldar') or app.puede('basedatos', 'restaurar') or app.puede('basedatos', 'administrar'));

insert into storage.buckets (id, name, public, file_size_limit)
values ('respaldos', 'respaldos', false, 209715200)
on conflict (id) do nothing;
drop policy if exists respaldos_storage_ver on storage.objects;
create policy respaldos_storage_ver on storage.objects for select to authenticated
  using (bucket_id = 'respaldos' and (app.puede('basedatos', 'respaldar') or app.puede('basedatos', 'restaurar')));
drop policy if exists respaldos_storage_subir on storage.objects;
create policy respaldos_storage_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'respaldos' and app.puede('basedatos', 'respaldar'));
drop policy if exists respaldos_storage_borrar on storage.objects;
create policy respaldos_storage_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'respaldos' and app.puede('basedatos', 'administrar'));

-- 2) Utilidades ---------------------------------------------------------------------------------------
create or replace function app.bd_exigir(p_accion text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.puede('basedatos', p_accion) then
    raise exception 'No tienes el permiso "%" en Bases de Datos.', p_accion;
  end if;
end; $$;
revoke all on function app.bd_exigir(text) from public, anon, authenticated;

create or replace function app.bd_secreta(p_col text) returns boolean language sql immutable as $$
  select p_col ~* 'password|hash|token|contrase|clave|secret|api_?key|codigo_acceso|codigo_expira'
$$;

create or replace function app.bd_columnas(p_tabla text) returns text[] language sql stable security definer set search_path = public as $$
  select array_agg(c.column_name::text order by c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and c.table_name = p_tabla and t.table_type = 'BASE TABLE'
$$;
revoke all on function app.bd_columnas(text) from public, anon, authenticated;

-- 3) Panel --------------------------------------------------------------------------------------------
create or replace function public.bd_panel() returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sis jsonb; v_prop jsonb;
begin
  perform app.bd_exigir('ver');
  select coalesce(jsonb_agg(jsonb_build_object(
      'nombre', c.relname,
      'columnas', (select count(*) from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = c.relname),
      'filas', (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint
    ) order by c.relname), '[]'::jsonb)
  into v_sis
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r';
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'nombre', t.nombre, 'base', t.base, 'modulo', t.modulo, 'descripcion', t.descripcion, 'campos', t.campos,
      'filas', (select count(*) from public.bd_registros r where r.tabla_id = t.id and r.activo and r.deleted_at is null)
    ) order by t.nombre), '[]'::jsonb)
  into v_prop from public.bd_tablas t where t.deleted_at is null;
  return jsonb_build_object('tablas', v_sis, 'propias', v_prop, 'tamano', pg_database_size(current_database()), 'permisos', coalesce(app.permisos_actuales() -> 'basedatos', '[]'::jsonb), 'superadmin', app.es_superadmin());
end; $$;
revoke all on function public.bd_panel() from public, anon;
grant execute on function public.bd_panel() to authenticated;

-- 4) Consulta de tablas del sistema (solo lectura) ------------------------------------------------------
create or replace function public.bd_tabla(
  p_tabla text, p_q text default null, p_orden text default null, p_dir text default 'asc', p_col text default null, p_valor text default null,
  p_pagina int default 1, p_tam int default 50, p_exportar boolean default false, p_ids text[] default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cols text[]; v_sec text[]; v_where text := 'true'; v_ord text := '1'; v_tam int; v_total bigint; v_filas jsonb;
begin
  perform app.bd_exigir(case when p_exportar then 'exportar' else 'ver' end);
  v_cols := app.bd_columnas(p_tabla);
  if v_cols is null then raise exception 'No existe la tabla "%".', p_tabla; end if;
  select coalesce(array_agg(c), '{}') into v_sec from unnest(v_cols) c where app.bd_secreta(c);
  if nullif(btrim(p_q), '') is not null then v_where := v_where || format(' and to_jsonb(t)::text ilike %L', '%' || btrim(p_q) || '%'); end if;
  if coalesce(p_col, '') <> '' and coalesce(p_valor, '') <> '' then
    if not p_col = any(v_cols) then raise exception 'La columna no existe.'; end if;
    if p_col = any(v_sec) then raise exception 'Esa columna es confidencial.'; end if;
    v_where := v_where || format(' and lower(to_jsonb(t)->>%L) = lower(%L)', p_col, p_valor);
  end if;
  if p_ids is not null then v_where := v_where || format(' and (to_jsonb(t)->>''id'') = any(%L::text[])', p_ids); end if;
  if coalesce(p_orden, '') <> '' then
    if not p_orden = any(v_cols) or p_orden = any(v_sec) then raise exception 'No se puede ordenar por esa columna.'; end if;
    v_ord := format('case when (to_jsonb(t)->>%1$L) ~ ''^-?[0-9]+(\.[0-9]+)?$'' then (to_jsonb(t)->>%1$L)::numeric end %2$s nulls last, (to_jsonb(t)->>%1$L) %2$s nulls last',
                    p_orden, case when lower(p_dir) = 'desc' then 'desc' else 'asc' end);
  end if;
  v_tam := least(greatest(coalesce(p_tam, 50), 1), case when p_exportar then 5000 else 200 end);
  execute format('select count(*) from public.%I t where %s', p_tabla, v_where) into v_total;
  execute format($q$
    select coalesce(jsonb_agg(s.x), '[]'::jsonb) from (
      select jsonb_build_object('id', to_jsonb(t)->>'id',
        'v', (select jsonb_agg(case when u.c = any(%1$L::text[]) and to_jsonb(t)->u.c <> 'null'::jsonb then to_jsonb('••••••'::text) else to_jsonb(t)->u.c end order by u.o)
              from unnest(%2$L::text[]) with ordinality u(c, o))) as x
      from public.%3$I t where %4$s order by %5$s limit %6$s offset %7$s) s
  $q$, v_sec, v_cols, p_tabla, v_where, v_ord, v_tam, (greatest(coalesce(p_pagina, 1), 1) - 1) * v_tam) into v_filas;
  return jsonb_build_object('tabla', p_tabla, 'encabezados', to_jsonb(v_cols), 'secretas', to_jsonb(v_sec), 'filas', v_filas, 'total', v_total, 'pagina', greatest(coalesce(p_pagina, 1), 1), 'tam', v_tam);
end; $$;
revoke all on function public.bd_tabla(text, text, text, text, text, text, int, int, boolean, text[]) from public, anon;
grant execute on function public.bd_tabla(text, text, text, text, text, text, int, int, boolean, text[]) to authenticated;

create or replace function public.bd_duplicados(p_tabla text, p_columna text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cols text[] := app.bd_columnas(p_tabla); v_res jsonb; v_tot int;
begin
  perform app.bd_exigir('ver');
  if v_cols is null then raise exception 'No existe la tabla "%".', p_tabla; end if;
  if not p_columna = any(v_cols) then raise exception 'Elige una columna.'; end if;
  if app.bd_secreta(p_columna) then raise exception 'Esa columna es confidencial.'; end if;
  execute format($q$select coalesce(jsonb_agg(jsonb_build_object('valor', k, 'n', n, 'ids', ids)), '[]'::jsonb), count(*) from (
      select lower(btrim(to_jsonb(t)->>%1$L)) k, count(*) n, (array_agg(to_jsonb(t)->>'id'))[1:20] ids from public.%2$I t
      where nullif(btrim(to_jsonb(t)->>%1$L), '') is not null group by 1 having count(*) > 1 order by 2 desc limit 300) d$q$, p_columna, p_tabla) into v_res, v_tot;
  return jsonb_build_object('columna', p_columna, 'total', v_tot, 'grupos', v_res);
end; $$;
revoke all on function public.bd_duplicados(text, text) from public, anon;
grant execute on function public.bd_duplicados(text, text) to authenticated;

create or replace function public.bd_integridad(p_tabla text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cols text[] := app.bd_columnas(p_tabla); v_total bigint; v_borr bigint := 0; v_prob jsonb := '[]'::jsonb; v_x jsonb;
begin
  perform app.bd_exigir('ver');
  if v_cols is null then raise exception 'No existe la tabla "%".', p_tabla; end if;
  execute format('select count(*) from public.%I', p_tabla) into v_total;
  if 'deleted_at' = any(v_cols) then execute format('select count(*) from public.%I where deleted_at is not null', p_tabla) into v_borr; end if;
  if 'codigo' = any(v_cols) then
    execute format($q$select coalesce(jsonb_agg(jsonb_build_object('fila', f, 'problemas', jsonb_build_array(p))), '[]'::jsonb) from (
        select coalesce(to_jsonb(t)->>'id', '?') f, 'Código repetido "' || (to_jsonb(t)->>'codigo') || '"' p from public.%1$I t
        where nullif(btrim(to_jsonb(t)->>'codigo'), '') is not null and (to_jsonb(t)->>'codigo') in
          (select to_jsonb(u)->>'codigo' from public.%1$I u where nullif(btrim(to_jsonb(u)->>'codigo'), '') is not null group by 1 having count(*) > 1) limit 300) z$q$, p_tabla) into v_x;
    v_prob := v_prob || v_x;
  end if;
  return jsonb_build_object('tabla', p_tabla, 'revisadas', v_total, 'borradas', v_borr, 'problemas', v_prob, 'total', jsonb_array_length(v_prob),
    'regla', 'Postgres ya impide claves duplicadas, datos del tipo equivocado y relaciones rotas; aquí se revisan códigos repetidos.');
end; $$;
revoke all on function public.bd_integridad(text) from public, anon;
grant execute on function public.bd_integridad(text) to authenticated;

-- 5) Tablas propias ------------------------------------------------------------------------------------
create or replace function app.bd_limpiar_campos(p jsonb) returns jsonb language plpgsql as $$
declare c jsonb; n text; t text; x jsonb; nombres text[] := '{}'; out jsonb := '[]'::jsonb; ops jsonb;
begin
  for c in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    n := left(btrim(regexp_replace(coalesce(c->>'nombre', ''), '[<>=]', '', 'g')), 50);
    if n = '' or n ~ '^_' then raise exception 'Nombre de campo no válido: "%".', coalesce(c->>'nombre', ''); end if;
    if lower(n) = any(nombres) then raise exception 'Campo repetido: %', n; end if;
    nombres := nombres || lower(n);
    t := case when c->>'tipo' in ('texto', 'numero', 'fecha', 'booleano', 'correo', 'lista', 'relacion') then c->>'tipo' else 'texto' end;
    x := jsonb_build_object('nombre', n, 'tipo', t, 'obligatorio', coalesce((c->>'obligatorio')::boolean, false), 'unico', coalesce((c->>'unico')::boolean, false),
                            'defecto', left(coalesce(c->>'defecto', ''), 200), 'activo', coalesce((c->>'activo')::boolean, true));
    if t = 'lista' then
      if jsonb_typeof(c->'opciones') = 'array' then
        select coalesce(jsonb_agg(o), '[]'::jsonb) into ops from (select btrim(v) o from jsonb_array_elements_text(c->'opciones') v where btrim(v) <> '' limit 50) q;
      else
        select coalesce(jsonb_agg(o), '[]'::jsonb) into ops from (select btrim(v) o from unnest(string_to_array(coalesce(c->>'opciones', ''), ',')) v where btrim(v) <> '' limit 50) q;
      end if;
      x := x || jsonb_build_object('opciones', ops);
    end if;
    if t = 'relacion' then x := x || jsonb_build_object('relacion', jsonb_build_object('tabla', coalesce(c->'relacion'->>'tabla', ''), 'campo', coalesce(c->'relacion'->>'campo', ''))); end if;
    if t = 'numero' then
      if coalesce(c->>'min', '') <> '' then x := x || jsonb_build_object('min', (c->>'min')::numeric); end if;
      if coalesce(c->>'max', '') <> '' then x := x || jsonb_build_object('max', (c->>'max')::numeric); end if;
    end if;
    out := out || jsonb_build_array(x);
  end loop;
  return out;
end; $$;

create or replace function app.bd_validar(p_tabla uuid, p_datos jsonb, p_registro uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.bd_tablas; c jsonb; nom text; tipo text; v text; num numeric; errores text[] := '{}'; limpio jsonb := '{}'::jsonb;
  ops text[]; rt text; rc text; ok boolean; val jsonb;
begin
  select * into t from public.bd_tablas where id = p_tabla and deleted_at is null;
  if t.id is null then raise exception 'La tabla no existe.'; end if;
  for c in select * from jsonb_array_elements(t.campos) where coalesce((value->>'activo')::boolean, true) loop
    nom := c->>'nombre'; tipo := c->>'tipo';
    v := nullif(btrim(coalesce(p_datos->>nom, '')), '');
    if v is null and coalesce(c->>'defecto', '') <> '' and p_registro is null then v := c->>'defecto'; end if;
    if v is null then
      if coalesce((c->>'obligatorio')::boolean, false) then errores := errores || (nom || ' es obligatorio'); end if;
      limpio := limpio || jsonb_build_object(nom, null); continue;
    end if;
    val := to_jsonb(left(v, 5000));
    if tipo = 'numero' then
      v := replace(v, ',', '.');
      if v !~ '^-?[0-9]+(\.[0-9]+)?$' then errores := errores || (nom || ' debe ser un número');
      else
        num := v::numeric;
        if c ? 'min' and num < (c->>'min')::numeric then errores := errores || (nom || ' debe ser ≥ ' || (c->>'min')); end if;
        if c ? 'max' and num > (c->>'max')::numeric then errores := errores || (nom || ' debe ser ≤ ' || (c->>'max')); end if;
        val := to_jsonb(num);
      end if;
    elsif tipo = 'fecha' then
      begin perform v::timestamptz; exception when others then errores := errores || (nom || ' debe ser una fecha'); end;
    elsif tipo = 'booleano' then
      if lower(v) in ('si', 'sí', 'true', '1') then val := to_jsonb('SI'::text);
      elsif lower(v) in ('no', 'false', '0') then val := to_jsonb('NO'::text);
      else errores := errores || (nom || ' debe ser Sí o No'); end if;
    elsif tipo = 'correo' then
      if v !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then errores := errores || (nom || ' debe ser un correo válido'); end if;
    elsif tipo = 'lista' then
      select coalesce(array_agg(o), '{}') into ops from jsonb_array_elements_text(coalesce(c->'opciones', '[]'::jsonb)) o;
      if not v = any(ops) then errores := errores || (nom || ' debe ser una de: ' || array_to_string(ops, ', ')); end if;
    elsif tipo = 'relacion' and coalesce(c->'relacion'->>'tabla', '') <> '' then
      rt := c->'relacion'->>'tabla'; rc := nullif(c->'relacion'->>'campo', ''); ok := false;
      if exists (select 1 from public.bd_tablas b where b.nombre = rt and b.deleted_at is null) then
        select exists (select 1 from public.bd_registros r join public.bd_tablas b on b.id = r.tabla_id
          where b.nombre = rt and r.deleted_at is null and ((coalesce(rc, '_ID') in ('_ID', 'id') and r.id::text = v) or (rc is not null and rc not in ('_ID', 'id') and r.datos->>rc = v))) into ok;
      elsif app.bd_columnas(rt) is not null and coalesce(rc, 'id') = any(app.bd_columnas(rt)) then
        execute format('select exists (select 1 from public.%I t where to_jsonb(t)->>%L = %L)', rt, coalesce(rc, 'id'), v) into ok;
      else errores := errores || (nom || ': tabla relacionada no disponible'); ok := true; end if;
      if not ok then errores := errores || (nom || ': "' || v || '" no existe en ' || rt); end if;
    end if;
    if coalesce((c->>'unico')::boolean, false) and exists (
      select 1 from public.bd_registros r where r.tabla_id = p_tabla and r.deleted_at is null and r.activo and r.id is distinct from p_registro
        and lower(r.datos->>nom) = lower(v)) then errores := errores || (nom || ' "' || v || '" ya existe'); end if;
    limpio := limpio || jsonb_build_object(nom, val);
  end loop;
  return jsonb_build_object('errores', to_jsonb(errores), 'datos', limpio);
end; $$;
revoke all on function app.bd_validar(uuid, jsonb, uuid) from public, anon, authenticated;

create or replace function public.bd_crear_tabla(p_nombre text, p_base text, p_modulo text, p_descripcion text, p_campos jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_base text := left(regexp_replace(btrim(regexp_replace(coalesce(p_nombre, ''), '[^[:alnum:] _]', '', 'g')), '\s+', '_', 'g'), 40); v_campos jsonb; v_id uuid;
begin
  perform app.bd_exigir('crear');
  if v_base = '' then raise exception 'Escribe el nombre de la tabla.'; end if;
  if exists (select 1 from public.bd_tablas where nombre = 'BD_' || v_base and deleted_at is null) or app.bd_columnas('BD_' || v_base) is not null then raise exception 'Ya existe una tabla con ese nombre.'; end if;
  v_campos := app.bd_limpiar_campos(p_campos);
  if jsonb_array_length(v_campos) = 0 then raise exception 'Agrega al menos un campo.'; end if;
  insert into public.bd_tablas (nombre, base, modulo, descripcion, campos, creado_por)
  values ('BD_' || v_base, left(coalesce(nullif(p_base, ''), 'General'), 40), left(coalesce(nullif(p_modulo, ''), 'Tablas propias'), 40), left(regexp_replace(coalesce(p_descripcion, ''), '[<>]', '', 'g'), 300), v_campos, app.empleado_id())
  returning id into v_id;
  perform app.auditar('basedatos', 'Tabla creada', 'BD_' || v_base, 'OK', (select string_agg(x->>'nombre' || ':' || (x->>'tipo'), ', ') from jsonb_array_elements(v_campos) x));
  return v_id;
end; $$;
revoke all on function public.bd_crear_tabla(text, text, text, text, jsonb) from public, anon;
grant execute on function public.bd_crear_tabla(text, text, text, text, jsonb) to authenticated;

-- Agrega campos o cambia reglas; un campo que se quita queda desactivado (sus datos se conservan).
create or replace function public.bd_editar_esquema(p_tabla uuid, p_campos jsonb) returns void language plpgsql security definer set search_path = public as $$
declare t public.bd_tablas; nuevos jsonb := app.bd_limpiar_campos(p_campos); viejo jsonb;
begin
  perform app.bd_exigir('editar');
  select * into t from public.bd_tablas where id = p_tabla and deleted_at is null;
  if t.id is null then raise exception 'La tabla no existe.'; end if;
  for viejo in select * from jsonb_array_elements(t.campos) loop
    if not exists (select 1 from jsonb_array_elements(nuevos) n where n->>'nombre' = viejo->>'nombre') then
      nuevos := nuevos || jsonb_build_array(viejo || '{"activo": false}'::jsonb);
    end if;
  end loop;
  update public.bd_tablas set campos = nuevos where id = p_tabla;
  perform app.auditar('basedatos', 'Esquema modificado', t.nombre, 'OK', null);
end; $$;
revoke all on function public.bd_editar_esquema(uuid, jsonb) from public, anon;
grant execute on function public.bd_editar_esquema(uuid, jsonb) to authenticated;

create or replace function public.bd_guardar_registro(p_tabla uuid, p_registro uuid, p_datos jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare r jsonb; v_id uuid := p_registro; v_nombre text;
begin
  perform app.bd_exigir(case when p_registro is null then 'crear' else 'editar' end);
  select nombre into v_nombre from public.bd_tablas where id = p_tabla and deleted_at is null;
  if v_nombre is null then raise exception 'La tabla no existe.'; end if;
  if p_registro is not null and not exists (select 1 from public.bd_registros where id = p_registro and tabla_id = p_tabla and deleted_at is null) then raise exception 'El registro ya no existe.'; end if;
  r := app.bd_validar(p_tabla, coalesce(p_datos, '{}'::jsonb), p_registro);
  if jsonb_array_length(r->'errores') > 0 then
    raise exception 'Revisa los datos: %.', (select string_agg(e, '; ') from jsonb_array_elements_text(r->'errores') e);
  end if;
  if p_registro is null then
    insert into public.bd_registros (tabla_id, datos, creado_por) values (p_tabla, r->'datos', app.empleado_id()) returning id into v_id;
  else
    update public.bd_registros set datos = r->'datos' where id = p_registro;
  end if;
  perform app.auditar('basedatos', case when p_registro is null then 'Registro creado' else 'Registro editado' end, v_nombre || ' · ' || v_id::text);
  return v_id;
end; $$;
revoke all on function public.bd_guardar_registro(uuid, uuid, jsonb) from public, anon;
grant execute on function public.bd_guardar_registro(uuid, uuid, jsonb) to authenticated;

create or replace function public.bd_desactivar_registro(p_registro uuid, p_activo boolean) returns void language plpgsql security definer set search_path = public as $$
declare v_nombre text;
begin
  perform app.bd_exigir('eliminar');
  select b.nombre into v_nombre from public.bd_registros r join public.bd_tablas b on b.id = r.tabla_id where r.id = p_registro and r.deleted_at is null;
  if v_nombre is null then raise exception 'El registro ya no existe.'; end if;
  update public.bd_registros set activo = p_activo where id = p_registro;
  perform app.auditar('basedatos', case when p_activo then 'Registro reactivado' else 'Registro desactivado' end, v_nombre || ' · ' || p_registro::text);
end; $$;
revoke all on function public.bd_desactivar_registro(uuid, boolean) from public, anon;
grant execute on function public.bd_desactivar_registro(uuid, boolean) to authenticated;

-- Importación todo o nada: p_filas = arreglo de objetos {campo: valor}.
create or replace function public.bd_importar(p_tabla uuid, p_filas jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare f jsonb; i int := 0; r jsonb; errs text[] := '{}'; ok jsonb := '[]'::jsonb; v_nombre text;
begin
  perform app.bd_exigir('crear');
  select nombre into v_nombre from public.bd_tablas where id = p_tabla and deleted_at is null;
  if v_nombre is null then raise exception 'La tabla no existe.'; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'El archivo no tiene filas de datos.'; end if;
  if jsonb_array_length(p_filas) > 5000 then raise exception 'Máximo 5.000 filas por importación.'; end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    i := i + 1;
    r := app.bd_validar(p_tabla, f, null);
    if jsonb_array_length(r->'errores') > 0 then
      errs := errs || ('Fila ' || (i + 1) || ': ' || (select string_agg(e, '; ') from jsonb_array_elements_text(r->'errores') e));
    else
      -- los únicos también se comparan contra las filas ya aceptadas de este mismo archivo
      ok := ok || jsonb_build_array(r->'datos');
    end if;
  end loop;
  if cardinality(errs) = 0 then
    -- duplicados dentro del archivo para campos únicos
    select array_agg('Campo único "' || u.nom || '": valor repetido en el archivo "' || u.val || '"') into errs from (
      select c->>'nombre' nom, lower(d->>(c->>'nombre')) val
      from jsonb_array_elements(ok) d, public.bd_tablas t, jsonb_array_elements(t.campos) c
      where t.id = p_tabla and coalesce((c->>'unico')::boolean, false) and coalesce((c->>'activo')::boolean, true) and nullif(d->>(c->>'nombre'), '') is not null
      group by 1, 2 having count(*) > 1) u;
  end if;
  if errs is not null and cardinality(errs) > 0 then
    return jsonb_build_object('success', false, 'errores', to_jsonb(errs[1:50]), 'totalErrores', cardinality(errs));
  end if;
  insert into public.bd_registros (tabla_id, datos, creado_por) select p_tabla, d, app.empleado_id() from jsonb_array_elements(ok) d;
  perform app.auditar('basedatos', 'Importación CSV', v_nombre, 'OK', jsonb_array_length(ok) || ' filas');
  return jsonb_build_object('success', true, 'importadas', jsonb_array_length(ok));
end; $$;
revoke all on function public.bd_importar(uuid, jsonb) from public, anon;
grant execute on function public.bd_importar(uuid, jsonb) to authenticated;

-- Consulta de registros de una tabla propia (misma forma que bd_tabla).
create or replace function public.bd_registros(
  p_tabla uuid, p_q text default null, p_orden text default null, p_dir text default 'asc', p_col text default null, p_valor text default null,
  p_pagina int default 1, p_tam int default 50, p_inactivos boolean default false, p_exportar boolean default false, p_ids text[] default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.bd_tablas; v_cols text[]; v_tam int; v_total bigint; v_filas jsonb; v_where text; v_ord text := 'r.created_at';
begin
  perform app.bd_exigir(case when p_exportar then 'exportar' else 'ver' end);
  select * into t from public.bd_tablas where id = p_tabla and deleted_at is null;
  if t.id is null then raise exception 'La tabla no existe.'; end if;
  select coalesce(array_agg(c->>'nombre' order by o), '{}') into v_cols from jsonb_array_elements(t.campos) with ordinality x(c, o) where coalesce((c->>'activo')::boolean, true);
  v_where := format('r.tabla_id = %L and r.deleted_at is null', p_tabla);
  if not coalesce(p_inactivos, false) then v_where := v_where || ' and r.activo'; end if;
  if nullif(btrim(p_q), '') is not null then v_where := v_where || format(' and r.datos::text ilike %L', '%' || btrim(p_q) || '%'); end if;
  if coalesce(p_col, '') <> '' and coalesce(p_valor, '') <> '' then
    if not p_col = any(v_cols) then raise exception 'La columna no existe.'; end if;
    v_where := v_where || format(' and lower(r.datos->>%L) = lower(%L)', p_col, p_valor);
  end if;
  if p_ids is not null then v_where := v_where || format(' and r.id::text = any(%L::text[])', p_ids); end if;
  if coalesce(p_orden, '') <> '' and p_orden = any(v_cols) then
    v_ord := format('case when (r.datos->>%1$L) ~ ''^-?[0-9]+(\.[0-9]+)?$'' then (r.datos->>%1$L)::numeric end %2$s nulls last, (r.datos->>%1$L) %2$s nulls last',
                    p_orden, case when lower(p_dir) = 'desc' then 'desc' else 'asc' end);
  end if;
  v_tam := least(greatest(coalesce(p_tam, 50), 1), case when p_exportar then 5000 else 200 end);
  execute format('select count(*) from public.bd_registros r where %s', v_where) into v_total;
  execute format($q$
    select coalesce(jsonb_agg(s.x), '[]'::jsonb) from (
      select jsonb_build_object('id', r.id, 'activo', r.activo,
        'v', (select coalesce(jsonb_agg(coalesce(r.datos->u.c, 'null'::jsonb) order by u.o), '[]'::jsonb) from unnest(%1$L::text[]) with ordinality u(c, o))
             || jsonb_build_array(r.activo, r.created_at, r.updated_at)) as x
      from public.bd_registros r where %2$s order by %3$s limit %4$s offset %5$s) s
  $q$, v_cols, v_where, v_ord, v_tam, (greatest(coalesce(p_pagina, 1), 1) - 1) * v_tam) into v_filas;
  return jsonb_build_object('tabla', t.nombre, 'encabezados', to_jsonb(v_cols) || '["_activo","_creado","_actualizado"]'::jsonb, 'secretas', '[]'::jsonb,
    'filas', v_filas, 'total', v_total, 'pagina', greatest(coalesce(p_pagina, 1), 1), 'tam', v_tam, 'esquema', t.campos);
end; $$;
revoke all on function public.bd_registros(uuid, text, text, text, text, text, int, int, boolean, boolean, text[]) from public, anon;
grant execute on function public.bd_registros(uuid, text, text, text, text, text, int, int, boolean, boolean, text[]) to authenticated;

-- 6) Respaldos -----------------------------------------------------------------------------------------
create or replace function public.bd_registrar_respaldo(p_codigo text, p_tipo text, p_archivo text, p_nombre text, p_tamano bigint, p_tablas text[], p_filas int, p_sha text, p_verificado text, p_detalle text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform app.bd_exigir('respaldar');
  insert into public.bd_respaldos (codigo, tipo, archivo, nombre, tamano, tablas, filas, sha256, verificado, por_nombre, detalle, creado_por)
  values (p_codigo, p_tipo, p_archivo, p_nombre, p_tamano, p_tablas, p_filas, p_sha, case when p_verificado in ('SI', 'NO') then p_verificado else 'Pendiente' end,
          (select nombre from public.empleados where id = app.empleado_id()), left(p_detalle, 500), app.empleado_id())
  returning id into v_id;
  perform app.auditar('basedatos', 'Respaldo ' || p_tipo, p_codigo, case when p_verificado = 'NO' then 'Error' else 'OK' end, coalesce(array_length(p_tablas, 1), 0) || ' tablas · ' || p_filas || ' filas');
  return v_id;
end; $$;
revoke all on function public.bd_registrar_respaldo(text, text, text, text, bigint, text[], int, text, text, text) from public, anon;
grant execute on function public.bd_registrar_respaldo(text, text, text, text, bigint, text[], int, text, text, text) to authenticated;

create or replace function public.bd_marcar_verificado(p_id uuid, p_ok boolean, p_detalle text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (app.puede('basedatos', 'respaldar') or app.puede('basedatos', 'restaurar')) then raise exception 'No tienes permiso para verificar respaldos.'; end if;
  update public.bd_respaldos set verificado = case when p_ok then 'SI' else 'NO' end, detalle = coalesce(left(p_detalle, 500), detalle) where id = p_id;
  perform app.auditar('basedatos', 'Verificación de respaldo', p_id::text, case when p_ok then 'OK' else 'Error' end, p_detalle);
end; $$;
revoke all on function public.bd_marcar_verificado(uuid, boolean, text) from public, anon;
grant execute on function public.bd_marcar_verificado(uuid, boolean, text) to authenticated;

-- Restaura SOLO tablas propias (BD_…): reemplaza su definición y sus registros por los del respaldo.
-- p_tablas = [{nombre, base, modulo, descripcion, campos, registros:[{id, datos, activo}]}]. Solo Superadministrador.
create or replace function public.bd_restaurar_propias(p_tablas jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare x jsonb; r jsonb; v_id uuid; n int := 0; filas int := 0;
begin
  perform app.bd_exigir('restaurar');
  if not app.es_superadmin() then raise exception 'Solo un Superadministrador restaura sobre los datos actuales.'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_tablas, '[]'::jsonb)) loop
    if coalesce(x->>'nombre', '') !~ '^BD_' then continue; end if;
    select id into v_id from public.bd_tablas where nombre = x->>'nombre';
    if v_id is null then
      insert into public.bd_tablas (nombre, base, modulo, descripcion, campos, creado_por)
      values (x->>'nombre', coalesce(x->>'base', 'General'), coalesce(x->>'modulo', 'Tablas propias'), x->>'descripcion', app.bd_limpiar_campos(x->'campos'), app.empleado_id()) returning id into v_id;
    else
      update public.bd_tablas set base = coalesce(x->>'base', base), modulo = coalesce(x->>'modulo', modulo), descripcion = x->>'descripcion', campos = app.bd_limpiar_campos(x->'campos'), deleted_at = null where id = v_id;
    end if;
    update public.bd_registros set deleted_at = now()
     where tabla_id = v_id and deleted_at is null and id::text not in (select y->>'id' from jsonb_array_elements(coalesce(x->'registros', '[]'::jsonb)) y);
    for r in select * from jsonb_array_elements(coalesce(x->'registros', '[]'::jsonb)) loop
      insert into public.bd_registros (id, tabla_id, datos, activo, creado_por)
      values ((r->>'id')::uuid, v_id, coalesce(r->'datos', '{}'::jsonb), coalesce((r->>'activo')::boolean, true), app.empleado_id())
      on conflict (id) do update set datos = excluded.datos, activo = excluded.activo, deleted_at = null, tabla_id = excluded.tabla_id;
      filas := filas + 1;
    end loop;
    n := n + 1;
  end loop;
  perform app.auditar('basedatos', 'Restauración de tablas propias', null, 'OK', n || ' tablas · ' || filas || ' registros');
  return jsonb_build_object('tablas', n, 'registros', filas);
end; $$;
revoke all on function public.bd_restaurar_propias(jsonb) from public, anon;
grant execute on function public.bd_restaurar_propias(jsonb) to authenticated;

-- 7) Permisos del módulo en los roles de sistema ------------------------------------------------------------
update public.roles set permisos = permisos || '{"basedatos":["ver","exportar"]}'::jsonb where nombre = 'Auditor' and not (permisos ? 'basedatos');
update public.roles set permisos = permisos || '{"basedatos":["ver","crear","editar","eliminar","exportar","respaldar","administrar"]}'::jsonb where nombre = 'Administrador del sistema' and not (permisos ? 'basedatos');
