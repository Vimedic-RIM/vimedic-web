// Meta Lead Ads → fila de «leads» del CRM (igual que metaDatosFila_ / metaCrearGestion_ de LeadsMeta.gs).
// Funciones puras: las usa la Edge Function meta-leads y se prueban sin red.

/** Versión de la Graph API (Meta mantiene cada versión unos 2 años; las llamadas viejas se suben solas). */
export const GRAPH = 'https://graph.facebook.com/v23.0'
/** Campos del lead que se piden a Meta. */
export const CAMPOS_LEAD = 'id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform'
export const MEDIO_PAGADO = '📣 Anuncio en Facebook o Instagram'
export const MEDIO_ORGANICO = '📱 Publicación en redes sociales'

// deno-lint-ignore no-explicit-any
export type LeadMeta = { id: string; created_time?: string; field_data?: { name: string; values?: any[] }[]; ad_id?: string; ad_name?: string; adset_id?: string; adset_name?: string; campaign_id?: string; campaign_name?: string; form_id?: string; is_organic?: boolean | string; platform?: string }

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[¿?¡!:]/g, '').replace(/[_\s]+/g, ' ').trim()
/** Sin emojis ni símbolos decorativos (Meta los pone en las opciones del formulario). */
export const sinEmojis = (v: unknown) => String(v ?? '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/\s{2,}/g, ' ').trim()
const esDePrueba = (v: unknown) => /^<test lead/i.test(String(v ?? '').trim())
/** "equipamiento_de_quirófano" → "Equipamiento de quirófano". */
const respuesta = (v: unknown) => { const s = sinEmojis(v).replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : '' }
/** Teléfono: Ecuador en formato local 09…; el resto con +código de país. */
export function telefonoMeta(v: unknown): string {
  const s = sinEmojis(v), d = s.replace(/\D/g, '')
  if (!d) return ''
  if (/^593\d{9}$/.test(d)) return '0' + d.slice(3)
  if (/^9\d{8}$/.test(d)) return '0' + d
  if (/^0\d{8,9}$/.test(d)) return d
  return (s.startsWith('+') || d.length > 10 ? '+' : '') + d
}
/** "maría fernanda LÓPEZ" → "María Fernanda López". */
export const nombreTitulo = (v: unknown) => sinEmojis(v).toLocaleLowerCase('es').replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase('es')).trim()
/** Pregunta del formulario como título corto: "¿qué_área_buscas_equipar?" → "Área a equipar". */
function tituloPregunta(h: string): string {
  const n = norm(h)
  if (/area/.test(n) && /equipar/.test(n)) return 'Área a equipar'
  if (/establecimiento/.test(n)) return 'Tipo de establecimiento'
  const s = String(h || '').replace(/[¿?_]/g, ' ').replace(/\s+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const REGLAS: [keyof Basicos, RegExp[]][] = [
  ['nombre', [/^nombre completo$/, /^full name$/, /^nombre$/, /^(?!.*(empresa|clinica|institucion|negocio|hospital|consultorio|establecimiento)).*nombre/]],
  ['nombreDe', [/^first name$/, /^nombre de pila$/]],
  ['apellido', [/^last name$/, /apellido/]],
  ['telefono', [/whatsapp/, /^phone number$/, /telefono|celular|phone|movil/]],
  ['email', [/correo/, /^email$/, /e mail/]],
  ['ciudad', [/^ciudad$/, /^city$/, /ciudad|provincia/]],
  ['identificacion', [/cedula|ruc\b|^ruc|identificacion/]],
  ['empresaCliente', [/empresa|company|institucion|clinica|hospital|razon social|consultorio/]],
]
type Basicos = { nombre: string; nombreDe: string; apellido: string; telefono: string; email: string; ciudad: string; identificacion: string; empresaCliente: string }

/** Lead de Meta → fila para «leads» (o «prueba» si es un lead de la herramienta de pruebas de Meta). */
export function armarLead(L: LeadMeta, formulario: string, empresa: string): { esPrueba: boolean; fila: Record<string, unknown>; resumen: string } {
  const campos = (L.field_data ?? []).map((f) => ({ k: String(f.name || ''), v: (f.values ?? []).map((x) => String(x ?? '')).filter(Boolean).join(', ') }))
  const esPrueba = campos.some((c) => esDePrueba(c.v))
  const b: Basicos = { nombre: '', nombreDe: '', apellido: '', telefono: '', email: '', ciudad: '', identificacion: '', empresaCliente: '' }
  const usados = new Set<number>()
  // Cada dato toma la primera pregunta que coincide con su regla más exacta (las reglas van de exacta a general).
  for (const [clave, pruebas] of REGLAS) {
    for (const p of pruebas) {
      const i = campos.findIndex((c, k) => !usados.has(k) && p.test(norm(c.k)))
      if (i >= 0) { usados.add(i); b[clave] = campos[i].v; break }
    }
  }
  const nombre = nombreTitulo(b.nombre || [b.nombreDe, b.apellido].filter(Boolean).join(' '))
  const telefono = telefonoMeta(b.telefono), email = sinEmojis(b.email).toLowerCase(), ciudad = respuesta(b.ciudad)
  const preguntas = campos.map((c, i) => (usados.has(i) ? null : { t: tituloPregunta(c.k), v: respuesta(c.v) })).filter((x): x is { t: string; v: string } => !!x && !!x.v)
  const organico = L.is_organic === true || /^(true|1)$/i.test(String(L.is_organic ?? ''))
  const plat = String(L.platform || '').toLowerCase()
  const red = /ig|instagram/.test(plat) ? 'Instagram' : /fb|facebook/.test(plat) ? 'Facebook' : 'Facebook/Instagram'
  const anuncio = sinEmojis(L.ad_name).slice(0, 200), campana = sinEmojis(L.campaign_name).slice(0, 200)
  const interes = ((preguntas.map((p) => p.t + ': ' + p.v).join(' · ') || 'Formulario de Meta') + (ciudad ? ' · Ciudad: ' + ciudad : '')).slice(0, 1000)
  const fecha = Date.parse(String(L.created_time || '')) ? new Date(String(L.created_time)).toISOString() : new Date().toISOString()
  const fila: Record<string, unknown> = {
    codigo: 'META-' + L.id, meta_lead_id: String(L.id), origen_tipo: 'meta', empresa: empresa === 'FEMEDICS' ? 'FEMEDICS' : 'VIMEDIC', fecha,
    nombre: nombre || email || telefono || 'Cliente de Meta', telefono: telefono || null, email: email || null, ciudad: ciudad || null,
    identificacion: b.identificacion ? b.identificacion.replace(/\D/g, '') || null : null, empresa_cliente: sinEmojis(b.empresaCliente).slice(0, 200) || null,
    interes, canal: red, anuncio: anuncio || null, medio_captacion: organico ? MEDIO_ORGANICO : MEDIO_PAGADO,
    meta_datos: { platform: L.platform ?? null, form_id: L.form_id ?? null, formulario: formulario || null, ad_id: L.ad_id ?? null, ad_name: L.ad_name ?? null, adset_id: L.adset_id ?? null, adset_name: L.adset_name ?? null, campaign_id: L.campaign_id ?? null, campaign_name: L.campaign_name ?? null, is_organic: organico, respuestas: preguntas, campos },
    atribucion: { anuncio_id: L.ad_id ?? '', campana_id: L.campaign_id ?? '', adset_id: L.adset_id ?? '', utm_source: red.toLowerCase(), utm_medium: organico ? 'organic' : 'paid_social', utm_campaign: campana, utm_content: anuncio, formulario: formulario || '' },
  }
  const resumen = 'Lead del formulario de Meta' + (formulario ? ' «' + formulario + '»' : '') + (organico ? ' (orgánico)' : '') + ' en ' + red + '. ' + interes + (anuncio ? ' · Anuncio: ' + anuncio : '') + (campana ? ' · Campaña: ' + campana : '') + '.'
  return { esPrueba, fila, resumen }
}
