-- Pruebas: todo el ciclo del stock de un producto, con los procesos de la app y un usuario de cada área.
-- Compra local → venta facturada → nota de crédito con devolución → traslado → importación → repuesto de Servicio Técnico
-- → edición de un movimiento. En cada paso el stock debe cuadrar con la suma de sus movimientos.
-- Al final revisa los datos reales: ninguna factura de la app sin su salida y ningún producto descuadrado.
-- Correr SOLO en PRUEBAS; se deshace.   npx supabase db query --remote --yes -f supabase/tests/stock_procesos.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;

insert into empleados (email, nombre, empresa, estado, cargo, permisos_extra) values
  ('t.stk.com@vimedic.test', 'T Compras', 'VIMEDIC', 'activo', 'Compras', '{"importaciones":["ver","crear","editar"]}'::jsonb),
  ('t.stk.fac@vimedic.test', 'T Facturación', 'VIMEDIC', 'activo', 'Facturación', '{"facturacion":["ver","crear","editar"]}'::jsonb),
  ('t.stk.bod@vimedic.test', 'T Bodega', 'VIMEDIC', 'activo', 'Bodega', '{"bodega":["ver","crear","editar"],"movimientos":["ver"],"inventario":["ver"]}'::jsonb),
  ('t.stk.st@vimedic.test', 'T Técnico', 'VIMEDIC', 'activo', 'Servicio Técnico', '{"servicio_tecnico":["ver","crear","editar"]}'::jsonb),
  ('t.stk.mov@vimedic.test', 'T Movimientos', 'VIMEDIC', 'activo', 'Inventario', '{"movimientos":["ver","crear","editar"],"inventario":["ver","editar"]}'::jsonb);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005c1', 't.stk.com@vimedic.test'), ('00000000-0000-0000-0000-0000000005c2', 't.stk.fac@vimedic.test'),
  ('00000000-0000-0000-0000-0000000005c3', 't.stk.bod@vimedic.test'), ('00000000-0000-0000-0000-0000000005c4', 't.stk.st@vimedic.test'),
  ('00000000-0000-0000-0000-0000000005c5', 't.stk.mov@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.stk.%';

insert into productos (id, codigo, nombre, stock, stock_por_reparar, pvp) values ('00000000-0000-0000-0000-0000000005f1', 'T-STK-1', 'Equipo de prueba del stock', 0, 0, 100);
create temp table x (k text primary key, v text) on commit drop;
grant all on x to authenticated;
-- stock · técnica del producto de prueba, y si cuadra con la suma de sus movimientos
create or replace function pg_temp.est() returns text language sql as $$
  select coalesce(p.stock, 0)::int || ' · ' || coalesce(p.stock_por_reparar, 0)::int ||
         case when coalesce(p.stock, 0) = coalesce(m.com, 0) and coalesce(p.stock_por_reparar, 0) = coalesce(m.tec, 0) then ' · cuadra' else ' · NO cuadra (' || coalesce(m.com, 0) || ' · ' || coalesce(m.tec, 0) || ')' end
  from productos p left join (select sum(app.stock_mov(tipo, bodega, cantidad, disponible)) com, coalesce(sum(cantidad) filter (where bodega = 'Por reparar'), 0) tec
                               from movimientos_inventario where producto_id = '00000000-0000-0000-0000-0000000005f1' and deleted_at is null) m on true
  where p.id = '00000000-0000-0000-0000-0000000005f1'
$$;

-- 1) Compra local (Adquisiciones) de 5
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000005c1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.registrar_ingreso_proveedor('Proveedor de prueba', 'F-001', current_date, 'prueba', '[{"codigo":"T-STK-1","cantidad":5,"precio":40}]'::jsonb);
exception when others then insert into r values (1, 'compra local', 'sin error', sqlerrm); end $$;
reset role;
insert into r select 1, 'compra local de 5 sube la Bodega Comercial', '5 · 0 · cuadra', pg_temp.est();

