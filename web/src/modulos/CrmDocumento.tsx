import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck, Bike, CalendarClock, FilePlus2, HandCoins, Handshake, Magnet, MapPin, Package, PackageSearch, Receipt, Search,
  ShoppingCart, StickyNote, Truck, User, Warehouse, X,
} from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { imagen } from './Inventario'

type Asesor = { id: string; nombre: string }
export type Origen = { tabla: 'leads' | 'cotizaciones'; id: string; codigo: string; nombre: string; telefono: string; email: string; identificacion: string; medio: string } | null
type Prod = { id: string; codigo: string | null; nombre: string; pvp: number | null; precio_dis: number | null; aplica_iva: boolean; stock: number | null; imagen_url: string | null; reservaciones: string | null }
type Linea = { id: string; codigo: string; nombre: string; imagen: string; precio: number; cantidad: number; descuento: number; iva: boolean; observacion: string }
type Cli = { id: string; nombre: string; identificacion: string | null; email: string | null; telefono: string | null; direccion: string | null; tipo_cliente: string | null; descuento_fijo: string | null }

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
const limpiar = (t: string) => t.replace(/[,()%*\\"']/g, ' ').trim()

export default function CrmDocumento({ modo, perfil, asesores, origen, cerrar, guardado }: {
  modo: 'Cotización' | 'Venta'; perfil: Perfil; asesores: Asesor[]; origen: Origen; cerrar: () => void; guardado: (msg: string) => void
}) {
  const esVenta = modo === 'Venta'
  const acento = esVenta ? '#04896f' : '#055c9d'
  const [pestana, setPestana] = useState<'cliente' | 'inventario' | 'carrito'>('cliente')

  /* cliente */
  const [busca, setBusca] = useState('')
  const [res, setRes] = useState<Cli[]>([])
  const [cliente, setCliente] = useState<Cli | null>(null)
  const [lead, setLead] = useState({ nombre: origen?.nombre ?? '', telefono: origen?.telefono ?? '', email: origen?.email ?? '', identificacion: origen?.identificacion ?? '' })
  const [medio, setMedio] = useState(origen?.medio ?? '')
  const [nota, setNota] = useState('')
  const [asesorId, setAsesorId] = useState(perfil.id)

  /* productos */
  const [qp, setQp] = useState('')
  const [prods, setProds] = useState<Prod[]>([])
  const [buscando, setBuscando] = useState(false)
  const [carrito, setCarrito] = useState<Linea[]>([])
  const [pct, setPct] = useState('')
  const dragIdx = useRef<number | null>(null)

  /* venta */
  const [pago, setPago] = useState('')
  const [tipoPago, setTipoPago] = useState('')
  const [plazo, setPlazo] = useState('')
  const [obsPago, setObsPago] = useState('')
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

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const q = limpiar(busca)
    if (q.length < 2) { setRes([]); return }
    const t = setTimeout(() => {
      supabase.from('clientes').select('id,nombre,identificacion,email,telefono,direccion,tipo_cliente,descuento_fijo').is('deleted_at', null)
        .or(`nombre.ilike.%${q}%,identificacion.ilike.%${q}%,email.ilike.%${q}%`).limit(8).then(({ data }) => setRes((data as Cli[]) ?? []))
    }, 250)
    return () => clearTimeout(t)
  }, [busca])

  useEffect(() => {
    const q = limpiar(qp)
    if (!q) { setProds([]); return }
    setBuscando(true)
    const t = setTimeout(() => {
      let c = supabase.from('productos').select('id,codigo,nombre,pvp,precio_dis,aplica_iva,stock,imagen_url,reservaciones').is('deleted_at', null)
      for (const p of q.split(/\s+/)) c = c.or(`nombre.ilike.%${p}%,codigo.ilike.%${p}%,codigo_unico.ilike.%${p}%,marca.ilike.%${p}%`)
      c.order('nombre').range(0, 29).then(({ data }) => { setProds((data as Prod[]) ?? []); setBuscando(false) })
    }, 250)
    return () => clearTimeout(t)
  }, [qp])

  /* descuento del cliente: DIS+VIP usa precio distribuidor, DIS+% descuenta ese % del PVP */
  function descCliente(c: Cli | null) { return c?.tipo_cliente === 'DIS' && /^\d+$/.test(c.descuento_fijo ?? '') ? Number(c.descuento_fijo) : 0 }
  function precioBase(p: Prod, c: Cli | null) { return c?.tipo_cliente === 'DIS' && c.descuento_fijo === 'VIP' && Number(p.precio_dis) > 0 ? Number(p.precio_dis) : Number(p.pvp) || 0 }

  function agregar(p: Prod) {
    setCarrito((a) => {
      const i = a.findIndex((x) => x.id === p.id)
      if (i >= 0) return a.map((x, k) => (k === i ? { ...x, cantidad: x.cantidad + 1 } : x))
      return [...a, { id: p.id, codigo: p.codigo ?? '', nombre: p.nombre, imagen: p.imagen_url ?? '', precio: precioBase(p, cliente), cantidad: 1, descuento: descCliente(cliente), iva: p.aplica_iva !== false, observacion: '' }]
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
    if (entrega === 'Local' && !dirEntrega.trim()) faltan.push('dirección de entrega')
    if (entrega === 'Envío' && (!ciudadDestino.trim() || !transporte)) faltan.push('ciudad y transporte')
  }
  const pasos = { cliente: !!nombre, captacion: !!medio, productos: carrito.length > 0 }
  const progreso = Math.round(([!!nombre, !!medio, carrito.length > 0, !esVenta || (!!pago && !!entrega)].filter(Boolean).length / 4) * 100)

  async function guardar() {
    if (faltan.length) { setError('Falta: ' + faltan.join(', ') + '.'); return }
    setGuardando(true); setError('')
    const ahora = new Date().toISOString()
    const items = carrito.map((i) => ({ id: i.id, codigo: i.codigo, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad, descuento: i.descuento, iva: i.iva, observacion: i.observacion }))
    const datos: Record<string, unknown> = {
      tipo_registro: modo, cliente_id: cliente?.id ?? null, lead_sin_cliente: !cliente, nombre,
      identificacion: cliente?.identificacion ?? (lead.identificacion || null), email: cliente?.email ?? (lead.email.trim() || null), telefono: cliente?.telefono ?? (lead.telefono.trim() || null),
      direccion: cliente?.direccion ?? null, asesor_id: asesorId || null, detalle_equipos: carrito.map((i) => `${i.nombre} (Cant: ${i.cantidad})`).join(', '),
      items, total: Math.round(total * 100) / 100, medio_captacion_lead: medio, nota_cotizacion: nota.trim() || null,
      estado_crm: esVenta ? 'Ganado' : 'Seguimiento', ultima_actividad: ahora,
    }
    if (esVenta) {
      Object.assign(datos, {
        medio_captacion_venta: medio, nota_venta: nota.trim() || null, estado_pago: pago, metodo_pago: tipoPago || (plazo ? 'Crédito ' + plazo : null),
        anticipo: Number(anticipo) || null, tipo_entrega: entrega, fecha_entrega: fechaEntrega || null, fecha_venta: ahora,
        direccion_entrega: entrega === 'Local' ? `${dirEntrega.trim()}${quienRecibe ? ' · Recibe: ' + quienRecibe : ''}${telEntrega ? ' · Tel: ' + telEntrega : ''}${mapsEntrega ? ' · ' + mapsEntrega : ''}` : entrega === 'Envío' ? `${ciudadDestino.trim()} · ${transporte}` : entrega === 'Delivery' ? mapsEntrega || null : null,
        flete: Number(flete) || null, flete_lo_paga: fletePaga || null,
      })
    }
    let id = origen?.tabla === 'cotizaciones' ? origen.id : crypto.randomUUID()
    let codigo = origen?.tabla === 'cotizaciones' ? origen.codigo : (esVenta ? 'VEN-' : 'COT-') + crypto.randomUUID().slice(0, 6).toUpperCase()
    const r = origen?.tabla === 'cotizaciones'
      ? await supabase.from('cotizaciones').update(datos).eq('id', id)
      : await supabase.from('cotizaciones').insert({ id, codigo, empresa: perfil.empresa, fecha: ahora, lead_id: origen?.tabla === 'leads' ? origen.id : null, ...datos })
    if (r.error) { setError(r.error.message); setGuardando(false); return }
    if (origen?.tabla === 'leads') await supabase.from('leads').update({ estado_crm: esVenta ? 'Ganado' : 'Seguimiento', ultima_actividad: ahora }).eq('id', origen.id)
    await supabase.from('interacciones').insert({
      id: crypto.randomUUID(), codigo: 'INT-' + crypto.randomUUID().slice(0, 8), ref_tipo: modo, ref_codigo: codigo, cotizacion_id: id,
      tipo: esVenta ? 'Venta Registrada' : 'Cotización Creada', nota: `${modo} por ${dinero(total)} (${unidades} u).`, empleado_id: perfil.id, usuario_texto: perfil.nombre,
    })
    id = ''; codigo = ''
    guardado(`${modo} creada por ${dinero(total)}.`)
  }

  const botonOpc = (valor: string, actual: string, set: (v: string) => void, clase: string, texto: React.ReactNode, tipo: 'opt' | 'chip' = 'chip') => (
    <button key={valor} type="button" onClick={() => set(valor)} className={`${clase} ns-${tipo}` + (actual === valor ? ' active' : '')}>{texto}</button>
  )

  const panelCliente = (
    <div className={'overflow-y-auto p-4 space-y-3 lg:block' + (pestana === 'cliente' ? '' : ' hidden')}>
      <section className="ns-sec">
        <header><span className="ns-num">1</span><h4>Cliente</h4></header>
        <div className="relative mb-2">
          <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente por nombre, cédula o correo..." className="ns-input pl-9" />
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
        {res.length > 0 && !cliente && (
          <div className="border border-slate-200 rounded-xl max-h-40 overflow-y-auto mb-2 divide-y divide-slate-100 bg-white shadow-sm">
            {res.map((c) => (
              <button key={c.id} type="button" className="w-full text-left px-3 py-2 hover:bg-slate-50" onClick={() => { setCliente(c); setBusca(''); setRes([]); setCarrito((a) => a.map((l) => ({ ...l, descuento: descCliente(c) }))) }}>
                <p className="text-xs font-bold text-slate-800 truncate">{c.nombre}</p>
                <p className="text-[10px] text-slate-500 truncate">{[c.identificacion, c.telefono, c.email].filter(Boolean).join(' · ')}</p>
              </button>
            ))}
          </div>
        )}
        {cliente ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-800 truncate">{cliente.nombre} {cliente.tipo_cliente === 'DIS' && <span className="pill" style={{ background: '#7c3aed1A', color: '#7c3aed' }}>DIS {cliente.descuento_fijo}</span>}</p>
              <p className="text-[10px] text-slate-500 truncate">{[cliente.identificacion, cliente.telefono, cliente.email].filter(Boolean).join(' · ') || 'Sin más datos'}</p>
            </div>
            <button type="button" className="text-[10px] font-bold" style={{ color: 'var(--acc)' }} onClick={() => setCliente(null)}>Cambiar</button>
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
            <p className="text-[10px] text-slate-500">¿Aún no es cliente? Cotiza a un prospecto:</p>
            <input className="ns-input" placeholder="Nombre *" value={lead.nombre} onChange={(e) => setLead({ ...lead, nombre: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="ns-input" placeholder="Teléfono" value={lead.telefono} onChange={(e) => setLead({ ...lead, telefono: e.target.value.replace(/\D/g, '') })} />
              <input className="ns-input" placeholder="Correo" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} />
            </div>
          </div>
        )}
      </section>

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
                <input className="ns-input" placeholder="Quién recibe" value={quienRecibe} onChange={(e) => setQuienRecibe(e.target.value)} />
                <input className="ns-input" placeholder="Teléfono entrega" value={telEntrega} onChange={(e) => setTelEntrega(e.target.value.replace(/\D/g, ''))} />
                <input className="ns-input sm:col-span-2" placeholder="URL Google Maps" value={mapsEntrega} onChange={(e) => setMapsEntrega(e.target.value)} />
              </div>
            )}
            {entrega === 'Envío' && (
              <div className="space-y-2 ns-reveal">
                <input className="ns-input" placeholder="Ciudad de destino *" value={ciudadDestino} onChange={(e) => setCiudadDestino(e.target.value)} />
                <label className="ns-label">Transporte <span className="text-red-500">*</span></label>
                <div className="flex flex-wrap gap-1.5">{TRANSPORTES.map((t) => botonOpc(t, transporte, setTransporte, 'ns-transporte-btn', t))}</div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" min="0" step="0.01" className="ns-input" placeholder="Flete ($)" value={flete} onChange={(e) => setFlete(e.target.value)} />
                  <select className="ns-input" value={fletePaga} onChange={(e) => setFletePaga(e.target.value)}><option value="">¿Quién paga el flete?</option><option>Cliente</option><option>Vimedic</option></select>
                </div>
              </div>
            )}
            {entrega === 'Delivery' && <input className="ns-input ns-reveal" placeholder="URL Google Maps" value={mapsEntrega} onChange={(e) => setMapsEntrega(e.target.value)} />}
            {entrega && <label className="block mt-2"><span className="ns-label">Fecha de entrega</span><input type="date" className="ns-input" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} /></label>}
          </section>
        </>
      )}

      <section className="ns-sec">
        <header><span className="ns-num"><StickyNote className="w-3 h-3" /></span><h4>{esVenta ? 'Nota de la venta' : 'Nota importante para esta proforma'}</h4><span className="ml-auto text-[10px] text-slate-400">{esVenta ? 'interna' : 'aparece en el PDF'}</span></header>
        <textarea rows={4} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Condiciones, tiempos de entrega, garantía..." className="ns-input" />
        <label className="block mt-2"><span className="ns-label">Asesor</span>
          <select className="ns-input" value={asesorId} onChange={(e) => setAsesorId(e.target.value)}>{asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>
      </section>
    </div>
  )

  const panelInventario = (
    <div className={'flex-col overflow-hidden p-4 lg:pl-0 lg:flex' + (pestana === 'inventario' ? ' flex' : ' hidden')}>
      <section className="ns-sec flex-1 flex flex-col min-h-0">
        <header><span className="ns-num">{esVenta ? 5 : 3}</span><h4>Agregar productos</h4><span className="ml-auto text-[10px] text-slate-400">inventario con precio</span></header>
        <div className="relative mb-2">
          <input type="text" value={qp} onChange={(e) => setQp(e.target.value)} placeholder="Buscar por nombre, código o marca..." className="ns-input pl-9" />
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
        <div className="flex-1 overflow-y-auto rounded-xl border border-slate-100 p-1.5 min-h-[260px]">
          {!qp.trim() && <div className="text-center py-6 px-3"><p className="text-[12px] font-semibold text-slate-500">Escribe el nombre, código o marca del equipo</p><p className="text-[10.5px] text-slate-400 mt-1">Los productos aparecen al buscar (así el formulario abre más rápido).</p></div>}
          {qp.trim() && !buscando && prods.length === 0 && <p className="text-[11px] text-slate-400 text-center py-3">Sin coincidencias para "{qp}".</p>}
          <div className="ns-pgrid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
            {prods.map((p) => {
              const n = carrito.find((x) => x.id === p.id)?.cantidad ?? 0
              const base = precioBase(p, cliente)
              return (
                <button key={p.id} type="button" onClick={() => agregar(p)} className={'ns-prod group text-left bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-md transition flex flex-col ' + (n ? 'is-added' : '')}>
                  <div className="relative aspect-[4/3] bg-slate-50">
                    <span className="ns-added">✓ Agregado<b className="ns-added-q">{n > 1 ? ' ×' + n : ''}</b></span>
                    <img loading="lazy" src={imagen(p.imagen_url, 240)} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} className="w-full h-full object-contain p-2" alt="" />
                    <span className="absolute right-1.5 bottom-1.5 w-7 h-7 rounded-full grid place-items-center text-white text-base font-bold shadow-md opacity-90 group-hover:scale-110 transition" style={{ background: 'var(--acc)' }}>+</span>
                  </div>
                  <div className="p-2 flex flex-col gap-0.5 flex-1">
                    <p className="text-[9px] font-mono-spec text-slate-400 truncate">{p.codigo}</p>
                    <p className="text-[11px] font-semibold text-slate-800 leading-snug line-clamp-2">{p.nombre}</p>
                    <p className="text-[10px] text-slate-500">Stock: <b>{p.stock ?? 0}</b></p>
                    {p.reservaciones && <p className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 leading-tight">🔴 {p.reservaciones}</p>}
                    <p className="text-[11px] font-bold mt-auto" style={{ color: 'var(--acc-d)' }}>{dinero(base)} <span className="text-[9px] font-normal text-slate-400">{p.aplica_iva === false ? 'IVA 0%' : '+ IVA'}</span></p>
                  </div>
                </button>
              )
            })}
          </div>
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
              <button onClick={() => aplicarPct(idx, -1)} title="Aplicar el % del cuadro de abajo como descuento" className="ns-round !w-6 !h-6 ml-auto">−</button>
              <button onClick={() => aplicarPct(idx, 1)} title="Subir el precio ese %" className="ns-round !w-6 !h-6">+</button>
            </div>
            <input type="text" value={i.observacion} placeholder="Observación (ej. Entrega inmediata / 72h)" onChange={(e) => cambiar(idx, { observacion: e.target.value })} className="ns-mini w-full text-left mt-1.5" />
          </div>
        ))}
      </div>
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
        <button onClick={guardar} disabled={guardando} className="ns-submit mt-1">{guardando ? 'Guardando…' : esVenta ? 'Registrar venta' : 'Generar cotización'}</button>
        {!esVenta && <p className="text-[9px] text-slate-400 mt-1 text-center">El PDF se generará cuando se conecte Google Drive.</p>}
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
              <h3 className="font-display font-bold text-base leading-tight">{esVenta ? 'Nueva Venta' : 'Nueva Cotización'}</h3>
              <p className="text-[11px] text-white/70">{esVenta ? 'Registra el pago, la entrega y los equipos vendidos.' : 'Elige el cliente, cómo llegó y los equipos.'}</p>
            </div>
            <div className="ml-auto hidden md:flex items-center gap-1.5">
              <span className={'ns-step' + (pasos.cliente ? ' done' : '')}><User />Cliente</span>
              <span className={'ns-step' + (pasos.captacion ? ' done' : '')}><Magnet />Captación</span>
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
          <button onClick={guardar} disabled={guardando} className="ns-submit">{guardando ? 'Guardando…' : esVenta ? 'Registrar venta' : 'Generar cotización'}</button>
        </div>
      </div>
    </div>
  )
}
