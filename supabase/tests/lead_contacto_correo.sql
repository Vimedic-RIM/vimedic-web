-- Pruebas: contacto desde el correo del lead (migración 20261120160000). Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/lead_contacto_correo.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;
create temp table x (k text primary key, v text) on commit drop;

insert into empleados (id, email, nombre, empresa, estado, cargo) values
  ('00000000-0000-0000-0000-00000000c001', 't.cont.a@vimedic.test', 'T Asesora Uno', 'VIMEDIC', 'activo', 'Asesor'),
  ('00000000-0000-0000-0000-00000000c002', 't.cont.b@vimedic.test', 'T Asesor Dos', 'VIMEDIC', 'activo', 'Asesor');
-- Leads de más de un día: el reparto no los toca y se les pone el asesor a mano.
insert into leads (id, codigo, nombre, telefono, empresa, origen_tipo, canal, fecha, estado_crm, meta_lead_id, meta_datos) values
  ('00000000-0000-0000-0000-00000000d001', 'META-T1', 'Cliente Uno', '0991234567', 'VIMEDIC', 'meta', 'Facebook', now() - interval '3 days', 'Nuevo', 'T-1', '{"formulario":"Autoclaves nov","respuestas":[]}'),
  ('00000000-0000-0000-0000-00000000d002', 'META-T2', 'Cliente Dos', '0991234568', 'VIMEDIC', 'meta', 'Instagram', now() - interval '3 days', 'Seguimiento', 'T-2', '{}'),
  ('00000000-0000-0000-0000-00000000d003', 'META-T3', 'Cliente Tres', '0991234569', 'VIMEDIC', 'meta', 'Facebook', now() - interval '3 days', 'Ganado', 'T-3', '{}'),
  ('00000000-0000-0000-0000-00000000d004', 'META-T4', 'Cliente Cuatro', null, 'VIMEDIC', 'meta', 'Facebook', now() - interval '3 days', 'Nuevo', 'T-4', '{}');
update leads set asesor_id = '00000000-0000-0000-0000-00000000c001', proximo_seguimiento = null where codigo like 'META-T%';

-- 1-3) Nuevo → Contactado, seguimiento a 1 día, observación con el medio y el origen
insert into x select 'wa', public.lead_contacto_correo('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'wa')::text;
insert into r select 1, 'Nuevo → Contactado', 'Contactado · true · true', (select estado_crm from leads where codigo = 'META-T1') || ' · ' || (v::jsonb ->> 'registrado') || ' · ' || (v::jsonb ->> 'cambio') from x where k = 'wa';
insert into r select 2, 'próximo seguimiento en 1 día', 'sí', (select case when proximo_seguimiento between now() + interval '23 hours 59 minutes' and now() + interval '1 day 1 minute' then 'sí' else 'no: ' || coalesce(proximo_seguimiento::text, 'nulo') end from leads where codigo = 'META-T1');
insert into r select 3, 'historial: Contacto Registrado con medio, espera y observación', 'Contacto Registrado · T Asesora Uno · sí',
  (select tipo || ' · ' || usuario_texto || ' · ' || case when nota like 'Medio: WhatsApp — Espera de respuesta hasta: % — Observación: Se contactó mediante el correo de aviso del lead que llegó a través de Facebook (formulario «Autoclaves nov»).' then 'sí' else nota end
     from interacciones where lead_id = '00000000-0000-0000-0000-00000000d001' order by created_at desc limit 1);
-- 4) Tocar otra vez el mismo botón: no se repite
insert into x select 'wa2', public.lead_contacto_correo('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'wa')::text;
insert into r select 4, 'tocar dos veces no repite la gestión', 'false · repetido · 1', (v::jsonb ->> 'registrado') || ' · ' || (v::jsonb ->> 'motivo') || ' · ' || (select count(*) from interacciones where lead_id = '00000000-0000-0000-0000-00000000d001') from x where k = 'wa2';
-- 5) Después llama: queda como seguimiento (ya estaba en Contactado)
insert into x select 'tel', public.lead_contacto_correo('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'tel')::text;
insert into r select 5, 'la llamada después: seguimiento, sigue en Contactado', 'Contactado · Seguimiento · Medio: Llamada',
  (select estado_crm from leads where codigo = 'META-T1') || ' · ' || (select tipo || ' · ' || split_part(nota, ' — ', 1) from interacciones where lead_id = '00000000-0000-0000-0000-00000000d001' and nota like 'Medio: Llamada%');
-- 6) Lead en Seguimiento: no retrocede, el próximo seguimiento pasa a 1 día
insert into x select 'seg', public.lead_contacto_correo('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c001', 'tel')::text;
insert into r select 6, 'en Seguimiento: no retrocede y reprograma a 1 día', 'Seguimiento · sí',
  (select estado_crm || ' · ' || case when proximo_seguimiento > now() + interval '23 hours' then 'sí' else 'no' end from leads where codigo = 'META-T2');
-- 7) Ganado: la etapa no cambia ni la fecha
insert into x select 'gan', public.lead_contacto_correo('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c001', 'wa')::text;
insert into r select 7, 'Ganado: no cambia etapa ni fecha', 'Ganado · nulo', (select estado_crm || ' · ' || coalesce(proximo_seguimiento::text, 'nulo') from leads where codigo = 'META-T3');
-- 8) Otro asesor (lead reasignado): no registra nada
insert into x select 'otro', public.lead_contacto_correo('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c002', 'wa')::text;
insert into r select 8, 'otro asesor no registra', 'false · reasignado', (v::jsonb ->> 'registrado') || ' · ' || (v::jsonb ->> 'motivo') from x where k = 'otro';
-- 9) Sin teléfono: error claro
do $$ begin perform public.lead_contacto_correo('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', 'wa'); insert into r values (9, 'sin teléfono: error', 'error', 'pasó');
exception when others then insert into r values (9, 'sin teléfono: error', 'error', case when sqlerrm like 'El cliente no dejó teléfono%' then 'error' else sqlerrm end); end $$;
-- 10) El navegador (anon / sesión) no puede llamar a la función ni leer la clave
set local role authenticated;
do $$ begin perform public.lead_contacto_correo('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-00000000c001', 'wa'); insert into r values (10, 'sin service_role no se puede', 'sin permiso', 'pasó');
exception when insufficient_privilege then insert into r values (10, 'sin service_role no se puede', 'sin permiso', 'sin permiso'); end $$;
do $$ begin perform public.lead_contacto_clave(); insert into r values (11, 'la clave no se lee desde el navegador', 'sin permiso', 'la leyó');
exception when insufficient_privilege then insert into r values (11, 'la clave no se lee desde el navegador', 'sin permiso', 'sin permiso'); end $$;
reset role;

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
