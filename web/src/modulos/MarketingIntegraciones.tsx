import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, CalendarClock, Check, ClipboardCheck, KeyRound, Link2, Plug, RefreshCw, Search, Send, Sparkles, Trash2, X, XCircle } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { imagen } from './Inventario'

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
      </div>
    </section>
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
type Prod = { id: string; codigo: string; nombre: string; descripcion: string | null; imagen_url: string | null; categoria: { nombre: string } | null }
export function Biblioteca({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [q, setQ] = useState('')
  const [lista, setLista] = useState<Prod[]>([])
  const [sel, setSel] = useState<Prod | null>(null)
  useEffect(() => {
    const t = q.trim(); let vivo = true
    const h = setTimeout(() => {
      let c = supabase.from('productos').select('id,codigo,nombre,descripcion,imagen_url,categoria:categorias(nombre)').is('deleted_at', null).or('estado.is.null,estado.not.ilike.inactivo')
      for (const w of t.replace(/[,()%*\\"']/g, ' ').split(/\s+/).filter(Boolean)) c = c.or(`nombre.ilike.%${w}%,codigo.ilike.%${w}%,marca.ilike.%${w}%`)
      c.order('orden', { ascending: true, nullsFirst: false }).order('nombre').limit(24).then(({ data }) => { if (vivo) setLista((data as unknown as Prod[]) ?? []) })
    }, t ? 250 : 0)
    return () => { vivo = false; clearTimeout(h) }
  }, [q])
  return (
    <section>
      <div className="relative max-w-md mb-4"><Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca un equipo por nombre o código…" className="inp pl-9 w-full" /></div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {lista.map((p) => (
          <button type="button" key={p.id} className="av-card text-left" onClick={() => setSel(p)}>
            <div className="aspect-square bg-slate-100 overflow-hidden">{p.imagen_url ? <img loading="lazy" src={imagen(p.imagen_url, 320)} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : null}</div>
            <div className="p-2.5"><p className="text-[10px] font-mono-spec text-slate-400">{p.codigo}</p><p className="text-xs font-bold text-slate-800 line-clamp-2">{p.nombre}</p><p className="text-[10px] mt-0.5" style={{ color: p.descripcion ? '#04896f' : '#c98a1f' }}>{p.descripcion ? 'Con descripción' : 'Sin descripción'}</p></div>
          </button>
        ))}
      </div>
      {sel && <EditorProducto perfil={perfil} prod={sel} cerrar={() => setSel(null)} aviso={aviso} />}
    </section>
  )
}

function EditorProducto({ perfil, prod, cerrar, aviso }: { perfil: Perfil; prod: Prod; cerrar: () => void; aviso: (t: string) => void }) {
  const [texto, setTexto] = useState(prod.descripcion ?? '')
  const [notas, setNotas] = useState('')
  const [ia, setIa] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState('')
  const aprobar = puede(perfil, 'marketing', 'aprobar')
  async function redactar() {
    setIa(true); setMsg('')
    try {
      const r = await llamar<{ descripcion: string; caracteristicas: string[]; conFicha: boolean }>('ia_producto', { id: prod.id, notas })
      setTexto(r.descripcion + (r.caracteristicas.length ? '\n\nCaracterísticas:\n' + r.caracteristicas.map((c) => '• ' + c).join('\n') : ''))
      setMsg(r.conFicha ? 'Redactado con los datos de la ficha técnica.' : 'Redactado sin ficha técnica legible: revisa que no falte nada.')
    } catch (e) { setMsg((e as Error).message) }
    setIa(false)
  }
  async function enviar(directo: boolean) {
    if (!texto.trim()) { setMsg('La descripción está vacía.'); return }
    setGuardando(true)
    if (directo) {
      const { error } = await supabase.from('productos').update({ descripcion: texto.trim() }).eq('id', prod.id)
      setGuardando(false)
      if (error) { setMsg('No se pudo aplicar: ' + error.message); return }
      aviso('Descripción actualizada en el inventario.'); cerrar(); return
    }
    const { error } = await supabase.from('marketing_cambios').insert({ id: crypto.randomUUID(), codigo: 'MC-' + crypto.randomUUID().slice(0, 6).toUpperCase(), producto_id: prod.id, producto_texto: `${prod.codigo} · ${prod.nombre}`, campo: 'descripcion', nivel: 'Producto', valor_anterior: prod.descripcion ?? '', valor_nuevo: texto.trim(), estado: 'Pendiente', autor_id: perfil.id, autor_rol: perfil.rol ?? null })
    setGuardando(false)
    if (error) { setMsg('No se pudo enviar: ' + error.message); return }
    aviso('Enviada a Revisión.'); cerrar()
  }
  return (
    <Ventana titulo={prod.nombre} cerrar={cerrar} ancho="sm:max-w-2xl" pie={<><p className="text-[11px] flex-1 text-slate-500">{msg}</p>
      {aprobar && <button className="btn" onClick={() => enviar(true)} disabled={guardando}>Aplicar directo</button>}
      <button className="btn btn-primary" onClick={() => enviar(false)} disabled={guardando}><Send />Enviar a revisión</button></>}>
      <p className="text-[11px] text-slate-500">{prod.codigo}{prod.categoria ? ' · ' + prod.categoria.nombre : ''}</p>
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-2">
        <p className="text-[11px] font-bold text-violet-700 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" />Redactar con IA (Gemini)</p>
        <input value={notas} onChange={(e) => setNotas(e.target.value)} className="inp w-full" placeholder="Indicaciones (opcional): enfoque, público, qué resaltar…" />
        <button type="button" className="btn" onClick={redactar} disabled={ia}><Sparkles />{ia ? 'Redactando…' : 'Redactar descripción y características'}</button>
        <p className="text-[10px] text-slate-500">Si el producto tiene ficha técnica en PDF, la IA la lee para no inventar datos.</p>
      </div>
      <label className="block text-[11px] font-bold text-slate-500">Descripción<textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={12} className="inp w-full mt-1" /></label>
    </Ventana>
  )
}

/* ============================ Revisión (aprobaciones) ============================ */
type Cambio = { id: string; codigo: string | null; fecha: string; producto_id: string | null; producto_texto: string | null; campo: string; valor_anterior: string | null; valor_nuevo: string | null; estado: string; comentario: string | null; autor: { nombre: string } | null }
const CAMPOS_OK = ['descripcion']
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
      const { error } = await supabase.from('productos').update({ [c.campo]: c.valor_nuevo }).eq('id', c.producto_id)
      if (error) { aviso('No se pudo aplicar: ' + error.message); return }
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
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase text-slate-400 mb-1">Antes</p><p className="whitespace-pre-line text-slate-600">{c.valor_anterior || '—'}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[10px] font-bold uppercase text-emerald-700 mb-1">Propuesto</p><p className="whitespace-pre-line text-slate-800">{c.valor_nuevo}</p></div>
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
