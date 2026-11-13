// Edge Function: Mensajes del CRM (Messenger / Instagram / WhatsApp vía Zernio).
// Equivale a "Mensajeria meta.gs" del original: bandeja, historial con adjuntos, responder
// (con reintento HUMAN_AGENT fuera de la ventana de 24 h de Facebook), marcar leída,
// reasignar conversaciones y redactar una respuesta con IA (Gemini).
// La clave de Zernio y la de Gemini viven cifradas en Vault (se conectan en Marketing › Configuración).
// También recibe el webhook de Zernio (firma HMAC-SHA256 en X-Zernio-Signature), cosa que Apps Script no podía verificar.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-zernio-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const ZERNIO = 'https://zernio.com/api/v1'
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'
const responder = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
class Falla extends Error { constructor(m: string, public status = 400) { super(m) } }
// deno-lint-ignore no-explicit-any
type Cualquiera = any

const canalDe = (p: string) => ({ facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp', telegram: 'Telegram', twitter: 'Twitter' } as Record<string, string>)[String(p || '').toLowerCase()] || (p ? String(p) : 'Facebook')

async function hmacHex(secreto: string, cuerpo: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const firma = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(cuerpo))
  return Array.from(new Uint8Array(firma)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, srv)

  const credencial = async (proveedor: string) => {
    const [{ data: config }, { data: secreto }] = await Promise.all([
      admin.from('integraciones').select('config').eq('proveedor', proveedor).is('deleted_at', null).maybeSingle(),
      admin.rpc('integracion_secreto', { p_proveedor: proveedor }),
    ])
    if (!secreto) throw new Falla(proveedor === 'zernio' ? 'Zernio no está conectado. Pídele a Marketing que lo conecte en Marketing › Configuración.' : 'La IA (Gemini) no está conectada. Se conecta en Marketing › Configuración.')
    return { secreto: secreto as string, config: (config?.config ?? {}) as Record<string, unknown> }
  }
  const zernio = async (ruta: string, init: RequestInit = {}) => {
    const c = await credencial('zernio')
    const r = await fetch(ZERNIO + ruta, { ...init, headers: { Authorization: 'Bearer ' + c.secreto, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } })
    const t = await r.text(); let j: Cualquiera = null; try { j = t ? JSON.parse(t) : null } catch { /* texto */ }
    return { ok: r.ok, status: r.status, data: j, texto: t }
  }

  try {
    /* ---------------- Webhook de Zernio (sin sesión: se valida la firma) ---------------- */
    if (new URL(req.url).searchParams.get('webhook') === '1') {
      const cuerpo = await req.text()
      const { config } = await credencial('zernio').catch(() => ({ config: {} as Record<string, unknown> }))
      const secretoWebhook = String(config.webhookSecret || '')
      if (!secretoWebhook) throw new Falla('Webhook sin configurar.', 403)
      const firma = String(req.headers.get('x-zernio-signature') || '').replace(/^sha256=/, '').toLowerCase()
      if (!firma || firma !== (await hmacHex(secretoWebhook, cuerpo))) throw new Falla('Firma no válida.', 401)
      const b = JSON.parse(cuerpo || '{}')
      const m = b.data?.message ?? b.message ?? b.data ?? {}
      const convId = String(m.conversationId || b.data?.conversationId || b.conversationId || '')
      if (!convId) return responder({ ok: true, ignorado: true })
      await admin.from('mensajes').upsert({
        zernio_id: m.id ? String(m.id) : null, conversacion_id: convId, cuenta_id: m.accountId ?? null, canal: canalDe(m.platform || b.data?.platform),
        nombre_contacto: m.sender?.name || m.participantName || null, direccion: String(m.direction || '').toLowerCase() === 'outgoing' ? 'saliente' : 'entrante',
        texto: m.message || m.text || (m.attachments?.length ? '[Multimedia]' : ''), fecha: m.createdAt || new Date().toISOString(), leido: false, payload: b,
      }, { onConflict: 'zernio_id' })
      return responder({ ok: true })
    }

    /* ---------------- Acciones de la app (con sesión) ---------------- */
    const usuario = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: u } = await usuario.auth.getUser()
    if (!u?.user) throw new Falla('Sesión no válida.', 401)
    const b = await req.json().catch(() => ({}))
    const accion = String(b.accion || '')
    const { data: perfil } = await usuario.rpc('mi_perfil')
    if (!perfil) throw new Falla('Tu cuenta no está vinculada a un empleado activo.', 403)
    const permisos = (perfil.permisos ?? {}) as Record<string, string[]>
    const tiene = (m: string, a: string) => !!perfil.es_superadmin || (permisos[m] ?? []).includes(a)
    if (!tiene('crm', 'ver') && !tiene('femedics', 'ver')) throw new Falla('Sin acceso al CRM.', 403)
    const veTodos = tiene('crm', 'ver_todos') || tiene('femedics', 'ver_todos')
    const yo = String(perfil.id)

    // Asignaciones: conversación → asesor. Un asesor ve las suyas y las de su equipo; quien tiene ver_todos ve todas.
    const asignaciones = async () => {
      const { data } = await admin.from('asignacion_conversaciones').select('conversacion_id,asesor_id,asesor:empleados!asesor_id(nombre)').is('deleted_at', null).limit(5000)
      return new Map(((data ?? []) as Cualquiera[]).map((a) => [String(a.conversacion_id), { id: a.asesor_id as string | null, nombre: (a.asesor?.nombre ?? '') as string }]))
    }
    const equipo = async (): Promise<Set<string>> => {
      if (veTodos) return new Set()
      const { data } = await admin.from('empleados').select('id,jefe_id').is('deleted_at', null)
      const hijos = new Map<string, string[]>()
      ;((data ?? []) as Cualquiera[]).forEach((e) => { if (e.jefe_id) hijos.set(e.jefe_id, [...(hijos.get(e.jefe_id) ?? []), e.id]) })
      const set = new Set([yo]), cola = [yo]
      while (cola.length) { const x = cola.pop()!; for (const h of hijos.get(x) ?? []) if (!set.has(h)) { set.add(h); cola.push(h) } }
      return set
    }
    const puedeVer = async (convId: string) => {
      if (veTodos) return true
      const a = (await asignaciones()).get(convId)
      return !!a?.id && (await equipo()).has(a.id)
    }
    const listarConversaciones = async () => {
      const todas: Cualquiera[] = []
      let cursor = ''
      for (let i = 0; i < 5; i++) {
        const r = await zernio('/inbox/conversations?limit=100&sortOrder=desc' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
        if (!r.ok) throw new Falla(`Zernio no respondió (código ${r.status}).`, 502)
        todas.push(...(Array.isArray(r.data?.data) ? r.data.data : []))
        cursor = r.data?.pagination?.hasMore ? r.data.pagination.nextCursor || '' : ''
        if (!cursor) break
      }
      return todas
    }

    if (accion === 'bandeja') {
      const [convs, mapa, miEquipo, locales] = await Promise.all([
        listarConversaciones(), asignaciones(), equipo(),
        admin.from('mensajes').select('conversacion_id').eq('direccion', 'entrante').eq('leido', false).is('deleted_at', null).limit(5000),
      ])
      const sinLeer = new Map<string, number>()
      ;((locales.data ?? []) as Cualquiera[]).forEach((m) => sinLeer.set(m.conversacion_id, (sinLeer.get(m.conversacion_id) ?? 0) + 1))
      const lista = convs.map((c) => {
        const a = mapa.get(String(c.id))
        return {
          id: String(c.id), cuenta: String(c.accountId || ''), canal: canalDe(c.platform), plataforma: String(c.platform || ''),
          nombre: c.participantName || c.participantUsername || c.participantId || 'Sin nombre', foto: c.participantAvatar || c.participantPictureUrl || c.avatarUrl || c.profilePictureUrl || '',
          perfilUrl: c.participantProfileUrl || c.profileUrl || '', ultimo: c.lastMessage || '', fecha: c.updatedTime || '',
          sinLeer: sinLeer.get(String(c.id)) ?? Number(c.unreadCount || 0), asesorId: a?.id ?? null, asesor: a?.nombre ?? '',
        }
      }).filter((c) => veTodos || (!!c.asesorId && miEquipo.has(c.asesorId)))
      let asesores: { id: string; nombre: string }[] = []
      if (veTodos) {
        const { data } = await admin.from('empleados').select('id,nombre').eq('estado', 'activo').is('deleted_at', null).or('recibe_leads_mensajes.eq.true,recibe_leads.eq.true').order('nombre')
        asesores = (data ?? []) as { id: string; nombre: string }[]
      }
      return responder({ conversaciones: lista, veTodos, asesores })
    }

    const convId = String(b.conversacion || '')
    const cuenta = String(b.cuenta || '')
    if (!convId) throw new Falla('Falta la conversación.')
    if (!(await puedeVer(convId))) throw new Falla('Esta conversación está asignada a otro asesor.', 403)

    if (accion === 'historial') {
      if (!cuenta) throw new Falla('Falta la cuenta de la conversación.')
      const mensajes: Cualquiera[] = [], vistos = new Set<string>()
      let cursor = ''
      for (let p = 0; p < 6; p++) {
        const r = await zernio(`/inbox/conversations/${encodeURIComponent(convId)}/messages?accountId=${encodeURIComponent(cuenta)}&limit=100&sortOrder=desc` + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
        if (!r.ok) { if (p > 0) break; throw new Falla(`No se pudieron cargar los mensajes (Zernio ${r.status}).`, 502) }
        const lote = Array.isArray(r.data?.messages) ? r.data.messages : []
        let nuevos = 0
        for (const m of lote) { const k = String(m.id || m.createdAt + '|' + (m.message || '')); if (vistos.has(k)) continue; vistos.add(k); mensajes.push(m); nuevos++ }
        cursor = r.data?.pagination?.hasMore ? r.data.pagination.nextCursor || '' : ''
        if (!cursor || !nuevos || lote.length < 100) break
      }
      const salida = mensajes.map((m) => ({
        id: String(m.id || ''), saliente: String(m.direction || '').toLowerCase() === 'outgoing', fecha: m.createdAt || '',
        texto: m.message || ((m.attachments ?? []).length ? '[Multimedia]' : ''),
        adjuntos: ((m.attachments ?? []) as Cualquiera[]).map((a, i) => ({ indice: i, tipo: a.type || a.originalType || 'file', nombre: a.filename || '', vista: a.previewUrl || '', url: a.url || '' })),
      })).sort((x, y) => (x.fecha < y.fecha ? -1 : 1))
      const ultEntrante = [...salida].reverse().find((m) => !m.saliente)
      const hasta = ultEntrante?.fecha ? new Date(ultEntrante.fecha).getTime() + 86400000 : 0
      return responder({ mensajes: salida, ventana: ultEntrante ? { puedeResponder: Date.now() <= hasta, hasta: new Date(hasta).toISOString() } : null })
    }

    if (accion === 'adjunto') {
      const r = await zernio(`/inbox/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(String(b.mensaje || ''))}/attachments/${Number(b.indice || 0)}?accountId=${encodeURIComponent(cuenta)}&format=json`)
      if (!r.ok || !r.data?.url) throw new Falla('No se pudo abrir el archivo (Zernio ' + r.status + ').', 502)
      return responder({ url: r.data.url })
    }

    if (accion === 'enviar') {
      const texto = String(b.texto || '').trim().slice(0, 2000)
      if (!texto || !cuenta) throw new Falla('Falta el texto o la cuenta.')
      const ruta = `/inbox/conversations/${encodeURIComponent(convId)}/messages`
      let r = await zernio(ruta, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ accountId: cuenta, message: texto, messagingType: 'RESPONSE' }) })
      // Fuera de la ventana de 24 h, Facebook solo acepta la etiqueta HUMAN_AGENT (igual que el original).
      if (!r.ok && String(b.plataforma || '').toLowerCase() === 'facebook') {
        r = await zernio(ruta, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ accountId: cuenta, message: texto, messagingType: 'MESSAGE_TAG', messageTag: 'HUMAN_AGENT' }) })
      }
      if (!r.ok) throw new Falla('Zernio no envió el mensaje: ' + (r.data?.error || r.data?.message || r.status), 502)
      await admin.from('mensajes').insert({ conversacion_id: convId, cuenta_id: cuenta, canal: canalDe(String(b.plataforma || '')), direccion: 'saliente', texto, leido: true, payload: { enviadoPor: yo, nombre: perfil.nombre } })
      await admin.from('mensajes').update({ leido: true }).eq('conversacion_id', convId).eq('direccion', 'entrante').eq('leido', false)
      return responder({ ok: true })
    }

    if (accion === 'leida') {
      await admin.from('mensajes').update({ leido: true }).eq('conversacion_id', convId).eq('direccion', 'entrante').eq('leido', false)
      return responder({ ok: true })
    }

    if (accion === 'reasignar') {
      if (!veTodos) throw new Falla('Solo quien ve todos los leads puede reasignar conversaciones.', 403)
      const asesorId = b.asesor ? String(b.asesor) : null
      const { error } = await admin.from('asignacion_conversaciones').upsert({ conversacion_id: convId, asesor_id: asesorId, fecha_asignacion: new Date().toISOString(), nombre_contacto: b.nombre ?? null, canal: b.canal ?? null, asignado_por: 'Reasignado por ' + perfil.nombre, deleted_at: null }, { onConflict: 'conversacion_id' })
      if (error) throw new Falla(error.message)
      if (asesorId && asesorId !== yo) await admin.from('notificaciones').insert({ para_id: asesorId, modulo: 'crm', evento: 'mensaje', tipo: 'aviso', texto: `Te asignaron la conversación de ${b.nombre || 'un contacto'} (${b.canal || 'redes'}) — por ${perfil.nombre}.` })
      return responder({ ok: true })
    }

    if (accion === 'sugerir') {
      const c = await credencial('gemini')
      const modelo = /^gemini-[\w.-]+$/.test(String(c.config?.modelo || '')) ? String(c.config.modelo) : 'gemini-2.5-flash'
      const hilo = (Array.isArray(b.hilo) ? b.hilo : []).slice(-20).map((m: Cualquiera) => (m.saliente ? 'VIMEDIC: ' : 'Cliente: ') + String(m.texto || '').slice(0, 600)).join('\n')
      const tipos: Record<string, string> = {
        rapida: 'Responde de forma breve y directa (1 a 2 oraciones).',
        comercial: 'Responde orientando la conversación a la venta: resuelve la duda, destaca un beneficio y propone el siguiente paso (cotización, llamada o visita).',
        seguimiento: 'Escribe un mensaje de seguimiento cordial para retomar la conversación y pedir una respuesta concreta.',
      }
      const instruccion = `Eres asesor comercial de ${String(b.empresa || 'VIMEDIC')}, importador de equipos médicos en Ecuador. ${tipos[String(b.tipo)] ?? tipos.comercial} Usa español neutro y trato de usted, sin inventar precios, stock ni plazos. Devuelve solo el texto del mensaje.\n\nConversación con ${String(b.nombre || 'el cliente')}:\n${hilo}`
      const r = await fetch(`${GEMINI}/models/${modelo}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.secreto }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: instruccion }] }], generationConfig: { temperature: 0.6, maxOutputTokens: 400 } }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Falla('Gemini respondió: ' + (j?.error?.message || r.status), 502)
      const texto = ((j.candidates?.[0]?.content?.parts ?? []) as Cualquiera[]).filter((x) => !x.thought).map((x) => x.text || '').join('').trim()
      if (!texto) throw new Falla('La IA no devolvió texto. Intenta de nuevo.')
      return responder({ texto })
    }

    throw new Falla('Acción no válida.')
  } catch (e) {
    const f = e instanceof Falla ? e : new Falla((e as Error).message || 'Error inesperado.', 500)
    return responder({ error: f.message }, f.status)
  }
})
