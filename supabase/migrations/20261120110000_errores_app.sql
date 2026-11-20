-- =====================================================================
-- Registro de errores de pantalla (ErrorPantalla.tsx).
--   Cuando un módulo falla al mostrarse, la app guarda aquí qué pasó (mensaje, componente y pila), quién y dónde,
--   para corregir la causa exacta en vez de adivinar. Ejemplo que motivó esto (20-nov): «undefined is not iterable»
--   en Marketing, intermitente y sin pista de en qué parte.
--   · Escribe cualquier usuario con sesión, solo por la función (máx. 30 por persona por hora).
--   · Lee solo quien tiene Seguridad › ver.
-- =====================================================================

create table if not exists public.errores_app (
  id          uuid primary key default gen_random_uuid(),
  fecha       timestamptz not null default now(),
  empleado_id uuid references public.empleados(id) on delete set null,
  donde       text,
  mensaje     text,
  componentes text,
  pila        text,
  url         text,
  version     text,
  navegador   text
);
select app.estandarizar('public.errores_app');
select app.aplicar_rls('public.errores_app', array['seguridad'], array['seguridad']);
create index if not exists errores_app_fecha_idx on public.errores_app (fecha desc);

create or replace function public.registrar_error_app(p jsonb)
returns void
language plpgsql security definer set search_path = public, app
as $$
declare yo uuid := app.empleado_id();
begin
  if auth.uid() is null then return; end if;
  -- Sin inundar la tabla si algo entra en bucle.
  if (select count(*) from public.errores_app where empleado_id is not distinct from yo and fecha > now() - interval '1 hour') >= 30 then return; end if;
  insert into public.errores_app (empleado_id, donde, mensaje, componentes, pila, url, version, navegador)
  values (yo, left(p ->> 'donde', 120), left(p ->> 'mensaje', 1000), left(p ->> 'componentes', 4000), left(p ->> 'pila', 4000),
          left(p ->> 'url', 300), left(p ->> 'version', 120), left(p ->> 'navegador', 300));
end;
$$;
revoke all on function public.registrar_error_app(jsonb) from public, anon;
grant execute on function public.registrar_error_app(jsonb) to authenticated;

notify pgrst, 'reload schema';
