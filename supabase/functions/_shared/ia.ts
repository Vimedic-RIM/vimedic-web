// IA de la plataforma (Edge Functions): Claude (Anthropic) si está conectado en Marketing › Configuración;
// si no, Gemini como respaldo (./gemini.ts). Lo usan marketing-integraciones (redes, fichas, descripciones,
// textos alternativos) y crm-mensajes (sugerir respuesta).
// La clave vive cifrada en Vault: solo se descifra aquí (service_role), nunca va al navegador ni a los registros.
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0'
import { credencialGemini, generarGemini } from './gemini.ts'

/* ======== Ajustes de Claude: todo aquí, en un solo lugar ======== */
/** Modelo por defecto (si en Configuración no se eligió otro). */
export const CLAUDE_MODELO = 'claude-opus-5-5'
/** Tope de la respuesta (incluye el razonamiento interno del modelo). */
export const CLAUDE_MAX_TOKENS = 16000
/** Modelos que aceptan el respaldo automático de Anthropic cuando su filtro de seguridad rechaza una solicitud. */
const CON_RESPALDO_ANTHROPIC = /^claude-(opus|sonnet)-/

/** Esfuerzo de razonamiento: «low» para respuestas cortas y rápidas, «medium» para redactar o leer fichas. */
export type Esfuerzo = 'low' | 'medium' | 'high'
/** Partes del pedido (mismo formato que ya usaban las funciones con Gemini). */
export type ParteIA = { text?: string; inline_data?: { mime_type: string; data: string } }
export type CredClaude = { secreto: string | null; config: Record<string, unknown> }
// deno-lint-ignore no-explicit-any
type Admin = any // cliente de Supabase con service_role
type MediaImagen = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export async function credencialClaude(admin: Admin): Promise<CredClaude> {
  const [{ data: fila }, { data: secreto }] = await Promise.all([
    admin.from('integraciones').select('config').eq('proveedor', 'claude').is('deleted_at', null).maybeSingle(),
    admin.rpc('integracion_secreto', { p_proveedor: 'claude' }),
  ])
  return { secreto: (secreto as string) || null, config: (fila?.config ?? {}) as Record<string, unknown> }
}
export function modeloClaude(config: Record<string, unknown>): string {
  const m = String(config?.modelo ?? '').trim()
  return /^claude-[a-z0-9-]+$/.test(m) ? m : CLAUDE_MODELO
}

/** Texto, PDF (ficha técnica) e imágenes → bloques de contenido de Claude. El PDF va antes del texto, como ya lo arman las funciones. */
export function contenidoClaude(partes: ParteIA[]): Anthropic.Beta.BetaContentBlockParam[] {
  return partes.map((p): Anthropic.Beta.BetaContentBlockParam => {
    const d = p.inline_data
    if (d?.data && d.mime_type === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.data } }
    if (d?.data && /^image\/(jpeg|png|gif|webp)$/.test(d.mime_type)) return { type: 'image', source: { type: 'base64', media_type: d.mime_type as MediaImagen, data: d.data } }
    return { type: 'text', text: String(p.text ?? '') }
  })
}

/** Un pedido a Claude (Messages API). Errores en español y con el motivo real. */
export async function generarClaude(cred: CredClaude, partes: ParteIA[], esfuerzo: Esfuerzo = 'medium'): Promise<{ texto: string; modelo: string }> {
  if (!cred.secreto) throw new Error('Claude no está conectado. Ve a Marketing › Configuración.')
  const modelo = modeloClaude(cred.config)
  const client = new Anthropic({ apiKey: cred.secreto, timeout: 90_000, maxRetries: 1 })
  let r: Anthropic.Beta.BetaMessage
  try {
    r = await client.beta.messages.create({
      model: modelo,
      max_tokens: CLAUDE_MAX_TOKENS,
      output_config: { effort: esfuerzo },
      // Si el filtro de seguridad rechaza, Anthropic reintenta solo con otro modelo (Haiku no lo admite).
      ...(CON_RESPALDO_ANTHROPIC.test(modelo) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      messages: [{ role: 'user', content: contenidoClaude(partes) }],
    })
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const motivo = e instanceof Anthropic.APIError ? String((e.error as any)?.error?.message || e.message) : (e as Error).message
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude rechazó la clave de API. Pega una nueva en Marketing › Configuración.')
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('La clave de Claude no tiene permiso para usar el modelo «' + modelo + '»: ' + motivo)
    if (e instanceof Anthropic.NotFoundError) throw new Error('Claude no reconoce el modelo «' + modelo + '». Elige otro en Marketing › Configuración.')
    if (e instanceof Anthropic.RateLimitError) throw new Error('Claude llegó al límite de uso de la cuenta en este momento. Intenta de nuevo en un minuto.')
    if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(motivo)) throw new Error('La cuenta de Claude no tiene saldo: recarga créditos en console.anthropic.com › Billing.')
    if (e instanceof Anthropic.APIConnectionError) throw new Error('No se pudo conectar con Claude (sin respuesta a tiempo). Intenta de nuevo.')
    throw new Error('Claude respondió: ' + motivo)
  }
  if (r.stop_reason === 'refusal') throw new Error('Claude no respondió esta solicitud por su filtro de seguridad. Cambia el texto e intenta de nuevo.')
  const texto = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
  if (!texto) throw new Error(r.stop_reason === 'max_tokens' ? 'La respuesta de Claude quedó cortada. Intenta de nuevo.' : 'La IA no devolvió texto. Intenta de nuevo.')
  return { texto, modelo: r.model || modelo }
}

/** La IA de la plataforma: Claude si está conectado; si no, Gemini (respaldo). `gemini` = ajustes de Gemini, solo para el respaldo. */
export async function generarIA(admin: Admin, partes: ParteIA[], opciones: { esfuerzo?: Esfuerzo; gemini?: Record<string, unknown> } = {}): Promise<{ texto: string; modelo: string; proveedor: 'claude' | 'gemini' }> {
  const claude = await credencialClaude(admin)
  if (claude.secreto) return { ...(await generarClaude(claude, partes, opciones.esfuerzo)), proveedor: 'claude' }
  const g = await credencialGemini(admin)
  if (g.secreto) return { ...(await generarGemini(admin, g, { contents: [{ role: 'user', parts: partes }], generationConfig: opciones.gemini ?? {} })), proveedor: 'gemini' }
  throw new Error('La IA no está conectada. Conecta Claude en Marketing › Configuración.')
}
