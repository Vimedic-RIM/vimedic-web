/* Marketing › Agenda: la semana por horas de quien coordina y su equipo, al estilo de Google Calendar.
   «Semana»: los 7 días con la gente elegida encima, cada persona con su color. «Día»: las personas lado a lado.
   Salen solas las tareas del Plan de trabajo, las publicaciones programadas (Zernio) y las campañas. Lo que no es de
   Marketing de otra persona sale como «Ocupado». Las citas son actividades normales: también están en la Agenda general
   (supabase/migrations/20261119130000_marketing_agenda.sql). Toda cita lleva responsable. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgePercent, Bell, CalendarClock, Check, ChevronLeft, ChevronRight, ClipboardList, Clock, ExternalLink, GraduationCap, Lock, MapPin, Megaphone, Pencil,
  Phone, Plus, RefreshCw, Trash2, Users, Video, X,
} from 'lucide-react'
import { supabase } from '../supabase'
import { hoyEC } from './ofertasInv'
import { llamar } from './MarketingIntegraciones'
import { MiniProducto } from './inventarioUtil'
import { agrupar } from '../tiempoReal'
import '../estilos/marketing-plan.css'
import '../estilos/marketing-agenda.css'

type Persona = { id: string; nombre: string; foto: string | null; rol: string }
type Evento = {
  id: string; codigo?: string; titulo?: string; tipo?: string; fecha: string; hora: string | null; duracion: number | null; estado?: string; prioridad?: string
  responsable: string; creadoPor?: string | null; creador?: string | null; ubicacion?: string | null; enlaceMeet?: string | null; detalle?: string | null
  invitados?: { id: string; nombre: string }[]; plan?: boolean; trabajo?: string | null; producto?: { codigo: string; nombre: string; imagen: string | null } | null
  gestiona?: boolean; privado?: boolean
}
type Campana = { id: string; nombre: string; inicio: string; fin: string; estado: string }
type Datos = { yo: string; coordina: boolean; agrega: boolean; personas: Persona[]; eventos: Evento[]; campanas: Campana[] }
type Post = { id: string; contenido: string; estado: string; fecha?: string; programada?: string; plataformas?: string[] }
type Item = { k: string; ev?: Evento; post?: Post; fecha: string; hora: string | null; dur: number; titulo: string; color: string; persona: string | null }
type Col = { key: string; fecha: string; persona: string | null }
type FormIni = Partial<Evento> & { fecha: string }

const H0 = 6, H1 = 22, PX = 46 // horas visibles y alto de una hora
const COLORES = ['#055c9d', '#04896f', '#c2410c', '#7c3aed', '#0e7490', '#b45309', '#475569']
const C_PUB = '#e1306c'
const TIPOS = ['Reunión', 'Llamada', 'Visita', 'Evento', 'Grabación', 'Recordatorio', 'Capacitación', 'Otro']
const DURACIONES = [15, 30, 45, 60, 90, 120, 180, 240]
const ICONO: Record<string, typeof Users> = { Reunión: Users, Llamada: Phone, Visita: MapPin, Evento: CalendarClock, Grabación: Video, Recordatorio: Bell, Capacitación: GraduationCap, Marketing: ClipboardList }

/* ---------------------------------------------------------------- Fechas (AAAA-MM-DD sin zona) y horas (HH:MM) */
const dia = (iso: string) => new Date(iso + 'T12:00:00')
const sumar = (iso: string, n: number) => { const d = dia(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const lunesDe = (iso: string) => sumar(iso, -((dia(iso).getDay() + 6) % 7))
const fLarga = (iso: string) => dia(iso).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' })
const fMes = (iso: string) => dia(iso).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })
const aMin = (h: string) => { const [a, b] = h.split(':').map(Number); return a * 60 + (b || 0) }
const deMin = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
const ymdLocal = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()
const corto = (n: string) => { const p = n.split(/\s+/).filter(Boolean); return p.length > 1 ? p[0] + ' ' + p[1][0] + '.' : n }
const rango = (e: { hora: string | null; duracion?: number | null; dur?: number }) => (e.hora ? e.hora + '–' + deMin(aMin(e.hora) + (e.duracion ?? e.dur ?? 60)) : 'Todo el día')

