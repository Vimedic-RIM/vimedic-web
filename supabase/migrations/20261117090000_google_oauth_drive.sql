-- =====================================================================
-- Google Drive por autorización (OAuth): «Conectar con Google» › elegir la cuenta › Permitir.
-- Sirve cuando Google Workspace no deja descargar la clave JSON de la cuenta de servicio
-- (política iam.disableServiceAccountKeyCreation). Como la app original, Drive se usa con la
-- cuenta de Google de la empresa.
--   · google_app: datos de la «app de Google» de VIMEDIC (ID de cliente y secreto de OAuth), una sola vez.
--   · drive: además de la cuenta de servicio, ahora guarda {"tipo":"oauth","refresh_token":…} o el puente de Apps Script.
-- Arreglo: la restricción de proveedores no admitía meta_pixel ni tiktok_pixel (no se podían guardar).
-- =====================================================================

alter table public.integraciones drop constraint if exists integraciones_proveedor_check;
alter table public.integraciones add constraint integraciones_proveedor_check
  check (proveedor in ('zernio', 'gemini', 'drive', 'meta_pixel', 'tiktok_pixel', 'google_app'));

create or replace function public.integraciones_estado()
returns table (proveedor text, configurado boolean, vista text, config jsonb, estado_prueba text, probado_en timestamptz, actualizado timestamptz)
language plpgsql stable security definer set search_path = public, app, vault
as $$
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede ver las conexiones.'; end if;
  return query
    select p.proveedor,
           i.secreto_id is not null,
           case when p.proveedor = 'drive' then (case when i.secreto_id is not null then 'Conexión guardada en Vault' else '' end)
                when i.secreto_id is not null then '•••• en Vault' else '' end,
           coalesce(i.config, '{}'::jsonb), i.estado_prueba, i.probado_en, i.updated_at
      from (values ('zernio'), ('gemini'), ('drive'), ('meta_pixel'), ('tiktok_pixel'), ('google_app')) as p(proveedor)
      left join public.integraciones i on i.proveedor = p.proveedor and i.deleted_at is null;
end;
$$;

create or replace function public.integracion_guardar(p_proveedor text, p_secreto text, p_config jsonb)
returns void
language plpgsql security definer set search_path = public, app, vault
as $$
declare v_actual uuid; v_nuevo text := nullif(trim(coalesce(p_secreto, '')), ''); v_id uuid;
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede cambiar las conexiones.'; end if;
  if p_proveedor not in ('zernio', 'gemini', 'drive', 'meta_pixel', 'tiktok_pixel', 'google_app') then raise exception 'Proveedor no válido.'; end if;

  select secreto_id into v_actual from public.integraciones where proveedor = p_proveedor and deleted_at is null;

  if v_nuevo is not null then
    if v_actual is not null then
      perform vault.update_secret(v_actual, v_nuevo);
      v_id := v_actual;
    else
      v_id := vault.create_secret(v_nuevo, 'integracion:' || p_proveedor || ':' || gen_random_uuid(), 'Clave de ' || p_proveedor);
    end if;
  else
    v_id := v_actual;
  end if;

  insert into public.integraciones (proveedor, secreto_id, config, actualizado_por)
  values (p_proveedor, v_id, coalesce(p_config, '{}'::jsonb), app.empleado_id())
  on conflict (proveedor) do update
    set secreto_id = v_id,
        config = coalesce(p_config, public.integraciones.config),
        estado_prueba = case when v_nuevo is not null then null else public.integraciones.estado_prueba end,
        probado_en = case when v_nuevo is not null then null else public.integraciones.probado_en end,
        actualizado_por = app.empleado_id(), deleted_at = null;
end;
$$;

-- Lo usa SOLO la Edge Function google-oauth (service_role) al volver de Google: guarda la autorización de Drive
-- sin borrar la configuración que ya había (ID de la unidad compartida) y deja anotado quién la autorizó.
create or replace function public.integracion_guardar_servicio(p_proveedor text, p_secreto text, p_config jsonb, p_empleado uuid)
returns void
language plpgsql security definer set search_path = public, vault
as $$
declare v_actual uuid; v_nuevo text := nullif(trim(coalesce(p_secreto, '')), ''); v_id uuid;
begin
  if p_proveedor not in ('drive') then raise exception 'Proveedor no válido.'; end if;
  if v_nuevo is null then raise exception 'Falta la autorización.'; end if;
  select secreto_id into v_actual from public.integraciones where proveedor = p_proveedor and deleted_at is null;
  if v_actual is not null then
    perform vault.update_secret(v_actual, v_nuevo); v_id := v_actual;
  else
    v_id := vault.create_secret(v_nuevo, 'integracion:' || p_proveedor || ':' || gen_random_uuid(), 'Clave de ' || p_proveedor);
  end if;
  insert into public.integraciones (proveedor, secreto_id, config, actualizado_por)
  values (p_proveedor, v_id, coalesce(p_config, '{}'::jsonb), p_empleado)
  on conflict (proveedor) do update
    set secreto_id = v_id,
        config = coalesce(public.integraciones.config, '{}'::jsonb) || coalesce(p_config, '{}'::jsonb),
        estado_prueba = null, probado_en = null,
        actualizado_por = p_empleado, deleted_at = null;
end;
$$;
revoke all on function public.integracion_guardar_servicio(text, text, jsonb, uuid) from public, anon, authenticated;
-- sin grant: solo service_role (la Edge Function) puede ejecutarla

notify pgrst, 'reload schema';
