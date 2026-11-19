-- Pruebas: Agenda de Marketing (semana por horas de quien coordina y su equipo).
-- Usuarios de prueba: A (Asistente), B (Audiovisual), C (coordina Marketing), G (Gerencia, también coordina) y X (otra área).
-- Correr SOLO en PRUEBAS; se deshace.   npx supabase db query --remote --yes -f supabase/tests/marketing_agenda.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;
create temp table x (k text primary key, v text) on commit drop;
grant all on x to authenticated;

insert into empleados (email, nombre, empresa, estado, cargo, permisos_extra, preferencias) values
  ('t.mka.a@vimedic.test', 'T Asistente Ag', 'VIMEDIC', 'activo', 'Marketing', '{"marketing":["ver","crear","editar"]}'::jsonb, '{"marketing":{"rol":"Asistente"}}'::jsonb),
  ('t.mka.b@vimedic.test', 'T Audiovisual Ag', 'VIMEDIC', 'activo', 'Marketing', '{"marketing":["ver","crear","editar"]}'::jsonb, '{"marketing":{"rol":"Audiovisual"}}'::jsonb),
  ('t.mka.c@vimedic.test', 'T Coordina Ag', 'VIMEDIC', 'activo', 'Jefatura comercial', '{"marketing":["ver"]}'::jsonb, '{"marketing":{"rol":"Coordinación"}}'::jsonb),
  ('t.mka.g@vimedic.test', 'T Gerencia Ag', 'VIMEDIC', 'activo', 'Gerencia', '{"marketing":["ver"]}'::jsonb, '{"marketing":{"rol":"Coordinación"}}'::jsonb),
  ('t.mka.x@vimedic.test', 'T Ventas Ag', 'VIMEDIC', 'activo', 'Ventas', '{"marketing":["ver"]}'::jsonb, '{}'::jsonb);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000b0b1', 't.mka.a@vimedic.test'), ('00000000-0000-0000-0000-00000000b0b2', 't.mka.b@vimedic.test'),
  ('00000000-0000-0000-0000-00000000b0b3', 't.mka.c@vimedic.test'), ('00000000-0000-0000-0000-00000000b0b4', 't.mka.g@vimedic.test'),
  ('00000000-0000-0000-0000-00000000b0b5', 't.mka.x@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.mka.%';
insert into x select k, id::text from (values ('A', 't.mka.a@vimedic.test'), ('B', 't.mka.b@vimedic.test'), ('C', 't.mka.c@vimedic.test'), ('G', 't.mka.g@vimedic.test'), ('X', 't.mka.x@vimedic.test')) v(k, m)
  join empleados e on e.email = v.m;
-- Reunión privada de Gerencia (no es de Marketing) a las 09:00, una tarea suya de todo el día y una actividad propia de A a las 16:00
insert into actividades (id, codigo, descripcion, tipo, fecha_programada, hora, duracion_min, realiza_id, estado, creado_por) values
  ('00000000-0000-0000-0000-00000000b0e1', 'T-AG-1', 'T-MKA Reunión con el banco', 'Reunión', current_date, '09:00', 60, (select v::uuid from x where k = 'G'), 'Por hacer', (select v::uuid from x where k = 'G')),
  ('00000000-0000-0000-0000-00000000b0e2', 'T-AG-2', 'T-MKA Revisar contratos', 'Documentación', current_date, null, null, (select v::uuid from x where k = 'G'), 'Por hacer', (select v::uuid from x where k = 'G')),
  ('00000000-0000-0000-0000-00000000b0e3', 'T-AG-3', 'T-MKA Llamar a proveedor', 'Llamada', current_date, '16:00', 30, (select v::uuid from x where k = 'A'), 'Por hacer', (select v::uuid from x where k = 'A'));

-- 1) La asistente abre la agenda: ve a su equipo y a quienes coordinan, no a otras áreas
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000b0b1', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'agA', public.mkt_agenda(current_date - 1, current_date + 6)::text;
insert into r select 1, 'asistente: gente de la agenda (A, B, C, G sí; X no)', 'true true true true false',
  (select string_agg((exists (select 1 from jsonb_array_elements((select v::jsonb from x where k = 'agA') -> 'personas') p where p ->> 'id' = (select v from x where k = q)))::text, ' ' order by o)
     from unnest(array['A', 'B', 'C', 'G', 'X']) with ordinality u(q, o));
insert into r select 2, 'lo privado de Gerencia sale como «Ocupado» sin asunto; su tarea sin hora no sale', '1 · true · null · 0',
  (select count(*) filter (where e ->> 'id' = '00000000-0000-0000-0000-00000000b0e1') || ' · ' ||
          coalesce(max(e ->> 'privado') filter (where e ->> 'id' = '00000000-0000-0000-0000-00000000b0e1'), '-') || ' · ' ||
          coalesce(max(e ->> 'titulo') filter (where e ->> 'id' = '00000000-0000-0000-0000-00000000b0e1'), 'null') || ' · ' ||
          count(*) filter (where e ->> 'id' = '00000000-0000-0000-0000-00000000b0e2')
     from jsonb_array_elements((select v::jsonb from x where k = 'agA') -> 'eventos') e);