/** Reparte en carriles los bloques que se cruzan (como Google Calendar). */
function acomodar(items: Item[]): { it: Item; ini: number; fin: number; col: number; cols: number }[] {
  const ord = items.map((it) => { const ini = aMin(it.hora!); return { it, ini, fin: ini + Math.max(15, it.dur), col: 0, cols: 1 } }).sort((a, b) => a.ini - b.ini || b.fin - a.fin)
  let grupo: typeof ord = [], finGrupo = -1
  const cerrar = () => { const n = Math.max(1, ...grupo.map((g) => g.col + 1)); grupo.forEach((g) => { g.cols = n }); grupo = [] }
  for (const b of ord) {
    if (grupo.length && b.ini >= finGrupo) { cerrar(); finGrupo = -1 }
    const usadas = new Set(grupo.filter((g) => g.fin > b.ini).map((g) => g.col))
    while (usadas.has(b.col)) b.col++
    grupo.push(b); finGrupo = Math.max(finGrupo, b.fin)
  }
  if (grupo.length) cerrar()
  return ord
}

export function AgendaMarketing({ aviso, irA }: { aviso: (t: string) => void; irA: (tab: string) => void }) {
  const hoy = hoyEC()
  const [vista, setVistaS] = useState<'semana' | 'dia'>(() => {
    try { const v = localStorage.getItem('vm_mkag_vista'); if (v === 'semana' || v === 'dia') return v } catch { /* sin almacenamiento */ }
    return typeof window !== 'undefined' && window.innerWidth < 760 ? 'dia' : 'semana'
  })
  const setVista = (v: 'semana' | 'dia') => { setVistaS(v); try { localStorage.setItem('vm_mkag_vista', v) } catch { /* sin almacenamiento */ } }
  const [ancla, setAncla] = useState(hoy) // día elegido; en «Semana», su semana
  const lunes = lunesDe(ancla)
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumar(lunes, i)), [lunes])
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [sel, setSel] = useState<string[] | null>(() => { try { const v = JSON.parse(localStorage.getItem('vm_mkag_gente') || 'null'); return Array.isArray(v) ? v : null } catch { return null } })
  const [verPub, setVerPub] = useState(() => { try { return localStorage.getItem('vm_mkag_pub') !== '0' } catch { return true } })
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [form, setForm] = useState<FormIni | null>(null)
  const [detalle, setDetalle] = useState<Item | null>(null)
  const [todos, setTodos] = useState(false) // «Todo el día»: ver todos
  const arrastra = useRef<{ id: string; dy: number } | null>(null)
  const [sobre, setSobre] = useState('')
  const caja = useRef<HTMLDivElement>(null)
  const [ahora, setAhora] = useState(() => new Date())

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('mkt_agenda', { p_desde: lunes, p_hasta: sumar(lunes, 6) })
    if (e) { setError(e.message); return }
    setDatos(data as Datos); setError('')
  }, [lunes])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => {
    const r = agrupar(() => cargar())
    const c = supabase.channel('mk-agenda').on('postgres_changes', { event: '*', schema: 'public', table: 'actividades' }, r).subscribe()
    const v = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', v)
    return () => { r.cancelar(); supabase.removeChannel(c); document.removeEventListener('visibilitychange', v) }
  }, [cargar])
  // Publicaciones programadas en Zernio: si no responde, la agenda sigue igual
  const cargarPosts = useCallback(() => { llamar<{ posts: Post[] }>('zernio_posts', { pagina: 1 }).then((p) => setPosts(p.posts ?? [])).catch(() => setPosts([])) }, [])
  useEffect(() => { if (verPub && posts === null) cargarPosts() }, [verPub, posts, cargarPosts])
  useEffect(() => { const t = setInterval(() => setAhora(new Date()), 60000); return () => clearInterval(t) }, [])
  const listo = !!datos
  useEffect(() => { if (listo && caja.current) caja.current.scrollTop = (8 - H0) * PX }, [listo, vista])

  const personas = datos?.personas ?? []
  const colorDe = useCallback((id: string) => COLORES[Math.max(0, personas.findIndex((p) => p.id === id)) % COLORES.length], [personas])
  const elegidas = useMemo(() => {
    if (!datos) return []
    const base = sel ?? [datos.yo, ...datos.personas.filter((p) => p.rol === 'Asistente' || p.rol === 'Audiovisual').map((p) => p.id)]
    const l = datos.personas.filter((p) => base.includes(p.id))
    return l.length ? l : datos.personas.slice(0, 1)
  }, [datos, sel])
  const alternar = (id: string) => {
    const act = elegidas.map((p) => p.id), n = act.includes(id) ? act.filter((x) => x !== id) : [...act, id]
    if (!n.length) return
    setSel(n); try { localStorage.setItem('vm_mkag_gente', JSON.stringify(n)) } catch { /* sin almacenamiento */ }
  }
  const alternarPub = () => { setVerPub((v) => { try { localStorage.setItem('vm_mkag_pub', v ? '0' : '1') } catch { /* sin almacenamiento */ } return !v }) }

  const items = useMemo<Item[]>(() => {
    if (!datos) return []
    const ids = new Set(elegidas.map((p) => p.id))
    const l: Item[] = datos.eventos.filter((e) => ids.has(e.responsable)).map((e) => ({
      k: e.id, ev: e, fecha: e.fecha, hora: e.hora, dur: e.duracion || 60, titulo: e.privado ? 'Ocupado' : e.titulo || '', color: colorDe(e.responsable), persona: e.responsable,
    }))
    if (verPub) for (const p of posts ?? []) {
      const d = new Date(p.programada || p.fecha || '')
      if (isNaN(+d)) continue
      const f = ymdLocal(d)
      if (f < dias[0] || f > dias[6]) continue
      l.push({ k: 'pub-' + p.id, post: p, fecha: f, hora: deMin(d.getHours() * 60 + d.getMinutes()), dur: 30, titulo: (p.contenido || 'Publicación').replace(/\s+/g, ' ').slice(0, 90), color: C_PUB, persona: null })
    }
    return l
  }, [datos, elegidas, verPub, posts, dias, colorDe])

  if (error) return <div className="card p-6 text-sm" style={{ color: '#a3341f', background: '#fdecea' }}>{error}</div>
  if (!datos) return <p className="text-xs text-slate-400 p-4">Cargando la agenda…</p>

  const hayPubDia = verPub && items.some((i) => i.post && i.fecha === ancla)
  const cols: Col[] = vista === 'semana' ? dias.map((d) => ({ key: d, fecha: d, persona: null }))
    : [...elegidas.map((p) => ({ key: p.id, fecha: ancla, persona: p.id })), ...(hayPubDia ? [{ key: 'pub', fecha: ancla, persona: 'pub' }] : [])]
  const deCol = (c: Col) => items.filter((i) => i.fecha === c.fecha && (c.persona === null || (c.persona === 'pub' ? !!i.post : i.persona === c.persona)))
  const alto = (H1 - H0) * PX
  const yoEnAgenda = personas.some((p) => p.id === datos.yo)
  const nueva = (fecha: string, hora: string | null, persona: string | null) => {
    if (!datos.agrega) return
    setForm({ fecha, hora, duracion: 60, responsable: persona && persona !== 'pub' ? persona : yoEnAgenda ? datos.yo : personas[0]?.id, tipo: 'Reunión' })
  }
  const minDe = (e: React.DragEvent | React.MouseEvent, el: HTMLElement, dy = 0) => {
    const y = e.clientY - el.getBoundingClientRect().top - dy
    return Math.min(H1 * 60 - 15, Math.max(H0 * 60, H0 * 60 + Math.round(((y / PX) * 60) / 15) * 15))
  }

  async function mover(id: string, fecha: string, hora: string | null, persona: string | null) {
    const e = datos!.eventos.find((x) => x.id === id)
    if (!e) return
    const resp = persona && persona !== 'pub' ? persona : null
    if (e.fecha === fecha && (e.hora ?? null) === hora && (!resp || resp === e.responsable)) return
    setDatos((d) => d && { ...d, eventos: d.eventos.map((x) => (x.id === id ? { ...x, fecha, hora, responsable: resp || x.responsable, duracion: hora ? x.duracion || 60 : null } : x)) })
    const { error: er } = await supabase.rpc('mkt_agenda_mover', { p_id: id, p_fecha: fecha, p_hora: hora, p_responsable: resp })
    if (er) { aviso(er.message); cargar() } else aviso(`Movida al ${fLarga(fecha)}${hora ? ' a las ' + hora : ' (todo el día)'}${resp && resp !== e.responsable ? ' · responsable: ' + (personas.find((p) => p.id === resp)?.nombre ?? '') : ''}.`)
  }

  const Bloque = ({ b, conPersona }: { b: ReturnType<typeof acomodar>[number]; conPersona: boolean }) => {
    const { it } = b, ev = it.ev
    const ini = Math.min(Math.max(b.ini, H0 * 60), H1 * 60 - 15), fin = Math.min(Math.max(b.fin, ini + 15), H1 * 60)
    const top = ((ini - H0 * 60) / 60) * PX, h = Math.max(20, ((fin - ini) / 60) * PX - 2)
    const I = it.post ? Megaphone : ev?.plan ? ClipboardList : ICONO[ev?.tipo ?? ''] ?? Clock
    const quien = it.persona ? personas.find((p) => p.id === it.persona)?.nombre ?? '' : ''
    const corta = h < 34
    return (
      <button type="button" className={'mka-ev' + (corta ? ' corta' : '') + (ev?.privado ? ' priv' : '') + (it.post ? ' pub' : '') + (ev?.estado === 'Listo' ? ' listo' : '')}
        style={{ top, height: h, left: `calc(${(b.col / b.cols) * 100}% + 2px)`, width: `calc(${100 / b.cols}% - 4px)`, ['--c' as string]: it.color }}
        draggable={!!ev?.gestiona}
        onDragStart={(e) => { arrastra.current = { id: it.k, dy: e.clientY - e.currentTarget.getBoundingClientRect().top }; e.dataTransfer.effectAllowed = 'move' }}
        onDragEnd={() => { arrastra.current = null; setSobre('') }}
        onClick={(e) => { e.stopPropagation(); if (!ev?.privado) setDetalle(it) }}
        title={ev?.privado ? quien + ': ocupado ' + rango(it) : it.titulo + ' · ' + rango(it) + (quien ? ' · ' + quien : '')}>
        {corta ? <span className="t1">{ev?.privado ? <><Lock />Ocupado</> : <><I />{it.titulo}</>}<em>{it.hora}</em></span> : <>
          <span className="h">{rango(it)}</span>
          <span className="t">{ev?.privado ? <><Lock />Ocupado</> : <>{b.cols < 2 && <I />}{it.titulo}</>}</span></>}
        {conPersona && quien && h >= 44 && <span className="q">{corto(quien)}</span>}
      </button>
    )
  }
  const Chip = ({ it, conPersona }: { it: Item; conPersona: boolean }) => {
    const ev = it.ev, I = it.post ? Megaphone : ev?.plan ? ClipboardList : ICONO[ev?.tipo ?? ''] ?? CalendarClock
    const quien = it.persona ? corto(personas.find((p) => p.id === it.persona)?.nombre ?? '') : ''
    return (
      <button type="button" className={'mka-dia-chip' + (ev?.estado === 'Listo' ? ' listo' : '')} style={{ ['--c' as string]: it.color }} draggable={!!ev?.gestiona}
        onDragStart={(e) => { arrastra.current = { id: it.k, dy: 0 }; e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { arrastra.current = null; setSobre('') }}
        onClick={() => setDetalle(it)} title={it.titulo + (quien ? ' · ' + quien : '')}>
        <I />{it.titulo}{conPersona && quien ? <small> · {quien}</small> : null}
      </button>
    )
  }

  const titulo = vista === 'semana' ? `${fMes(dias[0])} – ${dia(dias[6]).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })}` : fLarga(ancla)
  const paso = vista === 'semana' ? 7 : 1
  const enHoy = vista === 'semana' ? lunes === lunesDe(hoy) : ancla === hoy
  const mAhora = ahora.getHours() * 60 + ahora.getMinutes()

  return (
    <div>
      <div className="mkp-barra">
        <div className="mkp-semana">
          <button type="button" className="mkp-ib" onClick={() => setAncla(sumar(ancla, -paso))} aria-label="Anterior"><ChevronLeft /></button>
          <b>{cap(titulo)}</b>
          <button type="button" className="mkp-ib" onClick={() => setAncla(sumar(ancla, paso))} aria-label="Siguiente"><ChevronRight /></button>
        </div>
        {!enHoy && <button type="button" className="btn" onClick={() => setAncla(hoy)}>Hoy</button>}
        <div className="mkp-semana mka-vistas">
          <button type="button" className={vista === 'semana' ? 'on' : ''} onClick={() => setVista('semana')}>Semana</button>
          <button type="button" className={vista === 'dia' ? 'on' : ''} onClick={() => setVista('dia')}>Día</button>
        </div>
        <button type="button" className="mkp-ib" onClick={() => { cargar(); if (verPub) cargarPosts() }} title="Actualizar"><RefreshCw /></button>
        <span className="mkp-esp" />
        {datos.agrega && <button type="button" className="btn btn-primary" onClick={() => {
          const base = vista === 'dia' ? ancla : enHoy ? hoy : lunes
          const prox = base === hoy ? Math.min(H1 * 60 - 60, Math.max(8 * 60, Math.ceil((mAhora + 1) / 30) * 30)) : 9 * 60
          nueva(base, deMin(prox), vista === 'dia' && elegidas.length === 1 ? elegidas[0].id : null)
        }}><Plus />Nueva cita</button>}
      </div>

      <div className="mka-gente">
        {personas.map((p) => {
          const on = elegidas.some((x) => x.id === p.id)
          return <button key={p.id} type="button" className={'mka-chip' + (on ? ' on' : '')} style={{ ['--c' as string]: colorDe(p.id) }} onClick={() => alternar(p.id)} aria-pressed={on}>
            <i />{p.nombre}{p.id === datos.yo ? ' (tú)' : ''}{p.rol ? <small>{p.rol}</small> : null}</button>
        })}
        <button type="button" className={'mka-chip' + (verPub ? ' on' : '')} style={{ ['--c' as string]: C_PUB }} onClick={alternarPub} aria-pressed={verPub}><i />Publicaciones</button>
      </div>
      {datos.campanas.length > 0 && <div className="mka-camps">{datos.campanas.map((c) => (
        <span key={c.id} className="mka-camp"><BadgePercent /><b>{c.nombre}</b>{fMes(c.inicio)} → {fMes(c.fin)}{c.estado && c.estado !== 'Aprobada' && c.estado !== 'Vigente' ? ' · ' + c.estado : ''}</span>
      ))}</div>}
      {!datos.agrega && <p className="mkp-nota" style={{ marginBottom: 8 }}>Aquí ves tu agenda. La agenda de Marketing (agendar y ver al equipo) es de quien coordina y su equipo.</p>}

      <div className="mka-cal" ref={caja}>
        <div className="mka-grid" style={{ gridTemplateColumns: `52px repeat(${cols.length}, minmax(${vista === 'semana' ? 104 : 130}px, 1fr))` }}>
          <div className="mka-th esq" />
          {cols.map((c) => {
            if (vista === 'semana') return (
              <button key={'h' + c.key} type="button" className={'mka-th' + (c.fecha === hoy ? ' hoy' : '')} onClick={() => { setAncla(c.fecha); setVista('dia') }} title="Ver el día con cada persona">
                <span>{dia(c.fecha).toLocaleDateString('es-EC', { weekday: 'short' })}</span><b>{dia(c.fecha).getDate()}</b>
              </button>
            )
            const p = personas.find((x) => x.id === c.persona)
            return (
              <div key={'h' + c.key} className="mka-th per">
                <span className="mka-av" style={{ ['--c' as string]: c.persona === 'pub' ? C_PUB : colorDe(c.key) }}>{c.persona === 'pub' ? <Megaphone /> : iniciales(p?.nombre ?? '')}</span>
                <span className="mka-th-p"><span className="mka-th-n">{c.persona === 'pub' ? 'Publicaciones' : p ? corto(p.nombre) + (p.id === datos.yo ? ' (tú)' : '') : ''}</span>
                  {p?.rol ? <small>{p.rol}</small> : null}</span>
              </div>
            )
          })}

          <div className="mka-todo lab">Todo el día</div>
          {cols.map((c) => {
            const l = deCol(c).filter((i) => !i.hora), k = 't|' + c.key, ver = todos ? l : l.slice(0, 3)
            return (
              <div key={k} className={'mka-todo' + (sobre === k ? ' encima' : '')}
                onDragOver={(e) => { if (!arrastra.current || c.persona === 'pub') return; e.preventDefault(); setSobre(k) }}
                onDragLeave={() => setSobre((v) => (v === k ? '' : v))}
                onDrop={(e) => { e.preventDefault(); setSobre(''); const a = arrastra.current; arrastra.current = null; if (a) mover(a.id, c.fecha, null, c.persona) }}>
                {ver.map((it) => <Chip key={it.k} it={it} conPersona={vista === 'semana'} />)}
                {l.length > 3 && <button type="button" className="mka-mas" onClick={() => setTodos((v) => !v)}>{todos ? 'Ver menos' : `+${l.length - 3} más`}</button>}
              </div>
            )
          })}

          <div className="mka-hrs" style={{ height: alto }}>{Array.from({ length: H1 - H0 - 1 }, (_, i) => H0 + i + 1).map((h) => <span key={h} style={{ top: (h - H0) * PX }}>{String(h).padStart(2, '0')}:00</span>)}</div>
          {cols.map((c, ci) => {
            const k = 'c|' + c.key
            const [sk, sm] = sobre.startsWith(k + '|') ? [true, Number(sobre.split('|')[2])] : [false, 0]
            return (
              <div key={k} className={'mka-col' + (c.fecha === hoy ? ' hoy' : '') + (datos.agrega && c.persona !== 'pub' ? ' crea' : '')} style={{ height: alto, ['--px' as string]: PX + 'px' }}
                onClick={(e) => { if (c.persona === 'pub') return; nueva(c.fecha, deMin(Math.floor(minDe(e, e.currentTarget) / 30) * 30), c.persona) }}
                onDragOver={(e) => { const a = arrastra.current; if (!a || c.persona === 'pub') return; e.preventDefault(); const m = minDe(e, e.currentTarget, a.dy); setSobre(k + '|' + m) }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre((v) => (v.startsWith(k + '|') ? '' : v)) }}
                onDrop={(e) => { e.preventDefault(); const a = arrastra.current; arrastra.current = null; setSobre(''); if (a) mover(a.id, c.fecha, deMin(minDe(e, e.currentTarget, a.dy)), c.persona) }}>
                {acomodar(deCol(c).filter((i) => !!i.hora)).map((b) => <Bloque key={b.it.k} b={b} conPersona={vista === 'semana'} />)}
                {c.fecha === hoy && mAhora >= H0 * 60 && mAhora <= H1 * 60 && <div className={'mka-ahora' + (ci > 0 && vista === 'dia' ? ' sin-punto' : '')} style={{ top: ((mAhora - H0 * 60) / 60) * PX }} />}
                {sk && <div className="mka-fantasma" style={{ top: ((sm - H0 * 60) / 60) * PX }}><span>{deMin(sm)}</span></div>}
              </div>
            )
          })}
        </div>
      </div>
      <p className="mkp-nota" style={{ marginTop: 8 }}>
        {datos.agrega ? 'Toca una hora para agendar; arrastra una cita para cambiarla de hora, de día o (en «Día») de persona. ' : ''}
        Toca un día para verlo con cada persona lado a lado. Lo que no es de Marketing de otra persona sale como «Ocupado». Las citas también están en la Agenda de cada persona.
      </p>

      {form && <FormCita ini={form} datos={datos} cerrar={() => setForm(null)} aviso={aviso} listo={() => { setForm(null); cargar() }} />}
      {detalle && <DetalleCita it={items.find((x) => x.k === detalle.k) ?? detalle} datos={datos} cerrar={() => setDetalle(null)} aviso={aviso} irA={irA}
        editar={(e) => { setDetalle(null); setForm({ ...e, fecha: e.fecha }) }} recargar={cargar} />}
    </div>
  )
}

