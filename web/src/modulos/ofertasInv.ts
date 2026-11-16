/* Ofertas vigentes para Inventario (Issue #39): tipo, carga y precios.
   Se lee con la función inv_ofertas_vigentes (sin costo ni margen), no con la tabla ofertas. */
import { supabase } from '../supabase'

/** A quién se da la oferta: clientes PVP, distribuidores (DIS) o ambos. */
export type Publico = 'PVP' | 'DIS' | 'AMBOS'
export type TipoCli = 'PVP' | 'DIS'
/** Texto corto para etiquetas. */
export const textoPublico = (p: Publico): string => (p === 'PVP' ? 'Clientes PVP' : p === 'DIS' ? 'Distribuidores DIS' : 'PVP y DIS')

export type OfertaInv = {
  ofertaId: string; codigoOferta: string | null; productoId: string; codigo: string; nombre: string; marca: string
  categoriaId: string | null; categoria: string; catOrden: number | null; img: string; publico: boolean; stock: number
  /** PVP de referencia de la oferta (sin IVA). */
  pvp: number
  /** Precio de oferta (sin IVA). */
  precio: number
  descuento: number; iva: boolean; tipo: string; inicio: string | null; fin: string | null; proxima: boolean
  texto: string; regalo: string; combo: string; campana: string
  /** Límite de unidades de la oferta (0 = sin límite) y unidades que le quedan (null = se desconoce el stock). */
  limite: number; quedan: number | null
  deCampana: boolean
  /** Oferta de campaña (o con límite) a la que ya no le quedan unidades: no se debe aplicar al cotizar (regla de ofActivasMapa_ del original). */
  apagada: boolean
  /** A quién la configuraron y para qué tipos de cliente es la que se aplica (un producto puede tener una oferta distinta para PVP y otra para DIS). */
  aplicaA: Publico; ganaPara: TipoCli[]
}

export async function cargarOfertasInv(proximas = false): Promise<OfertaInv[]> {
  const { data, error } = await supabase.rpc('inv_ofertas_vigentes', { p_proximas: proximas })
  if (error) throw new Error(error.message)
  return ((data as OfertaInv[]) ?? []).map((o) => ({
    ...o, pvp: Number(o.pvp) || 0, precio: Number(o.precio) || 0, descuento: Number(o.descuento) || 0, stock: Number(o.stock) || 0,
    limite: Number(o.limite) || 0, quedan: o.quedan == null ? null : Number(o.quedan), deCampana: !!o.deCampana, apagada: !!o.apagada,
    aplicaA: o.aplicaA === 'PVP' || o.aplicaA === 'DIS' ? o.aplicaA : 'AMBOS', ganaPara: Array.isArray(o.ganaPara) && o.ganaPara.length ? o.ganaPara : ['PVP', 'DIS'],
  }))
}

const r2 = (n: number) => Math.round(n * 100) / 100
/** Precios Femedics: PVP / 0,90 (la misma regla del Inventario), también para el precio de oferta. */
export const aFemedics = (n: number) => r2((Number(n) || 0) / 0.9)

/** Precios listos para mostrar: antes y ahora, con o sin IVA, y el % de ahorro. */
export function preciosOferta(o: Pick<OfertaInv, 'pvp' | 'precio' | 'iva'>, op: { femedics?: boolean; conIva?: boolean } = {}) {
  const f = (n: number) => (op.femedics ? aFemedics(n) : r2(n))
  const iva = op.conIva && o.iva ? 1.15 : 1
  const antes = r2(f(o.pvp) * iva), ahora = r2(f(o.precio) * iva)
  const ahorro = antes > 0 && ahora < antes ? Math.round((1 - ahora / antes) * 100) : 0
  return { antes, ahora, ahorro }
}

/** Sin tildes, sin emojis y en minúsculas: para buscar y ordenar. */
export const normalizar = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s.-]/gu, ' ').toLowerCase().trim()

