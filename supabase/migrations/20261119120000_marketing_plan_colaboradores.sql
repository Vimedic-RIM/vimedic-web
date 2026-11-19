-- =====================================================================
-- Marketing › Plan de trabajo: los colaboradores (el equipo del área Marketing) también agregan tareas.
--   · Toda tarea lleva responsable: una persona del equipo (por defecto, quien la agrega).
--   · Quien agrega ve en el plan sus tareas y las que agregó para otra persona, y puede reprogramarlas,
--     pasarlas a otra persona o cancelarlas; las demás siguen siendo solo de quien coordina.
--   · A quien coordina le llega un aviso de cada tarea que agrega un colaborador.
--   · «Armar la semana» y mover cualquier tarea siguen siendo de quien coordina.
-- (copia de mkt_plan, mkt_plan_asignar, mkt_plan_mover y mkt_plan_cancelar vigentes, con esos cambios)
-- =====================================================================

/** ¿Quien llama es del equipo de Marketing (puede agregar tareas al plan)? */
create or replace function app.mkt_es_equipo() returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from app.mkt_plan_equipo() q where q.id = app.empleado_id());
$$;

/** Quienes coordinan Marketing (para avisarles): rol de Marketing «Coordinación» o permiso aprobar/administrar en Marketing. */
create or replace function app.mkt_coordinadores() returns setof uuid
language sql stable security definer set search_path = public as $$
  select e.id from public.empleados e left join public.roles r on r.id = e.rol_id
   where e.deleted_at is null and e.estado = 'activo'
     and (e.preferencias -> 'marketing' ->> 'rol' = 'Coordinación'
          or coalesce(r.permisos -> 'marketing', '[]'::jsonb) ?| array['aprobar', 'administrar']
          or coalesce(e.permisos_extra -> 'marketing', '[]'::jsonb) ?| array['aprobar', 'administrar']);
$$;
revoke all on function app.mkt_coordinadores() from public, anon, authenticated;

-- ---------------------------------------------------------------- Plan: equipo completo y lo que uno agregó
create or replace function public.mkt_plan(p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_coord boolean; yo uuid := app.empleado_id(); v_cerradas int;
begin
  if not app.puede('marketing', 'ver') then raise exception 'Sin acceso a Marketing.'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 62 then raise exception 'Rango de fechas no válido.'; end if;
  v_cerradas := app.mkt_cerrar_cumplidas();
  v_coord := app.mkt_coordina();
  return jsonb_build_object(
    'coordina', v_coord, 'agrega', v_coord or app.mkt_es_equipo(), 'yo', yo, 'cerradasAhora', v_cerradas,
    -- todo el equipo (para elegir responsable); el tablero de un colaborador solo muestra su fila y la de quienes tienen tareas que agregó
    'equipo', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'nombre', q.nombre, 'foto', q.foto, 'rol', q.rol)) from app.mkt_plan_equipo() q), '[]'::jsonb),
    'tareas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'codigo', a.codigo, 'descripcion', a.descripcion, 'trabajo', a.mkt_trabajo, 'detalle', a.mkt_detalle, 'instrucciones', a.detalle,
               'fecha', a.fecha_programada, 'prioridad', a.prioridad, 'estado', a.estado, 'responsable', coalesce(a.delegado_a_id, a.realiza_id),
               'creadoPor', a.creado_por, 'creador', c.nombre, 'pasos', a.mkt_pasos, 'resultado', a.resultado, 'finalizada', a.fecha_finalizacion, 'creada', a.created_at,
               'devolucion', case when a.estado = 'Devuelto' then a.devolucion end,
               'producto', case when p.id is not null then jsonb_build_object('id', p.id, 'codigo', p.codigo, 'nombre', p.nombre, 'imagen', p.imagen_url, 'publico', p.en_catalogo) end)
             order by a.fecha_programada nulls last, a.prioridad, a.created_at)
        from public.actividades a left join public.productos p on p.id = a.producto_id left join public.empleados c on c.id = a.creado_por
       where a.mkt_trabajo is not null and a.deleted_at is null
         and (v_coord or coalesce(a.delegado_a_id, a.realiza_id) = yo or a.creado_por = yo)
         and ((a.fecha_programada between p_desde and p_hasta)
              or (a.estado not in ('Listo', 'Cancelado') and (a.fecha_programada < p_desde or a.fecha_programada is null)))), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------- Asignar / agregar (coordinación o equipo; siempre con responsable)
