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

    /* ---------------- Zernio: planificador de publicaciones ----------------
       Igual que el original (Data Marketing.gs: mkPublicaciones, mkPresign, mkPublicar, mkEditarPublicacion,
       mkReprogramar, mkEliminarPublicacion) y su flujo de aprobación (MarketingFlujo.gs: mkfDiferir_):
       lo que publica Asistente o Audiovisual espera al coordinador; un borrador no necesita aprobación. */
    if (accion.startsWith('zernio_')) {
      if (!(await puede('ver'))) throw new Falla('Sin acceso a Marketing.', 403)
      const EDITABLES = ['draft', 'scheduled', 'failed', 'partial', 'cancelled']
      const TZ = 'America/Guayaquil'
      // deno-lint-ignore no-explicit-any
      type Cualquiera = any
      const errorZernio = (r: { status: number; data: Cualquiera; texto: string }, que: string) => {
        const det = String(r.data?.error?.message ?? r.data?.error ?? r.data?.message ?? r.texto ?? '').replace(/\s+/g, ' ').slice(0, 220)
        if (r.status === 401) return new Falla('Zernio rechazó la clave API (401). Revisa Marketing › Configuración.')
        if (r.status === 403) return new Falla('Zernio denegó el acceso (403). Revisa el permiso de la clave y las cuentas conectadas.')
        if (r.status === 429) return new Falla('Zernio alcanzó su límite de consultas. Reintenta en unos minutos.')
        return new Falla(`${que} (código ${r.status}).${det ? ' ' + det : ''}`)
      }
      const cuentasZ = async () => {
        const r = await zernio('/accounts'); if (!r.ok) throw errorZernio(r, 'No se pudieron cargar las cuentas')
        return ((r.data?.accounts ?? r.data ?? []) as Cualquiera[]).map((a) => ({ id: String(a._id || a.id), plataforma: String(a.platform || ''), nombre: String(a.name || a.username || a.platform || '') }))
      }
      const idPost = (v: unknown) => { const s = String(v || ''); if (!/^[a-zA-Z0-9_-]{1,100}$/.test(s)) throw new Falla('ID de publicación inválido.'); return s }
      const leerPost = async (id: string) => {
        const r = await zernio('/posts/' + encodeURIComponent(id)); if (!r.ok) throw errorZernio(r, 'No se encontró la publicación en Zernio')
        return (r.data?.post ?? r.data ?? {}) as Cualquiera
      }
      const miRol = async () => ((await usuario.rpc('marketing_mi_rol')).data ?? {}) as { empleado_id?: string; nombre?: string; rol?: string; coord?: boolean; requiere?: boolean }
      const fechaFutura = (v: unknown, maxDias = 400) => {
        const t = Date.parse(String(v || ''))
        if (!isFinite(t) || t < Date.now() + 60000) throw new Falla('Elige una fecha y hora al menos un minuto en el futuro.')
        if (t > Date.now() + maxDias * 86400000) throw new Falla('La fecha está demasiado lejos.')
        return new Date(t).toISOString()
      }
      // Enlaces que no caducan: Drive, el almacenamiento de la app (Audiovisual) y media.vimedic.com.ec.
      const enlacePermanente = (url: string) => /^https:\/\/(drive\.usercontent\.google\.com|drive\.google\.com|lh3\.googleusercontent\.com|docs\.google\.com|media\.vimedic\.com\.ec|[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public)\//i.test(url)
      /** Guarda la acción para que la apruebe Coordinación (mkfDiferir_). Devuelve null si no hace falta. */
      const diferir = async (fn: string, datos: Record<string, unknown>, resumen: string, aplicando: boolean) => {
        if (aplicando) return null
        const r = await miRol()
        if (!r.requiere) return null
        const ahora = new Date(Date.now() - 5 * 3600000).toISOString().replace(/\D/g, '').slice(2, 14)
        const { data, error } = await admin.from('marketing_cambios').insert({
          codigo: 'MKC-' + ahora + '-' + crypto.randomUUID().slice(0, 4), fecha: new Date().toISOString(),
          producto_id: (datos.productoId as string) || null, producto_texto: (datos.productoTexto as string) || null,
          campo: 'accion:' + fn, nivel: 'Revisión', valor_anterior: resumen.slice(0, 2000), valor_nuevo: JSON.stringify(datos),
          estado: 'Pendiente', autor_id: r.empleado_id ?? null, autor_rol: r.rol ?? null,
        }).select('id').single()
        if (error) throw new Falla('No se pudo enviar al coordinador: ' + error.message)
        return { ok: true, enRevision: true, id: data.id, mensaje: 'Enviado al coordinador para aprobación. Aparece en Revisión.' }
      }

      /** mkPublicar: valida formato y reglas de cada red, evita duplicados y registra la publicación. */
      const crearPost = async (d: Cualquiera, aplicando: boolean) => {
        const cuentas = await cuentasZ()
        const ids: string[] = Array.isArray(d.cuentas) ? d.cuentas.map(String)
          : Array.isArray(d.plataformas) ? d.plataformas.map((x: Cualquiera) => String(x.accountId || '')) : []
        if (!ids.length || ids.length > 20) throw new Falla('Elige las cuentas donde publicar.')
        const formato = String(d.formato || 'feed')
        if (!['feed', 'story', 'reel'].includes(formato)) throw new Falla('Formato no válido.')
        const contenido = String(d.contenido || '').trim()
        if (!contenido && formato !== 'story') throw new Falla('Escribe el contenido.')
        if ([...contenido].length > 2200) throw new Falla('El texto supera 2.200 caracteres (límite de Instagram y TikTok). Acórtalo.')
        let media: { url: string; type: string } | null = d.media && d.media.url ? { url: String(d.media.url), type: String(d.media.type) } : null
        // Compatibilidad: imagen enviada en base64 desde una pantalla anterior.
        if (!media && d.imagenBase64) {
          const tipo = String(d.imagenTipo || 'image/jpeg')
          const bytes = Uint8Array.from(atob(String(d.imagenBase64)), (c) => c.charCodeAt(0))
          const pre = await zernio('/media/presign', { method: 'POST', body: JSON.stringify({ filename: String(d.imagenNombre || 'imagen.jpg').slice(0, 150), contentType: tipo, size: bytes.length }) })
          if (!pre.ok || !pre.data?.uploadUrl) throw errorZernio(pre, 'No se pudo preparar la subida de la imagen')
          const up = await fetch(pre.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': tipo }, body: bytes })
          if (!up.ok) throw new Falla(`No se pudo subir la imagen (código ${up.status}).`)
          media = { url: String(pre.data.publicUrl), type: 'image' }
        } else if (!media && d.imagenUrl) media = { url: String(d.imagenUrl), type: 'image' }
        if (media && (!/^https:\/\//.test(media.url) || !['image', 'video'].includes(media.type))) throw new Falla('Multimedia no válida.')
        if (formato === 'reel' && media?.type !== 'video') throw new Falla('Reels requiere un video.')
        if (formato === 'story' && !media) throw new Falla('Historias requiere imagen o video.')
        let conTikTok = false
        const platforms = ids.map((id) => {
          const a = cuentas.find((c) => c.id === id); if (!a) throw new Falla('Cuenta no autorizada.')
          const pl = a.plataforma.toLowerCase(), esVideo = media?.type === 'video'
          if (pl === 'instagram' && !media) throw new Falla('Instagram requiere una imagen o un video.')
          if (pl === 'tiktok') {
            if (!media) throw new Falla('TikTok requiere un video o una imagen.')
            if (formato === 'story') throw new Falla('TikTok no admite historias: usa formato Reel o Feed.')
            conTikTok = true; return { platform: a.plataforma, accountId: a.id }
          }
          if (pl === 'youtube') {
            if (!esVideo) throw new Falla('YouTube requiere un video.')
            if (formato === 'story') throw new Falla('YouTube no admite historias: usa formato Reel o Feed.')
            const titulo = (contenido.split('\n').map((x) => x.trim()).filter(Boolean)[0] || 'VIMEDIC').replace(/[<>]/g, '').slice(0, 100)
            return { platform: a.plataforma, accountId: a.id, platformSpecificData: { title: titulo, visibility: 'public', madeForKids: false, containsSyntheticMedia: false } }
          }
          if (formato !== 'feed' && !['facebook', 'instagram'].includes(pl)) throw new Falla(`El formato ${formato === 'story' ? 'Historia' : 'Reel'} solo funciona en Facebook, Instagram, TikTok y YouTube. Quita ${a.plataforma} o usa Feed.`)
          const p: Record<string, unknown> = { platform: a.plataforma, accountId: a.id }
          if (formato === 'story' || (formato === 'reel' && pl === 'facebook')) p.platformSpecificData = { contentType: formato }
          return p
        })
        const cuerpo: Record<string, unknown> = { content: contenido, platforms, timezone: TZ }
        if (conTikTok) cuerpo.tiktokSettings = { privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: true, allow_duet: true, allow_stitch: true, content_preview_confirmed: true, express_consent_given: true }
        if (media) cuerpo.mediaItems = [{ url: media.url, type: media.type }]
        const borrador = d.borrador === true
        if (d.fechaISO) {
          cuerpo.scheduledFor = fechaFutura(d.fechaISO)
          if (media && !enlacePermanente(media.url) && Date.parse(cuerpo.scheduledFor as string) > Date.now() + 6.9 * 86400000)
            throw new Falla('Este archivo se subió directo (temporal) y solo se puede programar dentro de los próximos 6 días. Súbelo en Audiovisual para programarlo con más anticipación.')
        } else if (!borrador) cuerpo.publishNow = true
        if (borrador) cuerpo.isDraft = true
        // Un borrador no se publica: no necesita aprobación (mkfDiferir_).
        if (!borrador) {
          const guardado = { ...d, media, imagenBase64: undefined }
          const dif = await diferir('zernio_crear', guardado, contenido || '(Historia sin texto)', aplicando)
          if (dif) return dif
        }
        // Registro de la solicitud: una respuesta incierta nunca repite la publicación.
        const solicitud = String(d.requestId || '')
        if (!/^[a-zA-Z0-9-]{16,80}$/.test(solicitud)) throw new Falla('Solicitud inválida. Cierra y vuelve a abrir la publicación.')
        const { data: previa } = await admin.from('marketing_publicaciones').select('id,post_id').eq('solicitud_id', solicitud).is('deleted_at', null).maybeSingle()
        if (previa?.post_id) return { ok: true, postId: previa.post_id, repetida: true }
        if (previa) throw new Falla('La publicación anterior todavía no tiene respuesta de Zernio. Sincroniza el planificador y revisa si ya se creó antes de intentarlo de nuevo.')
        const { data: reg, error: eReg } = await admin.from('marketing_publicaciones').insert({
          solicitud_id: solicitud, audiovisual_id: d.audiovisualId || null, producto_id: d.productoId || null, producto_texto: d.productoTexto || null,
          formato, por: u.user.email ?? null,
        }).select('id').single()
        if (eReg) throw new Falla(/duplicate|unique/i.test(eReg.message) ? 'Esta publicación ya se está enviando.' : 'No se pudo registrar la publicación: ' + eReg.message)
        const r = await zernio('/posts', { method: 'POST', body: JSON.stringify(cuerpo) })
        if (!r.ok) {
          await admin.from('marketing_publicaciones').update({ deleted_at: new Date().toISOString() }).eq('id', reg.id)
          throw errorZernio(r, 'Zernio no aceptó la publicación')
        }
        const postId = String(r.data?.post?._id ?? r.data?.post?.id ?? r.data?._id ?? r.data?.id ?? '')
        await admin.from('marketing_publicaciones').update({ post_id: postId || null }).eq('id', reg.id)
        // La pieza de Audiovisual queda Programada o Publicada (avVincularPublicacion).
        if (d.audiovisualId && postId && !borrador) await admin.from('audiovisual').update({ estado: d.fechaISO ? 'Programado' : 'Publicado', publicacion_id: postId }).eq('id', d.audiovisualId)
        return { ok: true, postId }
      }
      /** mkEditarPublicacion: texto y/o fecha de una publicación pendiente; un borrador puede pasar a publicarse. */
      const editarPost = async (d: Cualquiera, aplicando: boolean) => {
        const id = idPost(d.id)
        const p = await leerPost(id)
        if (!EDITABLES.includes(String(p.status))) throw new Falla('Solo se pueden editar borradores, programadas o fallidas.')
        const contenido = String(d.contenido ?? '').trim()
        if ([...contenido].length > 5000) throw new Falla('El texto supera 5000 caracteres.')
        const cuerpo: Record<string, unknown> = { timezone: TZ, content: contenido }
        if (d.fechaISO) cuerpo.scheduledFor = fechaFutura(d.fechaISO)
        if (d.borrador === false && p.status === 'draft') cuerpo.isDraft = false
        // Seguir editando un borrador (sin fecha ni publicarlo) no necesita aprobación.
        if (!(p.status === 'draft' && d.borrador !== false && !d.fechaISO)) {
          const dif = await diferir('zernio_editar', { ...d, id }, contenido, aplicando)
          if (dif) return dif
        }
        const r = await zernio('/posts/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(cuerpo) })
        if (!r.ok) throw errorZernio(r, 'Zernio no aceptó el cambio')
        return { ok: true }
      }
      /** mkReprogramar: mover la fecha (arrastrar en el calendario). */
      const reprogramarPost = async (d: Cualquiera, aplicando: boolean) => {
        const id = idPost(d.id)
        const fecha = fechaFutura(d.fechaISO)
        const p = await leerPost(id)
        if (!EDITABLES.includes(String(p.status))) throw new Falla('Las publicaciones ya publicadas no se pueden mover.')
        const dif = await diferir('zernio_reprogramar', { ...d, id, fechaISO: fecha }, 'Nueva fecha: ' + new Date(fecha).toLocaleString('es-EC', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }), aplicando)
        if (dif) return dif
        const r = await zernio('/posts/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ scheduledFor: fecha, timezone: TZ }) })
        if (!r.ok) throw errorZernio(r, 'Zernio no aceptó la nueva fecha')
        return { ok: true, fecha }
      }

      if (accion === 'zernio_cuentas') return responder({ cuentas: await cuentasZ() })
      if (accion === 'zernio_rol') return responder(await miRol())
      if (accion === 'zernio_posts') {
        const pagina = Math.max(1, Math.min(1000, Number(b.pagina) || 1))
        const r = await zernio('/posts?limit=100&page=' + pagina); if (!r.ok) throw errorZernio(r, 'No se pudieron cargar las publicaciones')
        const lista = (r.data?.posts ?? r.data ?? []) as Cualquiera[]
        const ids = lista.map((p) => String(p._id || p.id)).filter(Boolean)
        // Producto y pieza de Audiovisual de cada publicación (MK_PostMeta del original).
        const [{ data: regs }, { data: avs }] = await Promise.all([
          ids.length ? admin.from('marketing_publicaciones').select('post_id,audiovisual_id,producto_id,producto_texto,formato,producto:productos(codigo,nombre)').in('post_id', ids).is('deleted_at', null) : Promise.resolve({ data: [] }),
          ids.length ? admin.from('audiovisual').select('id,titulo,archivo_url,mime,tipo,campana,publicacion_id').in('publicacion_id', ids).is('deleted_at', null) : Promise.resolve({ data: [] }),
        ])
        const avIds = [...new Set(((regs ?? []) as Cualquiera[]).map((x) => x.audiovisual_id).filter(Boolean))]
        const { data: avs2 } = avIds.length ? await admin.from('audiovisual').select('id,titulo,archivo_url,mime,tipo,campana,publicacion_id').in('id', avIds) : { data: [] }
        const avPorId = new Map<string, Cualquiera>([...((avs ?? []) as Cualquiera[]), ...((avs2 ?? []) as Cualquiera[])].map((a) => [a.id, a]))
        const avPorPost = new Map<string, Cualquiera>(((avs ?? []) as Cualquiera[]).map((a) => [a.publicacion_id, a]))
        const regPorPost = new Map<string, Cualquiera>(((regs ?? []) as Cualquiera[]).map((x) => [x.post_id, x]))
        const posts = lista.map((p) => {
          const id = String(p._id || p.id), m = (p.mediaItems?.[0] ?? {}) as Cualquiera
          const plats = (p.platforms ?? []) as Cualquiera[]
          const reg = regPorPost.get(id), av = (reg?.audiovisual_id && avPorId.get(reg.audiovisual_id)) || avPorPost.get(id)
          return {
            id, contenido: p.content || '', estado: p.status || '', fecha: p.scheduledFor || p.publishedAt || p.createdAt || '',
            programada: p.scheduledFor || '', creado: p.createdAt || '', publicado: p.publishedAt || '',
            plataformas: plats.map((x) => x.platform), imagen: m.url || '', tipoMedia: m.type || '', nMedia: (p.mediaItems ?? []).length,
            urls: plats.map((x) => x.platformPostUrl || '').filter(Boolean),
            detalle: plats.map((x) => ({ plataforma: x.platform || '', estado: x.status || '', url: x.platformPostUrl || '', error: String(x.errorMessage || x.error || '').slice(0, 200) })),
            avId: av?.id || '', avTitulo: av?.titulo || '', avUrl: av?.archivo_url || '', avVideo: /^video\//.test(av?.mime || '') || ['Video', 'Reel'].includes(av?.tipo || ''),
            campana: av?.campana || '', formato: reg?.formato || '',
            productoId: reg?.producto_id || '', producto: reg?.producto ? `${reg.producto.codigo} · ${reg.producto.nombre}` : (reg?.producto_texto || ''),
          }
        })
        const pag = r.data?.pagination ?? {}
        return responder({ posts, pagina, paginas: Number(pag.pages || pag.totalPages || pagina) })
      }
      if (!(await puede('crear'))) throw new Falla('No tienes permiso para publicar.', 403)
      if (accion === 'zernio_presign') {
        const tipo = String(b.tipo || ''), tamano = Number(b.tamano) || 0
        if (!/^image\/(jpeg|png|webp|gif)$|^video\/(mp4|quicktime|webm)$/.test(tipo) || !tamano || tamano > 300 * 1024 * 1024) throw new Falla('Formato o tamaño no admitido (JPG, PNG, WebP, GIF, MP4, MOV o WebM; máximo 300 MB).')
        const r = await zernio('/media/presign', { method: 'POST', body: JSON.stringify({ filename: String(b.nombre || 'archivo').slice(0, 150), contentType: tipo, size: tamano }) })
        if (!r.ok || !r.data?.uploadUrl) throw errorZernio(r, 'No se pudo preparar la subida')
        return responder({ uploadUrl: r.data.uploadUrl, publicUrl: r.data.publicUrl })
      }
      if (accion === 'zernio_crear') return responder(await crearPost(b, false))
      if (accion === 'zernio_editar') return responder(await editarPost(b, false))
      if (accion === 'zernio_reprogramar') return responder(await reprogramarPost(b, false))
      if (accion === 'zernio_eliminar') {
        const id = idPost(b.postId)
        const p = await leerPost(id)
        if (!['draft', 'scheduled', 'failed'].includes(String(p.status))) throw new Falla('Solo se pueden eliminar borradores, programadas o fallidas.')
        const r = await zernio('/posts/' + encodeURIComponent(id), { method: 'DELETE' })
        if (!r.ok) throw errorZernio(r, 'No se pudo borrar la publicación')
        await admin.from('audiovisual').update({ estado: 'Listo', publicacion_id: null }).eq('publicacion_id', id)
        await admin.from('marketing_publicaciones').update({ deleted_at: new Date().toISOString() }).eq('post_id', id)
        return responder({ ok: true })
      }
      /** Coordinación aprueba una publicación que esperaba: se ejecuta tal como se pidió (mkfAprobar). */
      if (accion === 'zernio_aplicar') {
        const r = await miRol()
        if (!r.coord) throw new Falla('Solo Coordinación de Marketing puede aprobar publicaciones.', 403)
        const { data: c } = await admin.from('marketing_cambios').select('id,campo,valor_nuevo,estado').eq('id', String(b.cambioId || '')).is('deleted_at', null).maybeSingle()
        if (!c || !String(c.campo).startsWith('accion:')) throw new Falla('No se encontró la publicación por aprobar.')
        if (!['Pendiente', 'Con cambios'].includes(String(c.estado))) throw new Falla('Esta publicación ya fue revisada.')
        let datos: Cualquiera
        try { datos = JSON.parse(String(c.valor_nuevo || '{}')) } catch { throw new Falla('Los datos guardados de la publicación no son válidos.') }
        // Solicitudes guardadas por la app original: [datos] o [id, fecha].
        const fn = String(c.campo).slice(7)
        if (Array.isArray(datos)) {
          if (fn === 'mkReprogramar') datos = { id: datos[0], fechaISO: datos[1] }
          else { const o = datos[0] ?? {}; datos = { ...o, cuentas: o.accounts, fechaISO: o.fecha, productoId: undefined, productoTexto: o.meta?.producto } }
        }
        if (b.contenido !== undefined && typeof b.contenido === 'string') datos.contenido = b.contenido
        if (b.fechaISO !== undefined) datos.fechaISO = b.fechaISO || ''
        const out = fn === 'zernio_crear' || fn === 'mkPublicar' ? await crearPost({ ...datos, requestId: datos.requestId || crypto.randomUUID() }, true)
          : fn === 'zernio_editar' || fn === 'mkEditarPublicacion' ? await editarPost(datos, true)
          : fn === 'zernio_reprogramar' || fn === 'mkReprogramar' ? await reprogramarPost(datos, true)
          : null
        if (!out) throw new Falla('Acción no reconocida.')
        await admin.from('marketing_cambios').update({ estado: 'Aprobado', revisado_por: r.empleado_id ?? null, fecha_revision: new Date().toISOString(), comentario: b.comentario ? String(b.comentario).slice(0, 500) : null }).eq('id', c.id)
        return responder({ ...out, aprobado: true })
      }
      throw new Falla('Acción no reconocida.')
    }

    /* ---------------- Gemini: redacción ---------------- */
    /* Copy para redes (mkGenerarCopyIA): tipo de publicación, datos reales del producto, redes y formato.
       Siempre invita a la web y nunca pasa de 2000 caracteres (mkAjustarCopy_). */
    if (accion === 'ia_texto') {
      if (!(await puede('crear'))) throw new Falla('No tienes permiso para usar la IA.', 403)
      const TIPOS: Record<string, string> = {
        promocional: 'Publicación promocional que destaque beneficios concretos y termine con una llamada a la acción para cotizar por WhatsApp.',
        educativo: 'Publicación educativa: explica un dato útil o un buen uso del equipo para profesionales de la salud, con tono experto y cercano.',
        lanzamiento: 'Anuncio de novedad o llegada de stock, que genere expectativa y pida escribir para reservar.',
        oferta: 'Oferta con urgencia moderada (tiempo o unidades limitadas) sin inventar precios ni porcentajes que no se te den.',
        caso: 'Caso de uso: cuenta cómo el equipo resuelve un problema real de una clínica, consultorio o laboratorio.',
        mejorar: 'Mejora el texto actual: más claro, persuasivo y bien estructurado, conservando la información.',
        acortar: 'Resume el texto actual en una versión corta y directa (máximo 3 líneas + CTA).',
        hashtags: 'Devuelve el texto actual sin cambios y agrega al final entre 5 y 8 hashtags relevantes para Ecuador y el sector salud.',
      }
      const actual = String(b.texto ?? b.actual ?? '').slice(0, 3000)
      const tipo = TIPOS[String(b.tipo)] ? String(b.tipo) : actual.trim() ? 'mejorar' : 'promocional'
      if (['mejorar', 'acortar', 'hashtags'].includes(tipo) && !actual.trim()) throw new Falla('Escribe primero un texto para que la IA lo trabaje.')
      const lim = (v: unknown, n: number) => String(v ?? '').replace(/[<>]/g, '').slice(0, n)
      let producto = ''
      const cx = (b.contexto && typeof b.contexto === 'object' ? b.contexto : null) as Record<string, unknown> | null
      if (cx?.nombre) {
        producto = 'Producto: ' + lim(cx.nombre, 160) + (cx.categoria ? '\nCategoría: ' + lim(cx.categoria, 80) : '') + (cx.marca ? '\nMarca: ' + lim(cx.marca, 60) : '') +
          (cx.modelo ? '\nModelo: ' + lim(cx.modelo, 60) : '') + (cx.destacados ? '\nDatos destacados: ' + lim(cx.destacados, 300) : '') + (cx.garantia ? '\nGarantía: ' + lim(cx.garantia, 60) : '') +
          '\nDescripción / especificaciones: ' + lim(cx.descripcion, 1500)
      } else if (b.productoId) {
        const { data: p } = await admin.from('productos').select('nombre,marca,codigo_unico,descripcion,caracteristicas,especificaciones,garantia,categoria:categorias(nombre)').eq('id', b.productoId).maybeSingle()
        // deno-lint-ignore no-explicit-any
        if (p) producto = 'Producto: ' + p.nombre + ((p as any).categoria?.nombre ? '\nCategoría: ' + (p as any).categoria.nombre : '') + (p.marca ? '\nMarca: ' + p.marca : '') + (p.codigo_unico ? '\nModelo: ' + p.codigo_unico : '') +
          (p.garantia ? '\nGarantía: ' + p.garantia : '') + '\nDescripción / especificaciones: ' + lim([p.descripcion, p.caracteristicas, p.especificaciones].filter(Boolean).join('\n'), 1500)
      } else if (b.producto) producto = 'Producto: ' + lim(b.producto, 200) + (b.descripcion ? '\nDescripción: ' + lim(b.descripcion, 1500) : '')
      const plataformas = (Array.isArray(b.plataformas) ? b.plataformas.map(String).join(', ') : String(b.plataforma || '')) || 'Facebook e Instagram'
      const formato = ({ feed: 'publicación de feed', reel: 'reel (texto de descripción)', story: 'historia (texto muy breve)' } as Record<string, string>)[String(b.formato)] || 'publicación de feed'
      const { data: cfgG } = await admin.from('integraciones').select('config').eq('proveedor', 'gemini').is('deleted_at', null).maybeSingle()
      const web = /^https:\/\/[\w.-]+/.test(String((cfgG?.config as Record<string, unknown>)?.webUrl || '')) ? String((cfgG?.config as Record<string, unknown>).webUrl) : 'https://vimedic.com.ec'
      const idea = String(b.idea ?? b.indicaciones ?? '').slice(0, 600)
      let t = await gemini([{ text: [
        'Eres el community manager de VIMEDIC, importadora y distribuidora de equipos médicos en Quito, Ecuador.',
        'Escribe en español de Ecuador, tuteo profesional, sin exageraciones ni promesas médicas.',
        'Tarea: ' + TIPOS[tipo],
        'Redes: ' + plataformas + '. Formato: ' + formato + '.',
        'Usa emojis con moderación, párrafos cortos y, salvo que la tarea diga otra cosa, cierra con una llamada a la acción y 3 a 6 hashtags.',
        'SIEMPRE incluye una invitación clara a visitar nuestra página web ' + web + ' (escribe el enlace completo tal cual), aunque también invites a escribir por WhatsApp.',
        'Extensión máxima: 2000 caracteres en total, incluidos emojis, enlace y hashtags. Ideal entre 400 y 1200.',
        'No inventes precios, descuentos, registros sanitarios ni datos técnicos que no aparezcan aquí.',
        producto ? '\n' + producto : '',
        idea ? '\nIndicaciones del equipo: ' + idea : '',
        actual ? '\nTexto actual:\n' + actual : '',
        '\nDevuelve solo el texto final de la publicación, sin comillas ni explicaciones.',
      ].filter(Boolean).join('\n') }], { temperature: 0.75, maxOutputTokens: 2048 })
      t = t.replace(/^["“]|["”]$/g, '').trim()
      // mkAjustarCopy_: invitación a la web (antes de los hashtags) y máximo 2000 caracteres.
      const MAX = 2000, dominio = web.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase(), cta = '\n\n🌐 Conoce más en ' + web
      const finTags = (s: string) => s.match(/\n+((?:#[^\s#]+\s*)+)$/)
      if (!t.toLowerCase().includes(dominio)) { const m = finTags(t); t = m ? t.slice(0, m.index).trim() + cta + '\n\n' + m[1].trim() : t + cta }
      if ([...t].length > MAX) {
        const m = finTags(t), tags = m ? m[1].trim() : ''
        let cuerpo = m ? t.slice(0, m.index) : t
        let cola = (cuerpo.toLowerCase().includes(dominio) ? '' : cta) + (tags ? '\n\n' + tags : '')
        const idx = cuerpo.toLowerCase().lastIndexOf(dominio)
        if (idx >= 0) { const ini = cuerpo.lastIndexOf('\n', idx); cola = '\n\n' + cuerpo.slice(ini < 0 ? 0 : ini).trim() + (tags ? '\n\n' + tags : ''); cuerpo = cuerpo.slice(0, ini < 0 ? 0 : ini) }
        const espacio = MAX - [...cola].length - 1, arr = [...cuerpo.trim()]
        if (arr.length > espacio) { const corto = arr.slice(0, Math.max(0, espacio)).join(''); const corte = Math.max(corto.lastIndexOf('\n'), corto.lastIndexOf('. ')); cuerpo = (corte > espacio * 0.6 ? corto.slice(0, corte + 1) : corto).trim() }
        t = (cuerpo.trim() + cola).trim()
        if ([...t].length > MAX) t = [...t].slice(0, MAX).join('')
      }
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
