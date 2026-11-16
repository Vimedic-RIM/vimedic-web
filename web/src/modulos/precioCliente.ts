/* Precio y descuento de un producto según el cliente (cotizaciones y ventas).
   Reglas de la app original (CRMDashboard.html: calcularDescuentoParaCliente_, vmAplicarDescCliente_ y vmDisExacto_):
   · Cliente PVP: precio de lista (PVP), sin descuento.
   · DIS con nivel 5 / 10 / 15: ese % de descuento sobre el PVP.
   · DIS VIP o DIS "a secas" (sin nivel, los clientes antiguos): el precio DIS de cada producto. Se muestra el PVP con el % que equivale al
     precio DIS, para que el distribuidor vea cuánto se le descuenta; el % cuadra al centavo (si no se puede, se mueve el precio unitario
     unos centavos para que el total sea exactamente el precio DIS).
   · Si el producto no tiene precio DIS (o no es menor al PVP): sin descuento.
   La oferta vigente se compara aparte (ofertaLinea.ts → mejorDeLosDos): el cliente se queda con lo mejor de los dos. */

export type TipoCliente = { tipo_cliente?: string | null; descuento_fijo?: string | null } | null | undefined

const r2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** ¿Es distribuidor? "DIS", "Dis" o "dis" cuentan igual (como en el original). */
export const esDis = (c: TipoCliente): boolean => String(c?.tipo_cliente ?? '').trim().toUpperCase() === 'DIS'
const nivel = (c: TipoCliente): string => String(c?.descuento_fijo ?? '').trim().toUpperCase()
/** % fijo sobre el PVP si el cliente tiene nivel 5, 10 o 15; si no, null. */
export const pctFijoDis = (c: TipoCliente): number | null => { const n = nivel(c); return n === '5' || n === '10' || n === '15' ? Number(n) : null }
/** DIS que paga el precio DIS de cada producto: VIP, o distribuidor sin nivel fijo. */
export const usaPrecioDis = (c: TipoCliente): boolean => nivel(c) === 'VIP' || (pctFijoDis(c) === null && esDis(c))

/** % de distribuidor que cuadra al centavo con el precio DIS (vmDisExacto_). null si no hay un precio DIS válido (vacío o no menor al PVP). */
export function disExacto(pvp: number, dis: number): { pct: number; precio: number } | null {
  const p = r2(pvp), d = r2(dis)
  if (!(p > 0) || !(d > 0) || d >= p) return null
  const neto = (pp: number, pct: number) => r2(pp * (1 - pct / 100))
  const base = r2((1 - d / p) * 100)
  if (neto(p, base) === d) return { pct: base, precio: p }
  for (let k = 1; k <= 5; k++) {
    for (const pc of [r2(base - k / 100), r2(base + k / 100)]) if (pc > 0 && pc < 100 && neto(p, pc) === d) return { pct: pc, precio: p }
  }
  const pp = r2(d / (1 - base / 100))
  for (let k = 0; k <= 10; k++) {
    for (const cand of [r2(pp + k / 100), r2(pp - k / 100)]) if (neto(cand, base) === d) return { pct: base, precio: cand }
  }
  return { pct: base, precio: p }
}

/** Lo que le corresponde a este cliente por el producto, sin contar ofertas: precio unitario y % de descuento de la línea. */
export function precioParaCliente(pvp: number, dis: number, c: TipoCliente): { precio: number; descuento: number } {
  const lista = Number(pvp) || 0
  const fijo = pctFijoDis(c)
  if (fijo !== null) return { precio: lista, descuento: fijo }
  if (usaPrecioDis(c)) {
    const r = disExacto(lista, Number(dis) || 0)
    if (r) return { precio: r.precio, descuento: r.pct }
  }
  return { precio: lista, descuento: 0 }
}