-- 2) La asistente agenda una reunión a quien coordina, con la audiovisual invitada
insert into x select 'cita', public.mkt_agenda_guardar(jsonb_build_object('titulo', 'T-MKA Reunión de campaña', 'tipo', 'Reunión', 'fecha', current_date, 'hora', '10:00', 'duracion', 30,
  'responsable', (select v from x where k = 'C'), 'invitados', jsonb_build_array((select v from x where k = 'B')), 'enlace', 'https://meet.google.com/abc-defg-hij'))::text;
do $$ begin
  perform public.mkt_agenda_guardar(jsonb_build_object('titulo', 'T-MKA sin responsable', 'fecha', current_date, 'hora', '11:00'));
  insert into r values (3, 'sin responsable no se guarda', 'error', 'se guardó');
exception when others then insert into r values (3, 'sin responsable no se guarda', 'error', case when sqlerrm like 'Toda cita necesita un responsable%' then 'error' else sqlerrm end); end $$;
do $$ begin
  perform public.mkt_agenda_guardar(jsonb_build_object('titulo', 'T-MKA para ventas', 'fecha', current_date, 'responsable', (select v from x where k = 'X')));
  insert into r values (4, 'responsable fuera de la agenda no se acepta', 'error', 'se guardó');
exception when others then insert into r values (4, 'responsable fuera de la agenda no se acepta', 'error', case when sqlerrm like 'El responsable debe ser%' then 'error' else sqlerrm end); end $$;
reset role;
insert into r select 5, 'la cita queda con responsable, hora, invitado y avisos', 'C · 10:00:00 · 30 · 1 · aviso C 1 · aviso B 1',
  (select case coalesce(a.delegado_a_id, a.realiza_id)::text when (select v from x where k = 'C') then 'C' else '?' end || ' · ' || a.hora || ' · ' || a.duracion_min || ' · ' || cardinality(a.invitados)
          || ' · aviso C ' || (select count(*) from notificaciones n where n.entidad_id = a.id and n.para_id::text = (select v from x where k = 'C') and n.evento = 'agenda_cita')
          || ' · aviso B ' || (select count(*) from notificaciones n where n.entidad_id = a.id and n.para_id::text = (select v from x where k = 'B') and n.evento = 'agenda_invitacion')
     from actividades a where a.id = (select v::uuid from x where k = 'cita'));

-- 3) Mover: quien la creó sí; otra persona del equipo que no es responsable ni la creó, no
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000b0b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mkt_agenda_mover((select v::uuid from x where k = 'cita'), current_date + 1, '11:30', null);
  insert into r values (6, 'quien la creó la mueve', 'sin error', 'sin error');
exception when others then insert into r values (6, 'quien la creó la mueve', 'sin error', sqlerrm); end $$;
do $$ begin
  perform public.mkt_agenda_mover('00000000-0000-0000-0000-00000000b0e1', current_date, '12:00', null);
  insert into r values (7, 'la asistente no mueve la reunión privada de Gerencia', 'error', 'se movió');
exception when others then insert into r values (7, 'la asistente no mueve la reunión privada de Gerencia', 'error', case when sqlerrm like 'Solo quien la creó%' then 'error' else sqlerrm end); end $$;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000b0b2', 'role', 'authenticated')::text, true);
do $$ begin
  perform public.mkt_agenda_mover((select v::uuid from x where k = 'cita'), current_date + 2, '08:00', null);
  insert into r values (8, 'la invitada no mueve una cita ajena', 'error', 'se movió');
exception when others then insert into r values (8, 'la invitada no mueve una cita ajena', 'error', case when sqlerrm like 'Solo quien la creó%' then 'error' else sqlerrm end); end $$;
insert into x select 'agB', public.mkt_agenda(current_date - 1, current_date + 6)::text;
-- 4) Quien coordina mueve una actividad de la asistente a otra hora y ve completo lo del equipo
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000b0b3', 'role', 'authenticated')::text, true);
do $$ begin
  perform public.mkt_agenda_mover('00000000-0000-0000-0000-00000000b0e3', current_date, '17:00', null);
  insert into r values (9, 'quien coordina mueve una actividad de su equipo', 'sin error', 'sin error');
