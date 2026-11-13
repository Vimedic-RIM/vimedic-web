import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, BookOpen, CalendarClock, Check, CircleCheck, ClipboardCheck, Copy, Eye, FileBadge, FileText, Film, Globe, ImagePlus, KeyRound, Link2, Plug, RefreshCw, Search, Send, Sparkles, Tag, Trash2, Upload, Video, X, XCircle,
} from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { imagen, Interruptor } from './Inventario'

/* Conexiones de Marketing: Zernio (redes) y Gemini (IA). Las claves viven en el servidor (Edge Function): el navegador nunca las ve. */
export async function llamar<T = Record<string, unknown>>(accion: string, datos: Record<string, unknown> = {}, funcion = 'marketing-integraciones'): Promise<T> {
  const { data, error } = await supabase.functions.invoke(funcion, { body: { accion, ...datos } })
  if (error) {
    let m = error.message
    try { const j = await (error as unknown as { context?: Response }).context?.json?.(); if (j?.error) m = j.error } catch { /* sin detalle */ }
    throw new Error(m)
  }
  if (data && (data as { error?: string }).error) throw new Error((data as { error: string }).error)
  return data as T
}

function Ventana({ titulo, cerrar, children, pie, ancho = 'sm:max-w-lg' }: { titulo: string; cerrar: () => void; children: React.ReactNode; pie: React.ReactNode; ancho?: string }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className={'bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden ' + ancho}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0"><h3 className="font-display font-bold text-sm text-slate-800">{titulo}</h3><button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">{children}</div>
        <div className="shrink-0 border-t border-slate-100 p-4 flex gap-2 items-center">{pie}</div>
      </div>
    </div>
  )
}

/* ============================ Configuración ============================ */
type Estado = { proveedor: string; configurado: boolean; vista: string; config: { modelo?: string }; estado_prueba: string | null; probado_en: string | null; actualizado: string | null }
const MODELOS = [['gemini-2.5-flash', 'Gemini 2.5 Flash · equilibrado (recomendado)'], ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite · el más rápido y económico'], ['gemini-2.5-pro', 'Gemini 2.5 Pro · máxima calidad']]

export function Configuracion({ aviso, alCambiar }: { aviso: (t: string) => void; alCambiar: () => void }) {
  const [estados, setEstados] = useState<Estado[] | null>(null)
  const [error, setError] = useState('')
  const cargar = useCallback(() => {
    supabase.rpc('integraciones_estado').then(({ data, error }) => { if (error) setError(error.message); else { setError(''); setEstados((data as Estado[]) ?? []) } })
  }, [])
  useEffect(() => { cargar() }, [cargar])
  if (error) return <div className="card p-6 text-sm text-amber-800 bg-amber-50 border-amber-200">{error}</div>
  if (!estados) return <p className="text-xs text-slate-400 p-4">Cargando conexiones…</p>
  const ver = (p: string) => estados.find((e) => e.proveedor === p) ?? { proveedor: p, configurado: false, vista: '', config: {}, estado_prueba: null, probado_en: null, actualizado: null }
  return (
    <section className="space-y-4">
      <div className="card p-4 text-xs text-slate-600 flex gap-3 items-start"><KeyRound className="w-4 h-4 mt-0.5 shrink-0 text-[var(--primary)]" />
        <p>Las claves se guardan <b>cifradas en el servidor</b> y solo las usa la aplicación para hablar con cada servicio: nadie puede verlas después de guardarlas, ni siquiera quien administra. Para cambiarlas, pega una nueva.</p></div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Tarjeta proveedor="zernio" titulo="Zernio · redes sociales" sub="Publica y programa en Facebook e Instagram desde el Planificador." est={ver('zernio')} aviso={aviso} cambio={() => { cargar(); alCambiar() }}
          ayuda="En el panel de Zernio crea una clave de API (API Keys) y pégala aquí. Es la misma que usaba la app anterior." />
        <Tarjeta proveedor="gemini" titulo="Gemini · inteligencia artificial" sub="Redacta publicaciones y descripciones de producto." est={ver('gemini')} aviso={aviso} cambio={() => { cargar(); alCambiar() }}
          ayuda="Crea una clave en Google AI Studio (aistudio.google.com/apikey) y pégala aquí." conModelo />
        <TarjetaDrive est={ver('drive')} aviso={aviso} cambio={() => { cargar(); alCambiar() }} />
        <TarjetaPixel proveedor="meta_pixel" titulo="Meta Conversions API" color="#1877f2" est={ver('meta_pixel')} aviso={aviso} cambio={() => { cargar(); alCambiar() }} />
        <TarjetaPixel proveedor="tiktok_pixel" titulo="TikTok Events API" color="#000000" est={ver('tiktok_pixel')} aviso={aviso} cambio={() => { cargar(); alCambiar() }} />
      </div>
    </section>
  )
}

/* Rastreo de conversiones del lado del servidor: además del píxel normal en el navegador, el
   servidor reporta el mismo evento por la API oficial de Meta/TikTok (mismo eventId, para que no
   se cuente doble). Evita perder eventos por bloqueadores de anuncios o restricciones de iOS/Safari. */
function TarjetaPixel({ proveedor, titulo, color, est, aviso, cambio }: {
  proveedor: 'meta_pixel' | 'tiktok_pixel'; titulo: string; color: string; est: Estado; aviso: (t: string) => void; cambio: () => void
}) {
  const cfg = est.config as { pixelId?: string }
  const [pixelId, setPixelId] = useState(cfg.pixelId ?? '')
  const [token, setToken] = useState('')
  const [ocupado, setOcupado] = useState('')
  const prueba = est.estado_prueba ?? '', ok = prueba.startsWith('ok')
  async function guardar() {
    if (!pixelId.trim()) { aviso('Pon el ID del píxel.'); return }
    if (!token.trim() && !est.configurado) { aviso('Pega el token de acceso.'); return }
    setOcupado('guardar')
    const { error } = await supabase.rpc('integracion_guardar', { p_proveedor: proveedor, p_secreto: token.trim() || null, p_config: { pixelId: pixelId.trim() } })
    setOcupado('')
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    const nueva = !!token.trim(); setToken(''); aviso(nueva ? 'Token guardado. Probando…' : 'ID del píxel actualizado.'); cambio()
    if (nueva) probar()
  }
  async function probar() {
    setOcupado('probar')
    try { const r = await llamar<{ mensaje: string }>('probar', { proveedor }); aviso(r.mensaje) } catch (e) { aviso((e as Error).message) }
    setOcupado(''); cambio()
  }
  async function quitar() {
    if (!confirm('¿Desconectar ' + titulo + '?')) return
    const { error } = await supabase.rpc('integracion_quitar', { p_proveedor: proveedor })
    if (error) aviso('No se pudo quitar: ' + error.message); else { setPixelId(''); aviso('Conexión eliminada.'); cambio() }
  }
  return (
    <article className="card p-5">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: color + '1A', color }}><Tag className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1"><h3 className="font-display font-bold text-sm text-slate-800">{titulo}</h3><p className="text-[11px] text-slate-500">Reporta conversiones (leads, ventas) desde el servidor, para no perder eventos por bloqueadores de anuncios o iOS.</p></div>
        <span className="pill shrink-0" style={est.configurado ? (prueba && !ok ? { background: '#fdecea', color: '#c0392b' } : { background: '#ecfaf5', color: '#04896f' }) : { background: '#f1f5f9', color: '#64748b' }}>
          {est.configurado ? (prueba ? (ok ? 'Conectado' : 'Con error') : 'Sin probar') : 'No conectado'}</span>
      </div>
      <label className="block text-[11px] font-bold text-slate-500 mt-3">ID del píxel
        <input type="text" value={pixelId} onChange={(e) => setPixelId(e.target.value)} className="inp w-full mt-1" placeholder="Ej. 123456789012345" /></label>
      <label className="block text-[11px] font-bold text-slate-500 mt-3">Token de acceso{est.configurado && <span className="font-mono-spec font-normal text-slate-400"> · actual {est.vista}</span>}
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="inp w-full mt-1" placeholder={est.configurado ? 'Pega uno nuevo para reemplazarlo' : 'Pega aquí el token'} /></label>
      {prueba && <p className="text-[11px] mt-3 rounded-lg px-3 py-2" style={ok ? { background: '#ecfaf5', color: '#04896f' } : { background: '#fdecea', color: '#a3341f' }}>{prueba.replace(/^(ok|error): /, '')}{est.probado_en ? ' · ' + new Date(est.probado_en).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : ''}</p>}
      <div className="flex gap-2 flex-wrap mt-4">
        <button type="button" className="btn btn-primary" onClick={guardar} disabled={!!ocupado}><Check />{ocupado === 'guardar' ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="btn" onClick={probar} disabled={!!ocupado || !est.configurado}><Plug />{ocupado === 'probar' ? 'Probando…' : 'Probar conexión'}</button>
        {est.configurado && <button type="button" className="btn ml-auto" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={quitar}><Trash2 />Desconectar</button>}
      </div>
    </article>
  )
}

