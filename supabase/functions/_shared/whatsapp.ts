// WhatsApp en las publicaciones de Facebook e Instagram (Planificador › Zernio).
//   · Facebook: enlace wa.me que abre el chat con un mensaje ya escrito que dice de qué publicación viene.
//   · Instagram: el número (allí los enlaces del texto no se pueden tocar).
// El contacto se elige en Marketing › Configuración (marketing_ajustes 'whatsapp_publicaciones').

export type ContactoWa = { numero: string; nombre: string }

/** Celular de Ecuador → formato internacional de WhatsApp (0951234567 → 593951234567). '' si no sirve. */
export function numeroWa(t: unknown): string {
  let d = String(t ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (/^0\d{9}$/.test(d)) d = '593' + d.slice(1)
  else if (/^9\d{8}$/.test(d)) d = '593' + d
  return /^\d{10,15}$/.test(d) ? d : ''
}
/** 593951234567 → 095 123 4567 (como lo escribe la gente en Ecuador). */
export function numeroLocal(n: string): string {
  return /^593\d{9}$/.test(n) ? ('0' + n.slice(3)).replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3') : '+' + n
}
/** De qué trata la publicación: el producto (sin el código) o la primera línea con texto, sin emojis ni hashtags. */
export function temaPublicacion(productoTexto: unknown, contenido: string): string {
  const prod = String(productoTexto ?? '').split(' · ').slice(-1)[0]
  const linea = contenido.split('\n').map((x) => x.trim()).find((x) => /[a-záéíóúñ]{3}/i.test(x.replace(/#\S+/g, ''))) || ''
  return (prod || linea).replace(/#\S+/g, '').replace(/https?:\/\/\S+/g, '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ').trim().replace(/[.:;,!¡¿?]+$/, '').slice(0, 70).trim()
}
/** ¿El texto ya trae un WhatsApp (enlace o el mismo número)? Entonces no se agrega otro. */
function yaTieneWhatsapp(texto: string, numero: string): boolean {
  return /wa\.me\/|api\.whatsapp\.com|whatsapp\.com\/send/i.test(texto) || texto.replace(/\D/g, '').includes(numero.slice(-9))
}
/** Texto final para la red: Facebook con enlace y mensaje de origen; Instagram con el número; otras redes, igual. */
export function conWhatsapp(texto: string, red: string, wa: ContactoWa, tema: string): string {
  const r = red.toLowerCase()
  if ((r !== 'facebook' && r !== 'instagram') || !texto.trim() || yaTieneWhatsapp(texto, wa.numero)) return texto
  if (r === 'facebook') {
    const mensaje = 'Hola VIMEDIC 👋 Vengo de su publicación en Facebook' + (tema ? ' sobre «' + tema + '»' : '') + ' y quiero más información.'
    return texto + '\n\n💬 Escríbenos por WhatsApp: https://wa.me/' + wa.numero + '?text=' + encodeURIComponent(mensaje)
  }
  return texto + '\n\n💬 WhatsApp: ' + numeroLocal(wa.numero) + ' · cuéntanos que nos viste en Instagram'
}
