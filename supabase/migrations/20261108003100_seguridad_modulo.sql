-- Módulo "Seguridad y Auditoría": usuarios, roles, sesiones activas, matriz de permisos, bitácora y revisión de privilegios.
-- Las sesiones las lleva Supabase Auth (auth.sessions): solo se tocan desde funciones security definer.

-- 1) Estado "bloqueado" para empleados -------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.empleados'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%estado%activo%'
  loop
    execute format('alter table public.empleados drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.empleados add constraint empleados_estado_check check (estado in ('activo', 'inactivo', 'bloqueado'));

-- 2) Revisiones periódicas de privilegios -----------------------------------------------------------
create table if not exists public.seg_revisiones (
  id uuid primary key default gen_random_uuid(),
  nota text,
  por_email text
);
select app.estandarizar('public.seg_revisiones');
select app.aplicar_rls('public.seg_revisiones', array['seguridad_ver'], array['seguridad_editar']);

-- 3) Auditoría: función interna y RPC para el frontend ---------------------------------------------
create or replace function app.auditar(p_modulo text, p_accion text, p_registro text, p_resultado text default 'OK', p_detalle text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.bitacora (empleado_id, usuario_email, modulo, accion, registro, resultado, detalle, origen)
  select e.id, e.email, p_modulo, p_accion, p_registro,
         case when p_resultado in ('OK', 'Denegado', 'Error', 'Pendiente') then p_resultado else 'OK' end,
         left(p_detalle, 500), 'web'
  from (select 1) x left join public.empleados e on e.auth_user_id = auth.uid() and e.deleted_at is null;
$$;
revoke all on function app.auditar(text, text, text, text, text) from public, anon, authenticated;

create or replace function public.auditar(p_modulo text, p_accion text, p_registro text default null, p_resultado text default 'OK', p_detalle text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app.empleado_id() is null then raise exception 'Sin sesión'; end if;
  perform app.auditar(left(p_modulo, 40), left(p_accion, 120), left(p_registro, 200), p_resultado, p_detalle);
end;
$$;
revoke all on function public.auditar(text, text, text, text, text) from public, anon;
grant execute on function public.auditar(text, text, text, text, text) to authenticated;

-- 4) Verificaciones comunes -------------------------------------------------------------------------
create or replace function app.seg_exigir_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.puede('seguridad', 'administrar') then
    perform app.auditar('seguridad', 'Acción denegada', null, 'Denegado', 'Requiere administrar Seguridad');
    raise exception 'Solo un Superadministrador o quien administra Seguridad puede hacer esto.';
  end if;
end;
$$;
revoke all on function app.seg_exigir_admin() from public, anon, authenticated;

-- Quien no es Superadministrador no puede tocar a un Superadministrador.
create or replace function app.seg_exigir_sobre(p_empleado uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.es_superadmin() and exists (
    select 1 from public.empleados e left join public.roles r on r.id = e.rol_id
    where e.id = p_empleado and (e.es_superadmin or coalesce(r.es_superadmin, false))
  ) then
    perform app.auditar('seguridad', 'Acción denegada', p_empleado::text, 'Denegado', 'Intento de modificar a un Superadministrador');
    raise exception 'Solo un Superadministrador puede modificar a otro Superadministrador.';
  end if;
end;
$$;
revoke all on function app.seg_exigir_sobre(uuid) from public, anon, authenticated;

-- 5) Usuarios ---------------------------------------------------------------------------------------
create or replace function public.seg_usuarios()
returns table (
  id uuid, email text, nombre text, estado text, cargo text, departamento text, jefe text, rol_id uuid, rol text, alcance text,
  superadmin boolean, empleados_admin boolean, modulos text[], sesiones int, ultimo_ingreso timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.puede('seguridad', 'ver') then raise exception 'No tienes acceso a Seguridad y Auditoría.'; end if;
  return query
  select e.id, e.email, e.nombre, e.estado, e.cargo, e.departamento, j.nombre, e.rol_id, r.nombre, r.alcance,
         (e.es_superadmin or coalesce(r.es_superadmin, false)),
         (coalesce((coalesce(r.permisos, '{}'::jsonb) || coalesce(e.permisos_extra, '{}'::jsonb)) -> 'empleados', '[]'::jsonb) ? 'editar'),
         array(select k from jsonb_object_keys(coalesce(r.permisos, '{}'::jsonb) || coalesce(e.permisos_extra, '{}'::jsonb)) k order by k),
         (select count(*)::int from auth.sessions s where s.user_id = e.auth_user_id and (s.not_after is null or s.not_after > now())),
         (select u.last_sign_in_at from auth.users u where u.id = e.auth_user_id)
  from public.empleados e
  left join public.roles r on r.id = e.rol_id
  left join public.empleados j on j.id = e.jefe_id
  where e.deleted_at is null
  order by (e.es_superadmin or coalesce(r.es_superadmin, false)) desc, e.nombre;
end;
$$;
revoke all on function public.seg_usuarios() from public, anon;
grant execute on function public.seg_usuarios() to authenticated;

-- Matriz de permisos efectivos (rol + extra) de todas las personas.
create or replace function public.seg_matriz()
returns table (id uuid, email text, nombre text, superadmin boolean, permisos jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.puede('seguridad', 'ver') then raise exception 'No tienes acceso a Seguridad y Auditoría.'; end if;
  return query
  select e.id, e.email, e.nombre, (e.es_superadmin or coalesce(r.es_superadmin, false)),
         coalesce(r.permisos, '{}'::jsonb) || coalesce(e.permisos_extra, '{}'::jsonb)
  from public.empleados e left join public.roles r on r.id = e.rol_id
  where e.deleted_at is null and e.estado <> 'inactivo'
  order by e.nombre;
end;
$$;
revoke all on function public.seg_matriz() from public, anon;
grant execute on function public.seg_matriz() to authenticated;

-- 6) Sesiones ---------------------------------------------------------------------------------------
create or replace function public.seg_sesiones()
returns table (id uuid, email text, nombre text, creada timestamptz, ultimo_uso timestamptz, vence timestamptz, dispositivo text, ip text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.puede('seguridad', 'ver') then raise exception 'No tienes acceso a Seguridad y Auditoría.'; end if;
  return query
  select s.id, e.email, e.nombre, s.created_at, coalesce(s.refreshed_at, s.updated_at), s.not_after, left(s.user_agent, 120), host(s.ip)
  from auth.sessions s
  join public.empleados e on e.auth_user_id = s.user_id and e.deleted_at is null
  where s.not_after is null or s.not_after > now()
  order by coalesce(s.refreshed_at, s.updated_at) desc nulls last;
end;
$$;
revoke all on function public.seg_sesiones() from public, anon;
grant execute on function public.seg_sesiones() to authenticated;

create or replace function public.seg_cerrar_sesion(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_emp uuid; v_mail text;
begin
  perform app.seg_exigir_admin();
  select e.id, e.email into v_emp, v_mail from auth.sessions s join public.empleados e on e.auth_user_id = s.user_id where s.id = p_id;
  if v_emp is null then raise exception 'La sesión ya no existe.'; end if;
  perform app.seg_exigir_sobre(v_emp);
  delete from auth.sessions where id = p_id;
  perform app.auditar('seguridad', 'Sesión cerrada por administrador', v_mail);
end;
$$;
revoke all on function public.seg_cerrar_sesion(uuid) from public, anon;
grant execute on function public.seg_cerrar_sesion(uuid) to authenticated;

create or replace function public.seg_cerrar_sesiones_de(p_empleado uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid; v_mail text; n int;
begin
  perform app.seg_exigir_admin();
  perform app.seg_exigir_sobre(p_empleado);
  select auth_user_id, email into v_user, v_mail from public.empleados where id = p_empleado;
  delete from auth.sessions where user_id = v_user;
  get diagnostics n = row_count;
  perform app.auditar('seguridad', 'Sesiones cerradas por administrador', v_mail, 'OK', n || ' sesiones');
  return n;
end;
$$;
revoke all on function public.seg_cerrar_sesiones_de(uuid) from public, anon;
grant execute on function public.seg_cerrar_sesiones_de(uuid) to authenticated;

-- 7) Bloquear / desbloquear -------------------------------------------------------------------------
create or replace function public.seg_bloquear(p_empleado uuid, p_bloquear boolean, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid; v_mail text;
begin
  perform app.seg_exigir_admin();
  perform app.seg_exigir_sobre(p_empleado);
  if p_empleado = app.empleado_id() then raise exception 'No puedes bloquear tu propia cuenta.'; end if;
  select auth_user_id, email into v_user, v_mail from public.empleados where id = p_empleado and deleted_at is null;
  if v_mail is null then raise exception 'No se encontró a la persona.'; end if;
  update public.empleados set estado = case when p_bloquear then 'bloqueado' else 'activo' end where id = p_empleado;
  if v_user is not null then
    update auth.users set banned_until = case when p_bloquear then 'infinity'::timestamptz else null end where id = v_user;
    if p_bloquear then delete from auth.sessions where user_id = v_user; end if;
  end if;
  perform app.auditar('seguridad', case when p_bloquear then 'Cuenta bloqueada' else 'Cuenta desbloqueada' end, v_mail, 'OK', p_motivo);
end;
$$;
revoke all on function public.seg_bloquear(uuid, boolean, text) from public, anon;
grant execute on function public.seg_bloquear(uuid, boolean, text) to authenticated;

-- 8) Roles ------------------------------------------------------------------------------------------
create or replace function public.seg_guardar_rol(p_id uuid, p_nombre text, p_descripcion text, p_alcance text, p_rol_crm text, p_permisos jsonb, p_superadmin boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '[<>]', '', 'g'));
begin
  if not app.es_superadmin() then
    perform app.auditar('seguridad', 'Acción denegada', v_nombre, 'Denegado', 'Solo un Superadministrador crea o edita roles');
    raise exception 'Solo un Superadministrador puede crear o editar roles.';
  end if;
  if v_nombre = '' then raise exception 'Escribe el nombre del rol.'; end if;
  if p_alcance not in ('propio', 'departamento', 'subordinados', 'organizacion') then p_alcance := 'propio'; end if;
  if exists (select 1 from public.roles where lower(nombre) = lower(v_nombre) and id is distinct from p_id and deleted_at is null) then
    raise exception 'Ya existe un rol con ese nombre.';
  end if;
  if p_id is null then
    insert into public.roles (nombre, descripcion, rol_crm, permisos, alcance, es_superadmin)
    values (v_nombre, left(p_descripcion, 300), nullif(p_rol_crm, ''), coalesce(p_permisos, '{}'::jsonb), p_alcance, coalesce(p_superadmin, false))
    returning id into v_id;
  else
    update public.roles set nombre = v_nombre, descripcion = left(p_descripcion, 300), rol_crm = nullif(p_rol_crm, ''),
           permisos = coalesce(p_permisos, '{}'::jsonb), alcance = p_alcance, es_superadmin = coalesce(p_superadmin, false)
     where id = p_id and deleted_at is null returning id into v_id;
    if v_id is null then raise exception 'Rol no encontrado.'; end if;
  end if;
  perform app.auditar('seguridad', case when p_id is null then 'Rol creado' else 'Rol modificado' end, v_nombre, 'OK', p_alcance);
  return v_id;
end;
$$;
revoke all on function public.seg_guardar_rol(uuid, text, text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.seg_guardar_rol(uuid, text, text, text, text, jsonb, boolean) to authenticated;

-- Asignar un rol: nadie puede dar permisos que no tiene ni el rol Superadministrador sin serlo.
create or replace function public.seg_asignar_rol(p_empleado uuid, p_rol uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.roles; v_mail text; m text; a text;
begin
  perform app.seg_exigir_admin();
  perform app.seg_exigir_sobre(p_empleado);
  select * into r from public.roles where id = p_rol and deleted_at is null;
  if r.id is null then raise exception 'Rol no encontrado.'; end if;
  select email into v_mail from public.empleados where id = p_empleado and deleted_at is null;
  if v_mail is null then raise exception 'No se encontró a la persona.'; end if;
  if r.es_superadmin and not app.es_superadmin() then
    perform app.auditar('seguridad', 'Acción denegada', v_mail, 'Denegado', 'Asignar rol Superadministrador');
    raise exception 'Solo un Superadministrador puede asignar el rol Superadministrador.';
  end if;
  if not app.es_superadmin() then
    for m, a in select k, jsonb_array_elements_text(v) from jsonb_each(r.permisos) as t(k, v) loop
      if not app.puede(m, a) then raise exception 'No puedes dar el permiso % de %, porque tú no lo tienes.', a, m; end if;
    end loop;
  end if;
  update public.empleados set rol_id = p_rol where id = p_empleado;
  perform app.auditar('seguridad', 'Rol asignado', v_mail, 'OK', r.nombre);
end;
$$;
revoke all on function public.seg_asignar_rol(uuid, uuid) from public, anon;
grant execute on function public.seg_asignar_rol(uuid, uuid) to authenticated;

-- Nombrar / quitar Superadministrador (solo un Superadministrador; si aún no hay ninguno, quien administra).
create or replace function public.seg_superadmin(p_empleado uuid, p_valor boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_mail text; hay boolean; otros int;
begin
  select exists (select 1 from public.empleados e left join public.roles r on r.id = e.rol_id
                 where e.deleted_at is null and e.estado = 'activo' and (e.es_superadmin or coalesce(r.es_superadmin, false))) into hay;
  if hay and not app.es_superadmin() then
    perform app.auditar('seguridad', 'Acción denegada', p_empleado::text, 'Denegado', 'Cambiar Superadministrador');
    raise exception 'Solo un Superadministrador puede hacer esto.';
  end if;
  if not hay then perform app.seg_exigir_admin(); end if;
  select email into v_mail from public.empleados where id = p_empleado and deleted_at is null;
  if v_mail is null then raise exception 'No se encontró a la persona.'; end if;
  if not p_valor then
    select count(*) into otros from public.empleados e left join public.roles r on r.id = e.rol_id
     where e.deleted_at is null and e.estado = 'activo' and e.id <> p_empleado and (e.es_superadmin or coalesce(r.es_superadmin, false));
    if otros = 0 then raise exception 'Debe quedar al menos un Superadministrador.'; end if;
  end if;
  update public.empleados set es_superadmin = coalesce(p_valor, false) where id = p_empleado;
  perform app.auditar('seguridad', case when p_valor then 'Superadministrador nombrado' else 'Superadministrador retirado' end, v_mail);
end;
$$;
revoke all on function public.seg_superadmin(uuid, boolean) from public, anon;
grant execute on function public.seg_superadmin(uuid, boolean) to authenticated;

-- 9) Revisión de privilegios -----------------------------------------------------------------------
create or replace function public.seg_marcar_revision(p_nota text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_mail text;
begin
  perform app.seg_exigir_admin();
  select email into v_mail from public.empleados where auth_user_id = auth.uid() and deleted_at is null;
  insert into public.seg_revisiones (nota, por_email, creado_por) values (left(regexp_replace(coalesce(p_nota, ''), '[<>]', '', 'g'), 300), v_mail, app.empleado_id());
  perform app.auditar('seguridad', 'Revisión de privilegios realizada', null, 'OK', p_nota);
end;
$$;
revoke all on function public.seg_marcar_revision(text) from public, anon;
grant execute on function public.seg_marcar_revision(text) to authenticated;