create or replace function public.mkt_plan_asignar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  yo uuid := app.empleado_id(); v_resp uuid := nullif(p ->> 'responsable', '')::uuid; v_trab text := p ->> 'trabajo';
  v_det text := nullif(btrim(coalesce(p ->> 'detalle', '')), ''); v_ins text := nullif(btrim(coalesce(p ->> 'instrucciones', '')), '');
  v_pri text := coalesce(nullif(p ->> 'prioridad', ''), 'Normal'); it jsonb; v_pid uuid; v_pcod text; v_pnom text; v_fecha date; v_id uuid; v_desc text;
  v_creadas int := 0; v_omit jsonb := '[]'::jsonb; v_resp_nombre text; a public.actividades;
  v_coord boolean := app.mkt_coordina(); v_ult_id uuid; v_ult_desc text; v_ult_fecha date;
begin
  if not (v_coord or app.mkt_es_equipo()) then raise exception 'Solo el equipo de Marketing o quien lo coordina puede agregar tareas al plan.'; end if;
  if v_trab is null or v_trab not in ('completar', 'fotos', 'video', 'produccion', 'edicion', 'ficha_tecnica', 'documentos_proveedor', 'publicacion', 'otro') then raise exception 'Tipo de trabajo no válido.'; end if;
  if v_pri not in ('Urgente', 'Importante', 'Normal') then raise exception 'Prioridad no válida.'; end if;
  if v_resp is null then raise exception 'Toda tarea necesita un responsable: elige a la persona del equipo.'; end if;
  select q.nombre into v_resp_nombre from app.mkt_plan_equipo() q where q.id = v_resp;
  if v_resp_nombre is null then raise exception 'Elige a una persona del equipo de Marketing.'; end if;
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then raise exception 'Elige al menos un producto.'; end if;
  if jsonb_array_length(p -> 'items') > 40 then raise exception 'Máximo 40 tareas a la vez.'; end if;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    v_fecha := coalesce(nullif(it ->> 'fecha', '')::date, current_date);
    v_pid := null; v_pcod := null; v_pnom := null;
    if nullif(it ->> 'producto_id', '') is not null then
      select id, codigo, nombre into v_pid, v_pcod, v_pnom from public.productos where id = (it ->> 'producto_id')::uuid and deleted_at is null;
      if v_pid is null then v_omit := v_omit || jsonb_build_object('producto', it ->> 'producto_id', 'motivo', 'Producto no encontrado'); continue; end if;
      if exists (select 1 from public.actividades x where x.producto_id = v_pid and x.mkt_trabajo = v_trab and coalesce(x.mkt_detalle, '') = coalesce(v_det, '')
                   and x.deleted_at is null and x.estado not in ('Listo', 'Cancelado')) then
        v_omit := v_omit || jsonb_build_object('producto', v_pnom, 'motivo', 'Ya tiene una tarea abierta de ese tipo'); continue;
      end if;
    elsif v_trab <> 'otro' then
      v_omit := v_omit || jsonb_build_object('producto', '—', 'motivo', 'Falta el producto'); continue;
    end if;
    -- Ficha completa o documentos ya cargados: no tiene sentido pedirlo (se revisa antes de crear la tarea).
    if v_trab in ('completar', 'documentos_proveedor') then
      a := null; a.producto_id := v_pid; a.mkt_trabajo := v_trab; a.mkt_detalle := v_det; a.mkt_base := '{}'::jsonb; a.created_at := now();
      if app.mkt_trabajo_cumplido(a) then
        v_omit := v_omit || jsonb_build_object('producto', v_pnom, 'motivo', case when v_trab = 'completar' then 'La ficha ya está completa' else 'Ya tiene manual y certificados' end);
        continue;
      end if;
    end if;
    v_desc := app.mkt_trabajo_nombre(v_trab) || coalesce(' (' || v_det || ')', '') || coalesce(': ' || v_pnom || ' · ' || v_pcod, coalesce(': ' || v_ins, ''));
    v_id := gen_random_uuid();
    insert into public.actividades (id, codigo, descripcion, tipo, fecha_programada, prioridad, relacionado_con, con_quien, realiza_id, delegada, delegado_a_id,
                                    estado, detalle, origen, area_usuario, producto_id, mkt_trabajo, mkt_detalle, mkt_pasos, mkt_base, creado_por)
    values (v_id, 'ACT-' || upper(substr(replace(v_id::text, '-', ''), 1, 8)), left(v_desc, 300), 'Marketing', v_fecha, v_pri, 'Área interna', 'Marketing', v_resp, v_resp <> yo, v_resp,
            'Por hacer', v_ins, 'marketing', 'Marketing', v_pid, v_trab, v_det, app.mkt_pasos_de(v_trab), coalesce(app.mkt_estado_producto(v_pid), '{}'::jsonb), yo);
    v_creadas := v_creadas + 1; v_ult_id := v_id; v_ult_desc := v_desc; v_ult_fecha := v_fecha;
    if v_resp <> yo then
      insert into public.notificaciones (id, para_id, modulo, evento, tipo, texto, entidad, entidad_id)
      values (gen_random_uuid(), v_resp, 'marketing', 'plan_asignada', 'info', '📌 Te asignaron: ' || left(v_desc, 200) || ' · para el ' || to_char(v_fecha, 'DD/MM'), 'actividades', v_id);
    end if;
  end loop;

  -- Un colaborador agregó tareas: aviso a quienes coordinan (uno por envío)
  if not v_coord and v_creadas > 0 then
    insert into public.notificaciones (id, para_id, modulo, evento, tipo, texto, entidad, entidad_id)
    select gen_random_uuid(), c, 'marketing', 'plan_agregada', 'info',
           '🗂️ ' || coalesce((select e.nombre from public.empleados e where e.id = yo), 'Alguien del equipo') || ' agregó al plan: '
             || case when v_creadas = 1 then left(v_ult_desc, 160) || ' · para el ' || to_char(v_ult_fecha, 'DD/MM') else v_creadas || ' tareas' end
             || ' · responsable: ' || v_resp_nombre,
           'actividades', v_ult_id
      from app.mkt_coordinadores() c where c <> yo and c <> v_resp;
  end if;
  return jsonb_build_object('creadas', v_creadas, 'omitidos', v_omit);
