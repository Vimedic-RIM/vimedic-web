-- Pruebas: Meta Lead Ads → CRM (migración 20261120120000 + Edge Function meta-leads).
-- El lead se inserta como lo hace la función (upsert por meta_lead_id): recibe asesor por reparto, avisa al asesor
-- y no se duplica si Meta lo vuelve a enviar. Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/meta_leads.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;

-- Reparto controlado: solo un asesor de prueba recibe leads de Meta en esta transacción.
update empleados set recibe_clientes_meta = false where recibe_clientes_meta and empresa = 'VIMEDIC';
insert into empleados (email, nombre, empresa, estado, cargo, recibe_clientes_meta) values ('t.meta.ase@vimedic.test', 'T Asesor Meta', 'VIMEDIC', 'activo', 'Asesor comercial', true);

-- 1) Proveedor nuevo
insert into r select 1, 'integraciones_estado incluye meta_leads (para quien administra)', 'meta_leads',
  (select string_agg(x, ',') from unnest(array['meta_leads']) x where exists (select 1 from pg_constraint where conname = 'integraciones_proveedor_check' and pg_get_constraintdef(oid) like '%meta_leads%'));

-- 2) Lead como lo inserta la función
insert into leads (codigo, meta_lead_id, origen_tipo, empresa, fecha, nombre, telefono, email, ciudad, interes, canal, anuncio, medio_captacion, meta_datos, atribucion)
values ('META-T9000001', 'T9000001', 'meta', 'VIMEDIC', now(), 'María Prueba Meta', '0990000001', 'maria.meta@prueba.ec', 'Quito', 'Área a equipar: Quirófano', 'Instagram', 'Autoclaves nov',
        '📣 Anuncio en Facebook o Instagram', '{"platform":"ig"}', '{"anuncio_id":"120211","campana_id":"120213"}')
on conflict (meta_lead_id) do nothing;
insert into r select 2, 'el lead entra con asesor por reparto justo', 'T Asesor Meta · reparto · Nuevo',
  (select e.nombre || ' · ' || l.asignacion || ' · ' || l.estado_crm from leads l join empleados e on e.id = l.asesor_id where l.meta_lead_id = 'T9000001');
insert into r select 3, 'el asesor recibe el aviso', '1',
  (select count(*)::text from notificaciones n join empleados e on e.id = n.para_id where e.email = 't.meta.ase@vimedic.test' and n.evento = 'lead_meta');

-- 3) Meta reenvía el mismo lead: no se duplica ni avisa otra vez
insert into leads (codigo, meta_lead_id, origen_tipo, empresa, fecha, nombre)
values ('META-T9000001', 'T9000001', 'meta', 'VIMEDIC', now(), 'María Prueba Meta')
on conflict (meta_lead_id) do nothing;
insert into r select 4, 'reenvío de Meta: sigue habiendo un solo lead y un solo aviso', '1 · 1',
  (select count(*)::text from leads where meta_lead_id = 'T9000001') || ' · ' ||
  (select count(*)::text from notificaciones n join empleados e on e.id = n.para_id where e.email = 't.meta.ase@vimedic.test' and n.evento = 'lead_meta');

-- 4) Cliente que ya existe con asesor: se respeta su asesor
insert into empleados (email, nombre, empresa, estado, cargo) values ('t.meta.otro@vimedic.test', 'T Asesor Del Cliente', 'VIMEDIC', 'activo', 'Asesor comercial');
insert into clientes (nombre, empresa, telefono, asesor_id) select 'Cliente Meta Existente', 'VIMEDIC', '0990000002', id from empleados where email = 't.meta.otro@vimedic.test';
insert into leads (codigo, meta_lead_id, origen_tipo, empresa, fecha, nombre, telefono) values ('META-T9000002', 'T9000002', 'meta', 'VIMEDIC', now(), 'Cliente Meta Existente', '+593 99 000 0002')
on conflict (meta_lead_id) do nothing;
insert into r select 5, 'si ya era cliente, va a su asesor', 'T Asesor Del Cliente · cliente existente',
  (select e.nombre || ' · ' || l.asignacion from leads l join empleados e on e.id = l.asesor_id where l.meta_lead_id = 'T9000002');

-- 5) Un lead viejo (traído días después) entra sin asesor, para asignarlo a mano
insert into leads (codigo, meta_lead_id, origen_tipo, empresa, fecha, nombre) values ('META-T9000003', 'T9000003', 'meta', 'VIMEDIC', now() - interval '3 days', 'Lead Viejo Meta')
on conflict (meta_lead_id) do nothing;
insert into r select 6, 'lead de hace 3 días entra sin asesor', 'sin asesor', (select coalesce(asesor_id::text, 'sin asesor') from leads where meta_lead_id = 'T9000003');

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
