-- =====================================================================
-- Documentos técnicos (manuales, hojas de datos, certificados, registros sanitarios): solo los ve quien tiene la
-- autorización «Documentos técnicos» en Empleados (documentos_tecnicos › ver), además de Servicio Técnico y
-- Marketing, que los usan en su trabajo. Antes los podía leer cualquier módulo que consulta productos.
-- En Inventario se muestran en la ficha del producto a quien tiene esa autorización.
-- =====================================================================
select app.aplicar_rls('public.documentos_tecnicos',
  array['documentos_tecnicos', 'servicio_tecnico', 'marketing'],
  array['documentos_tecnicos', 'servicio_tecnico', 'marketing']);
