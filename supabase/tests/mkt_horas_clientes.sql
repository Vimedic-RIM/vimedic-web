-- Pruebas: horas a las que llegan los clientes (migración 20261121090000). Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/mkt_horas_clientes.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;
create temp table x (k text primary key, v text) on commit drop;
grant all on x to authenticated;

insert into empleados (id, email, nombre, empresa, estado, cargo, permisos_extra) values
  ('00000000-0000-0000-0000-0000000b0001', 't.mh.mkt@vimedic.test', 'T Marketing', 'VIMEDIC', 'activo', 'Marketing', '{"marketing":["ver"]}'),
  ('00000000-0000-0000-0000-0000000b0002', 't.mh.otro@vimedic.test', 'T Sin Marketing', 'VIMEDIC', 'activo', 'Bodega', '{"inventario":["ver"]}');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000c0001', 't.mh.mkt@vimedic.test'), ('00000000-0000-0000-0000-0000000c0002', 't.mh.otro@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.email like 't.mh.%';

-- Leads de prueba (más de un día: el reparto no los toca). Miércoles 2026-11-18 19:30 en Ecuador = jueves 00:30 UTC.
insert into leads (codigo, nombre, empresa, origen_tipo, canal, fecha) values
  ('T-MH-1', 'Prueba 1', 'VIMEDIC', 'meta', 'Formulario Meta · Instagram', '2026-11-18 19:30:00-05'),
  ('T-MH-2', 'Prueba 2', 'VIMEDIC', 'meta', 'Formulario Meta · Instagram', '2026-11-18 19:05:00-05'),
  ('T-MH-3', 'Prueba 3', 'VIMEDIC', 'contacto', 'WhatsApp', '2026-11-16 08:10:00-05'),
  ('T-MH-4', 'Prueba 4', 'VIMEDIC', 'contacto', 'Llamada', '2025-01-10 10:00:00-05');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000c0001', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'mkt', public.mkt_horas_clientes(180)::text;
reset role;
-- Solo cuento las celdas de las fechas de prueba que no chocan con datos reales (se restan los reales de antes).
insert into r select 1, 'Instagram: miércoles (2) a las 19 h de Ecuador, 2 leads', 'sí',
  (select case when exists (select 1 from jsonb_array_elements(v::jsonb) e where e->>'red' = 'instagram' and (e->>'dia')::int = 2 and (e->>'hora')::int = 19 and (e->>'n')::int >= 2) then 'sí' else 'no' end from x where k = 'mkt');
insert into r select 2, 'WhatsApp: lunes (0) a las 8 h', 'sí',
  (select case when exists (select 1 from jsonb_array_elements(v::jsonb) e where e->>'red' = 'whatsapp' and (e->>'dia')::int = 0 and (e->>'hora')::int = 8) then 'sí' else 'no' end from x where k = 'mkt');
insert into r select 3, 'no devuelve nombres ni teléfonos', 'sí',
  (select case when v not like '%Prueba%' and v not like '%T-MH-%' then 'sí' else 'no' end from x where k = 'mkt');
insert into r select 4, 'solo las claves red, dia, hora y n', 'dia,hora,n,red',
  (select string_agg(distinct k2, ',' order by k2) from x, jsonb_array_elements(v::jsonb) e, jsonb_object_keys(e) k2 where x.k = 'mkt');

-- 5) Sin Marketing: no puede
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000c0002', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.mkt_horas_clientes(180); insert into x values ('otro', 'pudo');
exception when others then insert into x values ('otro', case when sqlerrm like 'Sin acceso a Marketing%' then 'sin acceso' else sqlerrm end); end $$;
reset role;
insert into r select 5, 'sin permiso de Marketing: sin acceso', 'sin acceso', (select v from x where k = 'otro');

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
