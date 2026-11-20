// Edge Function: Meta Lead Ads → CRM (reemplaza la hoja «Clientes Potenciales Meta» + LeadsMeta.gs).
//   · GET  ?hub.mode=subscribe…   verificación del webhook (token de verificación de Marketing › Configuración).
//   · POST con X-Hub-Signature-256 webhook «leadgen» de Meta: se valida la firma con la clave secreta de la app,
//          se lee el lead en la Graph API (token de página) y se procesa con la lógica compartida
//          (../_shared/metaServidor.ts › procesarLead, la misma que usa la sincronización meta-leads-poll).
//   · POST con sesión (Marketing › Configuración, quien administra): «preparar» (token de verificación), «guardar»,
//          «probar» (suscribe la página y verifica), «correo_vista» y «correo_prueba».
//          «Traer leads» y la sincronización automática viven en meta-leads-poll.
// El token y la clave secreta viven cifrados en Vault (integraciones 'meta_leads'); nunca van al navegador ni a los registros.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { CAMPOS_LEAD, type LeadMeta } from '../_shared/metaLeads.ts'
import { correoLeadAsesor, DISENOS_CORREO, ejemploCorreoLead } from '../_shared/correoLeads.ts'
import { enviarGmail } from '../_shared/gmail.ts'
import { LOGO_BLANCO_PNG, LOGO_COLOR_PNG } from '../_shared/logosCorreo.ts'
import { Falla, fechaEc, hmacHex, igual, servicioMeta, type ConfMeta } from '../_shared/metaServidor.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const responder = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, srv)
  const m = servicioMeta(admin)

  /** Suscribe la página a la app (campo leadgen) con el token de página y verifica que quedó. Devuelve el estado para la UI. */
  const conectarPagina = async (c: ConfMeta): Promise<{ ok: boolean; mensaje: string }> => {
    let nombre = c.paginaId
    try {
      nombre = String((await m.graphSistema(c, `/${c.paginaId}?fields=id,name`)).name || c.paginaId)
      // 1) Suscribir (parámetros en el cuerpo, como formulario)
      await m.graphPagina(c, `/${c.paginaId}/subscribed_apps`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ subscribed_fields: 'leadgen' }).toString() })
      // 2) Verificar: la app de este token debe aparecer suscrita con «leadgen»
      let appId = '', appNombre = ''
      try { const a = await m.graphSistema(c, '/app?fields=id,name'); appId = String(a?.id || ''); appNombre = String(a?.name || '') } catch { /* sin /app: se verifica por el campo */ }
      const lista = ((await m.graphPagina(c, `/${c.paginaId}/subscribed_apps`)).data ?? []) as { id?: string; name?: string; subscribed_fields?: (string | { name?: string })[] }[]
      const conLeadgen = (x: (typeof lista)[number]) => (x.subscribed_fields ?? []).some((f) => (typeof f === 'string' ? f : f?.name) === 'leadgen')
      const nuestra = appId ? lista.find((x) => String(x.id) === appId) : lista.find(conLeadgen)
      if (!nuestra) return { ok: false, mensaje: `Se suscribió la página «${nombre}», pero Meta no muestra ${appNombre ? 'la app «' + appNombre + '»' : 'la app'} en sus aplicaciones suscritas. Revisa que el usuario del sistema tenga asignada la app.` }
      if (!conLeadgen(nuestra)) return { ok: false, mensaje: `La app «${nuestra.name || appNombre}» está suscrita a la página «${nombre}», pero sin el campo «leadgen». Vuelve a pulsar «Probar conexión».` }
      return { ok: true, mensaje: `Conexión correcta · página «${nombre}» · la app «${nuestra.name || appNombre || 'de Meta'}» recibe los formularios (leadgen).` }
    } catch (e) {
      return { ok: false, mensaje: `Página «${nombre}»: ${(e as Error).message}` }
    }
  }

  try {
    const u = new URL(req.url)
    /* ---------- Verificación del webhook (Meta, al guardar la URL de devolución) ---------- */
    if (req.method === 'GET') {
      const c = await m.conf()
      const ok = u.searchParams.get('hub.mode') === 'subscribe' && !!c.config.verifyToken && igual(String(u.searchParams.get('hub.verify_token') || ''), String(c.config.verifyToken))
      return ok ? new Response(String(u.searchParams.get('hub.challenge') || ''), { status: 200, headers: { 'Content-Type': 'text/plain' } }) : new Response('Forbidden', { status: 403 })
    }

    /* ---------- Webhook «leadgen» de Meta ---------- */
    const firma = req.headers.get('x-hub-signature-256')
    if (firma) {
      const cuerpo = await req.text()
      const c = await m.conf()
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
          const L = await m.graphPagina(c, `/${a.id}?fields=${CAMPOS_LEAD}`) as LeadMeta
          const r = await m.procesarLead(c, L, await m.nombreFormulario(c, L.form_id || a.form))
          if (r === 'nuevo') nuevos++; else if (r === 'prueba') pruebas++
        } catch (e) { fallos++; console.error('[meta-leads] lead ' + a.id + ': ' + (e as Error).message) }
      }
      if (pruebas) await m.estado('ok: Lead de prueba de Meta recibido el ' + fechaEc() + ' (no entra al CRM).')
      else if (nuevos) await m.estado('ok: Último lead recibido el ' + fechaEc() + '.' + (m.errorCorreo() ? ' El correo al asesor no salió: ' + m.errorCorreo() : ''))
      else if (fallos) await m.estado('error: No se pudo leer un lead de Meta (' + fechaEc() + '). Revisa el token y el acceso a clientes potenciales.')
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
    const c = await m.conf()

    /* Correo al asesor: ver los 3 diseños (con un cliente de ejemplo) y enviarse uno de prueba. No necesitan Meta conectado. */
    if (accion === 'correo_vista' || accion === 'correo_prueba') {
      const { data: yo } = await admin.from('empleados').select('nombre,email').eq('auth_user_id', us.user.id).is('deleted_at', null).maybeSingle()
      const ej = ejemploCorreoLead(String(yo?.nombre || ''))
      const k = m.ajustesCorreo(c)
      if (accion === 'correo_vista') {
        const logos = { color: 'data:image/png;base64,' + LOGO_COLOR_PNG, blanco: 'data:image/png;base64,' + LOGO_BLANCO_PNG }
        return responder({ disenos: [1, 2, 3].map((n) => ({ n, nombre: DISENOS_CORREO[n], ...correoLeadAsesor(ej, n, k.crmUrl, logos) })) })
      }
      const para = String(yo?.email || us.user.email || '')
      if (!para) throw new Falla('Tu usuario no tiene correo en Empleados.')
      const disenos = [1, 2, 3].includes(Number(b.diseno)) ? [Number(b.diseno)] : [1, 2, 3]
      for (const n of disenos) {
        const x = correoLeadAsesor(ej, n, k.crmUrl)
        try { await enviarGmail(admin, { para, asunto: '[Prueba · diseño ' + n + ' · ' + DISENOS_CORREO[n] + '] ' + x.asunto, html: x.html, texto: x.texto }) }
        catch (e) { throw new Falla((e as Error).message) }
      }
      return responder({ ok: true, para, enviados: disenos.length })
    }

    /* Token de verificación del webhook: lo crea el servidor UNA sola vez y no cambia nunca. */
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

    /* Guardar: combina con lo que ya hay (campos vacíos no borran Vault; el token de verificación no cambia; diseño y
       copia del correo y el ajuste de sincronización se conservan). Después conecta y verifica la página. */
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
      // Primera conexión: la sincronización automática cada 5 min (meta-leads-poll) queda encendida por defecto.
      if (typeof (c.config.sync as { activo?: unknown } | undefined)?.activo !== 'boolean') {
        const { error: eSync } = await usuario.rpc('meta_poll_programar', { p_activo: true, p_url: url.replace(/\/+$/, '') + '/functions/v1/meta-leads-poll' })
        if (eSync) console.error('[meta-leads] sincronización automática: ' + eSync.message)
      }
      const r = await conectarPagina({ ...c, config, token, appSecret, paginaId, empresa: config.empresa as string })
      await m.estado((r.ok ? 'ok: ' : 'error: ') + r.mensaje)
      return responder({ ...r, guardado: true })
    }

    if (!c.token || !c.appSecret) throw new Falla('Falta guardar el token y la clave secreta de la app.')
    if (!/^\d{5,30}$/.test(c.paginaId)) throw new Falla('Falta el ID de la página de Facebook.')

    if (accion === 'probar') {
      const r = await conectarPagina(c)
      await m.estado((r.ok ? 'ok: ' : 'error: ') + r.mensaje)
      return responder(r)
    }

    throw new Falla('Acción no válida.')
  } catch (e) {
    const f = e instanceof Falla ? e : new Falla((e as Error).message || 'Error inesperado.', 500)
    return responder({ error: f.message }, f.status)
  }
})

