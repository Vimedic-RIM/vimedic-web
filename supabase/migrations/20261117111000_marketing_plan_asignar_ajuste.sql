-- =====================================================================
-- Ajuste del Plan de trabajo de Marketing (20261117110000): mkt_plan_asignar usaba una variable de tipo
-- record para el producto que fallaba ("record pr is not assigned yet"). Mismo comportamiento con variables simples.
-- =====================================================================

create or replace function public.mkt_plan_asignar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  yo uuid := app.empleado_id(); v_resp uuid := nullif(p ->> 'responsable', '')::uuid; v_trab text := p ->> 'trabajo';
  v_det text := nullif(btrim(coalesce(p ->> 'detalle', '')), ''); v_ins text := nullif(btrim(coalesce(p ->> 'instrucciones', '')), '');
  v_pri text := coalesce(nullif(p ->> 'prioridad', ''), 'Normal'); it jsonb; v_pid uuid; v_pcod text; v_pnom text; v_fecha date; v_id uuid; v_desc text;
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
