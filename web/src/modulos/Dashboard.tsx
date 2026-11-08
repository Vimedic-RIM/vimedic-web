import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity, Award, BadgeCheck, BarChart3, Building2, CalendarClock, CalendarDays, CalendarRange, Clapperboard, Download, DollarSign, FileText, Filter, Gauge, GitCompare, Grid3x3, Kanban,
  Layers, LayoutGrid, LineChart, Lightbulb, Map as MapIcon, Megaphone, Mountain, Package, PieChart, RefreshCw, Receipt, ReceiptText, ScanSearch, ShoppingBag, Sparkles, Table, Target,
  TrendingUp, Trophy, UserCheck, UserPlus, Users, Workflow, UsersRound, Clock, AlertCircle, AlertTriangle, Video, X,
} from 'lucide-react'
import type { ChartConfiguration } from 'chart.js'
import { supabase, type Perfil } from '../supabase'
import {
  Grafico, baseOpts, canal, CANAL_COLOR, cleanMedio, corto, ecKey, esMk, hoyKey, keyAdd, keyDiff, keyLabel, money, money0, monthKeys, monthLabel, normalize, PALETA, sumBy, topEntries, usdTick,
} from '../graficos'
import '../estilos/dashboard.css'

/* ============================ Datos ============================ */
type Item = [string, number, number, string, string]   // nombre, unidades, subtotal, categoría, código
type Venta = { f: string; id: string; cliente: string; ident: string; ciudad: string; provincia: string; tipo: string; asesor: string; medio: string; numero: string; estado: string; base: number; total: number; items: Item[] }
type Prof = { f: string; monto: number; asesor: string }
type Lead = { f: string; medio: string; anuncio: string }
type Av = { f: string; tipo: string; estado: string; responsable: string; producto: string; codigo: string; titulo: string }
type Nc = { f: string; base: number; total: number }
type Pipe = { embudo: Record<string, number>; abierto: number; cuenta: number; tasa: number }
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Filtro = { asesor: string; cliente: string; ciudad: string; medio: string; tipo: string }
type Ctx = { desde: string; hasta: string; version: number; filtro: Filtro; setFiltro: (c: keyof Filtro, v: string) => void }

const ventanaDe = (hasta: string) => monthKeys(hasta, 13)[0] + '-01'
const memo = new Map<string, Promise<unknown>>()
/* Cada conjunto de datos se pide una sola vez (y solo cuando alguna sección visible lo necesita). */
function useDataset<T>(clave: string, hasta: string, version: number, cargador: (desde: string) => Promise<T>) {
  const [d, setD] = useState<T | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let vivo = true
    const k = `${clave}|${hasta}|${version}`
    let p = memo.get(k) as Promise<T> | undefined
    if (!p) { p = cargador(ventanaDe(hasta)); memo.set(k, p) }
    setD(null); setErr('')
    p.then((r) => { if (vivo) setD(r) }).catch((e) => { memo.delete(k); if (vivo) setErr(String(e?.message ?? e)) })
    return () => { vivo = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, hasta, version])
  return { d, err }
}
const ts = (d: string) => d + 'T00:00:00-05:00'
/* La API devuelve como máximo 1.000 filas por petición: se pide por páginas (ordenadas por id, que es único) hasta traerlo todo. */
async function paginar(q: (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, max = 30000): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < max; i += 1000) {
    const { data, error } = await q(i, i + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as R[]))
    if (!data || data.length < 1000) break
  }
  return out
}
/* El Dashboard Ejecutivo es de VIMEDIC: Femedics tiene su propio módulo y sus datos no se mezclan aquí. */
const cargarVentas = async (desde: string): Promise<Venta[]> => {
  const data = await paginar((a, z) => supabase.from('facturas').select('codigo,estado,created_at,fecha_ganado,numero_contifico,medio_captacion_venta,subtotal,total,items,cliente:clientes(nombre,ciudad,provincia,tipo_cliente,identificacion),cotizacion:cotizaciones(nombre),asesor:empleados!asesor_id(nombre)').eq('empresa', 'VIMEDIC').is('deleted_at', null).gte('created_at', ts(desde)).order('id').range(a, z))
  return data.map((x) => {
    const total = Number(x.total) || 0
    return {
      f: x.fecha_ganado || ecKey(x.created_at), id: x.codigo, cliente: x.cliente?.nombre ?? x.cotizacion?.nombre ?? '', ident: x.cliente?.identificacion ?? '', ciudad: x.cliente?.ciudad ?? '', provincia: x.cliente?.provincia ?? '',
      tipo: x.cliente?.tipo_cliente ?? '', asesor: x.asesor?.nombre ?? '', medio: x.medio_captacion_venta ?? '', numero: x.numero_contifico ?? '', estado: x.estado, base: Number(x.subtotal) || total / 1.15, total,
      items: ((x.items ?? []) as R[]).map((i) => [String(i.nombre ?? ''), Number(i.cantidad) || 0, (Number(i.precio) || 0) * (Number(i.cantidad) || 0) * (1 - (Number(i.descuento) || 0) / 100), String(i.categoria ?? ''), String(i.codigo ?? '')] as Item),
    }
  })
}
const cargarProformas = async (desde: string): Promise<Prof[]> => {
  const data = await paginar((a, z) => supabase.from('cotizaciones').select('fecha,total,asesor:empleados!asesor_id(nombre)').eq('empresa', 'VIMEDIC').is('deleted_at', null).gte('fecha', ts(desde)).order('id').range(a, z))
  return data.map((x) => ({ f: ecKey(x.fecha), monto: Number(x.total) || 0, asesor: x.asesor?.nombre ?? '' }))
}
const cargarLeads = async (desde: string): Promise<Lead[]> => {
  const data = await paginar((a, z) => supabase.from('leads').select('fecha,medio_captacion,anuncio').eq('empresa', 'VIMEDIC').is('deleted_at', null).gte('fecha', ts(desde)).order('id').range(a, z))
  return data.map((x) => ({ f: ecKey(x.fecha), medio: x.medio_captacion ?? '', anuncio: x.anuncio ?? '' }))
}
const cargarClientesNuevos = async (desde: string): Promise<string[]> => {
  const data = await paginar((a, z) => supabase.from('clientes').select('fecha_registro,created_at').eq('empresa', 'VIMEDIC').is('deleted_at', null).or('fecha_registro.gte.' + ts(desde) + ',and(fecha_registro.is.null,created_at.gte.' + ts(desde) + ')').order('id').range(a, z))
  return data.map((x) => ecKey(x.fecha_registro || x.created_at))
}
const cargarAv = async (desde: string): Promise<Av[]> => {
  const data = await paginar((a, z) => supabase.from('audiovisual').select('fecha,tipo,estado,titulo,responsable:empleados!responsable_id(nombre),producto:productos(codigo,nombre)').is('deleted_at', null).gte('fecha', ts(keyAdd(desde, -40))).order('id').range(a, z))
  return data.map((x) => ({ f: ecKey(x.fecha), tipo: x.tipo ?? '', estado: x.estado ?? '', responsable: x.responsable?.nombre ?? '', producto: x.producto?.nombre ?? '', codigo: x.producto?.codigo ?? '', titulo: x.titulo ?? '' }))
}
/* Notas de crédito aplicadas: se cuentan en la fecha de la nota, por su base sin IVA (igual que el Dashboard original). Los importes de la nota vienen en centavos. */
const cargarNC = async (desde: string): Promise<Nc[]> => {
  const data = await paginar((a, z) => supabase.from('notas_credito').select('fecha,datos,factura:facturas(codigo,empresa)').eq('tipo', 'nota_credito').is('deleted_at', null).gte('fecha', ts(desde)).order('id').range(a, z))
  return data.filter((x) => !x.factura || x.factura.empresa === 'VIMEDIC').map((x) => {
    const ls = ((x.datos?.lineas ?? []) as R[])
    return { f: ecKey(x.fecha), base: Math.round(ls.reduce((s, l) => s + (Number(l.base) || 0), 0)) / 100, total: Math.round(Number(x.datos?.total) || 0) / 100 }
  })
}
/* Pipeline actual del CRM: sin los registros históricos (ya cerrados) ni los de Femedics. */
const cargarPipe = async (): Promise<Pipe> => {
  const [l, c] = await Promise.all([
    paginar((a, z) => supabase.from('leads').select('estado_crm').eq('empresa', 'VIMEDIC').is('deleted_at', null).order('id').range(a, z)),
    paginar((a, z) => supabase.from('cotizaciones').select('estado_crm,total').eq('empresa', 'VIMEDIC').neq('tipo_registro', 'Histórico').is('deleted_at', null).order('id').range(a, z)),
  ])
  const emb: Record<string, number> = {}
  ;[...l, ...c].forEach((x) => { const e = x.estado_crm || 'Nuevo'; emb[e] = (emb[e] || 0) + 1 })
  const cerrado = (e: string) => /ganad|perdid/i.test(e)
  const total = Object.values(emb).reduce((s, n) => s + n, 0)
  const abiertas = c.filter((x) => !cerrado(x.estado_crm || ''))
  return { embudo: emb, abierto: abiertas.reduce((s, x) => s + (Number(x.total) || 0), 0), cuenta: Object.entries(emb).filter(([k]) => !cerrado(k)).reduce((s, [, n]) => s + n, 0), tasa: total ? Math.round(((emb.Ganado || 0) / total) * 100) : 0 }
}

/* ============================ Sección con carga diferida ============================ */
function Seccion({ id, children, alto = 260, className = '' }: { id: string; children: ReactNode; alto?: number; className?: string }) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!('IntersectionObserver' in window)) { setVisible(true); return }
    const o = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setVisible(true); o.disconnect() } }, { rootMargin: '150px 0px' })
    o.observe(el); return () => o.disconnect()
  }, [])
  return (
    <section id={id} ref={ref} className={className}>
      {visible ? children : <div className="grid grid-cols-1 gap-3"><div className="sk" style={{ height: alto }} /></div>}
    </section>
  )
}
const Cargando = ({ n = 1, alto = 200 }: { n?: number; alto?: number }) => <>{Array.from({ length: n }, (_, i) => <div key={i} className="sk" style={{ height: alto }} />)}</>
const Error_ = ({ t }: { t: string }) => <p className="p-4 text-xs text-red-700">No se pudo cargar esta sección: {t}</p>

