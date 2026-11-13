-- Inventario: permisos especiales del empleado, multimedia del producto y galería
-- (Auth accesos.gs: preciosFemedics / inventarioMultimedia; Productos inventario.gs:
-- getProductoRawMultimedia, actualizarMultimediaProducto; Galeria.gs: guardarGaleriaProducto).

-- 1) Permisos especiales (Empleados › "permisosFlags").
create or replace function app.tiene_bandera(p_bandera text)
returns boolean language sql stable security definer set search_path = public, app as $$
  select coalesce(lower(e.preferencias -> 'permisosFlags' ->> p_bandera) in ('true', 'si', 'sí', '1'), false)
    from public.empleados e where e.id = app.empleado_id()
$$;

-- Lo que la pantalla necesita saber de quien la usa.
--  · preciosFemedics: ve y cotiza el PVP +11,11 % (PVP / 0,90). Siempre si su empresa es FEMEDICS.
--  · multimedia: puede cambiar imagen, ficha, carpeta y galería aunque no edite el resto del producto.
create or replace function public.mis_banderas()
returns jsonb language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'flags', coalesce(e.preferencias -> 'permisosFlags', '{}'::jsonb),
    'empresa', e.empresa,
    'ambas', coalesce((e.preferencias ->> 'ambasEmpresas')::boolean, false),
    'preciosFemedics', app.tiene_bandera('preciosFemedics') or e.empresa = 'FEMEDICS',
    'multimedia', app.es_superadmin() or app.puede('inventario', 'editar') or app.puede('marketing', 'editar') or app.tiene_bandera('inventarioMultimedia'))
  from public.empleados e where e.id = app.empleado_id()
$$;

create or replace function app.puede_multimedia()
returns boolean language sql stable security definer set search_path = public, app as $$
  select app.es_superadmin() or app.puede('inventario', 'editar') or app.puede('marketing', 'editar')
      or (app.puede('inventario', 'ver') and app.tiene_bandera('inventarioMultimedia'))
$$;

-- Quien tiene "Editar Multimedia" también puede subir imágenes y videos del catálogo.
drop policy if exists catalogo_subir on storage.objects;
create policy catalogo_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'catalogo' and (app.puede('marketing', 'crear') or app.puede('marketing', 'editar') or app.puede('inventario', 'editar') or app.puede_multimedia()));

-- 2) Imagen principal, ficha técnica y carpeta de multimedia (actualizarMultimediaProducto).
--    Solo cambia lo que viene en p_datos; deja constancia para que Marketing lo revise.
create or replace function public.inv_guardar_multimedia(p_producto uuid, p_datos jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  p record;
  v_emp uuid := app.empleado_id();
  v_coord boolean := coalesce((public.marketing_mi_rol() ->> 'coord')::boolean, false);
  v_campo text; v_col text; v_ant text; v_nuevo text;
begin
  if not app.puede_multimedia() then raise exception 'No tienes permiso para editar la multimedia del producto.'; end if;
  select id, codigo, nombre, imagen_url, ficha_tecnica_url, drive_carpeta_url into p from public.productos where id = p_producto and deleted_at is null;
  if p.id is null then raise exception 'No se encontró el producto.'; end if;
  foreach v_campo in array array['imagen', 'ficha', 'album'] loop
    if not (p_datos ? v_campo) then continue; end if;
    v_nuevo := nullif(btrim(coalesce(p_datos ->> v_campo, '')), '');
    if v_nuevo is not null and v_nuevo !~* '^https://\S+$' then raise exception 'El enlace de % no es válido (debe empezar con https://).', v_campo; end if;
    v_col := case v_campo when 'imagen' then 'imagen_url' when 'ficha' then 'ficha_tecnica_url' else 'drive_carpeta_url' end;
    v_ant := case v_campo when 'imagen' then p.imagen_url when 'ficha' then p.ficha_tecnica_url else p.drive_carpeta_url end;
    if v_ant is not distinct from v_nuevo then continue; end if;
    execute format('update public.productos set %I = $1 where id = $2', v_col) using v_nuevo, p_producto;
    insert into public.marketing_cambios (codigo, fecha, producto_id, producto_texto, campo, nivel, valor_anterior, valor_nuevo, estado, autor_id, autor_rol, revisado_por, fecha_revision, correcciones)
    values (app.mkt_codigo(), now(), p_producto, p.codigo || ' · ' || p.nombre, v_campo, 'Directo', v_ant, v_nuevo, 'Aplicado', v_emp, 'Inventario',
            case when v_coord then v_emp end, case when v_coord then now() end, 0);
  end loop;
end;
$$;

-- 3) Galería del producto: la lista queda tal cual se envía, en ese orden (guardarGaleriaProducto).
--    items = [{id?, tipo: 'imagen'|'video', archivo_url, descripcion?, tipo_video?}] (máx. 30).
create or replace function public.inv_galeria_guardar(p_producto uuid, p_items jsonb)
returns integer language plpgsql security definer set search_path = public, app as $$
declare
  p record;
  v_emp uuid := app.empleado_id();
  v_coord boolean := coalesce((public.marketing_mi_rol() ->> 'coord')::boolean, false);
  v_antes jsonb; v_despues jsonb; it jsonb; i int := 0; v_id uuid; v_ids uuid[] := '{}';
