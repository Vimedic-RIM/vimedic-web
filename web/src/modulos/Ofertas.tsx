import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, BadgePercent, Boxes, Check, Copy, Download, FileDown, Flag, Flame, Gift, LineChart, Medal, Megaphone, MessageCircle, Package, PackagePlus, Pause, Play, RefreshCw, RotateCcw, Search, ShieldAlert, SlidersHorizontal, Sparkles, Tag, Trash2, Trophy, Users, WandSparkles, X, XCircle, Zap, Mail, PartyPopper, type LucideIcon } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { LOGO_BLANCO } from '../catalogoAssets'
import { ConfirmarEliminar } from './CrmClientes'
import '../estilos/ofertas.css'

/* ============================ Tipos y utilidades ============================ */
const TIPOS = ['Oferta relámpago', 'Precio especial', 'Combo', 'Regalo', 'Liquidación', 'Outlet', 'Lote distribuidor', 'Campaña']
const TIPO_IC: Record<string, LucideIcon> = { 'Oferta relámpago': Zap, 'Precio especial': BadgePercent, Combo: PackagePlus, Regalo: Gift, 'Liquidación': Flame, Outlet: ShieldAlert, 'Lote distribuidor': Boxes }
export const GRUPOS: Record<string, { t: string; hex: string }> = { '36': { t: '3 a 6 meses', hex: '#f59e0b' }, '612': { t: '6 a 12 meses', hex: '#ea580c' }, '12': { t: 'Más de 12 meses', hex: '#b91c1c' }, obs: { t: 'Con observaciones', hex: '#7c3aed' }, nunca: { t: 'Nunca vendidos', hex: '#475569' } }
export type Cfg = { margenMinimo: number; desc36: number; desc612: number; desc12: number; descObs: number; diasOferta: number }
export const CFG_DEF: Cfg = { margenMinimo: 10, desc36: 8, desc612: 15, desc12: 25, descObs: 30, diasOferta: 30 }
export type Estrategia = { tipo: string; descuento: number; precio: number; porque: string; limitadoPorCosto: boolean; maxDesc: number; piso: number; margen: number | null; recupera: number; dias: number; comboCon: string; comboNombre: string; regalo: string }
export type Prod = {
  id: string; codigo: string; nombre: string; categoria: string; marca: string; img: string; stock: number; pvp: number; dis: number; costo: number; obs: string; nc: number; rep: number; noRep: number; motivosObs: string[]; conObs: boolean
  oculto: boolean; dias: number; grupo: string; lotes: [string | null, number][]; ultVenta: string; diasSinVenta: number | null; v90: number; v365: number; nuncaVendido: boolean; interes: number; capitalCosto: number; capitalPvp: number; ofertaId: string
  urgencia: number; estrategia: Estrategia
}
type Oferta = {
  id: string; codigo: string; productoId: string; producto: string; tipo: string; descuento: number; precio: number; pvp: number; costo: number; margen: number; inicio: string; fin: string; estadoManual: string; texto: string; comboCon: string; regalo: string; grupo: string
  stockInicial: number; objetivo: number; creado: string; creadoPor: string; actualizado: string; estado: string; historial: { f: string; por: string; n: string }[]; vendidas: number; recuperado: number; diasActiva: number
}
const R2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money0 = (n: number) => { n = Number(n) || 0; return n >= 10000 ? '$' + (n / 1000).toLocaleString('es-EC', { maximumFractionDigits: 1 }) + ' mil' : '$' + Math.round(n).toLocaleString('es-EC') }
const fechaC = (s: string) => (s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) + '/' + String(s).slice(0, 4) : '')
export const meses = (d: number) => (d >= 60 ? Math.round(d / 30) + ' meses' : d + ' días')
const ymd = (d: number | Date) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') }
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const DIA = 864e5
const imgUrl = (u: string, w = 300) => { const m = String(u || '').match(/\/d\/([-\w]{20,})/) || String(u || '').match(/[?&]id=([-\w]{20,})/); return m ? `https://lh3.googleusercontent.com/d/${m[1]}=w${w}` : String(u || '').split(/[\s,;|]+/)[0] }
const estadoDe = (o: { estadoManual: string; inicio: string; fin: string }) => {
  if (o.estadoManual === 'Cancelada' || o.estadoManual === 'Pausada') return o.estadoManual
  const t = Date.now(), ini = o.inicio ? new Date(o.inicio + 'T00:00:00').getTime() : 0, fin = o.fin ? new Date(o.fin + 'T00:00:00').getTime() : 0
  if (ini && t < ini) return 'Programada'
  if (fin && t > fin + 86399000) return 'Finalizada'
  return 'Activa'
}
const grupoEdad = (d: number) => (d >= 365 ? '12' : d >= 180 ? '612' : d >= 90 ? '36' : 'nuevo')
const grupoTexto = (x: Prod) => (x.conObs ? 'Con observaciones' : ({ '36': '3-6 meses', '612': '6-12 meses', '12': '+12 meses', nuevo: 'Menos de 3 meses' } as Record<string, string>)[x.grupo])

function estrategiaDe(p: Omit<Prod, 'estrategia' | 'urgencia'>, cfg: Cfg, estrellas: Record<string, { codigo: string; nombre: string; id: string }[]>): Estrategia {
  const piso = p.costo > 0 ? R2(p.costo * (1 + cfg.margenMinimo / 100)) : 0
  const maxDesc = p.pvp > 0 && piso > 0 ? Math.max(0, Math.floor((1 - piso / p.pvp) * 100)) : p.pvp > 0 ? 40 : 0
  let base: number, tipo: string, porque: string, comboCon = '', comboNombre = '', regalo = ''
  if (p.conObs) { tipo = 'Outlet'; base = cfg.descObs; porque = `Tiene observaciones (${p.motivosObs.join(', ')}): se vende transparente como "equipo con detalle", con la observación a la vista y garantía acordada.` }
  else if (p.grupo === '12') {
    if (p.interes > 0) { tipo = 'Liquidación'; base = cfg.desc12; porque = `Lleva ${Math.round(p.dias / 30)} meses en bodega y ${p.interes} cliente(s) lo cotizaron sin comprar: una liquidación dirigida a ellos tiene la mejor probabilidad de cierre.` }
    else if (p.stock >= 3 && p.dis > 0) { tipo = 'Lote distribuidor'; base = Math.max(cfg.desc12, Math.round((1 - p.dis / p.pvp) * 100) + 5); porque = `Lleva más de un año sin moverse y hay ${p.stock} unidades: venderlo como lote a distribuidores libera el capital de una sola vez.` }
    else { tipo = 'Liquidación'; base = cfg.desc12; porque = 'Lleva más de un año sin moverse. Cada mes más en bodega es capital detenido y riesgo de obsolescencia.' }
  } else if (p.grupo === '612') {
    const est = (estrellas[p.categoria] || []).filter((x) => x.id !== p.id)[0]
    if (est) { tipo = 'Combo'; base = cfg.desc612; comboCon = est.codigo; comboNombre = est.nombre; porque = `Entre 6 y 12 meses. "${est.nombre}" es lo más vendido de ${p.categoria}: ofrecerlo junto con este producto con descuento empuja la salida sin tocar el precio del producto estrella.` }
    else { tipo = 'Precio especial'; base = cfg.desc612; porque = 'Entre 6 y 12 meses sin rotar: un precio especial por tiempo limitado suele bastar para reactivarlo.' }
  } else if (p.pvp >= 1500) { tipo = 'Regalo'; base = Math.min(cfg.desc36, 5); regalo = 'Capacitación de uso y mantenimiento preventivo incluidos'; porque = 'Equipo de ticket alto con 3 a 6 meses en bodega: un beneficio de valor (capacitación, mantenimiento, accesorio) mueve la decisión sin bajar mucho el precio.' }
  else { tipo = 'Oferta relámpago'; base = cfg.desc36; porque = 'Entre 3 y 6 meses: una oferta relámpago de 15 días crea urgencia sin regalar margen.' }
  const desc = Math.max(0, Math.min(base, maxDesc)), precio = R2(p.pvp * (1 - desc / 100))
  return { tipo, descuento: desc, precio, porque, limitadoPorCosto: desc < base, maxDesc, piso, margen: p.costo > 0 && precio > 0 ? Math.round((precio - p.costo) / precio * 1000) / 10 : null, recupera: R2(precio * Math.max(0, p.stock)), dias: tipo === 'Oferta relámpago' ? 15 : cfg.diasOferta, comboCon, comboNombre, regalo }
}
const textoBase = (p: Prod, e: Estrategia) => e.tipo === 'Outlet' ? 'Equipo con detalle, revisado por nuestro servicio técnico. ' + (p.motivosObs[0] || '') : e.tipo === 'Combo' ? `Llévalo junto con ${e.comboNombre || 'nuestro equipo estrella'} con ${e.descuento}% de descuento.` : e.tipo === 'Regalo' ? (e.regalo || '') + '.' : e.tipo === 'Lote distribuidor' ? 'Precio especial por lote para distribuidores.' : e.descuento + '% de descuento por tiempo limitado.'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function armarProductos(filas: any[], estrellasRaw: any[], cfg: Cfg, vigentes: Record<string, string>): Prod[] {
  const estrellas: Record<string, { codigo: string; nombre: string; id: string }[]> = {}
  estrellasRaw.forEach((e) => { (estrellas[e.categoria] = estrellas[e.categoria] || []).push({ id: e.id, codigo: e.codigo, nombre: e.nombre }) })
  const ahora = Date.now(), out: Prod[] = []
  for (const r of filas) {
    const motivos: string[] = []
    const esReserva = /reserv|facturad|apartad|separad|vendid|pedido/i.test(r.obs || '')
    if (r.obs && !esReserva && r.stock > 0) motivos.push(String(r.obs).slice(0, 200))
    if (r.nc > 0) motivos.push(r.nc + ' devuelto(s) no disponible(s)')
    if (r.rep > 0) motivos.push(r.rep + ' por reparar')
    if (r.noRep > 0) motivos.push(r.noRep + ' no reparable(s)')
    const conObs = motivos.length > 0
    if (r.stock <= 0 && !conObs) continue
    const masViejo = r.stock > 0 && r.masViejo ? new Date(r.masViejo + 'T12:00:00').getTime() : 0
    const dias = masViejo ? Math.floor((ahora - masViejo) / DIA) : 0
    const ultMs = r.ultVenta ? new Date(r.ultVenta + 'T12:00:00').getTime() : 0
    const base = { id: r.id, codigo: r.codigo, nombre: r.nombre, categoria: r.categoria, marca: r.marca, img: imgUrl(r.img), stock: r.stock, pvp: Number(r.pvp), dis: Number(r.dis), costo: Number(r.costo), obs: r.obs, nc: r.nc, rep: r.rep, noRep: r.noRep, motivosObs: motivos, conObs,
      oculto: !!r.oculto, dias, grupo: grupoEdad(dias), lotes: (r.lotes ?? []) as [string | null, number][], ultVenta: r.ultVenta ?? '', diasSinVenta: ultMs ? Math.floor((ahora - ultMs) / DIA) : null, v90: Number(r.v90), v365: Number(r.v365),
      nuncaVendido: !ultMs && r.stock > 0 && dias >= 90, interes: Number(r.interes), capitalCosto: R2(r.costo * Math.max(0, r.stock)), capitalPvp: R2(r.pvp * Math.max(0, r.stock)), ofertaId: vigentes[r.id] || '' }
    if (base.grupo === 'nuevo' && !conObs) continue
    const estrategia = estrategiaDe(base, cfg, estrellas)
    const u = Math.min(45, dias / 365 * 30) + Math.min(25, Math.log(1 + Math.max(0, base.capitalPvp)) / Math.log(1 + 50000) * 25) + (conObs ? 15 : 0) + (base.nuncaVendido ? 10 : 0) + (base.v365 ? 0 : 5)
    out.push({ ...base, estrategia, urgencia: isFinite(u) ? Math.round(Math.min(100, u)) : 0 })
  }
  return out
}
const enGrupo = (p: Prod, g: string) => !g ? true : g === 'obs' ? p.conObs : g === 'nunca' ? p.nuncaVendido : g === 'activas' ? !!p.ofertaId : p.grupo === g && !p.conObs
const copiar = (t: string, aviso: (m: string) => void) => { navigator.clipboard?.writeText(t).then(() => aviso('Copiado'), () => aviso('No se pudo copiar')) }
const cargarImg = (src: string): Promise<HTMLImageElement | null> => new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src })
async function aDataUrl(url: string): Promise<string> { try { const b = await (await fetch(url)).blob(); if (b.size > 4 * 1048576) return ''; return await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ok(''); r.readAsDataURL(b) }) } catch { return '' } }
const telWa = (t: string) => { t = String(t || '').replace(/\D/g, ''); if (!t) return ''; if (t.startsWith('593')) return t; if (t.startsWith('0')) return '593' + t.slice(1); return t.length === 9 ? '593' + t : t }

