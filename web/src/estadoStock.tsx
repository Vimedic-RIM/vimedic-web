import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/* Estado del stock por producto (inv_estado_stock = vmInvEstadoStock del original):
   unidades en revisión (llegaron a bodega y Bodega aún no aprueba), en reparación
   (Servicio Técnico) y por llegar (importaciones en camino). Lo usan Inventario,
   Ofertas, Promociones y el CRM (cotización / venta). Se guarda una copia en
   sessionStorage para que abrir otra pantalla no vuelva a esperar la consulta. */
export type EstadoStock = { revision: number; reparacion: number; porLlegar: number; eta?: string }

const CLAVE = 'vm_inv_estado_v1'
let enMemoria: { t: number; datos: Record<string, EstadoStock> } | null = null
let pendiente: Promise<Record<string, EstadoStock> | null> | null = null
const VIGENCIA = 5 * 60 * 1000

function leerCopia(): Record<string, EstadoStock> | null {
  if (enMemoria && Date.now() - enMemoria.t < VIGENCIA) return enMemoria.datos
  try {
    const c = JSON.parse(sessionStorage.getItem(CLAVE) || 'null') as { t: number; datos: Record<string, EstadoStock> } | null
    if (c && Date.now() - c.t < VIGENCIA) { enMemoria = c; return c.datos }
  } catch { /* sin almacenamiento */ }
  return null
}

export function cargarEstadoStock(): Promise<Record<string, EstadoStock> | null> {
  if (pendiente) return pendiente
  pendiente = (async () => {
    const { data, error } = await supabase.rpc('inv_estado_stock')
    pendiente = null
    if (error) return null
    const m = (data as { productos?: Record<string, Partial<EstadoStock>> } | null)?.productos ?? {}
    const datos = Object.fromEntries(Object.entries(m).map(([id, o]) => [id, {
      revision: Number(o.revision) || 0, reparacion: Number(o.reparacion) || 0, porLlegar: Number(o.porLlegar) || 0, eta: o.eta ? String(o.eta) : '',
    }]))
    enMemoria = { t: Date.now(), datos }
    try { sessionStorage.setItem(CLAVE, JSON.stringify(enMemoria)) } catch { /* sin almacenamiento */ }
    return datos
  })()
  return pendiente
}

export function useEstadoStock(): Record<string, EstadoStock> | null {
  const [est, setEst] = useState<Record<string, EstadoStock> | null>(() => leerCopia())
  useEffect(() => {
    let vivo = true
    if (!leerCopia()) cargarEstadoStock().then((d) => { if (vivo && d) setEst(d) })
    return () => { vivo = false }
  }, [])
  return est
}

export function ChipsStockProceso({ e }: { e?: EstadoStock }) {
  if (!e || (!e.revision && !e.reparacion && !e.porLlegar)) return null
  return (
    <>
      {e.revision > 0 && <span className="pill" title="Ya llegó a bodega y Bodega aún no lo aprueba" style={{ background: '#eef2ff', color: '#4338ca' }}>{e.revision} por revisar</span>}
      {e.reparacion > 0 && <span className="pill" title="En Servicio Técnico" style={{ background: '#fef3c7', color: '#92400e' }}>{e.reparacion} en reparación</span>}
      {e.porLlegar > 0 && <span className="pill" title="En camino de una importación" style={{ background: '#e0f2fe', color: '#075985' }}>{e.porLlegar} por llegar</span>}
    </>
  )
}

/* Etiquetas de la tarjeta de producto al cotizar / vender (versión 4 del original):
   "3 en stock · 2 en revisión · 1 en reparación · 4 por llegar"; stock negativo = facturado sin stock. */
export function EtiquetasStockCotizacion({ stock, e }: { stock: number | null; e?: EstadoStock }) {
  const st = Number(stock) || 0
  const base: React.CSSProperties = { fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap', lineHeight: 1.5, display: 'inline-flex' }
  return (
    <div className="flex flex-wrap gap-1">
      <span style={{ ...base, background: st > 0 ? '#e7f6f2' : '#fdecea', color: st > 0 ? '#04896f' : '#c0392b' }} title={st < 0 ? 'Se facturó más de lo que hay en bodega' : undefined}>
        {st > 0 ? `${st} en stock` : st < 0 ? `${st} en stock (facturado sin stock)` : 'Sin stock'}
      </span>
      {!!e?.revision && <span style={{ ...base, background: '#fef3c7', color: '#92400e' }}>{e.revision} en revisión</span>}
      {!!e?.reparacion && <span style={{ ...base, background: '#fee2e2', color: '#991b1b' }}>{e.reparacion} en reparación</span>}
      {!!e?.porLlegar && <span style={{ ...base, background: '#e0f2fe', color: '#075985' }}>{e.porLlegar} por llegar</span>}
    </div>
  )
}

/* Marco y franja de la tarjeta: en revisión (ámbar) o por llegar (celeste). */
export function marcoStock(e?: EstadoStock): React.CSSProperties | undefined {
  if (!e) return undefined
  if (e.revision) return { border: '2px solid #f59e0b', boxShadow: '0 0 0 3px rgba(245,158,11,.15)' }
  if (e.porLlegar) return { border: '2px solid #38bdf8' }
  return undefined
}
export function FranjaStock({ e }: { e?: EstadoStock }) {
  if (!e || (!e.revision && !e.porLlegar)) return null
  const f = (s?: string) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '')
  const estilo: React.CSSProperties = { fontSize: 9, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', textAlign: 'center', padding: '3px 4px', color: '#fff' }
  if (e.revision) return <div style={{ ...estilo, background: '#f59e0b' }}>En revisión{e.porLlegar ? ` · +${e.porLlegar} por llegar` : ''}</div>
  return <div style={{ ...estilo, background: '#0284c7' }}>Por llegar {e.porLlegar}{e.eta ? ' · ' + f(e.eta) : ''}</div>
}
