// Meta Lead Ads en el servidor: lo comparten el webhook (meta-leads) y la sincronización por consulta (meta-leads-poll).
// Un solo lugar para: leer la conexión guardada (Vault), llamar a la Graph API (token del usuario del sistema o de la
// página, con su appsecret_proof), y PROCESAR UN LEAD: crearlo en el CRM (anti-duplicado por meta_lead_id), dejar la
// interacción y enviar el correo urgente al asesor. El reparto justo lo hacen los triggers de «leads».
import { armarLead, CAMPOS_LEAD, GRAPH, type LeadMeta } from './metaLeads.ts'
import { correoLeadAsesor, type DatosCorreoLead } from './correoLeads.ts'
import { enviarGmail } from './gmail.ts'

// deno-lint-ignore no-explicit-any
type Cualquiera = any
// deno-lint-ignore no-explicit-any
type Admin = any

/** Error con código HTTP (las funciones lo devuelven tal cual). */
export class Falla extends Error {
  status: number
  constructor(m: string, status = 400) { super(m); this.status = status }
}
export async function hmacHex(secreto: string, texto: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto)))).map((x) => x.toString(16).padStart(2, '0')).join('')
}
/** Comparación en tiempo constante (firmas y claves no se adivinan por tiempos). */
export function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
export const fechaEc = (d = new Date()) => d.toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short' })

export type ConfMeta = { config: Record<string, unknown>; token: string; appSecret: string; empresa: string; paginaId: string }
export type ResultadoLead = 'nuevo' | 'ya' | 'prueba'