function plantillas(p: Prod, o: Oferta) {
  const hasta = fechaC(o.fin), pr = money(o.precio) + ' + IVA', antes = money(o.pvp) + ' + IVA'
  const gancho = ({ Outlet: 'Tenemos disponible', 'Liquidación': 'Últimas unidades en liquidación', 'Oferta relámpago': 'Oferta relámpago', Combo: 'Combo especial', Regalo: 'Promoción especial', 'Lote distribuidor': 'Precio por lote', 'Precio especial': 'Precio especial' } as Record<string, string>)[o.tipo] || 'Oferta'
  const detalle = o.tipo === 'Outlet' ? ` (${p.motivosObs[0] || 'equipo con detalle'}, revisado por nuestro servicio técnico)` : ''
  const extra = o.tipo === 'Regalo' && o.regalo ? `\nIncluye: ${o.regalo}.` : o.tipo === 'Combo' && o.comboCon ? `\nAplica al comprarlo junto con ${o.comboCon}.` : ''
  return {
    titular: ({ Outlet: 'OUTLET', 'Liquidación': 'LIQUIDACIÓN', 'Oferta relámpago': 'OFERTA RELÁMPAGO', Combo: 'COMBO ESPECIAL', Regalo: 'INCLUYE REGALO', 'Lote distribuidor': 'PRECIO POR LOTE', 'Precio especial': 'PRECIO ESPECIAL' } as Record<string, string>)[o.tipo] || 'OFERTA',
    whatsapp: `Hola {nombre}, le saluda VIMEDIC.\n${gancho}: ${p.nombre}${detalle} a ${pr} (antes ${antes}).${extra}\nVálido hasta el ${hasta} o hasta agotar stock (${p.stock} disponible${p.stock === 1 ? '' : 's'}).\n¿Le reservo una unidad?`,
    redes: `${gancho} en VIMEDIC\n${p.nombre}${detalle}\nAhora ${pr} (antes ${antes}).${extra}\nVálido hasta el ${hasta} o hasta agotar stock.\nEscríbenos y te asesoramos.\n#VIMEDIC #EquiposMedicos #Ecuador #${norm(p.categoria || 'Salud').replace(/[^a-z0-9]/g, '')} #Oferta`,
    asunto: `${gancho}: ${p.nombre.slice(0, 45)} a ${money(o.precio)}`,
    correo: `Estimado/a {nombre}:\n\n${gancho} en ${p.nombre}${detalle}: ahora ${pr} (antes ${antes}).${extra} La promoción es válida hasta el ${hasta} o hasta agotar stock.\n\nSi le interesa, responda este correo y le enviamos la proforma con gusto.\n\nSaludos,\nEquipo VIMEDIC`,
  }
}
type Textos = ReturnType<typeof plantillas>

/* ============================ Por aprobar (campañas de Promociones) ============================ */
type ItemCampana = { id: string; desc?: number | null; descPropuesto?: number | null; nota?: string; estadoAprobacion?: string; descAprobado?: number; ofertaId?: string }
type CampanaPend = { id: string; codigo: string | null; nombre: string; inicio: string | null; fin: string | null; items: ItemCampana[] }
const itemsPendientes = (c: CampanaPend) => (c.items ?? []).filter((i) => Number(i.desc) > 0 && (!i.estadoAprobacion || i.estadoAprobacion === 'Pendiente'))
const contarPendientes = (campanas: CampanaPend[]) => campanas.reduce((n, c) => n + itemsPendientes(c).length, 0)