-- 2) Venta de 2: al registrar la factura se descarga sola
insert into facturas (id, codigo, empresa, estado, items, subtotal, iva, total, fecha_ganado)
values ('00000000-0000-0000-0000-0000000005fa', 'T-VEN-STK', 'VIMEDIC', 'Pendiente',
  '[{"id":"00000000-0000-0000-0000-0000000005f1","codigo":"T-STK-1","nombre":"Equipo de prueba del stock","cantidad":2,"precio":100,"descuento":0,"iva":true}]'::jsonb, 200, 30, 230, now());
insert into r select 2, 'venta pendiente de facturar no descuenta', '5 · 0 · cuadra', pg_temp.est();
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000005c2', 'role', 'authenticated')::text, true);
set local role authenticated;
update facturas set estado = 'Facturado', numero_contifico = 'T-001-002-99999', fecha_facturacion = current_date,
  facturado_por = (select id from empleados where email = 't.stk.fac@vimedic.test') where id = '00000000-0000-0000-0000-0000000005fa';
reset role;
insert into r select 3, 'al registrar la factura: salida de 2', '3 · 0 · cuadra', pg_temp.est();
insert into r select 4, 'la salida lleva factura, número y cantidad negativa', '1 · T-001-002-99999 · -2',
  (select count(*) || ' · ' || max(factura_texto) || ' · ' || min(cantidad)::int from movimientos_inventario where factura_id = '00000000-0000-0000-0000-0000000005fa' and tipo = 'SALIDA');
-- volver a marcarla no duplica
update facturas set estado = 'Pendiente' where id = '00000000-0000-0000-0000-0000000005fa';
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000005c2', 'role', 'authenticated')::text, true);
set local role authenticated;
update facturas set estado = 'Facturado' where id = '00000000-0000-0000-0000-0000000005fa';
reset role;
insert into r select 5, 'facturarla otra vez no descuenta dos veces', '3 · 0 · cuadra', pg_temp.est();

-- 3) Nota de crédito: devuelve 1 ya despachado → Bodega lo verifica disponible
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000005c2', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.nc_registrar('00000000-0000-0000-0000-0000000005fa', 'T-NC-STK', current_date, 'prueba', 'https://ejemplo.com/nc.pdf',
    jsonb_build_array(jsonb_build_object('movimiento_id', (select id from movimientos_inventario where factura_id = '00000000-0000-0000-0000-0000000005fa' and tipo = 'SALIDA'),
      'tipo', 'CANTIDAD', 'cantidad', 1, 'base', 100, 'iva', 15)), true);
exception when others then insert into r values (6, 'nota de crédito sobre la salida de la factura', 'sin error', sqlerrm); end $$;
reset role;
insert into r select 6, 'NC despachada: no suma hasta que Bodega verifique', '3 · 0 · cuadra', pg_temp.est();
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000005c3', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.nc_registrar_recepcion((select id from movimientos_inventario where producto_id = '00000000-0000-0000-0000-0000000005f1' and bodega = 'Por verificar' and tipo = 'DEVOLUCION'), 1, 'DISPONIBLE', current_date, 'ok');
exception when others then insert into r values (7, 'Bodega verifica la devolución', 'sin error', sqlerrm); end $$;
reset role;
insert into r select 7, 'Bodega la verifica disponible: vuelve a la Comercial', '4 · 0 · cuadra', pg_temp.est();

-- 4) Traslado de 1 a la Bodega Técnica
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000005c3', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.mov_trasladar('00000000-0000-0000-0000-0000000005f1', 1, 'tecnica', 'prueba');
exception when others then insert into r values (8, 'traslado', 'sin error', sqlerrm); end $$;
reset role;
insert into r select 8, 'traslado de 1 a la Bodega Técnica', '3 · 1 · cuadra', pg_temp.est();

