-- Marketing › Revisión del equipo (MarketingFlujo.gs + InformesDesempeno.gs del original).
--
-- Reglas del original (mkfCambiar_):
--  * Coordinación (o quien tiene "Publicación directa") cambia directo; queda como "Aplicado".
--  * Imagen principal, galería, álbum y etiqueta "Nuevo" salen directo para todos y Coordinación los
--    revisa después ("Aplicados"); las correcciones pequeñas de descripción/características también.
--  * Lo demás (nombre, categoría, marca, modelo, especificaciones, visible al público…) espera la
--    aprobación. Si Coordinación lo devuelve ("Con cambios"), al corregirlo se reenvía el mismo pedido.

-- ---------------------------------------------------------------- utilidades
-- Conversiones que no fallan con datos mal formados (vienen de la hoja de cálculo).
create or replace function app.jsonb_seguro(t text)
returns jsonb language plpgsql immutable as $$
begin
  if t is null or btrim(t) = '' then return null; end if;
  return t::jsonb;
exception when others then return null;
end;
$$;
create or replace function app.lista_jsonb(t text)
returns jsonb language sql immutable as $$
  select case when jsonb_typeof(app.jsonb_seguro(t)) = 'array' then app.jsonb_seguro(t) else '[]'::jsonb end
$$;
create or replace function app.num_seguro(t text)
returns numeric language plpgsql immutable as $$
begin
  return coalesce(nullif(btrim(coalesce(t, '')), '')::numeric, 0);
exception when others then return 0;
end;
$$;

create or replace function app.mkt_codigo()
returns text language sql volatile as $$
  select 'MKC-' || to_char(now() at time zone 'America/Guayaquil', 'YYMMDDHH24MISS') || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4)
$$;

create or replace function app.mkt_cambio_menor(a text, b text)
returns boolean language plpgsql immutable as $$
declare
  la int := length(coalesce(a, '')); lb int := length(coalesce(b, ''));
  n int; i int := 0; j int := 0; cambio int;
begin
  if btrim(coalesce(a, '')) = '' or btrim(coalesce(b, '')) = '' then return false; end if;
  n := least(la, lb);
  while i < n and substr(a, i + 1, 1) = substr(b, i + 1, 1) loop i := i + 1; end loop;
  while j < n - i and substr(a, la - j, 1) = substr(b, lb - j, 1) loop j := j + 1; end loop;
  cambio := greatest(la, lb) - i - j;
  return cambio <= 12 and cambio <= greatest(3, la * 0.1);
end;
$$;

-- Equipo de Marketing: quien tiene rol de Marketing o el módulo en sus permisos.
create or replace function app.mkt_equipo()
returns table (empleado_id uuid, nombre text, email text, rol text, directa boolean)
language sql stable security definer set search_path = public, app as $$
  select e.id, e.nombre, e.email,
         case when e.preferencias -> 'marketing' ->> 'rol' = 'Coordinación'
                or coalesce(r.permisos -> 'marketing', '[]'::jsonb) ? 'aprobar'
                or coalesce(e.permisos_extra -> 'marketing', '[]'::jsonb) ? 'aprobar' then 'Coordinación'
              when e.preferencias -> 'marketing' ->> 'rol' in ('Asistente', 'Audiovisual') then e.preferencias -> 'marketing' ->> 'rol'
              else 'Asistente' end,
         lower(coalesce(e.preferencias -> 'marketing' ->> 'directa', '')) in ('true', 'si', 'sí', '1')
    from public.empleados e
    left join public.roles r on r.id = e.rol_id
   where e.deleted_at is null and e.estado = 'activo'
     and (coalesce(e.preferencias -> 'marketing' ->> 'rol', '') <> ''
          or coalesce(r.permisos, '{}'::jsonb) ? 'marketing'
          or coalesce(e.permisos_extra, '{}'::jsonb) ? 'marketing')
$$;

-- Valor publicado de un campo del producto.
create or replace function app.mkt_valor_campo(p_producto uuid, p_campo text)
returns text language sql stable security definer set search_path = public, app as $$
  select case p_campo
           when 'nombre' then p.nombre when 'categoria' then c.nombre when 'marca' then p.marca when 'modelo' then p.codigo_unico
           when 'descripcion' then p.descripcion when 'caracteristicas' then p.caracteristicas when 'especificaciones' then p.especificaciones
           when 'destacados' then p.destacados when 'accesorios' then p.accesorios when 'certificaciones' then p.certificaciones
           when 'garantia' then p.garantia
           when 'publico' then case when p.en_catalogo then 'SI' else 'NO' end
           when 'nuevo' then case when p.sin_etiqueta_nuevo then 'SI' else 'NO' end
           when 'imagen' then p.imagen_url when 'imagen_url' then p.imagen_url
           when 'album' then p.drive_carpeta_url when 'ficha' then p.ficha_tecnica_url
         end
    from public.productos p left join public.categorias c on c.id = p.categoria_id
   where p.id = p_producto
