import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Calculator, Download, ExternalLink, FileText, Layers, List, Package, Pencil, RefreshCw, Search, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { agrupar } from '../tiempoReal'
import { puede } from '../permisos'
import { imagen } from './Inventario'
import '../estilos/movimientos.css'

/* ============================ Tipos y utilidades ============================ */
type Mov = { id: string; codigo: string; fecha: string; tipo: string; cantidad: number; item: string; nombre: string; imagen: string; cliente: string; factura: string; facturaUrl: string; operacion: string; responsable: string; observacion: string; productoId: string | null; facturaId: string | null; ingresoId: string | null }
type Prod = { id: string; codigo: string; nombre: string; stock: number; imagen_url: string | null; categoria?: { nombre: string } | null; pvp?: number | null }
type Kpis = { n: number; ing: number; sal: number; productos: number }
const COLS = 'id,codigo,fecha,tipo,cantidad,item,nombre,imagen_url,cliente,factura,factura_url,operacion,responsable,observacion,producto_id,factura_id,ingreso_id'
const POR_PAGINA = 25
const num = (n: number) => (Number(n) || 0).toLocaleString('es-EC', { maximumFractionDigits: 2 })
const fFecha = (t: string) => { const d = new Date(t); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) }
const limpiar = (t: string) => t.replace(/[,()%*\\"']/g, ' ').trim()
const mapear = (x: Record<string, any>): Mov => ({ id: x.id, codigo: x.codigo ?? '', fecha: x.fecha, tipo: x.tipo ?? '', cantidad: Number(x.cantidad) || 0, item: x.item ?? '', nombre: x.nombre ?? '', imagen: x.imagen_url ?? '', cliente: x.cliente ?? '', factura: x.factura ?? '', facturaUrl: x.factura_url ?? '', operacion: x.operacion ?? '', responsable: x.responsable ?? '', observacion: x.observacion ?? '', productoId: x.producto_id ?? null, facturaId: x.factura_id ?? null, ingresoId: x.ingreso_id ?? null }) // eslint-disable-line @typescript-eslint/no-explicit-any
const Miniatura = ({ url, grande }: { url?: string | null; grande?: boolean }) => (
  <span className={'th ' + (grande ? 'th-lg' : '')}>{url ? <img loading="lazy" alt="" src={imagen(url, grande ? 160 : 80)} onError={(e) => e.currentTarget.remove()} /> : <Package />}</span>
)

/* ============================ Pantalla principal ============================ */
export default function Movimientos({ perfil, aviso, productoInicial, limpiarProductoInicial }: {
  perfil: Perfil; aviso: (t: string) => void; productoInicial?: string | null; limpiarProductoInicial?: () => void
}) {
  const [filas, setFilas] = useState<Mov[] | null>(null)
  const [total, setTotal] = useState(0)
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [qDeb, setQDeb] = useState('')
  const [tipo, setTipo] = useState('')
  const [prod, setProd] = useState<Prod | null>(null)
  const [resp, setResp] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [pagina, setPagina] = useState(1)
  const [responsables, setResponsables] = useState<string[]>([])
  const [saldos, setSaldos] = useState<Record<string, number>>({})
  const [detalle, setDetalle] = useState<Mov | null>(null)
  const [editar, setEditar] = useState<Mov | null>(null)
  const [stockModal, setStockModal] = useState<'confirmar' | 'trabajando' | { error: string } | { r: { productos: number; cambios: { id: string; nombre: string; antes: number; despues: number }[]; huerfanos: { item: string; neto: number }[] } } | null>(null)
  const [cargando, setCargando] = useState(false)
  const peticion = useRef(0)
  const puedeEditar = puede(perfil, 'movimientos', 'editar')

  // "Ver movimientos" desde la ficha de un producto en Inventario: llega con el código y filtra directo.
  useEffect(() => {
    if (!productoInicial) return
    supabase.from('productos').select('id,codigo,nombre,stock,imagen_url').eq('codigo', productoInicial).maybeSingle()
      .then(({ data }) => { if (data) { setProd(data as Prod); setPagina(1) } limpiarProductoInicial?.() })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoInicial])

  useEffect(() => { const t = setTimeout(() => { setQDeb(q); setPagina(1) }, 200); return () => clearTimeout(t) }, [q])
  useEffect(() => { supabase.from('v_movimientos').select('responsable').not('responsable', 'is', null).limit(5000).then(({ data }) => setResponsables([...new Set(((data ?? []) as { responsable: string }[]).map((x) => x.responsable).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')))) }, [])

  const aplicar = useCallback((c: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const w of limpiar(qDeb).split(/\s+/).filter(Boolean)) c = c.ilike('texto', `%${w}%`)
    if (tipo === 'in') c = c.gt('cantidad', 0); else if (tipo === 'out') c = c.lt('cantidad', 0)
    if (prod) c = c.eq('item', prod.codigo)
    if (resp) c = c.eq('responsable', resp)
    if (desde) c = c.gte('fecha', desde + 'T00:00:00-05:00')
    if (hasta) c = c.lte('fecha', hasta + 'T23:59:59-05:00')
    return c
  }, [qDeb, tipo, prod, resp, desde, hasta])

  const cargar = useCallback(async () => {
    const n = ++peticion.current
    setCargando(true)
    const base = supabase.from('v_movimientos').select(COLS, { count: 'exact' })
    const [lista, k] = await Promise.all([
      aplicar(base).order('fecha', { ascending: false }).order('created_at', { ascending: false }).range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
      supabase.rpc('mov_kpis', { p_q: limpiar(qDeb), p_tipo: tipo, p_item: prod?.codigo ?? '', p_resp: resp, p_desde: desde ? desde + 'T00:00:00-05:00' : null, p_hasta: hasta ? hasta + 'T23:59:59-05:00' : null }),
    ])
    if (n !== peticion.current) return
    setCargando(false)
    if (lista.error) { setError(lista.error.message); return }
    setError(''); setTotal(lista.count ?? 0)
    const f = ((lista.data ?? []) as Record<string, any>[]).map(mapear) // eslint-disable-line @typescript-eslint/no-explicit-any
    setFilas(f)
    if (k.data) setKpis(k.data as Kpis)
    if (prod && f.length) supabase.from('v_movimientos_saldo').select('id,saldo').in('id', f.map((x) => x.id)).then(({ data }) => setSaldos(Object.fromEntries(((data ?? []) as { id: string; saldo: number }[]).map((x) => [x.id, Number(x.saldo)]))))
    else setSaldos({})
  }, [aplicar, pagina, qDeb, tipo, prod, resp, desde, hasta])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => {
    const recargar = agrupar(() => cargar())
    const c = supabase.channel('mov-lista').on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos_inventario' }, recargar).subscribe()
    return () => { recargar.cancelar(); supabase.removeChannel(c) }
  }, [cargar])

  const totPag = Math.max(1, Math.ceil(total / POR_PAGINA))
  const nums: (number | '…')[] = []
  for (let i = 1; i <= totPag; i++) { if (i === 1 || i === totPag || Math.abs(i - pagina) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…') }
  const limpiarTodo = () => { setQ(''); setQDeb(''); setTipo(''); setProd(null); setResp(''); setDesde(''); setHasta(''); setPagina(1) }

  async function exportarCsv() {
    const { data, error } = await aplicar(supabase.from('v_movimientos').select(COLS)).order('fecha', { ascending: false }).limit(5000)
    if (error) { aviso('No se pudo exportar: ' + error.message); return }
    const cab = ['Fecha', 'Tipo', 'Item', 'Producto', 'Cantidad', 'Cliente', 'Factura', 'Operacion', 'Responsable', 'Observacion']
    const filasCsv = ((data ?? []) as Record<string, any>[]).map(mapear).map((r) => [fFecha(r.fecha), r.cantidad < 0 ? 'Salida' : 'Ingreso', r.item, r.nombre, r.cantidad, r.cliente, r.factura, r.operacion, r.responsable, r.observacion]) // eslint-disable-line @typescript-eslint/no-explicit-any
    const csv = [cab, ...filasCsv].map((f) => f.map((x) => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'movimientos.csv'; a.click()
  }
  async function recalcular() {
    setStockModal('trabajando')
    const { data, error } = await supabase.rpc('recalcular_stock_general')
    if (error) { setStockModal({ error: error.message }); return }
    setStockModal({ r: data as never }); cargar()
  }

  return (
    <div className="vm-mov">
      <header className="hdr text-white">
        <div className="max-w-[1500px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap vm-head-pad">
          <div className="min-w-0"><h1 className="font-display font-bold text-lg leading-tight">Movimientos de inventario</h1><p className="text-[11px] text-white/70">Ingresos y salidas de todos los productos · {perfil.nombre}{puedeEditar ? ' · puedes modificar' : ' · solo lectura'}</p></div>
          <div className="ml-auto flex gap-2">
            <button className="btn !bg-white/10 !border-white/20 !text-white" onClick={exportarCsv}><Download />CSV</button>
            {puedeEditar && <button className="btn !bg-amber-400 !border-amber-400 !text-slate-900" title="Recalcula el stock de los productos que tienen movimientos" onClick={() => setStockModal('confirmar')}><Calculator />Actualizar stock</button>}
            <button className="btn !bg-white/10 !border-white/20 !text-white" onClick={cargar}><RefreshCw className={cargando ? 'animate-spin' : ''} />Actualizar</button>
          </div>
        </div>
      </header>
      <main className="max-w-[1500px] mx-auto px-4 py-4 space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="kpi"><span>Movimientos</span><b>{kpis ? num(kpis.n) : '—'}</b></div>
          <div className="kpi"><span>Unidades ingresadas</span><b style={{ color: 'var(--teal)' }}>{kpis ? num(kpis.ing) : '—'}</b></div>
          <div className="kpi"><span>Unidades salidas</span><b style={{ color: 'var(--amber)' }}>{kpis ? num(kpis.sal) : '—'}</b></div>
          <div className="kpi"><span>Neto</span><b>{kpis ? (kpis.ing - kpis.sal > 0 ? '+' : '') + num(kpis.ing - kpis.sal) : '—'}</b></div>
          <div className="kpi"><span>Productos</span><b>{kpis ? num(kpis.productos) : '—'}</b></div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp w-full !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar item, producto, cliente, factura, operación, responsable…" /></div>
          <div className="seg">{([['', 'Todos'], ['in', 'Ingresos'], ['out', 'Salidas']] as const).map(([v, t]) => <button key={v} className={tipo === v ? 'on' : ''} onClick={() => { setTipo(v); setPagina(1) }}>{t}</button>)}</div>
          <SelectorProducto prod={prod} elegir={(p) => { setProd(p); setPagina(1) }} />
          <select className="inp" value={resp} onChange={(e) => { setResp(e.target.value); setPagina(1) }}><option value="">Todos los responsables</option>{responsables.map((r) => <option key={r}>{r}</option>)}</select>
          <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">Desde<input type="date" className="inp" value={desde} onChange={(e) => { setDesde(e.target.value); setPagina(1) }} /></label>
          <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">Hasta<input type="date" className="inp" value={hasta} onChange={(e) => { setHasta(e.target.value); setPagina(1) }} /></label>
          <button className="btn" onClick={limpiarTodo}>Limpiar</button>
        </div>

        {prod && (
          <div className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center gap-3 flex-wrap">
            <Miniatura url={prod.imagen_url} grande />
            <div className="min-w-0"><p className="text-sm font-bold text-slate-800">{prod.nombre}</p><p className="text-[11px] text-slate-500 mono">{prod.codigo}</p></div>
            <div className="ml-auto text-right"><p className="text-[10px] text-slate-500 font-semibold uppercase">Stock actual</p><p className="font-display font-bold text-xl text-[var(--navy)]">{num(prod.stock)}</p></div>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-330px)] min-h-[300px]">
            <table className="t">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Item</th><th>Producto</th><th>Cliente</th><th>Factura</th><th>Operación</th><th>Responsable</th><th className="text-right">Cant.</th>{prod && <th className="text-right">Acumulado</th>}<th /></tr></thead>
              <tbody>
                {error && <tr><td colSpan={11} className="text-center py-10 text-red-600 font-semibold">{error}</td></tr>}
                {!error && filas === null && <tr><td colSpan={11} className="text-center py-10 text-slate-400"><span className="spin" /> Cargando movimientos…</td></tr>}
                {filas && !filas.length && <tr><td colSpan={11} className="text-center py-10 text-slate-400">No hay movimientos con estos filtros.</td></tr>}
                {filas?.map((r) => {
                  const sal = r.cantidad < 0
                  return (
                    <tr key={r.id} className={'mvrow' + (detalle?.id === r.id ? ' sel' : '')} title="Ver todo el detalle" onClick={() => setDetalle(r)}>
                      <td className="mono text-[11px] whitespace-nowrap">{fFecha(r.fecha)}</td>
                      <td><span className={'pill ' + (sal ? 'pout' : 'pin')}>{sal ? 'Salida' : 'Ingreso'}</span></td>
                      <td className="mono text-[11px]"><span className="lnk" onClick={async (e) => { e.stopPropagation(); const { data } = await supabase.from('productos').select('id,codigo,nombre,stock,imagen_url').eq('codigo', r.item).maybeSingle(); if (data) { setProd(data as Prod); setPagina(1); window.scrollTo({ top: 0, behavior: 'smooth' }) } }}>{r.item}</span></td>
                      <td className="min-w-[220px]"><div className="flex items-start gap-2"><Miniatura url={r.imagen} /><div className="min-w-0">{r.nombre}{r.observacion && <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2" title={r.observacion}>{r.observacion}</p>}</div></div></td>
                      <td>{r.cliente || '—'}</td>
                      <td className="mono text-[11px]">{r.facturaUrl ? <a className="lnk" target="_blank" rel="noopener" href={r.facturaUrl} onClick={(e) => e.stopPropagation()}>{r.factura || 'Ver'}</a> : r.factura || '—'}</td>
                      <td className="mono text-[10.5px] text-slate-500">{r.operacion}</td><td>{r.responsable || '—'}</td>
                      <td className="text-right font-bold" style={{ color: sal ? 'var(--amber)' : 'var(--teal)' }}>{sal ? '' : '+'}{num(r.cantidad)}</td>
                      {prod && <td className="text-right font-semibold text-slate-600">{saldos[r.id] != null ? num(saldos[r.id]) : '…'}</td>}
                      <td className="text-right whitespace-nowrap">{puedeEditar && <button className="btn !py-1 !px-2" title="Modificar" onClick={(e) => { e.stopPropagation(); setEditar(r) }}><Pencil /></button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-100 text-[11px] text-slate-500">
            <span>{total ? `${num((pagina - 1) * POR_PAGINA + 1)}–${num((pagina - 1) * POR_PAGINA + (filas?.length ?? 0))} de ${num(total)} movimientos` : ''}</span>
            {totPag > 1 && <div className="pg ml-auto"><button disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} aria-label="Página anterior">‹</button>{nums.map((x, i) => (x === '…' ? <span key={'g' + i}>…</span> : <button key={x} className={x === pagina ? 'on' : ''} onClick={() => setPagina(x)}>{x}</button>))}<button disabled={pagina >= totPag} onClick={() => setPagina(pagina + 1)} aria-label="Página siguiente">›</button></div>}
          </div>
        </div>
      </main>

      <Detalle mov={detalle} puedeEditar={puedeEditar} cerrar={() => setDetalle(null)} editar={(m) => { setDetalle(null); setEditar(m) }} />
      {editar && <Editar mov={editar} perfil={perfil} cerrar={() => setEditar(null)} guardado={() => { setEditar(null); cargar() }} />}
      {stockModal && <ModalStock estado={stockModal} cerrar={() => setStockModal(null)} ejecutar={recalcular} />}
    </div>
  )
}

/* ============================ Buscador de producto con miniatura ============================ */
function SelectorProducto({ prod, elegir }: { prod: Prod | null; elegir: (p: Prod | null) => void }) {
  const [txt, setTxt] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [lista, setLista] = useState<Prod[]>([])
  const [sel, setSel] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { setTxt(prod ? prod.codigo : '') }, [prod])
  useEffect(() => {
    if (!abierto) return
    const t = setTimeout(() => {
      let c = supabase.from('productos').select('id,codigo,nombre,stock,imagen_url').is('deleted_at', null)
      for (const w of limpiar(txt === prod?.codigo ? '' : txt).split(/\s+/).filter(Boolean)) c = c.or(`nombre.ilike.%${w}%,codigo.ilike.%${w}%,codigo_unico.ilike.%${w}%`)
      c.order('en_vista_publica', { ascending: false }).order('nombre').limit(30).then(({ data }) => { setLista((data as Prod[]) ?? []); setSel(-1) })
    }, 150)
    return () => clearTimeout(t)
  }, [txt, abierto, prod])
  useEffect(() => { const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false) }; document.addEventListener('click', f); return () => document.removeEventListener('click', f) }, [])
  return (
    <div className="relative w-64" ref={ref}>
      <input className="inp w-full" value={txt} placeholder="Producto (código o nombre)" autoComplete="off" onFocus={() => setAbierto(true)}
        onChange={(e) => { setTxt(e.target.value); setAbierto(true); if (!e.target.value) elegir(null) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!lista.length) return; setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + lista.length) % lista.length) }
          else if (e.key === 'Enter') { e.preventDefault(); const p = lista[sel >= 0 ? sel : 0]; if (p) { elegir(p); setAbierto(false) } }
          else if (e.key === 'Escape') setAbierto(false)
        }} />
      {abierto && (
        <div className="pdd">
          {lista.length ? lista.map((p, i) => <button key={p.id} type="button" className={i === sel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); elegir(p); setAbierto(false) }}><Miniatura url={p.imagen_url} /><span className="min-w-0"><b>{p.nombre}</b><small className="mono">{p.codigo} · stock {num(p.stock)}</small></span></button>) : <div className="vac">Ningún producto coincide</div>}
        </div>
      )}
    </div>
  )
}

/* ============================ Detalle (panel derecho) ============================ */
type Bloque = { icono: typeof FileText; titulo: string; estado?: string; datos: [string, string][]; enlaces?: [string, string][] }
function Detalle({ mov, puedeEditar, cerrar, editar }: { mov: Mov | null; puedeEditar: boolean; cerrar: () => void; editar: (m: Mov) => void }) {
  const [d, setD] = useState<{ producto: Prod | null; bloques: Bloque[]; otros: Mov[] } | null>(null)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  useEffect(() => {
    if (!mov) { setD(null); return }
    let vivo = true
    setD(null)
    ;(async () => {
      type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
      const [p, f, ing, otros] = await Promise.all([
        mov.productoId ? supabase.from('productos').select('id,codigo,nombre,stock,imagen_url,pvp,categoria:categorias(nombre)').eq('id', mov.productoId).maybeSingle() : Promise.resolve({ data: null }),
        mov.facturaId ? supabase.from('facturas').select('codigo,numero_contifico,estado,total,fecha_facturacion,created_at,pdf_url,cliente:clientes(nombre)').eq('id', mov.facturaId).maybeSingle() : Promise.resolve({ data: null }),
        mov.ingresoId ? supabase.from('ingresos_proveedor').select('codigo,proveedor_texto,numero_factura,fecha_factura,total').eq('id', mov.ingresoId).maybeSingle() : Promise.resolve({ data: null }),
        mov.operacion ? supabase.from('v_movimientos').select(COLS).eq('operacion', mov.operacion).neq('id', mov.id).order('fecha', { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
      ])
      if (!vivo) return
      const bloques: Bloque[] = []
      const fa = f.data as R | null, ig = ing.data as R | null
      if (fa) bloques.push({ icono: FileText, titulo: 'Venta / Factura', estado: fa.estado, datos: [['Operación', fa.codigo], ['Cliente', fa.cliente?.nombre ?? ''], ['Factura', fa.numero_contifico ?? '—'], ['Fecha', fa.fecha_facturacion || fa.created_at?.slice(0, 10)], ['Total', '$' + num(Number(fa.total) || 0)]].filter((x) => x[1]) as [string, string][], enlaces: fa.pdf_url ? [['Factura PDF', fa.pdf_url]] : [] })
      if (ig) bloques.push({ icono: Package, titulo: 'Ingreso de mercadería', datos: [['Operación', ig.codigo], ['Proveedor', ig.proveedor_texto ?? ''], ['Factura proveedor', ig.numero_factura ?? ''], ['Fecha', ig.fecha_factura ?? ''], ['Total', '$' + num(Number(ig.total) || 0)]].filter((x) => x[1]) as [string, string][] })
      setD({ producto: (p.data as unknown as Prod) ?? null, bloques, otros: ((otros.data ?? []) as R[]).map(mapear) })
    })()
    return () => { vivo = false }
  }, [mov])
  const sal = (mov?.cantidad ?? 0) < 0
  const dl = (filas: [string, string][]) => <dl>{filas.map(([a, b]) => [<dt key={a + 't'}>{a}</dt>, <dd key={a + 'd'}>{b}</dd>])}</dl>
  return (
    <>
      <div className={'dv' + (mov ? ' on' : '')} onClick={cerrar} />
      <aside className={'dp' + (mov ? ' on' : '')} aria-hidden={!mov}>
        {mov && (
          <>
            <div className="dp-h">
              <button className="btn !bg-white/10 !border-white/20 !text-white !px-2" onClick={cerrar} aria-label="Cerrar"><X /></button>
              <div className="min-w-0 flex-1"><p className="font-display font-bold leading-tight truncate">{mov.nombre || mov.item}</p><p className="text-[11px] text-white/70 mono">{mov.item} · {mov.operacion || 'sin operación'}</p></div>
              <span className="text-xl font-bold" style={{ color: sal ? '#fcd34d' : '#6ee7b7' }}>{sal ? '' : '+'}{num(mov.cantidad)}</span>
            </div>
            <div className="dp-b">
              <div className="db"><div className="flex gap-3 items-center"><Miniatura url={mov.imagen} grande /><div className="min-w-0"><p className="font-bold text-slate-800">{mov.nombre}</p><p className="text-[12px] text-slate-500">{fFecha(mov.fecha)} · {mov.responsable}</p></div></div></div>
              {!d && <div className="text-center py-8 text-slate-400"><span className="spin" /> Buscando todo lo relacionado…</div>}
              {d && (
                <>
                  {d.producto ? (
                    <div className="db"><h4><Package />Producto</h4><div className="flex gap-3">{d.producto.imagen_url && <img src={imagen(d.producto.imagen_url, 200)} alt="" style={{ width: 84, height: 84, objectFit: 'contain', borderRadius: 12, border: '1px solid var(--line)', background: '#fff' }} />}
                      {dl([['Código', d.producto.codigo], ['Nombre', d.producto.nombre], ['Categoría', d.producto.categoria?.nombre ?? '—'], ['Stock actual', num(d.producto.stock)], ['PVP', d.producto.pvp ? '$' + Number(d.producto.pvp).toFixed(2) : '—']])}</div></div>
                  ) : (
                    <div className="db" style={{ borderColor: '#fcd34d', background: '#fffbeb' }}><h4><AlertTriangle />El Item no existe en Productos</h4><p className="text-[12.5px]">Este movimiento no suma a ningún producto. Corrige el Item con el lápiz.</p></div>
                  )}
                  {d.bloques.map((b) => { const I = b.icono; return (
                    <div key={b.titulo} className="db"><h4><I />{b.titulo}{b.estado && <span className="est">{b.estado}</span>}</h4>{dl(b.datos)}{(b.enlaces ?? []).map(([t, u]) => <a key={u} className="lk" target="_blank" rel="noopener" href={u}><ExternalLink style={{ width: 13, height: 13 }} />{t}</a>)}</div>) })}
                  {!d.bloques.length && <div className="db text-[12.5px] text-slate-500">No se encontraron venta ni importación con la operación <b>{mov.operacion || '—'}</b>. Es un movimiento manual o de una operación anterior al sistema.</div>}
                  <div className="db"><h4><List />Registro del movimiento</h4>{dl([['Código', mov.codigo], ['Tipo', mov.tipo], ['Cliente', mov.cliente], ['Factura', mov.factura], ['Responsable', mov.responsable], ['Observación', mov.observacion]].filter((x) => x[1]) as [string, string][])}</div>
                  {d.otros.length > 0 && <div className="db"><h4><Layers />Otros movimientos de la operación {mov.operacion}</h4><div className="tl">{d.otros.map((o) => <div key={o.id} className="py-1.5 text-[12.5px] flex gap-2"><span className="mono text-[11px] text-slate-400 w-[104px] shrink-0">{fFecha(o.fecha)}</span><span className="min-w-0 flex-1"><b>{o.item}</b> {o.nombre}<br /><span className="text-slate-500">{o.tipo} · {o.responsable}</span></span><b style={{ color: o.cantidad < 0 ? 'var(--amber)' : 'var(--teal)' }}>{o.cantidad < 0 ? '' : '+'}{num(o.cantidad)}</b></div>)}</div></div>}
                </>
              )}
              {puedeEditar && <button className="btn w-full" onClick={() => editar(mov)}><Pencil />Modificar este movimiento</button>}
            </div>
          </>
        )}
      </aside>
    </>
  )
}

/* ============================ Modificar movimiento ============================ */
function Editar({ mov, perfil, cerrar, guardado }: { mov: Mov; perfil: Perfil; cerrar: () => void; guardado: () => void }) {
  const [item, setItem] = useState(mov.item)
  const [nombreItem, setNombreItem] = useState('')
  const [encontrado, setEncontrado] = useState<Prod | null>(null)
  const [tipo, setTipo] = useState(mov.cantidad < 0 ? 'SALIDA' : 'INGRESO')
  const [cant, setCant] = useState(String(Math.abs(mov.cantidad)))
  const [cli, setCli] = useState(mov.cliente)
  const [fac, setFac] = useState(mov.factura)
  const [resp, setResp] = useState(mov.responsable)
  const [motivo, setMotivo] = useState('')
  const [err, setErr] = useState('')
  const [guardando, setGuardando] = useState(false)
  useEffect(() => {
    const cod = item.trim()
    if (!cod) { setEncontrado(null); setNombreItem(''); return }
    const t = setTimeout(() => supabase.from('productos').select('id,codigo,nombre,stock,imagen_url').ilike('codigo', cod).is('deleted_at', null).limit(1).then(({ data }) => { const p = (data as Prod[] | null)?.[0] ?? null; setEncontrado(p); setNombreItem(p ? p.nombre : 'No existe en Productos') }), 200)
    return () => clearTimeout(t)
  }, [item])
  async function guardar() {
    if (!encontrado) { setErr('Elige un item que exista en Productos.'); return }
    if (!(Number(cant) > 0)) { setErr('La cantidad debe ser mayor a 0.'); return }
    if (!motivo.trim()) { setErr('Escribe el motivo del cambio.'); return }
    setGuardando(true); setErr('')
    const nota = `[Modificado por ${perfil.nombre} el ${new Date().toLocaleDateString('es-EC')}: ${motivo.trim()}]`
    const { error } = await supabase.from('movimientos_inventario').update({
      tipo, cantidad: Number(cant), producto_id: encontrado.id, producto_codigo: encontrado.codigo, nombre: encontrado.nombre, cliente_texto: cli.trim() || null, factura_texto: fac.trim() || null,
      responsable_texto: resp.trim() || null, observacion: [mov.observacion, nota].filter(Boolean).join(' ').slice(0, 1000),
    }).eq('id', mov.id)
    if (error) { setGuardando(false); setErr(error.message); return }
    /* Mantiene el stock de los productos afectados (el anterior y el nuevo) */
    const afectados = new Set([mov.productoId, encontrado.id].filter(Boolean) as string[])
    await Promise.all([...afectados].map((p) => supabase.rpc('recalcular_stock_producto', { p_producto: p })))
    guardado()
  }
  return (
    <div className="ovl" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
        <div><h3 className="font-display font-bold text-sm text-[var(--navy)]">Modificar movimiento</h3><p className="text-[10px] text-slate-400 mono">{fFecha(mov.fecha)} · {mov.codigo || mov.id.slice(0, 8)}</p></div>
        <label className="block text-[11px] font-semibold text-slate-500">Item (producto)<input className="inp w-full mt-1 mono" value={item} onChange={(e) => setItem(e.target.value)} autoComplete="off" /><span className="block text-[10px] mt-0.5" style={{ color: encontrado ? '#94a3b8' : '#dc2626' }}>{nombreItem}</span></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] font-semibold text-slate-500">Tipo<select className="inp w-full mt-1" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="INGRESO">Ingreso</option><option value="SALIDA">Salida</option></select></label>
          <label className="text-[11px] font-semibold text-slate-500">Cantidad<input type="number" min={0} step="any" className="inp w-full mt-1" value={cant} onChange={(e) => setCant(e.target.value)} /></label>
        </div>
        <label className="block text-[11px] font-semibold text-slate-500">Cliente<input className="inp w-full mt-1" value={cli} onChange={(e) => setCli(e.target.value)} /></label>
        <label className="block text-[11px] font-semibold text-slate-500">Factura<input className="inp w-full mt-1" value={fac} onChange={(e) => setFac(e.target.value)} /></label>
        <label className="block text-[11px] font-semibold text-slate-500">Responsable<input className="inp w-full mt-1" value={resp} onChange={(e) => setResp(e.target.value)} /></label>
        <label className="block text-[11px] font-semibold text-slate-500">Motivo del cambio *<input className="inp w-full mt-1" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. producto equivocado" /></label>
        {err && <p className="text-[11px] text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1"><button className="btn" onClick={cerrar}>Cancelar</button><button className="btn btn-p" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button></div>
      </div>
    </div>
  )
}

/* ============================ Actualizar stock ============================ */
function ModalStock({ estado, cerrar, ejecutar }: { estado: NonNullable<ReturnType<typeof useStock>>; cerrar: () => void; ejecutar: () => void }) {
  const caja = (c: React.ReactNode) => <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={(e) => { if (e.target === e.currentTarget && estado !== 'trabajando') cerrar() }}><div style={{ background: '#fff', borderRadius: 16, maxWidth: 620, width: '100%', maxHeight: '86vh', overflow: 'auto', padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,.3)' }}>{c}</div></div>
  if (estado === 'confirmar') return caja(<><h3 className="font-bold text-lg mb-2">Actualizar stock de los productos</h3><p className="text-sm text-slate-600 mb-4">Se recalculará el stock de cada producto <b>que tenga movimientos</b>, sumando todos sus ingresos y salidas. Los productos sin movimientos no se tocan. Esto corrige los productos que muestran un stock distinto a sus movimientos.</p><div className="flex justify-end gap-2"><button className="btn" onClick={cerrar}>Cancelar</button><button className="btn btn-p" onClick={ejecutar}>Recalcular</button></div></>)
  if (estado === 'trabajando') return caja(<div className="text-center py-8"><span className="spin" /><p className="mt-3 font-semibold">Recalculando stock…</p><p className="text-xs text-slate-500">Puede tardar unos segundos.</p></div>)
  if ('error' in estado) return caja(<><h3 className="font-bold text-lg text-red-600 mb-2">No se pudo actualizar</h3><p className="text-sm">{estado.error}</p><div className="text-right mt-4"><button className="btn" onClick={cerrar}>Cerrar</button></div></>)
  const { cambios: c, huerfanos: h, productos } = estado.r
  return caja(<>
    <h3 className="font-bold text-lg mb-1">Stock actualizado</h3><p className="text-sm text-slate-600 mb-3">{productos} productos revisados · <b>{c.length}</b> con stock corregido.</p>
    {c.length > 0 ? <table className="w-full text-sm mb-3"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Código</th><th>Producto</th><th className="text-right">Antes</th><th className="text-right">Ahora</th></tr></thead><tbody>{c.map((x) => <tr key={x.id} className="border-t"><td className="py-1 font-mono text-xs">{x.id}</td><td>{x.nombre}</td><td className="text-right text-slate-400">{x.antes}</td><td className="text-right font-bold">{x.despues}</td></tr>)}</tbody></table>
      : <p className="text-sm text-emerald-700 font-semibold mb-3">Todo cuadraba: ningún producto necesitó corrección.</p>}
    {h.length > 0 && <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm mb-3"><b>Movimientos con un Item que no existe en Productos:</b> {h.map((x) => `${x.item} (${x.neto})`).join(', ')}<br /><span className="text-xs text-slate-600">Corrige el Item de esos movimientos con el lápiz para que sumen al producto correcto.</span></div>}
    <div className="text-right"><button className="btn btn-p" onClick={cerrar}>Listo</button></div></>)
}
type StockEstado = 'confirmar' | 'trabajando' | { error: string } | { r: { productos: number; cambios: { id: string; nombre: string; antes: number; despues: number }[]; huerfanos: { item: string; neto: number }[] } } | null
declare function useStock(): StockEstado
void useMemo