-- 5) Importación: llegan 3, Bodega aprueba 2 y 1 tiene defecto
insert into imp_expedientes (id, codigo, proveedor_texto, referencia, flujo)
values ('00000000-0000-0000-0000-0000000005e1', 'T-PI-STK', 'HEALICOM MEDICAL EQUIPMENT CO LTD', 'T-PI-STK', '{"etapa":"En aduana","enviado":{"fecha":"2026-11-01"}}'::jsonb);
insert into imp_items (id, codigo, pedido_codigo, expediente_id, cantidad, codigo_producto, modelo, descripcion)
values ('00000000-0000-0000-0000-0000000005e2', 'T-IT-STK', 'T-PI-STK', '00000000-0000-0000-0000-0000000005e1', 3, 'T-STK-1', 'MODELO-T', 'Equipo de prueba');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000005c3', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.rec_revisar('T-PI-STK', 'T-IT-STK', '{"opId":"T-OP-STK-000000001","recibidas":3,"aprobadas":2,"defectos":1,"defecto":"golpe en la carcasa","tipoDano":"Golpe","sinSerie":true,"fotos":["https://ejemplo.com/foto.jpg"]}'::jsonb);
exception when others then insert into r values (9, 'revisión de la importación', 'sin error', sqlerrm); end $$;
reset role;
insert into r select 9, 'importación: 2 a la Comercial y 1 con defecto a la Técnica', '5 · 2 · cuadra', pg_temp.est();

-- 6) Servicio Técnico usa 1 como repuesto
insert into st_ordenes (id, codigo, tipo, estado, modalidad, cobertura, cliente_texto, producto_texto, trabajo_realizado, repuestos)
values ('00000000-0000-0000-0000-0000000005d1', 'T-ST-STK', 'Mantenimiento correctivo', 'En proceso', 'Remoto', 'Garantía', 'Cliente de prueba', 'Equipo del cliente', 'Cambio de pieza',
  '[{"id":"T-STK-1","nombre":"Equipo de prueba del stock","cantidad":1}]'::jsonb);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000005c4', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.st_finalizar('00000000-0000-0000-0000-0000000005d1', '{"estadoFinal":"Operativo"}'::jsonb);
exception when others then insert into r values (10, 'Servicio Técnico finaliza con repuesto', 'sin error', sqlerrm); end $$;
reset role;
insert into r select 10, 'repuesto de Servicio Técnico: salida de 1', '4 · 2 · cuadra', pg_temp.est();
insert into r select 11, 'la salida del repuesto queda en negativo', '-1',
  (select min(cantidad)::int::text from movimientos_inventario where producto_id = '00000000-0000-0000-0000-0000000005f1' and operacion_codigo = 'T-ST-STK');

-- 7) Movimientos: se corrige la compra (5 → 6) y se recalcula
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000005c5', 'role', 'authenticated')::text, true);
set local role authenticated;
update movimientos_inventario set cantidad = 6 where producto_id = '00000000-0000-0000-0000-0000000005f1' and ingreso_id is not null;
select public.recalcular_stock_producto('00000000-0000-0000-0000-0000000005f1');
reset role;
insert into r select 12, 'editar un movimiento y recalcular', '5 · 2 · cuadra', pg_temp.est();

-- 8) Control del stock
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000005c5', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'control', public.mov_control_stock()::text;
reset role;
insert into r select 13, 'el control no marca el producto de prueba', '0',
  (select count(*)::text from jsonb_array_elements((select v::jsonb from x where k = 'control') -> 'descuadrados') d where d ->> 'codigo' = 'T-STK-1');
insert into r select 14, 'datos reales: facturas de la app sin su salida', '0',
  (select jsonb_array_length((select v::jsonb from x where k = 'control') -> 'facturas_sin_salida')::text);
insert into r select 15, 'datos reales: productos descuadrados', '0',
  (select jsonb_array_length((select v::jsonb from x where k = 'control') -> 'descuadrados')::text);

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
