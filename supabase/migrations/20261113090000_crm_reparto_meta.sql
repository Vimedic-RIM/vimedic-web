-- =====================================================================
-- CRM: reparto justo de los clientes potenciales de Meta (LeadsMeta.gs)
-- y datos de la empresa para la guía de envío (fmGuardarConfig de Femedics.gs).
--
-- Reparto (igual que metaElegirAsesor_): entre los empleados activos de la
-- empresa con "Recibe clientes potenciales de Meta", le toca a quien menos
-- leads de Meta recibió en los últimos 30 días; si empatan, a quien lleva más
-- tiempo sin recibir uno; luego el orden de asignación. Si el cliente ya
-- existe con asesor, se respeta su asesor (no cuenta como turno).
-- Solo se reparten leads recientes (no los históricos que llegan con la carga
-- de datos), así una importación no reparte cientos de leads viejos.
-- =====================================================================

alter table public.leads add column if not exists asignado_en timestamptz;
alter table public.leads add column if not exists asignacion text
  check (asignacion is null or asignacion in ('reparto', 'manual', 'cliente existente'));
create index if not exists leads_meta_reparto_idx on public.leads (asesor_id, asignado_en) where origen_tipo = 'meta';

-- ---------------------------------------------------------------------
-- A quién le toca (null = nadie en el reparto)
-- ---------------------------------------------------------------------
create or replace function app.meta_elegir_asesor(p_empresa text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
    from public.empleados e
    left join lateral (
      select count(*) filter (where l.asignacion in ('reparto', 'manual')) as n, max(l.asignado_en) as ultimo
        from public.leads l
       where l.origen_tipo = 'meta' and l.asesor_id = e.id and l.deleted_at is null
         and l.asignado_en >= now() - interval '30 days'
    ) c on true
   where e.recibe_clientes_meta and e.estado = 'activo' and e.deleted_at is null and e.empresa = coalesce(p_empresa, 'VIMEDIC')
   order by coalesce(c.n, 0), c.ultimo nulls first, e.orden_asignacion nulls last, e.nombre
   limit 1
$$;
revoke all on function app.meta_elegir_asesor(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Al entrar un lead de Meta sin asesor: cliente existente → su asesor; si no, reparto justo
-- ---------------------------------------------------------------------
create or replace function app.tg_leads_meta_reparto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cli record;
  v_tel text := right(regexp_replace(coalesce(new.telefono, ''), '\D', '', 'g'), 9);
begin
  if new.origen_tipo <> 'meta' or new.asesor_id is not null or new.fecha < now() - interval '1 day' then
    return new;
  end if;
  new.medio_captacion := coalesce(new.medio_captacion, '📣 Anuncio en Facebook o Instagram');

  select c.id, c.asesor_id into v_cli
    from public.clientes c
   where c.deleted_at is null and c.empresa = new.empresa and c.asesor_id is not null
     and ((new.cliente_id is not null and c.id = new.cliente_id)
          or (length(v_tel) = 9 and right(regexp_replace(coalesce(c.telefono, ''), '\D', '', 'g'), 9) = v_tel)
          or (coalesce(new.email, '') <> '' and lower(c.email) = lower(new.email)))
   order by (c.id = new.cliente_id) desc nulls last
   limit 1;

  if v_cli.asesor_id is not null then
    new.asesor_id := v_cli.asesor_id; new.cliente_id := coalesce(new.cliente_id, v_cli.id); new.asignacion := 'cliente existente';
  else
    new.asesor_id := app.meta_elegir_asesor(new.empresa);
    if new.asesor_id is not null then new.asignacion := 'reparto'; end if;
  end if;
  if new.asesor_id is not null then new.asignado_en := now(); end if;
  return new;
end;
$$;

drop trigger if exists tg_leads_meta_reparto on public.leads;
create trigger tg_leads_meta_reparto before insert on public.leads
  for each row execute function app.tg_leads_meta_reparto();

-- Aviso interno al asesor que recibe el lead (y al equipo de Marketing si quedó sin asignar).
create or replace function app.tg_leads_meta_aviso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.origen_tipo <> 'meta' or new.fecha < now() - interval '1 day' then return new; end if;
  if new.asesor_id is not null then
    insert into public.notificaciones (id, para_id, modulo, evento, tipo, texto, entidad, entidad_id)
    values (gen_random_uuid(), new.asesor_id, case when new.empresa = 'FEMEDICS' then 'femedics' else 'crm' end, 'lead_meta', 'aviso',
            'Nuevo cliente potencial de Meta: ' || coalesce(nullif(new.nombre, ''), 'Sin nombre') || coalesce(' · ' || nullif(new.telefono, ''), '')
            || case when new.asignacion = 'cliente existente' then ' (ya era tu cliente)' else '' end,
            'leads', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists tg_leads_meta_aviso on public.leads;
create trigger tg_leads_meta_aviso after insert on public.leads
  for each row execute function app.tg_leads_meta_aviso();

-- ---------------------------------------------------------------------
-- Panel del reparto (vmLeadsMetaPanel): solo Marketing / administración del CRM
-- ---------------------------------------------------------------------
create or replace function app.meta_puede_panel()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select app.es_superadmin() or app.puede('marketing', 'editar') or app.puede('crm', 'administrar') or app.puede('femedics', 'administrar') $$;

create or replace function public.crm_meta_panel(p_empresa text default 'VIMEDIC')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sig uuid;
  res jsonb;
begin
  if not app.meta_puede_panel() then
    raise exception 'Solo Marketing puede ver y administrar el reparto de clientes potenciales.';
  end if;
  v_sig := app.meta_elegir_asesor(p_empresa);

  select jsonb_build_object(
    'siguiente', v_sig,
    'reparto', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'email', e.email, 'conTelefono', coalesce(e.telefono, '') <> '',
                                          'n30', coalesce(c.n, 0), 'ultimo', c.ultimo, 'siguiente', e.id = v_sig, 'orden', e.orden_asignacion)
                       order by e.orden_asignacion nulls last, e.nombre)
        from public.empleados e
        left join lateral (
          select count(*) filter (where l.asignacion in ('reparto', 'manual')) as n, max(l.asignado_en) as ultimo
            from public.leads l
           where l.origen_tipo = 'meta' and l.asesor_id = e.id and l.deleted_at is null and l.asignado_en >= now() - interval '30 days'
        ) c on true
       where e.recibe_clientes_meta and e.estado = 'activo' and e.deleted_at is null and e.empresa = p_empresa
    ), '[]'::jsonb),
    'fueraDelReparto', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'n30', x.n))
        from (select l.asesor_id, count(*) as n from public.leads l
               where l.origen_tipo = 'meta' and l.empresa = p_empresa and l.deleted_at is null and l.asignado_en >= now() - interval '30 days' and l.asesor_id is not null
               group by l.asesor_id) x
        join public.empleados e on e.id = x.asesor_id
       where not (e.recibe_clientes_meta and e.estado = 'activo' and e.deleted_at is null)
    ), '[]'::jsonb),
    'sinAsignar', (select count(*) from public.leads l where l.origen_tipo = 'meta' and l.empresa = p_empresa and l.deleted_at is null and l.asesor_id is null),
    'historial', coalesce((
      select jsonb_agg(h order by h.fecha desc) from (
        select l.id, l.codigo, l.fecha, l.nombre, l.telefono, l.ciudad, l.estado_crm, l.asesor_id, e.nombre as asesor, l.asignado_en, l.asignacion, l.anuncio,
               case when l.meta_datos->>'platform' ilike any (array['%ig%', '%instagram%']) then 'Instagram'
                    when l.meta_datos->>'platform' ilike any (array['%fb%', '%facebook%']) then 'Facebook' else '' end as red
          from public.leads l left join public.empleados e on e.id = l.asesor_id
         where l.origen_tipo = 'meta' and l.empresa = p_empresa and l.deleted_at is null
         order by l.fecha desc
         limit 300
      ) h
    ), '[]'::jsonb)
  ) into res;
  return res;
