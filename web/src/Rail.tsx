import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlarmClock, BadgeDollarSign, CalendarPlus, ChevronDown, ChevronUp, CirclePlus, CloudUpload, FilePlus2, LayoutDashboard,
  LayoutGrid, LogOut, MessageCircle, PackagePlus, PenLine, Pin, Search, Settings, ShieldCheck, SlidersHorizontal, UserPlus, X, type LucideIcon,
} from 'lucide-react'
import { supabase, type Perfil } from './supabase'
import { puede } from './permisos'
import { MODULOS } from './modulos'
import MfaPanel from './MfaPanel'
import PerfilConfig from './PerfilConfig'
import './estilos/rail.css'

// Barra lateral de acceso rápido: aparece dentro de los módulos (no en Mi Espacio), igual que en la app original.

const GRUPOS: [string, string[]][] = [
  ['Comercial', ['crm', 'clientes', 'femedics', 'marketing', 'catalogos', 'ofertas', 'agenda', 'dashboard']],
  ['Operaciones', ['inventario', 'movimientos', 'adquisiciones', 'bodega', 'logistica', 'serviciotecnico', 'importaciones', 'articulos']],
  ['Administración', ['facturacion', 'financiero', 'empleados', 'talentohumano', 'seguridad', 'basedatos']],
]
const MAX_ACC = 6

type Accion = { label: string; sub: string; icono: LucideIcon; permiso: string; c: string }
const ACCIONES: Record<string, Accion> = {
  gestion: { label: 'Nueva gestión', sub: 'Registrar un contacto', icono: CirclePlus, permiso: 'crm', c: '#055c9d' },
  cotizacion: { label: 'Nueva cotización', sub: 'Proforma con productos', icono: FilePlus2, permiso: 'crm', c: '#0e7490' },
  venta: { label: 'Nueva venta', sub: 'Pago y entrega', icono: BadgeDollarSign, permiso: 'crm', c: '#04896f' },
  cliente: { label: 'Nuevo cliente', sub: 'Ficha completa', icono: UserPlus, permiso: 'crm', c: '#0b2545' },
  seguimientos: { label: 'Seguimientos', sub: 'Gestiones pendientes', icono: AlarmClock, permiso: 'crm', c: '#c0392b' },
  mensajes: { label: 'Mensajes', sub: 'Chats de clientes', icono: MessageCircle, permiso: 'crm', c: '#1877f2' },
  actividad: { label: 'Nueva actividad', sub: 'Agenda y tareas', icono: CalendarPlus, permiso: 'agenda', c: '#17a9ba' },
  ingreso: { label: 'Nuevo ingreso', sub: 'Compra a proveedor', icono: PackagePlus, permiso: 'importaciones', c: '#0e7490' },
  publicacion: { label: 'Nueva publicación', sub: 'Copy con IA y programar', icono: PenLine, permiso: 'marketing', c: '#e1306c' },
  audiovisual: { label: 'Subir material', sub: 'Fotos y videos del día', icono: CloudUpload, permiso: 'marketing', c: '#c98a1f' },
}
const ORDEN_ACCIONES = Object.keys(ACCIONES)

type Cfg = { acciones: string[]; favoritos: string[]; fijo: boolean }

const norm = (v: string) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const claro = (hex: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return '#7dd3e0'
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, k = 0.55
  return `rgb(${Math.round(r + (255 - r) * k)},${Math.round(g + (255 - g) * k)},${Math.round(b + (255 - b) * k)})`
}
const esMovil = () => window.matchMedia('(max-width:639px)').matches
const estilo = (c: string) => ({ ['--c' as string]: c, ['--c-claro' as string]: claro(c) })

type Props = { perfil: Perfil; actual: string; ir: (id: string) => void; accion: (clave: string) => void; aviso: (t: string) => void }

