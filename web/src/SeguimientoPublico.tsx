import { useCallback, useEffect, useState } from 'react'
import { CircleCheckBig, FileCheck2, MapPin, MessageCircle, Navigation, PackageCheck, PackageOpen, Receipt, Share2, ShoppingBag, Star, Truck, Wrench, type LucideIcon } from 'lucide-react'
import { supabase } from './supabase'
import { imagen } from './modulos/inventarioUtil'
import './estilos/seguimiento.css'

/* Seguimiento público del pedido (Issue #38). El cliente lo abre con el QR de la guía o con el enlace que le envía su asesor.
   Los datos llegan de la función "seguimiento", que valida el código y solo entrega lo que el cliente puede ver. */
type Paso = { clave: string; nombre: string; fecha: string | null }
type Ent = { numero: number; estado: string; modalidad: string | null; transportista: string | null; guia: string | null; programada: string | null; ventana: string | null; entregada: string | null; recibio: string; fotos: string[] }
type Datos = {
  codigo: string; empresa: string; cliente: string; etapa: string; estado: string; desde: string; estimada: string | null; completado: string | null; instalacion: boolean
  factura: string; guia: string; tipoEntrega: string; etapas: Paso[]; historial: { fecha: string; titulo: string; detalle: string; tipo: string }[]
  productos: { nombre: string; cantidad: number; imagen: string }[]; entregas: Ent[]; asesor: { nombre: string; whatsapp: string; foto: string } | null; encuesta: boolean
}
type Legado = { legado: true; empresa: string; cliente: string; guia: string; despacho: string; entrega: { estado: string; fecha_programada: string | null; fecha_entrega: string | null; transportista: string | null; guia_numero: string | null } | null }

const ICONO: Record<string, LucideIcon> = { venta: ShoppingBag, facturar: Receipt, facturada: FileCheck2, preparacion: PackageOpen, lista: PackageCheck, despachada: Truck, en_ruta: Navigation, entregada: CircleCheckBig, instalacion: Wrench }
const fFecha = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('es-EC', { weekday: 'short', day: 'numeric', month: 'short' }) : '')
const fHora = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const MENSAJE: Record<string, string> = {
  venta: 'Recibimos tu pedido.', facturar: 'Estamos emitiendo tu factura.', facturada: 'Tu factura está lista; bodega va a preparar tu pedido.',
  preparacion: 'Estamos preparando y revisando tus equipos.', lista: 'Tu pedido está empacado y listo para salir.', despachada: 'Tu pedido salió de nuestra bodega.',
  en_ruta: 'Tu pedido va en camino.', entregada: '¡Tu pedido fue entregado!', instalacion: 'Coordinaremos la instalación o capacitación de tus equipos.',
}

export default function SeguimientoPublico() {
  const token = new URLSearchParams(window.location.search).get('c') ?? ''
  const [d, setD] = useState<Datos | Legado | null>(null)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState('')
  // Alguien del equipo con sesión iniciada que escaneó el QR con la cámara normal del celular: se le ofrece registrar el avance.
  const [equipo, setEquipo] = useState<boolean | null>(null)
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setEquipo(!!data.session)).catch(() => setEquipo(false)) }, [])
  const cargar = useCallback(async () => {
    if (!token) { setError('Enlace no válido.'); return }
    if (equipo === null) return
    const { data, error: e } = await supabase.functions.invoke('seguimiento', { body: { token, equipo } })
    let msg = (data as { error?: string } | null)?.error || ''
    if (e && !msg) { try { const j = await (e as unknown as { context?: Response }).context?.json?.(); msg = j?.error || e.message } catch { msg = e.message } }
    if (msg) { setError(msg); return }
    setError(''); setD(data as Datos | Legado)
  }, [token, equipo])
  useEffect(() => { document.title = 'Seguimiento de tu pedido · VIMEDIC'; cargar() }, [cargar])
  // Se actualiza solo mientras la página está abierta.
  useEffect(() => { const t = window.setInterval(() => { if (document.visibilityState === 'visible') cargar() }, 90000); return () => window.clearInterval(t) }, [cargar])

  const compartir = () => {
    const url = window.location.href
    if (navigator.share) navigator.share({ title: 'Seguimiento de mi pedido', url }).catch(() => undefined)
    else navigator.clipboard?.writeText(url)
  }
  const marca = d?.empresa === 'FEMEDICS' ? 'FEMEDICS' : 'VIMEDIC'

  return (
    <div className="sg">
      <header className="sg-top"><div className="sg-wrap">
        <div className="sg-marca"><Truck size={20} />{marca}</div>
        <h1>{d && !('legado' in d) ? (d.cliente ? `Hola ${d.cliente}, así va tu pedido` : 'Así va tu pedido') : 'Seguimiento de tu pedido'}</h1>
        <p>{d && !('legado' in d) ? `Pedido ${d.codigo}${d.factura ? ' · factura ' + d.factura : ''}${d.guia ? ' · guía ' + d.guia : ''}` : 'Equipos médicos'}</p>
      </div></header>
      <main className="sg-wrap">
        {error && <div className="sg-card prim"><p className="sg-msg err">{error}</p></div>}
        {!error && !d && <div className="sg-card prim"><div className="sg-spin" aria-label="Cargando" /></div>}
        {d && 'legado' in d && <Legado d={d} />}
        {d && !('legado' in d) && <Pedido d={d} setZoom={setZoom} compartir={compartir} token={token} />}
        {equipo && d && !('legado' in d) && <a className="sg-card sg-equipo" href={'/escanear?c=' + encodeURIComponent(token)}><b>Eres del equipo {marca}</b><span>Registrar el avance de este pedido →</span></a>}
        <p className="sg-pie">{marca} · Equipos médicos · Esta página se actualiza sola</p>
      </main>
      {zoom && <div className="sg-zoom" onClick={() => setZoom('')} role="dialog" aria-label="Foto"><img src={zoom} alt="Foto de la entrega" /></div>}
    </div>
  )
}

