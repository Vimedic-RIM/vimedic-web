import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  GripVertical, Move, RotateCcw, Ship, ArrowDownAZ, ArrowRight, BadgeCheck, CircleCheck, ClipboardList, PlusCircle, ShoppingCart, BadgeDollarSign, Barcode, Boxes, Check, ChevronDown, ChevronUp,
  ChevronsUpDown, ClipboardCopy, Download, Eraser, Eye, EyeOff, FileText, Hash, ImagePlus, Images, LayoutGrid,
  Package, PackagePlus, PackageX, PanelsTopLeft, Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Table2, Tag,
  Trash2, TriangleAlert, Video, X,
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

// Igual que la app original: los enlaces de Drive se piden como miniatura del ancho necesario.
// Cuando las imágenes pasen a R2 (media.vimedic.com.ec) esta función devuelve la URL tal cual.
export function imagen(url: string | null | undefined, ancho: number): string {
  const v = String(url || '').trim()
  if (!v) return ''
  try {
    const u = new URL(v)
    if (u.hostname !== 'drive.google.com' && !/^lh[0-9]+\.googleusercontent\.com$/.test(u.hostname)) return v
    const m = u.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/)
    const id = m ? m[1] : u.searchParams.get('id')
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return v
    return `https://lh3.googleusercontent.com/d/${id}=w${ancho}`
  } catch { return v }
}

type Linea = { id: string; codigo: string; nombre: string; imagen: string; precio: number; cantidad: number; descuento: number; iva: boolean; categoria: string; ficha: string; carpeta: string }
type Carrito = { cant: (id: string) => number; agregar: (p: Fila, e?: HTMLElement | null) => void }
const CLAVE_CARRITO = 'vm_cot_inv'
const CLAVE_PENDIENTE = 'vm_cot_pendiente'
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

/* ---------- Estado del stock: en revisión / en reparación / por llegar (vmInvEstadoStock de la app original) ---------- */
type ImpProd = { codigo: string; nombre: string; etapa: string; eta: string; llegada: string; enCamino: number; enRevision: number; enST: number }
type Est = { revision: number; reparacion: number; porLlegar: number; eta: string; imps: ImpProd[] }
type ImpResumen = { codigo: string; nombre: string; etapa: string; eta: string; llegada: string; productos: Record<string, number>; nuevos: number }
const EstCtx = createContext<{ est: Record<string, Est>; verImp: (codigo: string) => void }>({ est: {}, verImp: () => undefined })
const fechaC = (s: string) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '')
/** Marco del producto: ámbar si llegó algo sin verificar, azul si solo viene en camino. */
const marcoEst = (e?: Est) => (e ? (e.revision ? 'inv-hl-rev' : e.porLlegar ? 'inv-hl-lle' : '') : '')

function Banda({ p }: { p: { id: string } }) {
  const e = useContext(EstCtx).est[p.id]
  if (!e) return null
  if (e.revision) return <div className="inv-hl-band rev">En revisión{e.porLlegar ? ' · +' + e.porLlegar + ' por llegar' : ''}</div>
  if (e.porLlegar) return <div className="inv-hl-band lle">Por llegar {e.porLlegar}{e.eta ? ' · ' + fechaC(e.eta).slice(0, 5) : ''}</div>
  return null
}

