-- Pruebas de «Conectar con Google» (Drive) y del arreglo de proveedores. Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/google_oauth_drive.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated, service_role;

insert into empleados (email, nombre, empresa, es_superadmin) values ('t.oauth.admin@vimedic.test', 'T Admin OAuth', 'VIMEDIC', true);
insert into empleados (email, nombre, rol_id, empresa) values ('t.oauth.asesor@vimedic.test', 'T Asesor OAuth', (select id from roles where nombre = 'Asesor'), 'VIMEDIC');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 't.oauth.admin@vimedic.test'), ('00000000-0000-0000-0000-0000000000d2', 't.oauth.asesor@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.oauth.%';
create temp table p as select email, id, auth_user_id from empleados where email like 't.oauth.%';
grant select on p to authenticated, service_role;
-- Estado limpio para la prueba (todo se deshace al final)
update integraciones set deleted_at = now() where proveedor in ('drive', 'google_app', 'meta_pixel');

-- ===== Quien administra
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.oauth.admin@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.integracion_guardar('meta_pixel', null, '{"pixelId":"123"}'::jsonb);
  insert into r values (1, 'ahora se puede guardar el píxel de Meta (antes lo rechazaba la restricción)', 'ok', 'ok');
exception when others then insert into r values (1, 'ahora se puede guardar el píxel de Meta (antes lo rechazaba la restricción)', 'ok', left(sqlerrm, 90)); end $$;
do $$ begin
  perform public.integracion_guardar('google_app', '{"client_id":"x.apps.googleusercontent.com","client_secret":"s"}', '{"client_id":"x.apps.googleusercontent.com"}'::jsonb);
  insert into r values (2, 'guarda la app de Google (ID y secreto)', 'ok', 'ok');
exception when others then insert into r values (2, 'guarda la app de Google (ID y secreto)', 'ok', left(sqlerrm, 90)); end $$;
do $$ begin
  perform public.integracion_guardar('drive', null, '{"driveId":"UNIDAD1","modo":"oauth"}'::jsonb);
  insert into r values (3, 'guarda la unidad antes de autorizar (sin secreto)', 'ok', 'ok');
exception when others then insert into r values (3, 'guarda la unidad antes de autorizar (sin secreto)', 'ok', left(sqlerrm, 90)); end $$;
insert into r select 4, 'el estado muestra la app de Google guardada', 'true', (select configurado::text from public.integraciones_estado() where proveedor = 'google_app');
do $$ begin
  perform public.integracion_guardar_servicio('drive', '{"tipo":"oauth","refresh_token":"x"}', '{}'::jsonb, null);
  insert into r values (5, 'un usuario NO puede guardar como la función de Google', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (5, 'un usuario NO puede guardar como la función de Google', 'bloqueado', 'bloqueado'); end $$;
reset role;

-- ===== La Edge Function (service_role) guarda la autorización sin perder la unidad
set local role service_role;
select public.integracion_guardar_servicio('drive', '{"tipo":"oauth","refresh_token":"rt-prueba","cuenta":"empresa@vimedic.test"}', '{"modo":"oauth","cuenta":"empresa@vimedic.test"}'::jsonb, (select id from p where email = 't.oauth.admin@vimedic.test'));
insert into r select 6, 'conserva el ID de la unidad y agrega la cuenta', 'UNIDAD1 · empresa@vimedic.test', (select (config ->> 'driveId') || ' · ' || (config ->> 'cuenta') from integraciones where proveedor = 'drive' and deleted_at is null);
insert into r select 7, 'el secreto de Drive queda cifrado y legible solo por la función', 'oauth', (select (public.integracion_secreto('drive'))::jsonb ->> 'tipo');
reset role;

-- ===== Un asesor no ve ni cambia las conexiones
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.oauth.asesor@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.integracion_guardar('google_app', '{"client_id":"y","client_secret":"z"}', '{}'::jsonb);
  insert into r values (8, 'un asesor NO puede cambiar la app de Google', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (8, 'un asesor NO puede cambiar la app de Google', 'bloqueado', 'bloqueado'); end $$;
do $$ begin
  perform public.integracion_secreto('drive');
  insert into r values (9, 'un usuario NO puede leer el secreto de Drive', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (9, 'un usuario NO puede leer el secreto de Drive', 'bloqueado', 'bloqueado'); end $$;
reset role;

select n, prueba, esperado, obtenido, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado from r order by n;
rollback;