/** Servicio de Meta para una ejecución (el token de página se pide una vez y no se guarda). */
export function servicioMeta(admin: Admin) {
  const conf = async (): Promise<ConfMeta> => {
    const [{ data: fila }, { data: secreto }] = await Promise.all([
      admin.from('integraciones').select('config').eq('proveedor', 'meta_leads').is('deleted_at', null).maybeSingle(),
      admin.rpc('integracion_secreto', { p_proveedor: 'meta_leads' }),
    ])
    let s: Cualquiera = {}
    try { s = JSON.parse(String(secreto || '{}')) } catch { s = {} }
    const config = (fila?.config ?? {}) as Record<string, unknown>
    return { config, token: String(s.token || ''), appSecret: String(s.appSecret || ''), empresa: config.empresa === 'FEMEDICS' ? 'FEMEDICS' : 'VIMEDIC', paginaId: String(config.paginaId || '') }
  }
  /** Graph API con el token indicado, en el encabezado (no en la URL), y su appsecret_proof = HMAC-SHA256(ese token, app secret). */
  const graph = async (token: string, appSecret: string, ruta: string, init: RequestInit = {}) => {
    const prueba = await hmacHex(appSecret, token)
    const r = await fetch(GRAPH + ruta + (ruta.includes('?') ? '&' : '?') + 'appsecret_proof=' + prueba, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers ?? {}) } })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j?.error) throw new Falla('Meta respondió: ' + String(j?.error?.message || 'código ' + r.status))
    return j as Cualquiera
  }
  /** Llamadas con el token del USUARIO DEL SISTEMA (leer la página y pedir su token). */
  const graphSistema = (c: ConfMeta, ruta: string, init: RequestInit = {}) => graph(c.token, c.appSecret, ruta, init)
  let tokenPaginaCache = ''
  /** Token de la PÁGINA (Meta lo exige para subscribed_apps, leadgen_forms, /{form}/leads y /{leadgen_id}). No se guarda. */
  const getPageAccessToken = async (c: ConfMeta): Promise<string> => {
    if (tokenPaginaCache) return tokenPaginaCache
    const j = await graphSistema(c, `/${c.paginaId}?fields=access_token`)
    if (!j?.access_token) throw new Falla('Meta no entregó el token de la página ' + c.paginaId + ': el usuario del sistema debe tener asignada esa página (con permiso para administrarla) y el token, los permisos pages_show_list y pages_manage_metadata.')
    tokenPaginaCache = String(j.access_token)
    return tokenPaginaCache
  }
  /** Llamadas con el token de la PÁGINA (appsecret_proof calculado con ese mismo token). */
  const graphPagina = async (c: ConfMeta, ruta: string, init: RequestInit = {}) => graph(await getPageAccessToken(c), c.appSecret, ruta, init)
  /** Ruta de la página siguiente sin el token ni la prueba que trae Meta en la URL (van en el encabezado y se recalculan). */
  const siguiente = (r: Cualquiera): string | null => {
    const sig = String(r?.paging?.next || '')
    return sig ? sig.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, '').replace(/([?&])(access_token|appsecret_proof)=[^&]*/g, '$1').replace(/([?&])&+/g, '$1').replace(/[?&]+$/, '') : null
  }
  /** Formularios de la página (todas las páginas de resultados). */
  const formularios = async (c: ConfMeta): Promise<{ id: string; name: string; status: string }[]> => {
    const out: { id: string; name: string; status: string }[] = []
    let ruta: string | null = `/${c.paginaId}/leadgen_forms?fields=id,name,status&limit=100`
    for (let pag = 0; ruta && pag < 20; pag++) { const r = await graphPagina(c, ruta); out.push(...((r.data ?? []) as { id: string; name: string; status: string }[])); ruta = siguiente(r) }
    return out
  }
  /** Leads de un formulario creados después de «desde» (segundos Unix), todas las páginas de resultados. */
  const leadsDesde = async (c: ConfMeta, formId: string, desde: number): Promise<LeadMeta[]> => {
    const filtro = encodeURIComponent(JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: desde }]))
    const out: LeadMeta[] = []
    let ruta: string | null = `/${formId}/leads?fields=${CAMPOS_LEAD}&limit=100&filtering=${filtro}`
    for (let pag = 0; ruta && pag < 50; pag++) { const r = await graphPagina(c, ruta); out.push(...((r.data ?? []) as LeadMeta[])); ruta = siguiente(r) }
    return out
  }
  const estado = (texto: string) => admin.from('integraciones').update({ estado_prueba: texto, probado_en: new Date().toISOString() }).eq('proveedor', 'meta_leads')
  const nombres = new Map<string, string>()
  const nombreFormulario = async (c: ConfMeta, id?: string) => {
    if (!id) return ''
    if (!nombres.has(id)) { try { nombres.set(id, String((await graphPagina(c, `/${id}?fields=name`)).name || '')) } catch { nombres.set(id, '') } }
    return nombres.get(id) ?? ''
  }
  /** Ajustes del correo al asesor (Marketing › Configuración › Meta). Activo por defecto, diseño 1 «Alerta urgente». */
  const ajustesCorreo = (c: ConfMeta) => {
    const k = (c.config.correo ?? {}) as { activo?: boolean; diseno?: number; copia?: string }
    const copia = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(k.copia || '').trim()) ? String(k.copia).trim() : ''
    return { activo: k.activo !== false, diseno: [1, 2, 3].includes(Number(k.diseno)) ? Number(k.diseno) : 1, copia, crmUrl: (/^https:\/\/[\w.-]+/.test(String(c.config.appUrl || '')) ? String(c.config.appUrl).replace(/\/+$/, '') : 'https://qa.vimedic.com.ec') + '/#crm' }
  }
  let ultimoErrorCorreo = ''
  /** Correo URGENTE al asesor que recibió el lead. Si no sale, el lead igual queda en el CRM y con aviso en la campana. */
  const correoAsesor = async (c: ConfMeta, lead: { id: string; codigo: string; asesor_id: string | null; asignacion: string | null }, fila: Record<string, unknown>) => {
    const k = ajustesCorreo(c)
    if (!k.activo || !lead.asesor_id) return
    const { data: as } = await admin.from('empleados').select('nombre,email').eq('id', lead.asesor_id).maybeSingle()
    if (!as?.email) return
    const md = (fila.meta_datos ?? {}) as Cualquiera
    const d: DatosCorreoLead = {
      nombre: String(fila.nombre || ''), telefono: fila.telefono as string | null, email: fila.email as string | null, ciudad: fila.ciudad as string | null,
      respuestas: Array.isArray(md.respuestas) ? md.respuestas : [], red: String(fila.canal || 'Facebook/Instagram'), organico: md.is_organic === true,
      anuncio: md.ad_name ?? null, campana: md.campaign_name ?? null, formulario: md.formulario ?? null, fecha: String(fila.fecha || new Date().toISOString()),
      idCrm: lead.codigo, metaId: String(fila.meta_lead_id || ''), asesor: String(as.nombre || ''), existente: lead.asignacion === 'cliente existente',
    }
    const m = correoLeadAsesor(d, k.diseno, k.crmUrl)
    try { await enviarGmail(admin, { para: String(as.email), cc: k.copia && k.copia.toLowerCase() !== String(as.email).toLowerCase() ? k.copia : undefined, asunto: m.asunto, html: m.html, texto: m.texto }) }
    catch (e) { ultimoErrorCorreo = (e as Error).message; console.error('[meta] correo al asesor: ' + ultimoErrorCorreo) }
  }
  /** PROCESAR UN LEAD (webhook y sincronización): lo crea en el CRM si no estaba (meta_lead_id único), deja la
      interacción y avisa por correo al asesor. Los de la herramienta de prueba de Meta no entran. */
  const procesarLead = async (c: ConfMeta, L: LeadMeta, formulario: string): Promise<ResultadoLead> => {
    const { esPrueba, fila, resumen } = armarLead(L, formulario, c.empresa)
    if (esPrueba) return 'prueba'
    const { data, error } = await admin.from('leads').upsert(fila, { onConflict: 'meta_lead_id', ignoreDuplicates: true }).select('id,codigo,asesor_id,asignacion')
    if (error) throw new Falla('No se pudo guardar el lead: ' + error.message, 500)
    const nuevo = (data ?? [])[0] as { id: string; codigo: string; asesor_id: string | null; asignacion: string | null } | undefined
    if (!nuevo) return 'ya'
    await admin.from('interacciones').insert({
      codigo: 'INT-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8), ref_tipo: 'Contacto', ref_codigo: nuevo.codigo, lead_id: nuevo.id,
      tipo: 'Sistema', nota: resumen.slice(0, 3000), usuario_texto: 'Leads Meta',
    })
    await correoAsesor(c, nuevo, fila)
    return 'nuevo'
  }
  return { conf, graph, graphSistema, graphPagina, getPageAccessToken, formularios, leadsDesde, estado, nombreFormulario, ajustesCorreo, procesarLead, errorCorreo: () => ultimoErrorCorreo }
}
