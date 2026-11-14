-- Módulo 11 · Empleados (datos laborales) y Solicitudes del personal — Issue #31
-- Igual que SolicitudesPersonal.gs / Data Empleados.gs (vmEmpDatosLaborales_) de la app original:
--   Empleado → Pendiente jefe → (jefe aprueba) Pendiente TTHH → (TTHH valida) Aprobada.
--   Vacaciones por Código del Trabajo Art. 69; el saldo se descuenta una sola vez al aprobar.
--   Lo confidencial (motivo y documento de permisos médicos) no lo ve el jefe.
-- Todo cambio pasa por funciones de la base: la tabla deja de aceptar escrituras directas.

-- =====================================================================
-- 1) Empleados: datos laborales válidos y jefe inmediato sin ciclos
-- =====================================================================
create or replace function app.th_hoy() returns date language sql stable as $$
  select (now() at time zone 'America/Guayaquil')::date;
$$;

create table if not exists public.th_auditoria (
  id               uuid primary key default gen_random_uuid(),
  fecha            timestamptz not null default now(),
  usuario_id       uuid references public.empleados(id) on delete set null,
  usuario_email    text,
  rol              text,
  accion           text not null,
  solicitud_id     uuid references public.th_solicitudes(id) on delete set null,
  solicitud_codigo text,
  empleado_id      uuid references public.empleados(id) on delete set null,
  antes            jsonb,
  despues          jsonb,
  detalle          text
);
select app.estandarizar('public.th_auditoria');
create index if not exists th_auditoria_fecha_idx on public.th_auditoria (fecha desc);
alter table public.th_auditoria enable row level security;
drop policy if exists th_auditoria_ver on public.th_auditoria;
create policy th_auditoria_ver on public.th_auditoria for select to authenticated using (app.es_superadmin());

create or replace function app.tg_empleado_laboral() returns trigger
language plpgsql security definer set search_path = public as $$
declare p uuid; pasos int := 0; cambio boolean := tg_op = 'INSERT';
begin
  if new.jefe_id is not null and (tg_op = 'INSERT' or new.jefe_id is distinct from old.jefe_id) then
    if new.jefe_id = new.id then raise exception 'Un empleado no puede ser su propio jefe inmediato.'; end if;
    if not exists (select 1 from public.empleados where id = new.jefe_id and deleted_at is null and estado = 'activo' and coalesce(estado_laboral, '') <> 'Retirado') then
      raise exception 'El jefe inmediato debe ser un empleado activo.';
    end if;
    p := new.jefe_id;
    while p is not null and pasos < 60 loop
      select jefe_id into p from public.empleados where id = p;
      if p = new.id then raise exception 'Esa asignación crea un ciclo: el jefe elegido depende (directa o indirectamente) de este empleado.'; end if;
      pasos := pasos + 1;
    end loop;
  end if;
  if new.fecha_ingreso is not null and (tg_op = 'INSERT' or new.fecha_ingreso is distinct from old.fecha_ingreso) and new.fecha_ingreso > app.th_hoy() then
    raise exception 'La fecha de ingreso no puede estar en el futuro.';
  end if;
  if nullif(new.estado_laboral, '') is not null and (tg_op = 'INSERT' or new.estado_laboral is distinct from old.estado_laboral)
     and new.estado_laboral not in ('Activo', 'En vacaciones', 'Licencia', 'Suspendido', 'Retirado') then
    raise exception 'Estado laboral no válido.';
  end if;
  if tg_op = 'INSERT' or new.saldo_inicial_vacaciones is distinct from old.saldo_inicial_vacaciones or new.fecha_corte_vacaciones is distinct from old.fecha_corte_vacaciones then
    if new.saldo_inicial_vacaciones is null then new.fecha_corte_vacaciones := null;
    elsif new.saldo_inicial_vacaciones < 0 or new.saldo_inicial_vacaciones > 400 then raise exception 'El saldo inicial de vacaciones no es válido.';
    elsif new.fecha_corte_vacaciones is null then new.fecha_corte_vacaciones := app.th_hoy();
    end if;
  end if;
  -- Auditoría de los datos laborales (como solAuditar_ 'Datos laborales del empleado').
  if tg_op = 'UPDATE' and (new.fecha_ingreso, new.jefe_id, new.saldo_inicial_vacaciones, new.fecha_corte_vacaciones, new.estado_laboral, new.departamento, new.jornada_laboral, new.hora_entrada, new.hora_salida)
     is distinct from (old.fecha_ingreso, old.jefe_id, old.saldo_inicial_vacaciones, old.fecha_corte_vacaciones, old.estado_laboral, old.departamento, old.jornada_laboral, old.hora_entrada, old.hora_salida) then
    insert into public.th_auditoria (usuario_id, usuario_email, rol, accion, empleado_id, antes, despues, detalle)
    select e.id, e.email, '', 'Datos laborales del empleado', new.id,
      jsonb_build_object('fechaIngreso', old.fecha_ingreso, 'jefeId', old.jefe_id, 'saldoInicial', old.saldo_inicial_vacaciones, 'fechaCorte', old.fecha_corte_vacaciones, 'estadoLaboral', old.estado_laboral, 'departamento', old.departamento, 'jornada', old.jornada_laboral, 'horaEntrada', old.hora_entrada, 'horaSalida', old.hora_salida),
      jsonb_build_object('fechaIngreso', new.fecha_ingreso, 'jefeId', new.jefe_id, 'saldoInicial', new.saldo_inicial_vacaciones, 'fechaCorte', new.fecha_corte_vacaciones, 'estadoLaboral', new.estado_laboral, 'departamento', new.departamento, 'jornada', new.jornada_laboral, 'horaEntrada', new.hora_entrada, 'horaSalida', new.hora_salida),
      new.email
    from (select 1) x left join public.empleados e on e.auth_user_id = auth.uid() and e.deleted_at is null;
  end if;
  return new;
end $$;
drop trigger if exists empleados_laboral on public.empleados;
create trigger empleados_laboral before insert or update on public.empleados for each row execute function app.tg_empleado_laboral();

-- Foto del empleado subida desde Empleados (subirFotoEmpleado): carpeta empleados/ del bucket público de avatares.
drop policy if exists avatares_empleados on storage.objects;
create policy avatares_empleados on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and name like 'empleados/%' and app.puede('empleados', 'editar'));

-- mi_perfil: indica si la persona tiene personal a cargo (para mostrar la bandeja de Solicitudes).
create or replace function public.mi_perfil()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'nombre', e.nombre,
    'email', e.email,
    'empresa', e.empresa,
    'cargo', e.cargo,
    'departamento', e.departamento,
    'foto_url', e.foto_url,
    'jefe_id', e.jefe_id,
    'rol', r.nombre,
    'rol_crm', r.rol_crm,
    'es_superadmin', app.es_superadmin(),
    'permisos', app.permisos_actuales(),
    'es_jefe', exists (select 1 from public.empleados s where s.jefe_id = e.id and s.id <> e.id and s.deleted_at is null)
  )
  from public.empleados e
  left join public.roles r on r.id = e.rol_id
  where e.auth_user_id = auth.uid() and e.estado = 'activo' and e.deleted_at is null;
$$;
revoke all on function public.mi_perfil() from public, anon;
grant execute on function public.mi_perfil() to authenticated;

-- =====================================================================
-- 2) Configuración, documentos y permisos de las tablas
-- =====================================================================
create table if not exists public.th_configuracion (
  id     uuid primary key default gen_random_uuid(),
  clave  text not null unique,
  valor  jsonb not null default '{}'::jsonb
);
select app.estandarizar('public.th_configuracion');
select app.aplicar_rls('public.th_configuracion', array['talento_humano'], array['seguridad']);

-- Documentos de respaldo: almacenamiento PRIVADO (solCarpeta_ privada en Drive).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('talento-humano', 'talento-humano', false, 8388608, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- La solicitud es del usuario, de su jefe directo (si no es confidencial) o de Talento Humano.
create or replace function app.th_doc_permitido(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.th_solicitudes s left join public.empleados e on e.id = s.empleado_id
    where s.documento_drive_id = p_ruta and s.deleted_at is null and (
      s.empleado_id = app.empleado_id()
      or app.puede('talento_humano', 'ver')
      or (not s.confidencial and app.empleado_id() is not null and (s.jefe_id = app.empleado_id() or e.jefe_id = app.empleado_id()))
    ));
$$;
revoke all on function app.th_doc_permitido(text) from public, anon;
grant execute on function app.th_doc_permitido(text) to authenticated;

drop policy if exists th_docs_subir on storage.objects;
create policy th_docs_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'talento-humano' and name like 'solicitudes/' || app.empleado_id()::text || '/%');
drop policy if exists th_docs_ver on storage.objects;
create policy th_docs_ver on storage.objects for select to authenticated
  using (bucket_id = 'talento-humano' and (name like 'solicitudes/' || app.empleado_id()::text || '/%' or app.th_doc_permitido(name)));

-- Las solicitudes y el saldo solo cambian por las funciones de abajo (antes un jefe podía
-- aprobar directo en la tabla y veía el motivo de los permisos confidenciales).
drop policy if exists th_solicitudes_crear on public.th_solicitudes;
drop policy if exists th_solicitudes_editar on public.th_solicitudes;
drop policy if exists th_solicitudes_ver on public.th_solicitudes;
create policy th_solicitudes_ver on public.th_solicitudes for select to authenticated using (
  deleted_at is null and (empleado_id = app.empleado_id() or app.puede('talento_humano', 'ver')));
drop policy if exists th_vacaciones_admin on public.th_vacaciones_movimientos;