$$;

-- Aplica un valor al producto (mkfAplicar_). La galería se maneja en la Biblioteca.
create or replace function app.mkt_aplicar_campo(p_producto uuid, p_campo text, p_valor text)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  v text := nullif(btrim(coalesce(p_valor, '')), '');
  v_cat uuid;
begin
  if p_campo = 'categoria' then
    if v is not null then
      select id into v_cat from public.categorias where lower(nombre) = lower(v) and deleted_at is null order by created_at limit 1;
      if v_cat is null then insert into public.categorias (nombre) values (v) returning id into v_cat; end if;
    end if;
    update public.productos set categoria_id = v_cat where id = p_producto;
  elsif p_campo = 'nombre' then
    if v is null then raise exception 'El nombre no puede quedar vacío.'; end if;
    update public.productos set nombre = v where id = p_producto;
  elsif p_campo = 'marca' then update public.productos set marca = v where id = p_producto;
  elsif p_campo = 'modelo' then update public.productos set codigo_unico = v where id = p_producto;
  elsif p_campo = 'descripcion' then update public.productos set descripcion = v where id = p_producto;
  elsif p_campo = 'caracteristicas' then update public.productos set caracteristicas = v where id = p_producto;
  elsif p_campo = 'especificaciones' then update public.productos set especificaciones = v where id = p_producto;
  elsif p_campo = 'destacados' then update public.productos set destacados = v where id = p_producto;
  elsif p_campo = 'accesorios' then update public.productos set accesorios = v where id = p_producto;
  elsif p_campo = 'certificaciones' then update public.productos set certificaciones = v where id = p_producto;
  elsif p_campo = 'garantia' then update public.productos set garantia = v where id = p_producto;
  elsif p_campo = 'publico' then update public.productos set en_catalogo = (v = 'SI') where id = p_producto;
  elsif p_campo = 'nuevo' then update public.productos set sin_etiqueta_nuevo = (v = 'SI') where id = p_producto;
  elsif p_campo in ('imagen', 'imagen_url') then update public.productos set imagen_url = v where id = p_producto;
  elsif p_campo = 'album' then update public.productos set drive_carpeta_url = v where id = p_producto;
  elsif p_campo = 'ficha' then update public.productos set ficha_tecnica_url = v where id = p_producto;
  else raise exception 'Este cambio se corrige desde la Biblioteca (%).', p_campo;
  end if;
end;
$$;

-- ---------------------------------------------------------------- proponer o aplicar (mkfCambiar_)
create or replace function public.mkt_cambiar_campo(p_producto uuid, p_campo text, p_valor text)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  y jsonb := public.marketing_mi_rol();
  v_req boolean := coalesce((y ->> 'requiere')::boolean, true);
  v_coord boolean := coalesce((y ->> 'coord')::boolean, false);
  v_emp uuid := nullif(y ->> 'empleado_id', '')::uuid;
  v_nuevo text := btrim(coalesce(p_valor, ''));
  v_ant text; v_prod text; v_nivel text; v_id uuid; v_directo boolean;
  ab public.marketing_cambios%rowtype;