/* ============================ Pantalla principal ============================ */
export default function Ofertas({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [prods, setProds] = useState<Prod[] | null>(null)
  const [ofertas, setOfertas] = useState<Oferta[]>([])
  const [cfg, setCfg] = useState<Cfg>(CFG_DEF)
  const [cfgId, setCfgId] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'opor' | 'ofertas' | 'res' | 'aprobar'>('opor')
  const [campanasPendientes, setCampanasPendientes] = useState<CampanaPend[]>([])
  const [filtro, setFiltro] = useState('')
  const [q, setQ] = useState('')
  const [orden, setOrden] = useState('urg')
  const [mostrar, setMostrar] = useState(24)
  const [plan, setPlan] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [cats, setCats] = useState<Set<string>>(new Set())
  const [abierto, setAbierto] = useState<{ p: Prod; o: Oferta | null } | null>(null)
  const [hoja, setHoja] = useState<'ajustes' | 'plan' | 'pdf' | 'papelera' | null>(null)
  const [cargando, setCargando] = useState(false)
  const puedeEditar = puede(perfil, 'ofertas', 'editar'), puedeCrear = puede(perfil, 'ofertas', 'crear'), puedeEliminar = puede(perfil, 'ofertas', 'eliminar')

  const cargar = useCallback(async () => {
    setCargando(true)
    const [a, o, r, c, pc] = await Promise.all([
      supabase.rpc('of_analisis'),
      supabase.from('ofertas').select('id,codigo,producto_id,tipo,descuento_pct,precio_oferta,pvp_base,costo,margen_pct,inicio,fin,estado,texto_cliente,combo_con,regalo,grupo,stock_inicial,unidades_objetivo,historial,created_at,updated_at,creador:empleados!ofertas_creado_por_fkey(nombre),producto:productos!ofertas_producto_id_fkey(nombre)').is('deleted_at', null).order('created_at', { ascending: false }).limit(1000),
      supabase.from('v_ofertas_resultados').select('oferta_id,vendidas,recuperado,dias'),
      supabase.from('ofertas_config').select('id,valor').is('deleted_at', null).limit(1),
      supabase.from('promo_campanas').select('id,codigo,nombre,inicio,fin,items').eq('estado', 'En aprobación').is('deleted_at', null).limit(200),
    ])
    setCargando(false)
    setCampanasPendientes((pc.data as unknown as CampanaPend[]) ?? [])
    const e = a.error || o.error; if (e) { setError(e.message); return }
    const conf: Cfg = { ...CFG_DEF, ...(c.data?.[0]?.valor ?? {}) }
    setCfg(conf); setCfgId(c.data?.[0]?.id ?? '')
    const res = new Map(((r.data ?? []) as { oferta_id: string; vendidas: number; recuperado: number; dias: number }[]).map((x) => [x.oferta_id, x]))
    const lista: Oferta[] = ((o.data ?? []) as unknown as Record<string, any>[]).map((x) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const rr = res.get(x.id)
      const of: Oferta = { id: x.id, codigo: x.codigo ?? '', productoId: x.producto_id, producto: x.producto?.nombre ?? '', tipo: x.tipo ?? '', descuento: Number(x.descuento_pct) || 0, precio: Number(x.precio_oferta) || 0, pvp: Number(x.pvp_base) || 0, costo: Number(x.costo) || 0, margen: Number(x.margen_pct) || 0,
        inicio: x.inicio ?? '', fin: x.fin ?? '', estadoManual: x.estado ?? '', texto: x.texto_cliente ?? '', comboCon: x.combo_con ?? '', regalo: x.regalo ?? '', grupo: x.grupo ?? '', stockInicial: x.stock_inicial ?? 0, objetivo: x.unidades_objetivo ?? 0,
        creado: x.created_at, creadoPor: x.creador?.nombre ?? '', actualizado: x.updated_at, estado: '', historial: Array.isArray(x.historial) ? x.historial : [], vendidas: rr?.vendidas ?? 0, recuperado: Number(rr?.recuperado) || 0, diasActiva: rr?.dias ?? 0 }
      of.estado = estadoDe(of); return of
    })
    setOfertas(lista)
    const vig: Record<string, string> = {}; lista.forEach((x) => { if (x.estado === 'Activa' || x.estado === 'Programada') vig[x.productoId] = x.id })
    const an = (a.data ?? { productos: [], estrellas: [] }) as { productos: unknown[]; estrellas: unknown[] }
    setProds(armarProductos(an.productos as never[], an.estrellas as never[], conf, vig)); setError('')
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const P = prods ?? []
  const categorias = useMemo(() => [...new Set([...P.map((p) => p.categoria)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [P])
  const acepta = (c: string) => !cats.size || cats.has(c)
  const catOferta = (o: Oferta) => P.find((p) => p.id === o.productoId)?.categoria ?? ''
  const ofertasVis = ofertas.filter((o) => acepta(catOferta(o)))
  const filtrados = useMemo(() => {
    const w = norm(q).trim().split(/\s+/).filter(Boolean)
    const l = P.filter((p) => acepta(p.categoria) && enGrupo(p, filtro) && (!w.length || w.every((x) => norm([p.codigo, p.nombre, p.categoria, p.marca, p.motivosObs.join(' ')].join(' ')).includes(x))))
    const f: Record<string, (a: Prod, b: Prod) => number> = { urg: (a, b) => b.urgencia - a.urgencia, cap: (a, b) => b.capitalPvp - a.capitalPvp, edad: (a, b) => b.dias - a.dias, int: (a, b) => b.interes - a.interes || b.urgencia - a.urgencia }
    return l.sort(f[orden])
  }, [P, q, filtro, orden, cats]) // eslint-disable-line react-hooks/exhaustive-deps

  const R: Record<string, [number, number, number]> = { '36': [0, 0, 0], '612': [0, 0, 0], '12': [0, 0, 0], obs: [0, 0, 0], nunca: [0, 0, 0] }
  P.forEach((x) => { const add = (k: string) => { R[k][0]++; R[k][1] += x.capitalCosto; R[k][2] += x.capitalPvp }; if (!x.conObs && R[x.grupo]) add(x.grupo); if (x.conObs) add('obs'); if (x.nuncaVendido) add('nunca') })
  const KS = ['36', '612', '12', 'obs'], tot = KS.reduce((a, k) => a + R[k][2], 0), totC = KS.reduce((a, k) => a + R[k][1], 0)
  const sug = P.reduce((a, p) => a + (p.ofertaId ? 0 : p.estrategia.recupera), 0)
  const activas = ofertas.filter((o) => o.estado === 'Activa'), recTotal = ofertas.reduce((a, o) => a + o.recuperado, 0)
  const act = P.filter((p) => p.ofertaId).length
  const ofertaDe = (p: Prod) => ofertas.find((o) => o.id === p.ofertaId) ?? null

  /* Guardar una oferta (con las mismas reglas del original) */
  async function guardarOferta(d: { id?: string; p: Prod; tipo: string; desc: number; ini: string; fin: string; texto: string; comboCon: string; regalo: string; objetivo: string }): Promise<string> {
    const { p } = d
    if (!(p.pvp > 0)) throw new Error('El producto no tiene PVP: ponle precio en Inventario antes de crear la oferta.')
    const tipo = TIPOS.includes(d.tipo) ? d.tipo : 'Precio especial'
    const desc = Math.round(Number(d.desc) * 10) / 10
    if (desc < 0 || desc > 90) throw new Error('El descuento debe estar entre 0 y 90 %.')
    const precio = R2(p.pvp * (1 - desc / 100))
    if (p.costo > 0) {
      const piso = R2(p.costo * (1 + cfg.margenMinimo / 100))
      if (precio < piso) throw new Error(`Con ${desc} % el precio ($${precio.toFixed(2)}) queda debajo del piso: costo $${p.costo.toFixed(2)} + ${cfg.margenMinimo} % = $${piso.toFixed(2)}. Máximo permitido: ${Math.floor((1 - piso / p.pvp) * 100)} %.`)
    } else if (desc > 35) throw new Error('Este producto no tiene "Costo Importación": sin costo no se permite más de 35 % de descuento.')
    if (tipo === 'Regalo' && !d.regalo.trim()) throw new Error('Escribe qué se regala.')
    if (tipo === 'Combo' && !d.comboCon.trim()) throw new Error('Elige con qué producto va el combo.')
    const ini = d.ini || ymd(Date.now())
    const fin = d.fin || ymd(new Date(ini + 'T12:00:00').getTime() + cfg.diasOferta * DIA)
    if (fin < ini) throw new Error('La fecha de fin es anterior al inicio.')
    if (new Date(fin).getTime() - new Date(ini).getTime() > 366 * DIA) throw new Error('Una oferta puede durar máximo un año.')
    const choca = ofertas.find((o) => o.id !== d.id && o.productoId === p.id && (o.estado === 'Activa' || o.estado === 'Programada') && o.inicio <= fin && (!o.fin || o.fin >= ini))
    if (choca) throw new Error(`Este producto ya tiene la oferta ${choca.codigo} (${choca.estado.toLowerCase()}) en esas fechas. Edítala o finalízala primero.`)
    const margen = p.costo > 0 ? Math.round((precio - p.costo) / precio * 1000) / 10 : null
    const campos = { producto_id: p.id, tipo, descuento_pct: desc, precio_oferta: precio, pvp_base: p.pvp, costo: p.costo || null, margen_pct: margen, inicio: ini, fin, texto_cliente: d.texto.replace(/[<>]/g, '').slice(0, 400) || null,
      combo_con: tipo === 'Combo' ? d.comboCon.slice(0, 40) : null, regalo: tipo === 'Regalo' ? d.regalo.slice(0, 160) : null, unidades_objetivo: Math.max(0, Math.round(Number(d.objetivo))) || null, actualizado_por: perfil.id }
    const ahora = new Date().toISOString()
    if (d.id) {
      const ex = ofertas.find((o) => o.id === d.id); if (!ex) throw new Error('La oferta no existe.')
      if (ex.estado === 'Finalizada' || ex.estado === 'Cancelada') throw new Error(`Una oferta ${ex.estado.toLowerCase()} no se edita: crea una nueva.`)
      const hist = [...ex.historial, { f: ahora, por: perfil.nombre, n: `Editada: ${tipo} ${desc} % hasta ${fechaC(fin)}` }].slice(-30)
      const { error } = await supabase.from('ofertas').update({ ...campos, historial: hist }).eq('id', d.id); if (error) throw new Error(error.message)
      return d.id
    }
    const id = crypto.randomUUID()
    const { error } = await supabase.from('ofertas').insert({ id, codigo: `OF-${ahora.slice(2, 10).replace(/-/g, '')}-${id.slice(0, 4).toUpperCase()}`, ...campos, grupo: grupoTexto(p), stock_inicial: p.stock, historial: [{ f: ahora, por: perfil.nombre, n: `Creada: ${tipo} ${desc} %` }], creado_por: perfil.id })
    if (error) throw new Error(error.message)
    return id
  }
  async function estadoOferta(o: Oferta, accion: 'pausar' | 'reanudar' | 'finalizar' | 'cancelar' | 'eliminar', motivo = '') {
    const ahora = new Date().toISOString(); let campos: Record<string, unknown> = {}, nota = ''
    if (accion === 'pausar') { if (o.estado !== 'Activa' && o.estado !== 'Programada') throw new Error('Solo se pausa una oferta activa o programada.'); campos = { estado: 'Pausada' }; nota = 'Pausada' }
    else if (accion === 'reanudar') { if (o.estado !== 'Pausada') throw new Error('La oferta no está pausada.'); campos = { estado: null }; nota = 'Reanudada' }
    else if (accion === 'finalizar') { campos = { fin: ymd(Date.now() - DIA), estado: null }; nota = 'Finalizada antes de tiempo' }
    else if (accion === 'cancelar') { campos = { estado: 'Cancelada' }; nota = 'Cancelada' }
    else { campos = { deleted_at: ahora, motivo_eliminacion: motivo || null }; nota = 'Eliminada (Papelera)' }
    const hist = [...o.historial, { f: ahora, por: perfil.nombre, n: nota }].slice(-30)
    const { error } = await supabase.from('ofertas').update({ ...campos, historial: hist, actualizado_por: perfil.id }).eq('id', o.id)
    if (error) throw new Error(error.message)
  }

  const abrirProd = (p: Prod, o?: Oferta | null) => setAbierto({ p, o: o === undefined ? ofertaDe(p) : o })
  const productoDesdeOferta = (o: Oferta): Prod => ({ id: o.productoId, codigo: o.comboCon, nombre: o.producto, categoria: '', marca: '', img: '', stock: 0, pvp: o.pvp, dis: 0, costo: o.costo, obs: '', nc: 0, rep: 0, noRep: 0, motivosObs: [], conObs: false, oculto: false, dias: 0, grupo: 'nuevo', lotes: [], ultVenta: '', diasSinVenta: null, v90: 0, v365: 0, nuncaVendido: false,
    interes: 0, capitalCosto: 0, capitalPvp: 0, ofertaId: o.id, urgencia: 0, estrategia: { tipo: o.tipo, descuento: o.descuento, precio: o.precio, porque: 'Este producto ya no está en la lista de stock dormido.', limitadoPorCosto: false, maxDesc: 90, piso: 0, margen: null, recupera: 0, dias: 30, comboCon: '', comboNombre: '', regalo: '' } })

  return (
    <div className="vm-of">
      <header className="hdr text-white">
        <div className="w-full px-4 lg:px-6 py-3 flex items-center gap-3 flex-wrap vm-head-pad">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><Tag style={{ width: 20, height: 20 }} /></div>
          <div className="min-w-0"><h1 className="font-display font-bold text-lg leading-tight">Ofertas y Liquidación</h1><p className="text-[11px] text-white/70">Stock dormido, estrategias y resultados · {perfil.nombre}</p></div>
          <div className="ml-auto flex gap-2 flex-wrap">
            <button className="btn btn-sm btn-g" title="Filtrar productos y descargar PDF con fotos" onClick={() => setHoja('pdf')}><FileDown /><span>PDF con fotos</span></button>
            <button className="btn btn-sm btn-g" title="Descargar la lista actual en Excel" onClick={() => descargarExcel(tab, filtrados, ofertasVis, aviso)}><Download /><span>Descargar Excel</span></button>
            {puedeEliminar && <button className="btn btn-sm btn-g" title="Ofertas eliminadas" onClick={() => setHoja('papelera')}><Trash2 /></button>}
            {puedeCrear && <button className="btn btn-sm btn-g" title="Elegir varios productos y crear sus ofertas sugeridas" onClick={() => { setPlan(!plan); setSel(new Set()); setTab('opor'); if (!plan) aviso('Toca los productos para incluirlos en el plan.') }}><WandSparkles /><span className="hidden sm:inline">Plan de liquidación</span></button>}
            <button className="btn btn-sm btn-g" title="Ajustes" onClick={() => setHoja('ajustes')}><SlidersHorizontal /><span className="hidden sm:inline">Ajustes</span></button>
            <button className="btn btn-sm btn-g" title="Actualizar" onClick={cargar}><RefreshCw className={cargando ? 'animate-spin' : ''} /></button>
          </div>
        </div>
      </header>
      <main className="w-full px-4 lg:px-6 py-4 space-y-4">
        <section className="hero">
          {prods === null && !error ? <div className="text-white/80 text-sm"><span className="spin" /> Analizando el inventario…</div> : error ? <div className="text-sm"><b>No se pudo cargar.</b> {error} <button className="btn btn-sm btn-g ml-2" onClick={cargar}>Reintentar</button></div> : (
            <div className="relative z-[1] grid gap-4 md:grid-cols-[1.2fr_1fr] items-end">
              <div><p className="text-[12px] font-bold uppercase tracking-wider text-orange-300">Capital dormido en bodega</p>
                <div className="flex items-baseline gap-3 flex-wrap mt-1"><b className="big">{money0(tot)}</b><span className="text-white/70 text-sm">a precio de venta{totC ? ' · ' + money0(totC) + ' a costo' : ''}</span></div>
                <div className="barra mt-3">{KS.map((k) => <span key={k} title={`${GRUPOS[k].t}: ${money(R[k][2])}`} style={{ width: (tot ? R[k][2] / tot * 100 : 0) + '%', background: GRUPOS[k].hex }} />)}</div>
                <div className="flex gap-3 flex-wrap mt-2 text-[11.5px] text-white/80">{KS.map((k) => <span key={k}><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: GRUPOS[k].hex, marginRight: 5 }} />{GRUPOS[k].t} · {money0(R[k][2])}</span>)}</div></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white/10 p-3"><p className="text-[11px] text-white/70 font-semibold">Jugadas sugeridas sin aplicar</p><b className="font-display text-xl">{money0(sug)}</b><p className="text-[11px] text-white/60">vuelven a caja</p></div>
                <div className="rounded-2xl bg-white/10 p-3"><p className="text-[11px] text-white/70 font-semibold">Ofertas activas</p><b className="font-display text-xl">{activas.length}</b><p className="text-[11px] text-white/60">{money0(recTotal)} recuperado en total</p></div></div></div>
          )}
        </section>
        <div className="kpis">
          {[...['36', '612', '12', 'obs', 'nunca'].map((k) => [k, GRUPOS[k].t, R[k][0], money0(R[k][2]) + ' detenido', GRUPOS[k].hex] as const), ['activas', 'Con oferta vigente', act, `de ${P.length} productos`, '#04896f'] as const].map(([k, t, n, s, c]) => (
            <button key={k} className={'kpi' + (filtro === k ? ' on' : '')} style={{ ['--c' as string]: c }} onClick={() => { setFiltro(filtro === k ? '' : k); setTab('opor'); setMostrar(24) }}><small>{t}</small><b>{n}</b><span>{s}</span></button>
          ))}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="tabs">{([['opor', 'Oportunidades', P.length], ['ofertas', 'Ofertas', ofertas.filter((o) => ['Activa', 'Programada', 'Pausada'].includes(o.estado)).length], ['aprobar', 'Por aprobar', contarPendientes(campanasPendientes)], ['res', 'Resultados', null]] as const).map(([k, t, n]) => <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{t}{n != null && <b>{n}</b>}</button>)}</div>
          <div className="ml-auto" style={{ minWidth: 230, maxWidth: '100%' }}><span className="lbl">Filtrar por categorías</span>
            <details className="inp"><summary style={{ cursor: 'pointer' }}>{!cats.size ? 'Todas las categorías' : cats.size === 1 ? [...cats][0] : cats.size + ' categorías seleccionadas'}</summary>
              <button className="btn btn-sm my-2" type="button" onClick={() => { setCats(new Set()); setMostrar(24); setSel(new Set()) }}>Todas las categorías</button>
              <div style={{ maxHeight: 200, overflow: 'auto' }}>{categorias.map((c) => <label key={c} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 7, fontSize: 12, cursor: 'pointer' }}><input type="checkbox" checked={cats.has(c)} onChange={(e) => { const n = new Set(cats); e.target.checked ? n.add(c) : n.delete(c); setCats(n); setMostrar(24); setSel(new Set()) }} />{c}</label>)}</div></details></div>
        </div>

        {tab === 'opor' && (
          <section>
            <div className="flex gap-2 flex-wrap items-center mb-3">
              <div className="relative flex-1 min-w-[220px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp" style={{ paddingLeft: 36 }} placeholder="Buscar producto, código, categoría u observación…" value={q} onChange={(e) => { setQ(e.target.value); setMostrar(24) }} /></div>
              <select className="inp" style={{ width: 'auto' }} value={orden} onChange={(e) => { setOrden(e.target.value); setMostrar(24) }}><option value="urg">Más urgentes</option><option value="cap">Más dinero detenido</option><option value="edad">Más antiguos</option><option value="int">Más clientes interesados</option></select>
            </div>
            <div className={'grid-p' + (plan ? ' plan' : '')}>
              {prods && !filtrados.length && <div className="vacio col-span-full"><PartyPopper className="mx-auto mb-2" style={{ width: 34, height: 34 }} /><p className="font-semibold">Nada por aquí.</p><p className="text-sm">{filtro ? 'Ningún producto en este grupo.' : 'No hay stock dormido: todo rota en menos de 3 meses.'}</p></div>}
              {filtrados.slice(0, mostrar).map((p) => <Tarjeta key={p.id} p={p} sel={sel.has(p.id)} click={() => {
                if (plan) { if (p.ofertaId || !(p.pvp > 0)) { aviso(p.ofertaId ? 'Ya tiene una oferta vigente.' : 'Sin PVP no se puede ofertar.'); return } const n = new Set(sel); n.has(p.id) ? n.delete(p.id) : n.add(p.id); setSel(n); return }
                abrirProd(p) }} />)}
            </div>
            <div className="text-center mt-4">{filtrados.length > mostrar ? <button className="btn" onClick={() => setMostrar(mostrar + 24)}>Ver más ({filtrados.length - mostrar})</button> : <p className="text-xs text-slate-400">{filtrados.length} producto(s)</p>}</div>
          </section>
        )}
        {tab === 'ofertas' && <ListaOfertas ofertas={ofertasVis} prods={P} abrir={(o) => abrirProd(P.find((p) => p.id === o.productoId) ?? productoDesdeOferta(o), o)} />}
        {tab === 'aprobar' && <PorAprobar campanas={campanasPendientes} prods={P} aviso={aviso} recargar={cargar} />}
        {tab === 'res' && <Resultados ofertas={ofertasVis.filter((o) => o.estado !== 'Programada')} />}
      </main>

      {plan && (
        <div className="planbar">
          <div className="min-w-0 flex-1"><b>{sel.size} producto(s)</b><p className="text-[12px] text-white/70">Recuperas hasta {money0(P.filter((p) => sel.has(p.id)).reduce((a, p) => a + p.estrategia.recupera, 0))} con las jugadas sugeridas</p></div>
          <button className="btn btn-sm btn-g" onClick={() => setSel(new Set([...sel, ...filtrados.filter((p) => !p.ofertaId && p.pvp > 0).slice(0, 10).map((p) => p.id)]))}>Elegir los 10 más urgentes</button>
          <button className="btn btn-sm btn-g" onClick={() => { setPlan(false); setSel(new Set()) }}>Salir</button>
          <button className="btn btn-sm btn-p" disabled={!sel.size} onClick={() => setHoja('plan')}>Crear ofertas</button>
        </div>
      )}
      {abierto && <Drawer key={abierto.p.id + (abierto.o?.id ?? '')} p={abierto.p} o={abierto.o} cfg={cfg} puedeEditar={puedeEditar} puedeCrear={puedeCrear} puedeEliminar={puedeEliminar} aviso={aviso} cerrar={() => setAbierto(null)}
        guardar={async (d) => { const id = await guardarOferta({ ...d, p: abierto.p }); await cargar(); aviso(abierto.o ? 'Oferta actualizada' : 'Oferta publicada: queda lista para verse en el CRM, Inventario y catálogos'); return id }}
        estado={async (o, a, m) => { await estadoOferta(o, a, m); await cargar(); aviso('Listo') }} refrescar={cargar} />}
      {hoja === 'ajustes' && <Ajustes cfg={cfg} cerrar={() => setHoja(null)} guardar={async (v) => { const { error } = cfgId ? await supabase.from('ofertas_config').update({ valor: v }).eq('id', cfgId) : await supabase.from('ofertas_config').insert({ id: crypto.randomUUID(), valor: v }); if (error) { aviso(error.message); return } setHoja(null); aviso('Ajustes guardados'); cargar() }} />}
      {hoja === 'plan' && <PlanHoja ps={P.filter((p) => sel.has(p.id))} cerrar={() => setHoja(null)} crear={async () => {
        let creadas = 0; const errores: string[] = []
        for (const p of P.filter((x) => sel.has(x.id))) {
          const e = p.estrategia, ini = ymd(Date.now())
          try { await guardarOferta({ p, tipo: e.tipo, desc: e.descuento, ini, fin: ymd(Date.now() + e.dias * DIA), texto: textoBase(p, e), comboCon: e.comboCon, regalo: e.regalo, objetivo: '' }); creadas++ } catch (err) { errores.push(`${p.codigo}: ${(err as Error).message}`) }
        }
        setHoja(null); setPlan(false); setSel(new Set()); aviso(`${creadas} oferta(s) creadas${errores.length ? ` · ${errores.length} no se pudieron` : ''}`); if (errores.length) setTimeout(() => aviso(errores[0]), 2900); cargar() }} />}
      {hoja === 'pdf' && <PdfHoja productos={tab === 'opor' ? filtrados : ofertasVis.filter((o) => tab !== 'res' || o.estado !== 'Programada').map((o) => ({ ...(P.find((p) => p.id === o.productoId) ?? productoDesdeOferta(o)), pdfOferta: o } as Prod & { pdfOferta: Oferta }))} ofertas={ofertas} cerrar={() => setHoja(null)} />}
      {hoja === 'papelera' && <Papelera cerrar={() => setHoja(null)} aviso={aviso} restaurado={cargar} />}
    </div>
  )
}

function Tarjeta({ p, sel, click }: { p: Prod; sel: boolean; click: () => void }) {
  const e = p.estrategia, I = TIPO_IC[e.tipo] || Tag, g = GRUPOS[p.grupo]
  return (
    <article className={'pc' + (sel ? ' sel' : '')} onClick={click}>
      <span className="chk"><Check style={{ width: 16, height: 16 }} /></span>
      <div className="urg" title={`Urgencia ${p.urgencia}/100`}><i style={{ width: p.urgencia + '%' }} /></div>
      <div className="pc-top"><div className="ph">{p.img ? <img loading="lazy" src={p.img} alt="" onError={(ev) => ev.currentTarget.remove()} /> : <Package style={{ width: 28, height: 28 }} />}</div>
        <div className="min-w-0 flex-1">
          <div className="flex gap-1.5 flex-wrap mb-1">
            {p.conObs ? <span className="pill" style={{ background: '#f3e8ff', color: '#6d28d9' }}><AlertTriangle style={{ width: 11, height: 11 }} />Con observaciones</span> : g ? <span className="pill" style={{ background: g.hex + '1f', color: g.hex }}>{meses(p.dias)} en bodega</span> : p.nuncaVendido ? <span className="pill" style={{ background: '#f1f5f9', color: '#334155' }}>Nunca vendido</span> : null}
            {p.ofertaId && <span className="pill e-Activa"><Tag style={{ width: 11, height: 11 }} />En oferta</span>}
            {p.interes > 0 && <span className="pill" style={{ background: '#e0f2fe', color: '#075985' }}><Users style={{ width: 11, height: 11 }} />{p.interes} interesado{p.interes > 1 ? 's' : ''}</span>}</div>
          <p className="font-bold text-[14px] leading-snug text-slate-800 line-clamp-2">{p.nombre}</p>
          <p className="text-[11px] text-slate-400 mono">{p.codigo} · {p.categoria}</p>
          <p className="text-[12px] text-slate-600 mt-1"><b>{p.stock}</b> u. · {money0(p.capitalPvp)} detenido{p.ultVenta ? ' · última venta ' + meses(p.diasSinVenta ?? 0) : ' · sin ventas registradas'}</p>
          {p.conObs && <p className="text-[11.5px] text-violet-700 font-semibold mt-1 line-clamp-2">{p.motivosObs.join(' · ')}</p>}</div></div>
      {p.pvp > 0 ? (
        <div className="jug"><div className="t"><I style={{ width: 13, height: 13 }} />Jugada sugerida · {e.tipo}</div>
          <div className="flex items-end justify-between gap-2 mt-1"><div><span className="precio-n">{money(e.precio)}</span> <span className="precio-a">{money(p.pvp)}</span></div>
            <div className="text-right text-[11.5px] text-slate-600"><b className="text-[var(--acc)] text-[15px]">-{e.descuento}%</b>{e.margen != null ? <><br />margen {e.margen}%</> : <><br /><span className="text-amber-700">sin costo</span></>}</div></div>
          {e.limitadoPorCosto && <p className="text-[11px] text-amber-700 mt-1">Limitado por el costo: no baja del margen mínimo.</p>}</div>
      ) : <div className="jug"><p className="text-[12px] text-amber-800 font-semibold">Sin PVP: ponle precio en Inventario para poder ofertarlo.</p></div>}
    </article>
  )
}

type ProdPend = { id: string; codigo: string; nombre: string; imagen: string; categoria: string; pvp: number; costo: number | null }
function PorAprobar({ campanas, prods, aviso, recargar }: { campanas: CampanaPend[]; prods: Prod[]; aviso: (t: string) => void; recargar: () => void }) {
  const [extra, setExtra] = useState<Record<string, ProdPend>>({})
  const [ventasTot, setVentasTot] = useState<Record<string, number>>({})
  const [orden, setOrden] = useState('cat')
  const [ediciones, setEdiciones] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState('')
  const filas = useMemo(() => campanas.flatMap((c) => itemsPendientes(c).map((it) => ({ campana: c, item: it }))), [campanas])
  const porCodigo = useMemo(() => new Map(prods.map((p) => [p.codigo, p])), [prods])

  // Los productos que ya están en "Oportunidades" (stock dormido) traen toda su analítica
  // (antigüedad, interesados…); los que no, se piden sueltos aquí.
  useEffect(() => {
    const faltan = [...new Set(filas.map((f) => f.item.id).filter((cod) => !porCodigo.has(cod)))]
    if (!faltan.length) { setExtra({}); return }
    let vivo = true
    ;(async () => {
      const { data: p } = await supabase.from('productos').select('id,codigo,nombre,imagen_url,pvp,categoria:categorias(nombre)').in('codigo', faltan).is('deleted_at', null)
      if (!vivo) return
      const filas2 = (p ?? []) as unknown as { id: string; codigo: string; nombre: string; imagen_url: string | null; pvp: number | null; categoria: { nombre: string } | null }[]
      const { data: co } = await supabase.from('productos_costos').select('producto_id,costo_importacion').in('producto_id', filas2.map((x) => x.id)).is('deleted_at', null)
      const costos = Object.fromEntries(((co ?? []) as { producto_id: string; costo_importacion: number | null }[]).map((x) => [x.producto_id, Number(x.costo_importacion) || 0]))
      const mapa: Record<string, ProdPend> = {}
      filas2.forEach((x) => { mapa[x.codigo] = { id: x.id, codigo: x.codigo, nombre: x.nombre, imagen: x.imagen_url ?? '', categoria: x.categoria?.nombre ?? '—', pvp: Number(x.pvp) || 0, costo: costos[x.id] ?? 0 } })
      setExtra(mapa)
    })()
    return () => { vivo = false }
  }, [filas, porCodigo])

  // Ventas totales de siempre (no solo los últimos 12 meses) para cada producto pendiente.
  useEffect(() => {
    const idCod: [string, string][] = []
    filas.forEach((f) => {
      const real = porCodigo.get(f.item.id)
      if (real) idCod.push([real.id, f.item.id])
      else { const x = extra[f.item.id]; if (x) idCod.push([x.id, f.item.id]) }
    })
    const ids = [...new Set(idCod.map(([id]) => id))]
    if (!ids.length) return
    let vivo = true
    ;(async () => {
      const { data } = await supabase.from('movimientos_inventario').select('producto_id,cantidad').in('producto_id', ids).eq('tipo', 'SALIDA').is('deleted_at', null)
      if (!vivo) return
      const porId: Record<string, number> = {}
      ;((data ?? []) as { producto_id: string; cantidad: number }[]).forEach((m) => { porId[m.producto_id] = (porId[m.producto_id] || 0) + Math.abs(Number(m.cantidad) || 0) })
      const porCod: Record<string, number> = {}
      idCod.forEach(([id, cod]) => { porCod[cod] = Math.round(porId[id] || 0) })
      setVentasTot((x) => ({ ...x, ...porCod }))
    })()
    return () => { vivo = false }
  }, [filas, porCodigo, extra])

  function prodDe(codigo: string): Prod | null {
    const real = porCodigo.get(codigo)
    if (real) return real
    const x = extra[codigo]
    if (!x) return null
    return {
      id: x.id, codigo: x.codigo, nombre: x.nombre, categoria: x.categoria, marca: '', img: x.imagen ? imgUrl(x.imagen, 300) : '', stock: 0, pvp: x.pvp, dis: 0, costo: x.costo ?? 0,
      obs: '', nc: 0, rep: 0, noRep: 0, motivosObs: [], conObs: false, oculto: false, dias: 0, grupo: '', lotes: [], ultVenta: '', diasSinVenta: null, v90: 0, v365: 0, nuncaVendido: false,
      interes: 0, capitalCosto: 0, capitalPvp: 0, ofertaId: '', urgencia: 0,
      estrategia: { tipo: 'Precio especial', descuento: 0, precio: x.pvp, porque: '', limitadoPorCosto: false, maxDesc: 90, piso: 0, margen: null, recupera: 0, dias: 30, comboCon: '', comboNombre: '', regalo: '' },
    }
  }

  async function decidir(campanaId: string, codigo: string, decision: 'Aprobar' | 'Rechazar', descAprobado?: number) {
    const clave = campanaId + ':' + codigo
    let comentario: string | null = null
    if (decision === 'Rechazar') comentario = window.prompt('¿Por qué se rechaza? (opcional, lo verá Marketing)', '') ?? ''
    setOcupado(clave)
    const { error } = await supabase.rpc('revisar_item_promocion', { p_campana_id: campanaId, p_item_codigo: codigo, p_decision: decision, p_desc_aprobado: descAprobado ?? null, p_comentario: comentario || null })
    setOcupado('')
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    aviso(decision === 'Aprobar' ? 'Producto aprobado: ya está en Ofertas.' : 'Producto rechazado.')
    recargar()
  }

  const ordenadas = [...filas].sort((a, b) => {
    const pa = prodDe(a.item.id), pb = prodDe(b.item.id)
    if (orden === 'pvp') return (pb?.pvp ?? 0) - (pa?.pvp ?? 0)
    if (orden === 'desc') return (Number(b.item.desc) || 0) - (Number(a.item.desc) || 0)
    if (orden === 'nombre') return (pa?.nombre ?? a.item.id).localeCompare(pb?.nombre ?? b.item.id, 'es')
    return (pa?.categoria ?? '').localeCompare(pb?.categoria ?? '', 'es') || (pa?.nombre ?? '').localeCompare(pb?.nombre ?? '', 'es')
  })

  if (!filas.length) return <div className="vacio"><BadgePercent className="mx-auto mb-2" style={{ width: 34, height: 34 }} /><p className="font-semibold">No hay productos por aprobar.</p><p className="text-sm">Cuando Marketing envíe una campaña de Promociones a aprobación, sus productos aparecen aquí.</p></div>
  return (
    <>
    <div className="flex justify-end mb-3">
      <select className="inp" style={{ width: 'auto' }} value={orden} onChange={(e) => setOrden(e.target.value)}>
        <option value="cat">Categoría (A-Z)</option><option value="pvp">Precio (mayor a menor)</option><option value="desc">% Descuento (mayor a menor)</option><option value="nombre">Nombre (A-Z)</option></select>
    </div>
    <div className="grid-p">
      {ordenadas.map(({ campana, item }) => {
        const p = prodDe(item.id)
        const clave = campana.id + ':' + item.id
        const valor = ediciones[clave] ?? String(item.desc ?? 0)
        const trabajando = ocupado === clave
        if (!p) return <article key={clave} className="pc"><p className="text-[11px] text-amber-700 p-3">Cargando {item.id}…</p></article>
        return (
          <TarjetaAprobar key={clave} p={p} conAnalitica={porCodigo.has(item.id)} ventasTotales={ventasTot[item.id]} campana={campana} valor={valor} setValor={(v) => setEdiciones((x) => ({ ...x, [clave]: v }))} nota={item.nota}
            trabajando={trabajando} onAprobar={(d) => decidir(campana.id, item.id, 'Aprobar', d)} onRechazar={() => decidir(campana.id, item.id, 'Rechazar')} />
        )
      })}
    </div>
    </>
  )
}

function TarjetaAprobar({ p, conAnalitica, ventasTotales, campana, valor, setValor, nota, trabajando, onAprobar, onRechazar }: {
  p: Prod; conAnalitica: boolean; ventasTotales?: number; campana: CampanaPend; valor: string; setValor: (v: string) => void; nota?: string; trabajando: boolean; onAprobar: (desc: number) => void; onRechazar: () => void
}) {
  const g = GRUPOS[p.grupo]
  const desc = Math.max(0, Math.min(90, Number(valor) || 0))
  const precio = p.pvp > 0 ? R2(p.pvp * (1 - desc / 100)) : 0
  const ahorro = p.pvp > 0 ? R2(p.pvp - precio) : 0
  const sobrestock = p.stock >= 3
  return (
    <article className="pc">
      <div className="pc-top"><div className="ph">{p.img ? <img loading="lazy" src={p.img} alt="" onError={(ev) => ev.currentTarget.remove()} /> : <Package style={{ width: 28, height: 28 }} />}</div>
        <div className="min-w-0 flex-1">
          <div className="flex gap-1.5 flex-wrap mb-1">
            {p.conObs && <span className="pill" style={{ background: '#f3e8ff', color: '#6d28d9' }}><AlertTriangle style={{ width: 11, height: 11 }} />Con observaciones</span>}
            {g && <span className="pill" style={{ background: g.hex + '1f', color: g.hex }}>Antigüedad · {meses(p.dias)}</span>}
            {ventasTotales != null && (ventasTotales === 0
              ? <span className="pill" style={{ background: '#f1f5f9', color: '#334155' }}>Nunca vendido</span>
              : <span className="pill" style={{ background: '#ecfdf5', color: '#047857' }}>{ventasTotales} venta{ventasTotales === 1 ? '' : 's'} registrada{ventasTotales === 1 ? '' : 's'}</span>)}
            {sobrestock && <span className="pill" style={{ background: '#fff1e6', color: '#c2410c' }}>Sobrestock · {p.stock} u.</span>}
            {p.interes > 0 && <span className="pill" style={{ background: '#fff7ed', color: '#c2410c' }}><Users style={{ width: 11, height: 11 }} />{p.interes} cotizaron sin comprar</span>}
          </div>
          <p className="font-bold text-[14px] leading-snug text-slate-800 line-clamp-2">{p.nombre}</p>
          <p className="text-[11px] text-slate-400 mono">{p.codigo} · {p.categoria}</p>
          <p className="text-[11.5px] mt-1" style={{ color: '#055c9d' }}><b>{campana.nombre}</b>{(campana.inicio || campana.fin) && <> · vigente {fechaC(campana.inicio ?? '')} → {fechaC(campana.fin ?? '')}</>}</p>
          {conAnalitica && <p className="text-[12px] text-slate-600 mt-1"><b>{p.stock}</b> u. · {money0(p.capitalPvp)} detenido{p.ultVenta ? ' · última venta ' + meses(p.diasSinVenta ?? 0) : ' · sin ventas registradas'}</p>}
          {p.conObs && <p className="text-[11.5px] text-violet-700 font-semibold mt-1 line-clamp-2">{p.motivosObs.join(' · ')}</p>}
          {nota && <p className="text-[11.5px] text-slate-500 mt-1 italic">"{nota}"</p>}
        </div>
      </div>
      <div className="jug">
        <div className="t"><BadgePercent style={{ width: 13, height: 13 }} />% propuesto por Marketing</div>
        <div className="flex items-center gap-2 mt-1.5">
          <input type="number" min="0" max="90" step="0.5" className="inp font-bold" style={{ fontSize: 26, height: 48, width: 92, color: 'var(--acc)' }} value={valor} disabled={trabajando} onChange={(ev) => setValor(ev.target.value)} />
          <span className="text-lg font-bold" style={{ color: 'var(--acc)' }}>%</span>
          <div className="ml-auto text-right">
            {p.pvp > 0 && <span className="precio-a">{money(p.pvp)}</span>} <span className="precio-n">{money(precio)}</span>
          </div>
        </div>
        {p.pvp > 0 && desc > 0 && <p className="text-[11.5px] font-semibold mt-1.5" style={{ color: '#04896f' }}>El cliente ahorra {money(ahorro)}</p>}
      </div>
      <div className="flex gap-2" style={{ margin: '0 12px 12px' }}>
        <button className="btn flex-1 justify-center" disabled={trabajando} style={{ background: '#c0392b', borderColor: '#c0392b', color: '#fff' }} onClick={onRechazar}><XCircle className="w-4 h-4" />Rechazar</button>
        <button className="btn flex-1 justify-center" disabled={trabajando || desc <= 0} style={{ background: '#04896f', borderColor: '#04896f', color: '#fff' }} onClick={() => onAprobar(desc)}><Check className="w-4 h-4" />Aprobar</button>
      </div>
    </article>
  )
}

function ListaOfertas({ ofertas, prods, abrir }: { ofertas: Oferta[]; prods: Prod[]; abrir: (o: Oferta) => void }) {
  const orden: Record<string, number> = { Activa: 0, Programada: 1, Pausada: 2, Finalizada: 3, Cancelada: 4 }
  const l = [...ofertas].sort((a, b) => orden[a.estado] - orden[b.estado] || b.creado.localeCompare(a.creado))
  if (!l.length) return <div className="vacio"><Tag className="mx-auto mb-2" style={{ width: 34, height: 34 }} /><p className="font-semibold">Aún no hay ofertas.</p><p className="text-sm">Abre un producto en Oportunidades o usa el Plan de liquidación.</p></div>
  return (
    <div className="space-y-2">{l.map((o) => {
      const p = prods.find((x) => x.id === o.productoId), meta = o.objetivo || o.stockInicial || 1, pct = Math.min(100, Math.round(o.vendidas / meta * 100))
      const ini = new Date(o.inicio + 'T00:00:00').getTime(), fin = new Date(o.fin + 'T00:00:00').getTime() + DIA, tPct = Math.max(0, Math.min(100, (Date.now() - ini) / (fin - ini) * 100))
      return (
        <div key={o.id} className="of-row" onClick={() => abrir(o)} style={{ cursor: 'pointer' }}>
          <div className="ph" style={{ width: 56, height: 56 }}>{p?.img ? <img loading="lazy" src={p.img} alt="" /> : <Package />}</div>
          <div className="min-w-0"><div className="flex gap-1.5 flex-wrap items-center"><span className={'pill e-' + o.estado}>{o.estado}</span><span className="pill" style={{ background: '#fff7ed', color: '#c2410c' }}>{o.tipo} -{o.descuento}%</span><span className="text-[10.5px] text-slate-400 mono">{o.codigo}</span></div>
            <p className="font-bold text-[13.5px] text-slate-800 truncate mt-1">{o.producto}</p><p className="text-[11.5px] text-slate-500">{money(o.precio)} <s>{money(o.pvp)}</s> · {fechaC(o.inicio)} → {fechaC(o.fin)} · {o.creadoPor}</p></div>
          <div className="col-span-2 md:col-span-1"><p className="text-[11px] text-slate-500 mb-1">Vendidas <b className="text-slate-800">{o.vendidas} de {meta}</b></p><div className="prog"><i style={{ width: pct + '%' }} /></div></div>
          <div className="col-span-2 md:col-span-1"><p className="text-[11px] text-slate-500 mb-1">Recuperado <b className="text-slate-800">{money0(o.recuperado)}</b> · tiempo {Math.round(tPct)}%</p><div className="prog"><i style={{ width: tPct + '%', background: '#f59e0b' }} /></div></div>
          <div className="col-span-2 md:col-span-1 flex gap-2 justify-end"><button className="btn btn-sm"><Megaphone />Campaña</button></div>
        </div>
      )
    })}</div>
  )
}

function Resultados({ ofertas: O }: { ofertas: Oferta[] }) {
  if (!O.length) return <div className="vacio"><LineChart className="mx-auto mb-2" style={{ width: 34, height: 34 }} /><p className="font-semibold">Los resultados aparecen cuando empiecen las ofertas.</p></div>
  const tot = O.reduce((a, o) => a + o.recuperado, 0), uni = O.reduce((a, o) => a + o.vendidas, 0), conVenta = O.filter((o) => o.vendidas > 0).length
  const porTipo: Record<string, { n: number; u: number; r: number; ex: number }> = {}
  O.forEach((o) => { const t = (porTipo[o.tipo] = porTipo[o.tipo] || { n: 0, u: 0, r: 0, ex: 0 }); t.n++; t.u += o.vendidas; t.r += o.recuperado; if (o.vendidas > 0) t.ex++ })
  const tipos = Object.keys(porTipo).sort((a, b) => porTipo[b].r - porTipo[a].r), maxR = Math.max(1, ...tipos.map((t) => porTipo[t].r))
  const top = [...O].sort((a, b) => b.recuperado - a.recuperado).slice(0, 8)
  return (
    <>
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi" style={{ ['--c' as string]: '#04896f', cursor: 'default' }}><small>Dinero recuperado</small><b>{money0(tot)}</b><span>ventas durante las ofertas</span></div>
        <div className="kpi" style={{ ['--c' as string]: '#055c9d', cursor: 'default' }}><small>Unidades vendidas</small><b>{uni}</b><span>en {O.length} oferta(s)</span></div>
        <div className="kpi" style={{ ['--c' as string]: '#c2410c', cursor: 'default' }}><small>Tasa de éxito</small><b>{Math.round(conVenta / O.length * 100)}%</b><span>ofertas con al menos 1 venta</span></div></div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="sec"><h3><Trophy />Qué estrategia funciona mejor</h3><table className="tbl"><thead><tr><th>Estrategia</th><th className="num">Ofertas</th><th className="num">Éxito</th><th className="num">Unid.</th><th>Recuperado</th></tr></thead><tbody>
          {tipos.map((t) => { const x = porTipo[t]; return <tr key={t}><td><b>{t}</b></td><td className="num">{x.n}</td><td className="num">{Math.round(x.ex / x.n * 100)}%</td><td className="num">{x.u}</td><td><div className="flex items-center gap-2"><div className="prog flex-1"><i style={{ width: x.r / maxR * 100 + '%', background: '#c2410c' }} /></div><span className="text-[12px] w-[70px] text-right">{money0(x.r)}</span></div></td></tr> })}</tbody></table></div>
        <div className="sec"><h3><Medal />Ofertas que más recuperaron</h3>{top.map((o, i) => <div key={o.id} className="flex items-center gap-3 py-2 border-b border-slate-100"><b className="w-6 text-slate-400">{i + 1}</b><div className="min-w-0 flex-1"><p className="text-[13px] font-semibold truncate">{o.producto}</p><p className="text-[11px] text-slate-500">{o.tipo} -{o.descuento}% · {o.vendidas} u. en {o.diasActiva} días</p></div><b className="text-[13px]">{money0(o.recuperado)}</b></div>)}</div>
      </div>
    </>
  )
}

/* ============================ Panel del producto ============================ */
type FormO = { tipo: string; desc: number; ini: string; fin: string; texto: string; combo: string; regalo: string; obj: string }
function Drawer({ p, o, cfg, puedeEditar, puedeCrear, puedeEliminar, aviso, cerrar, guardar, estado, refrescar }: { p: Prod; o: Oferta | null; cfg: Cfg; puedeEditar: boolean; puedeCrear: boolean; puedeEliminar: boolean; aviso: (t: string) => void; cerrar: () => void
  guardar: (d: { id?: string; tipo: string; desc: number; ini: string; fin: string; texto: string; comboCon: string; regalo: string; objetivo: string }) => Promise<string>; estado: (o: Oferta, a: 'pausar' | 'reanudar' | 'finalizar' | 'cancelar' | 'eliminar', m?: string) => Promise<void>; refrescar: () => Promise<void> }) {
  const e = p.estrategia
  const [on, setOn] = useState(false)
  useEffect(() => { const t = requestAnimationFrame(() => setOn(true)); const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => { cancelAnimationFrame(t); document.removeEventListener('keydown', k) } }, [cerrar])
  const editable = !o || ['Activa', 'Programada', 'Pausada'].includes(o.estado)
  const [f, setF] = useState<FormO>(() => (o ? { tipo: o.tipo, desc: o.descuento, ini: o.inicio, fin: o.fin, texto: o.texto, combo: o.comboCon, regalo: o.regalo, obj: o.objetivo ? String(o.objetivo) : '' } : { tipo: e.tipo, desc: e.descuento, ini: ymd(Date.now()), fin: ymd(Date.now() + e.dias * DIA), texto: textoBase(p, e), combo: e.comboCon, regalo: e.regalo, obj: '' }))
  const [ocupado, setOcupado] = useState(false)
  const [confirma, setConfirma] = useState<'pausar' | 'reanudar' | 'finalizar' | 'cancelar' | 'eliminar' | null>(null)
  const maxDesc = p.pvp > 0 && p.costo > 0 ? Math.max(0, Math.floor((1 - p.costo * (1 + cfg.margenMinimo / 100) / p.pvp) * 100)) : 35
  const precio = R2(p.pvp * (1 - f.desc / 100)), margen = p.costo > 0 && precio > 0 ? Math.round((precio - p.costo) / precio * 1000) / 10 : null
  const sem: [string, string] = !p.costo ? ['am', 'Sin "Costo Importación": se permite hasta 35%. Cárgalo en Inventario para ver el margen real.'] : margen! < cfg.margenMinimo ? ['rj', `Debajo del piso (costo + ${cfg.margenMinimo}%). Máximo ${maxDesc}%.`] : margen! < cfg.margenMinimo + 10 ? ['am', `Margen ajustado: ${margen}%.`] : ['ok', `Margen sano: ${margen}%.`]
  const maxLote = Math.max(1, ...p.lotes.map((l) => l[1]))
  const set = (k: keyof FormO) => (x: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: x.target.value }))
  const puedeGuardar = o ? puedeEditar : puedeCrear
  const I = TIPO_IC[e.tipo] || Sparkles
  return (
    <>
      <div className={'drw-v' + (on ? ' on' : '')} onClick={cerrar} />
      <aside className={'drw' + (on ? ' on' : '')} aria-hidden={!on}>
        <div className="drw-h"><button className="btn btn-sm btn-g" onClick={cerrar} aria-label="Cerrar"><X /></button>
          <div className="w-11 h-11 rounded-xl bg-white overflow-hidden grid place-items-center text-slate-400 shrink-0">{p.img ? <img src={p.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <Package />}</div>
          <div className="min-w-0"><p className="font-display font-bold leading-tight truncate">{p.nombre}</p><p className="text-[11px] text-white/70 mono">{p.codigo} · {p.categoria}</p></div></div>
        <div className="drw-b">
          <div className="sec"><h3><Activity />Diagnóstico</h3>
            <div className="kv"><div><small>Stock</small><b>{p.stock} u.</b></div><div><small>Más antiguo</small><b>{p.dias ? meses(p.dias) : '—'}</b></div><div><small>Vendidas 12 meses</small><b>{p.v365}</b></div><div><small>Última venta</small><b>{p.ultVenta ? fechaC(p.ultVenta) : 'nunca'}</b></div>
              <div><small>PVP</small><b>{money(p.pvp)}</b></div><div><small>Costo</small><b>{p.costo ? money(p.costo) : '—'}</b></div><div><small>Detenido (PVP)</small><b>{money0(p.capitalPvp)}</b></div><div><small>Interesados</small><b>{p.interes}</b></div></div>
            <p className="lbl mt-3">Lotes en bodega (lo más antiguo se vende primero)</p>
            {p.lotes.length ? [...p.lotes].reverse().map((l, i) => { const d = l[0] ? Math.floor((Date.now() - new Date(l[0] + 'T12:00:00').getTime()) / DIA) : null, g = d == null ? '#94a3b8' : d >= 365 ? '#b91c1c' : d >= 180 ? '#ea580c' : d >= 90 ? '#f59e0b' : '#04896f'
              return <div key={i} className="lote"><span className="w-[86px] text-slate-500">{l[0] ? fechaC(l[0]) : 'sin fecha'}</span><span className="bar"><i style={{ width: l[1] / maxLote * 100 + '%', background: g }} /></span><b className="w-[90px] text-right">{l[1]} u. · {d == null ? '—' : meses(d)}</b></div> }) : <p className="text-sm text-slate-500">Sin stock disponible para la venta.</p>}
            {p.conObs && <div className="aviso rj mt-3"><b>Observaciones:</b> {p.motivosObs.join(' · ')}</div>}</div>
          <div className="sec" style={{ borderColor: '#fed7aa', background: 'linear-gradient(135deg,#fff7ed,#fff)' }}><h3 style={{ color: 'var(--acc)' }}><I />El estratega sugiere: {e.tipo}</h3>
            <p className="text-[13.5px] leading-relaxed text-slate-700">{e.porque}</p>
            <div className="flex gap-4 flex-wrap mt-2 text-[13px]"><span>Descuento <b>{e.descuento}%</b></span><span>Precio <b>{money(e.precio)}</b></span>{e.margen != null && <span>Margen <b>{e.margen}%</b></span>}<span>Recupera <b>{money0(e.recupera)}</b></span><span>Vigencia <b>{e.dias} días</b></span></div>
            {e.limitadoPorCosto && <p className="text-[12px] text-amber-700 mt-2">El descuento sugerido se recortó para no bajar del costo + {cfg.margenMinimo}%. Máximo posible: {e.maxDesc}%.</p>}</div>
          <ObservacionOriginal p={p} puedeEditar={puedeEditar} aviso={aviso} guardado={async () => { await refrescar(); cerrar() }} />
          <div className="sec"><h3><Tag />{o ? <>Oferta {o.codigo} <span className={'pill e-' + o.estado}>{o.estado}</span></> : 'Crear oferta'}</h3>
            {!editable ? <p className="text-sm text-slate-500">Esta oferta ya terminó. Crea una nueva desde la lista.</p> : (
              <>
                <label className="lbl">Tipo</label><div className="seg mb-3">{TIPOS.map((t) => <button key={t} className={t === f.tipo ? 'on' : ''} onClick={() => setF((v) => ({ ...v, tipo: t }))}>{t}</button>)}</div>
                <label className="lbl">Descuento: <b>{f.desc}%</b> <span className="font-normal text-slate-400">(máx. {maxDesc}%)</span></label>
                <input type="range" min={0} max={Math.max(1, maxDesc)} step={1} value={Math.min(f.desc, Math.max(1, maxDesc))} onChange={(x) => setF((v) => ({ ...v, desc: +x.target.value }))} />
                <div className="flex items-end justify-between mt-2"><div><span className="precio-n">{money(precio)}</span> <span className="precio-a">{money(p.pvp)}</span><p className="text-[11px] text-slate-500">+ IVA · ahorro {money(p.pvp - precio)} por unidad</p></div><div className="text-right text-[12px]"><b>Recupera {money0(precio * p.stock)}</b><br /><span className="text-slate-500">{p.stock} u.</span></div></div>
                <div className={'aviso mt-2 ' + sem[0]}>{sem[1]}</div>
                <div className="grid grid-cols-2 gap-2 mt-3"><label><span className="lbl">Desde</span><input type="date" className="inp" value={f.ini} onChange={set('ini')} /></label><label><span className="lbl">Hasta</span><input type="date" className="inp" value={f.fin} onChange={set('fin')} /></label></div>
                <div className="seg mt-2">{([[7, '1 semana'], [15, '15 días'], [30, '1 mes'], [60, '2 meses']] as const).map(([d, t]) => <button key={d} onClick={() => setF((v) => ({ ...v, fin: ymd(new Date(v.ini + 'T12:00:00').getTime() + d * DIA) }))}>{t}</button>)}</div>
                {f.tipo === 'Combo' && <label className="block mt-3"><span className="lbl">Combo con (código del producto estrella)</span><input className="inp mono" value={f.combo} placeholder="Ej. EQM100" onChange={(x) => setF((v) => ({ ...v, combo: x.target.value.trim().toUpperCase() }))} /></label>}
                {f.tipo === 'Regalo' && <label className="block mt-3"><span className="lbl">Qué se regala</span><input className="inp" value={f.regalo} placeholder="Ej. Capacitación y mantenimiento preventivo" onChange={set('regalo')} /></label>}
                <label className="block mt-3"><span className="lbl">Texto para el cliente (lo ve el asesor al cotizar)</span><textarea className="inp" rows={2} maxLength={400} value={f.texto} onChange={set('texto')} /></label>
                <label className="block mt-3"><span className="lbl">Meta de unidades (opcional)</span><input className="inp" type="number" min={0} inputMode="numeric" value={f.obj} placeholder={String(p.stock)} onChange={set('obj')} /></label>
                <div className="flex gap-2 mt-4 flex-wrap">
                  {o && puedeEditar && <>{o.estado === 'Pausada' ? <button className="btn btn-sm" onClick={() => setConfirma('reanudar')}><Play />Reanudar</button> : <button className="btn btn-sm" onClick={() => setConfirma('pausar')}><Pause />Pausar</button>}<button className="btn btn-sm" onClick={() => setConfirma('finalizar')}><Flag />Finalizar hoy</button><button className="btn btn-sm" onClick={() => setConfirma('cancelar')}><XCircle />Cancelar</button>{puedeEliminar && <button className="btn btn-sm" onClick={() => setConfirma('eliminar')}><Trash2 />Eliminar</button>}</>}
                  {puedeGuardar && <button className="btn btn-p flex-1" disabled={ocupado} onClick={async () => { setOcupado(true); try { await guardar({ id: o?.id, tipo: f.tipo, desc: f.desc, ini: f.ini, fin: f.fin, texto: f.texto, comboCon: f.combo, regalo: f.regalo, objetivo: f.obj }); cerrar() } catch (err) { aviso((err as Error).message) } setOcupado(false) }}>{ocupado ? <span className="spin" /> : <><Check />{o ? 'Guardar cambios' : 'Publicar oferta'}</>}</button>}
                </div></>
            )}</div>
          {o && <Kit p={p} o={o} aviso={aviso} />}
          <Interesados p={p} o={o} />
        </div>
      </aside>
      {confirma && confirma !== 'eliminar' && o && (
        <div className="ovl" onClick={() => setConfirma(null)}><div className="sheet" onClick={(x) => x.stopPropagation()}>
          <h3 className="font-display font-bold text-lg text-[var(--navy)] mb-2">¿Seguro que quieres {({ pausar: 'pausar', reanudar: 'reanudar', finalizar: 'finalizar hoy', cancelar: 'cancelar' } as Record<string, string>)[confirma]} la oferta?</h3>
          <p className="text-sm text-slate-600 mb-4">{({ cancelar: 'Deja de verse en el CRM y catálogos y queda como cancelada.', finalizar: 'Termina hoy y queda en Resultados con lo que vendió.', pausar: 'Deja de verse hasta que la reanudes.', reanudar: 'Vuelve a verse en el CRM y catálogos.' } as Record<string, string>)[confirma]}</p>
          <div className="flex gap-2"><button className="btn flex-1" onClick={() => setConfirma(null)}>No</button><button className="btn btn-n flex-1" onClick={async () => { const a = confirma; setConfirma(null); try { await estado(o, a); cerrar() } catch (err) { aviso((err as Error).message) } }}>Sí</button></div></div></div>
      )}
      {confirma === 'eliminar' && o && <ConfirmarEliminar titulo="¿Eliminar esta oferta?" detalle="Se quita de la app (no se borra de la base) y deja de verse en el CRM y catálogos. Se puede restaurar desde la Papelera." cerrar={() => setConfirma(null)} ok={async (m) => { setConfirma(null); try { await estado(o, 'eliminar', m); cerrar() } catch (err) { aviso((err as Error).message) } }} />}
    </>
  )
}

