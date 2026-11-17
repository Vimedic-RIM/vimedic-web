-- =====================================================================
-- Marketing › Plan de trabajo: quien coordina Marketing programa las actividades del equipo
-- (completar la ficha de un producto, fotos, video, ficha técnica, documentos técnicos del proveedor,
-- publicación). Cada tarea ES una actividad de la Agenda (origen 'marketing'), así la persona la ve y la
-- trabaja también en su Agenda (cronómetro, monedas, devoluciones), ligada al producto.
--   · Pasos por tipo de trabajo (p. ej. video: guion → grabación → edición → subir).
--   · Se cierra sola cuando el producto cumple: ficha completa, foto o video nuevo, ficha técnica nueva,
--     documentos técnicos del proveedor cargados, publicación hecha.
--   · «Armar la semana»: sugiere los siguientes productos (visibles al público primero, más cotizados,
--     en oferta, nuevos con stock).
-- Asignan: superadmin, Marketing › aprobar/administrar o el rol de Marketing «Coordinación».
-- =====================================================================

alter table public.actividades
  add column if not exists producto_id uuid references public.productos(id) on delete set null,
  add column if not exists mkt_trabajo text check (mkt_trabajo in ('completar', 'fotos', 'video', 'ficha_tecnica', 'documentos_proveedor', 'publicacion', 'otro')),
  add column if not exists mkt_detalle text,
  add column if not exists mkt_pasos jsonb not null default '[]'::jsonb,
  add column if not exists mkt_base jsonb not null default '{}'::jsonb;
create index if not exists actividades_mkt_idx on public.actividades (mkt_trabajo, estado) where mkt_trabajo is not null and deleted_at is null;
create index if not exists actividades_producto_idx on public.actividades (producto_id) where producto_id is not null;
-- (las columnas nuevas no están en el «grant update» de actividades: solo se cambian con las funciones de abajo)

-- ---------------------------------------------------------------- Ayudas
create or replace function app.mkt_coordina() returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.es_superadmin() or app.puede('marketing', 'aprobar') or app.puede('marketing', 'administrar')
      or exists (select 1 from public.empleados e where e.id = app.empleado_id() and e.preferencias -> 'marketing' ->> 'rol' = 'Coordinación');
$$;

create or replace function app.mkt_trabajo_nombre(p text) returns text
language sql immutable as $$
  select case p when 'completar' then 'Completar ficha' when 'fotos' then 'Fotos' when 'video' then 'Video'
    when 'ficha_tecnica' then 'Ficha técnica' when 'documentos_proveedor' then 'Documentos del proveedor'
    when 'publicacion' then 'Publicación' else 'Tarea' end;
$$;

create or replace function app.mkt_pasos_de(p text) returns jsonb
language sql immutable as $$
  select coalesce((select jsonb_agg(jsonb_build_object('t', x, 'hecho', false)) from unnest(case p
    when 'completar' then array['Descripción y características', 'Especificaciones técnicas', 'Imagen principal y 3 fotos', 'Enviar a revisión']
    when 'fotos' then array['Sesión de fotos', 'Edición', 'Subir a la galería']
    when 'video' then array['Guion', 'Grabación', 'Edición', 'Subir y enviar a revisión']
    when 'ficha_tecnica' then array['Revisar datos técnicos', 'Generar la ficha técnica', 'Revisión']
    when 'documentos_proveedor' then array['Pedir el material al proveedor', 'Recibir manual / hoja de datos y certificados', 'Revisar y subir a Documentos técnicos']
    when 'publicacion' then array['Copy', 'Diseño o video', 'Programar en el Planificador']
    else array[]::text[] end) x), '[]'::jsonb);
$$;