function usePeriodo(c: Ctx) {
  const n = keyDiff(c.desde, c.hasta) + 1
  const ph = keyAdd(c.desde, -1), pd = keyAdd(ph, -(n - 1))
  const prev = pd >= ventanaDe(c.hasta) ? { from: pd, to: ph } : null
  return { en: (f: string) => f >= c.desde && f <= c.hasta, prev, n }
}
const Tarjeta = ({ icono: I, color, titulo, sub, span = '', children, extra }: { icono: typeof Activity; color: string; titulo: string; sub: string; span?: string; children: ReactNode; extra?: ReactNode }) => (
  <article className={'card p-4 ' + span}>
    <div className="flex items-start justify-between gap-2 mb-3 flex-wrap"><div><h3 className="font-display font-bold text-sm text-slate-800 flex items-center gap-2"><I className="w-4 h-4" style={{ color }} />{titulo}</h3><p className="text-[11px] text-slate-400">{sub}</p></div>{extra}</div>
    {children}
  </article>
)
const Alto = ({ cfg, h = 'h-64' }: { cfg: ChartConfiguration | null; h?: string }) => <div className={h}><Grafico config={cfg} /></div>
const Cabecera = ({ icono: I, titulo, sub, extra }: { icono: typeof Activity; titulo: string; sub: string; extra?: ReactNode }) => (
  <div className="sec-h"><div><h2><I />{titulo}</h2><p>{sub}</p></div>{extra && <div className="ml-auto flex items-center gap-2 flex-wrap">{extra}</div>}</div>
)

/* ============================ Resumen ============================ */
function SecResumen({ c }: { c: Ctx }) {
  const { d: ventas, err } = useDataset('ventas', c.hasta, c.version, cargarVentas)
  const { d: profs } = useDataset('profs', c.hasta, c.version, cargarProformas)
  const { d: leads } = useDataset('leads', c.hasta, c.version, cargarLeads)
  const { d: nuevos } = useDataset('nuevos', c.hasta, c.version, cargarClientesNuevos)
  const { d: ncs } = useDataset('nc', c.hasta, c.version, cargarNC)
  const { en, prev: pp } = usePeriodo(c)
  if (err) return <Error_ t={err} />
  if (!ventas || !profs || !leads) return <div className="grid grid-cols-2 md:grid-cols-5 gap-3"><Cargando n={10} alto={104} /></div>
  const V = ventas.filter((v) => en(v.f)), P = profs.filter((p) => en(p.f)), L = leads.filter((l) => en(l.f)), NU = (nuevos ?? []).filter(en)
  const NCP = (ncs ?? []).filter((n) => en(n.f)), ncBase = NCP.reduce((s, n) => s + n.base, 0)
  const total = V.reduce((s, v) => s + v.base, 0) - ncBase, fact = V.filter((v) => v.estado === 'Facturado'), pend = V.filter((v) => v.estado !== 'Facturado')
  const totFact = fact.reduce((s, v) => s + v.base, 0), totPend = pend.reduce((s, v) => s + v.base, 0), valorP = P.reduce((s, p) => s + p.monto, 0)
  const prev = pp ? { total: ventas.filter((v) => v.f >= pp.from && v.f <= pp.to).reduce((s, v) => s + v.base, 0) - (ncs ?? []).filter((n) => n.f >= pp.from && n.f <= pp.to).reduce((s, n) => s + n.base, 0), n: ventas.filter((v) => v.f >= pp.from && v.f <= pp.to).length, prof: profs.filter((p) => p.f >= pp.from && p.f <= pp.to).length, leads: leads.filter((l) => l.f >= pp.from && l.f <= pp.to).length } : null
  const delta = (a: number, b: number | undefined | null) => { if (b == null) return null; if (!b) return a ? <span className="delta up">nuevo</span> : null; const p = Math.round(((a - b) / b) * 100); return <span className={'delta ' + (p > 0 ? 'up' : p < 0 ? 'down' : 'eq')}>{p > 0 ? '▲ ' : p < 0 ? '▼ ' : ''}{Math.abs(p)}%</span> }
  const cards = [
    { l: 'Ventas del período', v: '$' + money0(total), s: ncBase ? 'antes de IVA · neto de notas de crédito' : 'antes de IVA', d: prev && delta(total, prev.total), i: DollarSign, c: 'var(--teal)' },
    { l: 'Nº de ventas', v: V.length, s: 'gestiones ganadas', d: prev && delta(V.length, prev.n), i: Receipt, c: 'var(--primary)' },
    { l: 'Facturado', v: '$' + money0(totFact), s: `${fact.length} factura${fact.length === 1 ? '' : 's'} · ${total ? Math.round((totFact / total) * 100) : 0}%`, i: BadgeCheck, c: 'var(--teal)' },
    { l: 'Por facturar', v: '$' + money0(totPend), s: `${pend.length} venta${pend.length === 1 ? '' : 's'} pendiente${pend.length === 1 ? '' : 's'}`, i: Clock, c: 'var(--amber)' },
    { l: 'Ticket promedio', v: '$' + money0(V.length ? total / V.length : 0), s: 'por venta', i: ShoppingBag, c: 'var(--navy)' },
    { l: 'Proformas', v: P.length, s: '$' + money0(valorP) + ' proformado', d: prev && delta(P.length, prev.prof), i: FileText, c: 'var(--cyan)' },
    { l: 'Conversión', v: (P.length ? Math.round((V.length / P.length) * 100) : 0) + '%', s: 'ventas / proformas', i: TrendingUp, c: 'var(--teal)' },
    { l: 'Leads', v: L.length, s: 'todas las fuentes', d: prev && delta(L.length, prev.leads), i: Users, c: 'var(--amber)' },
    { l: 'Clientes nuevos', v: NU.length, s: 'registrados en el período', i: UserPlus, c: 'var(--violet)' },
    { l: 'Notas de crédito', v: '$' + money0(ncBase), s: `${NCP.length} aplicada${NCP.length === 1 ? '' : 's'} · antes de IVA`, i: ReceiptText, c: 'var(--red)' },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((k) => { const I = k.i; return (
        <div key={k.l} className="stat-card bg-white rounded-2xl border border-slate-200 p-3.5 shadow-sm">
          <div className="flex items-center justify-between mb-2"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: k.c + '1A', color: k.c }}><I className="w-4 h-4" /></div>{k.d}</div>
          <p className="font-display font-bold text-xl text-slate-800 truncate">{k.v}</p><p className="text-[10px] font-semibold text-slate-500 uppercase font-mono-spec">{k.l}</p><p className="text-[10px] text-slate-400 mt-0.5 truncate" title={k.s}>{k.s}</p>
        </div>) })}
    </div>
  )
}

