-- =====================================================================
-- Verificación en dos pasos (MFA / TOTP).
-- Supabase ya trae el enrolamiento y el desafío listos (auth.mfa.*); aquí solo:
--   1) una función que dice si la sesión actual cumple el nivel exigido, y
--   2) políticas RESTRICTIVE que, SOLO para quien YA se inscribió en MFA,
--      exigen haber completado el segundo paso (aal2) para hacer cambios
--      en lo más sensible: roles y permisos, datos de empleados, y
--      restauraciones de Bases de Datos.
-- Quien no se ha inscrito sigue entrando normal (aal1) — esto nunca bloquea
-- a nadie que no haya activado la verificación en dos pasos.
-- =====================================================================

create or replace function app.exigir_mfa()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when exists (
      select 1 from auth.mfa_factors
       where user_id = auth.uid() and status = 'verified'
    )
    then coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
    else true
  end;
$$;
comment on function app.exigir_mfa() is
  'true si la sesión puede hacer cambios sensibles: o no se inscribió en MFA (aal1 basta), o sí se inscribió y completó el segundo paso (aal2).';

-- Postgres exige una política RESTRICTIVE por comando (no admite una lista como "insert, update, delete").
do $$
declare
  v_tablas regclass[] := array['public.roles', 'public.bd_tablas', 'public.bd_registros'];
  v_comandos text[] := array['insert', 'update', 'delete'];
  t regclass; c text;
begin
  foreach t in array v_tablas loop
    foreach c in array v_comandos loop
      execute format('drop policy if exists rls_mfa_%s on %s', c, t);
      if c = 'insert' then
        execute format('create policy rls_mfa_%s on %s as restrictive for insert to authenticated with check (app.exigir_mfa())', c, t);
      elsif c = 'delete' then
        execute format('create policy rls_mfa_%s on %s as restrictive for delete to authenticated using (app.exigir_mfa())', c, t);
      else
        execute format('create policy rls_mfa_%s on %s as restrictive for update to authenticated using (app.exigir_mfa()) with check (app.exigir_mfa())', c, t);
      end if;
    end loop;
  end loop;
end $$;

-- Empleados: modificar un registro (incluye asignar rol) exige el segundo paso a quien ya se inscribió
-- (no se toca SELECT/INSERT: el directorio y el alta de empleados siguen igual para todos).
drop policy if exists rls_mfa_update on public.empleados;
create policy rls_mfa_update on public.empleados as restrictive for update to authenticated
  using (app.exigir_mfa()) with check (app.exigir_mfa());

revoke all on function app.exigir_mfa() from public, anon;
grant execute on function app.exigir_mfa() to authenticated;
