-- Pruebas del buscador de clientes y de la restricción "cliente de otro asesor" (como el original). Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/crm_clientes_buscador.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;

insert into empleados (email, nombre, rol_id, empresa) values
  ('t.asesora@vimedic.test', 'T Asesora A', (select id from roles where nombre = 'Asesor'), 'VIMEDIC'),
  ('t.asesorb@vimedic.test', 'T Asesor B', (select id from roles where nombre = 'Asesor'), 'VIMEDIC'),
  ('t.jefe@vimedic.test', 'T Jefe', (select id from roles where nombre = 'Alta Dirección'), 'VIMEDIC'),
  ('t.asist@vimedic.test', 'T Asistente', (select id from roles where nombre = 'Asistente Comercial Gerencia'), 'VIMEDIC'),
  ('t.super@vimedic.test', 'T Supervisor', (select id from roles where nombre = 'Supervisor Comercial'), 'VIMEDIC');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 't.asesora@vimedic.test'), ('00000000-0000-0000-0000-0000000000c2', 't.asesorb@vimedic.test'),
  ('00000000-0000-0000-0000-0000000000c3', 't.jefe@vimedic.test'), ('00000000-0000-0000-0000-0000000000c4', 't.asist@vimedic.test'),
  ('00000000-0000-0000-0000-0000000000c5', 't.super@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.%@vimedic.test';
create temp table p as select email, id, auth_user_id from empleados where email like 't.%@vimedic.test';
grant select on p to authenticated;
insert into clientes (identificacion, nombre, asesor_id) values
  ('0999100001', 'José Pérez Zzprueba', (select id from p where email = 't.asesora@vimedic.test')),
  ('0999100002', 'Clínica Zzprueba De B', (select id from p where email = 't.asesorb@vimedic.test')),
  ('0999100003', 'Hospital Zzprueba Libre', null),
  ('0999100004', 'Doctor Zzprueba Del Jefe', (select id from p where email = 't.jefe@vimedic.test'));

-- ===== Asesora A
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.asesora@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 1, 'el buscador encuentra TODOS los clientes (los suyos primero)', 'Hospital Zzprueba Libre,José Pérez Zzprueba,Clínica Zzprueba De B,Doctor Zzprueba Del Jefe',
  (select string_agg(x ->> 'nombre', ',' order by o) from jsonb_array_elements(public.crm_buscar_clientes('zzprueba', 'VIMEDIC')) with ordinality t(x, o));
insert into r select 2, 'el de otro asesor sale bloqueado y sin cédula, ciudad ni teléfono', 'false · false',
  (select (x ->> 'propio') || ' · ' || (x ? 'identificacion')::text from jsonb_array_elements(public.crm_buscar_clientes('clinica zzprueba', 'VIMEDIC')) x);
insert into r select 3, 'sin tildes ni mayúsculas: "jose perez" encuentra a "José Pérez"', 'true · 0999100001',
  (select (x ->> 'propio') || ' · ' || (x ->> 'identificacion') from jsonb_array_elements(public.crm_buscar_clientes('JOSE perez', 'VIMEDIC')) x);
insert into r select 14, 'por dígitos: "+593 999 100 001" encuentra la cédula 0999100001', 'José Pérez Zzprueba', (select string_agg(x ->> 'nombre', ',') from jsonb_array_elements(public.crm_buscar_clientes('+593 999 100 001', 'VIMEDIC')) x where x ->> 'nombre' like '%Zzprueba%');
insert into r select 4, 'el cliente sin asesor es de todos: lo ve y lo puede editar', '1 · 1',
  (select count(*)::text from clientes where nombre = 'Hospital Zzprueba Libre') || ' · ' ||
  (select count(*)::text from (select 1 from clientes where nombre = 'Hospital Zzprueba Libre') x);
do $$ declare v int; begin
  with u as (update clientes set ciudad = 'Quito' where nombre = 'Hospital Zzprueba Libre' returning 1) select count(*) into v from u;
  insert into r values (5, 'edita el cliente sin asesor', '1', v::text);
  begin
    insert into cotizaciones (codigo, nombre, identificacion, asesor_id) values ('T-COT-AJENA', 'Prueba', '999100002', (select id from p where email = 't.asesora@vimedic.test'));
    insert into r values (6, 'NO puede cotizar con la cédula de un cliente de otro asesor (aunque escriba sin el 0)', 'bloqueado', 'PERMITIDO');
  exception when others then insert into r values (6, 'NO puede cotizar con la cédula de un cliente de otro asesor (aunque escriba sin el 0)', 'bloqueado', case when sqlerrm like '%ya está asignado al asesor T Asesor B%' then 'bloqueado' else left(sqlerrm, 80) end); end;
  begin
    insert into cotizaciones (codigo, nombre, identificacion, asesor_id) values ('T-COT-LIBRE', 'Prueba', '0999100003', (select id from p where email = 't.asesora@vimedic.test'));
    insert into r values (7, 'sí cotiza para el cliente sin asesor', 'ok', 'ok');
  exception when others then insert into r values (7, 'sí cotiza para el cliente sin asesor', 'ok', left(sqlerrm, 80)); end;
  begin
    insert into clientes (identificacion, nombre) values ('0999100002', 'Duplicado');
    insert into r values (8, 'un cliente con cédula ya registrada da un mensaje claro', 'mensaje', 'PERMITIDO');
  exception when others then insert into r values (8, 'un cliente con cédula ya registrada da un mensaje claro', 'mensaje', case when sqlerrm like 'Ya existe un cliente con la cédula/RUC 0999100002 ("Clínica Zzprueba De B", asignado a T Asesor B)%' then 'mensaje' else left(sqlerrm, 90) end); end;
  begin
    perform public.crm_buscar_clientes('zzprueba', 'FEMEDICS');
    insert into r values (9, 'no busca en los clientes de FEMEDICS sin acceso', 'bloqueado', 'PERMITIDO');
  exception when others then insert into r values (9, 'no busca en los clientes de FEMEDICS sin acceso', 'bloqueado', 'bloqueado'); end;
end $$;
reset role;

-- ===== Asistente Comercial Gerencia: el cliente del jefe queda a nombre del jefe
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.asist@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 10, 'para el asistente el cliente del jefe es propio (con datos)', 'true · 0999100004',
  (select (x ->> 'propio') || ' · ' || (x ->> 'identificacion') from jsonb_array_elements(public.crm_buscar_clientes('doctor zzprueba', 'VIMEDIC')) x);
do $$ declare v uuid; begin
  insert into cotizaciones (codigo, nombre, identificacion, asesor_id) values ('T-COT-JEFE', 'Prueba', '0999100004', (select id from p where email = 't.asist@vimedic.test')) returning asesor_id into v;
  insert into r values (11, 'la cotización del asistente para el cliente del jefe queda a nombre del jefe', 'true', (v = (select id from p where email = 't.jefe@vimedic.test'))::text);
exception when others then insert into r values (11, 'la cotización del asistente para el cliente del jefe queda a nombre del jefe', 'true', left(sqlerrm, 80)); end $$;
reset role;

-- ===== Supervisor (ve todo): sin restricción
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.super@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  insert into cotizaciones (codigo, nombre, identificacion, asesor_id) values ('T-COT-SUP', 'Prueba', '0999100002', (select id from p where email = 't.super@vimedic.test'));
  insert into r values (12, 'quien ve todo sí puede cotizar para cualquier cliente', 'ok', 'ok');
exception when others then insert into r values (12, 'quien ve todo sí puede cotizar para cualquier cliente', 'ok', left(sqlerrm, 80)); end $$;
insert into r select 13, 'para quien ve todo, todos son propios', '4', (select count(*)::text from jsonb_array_elements(public.crm_buscar_clientes('zzprueba', 'VIMEDIC')) x where (x ->> 'propio')::boolean);
reset role;

select n, prueba, esperado, obtenido, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado from r order by n;
rollback;