/* ============================ Ventas ============================ */
function Seg({ valor, ops, set }: { valor: string; ops: [string, string][]; set: (v: string) => void }) {
  return <div className="seg sm">{ops.map(([k, t]) => <button key={k} type="button" className={valor === k ? 'active' : ''} onClick={() => set(k)}>{t}</button>)}</div>
}
function SecVentas({ c }: { c: Ctx }) {
  const { d: ventas, err } = useDataset('ventas', c.hasta, c.version, cargarVentas)
  const { d: profs } = useDataset('profs', c.hasta, c.version, cargarProformas)
  const { d: leads } = useDataset('leads', c.hasta, c.version, cargarLeads)
  const { en, prev: pp } = usePeriodo(c)
  const [tl, setTl] = useState('canal')
  const [dn, setDn] = useState('asesor')
  const g = useMemo(() => {
    if (!ventas || !profs || !leads) return null
    const V = ventas.filter((v) => en(v.f)), P = profs.filter((p) => en(p.f)), L = leads.filter((l) => en(l.f))
    const months = monthKeys(c.hasta, 12), mL = months.map(monthLabel)
    const out: Record<string, ChartConfiguration> = {}
    let series: { label: string; color: string; fn: (v: Venta) => boolean }[]
    if (tl === 'canal') series = ['Publicidad pagada', 'Digital orgánico', 'Comercial', 'Otro', 'Sin medio'].map((x) => ({ label: x, color: CANAL_COLOR[x], fn: (v) => canal(v.medio) === x }))
    else if (tl === 'asesor') { const top = Object.entries(sumBy(ventas, (v) => v.asesor || 'Sin asesor', (v) => v.base)).sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]); series = top.map((a, i) => ({ label: a, color: PALETA[i % PALETA.length], fn: (v) => (v.asesor || 'Sin asesor') === a })); if (ventas.some((v) => !top.includes(v.asesor || 'Sin asesor'))) series.push({ label: 'Otros', color: '#cbd5e1', fn: (v) => !top.includes(v.asesor || 'Sin asesor') }) }
    else series = [{ label: 'Facturado', color: '#055c9d', fn: (v) => v.estado === 'Facturado' }, { label: 'Por facturar', color: '#c98a1f', fn: (v) => v.estado !== 'Facturado' }]
    out.tl = { type: 'line', data: { labels: mL, datasets: series.map((s) => ({ label: s.label, data: months.map((m) => Math.round(ventas.filter((v) => s.fn(v) && v.f.slice(0, 7) === m).reduce((a, v) => a + v.base, 0))), borderColor: s.color, backgroundColor: s.color + '33', fill: true, tension: 0.35, pointRadius: 2, borderWidth: 2 })).filter((d) => d.data.some(Boolean)) },
      options: baseOpts({ plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (x: any) => x.dataset.label + ': $' + money0(x.raw), footer: (it: any[]) => 'Total: $' + money0(it.reduce((s, x) => s + x.raw, 0)) } } }, scales: { y: { stacked: true, beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } }) as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const keyFn = dn === 'asesor' ? (v: Venta) => v.asesor || 'Sin asesor' : dn === 'medio' ? (v: Venta) => cleanMedio(v.medio) : (v: Venta) => (v.tipo === 'DIS' ? 'Distribuidor (DIS)' : v.tipo === 'PVP' ? 'Cliente final (PVP)' : 'Sin tipo')
    const dd = topEntries(sumBy(V, keyFn, (v) => v.base), 7)
    out.dona = { type: 'doughnut', data: { labels: dd.map((x) => x[0]), datasets: [{ data: dd.map((x) => Math.round(x[1])), backgroundColor: dd.map((x, i) => (x[0] === 'Otros' ? '#cbd5e1' : PALETA[i % PALETA.length])), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', onClick: (_e: unknown, els: { index: number }[]) => { if (!els.length) return; let v = dd[els[0].index][0]; if (v === 'Otros') return; if (dn === 'tipo') v = v.includes('DIS') ? 'DIS' : v.includes('PVP') ? 'PVP' : ''; c.setFiltro(dn === 'asesor' ? 'asesor' : dn === 'medio' ? 'medio' : 'tipo', v) }, plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, boxWidth: 8 } }, tooltip: { callbacks: { label: (x: any) => { const t = x.dataset.data.reduce((s: number, y: number) => s + y, 0); return x.label + ': $' + money0(x.raw) + ' (' + (t ? Math.round((x.raw / t) * 100) : 0) + '%)' } } } } } as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const days: string[] = []; let k = c.desde; while (k <= c.hasta && days.length < 800) { days.push(k); k = keyAdd(k, 1) }
    const byMonth = days.length > 92, buckets = byMonth ? [...new Set(days.map((d) => d.slice(0, 7)))] : days, bk = (f: string) => (byMonth ? f.slice(0, 7) : f)
    out.diario = { type: 'bar', data: { labels: buckets.map((b) => (byMonth ? monthLabel(b) : keyLabel(b, { day: 'numeric', month: 'short' }))), datasets: [
      { type: 'line', label: 'Ventas USD', data: buckets.map((b) => Math.round(V.filter((v) => bk(v.f) === b).reduce((s, v) => s + v.base, 0))), borderColor: '#04896f', backgroundColor: '#04896f22', fill: true, tension: 0.3, pointRadius: byMonth ? 3 : 1.5, yAxisID: 'y' },
      { type: 'bar', label: 'Proformas', data: buckets.map((b) => P.filter((p) => bk(p.f) === b).length), backgroundColor: '#17a9ba88', borderRadius: 4, yAxisID: 'y1' }] as never },
      options: baseOpts({ plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (x: any) => (x.dataset.yAxisID === 'y' ? 'Ventas: $' + money0(x.raw) : 'Proformas: ' + x.raw) } } }, scales: { y: { beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, y1: { position: 'right', beginAtZero: true, ticks: { precision: 0 }, grid: { display: false } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16 } } } }) as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const fact = V.filter((v) => v.estado === 'Facturado')
    out.embudo = { type: 'bar', data: { labels: ['Leads', 'Proformas', 'Ventas', 'Facturadas'], datasets: [{ data: [L.length, P.length, V.length, fact.length], backgroundColor: ['#c98a1f', '#17a9ba', '#04896f', '#055c9d'], borderRadius: 8, barThickness: 26 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (x: any) => { const p = x.dataIndex ? x.dataset.data[x.dataIndex - 1] : 0; return x.dataIndex && p ? Math.round((x.raw / p) * 100) + '% del paso anterior' : '' } } } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, y: { grid: { display: false }, ticks: { font: { size: 11, weight: 600 } } } } } as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    out.profs = { type: 'bar', data: { labels: mL, datasets: [
      { type: 'bar', label: 'Proformas', data: months.map((m) => profs.filter((p) => p.f.slice(0, 7) === m).length), backgroundColor: '#17a9ba', borderRadius: 6, order: 2 },
      { type: 'line', label: 'Ventas', data: months.map((m) => ventas.filter((v) => v.f.slice(0, 7) === m).length), borderColor: '#04896f', backgroundColor: '#04896f', tension: 0.35, pointRadius: 3, order: 1 },
      { type: 'line', label: 'Facturadas', data: months.map((m) => ventas.filter((v) => v.estado === 'Facturado' && v.f.slice(0, 7) === m).length), borderColor: '#055c9d', backgroundColor: '#055c9d', borderDash: [5, 4], tension: 0.35, pointRadius: 2, order: 0 }] as never },
      options: baseOpts({ plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } }) as never }
    return out
  }, [ventas, profs, leads, tl, dn, c.desde, c.hasta]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Lectura ejecutiva */
  const insights = useMemo(() => {
    if (!ventas) return []
    const V = ventas.filter((v) => en(v.f)), total = V.reduce((s, v) => s + v.base, 0), it: { i: typeof Activity; c: string; t: string; s: string }[] = []
    const prev = pp ? ventas.filter((v) => v.f >= pp.from && v.f <= pp.to).reduce((s, v) => s + v.base, 0) : 0
    const ase = Object.entries(sumBy(V, (v) => v.asesor || 'Sin asesor', (v) => v.base)).sort((a, b) => b[1] - a[1])[0]
    const cli = Object.entries(sumBy(V, (v) => v.cliente || 'Sin nombre', (v) => v.base)).sort((a, b) => b[1] - a[1])[0]
    const ciu = Object.entries(sumBy(V.filter((v) => v.ciudad), (v) => v.ciudad, (v) => v.base)).sort((a, b) => b[1] - a[1])[0]
    const prod: Record<string, number> = {}; V.forEach((v) => v.items.forEach((x) => { prod[x[0]] = (prod[x[0]] || 0) + x[1] })); const pr = Object.entries(prod).sort((a, b) => b[1] - a[1])[0]
    if (prev) { const p = Math.round(((total - prev) / prev) * 100); it.push({ i: TrendingUp, c: p >= 0 ? '#04896f' : '#c0392b', t: `Ventas ${p >= 0 ? 'suben' : 'bajan'} ${Math.abs(p)}%`, s: `$${money0(total)} frente a $${money0(prev)} del período anterior.` }) }
    if (ase) it.push({ i: Award, c: '#055c9d', t: 'Mejor asesor: ' + ase[0], s: `$${money0(ase[1])} · ${total ? Math.round((ase[1] / total) * 100) : 0}% de las ventas.` })
    if (cli) it.push({ i: Building2, c: '#0b2545', t: 'Cliente principal: ' + corto(cli[0], 34), s: `$${money0(cli[1])} en el período.` })
    if (pr) it.push({ i: Package, c: '#c98a1f', t: 'Equipo más vendido', s: `${corto(pr[0], 46)} · ${pr[1]} u.` })
    if (ciu) it.push({ i: MapIcon, c: '#c0392b', t: 'Ciudad líder: ' + ciu[0], s: `$${money0(ciu[1])} · ${total ? Math.round((ciu[1] / total) * 100) : 0}% de las ventas.` })
    const sf = V.filter((v) => v.estado !== 'Facturado'); if (sf.length) it.push({ i: AlertCircle, c: '#c98a1f', t: `${sf.length} venta${sf.length === 1 ? '' : 's'} por facturar`, s: `$${money0(sf.reduce((s, v) => s + v.base, 0))} pendientes en Facturación.` })
    return it
  }, [ventas, c.desde, c.hasta]) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Error_ t={err} />
  if (!g) return <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><Cargando n={3} alto={300} /></div>
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Tarjeta icono={Activity} color="var(--cyan)" titulo="Línea de tiempo de ventas" sub={tl === 'canal' ? 'Últimos 12 meses · base antes de IVA · según medio de captación' : tl === 'asesor' ? 'Últimos 12 meses · base antes de IVA · por asesor' : 'Últimos 12 meses · base antes de IVA · facturado vs pendiente'} span="lg:col-span-2" extra={<Seg valor={tl} set={setTl} ops={[['canal', 'Por canal'], ['asesor', 'Por asesor'], ['estado', 'Facturado']]} />}><Alto cfg={g.tl} /></Tarjeta>
      <Tarjeta icono={PieChart} color="var(--violet)" titulo="Composición de ventas" sub="Período seleccionado · USD · toca para filtrar" extra={<Seg valor={dn} set={setDn} ops={[['asesor', 'Asesor'], ['medio', 'Medio'], ['tipo', 'Tipo']]} />}><Alto cfg={g.dona} /></Tarjeta>
      <Tarjeta icono={CalendarRange} color="var(--amber)" titulo="Actividad del período" sub="Ventas en USD y proformas emitidas" span="lg:col-span-2"><Alto cfg={g.diario} /></Tarjeta>
      <Tarjeta icono={Filter} color="var(--primary)" titulo="Embudo del período" sub="Leads → proformas → ventas → facturadas"><Alto cfg={g.embudo} /></Tarjeta>
      <Tarjeta icono={FileText} color="var(--teal)" titulo="Proformas realizadas vs ventas" sub="Últimos 12 meses · cantidad por mes" span="lg:col-span-2"><Alto cfg={g.profs} /></Tarjeta>
      <Tarjeta icono={Sparkles} color="var(--violet)" titulo="Lectura ejecutiva" sub="Lo más destacado del período">
        <div className="space-y-2">{insights.length ? insights.map((x, k) => { const I = x.i; return <div key={k} className="ins"><span className="ic" style={{ background: x.c + '1A', color: x.c }}><I /></span><div className="min-w-0"><p className="text-[12px] font-bold text-slate-800 truncate">{x.t}</p><p className="text-[11px] text-slate-500">{x.s}</p></div></div> }) : <p className="text-xs text-slate-400">Sin datos en el período.</p>}</div>
      </Tarjeta>
    </div>
  )
}

