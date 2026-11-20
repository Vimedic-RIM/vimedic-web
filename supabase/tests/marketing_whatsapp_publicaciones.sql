-- Pruebas: WhatsApp en las publicaciones (migración 20261120100000).
-- Correr SOLO en PRUEBAS; se deshace.   npx supabase db query --remote --yes -f supabase/tests/marketing_whatsapp_publicaciones.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;
create temp table x (k text primary key, v text) on commit drop;
grant all on x to authenticated;

insert into empleados (email, nombre, empresa, estado, cargo, telefono, permisos_extra) values
  ('t.wap.adm@vimedic.test', 'T Wap Admin', 'VIMEDIC', 'activo', 'Marketing', null, '{"marketing":["ver","administrar"]}'::jsonb),
  ('t.wap.ver@vimedic.test', 'T Wap Ver', 'VIMEDIC', 'activo', 'Marketing', null, '{"marketing":["ver"]}'::jsonb),
  ('t.wap.cel@vimedic.test', 'T Wap Con Celular', 'VIMEDIC', 'activo', 'Ventas', '099 111 2233', '{}'::jsonb),
  ('t.wap.sin@vimedic.test', 'T Wap Sin Celular', 'VIMEDIC', 'activo', 'Ventas', '', '{}'::jsonb);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000aa01', 't.wap.adm@vimedic.test'), ('00000000-0000-0000-0000-00000000aa02', 't.wap.ver@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.wap.%';

insert into x select 'id_cel', id::text from empleados where email = 't.wap.cel@vimedic.test';
insert into x select 'id_sin', id::text from empleados where email = 't.wap.sin@vimedic.test';

-- 1) El ajuste por defecto (si en esta base existe Victor Lopez con celular)
insert into r select 1, 'ajuste por defecto: Victor Lopez, activo', 'Victor Lopez · true',
  coalesce((select (valor ->> 'nombre') || ' · ' || (valor ->> 'activo') from marketing_ajustes where clave = 'whatsapp_publicaciones' and deleted_at is null), 'sin ajuste');

-- 2) Quien administra ve las opciones (solo con celular) y cambia el contacto
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000aa01', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'op', public.mkt_whatsapp_opciones()::text;
insert into x select 'g', public.mkt_whatsapp_guardar((select v::uuid from x where k = 'id_cel'), false)::text;
do $$ begin
  perform public.mkt_whatsapp_guardar((select v::uuid from x where k = 'id_sin'), true);
  insert into x values ('sin', 'se guardó');
exception when others then insert into x values ('sin', case when sqlerrm like 'Elige un empleado activo%' then 'error' else sqlerrm end); end $$;
reset role;
insert into r select 2, 'opciones: incluye al que tiene celular (con sus 4 últimos dígitos) y no al que no tiene', 'sí · 2233 · no',
  (select case when v::jsonb -> 'empleados' @> '[{"nombre":"T Wap Con Celular"}]' then 'sí' else 'no' end || ' · ' ||
          (select e ->> 'termina' from jsonb_array_elements(v::jsonb -> 'empleados') e where e ->> 'nombre' = 'T Wap Con Celular') || ' · ' ||
          case when v::jsonb -> 'empleados' @> '[{"nombre":"T Wap Sin Celular"}]' then 'sí' else 'no' end from x where k = 'op');
insert into r select 3, 'las opciones no traen el teléfono completo', 'no', (select case when v like '%0991112233%' or v like '%111 2233%' then 'sí' else 'no' end from x where k = 'op');
insert into r select 4, 'guardar cambia el contacto y lo desactiva', 'T Wap Con Celular · false',
  (select (valor ->> 'nombre') || ' · ' || (valor ->> 'activo') from marketing_ajustes where clave = 'whatsapp_publicaciones' and deleted_at is null);
insert into r select 5, 'no se puede elegir a alguien sin celular', 'error', (select v from x where k = 'sin');

-- 3) Sin administrar Marketing no se puede ver ni cambiar
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000aa02', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mkt_whatsapp_guardar((select v::uuid from x where k = 'id_cel'), true);
  insert into r values (6, 'sin administrar no se puede cambiar', 'error', 'se guardó');
exception when others then insert into r values (6, 'sin administrar no se puede cambiar', 'error', case when sqlerrm like 'Solo quien administra%' then 'error' else sqlerrm end); end $$;
-- quien solo ve Marketing sí lee el ajuste (para el aviso en «Nueva publicación»)
insert into r select 7, 'quien ve Marketing lee el ajuste', 'T Wap Con Celular', (select valor ->> 'nombre' from marketing_ajustes where clave = 'whatsapp_publicaciones' and deleted_at is null);
reset role;

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