function ObservacionOriginal({ p, puedeEditar, aviso, guardado }: { p: Prod; puedeEditar: boolean; aviso: (t: string) => void; guardado: () => Promise<void> }) {
  const [txt, setTxt] = useState(p.obs)
  const [ocupado, setOcupado] = useState(false)
  return (
    <div className="sec"><h3>Observación original del inventario</h3>
      <p className="text-xs text-slate-500 mb-2">Los cambios se guardan en Productos y se reflejan en los módulos que usan esta observación. Las alertas de bodega se calculan por separado.</p>
      <label className="lbl">Observación original</label><textarea className="inp" rows={4} maxLength={50000} value={txt} readOnly={!puedeEditar} onChange={(e) => setTxt(e.target.value)} />
      <div className="flex gap-2 mt-2"><button className="btn btn-sm" onClick={() => setTxt(p.obs)}>Deshacer cambios</button>
        <button className="btn btn-sm btn-n" disabled={!puedeEditar || ocupado || txt === p.obs} onClick={async () => {
          setOcupado(true)
          const { data } = await supabase.from('productos').select('reservaciones').eq('id', p.id).single()
          if ((data?.reservaciones ?? '').trim() !== p.obs) { setOcupado(false); aviso('Otra persona cambió la observación. Cierra y vuelve a abrir el producto.'); return }
          const { error } = await supabase.from('productos').update({ reservaciones: txt || null }).eq('id', p.id)
          setOcupado(false)
          if (error) { aviso(error.message); return }
          aviso('Observación original guardada'); await guardado() }}>{ocupado ? 'Guardando…' : 'Guardar observación'}</button></div></div>
  )
}

