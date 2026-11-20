-- Pruebas: registro de errores de pantalla (migración 20261120110000).
-- Correr SOLO en PRUEBAS; se deshace.   npx supabase db query --remote --yes -f supabase/tests/errores_app.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;

insert into empleados (email, nombre, empresa, estado, cargo, permisos_extra) values
  ('t.err.uno@vimedic.test', 'T Error Uno', 'VIMEDIC', 'activo', 'Ventas', '{"crm":["ver"]}'::jsonb),
  ('t.err.seg@vimedic.test', 'T Error Seguridad', 'VIMEDIC', 'activo', 'Sistemas', '{"seguridad":["ver"]}'::jsonb);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000e501', 't.err.uno@vimedic.test'), ('00000000-0000-0000-0000-00000000e502', 't.err.seg@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.err.%';

-- 1) Cualquier usuario registra su error; no puede leer la tabla
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e501', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.registrar_error_app('{"donde":"este módulo","mensaje":"undefined is not iterable","componentes":"at Resumen","url":"https://qa/#marketing"}'::jsonb);
insert into r select 1, 'quien no es de Seguridad no ve los errores', '0', (select count(*)::text from public.errores_app where mensaje = 'undefined is not iterable');
do $$ begin
  insert into public.errores_app (mensaje) values ('directo');
  insert into r values (2, 'no se puede escribir directo en la tabla', 'error', 'se guardó');
exception when others then insert into r values (2, 'no se puede escribir directo en la tabla', 'error', 'error'); end $$;
-- 3) Tope: 30 por hora
select public.registrar_error_app(jsonb_build_object('mensaje', 'bucle ' || g)) from generate_series(1, 40) g;
reset role;
insert into r select 3, 'quedó registrado con quién y dónde', 'T Error Uno · este módulo · at Resumen',
  (select e.nombre || ' · ' || x.donde || ' · ' || x.componentes from errores_app x join empleados e on e.id = x.empleado_id where x.mensaje = 'undefined is not iterable');
insert into r select 4, 'máximo 30 por persona por hora', '30',
  (select count(*)::text from errores_app x join empleados e on e.id = x.empleado_id where e.email = 't.err.uno@vimedic.test');

-- 4) Seguridad › ver sí los lee
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e502', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 5, 'Seguridad › ver lee los errores', '1', (select count(*)::text from public.errores_app where mensaje = 'undefined is not iterable');
reset role;

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
