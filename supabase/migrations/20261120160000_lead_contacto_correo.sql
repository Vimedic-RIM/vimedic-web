-- =====================================================================
-- Contacto desde el correo del lead de Meta.
--   Los botones «WhatsApp» y «Llamar» del correo urgente al asesor pasan por la página pública /contacto-lead/
--   (enlace firmado). Al tocarlos, la Edge Function lead-contacto registra la gestión y abre WhatsApp o la llamada:
--   · Nuevo → Contactado, con la observación «Se contactó mediante el correo de aviso del lead que llegó a través de…»
--     y espera de respuesta (próximo seguimiento) de 1 día. Igual que el formulario «Pasar a Contactado» del CRM.
--   · Ya gestionado (Contactado, Seguimiento…): queda como seguimiento y el próximo seguimiento pasa a 1 día.
--   · Ganado o Perdido: solo queda en el historial (la etapa no cambia).
--   · Solo cuenta si quien toca es el asesor que tiene el lead (si se reasignó, solo abre el chat o la llamada).
--   Firma de los enlaces: clave aleatoria en Vault ('leads_contacto_secreto'); solo la lee el servidor.
-- =====================================================================

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'leads_contacto_secreto') then
    perform vault.create_secret(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
                                'leads_contacto_secreto', 'Firma de los enlaces WhatsApp/Llamar del correo de leads (Edge Function lead-contacto)');
  end if;
end $$;

create or replace function public.lead_contacto_clave()
returns text language sql stable security definer set search_path = public, vault
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'leads_contacto_secreto' limit 1 $$;
revoke all on function public.lead_contacto_clave() from public, anon, authenticated;

create or replace function public.lead_contacto_correo(p_lead uuid, p_asesor uuid, p_via text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  l record;
  v_medio text;
  v_asesor text;
  v_prox timestamptz := now() + interval '1 day';
  v_ec timestamp;
  v_txt text;
  v_nota text;
  v_tipo text;
  v_estado text;
  v_cambio boolean := false;
  v_datos jsonb;
begin
  if p_via not in ('wa', 'tel') then raise exception 'Medio de contacto no válido.'; end if;
  v_medio := case p_via when 'wa' then 'WhatsApp' else 'Llamada' end;

  select id, codigo, nombre, telefono, asesor_id, coalesce(nullif(btrim(estado_crm), ''), 'Nuevo') as estado, canal, meta_datos, origen_tipo
    into l from public.leads where id = p_lead and deleted_at is null;
  if l.id is null then raise exception 'Esta gestión ya no existe en el CRM.'; end if;
  if nullif(btrim(coalesce(l.telefono, '')), '') is null then raise exception 'El cliente no dejó teléfono.'; end if;
  select nombre into v_asesor from public.empleados where id = p_asesor;

  v_datos := jsonb_build_object('codigo', l.codigo, 'nombre', l.nombre, 'telefono', l.telefono, 'asesor', coalesce(v_asesor, ''),
                                'respuestas', coalesce(l.meta_datos -> 'respuestas', '[]'::jsonb));

  -- Solo el asesor que tiene el lead registra la gestión.
  if l.asesor_id is distinct from p_asesor then
    return v_datos || jsonb_build_object('registrado', false, 'motivo', 'reasignado', 'estado', l.estado);
  end if;
  -- Recargar la página o tocar dos veces no repite la gestión.
  if exists (select 1 from public.interacciones i where i.lead_id = p_lead and i.deleted_at is null and i.created_at > now() - interval '2 minutes'
               and i.nota like 'Medio: ' || v_medio || ' — %correo de aviso del lead%') then
    return v_datos || jsonb_build_object('registrado', false, 'motivo', 'repetido', 'estado', l.estado);
  end if;

  v_ec := v_prox at time zone 'America/Guayaquil';
  v_txt := lpad(extract(day from v_ec)::int::text, 2, '0') || ' '
        || (array['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'])[extract(month from v_ec)::int]
        || ' ' || to_char(v_ec, 'HH24:MI');
  v_nota := 'Medio: ' || v_medio || ' — Espera de respuesta hasta: ' || v_txt
         || ' — Observación: Se contactó mediante el correo de aviso del lead que llegó a través de '
         || coalesce(nullif(btrim(coalesce(l.canal, '')), ''), 'Meta')
         || coalesce(' (formulario «' || nullif(btrim(l.meta_datos ->> 'formulario'), '') || '»)', '') || '.';

  if l.estado = 'Nuevo' then
    update public.leads set estado_crm = 'Contactado', ultima_actividad = now(), proximo_seguimiento = v_prox where id = p_lead;
    v_cambio := true; v_estado := 'Contactado'; v_tipo := 'Contacto Registrado';
  elsif lower(l.estado) in ('ganado', 'perdido') then
    v_estado := l.estado; v_tipo := 'Seguimiento';
  else
    update public.leads set ultima_actividad = now(), proximo_seguimiento = v_prox where id = p_lead;
    v_estado := l.estado; v_tipo := 'Seguimiento';
  end if;

  insert into public.interacciones (id, codigo, ref_tipo, ref_codigo, lead_id, tipo, nota, empleado_id, usuario_texto)
  values (gen_random_uuid(), 'INT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
          case l.origen_tipo when 'whatsapp' then 'Chat WhatsApp' when 'cita' then 'Cita' else 'Contacto' end,
          l.codigo, p_lead, v_tipo, left(v_nota, 3000), p_asesor, v_asesor);

  return v_datos || jsonb_build_object('registrado', true, 'cambio', v_cambio, 'estado', v_estado,
                                       'seguimiento', case when lower(l.estado) in ('ganado', 'perdido') then null else v_txt end);
end;
$$;
revoke all on function public.lead_contacto_correo(uuid, uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
