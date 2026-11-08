-- =====================================================================
-- VIMEDIC · Módulo Mi Agenda
-- Cronómetro (un solo activo por persona), cierre, devolución, revisión,
-- monedas (ganar / perder / canjear premios) y evidencias.
-- =====================================================================
alter table public.monedas_movimientos add column if not exists meta jsonb;

insert into storage.buckets (id, name, public, file_size_limit)
values ('agenda', 'agenda', false, 26214400)
on conflict (id) do nothing;
drop policy if exists agenda_storage_ver on storage.objects;
create policy agenda_storage_ver on storage.objects for select to authenticated using (bucket_id = 'agenda' and app.puede('agenda', 'ver'));
drop policy if exists agenda_storage_subir on storage.objects;
create policy agenda_storage_subir on storage.objects for insert to authenticated with check (bucket_id = 'agenda' and app.puede('agenda', 'crear'));

-- Cada persona ve lo suyo (lo que creó, realiza o le delegaron); "ver_todos" (jefatura) ve todo
drop policy if exists rls_ver on public.actividades;
create policy rls_ver on public.actividades for select to authenticated
  using (app.puede('agenda', 'ver') and (
           creado_por = app.empleado_id() or realiza_id = app.empleado_id() or delegado_a_id = app.empleado_id() or app.puede('agenda', 'ver_todos'))
         and (deleted_at is null or app.puede('agenda', 'eliminar')));
drop policy if exists rls_editar on public.actividades;
create policy rls_editar on public.actividades for update to authenticated
  using (app.puede('agenda', 'editar') and (creado_por = app.empleado_id() or realiza_id = app.empleado_id() or delegado_a_id = app.empleado_id() or app.puede('agenda', 'ver_todos')))
  with check (app.puede('agenda', 'editar'));

-- Premios iniciales de la tienda
insert into public.premios_agenda (id, codigo, emoji, nombre, costo, categoria, activo)
select gen_random_uuid(), x.c, x.e, x.n, x.k, x.g, true
from (values ('dulce','🍬','Caramelo / chocolate',30,'Sabores'),('bebida','🥤','Bebida',50,'Sabores'),('papas','🍟','Papas fritas',60,'Sabores'),('cafe','☕','Café especial',60,'Sabores'),
  ('desayuno','🥐','Snack / desayuno',100,'Sabores'),('comida','🍔','Cupón de comida',180,'Sabores'),('descanso15','⏰','15 minutos adicionales de descanso',120,'Tiempo'),
  ('descanso30','😴','30 minutos adicionales de descanso',220,'Tiempo'),('libre1','🕐','1 hora libre',400,'Tiempo'),('entrada','🌅','Entrar 30 minutos más tarde un día',350,'Tiempo'),
  ('salida','🏃','Salir 30 minutos antes',350,'Tiempo'),('almuerzo','🍕','Almuerzo pagado por la empresa',450,'Sabores'),('cine','🎬','Entrada al cine',500,'Experiencias'),
  ('gift','🎁','Gift card',600,'Experiencias'),('libre2','🕐','2 horas libres',750,'Tiempo'),('medio','🏆','Medio día libre',1200,'Tiempo')) as x(c, e, n, k, g)
where not exists (select 1 from public.premios_agenda);