/* ============================ Productos ============================ */
type Prod = { k: string; codigo: string; nombre: string; cat: string; u: number; ing: number; precio: number; nv: number; cuad: string }
const CUAD_COLOR: Record<string, string> = { Estrella: '#04896f', 'Alto valor': '#7c3aed', Rotación: '#c98a1f', 'Bajo aporte': '#94a3b8' }
function SecProductos({ c }: { c: Ctx }) {
  const { d: ventas, err } = useDataset('ventas', c.hasta, c.version, cargarVentas)
  const { en } = usePeriodo(c)
  const [rank, setRank] = useState('ingresos')
  const [f, setF] = useState({ min: '', max: '', uni: '', cat: '', cuad: '', q: '' })
  const [preset, setPreset] = useState('')
  const [sel, setSel] = useState('')
  const [orden, setOrden] = useState<{ k: keyof Prod; d: number } | null>(null)
  const todos = useMemo(() => {
    if (!ventas) return [] as Prod[]
    const m = new Map<string, Prod>()
    ventas.filter((v) => en(v.f)).forEach((v) => v.items.forEach((i) => {
      const k = i[4] || i[0], p = m.get(k) ?? { k, codigo: i[4], nombre: i[0], cat: i[3] || 'Sin categoría', u: 0, ing: 0, precio: 0, nv: 0, cuad: '' }
      p.u += i[1]; p.ing += i[2]; p.nv++; m.set(k, p)
    }))
    const L = [...m.values()].map((p) => ({ ...p, precio: p.u ? p.ing / p.u : 0 }))
    const med = (a: number[]) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), h = Math.floor(s.length / 2); return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 }
    const mp = med(L.map((p) => p.precio)), mu = med(L.map((p) => p.u))
    return L.map((p) => ({ ...p, cuad: p.precio >= mp && p.u >= mu ? 'Estrella' : p.precio >= mp ? 'Alto valor' : p.u >= mu ? 'Rotación' : 'Bajo aporte' }))
  }, [ventas, c.desde, c.hasta]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = todos.reduce((s, p) => s + p.ing, 0)
  const top80 = useMemo(() => { const s = [...todos].sort((a, b) => b.ing - a.ing); let acc = 0; const out = new Set<string>(); for (const p of s) { if (acc >= total * 0.8) break; out.add(p.k); acc += p.ing } return out }, [todos, total])
  const cats = [...new Set(todos.map((p) => p.cat))].sort()
  const lista = useMemo(() => {
    let L = todos.filter((p) => (!f.min || p.precio >= Number(f.min)) && (!f.max || p.precio <= Number(f.max)) && (!f.uni || p.u >= Number(f.uni)) && (!f.cat || p.cat === f.cat) && (!f.cuad || p.cuad === f.cuad) && (!f.q || normalize(p.nombre + ' ' + p.codigo).includes(normalize(f.q))))
    if (preset === 'premium') L = L.filter((p) => p.precio >= 1000)
    if (preset === 'top80') L = L.filter((p) => top80.has(p.k))
    const campo: keyof Prod = orden?.k ?? (rank === 'precio' ? 'precio' : rank === 'unidades' ? 'u' : 'ing')
    const dir = orden?.d ?? -1
    return L.sort((a, b) => { const x = a[campo], y = b[campo]; return (typeof x === 'string' ? x.localeCompare(String(y)) : Number(x) - Number(y)) * dir })
  }, [todos, f, preset, rank, orden, top80])
  const g = useMemo(() => {
    if (!ventas) return null
    const out: Record<string, ChartConfiguration> = {}
    const lt = lista.slice(0, 20), tot = lista.reduce((s, p) => s + p.ing, 0); let acc = 0
    out.pareto = { type: 'bar', data: { labels: lt.map((p) => corto(p.nombre, 18)), datasets: [
      { type: 'bar', label: 'Ingresos', data: lt.map((p) => Math.round(p.ing)), backgroundColor: '#04896f', borderRadius: 4, yAxisID: 'y' },
      { type: 'line', label: '% acumulado', data: lt.map((p) => { acc += p.ing; return tot ? Math.round((acc / tot) * 100) : 0 }), borderColor: '#c98a1f', backgroundColor: '#c98a1f', pointRadius: 2, tension: 0.3, yAxisID: 'y1' }] as never },
      options: baseOpts({ plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, y1: { position: 'right', min: 0, max: 100, ticks: { callback: (v: string | number) => v + '%' }, grid: { display: false } }, x: { ticks: { maxRotation: 70, font: { size: 8 } }, grid: { display: false } } } }) as never }
    const porCat = topEntries(sumBy(lista, (p) => p.cat, (p) => p.ing), 8)
    out.cat = { type: 'doughnut', data: { labels: porCat.map((x) => x[0]), datasets: [{ data: porCat.map((x) => Math.round(x[1])), backgroundColor: porCat.map((x, i) => (x[0] === 'Otros' ? '#cbd5e1' : PALETA[i % PALETA.length])), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '60%', onClick: (_e: unknown, els: { index: number }[]) => { if (els.length && porCat[els[0].index][0] !== 'Otros') setF((x) => ({ ...x, cat: x.cat === porCat[els[0].index][0] ? '' : porCat[els[0].index][0] })) }, plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, boxWidth: 8 } }, tooltip: { callbacks: { label: (x: any) => x.label + ': $' + money0(x.raw) } } } } as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const maxIng = Math.max(1, ...lista.map((p) => p.ing))
    out.matriz = { type: 'bubble', data: { datasets: [{ label: 'Productos', data: lista.slice(0, 120).map((p) => ({ x: p.u, y: Math.round(p.precio), r: 4 + 16 * Math.sqrt(p.ing / maxIng), p })), backgroundColor: lista.slice(0, 120).map((p) => CUAD_COLOR[p.cuad] + 'AA') }] } as never,
      options: { responsive: true, maintainAspectRatio: false, onClick: (_e: unknown, els: { index: number }[]) => { if (els.length) setSel(lista[els[0].index].k) }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it: any[]) => lista[it[0].dataIndex].nombre, label: (x: any) => `${x.raw.x} u · $${money0(x.raw.y)} c/u · $${money0(lista[x.dataIndex].ing)}` } } }, scales: { x: { title: { display: true, text: 'Unidades vendidas' }, beginAtZero: true, grid: { color: '#f1f5f9' } }, y: { title: { display: true, text: 'Precio promedio' }, ticks: usdTick, beginAtZero: true, grid: { color: '#f1f5f9' } } } } as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const months = monthKeys(c.hasta, 12), p = todos.find((x) => x.k === sel)
    if (p) {
      const rows = months.map((m) => { let u = 0, ing = 0; ventas.filter((v) => v.f.slice(0, 7) === m).forEach((v) => v.items.forEach((i) => { if ((i[4] || i[0]) === p.k) { u += i[1]; ing += i[2] } })); return [u, ing] })
      out.tend = { type: 'bar', data: { labels: months.map(monthLabel), datasets: [{ type: 'bar', label: 'Unidades', data: rows.map((r) => r[0]), backgroundColor: '#c98a1f', borderRadius: 4, yAxisID: 'y' }, { type: 'line', label: 'Ingresos USD', data: rows.map((r) => Math.round(r[1])), borderColor: '#04896f', backgroundColor: '#04896f', tension: 0.3, pointRadius: 2, yAxisID: 'y1' }] as never },
        options: baseOpts({ plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, y1: { position: 'right', beginAtZero: true, ticks: usdTick, grid: { display: false } }, x: { grid: { display: false } } } }) as never }
    }
    return out
  }, [ventas, lista, sel, todos, c.hasta]) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Error_ t={err} />
  if (!ventas || !g) return <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><Cargando n={3} alto={300} /></div>
  const unidades = lista.reduce((s, p) => s + p.u, 0), ing = lista.reduce((s, p) => s + p.ing, 0), prods = [...lista].map((p) => p.precio).sort((a, b) => a - b)
  const pk = [['Productos vendidos', lista.length], ['Unidades', money0(unidades)], ['Ingresos', '$' + money0(ing)], ['Precio promedio', '$' + money0(unidades ? ing / unidades : 0)], ['Precio mediano', '$' + money0(prods.length ? prods[Math.floor(prods.length / 2)] : 0)], ['Top 80 %', lista.filter((p) => top80.has(p.k)).length + ' productos']]
  const th = (k: keyof Prod, t: string, num = false) => <th className={num ? 'num' : ''} style={{ cursor: 'pointer' }} onClick={() => setOrden((o) => (o?.k === k ? { k, d: -o.d } : { k, d: k === 'nombre' || k === 'cat' || k === 'cuad' ? 1 : -1 }))}>{t}{orden?.k === k ? (orden.d < 0 ? ' ↓' : ' ↑') : ''}</th>
  const csv = () => { const q = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'; const rows = [['Código', 'Producto', 'Categoría', 'Unidades', 'Ingresos', 'Precio promedio', 'Perfil'], ...lista.map((p) => [p.codigo, p.nombre, p.cat, p.u, p.ing.toFixed(2), p.precio.toFixed(2), p.cuad])]; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = `productos_${c.desde}_${c.hasta}.csv`; a.click() }
  const prodSel = todos.find((p) => p.k === sel)
  return (
    <>
      <Cabecera icono={Package} titulo="Análisis de productos" sub="No solo cuántos se venden: cuánto valen, cuánto dejan y cuáles sostienen la facturación." extra={<Seg valor={rank} set={(v) => { setRank(v); setOrden(null) }} ops={[['ingresos', 'Ingresos'], ['precio', 'Precio'], ['unidades', 'Unidades']]} />} />
      <div className="card p-3 mb-3 flex items-center gap-2 flex-wrap">
        <label className="text-[10px] font-mono-spec uppercase text-slate-500 flex items-center gap-1.5">Precio $<input type="number" min="0" placeholder="mín" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} className="inp w-20 !py-1.5" /> – <input type="number" min="0" placeholder="máx" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} className="inp w-20 !py-1.5" /></label>
        <label className="text-[10px] font-mono-spec uppercase text-slate-500 flex items-center gap-1.5">Unidades ≥<input type="number" min="0" placeholder="0" value={f.uni} onChange={(e) => setF({ ...f, uni: e.target.value })} className="inp w-16 !py-1.5" /></label>
        <select value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })} className="inp !py-1.5"><option value="">Todas las categorías</option>{cats.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={f.cuad} onChange={(e) => setF({ ...f, cuad: e.target.value })} className="inp !py-1.5"><option value="">Todos los perfiles</option>{Object.keys(CUAD_COLOR).map((x) => <option key={x}>{x}</option>)}</select>
        <input type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className="inp w-48 !py-1.5" placeholder="Buscar producto o código…" />
        <div className="seg sm ml-auto"><button type="button" className={preset === 'premium' ? 'active' : ''} title="Precio unitario ≥ $1.000" onClick={() => setPreset(preset === 'premium' ? '' : 'premium')}>Equipos ≥ $1.000</button><button type="button" className={preset === 'top80' ? 'active' : ''} title="Productos que suman el 80 % de los ingresos" onClick={() => setPreset(preset === 'top80' ? '' : 'top80')}>Top 80 %</button><button type="button" onClick={() => { setPreset(''); setF({ min: '', max: '', uni: '', cat: '', cuad: '', q: '' }); setOrden(null) }}>Limpiar</button></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">{pk.map(([t, v]) => <div key={t} className="rounded-xl border border-slate-200 bg-white p-3"><p className="font-display font-bold text-base text-slate-800 truncate">{v}</p><p className="text-[10px] font-semibold uppercase font-mono-spec text-slate-500">{t}</p></div>)}</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Tarjeta icono={Target} color="var(--violet)" titulo="Matriz de valor de productos" sub="Precio promedio vs unidades · el tamaño de la burbuja es lo que facturó · toca una burbuja" span="lg:col-span-2" extra={<div className="flex gap-1.5 flex-wrap text-[10px] font-semibold">{Object.entries(CUAD_COLOR).map(([k, col]) => <span key={k} className="cuad" style={{ background: col + '1A', color: col }}>{k}</span>)}</div>}><Alto cfg={g.matriz} h="h-80" /></Tarjeta>
        <Tarjeta icono={BarChart3} color="var(--teal)" titulo="Regla 80/20" sub="Productos ordenados por ingresos · % acumulado"><Alto cfg={g.pareto} h="h-80" /></Tarjeta>
        <Tarjeta icono={Layers} color="var(--primary)" titulo="Ingresos por categoría" sub="Período · toca para filtrar"><Alto cfg={g.cat} /></Tarjeta>
        <Tarjeta icono={LineChart} color="var(--amber)" titulo={prodSel ? 'Tendencia: ' + corto(prodSel.nombre, 40) : 'Tendencia del producto'} sub="Últimos 12 meses · elige un producto en la matriz o la tabla" span="lg:col-span-2">{g.tend ? <Alto cfg={g.tend} /> : <p className="text-xs text-slate-400 py-16 text-center">Toca una burbuja o una fila de la tabla.</p>}</Tarjeta>
        <article className="card overflow-hidden lg:col-span-3">
          <div className="overflow-x-auto max-h-[520px]">
            {lista.length ? <table className="tbl"><thead><tr>{th('nombre', 'Producto')}{th('cat', 'Categoría')}{th('u', 'Unidades', true)}{th('ing', 'Ingresos', true)}{th('precio', 'Precio prom.', true)}<th className="num">% total</th>{th('cuad', 'Perfil')}</tr></thead>
              <tbody>{lista.slice(0, 300).map((p) => (
                <tr key={p.k} onClick={() => setSel(p.k)} style={{ cursor: 'pointer', background: sel === p.k ? '#eef6fd' : undefined }}>
                  <td className="max-w-[320px] truncate font-semibold text-slate-700" title={p.nombre}>{p.nombre}<span className="block text-[10px] font-mono-spec text-slate-400">{p.codigo}</span></td><td className="text-slate-500">{p.cat}</td>
                  <td className="num">{p.u}</td><td className="num font-semibold">${money(p.ing)}</td><td className="num">${money(p.precio)}</td><td className="num text-slate-500">{total ? ((p.ing / total) * 100).toFixed(1) : 0}%</td>
                  <td><span className="cuad" style={{ background: CUAD_COLOR[p.cuad] + '1A', color: CUAD_COLOR[p.cuad] }}>{p.cuad}</span></td></tr>))}</tbody></table>
              : <p className="p-6 text-center text-sm text-slate-400">No hay productos con estos filtros en el período.</p>}
          </div>
          <div className="px-4 py-2.5 border-t border-slate-100 text-[11px] text-slate-500 flex items-center gap-3"><span><b className="text-slate-700">{lista.length}</b> productos · ${money(ing)}</span><button type="button" className="btn ml-auto !py-1.5" onClick={csv}><Download />CSV</button></div>
        </article>
      </div>
    </>
  )
}