function Tarjeta({ proveedor, titulo, sub, est, aviso, cambio, ayuda, conModelo }: { proveedor: 'zernio' | 'gemini'; titulo: string; sub: string; est: Estado; aviso: (t: string) => void; cambio: () => void; ayuda: string; conModelo?: boolean }) {
  const [clave, setClave] = useState('')
  const [modelo, setModelo] = useState(est.config?.modelo || 'gemini-2.5-flash')
  const [ocupado, setOcupado] = useState('')
  const [cuentas, setCuentas] = useState<{ id: string; plataforma: string; nombre: string }[]>([])
  const prueba = est.estado_prueba ?? ''
  const ok = prueba.startsWith('ok')
  async function guardar() {
    if (!clave.trim() && !conModelo) { aviso('Pega la clave primero.'); return }
    setOcupado('guardar')
    const { error } = await supabase.rpc('integracion_guardar', { p_proveedor: proveedor, p_secreto: clave.trim() || null, p_config: conModelo ? { modelo } : {} })
    setOcupado('')
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    const nueva = !!clave.trim(); setClave(''); aviso(nueva ? 'Clave guardada. Probando la conexión…' : 'Configuración guardada.'); cambio()
    if (nueva) probar()
  }
  async function probar() {
    setOcupado('probar')
    try {
      const r = await llamar<{ ok: boolean; mensaje: string; extra?: typeof cuentas }>('probar', { proveedor })
      if (proveedor === 'zernio') setCuentas(r.extra ?? [])
      aviso(r.mensaje)
    } catch (e) { aviso((e as Error).message) }
    setOcupado(''); cambio()
  }
  async function quitar() {
    if (!confirm('¿Desconectar ' + (proveedor === 'zernio' ? 'Zernio' : 'Gemini') + '? Dejará de funcionar hasta que pegues una clave nueva.')) return
    const { error } = await supabase.rpc('integracion_quitar', { p_proveedor: proveedor })
    if (error) aviso('No se pudo quitar: ' + error.message); else { setCuentas([]); aviso('Conexión eliminada.'); cambio() }
  }
  return (
    <article className="card p-5">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: proveedor === 'zernio' ? '#e1306c1A' : '#7c3aed1A', color: proveedor === 'zernio' ? '#e1306c' : '#7c3aed' }}>{proveedor === 'zernio' ? <Link2 className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}</span>
        <div className="min-w-0 flex-1"><h3 className="font-display font-bold text-sm text-slate-800">{titulo}</h3><p className="text-[11px] text-slate-500">{sub}</p></div>
        <span className="pill shrink-0" style={est.configurado ? (prueba && !ok ? { background: '#fdecea', color: '#c0392b' } : { background: '#ecfaf5', color: '#04896f' }) : { background: '#f1f5f9', color: '#64748b' }}>
          {est.configurado ? (prueba ? (ok ? 'Conectado' : 'Con error') : 'Sin probar') : 'No conectado'}</span>
      </div>
      <p className="text-[11px] text-slate-500 mt-3">{ayuda}</p>
      <label className="block text-[11px] font-bold text-slate-500 mt-3">Clave de API{est.configurado && <span className="font-mono-spec font-normal text-slate-400"> · actual {est.vista}</span>}
        <input type="password" autoComplete="off" value={clave} onChange={(e) => setClave(e.target.value)} className="inp w-full mt-1" placeholder={est.configurado ? 'Pega una nueva para reemplazarla' : 'Pega aquí la clave'} /></label>
      {conModelo && (
        <label className="block text-[11px] font-bold text-slate-500 mt-3">Modelo de IA
          <select value={modelo} onChange={(e) => setModelo(e.target.value)} className="inp w-full mt-1">{MODELOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
      )}
      {prueba && <p className="text-[11px] mt-3 rounded-lg px-3 py-2" style={ok ? { background: '#ecfaf5', color: '#04896f' } : { background: '#fdecea', color: '#a3341f' }}>{prueba.replace(/^(ok|error): /, '')}{est.probado_en ? ' · ' + new Date(est.probado_en).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : ''}</p>}
      {cuentas.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{cuentas.map((c) => <span key={c.id} className="pill" style={{ background: '#eff6ff', color: '#055c9d' }}>{c.plataforma} · {c.nombre}</span>)}</div>}
      <div className="flex gap-2 flex-wrap mt-4">
        <button type="button" className="btn btn-primary" onClick={guardar} disabled={!!ocupado}><Check />{ocupado === 'guardar' ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="btn" onClick={probar} disabled={!!ocupado || !est.configurado}><Plug />{ocupado === 'probar' ? 'Probando…' : 'Probar conexión'}</button>
        {est.configurado && <button type="button" className="btn ml-auto" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={quitar}><Trash2 />Desconectar</button>}
      </div>
    </article>
  )
}

/* ============================ Planificador (Zernio) ============================ */
type Post = { id: string; contenido: string; estado: string; fecha: string; plataformas: string[]; imagen: string }
type Cuenta = { id: string; plataforma: string; nombre: string }
export type PiezaMin = { id: string; titulo: string; tipo: string; estado: string; url: string; producto: string }
const ESTADO_POST = (s: string) => { const t = s.toLowerCase(); return /publish|publicad/.test(t) ? ['Publicada', '#04896f', '#ecfaf5'] : /schedul|program/.test(t) ? ['Programada', '#055c9d', '#eff6ff'] : /fail|error|fall/.test(t) ? ['Falló', '#c0392b', '#fdecea'] : /draft|borrador/.test(t) ? ['Borrador', '#64748b', '#f1f5f9'] : [s || '—', '#64748b', '#f1f5f9'] }

export function Planificador({ perfil, piezas, piezaInicial, limpiarPieza, irConfig, aviso, alSincronizar, abrirAlEntrar, consumirAbrir }: {
  perfil: Perfil; piezas: PiezaMin[]; piezaInicial: PiezaMin | null; limpiarPieza: () => void; irConfig: () => void; aviso: (t: string) => void; alSincronizar: () => void
  abrirAlEntrar?: boolean; consumirAbrir?: () => void
}) {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [error, setError] = useState('')
  const [nueva, setNueva] = useState(false)
  const [cargando, setCargando] = useState(false)
  const crear = puede(perfil, 'marketing', 'crear')

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [c, p] = await Promise.all([llamar<{ cuentas: Cuenta[] }>('zernio_cuentas'), llamar<{ posts: Post[] }>('zernio_posts')])
      setCuentas(c.cuentas); setPosts(p.posts.sort((a, b) => Date.parse(b.fecha || '0') - Date.parse(a.fecha || '0'))); setError('')
      // Sincroniza el estado de las piezas audiovisuales con lo que realmente pasó en Zernio.
      const { data } = await supabase.from('audiovisual').select('id,estado,publicacion_id').is('deleted_at', null).not('publicacion_id', 'is', null)
      let cambios = 0
      for (const a of (data ?? []) as { id: string; estado: string; publicacion_id: string }[]) {
        const post = p.posts.find((x) => x.id === a.publicacion_id); if (!post) continue
        const [t] = ESTADO_POST(post.estado)
        const nuevo = t === 'Publicada' ? 'Publicado' : t === 'Programada' ? 'Programado' : t === 'Falló' ? 'Listo' : a.estado
        if (nuevo !== a.estado) { await supabase.from('audiovisual').update({ estado: nuevo }).eq('id', a.id); cambios++ }
      }
      if (cambios) alSincronizar()
    } catch (e) { setError((e as Error).message) }
    setCargando(false)
  }, [alSincronizar])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { if (piezaInicial) setNueva(true) }, [piezaInicial])
  useEffect(() => { if (abrirAlEntrar) { setNueva(true); consumirAbrir?.() } }, [abrirAlEntrar]) // eslint-disable-line react-hooks/exhaustive-deps

  async function borrar(p: Post) {
    if (!confirm('¿Eliminar esta publicación de Zernio?')) return
    try { await llamar('zernio_eliminar', { postId: p.id }); aviso('Publicación eliminada.'); cargar(); alSincronizar() } catch (e) { aviso((e as Error).message) }
  }
  const grupos = useMemo(() => { const g: Record<string, Post[]> = {}; (posts ?? []).forEach((p) => { const k = p.fecha ? p.fecha.slice(0, 10) : 'Sin fecha'; (g[k] = g[k] || []).push(p) }); return Object.entries(g) }, [posts])

  return (
    <section>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <p className="text-xs text-slate-500 mr-auto">{posts ? `${posts.length} publicaciones · ${cuentas.length} cuenta${cuentas.length === 1 ? '' : 's'} conectada${cuentas.length === 1 ? '' : 's'}` : ''}</p>
        <button type="button" className="btn" onClick={cargar} disabled={cargando}><RefreshCw className={cargando ? 'animate-spin' : ''} />Sincronizar</button>
        {crear && <button type="button" className="btn btn-primary" onClick={() => setNueva(true)} disabled={!!error}><CalendarClock />Nueva publicación</button>}
      </div>
      {error && (
        <div className="card p-6 text-center"><p className="text-sm font-bold text-slate-700">No se pudo conectar con Zernio</p><p className="text-xs text-slate-500 mt-1">{error}</p>
          {puede(perfil, 'marketing', 'administrar') && <button type="button" className="btn btn-primary mt-3" onClick={irConfig}><Plug />Ir a Configuración</button>}</div>
      )}
      {!error && !posts && <p className="text-xs text-slate-400">Cargando publicaciones…</p>}
      {posts && !posts.length && !error && <div className="card p-10 text-center"><p className="text-3xl">📅</p><p className="text-sm font-bold text-slate-700 mt-2">Todavía no hay publicaciones</p><p className="text-xs text-slate-400 mt-1">Crea la primera: puedes redactarla con IA y programarla.</p></div>}
      {grupos.map(([dia, lista]) => (
        <div key={dia} className="mb-5">
          <h3 className="text-[11px] font-mono-spec uppercase text-slate-500 mb-2 font-bold">{dia === 'Sin fecha' ? dia : new Date(dia + 'T12:00:00').toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {lista.map((p) => { const [t, c, bg] = ESTADO_POST(p.estado); return (
              <article key={p.id} className="card p-3 flex gap-3">
                {p.imagen ? <img src={p.imagen} alt="" className="w-20 h-20 rounded-xl object-cover shrink-0 bg-slate-100" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="w-20 h-20 rounded-xl bg-slate-100 shrink-0 grid place-items-center text-slate-300 text-2xl">✎</span>}
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2 flex-wrap"><span className="pill" style={{ background: bg, color: c }}>{t}</span>
                  {p.plataformas.map((x) => <span key={x} className="text-[10px] text-slate-500 font-semibold capitalize">{x}</span>)}
                  {p.fecha && <span className="text-[10px] text-slate-400 ml-auto">{new Date(p.fecha).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}</span>}</div>
                  <p className="text-xs text-slate-700 mt-1.5 line-clamp-3 whitespace-pre-line">{p.contenido}</p></div>
                {crear && t !== 'Publicada' && <button type="button" className="text-slate-300 hover:text-red-600 self-start" onClick={() => borrar(p)} aria-label="Eliminar"><Trash2 className="w-4 h-4" /></button>}
              </article>) })}
          </div>
        </div>
      ))}
      {nueva && <NuevaPublicacion cuentas={cuentas} piezas={piezas} inicial={piezaInicial} cerrar={() => { setNueva(false); limpiarPieza() }} aviso={aviso}
        hecho={() => { setNueva(false); limpiarPieza(); cargar(); alSincronizar() }} />}
    </section>
  )
}