export type GrupoOfertas = { categoria: string; orden: number | null; items: OfertaInv[] }
/** Por categoría (orden del catálogo y luego nombre). Dentro de cada una se respeta el orden de la base: visibles al público primero. */
export function agruparOfertas(l: OfertaInv[]): GrupoOfertas[] {
  const m = new Map<string, GrupoOfertas>()
  for (const o of l) {
    let g = m.get(o.categoria)
    if (!g) { g = { categoria: o.categoria, orden: o.catOrden, items: [] }; m.set(o.categoria, g) }
    g.items.push(o)
  }
  return [...m.values()].sort((a, b) => (a.orden ?? 1e9) - (b.orden ?? 1e9) || normalizar(a.categoria).localeCompare(normalizar(b.categoria), 'es'))
}

/** Fecha límite que ve el cliente en el PDF (Issue #40): la real de cada oferta, otra que se elige a mano (no cambia la oferta en el
 *  sistema, solo lo que dice el PDF) o ninguna. */
export type LimiteFecha = { modo: 'real' | 'otra' | 'ocultar'; fecha: string }
export const LIMITE_REAL: LimiteFecha = { modo: 'real', fecha: '' }
/** La fecha límite que se imprime para una oferta, o null si no se muestra ninguna. */
export function limiteDe(finReal: string | null | undefined, lim: LimiteFecha = LIMITE_REAL): string | null {
  if (lim.modo === 'ocultar') return null
  if (lim.modo === 'otra') return lim.fecha || null
  return finReal || null
}

/** "Válido hasta 16/12/2026" si todas terminan el mismo día; si no, cada producto muestra la suya. Con otra fecha o sin fecha, según el modo. */
export function textoVigencia(l: OfertaInv[], lim: LimiteFecha = LIMITE_REAL): string {
  if (lim.modo === 'ocultar') return ''
  if (lim.modo === 'otra') return lim.fecha ? 'Válido hasta el ' + fechaCorta(lim.fecha) : ''
  const fines = [...new Set(l.map((o) => o.fin).filter(Boolean))]
  return fines.length === 1 ? 'Válido hasta el ' + fechaCorta(fines[0]) : fines.length ? 'Vigencia indicada en cada producto' : ''
}

/** Nombres de las campañas de estas ofertas, sin repetir y en orden alfabético. */
export const campanasDe = (l: OfertaInv[]): string[] => [...new Set(l.map((o) => o.campana).filter(Boolean))].sort((a, b) => normalizar(a).localeCompare(normalizar(b), 'es'))

/** Nombre de archivo seguro: "Black Sales 2026" → "Black-Sales-2026". */
export const slugArchivo = (s: string): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'Ofertas'

/** Fecha local "YYYY-MM-DD" (la de Ecuador, la del equipo del usuario). */
export const ymdLocal = (d: Date): string => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
export const sumarDias = (ymd: string, n: number): string => { const [y, m, d] = ymd.split('-').map(Number); return ymdLocal(new Date(y, m - 1, d + n)) }

export const fechaCorta = (s: string | null | undefined) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '')
export const dineroUsd = (v: number) => '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })


/** Cómo se llama la promoción al publicarla en un texto: "BLACK" si es de la campaña Black (lo que pidió Ventas); si no, "PROMOCIÓN" ("PROMO" en un botón). */
export const etiquetaOferta = (o: Pick<OfertaInv, 'campana'>, corta = false): string => (/black/i.test(o.campana || '') ? 'BLACK' : corta ? 'PROMO' : 'PROMOCIÓN')

/** Hoy en Ecuador (AAAA-MM-DD). La base cuenta los días en esta zona: una oferta vale hasta el final de su día de fin. */
export const hoyEC = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date())

/** ¿La oferta sigue en pie en esa fecha? Termina al pasar su fecha de fin o al quedarse sin unidades (apagada); antes de su inicio todavía no empieza. */
export const ofertaActiva = (o: Pick<OfertaInv, 'inicio' | 'fin' | 'apagada'>, hoy: string = hoyEC()): boolean =>
  !o.apagada && !(o.fin && o.fin < hoy) && !(o.inicio && o.inicio > hoy)