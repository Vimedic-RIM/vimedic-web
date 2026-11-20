// Enlaces firmados de los botones «WhatsApp» y «Llamar» del correo del lead (página pública /contacto-lead/).
// token = <lead>.<asesor>.<emitido base36>.<firma>; firma = HMAC-SHA256(clave de Vault, «lead.asesor.emitido»), 32 hex.
// Vale 30 días. La clave la lee solo el servidor (public.lead_contacto_clave, service_role).
const VIGENCIA_S = 30 * 86400
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function hmac(clave: string, texto: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto)))).map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export async function firmarContacto(clave: string, leadId: string, asesorId: string, ahora = Date.now()): Promise<string> {
  const base = leadId + '.' + asesorId + '.' + Math.floor(ahora / 1000).toString(36)
  return base + '.' + await hmac(clave, base)
}

export async function verificarContacto(clave: string, token: string, ahora = Date.now()): Promise<{ leadId: string; asesorId: string } | null> {
  const p = String(token || '').split('.')
  if (p.length !== 4 || !UUID.test(p[0]) || !UUID.test(p[1]) || !/^[0-9a-z]{1,10}$/.test(p[2]) || !/^[0-9a-f]{32}$/.test(p[3])) return null
  const emitido = parseInt(p[2], 36)
  if (!Number.isFinite(emitido) || emitido * 1000 > ahora + 300_000 || ahora / 1000 - emitido > VIGENCIA_S) return null
  if (!igual(p[3], await hmac(clave, p[0] + '.' + p[1] + '.' + p[2]))) return null
  return { leadId: p[0].toLowerCase(), asesorId: p[1].toLowerCase() }
}

/** Dirección de la página pública que registra el contacto y abre WhatsApp (v=wa) o la llamada (v=tel). */
export const enlaceContacto = (appUrl: string, token: string, via: 'wa' | 'tel') =>
  appUrl.replace(/\/+$/, '') + '/contacto-lead/?t=' + encodeURIComponent(token) + '&v=' + via