/* ---------------------------------------------------------------- Detalle */
function DetalleCita({ it, datos, cerrar, aviso, irA, editar, recargar }: {
  it: Item; datos: Datos; cerrar: () => void; aviso: (s: string) => void; irA: (tab: string) => void; editar: (e: Evento) => void; recargar: () => Promise<void>
}) {
  const ev = it.ev, p = it.post
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  const nombre = (id: string | null | undefined) => datos.personas.find((x) => x.id === id)?.nombre ?? '—'
  async function cancelar() {
    const mo = prompt('¿Por qué se cancela? (opcional)')
    if (mo === null || !ev) return
    setOcupado(true)
    const { error } = await supabase.rpc('mkt_agenda_cancelar', { p_id: ev.id, p_motivo: mo })
    setOcupado(false)
    if (error) { aviso(error.message); return }
    aviso('Cita cancelada.'); await recargar(); cerrar()
  }
  return (
    <div className="mkp-fondo" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="mkp-modal">
        <header style={{ background: `linear-gradient(120deg,#0b2545,${it.color})` }}>
          <div><p style={{ opacity: 0.85, fontWeight: 800, textTransform: 'uppercase', fontSize: 10.5 }}>{p ? 'Publicación programada' : ev?.plan ? 'Tarea del Plan de trabajo' : ev?.tipo ?? 'Cita'}{ev?.codigo ? ' · ' + ev.codigo : ''}</p>
            <h3>{it.titulo}</h3>
            <p>{cap(fLarga(it.fecha))} · {rango(it)}</p></div>
          <button type="button" className="x" onClick={cerrar} aria-label="Cerrar"><X className="w-4 h-4" /></button>
        </header>
        <div className="cuerpo">
          {ev && <>
            <div className="mka-dato"><Users /><span><b>Responsable:</b> {nombre(ev.responsable)}{ev.creador ? ' · agendada por ' + (ev.creadoPor === datos.yo ? 'ti' : ev.creador) : ''}</span></div>
            {!!ev.invitados?.length && <div className="mka-dato"><Users /><span><b>Invitados:</b> {ev.invitados.map((i) => i.nombre).join(', ')}</span></div>}
            {ev.ubicacion && <div className="mka-dato"><MapPin /><span>{ev.ubicacion}</span></div>}
            {ev.enlaceMeet && <div className="mka-dato"><Video /><a href={ev.enlaceMeet} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 700 }}>Unirse a la reunión <ExternalLink className="w-3 h-3 inline" /></a></div>}
            {ev.producto && <div className="mkp-prod" style={{ marginTop: 10 }}><MiniProducto url={ev.producto.imagen} tam={44} /><div className="min-w-0 flex-1"><p className="text-[10.5px] font-mono-spec text-slate-400">{ev.producto.codigo}</p><p className="text-[12.5px] font-bold text-slate-800">{ev.producto.nombre}</p></div></div>}
            {ev.detalle && <><span className="mkp-lab">Notas</span><p className="text-[12.5px] text-slate-700 whitespace-pre-line">{ev.detalle}</p></>}
            <div className="mka-dato"><Check /><span>{ev.estado ?? 'Por hacer'}{ev.prioridad && ev.prioridad !== 'Normal' ? ' · ' + ev.prioridad : ''}</span></div>
            {ev.plan && <p className="mkp-nota" style={{ marginTop: 10 }}>Aquí se le puede poner hora; cambiarla de día o de persona, terminarla o cancelarla se hace en el Plan de trabajo.</p>}
          </>}
          {p && <>
            <p className="text-[12.5px] text-slate-700 whitespace-pre-line" style={{ marginTop: 4 }}>{p.contenido}</p>
            <div className="mka-dato"><Megaphone /><span>{(p.plataformas ?? []).join(', ') || 'Redes'} · {p.estado}</span></div>
          </>}
        </div>
        <footer>
          {ev?.plan && <button type="button" className="btn" onClick={() => { cerrar(); irA('plan') }}><ClipboardList />Abrir el Plan de trabajo</button>}
          {p && <button type="button" className="btn" onClick={() => { cerrar(); irA('planificador') }}><Megaphone />Ir al Planificador</button>}
          <span style={{ flex: 1 }} />
          {ev && !ev.plan && ev.gestiona && <button type="button" className="btn" style={{ color: '#b91c1c' }} disabled={ocupado} onClick={cancelar}><Trash2 />Cancelar cita</button>}
          {ev && !ev.plan && ev.gestiona && <button type="button" className="btn btn-primary" onClick={() => editar(ev)}><Pencil />Editar</button>}
        </footer>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Nueva cita / editar */