/* ============================ Equipo ============================ */
function SecEquipo({ c }: { c: Ctx }) {
  const { d: ventas, err } = useDataset('ventas', c.hasta, c.version, cargarVentas)
  const { d: profs } = useDataset('profs', c.hasta, c.version, cargarProformas)
  const { en } = usePeriodo(c)
  const g = useMemo(() => {
    if (!ventas || !profs) return null
    const V = ventas.filter((v) => en(v.f)), P = profs.filter((p) => en(p.f)), months = monthKeys(c.hasta, 12), mL = months.map(monthLabel), out: Record<string, ChartConfiguration> = {}
    out.valor = { type: 'line', data: { labels: mL, datasets: [
      { label: 'Proformado', data: months.map((m) => Math.round(profs.filter((p) => p.f.slice(0, 7) === m).reduce((s, p) => s + p.monto, 0))), borderColor: '#17a9ba', backgroundColor: '#17a9ba22', fill: true, tension: 0.35, pointRadius: 2 },
      { label: 'Vendido', data: months.map((m) => Math.round(ventas.filter((v) => v.f.slice(0, 7) === m).reduce((s, v) => s + v.base, 0))), borderColor: '#04896f', backgroundColor: '#04896f22', fill: true, tension: 0.35, pointRadius: 2 }] },
      options: baseOpts({ plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (x: any) => x.dataset.label + ': $' + money0(x.raw) } } }, scales: { y: { beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } }) as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const pa = Object.entries(sumBy(V, (v) => v.asesor || 'Sin asesor', (v) => v.base)).sort((a, b) => b[1] - a[1]).slice(0, 8)
    out.asesor = { type: 'bar', data: { labels: pa.map((x) => x[0].split(' ').slice(0, 2).join(' ')), datasets: [{ data: pa.map((x) => Math.round(x[1])), backgroundColor: pa.map((x) => (c.filtro.asesor && c.filtro.asesor !== x[0] ? '#cbd5e1' : '#055c9d')), borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, onClick: (_e: unknown, els: { index: number }[]) => { if (els.length) c.setFiltro('asesor', pa[els[0].index][0]) }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it: any[]) => pa[it[0].dataIndex][0], label: (x: any) => '$' + money0(x.raw) + ' · ' + V.filter((v) => (v.asesor || 'Sin asesor') === pa[x.dataIndex][0]).length + ' ventas' } } }, scales: { y: { beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } } } as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const nombres = [...new Set(V.map((v) => v.asesor || 'Sin asesor').concat(P.map((p) => p.asesor || 'Sin asesor')))]
    const efe = nombres.map((a) => ({ a, p: P.filter((p) => (p.asesor || 'Sin asesor') === a).length, v: V.filter((v) => (v.asesor || 'Sin asesor') === a).length })).filter((x) => x.p || x.v).sort((x, y) => y.v + y.p - (x.v + x.p)).slice(0, 8)
    out.efe = { type: 'bar', data: { labels: efe.map((x) => x.a.split(' ').slice(0, 2).join(' ')), datasets: [
      { type: 'bar', label: 'Proformas', data: efe.map((x) => x.p), backgroundColor: '#17a9ba', borderRadius: 6, yAxisID: 'y' },
      { type: 'bar', label: 'Ventas', data: efe.map((x) => x.v), backgroundColor: '#04896f', borderRadius: 6, yAxisID: 'y' },
      { type: 'line', label: '% cierre', data: efe.map((x) => (x.p ? Math.round((x.v / x.p) * 100) : 0)), borderColor: '#7c3aed', backgroundColor: '#7c3aed', pointRadius: 4, tension: 0.3, yAxisID: 'y1' }] as never },
      options: baseOpts({ plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (x: any) => (x.dataset.yAxisID === 'y1' ? 'Cierre: ' + x.raw + '%' : x.dataset.label + ': ' + x.raw) } } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, y1: { position: 'right', beginAtZero: true, max: 100, ticks: { callback: (v: string | number) => v + '%' }, grid: { display: false } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } } }) as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    return out
  }, [ventas, profs, c.desde, c.hasta, c.filtro.asesor]) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Error_ t={err} />
  if (!g) return <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><Cargando n={3} alto={300} /></div>
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Tarjeta icono={TrendingUp} color="var(--teal)" titulo="Valor proformado vs vendido" sub="Últimos 12 meses · USD antes de IVA"><Alto cfg={g.valor} /></Tarjeta>
      <Tarjeta icono={UserCheck} color="var(--primary)" titulo="Ventas por asesor" sub="Período · USD antes de IVA · toca para filtrar"><Alto cfg={g.asesor} /></Tarjeta>
      <Tarjeta icono={Award} color="var(--amber)" titulo="Efectividad por asesor" sub="Período · proformas vs ventas y % de cierre"><Alto cfg={g.efe} /></Tarjeta>
    </div>
  )
}

/* ============================ Clientes y ciudades ============================ */
const REGION: Record<string, string> = {}
;[['Costa', ['Esmeraldas', 'Manabí', 'Los Ríos', 'Guayas', 'Santa Elena', 'El Oro']], ['Sierra', ['Carchi', 'Imbabura', 'Pichincha', 'Cotopaxi', 'Tungurahua', 'Bolívar', 'Chimborazo', 'Cañar', 'Azuay', 'Loja', 'Santo Domingo de los Tsáchilas']], ['Amazonía', ['Sucumbíos', 'Napo', 'Orellana', 'Pastaza', 'Morona Santiago', 'Zamora Chinchipe']], ['Insular', ['Galápagos']]].forEach(([r, ps]) => (ps as string[]).forEach((p) => { REGION[normalize(p)] = r as string }))
function SecClientes({ c }: { c: Ctx }) {
  const { d: ventas, err } = useDataset('ventas', c.hasta, c.version, cargarVentas)
  const { d: nuevos } = useDataset('nuevos', c.hasta, c.version, cargarClientesNuevos)
  const { en, prev: pp } = usePeriodo(c)
  const [modo, setModo] = useState('ciudad')
  const { g, ranking, total } = useMemo(() => {
    if (!ventas) return { g: null, ranking: [] as { k: string; ing: number; n: number; prev: number }[], total: 0 }
    const V = ventas.filter((v) => en(v.f)), tot = V.reduce((s, v) => s + v.base, 0), out: Record<string, ChartConfiguration> = {}
    const prevV = pp ? ventas.filter((v) => v.f >= pp.from && v.f <= pp.to) : []
    const key = (v: Venta) => (modo === 'provincia' ? v.provincia : v.ciudad) || 'Sin ubicar'
    const rk = Object.entries(sumBy(V, key, (v) => v.base)).sort((a, b) => b[1] - a[1]).map(([k, ing]) => ({ k, ing, n: V.filter((v) => key(v) === k).length, prev: prevV.filter((v) => key(v) === k).reduce((s, v) => s + v.base, 0) }))
    const reg = sumBy(V, (v) => REGION[normalize(v.provincia)] || 'Sin ubicar', (v) => v.base)
    out.region = { type: 'doughnut', data: { labels: Object.keys(reg), datasets: [{ data: Object.values(reg).map(Math.round), backgroundColor: ['#04896f', '#055c9d', '#7c3aed', '#c98a1f', '#cbd5e1'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, boxWidth: 8 } }, tooltip: { callbacks: { label: (x: any) => x.label + ': $' + money0(x.raw) } } } } as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const pc = Object.entries(sumBy(V, (v) => v.cliente || 'Sin nombre', (v) => v.base)).sort((a, b) => b[1] - a[1]).slice(0, 8)
    out.cli = { type: 'bar', data: { labels: pc.map((x) => corto(x[0], 24)), datasets: [{ data: pc.map((x) => Math.round(x[1])), backgroundColor: pc.map((x) => (c.filtro.cliente && c.filtro.cliente !== x[0] ? '#cbd5e1' : '#0b2545')), borderRadius: 6 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, onClick: (_e: unknown, els: { index: number }[]) => { if (els.length) c.setFiltro('cliente', pc[els[0].index][0]) }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it: any[]) => pc[it[0].dataIndex][0], label: (x: any) => '$' + money0(x.raw) + ' · ' + V.filter((v) => (v.cliente || 'Sin nombre') === pc[x.dataIndex][0]).length + ' compra(s)' } } }, scales: { x: { beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, y: { grid: { display: false }, ticks: { font: { size: 9 } } } } } as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const months = monthKeys(c.hasta, 12)
    out.nuevos = { type: 'bar', data: { labels: months.map(monthLabel), datasets: [
      { type: 'bar', label: 'Clientes nuevos', data: months.map((m) => (nuevos ?? []).filter((f) => f.slice(0, 7) === m).length), backgroundColor: '#7c3aed', borderRadius: 6, yAxisID: 'y' },
      { type: 'line', label: 'Clientes con compra', data: months.map((m) => new Set(ventas.filter((v) => v.f.slice(0, 7) === m).map((v) => v.ident || v.cliente)).size), borderColor: '#04896f', backgroundColor: '#04896f', tension: 0.35, pointRadius: 2, yAxisID: 'y' }] as never },
      options: baseOpts({ plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } }) as never }
    return { g: out, ranking: rk, total: tot }
  }, [ventas, nuevos, modo, c.desde, c.hasta, c.filtro.cliente]) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Error_ t={err} />
  if (!g) return <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><Cargando n={3} alto={300} /></div>
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Tarjeta icono={MapIcon} color="var(--red)" titulo="Mapa comercial del Ecuador" sub="Período · provincias coloreadas y ciudades en burbujas" span="lg:col-span-2"><p className="text-xs text-slate-400 py-24 text-center">El mapa interactivo se está migrando. Mientras tanto, usa el ranking territorial y las ventas por región.</p></Tarjeta>
      <Tarjeta icono={Trophy} color="var(--amber)" titulo="Ranking territorial" sub="Período · participación y variación" extra={<Seg valor={modo} set={setModo} ops={[['ciudad', 'Ciudad'], ['provincia', 'Provincia']]} />}>
        <div className="max-h-64 overflow-y-auto space-y-1.5">{ranking.length ? ranking.slice(0, 20).map((r, i) => { const d = r.prev ? Math.round(((r.ing - r.prev) / r.prev) * 100) : null; return (
          <button type="button" key={r.k} onClick={() => c.setFiltro('ciudad', r.k)} className="w-full text-left rounded-lg border border-slate-100 px-2.5 py-1.5 hover:bg-slate-50">
            <div className="flex items-center justify-between gap-2"><span className="text-[12px] font-bold text-slate-700 truncate">{i + 1}. {r.k}</span><b className="text-[12px] text-slate-800">${money0(r.ing)}</b></div>
            <div className="flex items-center justify-between text-[10px] text-slate-400"><span>{r.n} venta{r.n === 1 ? '' : 's'} · {total ? Math.round((r.ing / total) * 100) : 0}%</span>{d != null && <span style={{ color: d >= 0 ? '#04896f' : '#c0392b' }}>{d >= 0 ? '▲' : '▼'} {Math.abs(d)}%</span>}</div></button>) }) : <p className="text-xs text-slate-400">Sin ventas con ubicación en el período.</p>}</div>
      </Tarjeta>
      <Tarjeta icono={Mountain} color="var(--teal)" titulo="Ventas por región" sub="Costa, Sierra, Amazonía e Insular"><Alto cfg={g.region} /></Tarjeta>
      <Tarjeta icono={Building2} color="var(--primary)" titulo="Top clientes" sub="Período · USD antes de IVA · toca para filtrar"><Alto cfg={g.cli} /></Tarjeta>
      <Tarjeta icono={UserPlus} color="var(--cyan)" titulo="Clientes nuevos" sub="Últimos 12 meses · registros en Clientes"><Alto cfg={g.nuevos} /></Tarjeta>
    </div>
  )
}

