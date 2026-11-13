import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertCircle, Award, BadgePercent, BookOpen, CalendarDays, CalendarRange, CheckCircle2, ClipboardCheck, Clapperboard, DollarSign, Download, FileText, Filter, FolderUp,
  GalleryHorizontal as Gallery, Image as ImageIcon, Images, LayoutDashboard, Lightbulb, ListChecks, Megaphone, PenLine, PieChart, Receipt, RefreshCw, Search, Send, ShoppingBag, Smartphone, Palette,
  Target, TrendingUp, Trash2, UploadCloud, UserCheck, Users, Video, X, Settings, Copy,
} from 'lucide-react'
import { Configuracion, Biblioteca } from './MarketingIntegraciones'
import { Revision } from './MarketingRevision'
import { Planificador } from './MarketingPlanificador'
import { Anuncios, Material, Promociones } from './MarketingExtra'
import { SubirMaterial, PapeleraAv, BuscadorProducto, useEquipo, type ProdBusq } from './MarketingArchivos'
import { miniaturaAv, enlaceZernio, esVideoAv, idDrive, fotogramaVideo, guardarMiniatura, prepararPortada, subirArchivoAv } from './audiovisualMedios'
import { Chart, registerables, type ChartConfiguration } from 'chart.js'
import { supabase, type Perfil } from '../supabase'
import { agrupar } from '../tiempoReal'
import { puede } from '../permisos'
import '../estilos/marketing.css'
import { PackageSearch } from 'lucide-react'
// Productos nuevos de las importaciones por identificar (vmRecIdentificar): se carga solo al abrirla
const Recepcion = lazy(() => import('./RecepcionImportaciones'))

Chart.register(...registerables)
Chart.defaults.font.family = 'Inter'; Chart.defaults.font.size = 10; Chart.defaults.color = '#64748b'
Chart.defaults.plugins.legend.labels.boxWidth = 10; Chart.defaults.plugins.tooltip.padding = 10; Chart.defaults.plugins.tooltip.backgroundColor = '#0b2545'