-- =====================================================================
-- 3) Reglas de vacaciones (solConfig_, solDiasAnio_, solGenerados_, solDiasRango_, solSaldo_)
-- =====================================================================
create or replace function app.th_config() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('conteo', 'calendario', 'devengo', 'anual', 'diasBase', 15, 'adicionalDesdeAnio', 6, 'adicionalMax', 15,
    'feriados', '[]'::jsonb, 'horasPorDia', 8, 'correo', true, 'diasMinAnticipacion', 0)
    || coalesce((select valor from public.th_configuracion where clave = 'solicitudes' and deleted_at is null), '{}'::jsonb);
$$;

create or replace function app.th_dias_anio(p_n int, c jsonb) returns numeric language sql immutable as $$
  select (c ->> 'diasBase')::numeric + greatest(0, case when p_n >= (c ->> 'adicionalDesdeAnio')::int
    then least(p_n - (c ->> 'adicionalDesdeAnio')::int + 1, (c ->> 'adicionalMax')::int) else 0 end);
$$;

create or replace function app.th_anios(p_ingreso date, p_hasta date) returns int language sql immutable as $$
  select case when p_ingreso is null or p_hasta is null or p_hasta < p_ingreso then 0 else extract(year from age(p_hasta, p_ingreso))::int end;
$$;

create or replace function app.th_generados(p_ingreso date, p_hasta date, c jsonb) returns numeric language plpgsql immutable as $$
declare n int := app.th_anios(p_ingreso, p_hasta); total numeric := 0; aniv date; sig date;
begin
  if p_ingreso is null or p_hasta is null or p_hasta < p_ingreso then return 0; end if;
  for i in 1..n loop total := total + app.th_dias_anio(i, c); end loop;
  if c ->> 'devengo' = 'proporcional' then
    aniv := (p_ingreso + make_interval(years => n))::date; sig := (p_ingreso + make_interval(years => n + 1))::date;
    total := total + least(1, greatest(0, (p_hasta - aniv)::numeric / nullif(sig - aniv, 0))) * app.th_dias_anio(n + 1, c);
  end if;
  return total;
end $$;

create or replace function app.th_antiguedad(p_ingreso date) returns text language plpgsql stable as $$
declare a interval; y int; m int;
begin
  if p_ingreso is null then return 'Sin fecha de ingreso'; end if;
  if p_ingreso > app.th_hoy() then return '0 día(s)'; end if;
  a := age(app.th_hoy(), p_ingreso); y := extract(year from a); m := extract(month from a);
  if y = 0 and m = 0 then return (app.th_hoy() - p_ingreso) || ' día(s)'; end if;
  return trim(case when y > 0 then y || case when y = 1 then ' año' else ' años' end else '' end
    || case when y > 0 and m > 0 then ' y ' else '' end
    || case when m > 0 then m || case when m = 1 then ' mes' else ' meses' end else '' end);
end $$;

create or replace function app.th_dias_rango(p_ini date, p_fin date, c jsonb) returns int language sql stable as $$
  select case when p_ini is null or p_fin is null or p_fin < p_ini then 0 else (
    select count(*)::int from generate_series(p_ini, least(p_fin, p_ini + 800), interval '1 day') g(d)
    where c ->> 'conteo' <> 'laborables'
       or (extract(isodow from g.d) < 6 and not coalesce(c -> 'feriados', '[]'::jsonb) ? to_char(g.d, 'YYYY-MM-DD'))) end;
$$;

create or replace function app.th_emp_activo(e public.empleados) returns boolean language sql immutable as $$
  select e.deleted_at is null and e.estado = 'activo' and coalesce(e.estado_laboral, '') <> 'Retirado';
$$;

/** Saldo de vacaciones de un empleado (solSaldo_). p_excluir deja fuera una solicitud de lo comprometido. */
create or replace function app.th_saldo(p_emp uuid, p_excluir uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.empleados; c jsonb := app.th_config(); hoy date := app.th_hoy(); gen numeric := 0; nota text := '';
  mas numeric; usados numeric; comp numeric; acum numeric; disp numeric; n int;
begin
  select * into e from public.empleados where id = p_emp;
  if e.id is null then return null; end if;
  if e.fecha_ingreso is not null then
    if e.saldo_inicial_vacaciones is not null then
      gen := e.saldo_inicial_vacaciones + greatest(0, app.th_generados(e.fecha_ingreso, hoy, c) - app.th_generados(e.fecha_ingreso, coalesce(e.fecha_corte_vacaciones, e.fecha_ingreso), c));
    else gen := app.th_generados(e.fecha_ingreso, hoy, c);
    end if;
  else
    gen := coalesce(e.saldo_inicial_vacaciones, 0);
    nota := 'Falta la fecha de ingreso en Empleados: no se pueden calcular las vacaciones por antigüedad.';
  end if;
  select coalesce(sum(dias) filter (where tipo <> 'Reverso' and dias >= 0), 0),
         coalesce(sum(-dias) filter (where tipo <> 'Reverso' and dias < 0), 0) - coalesce(sum(dias) filter (where tipo = 'Reverso'), 0)
    into mas, usados from public.th_vacaciones_movimientos where empleado_id = p_emp and deleted_at is null;
  select coalesce(sum(dias_vacaciones), 0) into comp from public.th_solicitudes
    where empleado_id = p_emp and deleted_at is null and estado in ('Pendiente jefe', 'Pendiente TTHH') and (p_excluir is null or id <> p_excluir);
  acum := round(gen + mas, 2); disp := round(acum - usados, 2); n := app.th_anios(e.fecha_ingreso, hoy);
  return jsonb_build_object('acumulados', acum, 'utilizados', round(usados, 2), 'disponibles', disp, 'comprometidos', round(comp, 2),
    'disponiblesReales', round(disp - comp, 2), 'diasPorAnio', case when e.fecha_ingreso is not null then app.th_dias_anio(n + 1, c) else (c ->> 'diasBase')::numeric end,
    'aniosServicio', n, 'antiguedad', app.th_antiguedad(e.fecha_ingreso), 'nota', nota);
end $$;

-- =====================================================================
-- 4) Roles, vista, historial, auditoría y avisos
-- =====================================================================
create or replace function app.th_roles() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'yo', app.empleado_id(),
    'esAdmin', app.es_superadmin(),
    'esTTHH', app.puede('talento_humano', 'ver'),
    'validaTTHH', app.es_superadmin() or (app.puede('talento_humano', 'ver') and app.puede('talento_humano', 'editar')),
    'esJefe', exists (select 1 from public.empleados s where s.jefe_id = app.empleado_id() and s.id <> app.empleado_id() and s.deleted_at is null));
$$;

create or replace function app.th_rol_txt(r jsonb) returns text language sql immutable as $$
  select case when (r ->> 'esAdmin')::boolean then 'Administrador' when (r ->> 'validaTTHH')::boolean then 'Talento Humano'
    when (r ->> 'esJefe')::boolean then 'Jefe inmediato' else 'Empleado' end;
$$;

create or replace function app.th_estado_txt(p text) returns text language sql immutable as $$
  select case p when 'Pendiente jefe' then 'Pendiente de aprobación del jefe inmediato' when 'Pendiente TTHH' then 'Pendiente de validación TTHH'
    when 'Aprobada' then 'Aprobada definitivamente' else p end;
$$;

/** ¿Puede el usuario ver esta solicitud? (solAlcance_) */
create or replace function app.th_alcance(s public.th_solicitudes, r jsonb) returns text language sql stable security definer set search_path = public as $$
  select case
    when (r ->> 'esAdmin')::boolean or (r ->> 'esTTHH')::boolean then 'tthh'
    when s.empleado_id = (r ->> 'yo')::uuid then 'propia'
    when (r ->> 'yo') is not null and (s.jefe_id = (r ->> 'yo')::uuid or (select jefe_id from public.empleados where id = s.empleado_id) = (r ->> 'yo')::uuid) then 'jefe'
    else '' end;
$$;

