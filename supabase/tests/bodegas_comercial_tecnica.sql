-- Pruebas: Bodega Comercial / Bodega Técnica, traslados y devoluciones por nota de crédito.
-- Correr SOLO en PRUEBAS; se deshace.   npx supabase db query --remote --yes -f supabase/tests/bodegas_comercial_tecnica.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated, anon, service_role;

insert into empleados (email, nombre, empresa, estado, cargo, permisos_extra) values
  ('t.bd.bod@vimedic.test', 'T Bodeguero', 'VIMEDIC', 'activo', 'Bodega', '{"bodega":["ver","crear","editar"],"movimientos":["ver"],"inventario":["ver"]}'::jsonb),
  ('t.bd.fac@vimedic.test', 'T Facturación', 'VIMEDIC', 'activo', 'Facturación', '{"facturacion":["ver","crear","editar"]}'::jsonb),
  ('t.bd.ase@vimedic.test', 'T Asesor', 'VIMEDIC', 'activo', 'Comercial', '{"crm":["ver"],"inventario":["ver"]}'::jsonb);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 't.bd.bod@vimedic.test'), ('00000000-0000-0000-0000-0000000000b2', 't.bd.fac@vimedic.test'),
  ('00000000-0000-0000-0000-0000000000b3', 't.bd.ase@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.bd.%';

-- Producto de prueba con 3 unidades en la Bodega Comercial y una venta facturada de 2
insert into productos (id, codigo, nombre, stock, stock_por_reparar, pvp) values ('00000000-0000-0000-0000-00000000bd01', 'T-BOD-1', 'Equipo de prueba bodegas', 3, 0, 100);
insert into movimientos_inventario (id, tipo, producto_id, producto_codigo, nombre, cantidad, fecha, bodega)
  values (gen_random_uuid(), 'INGRESO', '00000000-0000-0000-0000-00000000bd01', 'T-BOD-1', 'Equipo de prueba bodegas', 5, now() - interval '3 days', 'Principal');
create temp table fac as select id from facturas where deleted_at is null order by created_at desc limit 1;
insert into movimientos_inventario (id, tipo, producto_id, producto_codigo, nombre, cantidad, precio, aplica_iva, fecha, factura_id, operacion_codigo)
  select '00000000-0000-0000-0000-00000000bd02', 'SALIDA', '00000000-0000-0000-0000-00000000bd01', 'T-BOD-1', 'Equipo de prueba bodegas', -2, 100, true, now() - interval '2 days', id, 'T-VTA' from fac;
grant select on fac to authenticated;

insert into r select 1, 'proveedor de importación abreviado', 'HME', app.abreviar_proveedor('HEALICOM MEDICAL EQUIPMENT CO LTD');
insert into r select 2, 'movimientos de importación con el nombre completo del proveedor', '0',
  (select count(*)::text from movimientos_inventario m join imp_expedientes e on e.codigo = m.operacion_codigo where m.deleted_at is null and m.cliente_texto = e.proveedor_texto);
insert into r select 3, 'traslados con el signo al revés', '0',
  (select count(*)::text from movimientos_inventario where deleted_at is null and bodega in ('Principal', 'Por reparar') and ((tipo = 'SALIDA' and cantidad > 0) or (tipo = 'INGRESO' and cantidad < 0)));

-- Traslado manual: el asesor no puede
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b3', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.mov_trasladar('00000000-0000-0000-0000-00000000bd01', 1, 'tecnica', 'prueba');
  insert into r values (4, 'el asesor no puede trasladar', 'error', 'sin error');
exception when others then insert into r values (4, 'el asesor no puede trasladar', 'error', 'error'); end $$;
insert into r select 5, 'el asesor no ve la Bodega Técnica', 'false', app.ve_bodega_tecnica()::text;
reset role;

-- Bodega traslada 1 a la Técnica y luego intenta regresar 2
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 6, 'Bodega ve la Bodega Técnica', 'true', app.ve_bodega_tecnica()::text;
select public.mov_trasladar('00000000-0000-0000-0000-00000000bd01', 1, 'tecnica', 'pantalla rota');
do $$ begin
  perform public.mov_trasladar('00000000-0000-0000-0000-00000000bd01', 2, 'comercial', 'prueba');
  insert into r values (8, 'no se trasladan más unidades de las que hay', 'error', 'sin error');
exception when others then insert into r values (8, 'no se trasladan más unidades de las que hay', 'error', 'error'); end $$;
reset role;
insert into r select 7, 'tras el traslado: comercial 2 · técnica 1', '2 · 1', (select stock::int || ' · ' || stock_por_reparar::int from productos where id = '00000000-0000-0000-0000-00000000bd01');
insert into r select 9, 'Movimientos muestra las dos bodegas del traslado', 'Bodega Comercial|Bodega Técnica',
  (select string_agg(bodega, '|' order by bodega) from v_movimientos where producto_id = '00000000-0000-0000-0000-00000000bd01' and operacion like 'TRA-%');

-- Nota de crédito sin despachar: vuelve directo a la Bodega Comercial
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b2', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.nc_registrar((select id from fac), 'T-NC-0', current_date, 'prueba', 'https://ejemplo.com/nc.pdf',
    jsonb_build_array(jsonb_build_object('movimiento_id', '00000000-0000-0000-0000-00000000bd02', 'tipo', 'CANTIDAD', 'cantidad', 1, 'base', 100, 'iva', 15)));
  insert into r values (10, 'la NC con devolución pide si ya se despachó', 'error', 'sin error');
