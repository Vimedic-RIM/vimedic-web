-- Pruebas: Plan de trabajo de Marketing — los colaboradores agregan tareas, siempre con responsable.
-- Usuarios de prueba: A (Asistente), B (Audiovisual), C (coordina, no es del equipo) y X (otra área, ve Marketing).
-- Correr SOLO en PRUEBAS; se deshace.   npx supabase db query --remote --yes -f supabase/tests/marketing_plan_colaboradores.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;
create temp table x (k text primary key, v text) on commit drop;
grant all on x to authenticated;

insert into empleados (email, nombre, empresa, estado, cargo, permisos_extra, preferencias) values
  ('t.mkp.a@vimedic.test', 'T Asistente Mk', 'VIMEDIC', 'activo', 'Marketing', '{"marketing":["ver","crear","editar"]}'::jsonb, '{"marketing":{"rol":"Asistente"}}'::jsonb),
  ('t.mkp.b@vimedic.test', 'T Audiovisual Mk', 'VIMEDIC', 'activo', 'Marketing', '{"marketing":["ver","crear","editar"]}'::jsonb, '{"marketing":{"rol":"Audiovisual"}}'::jsonb),
  ('t.mkp.c@vimedic.test', 'T Coordina Mk', 'VIMEDIC', 'activo', 'Gerencia', '{"marketing":["ver"]}'::jsonb, '{"marketing":{"rol":"Coordinación"}}'::jsonb),
  ('t.mkp.x@vimedic.test', 'T Ventas', 'VIMEDIC', 'activo', 'Ventas', '{"marketing":["ver"]}'::jsonb, '{}'::jsonb);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a0a1', 't.mkp.a@vimedic.test'), ('00000000-0000-0000-0000-00000000a0a2', 't.mkp.b@vimedic.test'),
  ('00000000-0000-0000-0000-00000000a0a3', 't.mkp.c@vimedic.test'), ('00000000-0000-0000-0000-00000000a0a4', 't.mkp.x@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.mkp.%';
insert into x select 'A', id::text from empleados where email = 't.mkp.a@vimedic.test';
insert into x select 'B', id::text from empleados where email = 't.mkp.b@vimedic.test';
insert into x select 'C', id::text from empleados where email = 't.mkp.c@vimedic.test';

-- 1) A abre el plan: puede agregar, no coordina y ve a todo el equipo para elegir responsable
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000a0a1', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'planA', public.mkt_plan(current_date, current_date + 6)::text;
insert into r select 1, 'colaborador: puede agregar y no coordina', 'true · false',
  (select (v::jsonb ->> 'agrega') || ' · ' || (v::jsonb ->> 'coordina') from x where k = 'planA');
insert into r select 2, 'colaborador: ve a su compañero para elegirlo de responsable', '1',
  (select count(*)::text from jsonb_array_elements((select v::jsonb from x where k = 'planA') -> 'equipo') e where e ->> 'id' = (select v from x where k = 'B'));

-- 2) A agrega una tarea para sí misma y otra para B
insert into x select 'r1', public.mkt_plan_asignar(jsonb_build_object('responsable', (select v from x where k = 'A'), 'trabajo', 'otro', 'instrucciones', 'T-MKP propia', 'items', jsonb_build_array(jsonb_build_object('fecha', current_date))))::text;
insert into x select 'r2', public.mkt_plan_asignar(jsonb_build_object('responsable', (select v from x where k = 'B'), 'trabajo', 'otro', 'instrucciones', 'T-MKP para B', 'items', jsonb_build_array(jsonb_build_object('fecha', current_date))))::text;
insert into r select 3, 'colaborador agrega tareas (para sí y para un compañero)', '1 · 1',
  (select (select v::jsonb ->> 'creadas' from x where k = 'r1') || ' · ' || (select v::jsonb ->> 'creadas' from x where k = 'r2'));
-- sin responsable: no se puede
do $$ begin
  perform public.mkt_plan_asignar(jsonb_build_object('responsable', '', 'trabajo', 'otro', 'instrucciones', 'T-MKP sin responsable', 'items', jsonb_build_array(jsonb_build_object('fecha', current_date))));
  insert into r values (4, 'sin responsable no se guarda', 'error', 'se guardó');
exception when others then insert into r values (4, 'sin responsable no se guarda', 'error', case when sqlerrm like 'Toda tarea necesita un responsable%' then 'error' else sqlerrm end); end $$;
reset role;
insert into r select 5, 'cada tarea quedó con su responsable y quien la agregó (para B · propia)', 'B/A · A/A',
  (select string_agg(case coalesce(a.delegado_a_id, a.realiza_id)::text when (select v from x where k = 'A') then 'A' when (select v from x where k = 'B') then 'B' else '?' end
                     || '/' || case a.creado_por::text when (select v from x where k = 'A') then 'A' else '?' end, ' · ' order by a.detalle)
     from actividades a where a.detalle in ('T-MKP propia', 'T-MKP para B') and a.deleted_at is null);
insert into r select 6, 'avisos: a quien coordina (2) y a B por su tarea (1)', '2 · 1',
  (select count(*) filter (where para_id::text = (select v from x where k = 'C') and evento = 'plan_agregada') || ' · '
       || count(*) filter (where para_id::text = (select v from x where k = 'B') and evento = 'plan_asignada')
     from notificaciones where entidad = 'actividades' and entidad_id in (select id from actividades where detalle like 'T-MKP%'));