/** Lo que tiene hoy un producto (el mismo criterio de «Por completar» / mkt_pendientes). */
create or replace function app.mkt_estado_producto(p_producto uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'imagen', coalesce(btrim(p.imagen_url), '') <> '',
    'fotos', (select count(*) from public.producto_galeria g where g.producto_id = p.id and g.deleted_at is null and g.tipo <> 'video'),
    'videos', (select count(*) from public.producto_galeria g where g.producto_id = p.id and g.deleted_at is null and g.tipo = 'video'),
    'tipos', coalesce((select jsonb_object_agg(t, n) from (select coalesce(nullif(g.tipo_video, ''), 'Sin tipo') t, count(*) n from public.producto_galeria g
                        where g.producto_id = p.id and g.deleted_at is null and g.tipo = 'video' group by 1) x), '{}'::jsonb),
    'descripcion', coalesce(btrim(p.descripcion), '') <> '',
    'caracteristicas', coalesce(btrim(p.caracteristicas), '') <> '',
    'especificaciones', coalesce(btrim(p.especificaciones), '') <> '',
    'ficha', coalesce(btrim(p.ficha_tecnica_url), '') <> '',
    'docs_manual', exists (select 1 from public.documentos_tecnicos d where d.producto_id = p.id and d.deleted_at is null and d.tipo in ('Manual de usuario', 'Manual de servicio', 'Hoja de datos del fabricante')),
    'docs_cert', exists (select 1 from public.documentos_tecnicos d where d.producto_id = p.id and d.deleted_at is null and d.tipo in ('Certificado', 'Registro sanitario')))
  from public.productos p where p.id = p_producto;
$$;

/** ¿El producto ya cumple lo que pedía la tarea? (para cerrarla sola) */
create or replace function app.mkt_trabajo_cumplido(a public.actividades) returns boolean
language plpgsql stable security definer set search_path = public, app as $$
declare s jsonb; b jsonb := coalesce(a.mkt_base, '{}'::jsonb);
begin
  if a.producto_id is null or a.mkt_trabajo is null or a.mkt_trabajo = 'otro' then return false; end if;
  s := app.mkt_estado_producto(a.producto_id);
  if s is null then return false; end if;
  case a.mkt_trabajo
    when 'completar' then
      return (s ->> 'imagen')::boolean and (s ->> 'fotos')::int >= 3 and (s ->> 'descripcion')::boolean and (s ->> 'caracteristicas')::boolean and (s ->> 'especificaciones')::boolean;
    when 'fotos' then
      return (s ->> 'imagen')::boolean and (s ->> 'fotos')::int >= greatest(3, coalesce((b ->> 'fotos')::int, 0) + 1);
    when 'video' then
      if coalesce(a.mkt_detalle, '') <> '' then
        return coalesce((s -> 'tipos' ->> a.mkt_detalle)::int, 0) > coalesce((b -> 'tipos' ->> a.mkt_detalle)::int, 0);
      end if;
      return (s ->> 'videos')::int > coalesce((b ->> 'videos')::int, 0);
    when 'ficha_tecnica' then
      return exists (select 1 from public.fichas_tecnicas f where f.producto_id = a.producto_id and f.deleted_at is null and f.created_at > a.created_at);
    when 'documentos_proveedor' then
      return (s ->> 'docs_manual')::boolean and (s ->> 'docs_cert')::boolean;
    when 'publicacion' then
      return exists (select 1 from public.marketing_publicaciones m where m.producto_id = a.producto_id and m.deleted_at is null and m.created_at > a.created_at);
    else return false;
  end case;
end;
$$;

