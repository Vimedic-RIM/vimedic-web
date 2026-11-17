/* Términos y condiciones de las ofertas (Ofertas › Términos). Generales para todas las ofertas y, por campaña, los
   que se suman a los generales. En la cotización se guarda una copia (cotizaciones.terminos_ofertas) y la proforma
   los muestra en la sección «Términos y condiciones de la promoción» si el asesor no los ocultó. */
import { supabase } from '../supabase'
import { ofertaAplicada, type OfertaLinea } from './ofertaLinea'

export type CamposTerminos = {
  /** «Precios promocionales válidos hasta el … o hasta agotar stock.» */
  vigencia: boolean
  /** «Unidades limitadas, sujetas a disponibilidad…» */
  stockLimitado: boolean
  /** «Promoción no acumulable con otras promociones ni descuentos.» */
  noAcumulable: boolean
  /** Si los precios de la promoción incluyen IVA. */
  iva: '' | 'incluido' | 'mas_iva'
  formasPago: string
  entrega: string
  garantia: string
  reserva: string
  exclusiones: string
  /** Texto libre: cada línea es un punto. */
  adicionales: string
}
export const CAMPOS_DEF: CamposTerminos = { vigencia: true, stockLimitado: true, noAcumulable: true, iva: '', formasPago: '', entrega: '', garantia: '', reserva: '', exclusiones: '', adicionales: '' }
/** Lo que se imprime: un grupo por campaña (o «Ofertas» para las que no son de una campaña). */
export type GrupoTerminos = { titulo: string; fin: string | null; puntos: string[] }
type Fila = { campana_id: string | null; campos: Partial<CamposTerminos>; activo: boolean; campana: { nombre: string } | null }

export const camposDe = (c: Partial<CamposTerminos> | null | undefined): CamposTerminos => ({ ...CAMPOS_DEF, ...(c ?? {}) })
const fFin = (iso: string | null) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const punto = (t: string) => { const x = t.trim().replace(/\s+/g, ' '); return x ? (/[.!?:]$/.test(x) ? x : x + '.') : '' }

/** Los puntos que salen en la proforma, en este orden. */
export function puntosTerminos(c: CamposTerminos, fin: string | null): string[] {
  const p: string[] = []
  if (c.vigencia) p.push(fin ? `Precios promocionales válidos hasta el ${fFin(fin)} o hasta agotar stock.` : 'Precios promocionales válidos hasta agotar stock.')
  if (c.stockLimitado) p.push('Unidades limitadas, sujetas a disponibilidad de stock al momento de confirmar la compra.')
  if (c.noAcumulable) p.push('Promoción no acumulable con otras promociones ni descuentos.')
  if (c.iva === 'incluido') p.push('Los precios promocionales incluyen IVA.')
  if (c.iva === 'mas_iva') p.push('Los precios promocionales no incluyen IVA.')
  if (c.formasPago.trim()) p.push(punto('Formas de pago: ' + c.formasPago))
  if (c.entrega.trim()) p.push(punto('Entrega: ' + c.entrega))
  if (c.garantia.trim()) p.push(punto('Garantía: ' + c.garantia))
  if (c.reserva.trim()) p.push(punto('Reserva: ' + c.reserva))
  if (c.exclusiones.trim()) p.push(punto('No aplica para: ' + c.exclusiones))
  for (const l of c.adicionales.split(/\r?\n/)) { const x = punto(l.replace(/^[-•*\d.)\s]+/, '')); if (x) p.push(x) }
  return p
}

/** Términos de una campaña = sus campos, completados con los generales (textos vacíos toman los generales; los
 *  «adicionales» se suman). Sin términos propios (o desactivados) se usan solo los generales. */
export function combinar(general: CamposTerminos, propios: CamposTerminos | null): CamposTerminos {
  if (!propios) return general
  const t = (a: string, b: string) => (a.trim() ? a : b)
  return {
    vigencia: propios.vigencia, stockLimitado: propios.stockLimitado, noAcumulable: propios.noAcumulable, iva: propios.iva || general.iva,
    formasPago: t(propios.formasPago, general.formasPago), entrega: t(propios.entrega, general.entrega), garantia: t(propios.garantia, general.garantia),
    reserva: t(propios.reserva, general.reserva), exclusiones: t(propios.exclusiones, general.exclusiones),
    adicionales: [general.adicionales, propios.adicionales].filter((x) => x.trim()).join('\n'),
  }
}

export async function cargarTerminos(): Promise<{ general: CamposTerminos; generalActivo: boolean; porCampana: Map<string, { id: string; campos: CamposTerminos; activo: boolean }> }> {
  const { data, error } = await supabase.from('ofertas_terminos').select('campana_id,campos,activo,campana:promo_campanas(nombre)').is('deleted_at', null)
  if (error) throw new Error(error.message)
  const filas = (data as unknown as Fila[]) ?? []
  const g = filas.find((f) => !f.campana_id)
  const porCampana = new Map<string, { id: string; campos: CamposTerminos; activo: boolean }>()
  for (const f of filas) if (f.campana_id && f.campana?.nombre) porCampana.set(f.campana.nombre.trim().toLowerCase(), { id: f.campana_id, campos: camposDe(f.campos), activo: f.activo })
  return { general: camposDe(g?.campos), generalActivo: g ? g.activo : true, porCampana }
}

/** Los términos para las líneas con oferta de una cotización (copia que se guarda con ella). Vacío si no hay ofertas. */
export async function terminosDeItems(items: { descuento?: number; oferta?: OfertaLinea | null }[]): Promise<GrupoTerminos[]> {
  const conOferta = items.filter((i) => ofertaAplicada({ descuento: Number(i.descuento) || 0, oferta: i.oferta }))
  if (!conOferta.length) return []
  const t = await cargarTerminos()
  const grupos = new Map<string, { titulo: string; fin: string | null; campos: CamposTerminos }>()
  for (const i of conOferta) {
    const o = i.oferta!, nombre = (o.campana || '').trim(), k = nombre.toLowerCase() || '_ofertas'
    const g = grupos.get(k)
    if (g) { if (o.fin && (!g.fin || o.fin < g.fin)) g.fin = o.fin; continue }   // la fecha más próxima del grupo
    const propios = nombre ? t.porCampana.get(k) : undefined
    const campos = combinar(t.generalActivo ? t.general : { ...CAMPOS_DEF, vigencia: false, stockLimitado: false, noAcumulable: false }, propios && propios.activo ? propios.campos : null)
    grupos.set(k, { titulo: nombre || 'Ofertas y liquidación', fin: o.fin || null, campos })
  }
  return [...grupos.values()].map((g) => ({ titulo: g.titulo, fin: g.fin, puntos: puntosTerminos(g.campos, g.fin) })).filter((g) => g.puntos.length)
}
