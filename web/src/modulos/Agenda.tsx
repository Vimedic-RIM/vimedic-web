import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Bell, Calendar, CalendarDays, ChevronLeft, ChevronRight, Download, ExternalLink, GanttChartSquare, Check, CheckSquare, Clock, Columns3, FolderKanban, Gift, Inbox, Layers3, LayoutGrid, Paperclip, Pause, Pencil, Play, Plus, RefreshCw, Search, Send, SlidersHorizontal, Table2, Timer, Trash2, UserRound, Users, UsersRound, X, XCircle } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import '../estilos/agenda.css'

/* ============================ Tipos y catálogos ============================ */
const ESTADOS = ['Por hacer', 'En marcha', 'Pausado', 'Listo', 'Devuelto', 'Cancelado']
const PRIORIDADES = ['Urgente', 'Importante', 'Normal']
const MOTIVOS_DEV = ['Falta información', 'Requiere corrección', 'Está incompleta', 'No corresponde', 'Requiere aprobación', 'Debe reprogramarse', 'Otro motivo']
const TIPOS_ACT = ['Llamada', 'WhatsApp / Mensaje', 'Correo electrónico', 'Reunión', 'Visita', 'Seguimiento', 'Cotización / Proforma', 'Prospección', 'Cobranza', 'Facturación', 'Despacho / Entrega', 'Servicio técnico', 'Capacitación', 'Documentación', 'Informe / Reporte', 'Marketing', 'Compra', 'Trámite', 'Otro']
type Hist = { fecha: string; segundos: number }
type Act = {
  id: string; codigo: string; proyectoId: string | null; proyecto: string; descripcion: string; ubicacion: string; tipo: string; fecha: string; hora: string; duracion: number; prioridad: string; realizaId: string | null; delegada: boolean; delegadoId: string | null; delegado: string
  estado: string; detalle: string; evidencia: string; devolucion: Record<string, string>; resultado: string; quedoPendiente: boolean; fechaRetomar: string; evidenciaFinal: string; fechaFin: string; supervisar: boolean; comentarioCalif: string
  segundos: number; inicios: number; historial: Hist[]; sesion: { inicio: number; por: string } | null; monedaOtorgada: number; creadoPorId: string | null; creador: string; creado: string
}
type Emp = { id: string; nombre: string; email: string; area: string }
type Proyecto = { id: string; nombre: string; descripcion: string; estado: string; areas: string[]; responsable: string }
type Eco = { total: number; admin: boolean; hoy: number; racha: number; nivel: { numero: number; nombre: string; dias: number; completadas: number; minimo: number; siguiente: number | null }; historial: { id: string; fecha: string; cambio: number; motivo: string; tipo: string }[]; premios: { id: string; emoji: string; nombre: string; costo: number; categoria: string; activo: boolean }[]; canjes: { id: string; fecha: string; premio: string; emoji: string; costo: number; nota: string; usuario: string; propio: boolean; estado: string }[] }
const COLS = 'id,codigo,proyecto_id,descripcion,ubicacion,tipo,fecha_programada,hora,duracion_min,prioridad,realiza_id,delegada,delegado_a_id,estado,detalle,evidencia_url,devolucion,resultado,quedo_pendiente,fecha_retomar,evidencia_final_url,fecha_finalizacion,requiere_supervision,comentario_calificacion,segundos_trabajados,veces_iniciada,historial_tiempo,ultima_sesion,moneda_otorgada,created_at,creado_por,creador:empleados!actividades_creado_por_fkey(nombre),delegado:empleados!actividades_delegado_a_id_fkey(nombre),proyecto:proyectos(nombre)'
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const slug = (v: string) => norm(v).replace(/[^a-z0-9]/g, '')
const ymd = (d: Date | number) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') }
const dfecha = (s: string) => { if (!s) return ''; const d = new Date(s.length === 10 ? s + 'T12:00:00' : s); return isNaN(d.getTime()) ? s : d.toLocaleDateString('es-EC', { weekday: 'short', day: '2-digit', month: 'short' }) }
const reloj = (s: number) => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') }
const corto = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${m} min` : m ? `${m} min` : s ? '< 1 min' : '—' }
const hoyDDMM = () => new Date().toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Guayaquil' })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapear = (x: any): Act => ({
  id: x.id, codigo: x.codigo ?? '', proyectoId: x.proyecto_id, proyecto: x.proyecto?.nombre ?? '', descripcion: x.descripcion ?? '', ubicacion: x.ubicacion ?? '', tipo: x.tipo ?? 'Tarea', fecha: x.fecha_programada ?? '', hora: String(x.hora ?? '').slice(0, 5), duracion: x.duracion_min ?? 0, prioridad: x.prioridad ?? 'Normal',
  realizaId: x.realiza_id, delegada: !!x.delegada, delegadoId: x.delegado_a_id, delegado: x.delegado?.nombre ?? '', estado: x.estado, detalle: x.detalle ?? '', evidencia: x.evidencia_url ?? '', devolucion: x.devolucion && typeof x.devolucion === 'object' ? x.devolucion : {},
  resultado: x.resultado ?? '', quedoPendiente: !!x.quedo_pendiente, fechaRetomar: x.fecha_retomar ?? '', evidenciaFinal: x.evidencia_final_url ?? '', fechaFin: x.fecha_finalizacion ?? '', supervisar: !!x.requiere_supervision, comentarioCalif: x.comentario_calificacion ?? '',
  segundos: x.segundos_trabajados ?? 0, inicios: x.veces_iniciada ?? 0, historial: Array.isArray(x.historial_tiempo) ? x.historial_tiempo : [], sesion: x.ultima_sesion && x.ultima_sesion.inicio ? { inicio: Number(x.ultima_sesion.inicio), por: x.ultima_sesion.por } : null, monedaOtorgada: x.moneda_otorgada ?? 0,
  creadoPorId: x.creado_por, creador: x.creador?.nombre ?? '', creado: x.created_at,
})
const respId = (a: Act) => a.delegadoId ?? a.creadoPorId
const Spin = () => <span className="spin" />
function Modal({ titulo, cerrar, children, pie, ancho }: { titulo: React.ReactNode; cerrar: () => void; children: React.ReactNode; pie?: React.ReactNode; ancho?: number }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  return <div className="ovl" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar() }}><div className="modal" style={ancho ? { maxWidth: ancho } : undefined}><div className="mh"><h3 style={{ flex: 1 }}>{titulo}</h3><button className="btn" onClick={cerrar} aria-label="Cerrar"><X /></button></div><div className="mb">{children}</div>{pie && <div className="mf">{pie}</div>}</div></div>
}
const Seg = ({ ops, v, set }: { ops: string[]; v: string; set: (x: string) => void }) => <div className="seg">{ops.map((o) => <button key={o} type="button" className={o === v ? 'on' : ''} onClick={() => set(o)}>{o}</button>)}</div>

/* ============================ Pantalla principal ============================ */
export default function Agenda({ perfil, aviso, accion, limpiarAccion }: { perfil: Perfil; aviso: (t: string) => void; accion?: string | null; limpiarAccion?: () => void }) {
  const [acts, setActs] = useState<Act[] | null>(null)
  const [error, setError] = useState('')
  const [emps, setEmps] = useState<Emp[]>([])
  const [proyectos, setProyectos] = useState<Proyecto[]>([])
  const [eco, setEco] = useState<Eco | null>(null)
  const [scope, setScope] = useState<'mi' | 'asignadas' | 'delegadas'>('mi')
  const [verEquipo, setVerEquipo] = useState(false)
  const [vista, setVista] = useState<'kanban' | 'tarjetas' | 'tabla' | 'gantt' | 'calendario'>(() => { try { return (localStorage.getItem('ag:vista') as 'kanban') || 'kanban' } catch { return 'kanban' } })
  const [grupo, setGrupo] = useState('estado')
  const [q, setQ] = useState('')
  const [f, setF] = useState({ proyecto: '', estado: '', prioridad: '', desde: '', hasta: '' })
  const [menu, setMenu] = useState<'' | 'filtros' | 'grupo' | 'vista' | 'wallet'>('')
  const [alertas, setAlertas] = useState<'' | 'vencidas' | 'devueltas' | 'revisar'>('')
  const [modal, setModal] = useState<{ k: 'form'; act?: Act; fecha?: string } | { k: 'detalle'; id: string } | { k: 'fin'; id: string } | { k: 'dev'; id: string } | { k: 'calif'; id: string } | { k: 'proyectos' } | { k: 'tienda' } | null>(null)

  // Acceso directo de la barra lateral: "Nueva actividad" abre el formulario de una vez.
  useEffect(() => {
    if (accion === 'actividad') setModal({ k: 'form' })
    if (accion) limpiarAccion?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accion])
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [anchor, setAnchor] = useState(() => new Date())
  const [visor, setVisor] = useState<{ lista: string[]; i: number } | null>(null)
  const [fx, setFx] = useState(false)
  const [efectos, setEfectos] = useState(() => { try { return localStorage.getItem('ag:fx') !== '0' } catch { return true } })
  const [sonido, setSonido] = useState(() => { try { return localStorage.getItem('ag:snd') !== '0' } catch { return true } })
  useEffect(() => { try { localStorage.setItem('ag:fx', efectos ? '1' : '0'); localStorage.setItem('ag:snd', sonido ? '1' : '0') } catch { /* nada */ } }, [efectos, sonido])
  useEffect(() => { const f = (e: Event) => setVisor((e as CustomEvent).detail); window.addEventListener('ag-visor', f); return () => window.removeEventListener('ag-visor', f) }, [])
  useEffect(() => { if (fx) { const t = setTimeout(() => setFx(false), 1600); return () => clearTimeout(t) } }, [fx])
  const yo = perfil.id
  const jefatura = puede(perfil, 'agenda', 'ver_todos'), crear = puede(perfil, 'agenda', 'crear'), editar = puede(perfil, 'agenda', 'editar')

  useEffect(() => { try { localStorage.setItem('ag:vista', vista) } catch { /* nada */ } }, [vista])
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { const c = () => setMenu(''); document.addEventListener('click', c); return () => document.removeEventListener('click', c) }, [])

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('actividades').select(COLS).is('deleted_at', null).order('created_at', { ascending: false }).limit(1500)
    if (error) { setError(error.message); return }
    setError(''); setActs((data ?? []).map(mapear))
  }, [])
  const cargarEco = useCallback(async () => { await supabase.rpc('ag_revisar_vencidas'); const { data } = await supabase.rpc('ag_economia'); if (data) setEco(data as Eco) }, [])
  const cargarProyectos = useCallback(async () => {
    const { data } = await supabase.from('proyectos').select('id,nombre,descripcion,estado,areas,responsable:empleados!proyectos_responsable_id_fkey(nombre)').is('deleted_at', null).order('nombre').limit(300)
    setProyectos(((data ?? []) as unknown as Record<string, any>[]).map((p) => ({ id: p.id, nombre: p.nombre, descripcion: p.descripcion ?? '', estado: p.estado ?? 'Activo', areas: p.areas ?? [], responsable: p.responsable?.nombre ?? '' }))) // eslint-disable-line @typescript-eslint/no-explicit-any
  }, [])
  useEffect(() => { cargar(); cargarEco(); cargarProyectos(); supabase.rpc('ag_empleados').then(({ data }) => setEmps((data as Emp[]) ?? [])) }, [cargar, cargarEco, cargarProyectos])
  useEffect(() => { const c = supabase.channel('ag-act').on('postgres_changes', { event: '*', schema: 'public', table: 'actividades' }, () => cargar()).subscribe(); return () => { supabase.removeChannel(c) } }, [cargar])

  const A = acts ?? []
  const timer = A.find((a) => a.estado === 'En marcha' && a.sesion?.por === yo) ?? null
  const segTimer = (a: Act) => a.segundos + (a.sesion && a.estado === 'En marcha' ? (Date.now() - a.sesion.inicio) / 1000 : 0)
  void tick
  const enScope = (a: Act, s: string) => s === 'mi' ? respId(a) === yo : s === 'asignadas' ? a.delegadoId === yo && a.creadoPorId !== yo : a.creadoPorId === yo && !!a.delegadoId && a.delegadoId !== yo
  const hoy = ymd(Date.now())
  const lista = useMemo(() => {
    const w = norm(q).trim().split(/\s+/).filter(Boolean)
    return A.filter((a) => (verEquipo && jefatura ? true : enScope(a, scope)) && (!f.proyecto || a.proyectoId === f.proyecto) && (!f.estado || a.estado === f.estado) && (!f.prioridad || a.prioridad === f.prioridad) && (!f.desde || (a.fecha && a.fecha >= f.desde)) && (!f.hasta || (a.fecha && a.fecha <= f.hasta))
      && (!w.length || w.every((x) => norm([a.descripcion, a.detalle, a.proyecto, a.delegado, a.creador, a.codigo].join(' ')).includes(x))))
  }, [A, scope, verEquipo, f, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const cuenta = (s: string) => A.filter((a) => enScope(a, s) && a.estado !== 'Cancelado' && a.estado !== 'Listo').length
  const mias = A.filter((a) => respId(a) === yo || a.creadoPorId === yo)
  const vencidas = mias.filter((a) => ['Por hacer', 'En marcha', 'Pausado'].includes(a.estado) && a.fecha && a.fecha < hoy)
  const devueltas = mias.filter((a) => a.estado === 'Devuelto' && respId(a) === yo)
  const revisar = A.filter((a) => a.estado === 'Listo' && a.supervisar && a.creadoPorId === yo)
  const segHoy = mias.filter((a) => respId(a) === yo).reduce((s, a) => s + a.historial.filter((h) => h.fecha === hoyDDMM()).reduce((x, h) => x + h.segundos, 0), 0)
  const mes = hoyDDMM().slice(3)
  const segMes = mias.filter((a) => respId(a) === yo).reduce((s, a) => s + a.historial.filter((h) => h.fecha.slice(3) === mes).reduce((x, h) => x + h.segundos, 0), 0)
  const kpis: [string, string | number, boolean][] = [['Hoy', corto(segHoy), false], ['Este mes', corto(segMes), false], ['Pendientes', mias.filter((a) => respId(a) === yo && a.estado === 'Por hacer').length, false], ['En marcha', mias.filter((a) => respId(a) === yo && a.estado === 'En marcha').length, false], ['Vencidas', vencidas.length, vencidas.length > 0], ['Devueltas', devueltas.length, devueltas.length > 0], ...(revisar.length ? [['Por revisar', revisar.length, true] as [string, number, boolean]] : [])]
  const nAlertas = vencidas.length + devueltas.length + revisar.length

  /* Acciones */
  const rpc = async (fn: string, args: Record<string, unknown>, ok?: string) => { const { data, error } = await supabase.rpc(fn, args); if (error) { aviso(error.message); return null } if (ok) aviso(ok); await cargar(); return data ?? true }
  const iniciar = (a: Act) => rpc('ag_iniciar', { p_id: a.id })
  const pausar = (a: Act) => rpc('ag_pausar', { p_id: a.id })
  async function mover(id: string, destino: string) {
    const a = A.find((x) => x.id === id); if (!a || a.estado === destino) return
    if (destino === 'En marcha') return void iniciar(a)
    if (destino === 'Listo') return setModal({ k: 'fin', id })
    if (destino === 'Devuelto') return setModal({ k: 'dev', id })
    await rpc('ag_estado', { p_id: id, p_estado: destino })
  }
  const abrir = (a: Act) => setModal({ k: 'detalle', id: a.id })
  const agrupar = (l: Act[]): [string, Act[]][] => {
    if (grupo === 'ninguna') return [['Todas las actividades', l]]
    const clave = (a: Act) => grupo === 'estado' ? a.estado : grupo === 'prioridad' ? a.prioridad : grupo === 'fecha' ? (a.fecha ? dfecha(a.fecha) : 'Sin fecha') : (a.delegado || a.creador || 'Sin responsable')
    const m = new Map<string, Act[]>(); l.forEach((a) => { const k = clave(a); m.set(k, [...(m.get(k) ?? []), a]) })
    const orden = grupo === 'estado' ? ESTADOS : grupo === 'prioridad' ? PRIORIDADES : null
    return orden ? orden.map((o) => [o, m.get(o) ?? []] as [string, Act[]]) : [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
  }
  const Tarjeta = ({ a }: { a: Act }) => {
    const venc = ['Por hacer', 'En marcha', 'Pausado'].includes(a.estado) && a.fecha && a.fecha < hoy, corriendo = a.estado === 'En marcha' && a.sesion?.por === yo
    return (
      <article className={'card ' + (a.prioridad === 'Urgente' ? 'p-urg' : a.prioridad === 'Importante' ? 'p-imp' : '') + (arrastrando === a.id ? ' drag' : '')} draggable={editar} onDragStart={(e) => { setArrastrando(a.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', a.id) } catch { /* nada */ } }} onDragEnd={() => { setArrastrando(null); setSobre(null) }} onClick={() => abrir(a)}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}><span className={'pill e-' + slug(a.estado)}>{a.estado}</span>{a.tipo === 'Reunión' && <span className="pill" style={{ background: '#e0f2fe', color: '#0369a1' }}>Reunión</span>}{a.prioridad !== 'Normal' && <span className="pill" style={a.prioridad === 'Urgente' ? { background: '#fdecec', color: '#c0392b' } : { background: '#fff1e0', color: '#b45309' }}>{a.prioridad}</span>}</div>
        <p className="t">{a.descripcion}</p>
        <div className="meta">{a.proyecto && <span><FolderKanban />{a.proyecto}</span>}{a.fecha && <span style={venc ? { color: '#c0392b', fontWeight: 700 } : undefined}><Calendar />{dfecha(a.fecha)}{a.hora ? ' ' + a.hora : ''}</span>}{a.delegadoId && a.delegadoId !== a.creadoPorId && <span><Users />{a.delegadoId === yo ? 'De ' + a.creador : a.delegado}</span>}{a.segundos > 0 || corriendo ? <span><Clock />{corto(segTimer(a))}</span> : null}</div>
        {editar && ['Por hacer', 'Pausado', 'Devuelto', 'En marcha'].includes(a.estado) && respId(a) === yo && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
            {corriendo ? <button className="btn" onClick={() => pausar(a)}><Pause />Pausar</button> : <button className="btn btn-p" onClick={() => iniciar(a)}><Play />Iniciar</button>}
            <button className="btn btn-ok" onClick={() => setModal({ k: 'fin', id: a.id })}><Check />Listo</button></div>
        )}
      </article>
    )
  }

  const grupos = agrupar(lista)
  const esDeleg = scope === 'delegadas' && !verEquipo
  const sonar = () => { if (!sonido) return; try { const c = new (window.AudioContext || (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(), o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(880, c.currentTime); o.frequency.setValueAtTime(1320, c.currentTime + 0.08); g.gain.setValueAtTime(0.12, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.3) } catch { /* sin audio */ } }
  return (
    <div className="vm-ag" onClick={() => setMenu('')}>
      <header className="hdr"><div className="hdr-in">
        <div style={{ minWidth: 0, marginRight: 6 }}><h1 className="font-display" style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.15 }}>Agenda Vimedic</h1><p style={{ fontSize: 11, color: 'rgba(255,255,255,.65)' }}>{perfil.nombre}</p></div>
        <div className="buscar"><Search /><input placeholder="Buscar actividad, persona o proyecto…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
          <button className="tool" title="Filtros" onClick={() => setMenu(menu === 'filtros' ? '' : 'filtros')}><SlidersHorizontal />{Object.values(f).filter(Boolean).length > 0 && <span className="bad">{Object.values(f).filter(Boolean).length}</span>}</button>
          {menu === 'filtros' && <div className="pop" style={{ left: 0, right: 'auto' }}><h4>Filtros</h4>
            <label className="fld">Proyecto<select className="inp" value={f.proyecto} onChange={(e) => setF({ ...f, proyecto: e.target.value })}><option value="">Todos los proyectos</option>{proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><label className="fld">Estado<select className="inp" value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Todos</option>{ESTADOS.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="fld">Prioridad<select className="inp" value={f.prioridad} onChange={(e) => setF({ ...f, prioridad: e.target.value })}><option value="">Todas</option>{PRIORIDADES.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="fld">Desde<input type="date" className="inp" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></label><label className="fld">Hasta<input type="date" className="inp" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></label></div>
            <button className="btn" onClick={() => setF({ proyecto: '', estado: '', prioridad: '', desde: '', hasta: '' })}>Limpiar filtros</button></div>}
        </div>
        <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
          <button className="tool" title="Agrupar" onClick={() => setMenu(menu === 'grupo' ? '' : 'grupo')}><Layers3 /></button>
          {menu === 'grupo' && <div className="pop" style={{ left: 0, right: 'auto' }}><h4>Agrupar actividades</h4>{([['estado', 'Estado', 'Por etapa de avance'], ['prioridad', 'Prioridad', 'Urgente, importante o normal'], ['fecha', 'Fecha', 'Por fecha programada'], ['persona', 'Responsable', 'Quién debe hacer cada tarea'], ['ninguna', 'Sin agrupación', 'Todas juntas']] as const).map(([k, t, s]) => <button key={k} className={'opt' + (grupo === k ? ' on' : '')} onClick={() => { setGrupo(k); setMenu('') }}><span><b>{t}</b><small>{s}</small></span></button>)}</div>}
        </div>
        <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
          <button className="tool" title="Cambiar vista" onClick={() => setMenu(menu === 'vista' ? '' : 'vista')}><LayoutGrid /></button>
          {menu === 'vista' && <div className="pop" style={{ left: 0, right: 'auto' }}><h4>Cambiar vista</h4>{([['kanban', 'Kanban', 'Por columnas', Columns3], ['tarjetas', 'Tarjetas', 'Vista visual compacta', LayoutGrid], ['tabla', 'Tabla', 'Información en filas', Table2], ['gantt', 'Gantt', 'Planificación en el tiempo', GanttChartSquare], ['calendario', 'Calendario', 'Organización por fecha', CalendarDays]] as const).map(([k, t, s, I]) => <button key={k} className={'opt' + (vista === k ? ' on' : '')} onClick={() => { setVista(k); setMenu('') }}><I /><span><b>{t}</b><small>{s}</small></span></button>)}</div>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button className="coin" title="Mis monedas y nivel" onClick={() => setMenu(menu === 'wallet' ? '' : 'wallet')}>🪙 {eco?.total ?? 0}<span className="lvl">Nv {eco?.nivel.numero ?? 1}</span></button>
            {menu === 'wallet' && eco && <div className="pop"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontSize: 30 }}>🪙</span><div><strong style={{ fontSize: 20 }}>{eco.total}</strong><small style={{ display: 'block', color: '#64748b' }}>monedas disponibles</small></div></div>
              <p style={{ fontWeight: 800, fontSize: 13, marginTop: 8 }}>Nivel {eco.nivel.numero} · {eco.nivel.nombre}</p><div className="bar" style={{ margin: '6px 0' }}><i style={{ width: eco.nivel.siguiente ? Math.min(100, (eco.nivel.dias - eco.nivel.minimo) / (eco.nivel.siguiente - eco.nivel.minimo) * 100) + '%' : '100%' }} /></div>
              <small style={{ color: '#64748b' }}>{eco.nivel.siguiente ? `${eco.nivel.siguiente - eco.nivel.dias} día(s) con tareas completadas para el siguiente nivel` : 'Nivel máximo'}</small>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, textAlign: 'center', margin: '10px 0' }}>{[['Hoy', eco.hoy], ['Racha', eco.racha], ['Días', eco.nivel.dias]].map(([t, n]) => <div key={t} style={{ background: '#f8fafc', borderRadius: 10, padding: 6 }}><b style={{ display: 'block', fontSize: 16 }}>{n}</b><span style={{ fontSize: 10, color: '#64748b' }}>{t}</span></div>)}</div>
              <button className="btn btn-p" style={{ width: '100%' }} onClick={() => { setMenu(''); setModal({ k: 'tienda' }) }}><Gift />Tienda de premios</button><div style={{ display: 'flex', gap: 6, marginTop: 8 }}><button className="btn" style={{ flex: 1 }} onClick={() => setEfectos(!efectos)}>Efectos: {efectos ? 'sí' : 'no'}</button><button className="btn" style={{ flex: 1 }} onClick={() => setSonido(!sonido)}>Sonido: {sonido ? 'sí' : 'no'}</button></div></div>}
          </div>
          <button className="tool" title="Alertas" onClick={() => setAlertas(alertas ? '' : vencidas.length ? 'vencidas' : devueltas.length ? 'devueltas' : 'revisar')}><Bell />{nAlertas > 0 && <span className="bad">{nAlertas}</span>}</button>
          {jefatura && <button className="tool" title="Proyectos" onClick={() => setModal({ k: 'proyectos' })}><FolderKanban /></button>}
          <button className="tool" title="Actualizar" onClick={() => { cargar(); cargarEco(); cargarProyectos() }}><RefreshCw /></button>
          {crear && <button className="nuevo" onClick={() => setModal({ k: 'form' })}><Plus />Nueva actividad</button>}
        </div>
      </div></header>
      <main style={{ padding: '12px 20px' }}>
        <div className="sub">
          <div className="scope">{([['mi', 'Mi agenda', UserRound], ['asignadas', 'Me asignaron', Inbox], ['delegadas', 'Delegadas', Send]] as const).map(([k, t, I]) => <button key={k} className={!verEquipo && scope === k ? 'on' : ''} onClick={() => { setScope(k); setVerEquipo(false) }}><I />{t} <b>{cuenta(k)}</b></button>)}
            {jefatura && <button className={verEquipo ? 'on' : ''} onClick={() => setVerEquipo(!verEquipo)}><UsersRound />Ver equipo</button>}</div>
          <div className="kpis">{kpis.map(([t, n, al]) => <div key={t} className={'kp' + (al ? ' al' : '')}><b>{n}</b><span>{t}</span></div>)}</div>
          <small style={{ color: '#64748b', marginLeft: 'auto' }}>{lista.length} actividad(es)</small>
        </div>
        {alertas && (
          <div className="alertas"><div className="tabs">{([['vencidas', '⏰ Vencidas', vencidas], ['devueltas', '↩️ Devueltas', devueltas], ...(revisar.length || jefatura ? [['revisar', '🔍 Por revisar', revisar]] : [])] as [string, string, Act[]][]).map(([k, t, l]) => <button key={k} className={alertas === k ? 'on' : ''} onClick={() => setAlertas(k as 'vencidas')}>{t} ({l.length})</button>)}<button style={{ marginLeft: 'auto' }} onClick={() => setAlertas('')} aria-label="Cerrar"><X /></button></div>
            <div style={{ padding: 10, display: 'grid', gap: 8, maxHeight: 320, overflow: 'auto' }}>{(alertas === 'vencidas' ? vencidas : alertas === 'devueltas' ? devueltas : revisar).map((a) => (
              <div key={a.id} className="card" style={{ marginBottom: 0 }} onClick={() => abrir(a)}><p className="t">{a.descripcion}</p><div className="meta"><span><Calendar />{dfecha(a.fecha)}</span>{alertas === 'devueltas' && <span>{a.devolucion.motivo}</span>}{alertas === 'revisar' && <span>Hecha por {a.delegado || a.creador}</span>}</div>
                {alertas === 'revisar' && <button className="btn btn-n" style={{ marginTop: 8 }} onClick={(e) => { e.stopPropagation(); setModal({ k: 'calif', id: a.id }) }}>Revisar</button>}</div>))}
              {!(alertas === 'vencidas' ? vencidas : alertas === 'devueltas' ? devueltas : revisar).length && <p style={{ color: '#94a3b8', fontSize: 13, padding: 8 }}>Todo al día.</p>}</div></div>
        )}
        {error && <p style={{ color: '#c0392b', fontWeight: 700, padding: 24 }}>{error}</p>}
        {acts === null && !error && <p style={{ color: '#94a3b8', padding: 24 }}><Spin /> Cargando actividades…</p>}
        {acts && !lista.length && !esDeleg && <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}><p style={{ fontWeight: 700 }}>No hay actividades en esta vista.</p></div>}
        {acts && esDeleg && <Delegadas lista={lista} abrir={abrir} revisar={(id) => setModal({ k: 'calif', id })} delegar={() => setModal({ k: 'form' })} hoy={hoy} />}
        {acts && !esDeleg && (vista === 'calendario' || vista === 'gantt') && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <button className="btn" onClick={() => { const d = new Date(anchor); if (vista === 'calendario') d.setMonth(d.getMonth() - 1); else d.setDate(d.getDate() - 28); setAnchor(d) }}><ChevronLeft /></button>
              <button className="btn" onClick={() => setAnchor(new Date())}>Hoy</button>
              <b style={{ minWidth: 150, textAlign: 'center', textTransform: 'capitalize' }}>{vista === 'calendario' ? anchor.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' }) : dfecha(ymd(anchor)) + ' · 28 días'}</b>
              <button className="btn" onClick={() => { const d = new Date(anchor); if (vista === 'calendario') d.setMonth(d.getMonth() + 1); else d.setDate(d.getDate() + 28); setAnchor(d) }}><ChevronRight /></button>
            </div>
            {vista === 'calendario' ? <Calendario lista={lista} anchor={anchor} hoy={hoy} abrir={abrir} nuevoDia={(d) => { if (crear) setModal({ k: 'form', fecha: d }) }} /> : <Gantt lista={lista} anchor={anchor} abrir={abrir} />}
          </>
        )}
        {acts && lista.length > 0 && vista === 'kanban' && !esDeleg && (
          <div className="board">{grupos.map(([k, l]) => (
            <section key={k} className={'col' + (sobre === k ? ' drop' : '')} onDragOver={(e) => { if (!arrastrando || grupo !== 'estado') return; e.preventDefault(); setSobre(k) }} onDragLeave={() => setSobre(null)} onDrop={(e) => { e.preventDefault(); setSobre(null); const id = arrastrando; setArrastrando(null); if (id && grupo === 'estado') mover(id, k) }}>
              <h5>{k}<span>{l.length}</span></h5>{l.map((a) => <Tarjeta key={a.id} a={a} />)}</section>))}</div>
        )}
        {acts && lista.length > 0 && vista === 'tarjetas' && !esDeleg && grupos.filter(([, l]) => l.length).map(([k, l]) => <div key={k} style={{ marginBottom: 18 }}><h5 style={{ fontWeight: 800, color: '#0b2545', margin: '4px 2px 8px' }}>{k} <span style={{ color: '#94a3b8', fontWeight: 600 }}>({l.length})</span></h5><div className="grid-t">{l.map((a) => <Tarjeta key={a.id} a={a} />)}</div></div>)}
        {acts && lista.length > 0 && vista === 'tabla' && !esDeleg && grupos.filter(([, l]) => l.length).map(([k, l]) => (
          <div key={k} style={{ marginBottom: 18, overflowX: 'auto' }}>{grupo !== 'ninguna' && <h5 style={{ fontWeight: 800, color: '#0b2545', margin: '4px 2px 8px' }}>{k} ({l.length})</h5>}
            <table className="tb"><thead><tr><th>Actividad</th><th>Estado</th><th>Prioridad</th><th>Proyecto</th><th>Responsable</th><th>Fecha</th><th>Tiempo</th></tr></thead><tbody>{l.map((a) => <tr key={a.id} onClick={() => abrir(a)}><td><b>{a.descripcion}</b></td><td><span className={'pill e-' + slug(a.estado)}>{a.estado}</span></td><td>{a.prioridad}</td><td>{a.proyecto || '—'}</td><td>{a.delegado || a.creador}</td><td>{a.fecha ? dfecha(a.fecha) + (a.hora ? ' ' + a.hora : '') : '—'}</td><td>{corto(segTimer(a))}</td></tr>)}</tbody></table></div>
        ))}
      </main>
      {timer && (
        <div className="timerbar"><div><div style={{ width: 36, height: 36, borderRadius: 99, background: 'var(--cyan)', display: 'grid', placeItems: 'center' }}><Timer /></div>
          <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'rgba(255,255,255,.6)' }}>Trabajando en</div><div style={{ fontWeight: 800, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{timer.descripcion}</div></div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{reloj(segTimer(timer))}</div>
          <button className="tool" title="Pausar" onClick={() => pausar(timer)}><Pause /></button><button className="tool" style={{ background: 'var(--teal)' }} title="Finalizar" onClick={() => setModal({ k: 'fin', id: timer.id })}><Check /></button></div></div>
      )}
      {modal?.k === 'form' && <Formulario fechaIni={modal.fecha} act={modal.act} emps={emps} proyectos={proyectos.filter((p) => p.estado === 'Activo')} perfil={perfil} aviso={aviso} cerrar={() => setModal(null)} guardado={async () => { setModal(null); await cargar(); cargarEco() }} recargarProyectos={cargarProyectos} jefatura={jefatura} />}
      {modal?.k === 'detalle' && (() => { const a = A.find((x) => x.id === modal.id); return a ? <Detalle a={a} yo={yo} jefatura={jefatura} editar={editar} aviso={aviso} segTimer={segTimer} cerrar={() => setModal(null)} act={{ iniciar: () => iniciar(a), pausar: () => pausar(a), fin: () => setModal({ k: 'fin', id: a.id }), dev: () => setModal({ k: 'dev', id: a.id }), calif: () => setModal({ k: 'calif', id: a.id }), editarForm: () => setModal({ k: 'form', act: a }), cancelar: async () => { if (confirm('¿Cancelar esta actividad?')) { await rpc('ag_estado', { p_id: a.id, p_estado: 'Cancelado' }, 'Actividad cancelada'); setModal(null) } } }} /> : null })()}
      {modal?.k === 'fin' && (() => { const a = A.find((x) => x.id === modal.id); return a ? <Finalizar a={a} perfil={perfil} segTimer={segTimer} aviso={aviso} cerrar={() => setModal(null)} listo={async (p) => { const r = await rpc('ag_finalizar', { p_id: a.id, p }); if (r) { setModal(null); cargarEco(); { if ((r as { monedaGanada?: boolean }).monedaGanada) { aviso('¡Actividad lista! Ganaste 1 moneda 🪙'); sonar(); if (efectos) setFx(true) } else aviso('Actividad lista') } } }} /> : null })()}
      {modal?.k === 'dev' && (() => { const a = A.find((x) => x.id === modal.id); return a ? <Devolver a={a} emps={emps} cerrar={() => setModal(null)} listo={async (p) => { const r = await rpc('ag_devolver', { p_id: a.id, p }, 'Actividad devuelta'); if (r) setModal(null) }} /> : null })()}
      {modal?.k === 'calif' && (() => { const a = A.find((x) => x.id === modal.id); return a ? <Calificar a={a} cerrar={() => setModal(null)} aprobar={async (c) => { const r = await rpc('ag_calificar', { p_id: a.id, p_calificacion: 'Aprobado', p_comentario: c }, 'Actividad aprobada'); if (r) setModal(null) }} corregir={() => setModal({ k: 'dev', id: a.id })} /> : null })()}
      {modal?.k === 'proyectos' && <Proyectos proyectos={proyectos} emps={emps} perfil={perfil} aviso={aviso} cerrar={() => setModal(null)} cambio={cargarProyectos} eliminar={puede(perfil, 'agenda', 'eliminar')} />}
      {fx && <div style={{ position: 'fixed', left: '50%', top: '40%', zIndex: 300, fontSize: 64, pointerEvents: 'none', animation: 'agfly 1.5s ease-out forwards' }}>🪙 +1</div>}
      {visor && <Visor v={visor} cerrar={() => setVisor(null)} mover={(d) => setVisor((x) => (x ? { ...x, i: (x.i + d + x.lista.length) % x.lista.length } : x))} />}
      {modal?.k === 'tienda' && <Tienda eco={eco} aviso={aviso} cerrar={() => setModal(null)} recargar={cargarEco} />}
    </div>
  )
}

/* ============================ Evidencias ============================ */
function Evidencias({ valor, set, perfil, aviso }: { valor: string; set: (v: string) => void; perfil: Perfil; aviso: (t: string) => void }) {
  const items = valor.split('\n').filter(Boolean)
  const [subiendo, setSubiendo] = useState(false)
  const [enlace, setEnlace] = useState('')
  async function subir(files: File[]) {
    setSubiendo(true); const nuevos: string[] = []
    for (const fl of files) {
      if (fl.size > 25 * 1048576) { aviso(`${fl.name}: supera 25 MB`); continue }
      const ruta = `${perfil.id}/${Date.now()}_${fl.name.replace(/[^\w.-]/g, '_').slice(0, 60)}`
      const { error } = await supabase.storage.from('agenda').upload(ruta, fl, { contentType: fl.type || 'application/octet-stream' })
      if (error) { aviso(error.message); continue } nuevos.push('agenda:' + ruta)
    }
    set([...items, ...nuevos].join('\n')); setSubiendo(false)
  }
  async function abrir(u: string) { if (u.startsWith('agenda:')) { const { data } = await supabase.storage.from('agenda').createSignedUrl(u.slice(7), 600); if (data) window.open(data.signedUrl, '_blank', 'noopener') } else window.open(u, '_blank', 'noopener') }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <label className="btn" style={{ cursor: 'pointer' }}><Paperclip />Adjuntar archivos<input type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; subir(f) }} /></label>
        <label className="btn" style={{ cursor: 'pointer' }}>Tomar foto<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; subir(f) }} /></label>
        <input className="inp" style={{ flex: 1, minWidth: 140 }} placeholder="Pegar enlace (Drive, web…)" value={enlace} onChange={(e) => setEnlace(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && /^https?:\/\//.test(enlace)) { e.preventDefault(); set([...items, enlace].join('\n')); setEnlace('') } }} />
        {subiendo && <Spin />}</div>
      <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>{items.map((u, i) => <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}><button className="btn" onClick={() => abrir(u)} style={{ flex: 1, justifyContent: 'flex-start', overflow: 'hidden' }}>{u.startsWith('agenda:') ? u.split('/').pop()?.replace(/^\d+_/, '') : u}</button><button className="btn btn-red" onClick={() => set(items.filter((_, j) => j !== i).join('\n'))} aria-label="Quitar"><X /></button></div>)}</div>
    </div>
  )
}

/* ============================ Formulario ============================ */
function Formulario({ fechaIni, act, emps, proyectos, perfil, aviso, cerrar, guardado, recargarProyectos, jefatura }: { fechaIni?: string; act?: Act; emps: Emp[]; proyectos: Proyecto[]; perfil: Perfil; aviso: (t: string) => void; cerrar: () => void; guardado: () => Promise<void>; recargarProyectos: () => Promise<void>; jefatura: boolean }) {
  void jefatura
  const edit = !!act
  const [tipo, setTipo] = useState(act?.tipo === 'Reunión' ? 'Reunión' : 'Tarea')
  const [desc, setDesc] = useState(act?.descripcion ?? '')
  const [detalle, setDetalle] = useState(act?.detalle ?? '')
  const [quien, setQuien] = useState<'yo' | 'personas' | 'area'>(act?.delegada ? 'personas' : 'yo')
  const [sel, setSel] = useState<string[]>(act?.delegadoId ? [act.delegadoId] : [])
  const [area, setArea] = useState('')
  const [buscar, setBuscar] = useState('')
  const [supervisar, setSupervisar] = useState(act ? act.supervisar : true)
  const [fecha, setFecha] = useState(act?.fecha ?? fechaIni ?? '')
  const [hora, setHora] = useState(act?.hora ?? '')
  const [dur, setDur] = useState(act?.duracion || 30)
  const [prio, setPrio] = useState(act?.prioridad ?? 'Normal')
  const [ubic, setUbic] = useState(act?.ubicacion === 'En un proyecto' ? 'En un proyecto' : 'En mi día a día')
  const [proy, setProy] = useState(act?.proyectoId ?? '')
  const [nuevoProy, setNuevoProy] = useState('')
  const [ev, setEv] = useState(act?.evidencia ?? '')
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  const areas = [...new Set(emps.map((e) => e.area))].sort()
  const palabras = desc.trim().split(/\s+/).filter(Boolean).length
  const rapidas: [string, number][] = [['Hoy', 0], ['Mañana', 1], ['En 3 días', 3], ['En 1 semana', 7]]
  async function guardar() {
    if (!desc.trim()) { setErr('Describe brevemente qué vas a hacer.'); return }
    if (ubic === 'En un proyecto' && !proy && !nuevoProy.trim()) { setErr('Selecciona a qué proyecto pertenece la actividad.'); return }
    let destinatarios: string[] = []
    if (quien === 'personas') destinatarios = sel; else if (quien === 'area') destinatarios = emps.filter((e) => e.area === area).map((e) => e.id)
    if (quien !== 'yo' && !destinatarios.length) { setErr('Selecciona a quién o a qué área se delega la actividad.'); return }
    setOcupado(true); setErr('')
    try {
      let proyectoId = ubic === 'En un proyecto' ? proy : ''
      if (ubic === 'En un proyecto' && !proyectoId && nuevoProy.trim()) {
        const id = crypto.randomUUID(); const { error } = await supabase.from('proyectos').insert({ id, codigo: 'PRY-' + id.slice(0, 8).toUpperCase(), nombre: nuevoProy.trim(), estado: 'Activo', responsable_id: perfil.id, creado_por: perfil.id }); if (error) throw new Error(error.message)
        proyectoId = id; await recargarProyectos()
      }
      const base = { descripcion: desc.trim().slice(0, 200), ubicacion: ubic, proyecto_id: proyectoId || null, tipo, fecha_programada: fecha || null, hora: hora || null, duracion_min: tipo === 'Reunión' ? dur : null, prioridad: prio, detalle: detalle || null, evidencia_url: ev || null }
      if (edit && act) {
        const r = await supabase.from('actividades').update({ ...base, delegada: quien !== 'yo', delegado_a_id: quien !== 'yo' ? destinatarios[0] : null, requiere_supervision: quien !== 'yo' && supervisar }).eq('id', act.id)
        if (r.error) throw new Error(r.error.message)
      } else {
        const filas = (quien === 'yo' ? [null] : destinatarios).map((d) => { const id = crypto.randomUUID(); return { id, codigo: 'ACT-' + id.slice(0, 8).toUpperCase(), ...base, realiza_id: d ?? perfil.id, delegada: quien !== 'yo', delegado_a_id: d, estado: 'Por hacer', requiere_supervision: quien !== 'yo' && supervisar, origen: 'Manual', creado_por: perfil.id } })
        const r = await supabase.from('actividades').insert(filas); if (r.error) throw new Error(r.error.message)
        // aviso a cada persona a la que se delegó
        const avisos = filas.filter((x) => x.delegado_a_id && x.delegado_a_id !== perfil.id).map((x) => ({ id: crypto.randomUUID(), para_id: x.delegado_a_id, modulo: 'agenda', evento: 'delegada', tipo: 'aviso', texto: `${perfil.nombre} te delegó una actividad: "${base.descripcion}"`, entidad: 'actividades', entidad_id: x.id }))
        if (avisos.length) await supabase.from('notificaciones').insert(avisos)
        aviso(filas.length > 1 ? `${filas.length} actividades creadas` : 'Actividad creada')
      }
      await guardado()
    } catch (e) { setOcupado(false); setErr((e as Error).message) }
  }
  return (
    <Modal titulo={edit ? 'Editar actividad' : 'Nueva actividad'} cerrar={cerrar} pie={<><button className="btn" style={{ flex: 1 }} onClick={cerrar}>Cancelar</button><button className="btn btn-p" style={{ flex: 1 }} disabled={ocupado} onClick={guardar}>{ocupado ? <Spin /> : 'Guardar actividad'} <span className="pill" style={{ background: '#fff7d6', color: '#a16207' }}>×1 🪙</span></button></>}>
      <div className="sec"><h4><span className="num">1</span>¿Qué vas a hacer? <small style={{ marginLeft: 'auto', color: palabras > 4 ? '#c98a1f' : '#94a3b8' }}>máx. 4 palabras · {palabras}/4</small></h4>
        <Seg ops={['Tarea', 'Reunión']} v={tipo} set={setTipo} />
        <input className="inp" style={{ marginTop: 8, fontWeight: 700 }} maxLength={60} placeholder="Ej: Llamar cliente pendiente" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <textarea className="inp" style={{ marginTop: 8 }} rows={4} placeholder="Detalles: instrucciones, contexto, datos del cliente, lo que necesites…" value={detalle} onChange={(e) => setDetalle(e.target.value)} /></div>
      <div className="sec"><h4><span className="num">2</span>¿Quién la hace?</h4>
        <Seg ops={['Yo', 'Personas', 'Un área']} v={quien === 'yo' ? 'Yo' : quien === 'personas' ? 'Personas' : 'Un área'} set={(x) => setQuien(x === 'Yo' ? 'yo' : x === 'Personas' ? 'personas' : 'area')} />
        {quien === 'personas' && <div style={{ marginTop: 8 }}><input className="inp" placeholder="Buscar persona…" value={buscar} onChange={(e) => setBuscar(e.target.value)} /><div className="people" style={{ marginTop: 6 }}>{emps.filter((e) => norm(e.nombre + e.area).includes(norm(buscar))).map((e) => <label key={e.id}><input type="checkbox" disabled={edit} checked={sel.includes(e.id)} onChange={(x) => setSel(x.target.checked ? [...sel, e.id] : sel.filter((i) => i !== e.id))} />{e.nombre}<small style={{ marginLeft: 'auto', color: '#94a3b8' }}>{e.area}</small></label>)}</div>{edit && <small style={{ color: '#64748b' }}>Al editar solo se cambia un destinatario.</small>}</div>}
        {quien === 'area' && <div className="seg" style={{ marginTop: 8 }}>{areas.map((a) => <button key={a} type="button" className={area === a ? 'on' : ''} onClick={() => setArea(a)}>{a} ({emps.filter((e) => e.area === a).length})</button>)}</div>}
        {quien !== 'yo' && <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 13 }}><input type="checkbox" checked={supervisar} onChange={(e) => setSupervisar(e.target.checked)} />Revisar antes de darla por cerrada <small style={{ color: '#94a3b8' }}>(te llega a "Por revisar")</small></label>}</div>
      <div className="sec"><h4><span className="num">3</span>¿Para cuándo?</h4>
        <div className="seg"><button type="button" className={!fecha ? 'on' : ''} onClick={() => { setFecha(''); setHora('') }}>Sin fecha</button>{rapidas.map(([t, d]) => <button key={t} type="button" className={fecha === ymd(Date.now() + d * 864e5) ? 'on' : ''} onClick={() => setFecha(ymd(Date.now() + d * 864e5))}>{t}</button>)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}><input type="date" className="inp" value={fecha} onChange={(e) => setFecha(e.target.value)} /><input type="time" className="inp" value={hora} onChange={(e) => setHora(e.target.value)} /></div>
        {tipo === 'Reunión' && <div style={{ marginTop: 8 }}><p className="fld" style={{ marginBottom: 4 }}>Duración</p><div className="seg">{[[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1 h 30'], [120, '2 h']].map(([m, t]) => <button key={m} type="button" className={dur === m ? 'on' : ''} onClick={() => setDur(m as number)}>{t}</button>)}</div></div>}</div>
      <div className="sec"><h4><span className="num">4</span>Prioridad y ubicación</h4>
        <Seg ops={['Normal', 'Importante', 'Urgente']} v={prio} set={setPrio} />
        <div style={{ marginTop: 8 }}><Seg ops={['En mi día a día', 'En un proyecto']} v={ubic} set={setUbic} /></div>
        {ubic === 'En un proyecto' && <div style={{ marginTop: 8, display: 'grid', gap: 6 }}><select className="inp" value={proy} onChange={(e) => setProy(e.target.value)}><option value="">— Elegir proyecto —</option>{proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>{!proy && <input className="inp" placeholder="…o crea un proyecto nuevo" value={nuevoProy} onChange={(e) => setNuevoProy(e.target.value)} />}</div>}</div>
      <div className="sec"><h4><Paperclip />Archivos y evidencias (opcional)</h4><Evidencias valor={ev} set={setEv} perfil={perfil} aviso={aviso} /></div>
      {err && <p style={{ color: '#c0392b', fontSize: 12.5 }}>{err}</p>}
    </Modal>
  )
}

/* ============================ Detalle y cierre ============================ */
function Detalle({ a, yo, jefatura, editar, aviso, segTimer, cerrar, act }: { a: Act; yo: string; jefatura: boolean; editar: boolean; aviso: (t: string) => void; segTimer: (a: Act) => number; cerrar: () => void; act: { iniciar: () => void; pausar: () => void; fin: () => void; dev: () => void; calif: () => void; editarForm: () => void; cancelar: () => void } }) {
  const esResp = respId(a) === yo, esCreador = a.creadoPorId === yo, corriendo = a.estado === 'En marcha' && a.sesion?.por === yo
  const abierta = !['Listo', 'Cancelado'].includes(a.estado)
  const puedeEditar = editar && (esCreador || jefatura) && abierta && !(a.delegadoId && a.delegadoId !== a.creadoPorId && !['Por hacer', 'Devuelto'].includes(a.estado))
  async function abrirEv(u: string, lista?: string[]) { const l = lista ?? [u]; window.dispatchEvent(new CustomEvent('ag-visor', { detail: { lista: l, i: Math.max(0, l.indexOf(u)) } })) }
  void aviso
  const kv = (k: string, v: React.ReactNode) => (v ? <><dt>{k}</dt><dd>{v}</dd></> : null)
  const evs = (t: string) => t.split('\n').filter(Boolean)
  return (
    <Modal titulo={a.descripcion} cerrar={cerrar} ancho={520} pie={abierta ? <>
      {puedeEditar && <button className="btn" onClick={act.editarForm}><Pencil />Editar</button>}
      {esResp && editar && (corriendo ? <button className="btn" onClick={act.pausar}><Pause />Pausar</button> : <button className="btn btn-p" onClick={act.iniciar}><Play />Iniciar</button>)}
      {esResp && editar && <button className="btn btn-ok" onClick={act.fin}><Check />Marcar listo</button>}
      {(esCreador || jefatura) && editar && a.delegadoId && a.delegadoId !== yo && a.estado === 'Listo' ? null : null}
      {(esCreador || esResp || jefatura) && editar && <button className="btn btn-red" onClick={act.cancelar}><XCircle />Cancelar</button>}</> : a.estado === 'Listo' && a.supervisar && (esCreador || jefatura) ? <button className="btn btn-n" style={{ flex: 1 }} onClick={act.calif}>Revisar actividad</button> : undefined}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><span className={'pill e-' + slug(a.estado)}>{a.estado}</span><span className="pill" style={{ background: '#eef2f6', color: '#475569' }}>{a.prioridad}</span>{a.tipo === 'Reunión' && <span className="pill" style={{ background: '#e0f2fe', color: '#0369a1' }}>Reunión</span>}</div>
      <dl className="kv">{kv('Proyecto', a.proyecto)}{kv('Fecha', a.fecha ? dfecha(a.fecha) + (a.hora ? ' · ' + a.hora : '') : '')}{kv('Responsable', a.delegado || a.creador)}{kv('Creada por', a.creador)}{kv('Tiempo trabajado', segTimer(a) ? corto(segTimer(a)) + (a.inicios ? ` · ${a.inicios} inicio(s)` : '') : '')}{kv('Detalle', a.detalle && <span style={{ whiteSpace: 'pre-wrap' }}>{a.detalle}</span>)}</dl>
      {a.estado === 'Devuelto' && <div className="sec" style={{ borderColor: '#f5c6c0', background: '#fff7f6' }}><h4 style={{ color: '#c0392b' }}>↩️ Devuelta para corregir</h4><dl className="kv">{kv('Motivo', a.devolucion.motivo)}{kv('Qué corregir', a.devolucion.comentario)}{kv('Para el', a.devolucion.fecha_limite && dfecha(a.devolucion.fecha_limite))}</dl></div>}
      {a.estado === 'Listo' && <div className="sec" style={{ borderColor: '#9ae6c7' }}><h4 style={{ color: '#04896f' }}>✅ Resultado</h4><p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{a.resultado}</p>{a.quedoPendiente && <p style={{ fontSize: 12, color: '#a16207' }}>Quedó pendiente{a.fechaRetomar ? ' · retomar el ' + dfecha(a.fechaRetomar) : ''}</p>}{a.comentarioCalif && <p style={{ fontSize: 12, color: '#64748b' }}>Revisión: {a.comentarioCalif}</p>}</div>}
      {[...evs(a.evidencia), ...evs(a.evidenciaFinal)].length > 0 && <div className="sec"><h4><Paperclip />Evidencias</h4><div style={{ display: 'grid', gap: 4 }}>{[...evs(a.evidencia), ...evs(a.evidenciaFinal)].map((u, i) => <button key={i} className="btn" style={{ justifyContent: 'flex-start', overflow: 'hidden' }} onClick={() => abrirEv(u, [...evs(a.evidencia), ...evs(a.evidenciaFinal)])}>{u.startsWith('agenda:') ? u.split('/').pop()?.replace(/^\d+_/, '') : u}</button>)}</div></div>}
    </Modal>
  )
}

function Finalizar({ a, perfil, segTimer, aviso, cerrar, listo }: { a: Act; perfil: Perfil; segTimer: (a: Act) => number; aviso: (t: string) => void; cerrar: () => void; listo: (p: Record<string, unknown>) => Promise<void> }) {
  const base = Math.floor(segTimer(a))
  const [res, setRes] = useState('')
  const [h, setH] = useState(String(Math.floor(base / 3600)))
  const [m, setM] = useState(String(Math.floor((base % 3600) / 60)))
  const [pend, setPend] = useState('No')
  const [retomar, setRetomar] = useState('')
  const [ev, setEv] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  return (
    <Modal titulo="✅ Finalizar actividad" cerrar={cerrar} pie={<><button className="btn" style={{ flex: 1 }} onClick={cerrar}>Cancelar</button><button className="btn btn-ok" style={{ flex: 1 }} disabled={ocupado} onClick={async () => {
      if (!res.trim()) { setErr('Describe brevemente el resultado obtenido.'); return } setOcupado(true)
      await listo({ resultado: res, quedoPendiente: pend, fechaRetomar: retomar, evidenciaFinal: ev, segundos: (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 }); setOcupado(false) }}>{ocupado ? <Spin /> : 'Marcar como Listo'}</button></>}>
      <p style={{ fontWeight: 700 }}>{a.descripcion}</p>
      <label className="fld">¿Cómo te fue?<textarea className="inp" rows={3} placeholder="Describe brevemente el resultado obtenido." value={res} onChange={(e) => setRes(e.target.value)} /></label>
      <div className="sec"><h4><Clock />Tiempo trabajado <span style={{ marginLeft: 'auto', fontFamily: 'IBM Plex Mono' }}>{reloj(base)}</span></h4><small style={{ color: '#94a3b8' }}>Se toma del cronómetro. Si deseas corregirlo, usa horas y minutos.</small>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}><input className="inp" type="number" min={0} style={{ width: 80 }} value={h} onChange={(e) => setH(e.target.value)} /> h <input className="inp" type="number" min={0} max={59} style={{ width: 80 }} value={m} onChange={(e) => setM(e.target.value)} /> min
          {[15, 30, 60, 120].map((x) => <button key={x} type="button" className="btn" onClick={() => { setH(String(Math.floor(x / 60))); setM(String(x % 60)) }}>{x >= 60 ? x / 60 + ' h' : x + ' min'}</button>)}</div></div>
      <label className="fld">¿Quedó algo pendiente?<Seg ops={['Sí', 'No']} v={pend} set={setPend} /></label>
      {pend === 'Sí' && <label className="fld">¿Cuándo deseas retomarlo?<input type="date" className="inp" value={retomar} onChange={(e) => setRetomar(e.target.value)} /></label>}
      <div><p className="fld" style={{ marginBottom: 4 }}>📎 Entrega / evidencia final</p><Evidencias valor={ev} set={setEv} perfil={perfil} aviso={aviso} /></div>
      {err && <p style={{ color: '#c0392b', fontSize: 12.5 }}>{err}</p>}
    </Modal>
  )
}

function Devolver({ a, emps, cerrar, listo }: { a: Act; emps: Emp[]; cerrar: () => void; listo: (p: Record<string, unknown>) => Promise<void> }) {
  const [motivo, setMotivo] = useState(MOTIVOS_DEV[0])
  const [com, setCom] = useState('')
  const [quien, setQuien] = useState(a.delegadoId ?? a.creadoPorId ?? '')
  const [lim, setLim] = useState('')
  const [ev, setEv] = useState('')
  const [ocupado, setOcupado] = useState(false)
  return (
    <Modal titulo="↩️ Devolver actividad" cerrar={cerrar} pie={<><button className="btn" style={{ flex: 1 }} onClick={cerrar}>Cancelar</button><button className="btn btn-red" style={{ flex: 1 }} disabled={ocupado} onClick={async () => { setOcupado(true); await listo({ motivo, comentario: com, aQuien: quien, fechaLimite: lim, evidencia: ev }); setOcupado(false) }}>{ocupado ? <Spin /> : 'Devolver'}</button></>}>
      <p style={{ fontWeight: 700 }}>{a.descripcion}</p>
      <label className="fld">¿Por qué se devuelve?<select className="inp" value={motivo} onChange={(e) => setMotivo(e.target.value)}>{MOTIVOS_DEV.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label className="fld">¿Qué necesita corregirse o completarse?<textarea className="inp" rows={3} placeholder="Sé específico para que la persona sepa exactamente qué hacer." value={com} onChange={(e) => setCom(e.target.value)} /></label>
      <label className="fld">¿A quién se devuelve?<select className="inp" value={quien} onChange={(e) => setQuien(e.target.value)}><option value="">— Elegir —</option>{emps.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
      <label className="fld">¿Para cuándo debe estar corregida?<input type="date" className="inp" value={lim} onChange={(e) => setLim(e.target.value)} /></label>
      <label className="fld">📎 Evidencia o respaldo<input className="inp" placeholder="Enlace opcional" value={ev} onChange={(e) => setEv(e.target.value)} /></label>
    </Modal>
  )
}
function Calificar({ a, cerrar, aprobar, corregir }: { a: Act; cerrar: () => void; aprobar: (c: string) => Promise<void>; corregir: () => void }) {
  const [c, setC] = useState('')
  return (
    <Modal titulo="🔍 Revisar actividad" cerrar={cerrar} ancho={460} pie={<><button className="btn btn-red" style={{ flex: 1 }} onClick={corregir}>🛠️ Pedir corrección</button><button className="btn btn-ok" style={{ flex: 1 }} onClick={() => aprobar(c)}>✅ Aprobar</button></>}>
      <div style={{ background: '#f8fafc', borderRadius: 10, padding: 10, fontSize: 12.5 }}><b>{a.descripcion}</b><p style={{ marginTop: 4 }}>Resultado: {a.resultado}</p><p>Tiempo: {corto(a.segundos)}</p></div>
      <textarea className="inp" rows={2} placeholder="Comentario (opcional para aprobar)" value={c} onChange={(e) => setC(e.target.value)} />
    </Modal>
  )
}

/* ============================ Proyectos ============================ */
function Proyectos({ proyectos, emps, perfil, aviso, cerrar, cambio, eliminar }: { proyectos: Proyecto[]; emps: Emp[]; perfil: Perfil; aviso: (t: string) => void; cerrar: () => void; cambio: () => Promise<void>; eliminar: boolean }) {
  const [id, setId] = useState('')
  const [nombre, setNombre] = useState('')
  const [areasSel, setAreasSel] = useState<string[]>([])
  const [estado, setEstado] = useState('Activo')
  const areas = [...new Set(emps.map((e) => e.area))].sort()
  async function guardar() {
    if (!nombre.trim()) { aviso('El nombre del proyecto es obligatorio.'); return }
    const campos = { nombre: nombre.trim(), estado, areas: areasSel }
    const r = id ? await supabase.from('proyectos').update(campos).eq('id', id) : await supabase.from('proyectos').insert({ id: crypto.randomUUID(), codigo: 'PRY-' + crypto.randomUUID().slice(0, 8).toUpperCase(), ...campos, responsable_id: perfil.id, creado_por: perfil.id })
    if (r.error) { aviso(r.error.message); return } setId(''); setNombre(''); setAreasSel([]); setEstado('Activo'); await cambio(); aviso('Proyecto guardado')
  }
  async function borrar(p: Proyecto) { if (!confirm(`¿Eliminar el proyecto "${p.nombre}"? Se puede restaurar.`)) return; const { error } = await supabase.from('proyectos').update({ deleted_at: new Date().toISOString() }).eq('id', p.id); if (error) { aviso(error.message); return } await cambio() }
  return (
    <Modal titulo="📌 Proyectos" cerrar={cerrar}>
      <div className="sec"><input className="inp" placeholder="Nombre del proyecto" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <p className="fld" style={{ margin: '8px 0 4px' }}>Áreas involucradas (solo ellas lo verán — vacío = todos)</p><div className="seg">{areas.map((x) => <button key={x} type="button" className={areasSel.includes(x) ? 'on' : ''} onClick={() => setAreasSel(areasSel.includes(x) ? areasSel.filter((y) => y !== x) : [...areasSel, x])}>{x}</button>)}</div>
        {id && <div style={{ marginTop: 8 }}><Seg ops={['Activo', 'Pausado', 'Cerrado']} v={estado} set={setEstado} /></div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>{id && <button className="btn" onClick={() => { setId(''); setNombre(''); setAreasSel([]); setEstado('Activo') }}>Cancelar</button>}<button className="btn btn-p" style={{ flex: 1 }} onClick={guardar}>{id ? 'Guardar cambios' : 'Crear proyecto'}</button></div></div>
      {proyectos.map((p) => <div key={p.id} className="sec" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ flex: 1, minWidth: 0 }}><b>{p.nombre}</b><div style={{ fontSize: 11.5, color: '#64748b' }}>{p.estado}{p.areas.length ? ' · ' + p.areas.join(', ') : ' · todos'}{p.responsable ? ' · ' + p.responsable : ''}</div></div>
        <button className="btn" onClick={() => { setId(p.id); setNombre(p.nombre); setAreasSel(p.areas); setEstado(p.estado) }}><Pencil /></button>{eliminar && <button className="btn btn-red" onClick={() => borrar(p)}><Trash2 /></button>}</div>)}
    </Modal>
  )
}

/* ============================ Tienda de premios ============================ */
function Tienda({ eco, aviso, cerrar, recargar }: { eco: Eco | null; aviso: (t: string) => void; cerrar: () => void; recargar: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState('')
  const [edit, setEdit] = useState<{ id: string; emoji: string; nombre: string; costo: string; categoria: string; activo: boolean } | null>(null)
  if (!eco) return null
  async function canjear(id: string, nombre: string, costo: number) {
    if (!confirm(`¿Canjear "${nombre}" por ${costo} monedas?`)) return
    setOcupado(id); const { error } = await supabase.rpc('ag_canjear', { p_premio: id, p_nota: '' }); setOcupado('')
    if (error) { aviso(error.message); return } aviso('¡Canje registrado! Quien administra la tienda lo entregará.'); recargar()
  }
  async function gestionar(id: string, accion: string) { const { error } = await supabase.rpc('ag_gestionar_canje', { p_id: id, p_accion: accion }); if (error) { aviso(error.message); return } aviso(accion === 'Entregado' ? 'Marcado como entregado' : 'Canje cancelado y monedas devueltas'); recargar() }
  async function guardarPremio() {
    if (!edit) return; const costo = Number(edit.costo)
    if (!edit.nombre.trim() || !(costo >= 1) || Math.floor(costo) !== costo) { aviso('Completa nombre y un costo entero.'); return }
    const campos = { emoji: edit.emoji || '🎁', nombre: edit.nombre.trim(), costo, categoria: edit.categoria || 'Otros', activo: edit.activo }
    const r = edit.id ? await supabase.from('premios_agenda').update(campos).eq('id', edit.id) : await supabase.from('premios_agenda').insert({ id: crypto.randomUUID(), codigo: 'PREMIO-' + crypto.randomUUID().slice(0, 8), ...campos })
    if (r.error) { aviso(r.error.message); return } setEdit(null); recargar()
  }
  return (
    <Modal titulo={<>🎁 Tienda de premios <span className="pill" style={{ background: '#fff7d6', color: '#a16207' }}>🪙 {eco.total}</span></>} cerrar={cerrar} ancho={720}>
      <div className="premios">{eco.premios.map((p) => <div key={p.id} className="premio" style={!p.activo ? { opacity: .5 } : undefined}><div className="em">{p.emoji}</div><b style={{ fontSize: 12.5, display: 'block' }}>{p.nombre}</b><small style={{ color: '#64748b' }}>{p.categoria}</small>
        <button className="btn btn-p" style={{ width: '100%', marginTop: 6 }} disabled={!p.activo || eco.total < p.costo || ocupado === p.id} onClick={() => canjear(p.id, p.nombre, p.costo)}>🪙 {p.costo}</button>
        {eco.admin && <button className="btn" style={{ width: '100%', marginTop: 4 }} onClick={() => setEdit({ id: p.id, emoji: p.emoji, nombre: p.nombre, costo: String(p.costo), categoria: p.categoria, activo: p.activo })}><Pencil /></button>}</div>)}</div>
      {eco.admin && <button className="btn" onClick={() => setEdit({ id: '', emoji: '🎁', nombre: '', costo: '', categoria: 'Otros', activo: true })}><Plus />Nuevo premio</button>}
      {edit && <div className="sec"><h4>{edit.id ? 'Editar premio' : 'Nuevo premio'}</h4><div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 90px', gap: 8 }}><input className="inp" value={edit.emoji} onChange={(e) => setEdit({ ...edit, emoji: e.target.value })} /><input className="inp" placeholder="Nombre" value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /><input className="inp" type="number" min={1} placeholder="Costo" value={edit.costo} onChange={(e) => setEdit({ ...edit, costo: e.target.value })} /></div>
        <label style={{ display: 'flex', gap: 6, marginTop: 8, fontSize: 13 }}><input type="checkbox" checked={edit.activo} onChange={(e) => setEdit({ ...edit, activo: e.target.checked })} />Disponible</label><div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button className="btn" onClick={() => setEdit(null)}>Cancelar</button><button className="btn btn-p" onClick={guardarPremio}>Guardar</button></div></div>}
      <div className="sec"><h4>{eco.admin ? 'Canjes de todo el equipo' : 'Mis canjes'}</h4>{eco.canjes.length ? eco.canjes.map((c) => <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}><span style={{ fontSize: 20 }}>{c.emoji}</span><span style={{ flex: 1 }}><b>{c.premio}</b><br /><small style={{ color: '#64748b' }}>{eco.admin ? c.usuario + ' · ' : ''}{new Date(c.fecha).toLocaleDateString('es-EC')} · 🪙 {c.costo}</small></span><span className="pill" style={{ background: c.estado === 'Entregado' ? '#eaf8f4' : c.estado === 'Cancelado' ? '#f1f5f9' : '#fff7e8', color: c.estado === 'Entregado' ? '#04896f' : c.estado === 'Cancelado' ? '#94a3b8' : '#a16207' }}>{c.estado}</span>
        {eco.admin && c.estado === 'Pendiente' && <><button className="btn btn-ok" onClick={() => gestionar(c.id, 'Entregado')}>Entregar</button><button className="btn btn-red" onClick={() => gestionar(c.id, 'Cancelado')}>Cancelar</button></>}</div>) : <p style={{ fontSize: 13, color: '#94a3b8' }}>Aún no hay canjes.</p>}</div>
      <div className="sec"><h4>Mi historial de monedas</h4>{eco.historial.map((h) => <div key={h.id} style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><span style={{ flex: 1 }}>{h.motivo}</span><b style={{ color: h.cambio > 0 ? '#04896f' : '#c0392b' }}>{h.cambio > 0 ? '+' : ''}{h.cambio}</b></div>)}</div>
    </Modal>
  )
}
void AlertTriangle; void ArrowLeft; void Calendar; void CheckSquare; void Gift; void useRef

/* ============================ Vistas: Delegadas, Calendario y Gantt ============================ */
const COLOR_EST: Record<string, string> = { 'Por hacer': '#64748b', 'En marcha': '#6d28d9', Pausado: '#c98a1f', Listo: '#04896f', Devuelto: '#c0392b', Cancelado: '#94a3b8' }
function Delegadas({ lista, abrir, revisar, delegar, hoy }: { lista: Act[]; abrir: (a: Act) => void; revisar: (id: string) => void; delegar: () => void; hoy: string }) {
  const [filtro, setFiltro] = useState('activas')
  const act = (a: Act) => !['Listo', 'Cancelado'].includes(a.estado)
  const rev = (a: Act) => a.estado === 'Listo' && a.supervisar
  const venc = (a: Act) => act(a) && !!a.fecha && a.fecha < hoy
  const F: Record<string, [string, (a: Act) => boolean]> = { activas: ['Activas', act], revisar: ['Por revisar', rev], vencidas: ['Vencidas', venc], cerradas: ['Terminadas', (a) => a.estado === 'Listo'], todas: ['Todas', () => true] }
  const personas = new Map<string, { id: string; nombre: string; todas: Act[] }>()
  lista.forEach((a) => { const k = a.delegadoId ?? ''; if (!personas.has(k)) personas.set(k, { id: k, nombre: a.delegado || 'Sin asignar', todas: [] }); personas.get(k)!.todas.push(a) })
  const arr = [...personas.values()].map((p) => ({ ...p, ver: p.todas.filter(F[filtro][1]), rev: p.todas.filter(rev).length, venc: p.todas.filter(venc).length, act: p.todas.filter(act).length, listas: p.todas.filter((a) => a.estado === 'Listo').length }))
    .filter((p) => p.ver.length || (filtro === 'activas' && p.rev))
    .sort((a, b) => b.rev - a.rev || b.venc - a.venc || b.act - a.act || a.nombre.localeCompare(b.nombre, 'es'))
  const orden = (a: Act) => (rev(a) ? 0 : venc(a) ? 1 : a.estado === 'Devuelto' ? 2 : a.estado === 'En marcha' ? 3 : act(a) ? 4 : 5)
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {Object.keys(F).map((k) => <button key={k} className="kp" style={{ cursor: 'pointer', borderColor: filtro === k ? '#0b2545' : undefined, boxShadow: filtro === k ? '0 0 0 2px rgba(11,37,69,.12)' : undefined }} onClick={() => setFiltro(k)}><b>{lista.filter(F[k][1]).length}</b><span>{F[k][0]}</span></button>)}
        <button className="btn btn-p" style={{ marginLeft: 'auto' }} onClick={delegar}><Send />Delegar tarea</button>
      </div>
      {!lista.length && <div className="sec" style={{ textAlign: 'center', color: '#64748b' }}><b>Aún no has delegado tareas</b><p style={{ fontSize: 13 }}>Cuando delegues, aquí verás el avance de cada persona, lo vencido y lo que debes revisar.</p></div>}
      {lista.length > 0 && !arr.length && <div className="sec" style={{ textAlign: 'center', color: '#64748b' }}><b>Nada por aquí</b><p style={{ fontSize: 13 }}>No hay tareas delegadas en «{F[filtro][0]}».</p></div>}
      <div className="grid-t" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' }}>
        {arr.map((p) => {
          const pct = p.todas.length ? Math.round((p.listas / p.todas.length) * 100) : 0
          return (
            <article key={p.id} className="sec" style={{ background: '#fff' }}>
              <header style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ width: 36, height: 36, borderRadius: 99, background: '#055c9d', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13 }}>{p.nombre.split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 800 }}>{p.nombre}</p>
                  <div style={{ fontSize: 11.5, color: '#64748b' }}>{p.act} activa{p.act === 1 ? '' : 's'}{p.venc > 0 && <span style={{ color: '#c0392b', fontWeight: 700 }}> · {p.venc} vencida{p.venc === 1 ? '' : 's'}</span>}{p.rev > 0 && <span style={{ color: '#a16207', fontWeight: 700 }}> · {p.rev} por revisar</span>}</div>
                  <div className="bar" style={{ marginTop: 4 }} title={pct + '% terminado'}><i style={{ width: pct + '%' }} /></div>
                </div>
              </header>
              <div style={{ display: 'grid', gap: 4 }}>
                {p.ver.length ? [...p.ver].sort((a, b) => orden(a) - orden(b)).map((a) => (
                  <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 8px', borderRadius: 10, border: '1px solid ' + (rev(a) ? '#fde68a' : venc(a) ? '#fecaca' : '#f1f5f9'), cursor: 'pointer' }} onClick={() => abrir(a)}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: COLOR_EST[a.estado] }} />
                    <div style={{ flex: 1, minWidth: 0 }}><p style={{ fontWeight: 700, fontSize: 13 }}>{a.descripcion}</p><small style={{ color: '#64748b' }}><span style={{ color: COLOR_EST[a.estado], fontWeight: 700 }}>{a.estado}</span>{a.fecha ? ' · ' + (venc(a) ? 'Venció ' : '') + dfecha(a.fecha) : ''} · ⏱ {corto(a.segundos)}</small></div>
                    {rev(a) ? <button className="btn btn-n" onClick={(e) => { e.stopPropagation(); revisar(a.id) }}>Revisar</button> : a.estado === 'Listo' ? <span className="pill e-listo">Lista</span> : a.estado === 'Devuelto' ? <span className="pill e-devuelto">Corrigiendo</span> : null}
                  </div>
                )) : <p style={{ fontSize: 12, color: '#94a3b8' }}>Sin tareas en este filtro.</p>}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function Calendario({ lista, anchor, hoy, abrir, nuevoDia }: { lista: Act[]; anchor: Date; hoy: string; abrir: (a: Act) => void; nuevoDia: (d: string) => void }) {
  const y = anchor.getFullYear(), m = anchor.getMonth(), first = new Date(y, m, 1, 12), start = new Date(first)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const [mostrar, setMostrar] = useState<string | null>(null)
  const sinFecha = lista.filter((a) => !a.fecha)
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 1, background: '#e2e8f0', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => <div key={d} style={{ background: '#f8fafc', padding: 6, fontSize: 11, fontWeight: 800, color: '#64748b', textAlign: 'center' }}>{d}</div>)}
        {Array.from({ length: 42 }, (_, i) => {
          const d = new Date(start); d.setDate(start.getDate() + i)
          const day = ymd(d), items = lista.filter((a) => a.fecha === day)
          return (
            <div key={i} style={{ background: day === hoy ? '#eef6fb' : d.getMonth() !== m ? '#fafbfc' : '#fff', minHeight: 96, padding: 4, opacity: d.getMonth() !== m ? 0.55 : 1 }}>
              <button style={{ border: 0, background: 'none', fontSize: 12, fontWeight: 800, color: day === hoy ? '#055c9d' : '#334155', cursor: 'pointer' }} title={'Crear actividad el ' + day} onClick={() => nuevoDia(day)}>{d.getDate()} <span style={{ color: '#94a3b8' }}>+</span></button>
              {items.slice(0, 3).map((a) => <button key={a.id} onClick={() => abrir(a)} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', border: 0, background: '#f1f5f9', borderRadius: 6, padding: '2px 5px', margin: '2px 0', fontSize: 11, textAlign: 'left', cursor: 'pointer', overflow: 'hidden' }}><span style={{ width: 6, height: 6, borderRadius: 99, background: COLOR_EST[a.estado], flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.descripcion}</span></button>)}
              {items.length > 3 && <button style={{ border: 0, background: 'none', fontSize: 11, color: '#055c9d', fontWeight: 700, cursor: 'pointer' }} onClick={() => setMostrar(mostrar === day ? null : day)}>+{items.length - 3} actividades</button>}
              {mostrar === day && items.slice(3).map((a) => <button key={a.id} onClick={() => abrir(a)} style={{ display: 'block', width: '100%', border: 0, background: '#f1f5f9', borderRadius: 6, padding: '2px 5px', margin: '2px 0', fontSize: 11, textAlign: 'left', cursor: 'pointer' }}>{a.descripcion}</button>)}
            </div>
          )
        })}
      </div>
      {sinFecha.length > 0 && (
        <>
          <h5 style={{ fontWeight: 800, color: '#0b2545', margin: '14px 2px 8px' }}>Sin fecha programada · {sinFecha.length}</h5>
          <div className="grid-t">{sinFecha.slice(0, 60).map((a) => <article key={a.id} className="card" style={{ marginBottom: 0 }} onClick={() => abrir(a)}><p className="t">{a.descripcion}</p><div className="meta"><span className={'pill e-' + slug(a.estado)}>{a.estado}</span></div></article>)}</div>
        </>
      )}
    </div>
  )
}

function Gantt({ lista, anchor, abrir }: { lista: Act[]; anchor: Date; abrir: (a: Act) => void }) {
  const start = new Date(anchor); start.setHours(12, 0, 0, 0)
  const dias = 28, ancho = 40
  const dia = (v: string) => (v ? new Date(v.slice(0, 10) + 'T12:00:00') : null)
  return (
    <div>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Los puntos indican fechas programadas. Las barras unen la fecha programada y la finalización registrada; no representan una duración planificada.</p>
      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14 }}>
        <div style={{ minWidth: 240 + dias * ancho }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ width: 240, padding: 8, fontSize: 11, fontWeight: 800, color: '#64748b' }}>Actividad</div>
            {Array.from({ length: dias }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return <span key={i} style={{ width: ancho, textAlign: 'center', fontSize: 11, padding: '6px 0', color: '#475569', borderLeft: '1px solid #f1f5f9' }}>{d.getDate()}<small style={{ display: 'block', color: '#94a3b8' }}>{d.toLocaleDateString('es-EC', { weekday: 'narrow' })}</small></span> })}
          </div>
          {lista.slice(0, 80).map((a) => {
            const d = dia(a.fecha), fin = dia(a.fechaFin)
            const off = d ? Math.round((d.getTime() - start.getTime()) / 864e5) : null
            const last = fin && d && fin >= d ? Math.round((fin.getTime() - start.getTime()) / 864e5) : off
            const visible = d !== null && off !== null && off < dias && (last ?? 0) >= 0
            const left = Math.max(0, off ?? 0), width = Math.max(1, Math.min(dias - 1, last ?? 0) - left + 1)
            return (
              <div key={a.id} style={{ display: 'flex', borderBottom: '1px solid #f1f5f9', alignItems: 'center', minHeight: 38 }}>
                <button style={{ width: 240, padding: '6px 8px', textAlign: 'left', border: 0, background: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => abrir(a)}>{a.descripcion}</button>
                <div style={{ position: 'relative', flex: 1, height: 38 }}>
                  {visible ? <button title={a.descripcion} onClick={() => abrir(a)} style={{ position: 'absolute', top: 7, height: 24, left: left * ancho, width: width * ancho - 6, border: 0, borderRadius: 8, background: COLOR_EST[a.estado] ?? '#64748b', color: '#fff', cursor: 'pointer', fontSize: 11 }}>{fin && (last ?? 0) > (off ?? 0) ? '' : '◆'}</button> : <span style={{ fontSize: 11, color: '#94a3b8', padding: 10 }}>{d ? 'Fuera del período' : 'Sin fecha programada'}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ============================ Visor de evidencias ============================ */
function Visor({ v, cerrar, mover }: { v: { lista: string[]; i: number }; cerrar: () => void; mover: (d: number) => void }) {
  const u = v.lista[v.i]
  const [url, setUrl] = useState('')
  useEffect(() => {
    setUrl(''); let vivo = true
    if (u.startsWith('agenda:')) supabase.storage.from('agenda').createSignedUrl(u.slice(7), 3600).then(({ data }) => { if (vivo && data) setUrl(data.signedUrl) })
    else setUrl(u)
    return () => { vivo = false }
  }, [u])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); if (e.key === 'ArrowLeft') mover(-1); if (e.key === 'ArrowRight') mover(1) }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar, mover])
  const nombre = u.startsWith('agenda:') ? (u.split('/').pop() ?? '').replace(/^\d+_/, '') : u
  const esImg = /\.(png|jpe?g|webp|gif|heic)$/i.test(nombre), esPdf = /\.pdf$/i.test(nombre), esVideo = /\.(mp4|webm|mov)$/i.test(nombre)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(8,18,32,.92)', display: 'flex', flexDirection: 'column' }} onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', color: '#fff' }}>
        <div style={{ flex: 1, minWidth: 0 }}><p style={{ fontWeight: 800, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</p><p style={{ fontSize: 11, color: 'rgba(255,255,255,.6)' }}>{v.i + 1} de {v.lista.length}</p></div>
        {url && <a className="tool" href={url} target="_blank" rel="noopener" title="Abrir"><ExternalLink /></a>}
        {url && <a className="tool" href={url} download={nombre} title="Descargar"><Download /></a>}
        <button className="tool" onClick={cerrar} title="Cerrar"><X /></button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }} onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
        {!url ? <span className="spin" /> : esImg ? <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : esPdf ? <iframe src={url} title={nombre} style={{ width: '100%', height: '100%', border: 0, background: '#fff', borderRadius: 8 }} /> : esVideo ? <video src={url} controls style={{ maxWidth: '100%', maxHeight: '100%' }} /> : <div style={{ color: '#fff', textAlign: 'center' }}><p>Este tipo de archivo no se puede mostrar aquí.</p><a className="btn" href={url} target="_blank" rel="noopener" style={{ marginTop: 10 }}>Abrir en una pestaña nueva</a></div>}
      </div>
      {v.lista.length > 1 && <><button className="tool" style={{ position: 'absolute', left: 8, top: '50%' }} onClick={() => mover(-1)}><ChevronLeft /></button><button className="tool" style={{ position: 'absolute', right: 8, top: '50%' }} onClick={() => mover(1)}><ChevronRight /></button></>}
    </div>
  )
}
