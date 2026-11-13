-- =====================================================================
-- VIMEDIC · Agenda: lo que faltaba frente al original (Issue #27)
--   · Corregir el tiempo de una actividad terminada (editarTiempoActividad)
--   · Horas acumuladas por proyecto (getProyectosConHoras)
--   · Premios editados solo por quien administra la tienda (guardarPremioAgenda)
--   · Canje con nota y precio esperado (canjearPremioAgenda)
--   · Monedas: solo se mueven por las funciones de la Agenda
--   · Proyectos: editar uno existente solo jefatura (guardarProyecto)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) ¿Puede esta persona gestionar la actividad? Antes, si la actividad no
--    tenía "delegado a", la comparación daba nulo y dejaba pasar a
--    cualquiera con permiso de editar (podía cancelar o terminar tareas
--    ajenas y ganarse la moneda).
-- ---------------------------------------------------------------------
create or replace function app.ag_es_mia(a public.actividades)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app.puede('agenda', 'editar') and (
           app.puede('agenda', 'ver_todos')
        or (app.empleado_id() is not null and (a.creado_por is not distinct from app.empleado_id()
              or a.realiza_id is not distinct from app.empleado_id() or a.delegado_a_id is not distinct from app.empleado_id()))), false)
$$;

-- ---------------------------------------------------------------------
-- 1) Corregir el tiempo de una actividad en estado Listo
--    Pueden: jefatura o quien la creó, la recibió o la cerró. Se exige el
--    tiempo que la persona tenía en pantalla para no pisar otro cambio.
-- ---------------------------------------------------------------------
create or replace function public.ag_editar_tiempo(p_id uuid, p_segundos integer, p_esperados integer)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare a public.actividades; yo uuid := app.empleado_id(); ant int;
begin
  if p_segundos is null or p_segundos < 0 or p_segundos > 359999999 then raise exception 'Ingresa una duración válida en horas y minutos.'; end if;
  if not app.puede('agenda', 'editar') then raise exception 'No tienes permiso para corregir el tiempo de esta actividad.'; end if;
  select * into a from public.actividades where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Actividad no encontrada.'; end if;
  if a.estado <> 'Listo' then raise exception 'Solo puedes editar el tiempo de una actividad en estado Listo.'; end if;
  if not (app.puede('agenda', 'ver_todos') or (yo is not null and (a.creado_por is not distinct from yo or a.delegado_a_id is not distinct from yo or a.finalizado_por is not distinct from yo))) then
    raise exception 'No tienes permiso para corregir el tiempo de esta actividad.';
  end if;
  ant := coalesce(a.segundos_trabajados, 0);
  if p_esperados is distinct from ant then raise exception 'El tiempo cambió desde que abriste la tarjeta. Actualiza y vuelve a intentarlo.'; end if;
  if p_segundos = ant then return jsonb_build_object('segundos', ant); end if;
  update public.actividades set segundos_trabajados = p_segundos,
    ajustes_tiempo = coalesce(ajustes_tiempo, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', yo, 'anterior', ant, 'nuevo', p_segundos)),
    historial_tiempo = coalesce(historial_tiempo, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('fecha', to_char(now() at time zone 'America/Guayaquil', 'DD/MM/YYYY'), 'segundos', p_segundos - ant, 'ajuste', true))
  where id = p_id;
  return jsonb_build_object('segundos', p_segundos);
end;
$$;
revoke all on function public.ag_editar_tiempo(uuid, integer, integer) from public, anon;
grant execute on function public.ag_editar_tiempo(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Horas acumuladas por proyecto (suma del tiempo de sus actividades).
--    Solo jefatura, que es quien ve la lista completa de proyectos.
-- ---------------------------------------------------------------------
create or replace function public.ag_proyectos_horas()
returns table (proyecto_id uuid, segundos bigint, actividades bigint)
language sql stable security definer set search_path = public, app as $$
  select a.proyecto_id, coalesce(sum(a.segundos_trabajados), 0)::bigint, count(*)::bigint
  from public.actividades a
  where app.puede('agenda', 'ver_todos') and a.proyecto_id is not null and a.deleted_at is null
  group by a.proyecto_id
$$;
revoke all on function public.ag_proyectos_horas() from public, anon;
grant execute on function public.ag_proyectos_horas() to authenticated;

-- ---------------------------------------------------------------------
-- 3) Premios: crear / editar solo quien administra la tienda
-- ---------------------------------------------------------------------
create or replace function public.ag_guardar_premio(p jsonb)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_nombre text := btrim(coalesce(p->>'nombre', '')); v_costo numeric;
  v_emoji text := left(btrim(coalesce(nullif(p->>'emoji', ''), '🎁')), 20);
  v_cat text := left(btrim(coalesce(nullif(p->>'categoria', ''), 'Otros')), 60);
  v_desc text := left(btrim(coalesce(p->>'descripcion', '')), 500);
  v_activo boolean := coalesce((p->>'activo')::boolean, true);
begin
  if not app.puede('agenda', 'administrar') then raise exception 'Solo quien administra la tienda puede realizar esta acción.'; end if;
  begin v_costo := (p->>'costo')::numeric; exception when others then v_costo := null; end;
  if v_nombre = '' or length(v_nombre) > 150 or v_costo is null or v_costo < 1 or v_costo > 100000 or v_costo <> trunc(v_costo) then
    raise exception 'Completa nombre y un costo entero entre 1 y 100.000.';
  end if;
  if v_id is not null then
    update public.premios_agenda set emoji = v_emoji, nombre = v_nombre, costo = v_costo::int, categoria = v_cat, descripcion = nullif(v_desc, ''), activo = v_activo
    where id = v_id and deleted_at is null;
    if not found then raise exception 'Premio no encontrado.'; end if;
    return v_id;
  end if;
  v_id := gen_random_uuid();
  insert into public.premios_agenda (id, codigo, emoji, nombre, costo, categoria, descripcion, activo)
  values (v_id, 'PREMIO-' || left(v_id::text, 8), v_emoji, v_nombre, v_costo::int, v_cat, nullif(v_desc, ''), v_activo);
  return v_id;
end;
$$;
revoke all on function public.ag_guardar_premio(jsonb) from public, anon;
grant execute on function public.ag_guardar_premio(jsonb) to authenticated;

-- La tienda devuelve también la descripción de cada premio.
create or replace function public.ag_economia()
returns jsonb language plpgsql security definer set search_path = public as $$
declare yo uuid := app.empleado_id(); admin boolean := app.puede('agenda', 'administrar'); v_total int; dias int; compl int; hoy int; racha int := 0; d date; v_idx int := 1; lim int[] := array[0, 7, 21, 45, 90];
  nombres text[] := array['Organizado', 'Constante', 'Productivo', 'Experto', 'Pro Vimedic']; i int;
begin
  if not app.puede('agenda', 'ver') then raise exception 'Sin acceso a la Agenda'; end if;
  select coalesce(sum(cambio), 0) into v_total from public.monedas_movimientos where empleado_id = yo and deleted_at is null;
  select count(distinct (fecha at time zone 'America/Guayaquil')::date), count(distinct actividad_id) into dias, compl from public.monedas_movimientos where empleado_id = yo and cambio > 0 and motivo like 'Actividad completada:%' and deleted_at is null;
  select count(*) into hoy from public.monedas_movimientos where empleado_id = yo and cambio > 0 and motivo like 'Actividad completada:%' and (fecha at time zone 'America/Guayaquil')::date = (now() at time zone 'America/Guayaquil')::date and deleted_at is null;
  d := (now() at time zone 'America/Guayaquil')::date;
  if not exists (select 1 from public.monedas_movimientos where empleado_id = yo and cambio > 0 and motivo like 'Actividad completada:%' and (fecha at time zone 'America/Guayaquil')::date = d) then d := d - 1; end if;
  while exists (select 1 from public.monedas_movimientos where empleado_id = yo and cambio > 0 and motivo like 'Actividad completada:%' and (fecha at time zone 'America/Guayaquil')::date = d) loop racha := racha + 1; d := d - 1; end loop;
  for i in 1..5 loop if dias >= lim[i] then v_idx := i; end if; end loop;
  return jsonb_build_object('total', v_total, 'admin', admin, 'hoy', hoy, 'racha', racha,
    'nivel', jsonb_build_object('numero', v_idx, 'nombre', nombres[v_idx], 'dias', dias, 'completadas', compl, 'minimo', lim[v_idx], 'siguiente', case when v_idx < 5 then lim[v_idx + 1] end),
    'historial', coalesce((select jsonb_agg(h) from (select jsonb_build_object('id', id, 'fecha', fecha, 'cambio', cambio, 'motivo', motivo,
        'tipo', case when codigo like 'CANJE-%' then 'canje' when codigo like 'DEV-%' then 'devolucion' when cambio < 0 then 'penalizacion' else 'ganancia' end) h
      from public.monedas_movimientos where empleado_id = yo and deleted_at is null order by fecha desc limit 20) z), '[]'::jsonb),
    'premios', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'emoji', emoji, 'nombre', nombre, 'costo', costo, 'categoria', categoria, 'descripcion', coalesce(descripcion, ''), 'activo', activo) order by costo) from public.premios_agenda where deleted_at is null and (activo or admin)), '[]'::jsonb),
    'canjes', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'fecha', m.fecha, 'premio', m.meta->>'nombre', 'emoji', m.meta->>'emoji', 'costo', (m.meta->>'costo')::int, 'nota', m.meta->>'nota', 'usuario', e.nombre, 'propio', m.empleado_id = yo,
        'estado', case when exists (select 1 from public.monedas_movimientos r where r.meta->>'canje' = m.id::text and r.deleted_at is null) then 'Cancelado' else coalesce(m.meta->>'estado', 'Pendiente') end) order by m.fecha desc)
      from public.monedas_movimientos m join public.empleados e on e.id = m.empleado_id where m.codigo like 'CANJE-%' and m.deleted_at is null and (admin or m.empleado_id = yo)), '[]'::jsonb));