function NuevaPublicacion({ cuentas, piezas, inicial, cerrar, hecho, aviso }: { cuentas: Cuenta[]; piezas: PiezaMin[]; inicial: PiezaMin | null; cerrar: () => void; hecho: () => void; aviso: (t: string) => void }) {
  const [texto, setTexto] = useState(inicial ? inicial.titulo : '')
  const [sel, setSel] = useState<string[]>([])
  const [pieza, setPieza] = useState(inicial?.id ?? '')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [fecha, setFecha] = useState('')
  const [ind, setInd] = useState('')
  const [ia, setIa] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const elegida = piezas.find((p) => p.id === pieza)
  const conImagen = piezas.filter((p) => p.url && !/video|reel/i.test(p.tipo) && ['Listo', 'Programado', 'Publicado', 'En edición'].includes(p.estado))

  async function redactar() {
    setIa(true); setError('')
    try {
      const r = await llamar<{ texto: string }>('ia_texto', { producto: elegida?.producto || elegida?.titulo || '', indicaciones: ind, actual: texto, plataforma: cuentas.filter((c) => sel.includes(c.id)).map((c) => c.plataforma).join(' y ') || 'Instagram y Facebook' })
      setTexto(r.texto)
    } catch (e) { setError((e as Error).message) }
    setIa(false)
  }
  async function publicar() {
    if (!texto.trim()) { setError('Escribe el texto de la publicación.'); return }
    if (!sel.length) { setError('Elige al menos una cuenta.'); return }
    if (archivo && archivo.size > 6 * 1024 * 1024) { setError('La imagen supera los 6 MB.'); return }
    setEnviando(true); setError('')
    try {
      let b64 = ''
      if (archivo) b64 = await new Promise<string>((ok, no) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(',')[1] || ''); f.onerror = () => no(new Error('No se pudo leer la imagen.')); f.readAsDataURL(archivo) })
      const plataformas = cuentas.filter((c) => sel.includes(c.id)).map((c) => ({ platform: c.plataforma, accountId: c.id }))
      await llamar('zernio_crear', { contenido: texto.trim(), plataformas, fechaISO: fecha ? new Date(fecha).toISOString() : '', imagenBase64: b64, imagenNombre: archivo?.name, imagenTipo: archivo?.type, imagenUrl: !archivo && elegida?.url ? elegida.url : '', audiovisualId: pieza || undefined })
      aviso(fecha ? 'Publicación programada.' : 'Publicación enviada.'); hecho()
    } catch (e) { setError((e as Error).message) }
    setEnviando(false)
  }
  return (
    <Ventana titulo="Nueva publicación" cerrar={cerrar} ancho="sm:max-w-xl" pie={<><p className="text-[11px] flex-1" style={{ color: '#c0392b' }}>{error}</p><button className="btn btn-primary" onClick={publicar} disabled={enviando}><Send />{enviando ? 'Enviando…' : fecha ? 'Programar' : 'Publicar ahora'}</button></>}>
      <div>
        <p className="text-[11px] font-bold text-slate-500 mb-1">Dónde publicar</p>
        <div className="flex flex-wrap gap-1.5">{cuentas.length ? cuentas.map((c) => { const on = sel.includes(c.id); return (
          <button key={c.id} type="button" onClick={() => setSel((s) => (on ? s.filter((x) => x !== c.id) : [...s, c.id]))} className="pill" style={on ? { background: '#055c9d', color: '#fff' } : { background: '#f1f5f9', color: '#475569' }}>{on ? '✓ ' : ''}{c.plataforma} · {c.nombre}</button>) }) : <span className="text-[11px] text-slate-400">No hay cuentas conectadas en Zernio.</span>}</div>
      </div>
      <label className="block text-[11px] font-bold text-slate-500">Pieza de Audiovisual (opcional)
        <select value={pieza} onChange={(e) => { setPieza(e.target.value); setArchivo(null) }} className="inp w-full mt-1"><option value="">— Ninguna —</option>{conImagen.map((p) => <option key={p.id} value={p.id}>{p.titulo} · {p.estado}</option>)}</select></label>
      {elegida?.url && !archivo && <img src={elegida.url} alt="" className="h-28 rounded-xl object-cover border border-slate-200" />}
      <label className="block text-[11px] font-bold text-slate-500">…o sube una imagen<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); if (e.target.files?.[0]) setPieza('') }} className="block mt-1 text-xs" /></label>
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-2">
        <p className="text-[11px] font-bold text-violet-700 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" />Redactar con IA (Gemini)</p>
        <input value={ind} onChange={(e) => setInd(e.target.value)} className="inp w-full" placeholder="Indicaciones: promoción, tono, qué resaltar… (opcional)" />
        <button type="button" className="btn" onClick={redactar} disabled={ia}><Sparkles />{ia ? 'Redactando…' : texto.trim() ? 'Mejorar el texto' : 'Redactar'}</button>
      </div>
      <label className="block text-[11px] font-bold text-slate-500">Texto de la publicación<textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={7} className="inp w-full mt-1" placeholder="Escribe o redacta con IA…" /></label>
      <label className="block text-[11px] font-bold text-slate-500">Programar para (vacío = publicar ahora)<input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} className="inp w-full mt-1" /></label>
    </Ventana>
  )
}

/* ============================ Biblioteca (descripciones con IA) ============================ */
type Prod = {
  id: string; codigo: string; nombre: string; descripcion: string | null; imagen_url: string | null; categoria: { nombre: string } | null; marca: string | null
  drive_carpeta_url: string | null; ficha_tecnica_url: string | null; fecha_creacion: string | null; sin_etiqueta_nuevo: boolean; en_catalogo: boolean
}
const DIAS_NUEVO = 30
const normalize = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
function prodReciente(p: Prod) { const t = p.fecha_creacion ? Date.parse(p.fecha_creacion) : NaN; return isFinite(t) && Date.now() - t < DIAS_NUEVO * 864e5 }
function prodFaltan(p: Prod, tieneGaleria: boolean) {
  const f: string[] = []
  if (!p.imagen_url) f.push('imagen')
  if (!String(p.descripcion || '').trim()) f.push('descripción')
  if (!p.ficha_tecnica_url) f.push('ficha')
  if (!p.drive_carpeta_url && !tieneGaleria) f.push('álbum o galería')
  return f
}
function prodEsNuevo(p: Prod) { return prodReciente(p) && !p.sin_etiqueta_nuevo }

