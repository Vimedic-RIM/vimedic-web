import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BadgePercent, Check, FileDown, FolderUp, Megaphone, Package, Plus, Search, Send, Trash2, Users, X, XCircle } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { imagen as imgUrl } from './Inventario'
import { armarProductos, CFG_DEF, GRUPOS, meses, type Prod } from './Ofertas'
import '../estilos/ofertas.css'

const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
async function aDataUrl(url: string): Promise<string> { try { const b = await (await fetch(url)).blob(); if (b.size > 4 * 1048576) return ''; return await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ok(''); r.readAsDataURL(b) }) } catch { return '' } }
const txtPdf = (v: unknown) => String(v ?? '').replace(/[\u{1F000}-\u{1FFFF}☀-➿️‍]/gu, '').replace(/[^\x20-\x7E -ÿ\n]/g, ' ').replace(/ +/g, ' ').trim()

const normalize = (v: unknown) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
function Ventana({ titulo, cerrar, children, pie, ancha }: { titulo: string; cerrar: () => void; children: React.ReactNode; pie: React.ReactNode; ancha?: boolean }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className={'bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden ' + (ancha ? 'sm:max-w-4xl' : 'sm:max-w-xl')}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0"><h3 className="font-display font-bold text-sm text-slate-800">{titulo}</h3><button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">{children}</div>
        <div className="shrink-0 border-t border-slate-100 p-4 flex gap-2 items-center flex-wrap">{pie}</div>
      </div>
    </div>
  )
}
const fecha = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

/* ============================ Anuncios ============================ */
export function Anuncios({ perfil, desde, hasta, aviso }: { perfil: Perfil; desde: string; hasta: string; aviso: (t: string) => void }) {
  const [leads, setLeads] = useState<{ anuncio: string; medio: string }[] | null>(null)
  const [activos, setActivos] = useState<{ id: string; nombre: string }[]>([])
  const [nuevo, setNuevo] = useState('')
  const [error, setError] = useState('')
  const editar = puede(perfil, 'marketing', 'editar')
  const cargar = useCallback(async () => {
    const [l, a] = await Promise.all([
      supabase.from('leads').select('anuncio,medio_captacion').is('deleted_at', null).gte('fecha', desde + 'T00:00:00-05:00').lte('fecha', hasta + 'T23:59:59-05:00').not('anuncio', 'is', null).limit(5000),
      supabase.from('anuncios_activos').select('id,nombre').is('deleted_at', null).order('nombre'),
    ])
    if (l.error || a.error) { setError((l.error || a.error)!.message); return }
    setError(''); setLeads(((l.data ?? []) as { anuncio: string; medio_captacion: string | null }[]).filter((x) => x.anuncio?.trim()).map((x) => ({ anuncio: x.anuncio.trim(), medio: x.medio_captacion ?? '' })))
    setActivos((a.data ?? []) as { id: string; nombre: string }[])
  }, [desde, hasta])
  useEffect(() => { cargar() }, [cargar])
  const filas = useMemo(() => {
    const m: Record<string, number> = {}; (leads ?? []).forEach((x) => { m[x.anuncio] = (m[x.anuncio] || 0) + 1 })
    activos.forEach((a) => { if (!(a.nombre in m)) m[a.nombre] = 0 })
    const tot = Object.values(m).reduce((s, n) => s + n, 0) || 1
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([n, c]) => ({ nombre: n, leads: c, pct: Math.round((c / tot) * 100), activo: activos.find((a) => normalize(a.nombre) === normalize(n)) ?? null }))
  }, [leads, activos])
  async function activar(n: string) {
    const nombre = n.trim(); if (!nombre) return
    const { error } = await supabase.from('anuncios_activos').insert({ id: crypto.randomUUID(), nombre })
    if (error) aviso('No se pudo guardar: ' + error.message); else { setNuevo(''); cargar() }
  }
  async function desactivar(id: string) {
    const { error } = await supabase.from('anuncios_activos').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) aviso('No se pudo quitar: ' + error.message); else cargar()
  }
  return (
    <section className="space-y-4">
      <div className="card p-4 text-xs text-slate-600 flex gap-3 items-start"><Megaphone className="w-4 h-4 mt-0.5 shrink-0 text-[var(--violet)]" />
        <p>Aquí ves qué anuncios traen leads al CRM en el período elegido. Marca como <b>activos</b> los que están corriendo para que los asesores los elijan al registrar un lead. La inversión y el alcance llegarán cuando se conecte la API de anuncios de Meta.</p></div>
      {error && <p className="text-xs rounded-xl px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800">{error}</p>}
      {editar && <div className="flex gap-2"><input className="inp flex-1 max-w-sm" placeholder="Nombre del anuncio o campaña activa" value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') activar(nuevo) }} /><button className="btn btn-primary" onClick={() => activar(nuevo)}><Plus />Agregar activo</button></div>}
      <div className="card overflow-hidden">
        {!leads && <p className="p-6 text-center text-xs text-slate-400">Cargando…</p>}
        {leads && !filas.length && <p className="p-8 text-center text-sm text-slate-400">No hay leads con anuncio en este período.</p>}
        {filas.length > 0 && <table className="tbl"><thead><tr><th>Anuncio / campaña</th><th>Estado</th><th className="num">Leads</th><th className="num">% del total</th><th /></tr></thead><tbody>{filas.map((f) => (
          <tr key={f.nombre}><td><b className="text-slate-700">{f.nombre}</b></td>
            <td><span className="pill" style={f.activo ? { background: '#ecfaf5', color: '#04896f' } : { background: '#f1f5f9', color: '#64748b' }}>{f.activo ? 'Activo' : 'No marcado'}</span></td>
            <td className="num font-semibold">{f.leads}</td><td className="num text-slate-500">{f.pct}%</td>
            <td className="text-right">{editar && (f.activo ? <button className="btn" onClick={() => desactivar(f.activo!.id)}>Pausar</button> : <button className="btn" onClick={() => activar(f.nombre)}>Marcar activo</button>)}</td></tr>))}</tbody></table>}
      </div>
    </section>
  )
}