-- Personas y áreas para delegar
create or replace function public.ag_empleados()
returns table (id uuid, nombre text, email text, area text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre, e.email, coalesce(nullif(btrim(e.departamento), ''), nullif(btrim(e.cargo), ''), 'Sin área')
  from public.empleados e where app.puede('agenda', 'ver') and e.estado = 'activo' and e.deleted_at is null order by e.nombre
$$;
revoke all on function public.ag_empleados() from public, anon;
grant execute on function public.ag_empleados() to authenticated;

-- Cierra la sesión del cronómetro de una actividad y suma el tiempo
create or replace function app.ag_cerrar_sesion(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.actividades; seg int;
begin
  select * into a from public.actividades where id = p_id;
  if not found or a.ultima_sesion is null or a.ultima_sesion->>'inicio' is null then return; end if;
  seg := greatest(0, floor((extract(epoch from now()) * 1000 - (a.ultima_sesion->>'inicio')::numeric) / 1000))::int;
  update public.actividades set segundos_trabajados = segundos_trabajados + seg,
    historial_tiempo = historial_tiempo || jsonb_build_array(jsonb_build_object('fecha', to_char(now() at time zone 'America/Guayaquil', 'DD/MM/YYYY'), 'segundos', seg)),
    veces_pausada = veces_pausada + 1, ultima_sesion = null, estado = case when estado = 'En marcha' then 'Pausado' else estado end
  where id = p_id;
end;
$$;
revoke all on function app.ag_cerrar_sesion(uuid) from public, anon, authenticated;

-- ¿Puede esta persona gestionar la actividad? (quien la creó, realiza o recibió, o jefatura)
create or replace function app.ag_es_mia(a public.actividades)
returns boolean language sql stable security definer set search_path = public as $$
  select app.puede('agenda', 'editar') and (a.creado_por = app.empleado_id() or a.realiza_id = app.empleado_id() or a.delegado_a_id = app.empleado_id() or app.puede('agenda', 'ver_todos'))
$$;

create or replace function public.ag_iniciar(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.actividades; yo uuid := app.empleado_id(); o record;
begin
  select * into a from public.actividades where id = p_id and deleted_at is null for update;
  if not found or not app.ag_es_mia(a) then raise exception 'Actividad no encontrada.'; end if;
  if a.estado in ('Listo', 'Cancelado') then raise exception 'Esta actividad ya está cerrada.'; end if;
  if a.estado = 'En marcha' and a.ultima_sesion->>'por' = yo::text then return; end if;
  for o in select id from public.actividades where estado = 'En marcha' and ultima_sesion->>'por' = yo::text and id <> p_id loop perform app.ag_cerrar_sesion(o.id); end loop;
  update public.actividades set estado = 'En marcha', veces_iniciada = veces_iniciada + 1,
    ultima_sesion = jsonb_build_object('inicio', floor(extract(epoch from now()) * 1000), 'por', yo) where id = p_id;
end;
$$;
create or replace function public.ag_pausar(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.actividades;
begin
  select * into a from public.actividades where id = p_id and deleted_at is null;
  if not found or not app.ag_es_mia(a) then raise exception 'Actividad no encontrada.'; end if;
  perform app.ag_cerrar_sesion(p_id);
end;
$$;

-- Cambio de estado simple (arrastrar la tarjeta): Por hacer, Pausado o Cancelado
create or replace function public.ag_estado(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.actividades;
begin
  if p_estado not in ('Por hacer', 'Pausado', 'Cancelado') then raise exception 'Ese estado no se puede asignar arrastrando la tarjeta.'; end if;
  select * into a from public.actividades where id = p_id and deleted_at is null;
  if not found or not app.ag_es_mia(a) then raise exception 'Actividad no encontrada.'; end if;
  perform app.ag_cerrar_sesion(p_id);
  update public.actividades set estado = p_estado where id = p_id;
end;
$$;

create or replace function public.ag_finalizar(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.actividades; yo uuid := app.empleado_id(); gano boolean := false; seg int; ant int;
begin
  if btrim(coalesce(p->>'resultado', '')) = '' then raise exception 'Describe brevemente el resultado obtenido.'; end if;
  select * into a from public.actividades where id = p_id and deleted_at is null for update;
  if not found or not app.ag_es_mia(a) then raise exception 'Actividad no encontrada.'; end if;
  perform app.ag_cerrar_sesion(p_id);
  select * into a from public.actividades where id = p_id;
  update public.actividades set estado = 'Listo', resultado = btrim(p->>'resultado'), quedo_pendiente = coalesce((p->>'quedoPendiente') = 'Sí', false),
    fecha_retomar = case when (p->>'quedoPendiente') = 'Sí' then nullif(p->>'fechaRetomar', '')::date end, evidencia_final_url = nullif(p->>'evidenciaFinal', ''),
    fecha_finalizacion = now(), finalizado_por = yo where id = p_id;
  if nullif(p->>'segundos', '') is not null then
    seg := (p->>'segundos')::int; ant := a.segundos_trabajados;
    if seg >= 0 and seg <> ant then
      update public.actividades set segundos_trabajados = seg,
        ajustes_tiempo = ajustes_tiempo || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', yo, 'anterior', ant, 'nuevo', seg)),
        historial_tiempo = historial_tiempo || jsonb_build_array(jsonb_build_object('fecha', to_char(now() at time zone 'America/Guayaquil', 'DD/MM/YYYY'), 'segundos', seg - ant, 'ajuste', true)) where id = p_id;
    end if;
  end if;
  if a.moneda_otorgada = 0 then
    insert into public.monedas_movimientos (id, codigo, empleado_id, cambio, motivo, actividad_id) values (gen_random_uuid(), 'MON-' || gen_random_uuid(), yo, 1, 'Actividad completada: ' || a.descripcion, p_id);
    update public.actividades set moneda_otorgada = 1 where id = p_id; gano := true;
  end if;
  return jsonb_build_object('monedaGanada', gano);
end;
$$;

create or replace function public.ag_devolver(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a public.actividades; v_a uuid := nullif(p->>'aQuien', '')::uuid;
begin
  if coalesce(p->>'motivo', '') = '' then raise exception 'Selecciona el motivo de la devolución.'; end if;
  if btrim(coalesce(p->>'comentario', '')) = '' then raise exception 'Indica qué necesita corregirse o completarse.'; end if;
  if v_a is null then raise exception 'Selecciona a quién se devuelve la actividad.'; end if;
  select * into a from public.actividades where id = p_id and deleted_at is null;
  if not found or not app.ag_es_mia(a) then raise exception 'Actividad no encontrada.'; end if;
  perform app.ag_cerrar_sesion(p_id);
  update public.actividades set estado = 'Devuelto', calificacion = null, delegado_a_id = v_a,
    devolucion = jsonb_build_object('motivo', p->>'motivo', 'comentario', btrim(p->>'comentario'), 'devuelto_a', v_a, 'fecha_limite', nullif(p->>'fechaLimite', ''), 'evidencia', nullif(p->>'evidencia', ''), 'fecha', now()),
    comentario_calificacion = 'Corregir' where id = p_id;
  insert into public.notificaciones (para_id, modulo, evento, tipo, texto, entidad, entidad_id)
  values (v_a, 'agenda', 'devuelta', 'aviso', 'Actividad devuelta para corregir: "' || a.descripcion || '" — ' || (p->>'motivo'), 'actividades', p_id);
end;
$$;

create or replace function public.ag_calificar(p_id uuid, p_calificacion text, p_comentario text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.actividades;
begin
  select * into a from public.actividades where id = p_id and deleted_at is null;
  if not found or not (a.creado_por = app.empleado_id() or app.puede('agenda', 'ver_todos')) then raise exception 'Solo quien delegó la actividad o jefatura pueden revisarla.'; end if;
  update public.actividades set comentario_calificacion = left(coalesce(p_comentario, ''), 1000), calificado_por = app.empleado_id(), fecha_calificacion = now(),
    requiere_supervision = false, calificacion = case when p_calificacion = 'Aprobado' then 10 else null end where id = p_id;
end;
$$;

-- Tarea vencida sin completar: pierde 1 moneda (una sola vez)
create or replace function public.ag_revisar_vencidas()
returns integer language plpgsql security definer set search_path = public as $$
declare a public.actividades; n int := 0; v_resp uuid;
begin
  if not app.puede('agenda', 'ver') then return 0; end if;
  for a in select * from public.actividades where deleted_at is null and estado not in ('Listo', 'Cancelado') and moneda_penalizada = 0 and fecha_programada is not null and fecha_programada < (now() at time zone 'America/Guayaquil')::date loop
    v_resp := coalesce(a.delegado_a_id, a.creado_por);
    if v_resp is not null then
      insert into public.monedas_movimientos (id, codigo, empleado_id, cambio, motivo, actividad_id) values (gen_random_uuid(), 'MON-' || gen_random_uuid(), v_resp, -1, 'Tarea vencida sin completar: ' || a.descripcion, a.id);
    end if;
    update public.actividades set moneda_penalizada = 1 where id = a.id; n := n + 1;
  end loop;
  return n;
end;
$$;

-- Monedas, nivel, tienda y canjes de la persona (o todos los canjes si administra la tienda)
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
    'premios', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'emoji', emoji, 'nombre', nombre, 'costo', costo, 'categoria', categoria, 'activo', activo) order by costo) from public.premios_agenda where deleted_at is null and (activo or admin)), '[]'::jsonb),
    'canjes', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'fecha', m.fecha, 'premio', m.meta->>'nombre', 'emoji', m.meta->>'emoji', 'costo', (m.meta->>'costo')::int, 'nota', m.meta->>'nota', 'usuario', e.nombre, 'propio', m.empleado_id = yo,
        'estado', case when exists (select 1 from public.monedas_movimientos r where r.meta->>'canje' = m.id::text and r.deleted_at is null) then 'Cancelado' else coalesce(m.meta->>'estado', 'Pendiente') end) order by m.fecha desc)
      from public.monedas_movimientos m join public.empleados e on e.id = m.empleado_id where m.codigo like 'CANJE-%' and m.deleted_at is null and (admin or m.empleado_id = yo)), '[]'::jsonb));