function Kit({ p, o, aviso }: { p: Prod; o: Oferta; aviso: (t: string) => void }) {
  const [T, setT] = useState<Textos>(() => plantillas(p, o))
  const cvPost = useRef<HTMLCanvasElement>(null), cvHist = useRef<HTMLCanvasElement>(null)
  const [foto, setFoto] = useState<HTMLImageElement | null | undefined>(undefined)
  const [logo, setLogo] = useState<HTMLImageElement | null>(null)
  useEffect(() => { let vivo = true; (async () => { const [f, l] = await Promise.all([p.img ? aDataUrl(imgUrl(p.img, 900)).then(cargarImg) : Promise.resolve(null), cargarImg(LOGO_BLANCO)]); if (vivo) { setFoto(f); setLogo(l) } })(); return () => { vivo = false } }, [p.img])
  useEffect(() => {
    ;([[cvPost.current, 1080, 1080], [cvHist.current, 1080, 1920]] as const).forEach(([c, W, H]) => { if (c) dibujar(c, W, H, p, o, T.titular, foto, logo) })
  }, [p, o, T.titular, foto, logo])
  const bajar = (c: HTMLCanvasElement | null, n: string) => { c?.toBlob((b) => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `VIMEDIC-${n}-${p.codigo}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000) }, 'image/png') }
  const caja = (k: keyof Textos, t: string) => (
    <div className="mt-3"><div className="flex items-center justify-between gap-2 mb-1"><span className="lbl !mb-0">{t}</span><button className="btn btn-sm" onClick={() => copiar(T[k], aviso)}><Copy />Copiar</button></div>
      <div className="txt" contentEditable suppressContentEditableWarning onInput={(e) => setT((x) => ({ ...x, [k]: (e.target as HTMLElement).innerText }))}>{T[k]}</div></div>
  )
  return (
    <div className="sec"><h3><Megaphone />Kit de campaña</h3>
      <div className="flex gap-2 flex-wrap"><button className="btn btn-sm btn-n" disabled title="Configura GEMINI_API_KEY para usar la IA"><Sparkles />Redactar con IA</button><button className="btn btn-sm" onClick={() => setT(plantillas(p, o))}><RotateCcw />Plantilla</button></div>
      <p className="lbl mt-3">Arte para redes (se arma con la foto del producto)</p>
      <div className="cv-wrap"><canvas ref={cvPost} width={1080} height={1080} /><canvas ref={cvHist} width={1080} height={1920} /></div>
      <div className="flex gap-2 mt-2 flex-wrap"><button className="btn btn-sm" onClick={() => bajar(cvPost.current, 'post')}><Download />Post 1080×1080</button><button className="btn btn-sm" onClick={() => bajar(cvHist.current, 'historia')}><Download />Historia 1080×1920</button></div>
      {caja('whatsapp', 'WhatsApp ({nombre} se cambia por el nombre del cliente)')}{caja('redes', 'Instagram / Facebook')}{caja('asunto', 'Asunto del correo')}{caja('correo', 'Correo')}
    </div>
  )
}
function envolver(ctx: CanvasRenderingContext2D, txt: string, x: number, y: number, ancho: number, alto: number, max: number) {
  const pal = String(txt).split(/\s+/), lineas: string[] = []; let l = ''
  pal.forEach((w) => { const t = l ? l + ' ' + w : w; if (ctx.measureText(t).width > ancho && l) { lineas.push(l); l = w } else l = t })
  if (l) lineas.push(l)
  const out = lineas.slice(0, max); if (lineas.length > max) out[max - 1] = out[max - 1].replace(/\s*\S*$/, '') + '…'
  out.forEach((t, i) => ctx.fillText(t, x, y + i * alto)); return out.length
}
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }
function dibujar(c: HTMLCanvasElement, W: number, H: number, p: Prod, o: Oferta, titular: string, foto: HTMLImageElement | null | undefined, logo: HTMLImageElement | null) {
  const ctx = c.getContext('2d')!, hist = H > W
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0b2545'); g.addColorStop(0.65, '#102f57'); g.addColorStop(1, '#3b1d12'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  const rg = ctx.createRadialGradient(W * 0.92, H * 0.08, 10, W * 0.92, H * 0.08, W * 0.55); rg.addColorStop(0, 'rgba(234,88,12,.55)'); rg.addColorStop(1, 'rgba(234,88,12,0)'); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H)
  const m = 70
  ctx.fillStyle = '#fdba74'; ctx.font = '800 34px Inter, Arial'; ctx.textBaseline = 'top'; ctx.fillText(String(titular || 'OFERTA').toUpperCase(), m, hist ? 150 : 70)
  const cy = hist ? 230 : 130, ch = hist ? 920 : 560, cw = W - m * 2
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20; ctx.fillStyle = '#ffffff'; rr(ctx, m, cy, cw, ch, 44); ctx.fill(); ctx.restore()
  if (foto) { const pad = 50, bw = cw - pad * 2, bh = ch - pad * 2, s = Math.min(bw / foto.width, bh / foto.height); ctx.drawImage(foto, m + pad + (bw - foto.width * s) / 2, cy + pad + (bh - foto.height * s) / 2, foto.width * s, foto.height * s) }
  else { ctx.fillStyle = '#cbd5e1'; ctx.font = '600 34px Inter, Arial'; ctx.textAlign = 'center'; ctx.fillText(foto === undefined ? 'Cargando foto…' : 'Sin foto', W / 2, cy + ch / 2 - 17); ctx.textAlign = 'left' }
  if (o.descuento > 0) { const r = hist ? 120 : 105, sx = W - m - r + 20, sy = cy - 30 + r; ctx.fillStyle = '#ea580c'; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 6; ctx.stroke()
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `900 ${hist ? 74 : 64}px Inter, Arial`; ctx.fillText('-' + Math.round(o.descuento) + '%', sx, sy - (hist ? 44 : 38)); ctx.font = '700 22px Inter, Arial'; ctx.fillText(o.tipo === 'Outlet' ? 'OUTLET' : 'DESCUENTO', sx, sy + (hist ? 34 : 30)); ctx.textAlign = 'left' }
  let y = cy + ch + (hist ? 70 : 40)
  ctx.fillStyle = '#ffffff'; ctx.font = `700 ${hist ? 60 : 46}px "Space Grotesk", Inter, Arial`
  const nl = envolver(ctx, p.nombre, m, y, W - m * 2, hist ? 70 : 54, 2); y += nl * (hist ? 70 : 54) + (hist ? 30 : 16)
  if (o.tipo === 'Outlet' && p.motivosObs[0]) { ctx.fillStyle = '#c4b5fd'; ctx.font = `600 ${hist ? 32 : 26}px Inter, Arial`; envolver(ctx, 'Equipo con detalle: ' + p.motivosObs[0], m, y, W - m * 2, 36, 1); y += hist ? 56 : 40 }
  ctx.fillStyle = '#fb923c'; ctx.font = `900 ${hist ? 120 : 92}px Inter, Arial`; const pt = money(o.precio); ctx.fillText(pt, m, y)
  const pw = ctx.measureText(pt).width; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = `600 ${hist ? 34 : 28}px Inter, Arial`; ctx.fillText('+ IVA', m + pw + 18, y + (hist ? 70 : 52))
  y += hist ? 140 : 104
  if (o.descuento > 0) { ctx.font = `600 ${hist ? 38 : 30}px Inter, Arial`; ctx.fillStyle = 'rgba(255,255,255,.6)'; const at = 'Antes ' + money(o.pvp); ctx.fillText(at, m, y); const aw = ctx.measureText(at).width; ctx.fillRect(m, y + (hist ? 21 : 17), aw, 3) }
  const py = H - (hist ? 170 : 92)
  ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(m, py - 26, W - m * 2, 2)
  ctx.fillStyle = '#ffffff'; ctx.font = `600 ${hist ? 32 : 26}px Inter, Arial`; ctx.fillText('Válido hasta el ' + fechaC(o.fin) + ' o hasta agotar stock', m, py)
  if (logo) { const lh = hist ? 70 : 52, lw = logo.width * lh / logo.height; ctx.drawImage(logo, W - m - lw, py - (hist ? 14 : 12), lw, lh) }
  else { ctx.font = `800 ${hist ? 40 : 32}px "Space Grotesk", Inter`; ctx.textAlign = 'right'; ctx.fillText('VIMEDIC', W - m, py - 4); ctx.textAlign = 'left' }
  if (hist) { ctx.font = '700 34px Inter, Arial'; ctx.fillStyle = '#fdba74'; ctx.fillText('Escríbenos para reservar', m, py + 60) }
}

type Interesado = { id: string; nombre: string; telefono: string; email: string; asesor: string; estado: string; fecha: string; precioCotizado: number; empresa: string }
function Interesados({ p, o }: { p: Prod; o: Oferta | null }) {
  const [l, setL] = useState<Interesado[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('cotizaciones').select('codigo,nombre,telefono,email,fecha,estado_crm,empresa,items,asesor:empleados!cotizaciones_asesor_id_fkey(nombre)').is('deleted_at', null).neq('tipo_registro', 'Venta').not('estado_crm', 'ilike', '%ganado%')
      .contains('items', [{ codigo: p.codigo }]).order('fecha', { ascending: false }).limit(200).then(({ data, error }) => {
        if (error) { setErr(error.message); return }
        const vistos = new Set<string>(), out: Interesado[] = []
        for (const r of (data ?? []) as unknown as Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
          const tel = String(r.telefono || '').replace(/\D/g, ''), mail = String(r.email || '').trim().toLowerCase(), clave = tel || mail || String(r.nombre); if (!clave || vistos.has(clave)) continue; vistos.add(clave)
          const it = (r.items as { codigo?: string; precio?: number }[]).find((x) => x.codigo === p.codigo)
          out.push({ id: r.codigo, nombre: r.nombre ?? '', telefono: tel, email: mail, asesor: String(r.asesor?.nombre ?? '').split(' (')[0], estado: r.estado_crm ?? '', fecha: String(r.fecha ?? '').slice(0, 10), precioCotizado: Number(it?.precio) || 0, empresa: r.empresa })
          if (out.length >= 60) break
        }
        setL(out)
      })
  }, [p.codigo])
  const T = o ? plantillas(p, o) : null
  return (
    <div className="sec"><h3><Users />Clientes que lo cotizaron y no compraron</h3>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {!l && !err && <div className="text-sm text-slate-500"><span className="spin" /> Buscando…</div>}
      {l && !l.length && <p className="text-sm text-slate-500">Nadie lo ha cotizado en los últimos meses. Para este producto funcionan mejor las redes y el catálogo.</p>}
      {l && l.length > 0 && <>{!o ? <div className="aviso am mb-2">Publica la oferta para enviarles el mensaje con el precio.</div> : <p className="mb-1 text-sm text-slate-500">Mensaje personalizado listo en cada contacto (se abre WhatsApp o el correo; tú lo envías).</p>}
        {l.map((c) => { const w = telWa(c.telefono), nom = (c.nombre || '').split(' ')[0]; return (
          <div key={c.id} className="int"><div className="w-9 h-9 rounded-full bg-slate-100 grid place-items-center font-bold text-slate-600 shrink-0">{(c.nombre || '?').charAt(0)}</div>
            <div className="min-w-0 flex-1"><p className="font-semibold text-slate-800 text-[13px] truncate">{c.nombre || 'Sin nombre'}</p><p className="text-[11px] text-slate-500">{[c.fecha ? 'cotizó ' + fechaC(c.fecha) : '', c.precioCotizado ? 'a ' + money(c.precioCotizado) : '', c.asesor, c.estado, c.empresa === 'FEMEDICS' ? 'Femedics' : ''].filter(Boolean).join(' · ')}</p></div>
            {T && w && <a className="btn btn-sm btn-ok" target="_blank" rel="noopener" href={`https://wa.me/${w}?text=${encodeURIComponent(T.whatsapp.replace(/\{nombre\}/g, nom))}`}><MessageCircle /></a>}
            {T && c.email && <a className="btn btn-sm" href={`mailto:${c.email}?subject=${encodeURIComponent(T.asunto)}&body=${encodeURIComponent(T.correo.replace(/\{nombre\}/g, nom))}`}><Mail /></a>}</div>) })}</>}
    </div>
  )
}

