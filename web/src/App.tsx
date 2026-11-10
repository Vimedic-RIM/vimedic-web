import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Perfil } from './supabase'
import { puede } from './permisos'
import Login from './Login'
import MfaChallenge from './MfaChallenge'
import MiEspacio from './MiEspacio'
import Rail from './Rail'
import { MODULOS } from './modulos'
import Inventario from './modulos/Inventario'
import Crm from './modulos/Crm'
import Empleados from './modulos/Empleados'
import Facturacion from './modulos/Facturacion'
const Marketing = lazy(() => import('./modulos/Marketing'))
const Importaciones = lazy(() => import('./modulos/Importaciones'))
const Catalogos = lazy(() => import('./modulos/Catalogos'))
const Dashboard = lazy(() => import('./modulos/Dashboard'))
const Clientes = lazy(() => import('./modulos/Clientes'))
const Movimientos = lazy(() => import('./modulos/Movimientos'))
const Tablero = lazy(() => import('./modulos/Tablero'))
const Bodega = lazy(() => import('./modulos/Bodega'))
const Seguridad = lazy(() => import('./modulos/Seguridad'))
const BaseDatos = lazy(() => import('./modulos/BaseDatos'))
const ServicioTecnico = lazy(() => import('./modulos/ServicioTecnico'))
const Ofertas = lazy(() => import('./modulos/Ofertas'))
const Logistica = lazy(() => import('./modulos/Logistica'))
const Articulos = lazy(() => import('./modulos/Articulos'))
const Agenda = lazy(() => import('./modulos/Agenda'))
import './estilos/miespacio.css'
import './estilos/responsive.css'

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
  // Verificación en dos pasos: null = comprobando, true = falta el código (aal1→aal2), false = ya está al día.
  const [faltaMfa, setFaltaMfa] = useState<boolean | null>(null)
  const [vistaHash, setVista] = useState(window.location.hash.slice(1))
  const [aviso, setAviso] = useState('')
  const temporizador = useRef<number | undefined>(undefined)
  const avisar = (t: string) => {
    setAviso(t)
    window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => setAviso(''), 2600)
  }

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
    if (!session) { setPerfil(session === null ? null : undefined); setFaltaMfa(null); return }
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => setFaltaMfa(!!data && data.nextLevel === 'aal2' && data.currentLevel !== data.nextLevel))
  }, [session])

  useEffect(() => {
    if (!session || faltaMfa) { if (faltaMfa) setPerfil(undefined); return }
    supabase.rpc('mi_perfil').then(({ data }) => setPerfil((data as Perfil | null) ?? null))
  }, [session, faltaMfa])

  if (session === undefined) return <Cargando texto="Cargando…" />
  if (!session) return <Login />
  if (faltaMfa === null) return <Cargando texto="Cargando…" />
  if (faltaMfa) return <MfaChallenge onOk={() => setFaltaMfa(false)} />
  if (perfil === undefined) return <Cargando texto="Cargando tu perfil…" />
  if (!perfil) return <SinAcceso />

  // Sin módulo elegido se entra directo a Inventario (todos tienen acceso); Mi Espacio queda solo como respaldo sin permiso.
  const vista = vistaHash || (puede(perfil, 'inventario', 'ver') ? 'inventario' : '')
  const abrir = (id: string) => { window.location.hash = id }
  const volver = () => { window.location.hash = '' }

  // Dentro de un módulo se muestra la barra lateral de acceso rápido (igual que la app original).
  if ((vista === 'inventario' && puede(perfil, 'inventario', 'ver')) || (vista === 'crm' && puede(perfil, 'crm', 'ver')) || (vista === 'empleados' && puede(perfil, 'empleados', 'ver')) || (vista === 'facturacion' && puede(perfil, 'facturacion', 'ver')) || (vista === 'marketing' && puede(perfil, 'marketing', 'ver')) || (vista === 'importaciones' && puede(perfil, 'importaciones', 'ver')) || (vista === 'catalogos' && puede(perfil, 'catalogos', 'ver')) || (vista === 'femedics' && puede(perfil, 'femedics', 'ver')) || (vista === 'dashboard' && puede(perfil, 'dashboard', 'ver')) || (vista === 'clientes' && puede(perfil, 'clientes', 'ver')) || (vista === 'movimientos' && puede(perfil, 'movimientos', 'ver')) || (vista === 'talentohumano' && puede(perfil, 'talento_humano', 'ver')) || (vista === 'financiero' && puede(perfil, 'financiero', 'ver')) || (vista === 'bodega' && puede(perfil, 'bodega', 'ver')) || (vista === 'serviciotecnico' && puede(perfil, 'servicio_tecnico', 'ver')) || (vista === 'ofertas' && puede(perfil, 'ofertas', 'ver')) || (vista === 'logistica' && puede(perfil, 'logistica', 'ver')) || (vista === 'articulos' && puede(perfil, 'importaciones', 'ver')) || (vista === 'agenda' && puede(perfil, 'agenda', 'ver')) || (vista === 'seguridad' && puede(perfil, 'seguridad', 'ver')) || (vista === 'basedatos' && puede(perfil, 'basedatos', 'ver'))) {
    return (
      <>
        <Rail perfil={perfil} actual={vista} aviso={avisar}
          ir={(id) => {
            if (id === 'espacio') volver()
            else if (MODULOS[id]?.listo) abrir(id)
            else avisar(`${MODULOS[id]?.label ?? 'Este módulo'} todavía se está migrando. Sigue disponible en la app actual.`)
          }}
          accion={() => avisar('Esta acción depende del CRM, que todavía se está migrando.')} />
        <div className="vm-modulo">{vista === 'crm' ? <Crm perfil={perfil} aviso={avisar} /> : vista === 'empleados' ? <Empleados perfil={perfil} aviso={avisar} /> : vista === 'facturacion' ? <Facturacion perfil={perfil} aviso={avisar} /> : vista === 'basedatos' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Bases de Datos…</div>}><BaseDatos perfil={perfil} aviso={avisar} /></Suspense> : vista === 'seguridad' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Seguridad…</div>}><Seguridad perfil={perfil} aviso={avisar} /></Suspense> : vista === 'agenda' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Agenda…</div>}><Agenda perfil={perfil} aviso={avisar} /></Suspense> : vista === 'articulos' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Artículos…</div>}><Articulos perfil={perfil} aviso={avisar} /></Suspense> : vista === 'logistica' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Logística…</div>}><Logistica perfil={perfil} aviso={avisar} /></Suspense> : vista === 'ofertas' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Ofertas…</div>}><Ofertas perfil={perfil} aviso={avisar} /></Suspense> : vista === 'serviciotecnico' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Servicio Técnico…</div>}><ServicioTecnico perfil={perfil} aviso={avisar} /></Suspense> : vista === 'bodega' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Bodega…</div>}><Bodega perfil={perfil} aviso={avisar} /></Suspense> : (vista === 'talentohumano' || vista === 'financiero') ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando…</div>}><Tablero key={vista} perfil={perfil} aviso={avisar} modulo={MODULOS[vista].permiso} titulo={MODULOS[vista].label} desc={MODULOS[vista].desc} color={MODULOS[vista].c} icono={MODULOS[vista].icono} /></Suspense> : vista === 'movimientos' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Movimientos…</div>}><Movimientos perfil={perfil} aviso={avisar} /></Suspense> : vista === 'clientes' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Clientes…</div>}><Clientes perfil={perfil} aviso={avisar} /></Suspense> : vista === 'dashboard' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Dashboard…</div>}><Dashboard perfil={perfil} aviso={avisar} /></Suspense> : vista === 'femedics' ? <Crm perfil={perfil} aviso={avisar} empresa="FEMEDICS" /> : vista === 'catalogos' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Catálogos…</div>}><Catalogos perfil={perfil} aviso={avisar} /></Suspense> : vista === 'importaciones' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Importaciones…</div>}><Importaciones perfil={perfil} aviso={avisar} /></Suspense> : vista === 'marketing' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Marketing…</div>}><Marketing perfil={perfil} aviso={avisar} /></Suspense> : <Inventario perfil={perfil} volver={volver} />}</div>
        <div id="toast" role="status" className={aviso ? 'show' : ''}>{aviso}</div>
      </>
    )
  }
  return <MiEspacio perfil={perfil} abrir={abrir} />
}
