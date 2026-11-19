-- =====================================================================
-- Marketing › Agenda: la semana por horas de quien coordina y su equipo (al estilo de Google Calendar).
--   · Gente de la agenda: el equipo de Marketing, quienes coordinan y uno mismo.
--   · Muestra las actividades de cada persona (reuniones, llamadas, tareas del Plan de trabajo…) y las campañas.
--     Lo que no es de Marketing de otra persona sale como «Ocupado» (sin asunto ni detalle), como en Google Calendar;
--     quien coordina ve completo lo del equipo.
--   · Citas nuevas: siempre con responsable (alguien de la agenda) e invitados opcionales. Son actividades normales,
--     así que también están en la Agenda general de cada persona.
--   · Mover (arrastrar): día, hora y responsable. Las tareas del Plan siguen sus reglas: cambiar de día o de persona
--     solo quien coordina o quien la agregó; su responsable sí puede ponerle hora.
--   · Cancelar: nunca se borra (estado «Cancelado»).
-- =====================================================================

/** Gente de la agenda de Marketing para quien la abre (uno mismo siempre; el resto solo si es del equipo o coordina). */
create or replace function app.mkt_agenda_gente() returns table (id uuid, nombre text, foto text, rol text, email text)
language sql stable security definer set search_path = public, app as $$
  with yo as (select app.empleado_id() as id),
       eq as (select q.id, q.rol from app.mkt_plan_equipo() q),
       co as (select c as id from app.mkt_coordinadores() c),
       acceso as (select app.mkt_coordina() or app.mkt_es_equipo() as ok)
  select e.id, e.nombre, e.foto_url,
         coalesce((select eq.rol from eq where eq.id = e.id), case when e.id in (select id from co) then 'Coordinación' else '' end),
         lower(nullif(btrim(e.email), ''))
    from public.empleados e
   where e.deleted_at is null and e.estado = 'activo'
     and (e.id = (select id from yo)
          or ((select ok from acceso) and (e.id in (select id from eq) or e.id in (select id from co))));
$$;
revoke all on function app.mkt_agenda_gente() from public, anon, authenticated;

/** ¿Quien llama puede cambiar esta actividad desde la agenda? (no las del Plan: esas siguen sus propias reglas) */
create or replace function app.mkt_agenda_gestiona(a public.actividades) returns boolean
language sql stable security definer set search_path = public, app as $$
  select a.creado_por = app.empleado_id() or coalesce(a.delegado_a_id, a.realiza_id) = app.empleado_id()
      or (app.mkt_coordina() and (coalesce(a.delegado_a_id, a.realiza_id) in (select q.id from app.mkt_plan_equipo() q)
                                  or a.origen = 'marketing' or a.tipo = 'Marketing'));
$$;
revoke all on function app.mkt_agenda_gestiona(public.actividades) from public, anon, authenticated;