/** Cierra (como «Listo») una tarea de Marketing: corta el cronómetro, deja el resultado y da la moneda a quien la tenía. */
create or replace function app.mkt_cerrar(p_id uuid, p_resultado text, p_por uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare a public.actividades; v_resp uuid;
begin
  select * into a from public.actividades where id = p_id for update;
  if not found or a.estado in ('Listo', 'Cancelado') then return; end if;
  perform app.ag_cerrar_sesion(p_id);
  v_resp := coalesce(a.delegado_a_id, a.realiza_id);
  update public.actividades
     set estado = 'Listo', resultado = left(btrim(p_resultado), 1000), fecha_finalizacion = now(), finalizado_por = coalesce(p_por, v_resp),
         mkt_pasos = coalesce((select jsonb_agg(x || jsonb_build_object('hecho', true)) from jsonb_array_elements(a.mkt_pasos) x), '[]'::jsonb)
   where id = p_id;
  if a.moneda_otorgada = 0 and v_resp is not null then
    insert into public.monedas_movimientos (id, codigo, empleado_id, cambio, motivo, actividad_id)
    values (gen_random_uuid(), 'MON-' || gen_random_uuid(), v_resp, 1, 'Actividad completada: ' || a.descripcion, p_id);
    update public.actividades set moneda_otorgada = 1 where id = p_id;
  end if;
  if a.creado_por is not null and a.creado_por <> coalesce(p_por, v_resp) then
    insert into public.notificaciones (id, para_id, modulo, evento, tipo, texto, entidad, entidad_id)
    values (gen_random_uuid(), a.creado_por, 'marketing', 'plan_listo', 'info', '✅ Lista: ' || a.descripcion, 'actividades', p_id);
  end if;
end;
$$;

/** Cierra las tareas cuyo producto ya cumple. Devuelve cuántas cerró. */
create or replace function app.mkt_cerrar_cumplidas() returns integer
language plpgsql security definer set search_path = public, app as $$
declare a public.actividades; n int := 0;
begin
  for a in select * from public.actividades where mkt_trabajo is not null and mkt_trabajo <> 'otro' and deleted_at is null and estado not in ('Listo', 'Cancelado') loop
    if app.mkt_trabajo_cumplido(a) then
      perform app.mkt_cerrar(a.id, 'Cumplido: el producto ya tiene lo pedido (' || app.mkt_trabajo_nombre(a.mkt_trabajo) || ').', null);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function app.mkt_cerrar(uuid, text, uuid), app.mkt_cerrar_cumplidas() from public, anon, authenticated;

-- ---------------------------------------------------------------- Equipo y tareas
create or replace function app.mkt_plan_equipo() returns table (id uuid, nombre text, foto text, rol text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre, e.foto_url, coalesce(nullif(e.preferencias -> 'marketing' ->> 'rol', ''), 'Asistente')
    from public.empleados e left join public.roles r on r.id = e.rol_id
   where e.deleted_at is null and e.estado = 'activo'
     and (coalesce(r.permisos -> 'marketing', '[]'::jsonb) ? 'ver' or coalesce(e.permisos_extra -> 'marketing', '[]'::jsonb) ? 'ver'
          or coalesce(e.preferencias -> 'marketing' ->> 'rol', '') <> '' or e.id = app.empleado_id())
   order by e.nombre;
$$;

/** Plan de trabajo de un rango de fechas (más lo atrasado). Quien coordina ve a todo el equipo; los demás, lo suyo. */
create or replace function public.mkt_plan(p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_coord boolean; yo uuid := app.empleado_id(); v_cerradas int;
begin
  if not app.puede('marketing', 'ver') then raise exception 'Sin acceso a Marketing.'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 62 then raise exception 'Rango de fechas no válido.'; end if;
  v_cerradas := app.mkt_cerrar_cumplidas();
  v_coord := app.mkt_coordina();
  return jsonb_build_object(
    'coordina', v_coord, 'yo', yo, 'cerradasAhora', v_cerradas,
    'equipo', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'nombre', q.nombre, 'foto', q.foto, 'rol', q.rol)) from app.mkt_plan_equipo() q where v_coord or q.id = yo), '[]'::jsonb),
    'tareas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'codigo', a.codigo, 'descripcion', a.descripcion, 'trabajo', a.mkt_trabajo, 'detalle', a.mkt_detalle, 'instrucciones', a.detalle,
               'fecha', a.fecha_programada, 'prioridad', a.prioridad, 'estado', a.estado, 'responsable', coalesce(a.delegado_a_id, a.realiza_id),
               'creadoPor', a.creado_por, 'pasos', a.mkt_pasos, 'resultado', a.resultado, 'finalizada', a.fecha_finalizacion, 'creada', a.created_at,
               'devolucion', case when a.estado = 'Devuelto' then a.devolucion end,
               'producto', case when p.id is not null then jsonb_build_object('id', p.id, 'codigo', p.codigo, 'nombre', p.nombre, 'imagen', p.imagen_url, 'publico', p.en_catalogo) end)
             order by a.fecha_programada nulls last, a.prioridad, a.created_at)
        from public.actividades a left join public.productos p on p.id = a.producto_id
       where a.mkt_trabajo is not null and a.deleted_at is null
         and (v_coord or coalesce(a.delegado_a_id, a.realiza_id) = yo)
         and ((a.fecha_programada between p_desde and p_hasta)
              or (a.estado not in ('Listo', 'Cancelado') and (a.fecha_programada < p_desde or a.fecha_programada is null)))), '[]'::jsonb));
