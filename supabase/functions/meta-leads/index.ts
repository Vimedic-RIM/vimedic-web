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
  /** Graph API con el token en el encabezado (no en la URL) y appsecret_proof (por si la app lo exige). */
  const graph = async (c: Conf, ruta: string, init: RequestInit = {}) => {
    const prueba = await hmacHex(c.appSecret, c.token)
    const r = await fetch(GRAPH + ruta + (ruta.includes('?') ? '&' : '?') + 'appsecret_proof=' + prueba, { ...init, headers: { Authorization: 'Bearer ' + c.token, ...(init.headers ?? {}) } })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j?.error) throw new Falla('Meta respondió: ' + String(j?.error?.message || 'código ' + r.status))
    return j as Cualquiera
  }
  const estado = (texto: string) => admin.from('integraciones').update({ estado_prueba: texto, probado_en: new Date().toISOString() }).eq('proveedor', 'meta_leads')
  const formularios = new Map<string, string>()
  const nombreFormulario = async (c: Conf, id?: string) => {
    if (!id) return ''
    if (!formularios.has(id)) { try { formularios.set(id, String((await graph(c, `/${id}?fields=name`)).name || '')) } catch { formularios.set(id, '') } }
    return formularios.get(id) ?? ''
  }
  /** Crea el lead en el CRM (si ya estaba, no hace nada). */
  const registrar = async (c: Conf, L: LeadMeta, formulario: string): Promise<'nuevo' | 'ya' | 'prueba'> => {
    const { esPrueba, fila, resumen } = armarLead(L, formulario, c.empresa)
    if (esPrueba) return 'prueba'
    const { data, error } = await admin.from('leads').upsert(fila, { onConflict: 'meta_lead_id', ignoreDuplicates: true }).select('id,codigo')
    if (error) throw new Falla('No se pudo guardar el lead: ' + error.message, 500)
    const nuevo = (data ?? [])[0] as { id: string; codigo: string } | undefined
    if (!nuevo) return 'ya'
    await admin.from('interacciones').insert({
      codigo: 'INT-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8), ref_tipo: 'Contacto', ref_codigo: nuevo.codigo, lead_id: nuevo.id,
      tipo: 'Sistema', nota: resumen.slice(0, 3000), usuario_texto: 'Leads Meta',
    })
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
          const L = await graph(c, `/${a.id}?fields=${CAMPOS_LEAD}`) as LeadMeta
          const r = await registrar(c, L, await nombreFormulario(c, L.form_id || a.form))
          if (r === 'nuevo') nuevos++; else if (r === 'prueba') pruebas++
        } catch (e) { fallos++; console.error('[meta-leads] lead ' + a.id + ': ' + (e as Error).message) }
      }
      if (pruebas) await estado('ok: Lead de prueba de Meta recibido el ' + fechaEc() + ' (no entra al CRM).')
      else if (nuevos) await estado('ok: Último lead recibido el ' + fechaEc() + '.')
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
    if (!c.token || !c.appSecret) throw new Falla('Falta guardar el token y la clave secreta de la app.')
    if (!/^\d{5,30}$/.test(c.paginaId)) throw new Falla('Falta el ID de la página de Facebook.')

    if (accion === 'probar') {
      let ok = false, mensaje = ''
      try {
        const p = await graph(c, `/${c.paginaId}?fields=id,name`)
        // Suscribir la página a la app para recibir «leadgen» (si ya estaba, Meta lo deja igual).
        let suscrita = false, motivo = ''
        try { const s = await graph(c, `/${c.paginaId}/subscribed_apps?subscribed_fields=leadgen`, { method: 'POST' }); suscrita = s?.success === true } catch (e) { motivo = (e as Error).message }
        ok = suscrita
        mensaje = suscrita ? `Conexión correcta · página «${p.name}» · recibiendo clientes potenciales.` : `Se leyó la página «${p.name}», pero no se pudo suscribir a los formularios: ${motivo}`
      } catch (e) { mensaje = (e as Error).message }
      await estado((ok ? 'ok: ' : 'error: ') + mensaje)
      return responder({ ok, mensaje })
    }

    if (accion === 'traer') {
      const dias = Math.max(1, Math.min(90, Number(b.dias) || 7))
      const desde = Math.floor(Date.now() / 1000) - dias * 86400
      const filtro = encodeURIComponent(JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: desde }]))
      const forms = ((await graph(c, `/${c.paginaId}/leadgen_forms?fields=id,name&limit=100`)).data ?? []) as { id: string; name: string }[]
      let nuevos = 0, ya = 0, pruebas = 0, fallos = 0
      for (const f of forms) {
        let ruta: string | null = `/${f.id}/leads?fields=${CAMPOS_LEAD}&limit=100&filtering=${filtro}`
        for (let pag = 0; ruta && pag < 10; pag++) {
          const r: Cualquiera = await graph(c, ruta)
          for (const L of (r.data ?? []) as LeadMeta[]) {
            try { const x = await registrar(c, L, f.name || ''); if (x === 'nuevo') nuevos++; else if (x === 'ya') ya++; else pruebas++ } catch { fallos++ }
          }
          const sig = String(r.paging?.next || '')
          ruta = sig ? sig.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, '').replace(/([?&])access_token=[^&]*&?/, '$1') : null
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
