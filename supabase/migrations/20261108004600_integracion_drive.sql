-- Google Drive como tercera integración (cuenta de servicio + unidad compartida "VIMEDIC Sistema").
-- El secreto es el JSON de la cuenta de servicio; la configuración guarda el ID de la unidad compartida.
alter table public.integraciones drop constraint if exists integraciones_proveedor_check;
alter table public.integraciones add constraint integraciones_proveedor_check check (proveedor in ('zernio', 'gemini', 'drive'));

-- ¿Puede el usuario actual hacer esta acción en este módulo? (la usan las Edge Functions con el token del usuario)
create or replace function public.app_puede(p_modulo text, p_accion text)
returns boolean
language sql stable security definer set search_path = public, app
as $$ select app.puede(p_modulo, p_accion) $$;
revoke all on function public.app_puede(text, text) from public, anon;
grant execute on function public.app_puede(text, text) to authenticated;

create or replace function public.integraciones_estado()
returns table (proveedor text, configurado boolean, vista text, config jsonb, estado_prueba text, probado_en timestamptz, actualizado timestamptz)
language plpgsql stable security definer set search_path = public, app
as $$
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede ver las conexiones.'; end if;
  return query
    select p.proveedor,
           coalesce(i.secreto, '') <> '',
           case when p.proveedor = 'drive' then (case when coalesce(i.secreto, '') <> '' then 'JSON guardado' else '' end)
                when coalesce(i.secreto, '') <> '' then '••••' || right(i.secreto, 4) else '' end,
           coalesce(i.config, '{}'::jsonb), i.estado_prueba, i.probado_en, i.updated_at
      from (values ('zernio'), ('gemini'), ('drive')) as p(proveedor)
      left join public.integraciones i on i.proveedor = p.proveedor and i.deleted_at is null;
end;
$$;

create or replace function public.integracion_guardar(p_proveedor text, p_secreto text, p_config jsonb)
returns void
language plpgsql security definer set search_path = public, app
as $$
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede cambiar las conexiones.'; end if;
  if p_proveedor not in ('zernio', 'gemini', 'drive') then raise exception 'Proveedor no válido.'; end if;
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