/* ============================ Utilidades (idénticas al original) ============================ */
const money = (v: number) => Number(v || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money0 = (v: number) => Number(v || 0).toLocaleString('es-EC', { maximumFractionDigits: 0 })
const normalize = (v: unknown) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const EC_OFFSET = 5 * 3600000
const ecKey = (iso: string | null | undefined) => { const t = Date.parse(iso ?? ''); return isFinite(t) ? new Date(t - EC_OFFSET).toISOString().slice(0, 10) : '' }
const ecHoy = () => ecKey(new Date().toISOString())
const keyAdd = (key: string, days: number) => { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
const keyLabel = (key: string, opt: Intl.DateTimeFormatOptions) => new Date(key + 'T12:00:00Z').toLocaleDateString('es-EC', { timeZone: 'UTC', ...opt })
const monthKeys = (toKey: string, n: number) => { const out: string[] = []; let y = +toKey.slice(0, 4), mo = +toKey.slice(5, 7); for (let i = 0; i < n; i++) { out.unshift(y + '-' + String(mo).padStart(2, '0')); mo--; if (mo < 1) { mo = 12; y-- } } return out }
const monthLabel = (k: string) => new Date(k + '-15T12:00:00Z').toLocaleDateString('es-EC', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const weekStart = (key: string) => keyAdd(key, -((new Date(key + 'T12:00:00Z').getUTCDay() + 6) % 7))

const CANAL_COLOR: Record<string, string> = { 'Publicidad pagada': '#7c3aed', 'Digital orgánico': '#17a9ba', Comercial: '#c98a1f', Otro: '#055c9d', 'Sin medio': '#94a3b8' }
function canal(m: string | null | undefined) {
  const s = normalize(m)
  if (!s.trim()) return 'Sin medio'
  if (/anuncio|ads\b|cpc|pagad|pauta/.test(s)) return 'Publicidad pagada'
  if (/web|redes|publicacion|historia|estado|catalogo|whatsapp|pagina|maps|chat|facebook|instagram|tiktok|google|messenger|correo|email/.test(s)) return 'Digital orgánico'
  if (/referid|visita|prospecc|feria|evento|reactiv|seguimiento|telefon|llamada|local|distribuidor/.test(s)) return 'Comercial'
  return 'Otro'
}
const esMk = (c: string) => c === 'Publicidad pagada' || c === 'Digital orgánico'
const cleanMedio = (m: string | null | undefined) => String(m || '').trim() || 'Sin medio'
const sumBy = <T,>(list: T[], keyFn: (x: T) => string, valFn?: (x: T) => number) => { const o: Record<string, number> = {}; list.forEach((x) => { const k = keyFn(x); o[k] = (o[k] || 0) + (valFn ? valFn(x) : 1) }); return o }
const topEntries = (obj: Record<string, number>, n: number): [string, number][] => { const e = Object.entries(obj).sort((a, b) => b[1] - a[1]); if (e.length <= n) return e; const rest = e.slice(n - 1).reduce((s, x) => s + x[1], 0); return [...e.slice(0, n - 1), ['Otros', rest]] }

const TITLES: Record<string, [string, string]> = {
  resumen: ['Resultados de marketing', 'Del primer contacto a la venta facturada.'], planificador: ['Planificador de contenido', 'Programa, arrastra y reorganiza tus publicaciones.'],
  audiovisual: ['Audiovisual', 'Espacio de la productora: fotos y videos del día, ideas y estado de cada pieza.'], anuncios: ['Rendimiento publicitario', 'Inversión en anuncios frente a leads y ventas del CRM.'],
  biblioteca: ['Biblioteca de productos', 'Imágenes, fichas técnicas y álbumes de cada equipo.'], material: ['Material de proveedores', 'Fichas técnicas, manuales, certificaciones y videos que suben los proveedores.'],
  revision: ['Revisión del equipo', 'Aprobaciones, cambios aplicados y trabajo de cada persona.'], promociones: ['Promociones', 'Campañas de descuento: Black Friday, liquidaciones y ofertas.'],
  configuracion: ['Configuración', 'Conecta Zernio (redes sociales) y Gemini (inteligencia artificial).'],
}
const NAV: [string, string, typeof LayoutDashboard][] = [
  ['resumen', 'Resumen', LayoutDashboard], ['planificador', 'Planificador', CalendarDays], ['audiovisual', 'Audiovisual', Clapperboard], ['anuncios', 'Anuncios', Megaphone],
  ['biblioteca', 'Biblioteca', Images], ['material', 'Material de proveedores', FolderUp], ['importacion', 'Importaciones', PackageSearch], ['revision', 'Revisión', ClipboardCheck], ['promociones', 'Promociones', BadgePercent], ['configuracion', 'Configuración', Settings],
]
const AV_COLOR: Record<string, string> = { Idea: '#94a3b8', 'En producción': '#c98a1f', 'En edición': '#7c3aed', Listo: '#17a9ba', Programado: '#055c9d', Publicado: '#04896f' }
const AV_ESTADOS = ['Idea', 'En producción', 'En edición', 'Listo', 'Programado', 'Publicado']
const AV_TIPOS = ['Foto', 'Video', 'Reel', 'Historia', 'Carrusel', 'Diseño']
const AV_ICON: Record<string, typeof ImageIcon> = { Foto: ImageIcon, Video: Video, Reel: Clapperboard, Historia: Smartphone, Carrusel: Gallery, Diseño: Palette }

type Venta = { f: string; id: string; cliente: string; asesor: string; medio: string; numero: string; estado: string; base: number; total: number; items: [string, number, number][]; canal: string }
type Prof = { f: string; monto: number }
type Lead = { f: string; medio: string; anuncio: string }
type Av = { id: string; codigo: string; fecha: string; titulo: string; tipo: string; estado: string; campana: string; notas: string; responsable: string; responsableId: string | null; producto: string; productoId: string | null; tamano: number | null; url: string; mime: string; driveId: string | null; enlace: string | null; miniId: string | null; miniUrl: string | null }
type Datos = { ventas: Venta[]; proformas: Prof[]; leads: Lead[] }

/* Supabase devuelve como máximo 1.000 filas por consulta: se pide por tandas hasta traer todo. */
type Pag = PromiseLike<{ data: unknown[] | null; error: { message: string } | null; count?: number | null }>
async function paginar(q: (a: number, z: number) => Pag, max = 30000): Promise<{ data: unknown[]; error: { message: string } | null }> {
  // La primera tanda trae el total; las demás se piden a la vez (mucho más rápido que una tras otra).
  const p0 = await q(0, 999)
  if (p0.error) return { data: [], error: p0.error }
  const out: unknown[] = [...(p0.data ?? [])], total = Math.min(p0.count ?? out.length, max)
  if (total <= 1000 || out.length < 1000) return { data: out, error: null }
  const resto = await Promise.all(Array.from({ length: Math.ceil(total / 1000) - 1 }, (_, i) => q((i + 1) * 1000, (i + 1) * 1000 + 999)))
  for (const r of resto) { if (r.error) return { data: out, error: r.error }; out.push(...(r.data ?? [])) }
  return { data: out, error: null }
}

/* ============================ Gráfico (Chart.js) ============================ */
function Grafico({ id, config }: { id: string; config: ChartConfiguration | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || !config) return
    const c = new Chart(ref.current, config)
    return () => c.destroy()
  }, [config])
  return <canvas id={id} ref={ref} />
}
const baseOpts = (extra: Record<string, unknown> = {}) => ({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, ...extra })
const usdTick = { callback: (v: string | number) => '$' + money0(Number(v)) }

/* ============================ Pantalla ============================ */
export default function Marketing({ perfil, aviso, accion, limpiarAccion }: { perfil: Perfil; aviso: (t: string) => void; accion?: string | null; limpiarAccion?: () => void }) {
  const [tab, setTabR] = useState(() => { try { const g = localStorage.getItem('vm_mkt_tab'); return g && g in TITLES ? g : 'resumen' } catch { return 'resumen' } })
  const setTab = (k: string) => { setTabR(k); try { localStorage.setItem('vm_mkt_tab', k) } catch { /* sin almacenamiento */ } }
  const hoy = ecHoy()
  const [desde, setDesde] = useState(hoy.slice(0, 7) + '-01')
  const [hasta, setHasta] = useState(hoy)
  const [datos, setDatos] = useState<Datos | null>(null)
  const [av, setAv] = useState<Av[] | null>(null)
  const [catalogos, setCatalogos] = useState<{ f: string; asesor: string; cliente: string; formato: string; precios: string; segmentos: string; n: number; paginas: number }[]>([])
  const [qCat, setQCat] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [actualizado, setActualizado] = useState('')
  const [fCanal, setFCanal] = useState('')
  const [fMedio, setFMedio] = useState('')
  const [fBuscar, setFBuscar] = useState('')
  const [limite, setLimite] = useState(40)
  const [nuevaIdea, setNuevaIdea] = useState(false)
  const [piezaAbierta, setPiezaAbierta] = useState<Av | null>(null)
  const puedeCrear = puede(perfil, 'marketing', 'crear')
  const puedeAdmin = puede(perfil, 'marketing', 'administrar')
  const [piezaProgramar, setPiezaProgramar] = useState<Av | null>(null)
  const [subir, setSubir] = useState(false)
  const [papelera, setPapelera] = useState(false)
  const [abrirPublicacion, setAbrirPublicacion] = useState(false)
  // "Ver indicadores de Marketing" (Empleados › permisos especiales): sin él no se ven Resumen ni Anuncios.
  const [indicadores, setIndicadores] = useState<boolean | null>(null)
  useEffect(() => { supabase.rpc('marketing_mi_rol').then(({ data }) => setIndicadores(!!(data as { indicadores?: boolean } | null)?.indicadores)) }, [])
  useEffect(() => { if (indicadores === false && (tab === 'resumen' || tab === 'anuncios')) setTab('planificador') }, [indicadores, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  // Contador de Revisión en la barra (mkfContador): por aprobar para Coordinación, por corregir para el resto.
  const [porRevisar, setPorRevisar] = useState(0)
  useEffect(() => {
    const leer = () => { if (document.hidden) return; supabase.rpc('mkt_revision_contador').then(({ data }) => { const c = (data ?? {}) as { coord?: boolean; porAprobar?: number; conCambios?: number }; setPorRevisar((c.coord ? c.porAprobar : c.conCambios) ?? 0) }) }
    leer(); const t = window.setInterval(leer, 120000)
    return () => window.clearInterval(t)
  }, [tab])

  // Acceso directo de la barra lateral: lleva a la pestaña correcta y abre el formulario de una vez.
  useEffect(() => {
    if (accion === 'publicacion') { setTab('planificador'); setAbrirPublicacion(true) }
    else if (accion === 'audiovisual') { setTab('audiovisual'); setSubir(true) }
    if (accion) limpiarAccion?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accion])

  const cargarDatos = useCallback(async () => {
    setCargando(true)
    const desde12 = keyAdd(monthKeys(hasta, 12)[0] + '-01', 0) + 'T00:00:00-05:00'
    const [f, c, l, a, cg] = await Promise.all([
      paginar((a, z) => supabase.from('facturas').select('codigo,estado,created_at,fecha_ganado,numero_contifico,medio_captacion_venta,subtotal,total,items,cliente:clientes(nombre),cotizacion:cotizaciones(nombre),asesor:empleados!asesor_id(nombre)', { count: 'exact' }).eq('empresa', 'VIMEDIC').is('deleted_at', null).or('fecha_ganado.gte.' + desde12.slice(0, 10) + ',and(fecha_ganado.is.null,created_at.gte.' + desde12 + ')').order('id').range(a, z)),
      paginar((a, z) => supabase.from('cotizaciones').select('fecha,total', { count: 'exact' }).eq('empresa', 'VIMEDIC').is('deleted_at', null).gte('fecha', desde12).order('id').range(a, z)),
      paginar((a, z) => supabase.from('leads').select('fecha,medio_captacion,anuncio', { count: 'exact' }).eq('empresa', 'VIMEDIC').is('deleted_at', null).gte('fecha', desde12).order('id').range(a, z)),
      supabase.from('audiovisual').select('id,codigo,fecha,titulo,tipo,estado,campana,notas,responsable_id,tamano_mb,archivo_url,mime,producto_id,archivo_drive_id,enlace_publico,miniatura_id,miniatura_url,responsable:empleados!responsable_id(nombre),producto:productos(codigo,nombre)').is('deleted_at', null).order('fecha', { ascending: false }).limit(1000),
      supabase.from('catalogos_generados').select('fecha,cliente_texto,formato,precios,segmentos,n_productos,paginas,asesor:empleados!asesor_id(nombre)').is('deleted_at', null).gte('fecha', desde12).order('fecha', { ascending: false }).limit(1000),
    ])
    const err = f.error || c.error || l.error || a.error
    if (err) { setError('No se pudieron cargar los datos: ' + err.message); setCargando(false); return }
    setError('')
    type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const ventas: Venta[] = ((f.data ?? []) as R[]).filter((x) => x.estado === 'Facturado' || x.estado === 'Pendiente').map((x) => {
      const total = Number(x.total) || 0, base = Number(x.subtotal) || total / 1.15
      return {
        f: x.fecha_ganado || ecKey(x.created_at), id: x.codigo, cliente: x.cliente?.nombre ?? x.cotizacion?.nombre ?? '', asesor: x.asesor?.nombre ?? '', medio: x.medio_captacion_venta ?? '', numero: x.numero_contifico ?? '',
        estado: x.estado, base, total, canal: canal(x.medio_captacion_venta),
        items: ((x.items ?? []) as R[]).map((i) => [String(i.nombre ?? ''), Number(i.cantidad) || 0, (Number(i.precio) || 0) * (Number(i.cantidad) || 0) * (1 - (Number(i.descuento) || 0) / 100)] as [string, number, number]),
      }
    })
    setDatos({
      ventas, proformas: ((c.data ?? []) as R[]).map((x) => ({ f: ecKey(x.fecha), monto: Number(x.total) || 0 })),
      leads: ((l.data ?? []) as R[]).map((x) => ({ f: ecKey(x.fecha), medio: x.medio_captacion ?? '', anuncio: x.anuncio ?? '' })),
    })
    setAv(((a.data ?? []) as R[]).map((x) => ({
      id: x.id, codigo: x.codigo ?? '', fecha: x.fecha, titulo: x.titulo, tipo: x.tipo ?? '', estado: x.estado, campana: x.campana ?? '', notas: x.notas ?? '', responsable: x.responsable?.nombre ?? '', responsableId: x.responsable_id,
      producto: x.producto ? `${x.producto.codigo ?? ''} · ${x.producto.nombre}` : '', productoId: x.producto_id ?? null, tamano: x.tamano_mb, url: x.archivo_url ?? '', mime: x.mime ?? '',
      driveId: x.archivo_drive_id ?? null, enlace: x.enlace_publico ?? null, miniId: x.miniatura_id ?? null, miniUrl: x.miniatura_url ?? null,
    })))
    setCatalogos(((cg.data ?? []) as R[]).map((x) => ({ f: x.fecha, asesor: x.asesor?.nombre ?? '—', cliente: x.cliente_texto ?? '', formato: x.formato ?? '', precios: x.precios ?? '', segmentos: x.segmentos ?? '', n: Number(x.n_productos) || 0, paginas: Number(x.paginas) || 0 })))
    setActualizado('Actualizado ' + new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }))
    setCargando(false)
  }, [hasta])
  useEffect(() => { cargarDatos() }, [cargarDatos])
  useEffect(() => {
    const recargar = agrupar(() => cargarDatos())
    const canalRt = supabase.channel('marketing-av').on('postgres_changes', { event: '*', schema: 'public', table: 'audiovisual' }, recargar).subscribe()
    return () => { recargar.cancelar(); supabase.removeChannel(canalRt) }
  }, [cargarDatos])

  const rango = (k: 'mes' | '3m' | 'anio') => { const t = ecHoy(); setHasta(t); setDesde(k === 'mes' ? t.slice(0, 7) + '-01' : k === '3m' ? monthKeys(t, 3)[0] + '-01' : t.slice(0, 4) + '-01-01') }
  const rangoActivo = (k: 'mes' | '3m' | 'anio') => { const t = ecHoy(); const m = { mes: t.slice(0, 7) + '-01', '3m': monthKeys(t, 3)[0] + '-01', anio: t.slice(0, 4) + '-01-01' }; return hasta === t && desde === m[k] }
  const enPeriodo = (f: string) => f >= desde && f <= hasta

  /* ---- Resumen ---- */
  const V = useMemo(() => (datos?.ventas ?? []).filter((v) => enPeriodo(v.f)), [datos, desde, hasta]) // eslint-disable-line react-hooks/exhaustive-deps
  const P = useMemo(() => (datos?.proformas ?? []).filter((p) => enPeriodo(p.f)), [datos, desde, hasta]) // eslint-disable-line react-hooks/exhaustive-deps
  const L = useMemo(() => (datos?.leads ?? []).filter((l) => enPeriodo(l.f)), [datos, desde, hasta]) // eslint-disable-line react-hooks/exhaustive-deps
  const AVp = useMemo(() => (av ?? []).filter((a) => enPeriodo(ecKey(a.fecha))), [av, desde, hasta]) // eslint-disable-line react-hooks/exhaustive-deps
  const totalV = V.reduce((s, v) => s + v.base, 0), mkV = V.filter((v) => esMk(v.canal)), totalMk = mkV.reduce((s, v) => s + v.base, 0)
  const valorP = P.reduce((s, p) => s + p.monto, 0), sinMedio = V.filter((v) => v.canal === 'Sin medio').length, leadsPub = L.filter((l) => canal(l.medio) === 'Publicidad pagada').length
  const diasP = Math.max(1, Math.round((Date.parse(hasta) - Date.parse(desde)) / 864e5) + 1), pHasta = keyAdd(desde, -1), pDesde = keyAdd(desde, -diasP)
  const hayPrev = pDesde >= monthKeys(hasta, 12)[0] + '-01'
  const enPrev = (f: string) => f >= pDesde && f <= pHasta
  const Vp = hayPrev ? (datos?.ventas ?? []).filter((v) => enPrev(v.f)) : [], Pp = hayPrev ? (datos?.proformas ?? []).filter((p) => enPrev(p.f)) : [], Lp = hayPrev ? (datos?.leads ?? []).filter((l) => enPrev(l.f)) : []
  const totalVp = Vp.reduce((s, v) => s + v.base, 0), totalMkp = Vp.filter((v) => esMk(v.canal)).reduce((s, v) => s + v.base, 0)
  const delta = (a: number, b: number) => (hayPrev && b > 0 ? Math.round(((a - b) / b) * 100) : null)
  const kpis: { l: string; v: string | number; s: string; i: typeof Activity; c: string; d?: number | null }[] = [
    { l: 'Ventas del período', v: '$' + money0(totalV), s: 'antes de IVA', i: DollarSign, c: 'var(--teal)', d: delta(totalV, totalVp) },
    { l: 'Nº de ventas', v: V.length, s: 'Facturación', i: Receipt, c: 'var(--primary)', d: delta(V.length, Vp.length) },
    { l: 'Ventas marketing', v: '$' + money0(totalMk), s: `${totalV ? Math.round((totalMk / totalV) * 100) : 0}% del total · ${mkV.length} ventas`, i: Megaphone, c: 'var(--violet)', d: delta(totalMk, totalMkp) },
    { l: 'Ticket promedio', v: '$' + money0(V.length ? totalV / V.length : 0), s: 'por venta', i: ShoppingBag, c: 'var(--navy)', d: delta(V.length ? totalV / V.length : 0, Vp.length ? totalVp / Vp.length : 0) },
    { l: 'Proformas', v: P.length, s: '$' + money0(valorP) + ' proformado', i: FileText, c: 'var(--cyan)', d: delta(P.length, Pp.length) },
    { l: 'Conversión', v: (P.length ? Math.round((V.length / P.length) * 100) : 0) + '%', s: 'ventas / proformas', i: TrendingUp, c: 'var(--teal)' },
    { l: 'Leads', v: L.length, s: leadsPub + ' de publicidad', i: Users, c: 'var(--amber)', d: delta(L.length, Lp.length) },
    { l: 'Piezas producidas', v: AVp.filter((a) => a.estado !== 'Idea').length, s: `${AVp.filter((a) => /Foto|Carrusel|Diseño/.test(a.tipo)).length} fotos · ${AVp.filter((a) => /Video|Reel|Historia/.test(a.tipo)).length} videos`, i: Clapperboard, c: '#e1306c' },
    { l: 'Piezas publicadas', v: AVp.filter((a) => a.estado === 'Publicado').length, s: `${AVp.length ? Math.round((AVp.filter((a) => a.estado === 'Publicado').length / AVp.length) * 100) : 0}% del material · ${AVp.filter((a) => a.estado === 'Listo').length} listas`, i: Send, c: 'var(--primary)' },
    { l: 'Ventas sin medio', v: sinMedio, s: 'completa el medio en el CRM', i: AlertCircle, c: 'var(--red)' },
  ]

  const graficos = useMemo(() => {
    if (!datos) return null
    const months = monthKeys(hasta, 12), mLabels = months.map(monthLabel), allV = datos.ventas
    const canales = ['Publicidad pagada', 'Digital orgánico', 'Comercial', 'Otro', 'Sin medio']
    const g: Record<string, ChartConfiguration> = {}
    g.chTimeline = { type: 'line', data: { labels: mLabels, datasets: canales.map((c) => ({ label: c, data: months.map((m) => Math.round(allV.filter((v) => v.canal === c && v.f.slice(0, 7) === m).reduce((s, v) => s + v.base, 0))), borderColor: CANAL_COLOR[c], backgroundColor: CANAL_COLOR[c] + '33', fill: true, tension: 0.35, pointRadius: 2, borderWidth: 2 })).filter((d) => d.data.some(Boolean)) },
      options: baseOpts({ plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c: any) => c.dataset.label + ': $' + money0(c.raw), footer: (it: any[]) => 'Total: $' + money0(it.reduce((s, x) => s + x.raw, 0)) } } }, scales: { y: { stacked: true, beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } }) as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    g.chProformas = { type: 'bar', data: { labels: mLabels, datasets: [
      { type: 'bar', label: 'Proformas', data: months.map((m) => datos.proformas.filter((p) => p.f.slice(0, 7) === m).length), backgroundColor: '#17a9ba', borderRadius: 6, order: 2 },
      { type: 'line', label: 'Ventas', data: months.map((m) => allV.filter((v) => v.f.slice(0, 7) === m).length), borderColor: '#04896f', backgroundColor: '#04896f', tension: 0.35, pointRadius: 3, order: 1 },
      { type: 'line', label: 'Ventas marketing', data: months.map((m) => allV.filter((v) => esMk(v.canal) && v.f.slice(0, 7) === m).length), borderColor: '#7c3aed', backgroundColor: '#7c3aed', borderDash: [5, 4], tension: 0.35, pointRadius: 2, order: 0 }] as never },
      options: baseOpts({ plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } }) as never }
    g.chValor = { type: 'line', data: { labels: mLabels, datasets: [
      { label: 'Proformado', data: months.map((m) => Math.round(datos.proformas.filter((p) => p.f.slice(0, 7) === m).reduce((s, p) => s + p.monto, 0))), borderColor: '#17a9ba', backgroundColor: '#17a9ba22', fill: true, tension: 0.35, pointRadius: 2 },
      { label: 'Vendido', data: months.map((m) => Math.round(allV.filter((v) => v.f.slice(0, 7) === m).reduce((s, v) => s + v.base, 0))), borderColor: '#04896f', backgroundColor: '#04896f22', fill: true, tension: 0.35, pointRadius: 2 }] },
      options: baseOpts({ plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c: any) => c.dataset.label + ': $' + money0(c.raw) } } }, scales: { y: { beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } }) as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const porMedio = topEntries(sumBy(V, (v) => cleanMedio(v.medio), (v) => v.base), 7)
    g.chMedio = { type: 'doughnut', data: { labels: porMedio.map((x) => x[0]), datasets: [{ data: porMedio.map((x) => Math.round(x[1])), backgroundColor: porMedio.map((x, i) => (x[0] === 'Otros' ? '#cbd5e1' : ['#055c9d', '#17a9ba', '#7c3aed', '#04896f', '#c98a1f', '#e1306c', '#0b2545'][i % 7])), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, boxWidth: 8 } }, tooltip: { callbacks: { label: (c: any) => c.label + ': $' + money0(c.raw) } } } } as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    g.chEmbudo = { type: 'bar', data: { labels: ['Leads', 'Proformas', 'Ventas', 'Ventas marketing'], datasets: [{ data: [L.length, P.length, V.length, mkV.length], backgroundColor: ['#c98a1f', '#17a9ba', '#04896f', '#7c3aed'], borderRadius: 8, barThickness: 26 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, y: { grid: { display: false }, ticks: { font: { size: 11, weight: 600 } } } } } as never }
    const days: string[] = []; let k = desde; while (k <= hasta && days.length < 400) { days.push(k); k = keyAdd(k, 1) }
    const byMonth = days.length > 92, buckets = byMonth ? [...new Set(days.map((d) => d.slice(0, 7)))] : days, bk = (f: string) => (byMonth ? f.slice(0, 7) : f)
    g.chDiario = { type: 'bar', data: { labels: buckets.map((b) => (byMonth ? monthLabel(b) : keyLabel(b, { day: 'numeric', month: 'short' }))), datasets: [
      { type: 'line', label: 'Ventas USD', data: buckets.map((b) => Math.round(V.filter((v) => bk(v.f) === b).reduce((s, v) => s + v.base, 0))), borderColor: '#04896f', backgroundColor: '#04896f22', fill: true, tension: 0.3, pointRadius: byMonth ? 3 : 1.5, yAxisID: 'y' },
      { type: 'bar', label: 'Proformas', data: buckets.map((b) => P.filter((p) => bk(p.f) === b).length), backgroundColor: '#17a9ba88', borderRadius: 4, yAxisID: 'y1' }] as never },
      options: baseOpts({ plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c: any) => (c.dataset.yAxisID === 'y' ? 'Ventas: $' + money0(c.raw) : 'Proformas: ' + c.raw) } } }, scales: { y: { beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, y1: { position: 'right', beginAtZero: true, ticks: { precision: 0 }, grid: { display: false } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16 } } } }) as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const leadsMedio = Object.entries(sumBy(L, (l) => cleanMedio(l.medio))).sort((a, b) => b[1] - a[1]).slice(0, 8)
    g.chLeads = { type: 'bar', data: { labels: leadsMedio.map((x) => (x[0].length > 28 ? x[0].slice(0, 27) + '…' : x[0])), datasets: [{ data: leadsMedio.map((x) => x[1]), backgroundColor: leadsMedio.map((x) => CANAL_COLOR[canal(x[0])]), borderRadius: 6 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, y: { grid: { display: false }, ticks: { font: { size: 9 } } } } } as never }
    const porAsesor = Object.entries(sumBy(V, (v) => v.asesor || 'Sin asesor', (v) => v.base)).sort((a, b) => b[1] - a[1]).slice(0, 8)
    g.chAsesor = { type: 'bar', data: { labels: porAsesor.map((x) => x[0].split(' ').slice(0, 2).join(' ')), datasets: [{ data: porAsesor.map((x) => Math.round(x[1])), backgroundColor: '#055c9d', borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => '$' + money0(c.raw) } } }, scales: { y: { beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } } } as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const prod: Record<string, [number, number]> = {}; V.forEach((v) => v.items.forEach((it) => { prod[it[0]] = prod[it[0]] || [0, 0]; prod[it[0]][0] += it[1]; prod[it[0]][1] += it[2] }))
    const topP = Object.entries(prod).sort((a, b) => b[1][0] - a[1][0]).slice(0, 8)
    g.chProductos = { type: 'bar', data: { labels: topP.map((x) => (x[0].length > 26 ? x[0].slice(0, 25) + '…' : x[0])), datasets: [{ data: topP.map((x) => x[1][0]), backgroundColor: '#c98a1f', borderRadius: 6 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it: any[]) => topP[it[0].dataIndex][0], label: (c: any) => c.raw + ' u · $' + money0(topP[c.dataIndex][1][1]) } } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, y: { grid: { display: false }, ticks: { font: { size: 9 } } } } } as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    const avCol: Record<string, string> = { Foto: '#17a9ba', Video: '#e1306c', Reel: '#7c3aed', Historia: '#c98a1f', Carrusel: '#055c9d', Diseño: '#94a3b8' }
    const AVall = av ?? []
    g.chAv = { type: 'bar', data: { labels: mLabels, datasets: [
      ...AV_TIPOS.map((t) => ({ type: 'bar', label: t, data: months.map((m) => AVall.filter((a) => a.tipo === t && a.estado !== 'Idea' && ecKey(a.fecha).slice(0, 7) === m).length), backgroundColor: avCol[t], borderRadius: 4, stack: 'av', yAxisID: 'y' })).filter((d) => d.data.some(Boolean)),
      { type: 'line', label: 'Ventas marketing USD', data: months.map((m) => Math.round(allV.filter((v) => esMk(v.canal) && v.f.slice(0, 7) === m).reduce((s, v) => s + v.base, 0))), borderColor: '#04896f', backgroundColor: '#04896f', tension: 0.35, pointRadius: 3, yAxisID: 'y1' }] as never },
      options: baseOpts({ plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c: any) => (c.dataset.yAxisID === 'y1' ? 'Ventas marketing: $' + money0(c.raw) : c.dataset.label + ': ' + c.raw + ' piezas') } } }, scales: { y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Piezas' }, grid: { color: '#f1f5f9' } }, y1: { position: 'right', beginAtZero: true, ticks: usdTick, grid: { display: false } }, x: { stacked: true, grid: { display: false } } } }) as never } // eslint-disable-line @typescript-eslint/no-explicit-any
    g.chAvEstado = { type: 'doughnut', data: { labels: AV_ESTADOS, datasets: [{ data: AV_ESTADOS.map((e) => AVp.filter((a) => a.estado === e).length), backgroundColor: AV_ESTADOS.map((e) => AV_COLOR[e]), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { font: { size: 9 }, boxWidth: 8 } } } } as never }
    return g
  }, [datos, av, desde, hasta]) // eslint-disable-line react-hooks/exhaustive-deps

  const ventasFiltradas = useMemo(() => {
    const q = normalize(fBuscar)
    return V.filter((v) => {
      if (fCanal === '__mk' && !esMk(v.canal)) return false
      if (fCanal && fCanal !== '__mk' && v.canal !== fCanal) return false
      if (fMedio && cleanMedio(v.medio) !== fMedio) return false
      if (q && !normalize([v.id, v.cliente, v.asesor, v.numero, v.medio].join(' ')).includes(q)) return false
      return true
    })
  }, [V, fCanal, fMedio, fBuscar])
  const mediosVentas = useMemo(() => [...new Set(V.map((v) => cleanMedio(v.medio)))].sort(), [V])
  function exportarCsv() {
    if (!ventasFiltradas.length) { aviso('No hay ventas para exportar.'); return }
    const q = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
    const rows = [['Fecha', 'ID', 'Factura', 'Cliente', 'Asesor', 'Medio captación', 'Canal', 'Estado', 'Base USD', 'Total c/IVA'], ...ventasFiltradas.map((v) => [v.f, v.id, v.numero, v.cliente, v.asesor, cleanMedio(v.medio), v.canal, v.estado, v.base.toFixed(2), v.total.toFixed(2)])]
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `ventas_marketing_${desde}_${hasta}.csv`; a.click()
  }
  const catPeriodo = useMemo(() => catalogos.filter((c) => enPeriodo(ecKey(c.f))), [catalogos, desde, hasta]) // eslint-disable-line react-hooks/exhaustive-deps
  const catFiltrados = useMemo(() => { const q = qCat.trim().toLowerCase(); return q ? catPeriodo.filter((c) => (c.asesor + ' ' + c.cliente + ' ' + c.segmentos + ' ' + c.formato).toLowerCase().includes(q)) : catPeriodo }, [catPeriodo, qCat])
  const anuncios = useMemo(() => {
    const m: Record<string, number> = {}; L.forEach((l) => { if (l.anuncio) m[l.anuncio] = (m[l.anuncio] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [L])

  const [titulo, subtitulo] = TITLES[tab]
  const card = (id: string, Icono: typeof Activity, color: string, t: string, sub: string, span = '') => (
    <article className={'card p-4 ' + span}>
      <h3 className="font-display font-bold text-sm text-slate-800 flex items-center gap-2"><Icono className="w-4 h-4" style={{ color }} />{t}</h3>
      <p className="text-[11px] text-slate-400 mb-3">{sub}</p>
      <div className="h-64">{graficos && <Grafico id={id} config={graficos[id]} />}</div>
    </article>
  )

  return (
    <div className="vm-mkt">
      <nav id="sideNav" aria-label="Secciones de Marketing">
        {NAV.filter(([k]) => (k !== 'configuracion' || puedeAdmin) && (indicadores !== false || (k !== 'resumen' && k !== 'anuncios'))).map(([k, t, I]) => <button key={k} type="button" className={'nav-btn' + (tab === k ? ' active' : '')} data-tip={t} aria-label={t} onClick={() => setTab(k)}><I />{k === 'revision' && porRevisar > 0 && <span className="mk-nav-badge">{porRevisar > 99 ? '99+' : porRevisar}</span>}</button>)}
        <div className="nav-sep" />
        {puedeCrear && <button type="button" className="nav-btn create" data-tip="Crear publicación" aria-label="Crear publicación" onClick={() => setTab('planificador')}><PenLine /></button>}
        <button type="button" className="nav-btn" data-tip="Actualizar" aria-label="Actualizar" onClick={cargarDatos}><RefreshCw /></button>
      </nav>

      <header className="sticky top-0 z-30" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
        <div className="vm-head-pad max-w-[1600px] mx-auto pl-4 sm:pl-[72px] pr-4 sm:pr-6 min-h-14 py-2 flex items-center gap-3 flex-wrap">
          <div className="min-w-0"><h1 className="font-display font-bold text-white text-base sm:text-lg leading-tight">{titulo}</h1><p className="text-[11px] text-white/60">{subtitulo}</p></div>
          {(tab === 'resumen' || tab === 'anuncios') && (
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <div className="seg !bg-white/10">
                {([['mes', 'Mes'], ['3m', '3 meses'], ['anio', 'Año']] as const).map(([k, t]) => <button key={k} type="button" className={rangoActivo(k) ? 'active' : '!text-white/80'} onClick={() => rango(k)}>{t}</button>)}
              </div>
              <label className="flex items-center gap-1.5 text-[10px] text-white/60 font-mono-spec uppercase">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg bg-white/10 text-white text-xs px-2 py-1.5 border-0" style={{ colorScheme: 'dark' }} /></label>
              <label className="flex items-center gap-1.5 text-[10px] text-white/60 font-mono-spec uppercase">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg bg-white/10 text-white text-xs px-2 py-1.5 border-0" style={{ colorScheme: 'dark' }} /></label>
            </div>
          )}
          <span className="text-[10px] text-white/50 font-mono-spec hidden lg:inline">{actualizado}</span>
        </div>
      </header>
      {cargando && <div className="fixed top-0 left-0 right-0 h-[3px] z-[60] overflow-hidden" style={{ background: 'rgba(5,92,157,.12)' }}><div style={{ height: '100%', width: '40%', background: 'linear-gradient(90deg,var(--cyan),var(--primary))', animation: 'refreshBarSlide 1s ease-in-out infinite' }} /></div>}

      <main className="max-w-[1600px] mx-auto px-4 sm:pr-6 sm:pl-[76px] pt-5 pb-24 sm:pb-8">
        {error && <p role="status" className="mb-4 text-xs rounded-xl px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800">{error}</p>}

        {tab === 'resumen' && (
          <section>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {kpis.map((c) => { const I = c.i; return (
                <div key={c.l} className="stat-card bg-white rounded-2xl border border-slate-200 p-3.5 shadow-sm">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: c.c + '1A', color: c.c }}><I className="w-4 h-4" /></div>
                  <p className="font-display font-bold text-xl text-slate-800 truncate flex items-baseline gap-1.5">{c.v}{c.d != null && <span className="text-[10px] font-bold" style={{ color: c.d >= 0 ? '#04896f' : '#c0392b' }} title="Frente al período anterior de igual duración">{c.d >= 0 ? '▲' : '▼'} {Math.abs(c.d)}%</span>}</p><p className="text-[10px] font-semibold text-slate-500 uppercase font-mono-spec">{c.l}</p><p className="text-[10px] text-slate-400 mt-0.5 truncate" title={c.s}>{c.s}</p>
                </div>) })}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
              {card('chTimeline', Activity, 'var(--cyan)', 'Línea de tiempo de ventas por canal', 'Últimos 12 meses · base antes de IVA · según medio de captación de la venta', 'lg:col-span-2')}
              {card('chMedio', PieChart, 'var(--violet)', 'Ventas por medio de captación', 'Período seleccionado · USD')}
              {card('chProformas', FileText, 'var(--teal)', 'Proformas realizadas vs ventas', 'Últimos 12 meses · cantidad por mes', 'lg:col-span-2')}
              {card('chEmbudo', Filter, 'var(--primary)', 'Embudo del período', 'Leads → proformas → ventas')}
              {card('chDiario', CalendarRange, 'var(--amber)', 'Actividad del período', 'Ventas en USD y proformas emitidas', 'lg:col-span-2')}
              {card('chLeads', Users, 'var(--cyan)', 'Leads por medio', 'Top 8 del período')}
              {card('chValor', TrendingUp, 'var(--teal)', 'Valor proformado vs vendido', 'Últimos 12 meses · USD antes de IVA')}
              {card('chAsesor', UserCheck, 'var(--navy)', 'Ventas por asesor', 'Período · USD antes de IVA')}
              {card('chProductos', Award, 'var(--amber)', 'Equipos más vendidos', 'Período · unidades')}
              {card('chAv', Clapperboard, '#e1306c', 'Producción audiovisual vs ventas de marketing', 'Últimos 12 meses · piezas producidas por tipo y ventas atribuidas a canales digitales', 'lg:col-span-2')}
              {card('chAvEstado', ListChecks, 'var(--teal)', 'Material del período por estado', 'Pestaña Audiovisual')}
            </div>

            <article className="card mt-4 overflow-hidden">
              <div className="p-4 flex items-center gap-2 flex-wrap border-b border-slate-100">
                <div className="mr-auto"><h3 className="font-display font-bold text-sm text-slate-800 flex items-center gap-2"><BookOpen className="w-4 h-4 text-[var(--primary)]" />Catálogos personalizados del período</h3>
                  <p className="text-[11px] text-slate-400">{catPeriodo.length ? `${catPeriodo.length} catálogo${catPeriodo.length === 1 ? '' : 's'} en el período` : 'Quién armó cada catálogo, para qué cliente y qué incluyó'}</p></div>
                <div className="relative"><Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input type="search" value={qCat} onChange={(e) => setQCat(e.target.value)} placeholder="Asesor, cliente, segmento…" className="inp pl-8 w-52" /></div>
              </div>
              <div className="overflow-auto max-h-[420px]">
                {catFiltrados.length ? (
                  <table className="w-full text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500 sticky top-0"><tr>{['Fecha', 'Asesor', 'Cliente', 'Tipo', 'Segmentos', 'Productos', 'Páginas'].map((h, i) => <th key={h} className={'px-3 py-2 font-bold whitespace-nowrap ' + (i > 4 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
                    <tbody>{catFiltrados.slice(0, 200).map((c, i) => (
                      <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 whitespace-nowrap text-slate-500">{new Date(c.f).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: '2-digit' })} · {new Date(c.f).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false })}</td>
                        <td className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">{c.asesor}</td>
                        <td className="px-3 py-2">{c.cliente ? <b className="text-slate-800">{c.cliente}</b> : <span className="text-slate-400">Sin cliente</span>}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><span className={'inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ' + (c.formato === 'Impreso' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700')}>{c.formato || 'Digital'}</span>{c.precios === 'Con precios' && <span className="text-[10px] text-slate-400"> con precios</span>}</td>
                        <td className="px-3 py-2 text-slate-500 max-w-[320px] truncate" title={c.segmentos}>{c.segmentos || '—'}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-700">{c.n}</td><td className="px-3 py-2 text-right text-slate-500">{c.paginas || '—'}</td></tr>))}</tbody></table>
                ) : <p className="p-6 text-center text-xs text-slate-400">{catPeriodo.length ? 'Ningún catálogo coincide con la búsqueda.' : 'Todavía no se generaron catálogos personalizados en este período.'}</p>}
              </div>
            </article>

            <article className="card mt-4 overflow-hidden">
              <div className="p-4 flex items-center gap-2 flex-wrap border-b border-slate-100">
                <div className="mr-auto"><h3 className="font-display font-bold text-sm text-slate-800 flex items-center gap-2"><Receipt className="w-4 h-4 text-[var(--teal)]" />Ventas del período</h3><p className="text-[11px] text-slate-400">Facturación · medio de captación de la venta</p></div>
                <select value={fCanal} onChange={(e) => setFCanal(e.target.value)} className="inp" aria-label="Canal">
                  <option value="">Todos los canales</option><option value="__mk">Marketing (digital + publicidad)</option><option>Publicidad pagada</option><option>Digital orgánico</option><option>Comercial</option><option>Sin medio</option><option>Otro</option>
                </select>
                <select value={fMedio} onChange={(e) => setFMedio(e.target.value)} className="inp max-w-[220px]" aria-label="Medio de captación"><option value="">Todos los medios</option>{mediosVentas.map((m) => <option key={m}>{m}</option>)}</select>
                <div className="relative"><Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input type="search" value={fBuscar} onChange={(e) => setFBuscar(e.target.value)} placeholder="Cliente, asesor, ID…" className="inp pl-8 w-48" /></div>
                <button type="button" className="btn" onClick={exportarCsv}><Download />CSV</button>
              </div>
              <div className="overflow-auto max-h-[560px]">
                {ventasFiltradas.length ? (
                  <table className="tbl"><thead><tr><th>Fecha</th><th>Venta</th><th>Cliente</th><th>Asesor</th><th>Medio de captación</th><th>Estado</th><th className="num">Base USD</th><th className="num">Total c/IVA</th></tr></thead>
                    <tbody>{ventasFiltradas.slice(0, limite).map((v) => { const col = CANAL_COLOR[v.canal]; return (
                      <tr key={v.id}><td className="whitespace-nowrap font-mono-spec text-[11px]">{keyLabel(v.f, { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                        <td><span className="font-mono-spec text-[11px] text-slate-500">{v.id}</span>{v.numero && <span className="block text-[10px] text-slate-400">Fact. {v.numero}</span>}</td>
                        <td className="max-w-[220px] truncate font-semibold text-slate-700" title={v.cliente}>{v.cliente || '—'}</td><td className="text-slate-600">{v.asesor || '—'}</td>
                        <td><span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} /><span className="text-slate-700">{cleanMedio(v.medio)}</span></span><span className="block text-[10px] pl-3.5" style={{ color: col }}>{v.canal}</span></td>
                        <td><span className="pill" style={v.estado === 'Facturado' ? { background: '#ecfaf5', color: '#04896f' } : { background: '#fff8eb', color: '#a16207' }}>{v.estado}</span></td>
                        <td className="num font-semibold">${money(v.base)}</td><td className="num text-slate-500">${money(v.total)}</td></tr>) })}</tbody></table>
                ) : <p className="p-6 text-center text-sm text-slate-400">No hay ventas con estos filtros en el período.</p>}
              </div>
              <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-3 text-[11px] text-slate-500">
                <span><b className="text-slate-700">{ventasFiltradas.length}</b> ventas · base <b className="text-slate-700">${money(ventasFiltradas.reduce((s, v) => s + v.base, 0))}</b> · total c/IVA ${money(ventasFiltradas.reduce((s, v) => s + v.total, 0))}</span>
                {ventasFiltradas.length > limite && <button type="button" className="btn ml-auto" onClick={() => setLimite((n) => n + 40)}>Ver más</button>}
              </div>
            </article>

            <article className="card mt-4 overflow-hidden">
              <div className="p-4 border-b border-slate-100"><h3 className="font-display font-bold text-sm text-slate-800 flex items-center gap-2"><Target className="w-4 h-4 text-[var(--violet)]" />Del anuncio al CRM</h3><p className="text-[11px] text-slate-400">Leads del período agrupados por anuncio o campaña de origen.</p></div>
              <div className="overflow-auto">
                {anuncios.length ? <table className="tbl"><thead><tr><th>Anuncio / campaña</th><th className="num">Leads</th></tr></thead><tbody>{anuncios.map(([a, n]) => <tr key={a}><td><b className="text-slate-700">{a}</b></td><td className="num">{n}</td></tr>)}</tbody></table>
                  : <p className="p-6 text-center text-sm text-slate-400">No hay registros publicitarios atribuibles en este período.</p>}
              </div>
            </article>
          </section>
        )}

        {tab === 'audiovisual' && <Audiovisual piezas={av} cargando={cargando} puedeCrear={puedeCrear} puedeEliminar={puede(perfil, 'marketing', 'eliminar')} recargar={cargarDatos} abrirIdea={() => setNuevaIdea(true)} abrir={setPiezaAbierta} aviso={aviso} subir={() => setSubir(true)} papelera={() => setPapelera(true)} />}

        {tab === 'planificador' && <Planificador perfil={perfil} piezas={(av ?? []).map((a) => ({ id: a.id, titulo: a.titulo, tipo: a.tipo, estado: a.estado, url: a.url, producto: a.producto, mime: a.mime, notas: a.notas, productoId: a.productoId ?? undefined, enlace: enlaceZernio(a), mini: miniaturaAv(a, 480) }))} piezaInicial={piezaProgramar ? { id: piezaProgramar.id, titulo: piezaProgramar.titulo, tipo: piezaProgramar.tipo, estado: piezaProgramar.estado, url: piezaProgramar.url, producto: piezaProgramar.producto, mime: piezaProgramar.mime, notas: piezaProgramar.notas, productoId: piezaProgramar.productoId ?? undefined, enlace: enlaceZernio(piezaProgramar), mini: miniaturaAv(piezaProgramar, 480) } : null} limpiarPieza={() => setPiezaProgramar(null)} irConfig={() => setTab('configuracion')} aviso={aviso} alSincronizar={cargarDatos} abrirAlEntrar={abrirPublicacion} consumirAbrir={() => setAbrirPublicacion(false)} />}
        {tab === 'biblioteca' && <Biblioteca perfil={perfil} aviso={aviso} />}
        {tab === 'revision' && <Revision perfil={perfil} aviso={aviso} irA={setTab} />}
        {tab === 'configuracion' && puedeAdmin && <Configuracion aviso={aviso} alCambiar={() => undefined} />}

        {tab === 'anuncios' && <Anuncios perfil={perfil} desde={desde} hasta={hasta} aviso={aviso} />}
        {tab === 'material' && <Material perfil={perfil} aviso={aviso} />}
        {tab === 'promociones' && <Promociones perfil={perfil} aviso={aviso} />}
        {tab === 'importacion' && <Suspense fallback={<div className="card p-10 text-center text-slate-400">Cargando…</div>}><Recepcion perfil={perfil} aviso={aviso} area="marketing" /></Suspense>}

        {false && (
          <section>
            <div className="card p-10 text-center">
              <p className="text-3xl">🛠️</p><p className="text-sm font-bold text-slate-700 mt-2">{titulo}</p>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">Esta sección se está migrando. {tab === 'anuncios' ? 'Los datos de anuncios (inversión, alcance) llegarán de la API de Meta Ads; hoy el cruce de leads por anuncio está en Resumen.' : 'Sigue disponible en la app actual.'}</p>
            </div>
          </section>
        )}
      </main>

      {subir && <SubirMaterial perfil={perfil} cerrar={() => setSubir(false)} hecho={() => { cargarDatos(); aviso('Material subido.') }} />}
      {papelera && <PapeleraAv cerrar={() => setPapelera(false)} restaurado={cargarDatos} />}
      {nuevaIdea && <ModalIdea perfil={perfil} cerrar={() => setNuevaIdea(false)} guardado={() => { setNuevaIdea(false); aviso('Idea registrada.'); cargarDatos() }} />}
      {piezaAbierta && <ModalPieza puedeEliminar={puede(perfil, 'marketing', 'eliminar') || puede(perfil, 'marketing', 'editar')} programar={puedeCrear ? () => { setPiezaProgramar(piezaAbierta); setPiezaAbierta(null); setTab('planificador') } : undefined} pieza={piezaAbierta} puedeEditar={puede(perfil, 'marketing', 'editar')} cerrar={() => setPiezaAbierta(null)} guardado={() => { setPiezaAbierta(null); cargarDatos() }} aviso={aviso} />}
    </div>
  )
}

/* ============================ Audiovisual ============================ */
function Audiovisual({ piezas, cargando, puedeCrear, puedeEliminar, recargar, abrirIdea, abrir, aviso, subir, papelera }: {
  subir: () => void; papelera: () => void
  piezas: Av[] | null; cargando: boolean; puedeCrear: boolean; puedeEliminar: boolean; recargar: () => void; abrirIdea: () => void; abrir: (a: Av) => void; aviso: (t: string) => void
}) {
  const [q, setQ] = useState('')
  const [periodo, setPeriodo] = useState('mes')
  const [tipo, setTipo] = useState('')
  const [estado, setEstado] = useState('')
  const [resp, setResp] = useState('')
  const [vista, setVista] = useState<'gallery' | 'board'>('gallery')
  const hoy = ecHoy()
  const lista = piezas ?? []
  const responsables = [...new Set(lista.map((i) => i.responsable).filter(Boolean))].sort()
  const dia = (i: Av) => ecKey(i.fecha)
  const filtradas = useMemo(() => {
    const desde = periodo === 'hoy' ? hoy : periodo === 'semana' ? weekStart(hoy) : periodo === 'mes' ? hoy.slice(0, 7) + '-01' : ''
    const n = normalize(q)
    return lista.filter((i) => (!tipo || i.tipo === tipo) && (!estado || i.estado === estado) && (!resp || i.responsable === resp) && (!desde || dia(i) >= desde) && (!n || normalize([i.titulo, i.producto, i.campana, i.notas, i.responsable].join(' ')).includes(n)))
  }, [lista, q, periodo, tipo, estado, resp, hoy])
  const ws = weekStart(hoy), mes = hoy.slice(0, 7), esVideo = (i: Av) => /^video\//.test(i.mime) || ['Video', 'Reel'].includes(i.tipo)
  const mesI = lista.filter((i) => dia(i).slice(0, 7) === mes && i.url)
  const stats = [
    { l: 'Subido hoy', v: lista.filter((i) => dia(i) === hoy && i.url).length, s: 'piezas con archivo', i: UploadCloud, c: 'var(--primary)' },
    { l: 'Esta semana', v: lista.filter((i) => dia(i) >= ws && i.url).length, s: 'desde el lunes', i: CalendarRange, c: 'var(--cyan)' },
    { l: 'Listo para publicar', v: lista.filter((i) => i.estado === 'Listo').length, s: 'esperando programación', i: CheckCircle2, c: 'var(--teal)' },
    { l: 'Publicado este mes', v: lista.filter((i) => dia(i).slice(0, 7) === mes && i.estado === 'Publicado').length, s: lista.filter((i) => i.estado === 'Programado').length + ' programadas', i: Send, c: 'var(--violet)' },
    { l: 'Producción del mes', v: mesI.length, s: `${mesI.filter((i) => !esVideo(i)).length} fotos · ${mesI.filter(esVideo).length} videos`, i: Clapperboard, c: '#e1306c' },
  ]
  const tarjeta = (it: Av, compacta: boolean) => {
    const col = AV_COLOR[it.estado] || '#94a3b8', Ico = AV_ICON[it.tipo] || Lightbulb
    return (
      <div key={it.id} className="av-card" draggable={compacta} onClick={() => abrir(it)}
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', it.id) }}>
        <div className={'relative bg-slate-100 overflow-hidden ' + (compacta ? 'aspect-video' : 'aspect-square')}>
          <span className="absolute inset-0 grid place-items-center text-slate-300"><Ico className="w-8 h-8" /></span>
          {miniaturaAv(it, compacta ? 360 : 480) && <img loading="lazy" src={miniaturaAv(it, compacta ? 360 : 480)} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
          {esVideo(it) && it.url && <span className="absolute inset-0 grid place-items-center pointer-events-none"><span className="w-9 h-9 rounded-full grid place-items-center text-sm text-white" style={{ background: '#0000008c' }}>▶</span></span>}
          <span className="absolute left-2 top-2 pill" style={{ background: '#fffffff0', color: col }}>{it.estado || '—'}</span>
          <span className="absolute right-2 top-2 w-6 h-6 rounded-lg bg-white/90 grid place-items-center text-slate-600" title={it.tipo}><Ico className="w-3.5 h-3.5" /></span>
        </div>
        <div className="p-2.5"><p className="text-xs font-bold text-slate-800 truncate" title={it.titulo}>{it.titulo}</p><p className="text-[10px] text-slate-500 truncate">{it.producto || it.campana || 'Sin producto'}</p>
          <p className="text-[10px] text-slate-400 truncate mt-0.5">{it.responsable}{it.tamano ? ' · ' + it.tamano + ' MB' : ''}</p></div>
      </div>
    )
  }
  const hechas = useRef(new Set<string>())
  useEffect(() => {
    if (!puedeCrear || !piezas) return
    const faltan = piezas.filter((i) => esVideo(i) && /\/storage\/v1\/object\/public\//.test(i.url) && !i.miniUrl && !i.miniId && !hechas.current.has(i.id)).slice(0, 4)
    if (!faltan.length) return
    let vivo = true
    ;(async () => {
      let n = 0
      for (const i of faltan) {
        hechas.current.add(i.id)
        const b = await fotogramaVideo(i.url)
        if (b && vivo) { await guardarMiniatura(i.id, b).then(() => n++).catch(() => undefined) }
      }
      if (n && vivo) recargar()
    })()
    return () => { vivo = false }
  }, [piezas, puedeCrear]) // eslint-disable-line react-hooks/exhaustive-deps
  async function mover(id: string, nuevo: string) {
    const it = lista.find((x) => x.id === id)
    if (!it || it.estado === nuevo) return
    const { error } = await supabase.from('audiovisual').update({ estado: nuevo }).eq('id', id)
    if (error) aviso('No se pudo mover: ' + error.message); else recargar()
  }
  const grupos: Record<string, Av[]> = {}; filtradas.forEach((i) => { const k = dia(i) || 'Sin fecha'; (grupos[k] = grupos[k] || []).push(i) })
  const ayer = keyAdd(hoy, -1)

  return (
    <section>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {stats.map((c) => { const I = c.i; return (
          <div key={c.l} className="stat-card bg-white rounded-2xl border border-slate-200 p-3.5 shadow-sm"><div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: c.c + '1A', color: c.c }}><I className="w-4 h-4" /></div>
            <p className="font-display font-bold text-xl text-slate-800">{c.v}</p><p className="text-[10px] font-semibold text-slate-500 uppercase font-mono-spec">{c.l}</p><p className="text-[10px] text-slate-400 mt-0.5 truncate">{c.s}</p></div>) })}
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm"><Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Título, producto, campaña…" className="inp pl-9 w-full" /></div>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="inp" aria-label="Período"><option value="">Todo</option><option value="hoy">Hoy</option><option value="semana">Esta semana</option><option value="mes">Este mes</option></select>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="inp" aria-label="Tipo"><option value="">Todos los tipos</option>{AV_TIPOS.map((t) => <option key={t}>{t}</option>)}</select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="inp" aria-label="Estado"><option value="">Todos los estados</option>{AV_ESTADOS.map((t) => <option key={t}>{t}</option>)}</select>
        <select value={resp} onChange={(e) => setResp(e.target.value)} className="inp" aria-label="Responsable"><option value="">Todo el equipo</option>{responsables.map((t) => <option key={t}>{t}</option>)}</select>
        <div className="seg ml-auto"><button type="button" className={vista === 'gallery' ? 'active' : ''} onClick={() => setVista('gallery')}>Galería</button><button type="button" className={vista === 'board' ? 'active' : ''} onClick={() => setVista('board')}>Tablero</button></div>
        {puedeCrear && <button type="button" className="btn" onClick={abrirIdea}><Lightbulb />Nueva idea</button>}
        {puedeCrear && <button type="button" className="btn btn-primary" onClick={subir}><UploadCloud />Subir material</button>}
        {puedeEliminar && <button type="button" className="btn" onClick={papelera} title="Piezas eliminadas"><Trash2 />Papelera</button>}
      </div>
      <p className="text-[11px] text-slate-500 mb-2" role="status">{cargando && !piezas ? 'Cargando material…' : ''}</p>
      <div className="rounded-2xl">
        {piezas && !filtradas.length && <div className="card p-10 text-center"><p className="text-3xl">🎬</p><p className="text-sm font-bold text-slate-700 mt-2">Sin material en este filtro</p><p className="text-xs text-slate-400 mt-1">Sube fotos y videos del día o registra una idea para producir.</p></div>}
        {filtradas.length > 0 && vista === 'board' && (
          <div className="flex gap-3 overflow-x-auto pb-3">
            {AV_ESTADOS.map((e) => { const items = filtradas.filter((i) => i.estado === e); return (
              <section key={e} className="av-col" style={{ ['--c' as string]: AV_COLOR[e] || '#94a3b8' }} onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => { ev.preventDefault(); mover(ev.dataTransfer.getData('text/plain'), e) }}>
                <header className="flex items-center gap-2 px-3 py-3 border-t-[3px]" style={{ borderColor: 'var(--c)' }}><i className="w-2 h-2 rounded-full" style={{ background: 'var(--c)' }} /><h3 className="text-xs font-bold text-slate-700 flex-1">{e}</h3><span className="text-[10px] bg-white rounded-full px-2 py-0.5 text-slate-500">{items.length}</span></header>
                <div className="px-2 pb-2 space-y-2 max-h-[calc(100vh-330px)] overflow-y-auto min-h-[120px]">{items.map((i) => tarjeta(i, true))}</div>
              </section>) })}
          </div>
        )}
        {filtradas.length > 0 && vista === 'gallery' && Object.entries(grupos).map(([k, items]) => (
          <div key={k} className="mb-5"><h3 className="flex items-center gap-2 text-[11px] font-mono-spec uppercase text-slate-500 mb-2"><span className="font-bold text-slate-700">{k === hoy ? 'Hoy' : k === ayer ? 'Ayer' : k === 'Sin fecha' ? k : keyLabel(k, { weekday: 'long', day: 'numeric', month: 'long' })}</span><span className="text-slate-400">· {items.length} pieza{items.length === 1 ? '' : 's'}</span></h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">{items.map((i) => tarjeta(i, false))}</div></div>
        ))}
      </div>
    </section>
  )
}

/* ============================ Modales ============================ */
function Ventana({ titulo, cerrar, children, pie }: { titulo: string; cerrar: () => void; children: React.ReactNode; pie: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-lg flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0"><h3 className="font-display font-bold text-sm text-slate-800">{titulo}</h3><button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">{children}</div>
        <div className="shrink-0 border-t border-slate-100 p-4 flex gap-2">{pie}</div>
      </div>
    </div>
  )
}
function ModalIdea({ perfil, cerrar, guardado }: { perfil: Perfil; cerrar: () => void; guardado: () => void }) {
  const [t, setT] = useState(''); const [tipo, setTipo] = useState('Video'); const [campana, setCampana] = useState(''); const [notas, setNotas] = useState('')
  const [prod, setProd] = useState<ProdBusq | null>(null); const [resp, setResp] = useState(perfil.id); const [fechaI, setFechaI] = useState(ecHoy())
  const [error, setError] = useState(''); const [guardando, setGuardando] = useState(false)
  const equipo = useEquipo()
  async function guardar() {
    if (!t.trim()) { setError('Escribe un título para la idea.'); return }
    setGuardando(true)
    const { error } = await supabase.from('audiovisual').insert({ id: crypto.randomUUID(), codigo: 'AV-' + crypto.randomUUID().slice(0, 6).toUpperCase(), titulo: t.trim().slice(0, 160), tipo, estado: 'Idea', campana: campana.trim() || null, notas: notas.trim() || null, responsable_id: resp || perfil.id, producto_id: prod?.id ?? null, fecha: fechaI ? fechaI + 'T12:00:00-05:00' : new Date().toISOString() })
    setGuardando(false)
    if (error) { setError(error.message); return }
    guardado()
  }
  return (
    <Ventana titulo="Nueva idea de contenido" cerrar={cerrar} pie={<><p className="text-[11px] flex-1 self-center" style={{ color: '#c0392b' }}>{error}</p><button onClick={guardar} disabled={guardando} className="btn btn-primary">{guardando ? 'Guardando…' : 'Guardar idea'}</button></>}>
      <label className="block text-[11px] font-bold text-slate-500">Título<input value={t} onChange={(e) => setT(e.target.value)} className="inp w-full mt-1" placeholder="Ej. Reel del autoclave clase B" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[11px] font-bold text-slate-500">Tipo<select value={tipo} onChange={(e) => setTipo(e.target.value)} className="inp w-full mt-1">{AV_TIPOS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="block text-[11px] font-bold text-slate-500">Fecha<input type="date" value={fechaI} onChange={(e) => setFechaI(e.target.value)} className="inp w-full mt-1" /></label>
      </div>
      <div className="block text-[11px] font-bold text-slate-500">Producto (opcional)<div className="mt-1"><BuscadorProducto valor={prod} cambiar={setProd} /></div></div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[11px] font-bold text-slate-500">Responsable<select value={resp} onChange={(e) => setResp(e.target.value)} className="inp w-full mt-1">{!equipo.some((x) => x.id === perfil.id) && <option value={perfil.id}>{perfil.nombre}</option>}{equipo.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
        <label className="block text-[11px] font-bold text-slate-500">Campaña<input value={campana} onChange={(e) => setCampana(e.target.value)} className="inp w-full mt-1" placeholder="Opcional" /></label>
      </div>
      <label className="block text-[11px] font-bold text-slate-500">Notas<textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} className="inp w-full mt-1" /></label>
    </Ventana>
  )
}

/* Detalle de una pieza (openAvDetail / avGuardarDetalle / avCambiarPortada / avEliminarPieza del original):
   vista previa, datos, portada del video, adjuntar o reemplazar el archivo producido, copiar el enlace
   para Zernio, programar y eliminar (a la papelera). */
function ModalPieza({ pieza, puedeEditar, puedeEliminar, cerrar, guardado, aviso, programar }: { programar?: () => void; pieza: Av; puedeEditar: boolean; puedeEliminar: boolean; cerrar: () => void; guardado: () => void; aviso: (t: string) => void }) {
  const [t, setT] = useState(pieza.titulo); const [tipo, setTipo] = useState(pieza.tipo || 'Foto'); const [estado, setEstado] = useState(pieza.estado); const [campana, setCampana] = useState(pieza.campana); const [notas, setNotas] = useState(pieza.notas)
  const [prod, setProd] = useState<ProdBusq | null>(pieza.productoId ? { id: pieza.productoId, codigo: pieza.producto.split(' · ')[0] ?? '', nombre: pieza.producto.split(' · ').slice(1).join(' · ') } : null)
  const [resp, setResp] = useState(pieza.responsableId ?? ''); const [fechaP, setFechaP] = useState(ecKey(pieza.fecha))
  const [archivo, setArchivo] = useState<File | null>(null)
  const [progreso, setProgreso] = useState('')
  const [mini, setMini] = useState(miniaturaAv(pieza, 900))
  const [guardando, setGuardando] = useState(false)
  const equipo = useEquipo()
  const video = esVideoAv(pieza), drive = pieza.driveId || idDrive(pieza.url), enlace = enlaceZernio(pieza)
  async function guardar() {
    setGuardando(true)
    const cambios: Record<string, unknown> = { titulo: t.trim().slice(0, 160) || pieza.titulo, tipo, estado, campana: campana.trim() || null, notas: notas.trim() || null, producto_id: prod?.id ?? null, fecha: fechaP ? fechaP + 'T12:00:00-05:00' : pieza.fecha }
    if (resp) cambios.responsable_id = resp
    try {
      if (archivo) {
        const a = await subirArchivoAv(archivo, (_p, m) => setProgreso(m))
        Object.assign(cambios, { archivo_url: a.url, archivo_drive_id: a.driveId, enlace_publico: a.enlace, mime: a.mime, tamano_mb: a.tamanoMb, miniatura_url: null, miniatura_id: null })
        if (estado === 'Idea') cambios.estado = 'Listo'
      }
      const { error } = await supabase.from('audiovisual').update(cambios).eq('id', pieza.id)
      if (error) throw new Error(error.message)
      if (archivo && archivo.type.startsWith('video/')) { const img = await fotogramaVideo(archivo); if (img) await guardarMiniatura(pieza.id, img).catch(() => undefined) }
      aviso('Pieza actualizada.'); guardado()
    } catch (e) { aviso('No se pudo guardar: ' + (e as Error).message) }
    setGuardando(false); setProgreso('')
  }
  async function cambiarPortada(f: File | undefined) {
    if (!f) return
    try { setProgreso('Subiendo portada…'); const url = await guardarMiniatura(pieza.id, await prepararPortada(f)); setMini(url); aviso('Portada actualizada.') }
    catch (e) { aviso((e as Error).message) }
    setProgreso('')
  }
  async function eliminar() {
    if (!confirm('¿Eliminar "' + pieza.titulo + '"?\nSe quita de la app; el archivo se conserva. Se puede restaurar desde la Papelera.')) return
    const { error } = await supabase.from('audiovisual').update({ deleted_at: new Date().toISOString() }).eq('id', pieza.id)
    if (error) { aviso('No se pudo eliminar: ' + error.message); return }
    aviso('Pieza enviada a la papelera.'); guardado()
  }
  const copiar = () => { if (!enlace) return; navigator.clipboard?.writeText(enlace).then(() => aviso('Enlace copiado.'), () => aviso(enlace)) }
  const col = AV_COLOR[pieza.estado] || '#94a3b8'
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[92vh] flex flex-col overflow-hidden" style={{ maxWidth: 940 }}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 shrink-0">
          <span className="pill" style={{ background: col + '1A', color: col }}>{pieza.estado}</span>
          <h3 className="font-display font-bold text-sm text-slate-800 truncate flex-1">{pieza.codigo ? pieza.codigo + ' · ' : ''}{pieza.titulo}</h3>
          <button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="dt-grid">
            <div className="min-w-0 space-y-3">
              <label className="block text-[11px] font-bold text-slate-500">Título<input value={t} onChange={(e) => setT(e.target.value)} className="inp w-full mt-1" disabled={!puedeEditar} /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-[11px] font-bold text-slate-500">Tipo<select value={tipo} onChange={(e) => setTipo(e.target.value)} className="inp w-full mt-1" disabled={!puedeEditar}>{AV_TIPOS.map((x) => <option key={x}>{x}</option>)}</select></label>
                <label className="block text-[11px] font-bold text-slate-500">Estado<select value={estado} onChange={(e) => setEstado(e.target.value)} className="inp w-full mt-1" disabled={!puedeEditar}>{AV_ESTADOS.map((x) => <option key={x}>{x}</option>)}</select></label>
              </div>
              <div className="block text-[11px] font-bold text-slate-500">Producto{puedeEditar ? <div className="mt-1"><BuscadorProducto valor={prod} cambiar={setProd} /></div> : <p className="font-normal text-slate-700 mt-1">{pieza.producto || '—'}</p>}</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-[11px] font-bold text-slate-500">Fecha<input type="date" value={fechaP} onChange={(e) => setFechaP(e.target.value)} className="inp w-full mt-1" disabled={!puedeEditar} /></label>
                <label className="block text-[11px] font-bold text-slate-500">Responsable<select value={resp} onChange={(e) => setResp(e.target.value)} className="inp w-full mt-1" disabled={!puedeEditar}><option value="">{pieza.responsable || '—'}</option>{equipo.filter((x) => x.id !== pieza.responsableId).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
              </div>
              <label className="block text-[11px] font-bold text-slate-500">Campaña<input value={campana} onChange={(e) => setCampana(e.target.value)} className="inp w-full mt-1" disabled={!puedeEditar} /></label>
              <label className="block text-[11px] font-bold text-slate-500">Notas (se usan como texto al programar)<textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} className="inp w-full mt-1" disabled={!puedeEditar} /></label>
              {puedeEditar && <label className="btn" style={{ display: 'inline-flex', cursor: 'pointer' }}><UploadCloud />{archivo ? archivo.name.slice(0, 36) : pieza.url ? 'Reemplazar archivo' : 'Adjuntar archivo producido'}
                <input type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></label>}
              <p className="text-[10.5px] text-slate-400">{[pieza.mime, pieza.tamano ? pieza.tamano + ' MB' : '', drive ? 'En Google Drive' : pieza.url ? 'En la app' : 'Sin archivo'].filter(Boolean).join(' · ')}{progreso ? ' · ' + progreso : ''}</p>
            </div>
            <div className="av-prev space-y-2">
              <div className="dt-player">
                {!pieza.url ? <div className="text-center p-6 text-xs"><Lightbulb className="w-8 h-8 mx-auto mb-2" />Idea sin archivo todavía.<br />Adjunta el archivo producido.</div>
                  : video ? (drive ? <iframe src={`https://drive.google.com/file/d/${drive}/preview`} allow="autoplay; fullscreen" allowFullScreen title={pieza.titulo} /> : <video src={pieza.url} poster={mini || undefined} controls playsInline preload="metadata" />)
                  : <img src={mini || pieza.url} alt="" />}
              </div>
              {video && pieza.url && puedeEditar && <label className="flex items-center gap-2 text-[11px] font-bold cursor-pointer" style={{ color: 'var(--primary)' }}>
                {mini && <img src={mini} alt="" className="w-12 h-12 rounded-lg object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />}Cambiar portada
                <input type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => cambiarPortada(e.target.files?.[0])} /></label>}
              <div className="flex gap-2 flex-wrap">
                {pieza.url && <a className="btn" href={pieza.url} target="_blank" rel="noopener noreferrer"><Download />Abrir archivo</a>}
                {enlace && <button type="button" className="btn" onClick={copiar} title="Enlace directo que usa Zernio"><Copy />Copiar enlace</button>}
              </div>
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-slate-100 p-4 flex gap-2 flex-wrap">
          {programar && pieza.url && <button onClick={programar} className="btn"><Send />Programar</button>}
          {puedeEliminar && <button onClick={eliminar} className="btn" style={{ color: '#b91c1c', borderColor: '#fecaca' }}><Trash2 />Eliminar</button>}
          <button onClick={guardar} disabled={guardando || !puedeEditar} className="btn btn-primary ml-auto">{guardando ? (progreso || 'Guardando…') : 'Guardar cambios'}</button>
        </div>
      </div>
    </div>
  )
}
