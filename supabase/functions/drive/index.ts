// Edge Function: puente seguro con Google Drive (cuenta de servicio + unidad compartida "VIMEDIC Sistema").
// El JSON de la cuenta de servicio vive cifrado en Supabase Vault; solo se descifra aquí, con service_role.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const MODULOS = ['crm', 'clientes', 'femedics', 'facturacion', 'inventario', 'marketing', 'bodega', 'logistica', 'servicio_tecnico', 'importaciones', 'talento_humano', 'financiero', 'empleados', 'documentos_tecnicos', 'catalogos', 'ofertas', 'agenda']
const MAX_BYTES = 20 * 1024 * 1024
const responder = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
class Falla extends Error { constructor(m: string, public status = 400) { super(m) } }

const b64u = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : b instanceof Uint8Array ? b : new Uint8Array(b)
  let s = ''; for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
let cache: { token: string; hasta: number; clave: string } | null = null

async function tokenGoogle(sa: { client_email: string; private_key: string }) {
  if (cache && cache.clave === sa.client_email && cache.hasta > Date.now() + 60000) return cache.token
  const ahora = Math.floor(Date.now() / 1000)
  const cab = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const cuerpo = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }))
  const pem = sa.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const llave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', llave, new TextEncoder().encode(cab + '.' + cuerpo))
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cab}.${cuerpo}.${b64u(firma)}` }) })
  const j = await r.json()
  if (!r.ok) throw new Falla('Google rechazó la cuenta de servicio: ' + (j.error_description || j.error || r.status))
  cache = { token: j.access_token, hasta: Date.now() + (j.expires_in ?? 3600) * 1000, clave: sa.client_email }
  return cache.token
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const usuario = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const b = await req.json().catch(() => ({}))
    const accion = String(b.accion || '')
    // Material de proveedores (MaterialProveedores.gs): el proveedor no tiene cuenta; lo autoriza el código de su enlace,
    // que la base valida (solicitud abierta, vigente y producto abierto) antes de abrir la subida o registrar el archivo.
    const esProveedor = accion === 'material_iniciar' || accion === 'material_registrar'
    if (!esProveedor) {
      const { data: u } = await usuario.auth.getUser()
      if (!u?.user) throw new Falla('Sesión no válida.', 401)
    }
    const admin = createClient(url, srv)
    const puede = async (m: string, a: string) => (await usuario.rpc('app_puede', { p_modulo: m, p_accion: a })).data === true

    const [{ data: cfg }, { data: secreto }] = await Promise.all([
      admin.from('integraciones').select('config').eq('proveedor', 'drive').is('deleted_at', null).maybeSingle(),
      admin.rpc('integracion_secreto', { p_proveedor: 'drive' }),
    ])
    if (!secreto) throw new Falla('Google Drive no está conectado. Ve a Marketing › Configuración.')
    let sa: { client_email: string; private_key: string }
    try { sa = JSON.parse(secreto as string) } catch { throw new Falla('El JSON de la cuenta de servicio guardado no es válido. Vuelve a pegarlo.') }
    const driveId = String((cfg.config as Record<string, unknown>)?.driveId || '').trim()
    if (!driveId) throw new Falla('Falta el ID de la unidad compartida o carpeta en la configuración.')
    // 'unidad' = unidad compartida; 'carpeta' = carpeta de Mi unidad compartida con la cuenta de servicio (se detecta al probar)
    let tipo = String((cfg.config as Record<string, unknown>)?.tipo || 'unidad')
    const alcance = () => (tipo === 'unidad' ? `&corpora=drive&driveId=${driveId}` : '')
    const tk = await tokenGoogle(sa)
    const g = async (ruta: string, init: RequestInit = {}) => {
      const r = await fetch('https://www.googleapis.com' + ruta, { ...init, headers: { Authorization: 'Bearer ' + tk, ...(init.headers ?? {}) } })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Falla('Drive respondió: ' + (j?.error?.message || r.status))
      return j
    }
    const esc = (s: string) => s.split('\\').join('\\\\').split("'").join("\\'")
    const carpeta = async (padre: string, nombre: string) => {
      const q = `name='${esc(nombre)}' and '${padre}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      const l = await g(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true${alcance()}`)
      if (l.files?.[0]?.id) return l.files[0].id as string
      const c = await g('/drive/v3/files?supportsAllDrives=true&fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [padre] }) })
      return c.id as string
    }
    const ruta = async (r: string) => {
      let padre = driveId
      for (const seg of String(r || '').split('/').map((s) => s.replace(/[\\<>:"|?*]/g, '').trim()).filter(Boolean).slice(0, 5)) padre = await carpeta(padre, seg)
      return padre
    }

    if (accion === 'probar') {
      if (!(await puede('marketing', 'administrar'))) throw new Falla('Solo quien administra puede probar la conexión.', 403)
      let d: { name: string }
      try { d = await g(`/drive/v3/drives/${driveId}?fields=id,name`); tipo = 'unidad' } catch {
        d = await g(`/drive/v3/files/${driveId}?fields=id,name,mimeType&supportsAllDrives=true`); tipo = 'carpeta'
      }
      await admin.from('integraciones').update({ config: { ...(cfg.config as Record<string, unknown>), tipo } }).eq('proveedor', 'drive')
      let archivoPrueba = ''
      if (b.escribir) {
        const padre = await ruta('_pruebas')
        const meta = JSON.stringify({ name: 'conexion-vimedic-' + new Date().toISOString().slice(0, 10) + '.txt', parents: [padre] })
        const cuerpo = `--x\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--x\r\nContent-Type: text/plain\r\n\r\nPrueba de conexión VIMEDIC ${new Date().toISOString()}\r\n--x--`
        const f = await g('/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=x' }, body: cuerpo })
        archivoPrueba = f.webViewLink || f.name
      }
      const mensaje = `Conexión correcta · ${tipo === 'unidad' ? 'unidad' : 'carpeta'} «${d.name}»${archivoPrueba ? ' · archivo de prueba creado en la carpeta _pruebas' : ''}.`
      await admin.from('integraciones').update({ estado_prueba: 'ok: ' + mensaje, probado_en: new Date().toISOString() }).eq('proveedor', 'drive')
      return responder({ ok: true, mensaje, cuenta: sa.client_email, archivo: archivoPrueba })
    }

    const modulo = String(b.modulo || '')
    if (!esProveedor && !MODULOS.includes(modulo)) throw new Falla('Módulo no válido.')
    if (accion === 'listar') {
      if (!(await puede(modulo, 'ver'))) throw new Falla('Sin acceso a ese módulo.', 403)
      const padre = await ruta(String(b.carpeta || ''))
      const q = `'${padre}' in parents and trashed=false`
      const l = await g(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true${alcance()}`)
      return responder({ archivos: l.files ?? [] })
    }
    if (accion === 'subir') {
      if (!(await puede(modulo, 'crear')) && !(await puede(modulo, 'editar'))) throw new Falla('No tienes permiso para subir archivos en ese módulo.', 403)
      const nombre = String(b.nombre || '').replace(/[\\/<>:"|?*]/g, '_').trim().slice(0, 150)
      if (!nombre || !b.base64) throw new Falla('Falta el archivo.')
      const bytes = Uint8Array.from(atob(String(b.base64)), (c) => c.charCodeAt(0))
      if (bytes.length > MAX_BYTES) throw new Falla('El archivo supera los 20 MB.')
      const padre = await ruta(String(b.carpeta || modulo))
      const mime = String(b.mime || 'application/octet-stream')
      const enc = new TextEncoder()
      const partes = [enc.encode(`--x\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name: nombre, parents: [padre] })}\r\n--x\r\nContent-Type: ${mime}\r\n\r\n`), bytes, enc.encode('\r\n--x--')]
      const cuerpo = new Uint8Array(partes.reduce((a, p) => a + p.length, 0)); let o = 0
      for (const p of partes) { cuerpo.set(p, o); o += p.length }
      const f = await g('/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,size', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=x' }, body: cuerpo })
      return responder({ ok: true, id: f.id, nombre: f.name, enlace: f.webViewLink })
    }
    /* Archivos grandes (videos de Audiovisual hasta 2 GB, como avIniciarSubida del original): el servidor
       abre una subida reanudable en Drive y el navegador envía el archivo directo a Google, por partes. */
    if (accion === 'subida_iniciar') {
      if (!(await puede(modulo, 'crear')) && !(await puede(modulo, 'editar'))) throw new Falla('No tienes permiso para subir archivos en ese módulo.', 403)
      const nombre = String(b.nombre || '').replace(/[\\/<>:"|?*]/g, '_').trim().slice(0, 150)
      const mime = String(b.mime || ''), tamano = Number(b.tamano) || 0
      if (!nombre || !tamano) throw new Falla('Falta el archivo.')
      if (tamano > 2 * 1024 * 1024 * 1024) throw new Falla('El archivo supera los 2 GB.')
      if (modulo === 'marketing' && !/^(image|video)\//.test(mime)) throw new Falla('Solo se admiten fotos y videos.')
      const padre = await ruta(String(b.carpeta || modulo))
      const origen = req.headers.get('Origin') || ''
      const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink,size,mimeType', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime || 'application/octet-stream', 'X-Upload-Content-Length': String(tamano), ...(origen ? { Origin: origen } : {}) },
        body: JSON.stringify({ name: nombre, parents: [padre] }),
      })
      const sesion = r.headers.get('Location')
      if (!r.ok || !sesion) { const j = await r.json().catch(() => ({})); throw new Falla('Drive no abrió la subida: ' + (j?.error?.message || r.status)) }
      return responder({ ok: true, sesion })
    }
    /* Enlace público de descarga para que Zernio pueda leer el archivo (avEnlaceDrive_ del original). */
    if (accion === 'compartir') {
      if (!(await puede(modulo, 'crear')) && !(await puede(modulo, 'editar'))) throw new Falla('No tienes permiso en ese módulo.', 403)
      const id = String(b.id || '')
      if (!/^[\w-]{10,120}$/.test(id)) throw new Falla('Archivo inválido.')
      const f = await g(`/drive/v3/files/${id}?fields=id,name,mimeType,size,webViewLink&supportsAllDrives=true`)
      let publico = true, motivo = ''
      try { await g(`/drive/v3/files/${id}/permissions?supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) }) }
      catch (e) { publico = false; motivo = (e as Error).message }
      return responder({ ok: true, id: f.id, nombre: f.name, mime: f.mimeType, tamano: Number(f.size) || 0, enlace: f.webViewLink, descarga: publico ? `https://drive.usercontent.google.com/download?id=${f.id}&export=download&confirm=t` : '', publico, motivo })
    }
    /* Material de proveedores: subida por partes directo a Drive (vmMatIniciarSubida) y registro del archivo (vmMatSubirParte). */
    if (esProveedor) {
      const token = String(b.token || ''), clave = String(b.clave || '')
      const TIPOS: Record<string, string> = { ficha: 'Ficha técnica', manual: 'Manual', cert: 'Certificaciones', video: 'Videos', otro: 'Otros' }
      const tipoM = TIPOS[String(b.tipo || '')] ? String(b.tipo) : 'otro'
      const v = await admin.rpc('material_validar_subida', { p_token: token, p_clave: clave })
      if (v.error) throw new Falla(v.error.message)
      const padre = await ruta(String((v.data as { carpeta: string }).carpeta || 'Material proveedores'))
      if (accion === 'material_iniciar') {
        const nombre = String(b.nombre || '').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 140) || 'archivo'
        const mime = String(b.mime || 'application/octet-stream').slice(0, 120), tamano = Number(b.tamano) || 0, esVideo = /^video\//.test(mime)
        if (/\.(exe|bat|cmd|com|scr|js|vbs|msi|ps1|sh|jar|apk|html?|php)$/i.test(nombre)) throw new Falla('Tipo de archivo no permitido. / File type not allowed.')
        if (!/^(application\/(pdf|zip|x-zip-compressed|x-rar-compressed|vnd\.rar|x-7z-compressed|msword|vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.ms-excel|vnd\.ms-powerpoint|octet-stream)|image\/(jpeg|png|webp|gif|tiff)|video\/[\w.+-]+|text\/plain)$/.test(mime))
          throw new Falla('Tipo de archivo no permitido. / File type not allowed.')
        if (tamano <= 0 || tamano > (esVideo ? 1024 * 1024 * 1024 : 100 * 1024 * 1024)) throw new Falla('El archivo es demasiado grande (máx. ' + (esVideo ? '1 GB' : '100 MB') + '). / File too large.')
        const origen = req.headers.get('Origin') || ''
        const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink,size', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(tamano), ...(origen ? { Origin: origen } : {}) },
          body: JSON.stringify({ name: TIPOS[tipoM] + ' - ' + nombre, parents: [padre], description: 'Material de proveedor · ' + clave + ' · ' + TIPOS[tipoM] }),
        })
        const sesion = r.headers.get('Location')
        if (!r.ok || !sesion) throw new Falla('No se pudo iniciar la subida. Intente de nuevo. / Could not start the upload.')
        return responder({ ok: true, sesion })
      }
      // material_registrar: el archivo debe estar en la carpeta de ese producto
      const id = String(b.id || '')
      if (!/^[\w-]{10,120}$/.test(id)) throw new Falla('Archivo no válido.')
      const f = await g(`/drive/v3/files/${id}?fields=id,name,size,webViewLink,parents&supportsAllDrives=true`)
      if (!(f.parents ?? []).includes(padre)) throw new Falla('Archivo no válido.')
      try { await g(`/drive/v3/files/${id}/permissions?supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) }) } catch { /* queda privado */ }
      const reg = await admin.rpc('material_registrar_archivo', { p_token: token, d: { clave, tipo: tipoM, nombre: String(b.nombre || f.name || '').slice(0, 140), url: f.webViewLink || `https://drive.google.com/file/d/${id}/view`, tamano: String(Number(f.size) || 0) } })
      if (reg.error) throw new Falla(reg.error.message)
      return responder({ ok: true })
    }
    throw new Falla('Acción no reconocida.')
  } catch (e) {
    const f = e as Falla
    return responder({ error: f.message || 'Error inesperado.' }, f.status && f.status >= 400 ? f.status : 500)
  }
})
