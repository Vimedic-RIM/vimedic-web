import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cloud, ClipboardList, Copy, FileText, HelpCircle, ListPlus, NotebookPen, PackageSearch, Pencil, RefreshCw, Search, Send, Trash2, Users, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import '../estilos/articulos.css'

/* ============================ Tipos y utilidades ============================ */
type Prod = {
  id: string; codigo: string; nombre: string; categoria: string; imagen: string; stock: number; porReparar: number; pvp: number; precioDis: number; costo: number; obsStock: string
  v90: number; v180: number; v365: number; ventasMes: number[]; ultimaVenta: string | null; ultimoIngreso: string | null; ultimoIngresoCant: number; monto12: number; ops12: number; clientes12: number
  cot90: number; cotU90: number; cotAbiertas: number; cotGanadas: number; transito: number; transitoDetalle: { codigo: string; cantidad: number; etapa: string; eta: string; proveedor: string }[]
  proveedor: string; ultimaImportacion: string; nota: string; notaPor: string; notaFecha: string | null
  ticket: number; tendencia: number
}
type Item = { id: string; nombre: string; cantidad: number; costo: number; sugerido: number; proveedor?: string }
type Lista = { id: string; codigo: string; fecha: string; creadoPor: string; proveedor: string; estado: string; items: Item[]; totalUnidades: number; totalEstimado: number; notas: string }
type Params = { ventana: number; lead: number; cob: number }
const ESTADOS = ['Borrador', 'Enviada al proveedor', 'Convertida en importación', 'Anulada']
const TABS: [string, string][] = [['pedir', 'Para pedir'], ['alertas', 'Alertas'], ['todos', 'Todos'], ['sinstock', 'Sin stock'], ['transito', 'En tránsito'], ['sinventas', 'Sin ventas'], ['listas', 'Listas de pedido']]
const ORDEN_EST: Record<string, number> = { ya: 0, pronto: 1, ok: 2, sin: 3 }
const EST_TXT: Record<string, [string, string]> = { ya: ['p-ya', 'Pedir ya'], pronto: ['p-pronto', 'Pedir pronto'], ok: ['p-ok', 'Cubierto'], sin: ['p-sin', 'Sin ventas'] }
const PK = 'vm_articulos_param_v1', LK = 'vm_articulos_lista_v1'
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ent = (n: number) => (Number(n) || 0).toLocaleString('es-EC', { maximumFractionDigits: 0 })
const dec = (n: number) => (Number(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const dfecha = (s?: string | null) => { if (!s) return '—'; const d = new Date(s.length === 10 ? s + 'T12:00:00' : s); return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) }
const thumb = (u: string) => { if (!u) return ''; const m = u.match(/\/d\/([-\w]{20,})/) || u.match(/[?&]id=([-\w]{20,})/); return m ? `https://lh3.googleusercontent.com/d/${m[1]}=w160` : /^https:\/\//.test(u) ? u : '' }
const Spin = () => <span className="spin" />

function calc(p: Prod, P: Params) {
  const meses = P.ventana / 30.4
  const vendidas = P.ventana === 365 ? p.v365 : P.ventana === 180 ? p.v180 : p.v90
  const demanda = meses > 0 ? vendidas / meses : 0
  const disponible = (Number(p.stock) || 0) + (Number(p.transito) || 0)
  const puntoPedido = demanda * P.lead, objetivo = demanda * (P.lead + P.cob)
  const sugerido = demanda > 0 ? Math.max(0, Math.ceil(objetivo - disponible)) : 0
  const cobertura = demanda > 0 ? disponible / demanda : Infinity
  let estado = 'ok'
  if (demanda <= 0) estado = 'sin'; else if (disponible < puntoPedido || (Number(p.stock) || 0) <= 0) estado = 'ya'; else if (disponible < objetivo) estado = 'pronto'
  return { vendidas, demanda, disponible, puntoPedido, objetivo, sugerido, cobertura, estado, costoRef: Number(p.costo) || 0 }
}
type Calc = ReturnType<typeof calc>
const txtCob = (c: Calc) => (c.cobertura === Infinity ? '—' : (c.cobertura > 99 ? '+99' : dec(c.cobertura)) + ' m')
function alertas(p: Prod, c: Calc, P: Params): [string, string, number][] {
  const a: [string, string, number][] = [], st = Number(p.stock) || 0
  if (st <= 0 && (c.demanda > 0 || p.cotAbiertas > 0)) a.push(['al-r', 'Agotado con demanda', 3])
  else if (c.demanda > 0 && c.cobertura < P.lead) a.push(['al-r', 'Se agota antes de que llegue', 3])
  if (p.cot90 > 0 && c.disponible < p.cotU90) a.push(['al-a', `Cotizan ${ent(p.cotU90)} u y hay ${ent(c.disponible)}`, 2])
  if (p.tendencia <= -40 && c.demanda > 0) a.push(['al-a', `Ventas bajando ${p.tendencia} %`, 1])
  if (p.tendencia >= 50 && p.v90 > 0) a.push(['al-b', `Ventas subiendo +${p.tendencia} %`, 1])
  if (c.demanda > 0 && c.cobertura !== Infinity && c.cobertura > 12) a.push(['al-b', `Sobrestock (${c.cobertura > 99 ? '+99' : Math.round(c.cobertura)} meses)`, 1])
  if (st > 0 && !p.v365) a.push(['al-g', 'Sin rotación en 12 meses', 1])
  return a
}
const pesoAl = (al: [string, string, number][]) => al.reduce((s, x) => s + x[2], 0)
const Chips = ({ al, max = 9 }: { al: [string, string, number][]; max?: number }) => <>{al.slice(0, max).map((x, i) => <span key={i} className={'al ' + x[0]}>{x[1]}</span>)}</>
const Tend = ({ t }: { t: number }) => (!t ? <span className="text-slate-400">=</span> : t > 0 ? <span className="tend-up">▲ {t} %</span> : <span className="tend-dn">▼ {Math.abs(t)} %</span>)
const Pill = ({ c }: { c: Calc }) => <span className={'pill ' + EST_TXT[c.estado][0]}>{EST_TXT[c.estado][1]}</span>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapProd = (x: any): Prod => {
  const vm: number[] = (x.ventasMes ?? []).map(Number), t3 = vm.slice(9).reduce((a, b) => a + b, 0), p3 = vm.slice(6, 9).reduce((a, b) => a + b, 0)
  const ops = Number(x.ops12) || 0, monto = Number(x.monto12) || 0
  return { ...x, v90: Number(x.v90), v180: Number(x.v180), v365: Number(x.v365), ventasMes: vm, stock: Number(x.stock), porReparar: Number(x.porReparar), pvp: Number(x.pvp), precioDis: Number(x.precioDis), costo: Number(x.costo), monto12: monto, ops12: ops, clientes12: Number(x.clientes12),
    cot90: Number(x.cot90), cotU90: Number(x.cotU90), cotAbiertas: Number(x.cotAbiertas), cotGanadas: Number(x.cotGanadas), transito: Number(x.transito), ticket: ops ? Math.round(monto / ops * 100) / 100 : 0, tendencia: p3 ? Math.round((t3 - p3) / p3 * 100) : t3 ? 100 : 0 }
}
const textoLista = (l: { codigo?: string; proveedor: string; notas: string; items: Item[] }) => `Lista de pedido${l.codigo ? ' ' + l.codigo : ''} — VIMEDIC${l.proveedor ? '\nProveedor: ' + l.proveedor : ''}\n\n${l.items.map((it) => `• ${it.id} — ${it.nombre}: ${it.cantidad} u`).join('\n')}\n\nTotal: ${l.items.reduce((a, it) => a + Number(it.cantidad || 0), 0)} unidades${l.notas ? '\nNotas: ' + l.notas : ''}`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapLista = (x: any): Lista => ({ id: x.id, codigo: x.codigo ?? '', fecha: x.fecha, creadoPor: x.creador?.nombre ?? '', proveedor: x.proveedor_texto ?? '', estado: x.estado ?? 'Borrador', items: Array.isArray(x.items) ? x.items : [], totalUnidades: x.total_unidades ?? 0, totalEstimado: Number(x.total_estimado) || 0, notas: x.notas ?? '' })

/* ============================ Pantalla principal ============================ */
export default function Articulos({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [prods, setProds] = useState<Prod[] | null>(null)
  const [listas, setListas] = useState<Lista[]>([])
  const [error, setError] = useState('')
  const [P, setP] = useState<Params>(() => { try { return { ventana: 90, lead: 3, cob: 4, ...JSON.parse(localStorage.getItem(PK) || '{}') } } catch { return { ventana: 90, lead: 3, cob: 4 } } })
  const [tab, setTab] = useState('pedir')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [orden, setOrden] = useState('urgencia')
  const [SEL, setSEL] = useState<Record<string, number>>({})
  const [edit, setEdit] = useState<string | null>(null) // id de la lista que se edita
  const [meta, setMeta] = useState({ proveedor: '', notas: '' })
  const [estadoG, setEstadoG] = useState('')
  const [hoja, setHoja] = useState<'lista' | 'ayuda' | { det: string } | null>(null)
  const editar = puede(perfil, 'importaciones', 'editar')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const guardando = useRef(false), pendiente = useRef(false)
  const estado = useRef({ SEL, edit, meta, P }); estado.current = { SEL, edit, meta, P }
  const prodsRef = useRef<Prod[] | null>(null); prodsRef.current = prods

  useEffect(() => { try { localStorage.setItem(PK, JSON.stringify(P)) } catch { /* sin almacenamiento */ } }, [P])
  const cargarListas = useCallback(async () => {
    const { data } = await supabase.from('imp_listas_pedido').select('id,codigo,fecha,proveedor_texto,estado,items,total_unidades,total_estimado,notas,creador:empleados!imp_listas_pedido_creado_por_fkey(nombre)').is('deleted_at', null).order('codigo', { ascending: false }).limit(300)
    const l = (data ?? []).map(mapLista); setListas(l); return l
  }, [])
  const cargar = useCallback(async () => {
    const [a, l] = await Promise.all([supabase.rpc('art_analisis'), cargarListas()])
    if (a.error) { setError(a.error.message); return }
    setError(''); const mp = ((a.data ?? []) as unknown[]).map(mapProd); setProds(mp)
    // retomar la lista que se estaba armando
    if (!estado.current.edit && !Object.keys(estado.current.SEL).length) {
      let previa = ''; try { previa = localStorage.getItem(LK) || '' } catch { /* nada */ }
      const x = previa ? l.find((y) => y.id === previa && (y.estado === 'Borrador' || y.estado === 'Enviada al proveedor')) : null
      if (x) { setEdit(x.id); setMeta({ proveedor: x.proveedor, notas: x.notas }); setSEL(Object.fromEntries(x.items.map((i) => [mp.find((p) => p.codigo === i.id)?.id ?? i.id, i.cantidad]))); setEstadoG('Guardada · ' + x.codigo) }
    }
  }, [cargarListas])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { const f = () => { if (timer.current) { clearTimeout(timer.current); void guardarYa() } }; window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f) }) // eslint-disable-line react-hooks/exhaustive-deps

  const filas = useMemo(() => (prods ?? []).map((p) => ({ p, c: calc(p, P) })), [prods, P])
  const enTab = (p: Prod, c: Calc, t: string) => t === 'pedir' ? c.sugerido > 0 : t === 'alertas' ? alertas(p, c, P).some((x) => x[2] >= 2) : t === 'sinstock' ? (Number(p.stock) || 0) <= 0 : t === 'transito' ? p.transito > 0 : t === 'sinventas' ? c.demanda <= 0 : true
  const cats = useMemo(() => [...new Set((prods ?? []).map((p) => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [prods])
  const itemsSel = (): Item[] => Object.keys(SEL).map((id) => { const p = (prods ?? []).find((x) => x.id === id); const c = p ? calc(p, P) : { costoRef: 0, sugerido: 0 }; return { id: p?.codigo ?? id, nombre: p?.nombre ?? id, cantidad: SEL[id], costo: c.costoRef, sugerido: c.sugerido, proveedor: p?.proveedor ?? '' } })

  /* Guardado automático de la lista de pedido */
  async function guardarYa() {
    timer.current = null
    if (guardando.current) { pendiente.current = true; return }
    const { SEL: S, edit: e, meta: m, P: pp } = estado.current
    if (!Object.keys(S).length && !e) return
    guardando.current = true
    const items = Object.keys(S).map((id) => { const p = prodsRef.current?.find((x) => x.id === id); const c = p ? calc(p, pp) : { costoRef: 0, sugerido: 0 }; return { id: p?.codigo ?? id, nombre: p?.nombre ?? id, cantidad: S[id], costo: c.costoRef, sugerido: c.sugerido } })
    const totalU = items.reduce((a, i) => a + i.cantidad, 0), totalE = Math.round(items.reduce((a, i) => a + i.cantidad * i.costo, 0) * 100) / 100
    try {
      if (items.length > 300) throw new Error('La lista tiene demasiados productos (máximo 300).')
      const campos = { proveedor_texto: m.proveedor.slice(0, 160) || null, items, total_unidades: totalU, total_estimado: totalE, notas: m.notas.slice(0, 1500) || null, parametros: pp, actualizado_por: perfil.id }
      if (e) {
        const ex = listas.find((l) => l.id === e); if (ex && (ex.estado === 'Anulada' || ex.estado === 'Convertida en importación')) throw new Error(`Esta lista ya está "${ex.estado}" y no se puede cambiar.`)
        const { error } = await supabase.from('imp_listas_pedido').update(campos).eq('id', e); if (error) throw new Error(error.message)
      } else {
        if (!items.length) { guardando.current = false; return }
        const anio = new Date().getFullYear(), pref = `LP-${anio}-`
        const { data: ult } = await supabase.from('imp_listas_pedido').select('codigo').like('codigo', pref + '%').order('codigo', { ascending: false }).limit(1)
        const n = (ult?.[0]?.codigo ? Number(String(ult[0].codigo).slice(pref.length)) || 0 : 0) + 1
        const id = crypto.randomUUID(), codigo = pref + String(n).padStart(3, '0')
        const { error } = await supabase.from('imp_listas_pedido').insert({ id, codigo, estado: 'Borrador', creado_por: perfil.id, ...campos }); if (error) throw new Error(error.message)
        setEdit(id); estado.current.edit = id; try { localStorage.setItem(LK, id) } catch { /* nada */ } aviso(`Se creó la lista ${codigo} (borrador). Todo se guarda solo.`)
      }
      guardando.current = false
      setEstadoG('Guardado ✓ ' + new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })); cargarListas()
      if (pendiente.current) { pendiente.current = false; void guardarYa() }
    } catch (err) { guardando.current = false; setEstadoG('Sin guardar'); aviso((err as Error).message) }
  }
  const autoguardar = (inmediato?: boolean) => { setEstadoG('Guardando…'); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void guardarYa(), inmediato ? 0 : 1200) }
  const cambiarSel = (fn: (s: Record<string, number>) => Record<string, number>) => { setSEL((s) => { const n = fn(s); estado.current.SEL = n; return n }); autoguardar() }
  const cambiarMeta = (m: { proveedor: string; notas: string }) => { setMeta(m); estado.current.meta = m; autoguardar() }
  function terminar() {
    if (timer.current) { clearTimeout(timer.current); void guardarYa() }
    setSEL({}); setEdit(null); setMeta({ proveedor: '', notas: '' }); setEstadoG(''); estado.current = { ...estado.current, SEL: {}, edit: null, meta: { proveedor: '', notas: '' } }
    try { localStorage.removeItem(LK) } catch { /* nada */ }
  }

  /* Listado */
  const lista = useMemo(() => {
    const w = norm(q).split(/\s+/).filter(Boolean)
    const l = filas.filter((x) => enTab(x.p, x.c, tab) && (!cat || x.p.categoria === cat) && (!w.length || w.every((t) => norm([x.p.codigo, x.p.nombre, x.p.categoria, x.p.proveedor, x.p.nota].join(' ')).includes(t)))).map((x) => ({ ...x, al: alertas(x.p, x.c, P) }))
    l.sort((a, b) => {
      if (orden === 'monto') return b.p.monto12 - a.p.monto12
      if (orden === 'cotiz') return b.p.cotU90 - a.p.cotU90 || b.p.cot90 - a.p.cot90
      if (orden === 'alertas' || (tab === 'alertas' && orden === 'urgencia')) return pesoAl(b.al) - pesoAl(a.al) || b.c.demanda - a.c.demanda
      if (orden === 'sugerido') return b.c.sugerido - a.c.sugerido
      if (orden === 'ventas') return b.c.demanda - a.c.demanda
      if (orden === 'nombre') return a.p.nombre.localeCompare(b.p.nombre)
      return ORDEN_EST[a.c.estado] - ORDEN_EST[b.c.estado] || (a.c.cobertura === Infinity ? 1e9 : a.c.cobertura) - (b.c.cobertura === Infinity ? 1e9 : b.c.cobertura) || b.c.sugerido - a.c.sugerido
    })
    return l
  }, [filas, tab, cat, q, orden, P]) // eslint-disable-line react-hooks/exhaustive-deps

  const pedir = filas.filter((x) => x.c.sugerido > 0)
  const valor = pedir.reduce((a, x) => a + x.c.sugerido * x.c.costoRef, 0), sinCosto = pedir.filter((x) => !x.c.costoRef).length
  const conAl = filas.filter((x) => alertas(x.p, x.c, P).some((a) => a[2] >= 2)).length
  const kpis: [string, string, string][] = [['Productos visibles', ent(filas.length), ''], ['Con alertas', ent(conAl), conAl ? 'alerta' : ''], ['Pedir ya', ent(filas.filter((x) => x.c.estado === 'ya').length), filas.some((x) => x.c.estado === 'ya') ? 'alerta' : ''],
    ['Sin stock', ent(filas.filter((x) => (Number(x.p.stock) || 0) <= 0).length), ''], ['Unidades en tránsito', ent(filas.reduce((a, x) => a + (Number(x.p.transito) || 0), 0)), ''], ['Valor sugerido' + (sinCosto ? ` (${sinCosto} sin costo)` : ''), money(valor), '']]
  const conSug = lista.filter((x) => x.c.sugerido > 0 && !(x.p.id in SEL))
  const ids = Object.keys(SEL), uni = ids.reduce((a, id) => a + SEL[id], 0)
  const val = ids.reduce((a, id) => { const p = (prods ?? []).find((x) => x.id === id); return a + (p ? SEL[id] * calc(p, P).costoRef : 0) }, 0)
  const alternar = (id: string, c: Calc) => cambiarSel((s) => { const n = { ...s }; if (id in n) delete n[id]; else n[id] = c.sugerido || 1; return n })
  const fijarQty = (id: string, v: number) => cambiarSel((s) => { const n = { ...s }; if (v > 0) n[id] = v; else delete n[id]; return n })

  return (
    <div className="vm-art">
      <header className="hdr text-white">
        <div className="max-w-[1200px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap vm-head-pad">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><PackageSearch style={{ width: 20, height: 20 }} /></div>
          <div className="min-w-0"><h1 className="font-display font-bold text-lg leading-tight">Artículos a importar</h1><p className="text-[11px] text-white/70">Productos visibles al público · stock, tránsito, ventas y cantidad sugerida · {perfil.nombre}</p></div>
          <div className="ml-auto flex gap-2"><button className="btn btn-sm !bg-white/10 !border-white/20 !text-white" onClick={() => setHoja('ayuda')}><HelpCircle />Cómo se calcula</button><button className="btn btn-sm !bg-white/10 !border-white/20 !text-white" title="Actualizar" onClick={cargar}><RefreshCw /></button></div>
        </div>
      </header>
      <main className="max-w-[1200px] mx-auto px-4 py-4 space-y-3">
        <section className="sec grid gap-3 grid-cols-2 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div className="col-span-2 sm:col-span-1"><label className="f">Ventas a considerar</label><div className="seg">{([[90, 'Últimos 90 días'], [180, '180 días'], [365, '12 meses']] as const).map(([v, t]) => <button key={v} className={P.ventana === v ? 'on' : ''} onClick={() => setP({ ...P, ventana: v })}>{t}</button>)}</div></div>
          <label className="f">Llegada (meses)<input type="number" min={0.5} max={12} step={0.5} className="inp" inputMode="decimal" value={P.lead} onChange={(e) => setP({ ...P, lead: Math.min(12, Math.max(0.5, Number(e.target.value) || 3)) })} /></label>
          <label className="f">Cobertura deseada (meses)<input type="number" min={0} max={24} step={0.5} className="inp" inputMode="decimal" value={P.cob} onChange={(e) => setP({ ...P, cob: Math.min(24, Math.max(0, Number(e.target.value) || 0)) })} /></label>
        </section>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">{kpis.map(([t, n, c]) => <div key={t} className={'kpi ' + c}><b>{n}</b><span>{t}</span></div>)}</div>
        <div className="tabs">{TABS.map(([k, t]) => <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{t}<b>{k === 'listas' ? listas.filter((l) => l.estado !== 'Anulada').length : filas.filter((x) => enTab(x.p, x.c, k)).length}</b></button>)}</div>
        {tab !== 'listas' && (
          <div className="grid gap-2 sm:grid-cols-[1fr_220px_200px]">
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp !pl-9" placeholder="Buscar producto, código, categoría o proveedor…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <select className="inp" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas las categorías</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
            <select className="inp" value={orden} onChange={(e) => setOrden(e.target.value)}><option value="urgencia">Ordenar: más urgentes</option><option value="sugerido">Ordenar: mayor sugerido</option><option value="ventas">Ordenar: más vendidos</option><option value="monto">Ordenar: mayor venta en $ (12 meses)</option><option value="cotiz">Ordenar: más cotizados</option><option value="alertas">Ordenar: más alertas</option><option value="nombre">Ordenar: nombre</option></select>
          </div>
        )}
        {error && <div className="sec text-center py-10"><b className="text-[var(--red)]">No se pudo cargar</b><p className="ayuda mt-1">{error}</p><button className="btn btn-sm mt-3" onClick={cargar}>Reintentar</button></div>}
        {!error && prods === null && <div className="text-center py-14 text-slate-400"><Spin /> Cargando productos…</div>}
        {tab !== 'listas' && editar && conSug.length > 0 && <div className="flex gap-2 flex-wrap"><button className="btn btn-sm" onClick={() => { cambiarSel((s) => { const n = { ...s }; conSug.forEach((x) => (n[x.p.id] = x.c.sugerido)); return n }); aviso(conSug.length + ' productos agregados') }}><ListPlus />Agregar los {conSug.length} sugeridos a la lista</button></div>}
        {prods && tab !== 'listas' && !lista.length && <div className="sec text-center py-10 text-slate-500">{tab === 'pedir' ? 'Con estos parámetros ningún producto necesita pedido.' : tab === 'alertas' ? 'Sin alertas importantes con estos parámetros.' : 'No hay productos en esta vista.'}</div>}
        {prods && tab !== 'listas' && lista.length > 0 && (
          <>
            <div className="hidden md:block sec !p-0 overflow-hidden"><div className="scroll" style={{ maxHeight: 'calc(100vh - 140px)' }}>
              <table className="tabla"><thead><tr><th /><th>Producto</th><th>Estado</th><th className="num">Stock</th><th className="num">Tránsito</th><th className="num">Ventas/mes</th><th className="num" title="Ventas en dólares de los últimos 12 meses">Ventas 12 m</th><th className="num" title="Unidades cotizadas en los últimos 90 días">Cotizado 90 d</th><th className="num">Cobertura</th><th className="num">Sugerido</th><th className="num">Pedir</th><th className="num">Costo ref.</th><th>Proveedor</th></tr></thead>
                <tbody>{lista.slice(0, 300).map(({ p, c, al }) => { const s = p.id in SEL, img = thumb(p.imagen); return (
                  <tr key={p.id} className={s ? 'sel' : ''}>
                    <td><input type="checkbox" className="chk" disabled={!editar} checked={s} aria-label={'Seleccionar ' + p.nombre} onChange={() => alternar(p.id, c)} /></td>
                    <td><div className="flex items-center gap-2 min-w-[220px]">{img ? <img className="thumb" loading="lazy" src={img} alt="" /> : <div className="thumb" />}
                      <button className="text-left min-w-0" onClick={() => setHoja({ det: p.id })}><b className="block text-[13px] text-[var(--navy)] leading-snug">{p.nombre}</b><span className="mono text-[11px] text-slate-500">{p.codigo}</span>{p.categoria && <span className="text-[11px] text-slate-400"> · {p.categoria}</span>}{al.length > 0 && <div><Chips al={al} max={3} /></div>}{p.nota && <div className="nota" title={p.nota}>📝 {p.nota}</div>}</button></div></td>
                    <td><Pill c={c} /></td>
                    <td className="num"><b>{ent(p.stock)}</b>{p.porReparar > 0 && <div className="text-[10.5px] text-amber-700">+{ent(p.porReparar)} por reparar</div>}</td>
                    <td className="num">{p.transito ? <button className="pill p-tr" onClick={() => setHoja({ det: p.id })}>{ent(p.transito)}</button> : <span className="text-slate-300">0</span>}</td>
                    <td className="num">{dec(c.demanda)}<div className="text-[10.5px]"><Tend t={p.tendencia} /></div></td>
                    <td className="num">{p.monto12 ? <>{money(p.monto12)}<div className="text-[10.5px] text-slate-500">{ent(p.clientes12)} cliente(s)</div></> : <span className="text-slate-300">—</span>}</td>
                    <td className="num">{p.cot90 ? <><b>{ent(p.cotU90)}</b> u<div className="text-[10.5px] text-slate-500">{ent(p.cot90)} cotiz.{p.cotAbiertas ? ` · ${ent(p.cotAbiertas)} abiertas` : ''}</div></> : <span className="text-slate-300">—</span>}</td>
                    <td className="num">{txtCob(c)}</td>
                    <td className="num"><b className={c.sugerido ? 'text-[var(--acc)]' : 'text-slate-300'}>{ent(c.sugerido)}</b></td>
                    <td className="num"><input className="inp qty" type="number" min={0} step={1} inputMode="numeric" disabled={!editar} value={s ? SEL[p.id] : ''} placeholder={String(c.sugerido || 0)} aria-label="Cantidad a pedir" onChange={(e) => fijarQty(p.id, Math.max(0, Math.round(Number(e.target.value) || 0)))} /></td>
                    <td className="num">{c.costoRef ? money(c.costoRef) : <span className="text-slate-300">—</span>}</td>
                    <td className="text-[12px] text-slate-600 max-w-[160px] truncate" title={p.proveedor}>{p.proveedor || '—'}</td></tr>) })}</tbody></table></div></div>
            <div className="md:hidden grid gap-2">{lista.slice(0, 200).map(({ p, c, al }) => { const s = p.id in SEL, img = thumb(p.imagen); return (
              <div key={p.id} className={'card' + (s ? ' sel' : '')}><div className="flex items-start gap-3">{img ? <img className="thumb" loading="lazy" src={img} alt="" /> : <div className="thumb" />}
                <button className="text-left min-w-0 flex-1" onClick={() => setHoja({ det: p.id })}><b className="block text-[13.5px] text-[var(--navy)] leading-snug">{p.nombre}</b><span className="mono text-[11px] text-slate-500">{p.codigo}</span></button><Pill c={c} /></div>
                {al.length > 0 && <div className="mt-1"><Chips al={al} max={3} /></div>}{p.nota && <div className="nota">📝 {p.nota}</div>}
                <div className="flex gap-3 flex-wrap text-[11.5px] text-slate-600 mt-2"><span>12 m: <b>{money(p.monto12)}</b> <Tend t={p.tendencia} /></span><span>Cotizado 90 d: <b>{ent(p.cotU90)}</b> u</span></div>
                <div className="mini"><div><b>{ent(p.stock)}</b><span>Stock</span></div><div><b>{ent(p.transito)}</b><span>Tránsito</span></div><div><b>{dec(c.demanda)}</b><span>Ventas/mes</span></div><div><b className="text-[var(--acc)]">{ent(c.sugerido)}</b><span>Sugerido</span></div></div>
                <div className="flex items-center gap-2 mt-3"><label className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-600"><input type="checkbox" className="chk" disabled={!editar} checked={s} onChange={() => alternar(p.id, c)} />En la lista</label>
                  <input className="inp qty ml-auto" type="number" min={0} step={1} inputMode="numeric" disabled={!editar} value={s ? SEL[p.id] : ''} placeholder={String(c.sugerido || 0)} onChange={(e) => fijarQty(p.id, Math.max(0, Math.round(Number(e.target.value) || 0)))} /></div></div>) })}</div>
            <p className="ayuda mt-2">{lista.length} producto(s){lista.length > 300 ? ' (se muestran 300; afina con los filtros)' : ''}. Costo ref. = costo de importación del inventario.</p>
          </>
        )}
        {tab === 'listas' && (
          !listas.length ? <div className="sec text-center py-10 text-slate-500">Todavía no hay listas. Marca productos en “Para pedir”: la lista se crea y se guarda sola.</div> : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{listas.map((x) => (
              <div key={x.id} className="card"><div className="flex items-center gap-2"><span className="mono font-semibold text-[var(--navy)]">{x.codigo}</span><span className={'pill ' + (x.estado === 'Enviada al proveedor' ? 'l-enviada' : x.estado === 'Convertida en importación' ? 'l-convertida' : x.estado === 'Anulada' ? 'l-anulada' : 'l-borrador')}>{x.estado}</span></div>
                <p className="text-[13px] font-semibold mt-1">{x.proveedor || 'Sin proveedor'}</p>
                <p className="ayuda">{x.items.length} producto(s) · {ent(x.totalUnidades)} u · {money(x.totalEstimado)}<br />{dfecha(x.fecha)} · {x.creadoPor}</p>{x.notas && <p className="text-[12px] text-slate-600 mt-1">{x.notas}</p>}
                <div className="flex gap-2 flex-wrap mt-3">
                  <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(textoLista(x)).then(() => aviso('Lista copiada'))}><Copy />Copiar</button>
                  {editar && (x.estado === 'Borrador' || x.estado === 'Enviada al proveedor') && <button className="btn btn-sm" onClick={() => { if (timer.current) { clearTimeout(timer.current); void guardarYa() } const n = Object.fromEntries(x.items.map((i) => [(prods ?? []).find((p) => p.codigo === i.id)?.id ?? i.id, i.cantidad])); setSEL(n); setEdit(x.id); setMeta({ proveedor: x.proveedor, notas: x.notas }); estado.current = { ...estado.current, SEL: n, edit: x.id, meta: { proveedor: x.proveedor, notas: x.notas } }; setEstadoG('Guardada · ' + x.codigo); try { localStorage.setItem(LK, x.id) } catch { /* nada */ } setTab('pedir'); setHoja('lista') }}><Pencil />Editar</button>}
                  {editar && x.estado === 'Borrador' && <button className="btn btn-sm" onClick={() => cambiarEstado(x, 'Enviada al proveedor')}>Marcar enviada</button>}
                  {editar && x.estado === 'Enviada al proveedor' && <button className="btn btn-sm" onClick={() => cambiarEstado(x, 'Convertida en importación')}>Ya es importación</button>}
                  {editar && x.estado !== 'Anulada' && x.estado !== 'Convertida en importación' && <button className="btn btn-sm btn-red" onClick={() => { if (confirm('¿Anular la lista ' + x.codigo + '?')) cambiarEstado(x, 'Anulada') }}>Anular</button>}</div></div>))}</div>
          )
        )}
      </main>
      {(ids.length > 0 || edit) && (
        <div className="barra"><div className="max-w-[1200px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="min-w-0 text-sm"><b>{edit ? 'Lista ' + (listas.find((l) => l.id === edit)?.codigo ?? '') + ' · ' : 'Lista nueva · '}{ids.length} producto(s) · {ent(uni)} unidades</b><div className="text-[11px] text-white/70">Valor estimado {money(val)}{estadoG ? ' · ' + estadoG : ''}</div></div>
          <div className="ml-auto flex gap-2"><button className="btn btn-sm !bg-white/10 !border-white/20 !text-white" title="La lista actual queda guardada como borrador" onClick={() => { if (edit) aviso('La lista quedó guardada en “Listas de pedido”.'); terminar() }}>Nueva lista</button><button className="btn btn-sm !bg-white !text-[var(--navy)]" onClick={() => setHoja('lista')}><ClipboardList />Ver lista</button></div></div></div>
      )}
      {hoja === 'ayuda' && <Ayuda cerrar={() => setHoja(null)} />}
      {hoja === 'lista' && <RevisarLista items={itemsSel()} edit={edit} codigo={listas.find((l) => l.id === edit)?.codigo ?? ''} meta={meta} estadoG={estadoG} proveedores={[...new Set((prods ?? []).map((p) => p.proveedor).concat(listas.map((l) => l.proveedor)).filter(Boolean))]} cerrar={() => setHoja(null)}
        cambiarMeta={cambiarMeta} cambiarQty={(id, v) => { const p = (prods ?? []).find((x) => x.codigo === id || x.id === id); fijarQty(p?.id ?? id, v) }} quitar={(id) => { const p = (prods ?? []).find((x) => x.codigo === id || x.id === id); fijarQty(p?.id ?? id, 0) }}
        marcarEnviada={async () => { if (timer.current) { clearTimeout(timer.current); await guardarYa() } const x = listas.find((l) => l.id === estado.current.edit); if (x) { await cambiarEstado(x, 'Enviada al proveedor'); setHoja(null); terminar(); setTab('listas') } }} />}
      {hoja && typeof hoja === 'object' && (() => { const p = (prods ?? []).find((x) => x.id === hoja.det); return p ? <Detalle p={p} P={P} perfil={perfil} editar={editar} enLista={p.id in SEL} alternar={() => alternar(p.id, calc(p, P))} aviso={aviso} cerrar={() => setHoja(null)} guardarNota={(texto, por, fecha) => setProds((a) => (a ?? []).map((x) => (x.id === p.id ? { ...x, nota: texto, notaPor: por, notaFecha: fecha } : x)))} /> : null })()}
    </div>
  )

  async function cambiarEstado(x: Lista, est: string) {
    const { error } = await supabase.from('imp_listas_pedido').update({ estado: est, actualizado_por: perfil.id }).eq('id', x.id)
    if (error) { aviso(error.message); return }
    await cargarListas(); if (x.id === estado.current.edit && est !== 'Enviada al proveedor') terminar(); aviso('Lista actualizada')
  }
}