begin
  if not (app.puede('marketing', 'crear') or app.puede('marketing', 'editar')) then raise exception 'No tienes permiso para editar productos en Marketing.'; end if;
  if p_campo not in ('nombre', 'categoria', 'marca', 'modelo', 'descripcion', 'caracteristicas', 'especificaciones', 'destacados', 'accesorios',
                     'certificaciones', 'garantia', 'publico', 'nuevo', 'imagen', 'imagen_url', 'album', 'ficha') then
    raise exception 'Campo no válido.';
  end if;
  select codigo || ' · ' || nombre into v_prod from public.productos where id = p_producto and deleted_at is null;
  if v_prod is null then raise exception 'No se encontró el producto.'; end if;
  v_ant := btrim(coalesce(app.mkt_valor_campo(p_producto, p_campo), ''));
  select * into ab from public.marketing_cambios
   where producto_id = p_producto and campo = p_campo and estado in ('Pendiente', 'Con cambios') and deleted_at is null
   order by fecha desc limit 1;

  if v_nuevo = v_ant then
    if ab.id is not null then update public.marketing_cambios set estado = 'Retirado', comentario = 'Volvió al valor publicado.' where id = ab.id; end if;
    return jsonb_build_object('sinCambios', true);
  end if;

  v_directo := not v_req or p_campo in ('nuevo', 'imagen', 'imagen_url', 'album')
            or (p_campo in ('descripcion', 'caracteristicas') and ab.id is null and app.mkt_cambio_menor(v_ant, v_nuevo));
  if v_directo then
    if ab.id is not null then
      update public.marketing_cambios set estado = 'Reemplazado', comentario = 'Lo cambió ' || coalesce(y ->> 'nombre', 'Coordinación') || ' directamente.' where id = ab.id;
    end if;
    perform app.mkt_aplicar_campo(p_producto, p_campo, v_nuevo);
    v_nivel := case when p_campo in ('nuevo', 'imagen', 'imagen_url', 'album') then 'Directo' when v_req then 'Corrección menor'
                    when v_coord then 'Coordinación' else 'Publicación directa' end;
    insert into public.marketing_cambios (codigo, fecha, producto_id, producto_texto, campo, nivel, valor_anterior, valor_nuevo, estado,
                                          autor_id, autor_rol, revisado_por, fecha_revision, correcciones)
    values (app.mkt_codigo(), now(), p_producto, v_prod, p_campo, v_nivel, v_ant, v_nuevo, 'Aplicado',
            v_emp, y ->> 'rol', case when v_coord then v_emp end, case when v_coord then now() end, 0);
    return jsonb_build_object('aplicado', true, 'nivel', v_nivel);
  end if;

  if ab.id is not null then
    update public.marketing_cambios
       set valor_nuevo = v_nuevo, estado = 'Pendiente', autor_id = v_emp, autor_rol = y ->> 'rol',
           correcciones = correcciones + case when ab.estado = 'Con cambios' then 1 else 0 end,
           horas_correccion = case when ab.estado = 'Con cambios' and ab.fecha_devolucion is not null
                                   then round(coalesce(ab.horas_correccion, 0) + extract(epoch from now() - ab.fecha_devolucion) / 3600.0, 2)
                                   else horas_correccion end
     where id = ab.id;
    return jsonb_build_object('pendiente', true, 'id', ab.id, 'reenviado', ab.estado = 'Con cambios');
  end if;
  insert into public.marketing_cambios (codigo, fecha, producto_id, producto_texto, campo, nivel, valor_anterior, valor_nuevo, estado, autor_id, autor_rol, correcciones)
  values (app.mkt_codigo(), now(), p_producto, v_prod, p_campo, 'Revisión', v_ant, v_nuevo, 'Pendiente', v_emp, y ->> 'rol', 0)
  returning id into v_id;
  return jsonb_build_object('pendiente', true, 'id', v_id);
end;
$$;

-- Deja constancia de un cambio aplicado directo desde la Biblioteca (galería…): mkfRegistrarDirecto_.
create or replace function public.mkt_registrar_directo(p_producto uuid, p_campo text, p_anterior text, p_nuevo text)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  y jsonb := public.marketing_mi_rol();
  v_coord boolean := coalesce((y ->> 'coord')::boolean, false);
  v_emp uuid := nullif(y ->> 'empleado_id', '')::uuid;
  v_prod text;
begin
  if not (app.puede('marketing', 'crear') or app.puede('marketing', 'editar')) then raise exception 'No tienes permiso en Marketing.'; end if;
  if coalesce(p_anterior, '') = coalesce(p_nuevo, '') then return; end if;
  select codigo || ' · ' || nombre into v_prod from public.productos where id = p_producto;
  insert into public.marketing_cambios (codigo, fecha, producto_id, producto_texto, campo, nivel, valor_anterior, valor_nuevo, estado, autor_id, autor_rol, revisado_por, fecha_revision, correcciones)
  values (app.mkt_codigo(), now(), p_producto, v_prod, left(p_campo, 40), 'Directo', p_anterior, p_nuevo, 'Aplicado', v_emp, y ->> 'rol',
          case when v_coord then v_emp end, case when v_coord then now() end, 0);
end;
$$;

