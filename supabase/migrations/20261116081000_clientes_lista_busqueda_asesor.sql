-- La lista del módulo Clientes también busca por el nombre del asesor (como antes): se suma al texto de búsqueda de la vista.
create or replace view public.v_clientes_lista with (security_invoker = true) as
 SELECT c.id, c.empresa, c.identificacion, c.nombre, c.institucion, c.ciudad, c.telefono, c.email, c.asesor_id, d.nombre AS asesor,
    COALESCE(c.fecha_registro, c.created_at) AS registro, r.total_cotizaciones, r.total_ventas, r.monto_ventas, r.ultima_cotizacion, r.ultima_venta,
    GREATEST(r.ultima_venta::timestamp with time zone, r.ultima_cotizacion) AS ultima_actividad,
    (c.busqueda || ' ' || public.sin_tildes(d.nombre)) AS busqueda
   FROM clientes c
   LEFT JOIN v_clientes_resumen r ON r.id = c.id
   LEFT JOIN v_directorio_empleados d ON d.id = c.asesor_id
  WHERE c.deleted_at IS NULL;
