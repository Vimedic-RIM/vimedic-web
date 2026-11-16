-- Pruebas del rol "Asistente Comercial Gerencia". Correr SOLO en el proyecto de PRUEBAS; todo se deshace al final.
--   npx supabase db query --remote --yes -f supabase/tests/asistente_gerencia.sql
-- Casos: el asistente ve y edita los leads, clientes y cotizaciones de TODA la Alta Dirección y los suyos, pero no los de un asesor;
-- puede crear una cotización a nombre del jefe y leerla de vuelta; no puede borrar; un asesor normal no ve a los jefes; la Alta Dirección
-- sigue viendo todo; no se abre Rutas/Viáticos (es_yo_o_subordinado queda igual); mi_perfil trae "asiste_a"; un jefe dado de baja ya no se asiste.
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;

-- Personas ficticias (2 jefes de Alta Dirección, 1 asistente, 1 asesor)
insert into empleados (email, nombre, rol_id, empresa) values
  ('t.jefe1@vimedic.test',     'T Jefe Uno',   (select id from roles where nombre = 'Alta Dirección'),              'VIMEDIC'),
  ('t.jefe2@vimedic.test',     'T Jefe Dos',   (select id from roles where nombre = 'Alta Dirección'),              'VIMEDIC'),
  ('t.asistente@vimedic.test', 'T Asistente',  (select id from roles where nombre = 'Asistente Comercial Gerencia'), 'VIMEDIC'),
  ('t.asesor@vimedic.test',    'T Asesor',     (select id from roles where nombre = 'Asesor'),                      'VIMEDIC');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 't.jefe1@vimedic.test'),
  ('00000000-0000-0000-0000-0000000000b2', 't.jefe2@vimedic.test'),
  ('00000000-0000-0000-0000-0000000000b3', 't.asistente@vimedic.test'),
  ('00000000-0000-0000-0000-0000000000b4', 't.asesor@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.%@vimedic.test';
create temp table p as select email, id, auth_user_id from empleados where email like 't.%@vimedic.test';
grant select on p to authenticated;
-- Cuántos jefes activos hay en total (los reales de QA + los 2 de prueba): es lo que debe traer asiste_a
select set_config('prueba.n_jefes', (select count(*)::text from empleados e join roles ro on ro.id = e.rol_id
  where ro.rol_crm = 'Alta Dirección' and ro.deleted_at is null and e.estado = 'activo' and e.deleted_at is null), true);

-- Datos: uno por persona (+ un lead borrado del jefe 1)
insert into leads (codigo, nombre, asesor_id)
  select 'T-L-' || t.k, 'Lead ' || t.k, p.id from (values ('J1','t.jefe1@vimedic.test'),('J2','t.jefe2@vimedic.test'),('AST','t.asistente@vimedic.test'),('ASE','t.asesor@vimedic.test')) t(k, e) join p on p.email = t.e;
insert into leads (codigo, nombre, asesor_id, deleted_at) select 'T-L-J1X', 'Lead borrado', id, now() from p where email = 't.jefe1@vimedic.test';
insert into cotizaciones (codigo, nombre, asesor_id)
  select 'T-C-' || t.k, 'Cot ' || t.k, p.id from (values ('J1','t.jefe1@vimedic.test'),('J2','t.jefe2@vimedic.test'),('AST','t.asistente@vimedic.test'),('ASE','t.asesor@vimedic.test')) t(k, e) join p on p.email = t.e;
insert into clientes (identificacion, nombre, asesor_id)
  select '09999000' || t.k, 'T Cliente ' || t.k, p.id from (values ('01','t.jefe1@vimedic.test'),('02','t.jefe2@vimedic.test'),('03','t.asistente@vimedic.test'),('04','t.asesor@vimedic.test')) t(k, e) join p on p.email = t.e;

-- ===== Como el ASISTENTE
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.asistente@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 1, 'asistente ve los leads de los 2 jefes y los suyos (no el del asesor ni el borrado)', 'T-L-AST,T-L-J1,T-L-J2',
  (select string_agg(codigo, ',' order by codigo) from leads where codigo like 'T-L-%');
insert into r select 2, 'asistente ve las cotizaciones de los 2 jefes y las suyas', 'T-C-AST,T-C-J1,T-C-J2',
  (select string_agg(codigo, ',' order by codigo) from cotizaciones where codigo like 'T-C-%');
insert into r select 3, 'asistente ve los clientes de los 2 jefes y los suyos', 'T Cliente 01,T Cliente 02,T Cliente 03',
  (select string_agg(nombre, ',' order by nombre) from clientes where nombre like 'T Cliente %');
do $$
declare v int;
begin
  begin
    with u as (update cotizaciones set nota_cotizacion = 'editada por la asistente' where codigo = 'T-C-J1' returning 1) select count(*) into v from u;
    insert into r values (4, 'asistente edita la cotización del jefe', '1', v::text);
  exception when others then insert into r values (4, 'asistente edita la cotización del jefe', '1', 'ERROR: ' || left(sqlerrm, 80)); end;
  begin
    with u as (update cotizaciones set nota_cotizacion = 'x' where codigo = 'T-C-ASE' returning 1) select count(*) into v from u;
    insert into r values (5, 'asistente NO edita la cotización de un asesor', '0', v::text);
  exception when others then insert into r values (5, 'asistente NO edita la cotización de un asesor', '0', 'ERROR: ' || left(sqlerrm, 80)); end;
  begin
    with u as (update clientes set ciudad = 'Quito' where nombre = 'T Cliente 02' returning 1) select count(*) into v from u;
    insert into r values (6, 'asistente edita el cliente del jefe', '1', v::text);
  exception when others then insert into r values (6, 'asistente edita el cliente del jefe', '1', 'ERROR: ' || left(sqlerrm, 80)); end;
  begin
    with u as (update clientes set ciudad = 'Quito' where nombre = 'T Cliente 04' returning 1) select count(*) into v from u;
    insert into r values (7, 'asistente NO edita el cliente de un asesor', '0', v::text);
  exception when others then insert into r values (7, 'asistente NO edita el cliente de un asesor', '0', 'ERROR: ' || left(sqlerrm, 80)); end;
  begin
    with u as (update leads set estado_crm = estado_crm, nombre = 'Lead jefe tocado' where codigo = 'T-L-J2' returning 1) select count(*) into v from u;
    insert into r values (8, 'asistente edita el lead del jefe', '1', v::text);
  exception when others then insert into r values (8, 'asistente edita el lead del jefe', '1', 'ERROR: ' || left(sqlerrm, 80)); end;
end $$;
do $$
declare v uuid; n int;
begin
  begin
    insert into cotizaciones (codigo, nombre, asesor_id) values ('T-C-NUEVA', 'Cotización nueva a nombre del jefe', (select id from p where email = 't.jefe1@vimedic.test')) returning id into v;
    insert into r values (9, 'asistente crea una cotización a nombre del jefe y la lee de vuelta', 'true', (v is not null)::text);
  exception when others then insert into r values (9, 'asistente crea una cotización a nombre del jefe y la lee de vuelta', 'true', 'ERROR: ' || left(sqlerrm, 80)); end;
  begin
    insert into leads (codigo, nombre, asesor_id) values ('T-L-NUEVO', 'Lead nuevo a nombre del jefe', (select id from p where email = 't.jefe2@vimedic.test')) returning id into v;
    insert into r values (10, 'asistente crea un lead a nombre del jefe y lo lee de vuelta', 'true', (v is not null)::text);
  exception when others then insert into r values (10, 'asistente crea un lead a nombre del jefe y lo lee de vuelta', 'true', 'ERROR: ' || left(sqlerrm, 80)); end;
  begin
    update cotizaciones set deleted_at = now() where codigo = 'T-C-J1';
    get diagnostics n = row_count;
    insert into r values (11, 'asistente NO puede borrar (borrado lógico)', 'denegado', case when n > 0 then 'PERMITIDO' else 'denegado' end);
  exception when others then insert into r values (11, 'asistente NO puede borrar (borrado lógico)', 'denegado', 'denegado'); end;
end $$;
insert into r select 12, 'mi_perfil del asistente trae asiste_a con los 2 jefes', '2',
  (select count(*)::text from jsonb_array_elements_text(mi_perfil() -> 'asiste_a') x where x in ((select id::text from p where email = 't.jefe1@vimedic.test'), (select id::text from p where email = 't.jefe2@vimedic.test')));
insert into r select 13, 'mi_perfil del asistente: toda la Alta Dirección activa (los reales + los 2 de prueba), sin colarse él ni el asesor',
  current_setting('prueba.n_jefes'), jsonb_array_length(mi_perfil() -> 'asiste_a')::text;
insert into r select 14, 'es_yo_o_subordinado NO se abre al jefe (Rutas/Viáticos siguen igual)', 'false', app.es_yo_o_subordinado((select id from p where email = 't.jefe1@vimedic.test'))::text;
insert into r select 15, 'seguimiento de pedidos: ve los del jefe', 'true', app.trk_ve((select id from p where email = 't.jefe1@vimedic.test'))::text;
insert into r select 16, 'seguimiento de pedidos: no ve los del asesor', 'false', app.trk_ve((select id from p where email = 't.asesor@vimedic.test'))::text;
reset role;

-- ===== Como un ASESOR normal: no ve a los jefes
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.asesor@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 17, 'un asesor solo ve su lead (no los de los jefes ni el del asistente)', 'T-L-ASE', (select string_agg(codigo, ',' order by codigo) from leads where codigo like 'T-L-%');
insert into r select 18, 'un asesor solo ve su cotización', 'T-C-ASE', (select string_agg(codigo, ',' order by codigo) from cotizaciones where codigo like 'T-C-%');
insert into r select 19, 'un asesor no ve los clientes de los jefes', 'T Cliente 04', (select string_agg(nombre, ',' order by nombre) from clientes where nombre like 'T Cliente %');
insert into r select 20, 'mi_perfil del asesor: asiste_a vacío', '0', jsonb_array_length(mi_perfil() -> 'asiste_a')::text;
insert into r select 21, 'un asesor no ve el seguimiento de los pedidos del jefe', 'false', app.trk_ve((select id from p where email = 't.jefe1@vimedic.test'))::text;
reset role;

-- ===== Como el JEFE (Alta Dirección, ver_todos): igual que antes
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.jefe1@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 22, 'el jefe sigue viendo todos los leads (menos el borrado)', 'T-L-ASE,T-L-AST,T-L-J1,T-L-J2,T-L-NUEVO',
  (select string_agg(codigo, ',' order by codigo) from leads where codigo like 'T-L-%');
insert into r select 23, 'mi_perfil del jefe: asiste_a vacío (no es asistente)', '0', jsonb_array_length(mi_perfil() -> 'asiste_a')::text;
reset role;

-- ===== Un jefe dado de baja ya no se asiste
select set_config('request.jwt.claims', '', true);   -- sin sesión: el administrador de la base da de baja al jefe 2
update empleados set deleted_at = now() where email = 't.jefe2@vimedic.test';
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.asistente@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 24, 'con el jefe 2 dado de baja, el asistente ya no ve sus leads (ni el que creó a su nombre)', 'T-L-AST,T-L-J1',
  (select string_agg(codigo, ',' order by codigo) from leads where codigo like 'T-L-%');
reset role;

select n, prueba, esperado, obtenido, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado from r order by n;
rollback;
