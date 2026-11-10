-- Expone app.exigir_mfa() a la API (las Edge Functions la llaman con el token del usuario,
-- igual que app_puede, para exigir el segundo paso en acciones sensibles).
create or replace function public.app_exigir_mfa()
returns boolean
language sql stable security definer set search_path = public, app, auth
as $$ select app.exigir_mfa() $$;
revoke all on function public.app_exigir_mfa() from public, anon;
grant execute on function public.app_exigir_mfa() to authenticated;
