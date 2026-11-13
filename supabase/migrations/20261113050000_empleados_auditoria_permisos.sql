-- =====================================================================
-- Issue #3 — Seguridad al dar accesos y roles en Empleados.
-- 1) Cada cambio de rol_id / permisos_extra / es_superadmin queda en bitacora
--    (quién, a quién, qué cambió, cuándo) — hoy no quedaba ningún registro.
-- 2) Exige 2FA (app.exigir_mfa(), ya existe para resetear contraseñas) antes
--    de guardar esos mismos cambios.
-- =====================================================================
create or replace function app.tg_empleados_cambio_permisos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cambios text[] := '{}';
  v_rol_antes text; v_rol_despues text;
begin
  if new.rol_id is distinct from old.rol_id then
    select nombre into v_rol_antes from public.roles where id = old.rol_id;
    select nombre into v_rol_despues from public.roles where id = new.rol_id;
    v_cambios := array_append(v_cambios, 'rol: ' || coalesce(v_rol_antes, '—') || ' → ' || coalesce(v_rol_despues, '—'));
  end if;
  if new.permisos_extra is distinct from old.permisos_extra then
    v_cambios := array_append(v_cambios, 'permisos_extra: ' || coalesce(old.permisos_extra::text, '{}') || ' → ' || coalesce(new.permisos_extra::text, '{}'));
  end if;
  if new.es_superadmin is distinct from old.es_superadmin then
    v_cambios := array_append(v_cambios, 'es_superadmin: ' || old.es_superadmin::text || ' → ' || new.es_superadmin::text);
  end if;

  if array_length(v_cambios, 1) > 0 then
    if not app.exigir_mfa() then
      raise exception 'Para cambiar el rol o los permisos de un empleado, primero activa la verificación en dos pasos (2FA) en tu cuenta.';
    end if;
    perform app.auditar('empleados', 'cambio_permisos', new.nombre || ' (' || coalesce(new.codigo, '') || ')', 'OK', array_to_string(v_cambios, ' · '));
  end if;
  return new;
end;
$$;

drop trigger if exists tg_empleados_cambio_permisos on public.empleados;
create trigger tg_empleados_cambio_permisos before update on public.empleados
  for each row execute function app.tg_empleados_cambio_permisos();
