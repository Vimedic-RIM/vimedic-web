-- Pruebas: conexión de Claude en integraciones (migración 20261120090000).
-- Se guarda la clave cifrada (Vault), la pantalla ve «•••• en Vault» y nunca la clave, solo el servidor la descifra,
-- y sin permiso de administrar Marketing no se puede. Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/integracion_claude.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;
create temp table x (k text primary key, v text) on commit drop;
grant all on x to authenticated;

insert into empleados (email, nombre, empresa, estado, cargo, permisos_extra) values
  ('t.cla.adm@vimedic.test', 'T Claude Admin', 'VIMEDIC', 'activo', 'Marketing', '{"marketing":["ver","administrar"]}'::jsonb),
  ('t.cla.ver@vimedic.test', 'T Claude Ver', 'VIMEDIC', 'activo', 'Marketing', '{"marketing":["ver"]}'::jsonb);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000c1a1', 't.cla.adm@vimedic.test'), ('00000000-0000-0000-0000-00000000c1a2', 't.cla.ver@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.cla.%';
-- Punto de partida limpio dentro de la prueba (se deshace al final)
update public.integraciones set deleted_at = now() where proveedor = 'claude';

-- 1) Quien administra guarda la clave y el modelo
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000c1a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.integracion_guardar('claude', 'sk-ant-api03-PRUEBA-NO-REAL', '{"modelo":"claude-opus-5-5"}'::jsonb);
insert into x select 'estado', (select configurado || ' · ' || vista || ' · ' || (config ->> 'modelo') from public.integraciones_estado() where proveedor = 'claude');
insert into x select 'fila_visible', (select count(*)::text from public.integraciones_estado() where proveedor = 'claude' and (vista like '%PRUEBA%' or config::text like '%PRUEBA%'));
do $$ begin
  perform public.integracion_secreto('claude');
  insert into x values ('secreto_nav', 'lo leyó');
exception when insufficient_privilege then insert into x values ('secreto_nav', 'sin permiso'); end $$;
reset role;

insert into r select 1, 'integraciones_estado muestra Claude configurado, sin la clave', 'true · •••• en Vault · claude-opus-5-5', (select v from x where k = 'estado');
insert into r select 2, 'la clave no aparece en lo que ve la pantalla', '0', (select v from x where k = 'fila_visible');
insert into r select 3, 'el navegador no puede descifrar la clave', 'sin permiso', (select v from x where k = 'secreto_nav');
insert into r select 4, 'el servidor (service_role) sí la descifra', 'sk-ant-api03-PRUEBA-NO-REAL', public.integracion_secreto('claude');
insert into r select 5, 'la clave queda cifrada en Vault (no en la tabla)', 'sí',
  (select case when i.secreto_id is not null and i.config::text not like '%PRUEBA%' then 'sí' else 'no' end from public.integraciones i where proveedor = 'claude' and deleted_at is null);

-- 2) Sin permiso de administrar no se puede guardar
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000c1a2', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.integracion_guardar('claude', 'sk-ant-otra', '{}'::jsonb);
  insert into r values (6, 'sin administrar Marketing no se puede guardar', 'error', 'se guardó');
exception when others then insert into r values (6, 'sin administrar Marketing no se puede guardar', 'error', case when sqlerrm like 'Solo quien administra%' then 'error' else sqlerrm end); end $$;
reset role;

-- 3) Desconectar borra la clave
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000c1a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.integracion_quitar('claude');
reset role;
insert into r select 7, 'desconectar borra la clave', 'sin clave', coalesce(public.integracion_secreto('claude'), 'sin clave');

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
