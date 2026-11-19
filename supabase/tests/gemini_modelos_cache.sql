-- Pruebas: caché de modelos de Gemini en integraciones (migración 20261119150000).
-- La caché existe, la escribe solo el servidor y el navegador no puede leerla ni cambiarla.
-- Correr SOLO en PRUEBAS; se deshace.   npx supabase db query --remote --yes -f supabase/tests/gemini_modelos_cache.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;

insert into r select 1, 'columnas cache (jsonb) y cache_en (timestamptz)', 'cache:jsonb · cache_en:timestamp with time zone',
  (select string_agg(column_name || ':' || data_type, ' · ' order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'integraciones' and column_name in ('cache', 'cache_en'));

-- El servidor (service_role / dueño) guarda la lista
update public.integraciones set cache = '{"modelos":[{"id":"gemini-3.8-flash","nombre":"Gemini 3.8 Flash"}]}'::jsonb, cache_en = now() where proveedor = 'gemini';
insert into r select 2, 'el servidor guarda la lista', 'gemini-3.8-flash', (select cache -> 'modelos' -> 0 ->> 'id' from public.integraciones where proveedor = 'gemini');

-- El navegador (authenticated) no la lee ni la cambia
set local role authenticated;
do $$ begin
  perform cache from public.integraciones limit 1;
  insert into r values (3, 'authenticated no puede leer integraciones', 'sin permiso', 'la leyó');
exception when insufficient_privilege then insert into r values (3, 'authenticated no puede leer integraciones', 'sin permiso', 'sin permiso'); end $$;
do $$ begin
  update public.integraciones set cache = '{}'::jsonb where proveedor = 'gemini';
  insert into r values (4, 'authenticated no puede cambiar la caché', 'sin permiso', 'la cambió');
exception when insufficient_privilege then insert into r values (4, 'authenticated no puede cambiar la caché', 'sin permiso', 'sin permiso'); end $$;
reset role;

-- integraciones_estado (lo que ve la pantalla) no incluye la caché
insert into r select 5, 'integraciones_estado no devuelve cache', 'no',
  (select case when count(*) > 0 then 'sí' else 'no' end from information_schema.routines rt
     join information_schema.parameters p on p.specific_schema = rt.specific_schema and p.specific_name = rt.specific_name
    where rt.routine_schema = 'public' and rt.routine_name = 'integraciones_estado' and p.parameter_name in ('cache', 'cache_en'));

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
