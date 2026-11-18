select json_build_object(
'clientes', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.clientes)
,
'leads', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.leads)
,
'cotizaciones', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.cotizaciones)
,
'interacciones', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.interacciones)
,
'facturas', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.facturas)
,
'ingresos_proveedor', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.ingresos_proveedor)
,
'movimientos_inventario', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.movimientos_inventario)
,
'notas_credito', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.notas_credito)
,
'nota_credito_detalle', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.nota_credito_detalle)
,
'productos', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.productos)
,
'despachos', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.despachos)
,
'marketing_cambios', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.marketing_cambios)
,
'audiovisual', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.audiovisual)
,
'mensajes', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.mensajes)
,
'actividades', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.actividades)
,
'proyectos', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.proyectos)
,
'monedas_movimientos', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.monedas_movimientos)
,
'catalogos_generados', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.catalogos_generados)
,
'proveedores', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.proveedores)
,
'imp_items', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.imp_items)
,
'imp_codigos_reservados', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.imp_codigos_reservados)
,
'imp_ordenes_st', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.imp_ordenes_st)
,
'imp_recepciones', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.imp_recepciones)
,
'imp_expedientes', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.imp_expedientes)
,
'imp_unidades', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.imp_unidades)
,
'material_solicitudes', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.material_solicitudes)
,
'promo_campanas', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.promo_campanas)
,
'rutas', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.rutas)
,
'viaticos', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.viaticos)
,
'th_tipos_permiso', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.th_tipos_permiso)
,
'documentos_tecnicos', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.documentos_tecnicos)
,
'aliados', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.aliados)
,
'categorias', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.categorias)
,
'empleados', (select json_agg(json_build_object('c', codigo, 'b', deleted_at is not null)) from public.empleados)
) j;