export default function Rail({ perfil, actual, ir, accion, aviso }: Props) {
  const [ancho, setAncho] = useState(false)
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [tip, setTip] = useState<{ t: string; s: string; top: number; left: number } | null>(null)
  const [paleta, setPaleta] = useState<{ q: string; sel: number } | null>(null)
  const [pers, setPers] = useState<'acciones' | 'modulos' | null>(null)
  const [mfa, setMfa] = useState(false)
  const [config, setConfig] = useState(false)
  const [menuPerfil, setMenuPerfil] = useState<{ left: number; bottom: number } | null>(null)
  const [fotoOverride, setFotoOverride] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [indic, setIndic] = useState<{ top: number; c: string } | null>(null)
  // Arrastre para ordenar dentro de la misma barra (ratón y dedo con pulsación larga).
  const [arr, setArr] = useState<{ g: 'acc' | 'mod'; k: string } | null>(null)
  const [orden, setOrden] = useState<string[] | null>(null)
  const ordenRef = useRef<string[] | null>(null)
  const evitarClick = useRef(false)

  const clave = 'vm_rail_v2_' + norm(perfil.email || perfil.nombre || 'u')

  const accPermitidas = useMemo(() => ORDEN_ACCIONES.filter((k) => puede(perfil, ACCIONES[k].permiso, 'ver')), [perfil])
  const modPermitidos = useMemo(() => {
    const l: string[] = []
    GRUPOS.forEach(([, ids]) => ids.forEach((id) => { if (MODULOS[id] && puede(perfil, MODULOS[id].permiso, 'ver')) l.push(id) }))
    return l
  }, [perfil])

  const porDefecto = useCallback((): Cfg => {
    let uso: Record<string, number> = {}
    try { uso = JSON.parse(localStorage.getItem('vm_mod_uso') || '{}') } catch { /* sin almacenamiento */ }
    return {
      acciones: accPermitidas.slice(0, 4),
      favoritos: [...modPermitidos].sort((a, b) => (uso[b] || 0) - (uso[a] || 0)).slice(0, 5),
      fijo: false,
    }
  }, [accPermitidas, modPermitidos])

  const [cfg, setCfg] = useState<Cfg>(() => {
    let c: Cfg | null = null
    try { c = JSON.parse(localStorage.getItem(clave) || 'null') } catch { /* sin almacenamiento */ }
    return c && Array.isArray(c.acciones) && Array.isArray(c.favoritos) ? c : { acciones: [], favoritos: [], fijo: false }
  })
  // Normaliza contra lo que el empleado puede ver (y rellena por defecto si está vacío).
  useEffect(() => {
    setCfg((c) => {
      const d = porDefecto()
      const nuevo: Cfg = {
        acciones: c.acciones.filter((k) => accPermitidas.includes(k)).slice(0, MAX_ACC),
        favoritos: c.favoritos.filter((k) => modPermitidos.includes(k)),
        fijo: !!c.fijo,
      }
      if (!nuevo.acciones.length) nuevo.acciones = d.acciones
      if (!nuevo.favoritos.length && !localStorage.getItem(clave)) nuevo.favoritos = d.favoritos
      return nuevo
    })
  }, [accPermitidas, modPermitidos, porDefecto, clave])

  function guardar(c: Cfg) { setCfg(c); try { localStorage.setItem(clave, JSON.stringify(c)) } catch { /* sin almacenamiento */ } }
  const cfgRef = useRef(cfg); cfgRef.current = cfg

  // Clases en <body> que usa el CSS original para dejar espacio al contenido.
  useEffect(() => {
    document.body.classList.add('vm-con-rail')
    return () => document.body.classList.remove('vm-con-rail', 'vm-rail-fijo', 'vm-rail-abierto')
  }, [])
  useEffect(() => { document.body.classList.toggle('vm-rail-fijo', cfg.fijo && !esMovil()) }, [cfg.fijo])
  useEffect(() => { document.body.classList.toggle('vm-rail-abierto', menuAbierto) }, [menuAbierto])
  useEffect(() => { setAncho(cfg.fijo || esMovil()) }, [cfg.fijo])
  useEffect(() => {
    const f = () => setAncho(cfg.fijo || esMovil())
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [cfg.fijo])

  // Atajo Ctrl+K y Escape.
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaleta((p) => (p ? null : { q: '', sel: 0 })) }
      else if (e.key === 'Escape') { if (paleta) setPaleta(null); else if (pers) setPers(null); else setMenuAbierto(false) }
    }
    document.addEventListener('keydown', f)
    return () => document.removeEventListener('keydown', f)
  }, [paleta, pers])

  const favs = useMemo(() => (actual && !cfg.favoritos.includes(actual) && modPermitidos.includes(actual) ? [...cfg.favoritos, actual] : cfg.favoritos), [cfg.favoritos, actual, modPermitidos])
  const resto = modPermitidos.filter((p) => !favs.includes(p))
  const accList = cfg.acciones.filter((k) => ACCIONES[k])
  const accVivo = arr?.g === 'acc' && orden ? orden : accList
  const favsVivo = arr?.g === 'mod' && orden ? orden : favs
  const listaRef = useRef({ acc: accList, mod: favs }); listaRef.current = { acc: accList, mod: favs }

  function iniciarArrastre(e: React.PointerEvent<HTMLElement>, g: 'acc' | 'mod', k: string) {
    if (e.button !== 0) return
    const touch = e.pointerType === 'touch', x0 = e.clientX, y0 = e.clientY
    let activo = false, abortado = false, timer = 0
    const empezar = () => {
      activo = true; ordenRef.current = [...listaRef.current[g]]; setOrden(ordenRef.current); setArr({ g, k })
      if (touch) { try { navigator.vibrate?.(12) } catch { /* sin vibración */ } }
    }
    if (touch) timer = window.setTimeout(empezar, 380)
    const bloquear = (ev: TouchEvent) => { if (activo) ev.preventDefault() }
    const mover = (ev: PointerEvent) => {
      if (abortado) return
      if (!activo) {
        const d = Math.hypot(ev.clientX - x0, ev.clientY - y0)
        if (touch) { if (d > 9) { abortado = true; window.clearTimeout(timer); limpiar() } return }
        if (d > 5) empezar(); else return
      }
      const cont = scrollRef.current; if (!cont) return
      const els = Array.from(cont.querySelectorAll<HTMLElement>('[data-g="' + g + '"]')).filter((el) => el.dataset.k !== k)
      const pos = els.filter((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 < ev.clientY }).length
      const base = (ordenRef.current ?? []).filter((x) => x !== k)
      const nuevo = [...base.slice(0, pos), k, ...base.slice(pos)]
      if (nuevo.join() !== (ordenRef.current ?? []).join()) { ordenRef.current = nuevo; setOrden(nuevo) }
    }
    const limpiar = () => {
      document.removeEventListener('pointermove', mover); document.removeEventListener('pointerup', soltar); document.removeEventListener('pointercancel', soltar)
      document.removeEventListener('touchmove', bloquear)
    }
    const soltar = () => {
      window.clearTimeout(timer); limpiar()
      if (activo && ordenRef.current) {
        evitarClick.current = true; window.setTimeout(() => { evitarClick.current = false }, 60)
        const l = ordenRef.current, c = cfgRef.current
        guardar(g === 'acc' ? { ...c, acciones: l } : { ...c, favoritos: l })
      }
      ordenRef.current = null; setOrden(null); setArr(null)
    }
    document.addEventListener('pointermove', mover); document.addEventListener('pointerup', soltar); document.addEventListener('pointercancel', soltar)
    document.addEventListener('touchmove', bloquear, { passive: false })
  }
  const arrastrable = (g: 'acc' | 'mod', k: string) => ({ 'data-g': g, 'data-k': k, onPointerDown: (e: React.PointerEvent<HTMLElement>) => iniciarArrastre(e, g, k) })

  // Barra indicadora del módulo actual.
  useEffect(() => {
    const on = scrollRef.current?.querySelector<HTMLElement>('.vr-item.on')
    setIndic(on ? { top: on.offsetTop + 10, c: MODULOS[actual]?.c || '' } : null)
  }, [actual, favs, cfg.acciones, ancho, orden])

  function mostrarTip(el: HTMLElement, t: string, s: string) {
    if (ancho || esMovil()) return
    const r = el.getBoundingClientRect()
    setTip({ t, s, left: r.right + 12, top: r.top + r.height / 2 - 20 })
  }
  const verTip = (t: string, s: string, arrastre = false) => ({
    'data-tip': t,
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { if (!evitarClick.current) mostrarTip(e.currentTarget, t, (s ? s + ' · ' : '') + (arrastre ? 'arrastra para ordenar' : '')) },
    onMouseLeave: () => setTip(null),
    onPointerDown: () => setTip(null),
  })

  function irA(p: string) {
    setMenuAbierto(false); setTip(null)
    if (p === 'espacio') { ir('espacio'); return }
    if (p === actual) return
    try {
      const uso = JSON.parse(localStorage.getItem('vm_mod_uso') || '{}'); uso[p] = (uso[p] || 0) + 1
      localStorage.setItem('vm_mod_uso', JSON.stringify(uso))
    } catch { /* sin almacenamiento */ }
    ir(p)
  }

  const nombre = String(perfil.nombre || perfil.email || 'Usuario').trim()
  const ini = nombre.split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase() || 'V'
  const foto = fotoOverride ?? perfil.foto_url

  function abrirMenuPerfil(e: React.MouseEvent<HTMLElement>) {
    e.stopPropagation()
    if (menuPerfil) { setMenuPerfil(null); return }
    const r = e.currentTarget.getBoundingClientRect()
    const ancho = 252
    let left = r.left
    if (left + ancho > window.innerWidth - 12) left = window.innerWidth - ancho - 12
    setMenuPerfil({ left: Math.max(12, left), bottom: Math.max(12, window.innerHeight - r.top + 8) })
  }

  function itemModulo(p: string) {
    const m = MODULOS[p]
    const Icono = m.icono
    return (
      <button key={p} type="button" className={'vr-item vr-mov' + (p === actual ? ' on' : '') + (arr?.k === p && arr.g === 'mod' ? ' arrastrando' : '')} style={estilo(m.c)} aria-current={p === actual ? 'page' : undefined}
        onClick={() => { if (!evitarClick.current) irA(p) }} {...verTip(m.label, m.desc, true)} {...arrastrable('mod', p)}>
        <Icono className="ic" /><span className="vr-lbl">{m.label}</span>
      </button>
    )
  }

  // ---- paleta de búsqueda ----
  const resultados = useMemo(() => {
    if (!paleta) return [] as { tipo: 'acc' | 'mod'; k: string }[]
    const q = norm(paleta.q).trim()
    const coincide = (t: string) => !q || norm(t).includes(q)
    const r: { tipo: 'acc' | 'mod'; k: string }[] = []
    accPermitidas.forEach((k) => { if (coincide(ACCIONES[k].label + ' ' + ACCIONES[k].sub)) r.push({ tipo: 'acc', k }) })
    GRUPOS.forEach(([, ids]) => ids.forEach((p) => { if (modPermitidos.includes(p) && coincide(MODULOS[p].label + ' ' + MODULOS[p].desc)) r.push({ tipo: 'mod', k: p }) }))
    return r
  }, [paleta, accPermitidas, modPermitidos])

  function elegir(i: number) {
    const r = resultados[i]
    if (!r) return
    setPaleta(null)
    if (r.tipo === 'acc') accion(r.k); else irA(r.k)
  }

  return (
    <>
      <div id="vmRailVelo" onClick={() => setMenuAbierto(false)} />
      <button type="button" id="vmRailBtn" aria-label="Abrir menú" aria-expanded={menuAbierto} onClick={() => setMenuAbierto((v) => !v)}>
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="7" y2="7" /><line x1="4" x2="14" y1="12" y2="12" /><line x1="4" x2="20" y1="17" y2="17" /></svg>
      </button>

      <nav id="vmRail" aria-label="Acceso rápido" className={(ancho ? 'ancho' : '') + (arr ? ' ordenando' : '')} onMouseLeave={() => setTip(null)}>
        <button type="button" className="vr-item vr-home" onClick={() => irA(modPermitidos.includes('inventario') ? 'inventario' : 'espacio')} {...verTip('Inicio', 'Inventario')}>
          <span className="vr-logo"><LayoutDashboard className="ic" /></span>
          <span className="vr-lbl"><b>Inicio</b><small>Inventario</small></span>
        </button>
        <button type="button" className="vr-pinbtn" title={cfg.fijo ? 'Barra angosta' : 'Mostrar nombres'} onClick={() => { guardar({ ...cfg, fijo: !cfg.fijo }); aviso(!cfg.fijo ? 'Barra con nombres.' : 'Barra angosta: los nombres salen al pasar el cursor.') }}><Pin className="ic" /></button>
        <button type="button" className="vr-buscar" onClick={() => { setMenuAbierto(false); setPaleta({ q: '', sel: 0 }) }} {...verTip('Buscar', 'Ctrl + K')}>
          <Search className="ic" /><span>Buscar…</span><kbd>Ctrl K</kbd>
        </button>

        <div className="vr-scroll" ref={scrollRef}>
          <span className="vr-indic" style={indic ? { top: indic.top, background: indic.c, boxShadow: `0 0 12px ${indic.c}`, opacity: 1 } : { opacity: 0 }} />
          {accList.length > 0 && <div className="vr-tit"><span>ACCIONES RÁPIDAS</span></div>}
          {accVivo.map((k) => {
            const q = ACCIONES[k]
            const Icono = q.icono
            return (
              <button key={k} type="button" className={'vr-item vr-acc vr-mov' + (arr?.k === k && arr.g === 'acc' ? ' arrastrando' : '')} style={estilo(q.c)} onClick={() => { if (evitarClick.current) return; setMenuAbierto(false); setTip(null); accion(k) }} {...verTip(q.label, q.sub, true)} {...arrastrable('acc', k)}>
                <span className="vr-chip"><Icono className="ic" /></span>
                <span className="vr-lbl">{q.label}<span className="vr-sub">{q.sub}</span></span>
              </button>
            )
          })}
          {favs.length > 0 && <div className="vr-tit"><span>MIS MÓDULOS</span></div>}
          {favsVivo.map(itemModulo)}
          {resto.length > 0 && (
            <button type="button" className="vr-item" onClick={() => { setMenuAbierto(false); setPaleta({ q: '', sel: 0 }) }} {...verTip('Todos los módulos', `${resto.length} más`)}>
              <LayoutGrid className="ic" /><span className="vr-lbl">Todos los módulos</span>
            </button>
          )}
        </div>

        <div className="vr-pie">
          <button type="button" className="vr-item" onClick={abrirMenuPerfil} {...verTip(nombre, 'Mi cuenta')}>
            {foto ? <img src={foto} alt="" className="vr-ava" style={{ objectFit: 'cover' }} /> : <span className="vr-ava">{ini}</span>}
            <span className="vr-lbl vr-quien"><b>{nombre}</b><span>{perfil.rol || perfil.email || ''}</span></span>
          </button>
        </div>
      </nav>

      {tip && <div id="vrTip" role="tooltip" className="on" style={{ left: tip.left, top: tip.top }}>{tip.t}{tip.s && <small>{tip.s}</small>}</div>}

      {paleta && (
        <div id="vrPaleta" className="vr-modal on" role="dialog" aria-modal="true" aria-label="Buscar" onClick={(e) => { if (e.target === e.currentTarget) setPaleta(null) }}>
          <div className="vr-caja">
            <div className="vr-pbus">
              <Search className="ic" />
              <input autoFocus type="text" placeholder="¿A dónde vas? Busca un módulo o una acción…" autoComplete="off" value={paleta.q}
                onChange={(e) => setPaleta({ q: e.target.value, sel: 0 })}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setPaleta({ ...paleta, sel: Math.min(resultados.length - 1, paleta.sel + 1) }) }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setPaleta({ ...paleta, sel: Math.max(0, paleta.sel - 1) }) }
                  else if (e.key === 'Enter') { e.preventDefault(); elegir(paleta.sel) }
                }} />
              <kbd>Esc</kbd>
            </div>
            <div className="vr-plista">
              {resultados.length === 0 && <div className="vr-vacio">No encontramos «{paleta.q}». Prueba con otra palabra.</div>}
              {resultados.map((r, i) => {
                const it = r.tipo === 'acc' ? ACCIONES[r.k] : MODULOS[r.k]
                const Icono = it.icono
                const grupo = r.tipo === 'acc' ? 'ACCIONES' : GRUPOS.find(([, ids]) => ids.includes(r.k))?.[0].toUpperCase()
                const anterior = resultados[i - 1]
                const grupoAnterior = anterior ? (anterior.tipo === 'acc' ? 'ACCIONES' : GRUPOS.find(([, ids]) => ids.includes(anterior.k))?.[0].toUpperCase()) : null
                return (
                  <div key={r.tipo + r.k}>
                    {grupo !== grupoAnterior && <div className="vr-pgr">{grupo}</div>}
                    <button type="button" className={'vr-pop' + (i === paleta.sel ? ' sel' : '')} style={{ ['--c' as string]: it.c }}
                      onMouseMove={() => { if (paleta.sel !== i) setPaleta({ ...paleta, sel: i }) }} onClick={() => elegir(i)}>
                      <span className="vr-chip"><Icono className="ic" /></span>
                      <span><span>{it.label}</span><small>{'sub' in it ? it.sub : it.desc}</small></span>
                      <span className="vr-ir">Enter ↵</span>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {pers && <Personalizar cfg={cfg} tab={pers} setTab={setPers} guardar={guardar} accPermitidas={accPermitidas} modPermitidos={modPermitidos}
        restaurar={() => { guardar(porDefecto()); aviso('Barra restaurada.') }} cerrar={() => setPers(null)} aviso={aviso} />}
      {mfa && <MfaPanel cerrar={() => setMfa(false)} />}
      {config && <PerfilConfig perfil={perfil} cerrar={() => setConfig(false)} aviso={aviso} alGuardar={setFotoOverride} />}

      {menuPerfil && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 65 }} onClick={() => setMenuPerfil(null)} />
          <div className="vr-pmenu" style={{ left: menuPerfil.left, bottom: menuPerfil.bottom }}>
            <div className="vr-pmenu-h">
              {foto ? <img src={foto} alt="" className="vr-ava" style={{ objectFit: 'cover', marginLeft: 0 }} /> : <span className="vr-ava" style={{ marginLeft: 0 }}>{ini}</span>}
              <div style={{ minWidth: 0 }}><b>{nombre}</b><span>{perfil.rol || perfil.email || ''}</span></div>
            </div>
            <button type="button" className="vr-pmenu-it" onClick={() => { setMenuPerfil(null); setPers('modulos') }}><SlidersHorizontal />Personalizar módulos</button>
            <button type="button" className="vr-pmenu-it" onClick={() => { setMenuPerfil(null); setMfa(true) }}><ShieldCheck />Seguridad</button>
            <button type="button" className="vr-pmenu-it" onClick={() => { setMenuPerfil(null); setConfig(true) }}><Settings />Configuración</button>
            <div className="vr-pmenu-sep" />
            <button type="button" className="vr-pmenu-it salir" onClick={() => { setMenuPerfil(null); if (confirm('¿Cerrar sesión?')) supabase.auth.signOut() }}><LogOut />Cerrar sesión</button>
          </div>
        </>
      )}
    </>
  )
}