exception when others then insert into r values (10, 'la NC con devolución pide si ya se despachó', 'error', 'error'); end $$;
select public.nc_registrar((select id from fac), 'T-NC-1', current_date, 'prueba', 'https://ejemplo.com/nc.pdf',
  jsonb_build_array(jsonb_build_object('movimiento_id', '00000000-0000-0000-0000-00000000bd02', 'tipo', 'CANTIDAD', 'cantidad', 1, 'base', 100, 'iva', 15)), false);
reset role;
insert into r select 11, 'sin despachar: +1 a la Bodega Comercial al instante', '3 · 1', (select stock::int || ' · ' || stock_por_reparar::int from productos where id = '00000000-0000-0000-0000-00000000bd01');

-- Nota de crédito ya despachada: queda por verificar y Bodega decide
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b2', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.nc_registrar((select id from fac), 'T-NC-2', current_date, 'prueba', 'https://ejemplo.com/nc2.pdf',
  jsonb_build_array(jsonb_build_object('movimiento_id', '00000000-0000-0000-0000-00000000bd02', 'tipo', 'CANTIDAD', 'cantidad', 1, 'base', 100, 'iva', 15)), true);
do $$ begin
  perform public.nc_registrar_recepcion((select id from movimientos_inventario where producto_id = '00000000-0000-0000-0000-00000000bd01' and bodega = 'Por verificar' and tipo = 'DEVOLUCION'), 1, 'DISPONIBLE', current_date, 'ok');
  insert into r values (13, 'Facturación no verifica la devolución (lo hace Bodega)', 'error', 'sin error');
exception when others then insert into r values (13, 'Facturación no verifica la devolución (lo hace Bodega)', 'error', 'error'); end $$;
reset role;
insert into r select 12, 'despachado: no suma hasta que Bodega verifique', '3 · 1', (select stock::int || ' · ' || stock_por_reparar::int from productos where id = '00000000-0000-0000-0000-00000000bd01');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 14, 'la bandeja de Bodega muestra la devolución', '1',
  (select count(*)::text from jsonb_array_elements(public.bod_devoluciones_pendientes()) x where x ->> 'codigo' = 'T-BOD-1');
select public.nc_registrar_recepcion((select id from movimientos_inventario where producto_id = '00000000-0000-0000-0000-00000000bd01' and bodega = 'Por verificar' and tipo = 'DEVOLUCION'), 1, 'NO_DISPONIBLE', current_date, 'llegó golpeado');
insert into r select 16, 'ya no está en la bandeja', '0',
  (select count(*)::text from jsonb_array_elements(public.bod_devoluciones_pendientes()) x where x ->> 'codigo' = 'T-BOD-1');
reset role;
insert into r select 15, 'con defecto: va a la Bodega Técnica', '3 · 2', (select stock::int || ' · ' || stock_por_reparar::int from productos where id = '00000000-0000-0000-0000-00000000bd01');

-- Todo cuadra con los movimientos (el botón «Actualizar stock» no cambiaría nada)
insert into r select 17, 'stock comercial = suma de la Bodega Comercial', '3',
  (select sum(app.stock_mov(tipo, bodega, cantidad, disponible))::int::text from movimientos_inventario where producto_id = '00000000-0000-0000-0000-00000000bd01' and deleted_at is null);
insert into r select 18, 'stock técnico = suma de la Bodega Técnica', '2',
  (select sum(cantidad) filter (where bodega = 'Por reparar')::int::text from movimientos_inventario where producto_id = '00000000-0000-0000-0000-00000000bd01' and deleted_at is null);
insert into r select 19, 'acumulado del último movimiento: comercial · técnica · total', '3 · 2 · 5',
  (select saldo_comercial::int || ' · ' || saldo_tecnica::int || ' · ' || saldo::int from v_movimientos_saldo s join movimientos_inventario m on m.id = s.id
    where s.producto_id = '00000000-0000-0000-0000-00000000bd01' order by m.fecha desc, m.created_at desc limit 1);

-- El asesor no ve las unidades de la Bodega Técnica en el estado del stock
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b3', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 20, 'estado del stock para el asesor: sin unidades técnicas', '0',
  coalesce(public.inv_estado_stock() -> 'productos' -> '00000000-0000-0000-0000-00000000bd01' ->> 'reparacion', '0');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 21, 'estado del stock para Bodega: 2 en la Técnica', '2',
  coalesce(public.inv_estado_stock() -> 'productos' -> '00000000-0000-0000-0000-00000000bd01' ->> 'reparacion', '0');
reset role;

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