-- ---------------------------------------------------------------- Coordinación decide (mkfAprobar, mkfDevolver, mkfRechazar, mkfMarcarRevisado, mkfDeshacer)
create or replace function public.mkt_revision_decidir(p_ids uuid[], p_accion text, p_comentario text default null, p_ediciones jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  y jsonb := public.marketing_mi_rol();
  v_emp uuid := nullif(y ->> 'empleado_id', '')::uuid;
  v_nombre text := coalesce(y ->> 'nombre', 'Coordinación');
  v_com text := nullif(btrim(coalesce(p_comentario, '')), '');
  v_res jsonb := '[]'::jsonb;
  v_val text; v_editado boolean;
  c public.marketing_cambios%rowtype;
begin
  if not coalesce((y ->> 'coord')::boolean, false) then raise exception 'Solo Coordinación de Marketing puede hacer esto.'; end if;
  if p_accion not in ('aprobar', 'devolver', 'rechazar', 'revisado', 'deshacer') then raise exception 'Acción no válida.'; end if;
  if p_accion = 'devolver' and length(coalesce(v_com, '')) < 3 then raise exception 'Escribe qué hay que corregir.'; end if;
  for c in select * from public.marketing_cambios where id = any(p_ids) and deleted_at is null order by fecha loop
    begin
      if p_accion = 'aprobar' then
        if c.estado <> 'Pendiente' then raise exception 'Ya no está pendiente (%).', c.estado; end if;
        if c.campo like 'accion:%' then raise exception 'Las publicaciones se aprueban con el botón de la tarjeta (se envían a Zernio).'; end if;
        v_editado := coalesce(p_ediciones, '{}'::jsonb) ? c.id::text;
        v_val := case when v_editado then p_ediciones ->> c.id::text else c.valor_nuevo end;
        perform app.mkt_aplicar_campo(c.producto_id, c.campo, v_val);
        update public.marketing_cambios
           set estado = 'Aprobado', revisado_por = v_emp, fecha_revision = now(), valor_nuevo = btrim(coalesce(v_val, '')),
               comentario = case when v_editado then 'Ajustado y aprobado por ' || v_nombre else coalesce(v_com, comentario) end
         where id = c.id;
      elsif p_accion = 'devolver' then
        if c.estado <> 'Pendiente' then raise exception 'Ya no está pendiente (%).', c.estado; end if;
        update public.marketing_cambios set estado = 'Con cambios', comentario = left(v_com, 1000), revisado_por = v_emp, fecha_revision = now(), fecha_devolucion = now() where id = c.id;
      elsif p_accion = 'rechazar' then
        if c.estado not in ('Pendiente', 'Con cambios') then raise exception 'Ya fue revisado (%).', c.estado; end if;
        update public.marketing_cambios set estado = 'Rechazado', comentario = left(v_com, 1000), revisado_por = v_emp, fecha_revision = now() where id = c.id;
      elsif p_accion = 'revisado' then
        if c.estado <> 'Aplicado' or c.revisado_por is not null then raise exception 'Ya estaba revisado.'; end if;
        update public.marketing_cambios set revisado_por = v_emp, fecha_revision = now() where id = c.id;
      else -- deshacer
        if c.estado not in ('Aplicado', 'Aprobado') or c.campo like 'accion:%' or c.producto_id is null then raise exception 'Este cambio no se puede deshacer.'; end if;
        if c.campo = 'galeria' then raise exception 'Los cambios de la galería se corrigen desde la Biblioteca.'; end if;
        if btrim(coalesce(app.mkt_valor_campo(c.producto_id, c.campo), '')) <> btrim(coalesce(c.valor_nuevo, '')) then
          raise exception 'El campo cambió después; ábrelo en el producto para corregirlo.';
        end if;
        perform app.mkt_aplicar_campo(c.producto_id, c.campo, c.valor_anterior);
        update public.marketing_cambios set estado = 'Deshecho', revisado_por = v_emp, fecha_revision = now() where id = c.id;
      end if;
      v_res := v_res || jsonb_build_object('id', c.id, 'ok', true);
    exception when others then
      v_res := v_res || jsonb_build_object('id', c.id, 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return v_res;
end;
$$;

-- ---------------------------------------------------------------- bandejas
create or replace function app.mkt_item(c public.marketing_cambios)
returns jsonb language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'id', c.id, 'codigo', c.codigo, 'fecha', c.fecha, 'actualizado', c.updated_at, 'productoId', c.producto_id,
    'producto', coalesce((select p.codigo || ' · ' || p.nombre from public.productos p where p.id = c.producto_id), c.producto_texto),
    'imagen', (select p.imagen_url from public.productos p where p.id = c.producto_id),
    'campo', c.campo, 'accion', c.campo like 'accion:%', 'nivel', c.nivel, 'anterior', c.valor_anterior, 'nuevo', c.valor_nuevo, 'estado', c.estado,
    'autor', (select e.nombre from public.empleados e where e.id = c.autor_id), 'autorId', c.autor_id, 'rol', c.autor_rol,
    'revisadoPor', (select e.nombre from public.empleados e where e.id = c.revisado_por), 'fechaRevision', c.fecha_revision,
    'comentario', c.comentario, 'correcciones', c.correcciones)
$$;

create or replace function public.mkt_revision_bandeja()
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare
  y jsonb := public.marketing_mi_rol();
  v_emp uuid := nullif(y ->> 'empleado_id', '')::uuid;
begin
  if not coalesce((y ->> 'coord')::boolean, false) then raise exception 'Solo Coordinación de Marketing ve la bandeja de aprobación.'; end if;
  return jsonb_build_object(
    'yo', y,
    'pendientes', coalesce((select jsonb_agg(app.mkt_item(c) order by c.updated_at) from public.marketing_cambios c where c.deleted_at is null and c.estado = 'Pendiente'), '[]'::jsonb),
    'aplicados', coalesce((select jsonb_agg(x.j order by x.fecha desc) from (
        select app.mkt_item(c) as j, c.fecha from public.marketing_cambios c
         where c.deleted_at is null and c.estado = 'Aplicado' and c.revisado_por is null and c.fecha >= now() - interval '14 days'
           and c.autor_id is distinct from v_emp
         order by c.fecha desc limit 300) x), '[]'::jsonb),
    'conCambios', (select count(*) from public.marketing_cambios c where c.deleted_at is null and c.estado = 'Con cambios'),
    'equipo', coalesce((select jsonb_agg(jsonb_build_object('id', q.empleado_id, 'nombre', q.nombre, 'email', q.email, 'rol', q.rol, 'directa', q.directa) order by q.nombre) from app.mkt_equipo() q), '[]'::jsonb));
end;
$$;

create or replace function public.mkt_revision_contador()
returns jsonb language sql stable security definer set search_path = public, app as $$
  with y as (select public.marketing_mi_rol() as r)
  select jsonb_build_object(
    'coord', coalesce((y.r ->> 'coord')::boolean, false), 'rol', y.r ->> 'rol', 'directa', coalesce((y.r ->> 'directa')::boolean, false),
    'porAprobar', case when coalesce((y.r ->> 'coord')::boolean, false)
                       then (select count(*) from public.marketing_cambios c where c.deleted_at is null and c.estado = 'Pendiente') else 0 end,
    'conCambios', (select count(*) from public.marketing_cambios c where c.deleted_at is null and c.estado = 'Con cambios' and c.autor_id = nullif(y.r ->> 'empleado_id', '')::uuid))
  from y
$$;

create or replace function public.mkt_mis_envios()
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare
  y jsonb := public.marketing_mi_rol();
  v_emp uuid := nullif(y ->> 'empleado_id', '')::uuid;
begin
  if not app.puede('marketing', 'ver') then raise exception 'Sin acceso a Marketing.'; end if;
  return jsonb_build_object('yo', y, 'items', coalesce((select jsonb_agg(x.j order by x.f desc) from (
      select app.mkt_item(c) as j, c.updated_at as f from public.marketing_cambios c
       where c.deleted_at is null and c.autor_id = v_emp
         and (c.estado in ('Pendiente', 'Con cambios') or c.updated_at >= now() - interval '45 days')
       order by c.updated_at desc limit 300) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------- desempeño del equipo (mkfDesempeno)
create or replace function public.mkt_desempeno(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare
  t0 timestamptz := (p_desde::text || ' 00:00:00-05')::timestamptz;
  t1 timestamptz := (p_hasta::text || ' 23:59:59-05')::timestamptz;
begin
  if not coalesce((public.marketing_mi_rol() ->> 'coord')::boolean, false) then raise exception 'Solo Coordinación de Marketing ve el desempeño del equipo.'; end if;
  if p_hasta < p_desde or p_hasta - p_desde > 400 then raise exception 'Elige un período válido.'; end if;
  return jsonb_build_object('desde', t0, 'hasta', t1, 'equipo', coalesce((
    select jsonb_agg(m order by (m ->> 'rol') = 'Coordinación', ((m ->> 'campos')::int + (m ->> 'fotos')::int + (m ->> 'videos')::int) desc)
      from (
        select jsonb_build_object(
          'id', q.empleado_id, 'email', q.email, 'nombre', q.nombre, 'rol', q.rol, 'directa', q.directa,
          'pendientes', (select count(*) from public.marketing_cambios c where c.deleted_at is null and c.autor_id = q.empleado_id and c.estado = 'Pendiente'),
          'conCambios', (select count(*) from public.marketing_cambios c where c.deleted_at is null and c.autor_id = q.empleado_id and c.estado = 'Con cambios'),
          'enviados', count(*) filter (where k.revision),
          'aprobados', count(*) filter (where k.revision and k.estado = 'Aprobado'),
          'primera', count(*) filter (where k.revision and k.estado = 'Aprobado' and k.correcciones = 0),
          'devueltos', count(*) filter (where k.revision and k.correcciones > 0),
          'rechazados', count(*) filter (where k.revision and k.estado = 'Rechazado'),
          'directos', count(*) filter (where not k.revision and k.estado in ('Aplicado', 'Aprobado') and k.campo not in ('galeria', 'imagen', 'imagen_url')),
          'campos', count(*) filter (where k.campo not like 'accion:%' and k.campo not in ('galeria', 'imagen', 'imagen_url')),
          'productos', count(distinct k.producto_id),
          'fotos', coalesce(sum(k.fotos), 0)::int, 'videos', coalesce(sum(k.videos), 0)::int,
          'videosTipo', coalesce((select jsonb_object_agg(t.tipo, t.n) from (
              select coalesce(nullif(g ->> 'tipoVideo', ''), 'Sin tipo') as tipo, count(*) as n
                from public.marketing_cambios c2, lateral jsonb_array_elements(app.lista_jsonb(c2.valor_nuevo)) g
               where c2.deleted_at is null and c2.autor_id = q.empleado_id and c2.campo = 'galeria' and c2.fecha between t0 and t1 and g ->> 'tipo' = 'video'
                 and not (app.lista_jsonb(c2.valor_anterior)) @> jsonb_build_array(jsonb_build_object('archivo', g ->> 'archivo'))
               group by 1) t), '{}'::jsonb),
          'piezas', (select count(*) from public.audiovisual a where a.deleted_at is null and coalesce(a.creado_por, a.responsable_id) = q.empleado_id and a.fecha between t0 and t1),
          'horasAprobacion', round(avg(extract(epoch from k.fecha_revision - k.fecha) / 3600.0) filter (where k.revision and k.estado = 'Aprobado' and k.fecha_revision >= k.fecha)::numeric, 1),
          'horasCorreccion', round(avg(k.horas_correccion / nullif(k.correcciones, 0)) filter (where k.revision and k.correcciones > 0 and k.horas_correccion > 0)::numeric, 1),
          'tasaPrimera', case when count(*) filter (where k.revision and k.estado = 'Aprobado') > 0
                              then round(100.0 * count(*) filter (where k.revision and k.estado = 'Aprobado' and k.correcciones = 0) / count(*) filter (where k.revision and k.estado = 'Aprobado')) end
        ) as m
          from app.mkt_equipo() q
          left join lateral (
            select c.*, (c.nivel = 'Revisión' or c.campo like 'accion:%') as revision,
                   case when c.campo in ('imagen', 'imagen_url') then 1 when c.campo = 'galeria' then (
                     select count(*) from jsonb_array_elements(app.lista_jsonb(c.valor_nuevo)) g
                      where coalesce(g ->> 'tipo', 'imagen') <> 'video'
                        and not (app.lista_jsonb(c.valor_anterior)) @> jsonb_build_array(jsonb_build_object('archivo', g ->> 'archivo'))) else 0 end as fotos,
                   case when c.campo = 'galeria' then (
                     select count(*) from jsonb_array_elements(app.lista_jsonb(c.valor_nuevo)) g
                      where g ->> 'tipo' = 'video'
                        and not (app.lista_jsonb(c.valor_anterior)) @> jsonb_build_array(jsonb_build_object('archivo', g ->> 'archivo'))) else 0 end as videos
              from public.marketing_cambios c
             where c.deleted_at is null and c.autor_id = q.empleado_id and c.fecha between t0 and t1
          ) k on true
         group by q.empleado_id, q.email, q.nombre, q.rol, q.directa
      ) z), '[]'::jsonb));
end;
$$;

-- Coordinación activa o quita la "Publicación directa" de alguien del equipo (mkfDefinirDirecta).
create or replace function public.mkt_definir_directa(p_empleado uuid, p_activa boolean)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not coalesce((public.marketing_mi_rol() ->> 'coord')::boolean, false) then raise exception 'Solo Coordinación de Marketing puede cambiar esto.'; end if;
  update public.empleados
     set preferencias = coalesce(preferencias, '{}'::jsonb)
                        || jsonb_build_object('marketing', coalesce(preferencias -> 'marketing', '{}'::jsonb) || jsonb_build_object('directa', coalesce(p_activa, false)))
   where id = p_empleado and deleted_at is null;
  if not found then raise exception 'No se encontró a la persona.'; end if;
end;
$$;

-- ---------------------------------------------------------------- ajustes de la ficha técnica (mkfGuardarAjustes)
create table if not exists public.marketing_ajustes (
  id    uuid primary key default gen_random_uuid(),
  clave text not null unique,
  valor jsonb not null default '{}'::jsonb
);
select app.estandarizar('public.marketing_ajustes');
select app.aplicar_rls('public.marketing_ajustes', array['marketing', 'inventario', 'catalogos'], array['marketing']);
insert into public.marketing_ajustes (clave, valor) values ('ficha', '{"web":"vimedic.com.ec","telefono":"","correo":"","certificaciones":""}')
  on conflict (clave) do nothing;

create or replace function public.mkt_guardar_ajustes(p_valor jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare v jsonb;
begin
  if not coalesce((public.marketing_mi_rol() ->> 'coord')::boolean, false) then raise exception 'Solo Coordinación de Marketing puede cambiar los ajustes.'; end if;
  v := jsonb_build_object(
    'web', left(btrim(coalesce(nullif(p_valor ->> 'web', ''), 'vimedic.com.ec')), 80),
    'telefono', left(btrim(coalesce(p_valor ->> 'telefono', '')), 40),
    'correo', left(btrim(coalesce(p_valor ->> 'correo', '')), 80),
    'certificaciones', left(btrim(coalesce(p_valor ->> 'certificaciones', '')), 160));
  insert into public.marketing_ajustes (clave, valor) values ('ficha', v)
    on conflict (clave) do update set valor = excluded.valor, deleted_at = null;
  return v;
end;
$$;

-- ---------------------------------------------------------------- informe comercial (infComercial_)
create or replace function public.mkt_informe_comercial(p_desde date, p_hasta date, p_empresa text default 'VIMEDIC')
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare
  t0 timestamptz := (p_desde::text || ' 00:00:00-05')::timestamptz;
  t1 timestamptz := (p_hasta::text || ' 23:59:59-05')::timestamptz;
begin
  if not coalesce((public.marketing_mi_rol() ->> 'coord')::boolean, false) then raise exception 'Solo Coordinación de Marketing genera informes.'; end if;
  if not (app.es_superadmin() or app.puede('dashboard', 'ver') or app.puede('crm', 'ver_todos') or app.puede('marketing', 'administrar')) then
    raise exception 'No tienes acceso a los indicadores comerciales.';
  end if;
  return (
    with registros as (
      select l.id, 'lead' as tipo, l.fecha, l.asesor_id, l.estado_crm, false as con_items, null::jsonb as items, false as venta, null::timestamptz as fecha_venta
        from public.leads l where l.deleted_at is null and l.empresa = p_empresa and l.fecha between t0 and t1
      union all
      select c.id, 'cot', c.fecha, c.asesor_id, c.estado_crm, case when jsonb_typeof(c.items) = 'array' then jsonb_array_length(c.items) > 0 else false end, c.items,
             (c.tipo_registro = 'Venta' or c.estado_crm ilike '%ganado%'), coalesce(c.fecha_venta, c.ultima_actividad)
        from public.cotizaciones c where c.deleted_at is null and c.empresa = p_empresa
         and (c.fecha between t0 and t1 or ((c.tipo_registro = 'Venta' or c.estado_crm ilike '%ganado%') and coalesce(c.fecha_venta, c.ultima_actividad) between t0 and t1))
    ), primera as (
      select r.id, min(i.fecha) as f
        from registros r join public.interacciones i on i.deleted_at is null and i.fecha >= r.fecha
         and (i.lead_id = r.id or i.cotizacion_id = r.id) and coalesce(i.usuario_texto, '') <> '' and i.usuario_texto !~* '^sistema$'
       group by r.id
    ), base as (
      select coalesce(e.nombre, 'Sin asignar') as asesor, r.*, p.f as primera_f,
             (r.fecha between t0 and t1) as en_periodo,
             (r.venta and r.fecha_venta between t0 and t1) as venta_periodo,
             coalesce((select sum(app.num_seguro(it ->> 'cantidad') * app.num_seguro(it ->> 'precio') * (1 - app.num_seguro(it ->> 'descuento') / 100))
                         from jsonb_array_elements(case when jsonb_typeof(r.items) = 'array' then r.items else '[]'::jsonb end) it), 0) as monto,
             exists (select 1 from jsonb_array_elements(case when jsonb_typeof(r.items) = 'array' then r.items else '[]'::jsonb end) it where it -> 'oferta' ->> 'campana' is not null or it -> 'oferta' ->> 'tipo' = 'Campaña') as campana
        from registros r left join public.empleados e on e.id = r.asesor_id left join primera p on p.id = r.id
    ), por as (
      select asesor,
             count(*) filter (where en_periodo) as leads,
             count(*) filter (where en_periodo and ((coalesce(estado_crm, '') <> '' and estado_crm !~* '^(nuevo|pendiente|sin atender)') or primera_f is not null)) as atendidos,
             percentile_cont(0.5) within group (order by extract(epoch from primera_f - fecha) / 3600.0) filter (where en_periodo and primera_f is not null) as resp,
             count(*) filter (where en_periodo and tipo = 'cot' and con_items) as cot,
             count(*) filter (where venta_periodo) as ventas,
             coalesce(sum(monto) filter (where venta_periodo), 0) as monto,
             count(*) filter (where venta_periodo and campana) as campana
        from base group by asesor
    )
    select jsonb_build_object(
      'lista', coalesce((select jsonb_agg(jsonb_build_object('asesor', asesor, 'leads', leads, 'atendidos', atendidos, 'resp', round(resp::numeric, 1), 'cot', cot,
                          'ventas', ventas, 'monto', round(monto, 2), 'campana', campana, 'conversion', case when leads > 0 then round(100.0 * ventas / leads, 1) end)
                          order by monto desc, leads desc) from por where leads > 0 or ventas > 0), '[]'::jsonb),
      'total', (select jsonb_build_object('leads', count(*) filter (where en_periodo),
                  'atendidos', count(*) filter (where en_periodo and ((coalesce(estado_crm, '') <> '' and estado_crm !~* '^(nuevo|pendiente|sin atender)') or primera_f is not null)),
                  'resp', round((percentile_cont(0.5) within group (order by extract(epoch from primera_f - fecha) / 3600.0) filter (where en_periodo and primera_f is not null))::numeric, 1),
                  'cot', count(*) filter (where en_periodo and tipo = 'cot' and con_items),
                  'ventas', count(*) filter (where venta_periodo), 'monto', round(coalesce(sum(monto) filter (where venta_periodo), 0), 2),
                  'campana', count(*) filter (where venta_periodo and campana),
                  'conversion', case when count(*) filter (where en_periodo) > 0 then round(100.0 * count(*) filter (where venta_periodo) / count(*) filter (where en_periodo), 1) end)
                from base))
  );
end;
$$;

-- ---------------------------------------------------------------- permisos de ejecución
revoke all on function public.mkt_cambiar_campo(uuid, text, text), public.mkt_registrar_directo(uuid, text, text, text),
  public.mkt_revision_decidir(uuid[], text, text, jsonb), public.mkt_revision_bandeja(), public.mkt_revision_contador(), public.mkt_mis_envios(),
  public.mkt_desempeno(date, date), public.mkt_definir_directa(uuid, boolean), public.mkt_guardar_ajustes(jsonb), public.mkt_informe_comercial(date, date, text)
  from public, anon;
grant execute on function public.mkt_cambiar_campo(uuid, text, text), public.mkt_registrar_directo(uuid, text, text, text),
  public.mkt_revision_decidir(uuid[], text, text, jsonb), public.mkt_revision_bandeja(), public.mkt_revision_contador(), public.mkt_mis_envios(),
  public.mkt_desempeno(date, date), public.mkt_definir_directa(uuid, boolean), public.mkt_guardar_ajustes(jsonb), public.mkt_informe_comercial(date, date, text)
  to authenticated;
revoke all on function app.mkt_aplicar_campo(uuid, text, text) from public, anon, authenticated;