/* ============================ Marketing ============================ */
function SecMarketing({ c }: { c: Ctx }) {
  const { d: ventas, err } = useDataset('ventas', c.hasta, c.version, cargarVentas)
  const { d: leads } = useDataset('leads', c.hasta, c.version, cargarLeads)
  const { d: av } = useDataset('av', c.hasta, c.version, cargarAv)
  const { en } = usePeriodo(c)
  const r = useMemo(() => {
    if (!ventas || !leads || !av) return null
    const V = ventas.filter((v) => en(v.f)), L = leads.filter((l) => en(l.f)), out: Record<string, ChartConfiguration> = {}
    const canales = ['Publicidad pagada', 'Digital orgánico', 'Comercial', 'Otro', 'Sin medio']
    const filas = canales.map((x) => ({ c: x, leads: L.filter((l) => canal(l.medio) === x).length, ventas: V.filter((v) => canal(v.medio) === x).length, base: V.filter((v) => canal(v.medio) === x).reduce((s, v) => s + v.base, 0) }))
    out.canal = { type: 'bar', data: { labels: canales, datasets: [
      { type: 'bar', label: 'Leads', data: filas.map((x) => x.leads), backgroundColor: '#c98a1f', borderRadius: 6, yAxisID: 'y' },
      { type: 'bar', label: 'Ventas', data: filas.map((x) => x.ventas), backgroundColor: '#04896f', borderRadius: 6, yAxisID: 'y' },
      { type: 'line', label: '% conversión', data: filas.map((x) => (x.leads ? Math.min(100, Math.round((x.ventas / x.leads) * 100)) : 0)), borderColor: '#7c3aed', backgroundColor: '#7c3aed', pointRadius: 4, tension: 0.3, yAxisID: 'y1' }] as never },
      options: baseOpts({ plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, y1: { position: 'right', beginAtZero: true, max: 100, ticks: { callback: (v: string | number) => v + '%' }, grid: { display: false } }, x: { grid: { display: false } } } }) as never }
    const months = monthKeys(c.hasta, 12), avCol: Record<string, string> = { Foto: '#17a9ba', Video: '#e1306c', Reel: '#7c3aed', Historia: '#c98a1f', Carrusel: '#055c9d', Diseño: '#94a3b8' }
    out.cont = { type: 'bar', data: { labels: months.map(monthLabel), datasets: [
      ...Object.keys(avCol).map((t) => ({ type: 'bar', label: t, data: months.map((m) => av.filter((a) => a.tipo === t && a.estado !== 'Idea' && a.f.slice(0, 7) === m).length), backgroundColor: avCol[t], borderRadius: 4, stack: 'av', yAxisID: 'y' })).filter((d) => d.data.some(Boolean)),
      { type: 'line', label: 'Ventas marketing USD', data: months.map((m) => Math.round(ventas.filter((v) => esMk(canal(v.medio)) && v.f.slice(0, 7) === m).reduce((s, v) => s + v.base, 0))), borderColor: '#04896f', backgroundColor: '#04896f', tension: 0.35, pointRadius: 3, yAxisID: 'y1' }] as never },
      options: baseOpts({ plugins: { legend: { position: 'bottom' } }, scales: { y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Piezas' }, grid: { color: '#f1f5f9' } }, y1: { position: 'right', beginAtZero: true, ticks: usdTick, grid: { display: false } }, x: { stacked: true, grid: { display: false } } } }) as never }
    /* ¿El contenido vende? por producto */
    const vendidos: Record<string, { n: string; u: number }> = {}; ventas.forEach((v) => v.items.forEach((i) => { const k = i[4] || i[0]; vendidos[k] = vendidos[k] || { n: i[0], u: 0 }; vendidos[k].u += i[1] }))
    const piezas: Record<string, { n: string; p: number }> = {}; av.filter((a) => a.codigo && a.estado !== 'Idea').forEach((a) => { piezas[a.codigo] = piezas[a.codigo] || { n: a.producto, p: 0 }; piezas[a.codigo].p++ })
    const sinCont = Object.entries(vendidos).filter(([k]) => !piezas[k]).sort((a, b) => b[1].u - a[1].u).slice(0, 6)
    const sinVenta = Object.entries(piezas).filter(([k]) => !vendidos[k]).sort((a, b) => b[1].p - a[1].p).slice(0, 6)
    const conAmbos = Object.keys(piezas).filter((k) => vendidos[k]).sort((a, b) => vendidos[b].u - vendidos[a].u).slice(0, 8)
    out.vende = { type: 'bar', data: { labels: conAmbos.map((k) => corto(vendidos[k].n, 22)), datasets: [{ label: 'Piezas', data: conAmbos.map((k) => piezas[k].p), backgroundColor: '#e1306c', borderRadius: 4 }, { label: 'Unidades vendidas', data: conAmbos.map((k) => vendidos[k].u), backgroundColor: '#04896f', borderRadius: 4 }] },
      options: baseOpts({ plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, x: { grid: { display: false }, ticks: { font: { size: 8 } } } } }) as never }
    const anuncios = Object.entries(sumBy(L.filter((l) => l.anuncio), (l) => l.anuncio)).sort((a, b) => b[1] - a[1]).slice(0, 10)
    const mkV = V.filter((v) => esMk(canal(v.medio))), tot = V.reduce((s, v) => s + v.base, 0), mkTot = mkV.reduce((s, v) => s + v.base, 0)
    const lp = L.filter((l) => canal(l.medio) === 'Publicidad pagada').length
    const ins: string[] = []
    if (tot) ins.push(`Marketing digital aporta el ${Math.round((mkTot / tot) * 100)}% de las ventas ($${money0(mkTot)}).`)
    const mejor = [...filas].filter((x) => x.leads >= 3).sort((a, b) => b.ventas / b.leads - a.ventas / a.leads)[0]; if (mejor) ins.push(`${mejor.c} convierte mejor: ${Math.round((mejor.ventas / mejor.leads) * 100)}% de sus leads terminan en venta.`)
    if (lp) ins.push(`${lp} lead${lp === 1 ? '' : 's'} vinieron de publicidad pagada en el período.`)
    const sm = V.filter((v) => canal(v.medio) === 'Sin medio').length; if (sm) ins.push(`${sm} venta${sm === 1 ? '' : 's'} sin medio de captación: completa el dato en el CRM.`)
    return { out, filas, sinCont, sinVenta, anuncios, mkTot, tot, lp, ins, piezas: av.filter((a) => en(a.f) && a.estado !== 'Idea').length, mkVentas: mkV.length }
  }, [ventas, leads, av, c.desde, c.hasta]) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Error_ t={err} />
  if (!r) return <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><Cargando n={4} alto={280} /></div>
  const kp = [['Ventas marketing', '$' + money0(r.mkTot)], ['% del total', (r.tot ? Math.round((r.mkTot / r.tot) * 100) : 0) + '%'], ['Ventas marketing', r.mkVentas], ['Leads de publicidad', r.lp], ['Piezas producidas', r.piezas]]
  return (
    <>
      <Cabecera icono={Megaphone} titulo="Análisis de marketing" sub="Canales, contenido y campañas frente a las ventas del CRM." />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">{kp.map(([t, v], i) => <div key={i} className="rounded-xl border border-slate-200 bg-white p-3"><p className="font-display font-bold text-base text-slate-800 truncate">{v}</p><p className="text-[10px] font-semibold uppercase font-mono-spec text-slate-500">{t}</p></div>)}</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Tarjeta icono={GitCompare} color="var(--violet)" titulo="Rendimiento por canal" sub="Período · leads y ventas por canal · % de conversión" span="lg:col-span-2"><Alto cfg={r.out.canal} /></Tarjeta>
        <Tarjeta icono={Lightbulb} color="var(--amber)" titulo="Lectura de marketing" sub="Hallazgos automáticos del período"><div className="space-y-2">{r.ins.length ? r.ins.map((x, i) => <div key={i} className="ins"><span className="ic" style={{ background: '#c98a1f1A', color: '#c98a1f' }}><Lightbulb /></span><p className="text-[11.5px] text-slate-600">{x}</p></div>) : <p className="text-xs text-slate-400">Sin hallazgos.</p>}</div></Tarjeta>
        <Tarjeta icono={Clapperboard} color="#e1306c" titulo="Contenido producido vs ventas de marketing" sub="Últimos 12 meses · piezas por tipo · ventas de canales digitales" span="lg:col-span-2"><Alto cfg={r.out.cont} /></Tarjeta>
        <Tarjeta icono={ScanSearch} color="var(--teal)" titulo="¿El contenido vende?" sub="Productos: piezas producidas vs ventas (12 meses)"><Alto cfg={r.out.vende} /></Tarjeta>
        <Tarjeta icono={Video} color="var(--amber)" titulo="Venden sin contenido" sub="Prioridad para grabar · más ventas y 0 piezas"><div className="space-y-1.5">{r.sinCont.length ? r.sinCont.map(([k, x]) => <div key={k} className="flex justify-between gap-2 text-[11.5px] rounded-lg border border-slate-100 px-2.5 py-1.5"><span className="truncate text-slate-700">{x.n}</span><b className="shrink-0">{x.u} u</b></div>) : <p className="text-xs text-slate-400">Todo lo que se vende tiene contenido.</p>}</div></Tarjeta>
        <Tarjeta icono={AlertTriangle} color="var(--red)" titulo="Contenido sin ventas" sub="Revisa mensaje, precio o público"><div className="space-y-1.5">{r.sinVenta.length ? r.sinVenta.map(([k, x]) => <div key={k} className="flex justify-between gap-2 text-[11.5px] rounded-lg border border-slate-100 px-2.5 py-1.5"><span className="truncate text-slate-700">{x.n}</span><b className="shrink-0">{x.p} pieza{x.p === 1 ? '' : 's'}</b></div>) : <p className="text-xs text-slate-400">Sin hallazgos.</p>}</div></Tarjeta>
        <Tarjeta icono={Target} color="var(--violet)" titulo="Campañas y anuncios" sub="Período · leads atribuidos">{r.anuncios.length ? <div className="space-y-1.5">{r.anuncios.map(([a, n]) => <div key={a} className="flex justify-between gap-2 text-[11.5px] rounded-lg border border-slate-100 px-2.5 py-1.5"><span className="truncate text-slate-700">{a}</span><b>{n} leads</b></div>)}</div> : <p className="text-xs text-slate-400 py-6 text-center">No hay anuncios atribuidos en este período.</p>}</Tarjeta>
      </div>
    </>
  )
}

/* ============================ Agenda audiovisual ============================ */
function SecAgenda({ c }: { c: Ctx }) {
  const { d: av, err } = useDataset('av', c.hasta, c.version, cargarAv)
  const { en } = usePeriodo(c)
  const r = useMemo(() => {
    if (!av) return null
    const hoy = hoyKey(), dias = Array.from({ length: 14 }, (_, i) => keyAdd(hoy, i)), out: Record<string, ChartConfiguration> = {}
    const heat: Record<string, number> = {}; av.filter((a) => a.estado !== 'Idea').forEach((a) => { heat[a.f] = (heat[a.f] || 0) + 1 })
    const semanas = 26, lunes = keyAdd(hoy, -((new Date(hoy + 'T12:00:00Z').getUTCDay() + 6) % 7)), ini = keyAdd(lunes, -(semanas - 1) * 7)
    const max = Math.max(1, ...Object.values(heat))
    const estados = ['Idea', 'En producción', 'En edición', 'Listo', 'Programado', 'Publicado'], col = ['#94a3b8', '#c98a1f', '#7c3aed', '#17a9ba', '#055c9d', '#04896f']
    out.flujo = { type: 'doughnut', data: { labels: estados, datasets: [{ data: estados.map((e) => av.filter((a) => a.estado === e).length), backgroundColor: col, borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, boxWidth: 8 } } } } as never }
    const resp = [...new Set(av.filter((a) => en(a.f)).map((a) => a.responsable || 'Sin asignar'))].slice(0, 8)
    out.resp = { type: 'bar', data: { labels: resp.map((x) => x.split(' ').slice(0, 2).join(' ')), datasets: estados.map((e, i) => ({ label: e, data: resp.map((x) => av.filter((a) => en(a.f) && (a.responsable || 'Sin asignar') === x && a.estado === e).length), backgroundColor: col[i], stack: 's', borderRadius: 2 })) },
      options: baseOpts({ plugins: { legend: { position: 'bottom', labels: { font: { size: 9 } } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } } } }) as never }
    const total = Object.values(heat).reduce((s, n) => s + n, 0)
    return { dias, porDia: (d: string) => av.filter((a) => a.f === d), heat, ini, semanas, max, out, total, activos: Object.keys(heat).filter((d) => d >= ini).length }
  }, [av, c.desde, c.hasta]) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Error_ t={err} />
  if (!r) return <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><Cargando n={3} alto={260} /></div>
  const colorCelda = (n: number) => (n ? `rgba(4,137,111,${0.2 + 0.8 * (n / r.max)})` : '#eef2f7')
  return (
    <>
      <Cabecera icono={CalendarDays} titulo="Agenda audiovisual" sub="Qué se produce, cuándo y con qué ritmo." />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Tarjeta icono={CalendarClock} color="var(--cyan)" titulo="Próximos 14 días" sub="Piezas de Audiovisual por fecha" span="lg:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-7 gap-1.5">{r.dias.map((d) => { const L = r.porDia(d); return (
            <div key={d} className="rounded-lg border border-slate-100 p-1.5 min-h-[72px]"><p className="text-[9.5px] font-bold uppercase text-slate-400">{keyLabel(d, { weekday: 'short', day: 'numeric' })}</p>
              {L.slice(0, 3).map((a, i) => <p key={i} className="mt-0.5 text-[10px] rounded px-1 py-0.5 truncate text-white" style={{ background: a.estado === 'Publicado' ? '#04896f' : a.estado === 'Programado' ? '#055c9d' : '#94a3b8' }} title={a.titulo}>{a.titulo}</p>)}{L.length > 3 && <p className="text-[9px] text-slate-400">+{L.length - 3} más</p>}</div>) })}</div>
        </Tarjeta>
        <Tarjeta icono={Workflow} color="var(--violet)" titulo="Flujo de producción" sub="Estado actual de las piezas (12 meses)"><Alto cfg={r.out.flujo} /></Tarjeta>
        <Tarjeta icono={Grid3x3} color="var(--teal)" titulo="Ritmo de producción" sub="Piezas por día · últimas 26 semanas" span="lg:col-span-2">
          <div style={{ display: 'grid', gridTemplateRows: 'repeat(7,12px)', gridAutoFlow: 'column', gap: 3, overflowX: 'auto' }}>{Array.from({ length: r.semanas * 7 }, (_, i) => { const d = keyAdd(r.ini, i); const n = r.heat[d] || 0; return <i key={d} title={`${keyLabel(d, { day: 'numeric', month: 'short' })}: ${n} pieza${n === 1 ? '' : 's'}`} style={{ width: 12, height: 12, borderRadius: 3, background: colorCelda(n), display: 'block' }} /> })}</div>
          <p className="text-[11px] text-slate-500 mt-2">{r.total} piezas · {r.activos} días con producción</p>
        </Tarjeta>
        <Tarjeta icono={UsersRound} color="var(--primary)" titulo="Producción por responsable" sub="Período · piezas por estado"><Alto cfg={r.out.resp} /></Tarjeta>
      </div>
    </>
  )
}