end;
$$;

/** Asigna una o varias tareas a una persona: {responsable, trabajo, detalle?, instrucciones?, prioridad?, items:[{producto_id, fecha}]} */
create or replace function public.mkt_plan_asignar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  yo uuid := app.empleado_id(); v_resp uuid := nullif(p ->> 'responsable', '')::uuid; v_trab text := p ->> 'trabajo';
  v_det text := nullif(btrim(coalesce(p ->> 'detalle', '')), ''); v_ins text := nullif(btrim(coalesce(p ->> 'instrucciones', '')), '');
  v_pri text := coalesce(nullif(p ->> 'prioridad', ''), 'Normal'); it jsonb; pr record; v_fecha date; v_id uuid; v_desc text;
  v_creadas int := 0; v_omit jsonb := '[]'::jsonb; v_resp_nombre text; a public.actividades;
begin
  if not app.mkt_coordina() then raise exception 'Solo quien coordina Marketing puede asignar tareas.'; end if;
  if v_trab is null or v_trab not in ('completar', 'fotos', 'video', 'ficha_tecnica', 'documentos_proveedor', 'publicacion', 'otro') then raise exception 'Tipo de trabajo no válido.'; end if;
  if v_pri not in ('Urgente', 'Importante', 'Normal') then raise exception 'Prioridad no válida.'; end if;
  select q.nombre into v_resp_nombre from app.mkt_plan_equipo() q where q.id = v_resp;
  if v_resp_nombre is null then raise exception 'Elige a una persona del equipo de Marketing.'; end if;
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then raise exception 'Elige al menos un producto.'; end if;
  if jsonb_array_length(p -> 'items') > 40 then raise exception 'Máximo 40 tareas a la vez.'; end if;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    v_fecha := coalesce(nullif(it ->> 'fecha', '')::date, current_date);
    pr := null;
    if nullif(it ->> 'producto_id', '') is not null then
      select id, codigo, nombre into pr from public.productos where id = (it ->> 'producto_id')::uuid and deleted_at is null;
      if pr.id is null then v_omit := v_omit || jsonb_build_object('producto', it ->> 'producto_id', 'motivo', 'Producto no encontrado'); continue; end if;
      if exists (select 1 from public.actividades x where x.producto_id = pr.id and x.mkt_trabajo = v_trab and coalesce(x.mkt_detalle, '') = coalesce(v_det, '')
                   and x.deleted_at is null and x.estado not in ('Listo', 'Cancelado')) then
        v_omit := v_omit || jsonb_build_object('producto', pr.nombre, 'motivo', 'Ya tiene una tarea abierta de ese tipo'); continue;
      end if;
    elsif v_trab <> 'otro' then
      v_omit := v_omit || jsonb_build_object('producto', '—', 'motivo', 'Falta el producto'); continue;
    end if;
    -- Ficha completa o documentos ya cargados: no tiene sentido pedirlo (se revisa antes de crear la tarea).
    if v_trab in ('completar', 'documentos_proveedor') then
      a := null; a.producto_id := pr.id; a.mkt_trabajo := v_trab; a.mkt_detalle := v_det; a.mkt_base := '{}'::jsonb; a.created_at := now();
      if app.mkt_trabajo_cumplido(a) then
        v_omit := v_omit || jsonb_build_object('producto', pr.nombre, 'motivo', case when v_trab = 'completar' then 'La ficha ya está completa' else 'Ya tiene manual y certificados' end);
        continue;
      end if;
    end if;
    v_desc := app.mkt_trabajo_nombre(v_trab) || coalesce(' (' || v_det || ')', '') || coalesce(': ' || pr.nombre || ' · ' || pr.codigo, coalesce(': ' || v_ins, ''));
    v_id := gen_random_uuid();
    insert into public.actividades (id, codigo, descripcion, tipo, fecha_programada, prioridad, relacionado_con, con_quien, realiza_id, delegada, delegado_a_id,
                                    estado, detalle, origen, area_usuario, producto_id, mkt_trabajo, mkt_detalle, mkt_pasos, mkt_base, creado_por)
    values (v_id, 'ACT-' || upper(substr(replace(v_id::text, '-', ''), 1, 8)), left(v_desc, 300), 'Marketing', v_fecha, v_pri, 'Área interna', 'Marketing', v_resp, v_resp <> yo, v_resp,
            'Por hacer', v_ins, 'marketing', 'Marketing', pr.id, v_trab, v_det, app.mkt_pasos_de(v_trab), coalesce(app.mkt_estado_producto(pr.id), '{}'::jsonb), yo);
    v_creadas := v_creadas + 1;
    if v_resp <> yo then
      insert into public.notificaciones (id, para_id, modulo, evento, tipo, texto, entidad, entidad_id)
      values (gen_random_uuid(), v_resp, 'marketing', 'plan_asignada', 'info', '📌 Te asignaron: ' || left(v_desc, 200) || ' · para el ' || to_char(v_fecha, 'DD/MM'), 'actividades', v_id);
    end if;
  end loop;
  return jsonb_build_object('creadas', v_creadas, 'omitidos', v_omit);