end;
$$;
revoke all on function public.crm_meta_panel(text) from public, anon;
grant execute on function public.crm_meta_panel(text) to authenticated;

-- ---------------------------------------------------------------------
-- Asignar / reasignar a mano (vmLeadsMetaAsignar): solo a alguien del reparto
-- ---------------------------------------------------------------------
create or replace function public.crm_meta_asignar(p_lead uuid, p_asesor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead record;
  v_asesor record;
  v_anterior text;
  v_yo text := (select nombre from public.empleados where id = app.empleado_id());
begin
  if not app.meta_puede_panel() then
    raise exception 'Solo Marketing puede asignar clientes potenciales.';
  end if;
  select l.id, l.codigo, l.nombre, l.empresa, l.asesor_id, l.cliente_id, l.origen_tipo into v_lead
    from public.leads l where l.id = p_lead and l.deleted_at is null;
  if v_lead.id is null then raise exception 'No se encontró el lead.'; end if;
  select e.id, e.nombre into v_asesor from public.empleados e
   where e.id = p_asesor and e.recibe_clientes_meta and e.estado = 'activo' and e.deleted_at is null and e.empresa = v_lead.empresa;
  if v_asesor.id is null then
    raise exception 'Esa persona no tiene el permiso "Recibe clientes potenciales de Meta" en Empleados.';
  end if;
  if v_lead.asesor_id = v_asesor.id then return jsonb_build_object('success', true, 'sin_cambio', true); end if;
  v_anterior := (select nombre from public.empleados where id = v_lead.asesor_id);

  update public.leads set asesor_id = v_asesor.id, asignado_en = now(), asignacion = 'manual', ultima_actividad = now() where id = p_lead;
  update public.clientes set asesor_id = v_asesor.id where id = v_lead.cliente_id and asesor_id is null;

  insert into public.interacciones (id, codigo, ref_tipo, ref_codigo, lead_id, tipo, nota, empleado_id, usuario_texto)
  values (gen_random_uuid(), 'INT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'Contacto', v_lead.codigo, p_lead, 'Asignación',
          case when v_anterior is not null then 'Reasignado de ' || v_anterior || ' a ' else 'Asignado a ' end || v_asesor.nombre || ' (Reparto Meta).',
          app.empleado_id(), v_yo);
  insert into public.notificaciones (id, para_id, modulo, evento, tipo, texto, entidad, entidad_id)
  values (gen_random_uuid(), v_asesor.id, case when v_lead.empresa = 'FEMEDICS' then 'femedics' else 'crm' end, 'lead_meta', 'aviso',
          'Te asignaron un cliente potencial de Meta: ' || coalesce(nullif(v_lead.nombre, ''), 'Sin nombre') || ' — por ' || coalesce(v_yo, 'Marketing') || '.', 'leads', p_lead);
  return jsonb_build_object('success', true);
end;
$$;
revoke all on function public.crm_meta_asignar(uuid, uuid) from public, anon;
grant execute on function public.crm_meta_asignar(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Datos de la empresa (remitente de la guía de envío). FEMEDICS los edita en su CRM.
-- ---------------------------------------------------------------------
create table if not exists public.empresa_datos (
  id            uuid primary key default gen_random_uuid(),
  empresa       text not null unique check (empresa = any (app.empresas_validas())),
  razon_social  text not null,
  ruc           text,
  telefono      text
);
select app.estandarizar('public.empresa_datos');
select app.aplicar_rls('public.empresa_datos', array['crm', 'femedics', 'facturacion', 'logistica', 'bodega'], array['seguridad']);

insert into public.empresa_datos (empresa, razon_social, ruc, telefono)
values ('VIMEDIC', 'Importaciones Médicas Richard', '1721050035001', '095 887 9773'),
       ('FEMEDICS', 'FEMEDICS IMPORTACIONES', null, null)
on conflict (empresa) do nothing;

create or replace function public.empresa_guardar_datos(p_empresa text, p_razon_social text, p_ruc text, p_telefono text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (app.es_superadmin()
          or (p_empresa = 'FEMEDICS' and app.puede('femedics', 'administrar'))
          or (p_empresa = 'VIMEDIC' and app.puede('crm', 'administrar'))) then
    raise exception 'No tienes permiso para cambiar los datos de la empresa.';
  end if;
  if btrim(coalesce(p_razon_social, '')) = '' then raise exception 'Escribe la razón social.'; end if;
  insert into public.empresa_datos (empresa, razon_social, ruc, telefono)
  values (p_empresa, left(btrim(p_razon_social), 200), nullif(left(btrim(coalesce(p_ruc, '')), 20), ''), nullif(left(btrim(coalesce(p_telefono, '')), 40), ''))
  on conflict (empresa) do update set razon_social = excluded.razon_social, ruc = excluded.ruc, telefono = excluded.telefono, deleted_at = null;
  perform app.auditar(case when p_empresa = 'FEMEDICS' then 'femedics' else 'crm' end, 'Datos de la empresa', p_empresa, 'OK', null);
  return jsonb_build_object('success', true);
end;
$$;
revoke all on function public.empresa_guardar_datos(text, text, text, text) from public, anon;
grant execute on function public.empresa_guardar_datos(text, text, text, text) to authenticated;