function Hoja({ cerrar, children }: { cerrar: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  return <div className="ovl" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}><div className="sheet" role="dialog" aria-modal="true">{children}</div></div>
}
function Ayuda({ cerrar }: { cerrar: () => void }) {
  return (
    <Hoja cerrar={cerrar}><div className="flex items-center gap-2 mb-3"><h3 className="font-display font-bold text-[var(--navy)]">Cómo se calcula</h3><button className="btn btn-sm ml-auto" onClick={cerrar} aria-label="Cerrar"><X /></button></div>
      <div className="ayuda space-y-2 text-[13px]">
        <p>Solo aparecen los productos <b>visibles al público</b> (en catálogo y sin ocultar).</p>
        <p><b>Ventas/mes</b>: salidas registradas en Movimientos en la ventana elegida, divididas para los meses de esa ventana.</p>
        <p><b>Tránsito</b>: unidades de importaciones que todavía no se ingresaron a bodega (módulo Importaciones).</p>
        <p><b>Punto de pedido</b> = ventas/mes × tiempo de llegada. Si stock + tránsito está por debajo, el producto se marca <span className="pill p-ya">Pedir ya</span>: se acabará antes de que llegue lo nuevo.</p>
        <p><b>Objetivo</b> = ventas/mes × (tiempo de llegada + cobertura deseada). Si stock + tránsito no lo alcanza: <span className="pill p-pronto">Pedir pronto</span>.</p>
        <p><b>Sugerido</b> = objetivo − (stock + tránsito), redondeado hacia arriba. Los equipos por reparar no cuentan como stock.</p>
        <p>Los productos sin ventas en la ventana no tienen sugerido: decide la cantidad a mano si hace falta.</p>
        <p><b>Alertas</b>: <span className="al al-r">Agotado con demanda</span> / <span className="al al-r">Se agota antes de que llegue</span> (cobertura menor al tiempo de llegada), <span className="al al-a">Cotizan más de lo que hay</span> (cotizaciones de 90 días &gt; stock + tránsito), tendencia de ventas (últimos 3 meses contra los 3 anteriores), sobrestock (más de 12 meses) y sin rotación.</p>
        <p><b>Todo se guarda solo</b>: al marcar productos se crea una lista borrador y cada cambio (cantidades, proveedor, notas) se guarda en segundos. Las observaciones de cada producto también se guardan mientras escribes.</p></div></Hoja>
  )
}

