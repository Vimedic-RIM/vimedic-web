-- Pruebas: solo quien tiene la autorización «Documentos técnicos» (o Servicio Técnico / Marketing) ve los documentos técnicos.
-- Correr SOLO en PRUEBAS; se deshace.   npx supabase db query --remote --yes -f supabase/tests/documentos_tecnicos_ver.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated, anon, service_role;

insert into empleados (email, nombre, empresa, permisos_extra) values
  ('t.dt.inv@vimedic.test', 'T Solo Inventario', 'VIMEDIC', '{"inventario":["ver"]}'::jsonb),
  ('t.dt.aut@vimedic.test', 'T Inventario con documentos', 'VIMEDIC', '{"inventario":["ver"],"documentos_tecnicos":["ver"]}'::jsonb),
  ('t.dt.mkt@vimedic.test', 'T Marketing', 'VIMEDIC', '{"marketing":["ver"]}'::jsonb);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 't.dt.inv@vimedic.test'), ('00000000-0000-0000-0000-0000000000e2', 't.dt.aut@vimedic.test'), ('00000000-0000-0000-0000-0000000000e3', 't.dt.mkt@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.dt.%';
create temp table p as select email, auth_user_id from empleados where email like 't.dt.%';
grant select on p to authenticated;
insert into r select 0, 'hay documentos técnicos para probar', 'sí', case when count(*) > 0 then 'sí' else 'no' end from documentos_tecnicos where deleted_at is null;

select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.dt.inv@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 1, 'solo Inventario: NO ve los documentos técnicos', '0', count(*)::text from documentos_tecnicos;
insert into r select 2, 'solo Inventario: sí ve los productos', 'sí', case when count(*) > 0 then 'sí' else 'no' end from (select 1 from productos limit 1) x;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.dt.aut@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 3, 'con la autorización «Documentos técnicos»: los ve', 'sí', case when count(*) > 0 then 'sí' else 'no' end from documentos_tecnicos;
do $$ declare k int; begin
  update documentos_tecnicos set notas = notas where deleted_at is null; get diagnostics k = row_count;
  insert into r values (4, 'con solo «ver» no puede cambiarlos (no afecta filas)', '0', k::text);
exception when others then insert into r values (4, 'con solo «ver» no puede cambiarlos (no afecta filas)', '0', left(sqlerrm, 80)); end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.dt.mkt@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 5, 'Marketing los sigue viendo (Multimedia)', 'sí', case when count(*) > 0 then 'sí' else 'no' end from documentos_tecnicos;
reset role;

select n, prueba, esperado, obtenido, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado from r order by n;
rollback;
