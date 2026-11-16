import type { Perfil } from './supabase'

// Equivalente en el navegador a app.puede('modulo','accion'). La seguridad real la hace la RLS en la base;
// esto solo decide qué botones mostrar.
export function puede(perfil: Perfil, modulo: string, accion: string): boolean {
  // Mi Perfil es de todo empleado; la bandeja de Solicitudes, de jefes, Talento Humano y administración.
  if (modulo === 'miperfil') return true
  if (modulo === 'solicitudes') return perfil.es_superadmin || !!perfil.es_jefe || !!perfil.permisos?.talento_humano?.includes('ver')
  // El escáner de pedidos es para quien mueve alguna etapa del pedido (o supervisa todas las ventas).
  if (modulo === 'escanear') return perfil.es_superadmin || ['tracking', 'bodega', 'logistica', 'servicio_tecnico', 'facturacion'].some((m) => !!perfil.permisos?.[m]?.includes('ver'))
    || ['crm', 'femedics'].some((m) => !!perfil.permisos?.[m]?.includes('ver_todos'))
  // Trackings: el asesor del CRM ve el seguimiento de sus propias ventas (la base filtra cuáles); configurar tiempos sigue siendo solo de "tracking".
  if (modulo === 'tracking' && accion === 'ver' && ['crm', 'femedics'].some((m) => !!perfil.permisos?.[m]?.includes('ver'))) return true
  return perfil.es_superadmin || !!perfil.permisos?.[modulo]?.includes(accion)
}
