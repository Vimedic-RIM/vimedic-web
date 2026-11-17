-- Pruebas de Plantillas de documentos. Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/plantillas_documentos.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated, anon;

insert into empleados (email, nombre, empresa, es_superadmin) values ('t.pla.admin@vimedic.test', 'T Admin Plantillas', 'VIMEDIC', true);
insert into empleados (email, nombre, rol_id, empresa) values ('t.pla.asesor@vimedic.test', 'T Asesor Plantillas', (select id from roles where nombre = 'Asesor'), 'VIMEDIC');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 't.pla.admin@vimedic.test'), ('00000000-0000-0000-0000-0000000000e2', 't.pla.asesor@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.pla.%';
create temp table p as select email, id, auth_user_id from empleados where email like 't.pla.%';
grant select on p to authenticated;
update plantillas_documento set deleted_at = now() where codigo in ('acta_entrega', 'zz_prueba');

-- ===== Quien administra guarda dos versiones
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.pla.admin@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 1, 'la primera vez crea la plantilla (versión 1)', '1', public.plantilla_guardar('acta_entrega', 'Acta de entrega', '{"titulo":"Acta","bloques":[]}'::jsonb, 'primera')::text;
insert into r select 2, 'guardar otra vez sube la versión', '2', public.plantilla_guardar('acta_entrega', 'Acta de entrega', '{"titulo":"Acta v2","bloques":[]}'::jsonb, null)::text;
insert into r select 3, 'queda el contenido nuevo', 'Acta v2', (select contenido ->> 'titulo' from plantillas_documento where codigo = 'acta_entrega' and deleted_at is null);
insert into r select 4, 'el historial guarda las dos versiones con su autor', '2 · T Admin Plantillas', (select count(*)::text || ' · ' || max(e.nombre) from plantillas_documento_versiones v join empleados e on e.id = v.guardado_por where v.codigo = 'acta_entrega' and v.deleted_at is null);
do $$ begin
  perform public.plantilla_guardar('Acta Mala', 'x', '{}'::jsonb, null);
  insert into r values (5, 'rechaza un código de plantilla inválido', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (5, 'rechaza un código de plantilla inválido', 'bloqueado', 'bloqueado'); end $$;
do $$ begin
  perform public.plantilla_guardar('zz_prueba', 'x', '[1,2]'::jsonb, null);
  insert into r values (6, 'rechaza un contenido que no es un objeto', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (6, 'rechaza un contenido que no es un objeto', 'bloqueado', 'bloqueado'); end $$;
reset role;

-- ===== Un asesor: la lee (arma sus documentos) pero no la cambia ni ve el historial
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from p where email = 't.pla.asesor@vimedic.test'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 7, 'el asesor lee la plantilla vigente', 'Acta v2', (select contenido ->> 'titulo' from plantillas_documento where codigo = 'acta_entrega');
do $$ begin
  perform public.plantilla_guardar('acta_entrega', 'x', '{"titulo":"hack"}'::jsonb, null);
  insert into r values (8, 'el asesor NO puede guardar plantillas', 'bloqueado', 'PERMITIDO');
exception when others then insert into r values (8, 'el asesor NO puede guardar plantillas', 'bloqueado', 'bloqueado'); end $$;
do $$ declare v int; begin
  with u as (update plantillas_documento set contenido = '{"titulo":"hack"}' where codigo = 'acta_entrega' returning 1) select count(*) into v from u;
  insert into r values (9, 'el asesor NO puede editar la tabla directo', '0', v::text);
end $$;
insert into r select 10, 'el asesor no ve el historial', '0', (select count(*)::text from plantillas_documento_versiones where codigo = 'acta_entrega');
reset role;

-- ===== Sin sesión: nada
set local role anon;
do $$ declare v int; begin
  select count(*) into v from plantillas_documento;
  insert into r values (11, 'sin sesión no se leen plantillas', '0', v::text);
exception when others then insert into r values (11, 'sin sesión no se leen plantillas', '0', '0'); end $$;
reset role;

select n, prueba, esperado, obtenido, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado from r order by n;
rollback;
