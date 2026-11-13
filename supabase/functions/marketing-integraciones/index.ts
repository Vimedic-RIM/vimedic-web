// Edge Function: puente seguro entre la app y Zernio (redes sociales) / Gemini (IA).
// Las claves viven cifradas en Supabase Vault; solo se descifran aquí, con service_role, vía integracion_secreto().
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const ZERNIO = 'https://zernio.com/api/v1'
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'
const MODELO0 = 'gemini-2.5-flash'

const responder = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
class Falla extends Error { constructor(m: string, public status = 400) { super(m) } }
const NOMBRE_PROVEEDOR: Record<string, string> = { zernio: 'Zernio', gemini: 'Gemini', drive: 'Drive', meta_pixel: 'Meta Pixel', tiktok_pixel: 'TikTok Pixel' }

// Hash SHA-256 en minúsculas para datos de usuario (email/teléfono) — exigido por Meta y TikTok, nunca en texto plano.
async function sha256Hex(texto: string): Promise<string> {
  const limpio = texto.trim().toLowerCase()
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(limpio))
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const auth = req.headers.get('Authorization') ?? ''
    const usuario = createClient(url, anon, { global: { headers: { Authorization: auth } } })
    const { data: u } = await usuario.auth.getUser()
    if (!u?.user) throw new Falla('Sesión no válida.', 401)
    const admin = createClient(url, srv)
    const b = await req.json().catch(() => ({}))
    const accion = String(b.accion || '')
    const puede = async (a: string) => (await usuario.rpc('marketing_puede', { p_accion: a })).data === true

    const credencial = async (proveedor: string) => {
      const [{ data: config }, { data: secreto }] = await Promise.all([
        admin.from('integraciones').select('config').eq('proveedor', proveedor).is('deleted_at', null).maybeSingle(),
        admin.rpc('integracion_secreto', { p_proveedor: proveedor }),
      ])
      if (!secreto) throw new Falla(`${NOMBRE_PROVEEDOR[proveedor] ?? proveedor} no está conectado. Ve a Marketing › Configuración.`)
      return { secreto: secreto as string, config: (config?.config ?? {}) as Record<string, unknown> }
    }
    const metaEvento = async (eventName: string, eventId: string, userData: { email?: string; telefono?: string }, customData: Record<string, unknown>) => {
      const { secreto, config } = await credencial('meta_pixel')
      const pixelId = String(config.pixelId || '')
      if (!pixelId) throw new Falla('Falta el ID del píxel de Meta.')
      const user_data: Record<string, string[]> = {}
      if (userData.email) user_data.em = [await sha256Hex(userData.email)]
      if (userData.telefono) user_data.ph = [await sha256Hex(userData.telefono)]
      const payload = { data: [{ event_name: eventName, event_time: Math.floor(Date.now() / 1000), event_id: eventId, action_source: 'website', user_data, custom_data: customData }] }
      const r = await fetch(`https://graph.facebook.com/v20.0/${pixelId}/events?access_token=${encodeURIComponent(secreto)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Falla('Meta respondió: ' + (j?.error?.message || r.status))
      return j
    }
    const tiktokEvento = async (eventName: string, eventId: string, userData: { email?: string; telefono?: string }, customData: Record<string, unknown>) => {
      const { secreto, config } = await credencial('tiktok_pixel')
      const pixelId = String(config.pixelId || '')
      if (!pixelId) throw new Falla('Falta el ID del píxel de TikTok.')
      const user: Record<string, string[]> = {}
      if (userData.email) user.email = [await sha256Hex(userData.email)]
      if (userData.telefono) user.phone = [await sha256Hex(userData.telefono)]
      const payload = { event_source: 'web', event_source_id: pixelId, data: [{ event: eventName, event_time: Math.floor(Date.now() / 1000), event_id: eventId, user, properties: customData }] }
      const r = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': secreto }, body: JSON.stringify(payload) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || (j && j.code !== 0)) throw new Falla('TikTok respondió: ' + (j?.message || r.status))
      return j
    }
    const zernio = async (ruta: string, init: RequestInit = {}) => {
      const c = await credencial('zernio')
      const r = await fetch(ZERNIO + ruta, { ...init, headers: { Authorization: 'Bearer ' + c.secreto, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } })
      const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null } catch { /* texto */ } // deno-lint-ignore no-explicit-any
      return { ok: r.ok, status: r.status, data: j, texto: t }
    }
    const gemini = async (partes: unknown[], gen: Record<string, unknown>) => {
      const c = await credencial('gemini')
      const modelo = /^gemini-[\w.-]+$/.test(String(c.config?.modelo || '')) ? String(c.config.modelo) : MODELO0
      const r = await fetch(`${GEMINI}/models/${modelo}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.secreto }, body: JSON.stringify({ contents: [{ role: 'user', parts: partes }], generationConfig: gen }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Falla('Gemini respondió: ' + (j?.error?.message || r.status))
      // deno-lint-ignore no-explicit-any
      const texto = ((j.candidates?.[0]?.content?.parts ?? []) as any[]).filter((x) => !x.thought).map((x) => x.text || '').join('').trim()
      if (!texto) throw new Falla('La IA no devolvió texto. Intenta de nuevo.')
      return texto
    }
    const json = (t: string) => { const l = t.replace(/^```(?:json)?\s*|\s*```$/g, ''); try { return JSON.parse(l) } catch { const m = l.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Falla('La IA no devolvió un resultado válido.') } }

    /* ---------------- Probar conexiones (solo quien administra) ---------------- */
    if (accion === 'probar') {
      if (!(await puede('administrar'))) throw new Falla('Solo quien administra Marketing puede probar las conexiones.', 403)
      const prov = String(b.proveedor)
      let ok = false, mensaje = '', extra: unknown = null
      if (prov === 'zernio') {
        const r = await zernio('/accounts')
        ok = r.ok
        // deno-lint-ignore no-explicit-any
        const lista = ((r.data?.accounts ?? r.data ?? []) as any[]).map((a) => ({ id: a.id || a._id, plataforma: a.platform, nombre: a.name || a.username || a.platform }))
        mensaje = ok ? `Conexión correcta · ${lista.length} cuenta${lista.length === 1 ? '' : 's'} conectada${lista.length === 1 ? '' : 's'}.` : `Zernio rechazó la clave (código ${r.status}).`
        extra = lista
      } else if (prov === 'gemini') {
        try { const t = await gemini([{ text: 'Responde solo con la palabra: listo' }], { temperature: 0, maxOutputTokens: 20 }); ok = true; mensaje = 'Conexión correcta · la IA respondió: ' + t.slice(0, 40) } catch (e) { mensaje = (e as Error).message }
      } else if (prov === 'meta_pixel') {
        try {
          const { secreto, config } = await credencial('meta_pixel')
          const pixelId = String(config.pixelId || '')
          if (!pixelId) throw new Falla('Falta el ID del píxel de Meta.')
          const r = await fetch(`https://graph.facebook.com/v20.0/${pixelId}?fields=name&access_token=${encodeURIComponent(secreto)}`)
          const j = await r.json().catch(() => ({}))
          ok = r.ok && !j.error
          mensaje = ok ? `Conexión correcta · píxel "${j.name || pixelId}".` : 'Meta rechazó la clave: ' + (j?.error?.message || r.status)
        } catch (e) { mensaje = (e as Error).message }
      } else if (prov === 'tiktok_pixel') {
        try { await tiktokEvento('TestEvent', 'prueba-' + crypto.randomUUID(), {}, {}); ok = true; mensaje = 'Conexión correcta · TikTok aceptó un evento de prueba.' } catch (e) { mensaje = (e as Error).message }
      } else throw new Falla('Proveedor no válido.')
      await admin.from('integraciones').update({ estado_prueba: (ok ? 'ok: ' : 'error: ') + mensaje, probado_en: new Date().toISOString() }).eq('proveedor', prov)
      return responder({ ok, mensaje, extra })
    }

    /* ---------------- Zernio: planificador de publicaciones ---------------- */
    if (accion.startsWith('zernio_')) {
      if (!(await puede('ver'))) throw new Falla('Sin acceso a Marketing.', 403)
      if (accion === 'zernio_cuentas') {
        const r = await zernio('/accounts'); if (!r.ok) throw new Falla(`No se pudieron cargar las cuentas (código ${r.status}).`)
        // deno-lint-ignore no-explicit-any
        return responder({ cuentas: ((r.data?.accounts ?? r.data ?? []) as any[]).map((a) => ({ id: a.id || a._id, plataforma: a.platform, nombre: a.name || a.username || a.platform })) })
      }
      if (accion === 'zernio_posts') {
        const r = await zernio('/posts?limit=100'); if (!r.ok) throw new Falla(`No se pudieron cargar las publicaciones (código ${r.status}).`)
        // deno-lint-ignore no-explicit-any
        const posts = ((r.data?.posts ?? r.data ?? []) as any[]).map((p) => ({
          id: p._id || p.id, contenido: p.content || '', estado: p.status || '', fecha: p.scheduledFor || p.publishedAt || p.createdAt || '',
          // deno-lint-ignore no-explicit-any
          plataformas: ((p.platforms ?? []) as any[]).map((x) => x.platform), imagen: p.mediaItems?.[0]?.url || '',
        }))
        return responder({ posts })
      }
      if (!(await puede('crear'))) throw new Falla('No tienes permiso para publicar.', 403)
      if (accion === 'zernio_crear') {
        const contenido = String(b.contenido || '').trim()
        if (!contenido) throw new Falla('El contenido no puede estar vacío.')
        if (!Array.isArray(b.plataformas) || !b.plataformas.length) throw new Falla('Elige al menos una cuenta donde publicar.')
        const media: { url: string; type: string }[] = []
        if (b.imagenBase64) {
          const tipo = String(b.imagenTipo || 'image/jpeg')
          const pre = await zernio('/media/presign', { method: 'POST', body: JSON.stringify({ fileName: b.imagenNombre || 'imagen.jpg', fileType: tipo }) })
          if (!pre.ok || !pre.data?.uploadUrl) throw new Falla(`No se pudo preparar la subida de la imagen (código ${pre.status}).`)
          const bytes = Uint8Array.from(atob(String(b.imagenBase64)), (c) => c.charCodeAt(0))
          const up = await fetch(pre.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': tipo }, body: bytes })
          if (!up.ok) throw new Falla(`No se pudo subir la imagen (código ${up.status}).`)
          media.push({ url: pre.data.publicUrl, type: 'image' })
        } else if (b.imagenUrl && /^https:\/\//.test(String(b.imagenUrl))) media.push({ url: String(b.imagenUrl), type: 'image' })
        const cuerpo: Record<string, unknown> = { content: contenido, platforms: b.plataformas }
        if (media.length) cuerpo.mediaItems = media
        if (b.fechaISO) cuerpo.scheduledFor = b.fechaISO; else cuerpo.publishNow = true
        const r = await zernio('/posts', { method: 'POST', body: JSON.stringify(cuerpo) })
        if (!r.ok) throw new Falla(`Zernio no aceptó la publicación (código ${r.status}). ${String(r.texto).slice(0, 160)}`)
        const postId = String(r.data?.post?._id ?? r.data?.post?.id ?? r.data?._id ?? r.data?.id ?? '')
        // Sincronía con la pieza audiovisual y el registro de publicaciones
        if (b.audiovisualId && postId) {
          await admin.from('audiovisual').update({ estado: b.fechaISO ? 'Programado' : 'Publicado', publicacion_id: postId }).eq('id', b.audiovisualId)
          await admin.from('marketing_publicaciones').upsert({ post_id: postId, audiovisual_id: b.audiovisualId, por: u.user.email ?? null }, { onConflict: 'post_id' })
        }
        return responder({ ok: true, postId })
      }
      if (accion === 'zernio_eliminar') {
        if (!b.postId) throw new Falla('Falta el ID de la publicación.')
        const r = await zernio('/posts/' + encodeURIComponent(String(b.postId)), { method: 'DELETE' })
        if (!r.ok) throw new Falla(`No se pudo borrar la publicación (código ${r.status}).`)
        await admin.from('audiovisual').update({ estado: 'Listo', publicacion_id: null }).eq('publicacion_id', String(b.postId))
        return responder({ ok: true })
      }
      throw new Falla('Acción no reconocida.')
    }

    /* ---------------- Gemini: redacción ---------------- */
    if (accion === 'ia_texto') {
      if (!(await puede('crear'))) throw new Falla('No tienes permiso para usar la IA.', 403)
      const plataforma = String(b.plataforma || 'Instagram y Facebook'), tono = String(b.tono || 'cercano y profesional')
      const t = await gemini([{ text: [
        'Eres community manager de VIMEDIC, importadora de equipos médicos en Ecuador.',
        `Escribe UNA publicación para ${plataforma}, en español de Ecuador, tono ${tono}, sin exageraciones ni promesas médicas.`,
        b.producto ? 'Producto: ' + String(b.producto).slice(0, 200) : '',
        b.descripcion ? 'Datos reales del producto:\n' + String(b.descripcion).slice(0, 1500) : '',
        b.indicaciones ? 'Indicaciones del equipo: ' + String(b.indicaciones).slice(0, 400) : '',
        b.actual ? 'Texto actual para mejorar:\n' + String(b.actual).slice(0, 1200) : '',
        'Formato: gancho en la primera línea, 2 a 4 líneas de valor, una llamada a la acción (escribir por WhatsApp) y de 3 a 6 hashtags al final.',
        'No inventes especificaciones ni precios. Devuelve solo el texto de la publicación.',
      ].filter(Boolean).join('\n') }], { temperature: 0.8, maxOutputTokens: 900 })
      return responder({ texto: t })
    }
    if (accion === 'ia_producto') {
      if (!(await puede('crear'))) throw new Falla('No tienes permiso para usar la IA.', 403)
      const { data: p } = await admin.from('productos').select('nombre,descripcion,ficha_tecnica_url,categoria:categorias(nombre)').eq('id', b.id).maybeSingle()
      if (!p) throw new Falla('No se encontró el producto.')
      const partes: unknown[] = []
      let conFicha = false
      const f = String(p.ficha_tecnica_url || '')
      if (/^https:\/\//i.test(f)) {
        try {
          const m = f.match(/\/d\/([\w-]{20,})/) || f.match(/[?&]id=([\w-]{20,})/)
          const dir = m && /drive\.google\.com|docs\.google\.com/.test(f) ? `https://drive.google.com/uc?export=download&id=${m[1]}` : f
          const r = await fetch(dir, { redirect: 'follow' })
          const bytes = new Uint8Array(await r.arrayBuffer())
          if (r.ok && bytes.length > 0 && bytes.length <= 8 * 1024 * 1024 && /pdf/i.test(r.headers.get('content-type') || '')) {
            let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
            partes.push({ inline_data: { mime_type: 'application/pdf', data: btoa(s) } }); conFicha = true
          }
        } catch { /* sin ficha legible */ }
      }
      // deno-lint-ignore no-explicit-any
      const cat = (p as any).categoria?.nombre
      partes.push({ text: [
        'Eres redactor técnico-comercial de VIMEDIC, importadora de equipos médicos en Ecuador.',
        'Escribe en español neutro de Ecuador, claro y profesional, sin exageraciones ni promesas médicas.',
        'Producto: ' + p.nombre + (cat ? '\nCategoría: ' + cat : ''),
        p.descripcion ? '\nTexto actual:\n' + String(p.descripcion).slice(0, 3000) : '',
        conFicha ? '\nAdjunto va la FICHA TÉCNICA en PDF: toma de ahí los datos reales.' : '',
        b.notas ? '\nIndicaciones del equipo: ' + String(b.notas).slice(0, 400) : '',
        '\nDevuelve SOLO un JSON: {"descripcion": "2 a 4 frases: qué es, para qué sirve y su principal beneficio", "caracteristicas": ["..."]}',
        'Entre 5 y 12 características de máximo 90 caracteres, sin viñetas. Usa solo datos presentes en el texto o la ficha: si falta un dato, NO lo inventes. Sin precios ni garantías.',
      ].join('\n') })
      const o = json(await gemini(partes, { temperature: 0.4, maxOutputTokens: 2400, responseMimeType: 'application/json' }))
      const limpiar = (t: unknown, max: number) => String(t || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
      const car = (Array.isArray(o.caracteristicas) ? o.caracteristicas : String(o.caracteristicas || '').split('\n')).map((x: unknown) => limpiar(x, 120).replace(/^[-•·*✓✔\d.)\s]+/, '')).filter(Boolean).slice(0, 15)
      return responder({ descripcion: limpiar(o.descripcion, 1200), caracteristicas: car, conFicha })
    }
    if (accion === 'ia_alt_texto') {
      if (!(await puede('crear'))) throw new Falla('No tienes permiso para usar la IA.', 403)
      const { data: p } = await admin.from('productos').select('nombre,marca,categoria:categorias(nombre)').eq('id', b.id).maybeSingle()
      if (!p) throw new Falla('No se encontró el producto.')
      const n = Math.max(1, Math.min(20, Number(b.n) || 1))
      // deno-lint-ignore no-explicit-any
      const cat = (p as any).categoria?.nombre
      const tipos = Array.isArray(b.tipos) ? b.tipos.map((t: unknown) => (t === 'video' ? 'video' : 'imagen')) : Array(n).fill('imagen')
      const o = json(await gemini([{ text: [
        'Eres redactor de accesibilidad web para VIMEDIC, importadora de equipos médicos en Ecuador.',
        'Producto: ' + p.nombre + (p.marca ? ' · Marca ' + p.marca : '') + (cat ? ' · Categoría ' + cat : ''),
        'Escribe ' + n + ' textos alternativos (alt text) cortos en español, cada uno para un elemento distinto de la galería del catálogo, en este orden de tipo: ' + tipos.join(', ') + '.',
        'Cada texto describe de forma genérica y realista qué se vería en ' + (tipos.includes('video') ? 'esa foto o video' : 'esa foto') + ' del equipo (ej. "Vista frontal de ' + p.nombre + '", "Panel de control de ' + p.nombre + '"), sin inventar detalles que no puedas saber. Máximo 90 caracteres cada uno, sin numerar.',
        'Devuelve SOLO un JSON: {"textos": ["...", "..."]} con exactamente ' + n + ' elementos.',
      ].join('\n') }], { temperature: 0.6, maxOutputTokens: 500, responseMimeType: 'application/json' }))
      const limpiar = (t: unknown) => String(t || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90)
      const textos = (Array.isArray(o.textos) ? o.textos : []).map(limpiar).filter(Boolean)
      while (textos.length < n) textos.push((p.marca ? p.marca + ' ' : '') + p.nombre)
      return responder({ textos: textos.slice(0, n) })
    }
    /* ---------------- Rastreo de conversiones del lado del servidor (Meta + TikTok) ----------------
       Se llama con el mismo eventId que ya disparó el píxel en el navegador, para que las plataformas
       no cuenten el evento dos veces. Si un proveedor no está conectado, simplemente no se le manda
       (no es un error): solo se avisa si el que SÍ está conectado rechaza el evento. */
    if (accion === 'conversion_evento') {
      const eventName = String(b.eventName || '').trim(), eventId = String(b.eventId || '').trim()
      if (!eventName || !eventId) throw new Falla('Falta el nombre o el ID del evento.')
      const userData = (b.userData ?? {}) as { email?: string; telefono?: string }
      const customData = (b.customData ?? {}) as Record<string, unknown>
      const resultado = { enviado_meta: false, enviado_tiktok: false, errores: [] as string[] }
      await Promise.all([
        metaEvento(eventName, eventId, userData, customData).then(() => { resultado.enviado_meta = true })
          .catch((e) => { if (!/no está conectado/.test((e as Error).message)) resultado.errores.push('Meta: ' + (e as Error).message) }),
        tiktokEvento(eventName, eventId, userData, customData).then(() => { resultado.enviado_tiktok = true })
          .catch((e) => { if (!/no está conectado/.test((e as Error).message)) resultado.errores.push('TikTok: ' + (e as Error).message) }),
      ])
      return responder(resultado)
    }
    throw new Falla('Acción no reconocida.')
  } catch (e) {
    const f = e as Falla
    return responder({ error: f.message || 'Error inesperado.' }, f.status && f.status >= 400 ? f.status : 500)
  }
})