export function Biblioteca({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [productos, setProductos] = useState<Prod[]>([])
  const [galCount, setGalCount] = useState<Record<string, number>>({})
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [miss, setMiss] = useState('')
  const [limite, setLimite] = useState(48)
  const [sel, setSel] = useState<Prod | null>(null)
  const centinela = useRef<HTMLDivElement>(null)

  const cargar = useCallback(() => {
    setCargando(true)
    ;(async () => {
      const PAGE = 1000
      // Supabase corta cada respuesta en ~1000 filas sin importar el .limit() pedido:
      // hay que paginar con .range() hasta que una página vuelva incompleta.
      const todos: Prod[] = []
      for (let desde = 0; ; desde += PAGE) {
        const { data, error } = await supabase.from('productos')
          .select('id,codigo,nombre,descripcion,imagen_url,marca,drive_carpeta_url,ficha_tecnica_url,fecha_creacion,sin_etiqueta_nuevo,en_catalogo,categoria:categorias(nombre)')
          .is('deleted_at', null).or('estado.is.null,estado.not.ilike.inactivo').order('en_catalogo', { ascending: false }).order('nombre').order('id')
          .range(desde, desde + PAGE - 1)
        const pagina = (data as unknown as Prod[]) ?? []
        if (error || !pagina.length) break
        todos.push(...pagina)
        if (pagina.length < PAGE) break
      }
      setProductos(todos); setCargando(false)

      const c: Record<string, number> = {}
      for (let desde = 0; ; desde += PAGE) {
        const { data, error } = await supabase.from('producto_galeria').select('producto_id').is('deleted_at', null).order('id').range(desde, desde + PAGE - 1)
        const pagina = (data as { producto_id: string }[]) ?? []
        if (error || !pagina.length) break
        for (const g of pagina) c[g.producto_id] = (c[g.producto_id] ?? 0) + 1
        if (pagina.length < PAGE) break
      }
      setGalCount(c)
    })()
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const categorias = useMemo(() => [...new Set(productos.map((p) => p.categoria?.nombre).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es')), [productos])
  const marcas = useMemo(() => [...new Set(productos.map((p) => p.marca).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es')), [productos])

  const filtrados = useMemo(() => {
    const palabras = normalize(q).split(/\s+/).filter(Boolean)
    return productos.filter((p) => {
      if (palabras.length) {
        const haystack = normalize([p.codigo, p.nombre, p.categoria?.nombre, p.marca].join(' '))
        if (!palabras.every((w) => haystack.includes(w))) return false
      }
      if (cat && p.categoria?.nombre !== cat) return false
      const tieneGal = !!galCount[p.id]
      const faltan = prodFaltan(p, tieneGal)
      if (miss === 'inc' && !(prodReciente(p) && faltan.length)) return false
      if (miss === 'img' && p.imagen_url) return false
      if (miss === 'desc' && String(p.descripcion || '').trim()) return false
      if (miss === 'ficha' && p.ficha_tecnica_url) return false
      if (miss === 'album' && (p.drive_carpeta_url || tieneGal)) return false
      return true
    }).map((p) => ({ p, reciente: prodReciente(p), faltan: prodFaltan(p, !!galCount[p.id]) }))
      // Prioridad: visibles en la web pública primero, luego nuevos incompletos, luego el resto.
      .sort((a, b) => (Number(b.p.en_catalogo) - Number(a.p.en_catalogo)) || (Number(b.reciente && b.faltan.length > 0) - Number(a.reciente && a.faltan.length > 0)))
  }, [productos, q, cat, miss, galCount])

  const pendientes = useMemo(() => productos.filter((p) => prodReciente(p) && prodFaltan(p, !!galCount[p.id]).length).length, [productos, galCount])

  // Scroll infinito: cuando el centinela entra en pantalla, se revela más de la lista ya cargada.
  useEffect(() => {
    const el = centinela.current
    if (!el) return
    const obs = new IntersectionObserver((entradas) => { if (entradas[0]?.isIntersecting) setLimite((l) => l + 48) }, { rootMargin: '600px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [filtrados.length])

  return (
    <section>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-md"><Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimite(48) }} placeholder="Buscar nombre, categoría o código…" className="inp pl-9 w-full" /></div>
        <select className="inp" value={cat} onChange={(e) => { setCat(e.target.value); setLimite(48) }} aria-label="Categoría">
          <option value="">Todas las categorías</option>{categorias.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="inp" value={miss} onChange={(e) => { setMiss(e.target.value); setLimite(48) }} aria-label="Faltantes">
          <option value="">Todos</option><option value="inc">Nuevos por completar</option><option value="img">Sin imagen</option><option value="desc">Sin descripción</option><option value="ficha">Sin ficha</option><option value="album">Sin álbum</option>
        </select>
        <button type="button" className="btn" onClick={cargar}><RefreshCw className="w-3.5 h-3.5" />Actualizar</button>
        <span className="text-[11px] text-slate-500 ml-auto">{cargando ? 'Cargando biblioteca…' : productos.length + ' productos' + (pendientes ? ' · ' + pendientes + ' nuevo' + (pendientes === 1 ? '' : 's') + ' por completar' : '')}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {filtrados.slice(0, limite).map(({ p, faltan, reciente }) => (
          <button type="button" key={p.id} className="av-card text-left flex flex-col" onClick={() => setSel(p)}>
            <div className="aspect-square bg-slate-100 overflow-hidden relative">
              {p.imagen_url
                ? <img loading="lazy" src={imagen(p.imagen_url, 320)} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                : <span className="w-full h-full grid place-items-center text-slate-300"><ImagePlus className="w-7 h-7" /></span>}
              {prodEsNuevo(p) && <span className="absolute top-1.5 left-1.5 text-[9px] font-bold uppercase tracking-wider text-white bg-[#c98a1f] rounded-full px-2 py-0.5">Nuevo</span>}
            </div>
            <div className="p-2.5 flex-1 flex flex-col">
              <p className="text-[10px] font-mono-spec text-slate-400 truncate">{p.codigo}{p.categoria ? ' · ' + p.categoria.nombre : ''}</p>
              <p className="text-xs font-bold text-slate-800 mt-0.5 line-clamp-2">{p.nombre}</p>
              {reciente && faltan.length > 0 && <p className="text-[10px] text-amber-700 mt-1 line-clamp-2">Falta: {faltan.join(', ')}</p>}
              <div className="flex gap-1 mt-auto pt-2 flex-wrap">
                <span className={'pill ' + (p.imagen_url ? 'bg-sky-50 text-sky-700' : 'bg-red-50 text-red-600')}>{p.imagen_url ? 'Img' : 'Sin img'}</span>
                <span className={'pill ' + (String(p.descripcion || '').trim() ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400')}>Desc</span>
                <span className={'pill ' + (p.ficha_tecnica_url ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400')}>Ficha</span>
                <span className={'pill ' + ((p.drive_carpeta_url || galCount[p.id]) ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-400')}>Álbum</span>
              </div>
            </div>
          </button>
        ))}
        {!cargando && !filtrados.length && <p className="col-span-full p-8 text-center text-sm text-slate-400">No hay productos con estos filtros.</p>}
      </div>
      {filtrados.length > limite && <div ref={centinela} className="py-6 text-center text-[11px] text-slate-400">Cargando más productos…</div>}
      {sel && <EditorProducto perfil={perfil} prod={sel} categorias={categorias} marcas={marcas} cerrar={() => setSel(null)} aviso={aviso} />}
    </section>
  )
}

/* Campos de "Datos del producto" que se editan directo o pasan por Revisión,
   igual que ya funcionaba Descripción (marketing_cambios + permiso 'aprobar').
   'modelo' vive en la columna codigo_unico y 'publico' en en_catalogo. */
const CAMPO_COL: Record<string, string> = { modelo: 'codigo_unico', publico: 'en_catalogo', nuevo: 'sin_etiqueta_nuevo', album: 'drive_carpeta_url', ficha: 'ficha_tecnica_url' }
const CAMPOS_BOOL = ['publico', 'nuevo']
export const CAMPOS_PRODUCTO = ['descripcion', 'nombre', 'categoria', 'marca', 'modelo', 'garantia', 'accesorios', 'certificaciones', 'caracteristicas', 'especificaciones', 'publico', 'imagen_url', 'nuevo', 'album', 'ficha', 'destacados']

export async function aplicarCampoProducto(productoId: string, campo: string, valorNuevo: string): Promise<string | null> {
  if (campo === 'categoria') {
    const nombre = valorNuevo.trim()
    let categoria_id: string | null = null
    if (nombre) {
      const { data: existente } = await supabase.from('categorias').select('id').ilike('nombre', nombre).maybeSingle()
      if (existente) categoria_id = existente.id
      else {
        const nueva = crypto.randomUUID()
        const { error } = await supabase.from('categorias').insert({ id: nueva, nombre })
        if (error) return error.message
        categoria_id = nueva
      }
    }
    const { error } = await supabase.from('productos').update({ categoria_id }).eq('id', productoId)
    return error?.message ?? null
  }
  const col = CAMPO_COL[campo] ?? campo
  const valor: string | boolean | null = CAMPOS_BOOL.includes(campo) ? valorNuevo === 'SI' : (valorNuevo.trim() || null)
  const { error } = await supabase.from('productos').update({ [col]: valor }).eq('id', productoId)
  return error?.message ?? null
}

type ProdFull = {
  nombre: string; categoria: string; marca: string; codigo_unico: string; garantia: string; accesorios: string; certificaciones: string
  caracteristicas: string; especificaciones: string; destacados: string; ficha_tecnica_url: string
  pvp: number; aplica_iva: boolean; en_catalogo: boolean; imagen_url: string; descripcion: string; drive_carpeta_url: string
}
type GalItem = { id: string; tipo: 'imagen' | 'video'; archivo_url: string; descripcion: string | null; orden: number }
type DocTecnico = { id: string; tipo: string; nombre: string; url: string | null }
const DOC_TIPOS = ['Manual de usuario', 'Manual de servicio', 'Hoja de datos del fabricante', 'Certificado', 'Registro sanitario', 'Otro']
const DOC_OBLIGATORIOS = ['Manual de usuario', 'Hoja de datos del fabricante', 'Registro sanitario']
type Ficha = { version: number; url: string; fecha: string }
type Especificacion = { dato: string; valor: string }

function construirFichaHtml(full: ProdFull, codigo: string, destacadosSel: string[], especs: Especificacion[]): string {
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const car = full.caracteristicas.split('\n').map((x) => x.trim()).filter(Boolean)
  const certs = full.certificaciones.split(/[,;·\n]/).map((x) => x.trim()).filter(Boolean)
  const destacadosEsp = destacadosSel.length ? especs.filter((e) => destacadosSel.includes(e.dato)) : especs.slice(0, 3)
  return `<style>
    .ft-page{font-family:Arial,sans-serif;color:#0b2545;font-size:12px;width:210mm;min-height:297mm;box-sizing:border-box;padding:16mm;margin:0 auto;background:#fff}
    .ft-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #055c9d;padding-bottom:10px;margin-bottom:14px}
    .ft-tag{display:inline-block;border:2px solid #055c9d;color:#055c9d;font-weight:bold;letter-spacing:2px;padding:4px 12px;border-radius:8px;font-size:12px}
    .ft-img{display:block;margin:0 auto 14px;max-width:70mm;max-height:60mm;object-fit:contain}
    .ft-destacados{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
    .ft-chip{background:#eef6fd;border:1px solid #cfe3f5;border-radius:8px;padding:6px 10px;font-size:10.5px}
    .ft-tabla{width:100%;border-collapse:collapse;margin:8px 0}
    .ft-tabla td{padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:11px}
    .ft-car{margin:0;padding:0;list-style:none}
    .ft-car li{padding:3px 0;font-size:11px}
    .ft-cert{display:inline-block;background:#f0fdf8;border:1px solid #bfe6da;color:#04896f;border-radius:999px;padding:3px 10px;font-size:10px;margin:0 4px 4px 0}
  </style>
  <div class="ft-page">
    <div class="ft-head">
      <div><b style="font-size:22px;color:#055c9d">VIMEDIC</b><br><span class="ft-tag">FICHA TÉCNICA</span></div>
      <div style="text-align:right;font-size:10px;color:#64748b">${esc(codigo)}<br>${esc(new Date().toLocaleDateString('es-EC'))}</div>
    </div>
    <h1 style="font-size:17px;margin:0 0 2px">${esc(full.nombre)}</h1>
    <p style="font-size:11px;color:#64748b;margin:0 0 12px">${[full.marca, full.codigo_unico, full.categoria].filter(Boolean).map(esc).join(' · ')}</p>
    ${full.imagen_url ? `<img class="ft-img" src="${esc(full.imagen_url)}">` : ''}
    ${destacadosEsp.length ? `<div class="ft-destacados">${destacadosEsp.map((e) => `<span class="ft-chip"><b>${esc(e.dato)}:</b> ${esc(e.valor)}</span>`).join('')}</div>` : ''}
    ${full.descripcion ? `<p style="font-size:11.5px;line-height:1.5">${esc(full.descripcion)}</p>` : ''}
    ${car.length ? `<h3 style="font-size:12px;margin:14px 0 4px">Características</h3><ul class="ft-car">${car.map((c) => `<li>✓ ${esc(c)}</li>`).join('')}</ul>` : ''}
    ${especs.length ? `<h3 style="font-size:12px;margin:14px 0 4px">Especificaciones técnicas</h3><table class="ft-tabla">${especs.map((e) => `<tr><td style="font-weight:bold;width:40%">${esc(e.dato)}</td><td>${esc(e.valor)}</td></tr>`).join('')}</table>` : ''}
    ${full.garantia ? `<p style="font-size:11px;margin-top:10px"><b>Garantía:</b> ${esc(full.garantia)}</p>` : ''}
    ${certs.length ? `<div style="margin-top:8px">${certs.map((c) => `<span class="ft-cert">${esc(c)}</span>`).join('')}</div>` : ''}
    <p style="margin-top:24px;font-size:9px;color:#94a3b8;text-align:center">vimedic.com.ec · ${esc(codigo)}</p>
  </div>`
}
const WEB = 'vimedic.com.ec'
const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function EditorProducto({ perfil, prod, categorias, marcas, cerrar, aviso }: { perfil: Perfil; prod: Prod; categorias: string[]; marcas: string[]; cerrar: () => void; aviso: (t: string) => void }) {
  const [full, setFull] = useState<ProdFull | null>(null)
  const [base, setBase] = useState<Record<string, string>>({})
  const [notas, setNotas] = useState('')
  const [ia, setIa] = useState(false)
  const [msg, setMsg] = useState('')
  const [estado, setEstado] = useState<Record<string, 'guardando' | 'ok' | 'revision' | 'error'>>({})
  const [galeria, setGaleria] = useState<GalItem[]>([])
  const [nuevoTipo, setNuevoTipo] = useState<'imagen' | 'video'>('imagen')
  const [nuevoUrl, setNuevoUrl] = useState('')
  const [avPicker, setAvPicker] = useState(false)
  const [avLista, setAvLista] = useState<{ id: string; titulo: string; archivo_url: string; tipo: string }[]>([])
  const [sinNuevo, setSinNuevo] = useState(prod.sin_etiqueta_nuevo)
  const [docs, setDocs] = useState<DocTecnico[]>([])
  const [docTipo, setDocTipo] = useState(DOC_TIPOS[0])
  const [docSubiendo, setDocSubiendo] = useState(false)
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [generando, setGenerando] = useState(false)
  const [optimizando, setOptimizando] = useState(false)
  const aprobar = puede(perfil, 'marketing', 'aprobar')
  const puedeDocs = puede(perfil, 'documentos_tecnicos', 'crear') || puede(perfil, 'documentos_tecnicos', 'editar')
  const enlace = `https://${WEB}/equipo/?id=${encodeURIComponent(prod.codigo)}`

  const cargarGaleria = useCallback(() => {
    supabase.from('producto_galeria').select('id,tipo,archivo_url,descripcion,orden').eq('producto_id', prod.id).is('deleted_at', null).order('orden')
      .then(({ data }) => setGaleria((data as GalItem[]) ?? []))
  }, [prod.id])
  const cargarDocs = useCallback(() => {
    supabase.from('documentos_tecnicos').select('id,tipo,nombre,url').eq('producto_id', prod.id).is('deleted_at', null).order('created_at', { ascending: false })
      .then(({ data }) => setDocs((data as DocTecnico[]) ?? []))
  }, [prod.id])
  const cargarFicha = useCallback(() => {
    supabase.from('fichas_tecnicas').select('version,url,fecha').eq('producto_id', prod.id).order('version', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setFicha((data as Ficha) ?? null))
  }, [prod.id])

  useEffect(() => {
    supabase.from('productos').select('nombre,marca,codigo_unico,garantia,accesorios,certificaciones,caracteristicas,especificaciones,destacados,ficha_tecnica_url,pvp,aplica_iva,en_catalogo,imagen_url,drive_carpeta_url,descripcion,categoria:categorias(nombre)').eq('id', prod.id).single()
      .then(({ data }) => { const d = data as unknown as Record<string, any> | null; if (!d) return // eslint-disable-line @typescript-eslint/no-explicit-any
        const f: ProdFull = { nombre: d.nombre ?? '', categoria: d.categoria?.nombre ?? '', marca: d.marca ?? '', codigo_unico: d.codigo_unico ?? '', garantia: d.garantia ?? '', accesorios: d.accesorios ?? '', certificaciones: d.certificaciones ?? '', caracteristicas: d.caracteristicas ?? '', especificaciones: d.especificaciones ?? '', destacados: d.destacados ?? '', ficha_tecnica_url: d.ficha_tecnica_url ?? '', pvp: Number(d.pvp) || 0, aplica_iva: d.aplica_iva !== false, en_catalogo: !!d.en_catalogo, imagen_url: d.imagen_url ?? '', descripcion: d.descripcion ?? '', drive_carpeta_url: d.drive_carpeta_url ?? '' }
        setFull(f)
        setBase({ nombre: f.nombre, categoria: f.categoria, marca: f.marca, modelo: f.codigo_unico, garantia: f.garantia, accesorios: f.accesorios, certificaciones: f.certificaciones, caracteristicas: f.caracteristicas, especificaciones: f.especificaciones, imagen_url: f.imagen_url, descripcion: f.descripcion, album: f.drive_carpeta_url, ficha: f.ficha_tecnica_url, publico: f.en_catalogo ? 'SI' : 'NO', nuevo: prod.sin_etiqueta_nuevo ? 'SI' : 'NO' })
      })
    cargarGaleria()
    cargarDocs()
    cargarFicha()
  }, [prod.id, cargarGaleria, cargarDocs, cargarFicha])

  const especs = useMemo<Especificacion[]>(() => {
    if (!full) return []
    return full.especificaciones.split('\n').map((l) => { const i = l.indexOf(':'); return i > 0 ? { dato: l.slice(0, i).trim(), valor: l.slice(i + 1).trim() } : null }).filter(Boolean) as Especificacion[]
  }, [full])
  const destacadosSel = full?.destacados ? full.destacados.split('|').filter(Boolean) : []

  function toggleDestacado(dato: string) {
    if (!full) return
    const on = destacadosSel.includes(dato)
    if (!on && destacadosSel.length >= 3) { aviso('Elige máximo 3 datos destacados.'); return }
    const nuevos = (on ? destacadosSel.filter((x) => x !== dato) : [...destacadosSel, dato]).join('|')
    set('destacados', nuevos)
    guardarCampo('destacados', nuevos)
  }

  function fichaVistaPrevia() {
    if (!full) return
    const html = construirFichaHtml(full, prod.codigo, destacadosSel, especs)
    const blob = new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>Ficha técnica</title></head><body style="margin:0;background:#e2e8f0">${html}</body></html>`], { type: 'text/html;charset=utf-8' })
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  }

  async function fichaGenerar() {
    if (!full || fichaFaltan.length) return
    setGenerando(true)
    try {
      const html2pdf = (await import('html2pdf.js')).default
      const htmlStr = construirFichaHtml(full, prod.codigo, destacadosSel, especs)
      const blob = await html2pdf().set({
        margin: 0, image: { type: 'jpeg', quality: 0.96 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: false, logging: false, windowWidth: 794 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(htmlStr, 'string').toPdf().output('blob') as Blob
      const base64 = await new Promise<string>((ok, fail) => {
        const r = new FileReader()
        r.onerror = () => fail(new Error('No se pudo leer el PDF.'))
        r.onload = () => ok(String(r.result).split(',')[1] || '')
        r.readAsDataURL(blob)
      })
      const { data, error } = await supabase.functions.invoke('drive', { body: { accion: 'subir', modulo: 'marketing', carpeta: 'fichas_tecnicas/' + prod.codigo, nombre: 'Ficha tecnica ' + prod.codigo + '.pdf', mime: 'application/pdf', base64 } })
      const resp = data as { id?: string; enlace?: string; error?: string } | null
      if (error || resp?.error || !resp?.enlace) { aviso('No se pudo subir la ficha: ' + (resp?.error || error?.message)); return }
      const nuevaVersion = (ficha?.version ?? 0) + 1
      await supabase.from('fichas_tecnicas').insert({ id: crypto.randomUUID(), producto_id: prod.id, version: nuevaVersion, url: resp.enlace, drive_id: resp.id, generada_por: perfil.id, anterior_url: ficha?.url ?? null })
      await supabase.from('productos').update({ ficha_tecnica_url: resp.enlace }).eq('id', prod.id)
      set('ficha_tecnica_url', resp.enlace)
      setBase((b) => ({ ...b, ficha: resp.enlace as string }))
      setFicha({ version: nuevaVersion, url: resp.enlace, fecha: new Date().toISOString() })
      aviso('Ficha técnica generada (versión ' + nuevaVersion + ').')
    } catch (e) {
      aviso('No se pudo generar la ficha: ' + (e as Error).message)
    } finally {
      setGenerando(false)
    }
  }

  async function fichaSubirManual(file: File | null) {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) { aviso('El archivo supera los 20 MB.'); return }
    const base64 = await new Promise<string>((ok, fail) => {
      const r = new FileReader()
      r.onerror = () => fail(new Error('No se pudo leer el archivo.'))
      r.onload = () => ok(String(r.result).split(',')[1] || '')
      r.readAsDataURL(file)
    })
    const { data, error } = await supabase.functions.invoke('drive', { body: { accion: 'subir', modulo: 'marketing', carpeta: 'fichas_tecnicas/' + prod.codigo, nombre: file.name, mime: file.type || 'application/pdf', base64 } })
    const resp = data as { id?: string; enlace?: string; error?: string } | null
    if (error || resp?.error || !resp?.enlace) { aviso('No se pudo subir: ' + (resp?.error || error?.message)); return }
    await guardarCampo('ficha', resp.enlace)
    const nuevaVersion = (ficha?.version ?? 0) + 1
    await supabase.from('fichas_tecnicas').insert({ id: crypto.randomUUID(), producto_id: prod.id, version: nuevaVersion, url: resp.enlace, drive_id: resp.id, generada_por: perfil.id, anterior_url: ficha?.url ?? null })
    setFicha({ version: nuevaVersion, url: resp.enlace, fecha: new Date().toISOString() })
  }

  async function optimizarAlt() {
    const faltan = galeria.filter((g) => !(g.descripcion ?? '').trim())
    if (!faltan.length) { aviso('Todas las fotos y videos ya tienen texto alternativo.'); return }
    setOptimizando(true)
    try {
      const r = await llamar<{ textos: string[] }>('ia_alt_texto', { id: prod.id, n: faltan.length, tipos: faltan.map((g) => g.tipo) })
      await Promise.all(faltan.map((g, i) => supabase.from('producto_galeria').update({ descripcion: r.textos[i] }).eq('id', g.id)))
      cargarGaleria()
      aviso('Texto alternativo generado para ' + faltan.length + ' elemento' + (faltan.length === 1 ? '' : 's') + '.')
    } catch (e) {
      aviso((e as Error).message)
    } finally {
      setOptimizando(false)
    }
  }

  async function docSubir(files: FileList | null) {
    if (!files || !files.length) return
    setDocSubiendo(true)
    try {
      for (const f of Array.from(files)) {
        if (f.size > 20 * 1024 * 1024) { aviso(f.name + ' supera los 20 MB.'); continue }
        const base64 = await new Promise<string>((ok, fail) => {
          const r = new FileReader()
          r.onerror = () => fail(new Error('No se pudo leer el archivo.'))
          r.onload = () => ok(String(r.result).split(',')[1] || '')
          r.readAsDataURL(f)
        })
        const { data, error } = await supabase.functions.invoke('drive', { body: { accion: 'subir', modulo: 'documentos_tecnicos', carpeta: 'documentos_tecnicos/' + prod.codigo, nombre: f.name, mime: f.type || 'application/octet-stream', base64 } })
        const resp = data as { id?: string; enlace?: string; error?: string } | null
        if (error || resp?.error) { aviso('No se pudo subir ' + f.name + ': ' + (resp?.error || error?.message)); continue }
        await supabase.from('documentos_tecnicos').insert({ id: crypto.randomUUID(), producto_id: prod.id, tipo: docTipo, nombre: f.name, drive_id: resp?.id, url: resp?.enlace, subido_por: perfil.id })
      }
      cargarDocs()
    } finally {
      setDocSubiendo(false)
    }
  }

  async function galAgregar() {
    const url = nuevoUrl.trim()
    if (!url) return
    const orden = galeria.length ? Math.max(...galeria.map((g) => g.orden)) + 1 : 0
    const { error } = await supabase.from('producto_galeria').insert({ id: crypto.randomUUID(), producto_id: prod.id, tipo: nuevoTipo, archivo_url: url, orden, descripcion: null })
    if (error) { aviso('No se pudo agregar: ' + error.message); return }
    setNuevoUrl(''); cargarGaleria()
  }
  async function galQuitar(id: string) {
    const { error } = await supabase.from('producto_galeria').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) aviso('No se pudo quitar: ' + error.message); else cargarGaleria()
  }
  async function galMover(idx: number, dir: -1 | 1) {
    const otro = idx + dir
    if (otro < 0 || otro >= galeria.length) return
    const a = galeria[idx], b = galeria[otro]
    await Promise.all([
      supabase.from('producto_galeria').update({ orden: b.orden }).eq('id', a.id),
      supabase.from('producto_galeria').update({ orden: a.orden }).eq('id', b.id),
    ])
    cargarGaleria()
  }
  async function galDescripcion(id: string, descripcion: string) {
    await supabase.from('producto_galeria').update({ descripcion: descripcion.trim() || null }).eq('id', id)
  }
  function abrirAvPicker() {
    setAvPicker(true)
    supabase.from('audiovisual').select('id,titulo,archivo_url,tipo').eq('producto_id', prod.id).not('archivo_url', 'is', null).is('deleted_at', null).order('fecha', { ascending: false }).limit(20)
      .then(({ data }) => setAvLista((data as { id: string; titulo: string; archivo_url: string; tipo: string }[]) ?? []))
  }
  async function galDesdeAudiovisual(a: { archivo_url: string; tipo: string }) {
    const orden = galeria.length ? Math.max(...galeria.map((g) => g.orden)) + 1 : 0
    const { error } = await supabase.from('producto_galeria').insert({ id: crypto.randomUUID(), producto_id: prod.id, tipo: a.tipo === 'Foto' ? 'imagen' : 'video', archivo_url: a.archivo_url, orden, descripcion: null })
    if (error) aviso('No se pudo agregar: ' + error.message); else { cargarGaleria(); setAvPicker(false) }
  }

  async function guardarCampo(campo: string, valorNuevo: string) {
    const valorAnterior = base[campo] ?? ''
    if (valorNuevo === valorAnterior) return
    setEstado((e) => ({ ...e, [campo]: 'guardando' }))
    if (aprobar) {
      const error = await aplicarCampoProducto(prod.id, campo, valorNuevo)
      setEstado((e) => ({ ...e, [campo]: error ? 'error' : 'ok' }))
      if (error) setMsg('No se pudo guardar ' + campo + ': ' + error)
      else setBase((b) => ({ ...b, [campo]: valorNuevo }))
      return
    }
    const { error } = await supabase.from('marketing_cambios').insert({
      id: crypto.randomUUID(), codigo: 'MC-' + crypto.randomUUID().slice(0, 6).toUpperCase(), producto_id: prod.id,
      producto_texto: `${prod.codigo} · ${prod.nombre}`, campo, nivel: 'Producto', valor_anterior: valorAnterior, valor_nuevo: valorNuevo,
      estado: 'Pendiente', autor_id: perfil.id, autor_rol: perfil.rol ?? null,
    })
    setEstado((e) => ({ ...e, [campo]: error ? 'error' : 'revision' }))
    if (error) setMsg('No se pudo enviar ' + campo + ' a revisión: ' + error.message)
    else setBase((b) => ({ ...b, [campo]: valorNuevo }))
  }

  function set<K extends keyof ProdFull>(k: K, v: ProdFull[K]) { setFull((x) => (x ? { ...x, [k]: v } : x)) }
  function campoTexto(campo: string, k: keyof ProdFull, etiqueta: string, opts: { full?: boolean; lista?: string[]; placeholder?: string; multilinea?: boolean; filas?: number; maxLength?: number } = {}) {
    if (!full) return null
    const valor = String(full[k] ?? '')
    const St = estado[campo]
    const comun = { value: valor, maxLength: opts.maxLength, placeholder: opts.placeholder, className: 'inp w-full', list: opts.lista ? campo + 'Lst' : undefined }
    return (
      <label className={'mkf-lbl' + (opts.full ? ' sm:col-span-2' : '')}>
        <span className="flex items-center gap-1.5">{etiqueta}
          {St === 'guardando' && <RefreshCw className="w-3 h-3 animate-spin text-slate-400" />}
          {St === 'ok' && <CircleCheck className="w-3 h-3 text-emerald-600" />}
          {St === 'revision' && <span className="text-[9px] font-bold text-amber-700">enviado a revisión</span>}
          {St === 'error' && <span className="text-[9px] font-bold text-red-600">no se guardó</span>}
        </span>
        {opts.multilinea
          ? <textarea rows={opts.filas ?? 2} {...comun} onChange={(e) => set(k, e.target.value)} onBlur={() => guardarCampo(campo, valor)} />
          : <input type="text" {...comun} onChange={(e) => set(k, e.target.value)} onBlur={() => guardarCampo(campo, valor)} />}
        {opts.lista && <datalist id={campo + 'Lst'}>{opts.lista.map((o) => <option key={o} value={o} />)}</datalist>}
      </label>
    )
  }

  async function cambiarPublico(nuevo: boolean) {
    if (!full) return
    const anterior = full.en_catalogo
    set('en_catalogo', nuevo)
    setEstado((e) => ({ ...e, publico: 'guardando' }))
    if (aprobar) {
      const error = await aplicarCampoProducto(prod.id, 'publico', nuevo ? 'SI' : 'NO')
      setEstado((e) => ({ ...e, publico: error ? 'error' : 'ok' }))
      if (error) { setMsg('No se pudo cambiar: ' + error); set('en_catalogo', anterior) }
      else setBase((b) => ({ ...b, publico: nuevo ? 'SI' : 'NO' }))
      return
    }
    const { error } = await supabase.from('marketing_cambios').insert({
      id: crypto.randomUUID(), codigo: 'MC-' + crypto.randomUUID().slice(0, 6).toUpperCase(), producto_id: prod.id,
      producto_texto: `${prod.codigo} · ${prod.nombre}`, campo: 'publico', nivel: 'Producto', valor_anterior: anterior ? 'SI' : 'NO', valor_nuevo: nuevo ? 'SI' : 'NO',
      estado: 'Pendiente', autor_id: perfil.id, autor_rol: perfil.rol ?? null,
    })
    setEstado((e) => ({ ...e, publico: error ? 'error' : 'revision' }))
    if (error) { setMsg('No se pudo enviar a revisión: ' + error.message); set('en_catalogo', anterior) }
    else { setBase((b) => ({ ...b, publico: nuevo ? 'SI' : 'NO' })); aviso('Enviado a Revisión: ' + (nuevo ? 'mostrar' : 'ocultar') + ' en la web.') }
  }

  function toggleNuevo() {
    const nuevo = !sinNuevo
    setSinNuevo(nuevo)
    guardarCampo('nuevo', nuevo ? 'SI' : 'NO')
  }

  async function redactar() {
    setIa(true); setMsg('')
    try {
      const r = await llamar<{ descripcion: string; caracteristicas: string[]; conFicha: boolean }>('ia_producto', { id: prod.id, notas })
      const car = r.caracteristicas.join('\n')
      set('descripcion', r.descripcion); set('caracteristicas', car)
      await Promise.all([guardarCampo('descripcion', r.descripcion), guardarCampo('caracteristicas', car)])
      setMsg(r.conFicha ? 'Redactado con los datos de la ficha técnica.' : 'Redactado sin ficha técnica legible: revisa que no falte nada.')
    } catch (e) { setMsg((e as Error).message) }
    setIa(false)
  }

  const falta = full ? [!full.imagen_url && 'Imagen principal', !full.nombre.trim() && 'Nombre', !full.categoria.trim() && 'Categoría', !full.marca.trim() && 'Marca', !full.descripcion.trim() && 'Descripción', !full.caracteristicas.trim() && 'Características', !full.especificaciones.trim() && 'Especificaciones técnicas', galeria.filter((g) => g.tipo === 'imagen').length < 3 && 'Al menos 3 fotos'].filter(Boolean) as string[] : []
  const fotosOk = galeria.filter((g) => g.tipo === 'imagen').length >= 3
  const fichaFaltan = full ? [!full.imagen_url && 'Imagen principal', !full.descripcion.trim() && 'Descripción', !full.especificaciones.trim() && 'Especificaciones técnicas', !fotosOk && 'Al menos 3 fotos', !full.caracteristicas.trim() && 'Características'].filter(Boolean) as string[] : []
  const seo = full ? (() => {
    const avisos = [
      { ok: full.nombre.trim().length > 8, texto: 'Nombre descriptivo (qué es + marca/modelo)' },
      { ok: !!full.marca.trim(), texto: 'Marca registrada' },
      { ok: !!full.categoria.trim(), texto: 'Categoría' },
      { ok: full.descripcion.trim().length >= 120, texto: 'Descripción de al menos 120 caracteres' },
      { ok: !!full.nombre.trim().split(' ')[0] && normalize(full.descripcion).includes(normalize(full.nombre.trim().split(' ')[0])), texto: 'La descripción menciona el nombre del equipo' },
      { ok: full.caracteristicas.split('\n').filter((x) => x.trim()).length >= 3, texto: 'Al menos 3 características' },
      { ok: especs.length >= 3, texto: 'Al menos 3 especificaciones técnicas' },
      { ok: !!full.imagen_url, texto: 'Imagen principal' },
      { ok: fotosOk, texto: 'Al menos 3 fotos en la galería' },
      { ok: galeria.some((g) => g.tipo === 'video'), texto: 'Al menos un video' },
      { ok: galeria.length === 0 || galeria.every((g) => (g.descripcion ?? '').trim()), texto: 'Texto alternativo en todas las fotos y videos' },
    ]
    return { puntaje: Math.round((avisos.filter((a) => a.ok).length / avisos.length) * 100), avisos }
  })() : null

  return (
    <Ventana titulo={prod.nombre} cerrar={cerrar} ancho="sm:max-w-2xl" pie={<>
      <p className={'text-[11px] font-semibold flex-1 ' + (falta.length ? 'text-amber-700' : 'text-emerald-700')}>{falta.length ? 'Falta: ' + falta.join(', ') : '✓ Producto completo'}<span className="block font-normal text-slate-400">{msg || 'Todo se guarda solo'}</span></p>
      <button className="btn btn-primary" onClick={cerrar}><Check />Listo</button>
    </>}>
      <p className="text-[11px] text-slate-500">{prod.codigo}{full?.categoria ? ' · ' + full.categoria : ''}</p>

      {full && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3" style={full.en_catalogo ? { background: '#f0fdf8', borderColor: '#bfe6da' } : undefined}>
          <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={full.en_catalogo ? { background: '#dcfce7', color: '#04896f' } : { background: '#f1f5f9', color: '#94a3b8' }}><Globe className="w-4 h-4" /></span>
          <div className="min-w-0 flex-1"><p className="text-[12.5px] font-bold text-slate-800">Visible al público</p><p className="text-[11px] text-slate-500">{full.en_catalogo ? 'Se muestra en la web y en los catálogos.' : 'No se muestra en la web ni en los catálogos.'}</p></div>
          <Interruptor activo={full.en_catalogo} cambiar={() => cambiarPublico(!full.en_catalogo)} />
        </div>
      )}

      {prodReciente(prod) && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
          <span className="text-[9px] font-bold uppercase tracking-wider text-white rounded-full px-2 py-0.5 shrink-0" style={{ background: '#c98a1f', opacity: sinNuevo ? .35 : 1, textDecoration: sinNuevo ? 'line-through' : undefined }}>Nuevo</span>
          <p className="text-[11.5px] text-slate-600 flex-1 min-w-0">{sinNuevo ? 'Etiqueta "Nuevo" quitada. Este equipo ya no se marca como nuevo.' : 'Se muestra como "Nuevo" en el catálogo mientras sea reciente.'}</p>
          <button type="button" className="btn !py-1.5 shrink-0" onClick={toggleNuevo}><Tag className="w-3.5 h-3.5" />{sinNuevo ? 'Volver a mostrar' : 'Quitar etiqueta'}</button>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
        {full?.imagen_url ? <img src={imagen(full.imagen_url, 96)} alt="" className="w-12 h-12 rounded-lg object-contain bg-white border border-slate-200 shrink-0" /> : <span className="w-12 h-12 rounded-lg bg-white border border-slate-200 shrink-0 grid place-items-center text-slate-300"><ImagePlus className="w-4 h-4" /></span>}
        <div className="min-w-0 flex-1"><p className="text-[10px] font-mono-spec uppercase text-slate-400 font-semibold">Enlace del equipo para compartir</p><p className="text-[12px] font-semibold text-[var(--primary)] truncate">{enlace}</p></div>
        <button type="button" className="btn !py-1.5" onClick={() => { navigator.clipboard.writeText(enlace); aviso('Enlace copiado.') }}><Copy className="w-3.5 h-3.5" />Copiar</button>
        <button type="button" className="btn !py-1.5" onClick={() => window.open(enlace, '_blank', 'noopener')}><Eye className="w-3.5 h-3.5" />Vista previa</button>
      </div>

      {full && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><ImagePlus className="w-3.5 h-3.5 text-[var(--primary)]" />Imagen principal del producto</p>
          <p className="text-[11px] text-slate-500">Se usa en el catálogo, cotizaciones e inventario. Recomendado 4:3, fondo claro. Al elegirla se sube sola.</p>
          <label className="flex items-center gap-2 border border-dashed border-slate-300 rounded-xl p-2.5 cursor-pointer hover:border-[var(--cyan)] opacity-60 cursor-not-allowed" title="Próximamente: subir archivo directo">
            <ImagePlus className="w-4 h-4 text-slate-400" /><span className="text-xs text-slate-600">Elegir nueva imagen (JPG, PNG, WebP)</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled />
          </label>
          <label className="block text-[10px] font-semibold text-slate-500">O pega un enlace de Drive / HTTPS
            <input type="url" className="inp w-full mt-1" value={full.imagen_url} onChange={(e) => set('imagen_url', e.target.value)} onBlur={() => guardarCampo('imagen_url', full.imagen_url)} /></label>
        </div>
      )}

      {full && (
        <div className="space-y-2">
          <div className="flex items-center gap-2"><p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-[var(--primary)]" />Datos del producto</p>
            <span className="ml-auto text-[11px] text-slate-500">PVP {money(full.pvp)} {full.aplica_iva ? '' : '(sin IVA)'} <span className="text-slate-400">(solo lectura)</span></span></div>
          <div className="grid sm:grid-cols-2 gap-2">
            {campoTexto('nombre', 'nombre', 'Nombre', { full: true })}
            {campoTexto('categoria', 'categoria', 'Categoría', { lista: categorias })}
            {campoTexto('marca', 'marca', 'Marca', { lista: marcas })}
            {campoTexto('modelo', 'codigo_unico', 'Modelo')}
            {campoTexto('garantia', 'garantia', 'Garantía', { placeholder: 'Ej. 1 año' })}
            {campoTexto('accesorios', 'accesorios', 'Incluye (accesorios, uno por línea)', { full: true, multilinea: true, maxLength: 1200 })}
            {campoTexto('certificaciones', 'certificaciones', 'Certificaciones', { full: true, placeholder: 'ISO 13485 · CE · ARCSA' })}
          </div>
          {!aprobar && <p className="text-[10.5px] text-slate-400">Se guarda solo mientras escribes. Los cambios pasan a Revisión.</p>}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2"><p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><ImagePlus className="w-3.5 h-3.5 text-[var(--cyan)]" />Galería del catálogo</p>
          <span className="ml-auto text-[10px] font-mono-spec text-slate-400">{galeria.length} elemento{galeria.length === 1 ? '' : 's'}</span></div>
        <p className="text-[11px] text-slate-500">Fotos y videos que se ven en el catálogo después de la imagen principal. Se guarda solo.</p>
        {galeria.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {galeria.map((g, i) => (
              <div key={g.id} className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                <div className="aspect-square grid place-items-center bg-slate-100">
                  {g.tipo === 'video'
                    ? <Video className="w-6 h-6 text-slate-400" />
                    : <img src={imagen(g.archivo_url, 200)} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />}
                </div>
                <input type="text" defaultValue={g.descripcion ?? ''} onBlur={(e) => galDescripcion(g.id, e.target.value)} placeholder="Descripción" className="w-full text-[9px] px-1.5 py-1 border-t border-slate-200 bg-white" />
                <div className="flex items-center gap-0.5 px-1 pb-1">
                  <button type="button" className="w-5 h-5 grid place-items-center text-slate-400 hover:text-slate-700 disabled:opacity-30" onClick={() => galMover(i, -1)} disabled={i === 0} title="Mover antes"><ArrowUp className="w-3 h-3" /></button>
                  <button type="button" className="w-5 h-5 grid place-items-center text-slate-400 hover:text-slate-700 disabled:opacity-30" onClick={() => galMover(i, 1)} disabled={i === galeria.length - 1} title="Mover después"><ArrowDown className="w-3 h-3" /></button>
                  <button type="button" className="ml-auto w-5 h-5 grid place-items-center text-red-500 hover:text-red-700" onClick={() => galQuitar(g.id)} title="Quitar"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select className="inp !py-1.5" value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value as 'imagen' | 'video')}><option value="imagen">Foto</option><option value="video">Video</option></select>
          <input type="url" className="inp flex-1 min-w-[180px]" placeholder={nuevoTipo === 'video' ? 'Enlace de YouTube/Vimeo' : 'Enlace de Drive/HTTPS'} value={nuevoUrl} onChange={(e) => setNuevoUrl(e.target.value)} />
          <button type="button" className="btn" onClick={galAgregar}><ImagePlus className="w-3.5 h-3.5" />Agregar</button>
          <button type="button" className="btn" onClick={abrirAvPicker}><Film className="w-3.5 h-3.5" />Desde Audiovisual</button>
        </div>
        {avPicker && (
          <div className="rounded-xl border border-slate-200 p-2 space-y-1">
            {!avLista.length && <p className="text-[11px] text-slate-400 text-center py-2">Sin piezas de Audiovisual para este producto.</p>}
            {avLista.map((a) => (
              <button type="button" key={a.id} className="flex items-center gap-2 w-full text-left p-1.5 rounded-lg hover:bg-slate-50" onClick={() => galDesdeAudiovisual(a)}>
                <span className="w-8 h-8 rounded-md bg-slate-100 grid place-items-center shrink-0">{a.tipo === 'Foto' ? <ImagePlus className="w-3.5 h-3.5 text-slate-400" /> : <Video className="w-3.5 h-3.5 text-slate-400" />}</span>
                <span className="text-xs text-slate-700 truncate flex-1">{a.titulo}</span>
              </button>
            ))}
            <button type="button" className="text-[10px] text-slate-400 underline px-1.5" onClick={() => setAvPicker(false)}>Cerrar</button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-2">
        <p className="text-[11px] font-bold text-violet-700 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" />Redactar con IA (Gemini)</p>
        <input value={notas} onChange={(e) => setNotas(e.target.value)} className="inp w-full" placeholder="Indicaciones (opcional): enfoque, público, qué resaltar…" />
        <button type="button" className="btn" onClick={redactar} disabled={ia}><Sparkles />{ia ? 'Redactando…' : 'Redactar descripción y características'}</button>
        <p className="text-[10px] text-slate-500">Si el producto tiene ficha técnica en PDF, la IA la lee para no inventar datos.</p>
      </div>
      {full && campoTexto('descripcion', 'descripcion', 'Descripción', { full: true, multilinea: true, filas: 3 })}
      {full && campoTexto('caracteristicas', 'caracteristicas', 'Características (una por línea, se muestran con ✓)', { full: true, multilinea: true, filas: 5, maxLength: 3400 })}
      {full && campoTexto('especificaciones', 'especificaciones', 'Especificaciones técnicas (una por línea: Dato: valor)', { full: true, multilinea: true, filas: 6, maxLength: 4000 })}

      {full && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5 text-amber-500" />Álbum de multimedia</p>
          <div className="flex gap-2 items-center">
            <input type="url" className="inp flex-1" placeholder="Carpeta de Google Drive" value={full.drive_carpeta_url} onChange={(e) => set('drive_carpeta_url', e.target.value)} onBlur={() => guardarCampo('album', full.drive_carpeta_url)} />
            {full.drive_carpeta_url && <a href={full.drive_carpeta_url} target="_blank" rel="noopener noreferrer" className="btn !py-1.5">Abrir ↗</a>}
          </div>
          <p className="text-[10px] text-slate-400">Archivo interno en Drive. No se muestra en el catálogo cuando la galería ya tiene fotos.</p>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><FileBadge className="w-3.5 h-3.5 text-[var(--teal)]" />Documentos técnicos</p>
          <span className={'ml-auto pill ' + (docs.length === 0 ? 'bg-red-50 text-red-600' : DOC_OBLIGATORIOS.every((t) => docs.some((d) => d.tipo === t)) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
            {docs.length === 0 ? 'Sin documentos' : DOC_OBLIGATORIOS.every((t) => docs.some((d) => d.tipo === t)) ? 'Completo' : 'Incompleto'}
          </span>
        </div>
        <div className="space-y-1">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-[11.5px] text-slate-600">
              <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] font-semibold">{d.tipo}</a> : <span>{d.tipo}</span>}
              <span className="text-slate-400 truncate">{d.nombre}</span>
            </div>
          ))}
          {!docs.length && <p className="text-[11px] text-slate-400">Sin documentos técnicos todavía.</p>}
          {(() => { const faltan = DOC_OBLIGATORIOS.filter((t) => !docs.some((d) => d.tipo === t)); return faltan.length > 0 && <p className="text-[11px] text-slate-500">Falta: {faltan.join(', ')}. Los sube Servicio Técnico.</p> })()}
        </div>
        {puedeDocs && (
          <div className="flex gap-2 items-center flex-wrap">
            <select className="inp !py-1.5" value={docTipo} onChange={(e) => setDocTipo(e.target.value)}>{DOC_TIPOS.map((t) => <option key={t}>{t}</option>)}</select>
            <label className="btn cursor-pointer !py-1.5"><Upload className="w-3.5 h-3.5" />{docSubiendo ? 'Subiendo…' : 'Elegir archivos'}
              <input type="file" multiple className="hidden" disabled={docSubiendo} onChange={(e) => { docSubir(e.target.files); e.target.value = '' }} /></label>
          </div>
        )}
      </div>

      {full && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-[var(--teal)]" />Ficha técnica</p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
            <div className="grid sm:grid-cols-2 gap-x-3 gap-y-1">
              {['Imagen principal', 'Descripción', 'Especificaciones técnicas', 'Al menos 3 fotos', 'Características'].map((t) => (
                <div key={t} className={'flex items-center gap-1.5 text-[11.5px] ' + (fichaFaltan.includes(t) ? 'text-red-600' : 'text-emerald-700')}>
                  <span className="font-bold">{fichaFaltan.includes(t) ? '✕' : '✓'}</span>{t}
                </div>
              ))}
            </div>
            {fichaFaltan.length === 0
              ? <p className="text-[11px] font-semibold text-emerald-700">✓ Completo: la ficha se puede generar.</p>
              : <p className="text-[11px] text-slate-500">La ficha se puede generar cuando esté todo lo obligatorio.</p>}
            {ficha && <p className="text-[11px] text-slate-500">Versión {ficha.version} · {new Date(ficha.fecha).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' })} · <a href={ficha.url} target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--primary)]">Abrir PDF</a></p>}
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn !py-1.5" onClick={fichaVistaPrevia}><Eye className="w-3.5 h-3.5" />Vista previa</button>
              {aprobar && <button type="button" className="btn btn-primary !py-1.5" onClick={fichaGenerar} disabled={generando || fichaFaltan.length > 0}><RefreshCw className="w-3.5 h-3.5" />{generando ? 'Generando…' : 'Generar ahora'}</button>}
            </div>
          </div>

          {especs.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-slate-600">Datos destacados de la ficha (elige hasta 3)</p>
              <div className="flex flex-wrap gap-1.5">
                {especs.slice(0, 18).map((e) => (
                  <button type="button" key={e.dato} onClick={() => toggleDestacado(e.dato)}
                    className={'text-[10.5px] font-semibold px-3 py-1.5 rounded-full border ' + (destacadosSel.includes(e.dato) ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}>
                    {e.dato}
                  </button>
                ))}
              </div>
              {!destacadosSel.length && <p className="text-[10.5px] text-slate-400">Sin elegir: se usan las 3 primeras.</p>}
            </div>
          )}

          {aprobar && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-slate-600">Solo Coordinación: enlace manual (se reemplaza la próxima vez que se genere la ficha)</p>
              <div className="flex gap-2 items-center">
                <input type="url" className="inp flex-1" placeholder="Enlace de la ficha" value={full.ficha_tecnica_url} onChange={(e) => set('ficha_tecnica_url', e.target.value)} onBlur={() => guardarCampo('ficha', full.ficha_tecnica_url)} />
                {full.ficha_tecnica_url && <a href={full.ficha_tecnica_url} target="_blank" rel="noopener noreferrer" className="btn !py-1.5">Abrir ↗</a>}
              </div>
              <label className="btn cursor-pointer !py-1.5 inline-flex"><Upload className="w-3.5 h-3.5" />Elegir PDF
                <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { fichaSubirManual(e.target.files?.[0] ?? null); e.target.value = '' }} /></label>
            </div>
          )}
        </div>
      )}

      {seo && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Search className="w-3.5 h-3.5 text-[var(--primary)]" />Revisión SEO</p>
            <span className={'ml-auto pill ' + (seo.puntaje >= 80 ? 'bg-emerald-50 text-emerald-700' : seo.puntaje >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600')}>{seo.puntaje} / 100</span>
          </div>
          <ul className="space-y-1">
            {seo.avisos.map((a, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11.5px]">
                <span className={'font-bold ' + (a.ok ? 'text-emerald-600' : 'text-red-500')}>{a.ok ? '✓' : '✕'}</span>
                <span className={a.ok ? 'text-slate-500' : 'text-slate-700'}>{a.texto}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn !py-1.5" onClick={optimizarAlt} disabled={optimizando}><Sparkles className="w-3.5 h-3.5" />{optimizando ? 'Optimizando…' : 'Optimizar textos alternativos ahora'}</button>
        </div>
      )}
    </Ventana>
  )
}

/* ============================ Revisión (aprobaciones) ============================ */
type Cambio = { id: string; codigo: string | null; fecha: string; producto_id: string | null; producto_texto: string | null; campo: string; valor_anterior: string | null; valor_nuevo: string | null; estado: string; comentario: string | null; autor: { nombre: string } | null }
const CAMPOS_OK = CAMPOS_PRODUCTO
const textoCambio = (campo: string, v: string | null) => (campo === 'publico' ? (v === 'SI' ? 'Visible al público' : 'Oculto') : v || '—')
export function Revision({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [lista, setLista] = useState<Cambio[] | null>(null)
  const [error, setError] = useState('')
  const [com, setCom] = useState<Record<string, string>>({})
  const aprobar = puede(perfil, 'marketing', 'aprobar')
  const cargar = useCallback(() => {
    supabase.from('marketing_cambios').select('id,codigo,fecha,producto_id,producto_texto,campo,valor_anterior,valor_nuevo,estado,comentario,autor:empleados!autor_id(nombre)').is('deleted_at', null).order('fecha', { ascending: false }).limit(80)
      .then(({ data, error }) => { if (error) setError(error.message); else setLista((data as unknown as Cambio[]) ?? []) })
  }, [])
  useEffect(() => {
    cargar()
    const c = supabase.channel('mk-cambios').on('postgres_changes', { event: '*', schema: 'public', table: 'marketing_cambios' }, cargar).subscribe()
    return () => { supabase.removeChannel(c) }
  }, [cargar])
  async function decidir(c: Cambio, ok: boolean) {
    if (ok) {
      if (!c.producto_id || !CAMPOS_OK.includes(c.campo)) { aviso('Este tipo de cambio todavía se aplica a mano en el Inventario.'); return }
      const error = await aplicarCampoProducto(c.producto_id, c.campo, c.valor_nuevo ?? '')
      if (error) { aviso('No se pudo aplicar: ' + error); return }
    }
    const { error } = await supabase.from('marketing_cambios').update({ estado: ok ? 'Aprobado' : 'Rechazado', revisado_por: perfil.id, fecha_revision: new Date().toISOString(), comentario: com[c.id]?.trim() || null }).eq('id', c.id)
    if (error) aviso('No se pudo guardar: ' + error.message); else { aviso(ok ? 'Cambio aprobado y aplicado.' : 'Cambio rechazado.'); cargar() }
  }
  if (error) return <div className="card p-6 text-sm text-amber-800 bg-amber-50 border-amber-200">{error}</div>
  if (!lista) return <p className="text-xs text-slate-400">Cargando…</p>
  const pend = lista.filter((c) => c.estado === 'Pendiente'), hist = lista.filter((c) => c.estado !== 'Pendiente')
  return (
    <section className="space-y-5">
      <div><h3 className="font-display font-bold text-sm text-slate-800 flex items-center gap-2 mb-2"><ClipboardCheck className="w-4 h-4 text-[var(--primary)]" />Pendientes de aprobación ({pend.length})</h3>
        {!pend.length && <div className="card p-8 text-center text-xs text-slate-400">No hay cambios por revisar. Los que se envíen desde la Biblioteca aparecerán aquí.</div>}
        <div className="space-y-3">{pend.map((c) => (
          <article key={c.id} className="card p-4">
            <div className="flex items-center gap-2 flex-wrap"><b className="text-sm text-slate-800">{c.producto_texto}</b><span className="pill" style={{ background: '#fff8eb', color: '#a16207' }}>{c.campo}</span><span className="text-[10px] text-slate-400 ml-auto">{c.autor?.nombre ?? '—'} · {new Date(c.fecha).toLocaleDateString('es-EC')}</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-xs">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Antes</p><p className="whitespace-pre-line text-slate-600">{textoCambio(c.campo, c.valor_anterior)}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[10px] font-bold uppercase text-emerald-700 mb-1">Propuesto</p><p className="whitespace-pre-line text-slate-800">{textoCambio(c.campo, c.valor_nuevo)}</p></div>
            </div>
            {aprobar && <div className="flex gap-2 mt-3 flex-wrap"><input className="inp flex-1 min-w-[200px]" placeholder="Comentario (opcional)" value={com[c.id] ?? ''} onChange={(e) => setCom((o) => ({ ...o, [c.id]: e.target.value }))} />
              <button className="btn" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => decidir(c, false)}><XCircle />Rechazar</button><button className="btn btn-primary" onClick={() => decidir(c, true)}><Check />Aprobar y aplicar</button></div>}
          </article>))}</div></div>
      {hist.length > 0 && <div><h3 className="font-display font-bold text-sm text-slate-800 flex items-center gap-2 mb-2"><BookOpen className="w-4 h-4 text-slate-400" />Historial</h3>
        <div className="card overflow-hidden"><table className="tbl"><thead><tr><th>Fecha</th><th>Producto</th><th>Campo</th><th>Autor</th><th>Estado</th></tr></thead><tbody>{hist.map((c) => (
          <tr key={c.id}><td className="whitespace-nowrap">{new Date(c.fecha).toLocaleDateString('es-EC')}</td><td className="max-w-[300px] truncate">{c.producto_texto}</td><td>{c.campo}</td><td>{c.autor?.nombre ?? '—'}</td>
            <td><span className="pill" style={c.estado === 'Aprobado' ? { background: '#ecfaf5', color: '#04896f' } : { background: '#fdecea', color: '#c0392b' }}>{c.estado}</span></td></tr>))}</tbody></table></div></div>}
    </section>
  )
}

/* ============================ Google Drive (cuenta de servicio) ============================ */
const idUnidad = (v: string) => { const m = v.match(/folders\/([\w-]+)/) || v.match(/[?&]id=([\w-]+)/); return (m ? m[1] : v).trim() }
function TarjetaDrive({ est, aviso, cambio }: { est: Estado; aviso: (t: string) => void; cambio: () => void }) {
  const cfg = est.config as { driveId?: string }
  const [json, setJson] = useState('')
  const [unidad, setUnidad] = useState(cfg.driveId ?? '')
  const [ocupado, setOcupado] = useState('')
  const [cuenta, setCuenta] = useState('')
  const prueba = est.estado_prueba ?? '', ok = prueba.startsWith('ok')
  function leerArchivo(f: File | undefined) { if (!f) return; const r = new FileReader(); r.onload = () => setJson(String(r.result)); r.readAsText(f) }
  async function guardar() {
    if (json.trim()) { try { const j = JSON.parse(json); if (!j.client_email || !j.private_key) throw new Error('x') } catch { aviso('Ese archivo no parece el JSON de una cuenta de servicio de Google.'); return } }
    if (!est.configurado && !json.trim()) { aviso('Pega o sube el archivo JSON de la cuenta de servicio.'); return }
    if (!idUnidad(unidad)) { aviso('Falta el ID de la unidad compartida.'); return }
    setOcupado('guardar')
    const { error } = await supabase.rpc('integracion_guardar', { p_proveedor: 'drive', p_secreto: json.trim() || null, p_config: { driveId: idUnidad(unidad) } })
    setOcupado('')
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    setJson(''); aviso('Drive guardado. Probando…'); cambio(); probar()
  }
  async function probar() {
    setOcupado('probar')
    try { const r = await llamar<{ mensaje: string; cuenta: string }>('probar', { escribir: true }, 'drive'); setCuenta(r.cuenta); aviso(r.mensaje) }
    catch (e) { aviso((e as Error).message) }
    setOcupado(''); cambio()
  }
  async function quitar() {
    if (!confirm('¿Desconectar Google Drive?')) return
    const { error } = await supabase.rpc('integracion_quitar', { p_proveedor: 'drive' })
    if (error) aviso('No se pudo quitar: ' + error.message); else { setCuenta(''); aviso('Drive desconectado.'); cambio() }
  }
  return (
    <article className="card p-5 xl:col-span-2">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: '#0f9d581A', color: '#0f9d58' }}><Plug className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1"><h3 className="font-display font-bold text-sm text-slate-800">Google Drive · documentos del sistema</h3><p className="text-[11px] text-slate-500">Guarda PDF, facturas, evidencias y contratos en una unidad compartida o en una carpeta de Drive.</p></div>
        <span className="pill shrink-0" style={est.configurado ? (prueba && !ok ? { background: '#fdecea', color: '#c0392b' } : { background: '#ecfaf5', color: '#04896f' }) : { background: '#f1f5f9', color: '#64748b' }}>{est.configurado ? (prueba ? (ok ? 'Conectado' : 'Con error') : 'Sin probar') : 'No conectado'}</span>
      </div>
      <ol className="text-[11px] text-slate-500 mt-3 list-decimal pl-4 space-y-0.5">
        <li>En Google Cloud crea un proyecto, activa «Google Drive API» y crea una <b>cuenta de servicio</b>; descarga su clave en formato <b>JSON</b>.</li>
        <li>En Google Drive abre la unidad compartida «VIMEDIC Sistema» › Administrar miembros y agrega el correo de la cuenta de servicio como <b>Gestor de contenido</b>.</li>
        <li>Copia el ID de la unidad (el final del enlace al abrirla: …/folders/<b>ID</b>) y pégalo abajo junto con el JSON.</li>
      </ol>
      <label className="block text-[11px] font-bold text-slate-500 mt-3">ID o enlace de la unidad compartida o de una carpeta<input className="inp w-full mt-1" value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="Ej. 0AB1cD2eF3gH4iUk9PVA" /></label>
      <label className="block text-[11px] font-bold text-slate-500 mt-3">Clave de la cuenta de servicio (JSON){est.configurado && <span className="font-normal text-slate-400"> · ya hay una guardada; pega otra solo para reemplazarla</span>}
        <textarea className="inp w-full mt-1 font-mono-spec" rows={4} value={json} onChange={(e) => setJson(e.target.value)} placeholder='{ "type": "service_account", "client_email": "…", "private_key": "…" }' /></label>
      <input type="file" accept="application/json,.json" className="block mt-1 text-xs" onChange={(e) => leerArchivo(e.target.files?.[0])} />
      {prueba && <p className="text-[11px] mt-3 rounded-lg px-3 py-2" style={ok ? { background: '#ecfaf5', color: '#04896f' } : { background: '#fdecea', color: '#a3341f' }}>{prueba.replace(/^(ok|error): /, '')}{est.probado_en ? ' · ' + new Date(est.probado_en).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : ''}</p>}
      {cuenta && <p className="text-[11px] text-slate-500 mt-2">Cuenta de servicio: <b>{cuenta}</b></p>}
      <div className="flex gap-2 flex-wrap mt-4">
        <button type="button" className="btn btn-primary" onClick={guardar} disabled={!!ocupado}><Check />{ocupado === 'guardar' ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="btn" onClick={probar} disabled={!!ocupado || !est.configurado}><Plug />{ocupado === 'probar' ? 'Probando…' : 'Probar (crea un archivo de prueba)'}</button>
        {est.configurado && <button type="button" className="btn ml-auto" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={quitar}><Trash2 />Desconectar</button>}
      </div>
    </article>
  )
}
