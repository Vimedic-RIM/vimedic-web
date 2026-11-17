import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { ErrorPantalla } from './ErrorPantalla'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Perfil } from './supabase'
import { puede } from './permisos'
import Login from './Login'
import MfaChallenge from './MfaChallenge'
import MiEspacio from './MiEspacio'
import Rail from './Rail'
import { cargarPlantillas } from './plantillas'
import { MODULOS } from './modulos'
// Inventario también se descarga al abrirlo; su hoja de estilos se queda aquí porque otras pantallas usan sus clases.
import './estilos/inventario-original.css'
const Inventario = lazy(() => import('./modulos/Inventario'))
// CRM, Empleados y Facturación se descargan solo cuando se abren (la entrada a la app es más rápida).
const Crm = lazy(() => import('./modulos/Crm'))
const Empleados = lazy(() => import('./modulos/Empleados'))
const Facturacion = lazy(() => import('./modulos/Facturacion'))
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
const Adquisiciones = lazy(() => import('./modulos/Adquisiciones'))
const SolicitudesPersonal = lazy(() => import('./modulos/SolicitudesPersonal'))
const Tracking = lazy(() => import('./modulos/Tracking'))
const Escanear = lazy(() => import('./modulos/Escanear'))
const Plantillas = lazy(() => import('./modulos/Plantillas'))
// Enlaces directos a un registro: #bodega/<id>, #logistica/<id>, #tracking/<id>, #escanear/<código>…
const leerHash = () => { const h = window.location.hash.slice(1), i = h.indexOf('/'); return i < 0 ? { v: h, id: '' } : { v: h.slice(0, i), id: decodeURIComponent(h.slice(i + 1)) } }
// Los estilos de estos módulos se aplican a toda la app (Tailwind precompilado sin alcance): se cargan desde el inicio
// como antes, aunque su código ahora se descargue solo al abrir el módulo.
import './estilos/crm-original.css'
import './estilos/empleados.css'
import './estilos/facturacion.css'
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
  const [hashInicial] = useState(leerHash)
  const [vistaHash, setVista] = useState(hashInicial.v)
  // Registro a abrir al llegar al módulo (lo consume el módulo y lo limpia, así el mismo enlace se puede volver a abrir).
  const [abrirReg, setAbrirReg] = useState<{ v: string; id: string } | null>(hashInicial.id ? hashInicial : null)
  const [aviso, setAviso] = useState('')
  // Acciones rápidas de la barra lateral: a qué módulo llevan y qué abren ahí al llegar.
  const [accionPendiente, setAccionPendiente] = useState<string | null>(null)
  // "Ver movimientos" desde la ficha de un producto en Inventario: a qué código de producto filtrar al llegar a Movimientos.
  const [filtroMovProducto, setFiltroMovProducto] = useState<string | null>(null)
  const temporizador = useRef<number | undefined>(undefined)
  const avisar = (t: string) => {
    setAviso(t)
    window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => setAviso(''), 2600)
  }

  useEffect(() => {
    // La vista por defecto es Inventario: su código se empieza a descargar mientras se valida la sesión.
    if (!hashInicial.v || hashInicial.v === 'inventario') import('./modulos/Inventario').catch(() => undefined)
    if (hashInicial.id) window.history.replaceState(null, '', '#' + hashInicial.v)
    const f = () => {
      const { v, id } = leerHash()
      if (id) { setAbrirReg({ v, id }); window.history.replaceState(null, '', '#' + v) }
      setVista(v)
    }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [hashInicial])

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
  // Plantillas de documentos (logo, colores, pie y diseño de cada documento): se cargan al entrar.
  useEffect(() => { if (perfil) cargarPlantillas() }, [perfil])

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
  const irAMovimientosDe = (codigo: string) => { setFiltroMovProducto(codigo); abrir('movimientos') }
  const reg = (v: string) => (abrirReg?.v === v ? abrirReg.id : '')
  const limpiarReg = () => setAbrirReg(null)
  // A qué módulo lleva cada acceso directo de la barra lateral.
  const DESTINO_ACCION: Record<string, string> = {
    gestion: 'crm', cotizacion: 'crm', venta: 'crm', cliente: 'crm', seguimientos: 'crm', mensajes: 'crm',
    actividad: 'agenda', ingreso: 'importaciones', publicacion: 'marketing', audiovisual: 'marketing',
  }
  const ejecutarAccion = (clave: string) => {
    if (clave === 'escanear') { abrir('escanear'); return }
    const destino = DESTINO_ACCION[clave]
    if (!destino) { avisar('Esta acción todavía se está migrando.'); return }
    setAccionPendiente(clave)
    abrir(destino)
  }

  // Dentro de un módulo se muestra la barra lateral de acceso rápido (igual que la app original).
  if ((vista === 'inventario' && puede(perfil, 'inventario', 'ver')) || (vista === 'crm' && puede(perfil, 'crm', 'ver')) || (vista === 'empleados' && puede(perfil, 'empleados', 'ver')) || (vista === 'facturacion' && puede(perfil, 'facturacion', 'ver')) || (vista === 'marketing' && puede(perfil, 'marketing', 'ver')) || (vista === 'importaciones' && puede(perfil, 'importaciones', 'ver')) || (vista === 'catalogos' && puede(perfil, 'catalogos', 'ver')) || (vista === 'femedics' && puede(perfil, 'femedics', 'ver')) || (vista === 'dashboard' && puede(perfil, 'dashboard', 'ver')) || (vista === 'clientes' && puede(perfil, 'clientes', 'ver')) || (vista === 'movimientos' && puede(perfil, 'movimientos', 'ver')) || (vista === 'talentohumano' && puede(perfil, 'talento_humano', 'ver')) || (vista === 'financiero' && puede(perfil, 'financiero', 'ver')) || (vista === 'bodega' && puede(perfil, 'bodega', 'ver')) || (vista === 'serviciotecnico' && puede(perfil, 'servicio_tecnico', 'ver')) || (vista === 'ofertas' && puede(perfil, 'ofertas', 'ver')) || (vista === 'logistica' && puede(perfil, 'logistica', 'ver')) || (vista === 'articulos' && puede(perfil, 'importaciones', 'ver')) || (vista === 'agenda' && puede(perfil, 'agenda', 'ver')) || (vista === 'seguridad' && puede(perfil, 'seguridad', 'ver')) || (vista === 'basedatos' && puede(perfil, 'basedatos', 'ver')) || (vista === 'adquisiciones' && puede(perfil, 'importaciones', 'ver')) || vista === 'miperfil' || (vista === 'solicitudes' && puede(perfil, 'solicitudes', 'ver')) || (vista === 'tracking' && puede(perfil, 'tracking', 'ver')) || (vista === 'escanear' && puede(perfil, 'escanear', 'ver')) || (vista === 'plantillas' && puede(perfil, 'plantillas', 'ver'))) {
    return (
      <>
        <Rail perfil={perfil} actual={vista} aviso={avisar}
          ir={(id) => {
            if (id === 'espacio') volver()
            else if (MODULOS[id.split('/')[0]]?.listo) abrir(id)
            else avisar(`${MODULOS[id]?.label ?? 'Este módulo'} todavía se está migrando. Sigue disponible en la app actual.`)
          }}
          accion={ejecutarAccion} />
        <div className="vm-modulo"><ErrorPantalla key={vista} donde="este módulo"><Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando…</div>}>{vista === 'crm' ? <Crm perfil={perfil} aviso={avisar} accion={accionPendiente} limpiarAccion={() => setAccionPendiente(null)} /> : vista === 'empleados' ? <Empleados perfil={perfil} aviso={avisar} /> : vista === 'facturacion' ? <Facturacion perfil={perfil} aviso={avisar} /> : vista === 'basedatos' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Bases de Datos…</div>}><BaseDatos perfil={perfil} aviso={avisar} /></Suspense> : vista === 'seguridad' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Seguridad…</div>}><Seguridad perfil={perfil} aviso={avisar} /></Suspense> : vista === 'agenda' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Agenda…</div>}><Agenda perfil={perfil} aviso={avisar} accion={accionPendiente} limpiarAccion={() => setAccionPendiente(null)} /></Suspense> : vista === 'articulos' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Artículos…</div>}><Articulos perfil={perfil} aviso={avisar} /></Suspense> : vista === 'logistica' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Logística…</div>}><Logistica perfil={perfil} aviso={avisar} abrir={reg('logistica')} limpiarAbrir={limpiarReg} /></Suspense> : vista === 'ofertas' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Ofertas…</div>}><Ofertas perfil={perfil} aviso={avisar} /></Suspense> : vista === 'serviciotecnico' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Servicio Técnico…</div>}><ServicioTecnico perfil={perfil} aviso={avisar} abrir={reg('serviciotecnico')} limpiarAbrir={limpiarReg} /></Suspense> : vista === 'bodega' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Bodega…</div>}><Bodega perfil={perfil} aviso={avisar} abrir={reg('bodega')} limpiarAbrir={limpiarReg} /></Suspense> : (vista === 'talentohumano' || vista === 'financiero') ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando…</div>}><Tablero key={vista} perfil={perfil} aviso={avisar} modulo={MODULOS[vista].permiso} titulo={MODULOS[vista].label} desc={MODULOS[vista].desc} color={MODULOS[vista].c} icono={MODULOS[vista].icono} /></Suspense> : vista === 'movimientos' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Movimientos…</div>}><Movimientos perfil={perfil} aviso={avisar} productoInicial={filtroMovProducto} limpiarProductoInicial={() => setFiltroMovProducto(null)} /></Suspense> : vista === 'clientes' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Clientes…</div>}><Clientes perfil={perfil} aviso={avisar} /></Suspense> : vista === 'dashboard' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Dashboard…</div>}><Dashboard perfil={perfil} aviso={avisar} /></Suspense> : vista === 'femedics' ? <Crm perfil={perfil} aviso={avisar} empresa="FEMEDICS" /> : vista === 'catalogos' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Catálogos…</div>}><Catalogos perfil={perfil} aviso={avisar} /></Suspense> : vista === 'importaciones' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Importaciones…</div>}><Importaciones perfil={perfil} aviso={avisar} accion={accionPendiente} limpiarAccion={() => setAccionPendiente(null)} /></Suspense> : vista === 'marketing' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Marketing…</div>}><Marketing perfil={perfil} aviso={avisar} accion={accionPendiente} limpiarAccion={() => setAccionPendiente(null)} /></Suspense> : (vista === 'miperfil' || vista === 'solicitudes') ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando…</div>}><SolicitudesPersonal key={vista} perfil={perfil} aviso={avisar} modo={vista} /></Suspense> : vista === 'tracking' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Trackings…</div>}><Tracking perfil={perfil} aviso={avisar} abrir={reg('tracking')} limpiarAbrir={limpiarReg} /></Suspense> : vista === 'escanear' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Abriendo el escáner…</div>}><Escanear perfil={perfil} aviso={avisar} codigo={reg('escanear')} limpiarCodigo={limpiarReg} /></Suspense> : vista === 'plantillas' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Plantillas…</div>}><Plantillas perfil={perfil} aviso={avisar} /></Suspense> : vista === 'adquisiciones' ? <Suspense fallback={<div className="p-10 text-center text-xs text-slate-400">Cargando Adquisiciones…</div>}><Adquisiciones perfil={perfil} aviso={avisar} /></Suspense> : <Inventario perfil={perfil} volver={volver} irAMovimientos={irAMovimientosDe} />}</Suspense></ErrorPantalla></div>
        <div id="toast" role="status" className={aviso ? 'show' : ''}>{aviso}</div>
      </>
    )
  }
  return <MiEspacio perfil={perfil} abrir={abrir} />
}
