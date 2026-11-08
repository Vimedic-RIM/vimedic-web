import type { Perfil } from './supabase'

// Equivalente en el navegador a app.puede('modulo','accion'). La seguridad real la hace la RLS en la base;
// esto solo decide qué botones mostrar.
export function puede(perfil: Perfil, modulo: string, accion: string): boolean {
  return perfil.es_superadmin || !!perfil.permisos?.[modulo]?.includes(accion)
}
