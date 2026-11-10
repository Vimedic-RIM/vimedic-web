-- =====================================================================
-- Cierra el pendiente de seguridad: las claves de Zernio, Gemini y Drive
-- pasan de texto plano a Supabase Vault (cifradas con pgsodium, autenticadas
-- con AAD = proveedor, para que un secreto no se pueda copiar a otra fila).
-- =====================================================================

alter table public.integraciones add column if not exists secreto_id uuid references vault.secrets(id) on delete set null;

-- Migra lo que ya estuviera guardado en texto plano (no debería haber nada aún, pero por si acaso).
do $$
declare r record; v_id uuid;
begin
  for r in select id, proveedor, secreto from public.integraciones where secreto is not null and secreto_id is null loop
    v_id := vault.create_secret(r.secreto, 'integracion:' || r.proveedor, 'Clave de ' || r.proveedor || ' (migrada)');
    update public.integraciones set secreto_id = v_id where id = r.id;
  end loop;
end $$;

alter table public.integraciones drop column if exists secreto;

create or replace function public.integraciones_estado()
returns table (proveedor text, configurado boolean, vista text, config jsonb, estado_prueba text, probado_en timestamptz, actualizado timestamptz)
language plpgsql stable security definer set search_path = public, app, vault
as $$
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede ver las conexiones.'; end if;
  return query
    select p.proveedor,
           i.secreto_id is not null,
           case when p.proveedor = 'drive' then (case when i.secreto_id is not null then 'JSON guardado en Vault' else '' end)
                when i.secreto_id is not null then '•••• en Vault' else '' end,
           coalesce(i.config, '{}'::jsonb), i.estado_prueba, i.probado_en, i.updated_at
      from (values ('zernio'), ('gemini'), ('drive')) as p(proveedor)
      left join public.integraciones i on i.proveedor = p.proveedor and i.deleted_at is null;
end;
$$;

-- Guarda la clave en Vault (si viene vacía se conserva la anterior) y la configuración.
create or replace function public.integracion_guardar(p_proveedor text, p_secreto text, p_config jsonb)
returns void
language plpgsql security definer set search_path = public, app, vault
as $$
declare v_actual uuid; v_nuevo text := nullif(trim(coalesce(p_secreto, '')), ''); v_id uuid;
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede cambiar las conexiones.'; end if;
  if p_proveedor not in ('zernio', 'gemini', 'drive') then raise exception 'Proveedor no válido.'; end if;

  select secreto_id into v_actual from public.integraciones where proveedor = p_proveedor and deleted_at is null;

  if v_nuevo is not null then
    if v_actual is not null then
      perform vault.update_secret(v_actual, v_nuevo);
      v_id := v_actual;
    else
      v_id := vault.create_secret(v_nuevo, 'integracion:' || p_proveedor, 'Clave de ' || p_proveedor);
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

create or replace function public.integracion_quitar(p_proveedor text)
returns void
language plpgsql security definer set search_path = public, app, vault
as $$
declare v_id uuid;
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede cambiar las conexiones.'; end if;
  select secreto_id into v_id from public.integraciones where proveedor = p_proveedor and deleted_at is null;
  update public.integraciones set secreto_id = null, estado_prueba = null, probado_en = null, actualizado_por = app.empleado_id() where proveedor = p_proveedor;
  if v_id is not null then delete from vault.secrets where id = v_id; end if;
end;
$$;

revoke all on function public.marketing_puede(text), public.integraciones_estado(), public.integracion_guardar(text, text, jsonb), public.integracion_quitar(text) from public, anon;
grant execute on function public.marketing_puede(text), public.integraciones_estado(), public.integracion_guardar(text, text, jsonb), public.integracion_quitar(text) to authenticated;

-- Solo la usan las Edge Functions, con service_role: descifra el secreto de un proveedor.
create or replace function public.integracion_secreto(p_proveedor text)
returns text
language sql stable security definer set search_path = public, vault
as $$
  select vs.decrypted_secret
    from public.integraciones i join vault.decrypted_secrets vs on vs.id = i.secreto_id
   where i.proveedor = p_proveedor and i.deleted_at is null
$$;
revoke all on function public.integracion_secreto(text) from public, anon, authenticated;
-- sin grant a authenticated: solo service_role (las Edge Functions) puede ejecutarla
