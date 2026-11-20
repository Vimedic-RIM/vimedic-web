// Edge Function: «Conectar con Google» (OAuth 2.0) para Google Drive.
//   POST {accion:'iniciar', origen}  → enlace de autorización de Google (solo quien administra Marketing).
//   GET  ?code=…&state=…             → Google vuelve aquí tras «Permitir»: se canjea el código por un permiso
//                                       permanente (refresh token), se guarda cifrado en Vault y se avisa a la app.
// El ID de cliente y el secreto de la «app de Google» de VIMEDIC se guardan una sola vez en Marketing › Configuración
// (integraciones.google_app). Esta función no exige sesión de Supabase (Google llega sin ella): el «state» va firmado.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
// gmail.send (20-nov): los correos de los leads de Meta al asesor salen de esta misma cuenta (como GmailApp en la app original).
const ALCANCES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/gmail.send', 'openid', 'email']
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
class Falla extends Error { constructor(m: string, public status = 400) { super(m) } }

const b64u = (bytes: Uint8Array) => { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const deB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))
async function firmar(texto: string): Promise<string> {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode('google-oauth:' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(texto))))
}
/** Al terminar, la ventana de Google vuelve a una página de la propia app (public/conexion-lista.html), que avisa a la
 *  pantalla de Configuración y se cierra. (Supabase no muestra páginas HTML desde sus funciones: las sirve como texto.) */
function pagina(ok: boolean, texto: string, origen: string, cuenta = '') {
  if (!origen) return new Response((ok ? 'Google Drive conectado. ' : 'No se pudo conectar: ') + texto + ' Ya puedes cerrar esta ventana.', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  const destino = origen + '/conexion-lista.html?' + new URLSearchParams({ p: 'drive', ok: ok ? '1' : '0', texto, cuenta })
  return new Response(null, { status: 302, headers: { Location: destino } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, srv)
  const redirectUri = url.replace(/\/$/, '') + '/functions/v1/google-oauth'
  const appGoogle = async () => {
    const { data } = await admin.rpc('integracion_secreto', { p_proveedor: 'google_app' })
    if (!data) throw new Falla('Primero guarda el ID de cliente y el secreto de la app de Google (una sola vez) en Marketing › Configuración.')
    try { const j = JSON.parse(String(data)); if (!j.client_id || !j.client_secret) throw new Error('x'); return j as { client_id: string; client_secret: string } }
    catch { throw new Falla('Los datos guardados de la app de Google no son válidos. Vuelve a guardarlos.') }
  }

  /* ---------- Vuelta desde Google ---------- */
  if (req.method === 'GET') {
    const p = new URL(req.url).searchParams
    const [cuerpo = '', firma = ''] = String(p.get('state') || '').split('.')
    let st: { e: string; o: string; x: number } = { e: '', o: '', x: 0 }
    try { st = JSON.parse(new TextDecoder().decode(deB64u(cuerpo))) } catch { /* inválido */ }
    // Solo se vuelve a la app si el «state» lo firmó esta función (si no, sería una redirección abierta a cualquier sitio).
    const firmado = !!cuerpo && firma === (await firmar(cuerpo))
    const origen = firmado && /^https:\/\/[\w.-]+(:\d+)?$|^http:\/\/localhost(:\d+)?$/.test(st.o || '') ? st.o : ''
    try {
      if (!firmado) throw new Falla('El enlace de autorización no es válido. Vuelve a pulsar «Conectar con Google».')
      if (Date.now() > st.x) throw new Falla('El enlace de autorización venció (10 minutos). Vuelve a pulsar «Conectar con Google».')
      if (p.get('error')) throw new Falla(p.get('error') === 'access_denied' ? 'No se dio el permiso en Google.' : 'Google respondió: ' + p.get('error'))
      const code = p.get('code')
      if (!code) throw new Falla('Google no devolvió la autorización.')
      const app = await appGoogle()
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: app.client_id, client_secret: app.client_secret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) })
      const t = await r.json()
      if (!r.ok) throw new Falla('Google no aceptó la autorización: ' + (t.error_description || t.error || r.status))
      if (!String(t.scope || '').split(' ').includes('https://www.googleapis.com/auth/drive')) throw new Falla('No se marcó el permiso de Google Drive. Vuelve a conectar y deja marcada la casilla de Drive.')
      if (!t.refresh_token) throw new Falla('Google no entregó el permiso permanente. Vuelve a pulsar «Conectar con Google».')
      let cuenta = ''
      try { cuenta = JSON.parse(new TextDecoder().decode(deB64u(String(t.id_token).split('.')[1]))).email || '' } catch { /* sin correo */ }
      const { error } = await admin.rpc('integracion_guardar_servicio', { p_proveedor: 'drive', p_secreto: JSON.stringify({ tipo: 'oauth', refresh_token: t.refresh_token, cuenta }), p_config: { modo: 'oauth', cuenta }, p_empleado: st.e || null })
      if (error) throw new Falla('No se pudo guardar la conexión: ' + error.message)
      return pagina(true, 'La app ya puede guardar archivos en Drive con esta cuenta. Vuelve a la app: se probará la conexión.', origen, cuenta)
    } catch (e) {
      return pagina(false, (e as Error).message || 'Error inesperado.', origen)
    }
  }

  /* ---------- Desde la app: armar el enlace de Google ---------- */
  try {
    const usuario = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: u } = await usuario.auth.getUser()
    if (!u?.user) throw new Falla('Sesión no válida.', 401)
    if ((await usuario.rpc('app_puede', { p_modulo: 'marketing', p_accion: 'administrar' })).data !== true) throw new Falla('Solo quien administra Marketing puede conectar plataformas.', 403)
    const b = await req.json().catch(() => ({}))
    if (String(b.accion || '') === 'datos') return json({ redirect_uri: redirectUri })
    if (String(b.accion || '') !== 'iniciar') throw new Falla('Acción no reconocida.')
    const app = await appGoogle()
    const { data: emp } = await usuario.rpc('mi_perfil')
    const cuerpo = b64u(new TextEncoder().encode(JSON.stringify({ e: (emp as { id?: string } | null)?.id ?? '', o: String(b.origen || ''), x: Date.now() + 10 * 60000 })))
    const enlace = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: app.client_id, redirect_uri: redirectUri, response_type: 'code', scope: ALCANCES.join(' '),
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: cuerpo + '.' + (await firmar(cuerpo)),
    })
    return json({ ok: true, enlace, redirect_uri: redirectUri })
  } catch (e) {
    const f = e as Falla
    return json({ error: f.message || 'Error inesperado.' }, f.status && f.status >= 400 ? f.status : 500)
  }
})
