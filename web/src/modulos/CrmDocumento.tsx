import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck, Bike, CalendarClock, ChevronDown, ChevronUp, Copy, Lock, MessageCircle, Pencil, Phone, UserPlus, CreditCard, ImagePlus, FilePlus2, HandCoins, Handshake, Magnet, MapPin, Package, PackageSearch, Receipt, Search,
  ShoppingCart, StickyNote, Truck, User, Warehouse, X,
} from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { FormularioCliente, type Cliente as ClienteFicha } from './CrmClientes'
import { imagen } from './Inventario'
import type { DatosDoc } from '../proforma'
import { EtiquetasStockCotizacion, FranjaStock, marcoStock, useEstadoStock } from '../estadoStock'
import { leerDatosEmpresa } from './CrmMeta'

type Asesor = { id: string; nombre: string }
/** Lo que el CRM necesita saber al guardar (p. ej. para pedir el seguimiento de una proforma nueva). */
export type InfoGuardado = { id: string; nuevo: boolean; modo: 'Cotización' | 'Venta'; nombre: string; total: number }
export type Origen = { tabla: 'leads' | 'cotizaciones'; id: string; codigo: string; nombre: string; telefono: string; email: string; identificacion: string; medio: string; clienteId?: string | null } | null
type Prod = { id: string; codigo: string | null; nombre: string; pvp: number | null; precio_dis: number | null; aplica_iva: boolean; stock: number | null; imagen_url: string | null; reservaciones: string | null; descripcion: string | null; ficha_tecnica_url: string | null; drive_carpeta_url: string | null; categoria: { nombre: string } | null }
type Linea = { base?: number; obj?: number; id: string; codigo: string; nombre: string; imagen: string; precio: number; cantidad: number; descuento: number; iva: boolean; observacion: string; categoria?: string; descripcion?: string; ficha?: string; carpeta?: string }
type Cli = { ciudad?: string | null; asesor_id?: string | null; datos_venta?: Record<string, string> | null; id: string; nombre: string; identificacion: string | null; email: string | null; telefono: string | null; direccion: string | null; tipo_cliente: string | null; descuento_fijo: string | null }

