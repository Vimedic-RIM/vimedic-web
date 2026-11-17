-- =====================================================================
-- Marketing › Plan de trabajo (mejoras):
--   · El equipo es solo la gente del área Marketing en Empleados («Rol / Área» o «Departamento»), con su rol de
--     Marketing: Asistente (todo lo del producto) o Audiovisual (videos). Quien coordina sin ser del área ya no sale.
--   · Videos por etapas: «Producción de video» (guion y grabación) y «Edición de video», cada una en su día.
--     Se cierran solas cuando el producto tiene un video nuevo (del tipo pedido); la producción también a mano.
--   · mkt_plan_estado_producto: lo que le falta a un producto, para el formulario del día.
-- =====================================================================

alter table public.actividades drop constraint if exists actividades_mkt_trabajo_check;
alter table public.actividades add constraint actividades_mkt_trabajo_check
  check (mkt_trabajo in ('completar', 'fotos', 'video', 'produccion', 'edicion', 'ficha_tecnica', 'documentos_proveedor', 'publicacion', 'otro'));

-- ---------------------------------------------------------------- Equipo: solo el área Marketing
create or replace function app.mkt_plan_equipo() returns table (id uuid, nombre text, foto text, rol text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre, e.foto_url,
         case when e.preferencias -> 'marketing' ->> 'rol' in ('Asistente', 'Audiovisual', 'Coordinación') then e.preferencias -> 'marketing' ->> 'rol'
              when lower(coalesce(e.cargo, '')) ~ 'audiovisual|productor|video' then 'Audiovisual'
              else 'Asistente' end
    from public.empleados e
   where e.deleted_at is null and e.estado = 'activo'
     and (lower(coalesce(e.cargo, '')) like '%marketing%' or lower(coalesce(e.departamento, '')) like '%marketing%'
          or lower(coalesce(e.cargo, '')) ~ 'audiovisual')
   order by e.nombre;
$$;

-- ---------------------------------------------------------------- Nombres, pasos y cierre de los trabajos nuevos
create or replace function app.mkt_trabajo_nombre(p text) returns text
language sql immutable as $$
  select case p when 'completar' then 'Completar ficha' when 'fotos' then 'Fotos' when 'video' then 'Video'
    when 'produccion' then 'Producción de video' when 'edicion' then 'Edición de video'
    when 'ficha_tecnica' then 'Ficha técnica' when 'documentos_proveedor' then 'Documentos del proveedor'
    when 'publicacion' then 'Publicación' else 'Tarea' end;
$$;

create or replace function app.mkt_pasos_de(p text) returns jsonb
language sql immutable as $$
  select coalesce((select jsonb_agg(jsonb_build_object('t', x, 'hecho', false)) from unnest(case p
    when 'completar' then array['Descripción y características', 'Especificaciones técnicas', 'Imagen principal y 3 fotos', 'Enviar a revisión']
    when 'fotos' then array['Sesión de fotos', 'Edición', 'Subir a la galería']
    when 'video' then array['Guion', 'Grabación', 'Edición', 'Subir y enviar a revisión']
    when 'produccion' then array['Guion y lista de tomas', 'Preparar equipo, lugar y producto', 'Grabación', 'Respaldar el material grabado']
    when 'edicion' then array['Elegir las tomas', 'Edición: cortes, música, textos y logo', 'Revisión', 'Subir a la galería del producto']
    when 'ficha_tecnica' then array['Revisar datos técnicos', 'Generar la ficha técnica', 'Revisión']
    when 'documentos_proveedor' then array['Pedir el material al proveedor', 'Recibir manual / hoja de datos y certificados', 'Revisar y subir a Documentos técnicos']
    when 'publicacion' then array['Copy', 'Diseño o video', 'Programar en el Planificador']
    else array[]::text[] end) x), '[]'::jsonb);
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
    when 'video', 'produccion', 'edicion' then
      -- Un video nuevo en la galería del producto (del tipo pedido, si se pidió uno) cierra la producción y la edición.
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

-- ---------------------------------------------------------------- Lo que le falta a un producto (formulario del día)
create or replace function public.mkt_plan_estado_producto(p_producto uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.puede('marketing', 'ver') then raise exception 'Sin acceso a Marketing.'; end if;
  return app.mkt_estado_producto(p_producto)
    || jsonb_build_object('abiertas', coalesce((select jsonb_agg(distinct a.mkt_trabajo) from public.actividades a
                                                 where a.producto_id = p_producto and a.mkt_trabajo is not null and a.deleted_at is null
                                                   and a.estado not in ('Listo', 'Cancelado')), '[]'::jsonb));
end;
$$;
revoke all on function public.mkt_plan_estado_producto(uuid) from public, anon;
grant execute on function public.mkt_plan_estado_producto(uuid) to authenticated;

-- ---------------------------------------------------------------- Asignar: acepta los trabajos nuevos (mismo comportamiento)
create or replace function public.mkt_plan_asignar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  yo uuid := app.empleado_id(); v_resp uuid := nullif(p ->> 'responsable', '')::uuid; v_trab text := p ->> 'trabajo';
  v_det text := nullif(btrim(coalesce(p ->> 'detalle', '')), ''); v_ins text := nullif(btrim(coalesce(p ->> 'instrucciones', '')), '');
  v_pri text := coalesce(nullif(p ->> 'prioridad', ''), 'Normal'); it jsonb; v_pid uuid; v_pcod text; v_pnom text; v_fecha date; v_id uuid; v_desc text;
  v_creadas int := 0; v_omit jsonb := '[]'::jsonb; v_resp_nombre text; a public.actividades;
begin
  if not app.mkt_coordina() then raise exception 'Solo quien coordina Marketing puede asignar tareas.'; end if;
  if v_trab is null or v_trab not in ('completar', 'fotos', 'video', 'produccion', 'edicion', 'ficha_tecnica', 'documentos_proveedor', 'publicacion', 'otro') then raise exception 'Tipo de trabajo no válido.'; end if;
  if v_pri not in ('Urgente', 'Importante', 'Normal') then raise exception 'Prioridad no válida.'; end if;
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
    v_creadas := v_creadas + 1;
    if v_resp <> yo then
      insert into public.notificaciones (id, para_id, modulo, evento, tipo, texto, entidad, entidad_id)
      values (gen_random_uuid(), v_resp, 'marketing', 'plan_asignada', 'info', '📌 Te asignaron: ' || left(v_desc, 200) || ' · para el ' || to_char(v_fecha, 'DD/MM'), 'actividades', v_id);
    end if;
  end loop;
  return jsonb_build_object('creadas', v_creadas, 'omitidos', v_omit);
end;
$$;

notify pgrst, 'reload schema';
