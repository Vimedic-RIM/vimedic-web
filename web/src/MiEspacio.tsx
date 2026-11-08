import { useEffect, useRef, useState } from 'react'
import { ChevronRight, LayoutDashboard, LogOut, Moon, ShieldCheck, SlidersHorizontal, Sun, X } from 'lucide-react'
import { supabase, type Perfil } from './supabase'
import { puede } from './permisos'
import { MODULOS, ORDEN_MODULOS } from './modulos'
import './estilos/miespacio.css'

// Preferencias de orden y visibilidad: misma clave y forma que la app original.
const PREF_KEY = 'vimedic_miespacio_v4'
type Prefs = { moduleOrder: string[]; moduleVisible: Record<string, boolean> }

function cargarPrefs(): Prefs {
  const base: Prefs = { moduleOrder: [...ORDEN_MODULOS], moduleVisible: {} }
  try {
    const guardado = JSON.parse(localStorage.getItem(PREF_KEY) || 'null')
    if (guardado) {
      if (Array.isArray(guardado.moduleOrder)) {
        base.moduleOrder = guardado.moduleOrder.filter((id: string) => ORDEN_MODULOS.includes(id))
          .concat(ORDEN_MODULOS.filter((id) => !guardado.moduleOrder.includes(id)))
      }
      base.moduleVisible = { ...(guardado.moduleVisible || {}) }
    }
  } catch { /* sin almacenamiento */ }
  return base
}

function guardarPrefs(p: Prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)) } catch { /* sin almacenamiento */ }
}

function nombreCorto(perfil: Perfil): string {
  let nombre = String(perfil.nombre || perfil.email || '').trim()
  if (!nombre) return 'equipo VIMEDIC'
  if (nombre.includes('@')) nombre = nombre.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return nombre.split(' ')[0]
}

