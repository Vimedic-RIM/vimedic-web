// Módulos del sistema (mismos nombres que usa la base de datos en roles.permisos).
// `listo` = ya migrado a la app nueva. Los demás siguen en la app de Apps Script.
export type Modulo = { clave: string; titulo: string; desc: string; color: string; listo: boolean }

export const MODULOS: Modulo[] = [
  { clave: 'dashboard', titulo: 'Dashboard', desc: 'Resumen ejecutivo de la empresa.', color: '#055c9d', listo: false },
  { clave: 'crm', titulo: 'CRM', desc: 'Leads, cotizaciones y embudo comercial.', color: '#04896f', listo: false },
  { clave: 'clientes', titulo: 'Clientes', desc: 'Base de clientes y su historial.', color: '#17a9ba', listo: false },
  { clave: 'femedics', titulo: 'Femedics', desc: 'CRM del distribuidor autorizado.', color: '#e1306c', listo: false },
  { clave: 'inventario', titulo: 'Inventario', desc: 'Productos, stock y catálogo.', color: '#c98a1f', listo: true },
  { clave: 'movimientos', titulo: 'Movimientos', desc: 'Kardex de entradas y salidas.', color: '#055c9d', listo: false },
  { clave: 'facturacion', titulo: 'Facturación', desc: 'Facturas y notas de crédito.', color: '#04896f', listo: false },
  { clave: 'agenda', titulo: 'Agenda', desc: 'Citas, visitas y tareas.', color: '#17a9ba', listo: false },
  { clave: 'marketing', titulo: 'Marketing', desc: 'Campañas, contenido y promociones.', color: '#7c3aed', listo: false },
  { clave: 'catalogos', titulo: 'Catálogos', desc: 'Catálogos personalizados.', color: '#c98a1f', listo: false },
  { clave: 'ofertas', titulo: 'Ofertas', desc: 'Ofertas comerciales.', color: '#e1306c', listo: false },
  { clave: 'promociones', titulo: 'Promociones', desc: 'Campañas con aprobación y margen.', color: '#7c3aed', listo: false },
  { clave: 'documentos_tecnicos', titulo: 'Documentos técnicos', desc: 'Fichas y certificados por equipo.', color: '#055c9d', listo: false },
  { clave: 'bodega', titulo: 'Bodega', desc: 'Recepción y despacho de bodega.', color: '#c98a1f', listo: false },
  { clave: 'logistica', titulo: 'Logística', desc: 'Rutas, despachos y viáticos.', color: '#04896f', listo: false },
  { clave: 'importaciones', titulo: 'Importaciones', desc: 'Pedidos y recepción de importaciones.', color: '#17a9ba', listo: false },
  { clave: 'servicio_tecnico', titulo: 'Servicio técnico', desc: 'Órdenes de servicio y firma.', color: '#c0392b', listo: false },
  { clave: 'talento_humano', titulo: 'Talento humano', desc: 'Solicitudes, permisos y vacaciones.', color: '#e1306c', listo: false },
  { clave: 'empleados', titulo: 'Empleados', desc: 'Directorio y accesos.', color: '#055c9d', listo: false },
  { clave: 'financiero', titulo: 'Financiero', desc: 'Indicadores financieros.', color: '#04896f', listo: false },
  { clave: 'seguridad', titulo: 'Seguridad', desc: 'Bitácora, accesos y auditoría.', color: '#0b2545', listo: false },
]