/** Versión para la pantalla: oculta lo confidencial al jefe (solVista_). */
create or replace function app.th_vista(s public.th_solicitudes, r jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare al text := app.th_alcance(s, r); e public.empleados; j public.empleados; snap jsonb := coalesce(s.datos -> 'empleado', '{}'::jsonb);
  o jsonb; ocultar boolean;
begin
  select * into e from public.empleados where id = s.empleado_id;
  select * into j from public.empleados where id = s.jefe_id;
  ocultar := al = 'jefe' and s.confidencial;
  o := jsonb_build_object(
    'id', s.id, 'codigo', s.codigo, 'tipo', s.tipo, 'subtipo', coalesce(s.subtipo, ''), 'estado', s.estado, 'estadoTxt', app.th_estado_txt(s.estado),
    'fecha', s.fecha_solicitud, 'empleadoId', s.empleado_id, 'empleadoNombre', coalesce(snap ->> 'nombre', e.nombre, ''), 'empleadoEmail', coalesce(snap ->> 'email', e.email, ''),
    'cedula', coalesce(snap ->> 'cedula', e.cedula, ''), 'cargo', coalesce(snap ->> 'cargo', e.cargo, ''), 'departamento', coalesce(snap ->> 'departamento', e.departamento, ''),
    'jefeId', s.jefe_id, 'jefeNombre', coalesce(j.nombre, s.datos -> 'jefe' ->> 'nombre', ''),
    'modalidad', coalesce(s.modalidad, ''), 'fechaInicio', s.fecha_inicio, 'fechaFin', s.fecha_fin, 'fechaReincorporacion', s.fecha_reincorporacion,
    'horaInicio', coalesce(to_char(s.hora_inicio, 'HH24:MI'), ''), 'horaFin', coalesce(to_char(s.hora_fin, 'HH24:MI'), ''),
    'duracion', coalesce(s.duracion, 0), 'unidad', coalesce(s.unidad, ''), 'diasVacaciones', coalesce(s.dias_vacaciones, 0),
    'motivo', case when ocultar then 'Información confidencial: solo la ven el empleado y Talento Humano.' else coalesce(s.motivo, '') end,
    'observaciones', coalesce(s.observaciones, ''), 'confidencial', s.confidencial, 'requiereExcepcion', s.requiere_excepcion, 'excepcionMotivo', coalesce(s.excepcion_motivo, ''),
    'tieneDocumento', s.documento_drive_id is not null, 'documentoNombre', coalesce(s.documento_nombre, ''),
    'puedeVerDocumento', s.documento_drive_id is not null and not ocultar,
    'jefeDecision', coalesce(s.jefe_decision, ''), 'jefeDecisionPor', coalesce((select nombre from public.empleados where id = s.jefe_decision_por), ''),
    'jefeDecisionFecha', s.jefe_decision_fecha, 'jefeObservacion', coalesce(s.jefe_observacion, ''),
    'tthhDecision', coalesce(s.tthh_decision, ''), 'tthhDecisionPor', coalesce((select nombre from public.empleados where id = s.tthh_decision_por), ''),
    'tthhDecisionFecha', s.tthh_decision_fecha, 'tthhObservacion', case when ocultar then '' else coalesce(s.tthh_observacion, '') end,
    'horasAutorizadas', s.horas_autorizadas, 'horasTrabajadas', s.horas_trabajadas, 'horasCompensadas', s.horas_compensadas, 'verificadaPago', s.verificada_pago,
    'descuentoId', coalesce(s.descuento_codigo, ''), 'version', s.version, 'alcance', al,
    'historial', case when ocultar then (select coalesce(jsonb_agg(case when h ->> 'rol' in ('Talento Humano', 'Administrador') then h || '{"nota":""}'::jsonb else h end), '[]'::jsonb)
                   from jsonb_array_elements(s.historial) h) else s.historial end,
    'datos', case when al = 'tthh' then s.datos else jsonb_build_object('tipoPermiso', s.datos -> 'tipoPermiso') end);
  return o;
end $$;

create or replace function app.th_hist(h jsonb, r jsonb, accion text, estado text, nota text, sistema boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(h, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('fecha', now(),
    'por', case when sistema then 'Sistema' else coalesce((select nombre from public.empleados where id = (r ->> 'yo')::uuid), '') end,
    'email', case when sistema then '' else coalesce((select email from public.empleados where id = (r ->> 'yo')::uuid), '') end,
    'rol', case when sistema then '' else app.th_rol_txt(r) end, 'accion', accion, 'estado', estado, 'nota', coalesce(nota, '')));
$$;

create or replace function app.th_auditar(r jsonb, p_accion text, s public.th_solicitudes, p_emp uuid, p_antes jsonb, p_despues jsonb, p_detalle text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.th_auditoria (usuario_id, usuario_email, rol, accion, solicitud_id, solicitud_codigo, empleado_id, antes, despues, detalle)
  values ((r ->> 'yo')::uuid, (select email from public.empleados where id = (r ->> 'yo')::uuid), app.th_rol_txt(r), p_accion, s.id, s.codigo,
    coalesce(s.empleado_id, p_emp), p_antes, p_despues, left(coalesce(p_detalle, ''), 500));
  perform app.auditar('talento_humano', 'Solicitudes · ' || p_accion, coalesce(s.codigo, ''), 'OK', left(coalesce(p_detalle, ''), 200));
end $$;

/** Aviso interno en la campana. NUNCA incluye motivo, diagnóstico ni documentos (solNotificar_). */
create or replace function app.th_notificar(p_para uuid[], s public.th_solicitudes, p_evento text, p_modulo text) returns void
language plpgsql security definer set search_path = public as $$
declare tipo_txt text; v_nombre text;
begin
  tipo_txt := case s.tipo when 'Permiso' then 'Permiso' || case when s.confidencial then '' else ' · ' || coalesce(s.subtipo, '') end
    when 'Horas' then 'Horas · ' || coalesce(s.subtipo, '') else 'Vacaciones' end;
  v_nombre := coalesce(s.datos -> 'empleado' ->> 'nombre', (select e.nombre from public.empleados e where e.id = s.empleado_id), '');
  insert into public.notificaciones (para_id, modulo, evento, tipo, texto, entidad, entidad_id)
  select distinct x, p_modulo, 'solicitud', 'aviso', p_evento || ' — ' || s.codigo || ' · ' || tipo_txt || ' · ' || v_nombre || ' · ' || app.th_estado_txt(s.estado), 'th_solicitudes', s.id
  from unnest(p_para) x where x is not null and exists (select 1 from public.empleados e where e.id = x and e.deleted_at is null);
end $$;

/** Personas con acceso a Talento Humano (solCorreosTTHH_). */
create or replace function app.th_personal_tthh() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(e.id), '{}') from public.empleados e left join public.roles r on r.id = e.rol_id
  where app.th_emp_activo(e) and ((coalesce(r.permisos, '{}'::jsonb) || coalesce(e.permisos_extra, '{}'::jsonb)) -> 'talento_humano') ? 'ver';
$$;

create or replace function app.th_txt(v text, n int) returns text language sql immutable as $$
  select left(btrim(regexp_replace(coalesce(v, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g')), n);
$$;

create or replace function app.th_hora(v text) returns time language plpgsql immutable as $$
declare m text[];
begin
  m := regexp_match(coalesce(v, ''), '^\s*(\d{1,2}):(\d{2})');
  if m is null or m[1]::int > 23 or m[2]::int > 59 then return null; end if;
  return make_time(m[1]::int, m[2]::int, 0);
end $$;

create or replace function app.th_fecha(v text) returns date language plpgsql immutable as $$
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return left(v, 10)::date;
exception when others then return null;
end $$;

/** Rango para detectar solapes (solIntervalo_). */
create or replace function app.th_rango(p_tipo text, p_modalidad text, p_ini date, p_fin date, p_hi time, p_hf time) returns tsrange language sql immutable as $$
  select case when p_ini is null then null
    when (p_tipo = 'Horas' or (p_tipo = 'Permiso' and p_modalidad = 'horas')) and p_hi is not null and p_hf is not null
      then tsrange(p_ini + p_hi, p_ini + p_hf, '[)')
    else tsrange(p_ini::timestamp, (coalesce(p_fin, p_ini) + 1)::timestamp, '[)') end;
$$;

create or replace function app.th_buscar(p_id uuid) returns public.th_solicitudes language plpgsql security definer set search_path = public as $$
declare s public.th_solicitudes;
begin
  select * into s from public.th_solicitudes where id = p_id and deleted_at is null for update;
  if s.id is null then raise exception 'No se encontró la solicitud.'; end if;
  return s;
end $$;

create or replace function app.th_version(s public.th_solicitudes, p_version int) returns void language plpgsql as $$
begin
  if p_version is not null and s.version <> p_version then
    raise exception 'Otra persona actualizó esta solicitud hace un momento. Recarga para ver su estado actual.';
  end if;
end $$;

-- =====================================================================
-- 5) Funciones de la pantalla
-- =====================================================================
/** Crea una solicitud de vacaciones, permiso u horas (vmSolCrear). */
create or replace function public.th_sol_crear(d jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := app.th_roles(); c jsonb := app.th_config(); hoy date := app.th_hoy(); yo public.empleados; jefe public.empleados;
  v_tipo text; v_sub text := ''; v_mod text := ''; v_ini date; v_fin date; v_rein date; v_hi time; v_hf time; v_dur numeric := 0; v_uni text := '';
  v_dias numeric := 0; v_conf boolean := false; v_motivo text := app.th_txt(d ->> 'motivo', 2000); v_obs text := app.th_txt(d ->> 'observaciones', 1000);
  t public.th_tipos_permiso; v_key text := app.th_txt(d ->> 'requestId', 80); previa public.th_solicitudes; s public.th_solicitudes;
  saldo jsonb; v_exc boolean := false; v_exc_mot text := ''; v_cod text; v_doc text; v_doc_nom text; rng tsrange; otro record; en_unidad numeric; v_snap jsonb;
  v_horas text[] := array['Recuperación de horas', 'Compensación de horas', 'Autorización de horas adicionales', 'Salida anticipada', 'Ingreso tardío', 'Otro motivo relacionado con horarios'];
begin
  select * into yo from public.empleados where id = (r ->> 'yo')::uuid and deleted_at is null;
  if yo.id is null then raise exception 'Tu cuenta no está registrada en Empleados. Pide a Talento Humano que te agregue.'; end if;
  v_tipo := case lower(coalesce(d ->> 'tipo', '')) when 'vacaciones' then 'Vacaciones' when 'permiso' then 'Permiso' when 'horas' then 'Horas' end;
  if v_tipo is null then raise exception 'Tipo de solicitud no válido.'; end if;
  if not app.th_emp_activo(yo) then raise exception 'Tu estado laboral no permite registrar solicitudes. Consulta con Talento Humano.'; end if;
  select * into jefe from public.empleados where id = yo.jefe_id and deleted_at is null;
  if jefe.id is null or jefe.id = yo.id then raise exception 'No tienes un jefe inmediato asignado. Pide a Talento Humano que lo configure en Empleados (se elige de la lista de empleados).'; end if;
  if not app.th_emp_activo(jefe) then raise exception 'Tu jefe inmediato (%) no está activo. Pide a Talento Humano que actualice tu ficha.', jefe.nombre; end if;
  if v_key !~ '^[\w-]{8,80}$' then raise exception 'Solicitud sin identificador de envío. Recarga la página.'; end if;

  if v_tipo = 'Vacaciones' then
    v_ini := app.th_fecha(d ->> 'fechaInicio'); v_fin := app.th_fecha(d ->> 'fechaFin'); v_rein := app.th_fecha(d ->> 'fechaReincorporacion');
    if v_ini is null or v_fin is null then raise exception 'Indica fechas de inicio y fin válidas.'; end if;
    if v_fin < v_ini then raise exception 'La fecha de finalización no puede ser anterior a la de inicio.'; end if;
    if v_ini < hoy then raise exception 'Las vacaciones no pueden empezar en una fecha pasada.'; end if;
    if v_fin - v_ini > 120 then raise exception 'El período es demasiado largo. Revisa las fechas.'; end if;
    if (c ->> 'diasMinAnticipacion')::int > 0 and v_ini - hoy < (c ->> 'diasMinAnticipacion')::int then
      raise exception 'Las vacaciones se solicitan con al menos % día(s) de anticipación.', c ->> 'diasMinAnticipacion';
    end if;
    v_rein := coalesce(v_rein, v_fin + 1);
    if v_rein <= v_fin then raise exception 'La fecha de reincorporación debe ser posterior a la fecha de finalización.'; end if;
    v_dias := app.th_dias_rango(v_ini, v_fin, c); v_dur := v_dias; v_uni := 'días'; v_mod := 'días';
    if v_dias <= 0 then raise exception 'El rango elegido no tiene días que cuenten como vacaciones (%).', case when c ->> 'conteo' = 'laborables' then 'solo fines de semana o feriados' else 'revisa las fechas' end; end if;
  elsif v_tipo = 'Permiso' then
    select * into t from public.th_tipos_permiso where id::text = coalesce(d ->> 'subtipoId', '') and activo and deleted_at is null;
    if t.id is null then raise exception 'Elige un tipo de permiso válido.'; end if;
    v_sub := t.nombre; v_conf := t.confidencial; v_mod := case when d ->> 'modalidad' = 'horas' then 'horas' else 'días' end;
    v_ini := app.th_fecha(d ->> 'fechaInicio');
    if v_ini is null then raise exception 'Indica la fecha de inicio del permiso.'; end if;
    if v_ini < hoy - 30 then raise exception 'No se puede registrar un permiso con más de 30 días de atraso. Consulta con Talento Humano.'; end if;
    if v_mod = 'horas' then
      v_hi := app.th_hora(d ->> 'horaInicio'); v_hf := app.th_hora(d ->> 'horaFin');
      if v_hi is null or v_hf is null then raise exception 'Indica la hora de salida y la hora de retorno.'; end if;
      if v_hf <= v_hi then raise exception 'La hora de retorno debe ser posterior a la hora de salida.'; end if;
      v_fin := v_ini; v_dur := round(extract(epoch from v_hf - v_hi) / 3600, 2); v_uni := 'horas';
    else
      v_fin := coalesce(app.th_fecha(d ->> 'fechaFin'), v_ini);
      if v_fin < v_ini then raise exception 'La fecha de finalización no puede ser anterior a la de inicio.'; end if;
      if v_fin - v_ini > 120 then raise exception 'El período es demasiado largo. Revisa las fechas.'; end if;
      v_dur := v_fin - v_ini + 1; v_uni := 'días'; v_hi := app.th_hora(d ->> 'horaInicio'); v_hf := app.th_hora(d ->> 'horaFin');
    end if;
    if coalesce(t.duracion_maxima, 0) > 0 and nullif(t.unidad_maxima, '') is not null then
      en_unidad := case when t.unidad_maxima = v_uni then v_dur when t.unidad_maxima = 'horas' then v_dur * (c ->> 'horasPorDia')::numeric else v_dur / (c ->> 'horasPorDia')::numeric end;
      if en_unidad > t.duracion_maxima + 0.000000001 then raise exception 'El permiso "%" admite como máximo % %.', t.nombre, t.duracion_maxima::float, t.unidad_maxima; end if;
    end if;
    if t.afecta_vacaciones then
      v_dias := case when v_uni = 'días' then app.th_dias_rango(v_ini, v_fin, c) else round(v_dur / (c ->> 'horasPorDia')::numeric, 2) end;
    end if;
    if t.requiere_documento and coalesce(d -> 'documento' ->> 'ruta', '') = '' then raise exception 'El permiso "%" requiere un documento de respaldo.', t.nombre; end if;
    if v_motivo = '' then raise exception 'Explica el motivo del permiso.'; end if;
  else
    v_sub := coalesce(d ->> 'subtipo', '');
    if not v_sub = any (v_horas) then raise exception 'Elige el tipo de solicitud de horas.'; end if;
    v_ini := app.th_fecha(d ->> 'fechaInicio');
    if v_ini is null then raise exception 'Indica la fecha correspondiente.'; end if;
    v_hi := app.th_hora(d ->> 'horaInicio'); v_hf := app.th_hora(d ->> 'horaFin');
    if v_hi is null or v_hf is null then raise exception 'Indica la hora de inicio y la de finalización.'; end if;
    if v_hf <= v_hi then raise exception 'La hora de finalización debe ser posterior a la de inicio.'; end if;
    if v_motivo = '' then raise exception 'Escribe la justificación.'; end if;
    v_mod := 'horas'; v_fin := v_ini; v_dur := round(extract(epoch from v_hf - v_hi) / 3600, 2); v_uni := 'horas';
  end if;

  -- Un envío a la vez: número correlativo, solapes y saldo sin carreras (solLock_).
  perform pg_advisory_xact_lock(hashtext('th_solicitudes'));
  select * into previa from public.th_solicitudes where request_key = v_key and empleado_id = yo.id;
  if previa.id is not null then return jsonb_build_object('ok', true, 'repetida', true, 'solicitud', app.th_vista(previa, r)); end if;

  rng := app.th_rango(v_tipo, v_mod, v_ini, v_fin, v_hi, v_hf);
  for otro in select codigo, tipo, subtipo, app.th_rango(tipo, modalidad, fecha_inicio, fecha_fin, hora_inicio, hora_fin) as rg
    from public.th_solicitudes where empleado_id = yo.id and deleted_at is null and estado not in ('Rechazada', 'Cancelada') loop
    if rng is not null and otro.rg is not null and rng && otro.rg then
      raise exception 'Ya tienes la solicitud % (%) en esas fechas/horas. No se permiten solicitudes superpuestas.', otro.codigo, otro.tipo || case when coalesce(otro.subtipo, '') <> '' then ' · ' || otro.subtipo else '' end;
    end if;
  end loop;

  if v_dias > 0 then
    saldo := app.th_saldo(yo.id);
    if v_dias > (saldo ->> 'disponiblesReales')::numeric + 0.000000001 then
      if not coalesce((d ->> 'solicitarExcepcion')::boolean, false) then
        raise exception 'No tienes saldo suficiente: pides % día(s) y te quedan % (disponibles %, comprometidos en otras solicitudes %). Puedes enviarla como excepción para que Talento Humano la autorice.',
          v_dias::float, (saldo ->> 'disponiblesReales')::float, (saldo ->> 'disponibles')::float, (saldo ->> 'comprometidos')::float;
      end if;
      v_exc_mot := app.th_txt(d ->> 'motivoExcepcion', 500);
      if v_exc_mot = '' then raise exception 'Explica por qué pides la excepción de saldo.'; end if;
      v_exc := true;
    end if;
  end if;

  -- Documento de respaldo ya subido por el empleado a su carpeta privada.
  v_doc := nullif(d -> 'documento' ->> 'ruta', '');
  if v_doc is not null then
    if v_doc not like 'solicitudes/' || yo.id::text || '/%' or not exists (select 1 from storage.objects where bucket_id = 'talento-humano' and name = v_doc) then
      raise exception 'No se encontró el documento adjunto. Vuelve a elegirlo.';
    end if;
    v_doc_nom := coalesce(nullif(regexp_replace(app.th_txt(d -> 'documento' ->> 'nombre', 80), '[^\w.\- ]', '', 'g'), ''), 'documento');
  end if;

  select 'SOL-' || extract(year from hoy)::int || '-' || lpad((coalesce(max(nullif(regexp_replace(substr(codigo, 10), '\D', '', 'g'), '')::int), 0) + 1)::text, 5, '0')
    into v_cod from public.th_solicitudes where codigo like 'SOL-' || extract(year from hoy)::int || '-%';

  v_snap := jsonb_build_object(
    'empleado', jsonb_build_object('id', yo.id, 'codigo', yo.codigo, 'nombre', yo.nombre, 'email', yo.email, 'cedula', coalesce(yo.cedula, ''), 'cargo', coalesce(yo.cargo, ''), 'departamento', coalesce(yo.departamento, ''), 'fechaIngreso', yo.fecha_ingreso),
    'jefe', jsonb_build_object('id', jefe.id, 'nombre', jefe.nombre, 'email', jefe.email),
    'tipoPermiso', case when t.id is null then null else jsonb_build_object('id', t.id, 'nombre', t.nombre, 'remunerado', t.remunerado, 'afectaVacaciones', t.afecta_vacaciones, 'clase', t.clase, 'autorizacionEspecial', t.autorizacion_especial) end,
    'saldoAlSolicitar', case when v_dias > 0 or v_tipo = 'Vacaciones' then app.th_saldo(yo.id) end,
    'config', jsonb_build_object('conteo', c ->> 'conteo', 'devengo', c ->> 'devengo'));

  insert into public.th_solicitudes (codigo, tipo, subtipo, tipo_permiso_id, estado, empleado_id, jefe_id, modalidad, fecha_inicio, fecha_fin, fecha_reincorporacion,
    hora_inicio, hora_fin, duracion, unidad, dias_vacaciones, motivo, observaciones, confidencial, requiere_excepcion, excepcion_motivo, documento_drive_id, documento_nombre,
    datos, historial, request_key, version, creado_por)
  values (v_cod, v_tipo, nullif(v_sub, ''), t.id, 'Pendiente jefe', yo.id, jefe.id, v_mod, v_ini, v_fin, v_rein, v_hi, v_hf, v_dur, v_uni, v_dias,
    nullif(v_motivo, ''), nullif(v_obs, ''), v_conf, v_exc, nullif(v_exc_mot, ''), v_doc, v_doc_nom, v_snap,
    jsonb_build_array(
      jsonb_build_object('fecha', now(), 'por', yo.nombre, 'email', yo.email, 'rol', 'Empleado', 'accion', 'Solicitud creada', 'estado', 'Pendiente jefe', 'nota', ''),
      jsonb_build_object('fecha', now(), 'por', 'Sistema', 'email', '', 'rol', '', 'accion', 'Enviada al jefe inmediato (' || jefe.nombre || ')', 'estado', 'Pendiente jefe', 'nota', '')),
    v_key, 1, yo.id)
  returning * into s;

  perform app.th_auditar(r, 'Crear solicitud', s, null, null, jsonb_build_object('tipo', v_tipo, 'subtipo', v_sub, 'inicio', v_ini, 'fin', v_fin, 'duracion', v_dur || ' ' || v_uni, 'excepcion', v_exc), '');
  perform app.th_notificar(array[yo.id], s, 'Solicitud creada y enviada a tu jefe', 'miperfil');
  perform app.th_notificar(array[jefe.id], s, 'Nueva solicitud para revisar', 'solicitudes');
  return jsonb_build_object('ok', true, 'solicitud', app.th_vista(s, r));
end $$;

/** Jefe inmediato: aprueba o rechaza (solo de SUS subordinados) (vmSolDecidirJefe). */
create or replace function public.th_sol_decidir_jefe(p_id uuid, p_decision text, p_observacion text default '', p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := app.th_roles(); yo uuid := (r ->> 'yo')::uuid; s public.th_solicitudes; v_obs text := app.th_txt(p_observacion, 1000); antes text;
begin
  if p_decision not in ('aprobar', 'rechazar') then raise exception 'Decisión no válida.'; end if;
  if p_decision = 'rechazar' and v_obs = '' then raise exception 'Escribe el motivo del rechazo.'; end if;
  s := app.th_buscar(p_id);
  if yo is null or not (s.jefe_id = yo or (select jefe_id from public.empleados where id = s.empleado_id) = yo) then
    perform app.th_auditar(r, 'Intento no autorizado de decidir como jefe', s, null, null, null, '');
    raise exception 'Solo el jefe inmediato asignado puede aprobar o rechazar esta solicitud.';
  end if;
  if s.empleado_id = yo then raise exception 'No puedes aprobar tus propias solicitudes.'; end if;
  if s.estado <> 'Pendiente jefe' then raise exception 'Esta solicitud ya no está pendiente de tu aprobación (estado: %).', app.th_estado_txt(s.estado); end if;
  perform app.th_version(s, p_version);
  antes := s.estado;
  if p_decision = 'aprobar' then
    update public.th_solicitudes set estado = 'Pendiente TTHH', jefe_decision = 'Aprobada', jefe_decision_por = yo, jefe_decision_fecha = now(), jefe_observacion = nullif(v_obs, ''),
      historial = app.th_hist(app.th_hist(historial, r, 'Aprobada por jefe inmediato', 'Pendiente TTHH', v_obs), r, 'Enviada a Talento Humano', 'Pendiente TTHH', '', true),
      version = version + 1 where id = s.id returning * into s;
    perform app.th_auditar(r, 'Jefe aprueba', s, null, jsonb_build_object('estado', antes), jsonb_build_object('estado', s.estado), v_obs);
    perform app.th_notificar(array[s.empleado_id], s, 'Tu jefe aprobó la solicitud; pasa a Talento Humano', 'miperfil');
    perform app.th_notificar(app.th_personal_tthh(), s, 'Solicitud aprobada por el jefe: pendiente de validación', 'solicitudes');
  else
    update public.th_solicitudes set estado = 'Rechazada', jefe_decision = 'Rechazada', jefe_decision_por = yo, jefe_decision_fecha = now(), jefe_observacion = v_obs,
      historial = app.th_hist(historial, r, 'Rechazada por jefe inmediato', 'Rechazada', v_obs), version = version + 1 where id = s.id returning * into s;
    perform app.th_auditar(r, 'Jefe rechaza', s, null, jsonb_build_object('estado', antes), jsonb_build_object('estado', s.estado), v_obs);
    perform app.th_notificar(array[s.empleado_id], s, 'Tu jefe rechazó la solicitud', 'miperfil');
  end if;
  return jsonb_build_object('ok', true, 'solicitud', app.th_vista(s, r));
end $$;

/** Registra el descuento de vacaciones de una solicitud (una sola vez) (solDescontar_). */
create or replace function app.th_descontar(s public.th_solicitudes, r jsonb, p_motivo text) returns text
language plpgsql security definer set search_path = public as $$
declare n_desc int; n_rev int; v_cod text;
begin
  select count(*) filter (where tipo = 'Descuento'), count(*) filter (where tipo = 'Reverso') into n_desc, n_rev
    from public.th_vacaciones_movimientos where solicitud_id = s.id and deleted_at is null;
  if n_desc > n_rev then
    select codigo into v_cod from public.th_vacaciones_movimientos where solicitud_id = s.id and tipo = 'Descuento' and deleted_at is null order by fecha desc limit 1;
    return v_cod;
  end if;
  v_cod := 'MV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.th_vacaciones_movimientos (codigo, empleado_id, tipo, dias, solicitud_id, motivo, usuario_id, creado_por)
  values (v_cod, s.empleado_id, 'Descuento', -abs(s.dias_vacaciones), s.id, p_motivo, (r ->> 'yo')::uuid, (r ->> 'yo')::uuid);
  return v_cod;
end $$;

/** Talento Humano: validación final o rechazo justificado (vmSolDecidirTTHH). */
create or replace function public.th_sol_decidir_tthh(p_id uuid, p_decision text, p_observacion text default '', p_opciones jsonb default '{}'::jsonb, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := app.th_roles(); yo uuid := (r ->> 'yo')::uuid; s public.th_solicitudes; v_obs text := app.th_txt(p_observacion, 1000);
  op jsonb := coalesce(p_opciones, '{}'::jsonb); antes text; saldo jsonb; v_exc text; v_desc text; ha numeric; m_omitir text := app.th_txt(op ->> 'motivoOmitir', 500);
  m_exc text := app.th_txt(op ->> 'motivoExcepcion', 500);
begin
  s := app.th_buscar(p_id);
  if not (r ->> 'validaTTHH')::boolean then
    perform app.th_auditar(r, 'Intento no autorizado de validar como TTHH', s, null, null, null, '');
    raise exception 'Solo Talento Humano puede realizar la validación final.';
  end if;
  if p_decision not in ('aprobar', 'rechazar') then raise exception 'Decisión no válida.'; end if;
  if p_decision = 'rechazar' and v_obs = '' then raise exception 'Escribe la justificación del rechazo.'; end if;
  if s.empleado_id = yo then raise exception 'No puedes validar tus propias solicitudes: debe hacerlo otra persona de Talento Humano.'; end if;
  perform app.th_version(s, p_version);
  antes := s.estado;
  if s.estado = 'Pendiente jefe' then
    if not coalesce((op ->> 'omitirJefe')::boolean, false) then
      raise exception 'Esta solicitud todavía está pendiente del jefe inmediato. Solo puedes saltar esa etapa como procedimiento excepcional (con motivo).';
    end if;
    if length(m_omitir) < 10 then raise exception 'Explica (mínimo 10 caracteres) por qué se omite la aprobación del jefe.'; end if;
    update public.th_solicitudes set jefe_decision = 'Omitida (procedimiento excepcional)', jefe_observacion = m_omitir,
      historial = app.th_hist(historial, r, 'Etapa del jefe omitida por TTHH (excepcional)', estado, m_omitir), version = version + 1
      where id = s.id returning * into s;
    perform app.th_auditar(r, 'Omitir aprobación del jefe (excepcional)', s, null, jsonb_build_object('estado', antes), null, m_omitir);
  elsif s.estado <> 'Pendiente TTHH' then
    raise exception 'Esta solicitud ya no está pendiente de validación (estado: %).', app.th_estado_txt(s.estado);
  end if;

  if p_decision = 'rechazar' then
    update public.th_solicitudes set estado = 'Rechazada', tthh_decision = 'Rechazada', tthh_decision_por = yo, tthh_decision_fecha = now(), tthh_observacion = v_obs,
      historial = app.th_hist(historial, r, 'Rechazada por Talento Humano', 'Rechazada', v_obs), version = version + 1 where id = s.id returning * into s;
    perform app.th_auditar(r, 'TTHH rechaza', s, null, jsonb_build_object('estado', antes), jsonb_build_object('estado', s.estado), v_obs);
    perform app.th_notificar(array[s.empleado_id], s, 'Talento Humano rechazó la solicitud', 'miperfil');
    perform app.th_notificar(array[s.jefe_id], s, 'Talento Humano rechazó la solicitud', 'solicitudes');
    return jsonb_build_object('ok', true, 'solicitud', app.th_vista(s, r));
  end if;

  -- Aprobar: verificar saldo y descontar una sola vez.
  v_exc := s.excepcion_motivo;
  if coalesce(s.dias_vacaciones, 0) > 0 then
    if not exists (select 1 from public.empleados where id = s.empleado_id) then raise exception 'El empleado ya no existe en Empleados.'; end if;
    saldo := app.th_saldo(s.empleado_id, s.id);
    if s.dias_vacaciones > (saldo ->> 'disponibles')::numeric + 0.000000001 then
      if not coalesce((op ->> 'excepcionSaldo')::boolean, false) then
        raise exception 'Saldo insuficiente: la solicitud es de % día(s) y el empleado tiene % disponible(s). Para aprobar igual marca "Autorizar excepción de saldo" y explica el motivo.', s.dias_vacaciones::float, (saldo ->> 'disponibles')::float;
      end if;
      if length(m_exc) < 10 then raise exception 'Explica (mínimo 10 caracteres) por qué se autoriza la excepción de saldo.'; end if;
      v_exc := coalesce(nullif(s.excepcion_motivo, '') || ' | ', '') || 'TTHH: ' || m_exc;
      perform app.th_auditar(r, 'Excepción de saldo autorizada', s, null, jsonb_build_object('disponibles', saldo -> 'disponibles'), jsonb_build_object('dias', s.dias_vacaciones), m_exc);
    end if;
    v_desc := app.th_descontar(s, r, case when s.tipo = 'Vacaciones' then 'Vacaciones ' else 'Permiso que afecta vacaciones ' end || s.codigo || ' (' || s.fecha_inicio ||
      case when s.fecha_fin is not null and s.fecha_fin <> s.fecha_inicio then ' a ' || s.fecha_fin else '' end || ')');
  end if;
  ha := s.horas_autorizadas;
  if s.tipo = 'Horas' or (s.tipo = 'Permiso' and s.unidad = 'horas') then
    ha := case when coalesce(op ->> 'horasAutorizadas', '') = '' then s.duracion else (op ->> 'horasAutorizadas')::numeric end;
    if ha < 0 or ha > s.duracion + 0.000000001 then raise exception 'Las horas autorizadas deben estar entre 0 y %.', s.duracion::float; end if;
  end if;
  update public.th_solicitudes set estado = 'Aprobada', tthh_decision = 'Aprobada', tthh_decision_por = yo, tthh_decision_fecha = now(), tthh_observacion = nullif(v_obs, ''),
    excepcion_motivo = v_exc, descuento_codigo = coalesce(v_desc, descuento_codigo), horas_autorizadas = ha,
    historial = app.th_hist(historial, r, 'Aprobada definitivamente por Talento Humano', 'Aprobada', v_obs), version = version + 1 where id = s.id returning * into s;
  perform app.th_auditar(r, 'TTHH aprueba', s, null, jsonb_build_object('estado', antes), jsonb_build_object('estado', s.estado, 'descuento', coalesce(s.descuento_codigo, ''), 'horasAutorizadas', s.horas_autorizadas), v_obs);
  perform app.th_notificar(array[s.empleado_id], s, 'Solicitud aprobada definitivamente', 'miperfil');
  perform app.th_notificar(array[s.jefe_id], s, 'Solicitud aprobada definitivamente', 'solicitudes');
  return jsonb_build_object('ok', true, 'solicitud', app.th_vista(s, r));
end $$;

/** Empleado: cancela antes de la aprobación final. TTHH: anula (incluso aprobada) y revierte el saldo (vmSolCancelar). */
create or replace function public.th_sol_cancelar(p_id uuid, p_motivo text default '', p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := app.th_roles(); yo uuid := (r ->> 'yo')::uuid; s public.th_solicitudes; v_mot text := app.th_txt(p_motivo, 500); propia boolean; v_acc text; antes text;
  n_desc int; n_rev int;
begin
  s := app.th_buscar(p_id);
  propia := s.empleado_id = yo; antes := s.estado;
  if s.estado in ('Cancelada', 'Rechazada') then raise exception 'Esta solicitud ya está %.', lower(s.estado); end if;
  perform app.th_version(s, p_version);
  if s.estado = 'Aprobada' then
    if not (r ->> 'validaTTHH')::boolean or propia then raise exception 'Una solicitud aprobada solo la puede anular Talento Humano (otra persona si es tuya). Pídelo a TTHH.'; end if;
    if length(v_mot) < 10 then raise exception 'Explica (mínimo 10 caracteres) por qué se anula la solicitud aprobada.'; end if;
    select count(*) filter (where tipo = 'Descuento'), count(*) filter (where tipo = 'Reverso') into n_desc, n_rev
      from public.th_vacaciones_movimientos where solicitud_id = s.id and deleted_at is null;
    if n_desc > n_rev and coalesce(s.dias_vacaciones, 0) > 0 then
      insert into public.th_vacaciones_movimientos (codigo, empleado_id, tipo, dias, solicitud_id, motivo, usuario_id, creado_por)
      values ('MV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), s.empleado_id, 'Reverso', abs(s.dias_vacaciones), s.id, 'Anulación de ' || s.codigo || ': ' || v_mot, yo, yo);
    end if;
    v_acc := 'Anulada por Talento Humano (saldo revertido)';
  else
    if not propia and not (r ->> 'validaTTHH')::boolean then raise exception 'Solo el empleado o Talento Humano pueden cancelar esta solicitud.'; end if;
    if not propia and length(v_mot) < 5 then raise exception 'Escribe el motivo de la cancelación.'; end if;
    v_acc := case when propia then 'Cancelada por el empleado' else 'Cancelada por Talento Humano' end;
  end if;
  update public.th_solicitudes set estado = 'Cancelada', historial = app.th_hist(historial, r, v_acc, 'Cancelada', v_mot), version = version + 1
    where id = s.id returning * into s;
  perform app.th_auditar(r, v_acc, s, null, jsonb_build_object('estado', antes), jsonb_build_object('estado', s.estado), v_mot);
  perform app.th_notificar(array[s.empleado_id], s, 'Solicitud cancelada', 'miperfil');
  perform app.th_notificar(array[s.jefe_id], s, 'Solicitud cancelada', 'solicitudes');
  return jsonb_build_object('ok', true, 'solicitud', app.th_vista(s, r));
end $$;

/** Observación en el historial (empleado, su jefe o TTHH). No cambia el estado (vmSolObservar). */
create or replace function public.th_sol_observar(p_id uuid, p_texto text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := app.th_roles(); s public.th_solicitudes; v text := app.th_txt(p_texto, 1000);
begin
  if v = '' then raise exception 'Escribe la observación.'; end if;
  s := app.th_buscar(p_id);
  if app.th_alcance(s, r) = '' then raise exception 'No tienes acceso a esta solicitud.'; end if;
  update public.th_solicitudes set historial = app.th_hist(historial, r, 'Observación', estado, v), version = version + 1 where id = s.id returning * into s;
  perform app.th_auditar(r, 'Observación', s, null, null, null, v);
  return jsonb_build_object('ok', true, 'solicitud', app.th_vista(s, r));
end $$;

/** TTHH: horas trabajadas / compensadas y verificación para pago (vmSolRegistrarHoras). */
create or replace function public.th_sol_registrar_horas(p_id uuid, d jsonb, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := app.th_roles(); s public.th_solicitudes; ht numeric; hc numeric; vp boolean := coalesce((d ->> 'verificadaPago')::boolean, false); antes jsonb;
begin
  if not (r ->> 'validaTTHH')::boolean then raise exception 'Solo Talento Humano registra horas trabajadas y compensadas.'; end if;
  s := app.th_buscar(p_id);
  if s.unidad <> 'horas' then raise exception 'Esta solicitud no es por horas.'; end if;
  if s.estado <> 'Aprobada' then raise exception 'Primero la solicitud debe estar aprobada definitivamente.'; end if;
  perform app.th_version(s, p_version);
  if coalesce(d ->> 'horasTrabajadas', '') <> '' then
    ht := (d ->> 'horasTrabajadas')::numeric; if ht < 0 or ht > 400 then raise exception 'Horas trabajadas no válidas.'; end if; ht := round(ht, 2);
  end if;
  if coalesce(d ->> 'horasCompensadas', '') <> '' then
    hc := (d ->> 'horasCompensadas')::numeric; if hc < 0 or hc > 400 then raise exception 'Horas compensadas no válidas.'; end if; hc := round(hc, 2);
  end if;
  antes := jsonb_build_object('trabajadas', s.horas_trabajadas, 'compensadas', s.horas_compensadas, 'verificadaPago', s.verificada_pago);
  update public.th_solicitudes set horas_trabajadas = ht, horas_compensadas = hc, verificada_pago = vp,
    historial = app.th_hist(historial, r, 'Registro de horas (TTHH)', estado, 'Trabajadas: ' || coalesce(ht::text, '—') || ' · Compensadas: ' || coalesce(hc::text, '—') || ' · Verificada para pago: ' || case when vp then 'Sí' else 'No' end),
    version = version + 1 where id = s.id returning * into s;
  perform app.th_auditar(r, 'Registro de horas', s, null, antes, jsonb_build_object('trabajadas', ht, 'compensadas', hc, 'verificadaPago', vp), '');
  return jsonb_build_object('ok', true, 'solicitud', app.th_vista(s, r));
end $$;

/** TTHH: ajuste justificado del saldo de vacaciones (vmSolAjustarSaldo). */
create or replace function public.th_ajustar_saldo(p_empleado uuid, p_dias numeric, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := app.th_roles(); v_mot text := app.th_txt(p_motivo, 500); e public.empleados;
begin
  if not (r ->> 'validaTTHH')::boolean then raise exception 'Solo Talento Humano ajusta saldos de vacaciones.'; end if;
  if p_dias is null or p_dias = 0 or abs(p_dias) > 120 then raise exception 'Indica los días del ajuste (positivo para sumar, negativo para restar).'; end if;
  if length(v_mot) < 10 then raise exception 'Explica (mínimo 10 caracteres) el motivo del ajuste.'; end if;
  select * into e from public.empleados where id = p_empleado and deleted_at is null;
  if e.id is null then raise exception 'Empleado no encontrado.'; end if;
  if e.id = (r ->> 'yo')::uuid and not (r ->> 'esAdmin')::boolean then raise exception 'No puedes ajustar tu propio saldo.'; end if;
  insert into public.th_vacaciones_movimientos (codigo, empleado_id, tipo, dias, motivo, usuario_id, creado_por)
  values ('MV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), e.id, 'Ajuste', round(p_dias, 2), v_mot, (r ->> 'yo')::uuid, (r ->> 'yo')::uuid);
  perform app.th_auditar(r, 'Ajuste de saldo de vacaciones', null, e.id, null, jsonb_build_object('dias', p_dias), v_mot);
  return jsonb_build_object('ok', true, 'saldo', app.th_saldo(e.id));
end $$;

create or replace function app.th_tipos_json(p_solo_activos boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'nombre', nombre, 'requiereDocumento', requiere_documento, 'remunerado', remunerado,
    'duracionMax', coalesce(duracion_maxima, 0), 'unidadMax', coalesce(unidad_maxima, ''), 'afectaVacaciones', afecta_vacaciones, 'autorizacionEspecial', autorizacion_especial,
    'clase', coalesce(clase, ''), 'confidencial', confidencial, 'activo', activo, 'orden', orden) order by orden, nombre), '[]'::jsonb)
  from public.th_tipos_permiso where deleted_at is null and (not p_solo_activos or activo);
$$;

/** TTHH: crea o edita un tipo de permiso; no se borran, se desactivan (vmSolTipoGuardar). */
create or replace function public.th_tipo_guardar(t jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := app.th_roles(); v_nom text := app.th_txt(t ->> 'nombre', 80); v_uni text; v_dur numeric := coalesce(nullif(t ->> 'duracionMax', '')::numeric, 0);
  v_clase text; ex public.th_tipos_permiso; v_id uuid := nullif(t ->> 'id', '')::uuid; v_n int;
begin
  if not (r ->> 'validaTTHH')::boolean then raise exception 'Solo Talento Humano administra los tipos de permiso.'; end if;
  if v_nom = '' then raise exception 'Escribe el nombre del tipo de permiso.'; end if;
  v_uni := case when t ->> 'unidadMax' in ('horas', 'días') then t ->> 'unidadMax' else '' end;
  if v_dur < 0 or v_dur > 400 then raise exception 'Duración máxima no válida.'; end if;
  v_clase := case when t ->> 'clase' = 'Licencia legal' then 'Licencia legal' else 'Beneficio interno' end;
  if v_id is not null then select * into ex from public.th_tipos_permiso where id = v_id and deleted_at is null; end if;
  if exists (select 1 from public.th_tipos_permiso where lower(nombre) = lower(v_nom) and deleted_at is null and (ex.id is null or id <> ex.id)) then
    raise exception 'Ya existe un tipo con ese nombre.';
  end if;
  if ex.id is not null then
    update public.th_tipos_permiso set nombre = v_nom, requiere_documento = coalesce((t ->> 'requiereDocumento')::boolean, false), remunerado = coalesce((t ->> 'remunerado')::boolean, false),
      duracion_maxima = nullif(v_dur, 0), unidad_maxima = case when v_dur > 0 then nullif(v_uni, '') end, afecta_vacaciones = coalesce((t ->> 'afectaVacaciones')::boolean, false),
      autorizacion_especial = coalesce((t ->> 'autorizacionEspecial')::boolean, false), clase = v_clase, confidencial = coalesce((t ->> 'confidencial')::boolean, false),
      activo = coalesce((t ->> 'activo')::boolean, true) where id = ex.id;
  else
    select coalesce(max(nullif(regexp_replace(codigo, '\D', '', 'g'), '')::int), 0) + 1 into v_n from public.th_tipos_permiso;
    insert into public.th_tipos_permiso (codigo, nombre, requiere_documento, remunerado, duracion_maxima, unidad_maxima, afecta_vacaciones, autorizacion_especial, clase, confidencial, activo, orden, creado_por)
    values ('TP-' || lpad(v_n::text, 2, '0'), v_nom, coalesce((t ->> 'requiereDocumento')::boolean, false), coalesce((t ->> 'remunerado')::boolean, false), nullif(v_dur, 0),
      case when v_dur > 0 then nullif(v_uni, '') end, coalesce((t ->> 'afectaVacaciones')::boolean, false), coalesce((t ->> 'autorizacionEspecial')::boolean, false), v_clase,
      coalesce((t ->> 'confidencial')::boolean, false), coalesce((t ->> 'activo')::boolean, true),
      (select coalesce(max(orden), 0) + 1 from public.th_tipos_permiso), (r ->> 'yo')::uuid);
  end if;
  perform app.th_auditar(r, case when ex.id is not null then 'Editar tipo de permiso' else 'Crear tipo de permiso' end, null, null,
    case when ex.id is not null then to_jsonb(ex) - 'created_at' - 'updated_at' end, t, '');
  return jsonb_build_object('ok', true, 'tipos', app.th_tipos_json(false));
end $$;

/** Administrador: reglas de vacaciones (vmSolConfigGuardar). */
create or replace function public.th_config_guardar(c jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := app.th_roles(); actual jsonb := app.th_config(); n jsonb; fer jsonb; num numeric;
begin
  if not (r ->> 'esAdmin')::boolean then raise exception 'Solo el administrador configura el sistema de solicitudes.'; end if;
  c := coalesce(c, '{}'::jsonb);
  select coalesce(jsonb_agg(distinct x order by x), '[]'::jsonb) into fer from (
    select to_char(app.th_fecha(btrim(v)), 'YYYY-MM-DD') x
    from regexp_split_to_table(case when jsonb_typeof(c -> 'feriados') = 'array' then (select string_agg(value, ',') from jsonb_array_elements_text(c -> 'feriados')) else coalesce(c ->> 'feriados', '') end, '[\s,;]+') v
  ) f where x is not null;
  n := jsonb_build_object(
    'conteo', case when c ->> 'conteo' = 'laborables' then 'laborables' else 'calendario' end,
    'devengo', case when c ->> 'devengo' = 'proporcional' then 'proporcional' else 'anual' end,
    'diasBase', greatest(1, least(60, coalesce(nullif(c ->> 'diasBase', '')::numeric, 15))),
    'adicionalDesdeAnio', greatest(1, least(50, coalesce(nullif(c ->> 'adicionalDesdeAnio', '')::int, 6))),
    'adicionalMax', greatest(0, least(60, coalesce(nullif(c ->> 'adicionalMax', '')::int, 15))),
    'horasPorDia', greatest(1, least(24, coalesce(nullif(c ->> 'horasPorDia', '')::numeric, 8))),
    'diasMinAnticipacion', greatest(0, least(90, coalesce(nullif(c ->> 'diasMinAnticipacion', '')::int, 0))),
    'correo', coalesce((c ->> 'correo')::boolean, true), 'feriados', fer);
  insert into public.th_configuracion (clave, valor, creado_por) values ('solicitudes', n, (r ->> 'yo')::uuid)
  on conflict (clave) do update set valor = excluded.valor, deleted_at = null;
  perform app.th_auditar(r, 'Configuración de solicitudes', null, null, actual, n, '');
  return jsonb_build_object('ok', true, 'config', n);
end $$;

/** Mi Perfil: todo lo que necesita la pantalla del empleado en una sola llamada (vmSolMiPerfil). */
create or replace function public.th_mi_perfil() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := app.th_roles(); yo public.empleados; j public.empleados; c jsonb := app.th_config();
begin
  select * into yo from public.empleados where id = (r ->> 'yo')::uuid and deleted_at is null;
  if yo.id is null then raise exception 'Tu cuenta no está registrada en Empleados. Pide a Talento Humano que te agregue.'; end if;
  select * into j from public.empleados where id = yo.jefe_id and deleted_at is null;
  return jsonb_build_object(
    'perfil', jsonb_build_object('id', yo.id, 'codigo', yo.codigo, 'nombre', yo.nombre, 'email', yo.email, 'cedula', coalesce(yo.cedula, ''), 'cargo', coalesce(yo.cargo, ''),
      'departamento', coalesce(yo.departamento, ''), 'jefeId', yo.jefe_id, 'jefeNombre', coalesce(j.nombre, ''), 'jefeVinculado', j.id is not null and j.id <> yo.id,
      'fechaIngreso', yo.fecha_ingreso, 'antiguedad', app.th_antiguedad(yo.fecha_ingreso),
      'estadoLaboral', coalesce(nullif(yo.estado_laboral, ''), case when app.th_emp_activo(yo) then 'Activo' else 'Retirado' end),
      'jornada', coalesce(yo.jornada_laboral, ''), 'horaEntrada', coalesce(to_char(yo.hora_entrada, 'HH24:MI'), ''), 'horaSalida', coalesce(to_char(yo.hora_salida, 'HH24:MI'), ''),
      'foto', coalesce(yo.foto_url, ''), 'local', coalesce(yo.local, '')),
    'saldo', app.th_saldo(yo.id),
    'movimientos', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'codigo', m.codigo, 'fecha', m.fecha, 'tipo', m.tipo, 'dias', m.dias, 'motivo', coalesce(m.motivo, '')) order by m.fecha desc), '[]'::jsonb)
      from (select * from public.th_vacaciones_movimientos where empleado_id = yo.id and deleted_at is null order by fecha desc limit 50) m),
    'solicitudes', (select coalesce(jsonb_agg(app.th_vista(s, r) order by s.fecha_solicitud desc), '[]'::jsonb) from public.th_solicitudes s where s.empleado_id = yo.id and s.deleted_at is null),
    'tipos', app.th_tipos_json(true),
    'tiposHoras', jsonb_build_array('Recuperación de horas', 'Compensación de horas', 'Autorización de horas adicionales', 'Salida anticipada', 'Ingreso tardío', 'Otro motivo relacionado con horarios'),
    'config', c - 'correo', 'roles', r, 'hoy', app.th_hoy());
end $$;

/** Bandeja: jefe (solo sus subordinados) y/o TTHH (todas), con saldos y administración (vmSolBandeja). */
create or replace function public.th_bandeja() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := app.th_roles(); yo uuid := (r ->> 'yo')::uuid; o jsonb;
begin
  if not ((r ->> 'esJefe')::boolean or (r ->> 'esTTHH')::boolean or (r ->> 'esAdmin')::boolean) then
    raise exception 'No tienes personal a cargo ni acceso de Talento Humano.';
  end if;
  o := jsonb_build_object('roles', r, 'yo', jsonb_build_object('id', yo, 'nombre', (select nombre from public.empleados where id = yo)), 'hoy', app.th_hoy(), 'config', app.th_config());
  if (r ->> 'esJefe')::boolean then
    o := o || jsonb_build_object(
      'equipo', (select coalesce(jsonb_agg(app.th_vista(s, r) order by s.fecha_solicitud desc), '[]'::jsonb) from public.th_solicitudes s left join public.empleados e on e.id = s.empleado_id
        where s.deleted_at is null and s.empleado_id <> yo and (s.jefe_id = yo or e.jefe_id = yo)),
      'miEquipo', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'cargo', coalesce(e.cargo, ''), 'departamento', coalesce(e.departamento, ''),
          'estadoLaboral', coalesce(nullif(e.estado_laboral, ''), case when app.th_emp_activo(e) then 'Activo' else 'Retirado' end),
          'disponibles', sd -> 'disponibles', 'comprometidos', sd -> 'comprometidos') order by e.nombre), '[]'::jsonb)
        from public.empleados e cross join lateral (select app.th_saldo(e.id) sd) x where e.jefe_id = yo and e.id <> yo and e.deleted_at is null));
  else
    o := o || jsonb_build_object('equipo', '[]'::jsonb, 'miEquipo', '[]'::jsonb);
  end if;
  if (r ->> 'esTTHH')::boolean or (r ->> 'esAdmin')::boolean then
    o := o || jsonb_build_object(
      'todas', (select coalesce(jsonb_agg(app.th_vista(s, r) order by s.fecha_solicitud desc), '[]'::jsonb)
        from (select * from public.th_solicitudes where deleted_at is null order by fecha_solicitud desc limit 2000) s),
      'empleados', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'cedula', coalesce(e.cedula, ''), 'cargo', coalesce(e.cargo, ''), 'departamento', coalesce(e.departamento, ''),
          'jefeId', e.jefe_id, 'jefeNombre', coalesce(j.nombre, ''), 'jefeVinculado', j.id is not null, 'fechaIngreso', e.fecha_ingreso, 'antiguedad', sd ->> 'antiguedad',
          'estadoLaboral', coalesce(nullif(e.estado_laboral, ''), case when app.th_emp_activo(e) then 'Activo' else 'Retirado' end), 'activo', app.th_emp_activo(e),
          'acumulados', sd -> 'acumulados', 'utilizados', sd -> 'utilizados', 'disponibles', sd -> 'disponibles', 'comprometidos', sd -> 'comprometidos', 'nota', sd ->> 'nota') order by e.nombre), '[]'::jsonb)
        from public.empleados e left join public.empleados j on j.id = e.jefe_id and j.deleted_at is null cross join lateral (select app.th_saldo(e.id) sd) x where e.deleted_at is null),
      'movimientos', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'codigo', m.codigo, 'fecha', m.fecha, 'empleadoNombre', coalesce(e.nombre, ''), 'tipo', m.tipo, 'dias', m.dias,
          'solicitud', coalesce(s.codigo, ''), 'motivo', coalesce(m.motivo, ''), 'usuario', coalesce(u.email, '')) order by m.fecha desc), '[]'::jsonb)
        from (select * from public.th_vacaciones_movimientos where deleted_at is null order by fecha desc limit 300) m
        left join public.empleados e on e.id = m.empleado_id left join public.empleados u on u.id = m.usuario_id left join public.th_solicitudes s on s.id = m.solicitud_id),
      'tipos', app.th_tipos_json(false));
  end if;
  if (r ->> 'esAdmin')::boolean then
    o := o || jsonb_build_object('auditoria', (select coalesce(jsonb_agg(jsonb_build_object('fecha', a.fecha, 'usuario', coalesce(a.usuario_email, ''), 'rol', coalesce(a.rol, ''), 'accion', a.accion,
        'solicitud', coalesce(a.solicitud_codigo, ''), 'empleado', coalesce(e.nombre, ''), 'antes', coalesce(a.antes::text, ''), 'despues', coalesce(a.despues::text, ''), 'detalle', coalesce(a.detalle, '')) order by a.fecha desc), '[]'::jsonb)
      from (select * from public.th_auditoria where deleted_at is null order by fecha desc limit 400) a left join public.empleados e on e.id = a.empleado_id));
  end if;
  return o;
