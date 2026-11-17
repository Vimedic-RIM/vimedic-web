-- Pruebas: Facturación guarda actas y guías (HTML) en el bucket «despachos» solo en sus carpetas. Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/facturacion_actas_storage.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated, anon, service_role;

insert into empleados (email, nombre, empresa, permisos_extra) values ('t.act.fact@vimedic.test', 'T Facturación Actas', 'VIMEDIC', '{"facturacion":["ver","editar"]}'::jsonb);
insert into empleados (email, nombre, rol_id, empresa) values ('t.act.asesor@vimedic.test', 'T Asesor Actas', (select id from roles where nombre = 'Asesor'), 'VIMEDIC');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 't.act.fact@vimedic.test'), ('00000000-0000-0000-0000-0000000000d2', 't.act.asesor@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.act.%';
create temp table p as select email, auth_user_id from empleados where email like 't.act.%';
grant select on p to authenticated;

-- ===== Facturación (editar)
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.act.fact@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('despachos', 'actas/zz-prueba-acta.html');
  insert into r values (1, 'Facturación guarda el acta en actas/', 'permitido', 'permitido');
exception when others then insert into r values (1, 'Facturación guarda el acta en actas/', 'permitido', left(sqlerrm, 80)); end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('despachos', 'guias/zz-prueba-envio.html');
  insert into r values (2, 'Facturación guarda la etiqueta en guias/', 'permitido', 'permitido');
exception when others then insert into r values (2, 'Facturación guarda la etiqueta en guias/', 'permitido', left(sqlerrm, 80)); end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('despachos', 'zz-otra/foto.jpg');
  insert into r values (3, 'Facturación NO escribe en otras carpetas del bucket', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (3, 'Facturación NO escribe en otras carpetas del bucket', 'bloqueado', 'bloqueado'); end $$;
reset role;

-- ===== Asesor (sin Facturación)
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.act.asesor@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('despachos', 'actas/zz-asesor.html');
  insert into r values (4, 'el asesor NO guarda actas', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (4, 'el asesor NO guarda actas', 'bloqueado', 'bloqueado'); end $$;
reset role;

select n, prueba, esperado, obtenido, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado from r order by n;
rollback;