-- ---------------------------------------------------------------- Lectura
create or replace function public.mkt_agenda(p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare yo uuid := app.empleado_id(); v_coord boolean; v_email text; v_gente uuid[]; v_equipo uuid[];
begin
  if not app.puede('marketing', 'ver') then raise exception 'Sin acceso a Marketing.'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 42 then raise exception 'Rango de fechas no válido.'; end if;
  v_coord := app.mkt_coordina();
  select lower(nullif(btrim(email), '')) into v_email from public.empleados where id = yo;
  select coalesce(array_agg(g.id), '{}') into v_gente from app.mkt_agenda_gente() g;
  select coalesce(array_agg(q.id), '{}') into v_equipo from app.mkt_plan_equipo() q;
  return jsonb_build_object(
    'yo', yo, 'coordina', v_coord, 'agrega', v_coord or app.mkt_es_equipo(),
    'personas', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'nombre', g.nombre, 'foto', g.foto, 'rol', g.rol)
                                           order by case when g.id = yo then 0 when g.rol = 'Coordinación' then 1 else 2 end, g.nombre)
                            from app.mkt_agenda_gente() g), '[]'::jsonb),
    'eventos', coalesce((
      select jsonb_agg(case when x.ve then jsonb_build_object(
               'id', x.id, 'codigo', x.codigo, 'titulo', x.descripcion, 'tipo', x.tipo, 'fecha', x.fecha_programada,
               'hora', to_char(x.hora, 'HH24:MI'), 'duracion', case when x.hora is null then null else coalesce(x.duracion_min, 60) end,
               'estado', x.estado, 'prioridad', x.prioridad, 'responsable', x.resp, 'creadoPor', x.creado_por, 'creador', c.nombre,
               'ubicacion', x.ubicacion, 'enlaceMeet', x.enlace_meet, 'detalle', x.detalle,
               'invitados', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre))
                                        from public.empleados e where lower(e.email) = any (select lower(btrim(i)) from unnest(x.invitados) i)), '[]'::jsonb),
               'plan', x.mkt_trabajo is not null, 'trabajo', x.mkt_trabajo,
               'producto', case when p.id is not null then jsonb_build_object('codigo', p.codigo, 'nombre', p.nombre, 'imagen', p.imagen_url) end,
               'gestiona', x.estado not in ('Listo', 'Cancelado') and case when x.mkt_trabajo is not null
                             then v_coord or x.creado_por = yo or x.resp = yo else app.mkt_agenda_gestiona(x.a) end)
             else jsonb_build_object('id', x.id, 'fecha', x.fecha_programada, 'hora', to_char(x.hora, 'HH24:MI'),
                                     'duracion', coalesce(x.duracion_min, 60), 'responsable', x.resp, 'privado', true) end
             order by x.fecha_programada, x.hora nulls first, x.created_at)
        from (select a.id, a.codigo, a.descripcion, a.tipo, a.fecha_programada, a.hora, a.duracion_min, a.estado, a.prioridad, a.creado_por,
                     a.ubicacion, a.enlace_meet, a.detalle, a.invitados, a.mkt_trabajo, a.producto_id, a.created_at, a as a,
                     coalesce(a.delegado_a_id, a.realiza_id) as resp,
                     (coalesce(a.delegado_a_id, a.realiza_id) = yo or a.creado_por = yo
                      or (v_coord and coalesce(a.delegado_a_id, a.realiza_id) = any (v_equipo))
                      or a.mkt_trabajo is not null or a.origen = 'marketing' or a.tipo = 'Marketing'
                      or (v_email is not null and v_email = any (select lower(btrim(i)) from unnest(a.invitados) i))) as ve
                from public.actividades a
               where a.deleted_at is null and a.estado <> 'Cancelado'
                 and a.fecha_programada between p_desde and p_hasta
                 and coalesce(a.delegado_a_id, a.realiza_id) = any (v_gente)) x
        left join public.productos p on p.id = x.producto_id
        left join public.empleados c on c.id = x.creado_por
       where x.ve or x.hora is not null), '[]'::jsonb),
    'campanas', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'inicio', c.inicio, 'fin', c.fin, 'estado', c.estado) order by c.inicio)
                            from public.promo_campanas c
                           where c.deleted_at is null and c.inicio <= p_hasta and c.fin >= p_desde
                             and coalesce(c.estado, '') not in ('Borrador', 'Rechazada', 'Cancelada')), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------- Crear o editar una cita
