import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, ExternalLink, Pencil, Plug, RefreshCw, RotateCcw, Send, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { llamar } from './MarketingIntegraciones'

/* ============================ Planificador de contenido (Zernio) ============================
   Igual que el original (Marketing.html + Data Marketing.gs): calendario por semana (con horas), por
   mes o en lista; arrastrar para cambiar la fecha; detalle con el estado, el error y el enlace de cada
   red; editar y eliminar; publicar en Feed, Historia o Reel con imagen o video (Audiovisual o archivo
   subido directo a Zernio); borradores; redacción con IA. Lo que publica Asistente o Audiovisual
   espera al coordinador (pestaña Revisión). Las cargas siguen en segundo plano. */

export type PiezaMin = { id: string; titulo: string; tipo: string; estado: string; url: string; producto: string; mime?: string; notas?: string; productoId?: string; enlace?: string; mini?: string }
type Detalle = { plataforma: string; estado: string; url: string; error: string }
type Post = {
  id: string; contenido: string; estado: string; fecha: string; programada: string; creado: string; publicado: string; plataformas: string[]
  imagen: string; tipoMedia: string; nMedia: number; urls: string[]; detalle: Detalle[]; avId: string; avTitulo: string; avUrl: string; avVideo: boolean
  campana: string; formato: string; productoId: string; producto: string
}
type Cuenta = { id: string; plataforma: string; nombre: string }
type Rol = { rol?: string; coord?: boolean; requiere?: boolean }
type Progreso = (pct: number, texto: string) => void
type Trabajo = { id: string; titulo: string; pct: number; texto: string; estado: 'run' | 'ok' | 'err'; correr: (p: Progreso) => Promise<unknown>; alTerminar?: (r: unknown) => void }
type Vista = 'week' | 'month' | 'list'
type ProdIa = { id: string; codigo: string; nombre: string; marca: string | null; codigo_unico: string | null; descripcion: string | null; caracteristicas: string | null; especificaciones: string | null; garantia: string | null; categoria: { nombre: string } | null }

const PLAT: Record<string, [string, string]> = {
  facebook: ['F', '#1877f2'], instagram: ['I', '#e1306c'], tiktok: ['T', '#111827'], linkedin: ['in', '#0a66c2'], youtube: ['Y', '#ff0000'], twitter: ['X', '#111827'], x: ['X', '#111827'],
  threads: ['@', '#111827'], pinterest: ['P', '#e60023'], googlebusiness: ['G', '#34a853'], bluesky: ['B', '#1185fe'], telegram: ['T', '#26a5e4'], reddit: ['R', '#ff4500'],
}
const ESTADO: Record<string, string> = { scheduled: 'Programada', published: 'Publicada', draft: 'Borrador', failed: 'Fallida', partial: 'Parcial', publishing: 'Publicando', cancelled: 'Cancelada' }
const EDITABLE = ['draft', 'scheduled', 'failed', 'partial', 'cancelled']
const BORRABLE = ['draft', 'scheduled', 'failed']
const FORMATOS: [string, string][] = [['feed', 'Feed'], ['story', 'Historia'], ['reel', 'Reel']]
const TIPOS_IA: [string, string][] = [['promocional', 'Promocional'], ['educativo', 'Educativo'], ['lanzamiento', 'Novedad'], ['oferta', 'Oferta'], ['caso', 'Caso de uso']]
const AJUSTES_IA: [string, string][] = [['mejorar', 'Mejorar'], ['acortar', 'Acortar'], ['hashtags', 'Hashtags']]
const MIME_OK = /^image\/(jpeg|png|webp|gif)$|^video\/(mp4|quicktime|webm)$/
const MAX_TEXTO = 2000

const stClase = (s: string) => (ESTADO[s] ? 'st-' + s : 'st-other')
const pad = (n: number) => String(n).padStart(2, '0')
const EC = 5 * 3600000
function ecDate(iso: string) { const t = Date.parse(iso); if (!isFinite(t)) return null; const d = new Date(t - EC); return { key: d.toISOString().slice(0, 10), h: d.getUTCHours(), m: d.getUTCMinutes(), t } }
const ecAhora = () => ecDate(new Date().toISOString())!
const keyAdd = (k: string, n: number) => { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const keyDow = (k: string) => (new Date(k + 'T12:00:00Z').getUTCDay() + 6) % 7
const keyLabel = (k: string, o: Intl.DateTimeFormatOptions) => new Date(k + 'T12:00:00Z').toLocaleDateString('es-EC', { timeZone: 'UTC', ...o })
const weekStart = (k: string) => keyAdd(k, -keyDow(k))
const ecIso = (k: string, h: number, m: number) => `${k}T${pad(h)}:${pad(m)}:00-05:00`
const hm = (h: number, m: number) => pad(h) + ':' + pad(m)
const httpsUrl = (v: string) => { try { return new URL(v).protocol === 'https:' ? v : '' } catch { return '' } }
const largo = (t: string) => [...t].length
const fechaCorta = (iso: string) => { const d = ecDate(iso); return d ? keyLabel(d.key, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + hm(d.h, d.m) : '' }
const esVideoPieza = (p: PiezaMin) => /^video\//.test(p.mime || '') || (!p.mime && /video|reel/i.test(p.tipo))
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14) + '-x')
const leerVista = (): Vista => { try { const v = localStorage.getItem('vm_mk_vista'); if (v === 'week' || v === 'month' || v === 'list') return v } catch { /* sin almacenamiento */ } return window.innerWidth < 640 ? 'list' : 'week' }

function Punto({ p }: { p: string }) {
  const d = PLAT[String(p || '').toLowerCase()] ?? [String(p || '?').slice(0, 1).toUpperCase(), '#64748b']
  return <span className="pdot" style={{ background: d[1] }} title={p}>{d[0]}</span>
}

function Ventana({ titulo, cerrar, children, pie, ancho = 640 }: { titulo: React.ReactNode; cerrar: () => void; children: React.ReactNode; pie?: React.ReactNode; ancho?: number }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden" style={{ maxWidth: ancho }}>
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-slate-100 shrink-0"><div className="font-display font-bold text-sm text-slate-800 min-w-0 flex-1">{titulo}</div><button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {pie && <div className="shrink-0 border-t border-slate-100 p-4 flex gap-2 items-center flex-wrap">{pie}</div>}
      </div>
    </div>
  )
}

/** Sube el archivo directo a Zernio (URL firmada), con avance. */
async function subirAZernio(f: File, prog: Progreso) {
  const pre = await llamar<{ uploadUrl: string; publicUrl: string }>('zernio_presign', { nombre: f.name, tipo: f.type, tamano: f.size })
  await new Promise<void>((ok, no) => {
    const x = new XMLHttpRequest()
    x.open('PUT', pre.uploadUrl)
    x.setRequestHeader('Content-Type', f.type)
    x.upload.onprogress = (e) => { if (e.lengthComputable) prog(0.05 + 0.7 * (e.loaded / e.total), `Subiendo ${Math.round((e.loaded / e.total) * 100)} %…`) }
    x.onload = () => (x.status >= 200 && x.status < 300 ? ok() : no(new Error(`No se pudo subir el archivo (código ${x.status}).`)))
    x.onerror = () => no(new Error('Se cortó la conexión al subir el archivo.'))
    x.send(f)
  })
  return { url: pre.publicUrl, type: f.type.startsWith('video/') ? 'video' : 'image' }
}