/* ============================ CRM ============================ */
function SecCrm({ c }: { c: Ctx }) {
  const { d: pipe, err } = useDataset('pipe', c.hasta, c.version, cargarPipe)
  const { d: ventas } = useDataset('ventas', c.hasta, c.version, cargarVentas)
  const { d: ncs } = useDataset('nc', c.hasta, c.version, cargarNC)
  const { en } = usePeriodo(c)
  const cfg = useMemo<ChartConfiguration | null>(() => {
    if (!pipe) return null
    const orden = ['Nuevo', 'Contactado', 'Seguimiento', 'Negociación', 'Sin respuesta', 'Ganado', 'Perdido']
    const keys = Object.keys(pipe.embudo).sort((a, b) => { const ia = orden.indexOf(a), ib = orden.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) })
    const col = (k: string) => (/ganad/i.test(k) ? '#04896f' : /perdid/i.test(k) ? '#94a3b8' : /negoci/i.test(k) ? '#7c3aed' : /sin resp/i.test(k) ? '#c98a1f' : /seguim/i.test(k) ? '#17a9ba' : '#055c9d')
    return { type: 'bar', data: { labels: keys, datasets: [{ data: keys.map((k) => pipe.embudo[k]), backgroundColor: keys.map(col), borderRadius: 6, barThickness: 22 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, y: { grid: { display: false }, ticks: { font: { size: 11, weight: 600 } } } } } as never }
  }, [pipe])
  if (err) return <Error_ t={err} />
  if (!pipe) return <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><Cargando n={2} alto={280} /></div>
  const total = (ventas ?? []).filter((v) => en(v.f)).reduce((s, v) => s + v.base, 0), ncBase = (ncs ?? []).filter((n) => en(n.f)).reduce((s, n) => s + n.base, 0)
  const box = (l: string, v: string | number, s: string, col: string) => <div key={l} className="rounded-xl border border-slate-100 p-3" style={{ background: col + '0d' }}><p className="font-display font-bold text-lg" style={{ color: col }}>{v}</p><p className="text-[10px] font-semibold uppercase font-mono-spec text-slate-500">{l}</p><p className="text-[10px] text-slate-400">{s}</p></div>
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Tarjeta icono={Kanban} color="var(--violet)" titulo="Pipeline del CRM" sub="Foto actual · gestiones por estado (no depende del período)" span="lg:col-span-2" extra={<span className="pill bg-emerald-50 text-emerald-700">Actual</span>}><Alto cfg={cfg} /></Tarjeta>
      <Tarjeta icono={Gauge} color="var(--teal)" titulo="Salud comercial" sub="CRM y notas de crédito"><div className="grid grid-cols-2 gap-2">
        {box('Pipeline abierto', '$' + money0(pipe.abierto), 'valor estimado en gestión', '#7c3aed')}{box('Oportunidades', pipe.cuenta, 'gestiones activas', '#055c9d')}
        {box('Conversión CRM', pipe.tasa + '%', 'ganados / total de leads', '#04896f')}{box('Notas de crédito', (total ? Math.round((ncBase / total) * 1000) / 10 : 0) + '%', total ? '$' + money0(ncBase) + ' del total vendido' : 'sin ventas en el período', '#c0392b')}</div></Tarjeta>
    </div>
  )
}

