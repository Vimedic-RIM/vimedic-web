-- Pruebas: registrar y editar la factura de una venta (fact_registrar_factura).
-- Registrar descarga el stock una sola vez; repetir no duplica; editar cambia número/PDF sin tocar el stock;
-- número repetido pide confirmar; sin permiso no se puede.
-- Correr SOLO en PRUEBAS; se deshace.   npx supabase db query --remote --yes -f supabase/tests/facturacion_registrar.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;
create temp table x (k text primary key, v text) on commit drop;
grant all on x to authenticated;

insert into empleados (email, nombre, empresa, estado, cargo, permisos_extra) values
  ('t.frg.fac@vimedic.test', 'T Facturación Reg', 'VIMEDIC', 'activo', 'Facturación', '{"facturacion":["ver","crear","editar"]}'::jsonb),
  ('t.frg.ver@vimedic.test', 'T Solo Ver', 'VIMEDIC', 'activo', 'Ventas', '{"facturacion":["ver"]}'::jsonb);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000f0a1', 't.frg.fac@vimedic.test'), ('00000000-0000-0000-0000-00000000f0a2', 't.frg.ver@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.frg.%';

insert into productos (id, codigo, nombre, stock, stock_por_reparar, pvp) values ('00000000-0000-0000-0000-00000000f0f1', 'T-FRG-1', 'Equipo de prueba factura', 0, 0, 100);
insert into movimientos_inventario (id, codigo, tipo, bodega, producto_id, producto_codigo, nombre, cantidad, disponible, fecha)
values (gen_random_uuid(), 'T-FRG-ING', 'INGRESO', 'Bodega Comercial', '00000000-0000-0000-0000-00000000f0f1', 'T-FRG-1', 'Equipo de prueba factura', 5, true, now());
update productos set stock = 5 where id = '00000000-0000-0000-0000-00000000f0f1';
insert into facturas (id, codigo, empresa, estado, items, subtotal, iva, total, fecha_ganado, datos_completos) values
  ('00000000-0000-0000-0000-00000000f0fa', 'T-FRG-VEN', 'VIMEDIC', 'Pendiente',
   '[{"id":"00000000-0000-0000-0000-00000000f0f1","codigo":"T-FRG-1","nombre":"Equipo de prueba factura","cantidad":2,"precio":100,"descuento":0,"iva":true}]'::jsonb, 200, 30, 230, now(), true),
  ('00000000-0000-0000-0000-00000000f0fb', 'T-FRG-OTRA', 'VIMEDIC', 'Facturado', '[]'::jsonb, 10, 0, 10, now(), true);
update facturas set numero_contifico = '001-002-000099991' where id = '00000000-0000-0000-0000-00000000f0fb';
create or replace function pg_temp.est() returns text language sql as $$
  select f.estado || ' · ' || coalesce(f.numero_contifico, '-') || ' · ' || coalesce(f.pdf_url, 'sin pdf') || ' · stock ' || p.stock::int || ' · salidas ' ||
         (select count(*) from movimientos_inventario m where m.factura_id = f.id and m.deleted_at is null and m.tipo = 'SALIDA') || ' · hist ' ||
         (select count(*) from jsonb_array_elements(f.historial) h where h ->> 'accion' in ('Factura registrada', 'Factura editada'))
  from facturas f, productos p where f.id = '00000000-0000-0000-0000-00000000f0fa' and p.id = '00000000-0000-0000-0000-00000000f0f1'
$$;

-- 1) Registrar: queda facturada, descarga 2 una sola vez
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f0a1', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'r1', public.fact_registrar_factura('00000000-0000-0000-0000-00000000f0fa', '99990', 'https://contifico.com/f/99990.pdf')::text;
-- 2) Volver a guardar lo mismo (el doble registro de antes): no hace nada
insert into x select 'r2', public.fact_registrar_factura('00000000-0000-0000-0000-00000000f0fa', '99990', 'https://contifico.com/f/99990.pdf')::text;
reset role;
insert into r select 1, 'registrar: facturada, salida de 2, historial 1', 'Facturado · 99990 · https://contifico.com/f/99990.pdf · stock 3 · salidas 1 · hist 1', pg_temp.est();
insert into r select 2, 'guardar otra vez lo mismo no duplica', 'registrada · sin_cambios', (select (select v::jsonb ->> 'accion' from x where k = 'r1') || ' · ' || (select v::jsonb ->> 'accion' from x where k = 'r2'));
insert into r select 3, 'fecha de facturación = hoy en Ecuador', (now() at time zone 'America/Guayaquil')::date::text, (select fecha_facturacion::text from facturas where id = '00000000-0000-0000-0000-00000000f0fa');

