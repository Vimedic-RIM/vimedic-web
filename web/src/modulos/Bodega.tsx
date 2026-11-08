import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Barcode, Calendar, Camera, Check, CheckCheck, Columns3, Download, ImageUp, Inbox, List, MinusCircle, Package, PackageCheck, Play, PlayCircle, RefreshCw, RotateCcw, Save, ScanLine, ScanSearch, Search, Send, ShieldCheck, Split, Truck, Upload, Video, Warehouse, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import '../estilos/bodega.css'

/* ============================ Tipos ============================ */
type Linea = { key: string; id: string; nombre: string; cantidad: number; requiereSerie: boolean; observacion: string; despachado: number }
type Evid = { url: string; tipo: 'foto' | 'video'; etiqueta: string; fecha: string; por: string }
type Nov = { id: string; tipo: string; detalle: string; foto: string; fecha: string; por: string; resuelta: boolean; resolucion?: string; resueltaPor?: string; fechaResolucion?: string }
type Envio = { n: number; fecha: string; por: string; cantidades: Record<string, number>; series: Record<string, string[]>; fotos: string[]; nota: string }
type Hist = { fecha: string; por: string; nota: string }
type Entrega = Record<string, string>
type Despacho = {
  id: string; codigo: string; operacion: string; fecha: string; empresa: string; cliente: string; identificacion: string; telefono: string; asesor: string
  factura: string; facturaUrl: string; entrega: Entrega; productos: Linea[]; series: Record<string, string[]>; evidencias: Evid[]; novedades: Nov[]; envios: Envio[]
  estado: string; preparadoPorId: string | null; preparadoPor: string; verificadoPorId: string | null; verificadoPor: string; despachadoPor: string
  fechaDespacho: string; historial: Hist[]; actualizado: string
}
const TIPOS_NOVEDAD = ['Falta stock', 'Producto dañado', 'La serie no coincide', 'Falta un accesorio', 'Dirección incompleta', 'Cliente pidió un cambio', 'Otro']
const COLS_DB = 'id,codigo,operacion_codigo,fecha,empresa,cliente_texto,identificacion,telefono,factura_texto,factura_url,estado,entrega,productos,series,evidencias,novedades,envios,historial,preparado_por,verificado_por,fecha_despacho,updated_at,asesor:empleados!despachos_asesor_id_fkey(nombre),preparador:empleados!despachos_preparado_por_fkey(nombre),verificador:empleados!despachos_verificado_por_fkey(nombre),despachador:empleados!despachos_despachado_por_fkey(nombre)'
const TABS: [string, string][] = [['pendientes', 'Por despachar'], ['novedad', 'Con novedad'], ['despachados', 'Despachados'], ['todos', 'Todos']]
const ORDEN: Record<string, number> = { 'Por preparar': 0, 'En preparación': 1, 'Lista': 2, 'Parcial': 3, 'Despachada': 4 }
const COLS: { k: string; t: string; ic: typeof Inbox }[] = [
  { k: 'Por preparar', t: 'Por preparar', ic: Inbox }, { k: 'En preparación', t: 'En preparación', ic: ScanLine }, { k: 'Lista', t: 'Listos para despachar', ic: PackageCheck },
  { k: 'Parcial', t: 'Despacho parcial', ic: Split }, { k: 'Despachada', t: 'Despachados · 7 días', ic: Truck },
]

/* ============================ Utilidades ============================ */
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const slug = (v: string) => norm(v).replace(/[^a-z0-9]/g, '')
const fecha = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) }
const dias = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? 0 : Math.floor((Date.now() - d.getTime()) / 86400000) }
const hoyYmd = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const obj = <T,>(v: unknown): T => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : ({} as T))
const driveId = (u: string) => { const m = u.match(/\/d\/([-\w]{20,})/) || u.match(/[?&]id=([-\w]{20,})/); return m ? m[1] : '' }
const esRuta = (u: string) => !/^https?:/i.test(u)
const nombreCorto = (a: string) => String(a || '').split(' (')[0]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapear = (x: any): Despacho => ({
  id: x.id, codigo: x.codigo ?? '', operacion: x.operacion_codigo ?? '', fecha: x.fecha, empresa: x.empresa ?? '', cliente: x.cliente_texto ?? '', identificacion: x.identificacion ?? '', telefono: x.telefono ?? '',
  asesor: x.asesor?.nombre ?? '', factura: x.factura_texto ?? '', facturaUrl: x.factura_url ?? '', entrega: obj<Entrega>(x.entrega), productos: arr<Linea>(x.productos), series: obj<Record<string, string[]>>(x.series),
  evidencias: arr<Evid>(x.evidencias), novedades: arr<Nov>(x.novedades), envios: arr<Envio>(x.envios), estado: x.estado, preparadoPorId: x.preparado_por ?? null, preparadoPor: x.preparador?.nombre ?? '',
  verificadoPorId: x.verificado_por ?? null, verificadoPor: x.verificador?.nombre ?? '', despachadoPor: x.despachador?.nombre ?? '', fechaDespacho: x.fecha_despacho ?? '', historial: arr<Hist>(x.historial), actualizado: x.updated_at ?? '',
})
function resumen(d: Despacho) {
  let unidades = 0, despachadas = 0, faltanSeries = 0
  d.productos.forEach((p) => { unidades += p.cantidad; despachadas += p.despachado || 0; if (p.requiereSerie) faltanSeries += Math.max(0, p.cantidad - arr<string>(d.series[p.key]).filter(Boolean).length) })
  return { unidades, despachadas, faltanSeries, fotos: d.evidencias.length, novedades: d.novedades.filter((n) => !n.resuelta).length }
}
function fEntrega(d: Despacho) {
  const v = String(d.entrega.fechaEntrega || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || d.estado === 'Despachada') return null
  const h = hoyYmd()
  return { v, cls: v < h ? 'urg' : v === h ? 'prox' : '', txt: v < h ? 'Atrasado · ' + v.slice(8) + '/' + v.slice(5, 7) : v === h ? 'Entregar hoy' : 'Entregar ' + v.slice(8) + '/' + v.slice(5, 7) }
}
const atrasado = (d: Despacho) => d.estado !== 'Despachada' && (dias(d.fecha) >= 2 || fEntrega(d)?.cls === 'urg')
const despHoy = (d: Despacho) => d.estado === 'Despachada' && !!d.fechaDespacho && d.fechaDespacho.slice(0, 10) === new Date().toISOString().slice(0, 10)
const enTab = (d: Despacho, t: string) => (t === 'pendientes' ? d.estado !== 'Despachada' : t === 'novedad' ? resumen(d).novedades > 0 : t === 'despachados' ? d.estado === 'Despachada' : true)
const lsGet = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sin almacenamiento */ } }

/** Reduce la foto a 1600 px y la convierte a JPEG antes de subirla. */
function reducir(file: File): Promise<Blob> {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file), img = new Image()
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas')
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url)
      c.toBlob((b) => (b ? ok(b) : fail(new Error('No se pudo procesar la foto.'))), 'image/jpeg', 0.82)
    }
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('No se pudo leer la foto.')) }
    img.src = url
  })
}
const nota = (d: Despacho, por: string, texto: string): Hist[] => [...d.historial, { fecha: new Date().toISOString(), por, nota: texto.slice(0, 500) }].slice(-200)
const faltanSeriesMsg = (d: Despacho): string => {
  for (const p of d.productos) {
    if (!p.requiereSerie) continue
    const tiene = arr<string>(d.series[p.key]).filter(Boolean).length, nec = p.cantidad
    if (tiene < nec) return `Faltan series de "${p.nombre}": ${tiene} de ${nec}.`
  }
  return ''
}

