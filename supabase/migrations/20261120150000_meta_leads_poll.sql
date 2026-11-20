-- =====================================================================
-- Sincronización automática de leads de Meta por consulta (respaldo del webhook).
--   Meta puede bloquear la entrega por webhook («CRM access has been revoked from Lead Access Manager») aunque el
--   usuario del sistema sí pueda leer los leads por la Graph API. La Edge Function meta-leads-poll consulta los
--   formularios cada 5 minutos (pg_cron + pg_net) y procesa cada lead con la MISMA lógica del webhook
--   (_shared/metaServidor.ts › procesarLead; anti-duplicado por meta_lead_id en las dos vías).
--   · meta_sync_runs: registro de cada ejecución (cron o manual).
--   · Vault: 'meta_leads_cron_secret' (clave que manda el cron en x-cron-secret) y 'meta_leads_poll_url'
--     (dirección de la función en ESTE proyecto: la pone el interruptor del panel o el paso de despliegue, así una
--     base de producción nunca llama a la función de pruebas).
--   · El trabajo de pg_cron se llama 'meta-leads-poll' (cada 5 minutos).
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.meta_sync_runs (
  id               uuid primary key default gen_random_uuid(),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  source           text not null check (source in ('cron', 'manual')),
  desde            timestamptz,
  lookback_minutes integer,
  forms            integer not null default 0,
  found            integer not null default 0,
  inserted         integer not null default 0,
  duplicates       integer not null default 0,
  pruebas          integer not null default 0,
  errors           jsonb not null default '[]'::jsonb,
  aviso            text
);
select app.estandarizar('public.meta_sync_runs');
-- La ven quienes ven Marketing; solo el servidor (service_role) escribe.
select app.aplicar_rls('public.meta_sync_runs', array['marketing'], array['seguridad']);
create index if not exists meta_sync_runs_inicio_idx on public.meta_sync_runs (started_at desc);

-- Clave del cron (aleatoria, una sola vez)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'meta_leads_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
                                'meta_leads_cron_secret', 'Clave que manda pg_cron a la Edge Function meta-leads-poll (x-cron-secret)');
  end if;
end $$;

-- La Edge Function compara x-cron-secret con esta clave (solo service_role).
create or replace function public.meta_poll_clave()
returns text language sql stable security definer set search_path = public, vault
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'meta_leads_cron_secret' limit 1 $$;
revoke all on function public.meta_poll_clave() from public, anon, authenticated;

-- Programa (o quita) el trabajo de pg_cron. p_url: dirección de meta-leads-poll en este proyecto (se guarda en Vault).
create or replace function app.meta_poll_programar_interno(p_activo boolean, p_url text default null)
returns void language plpgsql security definer set search_path = public, app, vault
as $$
declare v_id uuid;
begin
  if p_url is not null then
    select id into v_id from vault.secrets where name = 'meta_leads_poll_url';
    if v_id is null then perform vault.create_secret(p_url, 'meta_leads_poll_url', 'Dirección de la Edge Function meta-leads-poll');
    else perform vault.update_secret(v_id, p_url); end if;
  end if;
  if exists (select 1 from cron.job where jobname = 'meta-leads-poll') then perform cron.unschedule('meta-leads-poll'); end if;
  if p_activo then
    if not exists (select 1 from vault.secrets where name = 'meta_leads_poll_url') then raise exception 'Falta la dirección de meta-leads-poll.'; end if;
    perform cron.schedule('meta-leads-poll', '*/5 * * * *', $cmd$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'meta_leads_poll_url'),
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_leads_cron_secret')),
        body := '{"source":"cron"}'::jsonb,
        timeout_milliseconds := 120000)
    $cmd$);
  end if;
end;
$$;
revoke all on function app.meta_poll_programar_interno(boolean, text) from public, anon, authenticated;

-- Estado para el panel: ¿está programada?, última ejecución y leads nuevos.
create or replace function public.meta_sync_estado()
returns jsonb language plpgsql stable security definer set search_path = public, app
as $$
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede ver la sincronización.'; end if;
  return jsonb_build_object(
    'programada', exists (select 1 from cron.job where jobname = 'meta-leads-poll' and active),
    'ultima', (select to_jsonb(x) from (
        select m.started_at, m.finished_at, m.source, m.desde, m.forms, m.found, m.inserted, m.duplicates, m.pruebas, m.errors, m.aviso
          from public.meta_sync_runs m where m.deleted_at is null order by m.started_at desc limit 1) x),
    'ultimaOk', (select max(m.started_at) from public.meta_sync_runs m where m.deleted_at is null and m.finished_at is not null and jsonb_array_length(m.errors) = 0),
    'nuevos24h', (select coalesce(sum(m.inserted), 0) from public.meta_sync_runs m where m.deleted_at is null and m.started_at > now() - interval '24 hours'));
end;
$$;
revoke all on function public.meta_sync_estado() from public, anon;
grant execute on function public.meta_sync_estado() to authenticated;

-- Interruptor del panel: activa o desactiva la sincronización cada 5 minutos.
create or replace function public.meta_poll_programar(p_activo boolean, p_url text)
returns jsonb language plpgsql security definer set search_path = public, app
as $$
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede cambiar la sincronización.'; end if;
  if p_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/meta-leads-poll$' then raise exception 'Dirección de la función no válida.'; end if;
  perform app.meta_poll_programar_interno(coalesce(p_activo, false), p_url);
  update public.integraciones set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('sync', jsonb_build_object('activo', coalesce(p_activo, false)))
   where proveedor = 'meta_leads';
  return public.meta_sync_estado();
end;
$$;
revoke all on function public.meta_poll_programar(boolean, text) from public, anon;
grant execute on function public.meta_poll_programar(boolean, text) to authenticated;

-- Si este proyecto ya tiene guardada la dirección de la función, queda programada (activa por defecto).
do $$
begin
  if exists (select 1 from vault.secrets where name = 'meta_leads_poll_url') then perform app.meta_poll_programar_interno(true, null); end if;
end $$;

notify pgrst, 'reload schema';