end $$;

/** Detalle de una solicitud con control de acceso (vmSolDetalle). */
create or replace function public.th_sol_detalle(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := app.th_roles(); s public.th_solicitudes; o jsonb; al text;
begin
  select * into s from public.th_solicitudes where id = p_id and deleted_at is null;
  if s.id is null then raise exception 'No se encontró la solicitud.'; end if;
  al := app.th_alcance(s, r);
  if al = '' then
    perform app.th_auditar(r, 'Intento de ver solicitud ajena', s, null, null, null, '');
    raise exception 'No tienes acceso a esta solicitud.';
  end if;
  o := app.th_vista(s, r);
  if al in ('tthh', 'jefe') then o := o || jsonb_build_object('saldoActual', app.th_saldo(s.empleado_id)); end if;
  return o;
end $$;

/** Documento de respaldo: empleado, su jefe (si no es confidencial), TTHH y administrador (vmSolDocumento). */
create or replace function public.th_sol_documento(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := app.th_roles(); s public.th_solicitudes; al text;
begin
  select * into s from public.th_solicitudes where id = p_id and deleted_at is null;
  if s.id is null then raise exception 'No se encontró la solicitud.'; end if;
  al := app.th_alcance(s, r);
  if al = '' or (al = 'jefe' and s.confidencial) then
    perform app.th_auditar(r, 'Intento de abrir documento sin permiso', s, null, null, null, '');
    raise exception 'No tienes permiso para ver este documento.';
  end if;
  if s.documento_drive_id is null then raise exception 'Esta solicitud no tiene documento.'; end if;
  perform app.th_auditar(r, 'Abrir documento', s, null, null, null, s.documento_nombre);
  return jsonb_build_object('ruta', s.documento_drive_id, 'nombre', coalesce(s.documento_nombre, 'documento'));
end $$;

-- Permisos de ejecución: las funciones internas no se llaman desde la app.
do $$
declare f text;
begin
  foreach f in array array['app.th_hoy()', 'app.tg_empleado_laboral()', 'app.th_config()', 'app.th_dias_anio(int, jsonb)', 'app.th_anios(date, date)', 'app.th_generados(date, date, jsonb)',
    'app.th_antiguedad(date)', 'app.th_dias_rango(date, date, jsonb)', 'app.th_emp_activo(public.empleados)', 'app.th_saldo(uuid, uuid)', 'app.th_roles()', 'app.th_rol_txt(jsonb)',
    'app.th_estado_txt(text)', 'app.th_alcance(public.th_solicitudes, jsonb)', 'app.th_vista(public.th_solicitudes, jsonb)', 'app.th_hist(jsonb, jsonb, text, text, text, boolean)',
    'app.th_auditar(jsonb, text, public.th_solicitudes, uuid, jsonb, jsonb, text)', 'app.th_notificar(uuid[], public.th_solicitudes, text, text)', 'app.th_personal_tthh()',
    'app.th_txt(text, int)', 'app.th_hora(text)', 'app.th_fecha(text)', 'app.th_rango(text, text, date, date, time, time)', 'app.th_buscar(uuid)',
    'app.th_version(public.th_solicitudes, int)', 'app.th_descontar(public.th_solicitudes, jsonb, text)', 'app.th_tipos_json(boolean)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array['public.th_sol_crear(jsonb)', 'public.th_sol_decidir_jefe(uuid, text, text, int)', 'public.th_sol_decidir_tthh(uuid, text, text, jsonb, int)',
    'public.th_sol_cancelar(uuid, text, int)', 'public.th_sol_observar(uuid, text)', 'public.th_sol_registrar_horas(uuid, jsonb, int)', 'public.th_ajustar_saldo(uuid, numeric, text)',
    'public.th_tipo_guardar(jsonb)', 'public.th_config_guardar(jsonb)', 'public.th_mi_perfil()', 'public.th_bandeja()', 'public.th_sol_detalle(uuid)', 'public.th_sol_documento(uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;

notify pgrst, 'reload schema';