end;
$$;
revoke all on function public.ag_economia() from public, anon;
grant execute on function public.ag_economia() to authenticated;

create or replace function public.ag_canjear(p_premio uuid, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare yo uuid := app.empleado_id(); p public.premios_agenda; saldo int;
begin
  select * into p from public.premios_agenda where id = p_premio and activo and deleted_at is null;
  if not found then raise exception 'Este premio ya no está disponible.'; end if;
  perform pg_advisory_xact_lock(hashtext('ag_monedas_' || yo::text));
  select coalesce(sum(cambio), 0) into saldo from public.monedas_movimientos where empleado_id = yo and deleted_at is null;
  if saldo < p.costo then raise exception 'No tienes monedas suficientes para este premio.'; end if;
  insert into public.monedas_movimientos (id, codigo, empleado_id, cambio, motivo, meta)
  values (gen_random_uuid(), 'CANJE-' || gen_random_uuid(), yo, -p.costo, 'Canje: ' || p.nombre, jsonb_build_object('tipo', 'canje', 'premioId', p.id, 'nombre', p.nombre, 'emoji', p.emoji, 'costo', p.costo, 'estado', 'Pendiente', 'nota', left(coalesce(p_nota, ''), 500)));
end;
$$;
revoke all on function public.ag_canjear(uuid, text) from public, anon;
grant execute on function public.ag_canjear(uuid, text) to authenticated;

create or replace function public.ag_gestionar_canje(p_id uuid, p_accion text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.monedas_movimientos;
begin
  if not app.puede('agenda', 'administrar') then raise exception 'Solo quien administra la tienda puede realizar esta acción.'; end if;
  if p_accion not in ('Entregado', 'Cancelado') then raise exception 'Acción inválida.'; end if;
  select * into m from public.monedas_movimientos where id = p_id and codigo like 'CANJE-%' for update;
  if not found then raise exception 'Canje no encontrado.'; end if;
  if exists (select 1 from public.monedas_movimientos r where r.meta->>'canje' = p_id::text) then
    if p_accion = 'Cancelado' then return; end if; raise exception 'El canje ya fue cancelado.';
  end if;
  if m.meta->>'estado' = 'Entregado' then if p_accion = 'Entregado' then return; end if; raise exception 'Un canje entregado no se puede cancelar.'; end if;
  if p_accion = 'Cancelado' then
    insert into public.monedas_movimientos (id, codigo, empleado_id, cambio, motivo, meta) values (gen_random_uuid(), 'DEV-' || gen_random_uuid(), m.empleado_id, (m.meta->>'costo')::int, 'Devolución de canje: ' || (m.meta->>'nombre'), jsonb_build_object('tipo', 'devolucion', 'canje', p_id));
  else
    update public.monedas_movimientos set meta = meta || jsonb_build_object('estado', 'Entregado', 'fechaEntrega', now()) where id = p_id;
  end if;
end;
$$;
revoke all on function public.ag_gestionar_canje(uuid, text) from public, anon;
grant execute on function public.ag_gestionar_canje(uuid, text) to authenticated;