-- 3) Quien coordina asigna una tarea a A (no genera aviso de «agregó»)
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000a0a3', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'r3', public.mkt_plan_asignar(jsonb_build_object('responsable', (select v from x where k = 'A'), 'trabajo', 'otro', 'instrucciones', 'T-MKP de coordinación', 'items', jsonb_build_array(jsonb_build_object('fecha', current_date))))::text;
reset role;
insert into r select 7, 'coordinación asigna a A sin aviso de «agregó»', '1 · 2',
  (select (select v::jsonb ->> 'creadas' from x where k = 'r3') || ' · ' ||
          (select count(*) from notificaciones where evento = 'plan_agregada' and para_id::text = (select v from x where k = 'C') and entidad_id in (select id from actividades where detalle like 'T-MKP%')));
insert into x select 'tP', id::text from actividades where detalle = 'T-MKP propia';
insert into x select 'tB', id::text from actividades where detalle = 'T-MKP para B';
insert into x select 'tC', id::text from actividades where detalle = 'T-MKP de coordinación';

-- 4) Lo que ve cada uno
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000a0a1', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'planA2', public.mkt_plan(current_date, current_date + 6)::text;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000a0a2', 'role', 'authenticated')::text, true);
insert into x select 'planB', public.mkt_plan(current_date, current_date + 6)::text;
reset role;
insert into r select 8, 'A ve sus 2 tareas y la que agregó para B (con quién la agregó)', '3 · T Asistente Mk',
  (select count(*) || ' · ' || max(t ->> 'creador') filter (where t ->> 'instrucciones' = 'T-MKP para B')
     from jsonb_array_elements((select v::jsonb from x where k = 'planA2') -> 'tareas') t where t ->> 'instrucciones' like 'T-MKP%');
insert into r select 9, 'B ve solo la suya', 'T-MKP para B',
  (select string_agg(t ->> 'instrucciones', ', ') from jsonb_array_elements((select v::jsonb from x where k = 'planB') -> 'tareas') t where t ->> 'instrucciones' like 'T-MKP%');

-- 5) A reprograma / pasa la que agregó; no puede mover ni cancelar la de coordinación
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000a0a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mkt_plan_mover((select v::uuid from x where k = 'tB'), current_date + 1, (select v::uuid from x where k = 'A'));
  insert into r values (10, 'A mueve la tarea que agregó', 'sin error', 'sin error');
exception when others then insert into r values (10, 'A mueve la tarea que agregó', 'sin error', sqlerrm); end $$;
do $$ begin
  perform public.mkt_plan_mover((select v::uuid from x where k = 'tC'), current_date + 2, null);
  insert into r values (11, 'A no mueve la de coordinación', 'error', 'se movió');
exception when others then insert into r values (11, 'A no mueve la de coordinación', 'error', case when sqlerrm like 'Solo quien coordina%' then 'error' else sqlerrm end); end $$;
do $$ begin
  perform public.mkt_plan_cancelar((select v::uuid from x where k = 'tC'), 'prueba');
  insert into r values (12, 'A no cancela la de coordinación', 'error', 'se canceló');
exception when others then insert into r values (12, 'A no cancela la de coordinación', 'error', case when sqlerrm like 'Solo quien coordina%' then 'error' else sqlerrm end); end $$;
do $$ begin
  perform public.mkt_plan_cancelar((select v::uuid from x where k = 'tP'), 'ya no hace falta');
  perform public.mkt_plan_terminar((select v::uuid from x where k = 'tC'), 'hecho');
  insert into r values (13, 'A cancela la que agregó y termina la que le asignaron', 'sin error', 'sin error');
exception when others then insert into r values (13, 'A cancela la que agregó y termina la que le asignaron', 'sin error', sqlerrm); end $$;
reset role;
insert into r select 14, 'estado final: propia cancelada · la de B pasó a A mañana · la de coordinación lista', 'Cancelado · A ' || (current_date + 1) || ' · Listo',
  (select (select estado from actividades where id = (select v::uuid from x where k = 'tP')) || ' · ' ||
          (select case coalesce(delegado_a_id, realiza_id)::text when (select v from x where k = 'A') then 'A ' else '? ' end || fecha_programada from actividades where id = (select v::uuid from x where k = 'tB')) || ' · ' ||
          (select estado from actividades where id = (select v::uuid from x where k = 'tC')));

-- 6) Alguien de otra área (ve Marketing, no es del equipo) no puede agregar
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000a0a4', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mkt_plan_asignar(jsonb_build_object('responsable', (select v from x where k = 'A'), 'trabajo', 'otro', 'instrucciones', 'T-MKP de fuera', 'items', jsonb_build_array(jsonb_build_object('fecha', current_date))));
  insert into r values (15, 'otra área no agrega tareas', 'error', 'se guardó');
exception when others then insert into r values (15, 'otra área no agrega tareas', 'error', case when sqlerrm like 'Solo el equipo de Marketing%' then 'error' else sqlerrm end); end $$;
insert into x select 'planX', public.mkt_plan(current_date, current_date + 6)::text;
reset role;
insert into r select 16, 'otra área: el plan no le deja agregar', 'false', (select v::jsonb ->> 'agrega' from x where k = 'planX');

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
