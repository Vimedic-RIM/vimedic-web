import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownAZ, ArrowLeft, BadgeCheck, BadgeDollarSign, Barcode, Boxes, Check, ChevronDown, ChevronUp,
  ChevronsUpDown, ClipboardCopy, Download, Eraser, Eye, EyeOff, FileText, Hash, Images, LayoutGrid,
  PackageX, PanelsTopLeft, Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Table2, Tag, TriangleAlert, X,
} from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import '../estilos/inventario-original.css'

// Mismo lote que la app original: 24 productos por carga, al desplazarse.
const LOTE = 24

type Fila = {
  id: string
  codigo: string
  codigo_unico: string | null
  nombre: string
  marca: string | null
  pvp: number | null
  precio_dis: number | null
  aplica_iva: boolean
  stock: number
  imagen_url: string | null
  ficha_tecnica_url: string | null
  drive_carpeta_url: string | null
  reservaciones: string | null
  estado: string | null
  fecha_creacion: string | null
  categoria_id: string | null
  categoria: { nombre: string } | null
}

type Detalle = Fila & {
  descripcion: string | null
  stock_minimo: number | null
  stock_maximo: number | null
  en_catalogo: boolean
  oculto: boolean
}

type Categoria = { id: string; nombre: string }
type Orden = { campo: 'nombre' | 'stock' | 'precio' | 'codigo' | 'codInterno' | 'marca'; dir: 'asc' | 'desc' } | null

const COLUMNAS =
  'id,codigo,codigo_unico,nombre,marca,pvp,precio_dis,aplica_iva,stock,imagen_url,ficha_tecnica_url,drive_carpeta_url,reservaciones,estado,fecha_creacion,categoria_id,categoria:categorias(nombre)'

const CAMPO_BD: Record<string, string> = {
  nombre: 'nombre', stock: 'stock', precio: 'pvp', codigo: 'codigo', codInterno: 'codigo_unico', marca: 'marca',
}

const dinero = (v: number | null | undefined) =>
  '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num2 = (v: number | null | undefined) => (Number(v) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const limpiar = (t: string) => t.replace(/[,()%*\\"']/g, ' ').trim()
const inactivo = (p: Fila) => String(p.estado || '').trim().toLowerCase() === 'inactivo'
const esNuevo = (p: Fila) => {
  const t = Date.parse(p.fecha_creacion || '')
  return isFinite(t) && Date.now() - t < 30 * 864e5
}

function copiarTexto(p: Fila, tipo: 'pvp' | 'dis'): string {
  const iva = p.aplica_iva === false ? ' (IVA 0%)' : ' + IVA'
  const l = ['*' + (p.nombre || '') + '*', 'Código: ' + (p.codigo || '')]
  if (tipo === 'dis') {
    if (!(Number(p.precio_dis) > 0)) return ''
    l.push('Precio distribuidor: $' + num2(p.precio_dis) + iva)
  } else l.push('Precio: $' + num2(p.pvp) + iva)
  return l.join('\n')
}

async function copiar(p: Fila, tipo: 'pvp' | 'dis', btn: HTMLElement | null) {
  const t = copiarTexto(p, tipo)
  if (!t) { alert('Este producto no tiene precio distribuidor.'); return }
  try { await navigator.clipboard.writeText(t) } catch { return }
  if (btn) { btn.classList.add('inv-copied'); setTimeout(() => btn.classList.remove('inv-copied'), 1400) }
}

/* ---------- Etiquetas de stock (mismas que la app original) ---------- */
function UbicStock({ p, grande }: { p: { stock: number }; grande?: boolean }) {
  const st = Number(p.stock) || 0
  const c = grande ? ' inv-ub-lg' : ''
  return (
    <span className={'inv-ub' + c + ' ' + (st > 0 ? 'ub-st' : 'ub-st0')} title={st < 0 ? 'Se facturó más de lo que hay en bodega' : undefined}>
      {st > 0 ? `${st} en stock` : st < 0 ? `${st} en stock (facturado sin stock)` : grande ? '0 en stock' : 'Sin stock'}
    </span>
  )
}

function Nuevo({ p, extra }: { p: Fila; extra?: string }) {
  if (!esNuevo(p)) return null
  return <span className={'inv-nuevo ' + (extra || '')} title="Producto nuevo">Nuevo</span>
}

