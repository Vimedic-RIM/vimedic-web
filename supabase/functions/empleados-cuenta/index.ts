// Edge Function: crea la cuenta de acceso de un empleado o le genera una contraseña nueva.
// Necesita service_role (auth.admin.*) — por eso no se puede hacer directo desde el navegador.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const responder = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
class Falla extends Error { constructor(m: string, public status = 400) { super(m) } }

// Sin caracteres ambiguos (0/O, 1/l/I) para que se pueda dictar o copiar sin errores.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
function generarClave(largo = 14) {
  const bytes = crypto.getRandomValues(new Uint8Array(largo))
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const usuario = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: u } = await usuario.auth.getUser()
    if (!u?.user) throw new Falla('Sesión no válida.', 401)

    const puede = async (m: string) => (await usuario.rpc('app_puede', { p_modulo: m, p_accion: 'editar' })).data === true
    if (!(await puede('empleados')) && !(await puede('talento_humano')) && !(await puede('seguridad'))) {
      throw new Falla('No tienes permiso para crear accesos de empleados.', 403)
    }
    const { data: mfaOk } = await usuario.rpc('app_exigir_mfa')
    if (mfaOk !== true) throw new Falla('Esta acción exige completar la verificación en dos pasos (Configuración › Seguridad).', 403)

    const b = await req.json().catch(() => ({}))
    const empleadoId = String(b.empleadoId || '')
    if (!empleadoId) throw new Falla('Falta el empleado.')

    const admin = createClient(url, srv)
    const { data: emp, error: e0 } = await admin.from('empleados').select('id,email,nombre,auth_user_id').eq('id', empleadoId).is('deleted_at', null).maybeSingle()
    if (e0) throw new Falla(e0.message)
    if (!emp) throw new Falla('No se encontró el empleado.', 404)

    const clave = generarClave()
    let nuevo = false

    if (emp.auth_user_id) {
      const { error } = await admin.auth.admin.updateUserById(emp.auth_user_id, { password: clave })
      if (error) throw new Falla('No se pudo cambiar la contraseña: ' + error.message)
    } else {
      // Puede que ya exista una cuenta de Auth con ese correo (por ejemplo, entró antes con Google)
      // sin que la tabla de empleados se haya vinculado todavía.
      let existente: { id: string } | null = null
      for (let page = 1; page <= 20 && !existente; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw new Falla(error.message)
        existente = data.users.find((x) => (x.email || '').toLowerCase() === emp.email.toLowerCase()) ?? null
        if (data.users.length < 200) break
      }
      if (existente) {
        const { error } = await admin.auth.admin.updateUserById(existente.id, { password: clave })
        if (error) throw new Falla('No se pudo cambiar la contraseña: ' + error.message)
        await admin.from('empleados').update({ auth_user_id: existente.id }).eq('id', empleadoId)
      } else {
        const { data: creado, error } = await admin.auth.admin.createUser({ email: emp.email, password: clave, email_confirm: true })
        if (error) throw new Falla('No se pudo crear la cuenta: ' + error.message)
        await admin.from('empleados').update({ auth_user_id: creado.user.id }).eq('id', empleadoId)
        nuevo = true
      }
    }
    return responder({ ok: true, clave, nuevo })
  } catch (e) {
    const f = e as Falla
    return responder({ error: f.message || 'Error inesperado.' }, f.status && f.status >= 400 ? f.status : 500)
  }
})
