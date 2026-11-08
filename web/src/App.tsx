import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Perfil } from './supabase'
import { puede } from './permisos'
import Login from './Login'
import MiEspacio from './MiEspacio'
import Inventario from './modulos/Inventario'
import './estilos/miespacio.css'

// Pantalla "sin acceso": usa las mismas clases (.login-page / .login-card) que Mi Espacio original.
function SinAcceso() {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-icon">✳</div>
        <h1>Sin acceso</h1>
        <p>Tu cuenta no está vinculada a un empleado activo. Contacta al administrador.</p>
        <button type="button" className="login-btn" onClick={() => supabase.auth.signOut()}>Salir</button>
      </div>
    </div>
  )
}

function Cargando({ texto }: { texto: string }) {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#64748b', fontSize: 13 }}>{texto}</div>
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [perfil, setPerfil] = useState<Perfil | null | undefined>(undefined)
  const [vista, setVista] = useState(window.location.hash.slice(1))

  useEffect(() => {
    const f = () => setVista(window.location.hash.slice(1))
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setPerfil(session === null ? null : undefined); return }
    supabase.rpc('mi_perfil').then(({ data }) => setPerfil((data as Perfil | null) ?? null))
  }, [session])

  if (session === undefined) return <Cargando texto="Cargando…" />
  if (!session) return <Login />
  if (perfil === undefined) return <Cargando texto="Cargando tu perfil…" />
  if (!perfil) return <SinAcceso />

  const abrir = (id: string) => { window.location.hash = id }
  const volver = () => { window.location.hash = '' }
  if (vista === 'inventario' && puede(perfil, 'inventario', 'ver')) return <Inventario perfil={perfil} volver={volver} />
  return <MiEspacio perfil={perfil} abrir={abrir} />
}