/* ============================ Hojas ============================ */
function Ajustes({ cfg, cerrar, guardar }: { cfg: Cfg; cerrar: () => void; guardar: (v: Cfg) => Promise<void> }) {
  const [v, setV] = useState<Cfg>(cfg)
  const [ocupado, setOcupado] = useState(false)
  const campo = (k: keyof Cfg, t: string, s?: string) => <label className="block"><span className="lbl">{t}</span><input className="inp" type="number" inputMode="decimal" min={0} max={k === 'diasOferta' ? 365 : 90} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />{s && <span className="text-[11px] text-slate-500">{s}</span>}</label>
  return (
    <div className="ovl" onClick={cerrar}><div className="sheet" onClick={(e) => e.stopPropagation()}>
      <h3 className="font-display font-bold text-lg text-[var(--navy)] mb-1">Ajustes del estratega</h3><p className="text-sm text-slate-600 mb-3">Valen para todas las sugerencias. El margen mínimo también se exige al guardar una oferta.</p>
      <div className="grid grid-cols-2 gap-3">{campo('margenMinimo', 'Margen mínimo sobre el costo (%)', 'Ninguna oferta baja de costo + este %')}{campo('diasOferta', 'Vigencia sugerida (días)')}{campo('desc36', 'Descuento 3 a 6 meses (%)')}{campo('desc612', 'Descuento 6 a 12 meses (%)')}{campo('desc12', 'Descuento más de 12 meses (%)')}{campo('descObs', 'Descuento con observaciones (%)')}</div>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" disabled={ocupado} onClick={async () => { setOcupado(true); await guardar(v); setOcupado(false) }}>Guardar</button></div></div></div>
  )
}
function PlanHoja({ ps, cerrar, crear }: { ps: Prod[]; cerrar: () => void; crear: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false)
  return (
    <div className="ovl" onClick={cerrar}><div className="sheet" onClick={(e) => e.stopPropagation()}>
      <h3 className="font-display font-bold text-lg text-[var(--navy)] mb-2">Crear {ps.length} ofertas</h3><p className="text-sm text-slate-600 mb-3">Se crean con la jugada sugerida de cada producto (tipo, descuento y vigencia), empiezan hoy y quedan listas para verse en el CRM, Inventario y catálogos. Después puedes ajustar cada una.</p>
      <div className="max-h-[40vh] overflow-auto border rounded-xl">{ps.map((p) => <div key={p.id} className="flex justify-between gap-2 text-[13px] px-3 py-2 border-b"><span className="min-w-0 truncate">{p.nombre}</span><b className="shrink-0">{p.estrategia.tipo} -{p.estrategia.descuento}%</b></div>)}</div>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" disabled={ocupado} onClick={async () => { setOcupado(true); await crear(); setOcupado(false) }}>{ocupado ? <><span className="spin" /> Creando…</> : 'Crear ofertas'}</button></div></div></div>
  )
}
function Papelera({ cerrar, aviso, restaurado }: { cerrar: () => void; aviso: (t: string) => void; restaurado: () => void }) {
  const [items, setItems] = useState<{ id: string; codigo: string; deleted_at: string; motivo_eliminacion: string | null; tipo: string; producto: { nombre: string } | null }[] | null>(null)
  useEffect(() => { supabase.from('ofertas').select('id,codigo,deleted_at,motivo_eliminacion,tipo,producto:productos!ofertas_producto_id_fkey(nombre)').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(100).then(({ data }) => setItems((data as never) ?? [])) }, [])
  async function restaurar(id: string) { const { error } = await supabase.from('ofertas').update({ deleted_at: null, motivo_eliminacion: null }).eq('id', id); if (error) { aviso(error.message); return } setItems((a) => (a ?? []).filter((x) => x.id !== id)); restaurado() }
  return (
    <div className="vmpap-fondo" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}><div className="vmpap" role="dialog" aria-modal="true">
      <div className="vmpap-h"><b>Papelera · Ofertas<small>Lo eliminado no se borra de la base: aquí puedes devolverlo a la app.</small></b><button className="vmpap-x" aria-label="Cerrar" onClick={cerrar}>×</button></div>
      <div className="vmpap-b">{items === null && <div className="vmpap-v">Cargando…</div>}{items && !items.length && <div className="vmpap-v">La papelera está vacía.</div>}
        {items?.map((x) => <div key={x.id} className="vmpap-i"><div className="vmpap-t"><p className="d"><span className="tg">Oferta</span>{x.producto?.nombre ?? ''} · {x.tipo}</p><p className="m">Eliminada el {new Date(x.deleted_at).toLocaleDateString('es-EC')}</p>{x.motivo_eliminacion && <p className="m">Motivo: {x.motivo_eliminacion}</p>}</div><button className="vmpap-r" onClick={() => restaurar(x.id)}>Restaurar</button></div>)}</div></div></div>
  )
}

