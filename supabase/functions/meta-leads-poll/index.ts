// Edge Function: sincronización de leads de Meta por CONSULTA (respaldo del webhook meta-leads).
//   Meta puede bloquear la entrega del webhook («CRM access has been revoked from Lead Access Manager») aunque el
//   usuario del sistema sí pueda leer los leads. Esta función pide a la Graph API los formularios de la página y sus
//   leads recientes, y procesa cada uno con la MISMA lógica del webhook (../_shared/metaServidor.ts › procesarLead):
//   anti-duplicado por meta_lead_id, interacción, reparto por los triggers de «leads» y correo urgente al asesor.
//   · Cron (pg_cron cada 5 min, trabajo 'meta-leads-poll'): encabezado x-cron-secret = clave de Vault.
//   · Manual (Marketing › Configuración › «Traer leads», quien administra Marketing): {"accion":"sincronizar","lookback_minutes": N}.
//     También {"accion":"programar","activo":true|false} enciende o apaga la sincronización cada 5 min.
//   Ventana: desde la última sincronización correcta − 10 min (mínimo 20 min); lookback_minutes la fuerza.
//   Cada ejecución queda en meta_sync_runs (formularios, encontrados, nuevos, duplicados, errores).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import type { LeadMeta } from '../_shared/metaLeads.ts'
import { Falla, igual, servicioMeta } from '../_shared/metaServidor.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const responder = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const MIN = 60_000
const VENTANA_MINIMA = 20, SOLAPE = 10, PRIMERA_VEZ = 1440, MAXIMA = 60 * 24 * 90, MAXIMA_AUTO = 60 * 24 * 7
/** Tiempo de trabajo por ejecución: lo que falte lo trae la siguiente (la ventana sale de la última correcta). */
const PRESUPUESTO_MS = 110_000