function Pedido({ d, setZoom, compartir, token }: { d: Datos; setZoom: (u: string) => void; compartir: () => void; token: string }) {
  const idx = d.etapas.findIndex((p) => p.clave === d.etapa)
  const completo = d.estado === 'Completado'
  const pct = completo ? 100 : Math.round(((Math.max(idx, 0) + 0.5) / d.etapas.length) * 100)
  const Ic = ICONO[d.etapa] ?? Truck
  const actual = d.etapas[idx]
  const ultimaEnt = d.entregas[d.entregas.length - 1]
  const cancelado = d.estado === 'Cancelado'
  return (
    <>
      <section className="sg-card prim" aria-live="polite">
        <div className="sg-estado">
          <span className={'sg-icono' + (completo ? ' ok' : cancelado ? '' : ' anim')}><Ic size={26} /></span>
          <div><b>{cancelado ? 'Pedido cancelado' : completo ? (d.instalacion ? 'Pedido completado' : 'Pedido entregado') : actual?.nombre ?? 'En proceso'}</b>
            <span>{cancelado ? 'Escríbenos si tienes dudas.' : completo ? 'Gracias por confiar en nosotros.' : MENSAJE[d.etapa] ?? ''}</span></div>
        </div>
        {!cancelado && <><div className={'sg-barra' + (completo ? ' ok' : '')}><i style={{ width: pct + '%' }} /></div>
          <div className="sg-pct"><span>Paso {Math.min(idx + 1, d.etapas.length)} de {d.etapas.length}</span><span>{pct}%</span></div></>}
        <div className="sg-eta">
          {!completo && !cancelado && d.estimada && <div><small>{d.etapa === 'instalacion' ? 'Instalación estimada' : 'Entrega estimada'}</small><b>{fFecha(d.estimada)}</b></div>}
          {completo && d.completado && <div><small>{d.instalacion ? 'Completado' : 'Entregado'}</small><b>{fFecha(d.completado)}</b></div>}
          {ultimaEnt?.transportista && <div><small>Transporte</small><b>{ultimaEnt.transportista}{ultimaEnt.guia ? ' · ' + ultimaEnt.guia : ''}</b></div>}
          {ultimaEnt && !ultimaEnt.entregada && ultimaEnt.programada && <div><small>Entrega programada</small><b>{fFecha(ultimaEnt.programada)}{ultimaEnt.ventana ? ' · ' + ultimaEnt.ventana : ''}</b></div>}
        </div>
      </section>

      <section className="sg-card"><h2><MapPin size={17} />Recorrido de tu pedido</h2>
        <ol className="sg-pasos">{d.etapas.map((p, i) => {
          const P = ICONO[p.clave] ?? Truck, hecho = completo || i < idx || (i === idx && completo), act = !completo && i === idx
          return (
            <li key={p.clave} className={'sg-paso' + (hecho ? ' hecho' : '') + (act ? ' actual' : '')}>
              <span className="sg-punto"><P size={15} /></span>
              <div className="sg-paso-txt"><b>{p.nombre}</b><small>{act ? 'En curso' + (p.fecha ? ' desde ' + fHora(p.fecha) : '') : p.fecha ? fHora(p.fecha) : hecho ? 'Listo' : 'Pendiente'}</small></div>
            </li>)
        })}</ol>
      </section>

      {d.entregas.some((e) => e.estado === 'Entregada') && <section className="sg-card"><h2><CircleCheckBig size={17} />Entrega</h2>
        {d.entregas.filter((e) => e.estado === 'Entregada').map((e) => (
          <div key={e.numero} className="sg-ent">
            <p><b>{d.entregas.length > 1 ? 'Envío ' + e.numero + ' · ' : ''}Entregado {fHora(e.entregada)}</b></p>
            {e.recibio && <p>Recibió: {e.recibio}</p>}
            {e.fotos.length > 0 && <div className="sg-fotos">{e.fotos.map((u) => <button key={u} type="button" onClick={() => setZoom(u)} aria-label="Ver foto"><img src={u} alt="Foto de la entrega" loading="lazy" /></button>)}</div>}
          </div>))}
      </section>}

      {d.productos.length > 0 && <section className="sg-card"><h2><PackageCheck size={17} />Tu pedido</h2>
        <div className="sg-prods">{d.productos.map((p, i) => (
          <div key={i} className="sg-prod">{p.imagen ? <img src={imagen(p.imagen, 120)} alt="" loading="lazy" /> : <span className="sin" />}
            <div style={{ minWidth: 0 }}><b>{p.nombre}</b><span>Cantidad: {p.cantidad}</span></div></div>))}</div>
      </section>}

      <section className="sg-card">
        {d.asesor && <div className="sg-asesor"><span className="ava">{d.asesor.foto ? <img src={imagen(d.asesor.foto, 96)} alt="" /> : d.asesor.nombre.slice(0, 1)}</span>
          <div><small style={{ color: 'var(--muted)', fontSize: 12 }}>Tu asesor</small><b style={{ display: 'block' }}>{d.asesor.nombre}</b></div></div>}
        {d.asesor?.whatsapp && <a className="sg-btn wa" href={`https://wa.me/${d.asesor.whatsapp}?text=${encodeURIComponent(`Hola ${d.asesor.nombre.split(' ')[0]}, te escribo por mi pedido ${d.codigo}.`)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} />Escribir por WhatsApp</a>}
        {d.encuesta && <a className="sg-btn prim" href={`/encuesta/?c=${token}`}><Star size={18} />Califica tu experiencia</a>}
        <button type="button" className="sg-btn sec" onClick={compartir}><Share2 size={17} />Compartir este seguimiento</button>
      </section>

      {d.historial.length > 0 && <section className="sg-card"><details className="sg-detalles"><summary>Ver el historial completo ({d.historial.length})</summary>
        <ul className="sg-hist" style={{ marginTop: 10 }}>{[...d.historial].reverse().map((h, i) => <li key={i}><b>{h.titulo}</b>{h.detalle && <span> · {h.detalle}</span>}<small>{fHora(h.fecha)}</small></li>)}</ul>
      </details></section>}
    </>
  )
}

function Legado({ d }: { d: Legado }) {
  const e = d.entrega
  return (
    <section className="sg-card prim">
      <div className="sg-estado"><span className={'sg-icono' + (e?.estado === 'Entregada' ? ' ok' : ' anim')}>{e?.estado === 'Entregada' ? <CircleCheckBig size={26} /> : <Truck size={26} />}</span>
        <div><b>{e?.estado === 'Entregada' ? 'Pedido entregado' : e?.estado || d.despacho || 'En proceso'}</b><span>{d.guia ? 'Guía ' + d.guia : ''}</span></div></div>
      <div className="sg-eta">
        {e?.fecha_programada && e.estado !== 'Entregada' && <div><small>Entrega programada</small><b>{fFecha(e.fecha_programada)}</b></div>}
        {e?.fecha_entrega && <div><small>Entregado</small><b>{fHora(e.fecha_entrega)}</b></div>}
        {e?.transportista && <div><small>Transporte</small><b>{e.transportista}{e.guia_numero ? ' · ' + e.guia_numero : ''}</b></div>}
      </div>
    </section>
  )
}
