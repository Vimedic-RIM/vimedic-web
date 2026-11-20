// Enviar correos con el Gmail de la empresa (la cuenta conectada en Marketing › Configuración › Google Drive con
// «Conectar con Google»; desde el 20-nov ese botón pide también el permiso «Enviar correo»). Como GmailApp en la app original.
import { LOGO_BLANCO_PNG, LOGO_COLOR_PNG } from './logosCorreo.ts'
import { mensajeGmail } from './correoLeads.ts'

const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send'
// deno-lint-ignore no-explicit-any
type Admin = any

/** Token de acceso de la cuenta de Google conectada, con el permiso de enviar correo. Errores en español. */
export async function tokenGmail(admin: Admin): Promise<{ token: string; cuenta: string }> {
  const [{ data: s }, { data: a }] = await Promise.all([admin.rpc('integracion_secreto', { p_proveedor: 'drive' }), admin.rpc('integracion_secreto', { p_proveedor: 'google_app' })])
  let cred: { tipo?: string; refresh_token?: string; cuenta?: string } = {}, app: { client_id?: string; client_secret?: string } = {}
  try { cred = JSON.parse(String(s || '{}')) } catch { cred = {} }
  try { app = JSON.parse(String(a || '{}')) } catch { app = {} }
  if (cred.tipo !== 'oauth' || !cred.refresh_token) throw new Error('Para enviar correos conecta la cuenta de Google de la empresa: Marketing › Configuración › Google Drive › «Conectar con Google».')
  if (!app.client_id || !app.client_secret) throw new Error('Faltan los datos de la app de Google en Marketing › Configuración.')
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cred.refresh_token, client_id: app.client_id, client_secret: app.client_secret }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error === 'invalid_grant' ? 'La autorización de Google venció: en Marketing › Configuración pulsa otra vez «Conectar con Google».' : 'Google rechazó la autorización: ' + (j?.error_description || j?.error || r.status))
  if (!String(j.scope || '').split(' ').includes(GMAIL_SEND)) throw new Error('Falta el permiso «Enviar correo» de Gmail: en Marketing › Configuración › Google Drive pulsa otra vez «Conectar con Google» y deja marcada la casilla de Gmail.')
  return { token: String(j.access_token), cuenta: String(cred.cuenta || '') }
}

/** Envía un correo HTML con los logos de VIMEDIC adjuntos (cid:vmlogo, cid:vmlogoblanco). */
export async function enviarGmail(admin: Admin, o: { para: string; cc?: string; asunto: string; html: string; texto: string; nombreDe?: string }): Promise<void> {
  const { token, cuenta } = await tokenGmail(admin)
  const raw = mensajeGmail({
    de: cuenta || 'me', nombreDe: o.nombreDe || 'VIMEDIC · Clientes potenciales', para: o.para, cc: o.cc, asunto: o.asunto, html: o.html, texto: o.texto,
    imagenes: [{ cid: 'vmlogo', nombre: 'vimedic-logo.png', png: LOGO_COLOR_PNG }, { cid: 'vmlogoblanco', nombre: 'vimedic-logo-blanco.png', png: LOGO_BLANCO_PNG }],
  })
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) })
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error('Gmail no envió el correo: ' + (j?.error?.message || r.status)) }
}