function RevisarLista({ items, edit, codigo, meta, estadoG, proveedores, cerrar, cambiarMeta, cambiarQty, quitar, marcarEnviada }: { items: Item[]; edit: string | null; codigo: string; meta: { proveedor: string; notas: string }; estadoG: string; proveedores: string[]; cerrar: () => void
  cambiarMeta: (m: { proveedor: string; notas: string }) => void; cambiarQty: (id: string, v: number) => void; quitar: (id: string) => void; marcarEnviada: () => Promise<void> }) {
  const total = items.reduce((a, i) => a + i.cantidad * i.costo, 0)
  const [ocupado, setOcupado] = useState(false)
  const provs = [...new Set(items.map((i) => i.proveedor).filter(Boolean))] as string[]
  return (
    <Hoja cerrar={cerrar}><div className="flex items-center gap-2 mb-1"><h3 className="font-display font-bold text-[var(--navy)]">{edit ? 'Lista ' + codigo : 'Nueva lista de pedido'}</h3><button className="btn btn-sm ml-auto" onClick={cerrar} aria-label="Cerrar"><X /></button></div>
      <p className="estado-g mb-3"><Cloud style={{ width: 13, height: 13, verticalAlign: -2 }} /> {estadoG || 'Se guarda sola'}</p>
      <div className="grid gap-2 sm:grid-cols-2"><label className="f">Proveedor<input className="inp" list="dlProv" value={meta.proveedor} placeholder="Nombre del proveedor" onChange={(e) => cambiarMeta({ ...meta, proveedor: e.target.value })} /></label><label className="f">Notas<input className="inp" value={meta.notas} placeholder="Ej. consolidar con el próximo embarque" onChange={(e) => cambiarMeta({ ...meta, notas: e.target.value })} /></label></div>
      <datalist id="dlProv">{proveedores.map((v) => <option key={v} value={v} />)}</datalist>
      {provs.length > 1 && <p className="ayuda mt-2">Los productos vienen de {provs.length} proveedores distintos ({provs.join(', ')}). Si quieres una lista por proveedor, usa “Nueva lista”.</p>}
      {items.length ? (
        <><div className="scroll mt-3"><table className="tabla"><thead><tr><th>Producto</th><th className="num">Sugerido</th><th className="num">Pedir</th><th className="num">Subtotal</th><th /></tr></thead><tbody>
          {items.map((i) => <tr key={i.id}><td><b className="text-[13px]">{i.nombre}</b><div className="mono text-[11px] text-slate-500">{i.id}</div></td><td className="num">{ent(i.sugerido)}</td><td className="num"><input className="inp qty" type="number" min={0} step={1} value={i.cantidad} onChange={(e) => cambiarQty(i.id, Math.max(0, Math.round(Number(e.target.value) || 0)))} /></td><td className="num">{i.costo ? money(i.cantidad * i.costo) : '—'}</td><td><button className="btn btn-sm btn-red" aria-label="Quitar" onClick={() => quitar(i.id)}><Trash2 /></button></td></tr>)}</tbody></table></div>
          <p className="text-right text-sm mt-2">Total estimado <b>{money(total)}</b></p></>
      ) : <p className="ayuda mt-3">La lista está vacía. Marca productos para agregarlos.</p>}
      <div className="flex gap-2 mt-4 flex-wrap"><button className="btn" onClick={() => navigator.clipboard?.writeText(textoLista({ codigo, proveedor: meta.proveedor, notas: meta.notas, items }))}><Copy />Copiar texto</button>
        {edit && <button className="btn" disabled={ocupado} onClick={async () => { setOcupado(true); await marcarEnviada(); setOcupado(false) }}>{ocupado ? <Spin /> : <><Send />Marcar enviada</>}</button>}
        <button className="btn btn-p flex-1" onClick={cerrar}>Listo</button></div></Hoja>
  )
}