exception when others then insert into r values (9, 'quien coordina mueve una actividad de su equipo', 'sin error', sqlerrm); end $$;
insert into x select 'agC', public.mkt_agenda(current_date - 1, current_date + 6)::text;
reset role;
insert into r select 10, 'la invitada ve la cita completa (asunto y enlace)', 'T-MKA Reunión de campaña · https://meet.google.com/abc-defg-hij',
  (select (e ->> 'titulo') || ' · ' || (e ->> 'enlaceMeet') from jsonb_array_elements((select v::jsonb from x where k = 'agB') -> 'eventos') e where e ->> 'id' = (select v from x where k = 'cita'));
insert into r select 11, 'quien coordina: actividad de la asistente completa y movida; lo privado de Gerencia sigue «Ocupado»', 'T-MKA Llamar a proveedor 17:00 · true',
  (select max((e ->> 'titulo') || ' ' || (e ->> 'hora')) filter (where e ->> 'id' = '00000000-0000-0000-0000-00000000b0e3') || ' · ' ||
          max(e ->> 'privado') filter (where e ->> 'id' = '00000000-0000-0000-0000-00000000b0e1')
     from jsonb_array_elements((select v::jsonb from x where k = 'agC') -> 'eventos') e);

-- 5) Tarea del Plan: su responsable le pone hora, pero no la cambia de día
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000b0b3', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.mkt_plan_asignar(jsonb_build_object('responsable', (select v from x where k = 'A'), 'trabajo', 'otro', 'instrucciones', 'T-MKA tarea del plan', 'items', jsonb_build_array(jsonb_build_object('fecha', current_date))));
reset role;
insert into x select 'tp', id::text from actividades where detalle = 'T-MKA tarea del plan';
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000b0b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mkt_agenda_mover((select v::uuid from x where k = 'tp'), current_date, '15:00', null);
  insert into r values (12, 'su responsable le pone hora a la tarea del Plan', 'sin error', 'sin error');
exception when others then insert into r values (12, 'su responsable le pone hora a la tarea del Plan', 'sin error', sqlerrm); end $$;
do $$ begin
  perform public.mkt_agenda_mover((select v::uuid from x where k = 'tp'), current_date + 3, '15:00', null);
  insert into r values (13, 'pero no la cambia de día (reglas del Plan)', 'error', 'se movió');
exception when others then insert into r values (13, 'pero no la cambia de día (reglas del Plan)', 'error', case when sqlerrm like 'Esta tarea del Plan solo%' then 'error' else sqlerrm end); end $$;
do $$ begin
  perform public.mkt_agenda_cancelar((select v::uuid from x where k = 'tp'), null);
  insert into r values (14, 'las tareas del Plan no se cancelan desde la agenda', 'error', 'se canceló');
exception when others then insert into r values (14, 'las tareas del Plan no se cancelan desde la agenda', 'error', case when sqlerrm like 'Las tareas del Plan%' then 'error' else sqlerrm end); end $$;
-- 6) Cancelar la cita: queda «Cancelado» (no se borra) y sale de la agenda
do $$ begin
  perform public.mkt_agenda_cancelar((select v::uuid from x where k = 'cita'), 'Se pasó a la próxima semana');
exception when others then insert into r values (15, 'cancelar', 'sin error', sqlerrm); end $$;
insert into x select 'agA2', public.mkt_agenda(current_date - 1, current_date + 6)::text;
reset role;
insert into r select 15, 'cita cancelada: sigue en la tabla, fuera de la agenda', 'Cancelado · sin borrar · 0',
  (select a.estado || ' · ' || case when a.deleted_at is null then 'sin borrar' else 'borrada' end || ' · ' ||
          (select count(*) from jsonb_array_elements((select v::jsonb from x where k = 'agA2') -> 'eventos') e where e ->> 'id' = a.id::text)
     from actividades a where a.id = (select v::uuid from x where k = 'cita'));
insert into r select 16, 'la tarea del Plan aparece con su hora y marcada como del Plan', '15:00 · true',
  (select (e ->> 'hora') || ' · ' || (e ->> 'plan') from jsonb_array_elements((select v::jsonb from x where k = 'agA2') -> 'eventos') e where e ->> 'id' = (select v from x where k = 'tp'));

-- 7) Otra área: solo se ve a sí misma y no agenda
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000b0b5', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'agX', public.mkt_agenda(current_date - 1, current_date + 6)::text;
do $$ begin
  perform public.mkt_agenda_guardar(jsonb_build_object('titulo', 'T-MKA de fuera', 'fecha', current_date, 'responsable', (select v from x where k = 'X')));
  insert into r values (17, 'otra área no agenda', 'error', 'se guardó');
exception when others then insert into r values (17, 'otra área no agenda', 'error', case when sqlerrm like 'La agenda de Marketing es%' then 'error' else sqlerrm end); end $$;
reset role;
insert into r select 18, 'otra área: solo se ve a sí misma y no agrega', '1 · false',
  (select jsonb_array_length(v::jsonb -> 'personas') || ' · ' || (v::jsonb ->> 'agrega') from x where k = 'agX');

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