end;
$$;
revoke all on function public.ag_economia() from public, anon;
grant execute on function public.ag_economia() to authenticated;

-- ---------------------------------------------------------------------
-- 4) Canje con nota y precio esperado ("El precio cambió…")
-- ---------------------------------------------------------------------
drop function if exists public.ag_canjear(uuid, text);
create or replace function public.ag_canjear(p_premio uuid, p_nota text default null, p_costo integer default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare yo uuid := app.empleado_id(); p public.premios_agenda; saldo int; v_nombre text;
begin
  if yo is null or not app.puede('agenda', 'ver') then raise exception 'Sin acceso a la Agenda'; end if;
  select * into p from public.premios_agenda where id = p_premio and activo and deleted_at is null;
  if not found then raise exception 'Este premio ya no está disponible.'; end if;
  if p_costo is not null and p_costo <> p.costo then raise exception 'El precio cambió. Actualiza la tienda antes de confirmar.'; end if;
  if p.costo < 1 then raise exception 'El premio tiene un costo inválido.'; end if;
  perform pg_advisory_xact_lock(hashtext('ag_monedas_' || yo::text));
  select coalesce(sum(cambio), 0) into saldo from public.monedas_movimientos where empleado_id = yo and deleted_at is null;
  if saldo < p.costo then raise exception 'No tienes monedas suficientes para este premio.'; end if;
  select nombre into v_nombre from public.empleados where id = yo;
  insert into public.monedas_movimientos (id, codigo, empleado_id, cambio, motivo, meta)
  values (gen_random_uuid(), 'CANJE-' || gen_random_uuid(), yo, -p.costo, 'Canje: ' || p.nombre,
    jsonb_build_object('tipo', 'canje', 'premioId', p.id, 'nombre', p.nombre, 'emoji', p.emoji, 'costo', p.costo, 'estado', 'Pendiente', 'nombreUsuario', coalesce(v_nombre, ''), 'nota', left(btrim(coalesce(p_nota, '')), 500)));
end;
$$;
revoke all on function public.ag_canjear(uuid, text, integer) from public, anon;
grant execute on function public.ag_canjear(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Permisos de las tablas
--    · monedas_movimientos: nadie escribe directo (solo las funciones de la
--      Agenda); cada quien ve sus movimientos y la administración de la
--      tienda ve todos.
--    · premios_agenda: escribir solo quien administra la tienda.
--    · proyectos: crear cualquiera con permiso de crear; editar (y enviar a
--      la papelera o restaurar) solo jefatura.
-- ---------------------------------------------------------------------
drop policy if exists rls_crear on public.monedas_movimientos;
drop policy if exists rls_editar on public.monedas_movimientos;
drop policy if exists rls_ver on public.monedas_movimientos;
create policy rls_ver on public.monedas_movimientos for select to authenticated
  using (app.puede('agenda', 'administrar'));

drop policy if exists rls_crear on public.premios_agenda;
drop policy if exists rls_editar on public.premios_agenda;
create policy rls_crear on public.premios_agenda for insert to authenticated with check (app.puede('agenda', 'administrar'));
create policy rls_editar on public.premios_agenda for update to authenticated
  using (app.puede('agenda', 'administrar')) with check (app.puede('agenda', 'administrar'));

drop policy if exists rls_editar on public.proyectos;
create policy rls_editar on public.proyectos for update to authenticated
  using (app.puede('agenda', 'editar') and app.puede('agenda', 'ver_todos'))
  with check (app.puede('agenda', 'editar') and app.puede('agenda', 'ver_todos'));

-- · actividades: desde la pantalla solo se editan los datos de la actividad.
--   El estado, el tiempo, las monedas, la revisión y el cierre se mueven
--   únicamente con las funciones de la Agenda (si no, alguien podría poner
--   "moneda otorgada = 0" a su tarea y volver a cobrarla).
revoke update on public.actividades from anon, authenticated;
grant update (descripcion, ubicacion, proyecto_id, tipo, fecha_programada, hora, duracion_min, prioridad, relacionado_con, con_quien,
  delegada, delegado_a_id, requiere_supervision, detalle, evidencia_url, enlace_relacionado, invitados, enlace_meet, agregar_calendar, deleted_at)
  on public.actividades to authenticated;

notify pgrst, 'reload schema';
