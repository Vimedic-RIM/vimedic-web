/* La oferta de una línea de proforma o de venta (Issue #41).
   Reglas de la app original: vmAplicarOferta_ y vmAplicarDescCliente_ (CRMDashboard.html) y la etiqueta "en promoción" de Documentos.gs.
   La oferta se guarda en la línea (cotizaciones.items[].oferta) para que la proforma diga con qué promoción se cotizó,
   aunque la campaña termine después. No es la tabla de ofertas: es solo lo que hace falta para imprimir y comparar. */
import type { OfertaInv } from './ofertasInv'

export type OfertaLinea = { campana: string; tipo: string; pct: number; fin: string | null; regalo?: string; combo?: string }

/** La oferta del producto lista para aplicarse a una línea, o null si no corresponde:
 *  apagada (campaña o con límite y ya sin unidades), próxima, Combo (el original no le aplica descuento solo) o sin porcentaje. */
export function ofertaDeLinea(o: OfertaInv | undefined | null): OfertaLinea | null {
  if (!o || o.apagada || o.proxima || o.tipo === 'Combo' || !(o.descuento > 0)) return null
  return { campana: o.campana || '', tipo: o.tipo || '', pct: o.descuento, fin: o.fin || null, ...(o.regalo ? { regalo: o.regalo } : {}), ...(o.combo ? { combo: o.combo } : {}) }
}

/** ¿La línea lleva el descuento de su oferta? Solo entonces se habla de promoción: con otro descuento (por ejemplo el del cliente) no la tiene. */
export const ofertaAplicada = (l: { descuento?: number | null; oferta?: OfertaLinea | null }): boolean =>
  !!l.oferta && l.oferta.pct > 0 && Math.abs((Number(l.descuento) || 0) - l.oferta.pct) < 0.005

/** Nombre de la promoción tal como se imprime: la campaña o, si no tiene, "Oferta <tipo>". */
export const nombreOferta = (o: Pick<OfertaLinea, 'campana' | 'tipo'>): string => (o.campana || 'Oferta ' + (o.tipo || '').toLowerCase()).trim()

/** Porcentaje sin ceros de sobra: 30 → "30", 12.5 → "12.5". */
export const pctTexto = (n: number): string => String(+Number(n).toFixed(2))

/** Al agregar un producto el cliente se queda con el mejor de los dos: la oferta (sobre el PVP) o lo suyo
 *  (su descuento o su precio de distribuidor). Si empatan, queda la oferta. */
export function mejorDeLosDos(precioCliente: number, descCliente: number, pvp: number, oferta: OfertaLinea | null): { precio: number; descuento: number; oferta?: OfertaLinea } {
  if (!oferta || !(pvp > 0)) return { precio: precioCliente, descuento: descCliente }
  const delCliente = precioCliente * (1 - descCliente / 100), conOferta = pvp * (1 - oferta.pct / 100)
  return conOferta <= delCliente + 0.005 ? { precio: pvp, descuento: oferta.pct, oferta } : { precio: precioCliente, descuento: descCliente }
}

/** Al elegir o cambiar el cliente: la línea conserva la oferta si su descuento es igual o mayor al del cliente; si no, gana el del cliente. */
export function descuentoConCliente(oferta: OfertaLinea | null | undefined, descCliente: number): { descuento: number; oferta?: OfertaLinea } {
  return oferta && oferta.pct >= descCliente - 0.0001 ? { descuento: oferta.pct, oferta } : { descuento: descCliente }
}

/** El chip del selector de productos: lo que se ve de una oferta de Inventario, antes de aplicarla a una línea. */
export const textoChipOfertaInv = (o: OfertaInv): string => textoChipOferta({ pct: o.descuento, campana: o.campana, tipo: o.tipo, fin: o.fin, regalo: o.regalo, combo: o.combo, quedan: o.quedan, limite: o.limite }, false)

/** Texto del chip naranja (selector de productos y carrito), como el original: "OFERTA -30% · Black Sales 2026 · hasta 16/12". */
export function textoChipOferta(o: { pct: number; campana: string; tipo: string; fin: string | null; regalo?: string; combo?: string; quedan?: number | null; limite?: number }, aplicada: boolean): string {
  const hasta = o.fin ? ' · hasta ' + o.fin.slice(8, 10) + '/' + o.fin.slice(5, 7) : ''
  const extra = (o.tipo === 'Combo' && o.combo ? ' · combo con ' + o.combo : o.regalo ? ' · incluye ' + o.regalo : '')
    + (o.quedan != null && o.quedan <= 5 && (o.limite ?? 0) > 0 ? ' · quedan ' + o.quedan : '')
  return `${aplicada ? 'OFERTA APLICADA' : 'OFERTA'}${o.pct > 0 ? ' -' + pctTexto(o.pct) + '%' : ''} · ${nombreOferta(o)}${hasta}${extra}`
}
