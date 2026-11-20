// Edge Function: Meta Lead Ads → CRM (reemplaza la hoja «Clientes Potenciales Meta» + LeadsMeta.gs).
//   · GET  ?hub.mode=subscribe…   verificación del webhook (token de verificación de Marketing › Configuración).
//   · POST con X-Hub-Signature-256 webhook «leadgen» de Meta: se valida la firma con la clave secreta de la app,
//          se lee el lead en la Graph API y se crea en «leads» (origen 'meta'). El reparto justo y el aviso al asesor
//          los hacen los triggers que ya existen. meta_lead_id es único: nunca entra dos veces.
//   · POST con sesión (Marketing › Configuración, quien administra): «probar» (lee la página y la suscribe al
//          webhook) y «traer» (recupera los leads de los últimos días, por si alguno no llegó).
// El token y la clave secreta viven cifrados en Vault (integraciones 'meta_leads'); nunca van al navegador ni a los registros.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { armarLead, CAMPOS_LEAD, GRAPH, type LeadMeta } from '../_shared/metaLeads.ts'
import { correoLeadAsesor, DISENOS_CORREO, ejemploCorreoLead, type DatosCorreoLead } from '../_shared/correoLeads.ts'
import { enviarGmail } from '../_shared/gmail.ts'
import { LOGO_BLANCO_PNG, LOGO_COLOR_PNG } from '../_shared/logosCorreo.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const responder = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
class Falla extends Error { constructor(m: string, public status = 400) { super(m) } }
// deno-lint-ignore no-explicit-any
type Cualquiera = any

