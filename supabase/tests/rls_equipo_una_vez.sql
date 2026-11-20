-- Pruebas: el equipo del asesor se calcula una vez (migración 20261120170000). Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/rls_equipo_una_vez.sql
-- Para cada usuario: app.mi_equipo() da exactamente el mismo conjunto que app.es_yo_o_subordinado() (regla original),
-- y ninguna política vuelve a calcular el equipo por fila.
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;
create temp table dif (usuario uuid, empleado uuid) on commit drop;
grant all on dif to authenticated;
create temp table eq (k int primary key, ids uuid[]) on commit drop;
grant all on eq to authenticated;

-- Organigrama de prueba: jefe → asesora → asistente (3 niveles) y otra asesora sin relación
insert into empleados (id, email, nombre, empresa, estado, cargo, jefe_id) values
  ('00000000-0000-0000-0000-0000000e0001', 't.eq.jefe@vimedic.test', 'T Jefe', 'VIMEDIC', 'activo', 'Jefe', null);
insert into empleados (id, email, nombre, empresa, estado, cargo, jefe_id) values
  ('00000000-0000-0000-0000-0000000e0002', 't.eq.ase@vimedic.test', 'T Asesora', 'VIMEDIC', 'activo', 'Asesor', '00000000-0000-0000-0000-0000000e0001');
insert into empleados (id, email, nombre, empresa, estado, cargo, jefe_id) values
  ('00000000-0000-0000-0000-0000000e0003', 't.eq.asi@vimedic.test', 'T Asistente', 'VIMEDIC', 'activo', 'Asistente', '00000000-0000-0000-0000-0000000e0002'),
  ('00000000-0000-0000-0000-0000000e0004', 't.eq.otra@vimedic.test', 'T Otra', 'VIMEDIC', 'activo', 'Asesor', null);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f0001', 't.eq.jefe@vimedic.test'), ('00000000-0000-0000-0000-0000000f0002', 't.eq.ase@vimedic.test'),
  ('00000000-0000-0000-0000-0000000f0003', 't.eq.asi@vimedic.test'), ('00000000-0000-0000-0000-0000000f0004', 't.eq.otra@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.email like 't.eq.%';

-- 1) Para cada usuario (reales y de prueba) y cada empleado: misma respuesta que la regla original
do $$
declare u record;
begin
  for u in select auth_user_id from public.empleados where deleted_at is null and auth_user_id is not null loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.auth_user_id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into dif select u.auth_user_id, e.id from public.empleados e
     where app.es_yo_o_subordinado(e.id) is distinct from coalesce(e.id = any((select app.mi_equipo())::uuid[]), false);
    execute 'reset role';
  end loop;
end $$;
insert into r select 1, 'mi_equipo = es_yo_o_subordinado para todos los usuarios', '0', (select count(*)::text from dif);

-- 2-4) Organigrama: el jefe ve 3 niveles, la asesora a su asistente, la otra solo a sí misma
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000f0001', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into eq select 2, app.mi_equipo();
reset role;
insert into r select 2, 'jefe: él, la asesora y la asistente', 'T Asesora,T Asistente,T Jefe', (select string_agg(nombre, ',' order by nombre) from empleados where id = any((select ids from eq where k = 2)::uuid[]));
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000f0002', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into eq select 3, app.mi_equipo();
reset role;
insert into r select 3, 'asesora: ella y su asistente', 'T Asesora,T Asistente', (select string_agg(nombre, ',' order by nombre) from empleados where id = any((select ids from eq where k = 3)::uuid[]));
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000f0004', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into eq select 4, app.mi_equipo();
reset role;
insert into r select 4, 'otra asesora: solo ella', 'T Otra', (select string_agg(nombre, ',' order by nombre) from empleados where id = any((select ids from eq where k = 4)::uuid[]));

-- 5) Sin empleado (usuario que no está en Empleados): equipo vacío
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000ffff', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 5, 'sin empleado: equipo vacío', '0', (select cardinality((select app.mi_equipo()))::text);
reset role;

-- 6-7) Políticas
insert into r select 6, 'ninguna política calcula el equipo por fila', '0', (select count(*)::text from pg_policies where schemaname = 'public' and (qual like '%es_yo_o_subordinado%' or with_check like '%es_yo_o_subordinado%'));
insert into r select 7, 'clientes, cotizaciones, leads, rutas y viáticos usan el equipo una vez', 'clientes,cotizaciones,leads,rutas,viaticos',
  (select string_agg(distinct tablename, ',' order by tablename) from pg_policies where schemaname = 'public' and (qual like '%mi_equipo%' or with_check like '%mi_equipo%'));

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
