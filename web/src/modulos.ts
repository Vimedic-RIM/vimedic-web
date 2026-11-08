import {
  BookOpen, CalendarCheck, ChartNoAxesCombined, Contact, Database, Kanban, Landmark, Megaphone, Package,
  PackagePlus, ReceiptText, Ship, ShieldCheck, Tag, Truck, UsersRound, Users, Warehouse, Wrench,
  type LucideIcon,
} from 'lucide-react'

// Mismos módulos, textos, íconos y colores que Mi Espacio de la app de Apps Script.
// `permiso` es el nombre del módulo en roles.permisos (base de datos nueva).
// `listo` = ya migrado a la app nueva; los demás avisan que siguen en la app actual.
export type Modulo = { id: string; label: string; desc: string; icono: LucideIcon; permiso: string; c: string; listo: boolean }

export const MODULOS: Record<string, Modulo> = {
  crm: { id: 'crm', label: 'CRM Vimedic', desc: 'Pipeline, cotizaciones, ventas, seguimiento y mensajes.', icono: Kanban, permiso: 'crm', c: '#055c9d', listo: true },
  marketing: { id: 'marketing', label: 'Marketing', desc: 'Resultados, planificador, audiovisual y biblioteca.', icono: Megaphone, permiso: 'marketing', c: '#e1306c', listo: true },
  inventario: { id: 'inventario', label: 'Inventario', desc: 'Productos, stock, precios y fichas técnicas.', icono: Package, permiso: 'inventario', c: '#04896f', listo: true },
  agenda: { id: 'agenda', label: 'Mi Agenda', desc: 'Actividades, tareas y organización diaria.', icono: CalendarCheck, permiso: 'agenda', c: '#17a9ba', listo: false },
  facturacion: { id: 'facturacion', label: 'Facturación', desc: 'Facturas, actas, guías y notas de crédito.', icono: ReceiptText, permiso: 'facturacion', c: '#0e7490', listo: true },
  dashboard: { id: 'dashboard', label: 'Dashboard Ejecutivo', desc: 'Indicadores estratégicos y control de gestión.', icono: ChartNoAxesCombined, permiso: 'dashboard', c: '#0b2545', listo: false },
  movimientos: { id: 'movimientos', label: 'Movimientos', desc: 'Historial de ingresos y salidas de todos los productos.', icono: PackagePlus, permiso: 'movimientos', c: '#0e7490', listo: false },
  femedics: { id: 'femedics', label: 'Femedics CRM', desc: 'Leads, cotizaciones y ventas de Femedics (distribuidor VIMEDIC).', icono: Kanban, permiso: 'femedics', c: '#2570da', listo: false },
  empleados: { id: 'empleados', label: 'Empleados', desc: 'Directorio, permisos y organigrama.', icono: UsersRound, permiso: 'empleados', c: '#7c3aed', listo: true },
  bodega: { id: 'bodega', label: 'Bodega', desc: 'Despacho de ventas: series, evidencias y novedades.', icono: Warehouse, permiso: 'bodega', c: '#9a6a12', listo: false },
  logistica: { id: 'logistica', label: 'Logística', desc: 'Entregas, seguimiento del cliente y postventa.', icono: Truck, permiso: 'logistica', c: '#0f766e', listo: false },
  serviciotecnico: { id: 'serviciotecnico', label: 'Servicio Técnico', desc: 'Órdenes, mantenimientos, instalaciones e informes técnicos.', icono: Wrench, permiso: 'servicio_tecnico', c: '#b45309', listo: false },
  talentohumano: { id: 'talentohumano', label: 'Talento Humano', desc: 'Personal, solicitudes, permisos y capacitaciones.', icono: Contact, permiso: 'talento_humano', c: '#be185d', listo: false },
  importaciones: { id: 'importaciones', label: 'Importaciones', desc: 'Compras al exterior, embarque, aduana, costeo y recepción.', icono: Ship, permiso: 'importaciones', c: '#1d4ed8', listo: false },
  articulos: { id: 'articulos', label: 'Artículos a importar', desc: 'Reposición: stock, tránsito, ventas y cantidad sugerida a pedir.', icono: Package, permiso: 'importaciones', c: '#0e7490', listo: false },
  financiero: { id: 'financiero', label: 'Financiero', desc: 'Cobros, pagos, flujo de caja y reportes.', icono: Landmark, permiso: 'financiero', c: '#15803d', listo: false },
  // En la base nueva "adquisiciones" no es un módulo aparte: se controla con importaciones.
  adquisiciones: { id: 'adquisiciones', label: 'Adquisiciones', desc: 'Ingresos de mercadería: compras a proveedor que suben el stock.', icono: PackagePlus, permiso: 'importaciones', c: '#0e7490', listo: false },
  catalogos: { id: 'catalogos', label: 'Catálogos personalizados', desc: 'Catálogos PDF por segmento con tu WhatsApp de asesor.', icono: BookOpen, permiso: 'catalogos', c: '#1d2344', listo: false },
  ofertas: { id: 'ofertas', label: 'Ofertas y Liquidación', desc: 'Stock dormido y con observaciones: estrategias, ofertas y resultados.', icono: Tag, permiso: 'ofertas', c: '#c2410c', listo: false },
  clientes: { id: 'clientes', label: 'Clientes', desc: 'Ficha completa de cada cliente: datos, cotizaciones, facturas y productos.', icono: Users, permiso: 'clientes', c: '#0e7490', listo: false },
  seguridad: { id: 'seguridad', label: 'Seguridad y Auditoría', desc: 'Usuarios, roles, sesiones activas y bitácora de actividad.', icono: ShieldCheck, permiso: 'seguridad', c: '#334155', listo: false },
  // En la base nueva "bases de datos" cuelga del módulo seguridad.
  basedatos: { id: 'basedatos', label: 'Bases de Datos', desc: 'Tablas, registros, exportaciones, respaldos y restauración.', icono: Database, permiso: 'seguridad', c: '#0f172a', listo: false },
}

// Orden por defecto de Mi Espacio (igual que la app original).
export const ORDEN_MODULOS = [
  'crm', 'clientes', 'marketing', 'inventario', 'agenda', 'facturacion', 'dashboard', 'movimientos', 'femedics', 'bodega',
  'logistica', 'serviciotecnico', 'talentohumano', 'importaciones', 'articulos', 'adquisiciones', 'financiero', 'catalogos',
  'ofertas', 'empleados', 'seguridad', 'basedatos',
]
