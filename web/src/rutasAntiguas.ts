/* Enlaces de la app anterior (Apps Script dentro de app.vimedic.com.ec): /acceso/, /espacio/, /entrando/ y /<módulo>/
   (a veces con ?empToken=… o ?r=<módulo>). En la app nueva los módulos van después del «#» (/#crm).
   Cuando app.vimedic.com.ec pase a la app nueva, los favoritos y enlaces viejos abren el módulo equivalente
   (o el inicio) en vez de quedarse en una página sin sentido. Las páginas públicas no se tocan. */
const PUBLICAS = new Set(['encuesta', 'servicio', 'material', 'seguimiento', 'escanear'])

/** Dirección nueva para un enlace de la app anterior, o null si no es uno de esos enlaces. */
export function rutaAntigua(pathname: string, search: string, modulos: Set<string>): string | null {
  const m = pathname.match(/^\/([a-z]+)\/?$/)
  if (!m || PUBLICAS.has(m[1])) return null
  let mod = m[1]
  if (mod === 'acceso' || mod === 'espacio' || mod === 'entrando') {
    const r = new URLSearchParams(search).get('r') || ''
    mod = /^[a-z]+$/.test(r) ? r : ''
  }
  return '/' + (mod && modulos.has(mod) ? '#' + mod : '')
}