/* ============================ Material de proveedores ============================ */
type Item = { clave: string; codigo?: string; marca?: string; nota?: string; pide?: Record<string, number> }
type Sol = { id: string; codigo: string | null; titulo: string; estado: string; vence: string | null; proveedor_texto: string | null; nota: string | null; productos: Item[] }
type Arch = { id: string; solicitud_id: string; clave: string | null; tipo: string | null; nombre: string | null; url: string | null; fecha: string }
const PIDE: Record<string, string> = { ficha: 'Ficha técnica', manual: 'Manual', cert: 'Certificados', video: 'Video', foto: 'Fotos' }

export function Material({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [sols, setSols] = useState<Sol[] | null>(null)
  const [arch, setArch] = useState<Arch[]>([])
  const [error, setError] = useState('')
  const [abierta, setAbierta] = useState<Sol | null>(null)
  const editar = puede(perfil, 'marketing', 'editar')
  const cargar = useCallback(async () => {
    const [s, a] = await Promise.all([
      supabase.from('material_solicitudes').select('id,codigo,titulo,estado,vence,proveedor_texto,nota,productos').is('deleted_at', null).order('created_at', { ascending: false }).limit(200),
      supabase.from('material_archivos').select('id,solicitud_id,clave,tipo,nombre,url,fecha').is('deleted_at', null).order('fecha', { ascending: false }).limit(2000),
    ])
    if (s.error || a.error) { setError((s.error || a.error)!.message); return }
    setError(''); setSols((s.data as unknown as Sol[]) ?? []); setArch((a.data as Arch[]) ?? [])
  }, [])
  useEffect(() => { cargar() }, [cargar])
  async function estado(s: Sol, nuevo: string) {
    const { error } = await supabase.from('material_solicitudes').update({ estado: nuevo }).eq('id', s.id)
    if (error) { aviso('No se pudo cambiar: ' + error.message); return }
    aviso('Solicitud ' + nuevo.toLowerCase() + '.'); setAbierta(null); cargar()
  }
  const hoy = new Date().toISOString().slice(0, 10)
  if (error) return <div className="card p-6 text-sm text-amber-800 bg-amber-50 border-amber-200">{error}</div>
  if (!sols) return <p className="text-xs text-slate-400">Cargando…</p>
  return (
    <section>
      <div className="card p-4 text-xs text-slate-600 flex gap-3 items-start mb-4"><FolderUp className="w-4 h-4 mt-0.5 shrink-0 text-[var(--primary)]" />
        <p>Solicitudes de fichas, manuales, certificaciones y videos enviadas a proveedores. Los archivos que ellos suban aparecen aquí. La página pública de carga para proveedores (con enlace de un solo uso) se activa en una próxima fase.</p></div>
      {!sols.length && <div className="card p-10 text-center text-sm text-slate-400">Todavía no hay solicitudes.</div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {sols.map((s) => {
          const mias = arch.filter((a) => a.solicitud_id === s.id), vencida = s.vence && s.vence.slice(0, 10) < hoy && s.estado === 'Abierta'
          return (
            <article key={s.id} className="card p-4 cursor-pointer hover:shadow-md" onClick={() => setAbierta(s)}>
              <div className="flex items-center gap-2 flex-wrap"><span className="font-mono-spec text-[11px] text-slate-400">{s.codigo}</span>
                <span className="pill" style={s.estado === 'Abierta' ? (vencida ? { background: '#fdecea', color: '#c0392b' } : { background: '#eff6ff', color: '#055c9d' }) : { background: '#ecfaf5', color: '#04896f' }}>{vencida ? 'Vencida' : s.estado}</span>
                <span className="text-[10px] text-slate-400 ml-auto">vence {fecha(s.vence)}</span></div>
              <p className="text-sm font-bold text-slate-800 mt-1.5 line-clamp-2">{s.titulo}</p>
              <p className="text-[11px] text-slate-500 mt-1">{(s.productos ?? []).length} producto{(s.productos ?? []).length === 1 ? '' : 's'} · {mias.length} archivo{mias.length === 1 ? '' : 's'} recibido{mias.length === 1 ? '' : 's'}</p>
            </article>
          )
        })}
      </div>
      {abierta && (
        <Ventana titulo={abierta.titulo} cerrar={() => setAbierta(null)} pie={editar ? <>
          {abierta.estado === 'Abierta' ? <button className="btn btn-primary" onClick={() => estado(abierta, 'Cerrada')}><Check />Marcar como cerrada</button> : <button className="btn" onClick={() => estado(abierta, 'Abierta')}>Reabrir</button>}</> : <span className="text-[11px] text-slate-400">Solo lectura</span>}>
          <p className="text-[11px] text-slate-500">{abierta.codigo} · {abierta.proveedor_texto || 'Proveedor'} · vence {fecha(abierta.vence)}</p>
          {abierta.nota && <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2.5">{abierta.nota}</p>}
          <div className="space-y-2">{(abierta.productos ?? []).map((p) => {
            const recibidos = arch.filter((a) => a.solicitud_id === abierta.id && a.clave === p.clave)
            return (
              <div key={p.clave} className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-bold text-slate-800">{p.codigo || p.clave}{p.marca ? ' · ' + p.marca : ''}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Se pide: {Object.entries(p.pide ?? {}).filter(([, v]) => v).map(([k]) => PIDE[k] ?? k).join(', ') || '—'}</p>
                {recibidos.length ? <div className="flex flex-wrap gap-1.5 mt-2">{recibidos.map((r) => <a key={r.id} href={r.url ?? '#'} target="_blank" rel="noopener noreferrer" className="pill" style={{ background: '#ecfaf5', color: '#04896f' }}>{r.tipo || 'archivo'} · {r.nombre || 'ver'}</a>)}</div>
                  : <p className="text-[11px] text-amber-700 mt-1.5">Aún sin archivos.</p>}
              </div>)
          })}</div>
        </Ventana>
      )}
    </section>
  )
}

/* ============================ Promociones ============================ */
type Hist = { fecha: string; por: string; accion: string; comentario?: string }
type ItemPromo = {
  id: string; desc?: number | null; descPropuesto?: number | null; unidades?: number | null; nota?: string; ofertaId?: string
  estadoAprobacion?: 'Pendiente' | 'Aprobado' | 'Rechazado'; descAprobado?: number; revisadoPor?: string; fechaRevision?: string; motivoRechazo?: string
}
type Camp = { id: string; codigo: string | null; nombre: string; inicio: string | null; fin: string | null; estado: string; items: ItemPromo[]; combos: unknown[]; preventa: boolean; comentario: string | null; historial: Hist[] }
const COLOR_P: Record<string, [string, string]> = { Borrador: ['#64748b', '#f1f5f9'], 'En aprobación': ['#a16207', '#fff8eb'], Devuelta: ['#c2410c', '#fff1e6'], Aprobada: ['#04896f', '#ecfaf5'], Rechazada: ['#c0392b', '#fdecea'], Cancelada: ['#64748b', '#f1f5f9'] }

export function Promociones({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [lista, setLista] = useState<Camp[] | null>(null)
  const [error, setError] = useState('')
  const [abierta, setAbierta] = useState<Camp | null>(null)
  const [nueva, setNueva] = useState(false)
  const crear = puede(perfil, 'marketing', 'crear'), aprobar = puede(perfil, 'marketing', 'aprobar')
  const puedeEliminar = puede(perfil, 'marketing', 'eliminar') || puede(perfil, 'promociones', 'eliminar')
  const cargar = useCallback(() => {
    supabase.from('promo_campanas').select('id,codigo,nombre,inicio,fin,estado,items,combos,preventa,comentario,historial').is('deleted_at', null).order('inicio', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) setError(error.message); else { setError(''); setLista((data as unknown as Camp[]) ?? []) } })
  }, [])
  useEffect(() => { cargar() }, [cargar])
  async function mover(c: Camp, estado: string, comentario?: string) {
    if (estado === 'Aprobada') {
      // Al aprobar, cada producto con descuento pasa a Ofertas y Liquidación como oferta real
      // (validado contra el piso de margen); esto lo hace una función con privilegios propios
      // porque no siempre quien aprueba tiene permiso de ver costos.
      const { data, error } = await supabase.rpc('aprobar_campana_promocion', { p_campana_id: c.id, p_comentario: comentario ?? null })
      if (error) { aviso('No se pudo aprobar: ' + error.message); return }
      const r = data as { creadas?: number; actualizadas?: number } | null
      aviso(`Campaña aprobada: ${r?.creadas ?? 0} oferta(s) nueva(s)${r?.actualizadas ? ', ' + r.actualizadas + ' actualizada(s)' : ''} en Ofertas y Liquidación.`)
      setAbierta(null); cargar(); return
    }
    const h: Hist = { fecha: new Date().toISOString(), por: perfil.nombre, accion: estado, ...(comentario ? { comentario } : {}) }
    const cambios: Record<string, unknown> = { estado, historial: [...(c.historial ?? []), h], comentario: comentario ?? null }
    if (estado === 'En aprobación') cambios.enviado = new Date().toISOString()
    if (estado === 'Rechazada') {
      cambios.aprobado_por = perfil.id; cambios.fecha_aprobacion = new Date().toISOString()
      // Rechazo de toda la campaña: marca también cada producto pendiente, para que quede igual
      // de trazable que un rechazo uno por uno desde Ofertas y Liquidación.
      const ahora = new Date().toISOString()
      cambios.items = (c.items ?? []).map((it) => (!it.estadoAprobacion || it.estadoAprobacion === 'Pendiente')
        ? { ...it, estadoAprobacion: 'Rechazado' as const, revisadoPor: perfil.nombre, fechaRevision: ahora, motivoRechazo: comentario || 'Campaña rechazada' }
        : it)
    }
    const { error } = await supabase.from('promo_campanas').update(cambios).eq('id', c.id)
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    aviso('Campaña: ' + estado.toLowerCase() + '.'); setAbierta(null); cargar()
  }
  async function actualizarCampo(c: Camp, campos: Partial<Pick<Camp, 'nombre' | 'inicio' | 'fin' | 'items' | 'estado'>>) {
    const { error } = await supabase.from('promo_campanas').update(campos).eq('id', c.id)
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    setAbierta((a) => (a && a.id === c.id ? { ...a, ...campos } : a)); cargar()
  }
  async function eliminar(c: Camp) {
    if (!confirm(`¿Eliminar "${c.nombre}" (${c.codigo})? No se podrá deshacer desde aquí.`)) return
    const { error } = await supabase.from('promo_campanas').update({ deleted_at: new Date().toISOString() }).eq('id', c.id)
    if (error) { aviso('No se pudo eliminar: ' + error.message); return }
    aviso('Campaña eliminada.'); setAbierta(null); cargar()
  }
  if (error) return <div className="card p-6 text-sm text-amber-800 bg-amber-50 border-amber-200">{error}</div>
  if (!lista) return <p className="text-xs text-slate-400">Cargando…</p>
  return (
    <section>
      <div className="flex items-center gap-2 mb-4"><p className="text-xs text-slate-500 mr-auto">{lista.length} campaña{lista.length === 1 ? '' : 's'}</p>
        {crear && <button className="btn btn-primary" onClick={() => setNueva(true)}><Plus />Nueva campaña</button>}</div>
      {!lista.length && <div className="card p-10 text-center text-sm text-slate-400">No hay campañas. Crea la primera (por ejemplo, Black Friday).</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {lista.map((c) => { const [col, bg] = COLOR_P[c.estado] ?? COLOR_P.Borrador; return (
          <article key={c.id} className="card p-4 cursor-pointer hover:shadow-md relative" onClick={() => setAbierta(c)}>
            {puedeEliminar && <button type="button" title="Eliminar campaña" className="absolute top-3 right-3 w-6 h-6 rounded-lg grid place-items-center text-slate-300 hover:text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); eliminar(c) }}><Trash2 className="w-3.5 h-3.5" /></button>}
            <div className="flex items-center gap-2 pr-7"><BadgePercent className="w-4 h-4 text-[var(--amber)]" /><span className="font-mono-spec text-[11px] text-slate-400">{c.codigo}</span><span className="pill ml-auto" style={{ background: bg, color: col }}>{c.estado}</span></div>
            <p className="text-sm font-bold text-slate-800 mt-1.5">{c.nombre}</p>
            <p className="text-[11px] text-slate-500 mt-1">{fecha(c.inicio)} → {fecha(c.fin)}{c.preventa ? ' · Preventa' : ''}</p>
            <p className="text-[11px] text-slate-400">{(c.items ?? []).length} producto{(c.items ?? []).length === 1 ? '' : 's'} · {(c.combos ?? []).length} combo{(c.combos ?? []).length === 1 ? '' : 's'}</p>
          </article>) })}
      </div>
      {abierta && <DetalleCampana c={abierta} perfil={perfil} aprobar={aprobar} editar={crear} puedeEliminar={puedeEliminar} cerrar={() => setAbierta(null)} mover={mover} eliminar={eliminar} actualizarCampo={actualizarCampo} />}
      {nueva && <NuevaCampana perfil={perfil} cerrar={() => setNueva(false)} hecho={() => { setNueva(false); cargar(); aviso('Campaña creada.') }} aviso={aviso} />}
    </section>
  )
}

type ProdPromo = {
  id: string; codigo: string; nombre: string; categoria: string; pvp: number; costo: number | null; enCatalogo: boolean; imagen: string; desc: number; precioFinal: number; margen: number | null
  estadoAprobacion?: ItemPromo['estadoAprobacion']; descOriginal?: number; revisadoPor?: string; motivoRechazo?: string
  stock: number; dias: number; grupo: string; conObs: boolean; motivosObs: string[]; interes: number; capitalPvp: number
}
const ORDENES_PROMO: [string, string][] = [
  ['cat', 'Categoría (A-Z)'], ['costo', 'Costo (mayor a menor)'], ['desc', '% Descuento (mayor a menor)'],
  ['pvp', 'PVP (mayor a menor)'], ['margen', 'Margen (mayor a menor)'], ['nombre', 'Nombre (A-Z)'],
]

function DetalleCampana({ c, perfil, aprobar, editar, puedeEliminar, cerrar, mover, eliminar, actualizarCampo }: {
  c: Camp; perfil: Perfil; aprobar: boolean; editar: boolean; puedeEliminar: boolean; cerrar: () => void
  mover: (c: Camp, estado: string, comentario?: string) => void; eliminar: (c: Camp) => void
  actualizarCampo: (c: Camp, campos: Partial<Pick<Camp, 'nombre' | 'inicio' | 'fin' | 'items' | 'estado'>>) => Promise<void> | void
}) {
  const [com, setCom] = useState('')
  const [nombreEd, setNombreEd] = useState(c.nombre)
  const [inicioEd, setInicioEd] = useState(c.inicio ?? '')
  const [finEd, setFinEd] = useState(c.fin ?? '')
  function guardarNombre() {
    const limpio = nombreEd.trim()
    if (!limpio || limpio === c.nombre) { setNombreEd(c.nombre); return }
    actualizarCampo(c, { nombre: limpio })
  }
  function guardarVigencia() {
    if (!inicioEd || !finEd) { setInicioEd(c.inicio ?? ''); setFinEd(c.fin ?? ''); return }
    if (finEd < inicioEd) { alert('La fecha de fin es anterior al inicio.'); setInicioEd(c.inicio ?? ''); setFinEd(c.fin ?? ''); return }
    if (inicioEd === c.inicio && finEd === c.fin) return
    actualizarCampo(c, { inicio: inicioEd, fin: finEd })
  }
  const verCostos = puede(perfil, 'promociones', 'ver_costos') || puede(perfil, 'ofertas', 'ver_costos')
  const [prods, setProds] = useState<ProdPromo[] | null>(null)
  const [analisis, setAnalisis] = useState<Prod[] | null>(null)
  const [ventasTot, setVentasTot] = useState<Record<string, number>>({})
  const [orden, setOrden] = useState('cat')
  const [generando, setGenerando] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const items = c.items ?? []

  // Misma analítica de "stock dormido" que usa Oportunidades (antigüedad, interés, observaciones):
  // solo trae candidatos (dormidos o con novedades), por eso los que no aparecen ahí quedan en blanco.
  useEffect(() => {
    let vivo = true
    supabase.rpc('of_analisis').then(({ data }) => {
      if (!vivo) return
      const an = (data ?? { productos: [], estrellas: [] }) as { productos: unknown[]; estrellas: unknown[] }
      setAnalisis(armarProductos(an.productos as never[], an.estrellas as never[], CFG_DEF, {}))
    })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    if (!items.length) { setProds([]); return }
    let vivo = true
    const codigos = items.map((i) => i.id)
    const porAnalisis = new Map((analisis ?? []).map((p) => [p.codigo, p]))
    ;(async () => {
      const { data: p, error } = await supabase.from('productos').select('id,codigo,nombre,pvp,stock,en_catalogo,imagen_url,categoria:categorias(nombre)').in('codigo', codigos).is('deleted_at', null)
      if (!vivo) return
      if (error) { setProds([]); return }
      const prodRows = (p ?? []) as unknown as { id: string; codigo: string; nombre: string; pvp: number | null; stock: number | null; en_catalogo: boolean | null; imagen_url: string | null; categoria: { nombre: string } | null }[]
      let costos: Record<string, number> = {}
      if (verCostos && prodRows.length) {
        const { data: co } = await supabase.from('productos_costos').select('producto_id,costo_importacion').in('producto_id', prodRows.map((x) => x.id)).is('deleted_at', null)
        costos = Object.fromEntries(((co ?? []) as { producto_id: string; costo_importacion: number | null }[]).map((x) => [x.producto_id, Number(x.costo_importacion) || 0]))
      }
      const porCodigo = new Map(prodRows.map((x) => [x.codigo, x]))
      const filas: ProdPromo[] = items.map((it) => {
        const p0 = porCodigo.get(it.id)
        const an = porAnalisis.get(it.id)
        const pvp = Number(p0?.pvp) || 0, desc = Number(it.desc) || 0
        const descEfectivo = it.estadoAprobacion === 'Aprobado' && it.descAprobado != null ? Number(it.descAprobado) : desc
        const precioFinal = Math.round(pvp * (1 - descEfectivo / 100) * 100) / 100
        const costo = p0 && verCostos ? (costos[p0.id] ?? 0) : null
        const margen = costo != null && costo > 0 && precioFinal > 0 ? Math.round((precioFinal - costo) / precioFinal * 1000) / 10 : null
        return {
          id: p0?.id ?? '', codigo: it.id, nombre: p0?.nombre ?? it.id, categoria: p0?.categoria?.nombre ?? '—', pvp, costo, enCatalogo: !!p0?.en_catalogo, imagen: p0?.imagen_url ?? '', desc: descEfectivo, precioFinal, margen,
          estadoAprobacion: it.estadoAprobacion, descOriginal: desc, revisadoPor: it.revisadoPor, motivoRechazo: it.motivoRechazo,
          stock: Number(p0?.stock) || 0, dias: an?.dias ?? 0, grupo: an?.grupo ?? '', conObs: an?.conObs ?? false, motivosObs: an?.motivosObs ?? [], interes: an?.interes ?? 0, capitalPvp: an?.capitalPvp ?? (Number(p0?.stock) || 0) * pvp,
        }
      })
      setProds(filas)
    })()
    return () => { vivo = false }
  }, [items, verCostos, analisis])

  // Ventas totales de siempre (no solo los últimos 12 meses), para la etiqueta "N ventas registradas".
  useEffect(() => {
    const ids = [...new Set((prods ?? []).map((p) => p.id).filter(Boolean))]
    if (!ids.length) return
    let vivo = true
    supabase.from('movimientos_inventario').select('producto_id,cantidad').in('producto_id', ids).eq('tipo', 'SALIDA').is('deleted_at', null).then(({ data }) => {
      if (!vivo) return
      const porId: Record<string, number> = {}
      ;((data ?? []) as { producto_id: string; cantidad: number }[]).forEach((m) => { porId[m.producto_id] = (porId[m.producto_id] || 0) + Math.abs(Number(m.cantidad) || 0) })
      const porCod: Record<string, number> = {}
      ;(prods ?? []).forEach((p) => { if (p.id) porCod[p.codigo] = porId[p.id] || 0 })
      setVentasTot((x) => ({ ...x, ...porCod }))
    })
    return () => { vivo = false }
  }, [prods])

  async function agregarProducto(codigo: string) {
    if (items.some((i) => i.id === codigo)) return
    await actualizarCampo(c, { items: [...items, { id: codigo, desc: 0, nota: '' }] })
  }
  async function quitarProducto(codigo: string) {
    if (!confirm('¿Quitar este producto de la campaña?')) return
    await actualizarCampo(c, { items: items.filter((i) => i.id !== codigo) })
  }
  async function guardarDesc(codigo: string, nuevoDesc: number) {
    const nuevos = items.map((i) => (i.id === codigo ? { ...i, desc: nuevoDesc, descPropuesto: nuevoDesc } : i))
    // Si la campaña ya estaba cerrada (aprobada/rechazada) y se suma un producto con descuento,
    // vuelve a "En aprobación" para que aparezca en Ofertas › Por aprobar. Los ya aprobados no se tocan.
    const reabrir = nuevoDesc > 0 && ['Aprobada', 'Rechazada'].includes(c.estado)
    await actualizarCampo(c, reabrir ? { items: nuevos, estado: 'En aprobación' } : { items: nuevos })
  }

  const filas = useMemo(() => {
    if (!prods) return []
    const cmp: Record<string, (a: ProdPromo, b: ProdPromo) => number> = {
      cat: (a, b) => a.categoria.localeCompare(b.categoria, 'es') || a.nombre.localeCompare(b.nombre, 'es'),
      costo: (a, b) => (b.costo ?? -1) - (a.costo ?? -1),
      desc: (a, b) => b.desc - a.desc,
      pvp: (a, b) => b.pvp - a.pvp,
      margen: (a, b) => (b.margen ?? -999) - (a.margen ?? -999),
      nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    }
    // Visibles en el catálogo público primero, siempre; el criterio elegido decide el resto.
    return [...prods].sort((a, b) => (Number(b.enCatalogo) - Number(a.enCatalogo)) || cmp[orden](a, b))
  }, [prods, orden])

  async function exportarPdf() {
    setGenerando(true)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
      const fechaHoy = new Date().toLocaleDateString('es-EC')
      const fotos = new Map<string, string | null>()
      const totalPaginas = Math.max(1, Math.ceil(filas.length / 6))
      let faltan = 0
      for (let pagina = 0; pagina < totalPaginas; pagina++) {
        const lote = filas.slice(pagina * 6, pagina * 6 + 6)
        for (let k = 0; k < lote.length; k += 3) {
          await Promise.all(lote.slice(k, k + 3).map(async (f) => { if (fotos.has(f.codigo)) return; fotos.set(f.codigo, f.imagen ? (await aDataUrl(imgUrl(f.imagen, 600))) || null : null) }))
        }
        if (pagina) doc.addPage()
        doc.setFillColor(11, 37, 69); doc.rect(0, 0, 210, 27, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('VIMEDIC', 12, 12); doc.setFontSize(10); doc.text(c.nombre, 12, 20)
        doc.setTextColor(100, 116, 139); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(`${fechaHoy} · ${filas.length} producto(s) en promoción`, 12, 34)
        lote.forEach((f, i) => {
          const x = 12 + (i % 2) * 95, y = 40 + Math.floor(i / 2) * 79, w = 91, h = 75
          doc.setDrawColor(226, 232, 240); doc.setFillColor(255, 255, 255); doc.roundedRect(x, y, w, h, 3, 3, 'FD')
          const foto = fotos.get(f.codigo)
          if (foto) { try { const prop = doc.getImageProperties(foto), s = Math.min(34 / prop.width, 31 / prop.height); doc.addImage(foto, prop.fileType, x + 4 + (34 - prop.width * s) / 2, y + 3 + (31 - prop.height * s) / 2, prop.width * s, prop.height * s, undefined, 'FAST') } catch { faltan++; doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text('Imagen no disponible', x + 4, y + 19) } }
          else { faltan++; doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text('Sin imagen disponible', x + 4, y + 19) }
          if (f.desc > 0) { doc.setFillColor(194, 65, 12); doc.roundedRect(x + w - 24, y + 4, 20, 10, 2, 2, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(`-${f.desc}%`, x + w - 14, y + 10.5, { align: 'center' }) }
          doc.setTextColor(11, 37, 69); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
          doc.text(doc.splitTextToSize(txtPdf(f.nombre), 45).slice(0, 4), x + 41, y + 8)
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text(txtPdf(f.codigo) + (f.categoria !== '—' ? ' · ' + txtPdf(f.categoria) : ''), x + 41, y + 32)
          if (f.desc > 0) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(148, 163, 184); const antes = `Antes: ${money(f.pvp)}`; doc.text(antes, x + 4, y + 44); const aw = doc.getTextWidth(antes); doc.setDrawColor(148, 163, 184); doc.line(x + 4, y + 43, x + 4 + aw, y + 43) }
          doc.setFont('helvetica', 'bold'); doc.setTextColor(194, 65, 12); doc.setFontSize(13); doc.text(`${money(f.precioFinal)}`, x + 4, y + 53)
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text('+ IVA', x + 4 + doc.getTextWidth(money(f.precioFinal)) + 2, y + 53)
          doc.setFontSize(7); doc.setTextColor(71, 85, 105); doc.text(`Válido hasta ${fecha(c.fin)}`, x + 4, y + 62)
        })
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text('Precios sujetos a disponibilidad de stock. Consulta con tu asesor VIMEDIC.', 12, 284); doc.text(`${pagina + 1} / ${totalPaginas}`, 195, 284, { align: 'right' })
      }
      doc.save(`VIMEDIC-Promo-${(c.codigo || c.nombre).replace(/[^a-z0-9]+/gi, '-')}.pdf`)
      if (faltan) setTimeout(() => alert(`${faltan} producto(s) sin imagen disponible.`), 300)
    } catch (e) { alert((e as Error).message) }
    setGenerando(false)
  }

  return (
    <Ventana titulo={c.nombre} ancha cerrar={cerrar} pie={<>
      {editar && ['Borrador', 'Devuelta'].includes(c.estado) && <button className="btn btn-primary" onClick={() => mover(c, 'En aprobación')}><Send />Enviar a aprobación</button>}
      {aprobar && c.estado === 'En aprobación' && <>
        <button className="btn" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => mover(c, 'Rechazada', com.trim())}>Rechazar campaña</button>
        <button className="btn" onClick={() => { if (!com.trim()) { alert('Escribe qué se debe corregir.'); return } mover(c, 'Devuelta', com.trim()) }}>Devolver</button>
        {items.filter((i) => Number(i.desc) > 0).length === 0
          ? <button className="btn btn-primary" onClick={() => mover(c, 'Aprobada', com.trim())}><Check />Aprobar</button>
          : <p className="text-[11px] text-slate-500 self-center">Los productos se aprueban o rechazan uno por uno desde Ofertas y Liquidación › Por aprobar.</p>}</>}
      {editar && ['Aprobada', 'Borrador'].includes(c.estado) && <button className={'btn' + (puedeEliminar ? '' : ' ml-auto')} style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => { if (confirm('¿Cancelar esta campaña?')) mover(c, 'Cancelada') }}><X />Cancelar campaña</button>}
      {puedeEliminar && <button className="btn ml-auto" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => eliminar(c)}><Trash2 />Eliminar</button>}</>}>
      {editar ? (
        <>
          <label className="block text-[11px] font-bold text-slate-500">Nombre de la campaña
            <input className="inp w-full mt-1 font-bold" value={nombreEd} onChange={(e) => setNombreEd(e.target.value)} onBlur={guardarNombre}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></label>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-[11px] font-bold text-slate-500">Vigente desde
              <input type="date" className="inp w-full mt-1" value={inicioEd} onChange={(e) => setInicioEd(e.target.value)} onBlur={guardarVigencia} /></label>
            <label className="block text-[11px] font-bold text-slate-500">Vigente hasta
              <input type="date" className="inp w-full mt-1" value={finEd} onChange={(e) => setFinEd(e.target.value)} onBlur={guardarVigencia} /></label>
          </div>
        </>
      ) : null}
      <p className="text-[11px] text-slate-500">{c.codigo} · {fecha(c.inicio)} → {fecha(c.fin)}{c.preventa ? ' · Preventa' : ''} · <b>{c.estado}</b></p>
      {c.comentario && <p className="text-xs rounded-lg p-2.5 bg-amber-50 text-amber-800">Comentario: {c.comentario}</p>}
      {aprobar && c.estado === 'En aprobación' && <textarea className="inp w-full" rows={2} placeholder="Comentario para quien envió la campaña" value={com} onChange={(e) => setCom(e.target.value)} />}

      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[11px] text-slate-500 mr-auto">{items.length} producto{items.length === 1 ? '' : 's'} en promoción.</p>
        <select className="inp" style={{ width: 'auto' }} value={orden} onChange={(e) => setOrden(e.target.value)}>{ORDENES_PROMO.map(([v, t]) => (!verCostos && (v === 'costo' || v === 'margen')) ? null : <option key={v} value={v}>{t}</option>)}</select>
        {editar && !['Cancelada'].includes(c.estado) && <button className="btn btn-sm btn-primary" onClick={() => setBuscando(true)}><Plus className="w-3.5 h-3.5" />Agregar producto</button>}
        <button className="btn btn-sm" disabled={!filas.length || generando} onClick={exportarPdf}><FileDown className="w-3.5 h-3.5" />{generando ? 'Generando…' : 'Exportar PDF'}</button>
      </div>

      <div>
        {!prods && <p className="p-4 text-center text-xs text-slate-400">Cargando productos…</p>}
        {prods && !filas.length && <p className="p-4 text-center text-xs text-slate-400">Esta campaña todavía no tiene productos.</p>}
        {filas.length > 0 && (
          <div className="vm-of" style={ESTILO_TARJETAS}><div className="grid-p">{filas.map((f) => (
            <TarjetaPromo key={f.codigo} f={f} ventas={ventasTot[f.codigo]}
              editable={editar && (!f.estadoAprobacion || f.estadoAprobacion === 'Pendiente')}
              onGuardar={(d) => guardarDesc(f.codigo, d)} onQuitar={() => quitarProducto(f.codigo)} />
          ))}</div></div>
        )}
      </div>
      {buscando && <BuscarProductoPromo excluir={items.map((i) => i.id)} analisis={analisis ?? []} cerrar={() => setBuscando(false)} agregar={agregarProducto} />}

      <div><p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">Historial</p>
        {!(c.historial ?? []).length && <p className="text-[11px] text-slate-400">Sin movimientos.</p>}
        <ul className="space-y-1.5">{[...(c.historial ?? [])].reverse().map((h, i) => <li key={i} className="text-[11px] text-slate-600"><b>{h.accion}</b> · {h.por} · {new Date(h.fecha).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' })}{h.comentario ? ' — ' + h.comentario : ''}</li>)}</ul></div>
    </Ventana>
  )
}

// Las tarjetas reusan los estilos de Ofertas, que viven bajo .vm-of; se anula su alto/fondo de pantalla completa.
const ESTILO_TARJETAS: React.CSSProperties = { minHeight: 0, background: 'transparent' }

/* Mismas etiquetas que Ofertas › Por aprobar, para leer igual los productos en los dos lados. */
function EtiquetasProducto({ conObs, grupo, dias, ventas, stock, interes }: { conObs: boolean; grupo: string; dias: number; ventas?: number; stock: number; interes: number }) {
  const g = GRUPOS[grupo]
  return (
    <div className="flex gap-1.5 flex-wrap mb-1">
      {conObs && <span className="pill" style={{ background: '#f3e8ff', color: '#6d28d9' }}><AlertTriangle style={{ width: 11, height: 11 }} />Con observaciones</span>}
      {g && <span className="pill" style={{ background: g.hex + '1f', color: g.hex }}>Antigüedad · {meses(dias)}</span>}
      {ventas != null && (ventas === 0
        ? <span className="pill" style={{ background: '#f1f5f9', color: '#334155' }}>Nunca vendido</span>
        : <span className="pill" style={{ background: '#ecfdf5', color: '#047857' }}>{ventas} venta{ventas === 1 ? '' : 's'} registrada{ventas === 1 ? '' : 's'}</span>)}
      {stock >= 3 && <span className="pill" style={{ background: '#fff1e6', color: '#c2410c' }}>Sobrestock · {stock} u.</span>}
      {interes > 0 && <span className="pill" style={{ background: '#fff7ed', color: '#c2410c' }}><Users style={{ width: 11, height: 11 }} />{interes} cotizaron sin comprar</span>}
    </div>
  )
}

function TarjetaPromo({ f, ventas, editable, onGuardar, onQuitar }: { f: ProdPromo; ventas?: number; editable: boolean; onGuardar: (desc: number) => void; onQuitar: () => void }) {
  const original = f.descOriginal ?? f.desc
  const [valor, setValor] = useState(String(original))
  useEffect(() => { setValor(String(original)) }, [original])
  const desc = Math.max(0, Math.min(90, Number(valor) || 0))
  const mostrar = editable ? desc : f.desc
  const precio = f.pvp > 0 ? Math.round(f.pvp * (1 - mostrar / 100) * 100) / 100 : 0
  const ahorro = f.pvp > 0 ? Math.round((f.pvp - precio) * 100) / 100 : 0
  function guardar() { if (desc !== original) onGuardar(desc) }
  return (
    <article className="pc">
      <div className="pc-top"><div className="ph">{f.imagen ? <img loading="lazy" src={imgUrl(f.imagen, 300)} alt="" onError={(ev) => ev.currentTarget.remove()} /> : <Package style={{ width: 28, height: 28 }} />}</div>
        <div className="min-w-0 flex-1">
          <EtiquetasProducto conObs={f.conObs} grupo={f.grupo} dias={f.dias} ventas={ventas} stock={f.stock} interes={f.interes} />
          <p className="font-bold text-[14px] leading-snug text-slate-800 line-clamp-2">{f.nombre}</p>
          <p className="text-[11px] text-slate-400 mono">{f.codigo} · {f.categoria}{!f.enCatalogo ? ' · No está en el catálogo' : ''}</p>
          <p className="text-[12px] text-slate-600 mt-1"><b>{f.stock}</b> u. · {money(f.capitalPvp)} detenido</p>
          {f.conObs && <p className="text-[11.5px] text-violet-700 font-semibold mt-1 line-clamp-2">{f.motivosObs.join(' · ')}</p>}
        </div>
      </div>
      <div className="jug">
        <div className="t"><BadgePercent style={{ width: 13, height: 13 }} />% de descuento propuesto</div>
        <div className="flex items-center gap-2 mt-1.5">
          {editable
            ? <input type="number" min="0" max="90" step="0.5" className="inp font-bold" style={{ fontSize: 26, height: 48, width: 92, color: 'var(--acc)' }} value={valor}
                onChange={(ev) => setValor(ev.target.value)} onBlur={guardar} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }} />
            : <span className="font-bold" style={{ fontSize: 26, color: 'var(--acc)' }}>{f.desc}</span>}
          <span className="text-lg font-bold" style={{ color: 'var(--acc)' }}>%</span>
          <div className="ml-auto text-right">
            {f.pvp > 0 && mostrar > 0 && <span className="precio-a">{money(f.pvp)}</span>} <span className="precio-n">{money(precio)}</span>
          </div>
        </div>
        {f.pvp > 0 && mostrar > 0 && <p className="text-[11.5px] font-semibold mt-1.5" style={{ color: '#04896f' }}>El cliente ahorra {money(ahorro)}</p>}
      </div>
      {f.estadoAprobacion === 'Aprobado' && (
        <p className="text-[11px] font-semibold rounded-lg px-2 py-1" style={{ background: '#ecfaf5', color: '#04896f', margin: '0 12px 12px' }}>
          Aprobado por {f.revisadoPor}{f.descOriginal != null && f.descOriginal !== f.desc ? ' · se propuso -' + f.descOriginal + '%, se aprobó -' + f.desc + '%' : ''}
        </p>
      )}
      {f.estadoAprobacion === 'Rechazado' && (
        <p className="text-[11px] font-semibold rounded-lg px-2 py-1" style={{ background: '#fdecea', color: '#c0392b', margin: '0 12px 12px' }}>
          Rechazado por {f.revisadoPor}{f.motivoRechazo ? ': ' + f.motivoRechazo : ''}
        </p>
      )}
      {editable && (
        <div style={{ margin: '0 12px 12px' }}>
          <button className="btn w-full" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={onQuitar}><XCircle className="w-4 h-4" />Quitar de la campaña</button>
        </div>
      )}
    </article>
  )
}

/* Buscador libre: cualquier producto del inventario, no solo lo que sugiere el sistema. */
type ProdBusqueda = { id: string; codigo: string; nombre: string; pvp: number | null; stock: number | null; imagen_url: string | null; en_catalogo: boolean | null; categoria: { nombre: string } | null }
function BuscarProductoPromo({ excluir, analisis, cerrar, agregar }: { excluir: string[]; analisis: Prod[]; cerrar: () => void; agregar: (codigo: string) => Promise<void> | void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<ProdBusqueda[] | null>(null)
  const [orden, setOrden] = useState('cat')
  const [agregando, setAgregando] = useState('')
  const porCodigo = useMemo(() => new Map(analisis.map((p) => [p.codigo, p])), [analisis])
  useEffect(() => {
    const palabras = normalize(q).split(/\s+/).filter(Boolean)
    if (!palabras.length) { setRes(null); return }
    let vivo = true
    const t = setTimeout(() => {
      let consulta = supabase.from('productos').select('id,codigo,nombre,pvp,stock,imagen_url,en_catalogo,categoria:categorias(nombre)').is('deleted_at', null)
      for (const w of palabras) consulta = consulta.ilike('busqueda_normalizada', `%${w}%`)
      consulta.limit(40).then(({ data }) => { if (vivo) setRes((data as unknown as ProdBusqueda[]) ?? []) })
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [q])
  const lista = useMemo(() => {
    const cmp: Record<string, (a: ProdBusqueda, b: ProdBusqueda) => number> = {
      cat: (a, b) => (a.categoria?.nombre ?? '').localeCompare(b.categoria?.nombre ?? '', 'es') || a.nombre.localeCompare(b.nombre, 'es'),
      pvp: (a, b) => (Number(b.pvp) || 0) - (Number(a.pvp) || 0),
      nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    }
    return [...(res ?? [])].sort((a, b) => (Number(!!b.en_catalogo) - Number(!!a.en_catalogo)) || cmp[orden](a, b))
  }, [res, orden])
  return (
    <Ventana titulo="Agregar productos a la campaña" ancha cerrar={cerrar} pie={<button className="btn ml-auto" onClick={cerrar}>Listo</button>}>
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[220px]"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input autoFocus className="inp w-full" style={{ paddingLeft: 34 }} placeholder="Buscar por nombre, código o marca…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="inp" style={{ width: 'auto' }} value={orden} onChange={(e) => setOrden(e.target.value)}>
          <option value="cat">Categoría (A-Z)</option><option value="pvp">Precio (mayor a menor)</option><option value="nombre">Nombre (A-Z)</option></select>
      </div>
      {res === null && <p className="text-xs text-slate-400 text-center py-6">Escribe para buscar cualquier producto del inventario.</p>}
      {res && !res.length && <p className="text-xs text-slate-400 text-center py-6">Sin resultados.</p>}
      {lista.length > 0 && (
        <div className="vm-of" style={ESTILO_TARJETAS}><div className="grid-p">{lista.map((p) => {
          const an = porCodigo.get(p.codigo), ya = excluir.includes(p.codigo)
          return (
            <article key={p.id} className="pc">
              <div className="pc-top"><div className="ph">{p.imagen_url ? <img loading="lazy" src={imgUrl(p.imagen_url, 300)} alt="" onError={(ev) => ev.currentTarget.remove()} /> : <Package style={{ width: 28, height: 28 }} />}</div>
                <div className="min-w-0 flex-1">
                  <EtiquetasProducto conObs={an?.conObs ?? false} grupo={an?.grupo ?? ''} dias={an?.dias ?? 0} stock={Number(p.stock) || 0} interes={an?.interes ?? 0} />
                  <p className="font-bold text-[14px] leading-snug text-slate-800 line-clamp-2">{p.nombre}</p>
                  <p className="text-[11px] text-slate-400 mono">{p.codigo} · {p.categoria?.nombre ?? '—'}{!p.en_catalogo ? ' · No está en el catálogo' : ''}</p>
                  <p className="text-[12px] text-slate-600 mt-1"><b>{Number(p.stock) || 0}</b> u. · PVP {money(Number(p.pvp) || 0)}</p>
                </div>
              </div>
              <div style={{ margin: '0 12px 12px' }}>
                <button className="btn w-full" disabled={ya || agregando === p.codigo} style={ya ? undefined : { background: '#04896f', borderColor: '#04896f', color: '#fff' }}
                  onClick={async () => { setAgregando(p.codigo); await agregar(p.codigo); setAgregando('') }}>
                  {ya ? <><Check className="w-4 h-4" />Ya está en la campaña</> : <><Plus className="w-4 h-4" />{agregando === p.codigo ? 'Agregando…' : 'Agregar'}</>}
                </button>
              </div>
            </article>
          )
        })}</div></div>
      )}
    </Ventana>
  )
}

function NuevaCampana({ perfil, cerrar, hecho, aviso }: { perfil: Perfil; cerrar: () => void; hecho: () => void; aviso: (t: string) => void }) {
  const [n, setN] = useState(''); const [ini, setIni] = useState(''); const [fin, setFin] = useState(''); const [pre, setPre] = useState(false)
  async function guardar() {
    if (!n.trim() || !ini || !fin) { aviso('Completa nombre y fechas.'); return }
    if (fin < ini) { aviso('La fecha final es anterior al inicio.'); return }
    const { error } = await supabase.from('promo_campanas').insert({ id: crypto.randomUUID(), codigo: 'PR-' + crypto.randomUUID().slice(0, 6).toUpperCase(), nombre: n.trim(), inicio: ini, fin, preventa: pre, estado: 'Borrador', historial: [{ fecha: new Date().toISOString(), por: perfil.nombre, accion: 'Creada' }], actualizado_por: perfil.id })
    if (error) aviso('No se pudo crear: ' + error.message); else hecho()
  }
  return (
    <Ventana titulo="Nueva campaña" cerrar={cerrar} pie={<button className="btn btn-primary" onClick={guardar}>Crear campaña</button>}>
      <label className="block text-[11px] font-bold text-slate-500">Nombre<input className="inp w-full mt-1" value={n} onChange={(e) => setN(e.target.value)} placeholder="Ej. Black Friday 2026" /></label>
      <div className="grid grid-cols-2 gap-3"><label className="block text-[11px] font-bold text-slate-500">Inicio<input type="date" className="inp w-full mt-1" value={ini} onChange={(e) => setIni(e.target.value)} /></label>
        <label className="block text-[11px] font-bold text-slate-500">Fin<input type="date" className="inp w-full mt-1" value={fin} onChange={(e) => setFin(e.target.value)} /></label></div>
      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={pre} onChange={(e) => setPre(e.target.checked)} />Con preventa</label>
    </Ventana>
  )
}