export default function MiEspacio({ perfil, abrir }: { perfil: Perfil; abrir: (id: string) => void }) {
  const [prefs, setPrefs] = useState<Prefs>(cargarPrefs)
  const [personalizar, setPersonalizar] = useState(false)
  const [aviso, setAviso] = useState('')
  const arrastrado = useRef<string | null>(null)
  const temporizador = useRef<number | undefined>(undefined)

  const h = new Date().getHours()
  const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
  const dia = h >= 6 && h < 19
  const fecha = new Date().toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' })
  const fechaTexto = fecha.charAt(0).toUpperCase() + fecha.slice(1)
  const iniciales = String(perfil.nombre || perfil.email || 'V').trim().split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase() || 'V'

  // Solo los módulos a los que el empleado tiene acceso.
  const permitidos = prefs.moduleOrder.filter((id) => MODULOS[id] && puede(perfil, MODULOS[id].permiso, 'ver'))
  const visibles = permitidos.filter((id) => prefs.moduleVisible[id] !== false)

  function cambiar(p: Prefs) { setPrefs(p); guardarPrefs(p) }

  function mostrarAviso(t: string) {
    setAviso(t)
    window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => setAviso(''), 2600)
  }

  function abrirModulo(id: string) {
    const m = MODULOS[id]
    if (m.listo) abrir(id)
    else mostrarAviso(`${m.label} todavía se está migrando. Sigue disponible en la app actual.`)
  }

  function sobre(e: React.DragEvent<HTMLButtonElement>, objetivo: string) {
    const origen = arrastrado.current
    if (!origen || origen === objetivo) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const despues = e.clientY > r.top + r.height / 2 || (e.clientX > r.left + r.width / 2 && Math.abs(e.clientY - (r.top + r.height / 2)) < r.height / 2)
    const orden = prefs.moduleOrder.filter((id) => id !== origen)
    const i = orden.indexOf(objetivo)
    orden.splice(despues ? i + 1 : i, 0, origen)
    setPrefs({ ...prefs, moduleOrder: orden })
  }

  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') setPersonalizar(false) }
    document.addEventListener('keydown', f)
    return () => document.removeEventListener('keydown', f)
  }, [])

  return (
    <>
      <div id="app">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="bar">
              <div className="brand">
                <div className="brand-icon"><LayoutDashboard className="ic ic-lg" /></div>
                <div><div className="brand-title">Mi Espacio</div><div className="brand-sub">VIMEDIC · Gestión interna</div></div>
              </div>
              <div className="bar-right">
                <div className="user-chip">
                  <div className="user-avatar">{iniciales}</div>
                  <div className="user-data"><div className="user-name">{perfil.nombre || perfil.email || 'Usuario VIMEDIC'}</div><div className="user-role">{perfil.rol || 'Equipo interno'}</div></div>
                </div>
                <button type="button" className="hbtn" onClick={() => setPersonalizar(true)} title="Personalizar Mi Espacio"><SlidersHorizontal className="ic ic-sm" /><span>Personalizar</span></button>
                <button type="button" className="hbtn" onClick={() => supabase.auth.signOut()} title="Cerrar sesión"><LogOut className="ic ic-sm" /><span>Salir</span></button>
              </div>
            </div>
            <div className="hello">
              <div>
                <h1>{saludo}, {nombreCorto(perfil)}</h1>
                <p>Tus módulos en un solo lugar. Los que más usas se preparan en segundo plano.</p>
              </div>
              <div className="hello-date">{dia ? <Sun className="ic ic-sm" /> : <Moon className="ic ic-sm" />}<span>{fechaTexto}</span></div>
            </div>
          </div>
        </header>

        <main id="homeView">
          <section className="panel">
            <div className="sec-head"><LayoutDashboard className="ic" style={{ color: 'var(--primary)' }} /><h2>Módulos</h2><span>Arrastra para ordenar</span></div>
            <div id="modulesGrid">
              {visibles.length === 0
                ? <p style={{ fontSize: 12, color: '#94a3b8' }}>{permitidos.length === 0 ? 'Todavía no tienes módulos asignados. Pide acceso a tu administrador.' : 'No hay módulos visibles. Actívalos en Personalizar.'}</p>
                : visibles.map((id) => {
                  const m = MODULOS[id]
                  const Icono = m.icono
                  return (
                    <button key={id} type="button" className="module-card" draggable style={{ ['--c' as string]: m.c }}
                      onClick={() => abrirModulo(id)}
                      onDragStart={(e) => { arrastrado.current = id; e.currentTarget.classList.add('dragging'); try { e.dataTransfer.setData('text/plain', 'x') } catch { /* navegador sin dataTransfer */ } }}
                      onDragOver={(e) => sobre(e, id)}
                      onDragEnd={(e) => { e.currentTarget.classList.remove('dragging'); arrastrado.current = null; guardarPrefs(prefs) }}>
                      <span className="module-icon"><Icono className="ic ic-lg" /></span>
                      <span className="module-info">
                        <span className="module-title">{m.label}</span>
                        <span className="module-description" style={{ display: 'block' }}>{m.desc}</span>
                        <span className={'module-state' + (m.listo ? ' ready' : '')}><i /><b>{m.listo ? 'Listo · abre al instante' : 'En migración'}</b></span>
                      </span>
                      <span className="module-arrow"><ChevronRight className="ic" /></span>
                    </button>
                  )
                })}
            </div>
          </section>
        </main>
        <footer className="footer">
          <span><ShieldCheck className="ic ic-sm" />VIMEDIC · Sistema interno</span>
          <span>Tu diseño se guarda en este navegador.</span>
        </footer>
      </div>

      {personalizar && (
        <div id="customOverlay" onClick={() => setPersonalizar(false)}>
          <div className="custom-modal" onClick={(e) => e.stopPropagation()}>
            <div className="custom-head"><SlidersHorizontal className="ic" style={{ color: 'var(--primary)' }} /><h3>Personalizar Mi Espacio</h3>
              <button type="button" onClick={() => setPersonalizar(false)} aria-label="Cerrar"><X className="ic" /></button></div>
            <div className="custom-body">
              <p className="custom-description">Elige qué módulos quieres ver. Para cambiar el orden, arrastra las tarjetas en la pantalla principal.</p>
              <div className="custom-label">Módulos</div>
              <div className="toggle-list">
                {permitidos.map((id) => {
                  const m = MODULOS[id]
                  const Icono = m.icono
                  return (
                    <label key={id} className="toggle-row" style={{ ['--c' as string]: m.c }}>
                      <Icono className="ic ic-sm" /><span>{m.label}</span>
                      <span className="toggle">
                        <input type="checkbox" checked={prefs.moduleVisible[id] !== false}
                          onChange={(e) => cambiar({ ...prefs, moduleVisible: { ...prefs.moduleVisible, [id]: e.target.checked } })} />
                        <span />
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="custom-footer">
              <button type="button" className="btn btn-light" onClick={() => {
                if (!confirm('¿Restaurar el diseño predeterminado de Mi Espacio?')) return
                cambiar({ moduleOrder: [...ORDEN_MODULOS], moduleVisible: {} }); mostrarAviso('Diseño restaurado.')
              }}>Restaurar diseño</button>
              <button type="button" className="btn btn-primary" onClick={() => setPersonalizar(false)}>Listo</button>
            </div>
          </div>
        </div>
      )}

      <div id="toast" role="status" className={aviso ? 'show' : ''}>{aviso}</div>
    </>
  )
}
