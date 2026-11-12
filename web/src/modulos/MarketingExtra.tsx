import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgePercent, Check, FileDown, FolderUp, Megaphone, Plus, Send, Trash2, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'

const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
type ItemPromo = { id: string; desc?: number | null; descPropuesto?: number | null; unidades?: number | null; nota?: string; ofertaId?: string }
type Camp = { id: string; codigo: string | null; nombre: string; inicio: string | null; fin: string | null; estado: string; items: ItemPromo[]; combos: unknown[]; preventa: boolean; comentario: string | null; historial: Hist[] }
const COLOR_P: Record<string, [string, string]> = { Borrador: ['#64748b', '#f1f5f9'], 'En aprobación': ['#a16207', '#fff8eb'], Devuelta: ['#c2410c', '#fff1e6'], Aprobada: ['#04896f', '#ecfaf5'], Rechazada: ['#c0392b', '#fdecea'], Cancelada: ['#64748b', '#f1f5f9'] }

export function Promociones({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [lista, setLista] = useState<Camp[] | null>(null)
  const [error, setError] = useState('')
  const [abierta, setAbierta] = useState<Camp | null>(null)
  const [nueva, setNueva] = useState(false)
  const crear = puede(perfil, 'marketing', 'crear'), aprobar = puede(perfil, 'marketing', 'aprobar')
  const cargar = useCallback(() => {
    supabase.from('promo_campanas').select('id,codigo,nombre,inicio,fin,estado,items,combos,preventa,comentario,historial').is('deleted_at', null).order('inicio', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) setError(error.message); else { setError(''); setLista((data as unknown as Camp[]) ?? []) } })
  }, [])
  useEffect(() => { cargar() }, [cargar])
  async function mover(c: Camp, estado: string, comentario?: string) {
    const h: Hist = { fecha: new Date().toISOString(), por: perfil.nombre, accion: estado, ...(comentario ? { comentario } : {}) }
    const cambios: Record<string, unknown> = { estado, historial: [...(c.historial ?? []), h], comentario: comentario ?? null }
    if (estado === 'En aprobación') cambios.enviado = new Date().toISOString()
    if (estado === 'Aprobada' || estado === 'Rechazada') { cambios.aprobado_por = perfil.id; cambios.fecha_aprobacion = new Date().toISOString() }
    const { error } = await supabase.from('promo_campanas').update(cambios).eq('id', c.id)
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    aviso('Campaña: ' + estado.toLowerCase() + '.'); setAbierta(null); cargar()
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
          <article key={c.id} className="card p-4 cursor-pointer hover:shadow-md" onClick={() => setAbierta(c)}>
            <div className="flex items-center gap-2"><BadgePercent className="w-4 h-4 text-[var(--amber)]" /><span className="font-mono-spec text-[11px] text-slate-400">{c.codigo}</span><span className="pill ml-auto" style={{ background: bg, color: col }}>{c.estado}</span></div>
            <p className="text-sm font-bold text-slate-800 mt-1.5">{c.nombre}</p>
            <p className="text-[11px] text-slate-500 mt-1">{fecha(c.inicio)} → {fecha(c.fin)}{c.preventa ? ' · Preventa' : ''}</p>
            <p className="text-[11px] text-slate-400">{(c.items ?? []).length} producto{(c.items ?? []).length === 1 ? '' : 's'} · {(c.combos ?? []).length} combo{(c.combos ?? []).length === 1 ? '' : 's'}</p>
          </article>) })}
      </div>
      {abierta && <DetalleCampana c={abierta} perfil={perfil} aprobar={aprobar} editar={crear} cerrar={() => setAbierta(null)} mover={mover} />}
      {nueva && <NuevaCampana perfil={perfil} cerrar={() => setNueva(false)} hecho={() => { setNueva(false); cargar(); aviso('Campaña creada.') }} aviso={aviso} />}
    </section>
  )
}

type ProdPromo = { codigo: string; nombre: string; categoria: string; pvp: number; costo: number | null; enCatalogo: boolean; desc: number; precioFinal: number; margen: number | null }
const ORDENES_PROMO: [string, string][] = [
  ['cat', 'Categoría (A-Z)'], ['costo', 'Costo (mayor a menor)'], ['desc', '% Descuento (mayor a menor)'],
  ['pvp', 'PVP (mayor a menor)'], ['margen', 'Margen (mayor a menor)'], ['nombre', 'Nombre (A-Z)'],
]