end;
$$;

-- ---------------------------------------------------------------- Mover: quien coordina o quien agregó la tarea
create or replace function public.mkt_plan_mover(p_id uuid, p_fecha date, p_responsable uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare a public.actividades; yo uuid := app.empleado_id(); v_ok boolean;
begin
  select * into a from public.actividades where id = p_id and deleted_at is null and mkt_trabajo is not null for update;
  if not found then raise exception 'Tarea no encontrada.'; end if;
  if not (app.mkt_coordina() or (a.creado_por = yo and app.mkt_es_equipo())) then raise exception 'Solo quien coordina Marketing o quien agregó la tarea puede moverla.'; end if;
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

-- ---------------------------------------------------------------- Cancelar: quien coordina o quien agregó la tarea
create or replace function public.mkt_plan_cancelar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public, app as $$
declare a public.actividades; yo uuid := app.empleado_id();
begin
  select * into a from public.actividades where id = p_id and deleted_at is null and mkt_trabajo is not null for update;
  if not found then raise exception 'Tarea no encontrada.'; end if;
  if not (app.mkt_coordina() or (a.creado_por = yo and app.mkt_es_equipo())) then raise exception 'Solo quien coordina Marketing o quien agregó la tarea puede cancelarla.'; end if;
  if a.estado in ('Listo', 'Cancelado') then raise exception 'La tarea ya está cerrada.'; end if;
  perform app.ag_cerrar_sesion(p_id);
  update public.actividades set estado = 'Cancelado', resultado = left(coalesce(nullif(btrim(p_motivo), ''), 'Cancelada'), 500), fecha_finalizacion = now(), finalizado_por = yo where id = p_id;
end;
$$;

notify pgrst, 'reload schema';
