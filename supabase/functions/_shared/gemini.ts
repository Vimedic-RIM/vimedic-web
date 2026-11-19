// Gemini (IA) compartido por las Edge Functions (marketing-integraciones y crm-mensajes):
//   · lista de modelos de Google (GET v1beta/models), filtrada y ordenada, en caché 24 h (integraciones.cache);
//   · modo «Automático»: el Flash más reciente;
//   · autorreparación: si Google retiró el modelo, toma el que sugiere el error (o el de la lista nueva),
//     reintenta UNA vez y deja anotado el cambio.
// La clave solo viaja en el encabezado x-goog-api-key: nunca se devuelve al navegador ni se escribe en los registros.

/* ======== Lo que se ajusta a mano: todo aquí, en un solo lugar ======== */
export const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta'
/** Valor guardado para «Automático · siempre el más reciente». */
export const GEMINI_AUTO = 'auto'
/** Modelo que usa el modo automático cuando no hay ninguna lista disponible. */
export const GEMINI_MODELO_RESPALDO = 'gemini-3.8-flash'
/** Lista mínima cuando Google no entrega la lista de modelos (y no hay una guardada). */
export const GEMINI_LISTA_RESPALDO: ModeloGemini[] = [
  { id: GEMINI_MODELO_RESPALDO, nombre: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.5-flash-lite', nombre: 'Gemini 3.5 Flash-Lite' },
]
/** Se excluyen los modelos cuyo nombre contiene alguna de estas palabras (no sirven para texto). */
export const GEMINI_EXCLUIR = ['tts', 'image', 'nano-banana', 'live', 'embedding', 'audio', 'vision', 'exp']
/** Horas que dura la lista de modelos guardada antes de volver a pedirla a Google. */
export const GEMINI_CACHE_HORAS = 24

export type ModeloGemini = { id: string; nombre: string }
type Cambio = { de: string; a: string; fecha: string }
type CacheGemini = { modelos?: ModeloGemini[]; retirados?: string[]; cambios?: Cambio[] }
export type CredGemini = { secreto: string | null; config: Record<string, unknown>; cache: CacheGemini; cacheEn: string | null }
export type ListaGemini = { modelos: ModeloGemini[]; actualizado: string | null; origen: 'google' | 'cache' | 'respaldo'; falla?: string } // falla: por qué Google no entregó la lista (no se llama «error»: la app lo tomaría como fallo total)
// deno-lint-ignore no-explicit-any
type Admin = any // cliente de Supabase con service_role

const VALIDO = /^gemini-[\w.-]+$/

/* ---------------- Lista: filtrar, ordenar y elegir ---------------- */
function version(id: string): [number, number] {
  const m = /^gemini-(\d+)(?:\.(\d+))?/.exec(id)
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : [0, 0]
}
/** De mayor a menor versión (3.8 > 3.5 > 2.5); en la misma versión, primero el estable (sin «preview») y el nombre más corto. */
export function ordenarModelos(lista: ModeloGemini[]): ModeloGemini[] {
  return [...lista].sort((a, b) => {
    const [a1, a2] = version(a.id), [b1, b2] = version(b.id)
    return (b1 - a1) || (b2 - a2) || (Number(/preview/.test(a.id)) - Number(/preview/.test(b.id))) || (a.id.length - b.id.length) || a.id.localeCompare(b.id)
  })
}
/** Solo modelos «gemini-…» con generateContent y que sirven para texto. */
// deno-lint-ignore no-explicit-any
export function filtrarModelos(crudos: any[]): ModeloGemini[] {
  const vistos = new Set<string>(), out: ModeloGemini[] = []
  for (const m of crudos ?? []) {
    const id = String(m?.name ?? '').replace(/^models\//, '')
    if (!VALIDO.test(id) || vistos.has(id)) continue
    if (!(Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))) continue
    const bajo = id.toLowerCase()
    if (GEMINI_EXCLUIR.some((p) => bajo.includes(p))) continue
    vistos.add(id)
    out.push({ id, nombre: String(m?.displayName || id) })
  }
  return ordenarModelos(out)
}
/** Modo automático: el «flash» (no lite, no pro) de versión más alta; si no hay, el primero; sin lista, el de respaldo. */
export function elegirAuto(lista: ModeloGemini[], evitar: string[] = []): string {
  const l = ordenarModelos(lista.filter((m) => !evitar.includes(m.id)))
  return l.find((m) => /flash/.test(m.id) && !/lite|pro/.test(m.id))?.id ?? l[0]?.id ?? GEMINI_MODELO_RESPALDO
}
/** Lo guardado en Configuración: «auto» o un modelo concreto (vacío o inválido = auto). */
export function modeloGuardado(cred: CredGemini): string {
  const g = String(cred.config?.modelo ?? '').trim()
  return g && g !== GEMINI_AUTO && VALIDO.test(g) ? g : GEMINI_AUTO
}

/* ---------------- Errores de modelo retirado ---------------- */
export const esModeloRetirado = (status: number, mensaje: string) => status === 404 || /no longer available|not found|is not supported/i.test(mensaje)
/** «…Please update your code to use models/gemini-3.8-flash.» → gemini-3.8-flash (descarta el modelo que falló). */
export function modeloSugerido(mensaje: string, actual: string): string | null {
  for (const m of String(mensaje).matchAll(/models\/(gemini-[\w.-]+)/g)) {
    const id = m[1].replace(/[.-]+$/, '')
    if (id !== actual && VALIDO.test(id)) return id
  }
  return null
}

/* ---------------- Base de datos (service_role) ---------------- */
export async function credencialGemini(admin: Admin): Promise<CredGemini> {
  const [{ data: fila }, { data: secreto }] = await Promise.all([
    admin.from('integraciones').select('config,cache,cache_en').eq('proveedor', 'gemini').is('deleted_at', null).maybeSingle(),
    admin.rpc('integracion_secreto', { p_proveedor: 'gemini' }),
  ])
  return { secreto: (secreto as string) || null, config: (fila?.config ?? {}) as Record<string, unknown>, cache: (fila?.cache ?? {}) as CacheGemini, cacheEn: fila?.cache_en ?? null }
}
async function guardar(admin: Admin, campos: Record<string, unknown>) {
  try {
    const { error } = await admin.from('integraciones').update(campos).eq('proveedor', 'gemini').is('deleted_at', null)
    if (error) console.error('[gemini] no se pudo guardar la configuración: ' + error.message)
  } catch (e) { console.error('[gemini] no se pudo guardar la configuración: ' + (e as Error).message) }
}

/* ---------------- Lista de modelos (Google o caché) ---------------- */
async function consultarGoogle(clave: string): Promise<ModeloGemini[]> {
  // deno-lint-ignore no-explicit-any
  const crudos: any[] = []
  let pagina = ''
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${GEMINI_API}/models?pageSize=1000${pagina ? '&pageToken=' + encodeURIComponent(pagina) : ''}`, { headers: { 'x-goog-api-key': clave }, signal: AbortSignal.timeout(10000) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(String(j?.error?.message || 'código ' + r.status))
    crudos.push(...(j?.models ?? []))
    pagina = String(j?.nextPageToken || '')
    if (!pagina) break
  }
  const modelos = filtrarModelos(crudos)
  if (!modelos.length) throw new Error('Google no devolvió modelos de texto')
  return modelos
}
/** Lista vigente (24 h) de la caché; si venció o se fuerza, la pide a Google. Si Google falla: la última guardada o la de respaldo. */
export async function listaModelos(admin: Admin, cred: CredGemini, forzar = false): Promise<ListaGemini> {
  const sinRetirados = (l: ModeloGemini[]) => l.filter((m) => !(cred.cache.retirados ?? []).includes(m.id))
  const guardada = sinRetirados(cred.cache.modelos ?? [])
  const vigente = !!cred.cacheEn && Date.now() - Date.parse(cred.cacheEn) < GEMINI_CACHE_HORAS * 3600e3
  if (!forzar && vigente && guardada.length) return { modelos: guardada, actualizado: cred.cacheEn, origen: 'cache' }
  try {
    if (!cred.secreto) throw new Error('Gemini no está conectado')
    const modelos = await consultarGoogle(cred.secreto)
    const ahora = new Date().toISOString()
    cred.cache = { ...cred.cache, modelos }
    cred.cacheEn = ahora
    await guardar(admin, { cache: cred.cache, cache_en: ahora })
    return { modelos: sinRetirados(modelos), actualizado: ahora, origen: 'google' }
  } catch (e) {
    const falla = (e as Error).message
    if (guardada.length) return { modelos: guardada, actualizado: cred.cacheEn, origen: 'cache', falla }
    return { modelos: GEMINI_LISTA_RESPALDO, actualizado: null, origen: 'respaldo', falla }
  }
}

/** Para la pantalla: lista, modelo guardado, a cuál resuelve «Automático» y, si el guardado ya no existe, lo pasa a «auto». */
export async function estadoModelos(admin: Admin, cred: CredGemini, forzar = false) {
  const lista = await listaModelos(admin, cred, forzar)
  let guardado = modeloGuardado(cred), migrado: string | null = null
  // Solo con una lista real de Google (no la de respaldo) se puede afirmar que el modelo ya no existe.
  if (guardado !== GEMINI_AUTO && lista.origen !== 'respaldo' && !lista.modelos.some((m) => m.id === guardado)) {
    migrado = guardado
    guardado = GEMINI_AUTO
    cred.config = { ...cred.config, modelo: GEMINI_AUTO }
    await guardar(admin, { config: cred.config })
    console.log(`[gemini] el modelo guardado ${migrado} ya no está en la lista de Google → auto · ${new Date().toISOString()}`)
  }
  return { ...lista, guardado, auto: elegirAuto(lista.modelos), migrado }
}

/* ---------------- Llamada a generateContent con autorreparación ---------------- */
async function llamarModelo(clave: string, modelo: string, cuerpo: Record<string, unknown>) {
  const r = await fetch(`${GEMINI_API}/models/${modelo}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave }, body: JSON.stringify(cuerpo) })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, j, mensaje: String(j?.error?.message || 'código ' + r.status) }
}
async function registrarCambio(admin: Admin, cred: CredGemini, de: string, a: string, guardado: string) {
  const fecha = new Date().toISOString()
  console.log(`[gemini] modelo retirado: ${de} → ${a} · ${fecha}${guardado === GEMINI_AUTO ? ' · sigue en Automático' : ''}`)
  cred.cache = {
    ...cred.cache,
    retirados: [...new Set([de, ...(cred.cache.retirados ?? [])])].slice(0, 50),
    cambios: [{ de, a, fecha }, ...(cred.cache.cambios ?? [])].slice(0, 20),
  }
  const campos: Record<string, unknown> = { cache: cred.cache }
  if (guardado !== GEMINI_AUTO) { cred.config = { ...cred.config, modelo: a }; campos.config = cred.config }
  await guardar(admin, campos)
}