begin
  if not app.puede_multimedia() then raise exception 'No tienes permiso para editar la galería.'; end if;
  select id, codigo, nombre into p from public.productos where id = p_producto and deleted_at is null;
  if p.id is null then raise exception 'No se encontró el producto.'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Galería no válida.'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'La galería admite hasta 30 elementos.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('archivo', archivo_url, 'tipo', tipo, 'tipoVideo', coalesce(tipo_video, ''), 'texto', coalesce(descripcion, '')) order by orden), '[]')
    into v_antes from public.producto_galeria where producto_id = p_producto and deleted_at is null;
  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(it ->> 'archivo_url', '') !~* '^https://\S+$' then raise exception 'El elemento % no tiene un enlace https:// válido.', i + 1; end if;
    v_id := nullif(it ->> 'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.producto_galeria where id = v_id and producto_id = p_producto and deleted_at is null) then
      update public.producto_galeria set orden = i, tipo = case when it ->> 'tipo' = 'video' then 'video' else 'imagen' end, archivo_url = it ->> 'archivo_url',
             descripcion = nullif(left(btrim(coalesce(it ->> 'descripcion', '')), 200), ''), tipo_video = case when it ->> 'tipo' = 'video' then nullif(it ->> 'tipo_video', '') end
       where id = v_id;
    else
      v_id := gen_random_uuid();
      insert into public.producto_galeria (id, producto_id, orden, tipo, archivo_url, descripcion, tipo_video)
      values (v_id, p_producto, i, case when it ->> 'tipo' = 'video' then 'video' else 'imagen' end, it ->> 'archivo_url',
              nullif(left(btrim(coalesce(it ->> 'descripcion', '')), 200), ''), case when it ->> 'tipo' = 'video' then nullif(it ->> 'tipo_video', '') end);
    end if;
    v_ids := v_ids || v_id; i := i + 1;
  end loop;
  update public.producto_galeria set deleted_at = now() where producto_id = p_producto and deleted_at is null and not (id = any(v_ids));
  select coalesce(jsonb_agg(jsonb_build_object('archivo', archivo_url, 'tipo', tipo, 'tipoVideo', coalesce(tipo_video, ''), 'texto', coalesce(descripcion, '')) order by orden), '[]')
    into v_despues from public.producto_galeria where producto_id = p_producto and deleted_at is null;
  if v_antes is distinct from v_despues then
    insert into public.marketing_cambios (codigo, fecha, producto_id, producto_texto, campo, nivel, valor_anterior, valor_nuevo, estado, autor_id, autor_rol, revisado_por, fecha_revision, correcciones)
    values (app.mkt_codigo(), now(), p_producto, p.codigo || ' · ' || p.nombre, 'galeria', 'Directo', v_antes::text, v_despues::text, 'Aplicado', v_emp, 'Inventario',
            case when v_coord then v_emp end, case when v_coord then now() end, 0);
  end if;
  return i;
end;
$$;

revoke all on function public.mis_banderas(), public.inv_guardar_multimedia(uuid, jsonb), public.inv_galeria_guardar(uuid, jsonb) from public, anon;
grant execute on function public.mis_banderas(), public.inv_guardar_multimedia(uuid, jsonb), public.inv_galeria_guardar(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
