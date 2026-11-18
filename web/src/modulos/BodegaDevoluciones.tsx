import { useCallback, useEffect, useState } from 'react'
import { Package, PackageCheck, RefreshCw, Undo2, Wrench, XCircle } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { imagen } from './inventarioUtil'

/* Devoluciones por nota de crédito de productos que ya se habían despachado: Bodega revisa lo que volvió y decide
   a qué bodega va (Bodega Comercial si está bien, Bodega Técnica si tiene defecto) o registra que no se recibió. */
type Dev = { id: string; fecha: string; codigo: string; nombre: string; imagen: string | null; cantidad: number; recibido: number; operacion: string | null; factura: string | null; cliente: string | null; nota: string | null; motivo: string | null; registro: string | null }
type Destino = 'DISPONIBLE' | 'NO_DISPONIBLE' | 'NO_ENTREGADO'
const OPCIONES: { k: Destino; t: string; d: string; ic: typeof PackageCheck }[] = [
  { k: 'DISPONIBLE', t: 'Bodega Comercial', d: 'Llegó bien: vuelve a la venta', ic: PackageCheck },
  { k: 'NO_DISPONIBLE', t: 'Bodega Técnica', d: 'Tiene defecto: a Servicio Técnico', ic: Wrench },
  { k: 'NO_ENTREGADO', t: 'No se recibió', d: 'El cliente no lo devolvió', ic: XCircle },
]
const fCorta = (t: string) => { const d = new Date(t); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) }

export default function BodegaDevoluciones({ perfil, aviso, contar }: { perfil: Perfil; aviso: (t: string) => void; contar?: (n: number) => void }) {
  const [lista, setLista] = useState<Dev[] | null>(null)
  const [error, setError] = useState('')
  const [abierta, setAbierta] = useState<{ id: string; destino: Destino | ''; cantidad: string; obs: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const editar = puede(perfil, 'bodega', 'editar')

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('bod_devoluciones_pendientes')
    if (error) { setError(error.message); return }
    const l = (data as Dev[] | null) ?? []
    setError(''); setLista(l); contar?.(l.length)
  }, [contar])
  useEffect(() => { cargar() }, [cargar])

  async function verificar(d: Dev) {
    if (!abierta) return
    const pend = d.cantidad - d.recibido, n = Number(abierta.cantidad)
    if (!abierta.destino) { aviso('Elige a qué bodega va.'); return }
    if (!(n > 0) || !Number.isInteger(n) || n > pend) { aviso(`La cantidad debe ser un número entero entre 1 y ${pend}.`); return }
    if (!abierta.obs.trim()) { aviso('Escribe qué encontraste al revisarlo.'); return }
    setGuardando(true)
    const { error } = await supabase.rpc('nc_registrar_recepcion', { p_devolucion_id: d.id, p_cantidad: n, p_destino: abierta.destino, p_fecha: new Date().toISOString().slice(0, 10), p_observacion: abierta.obs.trim() })
    setGuardando(false)
    if (error) { aviso(error.message); return }
    aviso(abierta.destino === 'DISPONIBLE' ? `${n} u. a la Bodega Comercial` : abierta.destino === 'NO_DISPONIBLE' ? `${n} u. a la Bodega Técnica` : 'Registrado: no se recibió')
    setAbierta(null); cargar()
  }

  return (
    <section className="dv-lista">
      <div className="dv-intro">
        <Undo2 />
        <div className="min-w-0 flex-1"><b>Devoluciones por verificar</b><p>Productos devueltos con nota de crédito que ya se habían despachado. Revísalos y decide a qué bodega van: <b>Bodega Comercial</b> si están bien o <b>Bodega Técnica</b> si tienen defecto.</p></div>
        <button className="btn btn-sm" onClick={cargar} title="Actualizar"><RefreshCw /></button>
      </div>
      {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}
      {lista === null && !error && <div className="text-center py-14 text-slate-400"><span className="spin" /> Cargando…</div>}
      {lista && !lista.length && <div className="text-center py-14 text-slate-400"><PackageCheck className="mx-auto mb-2" style={{ width: 32, height: 32 }} /><p className="font-semibold">No hay devoluciones por verificar.</p></div>}
      {lista?.map((d) => {
        const pend = d.cantidad - d.recibido, ab = abierta?.id === d.id
        return (
          <div key={d.id} className={'dv-card' + (ab ? ' on' : '')}>
            <div className="flex gap-3 items-start">
              <span className="dv-th">{d.imagen ? <img loading="lazy" alt="" src={imagen(d.imagen, 120)} onError={(e) => e.currentTarget.remove()} /> : <Package />}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-800 text-[13.5px] leading-snug">{d.nombre}</p>
                <p className="text-[11px] text-slate-500"><span className="mono">{d.codigo}</span> · <b className="text-slate-700">{pend}</b> de {d.cantidad} u. por verificar</p>
                <p className="text-[11px] text-slate-500">{[d.cliente, d.factura ? 'Factura ' + d.factura : d.operacion, d.nota ? 'NC ' + d.nota : '', fCorta(d.fecha), d.registro ? 'registró ' + d.registro : ''].filter(Boolean).join(' · ')}</p>
                {d.motivo && <p className="text-[11px] text-slate-600 mt-0.5">Motivo: {d.motivo}</p>}
              </div>
              {editar && !ab && <button className="btn btn-sm btn-p shrink-0" onClick={() => setAbierta({ id: d.id, destino: '', cantidad: String(pend), obs: '' })}>Verificar</button>}
            </div>
            {ab && abierta && (
              <div className="dv-form">
                <div className="dv-ops">{OPCIONES.map((o) => { const I = o.ic; return (
                  <button key={o.k} type="button" className={'dv-op ' + o.k.toLowerCase() + (abierta.destino === o.k ? ' on' : '')} onClick={() => setAbierta({ ...abierta, destino: o.k })}><I /><span><b>{o.t}</b><small>{o.d}</small></span></button>) })}</div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <label className="text-[11px] font-semibold text-slate-500">Cantidad<input type="number" min={1} max={pend} step={1} className="inp w-full mt-1" value={abierta.cantidad} onChange={(e) => setAbierta({ ...abierta, cantidad: e.target.value })} /></label>
                  <label className="text-[11px] font-semibold text-slate-500 col-span-2">Qué encontraste al revisarlo *<input className="inp w-full mt-1" value={abierta.obs} onChange={(e) => setAbierta({ ...abierta, obs: e.target.value })} placeholder="Ej. completo, sin golpes / pantalla rota" /></label>
                </div>
                <div className="flex gap-2 justify-end mt-2"><button className="btn btn-sm" onClick={() => setAbierta(null)}>Cancelar</button><button className="btn btn-sm btn-p" disabled={guardando} onClick={() => verificar(d)}>{guardando ? 'Guardando…' : 'Guardar verificación'}</button></div>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
