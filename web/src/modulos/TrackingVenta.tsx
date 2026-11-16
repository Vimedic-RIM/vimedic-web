import { useEffect, useState } from 'react'
import { Copy, ExternalLink, MapPinned, MessageCircle } from 'lucide-react'
import { supabase } from '../supabase'

/* Enlace de seguimiento del pedido (Issue #38): se crea solo cuando la venta llega a Facturación.
   Lo usan el detalle de la venta en el CRM y el módulo Trackings. */
export const NOMBRE_ETAPA: Record<string, string> = {
  venta: 'Venta confirmada', facturar: 'Enviada a facturar', facturada: 'Facturada', preparacion: 'En preparación', lista: 'Lista para despacho',
  despachada: 'Despachada', en_ruta: 'En camino', entregada: 'Entregada', instalacion: 'Instalación / capacitación',
}
export const enlaceSeguimiento = (token: string) => window.location.origin + '/seguimiento/?c=' + token
/** Mensaje listo para pegar en WhatsApp o correo: dice qué es el enlace y para qué sirve. */
export function mensajeSeguimiento(cliente: string, codigo: string, token: string, empresa = 'VIMEDIC') {
  const nombre = String(cliente || '').trim().split(/\s+/)[0]
  return `Hola${nombre ? ' ' + nombre : ''}, gracias por tu compra en ${empresa === 'FEMEDICS' ? 'FEMEDICS' : 'VIMEDIC'}. ` +
    `En este enlace puedes ver en tiempo real cómo avanza tu pedido ${codigo}: facturación, preparación en bodega, envío y entrega. ` +
    `Es el mismo seguimiento del código QR que llega con tu guía.\n${enlaceSeguimiento(token)}`
}
const telWa = (t: string) => { const n = String(t || '').replace(/\D/g, ''); return n ? (n.startsWith('0') ? '593' + n.slice(1) : n) : '' }

export function SeguimientoVenta({ cotizacionId, cliente, telefono, aviso }: { cotizacionId: string; cliente: string; telefono?: string; aviso: (t: string) => void }) {
  const [p, setP] = useState<{ codigo: string; token: string; etapa: string; estado: string; empresa: string; fecha_estimada: string | null } | null | undefined>(undefined)
  useEffect(() => {
    supabase.from('pedidos_seguimiento').select('codigo,token,etapa,estado,empresa,fecha_estimada').eq('cotizacion_id', cotizacionId).is('deleted_at', null).maybeSingle()
      .then(({ data }) => setP((data as never) ?? null))
  }, [cotizacionId])
  if (p === undefined) return null
  if (!p) return <p className="text-[11px] text-slate-400 text-center">El enlace de seguimiento del pedido aparece cuando la venta llega a Facturación.</p>
  const link = enlaceSeguimiento(p.token), msg = mensajeSeguimiento(cliente, p.codigo, p.token, p.empresa), wa = telWa(telefono ?? '')
  const copiar = (t: string, ok: string) => navigator.clipboard?.writeText(t).then(() => aviso(ok), () => aviso(t))
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: '#bfe3ea', background: '#f0fbfc' }}>
      <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: '#0e7490' }}><MapPinned className="w-4 h-4" />Seguimiento del pedido · {p.codigo}</p>
      <p className="text-[11px] text-slate-600 mt-1">Estado: <b>{p.estado === 'En curso' ? NOMBRE_ETAPA[p.etapa] ?? p.etapa : p.estado}</b>{p.fecha_estimada && p.estado === 'En curso' ? ' · entrega estimada ' + new Date(p.fecha_estimada + 'T12:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short' }) : ''}</p>
      <div className="grid grid-cols-2 gap-1.5 mt-2">
        <button type="button" className="text-xs font-bold py-2 rounded-lg text-white flex items-center justify-center gap-1.5" style={{ background: '#0e7490' }} onClick={() => copiar(msg, 'Mensaje copiado: pégalo en el chat del cliente.')}><Copy className="w-3.5 h-3.5" />Copiar mensaje</button>
        <button type="button" className="text-xs font-bold py-2 rounded-lg border bg-white flex items-center justify-center gap-1.5" style={{ borderColor: '#bfe3ea', color: '#0e7490' }} onClick={() => copiar(link, 'Enlace copiado.')}><Copy className="w-3.5 h-3.5" />Copiar enlace</button>
        {wa && <a className="text-xs font-bold py-2 rounded-lg text-white flex items-center justify-center gap-1.5" style={{ background: '#25d366' }} href={`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="w-3.5 h-3.5" />Enviar por WhatsApp</a>}
        <a className={'text-xs font-bold py-2 rounded-lg border bg-white flex items-center justify-center gap-1.5' + (wa ? '' : ' col-span-2')} style={{ borderColor: '#bfe3ea', color: '#0e7490' }} href={link} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5" />Ver como cliente</a>
      </div>
    </div>
  )
}