/* ============================ Pantalla principal ============================ */
export default function Bodega({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [lista, setLista] = useState<Despacho[] | null>(null)
  const [error, setError] = useState('')
  const [vista, setVista] = useState<'tablero' | 'lista'>(() => lsGet('bd:vista') || (window.innerWidth < 768 ? 'lista' : 'tablero'))
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('pendientes')
  const [kpi, setKpi] = useState('')
  const [verTodosDesp, setVerTodosDesp] = useState(false)
  const [abierto, setAbierto] = useState<{ id: string; despachar?: boolean } | null>(null)
  const [hoja, setHoja] = useState<'serie' | 'traer' | null>(null)
  const [mov, setMov] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const tableroRef = useRef<HTMLDivElement>(null)
  const editar = puede(perfil, 'bodega', 'editar')

  const cargar = useCallback(async () => {
    const limite = new Date(Date.now() - 60 * 86400000).toISOString()
    const { data, error } = await supabase.from('despachos').select(COLS_DB).is('deleted_at', null).or(`estado.neq.Despachada,fecha_despacho.gte.${limite},fecha_despacho.is.null`).order('fecha', { ascending: true }).limit(600)
    if (error) { setError(error.message); return }
    setError(''); setLista((data ?? []).map(mapear))
  }, [])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => {
    const c = supabase.channel('bodega-lista').on('postgres_changes', { event: '*', schema: 'public', table: 'despachos' }, () => cargar()).subscribe()
    return () => { supabase.removeChannel(c) }
  }, [cargar])
  useEffect(() => { lsSet('bd:vista', vista) }, [vista])

  const L = lista ?? []
  const filtrados = useMemo(() => {
    const w = norm(q).trim().split(/\s+/).filter(Boolean)
    return L.filter((d) => {
      if (w.length) {
        const s = Object.values(d.series).map((a) => arr<string>(a).join(' ')).join(' ')
        const t = norm([d.cliente, d.factura, d.codigo, d.productos.map((p) => p.nombre).join(' '), s, d.asesor, d.entrega.ciudad].join(' '))
        if (!w.every((x) => t.includes(x))) return false
      }
      if (!kpi) return true
      return kpi === 'nov' ? resumen(d).novedades > 0 : kpi === 'atr' ? atrasado(d) : kpi === 'hoy' ? despHoy(d) : d.estado === kpi
    })
  }, [L, q, kpi])

  /* Acciones rápidas desde la tarjeta */
  async function actualizar(d: Despacho, campos: Record<string, unknown>, texto: string) {
    const { error } = await supabase.from('despachos').update({ ...campos, historial: nota(d, perfil.nombre, texto) }).eq('id', d.id).eq('updated_at', d.actualizado)
    if (error) throw new Error(error.message)
  }
  async function transicion(d: Despacho, a: 'iniciar' | 'lista' | 'verificar' | 'reabrir') {
    if (a === 'iniciar') {
      if (d.estado !== 'Por preparar') throw new Error('Ya está en preparación.')
      return actualizar(d, { estado: 'En preparación', preparado_por: perfil.id, inicio_preparacion: new Date().toISOString() }, 'Inició la preparación.')
    }
    if (a === 'lista') {
      const f = faltanSeriesMsg(d); if (f) throw new Error(f)
      return actualizar(d, { estado: 'Lista', ...(d.preparadoPorId ? {} : { preparado_por: perfil.id }) }, 'Marcó el pedido como listo para despachar.')
    }
    if (a === 'verificar') {
      if (d.preparadoPorId && d.preparadoPorId === perfil.id) throw new Error('La verificación la hace una persona distinta a quien preparó.')
      return actualizar(d, { verificado_por: perfil.id }, 'Verificó el pedido (doble control).')
    }
    if (d.estado === 'Despachada') throw new Error('Ya fue despachado.')
    return actualizar(d, { estado: 'En preparación', verificado_por: null }, 'Volvió a preparación.')
  }
  const MSG = { iniciar: 'Preparación iniciada', lista: 'Listo para despachar', verificar: 'Verificado', reabrir: 'Volvió a preparación' }
  async function rapida(id: string, a: 'iniciar' | 'lista' | 'verificar' | 'reabrir' | 'abrir' | 'despachar') {
    const d = L.find((x) => x.id === id); if (!d) return
    if (a === 'abrir') { setAbierto({ id }); return }
    if (a === 'despachar') { setAbierto({ id, despachar: true }); return }
    setMov(id)
    try { await transicion(d, a); aviso(MSG[a]); await cargar() } catch (e) { const m = (e as Error).message; aviso(m); if (/series/i.test(m)) setAbierto({ id }) }
    setMov(null)
  }
  async function mover(id: string, destino: string) {
    const d = L.find((x) => x.id === id); if (!d || d.estado === destino) return
    const de = d.estado
    if (destino === 'Despachada' || destino === 'Parcial') { setAbierto({ id, despachar: true }); return }
    if (destino === 'En preparación' && de === 'Por preparar') return rapida(id, 'iniciar')
    if (destino === 'Lista' && (de === 'En preparación' || de === 'Parcial')) return rapida(id, 'lista')
    if (destino === 'Lista' && de === 'Por preparar') {
      setMov(id)
      try { await transicion(d, 'iniciar'); const { data } = await supabase.from('despachos').select(COLS_DB).eq('id', id).single(); await transicion(mapear(data), 'lista'); aviso('Listo para despachar') } catch (e) { const m = (e as Error).message; aviso(m); if (/series/i.test(m)) setAbierto({ id }) }
      setMov(null); cargar(); return
    }
    if (destino === 'En preparación' && de === 'Lista') return rapida(id, 'reabrir')
    if (destino === 'Por preparar') { aviso('Un despacho iniciado no vuelve a "Por preparar".'); return }
    aviso(`No se puede mover de "${de}" a "${destino}".`)
  }

  /* KPIs */
  const cnt = (k: string) => L.filter((d) => d.estado === k).length
  const K: [string, string, number, string][] = [['Por preparar', 'Por preparar', cnt('Por preparar'), ''], ['En preparación', 'En preparación', cnt('En preparación'), ''], ['Lista', 'Listos', cnt('Lista'), 'ok'],
    ['nov', 'Con novedad', L.filter((d) => resumen(d).novedades > 0 && d.estado !== 'Despachada').length, 'rj'], ['atr', 'Atrasados', L.filter(atrasado).length, 'am'], ['hoy', 'Despachados hoy', L.filter(despHoy).length, 'ok']]
  const limite7 = Date.now() - 7 * 864e5

  const Pills = ({ d }: { d: Despacho }) => {
    const n = resumen(d).novedades
    return <>{n > 0 && <span className="pill s-novedad"><AlertTriangle style={{ width: 11, height: 11 }} />{n} novedad{n > 1 ? 'es' : ''}</span>}{d.empresa === 'FEMEDICS' && <span className="pill fm">Femedics</span>}{d.verificadoPorId && <span className="pill" style={{ background: '#eef2ff', color: '#4338ca' }}><ShieldCheck style={{ width: 11, height: 11 }} />Verificado</span>}</>
  }
  const Meta = ({ d }: { d: Despacho }) => {
    const r = resumen(d), fe = fEntrega(d), atraso = d.estado !== 'Despachada' ? dias(d.fecha) : 0
    return (
      <div className="kb-meta">
        {d.entrega.entrega && <span><Truck />{d.entrega.entrega}{d.entrega.ciudad ? ' · ' + d.entrega.ciudad : ''}</span>}
        <span><Package />{r.despachadas}/{r.unidades}</span>
        {r.faltanSeries > 0 && d.estado !== 'Despachada' ? <span className="prox"><Barcode />Faltan {r.faltanSeries} series</span> : d.estado !== 'Despachada' && d.estado !== 'Por preparar' ? <span style={{ color: 'var(--teal)' }}><Barcode />Series ok</span> : null}
        <span className={d.estado !== 'Despachada' && d.estado !== 'Por preparar' && !r.fotos ? 'prox' : ''}><Camera />{r.fotos}</span>
        {fe && <span className={fe.cls}><Calendar />{fe.txt}</span>}
        <span className={atraso >= 2 ? 'urg' : ''} style={{ marginLeft: 'auto' }}>{d.estado === 'Despachada' ? 'Salió ' + fecha(d.fechaDespacho) : atraso ? `Hace ${atraso} día${atraso > 1 ? 's' : ''}` : 'Hoy'}</span>
      </div>
    )
  }
  const Acciones = ({ d }: { d: Despacho }) => {
    const r = resumen(d)
    const b = (a: Parameters<typeof rapida>[1], txt: string, I: typeof Play, cls = '') => <button key={a} className={'btn ' + cls} onClick={(e) => { e.stopPropagation(); rapida(d.id, a) }}><I />{txt}</button>
    if (!editar) return null
    if (d.estado === 'Por preparar') return <div className="kb-acc">{b('iniciar', 'Iniciar', Play, 'btn-p')}</div>
    if (d.estado === 'En preparación') return <div className="kb-acc">{b('abrir', r.faltanSeries ? 'Series' : 'Abrir', ScanLine)}{!r.faltanSeries && b('lista', 'Lista', CheckCheck, 'btn-p')}</div>
    if (d.estado === 'Lista') return <div className="kb-acc">{!d.verificadoPorId && b('verificar', 'Verificar', ShieldCheck)}{b('despachar', 'Despachar', Send, 'btn-ok')}</div>
    if (d.estado === 'Parcial') return <div className="kb-acc">{b('despachar', 'Despachar resto', Send, 'btn-ok')}</div>
    return null
  }
  const Columna = ({ c }: { c: (typeof COLS)[number] }) => {
    let ds = filtrados.filter((d) => d.estado === c.k), extra = 0
    if (c.k === 'Despachada') { ds = [...ds].sort((a, b) => b.fechaDespacho.localeCompare(a.fechaDespacho)); const rec = ds.filter((d) => new Date(d.fechaDespacho).getTime() >= limite7); extra = ds.length - rec.length; ds = verTodosDesp ? ds : rec }
    else ds = [...ds].sort((a, b) => Number(resumen(b).novedades > 0) - Number(resumen(a).novedades > 0) || (fEntrega(a)?.v ?? '9').localeCompare(fEntrega(b)?.v ?? '9') || a.fecha.localeCompare(b.fecha))
    const I = c.ic
    return (
      <section className={'kb-col' + (sobre === c.k ? ' drop' : '')} data-col={c.k}
        onDragOver={(e) => { if (!arrastrando) return; e.preventDefault(); setSobre(c.k) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre(null) }}
        onDrop={(e) => { e.preventDefault(); setSobre(null); const id = arrastrando; setArrastrando(null); if (id && editar) mover(id, c.k) }}>
        <div className="kb-h"><I />{c.t}<span className="c">{ds.length}</span></div>
        <div className="kb-b">
          {ds.length ? ds.map((d) => (
            <article key={d.id} className={'kb-card' + (resumen(d).novedades ? ' nov' : '') + (arrastrando === d.id ? ' drag' : '') + (mov === d.id ? ' mov' : '')} draggable={editar && d.estado !== 'Despachada'}
              onDragStart={(e) => { setArrastrando(d.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', d.id) } catch { /* nada */ } }} onDragEnd={() => { setArrastrando(null); setSobre(null) }}
              onClick={() => setAbierto({ id: d.id })}>
              <div className="flex items-center gap-1 flex-wrap mb-1.5"><Pills d={d} /><span className="ml-auto text-[10px] text-slate-400 mono">{d.codigo}</span></div>
              <p className="t">{d.cliente || 'Cliente'}</p><p className="s">Factura {d.factura || '—'}{d.asesor ? ' · ' + nombreCorto(d.asesor) : ''}</p>
              <p className="s line-clamp-2" style={{ color: '#475569' }}>{d.productos.map((p) => p.nombre).join(' · ').slice(0, 200)}</p>
              <Meta d={d} /><Acciones d={d} />
            </article>
          )) : <div className="kb-vacio">{c.k === 'Por preparar' ? 'Las ventas llegan solas al facturar.' : 'Arrastra aquí'}</div>}
          {c.k === 'Despachada' && (extra > 0 || verTodosDesp) && <button className="kb-mas" onClick={() => setVerTodosDesp(!verTodosDesp)}>{verTodosDesp ? 'Ver solo los últimos 7 días' : `Ver ${extra} más antiguos`}</button>}
        </div>
      </section>
    )
  }

  let listaVista = filtrados.filter((d) => enTab(d, tab))
  listaVista = [...listaVista].sort((a, b) => Number(resumen(b).novedades > 0) - Number(resumen(a).novedades > 0) || (tab === 'despachados' ? b.fechaDespacho.localeCompare(a.fechaDespacho) : (ORDEN[a.estado] - ORDEN[b.estado]) || a.fecha.localeCompare(b.fecha)))

  return (
    <div className="vm-bod">
      <header className="hdr text-white">
        <div className="w-full px-4 lg:px-6 py-3 flex items-center gap-3 flex-wrap vm-head-pad">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><Warehouse style={{ width: 20, height: 20 }} /></div>
          <div className="min-w-0"><h1 className="font-display font-bold text-lg leading-tight">Bodega</h1><p className="text-[11px] text-white/70">Despacho de ventas facturadas · {perfil.nombre}</p></div>
          <div className="ml-auto flex gap-2">
            <button className="btn btn-sm !bg-white/10 !border-white/20 !text-white" title="Buscar número de serie" onClick={() => setHoja('serie')}><ScanSearch /><span className="hidden sm:inline">Buscar serie</span></button>
            {editar && <button className="btn btn-sm !bg-white/10 !border-white/20 !text-white" title="Traer facturas anteriores" onClick={() => setHoja('traer')}><Download /><span className="hidden sm:inline">Traer facturas</span></button>}
            <button className="btn btn-sm !bg-white/10 !border-white/20 !text-white" title="Actualizar" onClick={cargar}><RefreshCw /></button>
          </div>
        </div>
      </header>
      <main className="w-full px-4 lg:px-6 py-4 space-y-3">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="vista"><button className={vista === 'tablero' ? 'on' : ''} onClick={() => setVista('tablero')}><Columns3 />Tablero</button><button className={vista === 'lista' ? 'on' : ''} onClick={() => setVista('lista')}><List />Lista</button></div>
          <div className="relative flex-1 min-w-[220px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp !pl-9" placeholder="Buscar cliente, factura, producto o número de serie…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <div className="kpis">
          {K.map(([k, t, n, c], i) => <div key={k} className={`kpi ${c}${i < 3 && vista === 'tablero' ? ' est' : ''}`} onClick={() => setKpi(kpi === k ? '' : k)} style={kpi === k ? { borderColor: 'var(--navy)', boxShadow: '0 0 0 2px rgba(11,37,69,.15)' } : undefined}><b>{n}</b><span>{t}</span></div>)}
          {kpi && <button className="btn btn-sm" onClick={() => setKpi('')}><X />Quitar filtro</button>}
        </div>
        {error && <div className="text-center py-14"><p className="text-red-600 font-semibold">{error}</p><button className="btn btn-p mt-3" onClick={cargar}><RefreshCw />Reintentar</button></div>}
        {!error && lista === null && <div className="text-center py-14 text-slate-400 w-full"><span className="spin" /> Cargando despachos…</div>}
        {!error && lista && vista === 'tablero' && (
          <>
            <div className="kb-salto">{COLS.map((c) => <button key={c.k} className="tab" onClick={() => { const el = tableroRef.current?.querySelector<HTMLElement>(`[data-col="${c.k}"]`); if (el) tableroRef.current?.scrollTo({ left: el.offsetLeft - 16, behavior: 'smooth' }) }}>{c.t.split(' ·')[0]}<b>{filtrados.filter((d) => d.estado === c.k && (c.k !== 'Despachada' || verTodosDesp || new Date(d.fechaDespacho).getTime() >= limite7)).length}</b></button>)}</div>
            <div className="kb" ref={tableroRef}>{COLS.map((c) => <Columna key={c.k} c={c} />)}</div>
          </>
        )}
        {!error && lista && vista === 'lista' && (
          <>
            <div className="tabs">{TABS.map(([k, t]) => <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{t}<b>{filtrados.filter((d) => enTab(d, k)).length}</b></button>)}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {!listaVista.length && <div className="col-span-full text-center py-14 text-slate-400"><Package className="mx-auto mb-2" style={{ width: 34, height: 34 }} /><p className="font-semibold text-slate-500">{L.length ? 'Nada en esta vista.' : 'Aún no hay despachos.'}</p><p className="text-xs mt-1">Las ventas llegan aquí solas cuando Facturación sube la factura.</p></div>}
              {listaVista.map((d) => (
                <div key={d.id} className={'card' + (resumen(d).novedades ? ' nov' : '')} onClick={() => setAbierto({ id: d.id })}>
                  <div className="flex items-center gap-1.5 flex-wrap mb-2"><span className={'pill s-' + slug(d.estado)}>{d.estado}</span><Pills d={d} /><span className="ml-auto text-[10px] text-slate-400 mono">{d.codigo}</span></div>
                  <p className="font-bold text-[15px] text-slate-800 leading-snug">{d.cliente || 'Cliente'}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Factura {d.factura || '—'}{d.asesor ? ' · ' + nombreCorto(d.asesor) : ''}</p>
                  <p className="text-xs text-slate-600 mt-1.5 line-clamp-2">{d.productos.map((p) => p.nombre).join(' · ').slice(0, 200)}</p><Meta d={d} />
                </div>
              ))}
            </div>
          </>
        )}
      </main>
      {abierto && <Panel id={abierto.id} despacharAlAbrir={abierto.despachar} perfil={perfil} editar={editar} aviso={aviso} cerrar={() => { setAbierto(null); cargar() }} cambio={cargar} />}
      {hoja === 'serie' && <BuscarSerie cerrar={() => setHoja(null)} ver={(id) => { setHoja(null); setAbierto({ id }) }} />}
      {hoja === 'traer' && <TraerFacturas cerrar={() => setHoja(null)} aviso={aviso} hecho={cargar} />}
    </div>
  )
}

/* ============================ Hoja inferior / modal ============================ */
function Hoja({ cerrar, children }: { cerrar: () => void; children: React.ReactNode }) {
  return <div className="ovl" onClick={cerrar}><div className="sheet" onClick={(e) => e.stopPropagation()}>{children}</div></div>
}
const Ocupado = () => <span className="spin" />

function BuscarSerie({ cerrar, ver }: { cerrar: () => void; ver: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<{ serie: string; producto: string; codigo: string; despacho: string; despacho_id: string; cliente: string; factura: string; estado: string; fecha: string }[] | null>(null)
  const [err, setErr] = useState('')
  const [buscando, setBuscando] = useState(false)
  async function buscar() {
    if (q.trim().length < 3) { setErr('Escribe al menos 3 caracteres de la serie.'); return }
    setBuscando(true); setErr('')
    const { data, error } = await supabase.rpc('bodega_buscar_serie', { p_q: q })
    setBuscando(false)
    if (error) { setErr(error.message); return }
    setRes((data ?? []) as never)
  }
  return (
    <Hoja cerrar={cerrar}>
      <h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">Buscar número de serie</h3>
      <div className="flex gap-2"><input className="inp mono" placeholder="Serie (mín. 3 caracteres)" autoCapitalize="characters" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') buscar() }} autoFocus /><button className="btn btn-p" onClick={buscar}><Search /></button></div>
      <div className="mt-3 space-y-2">
        {buscando && <span className="spin" />}
        {err && <p className="text-sm text-red-600">{err}</p>}
        {res && !buscando && !res.length && <p className="text-sm text-slate-500">No se encontró esa serie.</p>}
        {!buscando && res?.map((x, i) => (
          <div key={i} className="border border-slate-100 rounded-xl p-3 text-sm"><p className="mono font-bold">{x.serie}</p><p>{x.producto} <span className="text-slate-400 mono text-xs">{x.codigo}</span></p>
            <p className="text-xs text-slate-500">{x.cliente} · Factura {x.factura || '—'} · {x.estado} · {fecha(x.fecha)}</p><button className="btn btn-sm mt-2" onClick={() => ver(x.despacho_id)}>Ver despacho {x.despacho}</button></div>
        ))}
      </div>
    </Hoja>
  )
}

function TraerFacturas({ cerrar, aviso, hecho }: { cerrar: () => void; aviso: (t: string) => void; hecho: () => void }) {
  const [dias, setDias] = useState('15')
  const [ocupado, setOcupado] = useState(false)
  async function traer() {
    setOcupado(true)
    const { data, error } = await supabase.rpc('bodega_traer_facturas', { p_dias: Number(dias) })
    setOcupado(false)
    if (error) { aviso(error.message); return }
    cerrar(); aviso(data ? `Se trajeron ${data} despacho(s).` : 'No había facturas nuevas para traer.'); hecho()
  }
  return (
    <Hoja cerrar={cerrar}>
      <h3 className="font-display font-bold text-lg text-[var(--navy)] mb-2">Traer facturas anteriores</h3>
      <p className="text-sm text-slate-600 mb-3">Las ventas nuevas llegan solas al facturar. Usa esto para traer las que se facturaron antes de activar Bodega.</p>
      <label className="f">Facturadas en los últimos<select className="inp" value={dias} onChange={(e) => setDias(e.target.value)}><option value="7">7 días</option><option value="15">15 días</option><option value="30">30 días</option><option value="60">60 días</option></select></label>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" onClick={traer} disabled={ocupado}>{ocupado ? <Ocupado /> : 'Traer'}</button></div>
    </Hoja>
  )
}

/* ============================ Evidencia (miniatura con URL firmada) ============================ */
function Evidencia({ ev, quitable, quitar }: { ev: Evid; quitable: boolean; quitar: () => void }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let vivo = true
    if (!esRuta(ev.url)) { const id = driveId(ev.url); setUrl(ev.tipo === 'video' ? ev.url : id ? `https://lh3.googleusercontent.com/d/${id}=w400` : ev.url); return }
    supabase.storage.from('despachos').createSignedUrl(ev.url, 3600).then(({ data }) => { if (vivo && data) setUrl(data.signedUrl) })
    return () => { vivo = false }
  }, [ev.url, ev.tipo])
  return (
    <a className="ev" href={url || undefined} target="_blank" rel="noopener">
      {ev.tipo === 'video' ? <PlayCircle style={{ width: 34, height: 34, color: '#475569' }} /> : url ? <img src={url} loading="lazy" alt="" /> : <span className="spin" />}
      <span>{ev.etiqueta}</span>
      {quitable && <button title="Quitar" onClick={(e) => { e.preventDefault(); quitar() }}><X style={{ width: 14, height: 14 }} /></button>}
    </a>
  )
}

/* ============================ Panel de detalle ============================ */
function Panel({ id, despacharAlAbrir, perfil, editar, aviso, cerrar, cambio }: { id: string; despacharAlAbrir?: boolean; perfil: Perfil; editar: boolean; aviso: (t: string) => void; cerrar: () => void; cambio: () => void }) {
  const [o, setO] = useState<Despacho | null>(null)
  const [error, setError] = useState('')
  const [series, setSeries] = useState<Record<string, string[]>>({})
  const [hoja, setHoja] = useState<'novedad' | 'resolver' | 'despachar' | 'escaner' | null>(null)
  const [resolverId, setResolverId] = useState('')
  const [escanearA, setEscanearA] = useState<{ key: string; k: number } | null>(null)
  const [etiqueta, setEtiqueta] = useState('Equipo con serie')
  const [subida, setSubida] = useState<{ txt: string; pct: number } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const inputsRef = useRef<Record<string, HTMLInputElement | null>>({})
  const refs = { foto: useRef<HTMLInputElement>(null), fotoGal: useRef<HTMLInputElement>(null), video: useRef<HTMLInputElement>(null), videoGal: useRef<HTMLInputElement>(null) }
  const yaAbrioDespacho = useRef(false)

  const recargar = useCallback(async (sinSeries?: boolean) => {
    const { data, error } = await supabase.from('despachos').select(COLS_DB).eq('id', id).single()
    if (error) { setError(error.message); return null }
    const d = mapear(data); setO(d); setError('')
    if (!sinSeries) setSeries(Object.fromEntries(d.productos.map((p) => [p.key, Array.from({ length: p.cantidad }, (_, i) => arr<string>(d.series[p.key])[i] || '')])))
    return d
  }, [id])
  useEffect(() => { recargar() }, [recargar])
  useEffect(() => {
    const c = supabase.channel('bodega-' + id).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'despachos', filter: 'id=eq.' + id }, () => { const el = document.activeElement; if (!(el && /INPUT|TEXTAREA|SELECT/.test(el.tagName))) recargar() }).subscribe()
    return () => { supabase.removeChannel(c) }
  }, [id, recargar])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !hoja) cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [hoja, cerrar])
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])
  useEffect(() => { if (despacharAlAbrir && o && !yaAbrioDespacho.current) { yaAbrioDespacho.current = true; abrirDespacho() } }) // eslint-disable-line react-hooks/exhaustive-deps

  const cerrado = o?.estado === 'Despachada'
  const limpia = (a: string[]) => { const x = a.map((s) => s || ''); while (x.length && !x[x.length - 1]) x.pop(); return JSON.stringify(x) }
  const hayCambios = !!o && !cerrado && o.productos.some((p) => limpia((series[p.key] ?? []).map((s) => s.trim().toUpperCase())) !== limpia(arr<string>(o.series[p.key])))

  async function actualizar(campos: Record<string, unknown>, texto?: string) {
    if (!o) throw new Error('Cargando')
    const base: Record<string, unknown> = { ...campos }
    if (texto) base.historial = nota(o, perfil.nombre, texto)
    const { error } = await supabase.from('despachos').update(base).eq('id', o.id).eq('updated_at', o.actualizado)
    if (error) throw new Error(error.message)
    const d = await recargar(true); cambio(); return d
  }
  async function guardarSeries(silencioso?: boolean): Promise<Despacho | null> {
    if (!o) return null
    if (o.estado === 'Despachada') throw new Error('Este despacho ya salió; las series no se pueden cambiar.')
    const limpio: Record<string, string[]> = {}, vistas = new Set<string>()
    o.productos.forEach((p) => {
      const a = (series[p.key] ?? []).slice(0, p.cantidad).map((s) => String(s || '').trim().toUpperCase().slice(0, 80))
      a.forEach((s) => { if (!s) return; if (vistas.has(s)) throw new Error(`La serie ${s} está repetida.`); vistas.add(s) })
      limpio[p.key] = a
    })
    setGuardando(true)
    try {
      const campos: Record<string, unknown> = { series: limpio }
      if (o.estado === 'Por preparar') Object.assign(campos, { estado: 'En preparación', preparado_por: perfil.id, inicio_preparacion: new Date().toISOString() })
      const d = await actualizar(campos, `Series guardadas (${vistas.size}).`)
      if (d) setSeries(Object.fromEntries(d.productos.map((p) => [p.key, Array.from({ length: p.cantidad }, (_, i) => arr<string>(d.series[p.key])[i] || '')])))
      if (!silencioso) aviso('Series guardadas')
      return d
    } finally { setGuardando(false) }
  }
  const errAviso = (e: unknown) => aviso((e as Error).message)
  async function accion(a: 'iniciar' | 'lista' | 'verificar' | 'reabrir') {
    try {
      let d = o!
      if (hayCambios) d = (await guardarSeries(true)) ?? d
      if (a === 'iniciar') { if (d.estado !== 'Por preparar') throw new Error('Ya está en preparación.'); await actualizar({ estado: 'En preparación', preparado_por: perfil.id, inicio_preparacion: new Date().toISOString() }, 'Inició la preparación.') }
      else if (a === 'lista') { const f = faltanSeriesMsg(d); if (f) throw new Error(f); await actualizar({ estado: 'Lista', ...(d.preparadoPorId ? {} : { preparado_por: perfil.id }) }, 'Marcó el pedido como listo para despachar.') }
      else if (a === 'verificar') { if (d.preparadoPorId && d.preparadoPorId === perfil.id) throw new Error('La verificación la hace una persona distinta a quien preparó.'); await actualizar({ verificado_por: perfil.id }, 'Verificó el pedido (doble control).') }
      else { if (d.estado === 'Despachada') throw new Error('Ya fue despachado.'); await actualizar({ estado: 'En preparación', verificado_por: null }, 'Volvió a preparación.') }
      aviso({ iniciar: 'Preparación iniciada', lista: 'Listo para despachar', verificar: 'Verificado', reabrir: 'Volvió a preparación' }[a])
    } catch (e) { errAviso(e) }
  }
  async function sinSerie(p: Linea, v: boolean) {
    if (!o) return
    try {
      const prods = o.productos.map((x) => (x.key === p.key ? { ...x, requiereSerie: !v } : x))
      await actualizar({ productos: prods }, `"${p.nombre}" ${v ? 'marcado sin número de serie.' : 'vuelve a pedir número de serie.'}`)
      await supabase.from('productos').update({ requiere_serie: !v }).eq('codigo', p.id) // recuerda la preferencia (si tiene permiso)
    } catch (e) { errAviso(e) }
  }

  /* Fotos y videos → Storage */
  async function subirArchivos(files: File[], tipo: 'foto' | 'video') {
    if (!o || !files.length) return
    let actual = o
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      try {
        setSubida({ txt: tipo === 'foto' ? `Subiendo foto ${i + 1} de ${files.length}…` : `Subiendo video (${(f.size / 1048576).toFixed(1)} MB)…`, pct: (i / files.length) * 100 })
        if (tipo === 'video') {
          if (!/^video\//.test(f.type)) throw new Error('Formato de video no admitido. Usa MP4, MOV o WebM.')
          if (f.size > 50 * 1048576) throw new Error('El video debe pesar menos de 50 MB.')
        }
        const cuerpo: Blob = tipo === 'foto' ? await reducir(f) : f
        const ext = tipo === 'foto' ? 'jpg' : (f.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
        const ruta = `${actual.id}/${Date.now()}_${i}.${ext}`
        const { error } = await supabase.storage.from('despachos').upload(ruta, cuerpo, { contentType: tipo === 'foto' ? 'image/jpeg' : f.type || 'video/mp4' })
        if (error) throw new Error(error.message)
        const { data: fresco } = await supabase.from('despachos').select('evidencias,historial,updated_at').eq('id', actual.id).single()
        const evidencias = [...arr<Evid>(fresco?.evidencias), { url: ruta, tipo, etiqueta: tipo === 'foto' ? etiqueta : etiqueta === 'Equipo con serie' ? 'Video del despacho' : etiqueta, fecha: new Date().toISOString(), por: perfil.nombre }]
        const hist = [...arr<Hist>(fresco?.historial), { fecha: new Date().toISOString(), por: perfil.nombre, nota: `Subió ${tipo}: ${etiqueta}.` }].slice(-200)
        const { error: e2 } = await supabase.from('despachos').update({ evidencias, historial: hist }).eq('id', actual.id)
        if (e2) throw new Error(e2.message)
        actual = { ...actual, actualizado: '' }
      } catch (e) { errAviso(e) }
    }
    setSubida(null); await recargar(true); cambio(); aviso(tipo === 'foto' ? 'Evidencia guardada' : 'Video guardado')
  }
  async function quitarFoto(ev: Evid) {
    if (!o || !confirm('¿Quitar esta evidencia?')) return
    if (o.envios.some((e) => arr<string>(e.fotos).includes(ev.url))) { aviso('Esa foto ya es evidencia de un envío realizado; no se puede quitar.'); return }
    try {
      await actualizar({ evidencias: o.evidencias.filter((e) => e.url !== ev.url) }, 'Quitó una foto.')
      if (esRuta(ev.url)) await supabase.storage.from('despachos').remove([ev.url])
    } catch (e) { errAviso(e) }
  }

  const abrirDespacho = async () => {
    try { if (hayCambios) await guardarSeries(true); setHoja('despachar') } catch (e) { errAviso(e) }
  }

  if (error) return <div className="panel"><div className="text-center py-24 px-6"><p className="text-red-600 font-semibold mb-3">{error}</p><button className="btn btn-p" onClick={() => recargar()}><RefreshCw />Reintentar</button> <button className="btn" onClick={cerrar}>Cerrar</button></div></div>
  if (!o) return <div className="panel"><div className="text-center py-24 text-slate-400"><span className="spin" /> Abriendo…</div></div>

  const e = o.entrega, pendNov = o.novedades.filter((n) => !n.resuelta)
  const destino = e.entrega === 'Local' ? e.direccionEntregaLocal || '' : e.direccionEnvio || e.direccionEntregaLocal || ''
  const recibe = e.quienRecibe || e.nombreDestinatario || '', tel = e.telefonoEntregaLocal || e.telefonoDestinatario || o.telefono || ''
  const prep = [e.empaqueCaja, e.empaqueArmado, e.empaqueStretch].filter(Boolean)
  const usadas = new Set(o.envios.flatMap((en) => arr<string>(en.fotos)))
  let faltan = 0
  const kv = (k: string, v: React.ReactNode) => (v ? <><dt>{k}</dt><dd>{v}</dd></> : null)
  const lnk = (href: string, t: string) => <a className="text-[var(--acc)] font-semibold" href={href} target="_blank" rel="noopener">{t}</a>

  const sEnt = (
    <div className="sec"><h3><Truck />Entrega{o.empresa === 'FEMEDICS' && <span className="pill fm">Femedics</span>}</h3>
      <dl className="kv">
        {kv('Tipo', (e.entrega || '—') + (e.transporte ? ' · ' + e.transporte : ''))}{kv('Fecha', e.fechaEntrega)}{kv('Dirección', destino ? destino + (e.ciudad ? ', ' + e.ciudad : '') : '')}
        {kv('Recibe', recibe ? recibe + (e.cedulaDestinatario ? ' · ' + e.cedulaDestinatario : '') : '')}{kv('Teléfono', tel ? <a className="text-[var(--acc)] font-semibold" href={'tel:' + tel}>{tel}</a> : '')}
        {kv('Mapa', e.urlGoogleMaps ? lnk(e.urlGoogleMaps, 'Abrir ubicación') : '')}{kv('Preparación', prep.join(' · '))}{kv('Asesor', nombreCorto(o.asesor))}{kv('Factura', o.facturaUrl ? lnk(o.facturaUrl, 'Ver PDF') : '')}
      </dl>
    </div>
  )
  const sProd = (
    <div className="sec"><h3><Barcode />Productos y números de serie</h3>
      <div className="space-y-4">
        {o.productos.map((p) => {
          const desp = p.despachado || 0, s = series[p.key] ?? []
          return (
            <div key={p.key} className="border border-slate-100 rounded-2xl p-3">
              <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="font-bold text-sm text-slate-800">{p.nombre}</p><p className="text-[11px] text-slate-400 mono">{p.id} · {desp}/{p.cantidad} despachadas</p>{p.observacion && <p className="text-[11px] text-slate-500 mt-0.5">{p.observacion}</p>}</div></div>
              {p.requiereSerie ? (
                <div className="space-y-1.5 mt-2.5">
                  {Array.from({ length: p.cantidad }, (_, k) => {
                    const v = s[k] || ''; if (!v) faltan++
                    const nombre = `${p.key}#${k}`
                    return (
                      <div key={k} className="serie"><span className="n">{k + 1}</span>
                        <input className={'inp ' + (v ? 'ok' : '')} ref={(el) => { inputsRef.current[nombre] = el }} value={v} placeholder="Número de serie" autoComplete="off" autoCapitalize="characters" disabled={k < desp || cerrado || !editar}
                          onChange={(ev) => setSeries((m) => ({ ...m, [p.key]: Array.from({ length: p.cantidad }, (_, i) => (i === k ? ev.target.value.toUpperCase() : m[p.key]?.[i] || '')) }))}
                          onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const sig = Object.keys(inputsRef.current).filter((n) => inputsRef.current[n] && !inputsRef.current[n]!.disabled); const i = sig.indexOf(nombre); (inputsRef.current[sig[i + 1]] || document.getElementById('btnSeries') || ev.currentTarget).focus() } }} />
                        {k < desp ? <span className="pill s-despachada">Salió</span> : !cerrado && editar ? <button className="btn btn-sm" style={{ minWidth: 44, minHeight: 40 }} title="Escanear el código de barras de este equipo" onClick={() => { setEscanearA({ key: p.key, k }); setHoja('escaner') }}><ScanLine /></button> : null}
                      </div>
                    )
                  })}
                </div>
              ) : <p className="text-xs text-slate-500 mt-2 flex items-center gap-1"><MinusCircle style={{ width: 13, height: 13 }} />Este producto no lleva número de serie.</p>}
              {!cerrado && editar && <label className="flex items-center gap-2 mt-2.5 text-[11.5px] text-slate-500 cursor-pointer"><input type="checkbox" checked={!p.requiereSerie} onChange={(ev) => sinSerie(p, ev.target.checked)} /> No lleva número de serie (se recuerda para este producto)</label>}
            </div>
          )
        })}
      </div>
      {!cerrado && editar && o.productos.some((p) => p.requiereSerie) && (
        <div className="flex items-center gap-2 mt-3"><span className={'text-xs font-semibold ' + (faltan ? 'text-amber-700' : 'text-emerald-700')}>{faltan ? `Faltan ${faltan} series` : 'Series completas'}</span>
          <button id="btnSeries" className="btn btn-p ml-auto" disabled={guardando} onClick={() => guardarSeries().catch(errAviso)}>{guardando ? <Ocupado /> : <><Save />Guardar series</>}</button></div>
      )}
    </div>
  )
  const sEv = (
    <div className="sec"><h3><Camera />Evidencia del despacho <span className="text-xs font-normal text-slate-400">fotos o videos</span></h3>
      {o.evidencias.length ? <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">{o.evidencias.map((ev) => <Evidencia key={ev.url} ev={ev} quitable={!usadas.has(ev.url) && !cerrado && editar} quitar={() => quitarFoto(ev)} />)}</div>
        : <p className="text-xs text-slate-500 mb-3">Obligatoria para despachar: el equipo con su serie visible, el paquete cerrado y la guía pegada si es envío.</p>}
      {!cerrado && editar && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select className="inp" value={etiqueta} onChange={(ev) => setEtiqueta(ev.target.value)}>{['Equipo con serie', 'Paquete cerrado', 'Guía pegada', 'Entrega al transportista', 'Otro'].map((x) => <option key={x}>{x}</option>)}</select>
            <button className="btn btn-p" onClick={() => refs.foto.current?.click()}><Camera />Tomar foto</button>
            <button className="btn" onClick={() => refs.fotoGal.current?.click()}><ImageUp />Subir foto</button>
            <button className="btn" onClick={() => refs.video.current?.click()}><Video />Grabar video</button>
            <button className="btn" onClick={() => refs.videoGal.current?.click()}><Upload />Subir video</button>
          </div>
          {subida && <div className="mt-2"><p className="text-xs text-slate-600 mb-1">{subida.txt}</p><div className="bar"><i style={{ width: subida.pct + '%' }} /></div></div>}
          <input ref={refs.foto} type="file" accept="image/*" capture="environment" multiple hidden onChange={(ev) => { const f = [...(ev.target.files ?? [])]; ev.target.value = ''; subirArchivos(f, 'foto') }} />
          <input ref={refs.fotoGal} type="file" accept="image/*" multiple hidden onChange={(ev) => { const f = [...(ev.target.files ?? [])]; ev.target.value = ''; subirArchivos(f, 'foto') }} />
          <input ref={refs.video} type="file" accept="video/*" capture="environment" hidden onChange={(ev) => { const f = [...(ev.target.files ?? [])]; ev.target.value = ''; subirArchivos(f, 'video') }} />
          <input ref={refs.videoGal} type="file" accept="video/*" hidden onChange={(ev) => { const f = [...(ev.target.files ?? [])]; ev.target.value = ''; subirArchivos(f, 'video') }} />
        </>
      )}
    </div>
  )
  const sNov = (
    <div className="sec"><h3><AlertTriangle />Novedades</h3>
      {o.novedades.length ? (
        <div className="space-y-2 mb-3">
          {[...o.novedades].reverse().map((n) => (
            <div key={n.id} className={'rounded-xl p-3 ' + (n.resuelta ? 'bg-slate-50' : 'bg-red-50')}>
              <div className="flex items-center gap-2 flex-wrap"><span className={'pill ' + (n.resuelta ? 's-despachada' : 's-novedad')}>{n.resuelta ? 'Resuelta' : 'Abierta'}</span><b className="text-sm">{n.tipo}</b><span className="text-[11px] text-slate-400 ml-auto">{n.por} · {fecha(n.fecha)}</span></div>
              <p className="text-sm mt-1">{n.detalle}</p>
              {n.foto && <FotoNovedad ruta={n.foto} />}
              {n.resuelta ? <p className="text-xs text-emerald-700 mt-1"><b>Solución:</b> {n.resolucion} — {n.resueltaPor}</p> : !cerrado && editar && <button className="btn btn-sm mt-2" onClick={() => { setResolverId(n.id); setHoja('resolver') }}><Check />Marcar resuelta</button>}
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-slate-500 mb-3">Sin novedades.</p>}
      {!cerrado && editar && <button className="btn btn-red" onClick={() => setHoja('novedad')}><AlertTriangle />Reportar novedad</button>}
    </div>
  )
  const sEnv = o.envios.length ? (
    <div className="sec"><h3><Send />Despachos realizados</h3>
      <div className="space-y-2">{o.envios.map((en) => (
        <div key={en.n} className="text-sm border-b border-slate-100 pb-2"><b>Nº {en.n}</b> · {fecha(en.fecha)} · {en.por}
          <div className="text-xs text-slate-500">{o.productos.filter((p) => en.cantidades[p.key]).map((p) => <div key={p.key}>{en.cantidades[p.key]}× {p.nombre}{en.series?.[p.key]?.length ? <span className="mono"> ({en.series[p.key].join(', ')})</span> : null}</div>)}</div>
          {en.nota && <div className="text-xs text-slate-500">Nota: {en.nota}</div>}</div>))}</div>
    </div>
  ) : null
  const sHist = (
    <details className="sec"><summary className="font-display font-bold text-[15px] text-[var(--navy)] cursor-pointer">Historial</summary>
      <div className="mt-2 space-y-1.5">{[...o.historial].reverse().map((h, i) => <p key={i} className="text-xs"><span className="text-slate-400">{fecha(h.fecha)}</span> · <b>{h.por}</b> — {h.nota}</p>)}</div>
      <p className="text-[11px] text-slate-400 mt-2">Preparó: {o.preparadoPor || '—'} · Verificó: {o.verificadoPor || '—'} · Despachó: {o.despachadoPor || '—'}</p>
    </details>
  )

  return (
    <div className="panel">
      <div className="hdr text-white sticky top-0 z-10">
        <div className="w-full px-4 lg:px-6 py-3 flex items-center gap-3">
          <button className="btn btn-sm !bg-white/10 !border-white/20 !text-white" onClick={cerrar} title="Cerrar"><X /></button>
          <div className="min-w-0"><p className="font-display font-bold leading-tight truncate">{o.cliente || 'Despacho'}</p><p className="text-[11px] text-white/70 mono">{o.codigo} · Factura {o.factura || '—'}</p></div>
          <span className={'pill s-' + slug(o.estado) + ' ml-auto'}>{o.estado}</span>
        </div>
      </div>
      <div className="w-full px-4 lg:px-6 py-4 space-y-3">
        {pendNov.length > 0 && <div className="sec" style={{ borderColor: '#f5c6c0', background: '#fff7f6' }}><h3 style={{ color: 'var(--red)' }}><AlertTriangle />Novedad sin resolver</h3>{pendNov.map((n) => <p key={n.id} className="text-sm"><b>{n.tipo}:</b> {n.detalle}</p>)}<p className="text-[11px] text-slate-500 mt-1">No se puede despachar hasta resolverla.</p></div>}
        <div className="lg:hidden space-y-3">{sEnt}</div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start">
          <div className="space-y-3">{sProd}{sEv}</div>
          <div className="space-y-3"><div className="hidden lg:block">{sEnt}</div>{sNov}{sEnv}{sHist}</div>
        </div>
        {!cerrado && editar && (
          <div className="acciones"><div className="flex gap-2 flex-wrap lg:justify-end">
            {o.estado === 'Por preparar' && <button className="btn btn-p flex-1 lg:flex-none lg:min-w-[170px]" onClick={() => accion('iniciar')}><Play />Iniciar preparación</button>}
            {(o.estado === 'En preparación' || o.estado === 'Parcial') && <button className="btn flex-1 lg:flex-none lg:min-w-[170px]" onClick={() => accion('lista')}><CheckCheck />Marcar lista</button>}
            {!o.verificadoPorId && o.estado !== 'Por preparar' && <button className="btn flex-1 lg:flex-none lg:min-w-[170px]" onClick={() => accion('verificar')}><ShieldCheck />Verificar</button>}
            {o.estado === 'Lista' && <button className="btn flex-1 lg:flex-none lg:min-w-[170px]" onClick={() => accion('reabrir')}><RotateCcw />Volver a preparar</button>}
            <button className="btn btn-ok flex-1 lg:flex-none lg:min-w-[170px]" onClick={abrirDespacho} disabled={pendNov.length > 0} title={pendNov.length ? 'Resuelve la novedad primero' : undefined}><Send />Despachar</button>
          </div></div>
        )}
      </div>
      {hoja === 'novedad' && <NovedadHoja o={o} perfil={perfil} cerrar={() => setHoja(null)} listo={async () => { setHoja(null); await recargar(true); cambio(); aviso('Novedad reportada y avisada') }} />}
      {hoja === 'resolver' && <ResolverHoja o={o} nid={resolverId} perfil={perfil} cerrar={() => setHoja(null)} listo={async () => { setHoja(null); await recargar(true); cambio(); aviso('Novedad resuelta') }} />}
      {hoja === 'despachar' && <DespacharHoja o={o} cerrar={() => setHoja(null)} listo={async (r) => { setHoja(null); await recargar(); cambio(); aviso(r === 'Despachada' ? 'Despachado. Pasó a Logística.' : 'Despacho parcial registrado. Pasó a Logística.') }} />}
      {hoja === 'escaner' && escanearA && <Escaner cerrar={() => setHoja(null)} leido={(txt) => {
        const p = o.productos.find((x) => x.key === escanearA.key)!
        setSeries((m) => ({ ...m, [p.key]: Array.from({ length: p.cantidad }, (_, i) => (i === escanearA.k ? txt.trim().toUpperCase() : m[p.key]?.[i] || '')) }))
        setHoja(null); aviso('Serie leída: ' + txt)
      }} num={escanearA.k + 1} />}
    </div>
  )
}

function FotoNovedad({ ruta }: { ruta: string }) {
  const [url, setUrl] = useState(esRuta(ruta) ? '' : ruta)
  useEffect(() => { if (esRuta(ruta)) supabase.storage.from('despachos').createSignedUrl(ruta, 3600).then(({ data }) => { if (data) setUrl(data.signedUrl) }) }, [ruta])
  return url ? <a className="text-xs text-[var(--acc)] font-semibold" href={url} target="_blank" rel="noopener">Ver foto</a> : null
}

function NovedadHoja({ o, perfil, cerrar, listo }: { o: Despacho; perfil: Perfil; cerrar: () => void; listo: () => void }) {
  const [tipo, setTipo] = useState(TIPOS_NOVEDAD[0])
  const [det, setDet] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  async function enviar() {
    if (!det.trim()) { setErr('Describe la novedad.'); return }
    setOcupado(true); setErr('')
    try {
      let ruta = ''
      const evid = [...o.evidencias]
      if (foto) {
        ruta = `${o.id}/nov_${Date.now()}.jpg`
        const { error } = await supabase.storage.from('despachos').upload(ruta, await reducir(foto), { contentType: 'image/jpeg' })
        if (error) throw new Error(error.message)
        evid.push({ url: ruta, tipo: 'foto', etiqueta: 'Novedad: ' + tipo, fecha: new Date().toISOString(), por: perfil.nombre })
      }
      const { data: fresco, error: e0 } = await supabase.from('despachos').select('novedades,historial,evidencias').eq('id', o.id).single()
      if (e0) throw new Error(e0.message)
      const n: Nov = { id: 'N' + Date.now().toString(36), tipo, detalle: det.trim().slice(0, 1500), foto: ruta, fecha: new Date().toISOString(), por: perfil.nombre, resuelta: false }
      const hist = [...arr<Hist>(fresco.historial), { fecha: n.fecha, por: perfil.nombre, nota: `Novedad: ${tipo} — ${n.detalle}`.slice(0, 500) }].slice(-200)
      const { error } = await supabase.from('despachos').update({ novedades: [...arr<Nov>(fresco.novedades), n], historial: hist, ...(foto ? { evidencias: [...arr<Evid>(fresco.evidencias), evid[evid.length - 1]] } : {}) }).eq('id', o.id)
      if (error) throw new Error(error.message)
      supabase.rpc('bodega_avisar_novedad', { p_id: o.id, p_tipo: tipo, p_detalle: n.detalle }).then(() => undefined)
      listo()
    } catch (e) { setOcupado(false); setErr((e as Error).message) }
  }
  return (
    <Hoja cerrar={cerrar}>
      <h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">Reportar novedad</h3>
      <label className="f">Tipo<select className="inp" value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS_NOVEDAD.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="f mt-3">¿Qué pasó? *<textarea className="inp" rows={4} placeholder="Ej.: el monitor llegó con la pantalla rayada" value={det} onChange={(e) => setDet(e.target.value)} /></label>
      <label className="f mt-3">Foto (opcional · tómala o súbela)<input type="file" accept="image/*" className="inp" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} /></label>
      <p className="text-[11px] text-slate-500 mt-2">Se avisa al asesor. El pedido no se puede despachar hasta resolverla.</p>
      {err && <p className="text-[11px] text-red-600 mt-2">{err}</p>}
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" onClick={enviar} disabled={ocupado}>{ocupado ? <Ocupado /> : 'Reportar'}</button></div>
    </Hoja>
  )
}

function ResolverHoja({ o, nid, perfil, cerrar, listo }: { o: Despacho; nid: string; perfil: Perfil; cerrar: () => void; listo: () => void }) {
  const [txt, setTxt] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  async function ok() {
    if (!txt.trim()) { setErr('Escribe la solución.'); return }
    setOcupado(true)
    const { data: fresco } = await supabase.from('despachos').select('novedades,historial').eq('id', o.id).single()
    let hecho = false
    const novs = arr<Nov>(fresco?.novedades).map((n) => { if (n.id === nid && !n.resuelta) { hecho = true; return { ...n, resuelta: true, resolucion: txt.trim().slice(0, 1000), resueltaPor: perfil.nombre, fechaResolucion: new Date().toISOString() } } return n })
    if (!hecho) { setOcupado(false); setErr('La novedad ya estaba resuelta o no existe.'); return }
    const hist = [...arr<Hist>(fresco?.historial), { fecha: new Date().toISOString(), por: perfil.nombre, nota: ('Novedad resuelta: ' + txt.trim()).slice(0, 500) }].slice(-200)
    const { error } = await supabase.from('despachos').update({ novedades: novs, historial: hist }).eq('id', o.id)
    if (error) { setOcupado(false); setErr(error.message); return }
    listo()
  }
  return (
    <Hoja cerrar={cerrar}>
      <h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">Resolver novedad</h3>
      <label className="f">¿Cómo se resolvió? *<textarea className="inp" rows={3} value={txt} onChange={(e) => setTxt(e.target.value)} /></label>
      {err && <p className="text-[11px] text-red-600 mt-2">{err}</p>}
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-ok flex-1" onClick={ok} disabled={ocupado}>{ocupado ? <Ocupado /> : 'Marcar resuelta'}</button></div>
    </Hoja>
  )
}

function DespacharHoja({ o, cerrar, listo }: { o: Despacho; cerrar: () => void; listo: (estado: string) => void }) {
  const pend = o.productos.filter((p) => p.cantidad - (p.despachado || 0) > 0)
  const [cant, setCant] = useState<Record<string, number>>(() => Object.fromEntries(pend.map((p) => [p.key, p.cantidad - (p.despachado || 0)])))
  const [nota, setNota] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  async function ok() {
    setOcupado(true); setErr('')
    const todas = Object.fromEntries(o.productos.map((p) => [p.key, cant[p.key] ?? 0]))
    const { data, error } = await supabase.rpc('bodega_despachar', { p_id: o.id, p_cantidades: todas, p_nota: nota.trim() })
    if (error) { setOcupado(false); setErr(error.message); return }
    listo((data as { estado: string }).estado)
  }
  return (
    <Hoja cerrar={cerrar}>
      <h3 className="font-display font-bold text-lg text-[var(--navy)] mb-1">Despachar</h3>
      <p className="text-xs text-slate-500 mb-3">Si envías menos unidades, queda como despacho parcial y el resto sigue en Bodega.</p>
      {pend.map((p) => { const f = p.cantidad - (p.despachado || 0); return (
        <div key={p.key} className="flex items-center gap-3 py-2 border-b border-slate-100"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{p.nombre}</p><p className="text-[11px] text-slate-400">Pendientes: {f}</p></div>
          <input type="number" className="inp !w-20 text-center" min={0} max={f} value={cant[p.key] ?? 0} onChange={(e) => setCant((m) => ({ ...m, [p.key]: Number(e.target.value) || 0 }))} /></div>) })}
      <label className="f mt-3">Nota (opcional)<input className="inp" placeholder="Ej.: sale con Servientrega, guía 123" value={nota} onChange={(e) => setNota(e.target.value)} /></label>
      {err && <p className="text-[12px] text-red-600 mt-2">{err}</p>}
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-ok flex-1" onClick={ok} disabled={ocupado}>{ocupado ? <Ocupado /> : <><Send />Confirmar despacho</>}</button></div>
    </Hoja>
  )
}

/* ============================ Escáner de código de barras (cámara) ============================ */
declare global { interface Window { Html5Qrcode?: new (id: string) => { start: (c: unknown, o: unknown, ok: (t: string) => void, err: () => void) => Promise<unknown>; stop: () => Promise<unknown>; clear: () => void } } }
function Escaner({ cerrar, leido, num }: { cerrar: () => void; leido: (txt: string) => void; num: number }) {
  useEffect(() => {
    let esc: InstanceType<NonNullable<Window['Html5Qrcode']>> | null = null
    let activo = true
    const cargarLib = () => window.Html5Qrcode ? Promise.resolve() : new Promise<void>((ok, fail) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'; s.onload = () => ok(); s.onerror = () => fail(new Error('No se pudo cargar el escáner. Revisa tu internet.')); document.head.appendChild(s) })
    cargarLib().then(() => {
      if (!activo) return
      esc = new window.Html5Qrcode!('scanReader')
      return esc.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w: number, h: number) => ({ width: Math.min(300, w * 0.9), height: Math.min(160, h * 0.6) }) }, (txt) => { try { navigator.vibrate?.(80) } catch { /* nada */ } leido(txt) }, () => undefined)
    }).catch((e) => { alert((e as Error).message + ' También puedes escribirla o usar un lector de código de barras.'); cerrar() })
    return () => { activo = false; if (esc) { const e = esc; e.stop().catch(() => undefined).then(() => { try { e.clear() } catch { /* nada */ } }) } }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Hoja cerrar={cerrar}>
      <h3 className="font-display font-bold text-lg text-[var(--navy)] mb-2">Escanear número de serie</h3>
      <div id="scanReader" className="rounded-xl overflow-hidden bg-black min-h-[220px]" />
      <p className="text-xs text-slate-500 mt-2">Apunta al código de barras o QR de la etiqueta del equipo {num}.</p>
      <button className="btn w-full mt-3" onClick={cerrar}>Cerrar</button>
    </Hoja>
  )
}
