// Edge Function pública (sin login, Pinterest no puede autenticarse): genera el feed de
// productos en CSV que Pinterest lee periódicamente, igual que generarPinterestFeed() en la
// app original (ahí escribía una hoja "PINTEREST_FEED"; acá se sirve en vivo desde productos).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

function imagenDirecta(url: string | null): string {
  const v = String(url || '').trim()
  if (!v) return ''
  try {
    const u = new URL(v)
    if (u.hostname !== 'drive.google.com' && !/^lh[0-9]+\.googleusercontent\.com$/.test(u.hostname)) return v
    const m = u.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/)
    const id = m ? m[1] : u.searchParams.get('id')
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return v
    return `https://lh3.googleusercontent.com/d/${id}=w1200`
  } catch { return v }
}
const csv = (v: unknown) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await admin.from('productos')
    .select('codigo,nombre,descripcion,imagen_url,pvp,stock,categoria:categorias(nombre)')
    .eq('en_catalogo', true).eq('oculto', false).is('deleted_at', null).order('codigo')
  if (error) return new Response('Error: ' + error.message, { status: 500 })

  const filas = ['id,title,description,link,image_link,price,sale_price,availability,product_type,condition']
  // deno-lint-ignore no-explicit-any
  for (const p of (data ?? []) as any[]) {
    filas.push([
      csv(p.codigo), csv(p.nombre), csv(String(p.descripcion || '').replace(/\s+/g, ' ').trim().slice(0, 500)),
      csv('https://vimedic.com.ec/?producto=' + p.codigo), csv(imagenDirecta(p.imagen_url)),
      csv((Number(p.pvp) || 0).toFixed(2) + ' USD'), '', csv(Number(p.stock) > 0 ? 'in stock' : 'out of stock'),
      csv(p.categoria?.nombre || ''), 'new',
    ].join(','))
  }
  return new Response(filas.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=1800' } })
})