-- 3) Editar el número (repetido con otra venta: pide confirmar) y el PDF
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f0a1', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'r3', public.fact_registrar_factura('00000000-0000-0000-0000-00000000f0fa', '99991', 'https://contifico.com/f/99991.pdf')::text;
reset role;
insert into x select 'e3', pg_temp.est();
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f0a1', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'r4', public.fact_registrar_factura('00000000-0000-0000-0000-00000000f0fa', '99991', 'https://contifico.com/f/99991.pdf', true)::text;
reset role;
insert into r select 4, 'número repetido (99991 = 001-002-000099991): avisa y no guarda', 'false · T-FRG-OTRA · Facturado · 99990',
  (select (v::jsonb ->> 'ok') || ' · ' || (v::jsonb -> 'repetido' ->> 'codigo') from x where k = 'r3') || ' · ' || (select split_part(v, ' · ', 1) || ' · ' || split_part(v, ' · ', 2) from x where k = 'e3');
insert into r select 5, 'confirmado: edita número y PDF, sin tocar el stock', 'editada · Facturado · 99991 · https://contifico.com/f/99991.pdf · stock 3 · salidas 1 · hist 2',
  (select v::jsonb ->> 'accion' from x where k = 'r4') || ' · ' || pg_temp.est();
insert into r select 6, 'historial de la edición', 'Factura editada · Nº 99990 → 99991 · cambió el PDF',
  (select (h ->> 'accion') || ' · ' || (h ->> 'detalle') from facturas f, jsonb_array_elements(f.historial) h where f.id = '00000000-0000-0000-0000-00000000f0fa' and h ->> 'accion' = 'Factura editada');
insert into r select 7, 'la salida de inventario muestra el número y PDF nuevos', '99991 · https://contifico.com/f/99991.pdf',
  (select factura_texto || ' · ' || factura_url from movimientos_inventario where factura_id = '00000000-0000-0000-0000-00000000f0fa' and tipo = 'SALIDA');

-- 4) Validaciones y permisos
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f0a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.fact_registrar_factura('00000000-0000-0000-0000-00000000f0fa', 'ABC', null);
  insert into r values (8, 'número con letras no se acepta', 'error', 'se guardó');
exception when others then insert into r values (8, 'número con letras no se acepta', 'error', case when sqlerrm like 'El número de factura lleva%' then 'error' else sqlerrm end); end $$;
do $$ begin
  perform public.fact_registrar_factura('00000000-0000-0000-0000-00000000f0fa', '99991', 'drive.google.com/x');
  insert into r values (9, 'enlace sin https no se acepta', 'error', 'se guardó');
exception when others then insert into r values (9, 'enlace sin https no se acepta', 'error', case when sqlerrm like 'El enlace del PDF%' then 'error' else sqlerrm end); end $$;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f0a2', 'role', 'authenticated')::text, true);
do $$ begin
  perform public.fact_registrar_factura('00000000-0000-0000-0000-00000000f0fa', '12345', null);
  insert into r values (10, 'sin permiso de editar Facturación no se puede', 'error', 'se guardó');
exception when others then insert into r values (10, 'sin permiso de editar Facturación no se puede', 'error', case when sqlerrm like 'No tienes permiso%' then 'error' else sqlerrm end); end $$;
reset role;
insert into r select 11, 'estado final sin cambios por los intentos fallidos', 'Facturado · 99991 · https://contifico.com/f/99991.pdf · stock 3 · salidas 1 · hist 2', pg_temp.est();

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
