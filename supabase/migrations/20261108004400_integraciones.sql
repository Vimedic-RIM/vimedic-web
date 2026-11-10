-- =====================================================================
-- Integraciones de Marketing: Zernio (redes sociales) y Gemini (IA).
-- La clave se guarda aquí y SOLO la lee la Edge Function (service_role).
-- El navegador nunca recibe el secreto: solo "configurado / últimos 4 / modelo / resultado de la prueba".
-- =====================================================================
create table public.integraciones (
  id            uuid primary key default gen_random_uuid(),
  proveedor     text not null unique check (proveedor in ('zernio', 'gemini')),
  secreto       text,
  config        jsonb not null default '{}'::jsonb,
  estado_prueba text,
  probado_en    timestamptz,
  actualizado_por uuid references public.empleados(id) on delete set null
);
select app.estandarizar('public.integraciones');
alter table public.integraciones enable row level security;
revoke all on public.integraciones from anon, authenticated;   -- sin políticas: nadie la lee desde el navegador

-- ¿Puede el usuario actual hacer esta acción en Marketing? (la usa la Edge Function con el token del usuario)
create or replace function public.marketing_puede(p_accion text)
returns boolean
language sql stable security definer set search_path = public, app
as $$ select app.puede('marketing', p_accion) $$;

-- Estado de las conexiones, sin el secreto.
create or replace function public.integraciones_estado()
returns table (proveedor text, configurado boolean, vista text, config jsonb, estado_prueba text, probado_en timestamptz, actualizado timestamptz)
language plpgsql stable security definer set search_path = public, app
as $$
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede ver las conexiones.'; end if;
  return query
    select p.proveedor,
           coalesce(i.secreto, '') <> '',
           case when coalesce(i.secreto, '') <> '' then '••••' || right(i.secreto, 4) else '' end,
           coalesce(i.config, '{}'::jsonb), i.estado_prueba, i.probado_en, i.updated_at
      from (values ('zernio'), ('gemini')) as p(proveedor)
      left join public.integraciones i on i.proveedor = p.proveedor and i.deleted_at is null;
end;
$$;

-- Guarda la clave (si viene vacía se conserva la anterior) y la configuración.
create or replace function public.integracion_guardar(p_proveedor text, p_secreto text, p_config jsonb)
returns void
language plpgsql security definer set search_path = public, app
as $$
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede cambiar las conexiones.'; end if;
  if p_proveedor not in ('zernio', 'gemini') then raise exception 'Proveedor no válido.'; end if;
  insert into public.integraciones (proveedor, secreto, config, actualizado_por)
  values (p_proveedor, nullif(trim(coalesce(p_secreto, '')), ''), coalesce(p_config, '{}'::jsonb), app.empleado_id())
  on conflict (proveedor) do update
    set secreto = coalesce(nullif(trim(coalesce(p_secreto, '')), ''), public.integraciones.secreto),
        config = coalesce(p_config, public.integraciones.config),
        estado_prueba = case when nullif(trim(coalesce(p_secreto, '')), '') is not null then null else public.integraciones.estado_prueba end,
        probado_en = case when nullif(trim(coalesce(p_secreto, '')), '') is not null then null else public.integraciones.probado_en end,
        actualizado_por = app.empleado_id(), deleted_at = null;
end;
$$;

create or replace function public.integracion_quitar(p_proveedor text)
returns void
language plpgsql security definer set search_path = public, app
as $$
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede cambiar las conexiones.'; end if;
  update public.integraciones set secreto = null, estado_prueba = null, probado_en = null, actualizado_por = app.empleado_id() where proveedor = p_proveedor;
end;
$$;

revoke all on function public.marketing_puede(text), public.integraciones_estado(), public.integracion_guardar(text, text, jsonb), public.integracion_quitar(text) from public, anon;
grant execute on function public.marketing_puede(text), public.integraciones_estado(), public.integracion_guardar(text, text, jsonb), public.integracion_quitar(text) to authenticated;
