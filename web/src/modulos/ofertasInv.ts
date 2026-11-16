/* Ofertas vigentes para Inventario (Issue #39): tipo, carga y precios.
   Se lee con la función inv_ofertas_vigentes (sin costo ni margen), no con la tabla ofertas. */
import { supabase } from '../supabase'

export type OfertaInv = {
  ofertaId: string; codigoOferta: string | null; productoId: string; codigo: string; nombre: string; marca: string
  categoriaId: string | null; categoria: string; catOrden: number | null; img: string; publico: boolean; stock: number
  /** PVP de referencia de la oferta (sin IVA). */
  pvp: number
  /** Precio de oferta (sin IVA). */
  precio: number
  descuento: number; iva: boolean; tipo: string; inicio: string | null; fin: string | null; proxima: boolean
  texto: string; regalo: string; combo: string; campana: string
}

export async function cargarOfertasInv(proximas = false): Promise<OfertaInv[]> {
  const { data, error } = await supabase.rpc('inv_ofertas_vigentes', { p_proximas: proximas })
  if (error) throw new Error(error.message)
  return ((data as OfertaInv[]) ?? []).map((o) => ({ ...o, pvp: Number(o.pvp) || 0, precio: Number(o.precio) || 0, descuento: Number(o.descuento) || 0, stock: Number(o.stock) || 0 }))
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

/** "Válido hasta 16/12/2026" si todas terminan el mismo día; si no, cada producto muestra la suya. */
export function textoVigencia(l: OfertaInv[]): string {
  const fines = [...new Set(l.map((o) => o.fin).filter(Boolean))]
  return fines.length === 1 ? 'Válido hasta el ' + fechaCorta(fines[0]) : fines.length ? 'Vigencia indicada en cada producto' : ''
}

export const fechaCorta =(s: string | null | undefined) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '')
export const dineroUsd = (v: number) => '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