/** {id?, titulo, tipo, fecha, hora?, duracion?, responsable, invitados?:[empleado_id], ubicacion?, enlace?, prioridad?, notas?} */
create or replace function public.mkt_agenda_guardar(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  yo uuid := app.empleado_id(); v_id uuid := nullif(p ->> 'id', '')::uuid; v_resp uuid := nullif(p ->> 'responsable', '')::uuid;
  v_desc text := btrim(coalesce(p ->> 'titulo', '')); v_tipo text := coalesce(nullif(p ->> 'tipo', ''), 'Reunión');
  v_fecha date := nullif(p ->> 'fecha', '')::date; v_hora time := nullif(p ->> 'hora', '')::time; v_dur int := nullif(p ->> 'duracion', '')::int;
  v_pri text := coalesce(nullif(p ->> 'prioridad', ''), 'Normal'); v_inv text[]; v_resp_ant uuid; a public.actividades; v_quien text;
begin
  if not (app.mkt_coordina() or app.mkt_es_equipo()) then raise exception 'La agenda de Marketing es de quien coordina y su equipo.'; end if;
  if v_desc = '' then raise exception 'Escribe el asunto.'; end if;
  if v_fecha is null then raise exception 'Elige la fecha.'; end if;
  if v_resp is null then raise exception 'Toda cita necesita un responsable.'; end if;
  if not exists (select 1 from app.mkt_agenda_gente() g where g.id = v_resp) then raise exception 'El responsable debe ser alguien de la agenda de Marketing.'; end if;
  if v_hora is not null and (v_dur is null or v_dur < 5 or v_dur > 720) then v_dur := coalesce(case when v_dur between 5 and 720 then v_dur end, 60); end if;
  if v_hora is null then v_dur := null; end if;
  if v_tipo not in ('Reunión', 'Llamada', 'Visita', 'Evento', 'Grabación', 'Recordatorio', 'Capacitación', 'Marketing', 'Otro') then v_tipo := 'Otro'; end if;
  if v_pri not in ('Urgente', 'Importante', 'Normal') then raise exception 'Prioridad no válida.'; end if;
  -- Invitados: correos de gente de la agenda (sin repetir al responsable)
  select coalesce(array_agg(distinct g.email), '{}') into v_inv
    from app.mkt_agenda_gente() g
   where g.email is not null and g.id <> v_resp
     and g.id in (select x::uuid from jsonb_array_elements_text(case when jsonb_typeof(p -> 'invitados') = 'array' then p -> 'invitados' else '[]'::jsonb end) x);
  select nombre into v_quien from public.empleados where id = yo;

  if v_id is null then
    v_id := gen_random_uuid();
    insert into public.actividades (id, codigo, descripcion, tipo, fecha_programada, hora, duracion_min, prioridad, relacionado_con, con_quien,
                                    realiza_id, delegada, delegado_a_id, estado, detalle, origen, area_usuario, ubicacion, enlace_meet, invitados, creado_por)
    values (v_id, 'ACT-' || upper(substr(replace(v_id::text, '-', ''), 1, 8)), left(v_desc, 300), v_tipo, v_fecha, v_hora, v_dur, v_pri, 'Área interna', 'Marketing',
            v_resp, v_resp <> yo, v_resp, 'Por hacer', nullif(btrim(coalesce(p ->> 'notas', '')), ''), 'marketing', 'Marketing',
            nullif(btrim(coalesce(p ->> 'ubicacion', '')), ''), nullif(btrim(coalesce(p ->> 'enlace', '')), ''), v_inv, yo);
    v_resp_ant := yo;
  else
    select * into a from public.actividades where id = v_id and deleted_at is null for update;
    if not found then raise exception 'Cita no encontrada.'; end if;
    if a.mkt_trabajo is not null then raise exception 'Las tareas del Plan de trabajo se cambian en el Plan.'; end if;
    if not app.mkt_agenda_gestiona(a) then raise exception 'Solo quien la creó, su responsable o quien coordina puede cambiarla.'; end if;
    if a.estado in ('Listo', 'Cancelado') then raise exception 'La cita ya está cerrada.'; end if;
    v_resp_ant := coalesce(a.delegado_a_id, a.realiza_id);
    update public.actividades
       set descripcion = left(v_desc, 300), tipo = v_tipo, fecha_programada = v_fecha, hora = v_hora, duracion_min = v_dur, prioridad = v_pri,
           realiza_id = v_resp, delegado_a_id = v_resp, delegada = v_resp <> coalesce(a.creado_por, yo),
           detalle = nullif(btrim(coalesce(p ->> 'notas', '')), ''), ubicacion = nullif(btrim(coalesce(p ->> 'ubicacion', '')), ''),
           enlace_meet = nullif(btrim(coalesce(p ->> 'enlace', '')), ''), invitados = v_inv
     where id = v_id;
  end if;

  -- Avisos: al responsable (si es nuevo para él) y a los invitados que se agregaron
  if v_resp <> yo and v_resp is distinct from v_resp_ant then
    insert into public.notificaciones (id, para_id, modulo, evento, tipo, texto, entidad, entidad_id)
    values (gen_random_uuid(), v_resp, 'marketing', 'agenda_cita', 'info',
            '📅 ' || coalesce(v_quien, 'Marketing') || ' te agendó: ' || left(v_desc, 160) || ' · ' || to_char(v_fecha, 'DD/MM') || coalesce(' ' || to_char(v_hora, 'HH24:MI'), ''), 'actividades', v_id);
  end if;
  insert into public.notificaciones (id, para_id, modulo, evento, tipo, texto, entidad, entidad_id)
  select gen_random_uuid(), g.id, 'marketing', 'agenda_invitacion', 'info',
         '📅 ' || coalesce(v_quien, 'Marketing') || ' te invitó: ' || left(v_desc, 160) || ' · ' || to_char(v_fecha, 'DD/MM') || coalesce(' ' || to_char(v_hora, 'HH24:MI'), ''), 'actividades', v_id
    from app.mkt_agenda_gente() g
   where g.email = any (v_inv) and g.id <> yo
     and (a.id is null or not (g.email = any (select lower(btrim(i)) from unnest(a.invitados) i)));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- Mover (arrastrar): día, hora (null = todo el día) y responsable
create or replace function public.mkt_agenda_mover(p_id uuid, p_fecha date, p_hora time, p_responsable uuid default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare a public.actividades; yo uuid := app.empleado_id(); v_resp uuid; v_nuevo uuid;
begin
  select * into a from public.actividades where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Cita no encontrada.'; end if;
  if a.estado in ('Listo', 'Cancelado') then raise exception 'Ya está cerrada.'; end if;
  if p_fecha is null then raise exception 'Elige el día.'; end if;
  v_resp := coalesce(a.delegado_a_id, a.realiza_id);
  v_nuevo := coalesce(p_responsable, v_resp);
  if a.mkt_trabajo is not null then
    -- Tarea del Plan: cambiar de día o de persona = reglas del Plan; su responsable sí puede ponerle hora
    if p_fecha <> a.fecha_programada or v_nuevo <> v_resp then
      if not (app.mkt_coordina() or (a.creado_por = yo and app.mkt_es_equipo())) then
        raise exception 'Esta tarea del Plan solo la cambia de día o de persona quien coordina o quien la agregó.';
      end if;
      if not exists (select 1 from app.mkt_plan_equipo() q where q.id = v_nuevo) then raise exception 'Las tareas del Plan son del equipo de Marketing.'; end if;
    elsif not (app.mkt_coordina() or a.creado_por = yo or v_resp = yo) then
      raise exception 'Esta tarea es de otra persona.';
    end if;
  else
    if not app.mkt_agenda_gestiona(a) then raise exception 'Solo quien la creó, su responsable o quien coordina puede moverla.'; end if;
    if not exists (select 1 from app.mkt_agenda_gente() g where g.id = v_nuevo) then raise exception 'El responsable debe ser alguien de la agenda de Marketing.'; end if;
  end if;
  update public.actividades
     set fecha_programada = p_fecha, hora = p_hora,
         duracion_min = case when p_hora is null then duracion_min else coalesce(duracion_min, 60) end,
         realiza_id = v_nuevo, delegado_a_id = v_nuevo,
         delegada = case when v_nuevo = v_resp then delegada else v_nuevo <> coalesce(a.creado_por, yo) end
   where id = p_id;
  if v_nuevo <> v_resp and v_nuevo <> yo then
    insert into public.notificaciones (id, para_id, modulo, evento, tipo, texto, entidad, entidad_id)
    values (gen_random_uuid(), v_nuevo, 'marketing', 'agenda_cita', 'info',
            '📅 Te pasaron: ' || left(a.descripcion, 160) || ' · ' || to_char(p_fecha, 'DD/MM') || coalesce(' ' || to_char(p_hora, 'HH24:MI'), ''), 'actividades', p_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------- Cancelar una cita (no las del Plan: esas se cancelan en el Plan)
create or replace function public.mkt_agenda_cancelar(p_id uuid, p_motivo text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare a public.actividades; yo uuid := app.empleado_id(); v_resp uuid;
begin
  select * into a from public.actividades where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Cita no encontrada.'; end if;
  if a.mkt_trabajo is not null then raise exception 'Las tareas del Plan de trabajo se cancelan en el Plan.'; end if;
  if not app.mkt_agenda_gestiona(a) then raise exception 'Solo quien la creó, su responsable o quien coordina puede cancelarla.'; end if;
  if a.estado in ('Listo', 'Cancelado') then raise exception 'Ya está cerrada.'; end if;
  perform app.ag_cerrar_sesion(p_id);
  update public.actividades set estado = 'Cancelado', resultado = left(coalesce(nullif(btrim(p_motivo), ''), 'Cancelada desde la agenda de Marketing'), 500),
         fecha_finalizacion = now(), finalizado_por = yo where id = p_id;
  v_resp := coalesce(a.delegado_a_id, a.realiza_id);
  if v_resp <> yo then
    insert into public.notificaciones (id, para_id, modulo, evento, tipo, texto, entidad, entidad_id)
    values (gen_random_uuid(), v_resp, 'marketing', 'agenda_cita', 'info', '🚫 Se canceló: ' || left(a.descripcion, 160) || ' · ' || to_char(a.fecha_programada, 'DD/MM'), 'actividades', p_id);
  end if;
end;
$$;

revoke all on function public.mkt_agenda(date, date), public.mkt_agenda_guardar(jsonb), public.mkt_agenda_mover(uuid, date, time, uuid), public.mkt_agenda_cancelar(uuid, text) from public, anon;
grant execute on function public.mkt_agenda(date, date), public.mkt_agenda_guardar(jsonb), public.mkt_agenda_mover(uuid, date, time, uuid), public.mkt_agenda_cancelar(uuid, text) to authenticated;

notify pgrst, 'reload schema';
