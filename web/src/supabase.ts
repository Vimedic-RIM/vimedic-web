import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !key) {
  throw new Error('Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver .env.example)')
}

export const supabase = createClient(url, key)

export type Perfil = {
  id: string
  nombre: string
  email: string
  empresa: 'VIMEDIC' | 'FEMEDICS'
  cargo: string | null
  departamento: string | null
  foto_url: string | null
  rol: string | null
  es_superadmin: boolean
  permisos: Record<string, string[]>
}
