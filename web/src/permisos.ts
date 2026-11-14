import type { Perfil } from './supabase'

// Equivalente en el navegador a app.puede('modulo','accion'). La seguridad real la hace la RLS en la base;
// esto solo decide qué botones mostrar.
export function puede(perfil: Perfil, modulo: string, accion: string): boolean {
  // Mi Perfil es de todo empleado; la bandeja de Solicitudes, de jefes, Talento Humano y administración.
  if (modulo === 'miperfil') return true
  if (modulo === 'solicitudes') return perfil.es_superadmin || !!perfil.es_jefe || !!perfil.permisos?.talento_humano?.includes('ver')
  return perfil.es_superadmin || !!perfil.permisos?.[modulo]?.includes(accion)
}