export function Planificador({ perfil, piezas, piezaInicial, limpiarPieza, irConfig, aviso, alSincronizar, abrirAlEntrar, consumirAbrir }: {
  perfil: Perfil; piezas: PiezaMin[]; piezaInicial: PiezaMin | null; limpiarPieza: () => void; irConfig: () => void; aviso: (t: string) => void; alSincronizar: () => void
  abrirAlEntrar?: boolean; consumirAbrir?: () => void
}) {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [pagina, setPagina] = useState(1)
  const [paginas, setPaginas] = useState(1)
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [rol, setRol] = useState<Rol>({})
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [vista, setVistaS] = useState<Vista>(leerVista)
  const [cursor, setCursor] = useState(() => ecAhora().key)
  const [fEstado, setFEstado] = useState('')
  const [fRed, setFRed] = useState('')
  const [detalle, setDetalle] = useState<Post | null>(null)
  const [composer, setComposer] = useState<{ modo: 'new' | 'edit'; post?: Post; dia?: string; hora?: number; pieza?: PiezaMin | null } | null>(null)
  const [arrastrando, setArrastrando] = useState('')
  const [sobre, setSobre] = useState('')
  const [moviendo, setMoviendo] = useState('')
  const [trabajos, setTrabajos] = useState<Trabajo[]>([])
  const crear = puede(perfil, 'marketing', 'crear')
  const setVista = (v: Vista) => { setVistaS(v); try { localStorage.setItem('vm_mk_vista', v) } catch { /* sin almacenamiento */ } }

  const cargar = useCallback(async (mas = false) => {
    setCargando(true)
    try {
      const pag = mas ? pagina + 1 : 1
      const [p, c] = await Promise.all([
        llamar<{ posts: Post[]; pagina: number; paginas: number }>('zernio_posts', { pagina: pag }),
        mas ? Promise.resolve(null) : llamar<{ cuentas: Cuenta[] }>('zernio_cuentas'),
      ])
      if (c) setCuentas(c.cuentas)
      setPagina(pag); setPaginas(p.paginas || 1)
      setPosts((ant) => { const m = new Map((mas ? ant ?? [] : []).map((x) => [x.id, x])); p.posts.forEach((x) => m.set(x.id, x)); return [...m.values()] })
      setError('')
      // El estado de las piezas de Audiovisual sigue lo que realmente pasó en Zernio.
      const { data } = await supabase.from('audiovisual').select('id,estado,publicacion_id').is('deleted_at', null).not('publicacion_id', 'is', null)
      let cambios = 0
      for (const a of (data ?? []) as { id: string; estado: string; publicacion_id: string }[]) {
        const post = p.posts.find((x) => x.id === a.publicacion_id); if (!post) continue
        const nuevo = post.estado === 'published' ? 'Publicado' : post.estado === 'scheduled' ? 'Programado' : post.estado === 'failed' ? 'Listo' : a.estado
        if (nuevo !== a.estado) { await supabase.from('audiovisual').update({ estado: nuevo }).eq('id', a.id); cambios++ }
      }
      if (cambios) alSincronizar()
    } catch (e) { setError((e as Error).message) }
    setCargando(false)
  }, [pagina, alSincronizar])
  useEffect(() => { cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { supabase.rpc('marketing_mi_rol').then(({ data }) => setRol((data as Rol) ?? {})) }, [])
  useEffect(() => { if (piezaInicial) setComposer({ modo: 'new', pieza: piezaInicial }) }, [piezaInicial])
  useEffect(() => { if (abrirAlEntrar) { setComposer({ modo: 'new' }); consumirAbrir?.() } }, [abrirAlEntrar]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Cola de cargas en segundo plano ---------- */
  const correr = useCallback((t: Trabajo) => {
    const prog: Progreso = (pct, texto) => setTrabajos((l) => l.map((x) => (x.id === t.id ? { ...x, pct, texto } : x)))
    t.correr(prog).then((r) => {
      setTrabajos((l) => l.map((x) => (x.id === t.id ? { ...x, estado: 'ok', pct: 1, texto: 'Listo' } : x)))
      setTimeout(() => setTrabajos((l) => l.filter((x) => x.id !== t.id || x.estado !== 'ok')), 6000)
      t.alTerminar?.(r)
    }).catch((e) => setTrabajos((l) => l.map((x) => (x.id === t.id ? { ...x, estado: 'err', texto: (e as Error).message } : x))))
  }, [])
  const encolar = useCallback((titulo: string, fn: (p: Progreso) => Promise<unknown>, alTerminar?: (r: unknown) => void) => {
    const t: Trabajo = { id: uuid(), titulo, pct: 0, texto: 'En cola', estado: 'run', correr: fn, alTerminar }
    setTrabajos((l) => [...l, t]); correr(t)
  }, [correr])
  const reintentar = (t: Trabajo) => { const n = { ...t, estado: 'run' as const, pct: 0, texto: 'Reintentando…' }; setTrabajos((l) => l.map((x) => (x.id === t.id ? n : x))); correr(n) }

  /* ---------- Filtros y calendario ---------- */
  const redes = useMemo(() => [...new Set((posts ?? []).flatMap((p) => p.plataformas))].sort(), [posts])
  const lista = useMemo(() => (posts ?? []).filter((p) => (!fEstado || p.estado === fEstado || (fEstado === 'failed' && p.estado === 'partial')) && (!fRed || p.plataformas.includes(fRed))), [posts, fEstado, fRed])
  const ahora = ecAhora(), hoy = ahora.key
  const etiqueta = vista === 'week'
    ? keyLabel(weekStart(cursor), { day: 'numeric', month: 'short' }) + ' – ' + keyLabel(keyAdd(weekStart(cursor), 6), { day: 'numeric', month: 'short', year: 'numeric' })
    : vista === 'month' ? (() => { const t = keyLabel(cursor.slice(0, 7) + '-01', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1) })() : 'Todas las publicaciones'
  function mover(dir: number) {
    if (vista === 'week') setCursor((c) => keyAdd(c, 7 * dir))
    else setCursor((c) => { const d = new Date(Date.UTC(+c.slice(0, 4), +c.slice(5, 7) - 1 + dir, 1)); return d.toISOString().slice(0, 10) })
  }

  /* ---------- Arrastrar y soltar (mkReprogramar) ---------- */
  async function reprogramar(id: string, dia: string, hora?: number) {
    const p = (posts ?? []).find((x) => x.id === id); if (!p || !EDITABLE.includes(p.estado)) return
    const o = ecDate(p.fecha) || { h: 10, m: 0 }
    const iso = ecIso(dia, hora ?? o.h, o.m), t = Date.parse(iso)
    if (t < Date.now() + 60000) { aviso('Elige una fecha y hora futura.'); return }
    if (ecDate(p.fecha) && Math.abs(Date.parse(p.fecha) - t) < 1000) return
    const antes = p.fecha, nueva = new Date(t).toISOString()
    const poner = (f: string) => setPosts((l) => (l ?? []).map((x) => (x.id === id ? { ...x, fecha: f, programada: f } : x)))
    poner(nueva); setMoviendo(id)
    try {
      const r = await llamar<{ enRevision?: boolean }>('zernio_reprogramar', { id, fechaISO: iso })
      if (r.enRevision) { poner(antes); aviso('El cambio de fecha quedó en revisión del coordinador.') }
      else { const d = ecDate(nueva)!; aviso('Movida al ' + keyLabel(d.key, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + hm(d.h, d.m)) }
    } catch (e) { poner(antes); aviso((e as Error).message) }
    setMoviendo('')
  }
  const zonaDrop = (id: string, activa: boolean, dia: string, hora?: number) => activa ? {
    onDragOver: (e: React.DragEvent) => { if (!arrastrando) return; e.preventDefault(); if (sobre !== id) setSobre(id) },
    onDragLeave: () => setSobre((s) => (s === id ? '' : s)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setSobre(''); setArrastrando('')
      const av = e.dataTransfer.getData('text/av')
      if (av) { const pz = piezas.find((x) => x.id === av); if (pz) setComposer({ modo: 'new', pieza: pz, dia, hora: hora ?? 10 }); return }
      const pid = e.dataTransfer.getData('text/plain'); if (pid) reprogramar(pid, dia, hora)
    },
  } : {}
  const listos = useMemo(() => piezas.filter((x) => x.estado === 'Listo' && (x.enlace || x.url)), [piezas])

  async function borrar(p: Post) {
    if (!confirm('¿Eliminar esta publicación de Zernio?')) return
    try { await llamar('zernio_eliminar', { postId: p.id }); aviso('Publicación eliminada.'); setDetalle(null); setPosts((l) => (l ?? []).filter((x) => x.id !== p.id)); alSincronizar() }
    catch (e) { aviso((e as Error).message) }
  }

  const chip = (p: Post, conDia = false) => {
    const d = ecDate(p.fecha), movible = crear && EDITABLE.includes(p.estado)
    const video = p.tipoMedia === 'video' || (!p.tipoMedia && p.avVideo)
    const mini = p.avUrl && !p.avVideo ? p.avUrl : !video ? httpsUrl(p.imagen) : ''
    return (
      <div key={p.id} className={'chip ' + stClase(p.estado) + (moviendo === p.id ? ' moving' : '')} draggable={movible} title={(ESTADO[p.estado] || p.estado) + (movible ? ' · arrastra para mover' : '')}
        onClick={(e) => { e.stopPropagation(); setDetalle(p) }}
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); setArrastrando(p.id) }}
        onDragEnd={(e) => { e.currentTarget.classList.remove('dragging'); setArrastrando(''); setSobre('') }}>
        <div className="ctop">{d ? (conDia ? keyLabel(d.key, { day: 'numeric', month: 'short' }) + ' · ' : '') + hm(d.h, d.m) : 'Sin fecha'}<span className="ml-auto flex gap-0.5">{p.plataformas.slice(0, 4).map((x, i) => <Punto key={x + i} p={x} />)}</span></div>
        <div className="flex gap-1.5 items-start mt-1">
          {(mini || video) && <span className="cthumb cth">{mini && <img loading="lazy" src={mini} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />}{video && <i className="cplay">▶</i>}</span>}
          <span className="min-w-0 flex-1"><span className="ctxt">{p.contenido.slice(0, 120) || p.avTitulo || 'Publicación multimedia'}</span>{p.producto && <span className="cprod">📦 {p.producto}</span>}</span>
        </div>
      </div>
    )
  }

  /* ---------- Vistas ---------- */
  const refSemana = useRef<HTMLDivElement>(null)
  const ws = weekStart(cursor)
  useEffect(() => {
    if (vista !== 'week') return
    const sc = refSemana.current, fila = sc?.querySelector('[data-hour="7"]'), cab = sc?.querySelector('.cal-head') as HTMLElement | null
    if (sc && fila) sc.scrollTop = fila.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - (cab?.offsetHeight ?? 0)
  }, [vista, ws, posts === null]) // eslint-disable-line react-hooks/exhaustive-deps

  function semana() {
    const dias = Array.from({ length: 7 }, (_, i) => keyAdd(ws, i)), fin = dias[6], por: Record<string, Post[]> = {}
    lista.forEach((p) => { const d = ecDate(p.fecha); if (d && d.key >= ws && d.key <= fin) (por[d.key + '|' + d.h] ||= []).push(p) })
    const sinFecha = lista.filter((p) => !ecDate(p.fecha))
    return (
      <>
        <div className="cal-wrap" ref={refSemana}>
          <div className="cal-grid" style={{ gridTemplateColumns: '58px repeat(7,minmax(128px,1fr))' }}>
            <div className="cal-head" style={{ left: 0, zIndex: 6, position: 'sticky' }} />
            {dias.map((k) => { const n = lista.filter((p) => ecDate(p.fecha)?.key === k).length; return (
              <div key={k} className={'cal-head' + (k === hoy ? ' today' : '')}>
                <p className="text-[10px] font-mono-spec uppercase text-slate-400">{keyLabel(k, { weekday: 'short' })}</p><span className="dnum">{Number(k.slice(8))}</span>
                <p className="text-[9px] text-slate-400" style={n ? undefined : { color: 'transparent' }}>{n ? n + ' publ.' : '·'}</p>
              </div>) })}
            {Array.from({ length: 24 }, (_, h) => (
              <Fragment key={h}>
                <div className="hour" data-hour={h}>{hm(h, 0)}</div>
                {dias.map((k) => {
                  const id = k + '|' + h, pasado = k < hoy || (k === hoy && h < ahora.h)
                  const items = (por[id] ?? []).sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha))
                  return (
                    <div key={id} className={'slot' + (pasado ? ' past' : '') + (sobre === id ? ' drop' : '')} onClick={() => { if (!pasado && crear) setComposer({ modo: 'new', dia: k, hora: h }) }}
                      {...zonaDrop(id, !pasado, k, h)}>
                      {k === hoy && h === ahora.h && <div className="now-line" style={{ top: Math.round((ahora.m / 60) * 100) + '%' }} />}
                      {crear && <span className="slot-add">+ {hm(h, 0)}</span>}
                      {items.map((p) => chip(p))}
                    </div>
                  )
                })}
              </Fragment>
            ))}
          </div>
        </div>
        {sinFecha.length > 0 && <><h3 className="font-display font-bold text-sm mt-4 mb-2">Sin fecha</h3><div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-2">{sinFecha.map((p) => chip(p))}</div></>}
      </>
    )
  }
  function mes() {
    const primero = cursor.slice(0, 7) + '-01', inicio = weekStart(primero)
    return (
      <div className="overflow-x-auto"><div className="month-grid">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => <div key={d} className="mhead">{d}</div>)}
        {Array.from({ length: 42 }, (_, i) => {
          const k = keyAdd(inicio, i), items = lista.filter((p) => ecDate(p.fecha)?.key === k).sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha))
          const pasado = k < hoy
          return (
            <div key={k} className={'mday' + (k.slice(0, 7) !== primero.slice(0, 7) ? ' out' : '') + (k === hoy ? ' today' : '') + (pasado ? ' past' : '') + (sobre === k ? ' drop' : '')}
              onClick={() => { if (!pasado && crear) setComposer({ modo: 'new', dia: k, hora: 10 }) }} {...zonaDrop(k, !pasado, k)}>
              <span className="mnum">{Number(k.slice(8))}</span>
              {items.map((p) => chip(p))}
            </div>
          )
        })}
      </div></div>
    )
  }
  function enLista() {
    const grupos: Record<string, Post[]> = {}
    lista.slice().sort((a, b) => (Date.parse(b.fecha) || 0) - (Date.parse(a.fecha) || 0)).forEach((p) => { const k = ecDate(p.fecha)?.key ?? 'Sin fecha'; (grupos[k] ||= []).push(p) })
    const g = Object.entries(grupos)
    if (!g.length) return <p className="p-8 text-center text-sm text-slate-400">No hay publicaciones con estos filtros.</p>
    return g.map(([k, items]) => (
      <div key={k} className="mb-4">
        <h3 className="text-[11px] font-mono-spec uppercase text-slate-500 mb-2">{k === 'Sin fecha' ? k : keyLabel(k, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">{items.map((p) => chip(p))}</div>
      </div>
    ))
  }

  return (
    <section>
      <div className="card p-3 mb-3 flex items-center gap-2 flex-wrap">
        <div className="seg">{([['week', 'Semana'], ['month', 'Mes'], ['list', 'Lista']] as [Vista, string][]).map(([k, t]) => <button key={k} type="button" className={vista === k ? 'active' : ''} onClick={() => setVista(k)}>{t}</button>)}</div>
        {vista !== 'list' && <div className="flex items-center gap-1">
          <button type="button" className="btn" style={{ padding: '6px 8px' }} onClick={() => mover(-1)} aria-label="Anterior"><ChevronLeft /></button>
          <button type="button" className="btn" style={{ padding: '6px 10px' }} onClick={() => setCursor(ecAhora().key)}>Hoy</button>
          <button type="button" className="btn" style={{ padding: '6px 8px' }} onClick={() => mover(1)} aria-label="Siguiente"><ChevronRight /></button>
        </div>}
        <b className="font-display text-sm text-slate-800">{etiqueta}</b>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <select className="inp" style={{ width: 'auto' }} value={fEstado} onChange={(e) => setFEstado(e.target.value)} aria-label="Estado">
            <option value="">Todos los estados</option>{['scheduled', 'published', 'draft', 'failed', 'publishing', 'cancelled'].map((s) => <option key={s} value={s}>{s === 'failed' ? 'Fallidas o parciales' : ESTADO[s] + 's'}</option>)}
          </select>
          <select className="inp" style={{ width: 'auto' }} value={fRed} onChange={(e) => setFRed(e.target.value)} aria-label="Red social">
            <option value="">Todas las redes</option>{redes.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
          </select>
          <button type="button" className="btn" onClick={() => cargar()} disabled={cargando}><RefreshCw className={cargando ? 'animate-spin' : ''} />Sincronizar</button>
          {crear && <button type="button" className="btn btn-primary" onClick={() => setComposer({ modo: 'new' })} disabled={!!error}><CalendarClock />Nueva publicación</button>}
        </div>
      </div>
      <p className="text-[11px] text-slate-500 mb-2">
        {posts ? `${posts.length} publicaciones sincronizadas · ${cuentas.length} cuenta${cuentas.length === 1 ? '' : 's'} conectada${cuentas.length === 1 ? '' : 's'}` : ''}
        {crear && vista !== 'list' && posts && posts.length > 0 && ' · Arrastra una publicación pendiente para cambiar su fecha; toca un espacio libre para crear una.'}
        {rol.requiere && ' · Tus publicaciones las aprueba Coordinación antes de salir (los borradores no).'}
      </p>
      {crear && !error && listos.length > 0 && (
        <div className="card p-3 mb-3">
          <p className="text-[11px] font-bold text-slate-600 mb-2">🎬 Listo para publicar ({listos.length}) <span className="font-normal text-slate-400">· arrastra al calendario o toca para programar</span></p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {listos.slice(0, 20).map((pz) => (
              <button key={pz.id} type="button" draggable onClick={() => setComposer({ modo: 'new', pieza: pz })}
                onDragStart={(e) => { e.dataTransfer.setData('text/av', pz.id); e.dataTransfer.effectAllowed = 'copy'; setArrastrando('av:' + pz.id) }}
                onDragEnd={() => { setArrastrando(''); setSobre('') }}
                className="shrink-0 text-left rounded-xl border border-slate-200 overflow-hidden bg-white" style={{ width: 144, cursor: 'grab' }} title={'Programar: ' + pz.titulo}>
                <div className="relative bg-slate-100" style={{ aspectRatio: '16/9' }}>
                  {pz.mini && <img src={pz.mini} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
                  {esVideoPieza(pz) && <span className="absolute inset-0 grid place-items-center text-white text-xs" style={{ textShadow: '0 1px 3px #000a' }}>▶</span>}
                </div>
                <p className="text-[11px] font-semibold text-slate-700 truncate px-2 pt-1.5">{pz.titulo}</p>
                <p className="text-[10px] font-bold px-2 pb-1.5 flex items-center gap-1" style={{ color: 'var(--primary)' }}><CalendarClock className="w-3 h-3" />Programar</p>
              </button>
            ))}
          </div>
        </div>
      )}
      {error && (
        <div className="card p-6 text-center"><p className="text-sm font-bold text-slate-700">No se pudo conectar con Zernio</p><p className="text-xs text-slate-500 mt-1">{error}</p>
          {puede(perfil, 'marketing', 'administrar') && <button type="button" className="btn btn-primary mt-3" onClick={irConfig}><Plug />Ir a Configuración</button>}</div>
      )}
      {!error && !posts && <p className="text-xs text-slate-400">Cargando publicaciones…</p>}
      {!error && posts && (vista === 'week' ? semana() : vista === 'month' ? mes() : enLista())}
      {!error && posts && pagina < paginas && <div className="text-center mt-3"><button type="button" className="btn" onClick={() => cargar(true)} disabled={cargando}>Cargar publicaciones anteriores</button></div>}

      {detalle && <DetallePost p={detalle} crear={crear} cerrar={() => setDetalle(null)} borrar={() => borrar(detalle)} editar={() => { setComposer({ modo: 'edit', post: detalle }); setDetalle(null) }} />}
      {composer && <Composer {...composer} cuentas={cuentas} piezas={piezas} rol={rol} aviso={aviso} encolar={encolar}
        cerrar={() => { setComposer(null); limpiarPieza() }}
        enviado={(fecha) => { setComposer(null); limpiarPieza(); if (fecha) setCursor(fecha.slice(0, 10)) }}
        terminado={() => { cargar(); alSincronizar() }} />}

      {trabajos.length > 0 && (
        <div className="mk-cola">
          {trabajos.map((t) => (
            <div key={t.id} className={'mk-cola-i' + (t.estado === 'err' ? ' err' : t.estado === 'ok' ? ' ok' : '')}>
              <div className="flex items-center gap-2"><b className="text-[11.5px] text-slate-800 truncate flex-1">{t.titulo}</b>
                {t.estado === 'err' && <button type="button" className="text-[10.5px] font-bold" style={{ color: 'var(--primary)' }} onClick={() => reintentar(t)}><RotateCcw className="w-3 h-3 inline" /> Reintentar</button>}
                {t.estado !== 'run' && <button type="button" className="text-slate-400" onClick={() => setTrabajos((l) => l.filter((x) => x.id !== t.id))} aria-label="Quitar"><X className="w-3.5 h-3.5" /></button>}</div>
              <p className="text-[10.5px] mt-0.5" style={{ color: t.estado === 'err' ? '#b91c1c' : '#64748b' }}>{t.texto}</p>
              {t.estado === 'run' && <div className="mk-cola-b"><i style={{ width: Math.round(t.pct * 100) + '%' }} /></div>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ---------- Detalle de una publicación ---------- */
function DetallePost({ p, crear, cerrar, borrar, editar }: { p: Post; crear: boolean; cerrar: () => void; borrar: () => void; editar: () => void }) {
  const d = ecDate(p.fecha), url = httpsUrl(p.imagen)
  const det = p.detalle?.length ? p.detalle : p.plataformas.map((pl) => ({ plataforma: pl, estado: '', url: '', error: '' }))
  const kv: [string, string][] = ([
    ['Estado', ESTADO[p.estado] || p.estado], ['Programada', fechaCorta(p.programada)], ['Publicada', fechaCorta(p.publicado)], ['Creada', fechaCorta(p.creado)],
    ['Contenido', p.tipoMedia ? (p.tipoMedia === 'video' ? 'Video' : 'Imagen') + (p.nMedia > 1 ? ' ×' + p.nMedia : '') : 'Solo texto'],
    ['Formato', ({ feed: 'Feed', story: 'Historia', reel: 'Reel' } as Record<string, string>)[p.formato] || ''], ['Campaña', p.campana], ['Redes', String(p.plataformas.length)],
  ] as [string, string][]).filter((x) => x[1])
  return (
    <Ventana ancho={920} cerrar={cerrar}
      titulo={<span className={'flex items-center gap-2 flex-wrap ' + stClase(p.estado)}><span className="pill" style={{ background: 'var(--stbg)', color: 'var(--st)' }}>{ESTADO[p.estado] || p.estado}</span>
        <span className="flex gap-1">{p.plataformas.map((x, i) => <Punto key={x + i} p={x} />)}</span>
        <span className="text-xs font-semibold text-slate-500">{d ? keyLabel(d.key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + hm(d.h, d.m) : 'Sin fecha'}</span></span>}
      pie={<>
        <span className="text-[11px] text-slate-400 mr-auto">{!EDITABLE.includes(p.estado) ? 'Las publicaciones ya publicadas no se pueden editar.' : ''}</span>
        {crear && BORRABLE.includes(p.estado) && <button type="button" className="btn" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={borrar}><Trash2 />Eliminar</button>}
        {crear && EDITABLE.includes(p.estado) && <button type="button" className="btn btn-primary" onClick={editar}><Pencil />Editar</button>}
      </>}>
      <div className="dt-grid">
        <div className="min-w-0 space-y-4">
          <div><p className="text-sm text-slate-800 whitespace-pre-wrap" style={{ overflowWrap: 'anywhere' }}>{p.contenido || '(Sin texto)'}</p><p className="text-[10.5px] text-slate-400 mt-1">{largo(p.contenido || '')} caracteres</p></div>
          {(p.producto || p.avTitulo) && <div className="flex gap-2 flex-wrap">
            {p.producto && <span className="pill" style={{ background: '#eef6fd', color: '#055c9d' }}>📦 {p.producto}</span>}
            {p.avTitulo && <span className="pill" style={{ background: '#f5f3ff', color: '#6d28d9' }}>🎬 {p.avTitulo}</span>}</div>}
          <dl className="dt-kv">{kv.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
          <div className="grid sm:grid-cols-2 gap-2">{det.map((x, i) => (
            <Fragment key={x.plataforma + i}>
              <div className="dt-red"><Punto p={x.plataforma} /><span className="font-semibold text-slate-700 capitalize">{x.plataforma}</span>
                <span className="ml-auto text-[10px] font-bold" style={{ color: x.error ? '#dc2626' : '#94a3b8' }}>{x.error ? 'Error' : ESTADO[x.estado] || x.estado}</span>
                {httpsUrl(x.url) && <a href={x.url} target="_blank" rel="noopener noreferrer" className="font-bold" style={{ color: 'var(--primary)' }} aria-label="Abrir en la red"><ExternalLink className="w-3.5 h-3.5" /></a>}</div>
              {x.error && <p className="sm:col-span-2 text-[10.5px] px-1" style={{ color: '#dc2626', marginTop: -4 }}>{x.error}</p>}
            </Fragment>))}</div>
          {p.urls.length > 0 && <div className="flex gap-3 flex-wrap">{p.urls.filter(httpsUrl).map((x) => <a key={x} href={x} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold hover:underline" style={{ color: 'var(--primary)' }}>Ver publicación ↗</a>)}</div>}
        </div>
        <div className="dt-player">
          {url ? (p.tipoMedia === 'video' ? <video src={url} controls playsInline preload="metadata" /> : <img src={url} alt="" />)
            : p.avUrl ? (p.avVideo ? <video src={p.avUrl} controls playsInline preload="metadata" /> : <img src={p.avUrl} alt="" />)
            : <div className="text-center p-6 text-xs">Publicación solo de texto</div>}
        </div>
      </div>
    </Ventana>
  )
}

/* ---------- Nueva publicación / editar ---------- */
function Composer({ modo, post, dia, hora, pieza: piezaIni, cuentas, piezas, rol, aviso, encolar, cerrar, enviado, terminado }: {
  modo: 'new' | 'edit'; post?: Post; dia?: string; hora?: number; pieza?: PiezaMin | null; cuentas: Cuenta[]; piezas: PiezaMin[]; rol: Rol; aviso: (t: string) => void
  encolar: (titulo: string, fn: (p: Progreso) => Promise<unknown>, alTerminar?: (r: unknown) => void) => void
  cerrar: () => void; enviado: (fecha: string) => void; terminado: () => void
}) {
  const editar = modo === 'edit' && !!post
  const fechaIni = () => {
    if (editar) { const d = ecDate(post!.fecha); return d && d.t > Date.now() ? d.key + 'T' + hm(d.h, d.m) : '' }
    return dia ? dia + 'T' + hm(hora ?? 10, 0) : ''
  }
  const [texto, setTexto] = useState(editar ? post!.contenido : piezaIni?.notas ?? '')
  const [sel, setSel] = useState<string[]>([])
  const [formato, setFormato] = useState(piezaIni && esVideoPieza(piezaIni) ? 'reel' : 'feed')
  const [piezaId, setPiezaId] = useState(piezaIni?.id ?? '')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [fecha, setFecha] = useState(fechaIni)
  const [borrador, setBorrador] = useState(editar && post!.estado === 'draft')
  const [idea, setIdea] = useState('')
  const [qProd, setQProd] = useState(piezaIni?.producto ?? '')
  const [prodOpc, setProdOpc] = useState<ProdIa[]>([])
  const [prod, setProd] = useState<ProdIa | null>(null)
  const [verOpc, setVerOpc] = useState(false)
  const [iaOcupada, setIaOcupada] = useState('')
  const [antesIa, setAntesIa] = useState<string | null>(null)
  const [error, setError] = useState('')
  const solicitud = useRef(uuid())
  const [previa, setPrevia] = useState('')
  const pieza = piezas.find((x) => x.id === piezaId) ?? (piezaIni && piezaIni.id === piezaId ? piezaIni : null)
  const elegibles = useMemo(() => piezas.filter((x) => (x.enlace || x.url) && MIME_OK.test(x.mime || (esVideoPieza(x) ? 'video/mp4' : 'image/jpeg')) && ['Listo', 'Programado', 'Publicado', 'En edición'].includes(x.estado)), [piezas])

  useEffect(() => { if (!archivo) { setPrevia(''); return } const u = URL.createObjectURL(archivo); setPrevia(u); return () => URL.revokeObjectURL(u) }, [archivo])
  // Buscador de productos para la IA (visibles al público primero).
  useEffect(() => {
    const q = qProd.replace(/[,()%*\\]/g, ' ').trim()
    if (!verOpc || q.length < 2 || (prod && qProd === prod.codigo + ' · ' + prod.nombre)) { setProdOpc([]); return }
    const t = window.setTimeout(() => {
      supabase.from('productos').select('id,codigo,nombre,marca,codigo_unico,descripcion,caracteristicas,especificaciones,garantia,categoria:categorias(nombre)').is('deleted_at', null)
        .or(`nombre.ilike.%${q}%,codigo.ilike.%${q}%`).order('en_catalogo', { ascending: false }).order('nombre').limit(8)
        .then(({ data }) => setProdOpc((data as unknown as ProdIa[]) ?? []))
    }, 250)
    return () => window.clearTimeout(t)
  }, [qProd, verOpc, prod])
  // Si viene de Audiovisual con producto, se toma ese producto para la IA.
  useEffect(() => {
    if (!piezaIni?.productoId) return
    supabase.from('productos').select('id,codigo,nombre,marca,codigo_unico,descripcion,caracteristicas,especificaciones,garantia,categoria:categorias(nombre)').eq('id', piezaIni.productoId).maybeSingle()
      .then(({ data }) => { if (data) { const p = data as unknown as ProdIa; setProd(p); setQProd(p.codigo + ' · ' + p.nombre) } })
  }, [piezaIni?.productoId])

  const elegidas = cuentas.filter((c) => sel.includes(c.id))
  const plats = editar ? post!.plataformas : [...new Set(elegidas.map((c) => c.plataforma))]
  const n = largo(texto)
  const mediaTipo: '' | 'image' | 'video' = archivo ? (archivo.type.startsWith('video/') ? 'video' : 'image') : pieza ? (esVideoPieza(pieza) ? 'video' : 'image') : ''
  const principal = editar ? 'Guardar cambios' : borrador ? 'Guardar borrador' : fecha ? 'Programar' : 'Publicar ahora'

  /* Las mismas reglas que valida el servidor (mkPublicar), para avisar antes de cerrar. */
  function validar(ahora: boolean): string {
    const fechaISO = !ahora && fecha ? fecha + ':00-05:00' : ''
    if (fechaISO) {
      const t = Date.parse(fechaISO)
      if (!isFinite(t) || t < Date.now() + 60000) return 'La fecha debe estar al menos un minuto en el futuro.'
      if (!editar && archivo && t > Date.now() + 6.9 * 86400000) return 'Un archivo subido directo solo se puede programar dentro de los próximos 6 días. Súbelo en Audiovisual para programarlo con más anticipación.'
    }
    if (editar) { if (!fechaISO && post!.estado !== 'draft') return 'Elige la nueva fecha y hora.'; if (n > 5000) return 'El texto supera 5000 caracteres.'; return '' }
    if (!sel.length) return 'Selecciona al menos una cuenta.'
    if (!texto.trim() && formato !== 'story') return 'Escribe el contenido.'
    if (n > 2200) return 'El texto supera 2.200 caracteres (límite de Instagram y TikTok). Acórtalo.'
    if (formato === 'reel' && mediaTipo !== 'video') return 'Reels requiere un video.'
    if (formato === 'story' && !mediaTipo) return 'Historias requiere imagen o video.'
    if (archivo && (!MIME_OK.test(archivo.type) || archivo.size > 300 * 1024 * 1024)) return 'Formato o tamaño no admitido (JPG, PNG, WebP, GIF, MP4, MOV o WebM; máximo 300 MB).'
    for (const c of elegidas) {
      const pl = c.plataforma.toLowerCase()
      if (pl === 'instagram' && !mediaTipo) return 'Instagram requiere una imagen o un video.'
      if (pl === 'tiktok' && !mediaTipo) return 'TikTok requiere un video o una imagen.'
      if ((pl === 'tiktok' || pl === 'youtube') && formato === 'story') return `${c.plataforma} no admite historias: usa formato Reel o Feed.`
      if (pl === 'youtube' && mediaTipo !== 'video') return 'YouTube requiere un video.'
      if (formato !== 'feed' && !['facebook', 'instagram', 'tiktok', 'youtube'].includes(pl)) return `El formato ${formato === 'story' ? 'Historia' : 'Reel'} solo funciona en Facebook, Instagram, TikTok y YouTube. Quita ${c.plataforma} o usa Feed.`
    }
    return ''
  }

  function enviar(ahora: boolean) {
    const e = validar(ahora); if (e) { setError(e); return }
    const fechaISO = !ahora && fecha ? fecha + ':00-05:00' : ''
    const esBorrador = !ahora && borrador
    const contenido = texto
    if (editar) {
      const id = post!.id
      encolar('Editar publicación', async (prog) => { prog(0.3, 'Guardando en Zernio…'); return llamar('zernio_editar', { id, contenido, fechaISO, borrador: esBorrador }) },
        (r) => { if ((r as { enRevision?: boolean })?.enRevision) aviso('El cambio quedó en revisión del coordinador.'); else aviso('Publicación actualizada.'); terminado() })
      enviado(fechaISO); return
    }
    const f = archivo, pz = pieza, cuentasSel = [...sel], requestId = solicitud.current
    const redesTexto = elegidas.map((c) => c.plataforma + ' · ' + c.nombre)
    const titulo = (contenido.trim().split('\n')[0] || pz?.titulo || 'Publicación').slice(0, 48)
    encolar(titulo, async (prog) => {
      let media: { url: string; type: string } | null = null
      if (f) { prog(0.05, 'Subiendo multimedia…'); media = await subirAZernio(f, prog) }
      else if (pz) media = { url: pz.enlace || pz.url, type: esVideoPieza(pz) ? 'video' : 'image' }
      prog(0.8, 'Enviando a Zernio…')
      return llamar('zernio_crear', {
        requestId, cuentas: cuentasSel, redesTexto, contenido, formato, fechaISO, borrador: esBorrador, media,
        audiovisualId: pz?.id || null, productoId: prod?.id || pz?.productoId || null, productoTexto: prod ? prod.codigo + ' · ' + prod.nombre : pz?.producto || null,
      })
    }, (r) => {
      const x = r as { enRevision?: boolean; repetida?: boolean }
      aviso(x?.enRevision ? 'Enviada al coordinador para aprobación. Aparece en Revisión.' : x?.repetida ? 'Esta publicación ya se había creado.' : esBorrador ? 'Borrador guardado.' : fechaISO ? 'Publicación programada.' : 'Publicación enviada.')
      terminado()
    })
    aviso('Publicación en cola: se carga en segundo plano.')
    enviado(fechaISO)
  }

  /* ---------- Copy con IA ---------- */
  function contexto() {
    if (!prod) return null
    return { id: prod.id, nombre: prod.nombre, categoria: prod.categoria?.nombre ?? '', marca: prod.marca ?? '', modelo: prod.codigo_unico ?? '', garantia: prod.garantia ?? '', descripcion: [prod.descripcion, prod.caracteristicas, prod.especificaciones].filter(Boolean).join('\n').slice(0, 1500) }
  }
  function plantilla(tipo: string) {
    const nombre = prod ? prod.nombre : 'nuestros equipos médicos', web = 'https://vimedic.com.ec'
    const lineas = String([prod?.descripcion, prod?.caracteristicas].filter(Boolean).join('\n')).split(/\n|•/).map((x) => x.replace(/^[-✓✔·\s]+/, '').trim()).filter((x) => x && x.length < 110 && !/:$/.test(x)).slice(0, 4)
    const intro = ({ promocional: '✨ ' + nombre + (prod?.marca ? ' ' + prod.marca : '') + ': calidad y respaldo para tu consulta.', educativo: '💡 ¿Sabías qué hace la diferencia al elegir ' + nombre.toLowerCase() + '?', lanzamiento: '🚀 ¡Llegó ' + nombre + '! Stock disponible en VIMEDIC.', oferta: '⏳ Oportunidad por tiempo limitado: ' + nombre + '.', caso: '🏥 Así ' + nombre.toLowerCase() + ' ayuda en el día a día de clínicas y consultorios.' } as Record<string, string>)[tipo] || '✨ ' + nombre
    const cat = prod?.categoria?.nombre ? '#' + prod.categoria.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '') : ''
    return [intro, idea.trim() ? '\n' + idea.trim() : '', lineas.length ? '\n' + lineas.map((x) => '✅ ' + x).join('\n') : '', '\n📲 Escríbenos por WhatsApp y cotiza hoy.', '🌐 Conoce más en ' + web, '\n#VIMEDIC #EquiposMedicos #Ecuador #Salud' + (cat ? ' ' + cat : '')].filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }
  function poner(t: string) { setAntesIa(texto); setTexto(t) }
  const textoRef = useRef(texto); textoRef.current = texto
  async function redactar(tipo: string) {
    if (iaOcupada) return
    if (['mejorar', 'acortar', 'hashtags'].includes(tipo) && !texto.trim()) { aviso('Escribe primero un texto (o usa una plantilla) para que la IA lo trabaje.'); return }
    const base = texto
    setIaOcupada(tipo)
    try {
      const r = await Promise.race([
        llamar<{ texto: string }>('ia_texto', { tipo, contexto: contexto(), productoId: prod?.id, idea, texto: base, plataformas: plats, formato }),
        new Promise<never>((_, no) => setTimeout(() => no(new Error('tardó más de 60 s')), 60000)),
      ])
      if (textoRef.current !== base && textoRef.current.trim() && !confirm('Cambiaste el texto mientras la IA escribía. ¿Reemplazarlo por el de la IA?')) return
      poner(r.texto); aviso('Copy listo. Revísalo y ajusta lo que quieras.')
    } catch (e) {
      if (['mejorar', 'acortar', 'hashtags'].includes(tipo) || textoRef.current.trim()) aviso('La IA no respondió: ' + (e as Error).message)
      else { poner(plantilla(tipo)); aviso('La IA no respondió (' + (e as Error).message + '). Te dejé una plantilla rápida para que no esperes.') }
    } finally { setIaOcupada('') }
  }

  // De Audiovisual se muestra la miniatura (los videos de Drive no se reproducen fuera de Drive).
  const mediaPrevia = archivo ? previa : pieza ? (pieza.mini || (esVideoPieza(pieza) ? '' : pieza.url)) : editar ? httpsUrl(post!.imagen) : ''
  const previaVideo = archivo ? archivo.type.startsWith('video/') : pieza ? false : editar && post!.tipoMedia === 'video'

  return (
    <Ventana ancho={980} titulo={editar ? 'Editar publicación' : 'Nueva publicación'} cerrar={cerrar}
      pie={<>
        <p className="text-[11px] flex-1" style={{ color: '#c0392b', minWidth: 160 }}>{error}</p>
        {!editar && principal !== 'Publicar ahora' && <button type="button" className="btn" onClick={() => enviar(true)}><Send />Publicar ahora</button>}
        <button type="button" className="btn btn-primary" onClick={() => enviar(false)}>{editar ? <Pencil /> : fecha && !borrador ? <CalendarClock /> : <Send />}{principal}</button>
      </>}>
      <div className="cmp-grid">
        <div className="space-y-3 min-w-0">
          {!editar && <div>
            <p className="text-[11px] font-bold text-slate-500 mb-1">Dónde publicar</p>
            <div className="flex flex-wrap gap-1.5">{cuentas.length ? cuentas.map((c) => (
              <label key={c.id} className="acc-chip"><input type="checkbox" checked={sel.includes(c.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} /><Punto p={c.plataforma} />{c.nombre}</label>
            )) : <span className="text-[11px] text-slate-400">No hay cuentas conectadas en Zernio.</span>}</div>
          </div>}
          {!editar && <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-[11px] font-bold text-slate-500">Formato
              <select value={formato} onChange={(e) => setFormato(e.target.value)} className="inp w-full mt-1">{FORMATOS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
            <label className="block text-[11px] font-bold text-slate-500">Material de Audiovisual
              <select value={piezaId} onChange={(e) => { setPiezaId(e.target.value); setArchivo(null); const pz = piezas.find((x) => x.id === e.target.value); if (pz && esVideoPieza(pz) && formato === 'feed') setFormato('reel') }} className="inp w-full mt-1">
                <option value="">— Ninguno —</option>{elegibles.map((x) => <option key={x.id} value={x.id}>{(esVideoPieza(x) ? '🎬 ' : '🖼 ') + x.titulo} · {x.estado}</option>)}</select></label>
          </div>}
          {!editar && <label className="btn" style={{ display: 'inline-flex', cursor: 'pointer' }}><Upload />{archivo ? archivo.name.slice(0, 40) : '…o sube una imagen o video'}
            <input type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={(e) => { const f = e.target.files?.[0] ?? null; setArchivo(f); if (f) { setPiezaId(''); if (f.type.startsWith('video/') && formato === 'feed') setFormato('reel') } }} /></label>}
          {!editar && archivo && <p className="text-[10.5px] text-slate-400 -mt-1">{(archivo.size / 1048576).toFixed(1)} MB · se sube directo a Zernio (temporal: programable hasta 6 días). Para programar con más anticipación, súbelo en Audiovisual.</p>}

          <div className="rounded-xl border border-violet-200 p-3 space-y-2" style={{ background: '#f5f3ffb3' }}>
            <p className="text-[11px] font-bold text-violet-700 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" />Asistente de copy (Gemini)</p>
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="relative">
                <input value={qProd} onChange={(e) => { setQProd(e.target.value); setProd(null); setVerOpc(true) }} onFocus={() => setVerOpc(true)} onBlur={() => setTimeout(() => setVerOpc(false), 180)} className="inp w-full" placeholder="Producto (código o nombre)…" />
                {verOpc && prodOpc.length > 0 && <div className="mk-ac">{prodOpc.map((p) => (
                  <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setProd(p); setQProd(p.codigo + ' · ' + p.nombre); setVerOpc(false) }}><b>{p.codigo}</b> · {p.nombre}{p.marca ? ' · ' + p.marca : ''}</button>))}</div>}
              </div>
              <input value={idea} onChange={(e) => setIdea(e.target.value)} className="inp w-full" placeholder="Idea o indicaciones (opcional)" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TIPOS_IA.map(([k, t]) => <button key={k} type="button" className="btn" style={{ padding: '5px 9px', fontSize: 11 }} disabled={!!iaOcupada} onClick={() => redactar(k)}>{iaOcupada === k ? 'Redactando…' : t}</button>)}
              <span className="w-px mx-0.5" style={{ background: '#ddd6fe' }} />
              {AJUSTES_IA.map(([k, t]) => <button key={k} type="button" className="btn" style={{ padding: '5px 9px', fontSize: 11 }} disabled={!!iaOcupada || !texto.trim()} onClick={() => redactar(k)}>{iaOcupada === k ? '…' : t}</button>)}
              <button type="button" className="btn" style={{ padding: '5px 9px', fontSize: 11 }} disabled={!!iaOcupada} onClick={() => poner(plantilla('promocional'))} title="Arma un texto al instante con los datos del producto">Plantilla rápida</button>
              {antesIa !== null && <button type="button" className="btn" style={{ padding: '5px 9px', fontSize: 11 }} onClick={() => { setTexto(antesIa); setAntesIa(null) }}><RotateCcw />Deshacer</button>}
            </div>
            {iaOcupada && <p className="text-[10.5px] text-violet-700">Gemini está redactando… puedes seguir llenando lo demás.</p>}
          </div>

          <label className="block text-[11px] font-bold text-slate-500"><span className="flex items-center">Texto de la publicación<span className="ml-auto font-mono-spec" style={{ color: n > MAX_TEXTO ? '#dc2626' : n > 1800 ? '#d97706' : '#94a3b8', fontWeight: n > MAX_TEXTO ? 700 : 500 }}>{n} / {MAX_TEXTO}</span></span>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={8} className="inp w-full mt-1" placeholder={formato === 'story' ? 'Opcional en historias' : 'Escribe o redacta con IA…'} /></label>
          <div className="grid sm:grid-cols-2 gap-3 items-end">
            <label className="block text-[11px] font-bold text-slate-500">{editar ? 'Nueva fecha y hora' : 'Programar para (vacío = publicar ahora)'}
              <input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} className="inp w-full mt-1" /></label>
            {(!editar || post!.estado === 'draft') && <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 pb-2"><input type="checkbox" checked={borrador} onChange={(e) => setBorrador(e.target.checked)} />{editar ? 'Seguir como borrador' : 'Guardar como borrador'}</label>}
          </div>
          <p className="text-[10.5px] text-slate-400">Hora de Ecuador.{rol.requiere && !borrador ? ' Se enviará a Coordinación para aprobación antes de salir.' : ''}</p>
        </div>

        <aside className="cmp-prev">
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100"><span className="flex gap-0.5">{plats.map((x, i) => <Punto key={x + i} p={x} />)}</span>
            <span className="text-[10.5px] font-semibold text-slate-500 ml-auto">{borrador ? 'Borrador' + (fecha ? ' · ' + fecha.replace('T', ' ') : '') : fecha ? keyLabel(fecha.slice(0, 10), { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + fecha.slice(11, 16) : 'Publicar ahora'}</span></div>
          <div className="cmp-media relative">{mediaPrevia ? (previaVideo ? <video src={mediaPrevia} muted controls playsInline /> : <img src={mediaPrevia} alt="" />) : <span className="text-xs">{pieza ? '🎬 ' + pieza.titulo : 'Sin imagen ni video'}</span>}
            {!archivo && pieza && esVideoPieza(pieza) && mediaPrevia && <span className="absolute inset-0 grid place-items-center pointer-events-none"><span className="w-12 h-12 rounded-full grid place-items-center text-white" style={{ background: '#0000008c' }}>▶</span></span>}</div>
          <p className="p-3 text-[11.5px] whitespace-pre-wrap" style={{ color: texto ? '#1e293b' : '#94a3b8', overflowWrap: 'anywhere', maxHeight: 260, overflowY: 'auto' }}>{texto || 'Tu texto aparecerá aquí…'}</p>
        </aside>
      </div>
    </Ventana>
  )
}