/* ============================ Detalle de ventas ============================ */
function SecTabla({ c }: { c: Ctx }) {
  const { d: ventas, err } = useDataset('ventas', c.hasta, c.version, cargarVentas)
  const { en } = usePeriodo(c)
  const [asesor, setAsesor] = useState('')
  const [estado, setEstado] = useState('')
  const [q, setQ] = useState('')
  const [limite, setLimite] = useState(40)
  const V = useMemo(() => (ventas ?? []).filter((v) => en(v.f)), [ventas, c.desde, c.hasta]) // eslint-disable-line react-hooks/exhaustive-deps
  const lista = useMemo(() => {
    const n = normalize(q), f = c.filtro
    return V.filter((v) => (!asesor || (v.asesor || 'Sin asesor') === asesor) && (!estado || (estado === 'Facturado') === (v.estado === 'Facturado')) && (!f.asesor || (v.asesor || 'Sin asesor') === f.asesor) && (!f.cliente || (v.cliente || 'Sin nombre') === f.cliente) && (!f.ciudad || (v.ciudad || 'Sin ciudad') === f.ciudad) && (!f.medio || cleanMedio(v.medio) === f.medio) && (!f.tipo || v.tipo === f.tipo) && (!n || normalize([v.id, v.cliente, v.asesor, v.numero, v.medio, v.ciudad].join(' ')).includes(n)))
  }, [V, asesor, estado, q, c.filtro])
  if (err) return <Error_ t={err} />
  if (!ventas) return <Cargando alto={320} />
  const asesores = [...new Set(V.map((v) => v.asesor || 'Sin asesor'))].sort()
  const csv = () => { const e = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'; const rows = [['Fecha', 'ID', 'Factura', 'Cliente', 'Ciudad', 'Asesor', 'Medio', 'Estado', 'Base USD', 'Total c/IVA'], ...lista.map((v) => [v.f, v.id, v.numero, v.cliente, v.ciudad, v.asesor, cleanMedio(v.medio), v.estado, v.base.toFixed(2), v.total.toFixed(2)])]; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(e).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = `ventas_${c.desde}_${c.hasta}.csv`; a.click() }
  const chips = (Object.entries(c.filtro) as [keyof Filtro, string][]).filter(([, v]) => v)
  return (
    <article className="card overflow-hidden">
      <div className="p-4 flex items-center gap-2 flex-wrap border-b border-slate-100">
        <div className="mr-auto"><h3 className="font-display font-bold text-sm text-slate-800 flex items-center gap-2"><Receipt className="w-4 h-4 text-[var(--teal)]" />Ventas del período</h3><p className="text-[11px] text-slate-400">Facturación · base antes de IVA</p></div>
        {chips.map(([k, v]) => <span key={k} className="pill bg-slate-100 text-slate-600 flex items-center gap-1">{k}: {corto(v, 22)}<button type="button" aria-label="Quitar" onClick={() => c.setFiltro(k, '')}><X className="w-3 h-3" /></button></span>)}
        <select value={asesor} onChange={(e) => setAsesor(e.target.value)} className="inp"><option value="">Todos los asesores</option>{asesores.map((a) => <option key={a}>{a}</option>)}</select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="inp"><option value="">Todos los estados</option><option>Facturado</option><option value="Pendiente">Por facturar</option></select>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente, asesor, ID…" className="inp w-48" />
        <button type="button" className="btn" onClick={csv}><Download />CSV</button>
      </div>
      <div className="overflow-auto max-h-[560px]">
        {lista.length ? <table className="tbl"><thead><tr><th>Fecha</th><th>Venta</th><th>Cliente</th><th>Ciudad</th><th>Asesor</th><th>Medio</th><th>Estado</th><th className="num">Base USD</th><th className="num">Total c/IVA</th></tr></thead>
          <tbody>{lista.slice(0, limite).map((v) => { const cn = canal(v.medio), col = CANAL_COLOR[cn]; return (
            <tr key={v.id}><td className="whitespace-nowrap font-mono-spec text-[11px]">{keyLabel(v.f, { day: '2-digit', month: 'short', year: '2-digit' })}</td>
              <td><span className="font-mono-spec text-[11px] text-slate-500">{v.id}</span>{v.numero && <span className="block text-[10px] text-slate-400">Fact. {v.numero}</span>}</td>
              <td className="max-w-[220px] truncate font-semibold text-slate-700" title={v.cliente}>{v.cliente || '—'}</td><td className="text-slate-600">{v.ciudad || '—'}</td><td className="text-slate-600">{v.asesor || '—'}</td>
              <td><span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} /><span className="text-slate-700">{cleanMedio(v.medio)}</span></span></td>
              <td><span className="pill" style={v.estado === 'Facturado' ? { background: '#ecfaf5', color: '#04896f' } : { background: '#fff8eb', color: '#a16207' }}>{v.estado}</span></td>
              <td className="num font-semibold">${money(v.base)}</td><td className="num text-slate-500">${money(v.total)}</td></tr>) })}</tbody></table>
          : <p className="p-6 text-center text-sm text-slate-400">No hay ventas con estos filtros en el período.</p>}
      </div>
      <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-3 text-[11px] text-slate-500"><span><b className="text-slate-700">{lista.length}</b> ventas · base <b className="text-slate-700">${money(lista.reduce((s, v) => s + v.base, 0))}</b> · total c/IVA ${money(lista.reduce((s, v) => s + v.total, 0))}</span>{lista.length > limite && <button type="button" className="btn ml-auto" onClick={() => setLimite((n) => n + 40)}>Ver más</button>}</div>
    </article>
  )
}

/* ============================ Pantalla ============================ */
const NAV: [string, string, typeof LayoutGrid][] = [
  ['sec-resumen', 'Resumen', LayoutGrid], ['sec-ventas', 'Ventas', LineChart], ['sec-productos', 'Análisis de productos', Package], ['sec-equipo', 'Equipo comercial', Award], ['sec-clientes', 'Clientes y ciudades', Users],
  ['sec-marketing', 'Marketing', Megaphone], ['sec-agenda', 'Agenda audiovisual', Clapperboard], ['sec-crm', 'CRM', Filter], ['sec-tabla', 'Detalle de ventas', Table],
]
export default function Dashboard({ perfil }: { perfil: Perfil; aviso: (t: string) => void }) {
  const hoy = hoyKey()
  const [desde, setDesde] = useState(hoy.slice(0, 7) + '-01')
  const [hasta, setHasta] = useState(hoy)
  const [version, setVersion] = useState(0)
  const [filtro, setFiltroEst] = useState<Filtro>({ asesor: '', cliente: '', ciudad: '', medio: '', tipo: '' })
  const [activa, setActiva] = useState('sec-resumen')
  const setFiltro = (k: keyof Filtro, v: string) => setFiltroEst((f) => ({ ...f, [k]: f[k] === v ? '' : v }))
  const ctx: Ctx = { desde, hasta, version, filtro, setFiltro }
  const rango = (k: 'mes' | '3m' | 'anio') => { const t = hoyKey(); setHasta(t); setDesde(k === 'mes' ? t.slice(0, 7) + '-01' : k === '3m' ? monthKeys(t, 3)[0] + '-01' : t.slice(0, 4) + '-01-01') }
  const activo = (k: 'mes' | '3m' | 'anio') => { const t = hoyKey(); const m = { mes: t.slice(0, 7) + '-01', '3m': monthKeys(t, 3)[0] + '-01', anio: t.slice(0, 4) + '-01-01' }; return hasta === t && desde === m[k] }
  useEffect(() => {
    const o = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActiva(v.target.id) }, { rootMargin: '-20% 0px -70% 0px' })
    NAV.forEach(([id]) => { const el = document.getElementById(id); if (el) o.observe(el) })
    return () => o.disconnect()
  }, [])
  const ir = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="vm-dash">
      <nav id="sideNav" aria-label="Secciones">
        {NAV.map(([id, t, I]) => <button key={id} type="button" className={'nav-btn' + (activa === id ? ' active' : '')} data-tip={t} aria-label={t} onClick={() => ir(id)}><I /></button>)}
        <div className="nav-sep" />
        <button type="button" className="nav-btn" data-tip="Actualizar" aria-label="Actualizar" onClick={() => { memo.clear(); setVersion((v) => v + 1) }}><RefreshCw /></button>
      </nav>
      <header className="sticky top-0 z-30" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
        <div className="vm-head-pad max-w-[1600px] mx-auto pl-4 sm:pl-[72px] pr-4 sm:pr-6 min-h-14 py-2 flex items-center gap-3 flex-wrap">
          <div className="min-w-0"><h1 className="font-display font-bold text-white text-base sm:text-lg leading-tight">Dashboard ejecutivo</h1>
            <p className="text-[11px] text-white/60">{keyLabel(desde, { day: 'numeric', month: 'short', year: 'numeric' })} – {keyLabel(hasta, { day: 'numeric', month: 'short', year: 'numeric' })} · {perfil.nombre.split(' ')[0]}</p></div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="seg !bg-white/10">{([['mes', 'Mes'], ['3m', '3 meses'], ['anio', 'Año']] as const).map(([k, t]) => <button key={k} type="button" className={activo(k) ? 'active' : '!text-white/80'} onClick={() => rango(k)}>{t}</button>)}</div>
            <label className="flex items-center gap-1.5 text-[10px] text-white/60 font-mono-spec uppercase">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg bg-white/10 text-white text-xs px-2 py-1.5 border-0" style={{ colorScheme: 'dark' }} /></label>
            <label className="flex items-center gap-1.5 text-[10px] text-white/60 font-mono-spec uppercase">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg bg-white/10 text-white text-xs px-2 py-1.5 border-0" style={{ colorScheme: 'dark' }} /></label>
          </div>
        </div>
      </header>
      <main className="max-w-[1600px] mx-auto px-4 sm:pr-6 sm:pl-[76px] pt-5 pb-24 sm:pb-8 space-y-4">
        <Seccion id="sec-resumen" alto={220}><SecResumen c={ctx} /></Seccion>
        <Seccion id="sec-ventas"><SecVentas c={ctx} /></Seccion>
        <Seccion id="sec-productos"><SecProductos c={ctx} /></Seccion>
        <Seccion id="sec-equipo"><SecEquipo c={ctx} /></Seccion>
        <Seccion id="sec-clientes"><SecClientes c={ctx} /></Seccion>
        <Seccion id="sec-marketing"><SecMarketing c={ctx} /></Seccion>
        <Seccion id="sec-agenda"><SecAgenda c={ctx} /></Seccion>
        <Seccion id="sec-crm"><SecCrm c={ctx} /></Seccion>
        <Seccion id="sec-tabla"><SecTabla c={ctx} /></Seccion>
      </main>
    </div>
  )
}