/* ---------- Tarjeta ---------- */
function Tarjeta({ p, abrir }: { p: Fila; abrir: (id: string) => void }) {
  const act = !inactivo(p)
  return (
    <div className="row-card inv-card relative bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col" onClick={() => abrir(p.id)} title="Ver detalles" style={act ? undefined : { opacity: 0.55 }}>
      <div className="relative shrink-0">
        {p.imagen_url
          ? <img loading="lazy" decoding="async" src={p.imagen_url} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} className="w-full aspect-square object-cover bg-slate-50 border-b border-slate-100" alt="" />
          : <div className="w-full aspect-square bg-slate-50 border-b border-slate-100" />}
        <Nuevo p={p} extra="absolute bottom-1.5 left-1.5 shadow" />
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-1">
          {p.ficha_tecnica_url && (
            <a href={p.ficha_tecnica_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Ficha Técnica" className="bg-white/90 hover:bg-white p-1.5 rounded-lg shadow-sm border border-slate-200 transition-colors" style={{ color: 'var(--primary)' }}><FileText className="w-3.5 h-3.5" /></a>
          )}
          {p.drive_carpeta_url && (
            <a href={p.drive_carpeta_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Multimedia" className="bg-white/90 hover:bg-white p-1.5 rounded-lg shadow-sm border border-slate-200 transition-colors" style={{ color: 'var(--teal)' }}><Images className="w-3.5 h-3.5" /></a>
          )}
        </div>
      </div>
      <div className="p-2 flex flex-col flex-grow">
        <p className="text-[9px] font-mono-spec text-slate-400 truncate">{p.codigo}</p>
        <p className="text-xs font-bold text-slate-800 leading-snug line-clamp-2 min-h-[2.2em]">{p.nombre}</p>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {!act && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Inactivo</span>}
          {p.reservaciones && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700">🔴 {p.reservaciones}</span>}
          <UbicStock p={p} />
        </div>
        <div className="mt-auto pt-1.5 flex items-end justify-between gap-1">
          <div className="min-w-0">
            <p className="text-xs font-bold whitespace-nowrap" style={{ color: 'var(--primary)' }}>
              ${(Number(p.pvp) || 0).toFixed(2)} {p.aplica_iva === false ? 'IVA 0%' : '+ IVA'}
              <small className="block text-[9px] text-slate-500">${((Number(p.pvp) || 0) * (p.aplica_iva === false ? 1 : 1.15)).toFixed(2)} IVA incluido</small>
            </p>
          </div>
        </div>
        <span className="inv-qc-wrap mt-2 w-full">
          <button type="button" className="inv-qc" onClick={(e) => { e.stopPropagation(); copiar(p, 'pvp', e.currentTarget) }} title="Copiar nombre, código y precio PVP"><ClipboardCopy />PVP</button>
          {Number(p.precio_dis) > 0 && <button type="button" className="inv-qc dis" onClick={(e) => { e.stopPropagation(); copiar(p, 'dis', e.currentTarget) }} title="Copiar nombre, código y precio distribuidor"><ClipboardCopy />DIS</button>}
        </span>
      </div>
    </div>
  )
}

/* ---------- Fila de tabla ---------- */
function FilaTabla({ p, sel, click }: { p: Fila; sel: boolean; click: (id: string) => void }) {
  const act = !inactivo(p)
  const stockNum = Number(p.stock) || 0
  const ivaTxt = p.aplica_iva === false ? 'IVA 0%' : '+ IVA'
  return (
    <div onClick={() => click(p.id)} className={'inv-tr ' + (sel ? 'is-sel' : '')} style={act ? undefined : { opacity: 0.55 }}>
      <div className="inv-td-img">{p.imagen_url ? <img loading="lazy" decoding="async" src={p.imagen_url} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} alt="" /> : <img alt="" style={{ visibility: 'hidden' }} />}</div>
      <div className="inv-lg inv-arch items-center gap-1">
        {p.ficha_tecnica_url && <a className="inv-tico" href={p.ficha_tecnica_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Ficha técnica" style={{ color: 'var(--primary)' }}><FileText /></a>}
        {p.drive_carpeta_url && <a className="inv-tico" href={p.drive_carpeta_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Multimedia" style={{ color: 'var(--teal)' }}><Images /></a>}
      </div>
      <div className="inv-lg min-w-0"><span className="block w-full text-[11px] font-mono-spec font-semibold truncate" style={{ color: 'var(--primary)' }}>{p.codigo}</span></div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-slate-800 leading-snug truncate" title={p.nombre}><Nuevo p={p} extra="mr-1" />{p.nombre}</p>
        <p className="inv-lg text-[10px] text-slate-400 truncate">
          {p.categoria?.nombre || ''}{!act ? ' · Inactivo' : ''}
          {p.reservaciones && <> · <span className="text-red-600 font-bold">🔴 {p.reservaciones}</span></>}
        </p>
        <div className="inv-sm flex items-center gap-2 mt-0.5 text-[10px] flex-wrap">
          <span className="font-mono-spec text-slate-400">{p.codigo}{p.codigo_unico ? ' - ' + p.codigo_unico : ''}</span>
          {p.marca && <span className="text-slate-500 font-semibold">{p.marca}</span>}
          <UbicStock p={p} />
          <span className="font-bold" style={{ color: 'var(--primary)' }}>{dinero(p.pvp)} <span className="font-semibold text-slate-400">{ivaTxt}</span></span>
        </div>
      </div>
      <div className="inv-lg inv-xl min-w-0"><span className="block w-full text-[11px] text-slate-600 truncate">{p.codigo_unico || '—'}</span></div>
      <div className="inv-lg flex-col items-start gap-0.5"><span className={'inv-pill ' + (stockNum > 0 ? 'ok' : 'no')}>{p.stock ?? '—'}</span></div>
      <div className="inv-lg inv-xl min-w-0"><span className="block w-full text-[11px] font-semibold text-slate-600 truncate">{p.marca || '—'}</span></div>
      <div className="inv-lg flex-col items-start leading-tight"><b className="text-xs" style={{ color: 'var(--primary)' }}>{dinero(p.pvp)}</b><small className="text-[9px] text-slate-400 font-semibold">{ivaTxt}</small></div>
      <div className="inv-cot-col" />
    </div>
  )
}

/* ---------- Panel de detalle (lateral en PC, cajón en pantallas chicas) ---------- */
function Panel({ p, editar, abrirEditar }: { p: Fila; editar: boolean; abrirEditar: (id: string) => void }) {
  const [descripcion, setDescripcion] = useState<string | null>(null)
  useEffect(() => {
    setDescripcion(null)
    supabase.from('productos').select('descripcion').eq('id', p.id).single().then(({ data }) => setDescripcion((data as { descripcion: string | null } | null)?.descripcion ?? ''))
  }, [p.id])

  const pvp = Number(p.pvp) || 0
  const conIva = p.aplica_iva !== false
  const dis = Number(p.precio_dis) || 0
  const pct = pvp > 0 && dis > 0 && dis < pvp ? Math.round((1 - dis / pvp) * 10000) / 100 : 0
  const [verDis, setVerDis] = useState(false)
  useEffect(() => setVerDis(false), [p.id])

  return (
    <>
      <div className="inv-hero">
        {p.imagen_url && <img src={p.imagen_url} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} alt={p.nombre} onClick={() => window.open(p.imagen_url!, '_blank')} title="Ver imagen en grande" />}
        {p.imagen_url && (
          <div className="inv-hero-tools">
            <a href={p.imagen_url} download target="_blank" rel="noopener noreferrer" title="Descargar imagen"><Download /></a>
          </div>
        )}
      </div>
      <div className="inv-title">
        <p className="text-[10px] font-mono-spec text-slate-400">{p.codigo}{p.codigo_unico ? ' - ' + p.codigo_unico : ''}{p.categoria ? ' · ' + p.categoria.nombre : ''}</p>
        <h3 className="font-display font-bold text-lg leading-snug text-slate-800">{p.nombre}</h3>
      </div>
      <div className="inv-acts">
        {(p.ficha_tecnica_url || p.drive_carpeta_url) && (
          <div className="flex flex-col items-center gap-3">
            {p.ficha_tecnica_url && <a className="inv-act" href={p.ficha_tecnica_url} target="_blank" rel="noopener noreferrer"><span className="ic" style={{ ['--c' as string]: '#04896f' }}><FileText /></span>Ficha técnica</a>}
            {p.drive_carpeta_url && <a className="inv-act" href={p.drive_carpeta_url} target="_blank" rel="noopener noreferrer"><span className="ic" style={{ ['--c' as string]: '#055c9d' }}><Images /></span>Multimedia</a>}
          </div>
        )}
        {editar && <button type="button" className="inv-act" onClick={() => abrirEditar(p.id)}><span className="ic" style={{ ['--c' as string]: '#c98a1f' }}><Pencil /></span>Editar</button>}
        <button type="button" className="inv-act" onClick={(e) => copiar(p, 'pvp', e.currentTarget)} title="Copiar nombre, código y precio PVP"><span className="ic" style={{ ['--c' as string]: '#055c9d' }}><ClipboardCopy /></span>Copiar PVP</button>
        {dis > 0 && <button type="button" className="inv-act" onClick={(e) => copiar(p, 'dis', e.currentTarget)} title="Copiar nombre, código y precio distribuidor"><span className="ic" style={{ ['--c' as string]: '#7c3aed' }}><ClipboardCopy /></span>Copiar DIS</button>}
      </div>
      <div className="px-4 pb-4 space-y-3">
        {p.reservaciones && (
          <div className="flex items-start gap-2 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2"><TriangleAlert className="w-4 h-4 shrink-0" /><span>{p.reservaciones}</span></div>
        )}
        <div className="inv-price">
          <div className="grid grid-cols-2 gap-3 items-stretch">
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Precio PVP</p>
              <p className="font-display font-bold text-xl leading-tight" style={{ color: 'var(--primary)' }}>{dinero(pvp)} <span className="text-[10px] font-semibold text-slate-500">{conIva ? '+ IVA' : 'IVA 0%'}</span></p>
              <p className="text-[10px] text-slate-500">{conIva ? dinero(pvp * 1.15) + ' IVA incluido' : 'No aplica IVA'}</p>
            </div>
            {dis > 0 ? (
              <div className={'inv-dis' + (verDis ? ' show' : '')}>
                <div className="inv-dis-val" onClick={() => setVerDis(false)} title="Ocultar precio DIS">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Precio DIS</p>
                  <p className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-display font-bold text-lg" style={{ color: 'var(--teal)' }}>{dinero(dis)}</span>
                    {pct > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#7c3aed1A', color: '#7c3aed' }}>DIS:{String(pct).replace('.', ',')}%</span>}
                  </p>
                </div>
                <button type="button" className="inv-dis-cover" onClick={() => setVerDis(true)}><Eye /> Mostrar DIS</button>
              </div>
            ) : <div />}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl px-3 py-1">
          <div className="inv-kv"><span className="k"><Hash /></span><div className="min-w-0"><small>Código</small><b className="font-mono-spec">{p.codigo}</b></div></div>
          {p.codigo_unico && <div className="inv-kv"><span className="k"><Barcode /></span><div className="min-w-0"><small>Código interno</small><b>{p.codigo_unico}</b></div></div>}
          {p.marca && <div className="inv-kv"><span className="k"><BadgeCheck /></span><div className="min-w-0"><small>Marca</small><b>{p.marca}</b></div></div>}
          <div className="inv-kv"><span className="k"><Boxes /></span><div className="min-w-0"><small>Stock</small><div className="flex flex-wrap gap-1 mt-0.5"><UbicStock p={p} grande /></div></div></div>
          <div className="inv-kv"><span className="k"><Tag /></span><div className="min-w-0"><small>Categoría</small><b>{p.categoria?.nombre || '—'}</b></div></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Descripción</p>
          <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{descripcion === null ? 'Cargando…' : descripcion || '—'}</p>
        </div>
      </div>
    </>
  )
}

/* ---------- Pantalla principal ---------- */
export default function Inventario({ perfil, volver }: { perfil: Perfil; volver: () => void }) {
  const [items, setItems] = useState<Fila[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [error, setError] = useState('')
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('')
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [orden, setOrden] = useState<Orden>(null)
  const [mostrarInactivos, setMostrarInactivos] = useState(false)
  const [vista, setVista] = useState<'tarjetas' | 'tabla'>(() => {
    try { return localStorage.getItem('vimedic_inventario_vista') === 'tabla' ? 'tabla' : 'tarjetas' } catch { return 'tarjetas' }
  })
  const [menu, setMenu] = useState<'filtros' | 'vista' | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 12, top: 56 })
  const [selId, setSelId] = useState<string | null>(null)
  const [cajon, setCajon] = useState<string | null>(null)
  const [form, setForm] = useState<string | 'nuevo' | null>(null)
  const [esPc, setEsPc] = useState(() => window.matchMedia('(min-width: 1440px)').matches)
  const peticion = useRef(0)
  const centinela = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<Fila[]>([])
  itemsRef.current = items

  const editar = puede(perfil, 'inventario', 'editar')
  const crear = puede(perfil, 'inventario', 'crear')

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1440px)')
    const f = () => setEsPc(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(limpiar(texto)), 200)
    return () => clearTimeout(t)
  }, [texto])

  useEffect(() => {
    supabase.from('categorias').select('id,nombre').eq('activo', true).is('deleted_at', null).order('nombre')
      .then(({ data }) => setCategorias((data as Categoria[]) ?? []))
  }, [])

  const consulta = useCallback(() => {
    let q = supabase.from('productos').select(COLUMNAS, { count: 'exact' }).is('deleted_at', null)
    // Cada palabra debe aparecer en alguno de los campos (igual que la búsqueda de la app original).
    for (const palabra of busqueda.split(/\s+/).filter(Boolean)) {
      q = q.or(`nombre.ilike.%${palabra}%,codigo.ilike.%${palabra}%,codigo_unico.ilike.%${palabra}%,marca.ilike.%${palabra}%`)
    }
    if (categoria) q = q.eq('categoria_id', categoria)
    if (!mostrarInactivos) q = q.or('estado.is.null,estado.not.ilike.inactivo')
    if (orden) q = q.order(CAMPO_BD[orden.campo], { ascending: orden.dir === 'asc', nullsFirst: false })
    else q = q.order('orden', { ascending: true, nullsFirst: false })
    return q.order('nombre', { ascending: true })
  }, [busqueda, categoria, mostrarInactivos, orden])

  // Carga desde cero cuando cambia la búsqueda, el filtro o el orden.
  const cargar = useCallback(async (hasta = LOTE) => {
    const n = ++peticion.current
    setCargando(true)
    const { data, count, error } = await consulta().range(0, hasta - 1)
    if (n !== peticion.current) return
    if (error) setError('No se pudo cargar el inventario: ' + error.message)
    else { setError(''); setItems((data as unknown as Fila[]) ?? []); setTotal(count ?? 0) }
    setCargando(false)
  }, [consulta])

  useEffect(() => { cargar() }, [cargar])

  const cargarMas = useCallback(async () => {
    if (cargando || cargandoMas || itemsRef.current.length >= total) return
    const n = peticion.current
    setCargandoMas(true)
    const desde = itemsRef.current.length
    const { data, error } = await consulta().range(desde, desde + LOTE - 1)
    if (n === peticion.current && !error) setItems((a) => [...a, ...((data as unknown as Fila[]) ?? [])])
    setCargandoMas(false)
  }, [consulta, cargando, cargandoMas, total])

  // Carga por desplazamiento.
  useEffect(() => {
    const el = centinela.current
    if (!el) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) cargarMas() }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [cargarMas, items.length])

  // Tiempo real: refresca lo que ya está cargado cuando alguien cambia un producto.
  useEffect(() => {
    const canal = supabase.channel('inventario-productos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => cargar(Math.max(LOTE, itemsRef.current.length)))
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [cargar])

  // En PC siempre hay un producto seleccionado en el panel lateral.
  useEffect(() => {
    if (vista === 'tabla' && items.length && !items.some((x) => x.id === selId)) setSelId(items[0].id)
  }, [items, vista, selId])

  useEffect(() => {
    const f = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-menu]')) setMenu(null) }
    document.addEventListener('click', f)
    return () => document.removeEventListener('click', f)
  }, [])

  const categoriasLista = useMemo(() => categorias, [categorias])
  const hayFiltros = !!categoria || !!orden

  function abrirMenu(e: React.MouseEvent<HTMLButtonElement>, cual: 'filtros' | 'vista') {
    e.stopPropagation()
    if (menu === cual) { setMenu(null); return }
    const r = e.currentTarget.getBoundingClientRect()
    const ancho = cual === 'filtros' ? 300 : 240
    let left = r.left
    if (left + ancho > window.innerWidth - 12) left = window.innerWidth - ancho - 12
    setPos({ left: Math.max(12, left), top: r.bottom + 8 })
    setMenu(cual)
  }

  function alternarOrden(campo: NonNullable<Orden>['campo']) {
    setOrden((o) => {
      if (!o || o.campo !== campo) return { campo, dir: campo === 'stock' || campo === 'precio' ? 'desc' : 'asc' }
      return { campo, dir: o.dir === 'asc' ? 'desc' : 'asc' }
    })
  }

  function restablecer() { setTexto(''); setCategoria(''); setOrden(null); setMostrarInactivos(false) }

  function cambiarVista(v: 'tarjetas' | 'tabla') {
    setVista(v); setMenu(null)
    try { localStorage.setItem('vimedic_inventario_vista', v) } catch { /* sin almacenamiento */ }
  }

  const iconoOrden = (c: string) => orden?.campo === c ? (orden.dir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 sort-icon text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 sort-icon text-slate-400" />) : <ChevronsUpDown className="w-3.5 h-3.5 sort-icon text-slate-400" />

  function Th({ campo, etiqueta, cls }: { campo: NonNullable<Orden>['campo']; etiqueta: string; cls?: string }) {
    const on = orden?.campo === campo
    const numerico = campo === 'stock' || campo === 'precio'
    const pista = on ? (orden!.dir === 'asc' ? (numerico ? 'menor → mayor' : 'A → Z') : (numerico ? 'mayor → menor' : 'Z → A')) : 'Ordenar'
    return (
      <button type="button" onClick={() => alternarOrden(campo)} title={pista} className={'inv-sort ' + (on ? 'on ' : '') + (cls || '')}>
        {etiqueta}<span className="inv-sort-ic">{on ? (orden!.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    )
  }

  const seleccionado = items.find((x) => x.id === selId) || null
  const enCajon = items.find((x) => x.id === cajon) || null
  const clickProducto = (id: string) => { if (esPc && vista === 'tabla') setSelId(id); else setCajon(id) }

  return (
    <div className="min-h-screen antialiased" style={{ background: 'var(--bg)' }}>
      <header className="sticky top-0 z-30 border-b border-slate-200" style={{ background: 'linear-gradient(135deg, var(--navy), var(--primary))' }}>
        <div className="inv-head relative px-3 sm:px-5 py-2 min-h-14 flex items-center gap-2 flex-wrap sm:flex-nowrap overflow-visible">
          <button onClick={volver} className="w-9 h-9 text-white rounded-lg hover:bg-white/10 shrink-0 flex items-center justify-center transition-colors" title="Volver"><ArrowLeft className="w-4 h-4" /></button>
          <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[240px] order-1 sm:mr-1 flex flex-col justify-center min-h-10">
            <h1 className="font-display font-bold text-white text-[15px] sm:text-base leading-tight whitespace-nowrap truncate">Inventario Vimedic</h1>
          </div>

          <div className="order-3 sm:order-2 w-full sm:w-auto flex items-center gap-2 pb-1 sm:pb-0">
            <div className="relative flex-1 sm:flex-none">
              <input type="text" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por código, nombre, marca o categoría…"
                className="w-full sm:w-64 xl:w-80 pl-8 pr-3 py-2 rounded-lg bg-white/10 text-white placeholder:text-white/55 text-xs focus:outline-none focus:ring-2 focus:ring-white/40" />
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/60" />
            </div>

            <div className="relative shrink-0" data-menu>
              <button type="button" onClick={(e) => abrirMenu(e, 'filtros')} className={'w-9 h-9 rounded-lg hover:bg-white/20 text-white flex items-center justify-center transition-colors ' + (hayFiltros ? 'bg-white/30' : 'bg-white/10')} title="Filtros y orden"><SlidersHorizontal className="w-4 h-4" /></button>
              {menu === 'filtros' && (
                <div data-menu className="fixed z-[90] w-[300px] max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden" style={{ left: pos.left, top: pos.top }}>
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <div><p className="text-xs font-bold text-slate-800">Filtros</p><p className="text-[10px] text-slate-400 mt-0.5">Categoría y orden</p></div>
                    <SlidersHorizontal className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="py-2">
                    <p className="px-4 pt-1 pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">Categoría</p>
                    <div className="max-h-48 overflow-y-auto">
                      <button type="button" onClick={() => setCategoria('')} className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors">
                        <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"><LayoutGrid className="w-4 h-4" /></span>
                        <span className="min-w-0 flex-1"><b className={'block text-xs ' + (!categoria ? 'text-slate-900' : 'text-slate-700')}>Todas las categorías</b><small className="block text-[10px] text-slate-400">Mostrar todo el inventario</small></span>
                        {!categoria && <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--primary)' }} />}
                      </button>
                      {categoriasLista.map((c) => (
                        <button key={c.id} type="button" onClick={() => setCategoria(c.id)} className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors">
                          <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"><Tag className="w-4 h-4" /></span>
                          <span className="min-w-0 flex-1"><b className={'block text-xs truncate ' + (categoria === c.id ? 'text-slate-900' : 'text-slate-700')}>{c.nombre}</b><small className="block text-[10px] text-slate-400">Filtrar por categoría</small></span>
                          {categoria === c.id && <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--primary)' }} />}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-slate-100 py-2">
                    <p className="px-4 pt-1 pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">Ordenar</p>
                    {([['nombre', 'Nombre', 'Orden alfabético', ArrowDownAZ], ['stock', 'Stock', 'Mayor o menor disponibilidad', Boxes], ['precio', 'Precio', 'Mayor o menor precio', BadgeDollarSign]] as const).map(([c, t, s, Ic]) => (
                      <button key={c} type="button" onClick={() => alternarOrden(c)} className={'w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors ' + (orden?.campo === c ? 'bg-slate-50' : '')}>
                        <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"><Ic className="w-4 h-4" /></span>
                        <span className="min-w-0 flex-1"><b className="block text-xs text-slate-700">{t}</b><small className="block text-[10px] text-slate-400">{s}</small></span>
                        {iconoOrden(c)}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-slate-100 p-2">
                    <button type="button" onClick={() => { restablecer(); setMenu(null) }} className="w-full px-3 py-2.5 rounded-xl flex items-center gap-3 text-left hover:bg-slate-50 transition-colors">
                      <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"><Eraser className="w-4 h-4" /></span>
                      <span className="min-w-0 flex-1"><b className="block text-xs text-slate-700">Limpiar</b><small className="block text-[10px] text-slate-400">Búsqueda, filtros y orden</small></span>
                    </button>
                  </div>
                </div>
              )}
            </div>
            <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-white/75 bg-white/10 rounded-lg px-2.5 py-2" title="Productos encontrados"><b className="text-white">{total}</b> productos</span>
          </div>

          <div className="order-2 sm:order-3 flex items-center gap-1 shrink-0 sm:ml-auto">
            <div className="relative" data-menu>
              <button type="button" onClick={(e) => abrirMenu(e, 'vista')} className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors" title="Cambiar vista">
                {vista === 'tabla' ? <Table2 className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
              </button>
              {menu === 'vista' && (
                <div data-menu className="fixed z-[90] w-60 max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden" style={{ left: pos.left, top: pos.top }}>
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <div><p className="text-xs font-bold text-slate-800">Cambiar vista</p><p className="text-[10px] text-slate-400 mt-0.5">Elige cómo ver el inventario</p></div>
                    <PanelsTopLeft className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="p-2">
                    {([['tarjetas', 'Tarjetas', 'Vista visual con imágenes', LayoutGrid], ['tabla', 'Tabla', 'Vista compacta para revisar datos', Table2]] as const).map(([v, t, s, Ic]) => (
                      <button key={v} type="button" onClick={() => cambiarVista(v)} className={'w-full px-3 py-2.5 rounded-xl flex items-center gap-3 text-left hover:bg-slate-50 transition-colors ' + (vista === v ? 'bg-slate-50' : '')}>
                        <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"><Ic className="w-4 h-4" /></span>
                        <span className="min-w-0 flex-1"><b className="block text-xs text-slate-700">{t}</b><small className="block text-[10px] text-slate-400">{s}</small></span>
                        {vista === v && <Check className="w-4 h-4" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {crear && <button onClick={() => setForm('nuevo')} className="flex w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white items-center justify-center transition-colors" title="Agregar producto"><Plus className="w-4 h-4" /></button>}
            {editar && (
              <button onClick={() => setMostrarInactivos((v) => !v)} className={'flex w-9 h-9 rounded-lg hover:bg-white/20 text-white items-center justify-center transition-colors ' + (mostrarInactivos ? 'bg-white/30' : 'bg-white/10')} title="Mostrar productos inactivos"><EyeOff className="w-4 h-4" /></button>
            )}
            <button onClick={() => cargar(Math.max(LOTE, items.length))} className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors" title="Actualizar inventario"><RefreshCw className={'w-4 h-4 ' + (cargando ? 'animate-spin' : '')} /></button>
          </div>
        </div>
      </header>

      <main className="w-full px-4 sm:px-6 py-5">
        {error && <div className="mb-3 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}

        {cargando && items.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 gap-2 text-slate-400">
            <span className="inline-block w-5 h-5 rounded-full border-2 border-slate-300 border-t-[color:var(--primary)] animate-spin" />
            <p className="text-xs font-semibold">Cargando Inventario...</p>
          </div>
        )}

        {vista === 'tarjetas' && items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-2">
            {items.map((p) => <Tarjeta key={p.id} p={p} abrir={clickProducto} />)}
          </div>
        )}

        {vista === 'tabla' && items.length > 0 && (
          <div className="inv-split">
            <div className="inv-tbl min-w-0">
              <div className="inv-th">
                <span>Imagen</span><span className="inv-arch">Archivos</span>
                <Th campo="codigo" etiqueta="Código" /><Th campo="nombre" etiqueta="Producto" />
                <Th campo="codInterno" etiqueta="Código interno" cls="inv-xl" /><Th campo="stock" etiqueta="Stock" />
                <Th campo="marca" etiqueta="Marca" cls="inv-xl" /><Th campo="precio" etiqueta="PVP" /><span className="text-right" />
              </div>
              <div>{items.map((p) => <FilaTabla key={p.id} p={p} sel={esPc && selId === p.id} click={clickProducto} />)}</div>
            </div>
            <aside className="inv-side">
              {seleccionado
                ? <Panel p={seleccionado} editar={editar} abrirEditar={(id) => setForm(id)} />
                : <div className="p-10 text-center text-xs text-slate-400">Selecciona un producto de la lista para ver sus detalles.</div>}
            </aside>
          </div>
        )}

        {!cargando && items.length === 0 && (
          <div className="text-center py-16">
            <PackageX className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-400">
              {busqueda || categoria ? 'No hay productos que coincidan con la búsqueda.' : 'Todavía no hay productos. Cuando se importe el inventario aparecerán aquí.'}
            </p>
          </div>
        )}

        <div ref={centinela} />
        <div className="inv-pager">
          {total > 0 && (
            <p className="inv-pg-info">
              {items.length < total ? `Mostrando ${items.length} de ${total} productos · desplázate para ver más` : `${total} producto${total === 1 ? '' : 's'}`}
            </p>
          )}
        </div>
      </main>

      {/* Cajón de detalle (pantallas que no tienen panel lateral) */}
      {enCajon && (
        <div className="vq-overlay open" onClick={() => setCajon(null)}>
          <div className="vq-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="vq-drawer-head">
              <div className="vq-drawer-title"><div><h2>Detalle del producto</h2><p>{enCajon.codigo}</p></div></div>
              <button className="vq-close" onClick={() => setCajon(null)} aria-label="Cerrar"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-auto">
              <Panel p={enCajon} editar={editar} abrirEditar={(id) => { setCajon(null); setForm(id) }} />
            </div>
          </div>
        </div>
      )}

      {form && (
        <FormularioProducto
          perfil={perfil}
          id={form}
          categorias={categorias}
          cerrar={() => setForm(null)}
          guardado={() => { setForm(null); cargar(Math.max(LOTE, items.length)) }}
        />
      )}
    </div>
  )
}

/* ---------- Formulario de producto (estilo pf-* de la app original) ---------- */
type Campos = {
  id: string; codigo: string; codigo_unico: string | null; nombre: string; categoria_id: string | null; marca: string | null
  descripcion: string | null; pvp: number | null; precio_dis: number | null; aplica_iva: boolean; stock: number
  stock_minimo: number | null; stock_maximo: number | null; en_catalogo: boolean; oculto: boolean; imagen_url: string | null
}

function FormularioProducto({ perfil, id, categorias, cerrar, guardado }: {
  perfil: Perfil; id: string | 'nuevo'; categorias: Categoria[]; cerrar: () => void; guardado: () => void
}) {
  const nuevo = id === 'nuevo'
  const puedeArchivar = puede(perfil, 'inventario', 'eliminar')
  const [p, setP] = useState<Campos | null>(nuevo ? {
    id: crypto.randomUUID(), codigo: '', codigo_unico: null, nombre: '', categoria_id: null, marca: null, descripcion: null,
    pvp: null, precio_dis: null, aplica_iva: true, stock: 0, stock_minimo: null, stock_maximo: null,
    en_catalogo: false, oculto: false, imagen_url: null,
  } : null)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (nuevo) return
    supabase.from('productos')
      .select('id,codigo,codigo_unico,nombre,categoria_id,marca,descripcion,pvp,precio_dis,aplica_iva,stock,stock_minimo,stock_maximo,en_catalogo,oculto,imagen_url')
      .eq('id', id).single()
      .then(({ data, error }) => { if (error) setError(error.message); else setP(data as Campos) })
  }, [id, nuevo])

  function set<K extends keyof Campos>(k: K, v: Campos[K]) { setP((x) => (x ? { ...x, [k]: v } : x)) }
  const num = (s: string) => (s === '' ? null : Number(s))

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!p) return
    setGuardando(true); setError('')
    const { id: pid, ...campos } = p
    const { error } = nuevo
      ? await supabase.from('productos').insert({ id: pid, ...campos })
      : await supabase.from('productos').update(campos).eq('id', pid)
    setGuardando(false)
    if (error) setError(error.code === '23505' ? 'Ya existe un producto con ese código.' : error.message)
    else guardado()
  }

  async function archivar() {
    if (!p || !confirm(`¿Archivar "${p.nombre}"? Dejará de aparecer en el inventario.`)) return
    // Borrado lógico: nunca DELETE.
    const { error } = await supabase.from('productos').update({ deleted_at: new Date().toISOString() }).eq('id', p.id)
    if (error) setError(error.message); else guardado()
  }

  const Seccion = ({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) => (
    <section className="pf-sec"><header><span className="pf-num">{n}</span><h4>{titulo}</h4></header>{children}</section>
  )

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(15,23,42,.52)', zIndex: 130 }} onClick={cerrar}>
      <form className="pf-shell" onClick={(e) => e.stopPropagation()} onSubmit={guardar}>
        <div className="pf-head text-white px-5 py-4 shrink-0">
          <div>
            <div className="min-w-0">
              <h2 className="font-display font-bold text-base leading-tight">{nuevo ? 'Agregar producto' : 'Editar producto'}</h2>
              <p className="text-[11px] text-white/70">{nuevo ? 'Completa los datos del producto' : p?.codigo}</p>
            </div>
            <button type="button" className="pf-x text-white" onClick={cerrar} aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
        </div>
        {!p ? <div style={{ padding: 24 }} className="text-xs text-slate-400">{error || 'Cargando…'}</div> : (
          <>
            <div className="overflow-y-auto p-4 space-y-3">
              <Seccion n={1} titulo="Identificación">
                <div className="pf-grid">
                  <label className="pf-f"><span>Código *</span><input className="pf-in" required disabled={!nuevo} value={p.codigo} onChange={(e) => set('codigo', e.target.value.trim())} /></label>
                  <label className="pf-f"><span>Código interno / modelo</span><input className="pf-in" value={p.codigo_unico ?? ''} onChange={(e) => set('codigo_unico', e.target.value || null)} /></label>
                  <label className="pf-f pf-full"><span>Nombre *</span><input className="pf-in" required value={p.nombre} onChange={(e) => set('nombre', e.target.value)} /></label>
                  <label className="pf-f"><span>Categoría</span>
                    <select className="pf-in" value={p.categoria_id ?? ''} onChange={(e) => set('categoria_id', e.target.value || null)}>
                      <option value="">Sin categoría</option>
                      {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </label>
                  <label className="pf-f"><span>Marca</span><input className="pf-in" value={p.marca ?? ''} onChange={(e) => set('marca', e.target.value || null)} /></label>
                  <label className="pf-f pf-full"><span>Descripción</span><textarea className="pf-in pf-ta" value={p.descripcion ?? ''} onChange={(e) => set('descripcion', e.target.value || null)} /></label>
                </div>
              </Seccion>
              <Seccion n={2} titulo="Precios y stock">
                <div className="pf-grid">
                  <label className="pf-f"><span>Precio PVP</span><input className="pf-in" type="number" step="0.01" min="0" value={p.pvp ?? ''} onChange={(e) => set('pvp', num(e.target.value))} /></label>
                  <label className="pf-f"><span>Precio distribuidor</span><input className="pf-in" type="number" step="0.01" min="0" value={p.precio_dis ?? ''} onChange={(e) => set('precio_dis', num(e.target.value))} /></label>
                  <label className="pf-f"><span>Stock</span><input className="pf-in" type="number" step="1" value={p.stock} onChange={(e) => set('stock', Number(e.target.value))} /></label>
                  <label className="pf-f"><span>Stock mínimo</span><input className="pf-in" type="number" step="1" min="0" value={p.stock_minimo ?? ''} onChange={(e) => set('stock_minimo', num(e.target.value))} /></label>
                  <label className="pf-f"><span>Stock máximo</span><input className="pf-in" type="number" step="1" min="0" value={p.stock_maximo ?? ''} onChange={(e) => set('stock_maximo', num(e.target.value))} /></label>
                </div>
                <label className="pf-sw"><div><p>Aplica IVA</p><small>Se suma el 15 % al precio PVP</small></div><input type="checkbox" checked={p.aplica_iva} onChange={(e) => set('aplica_iva', e.target.checked)} /></label>
              </Seccion>
              <Seccion n={3} titulo="Visibilidad">
                <label className="pf-sw"><div><p>Visible en el catálogo</p><small>Aparece en la web pública</small></div><input type="checkbox" checked={p.en_catalogo} onChange={(e) => set('en_catalogo', e.target.checked)} /></label>
                <label className="pf-sw"><div><p>Oculto</p><small>No se muestra en los listados</small></div><input type="checkbox" checked={p.oculto} onChange={(e) => set('oculto', e.target.checked)} /></label>
              </Seccion>
              {error && <div className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 bg-white flex items-center gap-2 shrink-0">
              {!nuevo && puedeArchivar && <button type="button" onClick={archivar} className="text-xs font-bold px-3 py-2 rounded-xl text-red-700 bg-red-50 hover:bg-red-50">Archivar</button>}
              <span style={{ flex: 1 }} />
              <button className="pf-submit" style={{ width: 'auto', padding: '10px 22px' }} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