/** generateContent (v1beta) con el modelo guardado o el automático. Si Google lo retiró, cambia de modelo y reintenta una vez. */
export async function generarGemini(admin: Admin, cred: CredGemini, cuerpo: Record<string, unknown>): Promise<{ texto: string; modelo: string }> {
  if (!cred.secreto) throw new Error('La IA (Gemini) no está conectada. Se conecta en Marketing › Configuración.')
  const guardado = modeloGuardado(cred)
  let modelo = guardado === GEMINI_AUTO ? elegirAuto((await listaModelos(admin, cred)).modelos) : guardado
  let r = await llamarModelo(cred.secreto, modelo, cuerpo)
  if (!r.ok && esModeloRetirado(r.status, r.mensaje)) {
    const anterior = modelo
    // a) el error sugiere el reemplazo; b) si no, lista nueva de Google y la regla del modo automático
    const nuevo = modeloSugerido(r.mensaje, anterior) ?? elegirAuto((await listaModelos(admin, cred, true)).modelos, [anterior])
    if (nuevo !== anterior) {
      const r2 = await llamarModelo(cred.secreto, nuevo, cuerpo) // c) un solo reintento
      if (r2.ok) { await registrarCambio(admin, cred, anterior, nuevo, guardado); modelo = nuevo } // d)
      r = r2
    }
  }
  if (!r.ok) throw new Error('Gemini respondió: ' + r.mensaje) // e) el error real, como antes
  // deno-lint-ignore no-explicit-any
  const texto = ((r.j?.candidates?.[0]?.content?.parts ?? []) as any[]).filter((x) => !x.thought).map((x) => x.text || '').join('').trim()
  if (!texto) throw new Error('La IA no devolvió texto. Intenta de nuevo.')
  return { texto, modelo }
}
