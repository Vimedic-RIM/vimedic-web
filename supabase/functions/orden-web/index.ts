// Edge Function pública (sin login): ORDEN del catálogo para la web vimedic.com.ec.
//   La web sigue tomando los productos de su fuente actual; de aquí toma solo el orden que se define en la app:
//   · categorias: nombres (sin emoji) en el orden de Inventario › «Categorías del catálogo» (empate por nombre).
//   · productos:  códigos de los equipos públicos (en el catálogo y no ocultos) en ese orden de categorías y, dentro
//                 de cada una, el de «Ordenar categorías y productos».
//   Sin precios, stock ni datos internos. Consulta con service_role (el público no tiene acceso a la base).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' }
const json = (o: unknown, status = 200, cache = 'public, max-age=300') =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache } })
/** «🏥 Quirófano» → «Quirófano» (la web compara por nombre, sin emojis). */
const sinEmoji = (t: unknown) => String(t ?? '').replace(/[^\p{L}\p{N}\s\-\/&,.()]/gu, '').replace(/\s+/g, ' ').trim()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'GET') return json({ error: 'Método no permitido' }, 405, 'no-store')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: cats, error: eCat } = await admin.from('categorias').select('nombre')
    .is('deleted_at', null).eq('activo', true).order('orden', { ascending: true, nullsFirst: false }).order('nombre')
  if (eCat) return json({ error: 'No se pudo leer el orden.' }, 500, 'no-store')

  // Productos públicos en el orden del Inventario (en tandas: cada respuesta llega hasta 1.000 filas).
  const codigos: string[] = []
  for (let desde = 0; desde < 10000; desde += 1000) {
    const { data, error } = await admin.from('productos').select('codigo,categoria:categorias(nombre,orden)')
      .is('deleted_at', null).eq('en_catalogo', true).eq('oculto', false).not('codigo', 'is', null)
      .order('categoria(orden)', { ascending: true, nullsFirst: false }).order('categoria(nombre)', { ascending: true, nullsFirst: false })
      .order('orden', { ascending: true, nullsFirst: false }).order('nombre').order('id')
      .range(desde, desde + 999)
    if (error) return json({ error: 'No se pudo leer el orden.' }, 500, 'no-store')
    const filas = (data ?? []) as { codigo: string }[]
    for (const f of filas) if (f.codigo) codigos.push(String(f.codigo).trim().toUpperCase())
    if (filas.length < 1000) break
  }

  return json({ categorias: (cats ?? []).map((c: { nombre: string }) => sinEmoji(c.nombre)).filter(Boolean), productos: codigos, generado: new Date().toISOString() })
})