async function hmacHex(secreto: string, texto: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto)))).map((x) => x.toString(16).padStart(2, '0')).join('')
}
/** Comparación en tiempo constante (la firma no se puede adivinar por tiempos). */
function igual(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
const fechaEc = (d = new Date()) => d.toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short' })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, srv)

  const conf = async () => {
    const [{ data: fila }, { data: secreto }] = await Promise.all([
      admin.from('integraciones').select('config').eq('proveedor', 'meta_leads').is('deleted_at', null).maybeSingle(),
      admin.rpc('integracion_secreto', { p_proveedor: 'meta_leads' }),
    ])
    let s: Cualquiera = {}
    try { s = JSON.parse(String(secreto || '{}')) } catch { s = {} }
    const config = (fila?.config ?? {}) as Record<string, unknown>
    return { config, token: String(s.token || ''), appSecret: String(s.appSecret || ''), empresa: config.empresa === 'FEMEDICS' ? 'FEMEDICS' : 'VIMEDIC', paginaId: String(config.paginaId || '') }
  }
  type Conf = Awaited<ReturnType<typeof conf>>
  /** Graph API con el token que se indique, en el encabezado (no en la URL), y su appsecret_proof = HMAC-SHA256(ese token, app secret). */
  const graph = async (token: string, appSecret: string, ruta: string, init: RequestInit = {}) => {
    const prueba = await hmacHex(appSecret, token)
    const r = await fetch(GRAPH + ruta + (ruta.includes('?') ? '&' : '?') + 'appsecret_proof=' + prueba, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers ?? {}) } })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j?.error) throw new Falla('Meta respondió: ' + String(j?.error?.message || 'código ' + r.status))
    return j as Cualquiera
  }
  /** Llamadas con el token del USUARIO DEL SISTEMA (leer la página y pedir su token). */
  const graphSistema = (c: Conf, ruta: string, init: RequestInit = {}) => graph(c.token, c.appSecret, ruta, init)
  /** Token de la PÁGINA: Meta lo exige para subscribed_apps, leadgen_forms, /{form}/leads y /{leadgen_id}.
      Se pide con el token del usuario del sistema en cada operación y no se guarda en ningún lado. */
  let tokenPaginaCache = ''
  const getPageAccessToken = async (c: Conf): Promise<string> => {
    if (tokenPaginaCache) return tokenPaginaCache
    const j = await graphSistema(c, `/${c.paginaId}?fields=access_token`)
    if (!j?.access_token) throw new Falla('Meta no entregó el token de la página ' + c.paginaId + ': el usuario del sistema debe tener asignada esa página (con permiso para administrarla) y el token, los permisos pages_show_list y pages_manage_metadata.')
    tokenPaginaCache = String(j.access_token)
    return tokenPaginaCache
  }
  /** Llamadas con el token de la PÁGINA (appsecret_proof calculado con ese mismo token). */
  const graphPagina = async (c: Conf, ruta: string, init: RequestInit = {}) => graph(await getPageAccessToken(c), c.appSecret, ruta, init)
  const estado = (texto: string) => admin.from('integraciones').update({ estado_prueba: texto, probado_en: new Date().toISOString() }).eq('proveedor', 'meta_leads')
  const formularios = new Map<string, string>()
  const nombreFormulario = async (c: Conf, id?: string) => {
    if (!id) return ''
    if (!formularios.has(id)) { try { formularios.set(id, String((await graphPagina(c, `/${id}?fields=name`)).name || '')) } catch { formularios.set(id, '') } }
    return formularios.get(id) ?? ''
  }
  /** Suscribe la página a la app (campo leadgen) con el token de página y verifica que quedó. Devuelve el estado para la UI. */
  const conectarPagina = async (c: Conf): Promise<{ ok: boolean; mensaje: string }> => {
    let nombre = c.paginaId
    try {
      nombre = String((await graphSistema(c, `/${c.paginaId}?fields=id,name`)).name || c.paginaId)
      // 1) Suscribir (parámetros en el cuerpo, como formulario)
      await graphPagina(c, `/${c.paginaId}/subscribed_apps`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ subscribed_fields: 'leadgen' }).toString() })
      // 2) Verificar: la app de este token debe aparecer suscrita con «leadgen»
      let appId = '', appNombre = ''
      try { const a = await graphSistema(c, '/app?fields=id,name'); appId = String(a?.id || ''); appNombre = String(a?.name || '') } catch { /* sin /app: se verifica por el campo */ }
      const lista = ((await graphPagina(c, `/${c.paginaId}/subscribed_apps`)).data ?? []) as { id?: string; name?: string; subscribed_fields?: (string | { name?: string })[] }[]
      const conLeadgen = (x: (typeof lista)[number]) => (x.subscribed_fields ?? []).some((f) => (typeof f === 'string' ? f : f?.name) === 'leadgen')
      const nuestra = appId ? lista.find((x) => String(x.id) === appId) : lista.find(conLeadgen)
      if (!nuestra) return { ok: false, mensaje: `Se suscribió la página «${nombre}», pero Meta no muestra ${appNombre ? 'la app «' + appNombre + '»' : 'la app'} en sus aplicaciones suscritas. Revisa que el usuario del sistema tenga asignada la app.` }
      if (!conLeadgen(nuestra)) return { ok: false, mensaje: `La app «${nuestra.name || appNombre}» está suscrita a la página «${nombre}», pero sin el campo «leadgen». Vuelve a pulsar «Probar conexión».` }
      return { ok: true, mensaje: `Conexión correcta · página «${nombre}» · la app «${nuestra.name || appNombre || 'de Meta'}» recibe los formularios (leadgen).` }
    } catch (e) {
      return { ok: false, mensaje: `Página «${nombre}»: ${(e as Error).message}` }
    }
  }
  /** Ajustes del correo al asesor (Marketing › Configuración › Meta). Activo por defecto, diseño 1 «Alerta urgente». */
  const ajustesCorreo = (c: Conf) => {
    const k = (c.config.correo ?? {}) as { activo?: boolean; diseno?: number; copia?: string }
    const copia = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(k.copia || '').trim()) ? String(k.copia).trim() : ''
    return { activo: k.activo !== false, diseno: [1, 2, 3].includes(Number(k.diseno)) ? Number(k.diseno) : 1, copia, crmUrl: (/^https:\/\/[\w.-]+/.test(String(c.config.appUrl || '')) ? String(c.config.appUrl).replace(/\/+$/, '') : 'https://qa.vimedic.com.ec') + '/#crm' }
  }
  let ultimoErrorCorreo = ''
  /** Correo URGENTE al asesor que recibió el lead (CorreoLeadsMeta.gs). Si no sale, el lead igual queda en el CRM y con aviso en la campana. */
  const correoAsesor = async (c: Conf, lead: { id: string; codigo: string; asesor_id: string | null; asignacion: string | null }, fila: Record<string, unknown>) => {
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
    catch (e) { ultimoErrorCorreo = (e as Error).message; console.error('[meta-leads] correo al asesor: ' + ultimoErrorCorreo) }
  }
  /** Crea el lead en el CRM (si ya estaba, no hace nada) y avisa por correo al asesor. */
  const registrar = async (c: Conf, L: LeadMeta, formulario: string): Promise<'nuevo' | 'ya' | 'prueba'> => {
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

  try {
    const u = new URL(req.url)
    /* ---------- Verificación del webhook (Meta, al guardar la URL de devolución) ---------- */
    if (req.method === 'GET') {
      const c = await conf()
      const ok = u.searchParams.get('hub.mode') === 'subscribe' && !!c.config.verifyToken && igual(String(u.searchParams.get('hub.verify_token') || ''), String(c.config.verifyToken))
      return ok ? new Response(String(u.searchParams.get('hub.challenge') || ''), { status: 200, headers: { 'Content-Type': 'text/plain' } }) : new Response('Forbidden', { status: 403 })
    }

    /* ---------- Webhook «leadgen» de Meta ---------- */
    const firma = req.headers.get('x-hub-signature-256')
    if (firma) {
      const cuerpo = await req.text()
      const c = await conf()
      // Sin configurar todavía: error para que Meta reintente más tarde (no se pierde el lead).
      if (!c.token || !c.appSecret) return responder({ error: 'Conexión de Meta sin configurar.' }, 503)
      if (!igual(firma.replace(/^sha256=/, '').toLowerCase(), await hmacHex(c.appSecret, cuerpo))) return responder({ error: 'Firma no válida.' }, 401)
      const b = JSON.parse(cuerpo || '{}')
      const avisos: { id: string; form?: string }[] = []
      for (const e of (Array.isArray(b.entry) ? b.entry : [])) for (const ch of (Array.isArray(e?.changes) ? e.changes : [])) {
        if (ch?.field === 'leadgen' && ch.value?.leadgen_id) avisos.push({ id: String(ch.value.leadgen_id), form: ch.value.form_id ? String(ch.value.form_id) : undefined })
      }
      let fallos = 0, nuevos = 0, pruebas = 0
      for (const a of avisos) {
        try {
          if (!/^\d{5,30}$/.test(a.id)) continue
          const L = await graphPagina(c, `/${a.id}?fields=${CAMPOS_LEAD}`) as LeadMeta
          const r = await registrar(c, L, await nombreFormulario(c, L.form_id || a.form))
          if (r === 'nuevo') nuevos++; else if (r === 'prueba') pruebas++
        } catch (e) { fallos++; console.error('[meta-leads] lead ' + a.id + ': ' + (e as Error).message) }
      }
      if (pruebas) await estado('ok: Lead de prueba de Meta recibido el ' + fechaEc() + ' (no entra al CRM).')
      else if (nuevos) await estado('ok: Último lead recibido el ' + fechaEc() + '.' + (ultimoErrorCorreo ? ' El correo al asesor no salió: ' + ultimoErrorCorreo : ''))
      else if (fallos) await estado('error: No se pudo leer un lead de Meta (' + fechaEc() + '). Revisa el token y el acceso a clientes potenciales.')
      // Si alguno falló, Meta lo vuelve a enviar (no se duplica: meta_lead_id es único).
      return responder({ ok: fallos === 0, recibidos: avisos.length, nuevos }, fallos ? 500 : 200)
    }

    /* ---------- Acciones desde la app (Marketing › Configuración) ---------- */
    const usuario = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: us } = await usuario.auth.getUser()
    if (!us?.user) throw new Falla('Sesión no válida.', 401)
    if ((await usuario.rpc('marketing_puede', { p_accion: 'administrar' })).data !== true) throw new Falla('Solo quien administra Marketing puede usar esta conexión.', 403)
    const b = await req.json().catch(() => ({}))
    const accion = String(b.accion || '')
    const c = await conf()

    /* Correo al asesor: ver los 3 diseños (con un cliente de ejemplo) y enviarse uno de prueba. No necesitan Meta conectado. */
    if (accion === 'correo_vista' || accion === 'correo_prueba') {
      const { data: yo } = await admin.from('empleados').select('nombre,email').eq('auth_user_id', us.user.id).is('deleted_at', null).maybeSingle()
      const ej = ejemploCorreoLead(String(yo?.nombre || ''))
      const k = ajustesCorreo(c)
      if (accion === 'correo_vista') {
        const logos = { color: 'data:image/png;base64,' + LOGO_COLOR_PNG, blanco: 'data:image/png;base64,' + LOGO_BLANCO_PNG }
        return responder({ disenos: [1, 2, 3].map((n) => ({ n, nombre: DISENOS_CORREO[n], ...correoLeadAsesor(ej, n, k.crmUrl, logos) })) })
      }
      const para = String(yo?.email || us.user.email || '')
      if (!para) throw new Falla('Tu usuario no tiene correo en Empleados.')
      const disenos = [1, 2, 3].includes(Number(b.diseno)) ? [Number(b.diseno)] : [1, 2, 3]
      for (const n of disenos) {
        const m = correoLeadAsesor(ej, n, k.crmUrl)
        try { await enviarGmail(admin, { para, asunto: '[Prueba · diseño ' + n + ' · ' + DISENOS_CORREO[n] + '] ' + m.asunto, html: m.html, texto: m.texto }) }
        catch (e) { throw new Falla((e as Error).message) }
      }
      return responder({ ok: true, para, enviados: disenos.length })
    }

    /* Token de verificación del webhook: lo crea el servidor UNA sola vez y no cambia nunca (si cambiara, el webhook ya
       configurado en Meta dejaría de verificar). La pantalla lo pide al abrirse. */
    if (accion === 'preparar') {
      let vt = String(c.config.verifyToken || '')
      if (!vt) {
        vt = 'vm-' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)
        const { data: fila } = await admin.from('integraciones').select('id,config').eq('proveedor', 'meta_leads').maybeSingle()
        if (fila) {
          const actual = (fila.config ?? {}) as Record<string, unknown>
          if (actual.verifyToken) vt = String(actual.verifyToken) // otro guardado se adelantó: se respeta
          else await admin.from('integraciones').update({ config: { ...actual, verifyToken: vt }, deleted_at: null }).eq('id', fila.id)
        } else await admin.from('integraciones').insert({ proveedor: 'meta_leads', config: { verifyToken: vt } })
      }
      return responder({ verifyToken: vt })
    }

    /* Guardar: combina con lo que ya hay. Lo que no se envía se conserva: token y clave secreta (si los campos van vacíos),
       token de verificación (nunca se cambia desde aquí), diseño y copia del correo. Después conecta y verifica la página. */
    if (accion === 'guardar') {
      const paginaId = String(b.paginaId ?? c.paginaId).replace(/\D/g, '')
      if (!/^\d{5,30}$/.test(paginaId)) throw new Falla('Pon el ID de la página de Facebook (solo números).')
      const tokenNuevo = String(b.token || '').trim(), secretoNuevo = String(b.appSecret || '').trim()
      const token = tokenNuevo || c.token, appSecret = secretoNuevo || c.appSecret
      if (!token || !appSecret) throw new Falla('Pega el token de acceso y la clave secreta de la app (la primera vez van los dos).')
      const correoAntes = (c.config.correo ?? {}) as Record<string, unknown>, correoNuevo = (b.correo && typeof b.correo === 'object' ? b.correo : {}) as Record<string, unknown>
      const correo = {
        activo: typeof correoNuevo.activo === 'boolean' ? correoNuevo.activo : correoAntes.activo !== false,
        diseno: [1, 2, 3].includes(Number(correoNuevo.diseno)) ? Number(correoNuevo.diseno) : [1, 2, 3].includes(Number(correoAntes.diseno)) ? Number(correoAntes.diseno) : 1,
        copia: typeof correoNuevo.copia === 'string' ? correoNuevo.copia.trim().slice(0, 200) : String(correoAntes.copia ?? ''),
      }
      const config = {
        ...c.config, paginaId,
        empresa: b.empresa === 'FEMEDICS' ? 'FEMEDICS' : b.empresa === 'VIMEDIC' ? 'VIMEDIC' : c.empresa,
        appUrl: /^https:\/\/[\w.-]+$/.test(String(b.appUrl || '')) ? String(b.appUrl) : c.config.appUrl,
        verifyToken: c.config.verifyToken || 'vm-' + crypto.randomUUID().replace(/-/g, '').slice(0, 24),
        correo,
      }
      const cambiaSecreto = !!tokenNuevo || !!secretoNuevo
      const { error } = await usuario.rpc('integracion_guardar', { p_proveedor: 'meta_leads', p_secreto: cambiaSecreto ? JSON.stringify({ token, appSecret }) : null, p_config: config })
      if (error) throw new Falla('No se pudo guardar: ' + error.message)
      const r = await conectarPagina({ ...c, config, token, appSecret, paginaId, empresa: config.empresa as string })
      await estado((r.ok ? 'ok: ' : 'error: ') + r.mensaje)
      return responder({ ...r, guardado: true })
    }

    if (!c.token || !c.appSecret) throw new Falla('Falta guardar el token y la clave secreta de la app.')
    if (!/^\d{5,30}$/.test(c.paginaId)) throw new Falla('Falta el ID de la página de Facebook.')

    if (accion === 'probar') {
      const r = await conectarPagina(c)
      await estado((r.ok ? 'ok: ' : 'error: ') + r.mensaje)
      return responder(r)
    }

    if (accion === 'traer') {
      const dias = Math.max(1, Math.min(90, Number(b.dias) || 7))
      const desde = Math.floor(Date.now() / 1000) - dias * 86400
      const filtro = encodeURIComponent(JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: desde }]))
      const forms = ((await graphPagina(c, `/${c.paginaId}/leadgen_forms?fields=id,name&limit=100`)).data ?? []) as { id: string; name: string }[]
      let nuevos = 0, ya = 0, pruebas = 0, fallos = 0
      for (const f of forms) {
        let ruta: string | null = `/${f.id}/leads?fields=${CAMPOS_LEAD}&limit=100&filtering=${filtro}`
        for (let pag = 0; ruta && pag < 10; pag++) {
          const r: Cualquiera = await graphPagina(c, ruta)
          for (const L of (r.data ?? []) as LeadMeta[]) {
            try { const x = await registrar(c, L, f.name || ''); if (x === 'nuevo') nuevos++; else if (x === 'ya') ya++; else pruebas++ } catch { fallos++ }
          }
          const sig = String(r.paging?.next || '')
          // La página siguiente trae el token y la prueba en la URL: se quitan (el token va en el encabezado y la prueba se recalcula).
          ruta = sig ? sig.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, '').replace(/([?&])(access_token|appsecret_proof)=[^&]*/g, '$1').replace(/([?&])&+/g, '$1').replace(/[?&]+$/, '') : null
        }
      }
      return responder({ ok: true, formularios: forms.length, nuevos, ya, pruebas, fallos, dias })
    }

    throw new Falla('Acción no válida.')
  } catch (e) {
    const f = e instanceof Falla ? e : new Falla((e as Error).message || 'Error inesperado.', 500)
    return responder({ error: f.message }, f.status)
  }
})