/* ============================ Detalle de un producto ============================ */
type Venta = { fecha: string; cliente: string; cantidad: number; precio: number; total: number; factura: string; asesor: string }
type Cot = { codigo: string; fecha: string; cliente: string; cantidad: number; precio: number; estado: string; asesor: string; empresa: string }
function Detalle({ p, P, perfil, editar, enLista, alternar, aviso, cerrar, guardarNota }: { p: Prod; P: Params; perfil: Perfil; editar: boolean; enLista: boolean; alternar: () => void; aviso: (t: string) => void; cerrar: () => void; guardarNota: (t: string, por: string, f: string) => void }) {
  const c = calc(p, P), img = thumb(p.imagen)
  const [extra, setExtra] = useState<{ ventas: Venta[]; clientes: { cliente: string; unidades: number; total: number; compras: number; ultima: string }[]; cots: Cot[]; notas: { id: string; nota: string; por: string; fecha: string; creado_por: string | null; created_at: string }[] } | null>(null)
  const [txt, setTxt] = useState(p.nota)
  const [nEstado, setNEstado] = useState('Se guarda sola mientras escribes')
  const tN = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notas = useRef<{ id: string; creado_por: string | null; created_at: string }[]>([])
  useEffect(() => {
    ;(async () => {
      const desde = new Date(Date.now() - 365 * 86400000).toISOString(), c90 = new Date(Date.now() - 90 * 86400000).toISOString()
      const [mv, ct, ns] = await Promise.all([
        supabase.from('movimientos_inventario').select('fecha,cantidad,precio,descuento,cliente_texto,factura_texto,responsable_texto').eq('producto_id', p.id).eq('tipo', 'SALIDA').is('deleted_at', null).gte('fecha', desde).order('fecha', { ascending: false }).limit(500),
        supabase.from('cotizaciones').select('codigo,fecha,nombre,estado_crm,empresa,items,asesor:empleados!cotizaciones_asesor_id_fkey(nombre)').is('deleted_at', null).gte('fecha', c90).contains('items', [{ codigo: p.codigo }]).order('fecha', { ascending: false }).limit(60),
        supabase.from('imp_notas_articulos').select('id,nota,creado_por,created_at,updated_at,autor:empleados!imp_notas_articulos_creado_por_fkey(nombre)').eq('producto_id', p.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(30),
      ])
      const ventas: Venta[] = ((mv.data ?? []) as Record<string, any>[]).map((r) => { const cant = Math.abs(Number(r.cantidad) || 0), pr = Number(r.precio) || 0, d = Number(r.descuento) || 0; return { fecha: r.fecha, cliente: r.cliente_texto ?? '', cantidad: cant, precio: pr, total: Math.round(cant * pr * (1 - (d > 1 ? d / 100 : d)) * 100) / 100, factura: r.factura_texto ?? '', asesor: r.responsable_texto ?? '' } }) // eslint-disable-line @typescript-eslint/no-explicit-any
      const cl: Record<string, { cliente: string; unidades: number; total: number; compras: number; ultima: string }> = {}
      ventas.forEach((v) => { const k = v.cliente || '(sin cliente)'; const x = (cl[k] = cl[k] || { cliente: k, unidades: 0, total: 0, compras: 0, ultima: '' }); x.unidades += v.cantidad; x.total += v.total; x.compras++; if (v.fecha > x.ultima) x.ultima = v.fecha })
      const cots: Cot[] = ((ct.data ?? []) as Record<string, any>[]).map((r) => { const it = (r.items as { codigo?: string; cantidad?: number; precio?: number }[]).find((x) => x.codigo === p.codigo); return { codigo: r.codigo, fecha: r.fecha, cliente: r.nombre ?? '', cantidad: Math.max(0, Number(it?.cantidad) || 1), precio: Number(it?.precio) || 0, estado: r.estado_crm ?? 'Nuevo', asesor: r.asesor?.nombre ?? '', empresa: r.empresa } }) // eslint-disable-line @typescript-eslint/no-explicit-any
      const lista = ((ns.data ?? []) as Record<string, any>[]).map((n) => ({ id: n.id, nota: n.nota, por: n.autor?.nombre ?? '', fecha: n.updated_at, creado_por: n.creado_por, created_at: n.created_at })) // eslint-disable-line @typescript-eslint/no-explicit-any
      notas.current = lista
      setExtra({ ventas: ventas.slice(0, 60), clientes: Object.values(cl).sort((a, b) => b.total - a.total || b.unidades - a.unidades).slice(0, 30), cots, notas: lista })
    })()
  }, [p.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const guardar = async () => {
    tN.current = null
    const texto = txt.replace(/[<>]/g, '').slice(0, 2000)
    setNEstado('Guardando…')
    const ult = notas.current[0], ahora = Date.now()
    const reciente = ult && ult.creado_por === perfil.id && ahora - new Date(ult.created_at).getTime() < 15 * 60000
    let error
    if (reciente) ({ error } = await supabase.from('imp_notas_articulos').update({ nota: texto }).eq('id', ult.id))
    else if (texto.trim()) { const id = crypto.randomUUID(); ({ error } = await supabase.from('imp_notas_articulos').insert({ id, producto_id: p.id, nota: texto, creado_por: perfil.id })); if (!error) notas.current = [{ id, creado_por: perfil.id, created_at: new Date().toISOString() }, ...notas.current] }
    if (error) { setNEstado('No se guardó — reintenta'); aviso(error.message); return }
    const f = new Date().toISOString(); setNEstado('Guardado ✓ ' + new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })); guardarNota(texto.trim(), perfil.nombre, f)
  }
  useEffect(() => () => { if (tN.current) { clearTimeout(tN.current); void guardar() } }) // eslint-disable-line react-hooks/exhaustive-deps
  const meses = p.ventasMes, max = Math.max(1, ...meses), hoy = new Date(), nom = (i: number) => new Date(hoy.getFullYear(), hoy.getMonth() - (11 - i), 1).toLocaleDateString('es-EC', { month: 'short' }).replace('.', '')
  const W = 360, H = 110, bw = W / 12, al = alertas(p, c, P), margen = p.pvp && c.costoRef ? (p.pvp - c.costoRef) / p.pvp : null
  const estCls = (e: string) => (/ganad/i.test(e) ? 'al-b' : /perdid/i.test(e) ? 'al-g' : 'al-a')
  return (
    <Hoja cerrar={cerrar}>
      <div className="flex items-start gap-3 mb-3">{img && <img className="thumb !w-16 !h-16" src={img} alt="" />}<div className="min-w-0 flex-1"><h3 className="font-display font-bold text-[var(--navy)] leading-snug">{p.nombre}</h3><span className="mono text-xs text-slate-500">{p.codigo}</span> <Pill c={c} /></div><button className="btn btn-sm" onClick={cerrar} aria-label="Cerrar"><X /></button></div>
      {al.length > 0 && <div className="mb-2"><Chips al={al} /></div>}
      <div className="mini !mt-0 mb-2"><div><b>{money(p.monto12)}</b><span>Ventas 12 m</span></div><div><b>{ent(p.clientes12)}</b><span>Clientes</span></div><div><b>{money(p.ticket)}</b><span>Ticket prom.</span></div><div><b><Tend t={p.tendencia} /></b><span>Últ. 3 m vs ant.</span></div></div>
      <div className="mini !mt-0"><div><b>{ent(p.stock)}</b><span>Stock</span></div><div><b>{ent(p.transito)}</b><span>Tránsito</span></div><div><b>{dec(c.demanda)}</b><span>Ventas/mes</span></div><div><b className="text-[var(--acc)]">{ent(c.sugerido)}</b><span>Sugerido</span></div></div>
      <h4 className="font-display font-bold text-sm text-[var(--navy)] mt-4 mb-1">Unidades vendidas por mes</h4>
      <div className="scroll"><svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 300 }} role="img" aria-label="Ventas de los últimos 12 meses">{meses.map((v, i) => { const h = Math.round((v / max) * 70); return <g key={i}><rect x={i * bw + 4} y={84 - h} width={bw - 8} height={Math.max(h, 1)} rx={3} fill={i === 11 ? '#0e7490' : '#9fd3dd'} />{v > 0 && <text x={i * bw + bw / 2} y={80 - h} textAnchor="middle" fontSize={9} fill="#334155">{v}</text>}<text x={i * bw + bw / 2} y={100} textAnchor="middle" fontSize={9} fill="#64748b">{nom(i)}</text></g> })}</svg></div>
      <h4 className="font-display font-bold text-sm text-[var(--navy)] mt-3 mb-1">Cálculo con tus parámetros</h4>
      <dl className="kv"><dt>Vendidas ({P.ventana} días)</dt><dd>{ent(c.vendidas)} u → {dec(c.demanda)} u/mes</dd><dt>Stock + tránsito</dt><dd>{ent(c.disponible)} u (alcanza {txtCob(c)})</dd><dt>Punto de pedido</dt><dd>{dec(c.puntoPedido)} u ({P.lead} meses de llegada)</dd><dt>Objetivo</dt><dd>{dec(c.objetivo)} u ({P.lead} + {P.cob} meses)</dd><dt>Sugerido</dt><dd><b>{ent(c.sugerido)} u</b>{c.costoRef ? ' · ' + money(c.sugerido * c.costoRef) : ''}</dd></dl>
      <h4 className="font-display font-bold text-sm text-[var(--navy)] mt-3 mb-1">Compras y precios</h4>
      <dl className="kv"><dt>Último proveedor</dt><dd>{p.proveedor || '—'}{p.ultimaImportacion && <span className="mono text-xs text-slate-500"> {p.ultimaImportacion}</span>}</dd><dt>Costo importación</dt><dd>{p.costo ? money(p.costo) : '—'}</dd><dt>PVP</dt><dd>{p.pvp ? money(p.pvp) : '—'}{margen != null ? ` · margen ${(margen * 100).toFixed(1)} %` : ''}</dd>
        <dt>Último ingreso</dt><dd>{p.ultimoIngreso ? `${dfecha(p.ultimoIngreso)} (${ent(p.ultimoIngresoCant)} u)` : '—'}</dd><dt>Última venta</dt><dd>{dfecha(p.ultimaVenta)}</dd></dl>
      {p.transitoDetalle.length > 0 && <><h4 className="font-display font-bold text-sm text-[var(--navy)] mt-3 mb-1">En tránsito</h4>{p.transitoDetalle.map((t, i) => <div key={i} className="flex items-center gap-2 text-[13px] py-1.5 border-b border-slate-100"><span className="mono font-semibold">{t.codigo}</span><span className="pill p-tr">{t.etapa}</span><span className="ml-auto"><b>{ent(t.cantidad)}</b> u{t.eta ? ' · ETA ' + dfecha(t.eta) : ''}</span></div>)}</>}
      {!extra ? <div className="text-center py-6 text-slate-400 text-sm"><Spin /> Cargando ventas, cotizaciones y observaciones…</div> : (
        <>
          <h4 className="h4"><NotebookPen style={{ width: 16, height: 16 }} />Observación de compras <span className="estado-g ml-auto">{nEstado}</span></h4>
          <textarea className="inp" maxLength={2000} readOnly={!editar} placeholder="Ej. el proveedor subió el precio; esperar oferta de marzo; cliente X pide 10 u cada trimestre…" value={txt} onChange={(e) => { setTxt(e.target.value); setNEstado('Escribiendo…'); if (tN.current) clearTimeout(tN.current); tN.current = setTimeout(guardar, 900) }} onBlur={() => { if (tN.current) { clearTimeout(tN.current); void guardar() } }} />
          {p.obsStock && <p className="ayuda mt-1"><b>Observación de inventario:</b> {p.obsStock}</p>}
          {extra.notas.length > 1 && <details className="mt-1"><summary className="ayuda cursor-pointer">Historial de observaciones ({extra.notas.length - 1})</summary><div className="lst">{extra.notas.slice(1).map((n) => <div key={n.id}><span className="flex-1">{n.nota}</span><span className="s">{n.por} · {dfecha(n.fecha)}</span></div>)}</div></details>}
          <h4 className="h4"><Users style={{ width: 16, height: 16 }} />Quién lo compra (12 meses)</h4>
          {extra.clientes.length ? <div className="lst">{extra.clientes.slice(0, 8).map((x) => <div key={x.cliente}><b className="flex-1 min-w-0 truncate">{x.cliente}</b><span className="s">{x.compras} compra(s) · últ. {dfecha(x.ultima)}</span><span className="num"><b>{ent(x.unidades)}</b> u · {money(x.total)}</span></div>)}</div> : <p className="ayuda">Sin ventas en 12 meses.</p>}
          {extra.ventas.length > 0 && <details className="mt-1"><summary className="ayuda cursor-pointer">Ver las últimas {extra.ventas.length} ventas</summary><div className="lst">{extra.ventas.map((x, i) => <div key={i}><span className="s w-[78px] shrink-0">{dfecha(x.fecha)}</span><span className="flex-1 min-w-0 truncate">{x.cliente || '—'}{x.factura && <span className="mono s"> {x.factura}</span>}<br /><span className="s">{x.asesor}</span></span><span className="num">{ent(x.cantidad)} u × {money(x.precio)}<br /><b>{money(x.total)}</b></span></div>)}</div></details>}
          <h4 className="h4"><FileText style={{ width: 16, height: 16 }} />Cotizaciones (90 días)<span className="estado-g ml-auto">{ent(p.cot90)} cotiz. · {ent(p.cotU90)} u · {ent(p.cotAbiertas)} abiertas · {ent(p.cotGanadas)} ganadas</span></h4>
          {extra.cots.length ? <div className="lst">{extra.cots.slice(0, 15).map((x) => <div key={x.codigo}><span className="s w-[78px] shrink-0">{dfecha(x.fecha)}</span><span className="flex-1 min-w-0"><b>{x.cliente || '—'}</b> <span className="mono s">{x.codigo}</span><br /><span className="s">{x.asesor}{x.empresa !== 'VIMEDIC' ? ' · ' + x.empresa : ''}</span></span><span className="num">{ent(x.cantidad)} u{x.precio ? ' × ' + money(x.precio) : ''}<br /><span className={'al ' + estCls(x.estado)}>{x.estado}</span></span></div>)}</div> : <p className="ayuda">Nadie lo ha cotizado en los últimos 90 días.</p>}
        </>
      )}
      {editar && <div className="flex gap-2 mt-4 sticky bottom-0 bg-white pt-2"><button className="btn btn-p flex-1" onClick={() => { alternar(); cerrar() }}>{enLista ? 'Quitar de la lista' : `Agregar ${c.sugerido || 1} u a la lista`}</button></div>}
    </Hoja>
  )
}
