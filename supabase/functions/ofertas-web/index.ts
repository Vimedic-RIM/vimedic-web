// Edge Function pública (sin login): ofertas vigentes para la web vimedic.com.ec («Black Sales» y demás campañas).
// Solo lo publicable (campaña, fechas, producto visible, imagen y % de descuento). Sin precios: la web no los muestra.
// La consulta la hace web_ofertas_publicas() con service_role; el público no tiene acceso a la base.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' }

/** Imagen de Drive → enlace directo de tamaño medio (como el catálogo). */
function imagen(url: string): string {
  const v = String(url || '').trim()
  try {
    const u = new URL(v)
    if (u.hostname !== 'drive.google.com' && !/^lh[0-9]+\.googleusercontent\.com$/.test(u.hostname)) return /^https:\/\//.test(v) ? v : ''
    const id = u.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? u.searchParams.get('id')
    return id && /^[a-zA-Z0-9_-]+$/.test(id) ? `https://lh3.googleusercontent.com/d/${id}=w600` : ''
  } catch { return '' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'GET') return new Response('Método no permitido', { status: 405, headers: CORS })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await admin.rpc('web_ofertas_publicas')
  if (error) return new Response(JSON.stringify({ error: 'No se pudieron leer las ofertas.' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  // deno-lint-ignore no-explicit-any
  const d = (data ?? {}) as any
  const productos = (Array.isArray(d.productos) ? d.productos : []).map((p: Record<string, unknown>) => ({ ...p, imagen: imagen(String(p.imagen || '')) }))
  return new Response(JSON.stringify({ hoy: d.hoy, campanas: d.campanas ?? [], productos }), {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  })
})
