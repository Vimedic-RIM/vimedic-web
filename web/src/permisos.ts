import type { Perfil } from './supabase'

// Equivalente en el navegador a app.puede('modulo','accion'). La seguridad real la hace la RLS en la base;
// esto solo decide qué botones mostrar.
/** Bodega Técnica y stock total: Movimientos, Servicio Técnico, Bodega, Importaciones, quien edita Inventario y la administración
 *  (igual que app.ve_bodega_tecnica en la base). Los asesores ven solo el stock comercial. */
export function veBodegaTecnica(perfil: Perfil): boolean {
  return perfil.es_superadmin || ['movimientos', 'servicio_tecnico', 'bodega', 'importaciones'].some((m) => !!perfil.permisos?.[m]?.includes('ver')) || !!perfil.permisos?.inventario?.includes('editar')
}

export function puede(perfil: Perfil, modulo: string, accion: string): boolean {
  // Mi Perfil es de todo empleado; la bandeja de Solicitudes, de jefes, Talento Humano y administración.
  if (modulo === 'miperfil') return true
  if (modulo === 'solicitudes') return perfil.es_superadmin || !!perfil.es_jefe || !!perfil.permisos?.talento_humano?.includes('ver')
  // El escáner de pedidos es para quien mueve alguna etapa del pedido (o supervisa todas las ventas).
  if (modulo === 'escanear') return perfil.es_superadmin || ['tracking', 'bodega', 'logistica', 'servicio_tecnico', 'facturacion'].some((m) => !!perfil.permisos?.[m]?.includes('ver'))
    || ['crm', 'femedics'].some((m) => !!perfil.permisos?.[m]?.includes('ver_todos'))
  // Trackings: el asesor del CRM ve el seguimiento de sus propias ventas (la base filtra cuáles); configurar tiempos sigue siendo solo de "tracking".
  // El Dashboard Ejecutivo también abre los pedidos desde su mapa de proceso.
  if (modulo === 'tracking' && accion === 'ver' && ['crm', 'femedics', 'dashboard'].some((m) => !!perfil.permisos?.[m]?.includes('ver'))) return true
  return perfil.es_superadmin || !!perfil.permisos?.[modulo]?.includes(accion)
}