end;
$$;

/** Marca o desmarca un paso (la persona responsable o quien coordina). */
create or replace function public.mkt_plan_paso(p_id uuid, p_indice integer, p_hecho boolean) returns void
language plpgsql security definer set search_path = public, app as $$
declare a public.actividades; yo uuid := app.empleado_id();
begin
  select * into a from public.actividades where id = p_id and deleted_at is null and mkt_trabajo is not null for update;
  if not found then raise exception 'Tarea no encontrada.'; end if;
  if not (coalesce(a.delegado_a_id, a.realiza_id) = yo or app.mkt_coordina()) then raise exception 'Esta tarea es de otra persona.'; end if;
  if a.estado in ('Listo', 'Cancelado') then raise exception 'La tarea ya está cerrada.'; end if;
  if p_indice < 0 or p_indice >= jsonb_array_length(a.mkt_pasos) then raise exception 'Paso no válido.'; end if;
  update public.actividades
     set mkt_pasos = jsonb_set(mkt_pasos, array[p_indice::text], (mkt_pasos -> p_indice) || jsonb_build_object('hecho', p_hecho, 'por', yo, 'fecha', now()))
   where id = p_id;
end;
$$;

/** Reprograma o cambia de persona (arrastrar en el tablero). Solo quien coordina. */
create or replace function public.mkt_plan_mover(p_id uuid, p_fecha date, p_responsable uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare a public.actividades; yo uuid := app.empleado_id(); v_ok boolean;
begin
  if not app.mkt_coordina() then raise exception 'Solo quien coordina Marketing puede mover tareas.'; end if;
  select * into a from public.actividades where id = p_id and deleted_at is null and mkt_trabajo is not null for update;
  if not found then raise exception 'Tarea no encontrada.'; end if;
  if a.estado in ('Listo', 'Cancelado') then raise exception 'La tarea ya está cerrada.'; end if;
  if p_responsable is not null then
    select true into v_ok from app.mkt_plan_equipo() q where q.id = p_responsable;
    if v_ok is null then raise exception 'Elige a una persona del equipo de Marketing.'; end if;
  end if;
  update public.actividades
     set fecha_programada = coalesce(p_fecha, fecha_programada),
         realiza_id = coalesce(p_responsable, realiza_id), delegado_a_id = coalesce(p_responsable, delegado_a_id),
         delegada = coalesce(p_responsable, coalesce(delegado_a_id, realiza_id)) <> yo
   where id = p_id;
  if p_responsable is not null and p_responsable <> coalesce(a.delegado_a_id, a.realiza_id) and p_responsable <> yo then
    insert into public.notificaciones (id, para_id, modulo, evento, tipo, texto, entidad, entidad_id)
    values (gen_random_uuid(), p_responsable, 'marketing', 'plan_asignada', 'info', '📌 Te asignaron: ' || a.descripcion || ' · para el ' || to_char(coalesce(p_fecha, a.fecha_programada), 'DD/MM'), 'actividades', p_id);
  end if;
end;
$$;

/** La persona (o quien coordina) da la tarea por terminada. */
create or replace function public.mkt_plan_terminar(p_id uuid, p_resultado text) returns void
language plpgsql security definer set search_path = public, app as $$
declare a public.actividades; yo uuid := app.empleado_id();
begin
  if btrim(coalesce(p_resultado, '')) = '' then raise exception 'Describe brevemente qué se hizo.'; end if;
  select * into a from public.actividades where id = p_id and deleted_at is null and mkt_trabajo is not null;
  if not found then raise exception 'Tarea no encontrada.'; end if;
  if not (coalesce(a.delegado_a_id, a.realiza_id) = yo or app.mkt_coordina()) then raise exception 'Esta tarea es de otra persona.'; end if;
  if a.estado in ('Listo', 'Cancelado') then raise exception 'La tarea ya está cerrada.'; end if;
  perform app.mkt_cerrar(p_id, p_resultado, yo);
end;
$$;

/** Quien coordina cancela una tarea (queda en el historial). */
create or replace function public.mkt_plan_cancelar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public, app as $$
declare a public.actividades;
begin
  if not app.mkt_coordina() then raise exception 'Solo quien coordina Marketing puede cancelar tareas.'; end if;
  select * into a from public.actividades where id = p_id and deleted_at is null and mkt_trabajo is not null for update;
  if not found then raise exception 'Tarea no encontrada.'; end if;
  if a.estado in ('Listo', 'Cancelado') then raise exception 'La tarea ya está cerrada.'; end if;
  perform app.ag_cerrar_sesion(p_id);
  update public.actividades set estado = 'Cancelado', resultado = left(coalesce(nullif(btrim(p_motivo), ''), 'Cancelada'), 500), fecha_finalizacion = now(), finalizado_por = app.empleado_id() where id = p_id;
end;
$$;

/** «Armar la semana»: los siguientes productos que necesitan ese trabajo y no tienen una tarea abierta.
    Orden: visibles al público primero, luego de la web, y por puntaje (cotizaciones, oferta vigente, nuevos con stock). */
create or replace function public.mkt_plan_sugerir(p_trabajo text, p_limite integer default 10, p_detalle text default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v_det text := nullif(btrim(coalesce(p_detalle, '')), '');
begin
  if not app.mkt_coordina() then raise exception 'Solo quien coordina Marketing puede armar el plan.'; end if;
  if p_trabajo not in ('completar', 'fotos', 'video', 'ficha_tecnica', 'documentos_proveedor', 'publicacion') then raise exception 'Tipo de trabajo no válido.'; end if;
  return coalesce((
    with cot as (
      select it ->> 'id' as cod, count(distinct c.id) as n
        from public.cotizaciones c, lateral jsonb_array_elements(case when jsonb_typeof(c.items) = 'array' then c.items else '[]'::jsonb end) it
       where c.deleted_at is null and c.fecha >= now() - interval '365 days' and coalesce(c.estado_crm, '') <> 'Eliminado' group by 1
    ), gal as (
      select producto_id, count(*) filter (where tipo <> 'video') as fotos, count(*) filter (where tipo = 'video') as videos,
             count(*) filter (where tipo = 'video' and coalesce(tipo_video, '') = coalesce(v_det, '')) as videos_tipo
        from public.producto_galeria where deleted_at is null group by 1
    ), docs as (
      select producto_id, bool_or(tipo in ('Manual de usuario', 'Manual de servicio', 'Hoja de datos del fabricante')) as manual, bool_or(tipo in ('Certificado', 'Registro sanitario')) as cert
        from public.documentos_tecnicos where deleted_at is null group by 1
    ), ofe as (
      select distinct producto_id from public.ofertas where deleted_at is null and producto_id is not null
         and (inicio is null or inicio <= current_date) and (fin is null or fin >= current_date)
    ), abiertas as (
      select distinct producto_id from public.actividades where mkt_trabajo = p_trabajo and coalesce(mkt_detalle, '') = coalesce(v_det, '')
         and deleted_at is null and estado not in ('Listo', 'Cancelado') and producto_id is not null
    ), base as (
      select p.id, p.codigo, p.nombre, p.imagen_url, p.en_catalogo, coalesce(p.stock, 0) as stock, coalesce(cot.n, 0) as cot, ofe.producto_id is not null as oferta,
             coalesce(p.fecha_creacion::timestamptz, p.created_at) >= now() - interval '60 days' as nuevo,
             coalesce(cat.nombre, '') !~* 'flete|servicio|insumo|repuesto' as web,
             coalesce(g.fotos, 0) as fotos, coalesce(g.videos, 0) as videos, coalesce(g.videos_tipo, 0) as videos_tipo,
             coalesce(btrim(p.imagen_url), '') <> '' as imagen, coalesce(btrim(p.descripcion), '') <> '' as descr,
             coalesce(btrim(p.caracteristicas), '') <> '' as car, coalesce(btrim(p.especificaciones), '') <> '' as esp,
             coalesce(btrim(p.ficha_tecnica_url), '') <> '' as ficha, coalesce(d.manual, false) as manual, coalesce(d.cert, false) as cert,
             exists (select 1 from public.marketing_publicaciones m where m.producto_id = p.id and m.deleted_at is null and m.created_at >= now() - interval '60 days') as publicado
        from public.productos p
        left join public.categorias cat on cat.id = p.categoria_id
        left join cot on cot.cod = p.codigo
        left join gal g on g.producto_id = p.id
        left join docs d on d.producto_id = p.id
        left join ofe on ofe.producto_id = p.id
       where p.deleted_at is null and not coalesce(p.oculto, false) and coalesce(p.estado, '') !~* '^inactivo'
         and p.id not in (select producto_id from abiertas)
    ), necesitan as (
      select b.*, (b.cot * 10 + case when b.oferta then 30 else 0 end + case when b.nuevo and b.stock > 0 then 50 when b.nuevo then 20 else 0 end + case when b.stock > 0 then 5 else 0 end) as puntaje
        from base b
       where case p_trabajo
               when 'completar' then not (b.imagen and b.fotos >= 3 and b.descr and b.car and b.esp)
               when 'fotos' then not (b.imagen and b.fotos >= 3)
               when 'video' then (case when v_det is null then b.videos = 0 else b.videos_tipo = 0 end)
               when 'ficha_tecnica' then not b.ficha
               when 'documentos_proveedor' then not (b.manual and b.cert)
               when 'publicacion' then not b.publicado
             end
       order by b.en_catalogo desc, b.web desc, puntaje desc, b.nombre
       limit least(greatest(coalesce(p_limite, 10), 1), 50)
    )
    select jsonb_agg(jsonb_build_object(
             'id', n.id, 'codigo', n.codigo, 'nombre', n.nombre, 'imagen', n.imagen_url, 'publico', n.en_catalogo,
             'motivo', concat_ws(' · ', case when n.en_catalogo then 'Visible al público' end, case when n.cot > 0 then n.cot || ' cotizaci' || case when n.cot = 1 then 'ón' else 'ones' end end,
                                case when n.oferta then 'En oferta' end, case when n.nuevo then 'Nuevo' end, case when n.stock > 0 then 'Stock ' || n.stock end)))
      from necesitan n
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.mkt_plan(date, date), public.mkt_plan_asignar(jsonb), public.mkt_plan_paso(uuid, integer, boolean), public.mkt_plan_mover(uuid, date, uuid),
  public.mkt_plan_terminar(uuid, text), public.mkt_plan_cancelar(uuid, text), public.mkt_plan_sugerir(text, integer, text) from public, anon;
grant execute on function public.mkt_plan(date, date), public.mkt_plan_asignar(jsonb), public.mkt_plan_paso(uuid, integer, boolean), public.mkt_plan_mover(uuid, date, uuid),
  public.mkt_plan_terminar(uuid, text), public.mkt_plan_cancelar(uuid, text), public.mkt_plan_sugerir(text, integer, text) to authenticated;

notify pgrst, 'reload schema';