/** Próximas importaciones del producto con la nota obligatoria (sin proveedor ni costos). */
function ImpLista({ id }: { id: string }) {
  const { est, verImp } = useContext(EstCtx)
  const e = est[id]
  if (!e || !e.imps.length) return null
  return (
    <div className="inv-imp-box">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Próximas importaciones de este producto</p>
      <div className="inv-imp-nota"><span>⚠</span><div><b>Unidades pendientes de verificación.</b> Aún no han sido revisadas por Bodega ni por Servicio Técnico. Antes de ofrecerlas o comprometer una fecha de entrega, confirma su estado y disponibilidad con el área correspondiente.</div></div>
      {e.imps.map((i) => {
        const llego = i.etapa === 'En bodega'
        const f = llego ? (i.llegada ? 'Llegó a bodega el ' + fechaC(i.llegada) : 'Ya está en bodega') : (i.eta ? 'Llegada aproximada: ' + fechaC(i.eta) : 'Fecha de llegada por confirmar')
        return (
          <div className="inv-imp-row" key={i.codigo}>
            <div className="min-w-0 flex-1"><b className="text-slate-800">{f}</b><div className="text-[11px] text-slate-500">{i.codigo}{i.nombre && i.nombre !== i.codigo ? ' · ' + i.nombre : ''}</div></div>
            <button type="button" className="inv-imp-ver" onClick={(ev) => { ev.stopPropagation(); verImp(i.codigo) }}>Ver sus productos</button>
            <div className="text-right shrink-0">
              {i.enCamino > 0 && <span className="inv-ub ub-lle">{i.enCamino} por llegar</span>}
              {i.enRevision > 0 && <> <span className="inv-ub ub-rev">{i.enRevision} en revisión</span></>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- Etiquetas de stock (mismas que la app original) ---------- */
function UbicStock({ p, grande }: { p: { id: string; stock: number }; grande?: boolean }) {
  const st = Number(p.stock) || 0
  const e = useContext(EstCtx).est[p.id]
  const c = grande ? ' inv-ub-lg' : ''
  return (
    <>
      <span className={'inv-ub' + c + ' ' + (st > 0 ? 'ub-st' : 'ub-st0')} title={st < 0 ? 'Se facturó más de lo que hay en bodega' : undefined}>
        {st > 0 ? `${st} en stock` : st < 0 ? `${st} en stock (facturado sin stock)` : grande ? '0 en stock' : 'Sin stock'}
      </span>
      {e?.revision ? <span className={'inv-ub' + c + ' ub-rev'}>{e.revision} en revisión</span> : null}
      {e?.reparacion ? <span className={'inv-ub' + c + ' ub-rep'}>{e.reparacion} en reparación</span> : null}
      {grande && e?.porLlegar ? <span className={'inv-ub' + c + ' ub-lle'}>{e.porLlegar} por llegar</span> : null}
    </>
  )
}

function Nuevo({ p, extra }: { p: Fila; extra?: string }) {
  if (!esNuevo(p)) return null
  return <span className={'inv-nuevo ' + (extra || '')} title="Producto nuevo">Nuevo</span>
}

/* ---------- Tarjeta ---------- */
type Orden_ = { arrastrar: (id: string) => void; soltar: (id: string) => void }
function Tarjeta({ p, abrir, car, alternar, reordenar }: { p: Fila; abrir: (id: string) => void; car: Carrito | null; alternar?: (p: Fila) => void; reordenar?: Orden_ }) {
  const act = !inactivo(p)
  const n = car?.cant(p.id) ?? 0
  const marco = marcoEst(useContext(EstCtx).est[p.id])
  if (reordenar) {
    return (
      <div className="row-card relative bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col" style={{ cursor: 'grab', opacity: act ? 1 : 0.55 }} draggable
        onDragStart={() => reordenar.arrastrar(p.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); reordenar.soltar(p.id) }}>
        <div className="absolute z-10 m-1.5 flex items-center justify-center text-slate-400 bg-white/90 rounded-md p-0.5"><GripVertical className="w-3.5 h-3.5" /></div>
        {p.imagen_url ? <img loading="lazy" decoding="async" src={imagen(p.imagen_url, 240)} className="w-full aspect-square object-cover bg-slate-50 border-b border-slate-100 pointer-events-none" alt="" /> : <div className="w-full aspect-square bg-slate-50 border-b border-slate-100" />}
        <div className="p-2"><p className="text-[9px] font-mono-spec text-slate-400 truncate">{p.codigo}</p><p className="text-xs font-bold text-slate-800 leading-snug line-clamp-2">{p.nombre}</p></div>
      </div>
    )
  }
  return (
    <div className={'row-card inv-card relative bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col' + (n ? ' is-added' : '') + (marco ? ' ' + marco : '')} onClick={() => abrir(p.id)} title="Ver detalles" style={act ? undefined : { opacity: 0.55 }}>
      <div className="relative shrink-0">
        {p.imagen_url
          ? <img loading="lazy" decoding="async" src={imagen(p.imagen_url, 320)}onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} className="w-full aspect-square object-cover bg-slate-50 border-b border-slate-100" alt="" />
          : <div className="w-full aspect-square bg-slate-50 border-b border-slate-100" />}
        <span className="inv-added"><Check /><span className="inv-added-n">Agregado{n > 1 ? ' ×' + n : ''}</span></span>
        <Nuevo p={p} extra="absolute bottom-1.5 left-1.5 shadow" />
        {alternar && (
          <button type="button" onClick={(e) => { e.stopPropagation(); alternar(p) }} title={act ? 'Inactivar producto' : 'Activar producto'} className="absolute top-1.5 left-1.5 bg-white p-1 rounded-md shadow border border-slate-200" style={{ color: act ? '#04896f' : '#c0392b' }}>
            {act ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          </button>
        )}
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-1">
          {p.ficha_tecnica_url && (
            <a href={p.ficha_tecnica_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Ficha Técnica" className="bg-white/90 hover:bg-white p-1.5 rounded-lg shadow-sm border border-slate-200 transition-colors" style={{ color: 'var(--primary)' }}><FileText className="w-3.5 h-3.5" /></a>
          )}
          {p.drive_carpeta_url && (
            <a href={p.drive_carpeta_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Multimedia" className="bg-white/90 hover:bg-white p-1.5 rounded-lg shadow-sm border border-slate-200 transition-colors" style={{ color: 'var(--teal)' }}><Images className="w-3.5 h-3.5" /></a>
          )}
        </div>
      </div>
      <Banda p={p} />
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
        {car && (
          <button type="button" className="inv-cot mt-1.5" onClick={(e) => { e.stopPropagation(); car.agregar(p, e.currentTarget) }} aria-label={'Cotizar ' + p.nombre}>
            <span className="when-add inline-flex items-center gap-1.5"><ShoppingCart />Cotizar</span>
            <span className="when-added"><CircleCheck /><span className="inv-cot-n">Agregado{n > 1 ? ' ×' + n : ''}</span><Plus /></span>
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------- Fila de tabla ---------- */
function TablaEst({ id }: { id: string }) {
  const e = useContext(EstCtx).est[id]
  if (!e) return null
  return (
    <>
      {e.revision > 0 && <span className="inv-ub ub-rev">{e.revision} en revisión</span>}
      {e.reparacion > 0 && <span className="inv-ub ub-rep">{e.reparacion} en reparación</span>}
      {e.porLlegar > 0 && <span className="inv-ub ub-lle">{e.porLlegar} por llegar</span>}
    </>
  )
}

function FilaTabla({ p, sel, click, car }: { p: Fila; sel: boolean; click: (id: string) => void; car: Carrito | null }) {
  const n = car?.cant(p.id) ?? 0
  const act = !inactivo(p)
  const stockNum = Number(p.stock) || 0
  const ivaTxt = p.aplica_iva === false ? 'IVA 0%' : '+ IVA'
  const marco = marcoEst(useContext(EstCtx).est[p.id])
  return (
    <div onClick={() => click(p.id)} className={'inv-tr ' + (n ? 'is-added ' : '') + (sel ? 'is-sel ' : '') + marco} style={act ? undefined : { opacity: 0.55 }}>
      <div className="inv-td-img">{p.imagen_url ? <img loading="lazy" decoding="async" src={imagen(p.imagen_url, 120)}onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} alt="" /> : <img alt="" style={{ visibility: 'hidden' }} />}</div>
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
      <div className="inv-lg flex-col items-start gap-0.5"><span className={'inv-pill ' + (stockNum > 0 ? 'ok' : 'no')}>{p.stock ?? '—'}</span><TablaEst id={p.id} /></div>
      <div className="inv-lg inv-xl min-w-0"><span className="block w-full text-[11px] font-semibold text-slate-600 truncate">{p.marca || '—'}</span></div>
      <div className="inv-lg flex-col items-start leading-tight"><b className="text-xs" style={{ color: 'var(--primary)' }}>{dinero(p.pvp)}</b><small className="text-[9px] text-slate-400 font-semibold">{ivaTxt}</small></div>
      <div className="inv-cot-col">
        {car && (
          <button type="button" className="inv-mini-cot" onClick={(e) => { e.stopPropagation(); car.agregar(p, e.currentTarget) }} title="Agregar a la cotización">
            <span className="when-add"><ShoppingCart /><span className="inv-cot-lbl">Cotizar</span></span>
            <span className="when-added"><Check /><span className="inv-cot-n">{n > 1 ? '×' + n : 'Agregado'}</span></span>
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------- Panel de detalle (lateral en PC, cajón en pantallas chicas) ---------- */
function Panel({ p, editar, abrirEditar, car }: { p: Fila; editar: boolean; abrirEditar: (id: string) => void; car: Carrito | null }) {
  const nCot = car?.cant(p.id) ?? 0
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
        {p.imagen_url && <img src={imagen(p.imagen_url, 800)} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} alt={p.nombre} onClick={() => window.open(imagen(p.imagen_url, 1600), '_blank')} title="Ver imagen en grande" />}
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
        {car && <button type="button" className={'inv-act inv-act-cot' + (nCot ? ' is-added' : '')} onClick={(e) => car.agregar(p, e.currentTarget)}><span className="ic" style={{ ['--c' as string]: '#04896f' }}>{nCot ? <Check /> : <ShoppingCart />}</span>{nCot ? 'Agregado' + (nCot > 1 ? ' ×' + nCot : '') : 'Cotizar'}</button>}
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
        <ImpLista id={p.id} />
        <div className="bg-white border border-slate-200 rounded-2xl p-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Descripción</p>
          <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{descripcion === null ? 'Cargando…' : descripcion || '—'}</p>
        </div>
      </div>
    </>
  )
}

/* ---------- Pantalla principal ---------- */
export default function Inventario({ perfil }: { perfil: Perfil; volver?: () => void }) {
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
  const [carrito, setCarrito] = useState<Linea[]>(() => { try { return JSON.parse(sessionStorage.getItem(CLAVE_CARRITO) || '[]') } catch { return [] } })
  const [drawer, setDrawer] = useState(false)
  const [estadoCot, setEstadoCot] = useState('')
  const [est, setEst] = useState<Record<string, Est>>(() => { try { return JSON.parse(localStorage.getItem('vimedic_inv_estado') || 'null')?.productos ?? {} } catch { return {} } })
  const [imps, setImps] = useState<ImpResumen[]>(() => { try { return JSON.parse(localStorage.getItem('vimedic_inv_estado') || 'null')?.importaciones ?? [] } catch { return [] } })
  const [impFiltro, setImpFiltro] = useState('')
  const [reordenando, setReordenando] = useState(false)
  const [guardandoOrden, setGuardandoOrden] = useState(false)
  const [papelera, setPapelera] = useState(false)
  const reordRef = useRef(false)
  const arrastrando = useRef<string | null>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const conCrm = puede(perfil, 'crm', 'crear')
  useEffect(() => { try { sessionStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito)) } catch { /* sin almacenamiento */ } }, [carrito])
  useEffect(() => { document.body.classList.toggle('vm-cot-abierto', drawer); return () => document.body.classList.remove('vm-cot-abierto') }, [drawer])
  const peticion = useRef(0)
  const centinela = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<Fila[]>([])
  itemsRef.current = items

  const editar = puede(perfil, 'inventario', 'editar')
  const crear = puede(perfil, 'inventario', 'crear')

  const car: Carrito | null = conCrm ? {
    cant: (id) => carrito.find((x) => x.id === id)?.cantidad ?? 0,
    agregar: (p, el) => {
      setEstadoCot('')
      setCarrito((a) => {
        const i = a.findIndex((x) => x.id === p.id)
        if (i >= 0) return a.map((x, k) => (k === i ? { ...x, cantidad: Math.min(x.cantidad + 1, 9999) } : x))
        return [...a, { id: p.id, codigo: p.codigo, nombre: p.nombre, imagen: p.imagen_url ?? '', precio: Number(p.pvp) || 0, cantidad: 1, descuento: 0, iva: p.aplica_iva !== false, categoria: p.categoria?.nombre ?? '', ficha: p.ficha_tecnica_url ?? '', carpeta: p.drive_carpeta_url ?? '' }]
      })
      for (const b of [el, fabRef.current]) { if (!b) continue; const cls = b === fabRef.current ? 'bump' : 'pop'; b.classList.remove(cls); void b.offsetWidth; b.classList.add(cls); setTimeout(() => b.classList.remove(cls), 360) }
    },
  } : null
  const unidades = carrito.reduce((a, x) => a + x.cantidad, 0)
  const totales = carrito.reduce((t, x) => { const neto = x.precio * x.cantidad * (1 - x.descuento / 100); t.sub += neto; if (x.iva) t.iva += neto * 0.15; return t }, { sub: 0, iva: 0 })
  const cambiarCant = (id: string, d: number) => setCarrito((a) => a.flatMap((x) => (x.id !== id ? [x] : x.cantidad + d <= 0 ? [] : [{ ...x, cantidad: x.cantidad + d }])))

  async function completarCotizacion() {
    if (!carrito.length) return
    setEstadoCot('Preparando la cotización…')
    const { data } = await supabase.from('productos').select('id,descripcion').in('id', carrito.map((x) => x.id))
    const desc = new Map(((data as { id: string; descripcion: string | null }[]) ?? []).map((d) => [d.id, d.descripcion ?? '']))
    try { sessionStorage.setItem(CLAVE_PENDIENTE, JSON.stringify(carrito.map((x) => ({ ...x, descripcion: desc.get(x.id) ?? '', observacion: '' })))) } catch { setEstadoCot('No se pudo preparar la cotización en este navegador.'); return }
    setCarrito([]); setDrawer(false)
    window.location.hash = 'crm'
  }

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

  const cargarCategorias = useCallback(() => {
    supabase.from('categorias').select('id,nombre').eq('activo', true).is('deleted_at', null).order('nombre')
      .then(({ data }) => setCategorias((data as Categoria[]) ?? []))
  }, [])
  useEffect(() => { cargarCategorias() }, [cargarCategorias])

  const cargarEstado = useCallback(() => {
    supabase.rpc('inv_estado_stock').then(({ data }) => {
      const r = data as { productos?: Record<string, Est>; importaciones?: ImpResumen[] } | null
      if (!r) return
      setEst(r.productos ?? {}); setImps(r.importaciones ?? [])
      try { localStorage.setItem('vimedic_inv_estado', JSON.stringify(r)) } catch { /* sin almacenamiento */ }
    })
  }, [])
  useEffect(() => { const t = setTimeout(cargarEstado, 300); return () => clearTimeout(t) }, [cargarEstado])
  const impSel = impFiltro ? imps.find((i) => i.codigo === impFiltro) ?? null : null
  const idsImp = useMemo(() => (impSel ? Object.keys(impSel.productos) : null), [impSel])

  const consulta = useCallback(() => {
    let q = supabase.from('productos').select(COLUMNAS, { count: 'exact' }).is('deleted_at', null)
    if (idsImp) q = q.in('id', idsImp.length ? idsImp : ['00000000-0000-0000-0000-000000000000'])
    // Cada palabra debe aparecer en alguno de los campos (igual que la búsqueda de la app original).
    for (const palabra of busqueda.split(/\s+/).filter(Boolean)) {
      q = q.or(`nombre.ilike.%${palabra}%,codigo.ilike.%${palabra}%,codigo_unico.ilike.%${palabra}%,marca.ilike.%${palabra}%`)
    }
    if (categoria) q = q.eq('categoria_id', categoria)
    if (!mostrarInactivos) q = q.or('estado.is.null,estado.not.ilike.inactivo')
    if (orden) q = q.order(CAMPO_BD[orden.campo], { ascending: orden.dir === 'asc', nullsFirst: false })
    else q = q.order('en_vista_publica', { ascending: false }).order('orden', { ascending: true, nullsFirst: false })
    return q.order('nombre', { ascending: true })
  }, [busqueda, categoria, mostrarInactivos, orden, idsImp])

  // Carga desde cero cuando cambia la búsqueda, el filtro o el orden.
  const cargar = useCallback(async (hasta = LOTE) => {
    if (reordRef.current) return
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
    if (reordRef.current || cargando || cargandoMas || itemsRef.current.length >= total) return
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
  const hayFiltros = !!categoria || !!orden || !!impFiltro

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

  function restablecer() { setTexto(''); setCategoria(''); setOrden(null); setMostrarInactivos(false); setImpFiltro('') }

  /** Muestra todos los productos de una importación (o quita el filtro). */
  function filtrarImp(codigo: string, desdeDetalle?: boolean) {
    setImpFiltro((a) => (a === codigo && !desdeDetalle ? '' : codigo))
    if (desdeDetalle) { setCajon(null); setTexto(''); setCategoria('') }
    setMenu(null); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function alternarEstado(p: Fila) {
    const nuevo = inactivo(p) ? 'Activo' : 'Inactivo'
    setItems((a) => a.map((x) => (x.id === p.id ? { ...x, estado: nuevo } : x)))
    const { error } = await supabase.from('productos').update({ estado: nuevo }).eq('id', p.id)
    if (error) { alert('No se pudo cambiar el estado: ' + error.message); cargar(Math.max(LOTE, itemsRef.current.length)) }
  }

  /* Reordenar: trae todos los productos del catálogo, agrupados por categoría, y se arrastran las tarjetas. */
  async function iniciarOrden() {
    setVista('tarjetas'); setMenu(null); setCargando(true)
    reordRef.current = true; peticion.current++
    let q = supabase.from('productos').select(COLUMNAS).is('deleted_at', null)
    if (!mostrarInactivos) q = q.or('estado.is.null,estado.not.ilike.inactivo')
    const { data, error } = await q.order('en_vista_publica', { ascending: false }).order('orden', { ascending: true, nullsFirst: false }).order('nombre').limit(3000)
    setCargando(false)
    if (error) { reordRef.current = false; alert('No se pudo cargar el catálogo: ' + error.message); return }
    const lista = ((data as unknown as Fila[]) ?? []).slice().sort((a, b) => (a.categoria?.nombre ?? '').localeCompare(b.categoria?.nombre ?? '', 'es'))
    setTexto(''); setCategoria(''); setOrden(null); setImpFiltro('')
    setItems(lista); setTotal(lista.length); setReordenando(true)
    window.scrollTo({ top: 0 })
  }
  function cancelarOrden() { reordRef.current = false; setReordenando(false); cargar() }
  function soltar(destino: string) {
    const origen = arrastrando.current; arrastrando.current = null
    if (!origen || origen === destino) return
    setItems((a) => {
      const i = a.findIndex((x) => x.id === origen), j = a.findIndex((x) => x.id === destino)
      if (i < 0 || j < 0) return a
      const c = a.slice(); const [m] = c.splice(i, 1); c.splice(j, 0, m); return c
    })
  }
  async function guardarOrden() {
    setGuardandoOrden(true)
    const { error } = await supabase.rpc('inv_guardar_orden', { p_ids: items.map((x) => x.id) })
    setGuardandoOrden(false)
    if (error) { alert('No se pudo guardar el orden: ' + error.message); return }
    reordRef.current = false; setReordenando(false); cargar()
  }

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
    <EstCtx.Provider value={{ est, verImp: (c) => filtrarImp(c, true) }}>
    <div className="min-h-screen antialiased" style={{ background: 'var(--bg)' }}>
      <header className="sticky top-0 z-30 border-b border-slate-200" style={{ background: 'linear-gradient(135deg, var(--navy), var(--primary))' }}>
        {/* Barra superior compacta: TODO en una sola línea */}
        <div className="inv-head relative px-3 sm:px-5 py-2 min-h-14 flex items-center gap-2 flex-nowrap overflow-visible">
          <div className="hidden sm:flex min-w-0 shrink-0 max-w-[200px] lg:max-w-[240px] lg:mr-1 flex-col justify-center min-h-10">
            <h1 className="font-display font-bold text-white text-[15px] sm:text-base leading-tight whitespace-nowrap truncate">Inventario Vimedic</h1>
          </div>

          <div className="flex items-center gap-2 min-w-0 flex-1 lg:flex-none">
            <div className="relative flex-1 min-w-0 lg:flex-none">
              <input type="text" value={texto} disabled={reordenando} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por código, nombre, marca o categoría…"
                className="w-full lg:w-64 xl:w-80 pl-8 pr-3 py-2 rounded-lg bg-white/10 text-white placeholder:text-white/55 text-xs focus:outline-none focus:ring-2 focus:ring-white/40" />
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/60" />
            </div>

            <div className="relative shrink-0" data-menu>
              <button type="button" onClick={(e) => abrirMenu(e, 'filtros')} className={'w-9 h-9 rounded-lg hover:bg-white/20 text-white flex items-center justify-center transition-colors ' + (hayFiltros ? 'bg-white/30' : 'bg-white/10')} title="Filtros y orden"><SlidersHorizontal className="w-4 h-4" /></button>
              {menu === 'filtros' && (
                <div data-menu className="fixed z-[90] w-[300px] max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden" style={{ left: pos.left, top: pos.top }}>
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <div><p className="text-xs font-bold text-slate-800">Filtros</p><p className="text-[10px] text-slate-400 mt-0.5">Categoría, importación y orden</p></div>
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
                    <p className="px-4 pt-1 pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">Importación</p>
                    <div className="max-h-56 overflow-y-auto">
                      {!imps.length && <p className="px-4 pb-2 text-[11px] text-slate-400">No hay importaciones en curso ni recientes.</p>}
                      {imps.map((i) => {
                        const n = Object.keys(i.productos).length + (i.nuevos || 0), on = i.codigo === impFiltro
                        const f = i.etapa === 'Ingresado' ? (i.llegada ? 'llegó ' + fechaC(i.llegada).slice(0, 5) : 'ingresada') : (i.eta ? 'llega ' + fechaC(i.eta).slice(0, 5) : 'sin fecha')
                        return (
                          <button key={i.codigo} type="button" className="inv-impm" onClick={() => filtrarImp(i.codigo)} style={on ? { background: '#eff6ff' } : undefined}>
                            <span className={'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ' + (on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600')}><Ship className="w-4 h-4" /></span>
                            <span className="min-w-0 flex-1"><b className="block text-xs text-slate-700 truncate">{i.nombre || i.codigo}</b><small className="block text-[10px] text-slate-400 truncate">{i.codigo} · {i.etapa === 'Ingresado' ? 'Ingresada' : i.etapa} · {f} · {n} producto{n === 1 ? '' : 's'}</small></span>
                            {on && <Check className="w-4 h-4 text-blue-600" />}
                          </button>
                        )
                      })}
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
            <span className="hidden md:inline-block shrink-0 whitespace-nowrap text-[11px] font-semibold text-white/75 bg-white/10 rounded-lg px-2.5 py-2" title="Productos encontrados"><b className="text-white">{total}</b> productos</span>
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-auto">
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
            {puede(perfil, 'inventario', 'eliminar') && <button onClick={() => setPapelera(true)} className="flex w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white items-center justify-center transition-colors" title="Papelera (productos eliminados)"><Trash2 className="w-4 h-4" /></button>}
            {editar && (
              <button onClick={() => setMostrarInactivos((v) => !v)} className={'flex w-9 h-9 rounded-lg hover:bg-white/20 text-white items-center justify-center transition-colors ' + (mostrarInactivos ? 'bg-white/30' : 'bg-white/10')} title="Mostrar productos inactivos"><EyeOff className="w-4 h-4" /></button>
            )}
            {editar && <button onClick={iniciarOrden} disabled={reordenando} className="flex w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white items-center justify-center transition-colors" title="Reordenar productos"><Move className="w-4 h-4" /></button>}
            <button onClick={() => { cargarEstado(); cargar(Math.max(LOTE, items.length)) }} className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors" title="Actualizar inventario"><RefreshCw className={'w-4 h-4 ' + (cargando ? 'animate-spin' : '')} /></button>
          </div>
        </div>
      </header>

      {reordenando && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2 flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] font-semibold text-amber-800">🔀 Modo reordenar: arrastra las tarjetas para cambiar su posición en el catálogo público.</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={cancelarOrden} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600">Cancelar</button>
            <button type="button" onClick={guardarOrden} disabled={guardandoOrden} className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: 'var(--amber, #c98a1f)' }}>{guardandoOrden ? 'Guardando...' : 'Guardar Orden'}</button>
          </div>
        </div>
      )}

      <main className="w-full px-4 sm:px-6 py-5">
        {impSel && (
          <div className="mb-3 inv-impf">
            <span className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0"><Ship className="w-4 h-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-slate-800 truncate">{impSel.nombre || impSel.codigo}</p>
              <p className="text-[11.5px] text-slate-500">
                <b className="cod">{impSel.codigo}</b> · <span className={'et' + (impSel.etapa === 'Ingresado' ? ' ok' : '')}>{impSel.etapa === 'Ingresado' ? 'Ingresada' : impSel.etapa}</span> · {impSel.etapa === 'Ingresado' ? (impSel.llegada ? 'Llegó el ' + fechaC(impSel.llegada) : 'Ya ingresó al inventario') : (impSel.eta ? 'Llegada aproximada ' + fechaC(impSel.eta) : 'Fecha por confirmar')} ·{' '}
                <b className="text-slate-700">{Object.keys(impSel.productos).length} producto{Object.keys(impSel.productos).length === 1 ? '' : 's'}, {Object.values(impSel.productos).reduce((a, x) => a + (Number(x) || 0), 0)} unidades</b>
                {impSel.nuevos ? <span className="text-amber-700 font-semibold"> · +{impSel.nuevos} equipo{impSel.nuevos === 1 ? '' : 's'} nuevo{impSel.nuevos === 1 ? '' : 's'} aún sin código</span> : null}
              </p>
            </div>
            <button type="button" onClick={() => setImpFiltro('')} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 flex items-center gap-1"><X className="w-3.5 h-3.5" />Quitar filtro</button>
          </div>
        )}
        {error &&<div className="mb-3 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}

        {cargando && items.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 gap-2 text-slate-400">
            <span className="inline-block w-5 h-5 rounded-full border-2 border-slate-300 border-t-[color:var(--primary)] animate-spin" />
            <p className="text-xs font-semibold">Cargando Inventario...</p>
          </div>
        )}

        {vista === 'tarjetas' && items.length > 0 && (
          <div className="inv-grid">
            {items.map((p) => <Tarjeta key={p.id} p={p} abrir={clickProducto} car={car} alternar={editar ? alternarEstado : undefined} reordenar={reordenando ? { arrastrar: (id) => { arrastrando.current = id }, soltar } : undefined} />)}
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
              <div>{items.map((p) => <FilaTabla key={p.id} p={p} sel={esPc && selId === p.id} click={clickProducto} car={car} />)}</div>
            </div>
            <aside className="inv-side">
              {seleccionado
                ? <Panel p={seleccionado} editar={editar} abrirEditar={(id) => setForm(id)} car={car} />
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

      {/* Ficha completa del producto (igual que la app original) */}
      {enCajon && (
        <DetalleProducto
          p={enCajon}
          editar={editar}
          eliminar={puede(perfil, 'inventario', 'eliminar')}
          car={car}
          cerrar={() => setCajon(null)}
          abrirEditar={(id) => { setCajon(null); setForm(id) }}
          eliminado={() => { setCajon(null); cargar(Math.max(LOTE, items.length)) }}
        />
      )}

      {conCrm && !cajon && !form && (
        <button ref={fabRef} type="button" className="vq-fab" onClick={() => { setEstadoCot(''); setDrawer(true) }} title="Cotizador" aria-label="Abrir cotizador">
          <ShoppingCart className="w-6 h-6" />
          {unidades > 0 && <span className="vq-fab-count">{unidades}</span>}
        </button>
      )}
      {conCrm && (
        <div className={'vq-overlay' + (drawer ? ' open' : '')} aria-hidden={!drawer} onClick={(e) => { if (e.target === e.currentTarget) setDrawer(false) }}>
          <aside className="vq-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="vq-drawer-head">
              <div className="vq-drawer-title">
                <ShoppingCart className="w-5 h-5 shrink-0" />
                <div className="min-w-0"><h2>Cotizador</h2><p>Productos seleccionados</p></div>
                <span className="vq-badge">{unidades}</span>
              </div>
              <button type="button" className="vq-close" onClick={() => setDrawer(false)} aria-label="Cerrar cotizador"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-4 pt-2 text-[10px] font-semibold text-red-600" role="status">{estadoCot}</div>
            <div className="vq-items">
              {!carrito.length ? (
                <div className="vq-empty"><ClipboardList className="w-9 h-9 text-slate-300" /><p>No has agregado equipos a la cotización.</p><p className="mt-1 text-[10px]">Pulsa «Cotizar» en cualquier producto para agregarlo.</p></div>
              ) : carrito.map((x) => (
                <div key={x.id} className="vq-cart-row">
                  {x.imagen ? <img loading="lazy" decoding="async" src={imagen(x.imagen, 160)} alt={x.nombre} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <div className="w-[52px] h-[52px] rounded-[10px] border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300"><ImagePlus className="w-5 h-5" /></div>}
                  <div className="vq-cart-main">
                    <b title={x.nombre}>{x.nombre}</b>
                    <small>{x.codigo}{x.categoria ? ' · ' + x.categoria : ''}</small>
                    <div className="vq-cart-price">{'$'}{x.precio.toFixed(2)} {x.iva ? '+ IVA' : '· IVA 0%'}</div>
                    <div className="vq-qty"><button type="button" onClick={() => cambiarCant(x.id, -1)}>−</button><span>{x.cantidad}</span><button type="button" onClick={() => cambiarCant(x.id, 1)}>+</button></div>
                  </div>
                  <button type="button" className="vq-remove" onClick={() => setCarrito((a) => a.filter((y) => y.id !== x.id))} title="Quitar">×</button>
                </div>
              ))}
            </div>
            <div className="vq-footer">
              <div className="vq-totals">
                <div className="vq-total-line"><span>Subtotal</span><strong>{'$'}{totales.sub.toFixed(2)}</strong></div>
                <div className="vq-total-line"><span>IVA</span><strong>{'$'}{totales.iva.toFixed(2)}</strong></div>
                <div className="vq-total-line grand"><span>Total</span><strong>{'$'}{(totales.sub + totales.iva).toFixed(2)}</strong></div>
              </div>
              <p className="vq-note">Revisa los productos y cantidades. Al completar la cotización se abrirá el formulario del CRM con esta lista ya cargada.</p>
              <div className="vq-footer-actions">
                <button type="button" className="vq-btn vq-btn-secondary" onClick={() => setDrawer(false)}><PlusCircle className="w-4 h-4" /> Seguir agregando productos</button>
                <button type="button" className="vq-btn vq-btn-primary" disabled={!carrito.length} onClick={completarCotizacion}><ArrowRight className="w-4 h-4" /> Completar cotización</button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {form && (
        <FormularioProducto
          id={form}
          categorias={categorias}
          cerrar={() => setForm(null)}
          guardado={() => { setForm(null); cargarCategorias(); cargar(Math.max(LOTE, items.length)) }}
        />
      )}
      {papelera && <PapeleraProductos cerrar={() => setPapelera(false)} restaurado={() => cargar(Math.max(LOTE, items.length))} />}
    </div>
    </EstCtx.Provider>
  )
}

/* ---------- Papelera: productos eliminados (borrado lógico), se pueden devolver ---------- */
function PapeleraProductos({ cerrar, restaurado }: { cerrar: () => void; restaurado: () => void }) {
  const [lista, setLista] = useState<{ id: string; codigo: string; nombre: string; deleted_at: string }[] | null>(null)
  const [error, setError] = useState('')
  const cargarLista = useCallback(() => {
    supabase.from('productos').select('id,codigo,nombre,deleted_at').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) setError(error.message); else setLista((data as { id: string; codigo: string; nombre: string; deleted_at: string }[]) ?? []) })
  }, [])
  useEffect(() => { cargarLista() }, [cargarLista])
  async function restaurar(id: string) {
    const { error } = await supabase.from('productos').update({ deleted_at: null }).eq('id', id)
    if (error) { alert('No se pudo restaurar: ' + error.message); return }
    setLista((a) => (a ?? []).filter((x) => x.id !== id)); restaurado()
  }
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[86vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex-1 min-w-0"><b className="block text-base text-slate-800">Papelera · Inventario</b><small className="text-xs text-slate-500">Lo eliminado no se borra de la base: aquí puedes devolverlo.</small></div>
          <button type="button" onClick={cerrar} className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center" aria-label="Cerrar"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto px-4 py-2">
          {error && <p className="text-xs text-red-600 py-3">{error}</p>}
          {!lista && !error && <p className="text-xs text-slate-400 py-6 text-center">Cargando…</p>}
          {lista && !lista.length && <p className="text-xs text-slate-400 py-6 text-center">La papelera está vacía.</p>}
          {lista?.map((x) => (
            <div key={x.id} className="flex items-center gap-3 py-2.5 border-b border-dashed border-slate-200 last:border-0">
              <div className="min-w-0 flex-1"><p className="text-xs font-bold text-slate-800 truncate">{x.nombre}</p><p className="text-[11px] text-slate-500">{x.codigo} · eliminado {new Date(x.deleted_at).toLocaleDateString('es-EC')}</p></div>
              <button type="button" onClick={() => restaurar(x.id)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" />Restaurar</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------- Ficha completa del producto (copia de #detailOverlay de Inventario.html) ---------- */
type InfoExtra = { descripcion: string | null; caracteristicas: string | null; especificaciones: string | null; accesorios: string | null; certificaciones: string | null }
type GaleriaItem = { tipo: 'imagen' | 'video'; archivo_url: string; descripcion: string | null }

function urlVideoEmbed(url: string): string | null {
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,})/)
  if (yt) return 'https://www.youtube.com/embed/' + yt[1]
  const vm = url.match(/vimeo\.com\/(\d+)/)
  if (vm) return 'https://player.vimeo.com/video/' + vm[1]
  return null
}

function DetalleProducto({ p, editar, eliminar, cerrar, abrirEditar, eliminado, car }: {
  p: Fila; editar: boolean; eliminar: boolean; cerrar: () => void; abrirEditar: (id: string) => void; eliminado: () => void; car: Carrito | null
}) {
  const nCot = car?.cant(p.id) ?? 0
  const [info, setInfo] = useState<InfoExtra | null>(null)
  const [galeria, setGaleria] = useState<GaleriaItem[]>([])
  const [verDis, setVerDis] = useState(false)
  const [imgSel, setImgSel] = useState(0)
  const descripcion = info?.descripcion ?? null
  useEffect(() => {
    setImgSel(0)
    Promise.all([
      supabase.from('productos').select('descripcion,caracteristicas,especificaciones,accesorios,certificaciones').eq('id', p.id).single(),
      supabase.from('producto_galeria').select('tipo,archivo_url,descripcion').eq('producto_id', p.id).is('deleted_at', null).order('orden'),
    ]).then(([prod, gal]) => {
      setInfo((prod.data as InfoExtra | null) ?? { descripcion: '', caracteristicas: null, especificaciones: null, accesorios: null, certificaciones: null })
      setGaleria((gal.data as GaleriaItem[]) ?? [])
    })
  }, [p.id])
  const media = useMemo(() => {
    const m: GaleriaItem[] = p.imagen_url ? [{ tipo: 'imagen', archivo_url: p.imagen_url, descripcion: null }] : []
    return m.concat(galeria)
  }, [p.imagen_url, galeria])
  const actual = media[imgSel] ?? null
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    document.addEventListener('keydown', f)
    return () => document.removeEventListener('keydown', f)
  }, [cerrar])

  const pvp = Number(p.pvp) || 0
  const conIva = p.aplica_iva !== false
  const dis = Number(p.precio_dis) || 0
  const pct = pvp > 0 && dis > 0 && dis < pvp ? Math.round((1 - dis / pvp) * 10000) / 100 : 0
  const stockN = Number(p.stock) || 0

  async function eliminarProducto() {
    if (!confirm(`¿Eliminar "${p.nombre || p.codigo}"?\n\nDesaparece de Inventario. Su stock y movimientos se conservan y se puede restaurar.`)) return
    // Borrado lógico: nunca DELETE.
    const { error } = await supabase.from('productos').update({ deleted_at: new Date().toISOString() }).eq('id', p.id)
    if (error) alert('No se pudo eliminar: ' + error.message); else eliminado()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[60] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-[#f6f9fc] sm:rounded-3xl shadow-2xl w-full h-full sm:h-auto sm:max-w-6xl sm:max-h-[92vh] flex flex-col overflow-hidden">
        {/* Encabezado */}
        <div className="inv-dhead shrink-0 px-5 pt-4 pb-4 text-white" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><Package className="w-4 h-4" /></span>
              <p className="text-[11px] font-mono-spec text-white/75 truncate">{p.codigo}{p.codigo_unico ? ' - ' + p.codigo_unico : ''}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={cerrar} className="w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors" title="Cerrar"><X className="w-4 h-4" /></button>
            </div>
          </div>
          <h2 className="font-display font-bold text-lg sm:text-xl leading-snug mt-2">{p.nombre}</h2>
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <span className="inv-chip" style={{ background: 'rgba(255,255,255,.14)', borderColor: 'rgba(255,255,255,.2)', color: '#fff' }}><Tag /><span>{p.categoria?.nombre || '—'}</span></span>
            <span className="inv-chip" style={stockN > 0 ? { background: '#e7f6f2', borderColor: '#bfe6da', color: '#04896f' } : { background: '#fdecea', borderColor: '#f5c6c0', color: '#c0392b' }}>
              {stockN > 0 ? 'Stock: ' + stockN : stockN < 0 ? `Stock: ${stockN} (facturado sin stock)` : 'Sin stock'}
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-y-auto sm:overflow-hidden">
          {/* IZQUIERDA — galería del producto (igual que en la vista pública) */}
          <div className="contents sm:flex sm:w-[400px] shrink-0 flex-col sm:overflow-y-auto sm:border-r border-slate-200/70">
            <div className="order-1 sm:order-none p-4 pb-0 shrink-0">
              <div className="bg-white rounded-2xl border border-slate-200 p-2 shadow-sm max-w-[320px] mx-auto sm:max-w-none">
                <div className="relative">
                  {actual && actual.tipo === 'video'
                    ? (urlVideoEmbed(actual.archivo_url)
                        ? <iframe src={urlVideoEmbed(actual.archivo_url)!} className="w-full aspect-square rounded-xl bg-black" allow="autoplay; fullscreen; picture-in-picture" title="Video del producto" />
                        : <video src={actual.archivo_url} controls className="w-full aspect-square rounded-xl bg-black object-contain" />)
                    : actual
                      ? <img decoding="async" src={imagen(actual.archivo_url, 800)} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} className="w-full aspect-square object-contain p-2 rounded-xl bg-white" alt="" />
                      : <div className="w-full aspect-square rounded-xl bg-white" />}
                  {actual && actual.tipo === 'imagen' && (
                    <div className="inv-hero-tools">
                      <a href={imagen(actual.archivo_url, 1600)} target="_blank" rel="noopener noreferrer" title="Descargar imagen"><Download /></a>
                    </div>
                  )}
                </div>
                {actual?.descripcion && <p className="text-[10px] text-slate-500 mt-1.5 px-1 leading-snug">{actual.descripcion}</p>}
              </div>
              {media.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto mt-2.5 pb-1 max-w-[320px] mx-auto sm:max-w-none">
                  {media.map((m, i) => (
                    <button key={i} type="button" onClick={() => setImgSel(i)}
                      className="shrink-0 w-14 h-14 rounded-lg border-2 overflow-hidden bg-white grid place-items-center"
                      style={{ borderColor: i === imgSel ? 'var(--primary)' : '#e2e8f0' }}>
                      {m.tipo === 'video'
                        ? <span className="text-slate-400"><Video className="w-4 h-4" /></span>
                        : <img decoding="async" loading="lazy" src={imagen(m.archivo_url, 120)} className="w-full h-full object-cover" alt="" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* DERECHA — detalles */}
          <div className="order-2 sm:order-none flex-1 p-4 sm:p-5 sm:overflow-y-auto space-y-4">
            {p.reservaciones && (
              <div className="flex items-start gap-2 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" /><span>{p.reservaciones}</span>
              </div>
            )}

            {/* Precio + DIS oculto */}
            <div className="inv-price">
              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 items-stretch">
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Precio PVP</p>
                  <p className="font-display font-bold text-2xl leading-tight" style={{ color: 'var(--primary)' }}><span>${pvp.toFixed(2)}</span> <span className="text-[11px] font-semibold text-slate-500">{conIva ? '+ IVA' : 'IVA 0%'}</span></p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{conIva ? '$' + (pvp * 1.15).toFixed(2) + ' IVA incluido' : 'No aplica IVA'}</p>
                </div>
                {dis > 0 && (
                  <div className={'inv-dis' + (verDis ? ' show' : '')}>
                    <div className="inv-dis-val" onClick={() => setVerDis(false)} title="Ocultar precio DIS">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Precio DIS</p>
                      <p className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-display font-bold text-xl" style={{ color: 'var(--teal)' }}>${dis.toFixed(2)}</span>
                        {pct > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#7c3aed1A', color: '#7c3aed' }}>DIS:{String(pct).replace('.', ',')}%</span>}
                      </p>
                    </div>
                    <button type="button" className="inv-dis-cover" onClick={() => setVerDis(true)}><Eye /> Mostrar DIS</button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="inv-stat"><small>Stock</small><b style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}><UbicStock p={p} grande /></b></div>
            </div>
            <ImpLista id={p.id} />

            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Descripción</p>
              <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{descripcion === null ? 'Cargando…' : descripcion || '—'}</p>
            </div>

            {([
              ['Especificaciones', info?.especificaciones],
              ['Características', info?.caracteristicas],
              ['Accesorios', info?.accesorios],
              ['Certificaciones', info?.certificaciones],
            ] as [string, string | null | undefined][]).filter(([, v]) => v && v.trim()).map(([t, v]) => (
              <div key={t} className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{t}</p>
                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{v}</p>
              </div>
            ))}

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex flex-col gap-2">
                {p.ficha_tecnica_url && (
                  <a href={p.ficha_tecnica_url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold px-3 py-2 rounded-xl border bg-white flex items-center gap-1.5" style={{ borderColor: '#cfe0ef', color: 'var(--primary)' }}>
                    <FileText className="w-3.5 h-3.5" /> Ficha Técnica
                  </a>
                )}
                {p.drive_carpeta_url && (
                  <a href={p.drive_carpeta_url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold px-3 py-2 rounded-xl border bg-white flex items-center gap-1.5" style={{ borderColor: '#cdebe4', color: 'var(--teal)' }}>
                    <Images className="w-3.5 h-3.5" /> Multimedia
                  </a>
                )}
              </div>
              {editar && (
                <button type="button" onClick={() => abrirEditar(p.id)} className="text-[11px] font-bold px-3 py-2 rounded-xl border bg-white flex items-center gap-1.5" style={{ borderColor: '#f1dfbf', color: '#a86d10' }}>
                  <Pencil className="w-3.5 h-3.5" /> Editar producto
                </button>
              )}
              {eliminar && (
                <button type="button" onClick={eliminarProducto} className="text-[11px] font-bold px-3 py-2 rounded-xl border flex items-center gap-1.5" style={{ borderColor: '#fecaca', color: '#b91c1c', background: '#fff5f5' }}>
                  <Trash2 className="w-3.5 h-3.5" /> Eliminar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Acciones fijas abajo */}
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 flex items-center gap-2">
          <button onClick={(e) => copiar(p, 'pvp', e.currentTarget)} title="Copiar nombre y precio PVP" className="inv-cpy"><ClipboardCopy className="w-4 h-4" />PVP</button>
          {dis > 0 && <button onClick={(e) => copiar(p, 'dis', e.currentTarget)} title="Copiar nombre y precio DIS" className="inv-cpy dis"><ClipboardCopy className="w-4 h-4" />DIS</button>}
          {car && (
            <button type="button" className={'inv-dcot flex-1' + (nCot ? ' is-added' : '')} onClick={(e) => car.agregar(p, e.currentTarget)}>
              <span className="when-add inline-flex items-center gap-2"><ShoppingCart />Cotizar este producto</span>
              <span className="when-added"><CircleCheck />Agregado{nCot > 1 ? ' ×' + nCot : ''} · agregar otro</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- Editar / Agregar producto (copia de #productFormOverlay de Inventario.html) ---------- */
const MENORES = ['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'con', 'sin', 'para', 'por', 'en', 'a', 'al']
const SIGLAS = ['LED', 'DEA', 'UV', 'ECG', 'EKG', 'EEG', 'UCI', 'USB', 'LCD', 'PVC', 'ABS', 'SPO2', 'NIBP', 'HD', 'TV', 'PC', 'CPAP', 'BPAP', 'IV', 'AC', 'DC', 'RX', 'UPS', 'INOX', 'CE', 'ISO', 'PSI', 'LPM', 'ML', 'HLE']
// Al crear, el nombre queda en formato título (igual que la app original).
function nombreTitulo(txt: string): string {
  return String(txt || '').replace(/\s+/g, ' ').trim().split(' ').map((p, i) => {
    if (!p) return p
    const limpio = p.replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+|[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+$/g, '')
    if (/\d/.test(p)) return p.toUpperCase()
    if (SIGLAS.includes(limpio.toUpperCase())) return p.toUpperCase()
    if (limpio.length === 1 && /[A-Za-z]/.test(limpio) && i > 0 && !MENORES.includes(limpio.toLowerCase())) return p.toUpperCase()
    const low = p.toLowerCase()
    if (i > 0 && MENORES.includes(limpio.toLowerCase())) return low
    return low.replace(/(^|[-/(])([a-záéíóúüñ])/g, (_m, a, b) => a + b.toUpperCase())
  }).join(' ')
}

function Interruptor({ activo, cambiar }: { activo: boolean; cambiar: () => void }) {
  return (
    <button type="button" onClick={cambiar} className="relative w-11 h-6 rounded-full transition-colors shrink-0" style={{ background: activo ? 'var(--teal)' : '#cbd5e1' }}>
      <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform" style={{ transform: activo ? 'translateX(20px)' : 'translateX(0)' }} />
    </button>
  )
}

type Campos = {
  codigo: string; codigo_unico: string; nombre: string; marca: string; categoria: string; imagen_url: string
  descripcion: string; pvp: string; precio_dis: string; aplica_iva: boolean; reservaciones: string; en_catalogo: boolean
}

function Seccion({ n, t, children }: { n: number; t: string; children: React.ReactNode }) {
  return <section className="pf-sec"><header><span className="pf-num">{n}</span><h4>{t}</h4></header>{children}</section>
}

function FormularioProducto({ id, categorias, cerrar, guardado }: {
  perfil?: Perfil; id: string | 'nuevo'; categorias: Categoria[]; cerrar: () => void; guardado: () => void
}) {
  const nuevo = id === 'nuevo'
  const [f, setF] = useState<Campos | null>(nuevo ? {
    codigo: '', codigo_unico: '', nombre: '', marca: '', categoria: '', imagen_url: '', descripcion: '', pvp: '', precio_dis: '',
    aplica_iva: true, reservaciones: '', en_catalogo: false,
  } : null)
  const [marcas, setMarcas] = useState<string[]>([])
  const [imgError, setImgError] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (nuevo) return
    supabase.from('productos')
      .select('codigo,codigo_unico,nombre,marca,imagen_url,descripcion,pvp,precio_dis,aplica_iva,reservaciones,en_catalogo,categoria:categorias(nombre)')
      .eq('id', id).single()
      .then(({ data, error }) => {
        if (error || !data) { setError(error?.message || 'No se encontró el producto'); return }
        const d = data as unknown as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
        setF({
          codigo: d.codigo, codigo_unico: d.codigo_unico ?? '', nombre: d.nombre, marca: d.marca ?? '', categoria: d.categoria?.nombre ?? '',
          imagen_url: d.imagen_url ?? '', descripcion: d.descripcion ?? '', pvp: d.pvp == null ? '' : String(d.pvp),
          precio_dis: d.precio_dis == null ? '' : String(d.precio_dis), aplica_iva: d.aplica_iva !== false,
          reservaciones: d.reservaciones ?? '', en_catalogo: !!d.en_catalogo,
        })
      })
  }, [id, nuevo])

  // Sugerencias de marca con lo que ya existe en el inventario.
  useEffect(() => {
    supabase.from('productos').select('marca').not('marca', 'is', null).is('deleted_at', null).limit(3000)
      .then(({ data }) => setMarcas([...new Set(((data as { marca: string }[]) ?? []).map((x) => x.marca.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))))
  }, [])

  function set<K extends keyof Campos>(k: K, v: Campos[K]) { setF((x) => (x ? { ...x, [k]: v } : x)); if (k === 'imagen_url') setImgError(false) }

  async function guardar() {
    if (!f) return
    const nombre = nuevo ? nombreTitulo(f.nombre) : f.nombre.trim()
    if (!nombre) { setError('El nombre es obligatorio.'); return }
    if (nuevo && !f.codigo.trim()) { setError('El ID del producto es obligatorio.'); return }
    setGuardando(true); setError('')

    // La categoría se escribe como texto: si no existe, se crea.
    let categoria_id: string | null = null
    const nomCat = f.categoria.trim()
    if (nomCat) {
      const existente = categorias.find((c) => c.nombre.toLowerCase() === nomCat.toLowerCase())
      if (existente) categoria_id = existente.id
      else {
        const nueva = crypto.randomUUID()
        const { error } = await supabase.from('categorias').insert({ id: nueva, nombre: nomCat })
        if (error) { setError('No se pudo crear la categoría: ' + error.message); setGuardando(false); return }
        categoria_id = nueva
      }
    }

    const datos = {
      nombre, categoria_id,
      descripcion: f.descripcion.trim() || null,
      pvp: Number(f.pvp) || 0,
      precio_dis: Number(f.precio_dis) || 0,
      reservaciones: f.reservaciones.trim() || null,
      codigo_unico: f.codigo_unico.trim() || null,
      marca: f.marca.trim() || null,
      aplica_iva: f.aplica_iva,
      en_catalogo: f.en_catalogo,
      imagen_url: f.imagen_url.trim() || null,
    }
    const { error } = nuevo
      ? await supabase.from('productos').insert({ id: crypto.randomUUID(), codigo: f.codigo.trim(), ...datos })
      : await supabase.from('productos').update(datos).eq('id', id)
    setGuardando(false)
    if (error) setError(error.code === '23505' ? 'Ya existe un producto con ese ID.' : error.message)
    else guardado()
  }

  return (
    <div style={{ zIndex: 130 }} className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="pf-shell w-full h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:max-w-2xl flex flex-col overflow-hidden sm:rounded-3xl shadow-2xl">
        <div className="pf-head px-5 pt-4 pb-3 text-white shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl grid place-items-center bg-white/15 shrink-0"><PackagePlus className="w-5 h-5" /></span>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-base leading-tight">{nuevo ? 'Agregar Producto' : 'Editar Producto'}</h3>
              <p className="text-[11px] text-white/70">Los campos con * son obligatorios. Stock y estado se manejan con ingresos y ventas.</p>
            </div>
            <button type="button" onClick={cerrar} className="pf-x" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {!f ? <div style={{ padding: 24 }} className="flex-1 text-xs text-slate-400">{error || 'Cargando…'}</div> : (
          <>
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3 bg-slate-50">
              <Seccion n={1} t="Identificación">
                <div className="pf-grid">
                  {nuevo && <label className="pf-f"><span>ID del producto *</span>
                    <input type="text" placeholder="Ej. EQM1234" autoComplete="off" className="pf-in" value={f.codigo} onChange={(e) => set('codigo', e.target.value)} /></label>}
                  <label className="pf-f"><span>Código interno</span>
                    <input type="text" placeholder="Ej. MDR-2026-001" autoComplete="off" className="pf-in" value={f.codigo_unico} onChange={(e) => set('codigo_unico', e.target.value)} /></label>
                  <label className="pf-f pf-full"><span>Nombre del producto *</span>
                    <input type="text" placeholder={'Ej. Monitor multiparámetros 8"'} className="pf-in" value={f.nombre}
                      onChange={(e) => set('nombre', e.target.value)} onBlur={() => { if (nuevo && f.nombre.trim()) set('nombre', nombreTitulo(f.nombre)) }} /></label>
                  <label className="pf-f"><span>Marca</span>
                    <input type="text" list="pfMarcaList" placeholder="Ej. Vimedic, Mindray…" autoComplete="off" className="pf-in" value={f.marca} onChange={(e) => set('marca', e.target.value)} /></label>
                  <label className="pf-f"><span>Categoría</span>
                    <input type="text" list="pfCategoriaList" placeholder="Ej. Monitoreo" autoComplete="off" className="pf-in" value={f.categoria} onChange={(e) => set('categoria', e.target.value)} /></label>
                  <datalist id="pfMarcaList">{marcas.map((m) => <option key={m} value={m} />)}</datalist>
                  <datalist id="pfCategoriaList">{categorias.map((c) => <option key={c.id} value={c.nombre} />)}</datalist>
                </div>
              </Seccion>

              <Seccion n={2} t="Imagen principal">
                <div className="pf-img">
                  <div className="pf-img-box">
                    {f.imagen_url && !imgError
                      ? <img src={imagen(f.imagen_url, 320)} alt="Imagen del producto" onError={() => setImgError(true)} />
                      : <span><ImagePlus className="w-7 h-7" />Sin imagen</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <input type="text" placeholder="Pega el enlace de la imagen (Drive o web)" className="pf-in" value={f.imagen_url} onChange={(e) => set('imagen_url', e.target.value)} />
                    {f.imagen_url && <div className="flex flex-wrap gap-2 mt-2"><button type="button" className="pf-img-btn pf-img-del" onClick={() => set('imagen_url', '')}><Trash2 className="w-4 h-4" />Quitar</button></div>}
                    <p role="status" className="text-[11px] text-slate-500 mt-1.5">Por ahora se pega el enlace de la imagen. La subida de archivos se habilita al conectar el almacenamiento de imágenes.</p>
                  </div>
                </div>
              </Seccion>

              <Seccion n={3} t="Descripción">
                <label className="pf-f"><span>Descripción / especificaciones</span>
                  <textarea rows={4} placeholder="Características principales del equipo…" className="pf-in pf-ta" value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} /></label>
              </Seccion>

              <Seccion n={4} t="Precios">
                <div className="pf-grid">
                  <label className="pf-f"><span>Precio PVP ($)</span>
                    <input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" className="pf-in" value={f.pvp} onChange={(e) => set('pvp', e.target.value)} /></label>
                  <label className="pf-f"><span>Precio distribuidor ($)</span>
                    <input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" className="pf-in" value={f.precio_dis} onChange={(e) => set('precio_dis', e.target.value)} /></label>
                </div>
                <div className="pf-sw mt-2.5"><div><p>Aplica IVA</p><small>Se cobra IVA sobre este producto.</small></div>
                  <Interruptor activo={f.aplica_iva} cambiar={() => set('aplica_iva', !f.aplica_iva)} /></div>
              </Seccion>

              <Seccion n={5} t="Stock y catálogo">
                <label className="pf-f"><span>Observaciones de stock</span>
                  <input type="text" placeholder="Ej. Reservado, en reparación…" className="pf-in" value={f.reservaciones} onChange={(e) => set('reservaciones', e.target.value)} /></label>
                <div className="pf-sw mt-2.5"><div><p>Visible en catálogo público</p><small>Se muestra en la página web.</small></div>
                  <Interruptor activo={f.en_catalogo} cambiar={() => set('en_catalogo', !f.en_catalogo)} /></div>
              </Seccion>

              {error && <div className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
            </div>
            <div className="shrink-0 border-t border-slate-200 bg-white p-3 sm:p-4">
              <button onClick={guardar} disabled={guardando} className="pf-submit">{guardando ? 'Guardando…' : 'Guardar producto'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