function FormCita({ ini, datos, cerrar, aviso, listo }: { ini: FormIni; datos: Datos; cerrar: () => void; aviso: (s: string) => void; listo: () => void }) {
  const [titulo, setTitulo] = useState(ini.titulo ?? '')
  const [tipo, setTipo] = useState(ini.tipo && TIPOS.includes(ini.tipo) ? ini.tipo : ini.id ? 'Otro' : 'Reunión')
  const [fecha, setFecha] = useState(ini.fecha)
  const [todoDia, setTodoDia] = useState(!ini.hora)
  const [hora, setHora] = useState(ini.hora ?? '09:00')
  const [dur, setDur] = useState(ini.duracion ?? 60)
  const [resp, setResp] = useState(ini.responsable ?? '')
  const [inv, setInv] = useState<string[]>((ini.invitados ?? []).map((i) => i.id))
  const [ubicacion, setUbicacion] = useState(ini.ubicacion ?? '')
  const [enlace, setEnlace] = useState(ini.enlaceMeet ?? '')
  const [prioridad, setPrioridad] = useState(ini.prioridad ?? 'Normal')
  const [notas, setNotas] = useState(ini.detalle ?? '')
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  const durs = DURACIONES.includes(dur) ? DURACIONES : [...DURACIONES, dur].sort((a, b) => a - b)
  async function guardar() {
    if (!titulo.trim()) { aviso('Escribe el asunto.'); return }
    if (!resp) { aviso('Elige al responsable.'); return }
    if (!fecha) { aviso('Elige la fecha.'); return }
    setOcupado(true)
    const { error } = await supabase.rpc('mkt_agenda_guardar', { p: {
      id: ini.id ?? '', titulo, tipo, fecha, hora: todoDia ? '' : hora, duracion: dur, responsable: resp, invitados: inv.filter((x) => x !== resp), ubicacion, enlace, prioridad, notas,
    } })
    if (error) { aviso(error.message); setOcupado(false); return }
    const n = datos.personas.find((p) => p.id === resp)?.nombre ?? ''
    aviso(ini.id ? 'Cita actualizada.' : resp === datos.yo ? 'Cita agendada.' : `Cita agendada para ${n}: le llega un aviso.`)
    listo()
  }
  return (
    <div className="mkp-fondo" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="mkp-modal">
        <header><div><h3>{ini.id ? 'Editar cita' : 'Nueva cita'}</h3><p>Toda cita queda con su responsable y aparece también en su Agenda.</p></div>
          <button type="button" className="x" onClick={cerrar} aria-label="Cerrar"><X className="w-4 h-4" /></button></header>
        <div className="cuerpo">
          <label><span className="mkp-lab" style={{ marginTop: 0 }}>Asunto</span>
            <input className="inp" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={300} placeholder="Ej. Reunión de planificación de la campaña" autoFocus /></label>
          <div className="mkp-2">
            <label><span className="mkp-lab">Responsable</span>
              <select className="inp" value={resp} onChange={(e) => setResp(e.target.value)}>
                {!resp && <option value="">Elige…</option>}
                {datos.personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.rol ? ' · ' + p.rol : ''}{p.id === datos.yo ? ' (tú)' : ''}</option>)}
              </select></label>
            <label><span className="mkp-lab">Tipo</span><select className="inp" value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS.map((t) => <option key={t}>{t}</option>)}</select></label>
          </div>
          <div className="mkp-2">
            <label><span className="mkp-lab">Fecha</span><input type="date" className="inp" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
            <label><span className="mkp-lab">Hora</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <input type="time" className="inp" value={hora} step={900} disabled={todoDia} onChange={(e) => setHora(e.target.value)} style={{ flex: 1 }} />
                <select className="inp" value={dur} disabled={todoDia} onChange={(e) => setDur(Number(e.target.value))} style={{ width: 'auto' }} aria-label="Duración">
                  {durs.map((d) => <option key={d} value={d}>{d < 60 ? d + ' min' : d % 60 ? Math.floor(d / 60) + ' h ' + (d % 60) + ' min' : d / 60 + ' h'}</option>)}
                </select>
              </span></label>
          </div>
          <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 mt-2"><input type="checkbox" checked={todoDia} onChange={(e) => setTodoDia(e.target.checked)} />Todo el día (sin hora)</label>
          <span className="mkp-lab">Invitados</span>
          <div className="mka-inv">{datos.personas.filter((p) => p.id !== resp).map((p) => {
            const on = inv.includes(p.id)
            return <button key={p.id} type="button" className={on ? 'on' : ''} onClick={() => setInv((l) => (on ? l.filter((x) => x !== p.id) : [...l, p.id]))} aria-pressed={on}>{on ? <Check /> : <Plus />}{p.nombre}</button>
          })}</div>
          <div className="mkp-2">
            <label><span className="mkp-lab">Lugar</span><input className="inp" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} placeholder="Ej. Sala de exhibición" /></label>
            <label><span className="mkp-lab">Enlace de la reunión</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <input className="inp" value={enlace} onChange={(e) => setEnlace(e.target.value)} placeholder="https://meet.google.com/…" style={{ flex: 1 }} />
                <a className="btn" href="https://meet.new" target="_blank" rel="noreferrer" title="Crea un Meet nuevo y pega aquí su enlace"><Video />Meet</a>
              </span></label>
          </div>
          <div className="mkp-2">
            <label><span className="mkp-lab">Prioridad</span><select className="inp" value={prioridad} onChange={(e) => setPrioridad(e.target.value)}><option>Normal</option><option>Importante</option><option>Urgente</option></select></label>
            <span />
          </div>
          <label><span className="mkp-lab">Notas</span><textarea className="inp" rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Temas, qué llevar, acuerdos…" /></label>
        </div>
        <footer><span style={{ flex: 1 }} /><button type="button" className="btn" onClick={cerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={ocupado} onClick={guardar}><Check />{ocupado ? 'Guardando…' : ini.id ? 'Guardar' : 'Agendar'}</button></footer>
      </div>
    </div>
  )
}
