-- Pruebas: ordenar categorías y productos del catálogo (migración 20261120180000). Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/inventario_orden_catalogo.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;
create temp table x (k text primary key, v text) on commit drop;
grant all on x to authenticated;

-- Datos de prueba: dos categorías y tres productos
insert into categorias (id, nombre, orden, activo) values
  ('00000000-0000-0000-0000-0000000ca001', 'T Cat Uno', 1, true), ('00000000-0000-0000-0000-0000000ca002', 'T Cat Dos', 2, true);
insert into productos (id, codigo, nombre, categoria_id, orden) values
  ('00000000-0000-0000-0000-0000000ab001', 'T-ORD-1', 'T Prod A', '00000000-0000-0000-0000-0000000ca001', 1),
  ('00000000-0000-0000-0000-0000000ab002', 'T-ORD-2', 'T Prod B', '00000000-0000-0000-0000-0000000ca001', 2),
  ('00000000-0000-0000-0000-0000000ab003', 'T-ORD-3', 'T Prod C', '00000000-0000-0000-0000-0000000ca002', 3);
-- Otro empleado que edita Inventario (no autorizado para ordenar)
insert into empleados (id, email, nombre, empresa, estado, cargo, permisos_extra) values
  ('00000000-0000-0000-0000-0000000ed001', 't.ord.edit@vimedic.test', 'T Edita Inventario', 'VIMEDIC', 'activo', 'Bodega', '{"inventario":["ver","editar"]}');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000fd001', 't.ord.edit@vimedic.test');
update empleados set auth_user_id = '00000000-0000-0000-0000-0000000fd001' where id = '00000000-0000-0000-0000-0000000ed001';

insert into r select 1, 'autorizado: Jonathan Ruiz', 'Jonathan Ruiz',
  (select string_agg(e.nombre, ',') from inventario_ajustes a, jsonb_array_elements_text(a.valor -> 'empleados') j(id) join empleados e on e.id = j.id::uuid where a.clave = 'orden_catalogo');

-- 2-5) Jonathan: puede, y se guarda: Cat Dos primero; dentro de Cat Uno, B antes que A
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from empleados where lower(nombre) = 'jonathan ruiz' and deleted_at is null limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'puede_j', public.inv_puede_ordenar()::text;
insert into x select 'guardar', public.inv_guardar_orden_catalogo(
  array['00000000-0000-0000-0000-0000000ca002', '00000000-0000-0000-0000-0000000ca001']::uuid[],
  array['00000000-0000-0000-0000-0000000ab003', '00000000-0000-0000-0000-0000000ab002', '00000000-0000-0000-0000-0000000ab001']::uuid[])::text;
insert into x select 'otra_vez', public.inv_guardar_orden_catalogo(
  array['00000000-0000-0000-0000-0000000ca002', '00000000-0000-0000-0000-0000000ca001']::uuid[],
  array['00000000-0000-0000-0000-0000000ab003', '00000000-0000-0000-0000-0000000ab002', '00000000-0000-0000-0000-0000000ab001']::uuid[])::text;
reset role;
insert into r select 2, 'Jonathan puede ordenar', 'true', (select v from x where k = 'puede_j');
insert into r select 3, 'categorías en el orden nuevo', 'T Cat Dos,T Cat Uno', (select string_agg(nombre, ',' order by orden) from categorias where nombre like 'T Cat %');
insert into r select 4, 'productos: C, B, A', 'T Prod C,T Prod B,T Prod A', (select string_agg(nombre, ',' order by orden) from productos where codigo like 'T-ORD-%');
insert into r select 5, 'guardar igual otra vez no reescribe nada', '0 · 0', (select (v::jsonb ->> 'categorias') || ' · ' || (v::jsonb ->> 'productos') from x where k = 'otra_vez');

-- 6-8) Quien edita Inventario y otro superadministrador: no pueden
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000fd001', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'puede_e', public.inv_puede_ordenar()::text;
do $$ begin perform public.inv_guardar_orden_catalogo(array['00000000-0000-0000-0000-0000000ca001']::uuid[], null); insert into x values ('err_e', 'guardó');
exception when others then insert into x values ('err_e', case when sqlerrm like 'Solo la persona autorizada%' then 'rechazado' else sqlerrm end); end $$;
do $$ begin perform public.inv_guardar_orden(array['00000000-0000-0000-0000-0000000ab001']::uuid[]); insert into x values ('err_e2', 'guardó');
exception when others then insert into x values ('err_e2', case when sqlerrm like 'Solo la persona autorizada%' then 'rechazado' else sqlerrm end); end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from empleados where deleted_at is null and es_superadmin and lower(nombre) <> 'jonathan ruiz' and auth_user_id is not null limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'puede_s', public.inv_puede_ordenar()::text;
do $$ begin perform public.inv_guardar_orden_catalogo(array['00000000-0000-0000-0000-0000000ca001']::uuid[], null); insert into x values ('err_s', 'guardó');
exception when others then insert into x values ('err_s', case when sqlerrm like 'Solo la persona autorizada%' then 'rechazado' else sqlerrm end); end $$;
reset role;
insert into r select 6, 'quien edita Inventario: no ve ni guarda', 'false · rechazado · rechazado', (select v from x where k = 'puede_e') || ' · ' || (select v from x where k = 'err_e') || ' · ' || (select v from x where k = 'err_e2');
insert into r select 7, 'otro superadministrador: no ve ni guarda', 'false · rechazado', (select v from x where k = 'puede_s') || ' · ' || (select v from x where k = 'err_s');
insert into r select 8, 'el orden no cambió por los intentos rechazados', 'T Cat Dos,T Cat Uno', (select string_agg(nombre, ',' order by orden) from categorias where nombre like 'T Cat %');

-- 9) La lista de autorizados la cambia solo Seguridad (quien edita Inventario no)
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000fd001', 'role', 'authenticated')::text, true);
set local role authenticated;
with u as (update inventario_ajustes set valor = '{"empleados":["00000000-0000-0000-0000-0000000ed001"]}' where clave = 'orden_catalogo' returning 1)
insert into x select 'aj', count(*)::text from u;
reset role;
insert into r select 9, 'quien edita Inventario no puede autorizarse', '0', (select v from x where k = 'aj');

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
