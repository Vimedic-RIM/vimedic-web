-- Pruebas de las funciones que el frontend llama y deben existir en "public" (Issue #42). Correr SOLO en el proyecto de PRUEBAS;
-- todo se deshace al final.   npx supabase db query --remote --yes -f supabase/tests/facturacion_envio.sql
-- Casos: existen en public (lo que busca la API); anon no las ejecuta y authenticated sí; un asesor envía una venta a Facturación y
-- queda una factura Pendiente con datos completos; reenviar no duplica; si ya está Facturada avisa; sin permiso se bloquea;
-- la bitácora devuelve su id; el ingreso de proveedores se resuelve.
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;

insert into r select 1, 'public.enviar_venta_a_facturacion existe', 'true', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'enviar_venta_a_facturacion')::text;
insert into r select 2, 'public.registrar_bitacora existe', 'true', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'registrar_bitacora')::text;
insert into r select 3, 'public.registrar_ingreso_proveedor existe', 'true', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'registrar_ingreso_proveedor')::text;
insert into r select 4, 'anon NO puede ejecutar enviar_venta_a_facturacion', 'false',
  coalesce((select has_function_privilege('anon', p.oid, 'execute') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'enviar_venta_a_facturacion'), false)::text;
insert into r select 5, 'authenticated SÍ puede ejecutarla', 'true',
  coalesce((select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'enviar_venta_a_facturacion'), false)::text;

do $$ begin perform set_config('prueba.cot', (select id::text from cotizaciones where deleted_at is null limit 1), true); end $$;

-- ===== Asesor con CRM (Jessica) envía una venta
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from empleados where nombre = 'Jessica Maldonado' and deleted_at is null limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare res jsonb; asesor uuid := (select id from empleados where nombre = 'Jessica Maldonado' and deleted_at is null limit 1);
begin
  begin
    res := public.enviar_venta_a_facturacion('VEN-PRUEBA42', 'VIMEDIC', current_setting('prueba.cot')::uuid, null, '1712345678', asesor, 'Referido', null,
             '[{"codigo":"X","nombre":"Prueba","precio":100,"cantidad":1}]'::jsonb, '{"pago":"Pagado","entrega":"Local"}'::jsonb, 100, 15, 115);
    insert into r values (6, 'el asesor envía la venta a Facturación', 'true', coalesce(res ->> 'success', 'null'));
  exception when others then insert into r values (6, 'el asesor envía la venta a Facturación', 'true', 'ERROR: ' || left(sqlerrm, 90)); end;
end $$;
reset role;
insert into r select 7, 'queda 1 factura Pendiente con datos completos', '1 · Pendiente · true',
  (select count(*) || ' · ' || coalesce(max(estado), '-') || ' · ' || coalesce(bool_and(datos_completos)::text, '-') from facturas where codigo = 'VEN-PRUEBA42' and deleted_at is null);

-- ===== Reenviar (reintento) no duplica
set local role authenticated;
do $$
declare res jsonb; asesor uuid := (select id from empleados where nombre = 'Jessica Maldonado' and deleted_at is null limit 1);
begin
  begin
    res := public.enviar_venta_a_facturacion('VEN-PRUEBA42', 'VIMEDIC', current_setting('prueba.cot')::uuid, null, '1712345678', asesor, 'Referido', null, '[]'::jsonb, '{}'::jsonb, 200, 30, 230);
    insert into r values (8, 'reenviar actualiza y no duplica', 'true', coalesce(res ->> 'success', 'null'));
  exception when others then insert into r values (8, 'reenviar actualiza y no duplica', 'true', 'ERROR: ' || left(sqlerrm, 90)); end;
end $$;
reset role;
insert into r select 9, 'sigue siendo 1 sola factura, con el total nuevo', '1 · 230.00',
  (select count(*) || ' · ' || coalesce(max(total)::text, '-') from facturas where codigo = 'VEN-PRUEBA42' and deleted_at is null);

-- ===== Si ya está Facturada, avisa y no la toca
update facturas set estado = 'Facturado', numero_contifico = '001-001-000000042' where codigo = 'VEN-PRUEBA42';
set local role authenticated;
do $$
declare res jsonb;
begin
  begin
    res := public.enviar_venta_a_facturacion('VEN-PRUEBA42', 'VIMEDIC', current_setting('prueba.cot')::uuid, null, null, null, null, null, '[]'::jsonb, '{}'::jsonb, 1, 0, 1);
    insert into r values (10, 'ya facturada: avisa con el número', 'true · 001-001-000000042', coalesce(res ->> 'ya_facturado', 'null') || ' · ' || coalesce(res ->> 'numero_contifico', 'null'));
  exception when others then insert into r values (10, 'ya facturada: avisa con el número', 'true · 001-001-000000042', 'ERROR: ' || left(sqlerrm, 90)); end;
end $$;
reset role;

-- ===== Bitácora de Facturación (la usan la guía de despacho y el acta)
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from empleados where nombre = 'Jessica Maldonado' and deleted_at is null limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare res uuid;
begin
  begin
    res := public.registrar_bitacora('facturacion', 'prueba', 'Prueba #42', (select id from facturas where codigo = 'VEN-PRUEBA42' limit 1));
    insert into r values (11, 'registrar_bitacora devuelve su id', 'con id', case when res is not null then 'con id' else 'sin id' end);
  exception when undefined_function then insert into r values (11, 'registrar_bitacora devuelve su id', 'con id', 'NO EXISTE');
            when others then insert into r values (11, 'registrar_bitacora devuelve su id', 'con id', 'ERROR: ' || left(sqlerrm, 90)); end;
end $$;
-- ===== Ingreso de proveedores: solo se comprueba que la API la encuentra (su lógica es de Adquisiciones)
do $$
declare t text;
begin
  begin perform public.registrar_ingreso_proveedor('Proveedor prueba #42', 'F-42', current_date, null, '[]'::jsonb); t := 'existe';
  exception when undefined_function then t := 'NO EXISTE';
            when others then t := 'existe'; end;
  insert into r values (12, 'registrar_ingreso_proveedor se resuelve en public', 'existe', t);
end $$;
reset role;

-- ===== Sin ningún permiso: se bloquea (rol quitado dentro de la transacción)
select set_config('request.jwt.claims', '', true);
update empleados set rol_id = null, permisos_extra = '{}'::jsonb where nombre = 'Steban Gines';
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from empleados where nombre = 'Steban Gines' limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.enviar_venta_a_facturacion('VEN-PRUEBA42B', 'VIMEDIC', current_setting('prueba.cot')::uuid);
    insert into r values (13, 'sin permiso de CRM: bloqueado', 'bloqueado', 'PERMITIDO');
  exception when others then insert into r values (13, 'sin permiso de CRM: bloqueado', 'bloqueado', case when sqlerrm like 'No autorizado%' then 'bloqueado' else left(sqlerrm, 90) end); end;
end $$;
reset role;

select n, prueba, esperado, obtenido, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado from r order by n;
rollback;
