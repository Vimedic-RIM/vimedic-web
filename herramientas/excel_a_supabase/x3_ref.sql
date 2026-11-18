select json_build_object(
 'empleados', (select json_agg(json_build_object('id', id, 'nombre', nombre, 'email', email, 'codigo', codigo)) from empleados),
 'clientes', (select json_agg(json_build_object('id', id, 'codigo', codigo, 'ident', identificacion, 'empresa', empresa, 'b', deleted_at is not null, 'nombre', nombre)) from clientes),
 'cotizaciones', (select json_agg(json_build_object('id', id, 'codigo', codigo)) from cotizaciones),
 'leads', (select json_agg(json_build_object('id', id, 'codigo', codigo)) from leads),
 'facturas', (select json_agg(json_build_object('id', id, 'codigo', codigo)) from facturas),
 'productos', (select json_agg(json_build_object('id', id, 'codigo', codigo)) from productos),
 'ingresos', (select json_agg(json_build_object('id', id, 'codigo', codigo)) from ingresos_proveedor),
 'notas', (select json_agg(json_build_object('id', id, 'codigo', codigo)) from notas_credito),
 'movs', (select json_agg(json_build_object('id', id, 'codigo', codigo)) from movimientos_inventario),
 'tipos', (select json_object_agg(table_name || '.' || column_name, data_type) from information_schema.columns where table_schema = 'public')
) j;