type ErrorSync = { formulario?: string; nombre?: string; lead?: string; error: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, srv)
  const inicio = Date.now()

  try {
    const b = await req.json().catch(() => ({})) as { accion?: string; activo?: boolean; lookback_minutes?: number }

    /* ---------- Quién llama: el cron (clave de Vault) o quien administra Marketing ---------- */
    let source: 'cron' | 'manual'
    const claveCron = req.headers.get('x-cron-secret')
    if (claveCron) {
      const { data: clave } = await admin.rpc('meta_poll_clave')
      if (!clave || !igual(claveCron, String(clave))) return responder({ error: 'Clave del cron no válida.' }, 401)
      // Quien tiene la clave (el cron o una prueba desde la base) puede marcar la ejecución como manual.
      source = (b as { source?: string }).source === 'manual' ? 'manual' : 'cron'
      /* Reenviar el correo del asesor de leads que ya están en el CRM (solo con la clave; máx. 50). */
      if (b.accion === 'reenviar_correos') {
        const codigos = Array.isArray((b as { codigos?: unknown }).codigos) ? ((b as { codigos: unknown[] }).codigos).map(String).filter((x) => /^META-\d{5,30}$/.test(x)).slice(0, 50) : []
        if (!codigos.length) throw new Falla('Indica los códigos de los leads (META-…).')
        const m = servicioMeta(admin)
        const c = await m.conf()
        const resultado: { codigo: string; resultado: string }[] = []
        for (const codigo of codigos) resultado.push({ codigo, resultado: await m.reenviarCorreo(c, codigo) })
        console.log('[meta-leads-poll] reenvío de correos: ' + JSON.stringify(resultado))
        return responder({ ok: resultado.every((x) => x.resultado.startsWith('enviado')), resultado })
      }
    } else {
      const usuario = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
      const { data: us } = await usuario.auth.getUser()
      if (!us?.user) throw new Falla('Sesión no válida.', 401)
      if ((await usuario.rpc('marketing_puede', { p_accion: 'administrar' })).data !== true) throw new Falla('Solo quien administra Marketing puede sincronizar los leads de Meta.', 403)
      source = 'manual'

      /* Interruptor «Sincronización automática cada 5 min» (la dirección sale del servidor, no del navegador). */
      if (b.accion === 'programar') {
        const { data, error } = await usuario.rpc('meta_poll_programar', { p_activo: b.activo === true, p_url: url.replace(/\/+$/, '') + '/functions/v1/meta-leads-poll' })
        if (error) throw new Falla(error.message)
        return responder(data)
      }
      if (b.accion && b.accion !== 'sincronizar') throw new Falla('Acción no válida.')
    }

    /* ---------- Ventana ---------- */
    const pedido = Number(b.lookback_minutes)
    let lookback: number | null = null
    let desdeMs: number
    if (Number.isFinite(pedido) && pedido > 0) {
      lookback = Math.min(MAXIMA, Math.max(1, Math.round(pedido)))
      desdeMs = inicio - lookback * MIN
    } else {
      // Un cron que se cruza con otro que sigue trabajando no repite el trabajo.
      if (source === 'cron') {
        const { data: enCurso } = await admin.from('meta_sync_runs').select('id').is('deleted_at', null).is('finished_at', null)
          .gt('started_at', new Date(inicio - 4 * MIN).toISOString()).limit(1)
        if ((enCurso ?? []).length) return responder({ ok: true, omitido: 'Hay otra sincronización en curso.' })
      }
      const { data: ult } = await admin.from('meta_sync_runs').select('started_at').is('deleted_at', null).not('finished_at', 'is', null)
        .eq('errors', '[]').order('started_at', { ascending: false }).limit(1).maybeSingle()
      const base = ult?.started_at ? new Date(String(ult.started_at)).getTime() - SOLAPE * MIN : inicio - PRIMERA_VEZ * MIN
      desdeMs = Math.max(inicio - MAXIMA_AUTO * MIN, Math.min(base, inicio - VENTANA_MINIMA * MIN))
    }

    /* ---------- Registro de la ejecución ---------- */
    const { data: run, error: eRun } = await admin.from('meta_sync_runs')
      .insert({ source, started_at: new Date(inicio).toISOString(), desde: new Date(desdeMs).toISOString(), lookback_minutes: lookback })
      .select('id').single()
    if (eRun) throw new Falla('No se pudo registrar la sincronización: ' + eRun.message, 500)

    const errores: ErrorSync[] = []
    let forms = 0, found = 0, inserted = 0, duplicates = 0, pruebas = 0, aviso: string | null = null
    try {
      const m = servicioMeta(admin)
      const c = await m.conf()
      if (!c.token || !c.appSecret) throw new Falla('Falta guardar el token y la clave secreta de la app de Meta.')
      if (!/^\d{5,30}$/.test(c.paginaId)) throw new Falla('Falta el ID de la página de Facebook.')
      const todos = await m.formularios(c)
      // El cron mira los formularios activos; «Traer leads» (manual) también los archivados, como antes.
      const lista = todos.filter((f) => source === 'cron' ? String(f.status || '').toUpperCase() === 'ACTIVE' : String(f.status || '').toUpperCase() !== 'DELETED')
      forms = lista.length
      const desdeUnix = Math.floor(desdeMs / 1000)
      for (const f of lista) {
        if (Date.now() - inicio > PRESUPUESTO_MS) { errores.push({ error: 'Se acabó el tiempo de esta ejecución; la siguiente continúa desde aquí.' }); break }
        let leads: LeadMeta[]
        try { leads = await m.leadsDesde(c, f.id, desdeUnix) }
        catch (e) { errores.push({ formulario: f.id, nombre: f.name, error: (e as Error).message }); continue }
        found += leads.length
        for (const L of leads) {
          try {
            const r = await m.procesarLead(c, L, f.name || '')
            if (r === 'nuevo') inserted++; else if (r === 'ya') duplicates++; else pruebas++
          } catch (e) { errores.push({ formulario: f.id, nombre: f.name, lead: String(L.id || ''), error: (e as Error).message }) }
        }
      }
      if (m.errorCorreo()) aviso = 'El correo al asesor no salió: ' + m.errorCorreo()
    } catch (e) {
      errores.push({ error: (e as Error).message })
    }

    // El aviso del correo no invalida la sincronización (los leads sí entraron): va aparte y no frena la ventana.
    const resultado = { forms, found, inserted, duplicates, pruebas, errors: errores.slice(0, 50), aviso }
    await admin.from('meta_sync_runs').update({ ...resultado, finished_at: new Date().toISOString() }).eq('id', run.id)
    console.log(`[meta-leads-poll] ${source} · formularios ${forms} · encontrados ${found} · nuevos ${inserted} · duplicados ${duplicates} · errores ${errores.length}`)
    return responder({ ok: errores.length === 0, id: run.id, source, desde: new Date(desdeMs).toISOString(), ...resultado })
  } catch (e) {
    const f = e instanceof Falla ? e : new Falla((e as Error).message || 'Error inesperado.', 500)
    return responder({ error: f.message }, f.status)
  }
})
