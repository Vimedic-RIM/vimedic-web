-- Pruebas del Plan de trabajo de Marketing. Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/marketing_plan.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated, anon, service_role;

insert into empleados (email, nombre, empresa, es_superadmin) values ('t.mkp.coord@vimedic.test', 'T Coordina', 'VIMEDIC', true);
insert into empleados (email, nombre, empresa, permisos_extra, preferencias) values
  ('t.mkp.asis@vimedic.test', 'T Asistente Mkt', 'VIMEDIC', '{"marketing":["ver","crear","editar"],"agenda":["ver","crear","editar"]}', '{"marketing":{"rol":"Asistente"}}'),
  ('t.mkp.otro@vimedic.test', 'T Otro Mkt', 'VIMEDIC', '{"marketing":["ver","crear","editar"]}', '{"marketing":{"rol":"Audiovisual"}}');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 't.mkp.coord@vimedic.test'), ('00000000-0000-0000-0000-0000000000f2', 't.mkp.asis@vimedic.test'), ('00000000-0000-0000-0000-0000000000f3', 't.mkp.otro@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.mkp.%';
create temp table p as select email, id, auth_user_id from empleados where email like 't.mkp.%';
grant select on p to authenticated, service_role;
insert into productos (id, codigo, nombre, en_catalogo) values
  ('00000000-0000-0000-0000-00000000a001', 'TZZ-MKP-1', 'Zz Prueba Incompleto', true),
  ('00000000-0000-0000-0000-00000000a002', 'TZZ-MKP-2', 'Zz Prueba Completo', false);
update productos set imagen_url = 'x.jpg', descripcion = 'd', caracteristicas = 'c', especificaciones = 'e' where codigo = 'TZZ-MKP-2';
insert into producto_galeria (producto_id, tipo, archivo_url) select '00000000-0000-0000-0000-00000000a002', 'imagen', 'f' || g from generate_series(1, 3) g;
create temp table t (k text, id uuid);
grant all on t to authenticated, service_role;

-- ===== Quien coordina asigna
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.mkp.coord@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 1, 'asigna «completar» al incompleto y omite el que ya está completo', '1 · La ficha ya está completa',
  (select (x ->> 'creadas') || ' · ' || (x -> 'omitidos' -> 0 ->> 'motivo') from (select public.mkt_plan_asignar(jsonb_build_object('responsable', (select id from p where email = 't.mkp.asis@vimedic.test'), 'trabajo', 'completar', 'prioridad', 'Importante',
     'items', jsonb_build_array(jsonb_build_object('producto_id', '00000000-0000-0000-0000-00000000a001', 'fecha', current_date), jsonb_build_object('producto_id', '00000000-0000-0000-0000-00000000a002', 'fecha', current_date)))) x) q);
insert into r select 2, 'no duplica una tarea abierta del mismo tipo', '0 · Ya tiene una tarea abierta de ese tipo',
  (select (x ->> 'creadas') || ' · ' || (x -> 'omitidos' -> 0 ->> 'motivo') from (select public.mkt_plan_asignar(jsonb_build_object('responsable', (select id from p where email = 't.mkp.asis@vimedic.test'), 'trabajo', 'completar',
     'items', jsonb_build_array(jsonb_build_object('producto_id', '00000000-0000-0000-0000-00000000a001')))) x) q);
insert into r select 3, 'asigna un video al otro', '1', (public.mkt_plan_asignar(jsonb_build_object('responsable', (select id from p where email = 't.mkp.otro@vimedic.test'), 'trabajo', 'video',
     'items', jsonb_build_array(jsonb_build_object('producto_id', '00000000-0000-0000-0000-00000000a002', 'fecha', current_date + 1)))) ->> 'creadas');
insert into t select 'completar', id from actividades where producto_id = '00000000-0000-0000-0000-00000000a001' and mkt_trabajo = 'completar';
insert into t select 'video', id from actividades where producto_id = '00000000-0000-0000-0000-00000000a002' and mkt_trabajo = 'video';
insert into r select 4, 'la tarea es una actividad de la Agenda delegada, con sus 4 pasos', 'Marketing · Por hacer · true · 4',
  (select tipo || ' · ' || estado || ' · ' || delegada::text || ' · ' || jsonb_array_length(mkt_pasos) from actividades where id = (select id from t where k = 'completar'));
insert into r select 6, 'quien coordina ve las tareas de todo el equipo', '2', (select count(*)::text from jsonb_array_elements(public.mkt_plan(current_date - 7, current_date + 7) -> 'tareas') x where x -> 'producto' ->> 'codigo' like 'TZZ-MKP-%');
insert into r select 7, 'sugerir no repite el producto que ya tiene la tarea abierta', 'false',
  (select (public.mkt_plan_sugerir('completar', 50) @> jsonb_build_array(jsonb_build_object('codigo', 'TZZ-MKP-1')))::text);
reset role;
insert into r select 5, 'avisa a la persona asignada', '1', (select count(*)::text from notificaciones where para_id = (select id from p where email = 't.mkp.asis@vimedic.test') and evento = 'plan_asignada');

-- ===== La asistente: ve lo suyo, marca pasos, no asigna ni mueve
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.mkp.asis@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 8, 'la asistente solo ve sus tareas', '1', (select count(*)::text from jsonb_array_elements(public.mkt_plan(current_date - 7, current_date + 7) -> 'tareas') x where x -> 'producto' ->> 'codigo' like 'TZZ-MKP-%');
do $$ begin
  perform public.mkt_plan_paso((select id from t where k = 'completar'), 0, true);
  insert into r values (9, 'marca un paso de su tarea', 'true', (select (mkt_pasos -> 0 ->> 'hecho') from actividades where id = (select id from t where k = 'completar')));
exception when others then insert into r values (9, 'marca un paso de su tarea', 'true', left(sqlerrm, 80)); end $$;
do $$ begin
  perform public.mkt_plan_paso((select id from t where k = 'video'), 0, true);
  insert into r values (10, 'NO marca pasos de la tarea de otra persona', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (10, 'NO marca pasos de la tarea de otra persona', 'bloqueado', 'bloqueado'); end $$;
do $$ begin
  perform public.mkt_plan_asignar(jsonb_build_object('responsable', (select id from p where email = 't.mkp.asis@vimedic.test'), 'trabajo', 'fotos', 'items', jsonb_build_array(jsonb_build_object('producto_id', '00000000-0000-0000-0000-00000000a002'))));
  insert into r values (11, 'la asistente NO puede asignar', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (11, 'la asistente NO puede asignar', 'bloqueado', 'bloqueado'); end $$;
do $$ begin
  perform public.mkt_plan_mover((select id from t where k = 'completar'), current_date + 3, null);
  insert into r values (12, 'la asistente NO puede reprogramar', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (12, 'la asistente NO puede reprogramar', 'bloqueado', 'bloqueado'); end $$;
reset role;

-- ===== Cierre automático: el producto se completa y llega el video
select set_config('request.jwt.claims', '', true);
update productos set imagen_url = 'x.jpg', descripcion = 'd', caracteristicas = 'c', especificaciones = 'e' where id = '00000000-0000-0000-0000-00000000a001';
insert into producto_galeria (producto_id, tipo, archivo_url) select '00000000-0000-0000-0000-00000000a001', 'imagen', 'g' || g from generate_series(1, 3) g;
insert into producto_galeria (producto_id, tipo, tipo_video, archivo_url) values ('00000000-0000-0000-0000-00000000a002', 'video', 'Comercial', 'v1');
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.mkp.coord@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 13, 'al abrir el plan se cierran solas las dos tareas cumplidas', '2', (public.mkt_plan(current_date - 7, current_date + 7) ->> 'cerradasAhora');
reset role;
insert into r select 14, 'la tarea cumplida queda Lista, con todos los pasos y la moneda para la asistente', 'Listo · true · 1',
  (select estado || ' · ' || (select bool_and((x ->> 'hecho')::boolean) from jsonb_array_elements(mkt_pasos) x)::text || ' · ' || moneda_otorgada from actividades where id = (select id from t where k = 'completar'));
insert into r select 15, 'la moneda va a la asistente', '1', (select count(*)::text from monedas_movimientos where actividad_id = (select id from t where k = 'completar') and empleado_id = (select id from p where email = 't.mkp.asis@vimedic.test'));

-- ===== Terminar a mano y cancelar
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.mkp.coord@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 16, 'asigna una publicación y una tarea libre', '1 · 1',
  (public.mkt_plan_asignar(jsonb_build_object('responsable', (select id from p where email = 't.mkp.otro@vimedic.test'), 'trabajo', 'publicacion', 'items', jsonb_build_array(jsonb_build_object('producto_id', '00000000-0000-0000-0000-00000000a001')))) ->> 'creadas')
  || ' · ' || (public.mkt_plan_asignar(jsonb_build_object('responsable', (select id from p where email = 't.mkp.otro@vimedic.test'), 'trabajo', 'otro', 'instrucciones', 'Ordenar la bodega de material', 'items', jsonb_build_array(jsonb_build_object('fecha', current_date)))) ->> 'creadas');
insert into t select 'publicacion', id from actividades where producto_id = '00000000-0000-0000-0000-00000000a001' and mkt_trabajo = 'publicacion';
insert into t select 'otro', id from actividades where mkt_trabajo = 'otro' and descripcion like '%Ordenar la bodega de material%' and created_at >= now() - interval '1 minute';
do $$ begin
  perform public.mkt_plan_mover((select id from t where k = 'publicacion'), current_date + 2, (select id from p where email = 't.mkp.asis@vimedic.test'));
  insert into r values (17, 'quien coordina reprograma y cambia de persona', 'true', ((select fecha_programada = current_date + 2 and delegado_a_id = (select id from p where email = 't.mkp.asis@vimedic.test') from actividades where id = (select id from t where k = 'publicacion')))::text);
exception when others then insert into r values (17, 'quien coordina reprograma y cambia de persona', 'true', left(sqlerrm, 80)); end $$;
do $$ begin
  perform public.mkt_plan_cancelar((select id from t where k = 'otro'), 'Ya no hace falta');
  insert into r values (18, 'cancela una tarea', 'Cancelado', (select estado from actividades where id = (select id from t where k = 'otro')));
exception when others then insert into r values (18, 'cancela una tarea', 'Cancelado', left(sqlerrm, 80)); end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.mkp.asis@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mkt_plan_terminar((select id from t where k = 'publicacion'), 'Publicado en Instagram');
  insert into r values (19, 'la asistente termina su tarea a mano', 'Listo', (select estado from actividades where id = (select id from t where k = 'publicacion')));
exception when others then insert into r values (19, 'la asistente termina su tarea a mano', 'Listo', left(sqlerrm, 80)); end $$;
insert into r select 20, 'la tarea también aparece en su Agenda', 'true', (exists (select 1 from actividades where id = (select id from t where k = 'publicacion')))::text;
reset role;

select n, prueba, esperado, obtenido, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado from r order by n;
rollback;