/* ============================ Excel (SheetJS bajo demanda) y PDF con fotos ============================ */
let sheetjs: Promise<any> | null = null // eslint-disable-line @typescript-eslint/no-explicit-any
const libXlsx = () => (sheetjs ??= new Promise((ok, fail) => { const w = window as never as { XLSX?: unknown }; if (w.XLSX) return ok(w.XLSX); const s = document.createElement('script'); s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'; s.onload = () => (w.XLSX ? ok(w.XLSX) : fail(new Error('No se pudo cargar la descarga Excel.'))); s.onerror = () => { sheetjs = null; fail(new Error('No se pudo cargar la descarga Excel. Revisa tu conexión e intenta de nuevo.')) }; document.head.appendChild(s) }))
async function descargarExcel(tab: string, productos: Prod[], ofertas: Oferta[], aviso: (m: string) => void) {
  const filasO = (os: Oferta[]) => [['ID oferta', 'Código producto', 'Producto', 'Estado', 'Tipo', 'Descuento (%)', 'PVP (USD)', 'Precio oferta (USD)', 'Costo (USD)', 'Inicio', 'Fin', 'Meta unidades', 'Stock inicial', 'Unidades vendidas', 'Recuperado (USD)', 'Días activa', 'Creado por', 'Texto de oferta', 'Combo con', 'Regalo'],
    ...os.map((o) => [o.codigo, o.productoId, o.producto, o.estado, o.tipo, o.descuento, o.pvp, o.precio, o.costo, fechaC(o.inicio), fechaC(o.fin), o.objetivo || o.stockInicial || 1, o.stockInicial, o.vendidas, o.recuperado, o.diasActiva, o.creadoPor, o.texto, o.comboCon, o.regalo])]
  const hojas: [string, (string | number)[][]][] = []; let nombre = ''
  if (tab === 'opor') {
    if (!productos.length) return aviso('No hay productos para descargar con estos filtros.')
    nombre = 'Oportunidades'
    hojas.push([nombre, [['Código', 'Producto', 'Categoría', 'Marca', 'Grupo', 'Stock', 'Antigüedad (días)', 'Vendidas en 12 meses', 'Última venta', 'PVP (USD)', 'Costo (USD)', 'Capital detenido PVP (USD)', 'Interesados', 'Observaciones', 'Estrategia sugerida', 'Descuento sugerido (%)', 'Precio sugerido (USD)', 'Recuperación sugerida (USD)', 'Vigencia sugerida (días)', 'Motivo de estrategia', 'Oferta vigente'],
      ...productos.map((p) => [p.codigo, p.nombre, p.categoria, p.marca, p.conObs ? 'Con observaciones' : GRUPOS[p.grupo]?.t || (p.nuncaVendido ? 'Nunca vendidos' : ''), p.stock, p.dias, p.v365, p.ultVenta ? fechaC(p.ultVenta) : '', p.pvp, p.costo, p.capitalPvp, p.interes, p.motivosObs.join(' · '), p.estrategia.tipo, p.estrategia.descuento, p.estrategia.precio, p.estrategia.recupera, p.estrategia.dias, p.estrategia.porque, p.ofertaId])]])
  } else if (tab === 'ofertas') { if (!ofertas.length) return aviso('No hay ofertas para descargar.'); nombre = 'Ofertas'; hojas.push([nombre, filasO(ofertas)]) }
  else {
    const os = ofertas.filter((o) => o.estado !== 'Programada'); if (!os.length) return aviso('No hay resultados para descargar.'); nombre = 'Resultados'
    hojas.push(['Resumen', [['Indicador', 'Valor'], ['Dinero recuperado (USD)', os.reduce((s, o) => s + o.recuperado, 0)], ['Unidades vendidas', os.reduce((s, o) => s + o.vendidas, 0)], ['Ofertas', os.length], ['Ofertas con ventas', os.filter((o) => o.vendidas > 0).length], ['Tasa de éxito (%)', Math.round(os.filter((o) => o.vendidas > 0).length / os.length * 100)]]])
    hojas.push(['Detalle de resultados', filasO(os)])
  }
  try {
    aviso('Preparando Excel…')
    const X = await libXlsx(), wb = X.utils.book_new()
    hojas.forEach(([titulo, filas]) => {
      const datos = filas.map((f) => f.map((v) => (v == null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? v : '') : String(v))))
      const ws = X.utils.aoa_to_sheet(datos)
      ws['!cols'] = datos[0].map((_, i) => ({ wch: Math.min(52, Math.max(14, ...datos.slice(0, 201).map((f) => String(f[i] ?? '').length + 2))) }))
      ws['!autofilter'] = { ref: ws['!ref'] }
      X.utils.book_append_sheet(wb, ws, titulo.slice(0, 31))
    })
    X.writeFile(wb, `VIMEDIC-${nombre}-${ymd(Date.now())}.xlsx`, { compression: true }); aviso('Excel preparado para descargar')
  } catch (e) { aviso((e as Error).message) }
}

function PdfHoja({ productos, ofertas, cerrar }: { productos: (Prod & { pdfOferta?: Oferta })[]; ofertas: Oferta[]; cerrar: () => void }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<Set<string>>(new Set())
  const [marca, setMarca] = useState('')
  const [grupo, setGrupo] = useState('')
  const [stock, setStock] = useState(true)
  const [obs, setObs] = useState(true)
  const [sel, setSel] = useState<Set<number>>(new Set(productos.map((_, i) => i)))
  const [prog, setProg] = useState('')
  const [url, setUrl] = useState('')
  const [gen, setGen] = useState(false)
  const vista = useMemo(() => { const w = norm(q).trim().split(/\s+/).filter(Boolean); return productos.map((p, i) => ({ p, i })).filter((x) => (!cat.size || cat.has(x.p.categoria)) && (!marca || x.p.marca === marca) && enGrupo(x.p, grupo) && w.every((t) => norm(x.p.codigo + ' ' + x.p.nombre).includes(t))) }, [productos, q, cat, marca, grupo])
  const n = vista.filter((x) => sel.has(x.i)).length
  const txt = (v: unknown) => String(v ?? '').replace(/[\u{1F000}-\u{1FFFF}☀-➿️‍]/gu, '').replace(/[^\x20-\x7E -ÿ\n]/g, ' ').replace(/ +/g, ' ').trim()
  async function generar() {
    const lista = vista.filter((x) => sel.has(x.i)).map((x) => x.p); if (!lista.length) return
    setGen(true); setUrl('')
    try {
      setProg('Preparando el PDF y las fotografías…')
      const { jsPDF } = await import('jspdf'); const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
      const total = Math.ceil(lista.length / 6), fecha = new Date().toLocaleDateString('es-EC'), fotos = new Map<string, string | null>(); let faltan = 0
      for (let pagina = 0; pagina < total; pagina++) {
        const lote = lista.slice(pagina * 6, pagina * 6 + 6)
        for (let k = 0; k < lote.length; k += 3) await Promise.all(lote.slice(k, k + 3).map(async (p) => { if (fotos.has(p.id)) return; fotos.set(p.id, p.img ? (await aDataUrl(imgUrl(p.img, 600))) || null : null) }))
        if (pagina) doc.addPage()
        doc.setFillColor(11, 37, 69); doc.rect(0, 0, 210, 27, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('VIMEDIC', 12, 12); doc.setFontSize(10); doc.text('Ofertas y Liquidacion | Lista de productos', 12, 20)
        doc.setTextColor(100, 116, 139); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(`${fecha} | ${lista.length} productos seleccionados`, 12, 34)
        lote.forEach((p, i) => {
          const x = 12 + (i % 2) * 95, y = 40 + Math.floor(i / 2) * 79, w = 91, h = 75
          doc.setDrawColor(226, 232, 240); doc.setFillColor(255, 255, 255); doc.roundedRect(x, y, w, h, 3, 3, 'FD')
          const foto = fotos.get(p.id)
          if (foto) { try { const prop = doc.getImageProperties(foto), s = Math.min(34 / prop.width, 31 / prop.height); doc.addImage(foto, prop.fileType, x + 4 + (34 - prop.width * s) / 2, y + 3 + (31 - prop.height * s) / 2, prop.width * s, prop.height * s, undefined, 'FAST') } catch { faltan++; doc.setFontSize(7); doc.text('Imagen no disponible', x + 4, y + 19) } }
          else { faltan++; doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text('Sin imagen disponible', x + 4, y + 19) }
          doc.setTextColor(11, 37, 69); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
          doc.text(doc.splitTextToSize(txt(p.nombre), 45).slice(0, 4), x + 41, y + 8)
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text(txt(p.codigo), x + 41, y + 29)
          const o = p.pdfOferta || ofertas.find((v) => v.id === p.ofertaId), activa = !!o && o.estado === 'Activa', e = p.estrategia, precio = activa ? o!.precio : e?.precio
          doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 37, 69); doc.setFontSize(8); doc.text(`PVP: ${money(p.pvp)} + IVA`, x + 4, y + 40)
          if (precio != null) { doc.setTextColor(194, 65, 12); doc.text(`${activa ? 'Oferta vigente: ' : 'Precio sugerido: '}${money(precio)} + IVA`, x + 4, y + 46) }
          doc.setFont('helvetica', 'normal'); doc.setTextColor(71, 85, 105); doc.setFontSize(7)
          if (stock) doc.text(`Stock: ${Number(p.stock) || 0} unidades`, x + 4, y + 52)
          if (activa && o!.fin) doc.text('Oferta hasta: ' + fechaC(o!.fin), x + 4, y + 57)
          if (obs) { const t = txt((p.motivosObs || []).join(' | ')); if (t) { const lineas = doc.splitTextToSize('Observaciones: ' + t, w - 8); doc.text(lineas.slice(0, 3), x + 4, y + 62); if (lineas.length > 3) { doc.setFontSize(6); doc.text('(Detalle completo en el modulo Ofertas)', x + 4, y + 73) } } }
          void h
        })
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text('Precios sugeridos sujetos a aprobacion. Verifica stock y vigencia antes de cotizar.', 12, 284); doc.text(`${pagina + 1} / ${total}`, 195, 284, { align: 'right' })
        setProg(`Preparados ${Math.min(lista.length, (pagina + 1) * 6)} de ${lista.length} productos…`)
      }
      setUrl(doc.output('datauristring')); setProg(`PDF generado: ${lista.length} productos, ${total} paginas.${faltan ? ` ${faltan} producto(s) sin imagen disponible.` : ' Todas las imagenes incluidas.'}`)
    } catch (e) { setProg((e as Error).message) }
    setGen(false)
  }
  const marcas = [...new Set(productos.map((p) => p.marca).filter(Boolean))].sort(), cats = [...new Set(productos.map((p) => p.categoria).filter(Boolean))].sort()
  return (
    <div className="ovl" onClick={() => !gen && cerrar()}><div className="sheet" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
      <h3 className="font-display font-bold text-lg text-[var(--navy)]">PDF con fotos de productos</h3><p className="text-sm text-slate-500 mt-1 mb-3">Parte de la lista que estás viendo. Filtra y marca los productos antes de descargar.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2"><span className="lbl">Buscar producto o código</span><input className="inp" placeholder="Nombre o código" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div><span className="lbl">Categorías (puedes marcar varias)</span><details className="inp"><summary style={{ cursor: 'pointer' }}>Elegir categorías</summary><div style={{ maxHeight: 150, overflow: 'auto' }}>{cats.map((c) => <label key={c} style={{ display: 'flex', gap: 8, padding: 6, fontSize: 12 }}><input type="checkbox" checked={cat.has(c)} onChange={(e) => { const s = new Set(cat); e.target.checked ? s.add(c) : s.delete(c); setCat(s) }} />{c}</label>)}</div><span className="text-xs text-slate-500">Sin marcas se incluyen todas.</span></details></div>
        <label><span className="lbl">Marca</span><select className="inp" value={marca} onChange={(e) => setMarca(e.target.value)}><option value="">Todas</option>{marcas.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="col-span-2"><span className="lbl">Grupo</span><select className="inp" value={grupo} onChange={(e) => setGrupo(e.target.value)}><option value="">Todos</option>{Object.keys(GRUPOS).map((k) => <option key={k} value={k}>{GRUPOS[k].t}</option>)}<option value="activas">Con oferta vigente</option></select></label></div>
      <div className="flex gap-2 flex-wrap my-3"><label className="text-xs"><input type="checkbox" checked={stock} onChange={(e) => setStock(e.target.checked)} /> Mostrar stock</label><label className="text-xs"><input type="checkbox" checked={obs} onChange={(e) => setObs(e.target.checked)} /> Mostrar observaciones</label></div>
      <div className="flex gap-2 mb-2"><button className="btn btn-sm" onClick={() => setSel(new Set([...sel, ...vista.map((x) => x.i)]))}>Marcar filtrados</button><button className="btn btn-sm" onClick={() => { const s = new Set(sel); vista.forEach((x) => s.delete(x.i)); setSel(s) }}>Desmarcar filtrados</button></div>
      <p className="text-xs font-bold mb-2">{n} seleccionados de {vista.length} filtrados. Solo se incluyen los productos marcados que cumplen estos filtros.</p>
      <div style={{ maxHeight: '32vh', overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 12 }}>
        {vista.length ? vista.map(({ p, i }) => <label key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 9, borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}><input type="checkbox" checked={sel.has(i)} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(i) : s.delete(i); setSel(s) }} />
          <span style={{ width: 46, height: 46, flexShrink: 0, background: '#f8fafc', display: 'grid', placeItems: 'center', borderRadius: 8 }}>{p.img ? <img loading="lazy" src={p.img} alt="" style={{ width: 46, height: 46, objectFit: 'contain' }} /> : 'Sin foto'}</span><span style={{ minWidth: 0 }}><b className="text-xs">{p.nombre}</b><br /><span className="text-xs text-slate-500">{p.codigo} · {money(p.pvp)}</span></span></label>) : <p className="text-sm p-3 text-slate-500">No hay productos con estos filtros.</p>}</div>
      <p className="text-xs text-slate-500 my-2" role="status">{prog}</p>
      {url && <a className="btn btn-ok w-full mt-2" href={url} download={`VIMEDIC-Ofertas-${ymd(Date.now())}.pdf`}>Guardar PDF generado</a>}
      <div className="flex gap-2 mt-3"><button className="btn flex-1" disabled={gen} onClick={cerrar}>Cerrar</button><button className="btn btn-p flex-1" disabled={gen || !n} onClick={generar}>{gen ? <span className="spin" /> : 'Preparar PDF'}</button></div></div></div>
  )
}