function DetalleCampana({ c, perfil, aprobar, editar, cerrar, mover }: { c: Camp; perfil: Perfil; aprobar: boolean; editar: boolean; cerrar: () => void; mover: (c: Camp, estado: string, comentario?: string) => void }) {
  const [com, setCom] = useState('')
  const verCostos = puede(perfil, 'promociones', 'ver_costos') || puede(perfil, 'ofertas', 'ver_costos')
  const [prods, setProds] = useState<ProdPromo[] | null>(null)
  const [orden, setOrden] = useState('cat')
  const [generando, setGenerando] = useState(false)
  const items = c.items ?? []

  useEffect(() => {
    if (!items.length) { setProds([]); return }
    let vivo = true
    const codigos = items.map((i) => i.id)
    ;(async () => {
      const { data: p, error } = await supabase.from('productos').select('id,codigo,nombre,pvp,en_catalogo,categoria:categorias(nombre)').in('codigo', codigos).is('deleted_at', null)
      if (!vivo) return
      if (error) { setProds([]); return }
      const prodRows = (p ?? []) as unknown as { id: string; codigo: string; nombre: string; pvp: number | null; en_catalogo: boolean | null; categoria: { nombre: string } | null }[]
      let costos: Record<string, number> = {}
      if (verCostos && prodRows.length) {
        const { data: co } = await supabase.from('productos_costos').select('producto_id,costo').in('producto_id', prodRows.map((x) => x.id)).is('deleted_at', null)
        costos = Object.fromEntries(((co ?? []) as { producto_id: string; costo: number | null }[]).map((x) => [x.producto_id, Number(x.costo) || 0]))
      }
      const porCodigo = new Map(prodRows.map((x) => [x.codigo, x]))
      const filas: ProdPromo[] = items.map((it) => {
        const p0 = porCodigo.get(it.id)
        const pvp = Number(p0?.pvp) || 0, desc = Number(it.desc) || 0, precioFinal = Math.round(pvp * (1 - desc / 100) * 100) / 100
        const costo = p0 && verCostos ? (costos[p0.id] ?? 0) : null
        const margen = costo != null && costo > 0 && precioFinal > 0 ? Math.round((precioFinal - costo) / precioFinal * 1000) / 10 : null
        return { codigo: it.id, nombre: p0?.nombre ?? it.id, categoria: p0?.categoria?.nombre ?? '—', pvp, costo, enCatalogo: !!p0?.en_catalogo, desc, precioFinal, margen }
      })
      setProds(filas)
    })()
    return () => { vivo = false }
  }, [items, verCostos])

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
      const cols: [string, number][] = verCostos
        ? [['Código', 22], ['Producto', 58], ['Categoría', 32], ['PVP', 18], ['Costo', 18], ['Desc %', 16], ['Final', 18], ['Margen', 14]]
        : [['Código', 24], ['Producto', 78], ['Categoría', 42], ['PVP', 20], ['Desc %', 18], ['Final', 20]]
      const porPagina = 34
      const totalPaginas = Math.max(1, Math.ceil(filas.length / porPagina))
      for (let pagina = 0; pagina < totalPaginas; pagina++) {
        if (pagina) doc.addPage()
        doc.setFillColor(11, 37, 69); doc.rect(0, 0, 210, 24, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('VIMEDIC', 12, 11); doc.setFontSize(9); doc.text('Promociones | ' + c.nombre, 12, 18)
        doc.setTextColor(100, 116, 139); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(`${fechaHoy} · ${filas.length} producto(s) · orden: ${ORDENES_PROMO.find(([v]) => v === orden)?.[1] ?? ''}`, 12, 30)
        let x = 12; const y0 = 38
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(11, 37, 69)
        cols.forEach(([t, w]) => { doc.text(t, x, y0); x += w })
        doc.setDrawColor(226, 232, 240); doc.line(12, y0 + 2, 198, y0 + 2)
        doc.setFont('helvetica', 'normal'); doc.setTextColor(51, 65, 85)
        const lote = filas.slice(pagina * porPagina, pagina * porPagina + porPagina)
        lote.forEach((f, i) => {
          const y = y0 + 7 + i * 6.8; x = 12
          const vals = verCostos
            ? [f.codigo, f.nombre.slice(0, 34), f.categoria.slice(0, 20), money(f.pvp), f.costo != null ? money(f.costo) : '—', f.desc + '%', money(f.precioFinal), f.margen != null ? f.margen + '%' : '—']
            : [f.codigo, f.nombre.slice(0, 46), f.categoria.slice(0, 26), money(f.pvp), f.desc + '%', money(f.precioFinal)]
          vals.forEach((v, k) => { doc.text(String(v), x, y); x += cols[k][1] })
        })
        doc.setFontSize(7); doc.setTextColor(148, 163, 184); doc.text(`${pagina + 1} / ${totalPaginas}`, 195, 290, { align: 'right' })
      }
      doc.save(`VIMEDIC-Promo-${(c.codigo || c.nombre).replace(/[^a-z0-9]+/gi, '-')}.pdf`)
    } catch (e) { alert((e as Error).message) }
    setGenerando(false)
  }

  return (
    <Ventana titulo={c.nombre} ancha cerrar={cerrar} pie={<>
      {editar && ['Borrador', 'Devuelta'].includes(c.estado) && <button className="btn btn-primary" onClick={() => mover(c, 'En aprobación')}><Send />Enviar a aprobación</button>}
      {aprobar && c.estado === 'En aprobación' && <>
        <button className="btn" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => mover(c, 'Rechazada', com.trim())}>Rechazar</button>
        <button className="btn" onClick={() => { if (!com.trim()) { alert('Escribe qué se debe corregir.'); return } mover(c, 'Devuelta', com.trim()) }}>Devolver</button>
        <button className="btn btn-primary" onClick={() => mover(c, 'Aprobada', com.trim())}><Check />Aprobar</button></>}
      {editar && ['Aprobada', 'Borrador'].includes(c.estado) && <button className="btn ml-auto" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => { if (confirm('¿Cancelar esta campaña?')) mover(c, 'Cancelada') }}><Trash2 />Cancelar campaña</button>}</>}>
      <p className="text-[11px] text-slate-500">{c.codigo} · {fecha(c.inicio)} → {fecha(c.fin)}{c.preventa ? ' · Preventa' : ''} · <b>{c.estado}</b></p>
      {c.comentario && <p className="text-xs rounded-lg p-2.5 bg-amber-50 text-amber-800">Comentario: {c.comentario}</p>}
      {aprobar && c.estado === 'En aprobación' && <textarea className="inp w-full" rows={2} placeholder="Comentario para quien envió la campaña" value={com} onChange={(e) => setCom(e.target.value)} />}

      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[11px] text-slate-500 mr-auto">{items.length} producto{items.length === 1 ? '' : 's'} en promoción.</p>
        <select className="inp" style={{ width: 'auto' }} value={orden} onChange={(e) => setOrden(e.target.value)}>{ORDENES_PROMO.map(([v, t]) => (!verCostos && (v === 'costo' || v === 'margen')) ? null : <option key={v} value={v}>{t}</option>)}</select>
        <button className="btn btn-sm" disabled={!filas.length || generando} onClick={exportarPdf}><FileDown className="w-3.5 h-3.5" />{generando ? 'Generando…' : 'Exportar PDF'}</button>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        {!prods && <p className="p-4 text-center text-xs text-slate-400">Cargando productos…</p>}
        {prods && !filas.length && <p className="p-4 text-center text-xs text-slate-400">Esta campaña todavía no tiene productos.</p>}
        {filas.length > 0 && (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>Producto</th><th>Categoría</th><th className="num">PVP</th>{verCostos && <th className="num">Costo</th>}<th className="num">Desc.</th><th className="num">Precio final</th>{verCostos && <th className="num">Margen</th>}</tr></thead>
            <tbody>{filas.map((f) => (
              <tr key={f.codigo}>
                <td><b className="text-slate-700">{f.nombre}</b><br /><span className="text-[10px] text-slate-400 font-mono-spec">{f.codigo}{!f.enCatalogo ? ' · No está en el catálogo' : ''}</span></td>
                <td className="text-slate-500">{f.categoria}</td>
                <td className="num">{money(f.pvp)}</td>
                {verCostos && <td className="num">{f.costo != null ? money(f.costo) : '—'}</td>}
                <td className="num font-semibold" style={{ color: f.desc ? 'var(--amber)' : undefined }}>{f.desc ? f.desc + '%' : '—'}</td>
                <td className="num font-semibold">{money(f.precioFinal)}</td>
                {verCostos && <td className="num">{f.margen != null ? f.margen + '%' : '—'}</td>}
              </tr>))}</tbody>
          </table></div>
        )}
      </div>

      <div><p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">Historial</p>
        {!(c.historial ?? []).length && <p className="text-[11px] text-slate-400">Sin movimientos.</p>}
        <ul className="space-y-1.5">{[...(c.historial ?? [])].reverse().map((h, i) => <li key={i} className="text-[11px] text-slate-600"><b>{h.accion}</b> · {h.por} · {new Date(h.fecha).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' })}{h.comentario ? ' — ' + h.comentario : ''}</li>)}</ul></div>
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
