-- Pruebas de los términos y condiciones de las ofertas. Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/ofertas_terminos.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated, anon;

insert into empleados (email, nombre, empresa, es_superadmin) values ('t.ter.admin@vimedic.test', 'T Admin Términos', 'VIMEDIC', true);
insert into empleados (email, nombre, rol_id, empresa) values ('t.ter.asesor@vimedic.test', 'T Asesor Términos', (select id from roles where nombre = 'Asesor'), 'VIMEDIC');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 't.ter.admin@vimedic.test'), ('00000000-0000-0000-0000-0000000000b2', 't.ter.asesor@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.ter.%';
create temp table p as select email, id, auth_user_id from empleados where email like 't.ter.%';
grant select on p to authenticated;
update ofertas_terminos set deleted_at = now();
insert into promo_campanas (id, codigo, nombre, fin) values ('00000000-0000-0000-0000-0000000000c9', 'ZZ-CAMP-T', 'Zz Campaña Términos', current_date + 10);

-- ===== Quien administra
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.ter.admin@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.ofertas_terminos_guardar(null, '{"vigencia":true,"formasPago":"Contado o transferencia"}'::jsonb, true);
  perform public.ofertas_terminos_guardar(null, '{"vigencia":true,"formasPago":"Solo contado"}'::jsonb, true);
  insert into r values (1, 'guarda los términos generales y al volver a guardar los reemplaza (una sola fila)', '1 · Solo contado',
    (select count(*)::text || ' · ' || max(campos ->> 'formasPago') from ofertas_terminos where campana_id is null and deleted_at is null));
exception when others then insert into r values (1, 'guarda los términos generales y al volver a guardar los reemplaza (una sola fila)', '1 · Solo contado', left(sqlerrm, 80)); end $$;
do $$ begin
  perform public.ofertas_terminos_guardar('00000000-0000-0000-0000-0000000000c9', '{"noAcumulable":true,"garantia":"2 años"}'::jsonb, true);
  insert into r values (2, 'guarda los términos propios de una campaña', '2 años', (select campos ->> 'garantia' from ofertas_terminos where campana_id = '00000000-0000-0000-0000-0000000000c9'));
exception when others then insert into r values (2, 'guarda los términos propios de una campaña', '2 años', left(sqlerrm, 80)); end $$;
do $$ begin
  perform public.ofertas_terminos_guardar(null, '[1]'::jsonb, true);
  insert into r values (3, 'rechaza términos que no son un objeto', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (3, 'rechaza términos que no son un objeto', 'bloqueado', 'bloqueado'); end $$;
reset role;

-- ===== Asesor: los lee (los copia en su cotización) pero no los cambia
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.ter.asesor@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 4, 'el asesor lee los términos (generales y de la campaña)', '2', (select count(*)::text from ofertas_terminos where deleted_at is null);
do $$ begin
  perform public.ofertas_terminos_guardar(null, '{"vigencia":false}'::jsonb, true);
  insert into r values (5, 'el asesor NO puede cambiar los términos', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (5, 'el asesor NO puede cambiar los términos', 'bloqueado', 'bloqueado'); end $$;
reset role;

-- ===== Cotización: copia y opción de mostrar
insert into r select 6, 'las cotizaciones muestran los términos por defecto', 'true', (select column_default = 'true' from information_schema.columns where table_name = 'cotizaciones' and column_name = 'mostrar_terminos')::text;

select n, prueba, esperado, obtenido, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado from r order by n;
rollback;
