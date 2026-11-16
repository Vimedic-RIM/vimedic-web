// Edge Function pública: seguimiento del pedido para el cliente (Issue #38).
// El cliente abre /seguimiento/?c=<código> (el QR de la guía o el enlace que le envía su asesor).
// Valida el código con service_role y devuelve SOLO lo que el cliente puede ver: etapas, fechas,
// productos (sin precios), transportista, fotos de la entrega y su asesor. Nada de cédulas, precios ni datos internos.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const responder = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const ETAPAS: [string, string][] = [
  ['venta', 'Pedido confirmado'], ['facturar', 'Enviado a facturar'], ['facturada', 'Facturado'], ['preparacion', 'Preparando tu pedido'],
  ['lista', 'Listo para despacho'], ['despachada', 'Despachado'], ['en_ruta', 'En camino'], ['entregada', 'Entregado'], ['instalacion', 'Instalación / capacitación'],
]
const primerNombre = (t: string | null) => String(t || '').trim().split(/\s+/)[0] || ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const b = await req.json().catch(() => ({}))
    const token = String(b.token || '').trim()
    if (!/^[a-f0-9]{32,80}$/i.test(token)) return responder({ error: 'Enlace no válido.' }, 400)
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: p } = await db.from('pedidos_seguimiento')
      .select('id,codigo,empresa,cliente_texto,etapa,etapa_desde,estado,fecha_estimada,requiere_instalacion,zona,factura_id,despacho_id,asesor_id,created_at,completado_en')
      .eq('token', token).is('deleted_at', null).maybeSingle()

    if (!p) {
      // Pedidos anteriores al proceso nuevo: estado básico del despacho y la entrega (mismo código del QR).
      const { data: d } = await db.from('despachos').select('id,numero_guia,estado,fecha,cliente_texto,empresa').eq('token_seguimiento', token).is('deleted_at', null).maybeSingle()
      const { data: e } = await db.from('entregas').select('estado,fecha_programada,fecha_entrega,transportista,guia_numero').eq('token_seguimiento', token).is('deleted_at', null).limit(1).maybeSingle()
      if (!d && !e) return responder({ error: 'No encontramos este pedido. Revisa el enlace o escríbenos.' }, 404)
      return responder({ legado: true, empresa: d?.empresa ?? 'VIMEDIC', cliente: primerNombre(d?.cliente_texto), guia: d?.numero_guia ?? '', despacho: d?.estado ?? '', entrega: e ?? null })
    }

    const [ev, fac, desp, ents, ase, enc] = await Promise.all([
      db.from('pedidos_eventos').select('fecha,etapa,tipo,titulo,detalle').eq('pedido_id', p.id).eq('publico', true).is('deleted_at', null).order('fecha'),
      p.factura_id ? db.from('facturas').select('numero_contifico,items').eq('id', p.factura_id).maybeSingle() : Promise.resolve({ data: null }),
      p.despacho_id ? db.from('despachos').select('numero_guia,productos,entrega').eq('id', p.despacho_id).maybeSingle() : Promise.resolve({ data: null }),
      p.despacho_id ? db.from('entregas').select('envio_numero,estado,modalidad,transportista,guia_numero,fecha_programada,ventana,fecha_entrega,prueba').eq('despacho_id', p.despacho_id).is('deleted_at', null).order('envio_numero') : Promise.resolve({ data: [] }),
      p.asesor_id ? db.from('empleados').select('nombre,telefono,foto_url').eq('id', p.asesor_id).maybeSingle() : Promise.resolve({ data: null }),
      p.despacho_id ? db.from('encuestas').select('id').eq('despacho_id', p.despacho_id).is('deleted_at', null).limit(1) : Promise.resolve({ data: [] }),
    ])

    // Productos sin precios: del despacho (lo que sale de bodega) o, antes de eso, de la factura.
    type Linea = { id?: string; codigo?: string; nombre?: string; cantidad?: number }
    const lineas: Linea[] = ((desp.data?.productos as Linea[] | null) ?? (fac.data?.items as Linea[] | null) ?? [])
    const codigos = [...new Set(lineas.map((l) => String(l.codigo || l.id || '')).filter(Boolean))].slice(0, 60)
    const { data: prods } = codigos.length ? await db.from('productos').select('codigo,imagen_url').in('codigo', codigos) : { data: [] }
    const img = new Map((prods ?? []).map((x: { codigo: string; imagen_url: string | null }) => [x.codigo, x.imagen_url ?? '']))
    const productos = lineas.map((l) => ({ nombre: String(l.nombre || l.codigo || ''), cantidad: Number(l.cantidad) || 1, imagen: img.get(String(l.codigo || l.id || '')) || '' }))

    // Entregas con fotos (enlaces temporales del almacenamiento privado).
    type Ent = { envio_numero: number; estado: string; modalidad: string | null; transportista: string | null; guia_numero: string | null; fecha_programada: string | null; ventana: string | null; fecha_entrega: string | null; prueba: { nombre?: string; fotos?: string[] } | null }
    const entregas = await Promise.all(((ents.data as Ent[] | null) ?? []).map(async (e) => {
      let fotos: string[] = []
      const rutas = (e.estado === 'Entregada' ? (e.prueba?.fotos ?? []) : []).filter((r) => typeof r === 'string').slice(0, 6)
      const http = rutas.filter((r) => /^https?:/i.test(r)), priv = rutas.filter((r) => !/^https?:/i.test(r))
      if (priv.length) { const { data } = await db.storage.from('entregas').createSignedUrls(priv, 3600); fotos = (data ?? []).map((x) => x.signedUrl).filter(Boolean) as string[] }
      return { numero: e.envio_numero, estado: e.estado, modalidad: e.modalidad, transportista: e.transportista, guia: e.guia_numero, programada: e.fecha_programada, ventana: e.ventana,
        entregada: e.fecha_entrega, recibio: e.estado === 'Entregada' ? primerNombre(e.prueba?.nombre ?? '') : '', fotos: [...http, ...fotos] }
    }))

    // El cliente abrió el enlace: queda en la bitácora del pedido (como mucho una vez cada 6 horas). Si lo abre alguien del equipo
    // con sesión iniciada (b.equipo), no se anota como visita del cliente.
    const { data: ult } = await db.from('pedidos_eventos').select('fecha').eq('pedido_id', p.id).eq('titulo', 'El cliente abrió el seguimiento').order('fecha', { ascending: false }).limit(1)
    if (!b.equipo && (!ult?.length || Date.now() - Date.parse(ult[0].fecha) > 6 * 3600e3)) {
      await db.from('pedidos_eventos').insert({ pedido_id: p.id, etapa: p.etapa, tipo: 'escaneo', titulo: 'El cliente abrió el seguimiento', publico: false, area: 'Cliente', dispositivo: (req.headers.get('user-agent') || '').slice(0, 160) })
    }

    const tel = String(ase.data?.telefono || '').replace(/\D/g, '')
    const etapas = ETAPAS.filter(([k]) => k !== 'instalacion' || p.requiere_instalacion).map(([k, t]) => {
      const e = (ev.data ?? []).find((x: { tipo: string; etapa: string }) => x.tipo === 'avance' && x.etapa === k)
      return { clave: k, nombre: t, fecha: e?.fecha ?? null }
    })
    return responder({
      codigo: p.codigo, empresa: p.empresa, cliente: primerNombre(p.cliente_texto), etapa: p.etapa, estado: p.estado, desde: p.etapa_desde,
      estimada: p.fecha_estimada, completado: p.completado_en, instalacion: p.requiere_instalacion, factura: fac.data?.numero_contifico ?? '', guia: desp.data?.numero_guia ?? '',
      tipoEntrega: (desp.data?.entrega as { entrega?: string } | null)?.entrega ?? '', etapas,
      eventos: (ev.data ?? []).filter((x: { tipo: string }) => x.tipo !== 'avance').map((x: { fecha: string; titulo: string; detalle: string | null }) => ({ fecha: x.fecha, titulo: x.titulo, detalle: x.detalle ?? '' })),
      historial: (ev.data ?? []).map((x: { fecha: string; titulo: string; detalle: string | null; tipo: string }) => ({ fecha: x.fecha, titulo: x.titulo, detalle: x.detalle ?? '', tipo: x.tipo })),
      productos, entregas,
      asesor: ase.data ? { nombre: String(ase.data.nombre || '').split(' (')[0], whatsapp: tel ? (tel.startsWith('0') ? '593' + tel.slice(1) : tel) : '', foto: ase.data.foto_url ?? '' } : null,
      encuesta: (p.etapa === 'entregada' || p.etapa === 'instalacion' || p.estado === 'Completado') && !(enc.data ?? []).length,
    })
  } catch (e) {
    return responder({ error: (e as Error).message || 'Error' }, 500)
  }
})
