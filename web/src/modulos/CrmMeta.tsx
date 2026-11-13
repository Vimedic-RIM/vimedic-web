import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Megaphone, RefreshCw, Search, TriangleAlert, X } from 'lucide-react'
import { supabase } from '../supabase'

/* =====================================================================
   CRM — Reparto de clientes potenciales de Meta (vmLeadsMetaPanel /
   vmLeadsMetaAsignar de LeadsMeta.gs) y datos de la empresa para la guía
   de envío (fmGuardarConfig de Femedics.gs).
   ===================================================================== */

type Asesor = { id: string; nombre: string; email: string | null; conTelefono: boolean; n30: number; ultimo: string | null; siguiente: boolean }
type Fila = { id: string; codigo: string | null; fecha: string; nombre: string | null; telefono: string | null; ciudad: string | null; estado_crm: string; asesor_id: string | null; asesor: string | null; asignado_en: string | null; asignacion: string | null; anuncio: string | null; red: string }
type Panel = { siguiente: string | null; reparto: Asesor[]; fueraDelReparto: { id: string; nombre: string; n30: number }[]; sinAsignar: number; historial: Fila[] }

const fecha = (s: string | null) => (s ? new Date(s).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const iniciales = (n: string) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase() || '?'
const MOTIVO: Record<string, string> = { reparto: 'Reparto justo', manual: 'Asignado a mano', 'cliente existente': 'Ya era su cliente' }

function Ventana({ titulo, sub, icono: Icono, ancho, cerrar, children, pie }: { titulo: string; sub: string; icono: typeof Megaphone; ancho: number; cerrar: () => void; children: React.ReactNode; pie?: React.ReactNode }) {
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', f); return () => document.removeEventListener('keydown', f) }, [cerrar])
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="ns-shell nq-theme bg-slate-50 sm:rounded-3xl shadow-2xl w-full h-[100dvh] sm:h-auto sm:max-h-[92vh] flex flex-col overflow-hidden" style={{ maxWidth: ancho }} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="ns-head shrink-0 px-5 pt-4 pb-3 text-white">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl grid place-items-center bg-white/15 shrink-0"><Icono className="w-5 h-5" /></span>
            <div className="min-w-0"><h3 className="font-display font-bold text-base leading-tight">{titulo}</h3><p className="text-[11px] text-white/70">{sub}</p></div>
            <button onClick={cerrar} className="ml-auto w-9 h-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 shrink-0" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">{children}</div>
        {pie && <div className="shrink-0 px-4 py-3 border-t border-slate-200 bg-white flex items-center gap-3">{pie}</div>}
      </div>
    </div>
  )
}