function Personalizar({ cfg, tab, setTab, guardar, accPermitidas, modPermitidos, restaurar, cerrar, aviso }: {
  cfg: Cfg; tab: 'acciones' | 'modulos'; setTab: (t: 'acciones' | 'modulos') => void; guardar: (c: Cfg) => void
  accPermitidas: string[]; modPermitidos: string[]; restaurar: () => void; cerrar: () => void; aviso: (t: string) => void
}) {
  const esAcc = tab === 'acciones'
  const lista = esAcc ? cfg.acciones : cfg.favoritos
  const todos = esAcc ? accPermitidas : modPermitidos
  const orden = lista.concat(todos.filter((k) => !lista.includes(k)))
  const poner = (l: string[]) => guardar(esAcc ? { ...cfg, acciones: l } : { ...cfg, favoritos: l })

  function alternar(k: string, on: boolean) {
    if (on) {
      if (esAcc && lista.length >= MAX_ACC) { aviso(`Puedes tener hasta ${MAX_ACC} acciones rápidas.`); return }
      if (!lista.includes(k)) poner([...lista, k])
    } else poner(lista.filter((x) => x !== k))
  }
  function mover(k: string, d: number) {
    const l = [...lista], i = l.indexOf(k), j = i + d
    if (i < 0 || j < 0 || j >= l.length) return
    l.splice(i, 1); l.splice(j, 0, k); poner(l)
  }

  return (
    <div id="vrPers" className="vr-modal on" role="dialog" aria-modal="true" aria-label="Personalizar barra" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="vr-caja">
        <div className="vr-pcab">
          <div><h3>Personaliza tu barra</h3><p>Elige y ordena lo que quieres tener a un clic en todos los módulos.</p></div>
          <button type="button" className="vr-mini" onClick={cerrar} aria-label="Cerrar"><X className="ic" /></button>
        </div>
        <div className="vr-ptabs">
          <button type="button" className={'vr-ptab' + (esAcc ? ' on' : '')} onClick={() => setTab('acciones')}>Acciones rápidas</button>
          <button type="button" className={'vr-ptab' + (!esAcc ? ' on' : '')} onClick={() => setTab('modulos')}>Módulos favoritos</button>
        </div>
        <div className="vr-plista">
          <div className="vr-pgr">{esAcc ? `ACTIVADAS ARRIBA · MÁXIMO ${MAX_ACC}` : 'APARECEN EN «MIS MÓDULOS»'}</div>
          {orden.map((k) => {
            const it = esAcc ? ACCIONES[k] : MODULOS[k]
            const Icono = it.icono
            const on = lista.includes(k), pos = lista.indexOf(k)
            return (
              <div key={k} className={'vr-fila' + (on ? '' : ' off')} style={{ ['--c' as string]: it.c }}>
                <label className="vr-sw"><input type="checkbox" checked={on} onChange={(e) => alternar(k, e.target.checked)} /><span /></label>
                <span className="vr-chip"><Icono className="ic" /></span>
                <span style={{ minWidth: 0 }}><b>{it.label}</b><small>{'sub' in it ? it.sub : it.desc}</small></span>
                {on && (
                  <span className="vr-ord">
                    <button type="button" aria-label="Subir" disabled={pos === 0} onClick={() => mover(k, -1)}><ChevronUp className="ic" /></button>
                    <button type="button" aria-label="Bajar" disabled={pos === lista.length - 1} onClick={() => mover(k, 1)}><ChevronDown className="ic" /></button>
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <div className="vr-ppie">
          <label className="vr-sw"><input id="vrFijo" type="checkbox" checked={cfg.fijo} onChange={(e) => guardar({ ...cfg, fijo: e.target.checked })} /><span /></label>
          <label htmlFor="vrFijo" style={{ cursor: 'pointer' }}>Mostrar siempre los nombres</label>
          <button type="button" className="btn btn-light" style={{ marginLeft: 'auto' }} onClick={restaurar}>Restaurar</button>
          <button type="button" className="btn btn-primary" onClick={cerrar}>Listo</button>
        </div>
      </div>
    </div>
  )
}
