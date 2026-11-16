/* Formato de los nombres en los formularios, igual que la app original (primeraMayusculaEnVivo_ y formatearNombrePropio_ de
   CRMDashboard.html): la primera letra de cada palabra en mayúscula y el resto en minúscula.
   "LOPEZ DIAZ CRISTOPHER ADRIAN" → "Lopez Diaz Cristopher Adrian".
   Se usa en nombre de cliente, institución, persona y cargo de contacto, ciudad, el lead rápido de cotización y venta, y Empleados.
   La versión de la app nueva solo subía la primera letra y dejaba el resto como llegara: un nombre pegado, traído de un lead o escrito
   en mayúsculas se guardaba en mayúsculas. */

/** Mientras se escribe: no recorta espacios (se recortan al guardar). */
export const nombrePropio = (s: string): string =>
  String(s ?? '').toLowerCase().split(' ').map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(' ')

/** Para guardar: lo mismo, sin espacios sobrantes en los extremos. */
export const nombrePropioFinal = (s: string): string => nombrePropio(String(s ?? '').trim())

/** El campo lo controla React: al cambiar el texto, el cursor saltaría al final. Se devuelve a su sitio, como hacía la app original. */
export function conservarCursor(el: HTMLInputElement, escrito: string, aplicado: string): void {
  const pos = el.selectionStart
  if (aplicado === escrito || pos == null) return
  requestAnimationFrame(() => { try { el.setSelectionRange(pos, pos) } catch { /* el campo ya no está */ } })
}