const MEDIOS: [string, string[]][] = [
  ['Web y catálogo VIMEDIC', ['🤖 Chat bot web', '📝 Cotización web', '📅 Visita web', '🔓 Desbloqueo precios y stock web', '🛒 Catálogo web', '🌐 Página web']],
  ['Publicidad pagada', ['📣 Anuncio en Facebook o Instagram', '🎵 Anuncio en TikTok', '🔎 Anuncio en Google', '▶️ Anuncio en YouTube']],
  ['Redes sociales (sin pago)', ['📱 Publicación en redes sociales', '📖 Historia o estado', '💬 Mensaje directo en redes sociales']],
  ['El cliente nos contactó directo', ['🔗 Enlace directo de WhatsApp', '📲 Escribió al WhatsApp del asesor', '☎️ Llamada entrante', '✉️ Correo electrónico entrante']],
  ['Búsqueda en internet', ['📍 Google Maps', '🔍 Búsqueda en Google (sin anuncio)']],
  ['Recomendación', ['🤝 Referido por un cliente', '🩺 Referido por un médico o profesional de salud', '🏷️ Distribuidor o aliado comercial']],
  ['Gestión comercial', ['🚶 Visita comercial', '🏢 Visita del cliente a nuestras instalaciones', '📞 Prospección telefónica', '🎪 Feria o evento', '🏛️ Compra pública (SERCOP)', '🔄 Reactivación o seguimiento']],
]
const PLAZOS = ['5 DIAS', '15 DIAS', '30 DIAS', '45 DIAS', '60 DIAS', '90 DIAS', '120 DIAS']
const TRANSPORTES = ['Empresa', 'Tramaco', 'Enetsa', 'Jhetro', 'Esmeraldeño', 'Terminal Terrestre', 'Servientrega']
const dinero = (n: number) => '$' + n.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const LOTE_PRODS = 24
const limpiar = (t: string) => t.replace(/[,()%*\\"']/g, ' ').trim()

/** Lista legible de lo que cambió entre dos versiones de una cotización. */
function diferencias(prev: Record<string, any>[], sig: Linea[], extra: { notaPrev: string; nota: string; nombrePrev: string; nombre: string; totalPrev: number; total: number; medioPrev: string; medio: string }): string[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const c: string[] = []
  const pm = new Map(prev.map((i) => [String(i.id), i]))
  const sm = new Map(sig.map((i) => [String(i.id), i]))
  sig.forEach((n) => {
    const o = pm.get(String(n.id))
    if (!o) { c.push(`Agregó ${n.nombre} (${n.cantidad} u a ${dinero(n.precio)})`); return }
    if (Number(o.cantidad) !== n.cantidad) c.push(`${n.nombre}: cantidad ${o.cantidad} → ${n.cantidad}`)
    if (Math.abs(Number(o.precio) - n.precio) > 0.004) c.push(`${n.nombre}: precio ${dinero(Number(o.precio))} → ${dinero(n.precio)}`)
    if (Math.abs((Number(o.descuento) || 0) - (n.descuento || 0)) > 0.004) c.push(`${n.nombre}: descuento ${Number(o.descuento) || 0}% → ${n.descuento || 0}%`)
    if ((o.observacion || '') !== (n.observacion || '')) c.push(`${n.nombre}: observación modificada`)
  })
  prev.forEach((o) => { if (!sm.has(String(o.id))) c.push(`Quitó ${o.nombre}`) })
  if (extra.nombrePrev !== extra.nombre) c.push(`Cliente: ${extra.nombrePrev || '—'} → ${extra.nombre}`)
  if (extra.medioPrev !== extra.medio) c.push('Medio de captación modificado')
  if ((extra.notaPrev || '') !== (extra.nota || '')) c.push('Nota importante modificada')
  if (Math.abs(extra.totalPrev - extra.total) > 0.004) c.push(`Total: ${dinero(extra.totalPrev)} → ${dinero(extra.total)}`)
  return c
}

export default function CrmDocumento({ modo, perfil, asesores, origen, cerrar, guardado, editar, empresa, itemsIniciales }: {
  itemsIniciales?: Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
  empresa: 'VIMEDIC' | 'FEMEDICS'
  modo: 'Cotización' | 'Venta'; perfil: Perfil; asesores: Asesor[]; origen: Origen; cerrar: () => void; guardado: (msg: string, doc: DatosDoc, info?: InfoGuardado) => void
  editar?: Record<string, any> | null // eslint-disable-line @typescript-eslint/no-explicit-any
}) {
  const ed = editar ?? null
  const esVenta = modo === 'Venta'
  const esFm = empresa === 'FEMEDICS'   // Femedics: solo PVP, precio = PVP / (1 − objetivo %), descuento aparte
  const [plan, setPlan] = useState(10)
  const acento = esVenta ? '#04896f' : '#055c9d'
  const [pestana, setPestana] = useState<'cliente' | 'inventario' | 'carrito'>('cliente')

  /* cliente */
  const [busca, setBusca] = useState('')
  const [res, setRes] = useState<Cli[]>([])
  const [cliente, setCliente] = useState<Cli | null>(null)
  const [lead, setLead] = useState({ nombre: ed?.nombre ?? origen?.nombre ?? '', telefono: ed?.telefono ?? origen?.telefono ?? '', email: ed?.email ?? origen?.email ?? '', identificacion: ed?.identificacion ?? origen?.identificacion ?? '' })
  const veTodos = puede(perfil, 'crm', 'ver_todos') || puede(perfil, 'femedics', 'ver_todos')
  const ajeno = (c: Cli) => !veTodos && !!c.asesor_id && c.asesor_id !== perfil.id
  const [leadCiudad, setLeadCiudad] = useState<string>(ed?.ciudad ?? '')
  const [leadAbierto, setLeadAbierto] = useState(false)
  const [leadListo, setLeadListo] = useState(!!(ed?.nombre ?? origen?.nombre))
  const [fichaOculta, setFichaOculta] = useState(false)
  const [formCli, setFormCli] = useState<null | { cliente: ClienteFicha | null; prefill?: { nombre?: string; telefono?: string; email?: string; ciudad?: string; identificacion?: string } }>(null)
  const [copiado, setCopiado] = useState(false)
  const [medio, setMedio] = useState(ed?.medio_captacion_lead ?? origen?.medio ?? '')
  const [nota, setNota] = useState<string>(ed?.nota_cotizacion ?? '')
  const [asesorId, setAsesorId] = useState<string>(ed?.asesor_id ?? perfil.id)

  /* productos */
  const [qp, setQp] = useState('')
  const [prods, setProds] = useState<Prod[]>([])
  const [buscando, setBuscando] = useState(false)
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const consultaProds = (q: string, desde: number) => {
    // Sin texto: los primeros productos activos en el orden del Inventario. Con texto: coincidencias. Siempre por lotes (no se carga todo).
    let c = supabase.from('productos').select('id,codigo,nombre,pvp,precio_dis,aplica_iva,stock,imagen_url,reservaciones,descripcion,ficha_tecnica_url,drive_carpeta_url,categoria:categorias(nombre)').is('deleted_at', null).or('estado.is.null,estado.not.ilike.inactivo')
    for (const p of q.split(/\s+/).filter(Boolean)) c = c.or(`nombre.ilike.%${p}%,codigo.ilike.%${p}%,codigo_unico.ilike.%${p}%,marca.ilike.%${p}%`)
    c = c.order('en_vista_publica', { ascending: false })
    if (!q) c = c.order('orden', { ascending: true, nullsFirst: false })
    return c.order('nombre').range(desde, desde + LOTE_PRODS - 1)
  }
  const [carrito, setCarrito] = useState<Linea[]>(() => ((ed?.items ?? itemsIniciales ?? []) as Record<string, any>[]).map((i) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: String(i.id), codigo: i.codigo ?? '', nombre: i.nombre, imagen: i.imagen ?? '', precio: Number(i.precio) || 0, cantidad: Number(i.cantidad) || 1, descuento: Number(i.descuento) || 0,
    iva: i.iva !== false, observacion: i.observacion ?? '', base: i.base != null ? Number(i.base) : undefined, obj: i.obj != null ? Number(i.obj) : undefined, categoria: i.categoria ?? '', descripcion: i.descripcion ?? '', ficha: i.ficha ?? '', carpeta: i.carpeta ?? '' })))
  useEffect(() => {
    if (!ed?.cliente_id) return
    supabase.from('clientes').select('id,nombre,identificacion,email,telefono,direccion,tipo_cliente,descuento_fijo,datos_venta').eq('id', ed.cliente_id).single().then(({ data }) => { if (data) setCliente(data as Cli) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [pct, setPct] = useState('')
  const estStock = useEstadoStock()
  const dragIdx = useRef<number | null>(null)

  /* venta */
  const [pago, setPago] = useState('')
  const [tipoPago, setTipoPago] = useState('')
  const [plazo, setPlazo] = useState('')
  const [obsPago, setObsPago] = useState('')
  const [comprobante, setComprobante] = useState<File | null>(null)
  const [anticipo, setAnticipo] = useState('')
  const [entrega, setEntrega] = useState('')
  const [dirEntrega, setDirEntrega] = useState('')
  const [quienRecibe, setQuienRecibe] = useState('')
  const [telEntrega, setTelEntrega] = useState('')
  const [mapsEntrega, setMapsEntrega] = useState('')
  const [ciudadDestino, setCiudadDestino] = useState('')
  const [transporte, setTransporte] = useState('')
  const [flete, setFlete] = useState('')
  const [fletePaga, setFletePaga] = useState('')
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [rem, setRem] = useState({ nombre: 'Importaciones Médicas Richard', cedula: '1721050035001', telefono: '095 887 9773' })
  // Remitente de la guía: datos de la empresa (FEMEDICS los edita en su CRM, igual que fmGuardarConfig del original).
  useEffect(() => { leerDatosEmpresa(empresa).then((d) => { if (d) setRem({ nombre: d.razon_social, cedula: d.ruc ?? '', telefono: d.telefono ?? '' }) }) }, [empresa])
  const [dest, setDest] = useState({ nombre: '', telefono: '', cedula: '', email: '' })
  const [dirEnvio, setDirEnvio] = useState('')
  const [caja, setCaja] = useState('')
  const [armado, setArmado] = useState('')
  const [stretch, setStretch] = useState('')
  const [garantia, setGarantia] = useState('')
  const [guardarDv, setGuardarDv] = useState(false)
  const [dvAplicado, setDvAplicado] = useState(false)

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const q = limpiar(busca)
    if (q.length < 2) { setRes([]); return }
    const t = setTimeout(() => {
      supabase.from('clientes').select('id,nombre,identificacion,email,telefono,direccion,ciudad,asesor_id,tipo_cliente,descuento_fijo,datos_venta').is('deleted_at', null).eq('empresa', empresa)
        .or(`nombre.ilike.%${q}%,identificacion.ilike.%${q}%,email.ilike.%${q}%,telefono.ilike.%${q}%,ciudad.ilike.%${q}%,institucion.ilike.%${q}%`).order('nombre').limit(15).then(({ data }) => setRes(((data as Cli[]) ?? []).sort((a, b) => Number(ajeno(a)) - Number(ajeno(b)))))
    }, 250)
    return () => clearTimeout(t)
  }, [busca])

  useEffect(() => {
    const q = limpiar(qp)
    setBuscando(true)
    let vivo = true
    const t = setTimeout(() => {
      consultaProds(q, 0).then(({ data }) => { if (!vivo) return; const d = (data as unknown as Prod[]) ?? []; setProds(d); setHayMas(d.length === LOTE_PRODS); setBuscando(false) })
    }, q ? 250 : 0)
    return () => { vivo = false; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qp])
  async function masProds() {
    if (cargandoMas || buscando || !hayMas) return
    setCargandoMas(true)
    const { data } = await consultaProds(limpiar(qp), prods.length)
    const d = (data as unknown as Prod[]) ?? []
    setProds((a) => [...a, ...d.filter((x) => !a.some((y) => y.id === x.id))]); setHayMas(d.length === LOTE_PRODS); setCargandoMas(false)
  }

  /* descuento del cliente: DIS+VIP usa precio distribuidor, DIS+% descuenta ese % del PVP */
  function descCliente(c: Cli | null) { if (esFm) return 0; return c?.tipo_cliente === 'DIS' && /^\d+$/.test(c.descuento_fijo ?? '') ? Number(c.descuento_fijo) : 0 }
  const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
  const conObjetivo = (base: number, obj: number) => r2(base / (1 - Math.min(90, Math.max(0, obj)) / 100))
  function precioBase(p: Prod, c: Cli | null) { if (esFm) return Number(p.pvp) || 0; return c?.tipo_cliente === 'DIS' && c.descuento_fijo === 'VIP' && Number(p.precio_dis) > 0 ? Number(p.precio_dis) : Number(p.pvp) || 0 }

  function aplicarDv(c: Cli) {
    const d = c.datos_venta as Record<string, any> | null | undefined // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!esVenta || !d || !Object.keys(d).length) return
    setPago(d.pago ?? ''); setTipoPago(d.tipoPago ?? ''); setPlazo(d.plazo ?? ''); setEntrega(d.entrega ?? ''); setDirEntrega(d.dirEntrega ?? '')
    setQuienRecibe(d.quienRecibe ?? ''); setTelEntrega(d.telEntrega ?? ''); setMapsEntrega(d.mapsEntrega ?? ''); setCiudadDestino(d.ciudadDestino ?? ''); setTransporte(d.transporte ?? '')
    if (d.dest) setDest(d.dest); setDirEnvio(d.dirEnvio ?? ''); setCaja(d.caja ?? ''); setArmado(d.armado ?? ''); setStretch(d.stretch ?? ''); setGarantia(d.garantia ?? '')
    setDvAplicado(true)
  }

  function agregar(p: Prod) {
    setCarrito((a) => {
      const i = a.findIndex((x) => x.id === p.id)
      if (i >= 0) return a.map((x, k) => (k === i ? { ...x, cantidad: x.cantidad + 1 } : x))
      return [...a, { id: p.id, codigo: p.codigo ?? '', nombre: p.nombre, imagen: p.imagen_url ?? '', precio: esFm ? conObjetivo(precioBase(p, cliente), plan) : precioBase(p, cliente), base: esFm ? precioBase(p, cliente) : undefined, obj: esFm ? plan : undefined, cantidad: 1, descuento: descCliente(cliente), iva: p.aplica_iva !== false, observacion: '', categoria: p.categoria?.nombre ?? '', descripcion: p.descripcion ?? '', ficha: p.ficha_tecnica_url ?? '', carpeta: p.drive_carpeta_url ?? '' }]
    })
  }
  const cambiar = (idx: number, c: Partial<Linea>) => setCarrito((a) => a.map((x, k) => (k === idx ? { ...x, ...c } : x)))

  const { subtotal, ivaTotal, total } = useMemo(() => {
    let s = 0, iv = 0
    carrito.forEach((i) => { const l = i.precio * i.cantidad * (1 - (i.descuento || 0) / 100); s += l; if (i.iva) iv += l * 0.15 })
    return { subtotal: s, ivaTotal: iv, total: s + iv }
  }, [carrito])
  const unidades = carrito.reduce((n, i) => n + i.cantidad, 0)

  const nombre = cliente?.nombre ?? lead.nombre.trim()
  const faltan: string[] = []
  if (!nombre) faltan.push('cliente')
  if (!medio) faltan.push('medio de captación')
  if (!carrito.length) faltan.push('productos')
  if (esVenta) {
    if (!pago) faltan.push('pago')
    if (pago === 'Pagado' && !tipoPago) faltan.push('tipo de pago')
    if (pago === 'Crédito' && !plazo) faltan.push('plazo de crédito')
    if (!entrega) faltan.push('entrega')
    if (entrega === 'Local' && (!dirEntrega.trim() || !quienRecibe.trim() || !telEntrega.trim() || !mapsEntrega.trim())) faltan.push('datos de entrega local')
    if (entrega === 'Envío' && (!ciudadDestino.trim() || !transporte)) faltan.push('ciudad y transporte')
    if (entrega === 'Envío' && (!dest.nombre.trim() || !dest.telefono.trim() || !dest.cedula.trim() || !dest.email.trim() || !dirEnvio.trim())) faltan.push('destinatario y dirección de envío')
    if (entrega === 'Delivery' && !mapsEntrega.trim()) faltan.push('URL de Google Maps')
  }
  const pasos = { cliente: !!nombre, captacion: !!medio, pago: !!pago, entrega: !!entrega, productos: carrito.length > 0 }
  const progreso = Math.round(([!!nombre, !!medio, carrito.length > 0, !esVenta || (!!pago && !!entrega)].filter(Boolean).length / 4) * 100)

  async function guardar() {
    if (faltan.length) { setError('Falta: ' + faltan.join(', ') + '.'); return }
    setGuardando(true); setError('')
    const ahora = new Date().toISOString()
    const items = carrito.map((i) => ({ base: i.base, obj: i.obj, categoria: i.categoria, descripcion: i.descripcion, ficha: i.ficha, carpeta: i.carpeta, id: i.id, codigo: i.codigo, nombre: i.nombre, imagen: i.imagen, precio: i.precio, cantidad: i.cantidad, descuento: i.descuento, iva: i.iva, observacion: i.observacion }))
    const datos: Record<string, unknown> = {
      tipo_registro: modo, cliente_id: cliente?.id ?? null, lead_sin_cliente: !cliente, nombre,
      identificacion: cliente?.identificacion ?? (lead.identificacion || null), email: cliente?.email ?? (lead.email.trim() || null), telefono: cliente?.telefono ?? (lead.telefono.trim() || null),
      direccion: cliente?.direccion ?? null, ciudad: cliente?.ciudad ?? (leadCiudad.trim() || null), asesor_id: asesorId || null, detalle_equipos: carrito.map((i) => `${i.nombre} (Cant: ${i.cantidad})`).join(', '),
      items, total: Math.round(total * 100) / 100, medio_captacion_lead: medio, nota_cotizacion: nota.trim() || null,
      estado_crm: esVenta ? 'Ganado' : 'Seguimiento', ultima_actividad: ahora,
    }
    if (ed) { delete datos.tipo_registro; delete datos.estado_crm }
    if (esVenta) {
      Object.assign(datos, {
        medio_captacion_venta: medio, nota_venta: nota.trim() || null, estado_pago: pago, metodo_pago: tipoPago || (plazo ? 'Crédito ' + plazo : null),
        anticipo: Number(anticipo) || null, tipo_entrega: entrega, fecha_entrega: fechaEntrega || null, fecha_venta: ahora,
        direccion_entrega: entrega === 'Local' ? `${dirEntrega.trim()}${quienRecibe ? ' · Recibe: ' + quienRecibe : ''}${telEntrega ? ' · Tel: ' + telEntrega : ''}${mapsEntrega ? ' · ' + mapsEntrega : ''}` : entrega === 'Envío' ? `${ciudadDestino.trim()} · ${transporte}` : entrega === 'Delivery' ? mapsEntrega || null : null,
        flete: Number(flete) || null, flete_lo_paga: fletePaga || null,
        detalle_venta: { observacionPago: obsPago || null, remitente: entrega === 'Envío' ? rem : null, destinatario: entrega === 'Envío' ? dest : null, direccionEnvio: dirEnvio || null, transporte: transporte || null, ciudadDestino: ciudadDestino || null, empaque: { caja, armado, stretch }, cartaGarantia: garantia || null },
      })
    }
    const existente = ed ? { id: ed.id as string, codigo: ed.codigo as string } : origen?.tabla === 'cotizaciones' ? { id: origen.id, codigo: origen.codigo } : null
    let id = existente ? existente.id : crypto.randomUUID()
    let codigo = existente ? existente.codigo : (esVenta ? 'VEN-' : 'COT-') + crypto.randomUUID().slice(0, 6).toUpperCase()
    if (esVenta && comprobante) {
      const ext = (comprobante.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
      const ruta = `ventas/${id}/comprobante_${Date.now()}.${ext}`
      const { error: errSubida } = await supabase.storage.from('crm').upload(ruta, comprobante, { contentType: comprobante.type || 'image/jpeg' })
      if (errSubida) { setError('No se pudo subir el comprobante: ' + errSubida.message); setGuardando(false); return }
      ;(datos.detalle_venta as Record<string, unknown>).comprobantePagoUrl = ruta
    }
    const r = existente
      ? await supabase.from('cotizaciones').update(datos).eq('id', id)
      : await supabase.from('cotizaciones').insert({ id, codigo, empresa, fecha: ahora, lead_id: origen?.tabla === 'leads' ? origen.id : null, ...datos })
    if (r.error) { setError(r.error.message); setGuardando(false); return }
    if (origen?.tabla === 'leads') await supabase.from('leads').update({ estado_crm: esVenta ? 'Ganado' : 'Seguimiento', ultima_actividad: ahora }).eq('id', origen.id)
    /* Historial de versiones: qué cambió, quién y cuándo (con la foto de los productos de esa versión). */
    const cambios = ed
      ? diferencias((ed.items ?? []) as Record<string, any>[], carrito, { notaPrev: ed.nota_cotizacion ?? '', nota: nota.trim(), nombrePrev: ed.nombre ?? '', nombre, totalPrev: Number(ed.total) || 0, total: Math.round(total * 100) / 100, medioPrev: ed.medio_captacion_lead ?? '', medio }) // eslint-disable-line @typescript-eslint/no-explicit-any
      : origen?.tabla === 'cotizaciones' ? ['Convertida en venta'] : [`${modo} creada con ${carrito.length} producto(s) por ${dinero(total)}`]
    const { data: vs } = await supabase.from('cotizaciones_historial').select('version').eq('cotizacion_id', id).order('version', { ascending: false }).limit(1)
    await supabase.from('cotizaciones_historial').insert({
      id: crypto.randomUUID(), cotizacion_id: id, version: ((vs?.[0] as { version: number } | undefined)?.version ?? 0) + 1, cambios: cambios.length ? cambios : ['Guardada sin cambios'], items,
      total: Math.round(total * 100) / 100, nota: nota.trim() || null, cliente: { nombre, identificacion: cliente?.identificacion ?? lead.identificacion, email: cliente?.email ?? lead.email, telefono: cliente?.telefono ?? lead.telefono },
      empleado_id: perfil.id, usuario_texto: perfil.nombre,
    })
    await supabase.from('interacciones').insert({
      id: crypto.randomUUID(), codigo: 'INT-' + crypto.randomUUID().slice(0, 8), ref_tipo: modo, ref_codigo: codigo, cotizacion_id: id,
      tipo: esVenta ? 'Venta Registrada' : ed ? 'Cotización Editada' : 'Cotización Creada', nota: ed ? cambios.join(' · ') || 'Guardada sin cambios.' : `${modo} por ${dinero(total)} (${unidades} u).`, empleado_id: perfil.id, usuario_texto: perfil.nombre,
    })
    if (esVenta && guardarDv && cliente) {
      await supabase.from('clientes').update({ datos_venta: { pago, tipoPago, plazo, entrega, dirEntrega, quienRecibe, telEntrega, mapsEntrega, ciudadDestino, transporte, dest, dirEnvio, caja, armado, stretch, garantia } }).eq('id', cliente.id)
    }
    if (esVenta) {
      /* Cada venta entra a Facturación como "Pendiente" con sus datos de pago y entrega. */
      const pe = {
        pago, tipoPago, plazoCredito: plazo, observacionPago: obsPago, entrega, fechaEntrega, ciudad: ciudadDestino, transporte, direccionEnvio: dirEnvio,
        direccionEntregaLocal: dirEntrega, quienRecibe, telefonoEntregaLocal: telEntrega, urlGoogleMaps: mapsEntrega, nombreDestinatario: dest.nombre, cedulaDestinatario: dest.cedula,
        telefonoDestinatario: dest.telefono, emailDestinatario: dest.email, nombreRemitente: rem.nombre, cedulaRemitente: rem.cedula, telefonoRemitente: rem.telefono,
        empaqueCaja: caja, empaqueArmado: armado, empaqueStretch: stretch, cartaGarantia: garantia, flete, fletePaga,
      }
      const redondo = (n: number) => Math.round(n * 100) / 100
      // El insert/update en "facturas" no lo hace el navegador directo (su RLS solo deja escribir
      // a quien tiene permiso del módulo Facturación): lo hace esta función con privilegios propios,
      // igual que crearRegistroFacturacion_ en la app original. Ella decide si crea la fila o
      // actualiza una ya existente con el mismo código (migrada o reenviada), y si ya estaba
      // Facturada no la toca — avisa en vez de fallar en silencio.
      const { data: rpcRes, error: errFact } = await supabase.rpc('enviar_venta_a_facturacion', {
        p_codigo: codigo, p_empresa: empresa, p_cotizacion_id: id, p_cliente_id: cliente?.id ?? null,
        p_identificacion: cliente?.identificacion ?? (lead.identificacion || null), p_asesor_id: asesorId || null,
        p_medio: medio, p_observacion: nota.trim() || null, p_items: items, p_pago_entrega: pe,
        p_subtotal: redondo(subtotal), p_iva: redondo(ivaTotal), p_total: redondo(total),
      })
      if (errFact) { setError('No se pudo enviar a Facturación: ' + errFact.message); setGuardando(false); return }
      const resFact = rpcRes as { success: boolean; ya_facturado?: boolean; numero_contifico?: string } | null
      if (resFact && resFact.ya_facturado) {
        setError('Esta venta ya fue facturada antes' + (resFact.numero_contifico ? ' (factura N.º ' + resFact.numero_contifico + ')' : '') + '. Revísala en Facturación.')
        setGuardando(false); return
      }
    }
    const codigoFinal = codigo, idFinal = id, eraNuevo = !existente
    id = ''; codigo = ''
    const resumenEntrega = [entrega === 'Local' ? dirEntrega : entrega === 'Envío' ? `${ciudadDestino} (${transporte})${dirEnvio ? ' · ' + dirEnvio : ''}` : '', quienRecibe ? 'Recibe: ' + quienRecibe : '', fechaEntrega ? 'Fecha de entrega: ' + fechaEntrega : '', [caja, armado, stretch].filter(Boolean).length ? 'Empaque: ' + [caja, armado, stretch].filter(Boolean).join(' · ') : '', garantia ? 'Garantía: ' + garantia : ''].filter(Boolean)
    guardado(`${modo} ${ed ? 'actualizada' : 'creada'} por ${dinero(total)}.`, {
      codigo: (datos.codigo as string | undefined) ?? codigoFinal, fecha: new Date().toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }), tipo: modo, empresa,
      cliente: { nombre, identificacion: cliente?.identificacion ?? lead.identificacion, email: cliente?.email ?? lead.email, telefono: cliente?.telefono ?? lead.telefono },
      asesor: asesores.find((a) => a.id === asesorId)?.nombre ?? perfil.nombre, nota: nota.trim() || null,
      items: carrito.map((i) => ({ id: i.id, codigo: i.codigo, nombre: i.nombre, imagen: i.imagen, categoria: i.categoria, descripcion: i.descripcion, ficha: i.ficha, carpeta: i.carpeta, precio: i.precio, cantidad: i.cantidad, descuento: i.descuento, iva: i.iva, observacion: i.observacion })),
      pagoEntrega: esVenta ? { pago: pago + (tipoPago ? ' · ' + tipoPago : '') + (plazo ? ' · Plazo: ' + plazo : ''), entrega, detalle: resumenEntrega } : null,
    }, { id: idFinal, nuevo: eraNuevo, modo, nombre, total: Math.round(total * 100) / 100 })
  }

  const botonOpc = (valor: string, actual: string, set: (v: string) => void, clase: string, texto: React.ReactNode, tipo: 'opt' | 'chip' = 'chip') => (
    <button key={valor} type="button" onClick={() => set(valor)} className={`${clase} ns-${tipo}` + (actual === valor ? ' active' : '')}>{texto}</button>
  )

  const soloDig = (s: string) => String(s || '').replace(/\D/g, '')
  const waLink = (s: string) => { const d = soloDig(s); return d ? 'https://wa.me/' + (d.startsWith('0') ? '593' + d.slice(1) : d) : '' }
  const titulo1 = (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_m, a, b) => a + b.toUpperCase())
  const nombreAsesor = (id?: string | null) => asesores.find((x) => x.id === id)?.nombre ?? ''
  const etiquetaDis = (c: Cli) => { const n = String(c.descuento_fijo || '').trim().toUpperCase(); return n === '5' || n === '10' || n === '15' ? 'DIS:' + n + '%' : n === 'VIP' ? 'DIS VIP' : 'DIS' }
  const avisoLocal = (m: string) => { setInfoCli(m); setTimeout(() => setInfoCli(''), 2500) }
  const [infoCli, setInfoCli] = useState('')
  function elegirCliente(c: Cli) {
    if (ajeno(c)) { alert('"' + c.nombre + '" ya está asignado a ' + (nombreAsesor(c.asesor_id) || 'otro asesor') + '.\n\nNo puedes editarlo ni generar cotización/venta para este cliente.'); return }
    setCliente(c); setBusca(''); setRes([]); setLeadAbierto(false); setFichaOculta(window.innerWidth < 1024)
    setCarrito((a) => a.map((l) => ({ ...l, descuento: descCliente(c) }))); aplicarDv(c)
  }
  function quitarCliente() { setCliente(null); setFichaOculta(false) }
  function usarLead() {
    const tel = lead.telefono.trim(), vacio = /^\+?593$/.test(tel.replace(/\s/g, ''))
    if (!lead.nombre.trim() && (!tel || vacio) && !lead.email.trim()) { alert('Ingresa al menos un dato (nombre, teléfono o email).'); return }
    setLead((l) => ({ ...l, nombre: l.nombre.trim() || 'Lead ' + (vacio ? '' : tel || l.email), telefono: vacio ? '' : tel }))
    setLeadListo(true); setLeadAbierto(false); setFichaOculta(window.innerWidth < 1024)
  }
  /* Si la gestión no trae cliente pero ya existe en Clientes (misma cédula/RUC, correo o teléfono; o el mismo
     nombre cuando es el único), se vincula solo: no hace falta buscarlo ni crearlo otra vez. */
  const [autoVinculo, setAutoVinculo] = useState('')
  const autoBuscado = useRef(false)
  useEffect(() => {
    if (autoBuscado.current || cliente) return
    if (!origen && !ed) return
    autoBuscado.current = true
    const idCli = origen?.clienteId ?? (ed?.cliente_id as string | undefined)
    if (idCli) { recargarCliente(idCli); return }
    const ident = soloDig(lead.identificacion), mail = lead.email.trim().toLowerCase(), tel = soloDig(lead.telefono).slice(-9)
    const nom = lead.nombre.trim().replace(/[,()%*\\"']/g, ' ').replace(/\s+/g, ' ')
    const filtros = [ident.length >= 10 ? 'identificacion.eq.' + ident : '', /@/.test(mail) ? 'email.ilike.' + mail : '', tel.length === 9 ? 'telefono.ilike.%' + tel : '', nom.length >= 4 ? 'nombre.ilike.' + nom : ''].filter(Boolean)
    if (!filtros.length) return
    supabase.from('clientes').select('id,nombre,identificacion,email,telefono,direccion,ciudad,asesor_id,tipo_cliente,descuento_fijo,datos_venta').is('deleted_at', null).eq('empresa', empresa).or(filtros.join(',')).limit(10).then(({ data }) => {
      const lista = (data as Cli[] | null) ?? []
      if (!lista.length) return
      const n = (s: string | null | undefined) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
      const puntaje = (c: Cli) => (ident.length >= 10 && soloDig(c.identificacion ?? '') === ident ? 8 : 0) + (mail && (c.email ?? '').trim().toLowerCase() === mail ? 4 : 0) + (tel.length === 9 && soloDig(c.telefono ?? '').slice(-9) === tel ? 2 : 0) + (n(c.nombre) === n(nom) ? 1 : 0)
      const orden = lista.map((c) => ({ c, p: puntaje(c) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p)
      const mejor = orden[0]
      if (!mejor) return
      // Solo por nombre: únicamente si es el único con ese nombre y la cédula no contradice.
      if (mejor.p === 1 && (orden.length > 1 || (ident && mejor.c.identificacion && soloDig(mejor.c.identificacion) !== ident))) return
      if (ajeno(mejor.c)) { setAutoVinculo('Este cliente ya existe (' + mejor.c.nombre + ') pero está asignado a ' + (nombreAsesor(mejor.c.asesor_id) || 'otro asesor') + '.'); return }
      elegirCliente(mejor.c)
      setAutoVinculo('Cliente encontrado en Clientes y vinculado automáticamente (' + (mejor.p >= 8 ? 'misma cédula/RUC' : mejor.p >= 4 ? 'mismo correo' : mejor.p >= 2 ? 'mismo teléfono' : 'mismo nombre') + ').')
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function recargarCliente(id: string) {
    const { data } = await supabase.from('clientes').select('id,nombre,identificacion,email,telefono,direccion,ciudad,asesor_id,tipo_cliente,descuento_fijo,datos_venta').eq('id', id).single()
    if (data) elegirCliente(data as Cli)
  }
  function solicitarDatos(c: Cli) {
    const campos: [string, string | null | undefined][] = [['Cédula / RUC', c.identificacion], ['Nombre completo', c.nombre], ['Ciudad', c.ciudad], ['Dirección', c.direccion], ['Teléfono', c.telefono], ['Correo', c.email]]
    const ok = campos.filter(([, v]) => v), falta = campos.filter(([, v]) => !v)
    const l = ['Estos son los datos que tenemos en nuestro sistema:', '', ...ok.map(([k, v]) => '✅ ' + k + ': ' + v), '']
    if (falta.length) l.push('Nos ayudarías mucho completando también esto:', ...falta.map(([k]) => '📝 ' + k), '', 'Y si algún dato de arriba está erróneo, este es un buen momento para corregirlo. ¡Gracias! 🙌')
    else l.push('¿Nos ayudas confirmando que todo está correcto? Si algún dato está erróneo, este es el momento ideal para corregirlo. 🙌')
    l.push('', '*VIMEDIC | Equipamiento médico con respaldo en todo Ecuador*')
    navigator.clipboard?.writeText(l.join('\n')).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1800) }).catch(() => alert(l.join('\n')))
  }
  const bannerDesc = (c: Cli) => {
    if (esFm || c.tipo_cliente?.toUpperCase() !== 'DIS') return null
    const nivel = String(c.descuento_fijo || '').trim().toUpperCase()
    return (
      <div className="mt-2.5 flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] text-violet-800" style={{ background: '#7c3aed12', border: '1px solid #7c3aed33' }}>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white shrink-0" style={{ background: '#7c3aed' }}>{etiquetaDis(c)}</span>
        <span>Cliente distribuidor · {nivel === '5' || nivel === '10' || nivel === '15' ? <>Descuento fijo de <b>{nivel}%</b> sobre el PVP en todos los productos.</> : <>Descuento de distribuidor según el <b>precio DIS</b> de cada producto (el % se ve en cada tarjeta).</>}</span>
      </div>
    )
  }
  const panelCliente = (
    <div className={'overflow-y-auto p-4 space-y-3 lg:block' + (pestana === 'cliente' ? '' : ' hidden')}>
      <section className="ns-sec">
        <header><span className="ns-num">1</span><h4>Cliente</h4>
          <button type="button" onClick={() => setFichaOculta((v) => !v)} className="ml-auto text-[10px] font-bold flex items-center gap-0.5" style={{ color: acento }}>{fichaOculta ? 'Expandir' : 'Contraer'}{fichaOculta ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}</button>
        </header>
        <div className="relative mb-2">
          <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente por nombre, cédula o correo..." className="ns-input pl-9" />
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
        {busca.trim().length >= 2 && (
          <div className="border border-slate-200 rounded-xl max-h-40 overflow-y-auto mb-2 divide-y divide-slate-100 bg-white shadow-sm">
            {res.length === 0 && <p className="text-[11px] text-slate-400 text-center py-2.5">Sin coincidencias — puedes crear un cliente nuevo abajo.</p>}
            {res.map((c) => {
              const bloqueado = ajeno(c)
              return (
                <button key={c.id} type="button" className={'w-full text-left px-3 py-2 hover:bg-slate-50' + (bloqueado ? ' opacity-60' : '')} onMouseDown={(e) => e.preventDefault()} onClick={() => elegirCliente(c)}>
                  <p className="text-xs font-semibold text-slate-800 truncate flex items-center gap-1.5">{bloqueado && <Lock className="w-3 h-3 shrink-0" style={{ color: 'var(--red)' }} />}{c.nombre}{!bloqueado && c.tipo_cliente?.toUpperCase() === 'DIS' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: '#7c3aed' }}>{etiquetaDis(c)}</span>}</p>
                  <p className={'text-[10px] truncate ' + (bloqueado ? 'font-bold' : 'text-slate-500')} style={bloqueado ? { color: 'var(--red)' } : undefined}>
                    {bloqueado ? 'Asignado a: ' + (nombreAsesor(c.asesor_id) || 'otro asesor') + ' — no editable' : <>{c.identificacion || 'Sin cédula'} · {c.ciudad || 'Sin ciudad'}{c.asesor_id ? ' · Asesor: ' + nombreAsesor(c.asesor_id) : <> · <span style={{ color: 'var(--red)' }}>Sin asesor</span></>}</>}
                  </p>
                </button>
              )
            })}
          </div>
        )}
        {!fichaOculta && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            {cliente ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="text-xs text-slate-700 space-y-0.5 min-w-0">
                    <p className="font-bold text-slate-800 truncate">{cliente.nombre}</p>
                    <p className="text-slate-500 truncate">{cliente.identificacion || '—'}</p>
                    <p className="text-slate-500 truncate">{cliente.email || '—'}</p>
                    <p className="text-slate-500 truncate">{cliente.telefono ? <span className="inline-flex items-center gap-1.5"><span>{cliente.telefono}</span>
                      <a href={'tel:' + soloDig(cliente.telefono)} title="Llamar" className="text-slate-400 hover:text-blue-600 shrink-0"><Phone className="w-3 h-3" /></a>
                      <a href={waLink(cliente.telefono)} target="_blank" rel="noopener noreferrer" title="WhatsApp" className="text-slate-400 hover:text-green-600 shrink-0"><MessageCircle className="w-3 h-3" /></a></span> : <span className="text-slate-400">—</span>}</p>
                    <p className="text-slate-500 truncate">{cliente.direccion || '—'}</p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button type="button" onClick={() => setFormCli({ cliente: cliente as unknown as ClienteFicha })} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border flex items-center gap-1" style={{ borderColor: acento, color: acento }}><Pencil className="w-3 h-3" /> Editar Cliente</button>
                    <button type="button" onClick={() => solicitarDatos(cliente)} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border flex items-center gap-1" style={{ borderColor: '#25D366', color: '#25D366' }}><Copy className="w-3 h-3" /> {copiado ? '¡Copiado!' : 'Solicitar Datos'}</button>
                    <button type="button" onClick={quitarCliente} className="text-[10px] font-semibold text-slate-400 hover:text-slate-600">Cambiar cliente</button>
                  </div>
                </div>
                {bannerDesc(cliente)}
                {autoVinculo && <p className="mt-2 text-[10.5px] font-semibold rounded-lg px-2 py-1" style={{ background: '#e7f6f2', color: '#04896f' }}>✓ {autoVinculo}</p>}
              </>
            ) : leadListo && lead.nombre.trim() && !leadAbierto ? (
              esVenta ? (
                <>
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 mb-2.5">
                    <p className="text-xs font-bold text-amber-800">Esta cotización es de un lead ({lead.nombre}).</p>
                    <p className="text-[11px] text-amber-700">{autoVinculo || 'No está registrado en Clientes: créalo con estos datos para generar la venta.'}</p>
                  </div>
                  <button type="button" onClick={() => setFormCli({ cliente: null, prefill: { nombre: lead.nombre, telefono: lead.telefono, email: lead.email, ciudad: leadCiudad, identificacion: lead.identificacion } })} className="text-xs font-bold px-3 py-1.5 rounded-lg text-white flex items-center gap-1.5" style={{ background: '#04896f' }}><UserPlus className="w-3.5 h-3.5" /> Crear cliente con estos datos</button>
                </>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="text-xs text-slate-700 space-y-0.5 min-w-0">
                    <p className="font-bold text-slate-800 truncate">{lead.nombre || '(sin nombre)'} <span className="font-normal text-[10px] text-slate-400">(lead — sin cliente)</span></p>
                    <p className="text-slate-500 truncate">{lead.email || '—'}</p>
                    <p className="text-slate-500 truncate">{lead.telefono || '—'}</p>
                    {leadCiudad && <p className="text-slate-500 truncate">{leadCiudad}</p>}
                    <p className="text-[10px] text-amber-600 pt-1">Al generar la venta se pedirá crear el cliente.</p>
                  </div>
                  <button type="button" onClick={() => { setLeadAbierto(true); if (!lead.telefono) setLead((l) => ({ ...l, telefono: '+593 ' })) }} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border shrink-0 flex items-center gap-1" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}><Pencil className="w-3 h-3" /> Cambiar</button>
                </div>
              )
            ) : (
              <>
                <p className="text-xs text-slate-500 mb-2.5">{esVenta ? 'Ningún cliente seleccionado todavía. Búscalo arriba o crea uno nuevo.' : 'Ningún cliente seleccionado todavía. Búscalo arriba, o elige una de estas dos opciones.'}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={() => setFormCli({ cliente: null })} className="text-xs font-bold px-3 py-1.5 rounded-lg text-white flex items-center gap-1.5" style={{ background: 'var(--teal)' }}><UserPlus className="w-3.5 h-3.5" /> Nuevo Cliente</button>
                  {!esVenta && <button type="button" onClick={() => { setLeadAbierto(true); setLead((l) => ({ ...l, telefono: l.telefono || '+593 ' })) }} className="text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-1.5" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}><User className="w-3.5 h-3.5" /> Agregar Lead</button>}
                </div>
              </>
            )}
            {!cliente && leadAbierto && !esVenta && (
              <div className="mt-3 space-y-2 bg-white border border-slate-200 rounded-lg p-3">
                <p className="text-[10px] text-slate-400">Cotiza sin crear cliente. Ningún campo es obligatorio — completa lo que tengas.</p>
                <input className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--cyan)' }} placeholder="Nombre (opcional)" value={lead.nombre} onChange={(e) => setLead({ ...lead, nombre: titulo1(e.target.value) })} />
                <input className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--cyan)' }} placeholder="+593 99 999 9999" value={lead.telefono} onChange={(e) => setLead({ ...lead, telefono: e.target.value })} />
                <input className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--cyan)' }} placeholder="Email (opcional)" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} />
                <input className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--cyan)' }} placeholder="Ciudad (opcional)" value={leadCiudad} onChange={(e) => setLeadCiudad(titulo1(e.target.value))} />
                <button type="button" onClick={usarLead} className="w-full text-xs font-bold py-2 rounded-lg text-white" style={{ background: 'var(--primary)' }}>Usar estos datos</button>
              </div>
            )}
          </div>
        )}
      </section>
      {formCli && <FormularioCliente empresa={empresa} perfil={perfil} asesores={asesores} cliente={formCli.cliente} prefill={formCli.prefill} cerrar={() => setFormCli(null)} aviso={avisoLocal} guardado={(id) => { setFormCli(null); recargarCliente(id) }} />}

      <section className="ns-sec">
        <header><span className="ns-num">2</span><h4>Medio de captación <span className="text-red-500">*</span></h4></header>
        <select value={medio} onChange={(e) => setMedio(e.target.value)} className="ns-input">
          <option value="">Selecciona cómo llegó este cliente</option>
          {MEDIOS.map(([g, ops]) => <optgroup key={g} label={g}>{ops.map((o) => <option key={o} value={o}>{o}</option>)}</optgroup>)}
        </select>
        <p className="text-[10px] text-slate-400 mt-1">Elige por dónde llegó <b>esta vez</b>, aunque ya sea cliente.</p>
      </section>

      {esVenta && (
        <>
          <section className="ns-sec">
            <header><span className="ns-num">3</span><h4>Pago <span className="text-red-500">*</span></h4></header>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              {([['Pagado', BadgeCheck], ['Contraentrega', HandCoins], ['Crédito', CalendarClock], ['Acuerdo de Pago', Handshake]] as const).map(([v, I]) =>
                botonOpc(v, pago, setPago, 'ns-pago-btn', <><I />{v === 'Acuerdo de Pago' ? 'Acuerdo' : v}</>, 'opt'))}
            </div>
            {pago === 'Pagado' && <div className="grid grid-cols-3 gap-2 mb-2 ns-reveal">{[['Efectivo', '💵 Efectivo'], ['Transferencia', '🏦 Transferencia'], ['Cheque', '🧾 Cheque']].map(([v, t]) => botonOpc(v, tipoPago, setTipoPago, 'ns-tipopago-btn', t))}</div>}
            {pago === 'Crédito' && (
              <div className="mb-2 ns-reveal"><label className="ns-label">Plazo de crédito <span className="text-red-500">*</span></label>
                <div className="flex flex-wrap gap-1.5">{PLAZOS.map((p) => botonOpc(p, plazo, setPlazo, 'ns-plazo-btn', p.toLowerCase().replace('dias', 'días')))}</div></div>
            )}
            {pago === 'Pagado' && tipoPago === 'Transferencia' && (
              <label className="ns-drop ns-reveal" style={{ cursor: 'pointer' }}>
                <ImagePlus className="w-4 h-4" /><span>{comprobante ? comprobante.name : 'Comprobante de transferencia (foto)'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => setComprobante(e.target.files?.[0] ?? null)} />
              </label>
            )}
            {pago && <input type="text" value={obsPago} onChange={(e) => setObsPago(e.target.value)} placeholder="Observación de pago (condiciones, abonos…)" className="ns-input mb-2 ns-reveal" />}
            {(pago === 'Contraentrega' || pago === 'Acuerdo de Pago' || pago === 'Crédito') && <input type="number" min="0" step="0.01" value={anticipo} onChange={(e) => setAnticipo(e.target.value)} placeholder="Anticipo recibido ($)" className="ns-input" />}
          </section>

          <section className="ns-sec">
            <header><span className="ns-num">4</span><h4>Entrega <span className="text-red-500">*</span></h4></header>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              {([['Local', MapPin], ['Envío', Truck], ['Delivery', Bike], ['Retiro en Bodega', Warehouse]] as const).map(([v, I]) =>
                botonOpc(v, entrega, setEntrega, 'ns-entrega-btn', <><I />{v === 'Retiro en Bodega' ? 'Retiro' : v}</>, 'opt'))}
            </div>
            {entrega === 'Local' && (
              <div className="grid sm:grid-cols-2 gap-2 ns-reveal">
                <input className="ns-input sm:col-span-2" placeholder="Dirección entrega local *" value={dirEntrega} onChange={(e) => setDirEntrega(e.target.value)} />
                <input className="ns-input" placeholder="Quién recibe *" value={quienRecibe} onChange={(e) => setQuienRecibe(e.target.value)} />
                <input className="ns-input" placeholder="Teléfono entrega *" value={telEntrega} onChange={(e) => setTelEntrega(e.target.value.replace(/\D/g, ''))} />
                <input className="ns-input sm:col-span-2" placeholder="URL Google Maps *" value={mapsEntrega} onChange={(e) => setMapsEntrega(e.target.value)} />
              </div>
            )}
            {entrega === 'Envío' && (
              <div className="space-y-2 ns-reveal">
                <input className="ns-input" placeholder="Ciudad de destino *" value={ciudadDestino} onChange={(e) => setCiudadDestino(e.target.value)} />
                <label className="ns-label">Transporte <span className="text-red-500">*</span></label>
                <div className="flex flex-wrap gap-1.5">{TRANSPORTES.map((t) => botonOpc(t, transporte, setTransporte, 'ns-transporte-btn', t))}</div>
                <div className="grid sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-2 rounded-xl border border-slate-200 p-2.5 bg-slate-50/70">
                    <p className="ns-label !mb-0">Remitente</p>
                    <input className="ns-input" placeholder="Nombre remitente" value={rem.nombre} onChange={(e) => setRem({ ...rem, nombre: e.target.value })} />
                    <input className="ns-input" placeholder="Cédula remitente" value={rem.cedula} onChange={(e) => setRem({ ...rem, cedula: e.target.value })} />
                    <input className="ns-input" placeholder="Teléfono remitente" value={rem.telefono} onChange={(e) => setRem({ ...rem, telefono: e.target.value })} />
                  </div>
                  <div className="space-y-2 rounded-xl border border-slate-200 p-2.5 bg-slate-50/70">
                    <p className="ns-label !mb-0">Destinatario</p>
                    <input className="ns-input" placeholder="Nombre *" value={dest.nombre} onChange={(e) => setDest({ ...dest, nombre: e.target.value })} />
                    <input className="ns-input" placeholder="Teléfono *" value={dest.telefono} onChange={(e) => setDest({ ...dest, telefono: e.target.value.replace(/\D/g, '') })} />
                    <input className="ns-input" placeholder="Cédula *" value={dest.cedula} onChange={(e) => setDest({ ...dest, cedula: e.target.value.replace(/\D/g, '') })} />
                    <input type="email" className="ns-input" placeholder="Email *" value={dest.email} onChange={(e) => setDest({ ...dest, email: e.target.value })} />
                  </div>
                </div>
                <input className="ns-input" placeholder="Dirección de envío *" value={dirEnvio} onChange={(e) => setDirEnvio(e.target.value)} />
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" min="0" step="0.01" className="ns-input" placeholder="Flete ($)" value={flete} onChange={(e) => setFlete(e.target.value)} />
                  <select className="ns-input" value={fletePaga} onChange={(e) => setFletePaga(e.target.value)}><option value="">¿Quién paga el flete?</option><option>Cliente</option><option>Vimedic</option></select>
                </div>
              </div>
            )}
            {entrega === 'Delivery' && <input className="ns-input ns-reveal" placeholder="URL Google Maps *" value={mapsEntrega} onChange={(e) => setMapsEntrega(e.target.value)} />}
          </section>

          <section className="ns-sec">
            <header><span className="ns-num">5</span><h4>Preparación y garantía</h4><span className="ml-auto text-[10px] text-slate-400">opcional</span></header>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {([['Empaque', caja, setCaja, [['En Caja', '📦 En caja'], ['Sin Caja', 'Sin caja']], 'ns-empaque-caja-btn'], ['Armado', armado, setArmado, [['Armado', '🔧 Armado'], ['Desarmado', 'Desarmado']], 'ns-empaque-armado-btn'],
                ['Stretch', stretch, setStretch, [['Con Stretch', 'Con stretch'], ['Sin Stretch', 'Sin stretch']], 'ns-empaque-stretch-btn'], ['Carta de garantía', garantia, setGarantia, [['Virtual', '📧 Virtual'], ['Física', '📄 Física']], 'ns-garantia-btn']] as const).map(([t, val, set, ops, cl]) => (
                <div key={t}><p className="ns-label">{t}</p><div className="flex gap-1.5">{ops.map(([v, tx]) => <button key={v} type="button" onClick={() => set(val === v ? '' : v)} className={cl + ' ns-chip flex-1' + (val === v ? ' active' : '')}>{tx}</button>)}</div></div>
              ))}
              <div className="col-span-2"><p className="ns-label">Fecha de entrega</p><input type="date" className="ns-input" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} /></div>
            </div>
          </section>

          {cliente && (
            <section className="ns-sec">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={guardarDv} onChange={(e) => setGuardarDv(e.target.checked)} className="mt-0.5 w-4 h-4 shrink-0" style={{ accentColor: '#04896f' }} />
                <span className="min-w-0"><b className="block text-xs text-slate-800">Guardar como datos predeterminados de este cliente</b>
                  <span className="block text-[10px] text-slate-500 leading-snug">Pago, entrega, destinatario y preparación se llenarán solos en su próxima venta (clientes frecuentes).</span></span>
              </label>
              {dvAplicado && <div className="mt-2 text-[11px] rounded-lg px-2.5 py-1.5" style={{ background: '#e7f6f2', color: '#04896f' }}>Se cargaron los datos predeterminados de este cliente.</div>}
            </section>
          )}
        </>
      )}

      <section className="ns-sec">
        <header><span className="ns-num"><StickyNote className="w-3 h-3" /></span><h4>{esVenta ? 'Nota importante para esta venta' : 'Nota importante para esta proforma'}</h4><span className="ml-auto text-[10px] text-slate-400">{esVenta ? 'interna' : 'aparece en el PDF'}</span></header>
        <textarea rows={4} value={nota} onChange={(e) => setNota(e.target.value)} placeholder={esVenta ? 'Independiente de la cotización; no aparece en el PDF de proforma...' : 'Condiciones, tiempos de entrega, garantía...'} className="ns-input" />
        <label className="block mt-2"><span className="ns-label">Asesor</span>
          <select className="ns-input" value={asesorId} onChange={(e) => setAsesorId(e.target.value)}>{asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>
      </section>
    </div>
  )

  const panelInventario = (
    <div className={'flex-col overflow-hidden p-4 lg:pl-0 lg:flex' + (pestana === 'inventario' ? ' flex' : ' hidden')}>
      <section className="ns-sec flex-1 flex flex-col min-h-0">
        <header><span className="ns-num">{esVenta ? <PackageSearch className="w-3 h-3" /> : 3}</span><h4>Agregar productos</h4><span className="ml-auto text-[10px] text-slate-400">inventario con precio</span></header>
        <div className="relative mb-2">
          <input type="text" value={qp} onChange={(e) => setQp(e.target.value)} placeholder="Buscar por nombre, código o marca..." className="ns-input pl-9" />
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
        <div className="flex-1 overflow-y-auto rounded-xl border border-slate-100 p-1.5 min-h-[260px]" onScroll={(e) => { const el = e.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) masProds() }}>
          {!qp.trim() && !buscando && prods.length > 0 && <p className="text-[10.5px] text-slate-400 text-center pb-1.5">Primeros productos del inventario · escribe para buscar entre todos</p>}
          {qp.trim() && !buscando && prods.length === 0 && <p className="text-[11px] text-slate-400 text-center py-3">Sin coincidencias para "{qp}".</p>}
          <div className="ns-pgrid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
            {prods.map((p) => {
              const n = carrito.find((x) => x.id === p.id)?.cantidad ?? 0
              const base = precioBase(p, cliente)
              return (
                <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => agregar(p)} style={marcoStock(estStock?.[p.id])} className={'ns-prod group text-left bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-md transition flex flex-col ' + (n ? 'is-added' : '')}>
                  <div className="relative aspect-[4/3] bg-slate-50">
                    <span className="ns-added">✓ Agregado<b className="ns-added-q">{n > 1 ? ' ×' + n : ''}</b></span>
                    <img loading="lazy" src={imagen(p.imagen_url, 240)} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} className="w-full h-full object-contain p-2" alt="" />
                    <span className="absolute right-1.5 bottom-1.5 w-7 h-7 rounded-full grid place-items-center text-white text-base font-bold shadow-md opacity-90 group-hover:scale-110 transition" style={{ background: 'var(--acc)' }}>+</span>
                  </div>
                  <FranjaStock e={estStock?.[p.id]} />
                  <div className="p-2 flex flex-col gap-0.5 flex-1">
                    <p className="text-[9px] font-mono-spec text-slate-400 truncate">{p.codigo}</p>
                    <p className="text-[11px] font-semibold text-slate-800 leading-snug line-clamp-2">{p.nombre}</p>
                    <EtiquetasStockCotizacion stock={p.stock} e={estStock?.[p.id]} />
                    {p.reservaciones && <p className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 leading-tight">🔴 {p.reservaciones}</p>}
                    <p className="text-[11px] font-bold mt-auto" style={{ color: 'var(--acc-d)' }}>{dinero(base)} <span className="text-[9px] font-normal text-slate-400">{p.aplica_iva === false ? 'IVA 0%' : '+ IVA'}</span></p>
                    {base > 0 && <p className="text-[9px] text-slate-400 leading-tight">{p.aplica_iva === false ? 'No aplica IVA' : dinero(Math.round(base * 1.15 * 100) / 100) + ' IVA incluido'}</p>}
                  </div>
                </button>
              )
            })}
          </div>
          {buscando && !prods.length && <p className="text-[11px] text-slate-400 text-center py-4">Cargando productos…</p>}
          {hayMas && <button type="button" onClick={masProds} disabled={cargandoMas} className="w-full mt-2 py-2 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-500 hover:bg-slate-50">{cargandoMas ? "Cargando…" : "Ver más productos"}</button>}
        </div>
      </section>
    </div>
  )

  const aplicarPct = (idx: number | null, signo: 1 | -1) => {
    const v = Number(pct)
    if (!v) return
    setCarrito((a) => a.map((x, k) => (idx === null || k === idx) ? (signo === -1 ? { ...x, descuento: Math.min(100, Math.max(0, +(x.descuento + v).toFixed(2))) } : { ...x, precio: +(x.precio * (1 + v / 100)).toFixed(2) }) : x))
  }
  const panelCarrito = (
    <div className={'overflow-hidden flex-col bg-white lg:border-l border-slate-200 lg:flex' + (pestana === 'carrito' ? ' flex' : ' hidden')}>
      <div className="px-4 pt-4 pb-2 flex items-center gap-2">
        <ShoppingCart className="w-4 h-4" style={{ color: 'var(--acc)' }} />
        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Productos en la {esVenta ? 'venta' : 'cotización'}</h4>
        <span className="ml-auto pill" style={{ background: 'var(--acc-l)', color: 'var(--acc)' }}>{unidades} u</span>
      </div>
      <div className="space-y-2 px-4 pb-2 flex-grow overflow-y-auto">
        {carrito.length === 0 && <div className="text-center py-10 text-slate-400"><p className="text-3xl">🧾</p><p className="text-xs font-semibold mt-2">Aún no agregas productos</p><p className="text-[11px]">Búscalos en el inventario y tócalos para sumarlos.</p></div>}
        {carrito.map((i, idx) => (
          <div key={i.id} className="ns-item" draggable onDragStart={() => { dragIdx.current = idx }} onDragOver={(e) => e.preventDefault()}
            onDrop={() => { const d = dragIdx.current; if (d === null || d === idx) return; setCarrito((a) => { const b = [...a]; const [m] = b.splice(d, 1); b.splice(idx, 0, m); return b }) }}>
            <div className="flex items-center gap-2.5">
              <img loading="lazy" src={imagen(i.imagen, 160)} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} className="w-11 h-11 rounded-xl object-contain border border-slate-100 shrink-0 bg-slate-50 cursor-grab" alt="" />
              <div className="flex-grow min-w-0">
                <p className="text-xs font-bold text-slate-800 truncate" title={i.nombre}>{i.nombre}</p>
                <p className="text-[10px] text-slate-400">{i.descuento ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#7c3aed1A', color: '#7c3aed' }}>Desc: {i.descuento}%</span> : null} <b className="text-slate-600">{dinero(i.precio * i.cantidad * (1 - i.descuento / 100))}</b></p>
              </div>
              <div className="ns-qty shrink-0">
                <button onClick={() => i.cantidad <= 1 ? setCarrito((a) => a.filter((_, k) => k !== idx)) : cambiar(idx, { cantidad: i.cantidad - 1 })} aria-label="Menos">−</button>
                <input type="text" inputMode="numeric" value={i.cantidad} aria-label="Cantidad" className="ns-qty-in" onFocus={(e) => e.target.select()} onChange={(e) => cambiar(idx, { cantidad: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} />
                <button onClick={() => cambiar(idx, { cantidad: i.cantidad + 1 })} aria-label="Más">+</button>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <span className="text-[10px] text-slate-400">P. unit. $</span>
              <input type="number" min="0" step="0.01" value={i.precio} onFocus={(e) => e.target.select()} onChange={(e) => cambiar(idx, { precio: Number(e.target.value) || 0 })} className="ns-mini w-20" />
              {esFm && <><span className="text-[10px] text-slate-400" title="Objetivo previsto: sube el precio para absorber el descuento">Obj. %</span><input type="number" min="0" max="90" step="0.1" value={i.obj ?? 0} onFocus={(e) => e.target.select()} onChange={(e) => cambiar(idx, { obj: Number(e.target.value) || 0, precio: conObjetivo(i.base ?? i.precio, Number(e.target.value) || 0), base: i.base ?? i.precio })} className="ns-mini w-14" /></>}
              <button onClick={() => aplicarPct(idx, -1)} title="Aplicar el % del cuadro de abajo como descuento" className="ns-round !w-6 !h-6 ml-auto">−</button>
              <button onClick={() => aplicarPct(idx, 1)} title="Subir el precio ese %" className="ns-round !w-6 !h-6">+</button>
            </div>
            <input type="text" value={i.observacion} placeholder="Observación (ej. Entrega inmediata / 72h)" onChange={(e) => cambiar(idx, { observacion: e.target.value })} className="ns-mini w-full text-left mt-1.5" />
          </div>
        ))}
      </div>
      {esFm && (
        <div className="px-4 py-2 flex items-center gap-1.5 border-t border-slate-100">
          <label className="text-[10px] text-slate-500 mr-auto leading-tight">Plan previsto <span className="block text-slate-400">Precio = PVP ÷ (1 − %). Con 10 % de descuento vuelve al PVP VIMEDIC.</span></label>
          <input type="number" min="0" max="90" step="0.1" value={plan} onChange={(e) => setPlan(Number(e.target.value) || 0)} className="ns-mini w-16" />
          <button onClick={() => setCarrito((a) => a.map((x) => ({ ...x, obj: plan, base: x.base ?? x.precio, precio: conObjetivo(x.base ?? x.precio, plan) })))} className="btn btn-sm" style={{ fontSize: 11, fontWeight: 700, padding: '5px 9px', border: '1px solid #cbd5e1', borderRadius: 8 }}>Aplicar a todos</button>
        </div>
      )}
      <div className="px-4 py-2 flex items-center justify-end gap-1.5 border-t border-slate-100">
        <label className="text-[10px] text-slate-500 mr-auto leading-tight">Ajustar todos <span className="block text-slate-400">− descuento · + sube precio</span></label>
        <input type="number" step="0.1" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="%" onFocus={(e) => e.target.select()} className="ns-mini w-16" />
        <button onClick={() => aplicarPct(null, -1)} title="Sumar ese % de descuento a todos" className="ns-round">−</button>
        <button onClick={() => aplicarPct(null, 1)} title="Subir el precio de todos ese %" className="ns-round">+</button>
      </div>
      <div className="hidden lg:block p-4 pt-2">
        <div className="ns-total">
          <div className="flex justify-between text-[11px] text-slate-500"><span>Subtotal</span><span>{dinero(subtotal)}</span></div>
          <div className="flex justify-between text-[11px] text-slate-500 mt-0.5"><span>IVA 15%</span><span>{dinero(ivaTotal)}</span></div>
          <div className="flex justify-between items-end mt-2 pt-2 border-t border-slate-200/70"><span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">Total</span><span className="font-display font-bold text-2xl" style={{ color: 'var(--acc-d)' }}>{dinero(total)}</span></div>
        </div>
        <p className="text-[10px] mt-2 min-h-[14px]" style={{ color: error || faltan.length ? '#c0392b' : '#04896f' }}>{error || (faltan.length ? 'Falta: ' + faltan.join(', ') : 'Todo listo')}</p>
        <button onClick={guardar} disabled={guardando} className="ns-submit mt-1">{guardando ? 'Guardando…' : esVenta ? 'Registrar venta' : ed ? 'Guardar cambios' : 'Generar cotización'}</button>
        {!esVenta && <p className="text-[9px] text-slate-400 mt-1 text-center">Al guardar se abre la proforma lista para imprimir o guardar como PDF.</p>}
      </div>
    </div>
  )

  const Icono = esVenta ? Receipt : FilePlus2
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[60] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="ns-shell nq-theme bg-slate-50 sm:rounded-3xl shadow-2xl w-full h-[100dvh] sm:h-[94vh] sm:max-w-[1500px] flex flex-col overflow-hidden"
        style={esVenta ? { ['--acc' as string]: '#04896f', ['--acc-d' as string]: '#064e3b', ['--acc-l' as string]: '#e7f6f2', ['--acc-b' as string]: '#bfe6da', ['--acc-rgb' as string]: '4,137,111' } : undefined}>
        <div className="ns-head shrink-0 px-5 pt-4 pb-3 text-white" style={esVenta ? { background: 'linear-gradient(135deg,#064e3b,#04896f)' } : undefined}>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl grid place-items-center bg-white/15"><Icono className="w-5 h-5" /></span>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-base leading-tight">{esVenta ? 'Nueva Venta' : ed ? 'Editar Cotización' : 'Nueva Cotización'}</h3>
              <p className="text-[11px] text-white/70">{esVenta ? 'Registra el pago, la entrega y los equipos vendidos.' : 'Elige el cliente, cómo llegó y los equipos.'}</p>
            </div>
            <div className="ml-auto hidden md:flex items-center gap-1.5">
              <span className={'ns-step' + (pasos.cliente ? ' done' : '')}><User />Cliente</span>
              <span className={'ns-step' + (pasos.captacion ? ' done' : '')}><Magnet />Captación</span>
              {esVenta && <span className={'ns-step' + (pasos.pago ? ' done' : '')}><CreditCard />Pago</span>}
              {esVenta && <span className={'ns-step' + (pasos.entrega ? ' done' : '')}><Truck />Entrega</span>}
              <span className={'ns-step' + (pasos.productos ? ' done' : '')}><Package />Productos</span>
            </div>
            <button onClick={cerrar} className="ml-2 w-9 h-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-white/15 overflow-hidden"><i className="block h-full rounded-full bg-white transition-all duration-300" style={{ width: progreso + '%' }} /></div>
        </div>

        <div className="lg:hidden flex border-b border-slate-200 bg-white shrink-0">
          {([['cliente', User, 'Datos'], ['inventario', PackageSearch, 'Inventario'], ['carrito', ShoppingCart, 'Carrito']] as const).map(([k, I, t]) => (
            <button key={k} type="button" onClick={() => setPestana(k)} className={'flex-1 text-xs font-bold py-2.5 border-b-2 flex items-center justify-center gap-1.5' + (pestana === k ? '' : ' border-transparent text-slate-400')} style={pestana === k ? { borderColor: acento, color: acento } : undefined}>
              <I className="w-3.5 h-3.5" /> {t}{k === 'carrito' && carrito.length > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: acento }}>{carrito.length}</span>}
            </button>
          ))}
        </div>

        <div className="flex-grow grid grid-cols-1 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.15fr)_370px] overflow-hidden">
          {panelCliente}{panelInventario}{panelCarrito}
        </div>

        <div className="lg:hidden shrink-0 border-t border-slate-200 bg-white px-4 py-2.5 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500">Subtotal <b className="text-slate-700">{dinero(subtotal)}</b> · IVA <b className="text-slate-700">{dinero(ivaTotal)}</b></span>
            <span className="font-display font-bold text-slate-800">Total: <span style={{ color: acento }}>{dinero(total)}</span></span>
          </div>
          {(error || faltan.length > 0) && <p className="text-[10px]" style={{ color: '#c0392b' }}>{error || 'Falta: ' + faltan.join(', ')}</p>}
          <button onClick={guardar} disabled={guardando} className="ns-submit">{guardando ? 'Guardando…' : esVenta ? 'Registrar venta' : ed ? 'Guardar cambios' : 'Generar cotización'}</button>
        </div>
      </div>
    </div>
  )
}