export function RepartoMeta({ empresa, cerrar, aviso, cambio }: { empresa: 'VIMEDIC' | 'FEMEDICS'; cerrar: () => void; aviso: (t: string) => void; cambio: () => void }) {
  const [p, setP] = useState<Panel | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [soloSin, setSoloSin] = useState(false)
  const [eleccion, setEleccion] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState('')
  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('crm_meta_panel', { p_empresa: empresa })
    if (e) { setError(e.message); return }
    setError(''); setP(data as Panel)
  }, [empresa])
  useEffect(() => { cargar() }, [cargar])

  const historial = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (p?.historial ?? []).filter((x) => (!soloSin || !x.asesor_id) && (!t || [x.nombre, x.asesor, x.ciudad, x.codigo, x.telefono].join(' ').toLowerCase().includes(t)))
  }, [p, q, soloSin])
  const siguiente = p?.reparto.find((a) => a.siguiente)

  async function asignar(f: Fila) {
    const id = eleccion[f.id]
    if (!id) { aviso('Elige el asesor.'); return }
    const nombre = p?.reparto.find((a) => a.id === id)?.nombre ?? ''
    if (!confirm(`¿Asignar a ${f.nombre || 'este cliente'} a ${nombre}? Le llegará el aviso con los datos.`)) return
    setOcupado(f.id)
    const { error: e } = await supabase.rpc('crm_meta_asignar', { p_lead: f.id, p_asesor: id })
    setOcupado('')
    if (e) { aviso(e.message); return }
    aviso((f.asesor_id ? 'Reasignado a ' : 'Asignado a ') + nombre + '.')
    setEleccion((x) => { const y = { ...x }; delete y[f.id]; return y })
    cargar(); cambio()
  }

  return (
    <Ventana titulo="Clientes potenciales de Meta" sub="Reparto justo de los formularios de Facebook e Instagram." icono={Megaphone} ancho={860} cerrar={cerrar}
      pie={<><p className="text-[11px] text-slate-500 flex-1">Le toca a quien menos recibió en 30 días; si empatan, a quien lleva más tiempo sin recibir. Si el cliente ya era de un asesor, vuelve a él y no cuenta como turno.</p>
        <button onClick={cargar} className="shrink-0 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white flex items-center gap-1.5 text-slate-600"><RefreshCw className="w-3.5 h-3.5" />Actualizar</button></>}>
      {error && <div className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
      {!p && !error && <p className="text-xs text-slate-400 text-center py-8">Cargando el reparto…</p>}
      {p && (
        <>
          {siguiente ? (
            <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl p-3">
              <span className="w-10 h-10 rounded-full grid place-items-center text-white font-bold text-sm shrink-0" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>{iniciales(siguiente.nombre)}</span>
              <div className="min-w-0"><p className="text-[10px] font-bold uppercase text-slate-400">Le toca el próximo cliente potencial</p><p className="font-display font-bold text-sm text-slate-800 truncate">{siguiente.nombre}</p></div>
            </div>
          ) : (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs" style={{ color: '#78350f' }}>
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" /><div><b>Nadie en el reparto.</b> Activa "Recibe clientes potenciales de Meta" en Empleados. Mientras tanto los nuevos quedan sin asignar.</div>
            </div>
          )}
          {p.sinAsignar > 0 && (
            <button type="button" onClick={() => setSoloSin(true)} className="w-full text-left flex items-center gap-2 bg-red-50 border border-red-200 rounded-2xl px-3 py-2.5 text-xs" style={{ color: '#991b1b' }}>
              <TriangleAlert className="w-4 h-4 shrink-0" /><span><b>{p.sinAsignar} cliente(s) sin asignar.</b> Toca aquí para verlos y asignarlos.</span>
            </button>
          )}

          <section className="ns-sec">
            <p className="ns-label">Orden del reparto (quienes tienen el permiso)</p>
            {p.reparto.length === 0 && <p className="text-[11px] text-slate-500">Nadie tiene el permiso todavía.</p>}
            <div className="space-y-1.5">
              {p.reparto.map((a, i) => (
                <div key={a.id} className="flex items-center gap-2.5 rounded-xl border px-3 py-2" style={{ borderColor: a.siguiente ? 'var(--acc)' : '#e2e8f0', background: a.siguiente ? 'var(--acc-l)' : '#fff' }}>
                  <span className="text-[10px] font-bold text-slate-400 w-4 shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 truncate">{a.nombre}{!a.conTelefono && <span className="pill ml-1.5" style={{ background: '#fef3c7', color: '#92400e' }} title="Sin celular en Empleados">sin celular</span>}</p>
                    <p className="text-[10px] text-slate-400 truncate">{a.email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-slate-700">{a.n30} <span className="font-normal text-slate-400">en 30 días</span></p>
                    <p className="text-[10px] text-slate-400">último: {fecha(a.ultimo)}</p>
                  </div>
                </div>
              ))}
            </div>
            {p.fueraDelReparto.length > 0 && <p className="text-[10.5px] text-slate-500 mt-2">Recibieron clientes en 30 días pero <b>ya no tienen el permiso</b>: {p.fueraDelReparto.map((x) => `${x.nombre} (${x.n30})`).join(', ')}. Puedes reasignar sus clientes abajo.</p>}
          </section>

          <section className="ns-sec">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <p className="ns-label !mb-0 mr-auto">Historial de asignaciones</p>
              <button type="button" onClick={() => setSoloSin((v) => !v)} className={'ns-chip' + (soloSin ? ' active' : '')}>Sin asignar ({p.sinAsignar})</button>
            </div>
            <div className="relative mb-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, asesor, ciudad o código…" className="ns-input pl-9" />
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            <div className="space-y-1.5">
              {historial.length === 0 && <p className="text-[11px] text-slate-400 text-center py-4">Sin registros.</p>}
              {historial.slice(0, 150).map((x) => (
                <div key={x.id} className="bg-white border border-slate-200 rounded-xl px-3 py-2 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
                    <p className="text-xs font-bold text-slate-800 truncate">{x.nombre || '—'}</p>
                    <p className="text-[10px] text-slate-500 truncate">{[x.telefono, x.red, x.ciudad, fecha(x.fecha)].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="shrink-0 text-right" style={{ minWidth: 120 }}>
                    {x.asesor_id ? <p className="text-[11px] font-semibold text-slate-700">{x.asesor}</p> : <span className="pill" style={{ background: '#fdecea', color: '#c0392b' }}>Sin asignar</span>}
                    <p className="text-[10px] text-slate-400">{x.asignacion ? MOTIVO[x.asignacion] ?? x.asignacion : ''}{x.asignado_en ? ' · ' + fecha(x.asignado_en) : ''}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <select value={eleccion[x.id] ?? ''} onChange={(e) => setEleccion({ ...eleccion, [x.id]: e.target.value })} className="ns-input" style={{ width: 150, padding: '6px 8px', fontSize: 11 }}>
                      <option value="">Elegir asesor…</option>
                      {p.reparto.map((a) => <option key={a.id} value={a.id} disabled={a.id === x.asesor_id}>{a.nombre}</option>)}
                    </select>
                    <button type="button" disabled={ocupado === x.id} onClick={() => asignar(x)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-60" style={{ background: 'var(--acc)' }}>{ocupado === x.id ? '…' : x.asesor_id ? 'Reasignar' : 'Asignar'}</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </Ventana>
  )
}

/* ============================ Datos de la empresa (remitente de la guía) ============================ */
export type DatosEmpresa = { razon_social: string; ruc: string | null; telefono: string | null }
export async function leerDatosEmpresa(empresa: string): Promise<DatosEmpresa | null> {
  const { data } = await supabase.from('empresa_datos').select('razon_social,ruc,telefono').eq('empresa', empresa).is('deleted_at', null).maybeSingle()
  return (data as DatosEmpresa | null) ?? null
}

export function EditorDatosEmpresa({ empresa, cerrar, aviso }: { empresa: 'VIMEDIC' | 'FEMEDICS'; cerrar: () => void; aviso: (t: string) => void }) {
  const [d, setD] = useState({ razon: '', ruc: '', telefono: '' })
  const [cargado, setCargado] = useState(false)
  const [guardando, setGuardando] = useState(false)
  useEffect(() => { leerDatosEmpresa(empresa).then((x) => { if (x) setD({ razon: x.razon_social, ruc: x.ruc ?? '', telefono: x.telefono ?? '' }); setCargado(true) }) }, [empresa])
  async function guardar() {
    setGuardando(true)
    const { error } = await supabase.rpc('empresa_guardar_datos', { p_empresa: empresa, p_razon_social: d.razon, p_ruc: d.ruc, p_telefono: d.telefono })
    setGuardando(false)
    if (error) { aviso(error.message); return }
    aviso('Datos de ' + empresa + ' guardados.'); cerrar()
  }
  return (
    <Ventana titulo={'Datos de ' + empresa} sub="Remitente de la guía de envío en las ventas." icono={Building2} ancho={440} cerrar={cerrar}
      pie={<><p className="text-[11px] text-slate-500 flex-1">Se usan al registrar una venta con envío.</p><button onClick={guardar} disabled={guardando || !cargado} className="ns-submit !w-auto px-6">{guardando ? 'Guardando…' : 'Guardar'}</button></>}>
      <section className="ns-sec space-y-2">
        <label className="block"><span className="ns-label">Razón social *</span><input value={d.razon} onChange={(e) => setD({ ...d, razon: e.target.value })} className="ns-input" maxLength={200} /></label>
        <label className="block"><span className="ns-label">RUC</span><input value={d.ruc} onChange={(e) => setD({ ...d, ruc: e.target.value.replace(/\D/g, '') })} inputMode="numeric" className="ns-input" maxLength={13} /></label>
        <label className="block"><span className="ns-label">Teléfono</span><input value={d.telefono} onChange={(e) => setD({ ...d, telefono: e.target.value })} className="ns-input" maxLength={40} /></label>
      </section>
    </Ventana>
  )
}
