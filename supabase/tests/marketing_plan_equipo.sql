-- Pruebas: Plan de trabajo de Marketing con el equipo del área Marketing y videos por etapas (producción / edición).
-- Correr SOLO en PRUEBAS; se deshace.   npx supabase db query --remote --yes -f supabase/tests/marketing_plan_equipo.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated, anon, service_role;

insert into empleados (email, nombre, empresa, estado, cargo, permisos_extra, preferencias) values
  ('t.mp.coord@vimedic.test', 'T Coordina Gerencia', 'VIMEDIC', 'activo', 'Gerencia', '{"marketing":["ver","crear","editar"]}'::jsonb, '{"marketing":{"rol":"Coordinación"}}'::jsonb),
  ('t.mp.asis@vimedic.test', 'T Asistente Mkt', 'VIMEDIC', 'activo', 'Marketing', '{"marketing":["ver","crear","editar"]}'::jsonb, '{"marketing":{"rol":"Asistente"}}'::jsonb),
  ('t.mp.av@vimedic.test', 'T Productora Mkt', 'VIMEDIC', 'activo', 'Productora Audiovisual', '{"marketing":["ver","crear","editar"]}'::jsonb, '{}'::jsonb),
  ('t.mp.otro@vimedic.test', 'T Comercial con Marketing', 'VIMEDIC', 'activo', 'Comercial', '{"marketing":["ver"]}'::jsonb, '{}'::jsonb);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 't.mp.coord@vimedic.test'), ('00000000-0000-0000-0000-0000000000f2', 't.mp.asis@vimedic.test'),
  ('00000000-0000-0000-0000-0000000000f3', 't.mp.av@vimedic.test'), ('00000000-0000-0000-0000-0000000000f4', 't.mp.otro@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.mp.%';
create temp table p as select email, id, auth_user_id from empleados where email like 't.mp.%';
create temp table prod as select id from productos where deleted_at is null order by en_catalogo desc, codigo limit 1;
grant select on p, prod to authenticated;

select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.mp.coord@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table plan as select public.mkt_plan(current_date, current_date + 6) as j;
insert into r select 1, 'equipo: la asistente del área Marketing está', 'sí', case when exists (select 1 from plan, jsonb_array_elements(j -> 'equipo') x where x ->> 'nombre' = 'T Asistente Mkt') then 'sí' else 'no' end;
insert into r select 2, 'equipo: la productora (cargo audiovisual) está como Audiovisual', 'Audiovisual', (select x ->> 'rol' from plan, jsonb_array_elements(j -> 'equipo') x where x ->> 'nombre' = 'T Productora Mkt');
insert into r select 3, 'equipo: quien coordina sin ser del área NO está', 'no', case when exists (select 1 from plan, jsonb_array_elements(j -> 'equipo') x where x ->> 'nombre' = 'T Coordina Gerencia') then 'sí' else 'no' end;
insert into r select 4, 'equipo: alguien de otra área con permiso de Marketing NO está', 'no', case when exists (select 1 from plan, jsonb_array_elements(j -> 'equipo') x where x ->> 'nombre' = 'T Comercial con Marketing') then 'sí' else 'no' end;
insert into r select 5, 'equipo: Victor Lopez, Jonathan Valdiviezo y Andres Espinosa NO están', '0',
  (select count(*)::text from plan, jsonb_array_elements(j -> 'equipo') x where x ->> 'nombre' in ('Victor Lopez', 'Jonathan Valdiviezo', 'Andres Espinosa'));

-- Video por etapas para la productora
create temp table asg as select public.mkt_plan_asignar(jsonb_build_object('responsable', (select id from p where email = 't.mp.av@vimedic.test'), 'trabajo', 'produccion', 'detalle', 'Comercial',
  'items', jsonb_build_array(jsonb_build_object('producto_id', (select id from prod), 'fecha', current_date)))) as j;
insert into asg select public.mkt_plan_asignar(jsonb_build_object('responsable', (select id from p where email = 't.mp.av@vimedic.test'), 'trabajo', 'edicion', 'detalle', 'Comercial',
  'items', jsonb_build_array(jsonb_build_object('producto_id', (select id from prod), 'fecha', current_date + 1))));
insert into r select 6, 'producción y edición del mismo video: 2 tareas creadas', '2', (select sum((j ->> 'creadas')::int)::text from asg);
reset role;
insert into r select 7, 'pasos de la producción empiezan con el guion', 'Guion y lista de tomas',
  (select a.mkt_pasos -> 0 ->> 't' from actividades a where a.mkt_trabajo = 'produccion' and a.producto_id = (select id from prod) and a.deleted_at is null order by a.created_at desc limit 1);
insert into r select 8, 'la edición queda para el día siguiente', (current_date + 1)::text,
  (select a.fecha_programada::text from actividades a where a.mkt_trabajo = 'edicion' and a.producto_id = (select id from prod) and a.deleted_at is null order by a.created_at desc limit 1);
set local role authenticated;
insert into r select 9, 'lo que le falta al producto muestra las tareas abiertas', 'sí',
  case when public.mkt_plan_estado_producto((select id from prod)) -> 'abiertas' ? 'produccion' then 'sí' else 'no' end;
do $$ begin
  perform public.mkt_plan_asignar(jsonb_build_object('responsable', (select id from p where email = 't.mp.otro@vimedic.test'), 'trabajo', 'completar',
    'items', jsonb_build_array(jsonb_build_object('producto_id', (select id from prod)))));
  insert into r values (10, 'no se asigna a alguien fuera del área Marketing', 'error', 'se asignó');
exception when others then insert into r values (10, 'no se asigna a alguien fuera del área Marketing', 'error', case when sqlerrm like '%equipo de Marketing%' then 'error' else left(sqlerrm, 80) end); end $$;
reset role;

-- La asistente solo ve lo suyo y se ve a sí misma en el equipo
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.mp.asis@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 11, 'la asistente ve solo su fila en el equipo', '1', jsonb_array_length(public.mkt_plan(current_date, current_date + 6) -> 'equipo')::text;
reset role;

select n, prueba, esperado, obtenido, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado from r order by n;
rollback;
