-- Pruebas: sincronización automática de leads de Meta (migración 20261120150000). Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/meta_leads_poll.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;
create temp table x (k text primary key, v text) on commit drop;
grant all on x to authenticated;

insert into empleados (email, nombre, empresa, estado, cargo, permisos_extra) values
  ('t.poll.adm@vimedic.test', 'T Poll Admin', 'VIMEDIC', 'activo', 'Marketing', '{"marketing":["ver","administrar"]}'::jsonb),
  ('t.poll.ver@vimedic.test', 'T Poll Ver', 'VIMEDIC', 'activo', 'Marketing', '{"marketing":["ver"]}'::jsonb);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000a0a01', 't.poll.adm@vimedic.test'), ('00000000-0000-0000-0000-0000000a0a02', 't.poll.ver@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.poll.%';

insert into r select 1, 'extensiones pg_cron y pg_net', 'pg_cron,pg_net', (select string_agg(extname, ',' order by extname) from pg_extension where extname in ('pg_cron', 'pg_net'));
insert into r select 2, 'clave del cron en Vault', 'sí', (select case when exists (select 1 from vault.secrets where name = 'meta_leads_cron_secret') then 'sí' else 'no' end);

-- 3) El navegador no puede leer la clave del cron
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000a0a01', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.meta_poll_clave(); insert into x values ('clave', 'la leyó');
exception when insufficient_privilege then insert into x values ('clave', 'sin permiso'); end $$;
-- 4) El administrador activa la sincronización: queda programada cada 5 min
insert into x select 'act', public.meta_poll_programar(true, 'https://qwkziqjozfeemvjshvsp.supabase.co/functions/v1/meta-leads-poll')::text;
do $$ begin perform public.meta_poll_programar(true, 'https://otro-sitio.com/x'); insert into x values ('url', 'aceptó');
exception when others then insert into x values ('url', case when sqlerrm like 'Dirección de la función%' then 'rechazada' else sqlerrm end); end $$;
reset role;
insert into r select 3, 'el navegador no lee la clave del cron', 'sin permiso', (select v from x where k = 'clave');
insert into r select 4, 'activar: trabajo meta-leads-poll cada 5 minutos', 'true · */5 * * * * · true',
  (select (v::jsonb ->> 'programada') || ' · ' || (select schedule from cron.job where jobname = 'meta-leads-poll') || ' · ' || (select active::text from cron.job where jobname = 'meta-leads-poll') from x where k = 'act');
insert into r select 5, 'el trabajo llama a la función con la clave (sin escribirla en el comando)', 'sí',
  (select case when command like '%meta_leads_poll_url%' and command like '%x-cron-secret%' and command like '%"source":"cron"%' and command not like '%' || public.meta_poll_clave() || '%' then 'sí' else 'no' end from cron.job where jobname = 'meta-leads-poll');
insert into r select 6, 'solo acepta la dirección de meta-leads-poll', 'rechazada', (select v from x where k = 'url');

-- 7) Desactivar quita el trabajo
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000a0a01', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'des', public.meta_poll_programar(false, 'https://qwkziqjozfeemvjshvsp.supabase.co/functions/v1/meta-leads-poll')::text;
reset role;
insert into r select 7, 'desactivar: sin trabajo programado', 'false · 0', (select (v::jsonb ->> 'programada') || ' · ' || (select count(*) from cron.job where jobname = 'meta-leads-poll') from x where k = 'des');

-- 8) Estado: última ejecución y errores
insert into meta_sync_runs (source, started_at, finished_at, forms, found, inserted, duplicates, errors)
values ('cron', now() - interval '3 minutes', now() - interval '3 minutes', 2, 5, 2, 3, '[{"error":"Meta respondió: prueba"}]');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000a0a01', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'est', public.meta_sync_estado()::text;
reset role;
insert into r select 8, 'estado: última ejecución con nuevos y errores', '2 · 3 · Meta respondió: prueba',
  (select (v::jsonb -> 'ultima' ->> 'inserted') || ' · ' || (v::jsonb -> 'ultima' ->> 'duplicates') || ' · ' || (v::jsonb -> 'ultima' -> 'errors' -> 0 ->> 'error') from x where k = 'est');

-- 9) Sin administrar Marketing: ni estado ni interruptor
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000a0a02', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.meta_poll_programar(true, 'https://qwkziqjozfeemvjshvsp.supabase.co/functions/v1/meta-leads-poll'); insert into r values (9, 'sin administrar no cambia la sincronización', 'error', 'cambió');
exception when others then insert into r values (9, 'sin administrar no cambia la sincronización', 'error', case when sqlerrm like 'Solo quien administra%' then 'error' else sqlerrm end); end $$;
reset role;

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
