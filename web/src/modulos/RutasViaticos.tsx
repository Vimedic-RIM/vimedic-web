import { useCallback, useEffect, useState } from 'react'
import { Check, MapPin, Plus, Route, Trash2, Wallet, X, XCircle } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'

/* Rutas_viaticos.gs: rutas de visita a clientes y solicitudes de viáticos de los asesores.
   rutas/viaticos son editables por "crm" (y viaticos también por "financiero", que las aprueba),
   según su RLS — ningún RPC con privilegios propios hace falta aquí. */

type ClienteRuta = { clienteId: string; nombre: string; ciudad: string; fecha: string }
type Ruta = { id: string; codigo: string; nombre: string; fecha_inicio: string | null; fecha_fin: string | null; clientes: ClienteRuta[]; estado: string; asesor: { nombre: string } | null; created_at: string }
type Destino = { lugar: string; transporte: string; dias: string }
type Gasto = { categoria: string; dias: string; frecuencia: string; costoUnitario: string }
type Viatico = { id: string; codigo: string; motivos: string; destinos: Destino[]; gastos: Gasto[]; monto_total: number | null; estado: string; ruta_id: string | null; aprobado_por: string | null; fecha_resolucion: string | null; created_at: string; asesor: { nombre: string } | null }
const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function RutasViaticos({ perfil, cerrar, aviso }: { perfil: Perfil; cerrar: () => void; aviso: (t: string) => void }) {
  const [tab, setTab] = useState<'rutas' | 'viaticos'>('rutas')
  const [rutas, setRutas] = useState<Ruta[] | null>(null)
  const [viaticos, setViaticos] = useState<Viatico[] | null>(null)
  const [nuevaRuta, setNuevaRuta] = useState(false)
  const [nuevoViatico, setNuevoViatico] = useState(false)
  const puedeAprobar = puede(perfil, 'financiero', 'editar')

  const cargarRutas = useCallback(() => {
    supabase.from('rutas').select('id,codigo,nombre,fecha_inicio,fecha_fin,clientes,estado,created_at,asesor:empleados!rutas_asesor_id_fkey(nombre)').is('deleted_at', null).order('created_at', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) aviso(error.message); else setRutas((data as unknown as Ruta[]) ?? []) })
  }, [aviso])
  const cargarViaticos = useCallback(() => {
    supabase.from('viaticos').select('id,codigo,motivos,destinos,gastos,monto_total,estado,ruta_id,aprobado_por,fecha_resolucion,created_at,asesor:empleados!viaticos_asesor_id_fkey(nombre)').is('deleted_at', null).order('created_at', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) aviso(error.message); else setViaticos((data as unknown as Viatico[]) ?? []) })
  }, [aviso])
  useEffect(() => { cargarRutas(); cargarViaticos() }, [cargarRutas, cargarViaticos])

  async function resolverViatico(id: string, estado: 'Aprobado' | 'Rechazado') {
    const { error } = await supabase.from('viaticos').update({ estado, aprobado_por: perfil.id, fecha_resolucion: new Date().toISOString() }).eq('id', id)
    if (error) { aviso('No se pudo actualizar: ' + error.message); return }
    aviso('Viático ' + estado.toLowerCase() + '.'); cargarViaticos()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-3xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={() => setTab('rutas')} className={'text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 ' + (tab === 'rutas' ? 'bg-slate-800 text-white' : 'text-slate-500')}><Route className="w-3.5 h-3.5" />Rutas</button>
            <button onClick={() => setTab('viaticos')} className={'text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 ' + (tab === 'viaticos' ? 'bg-slate-800 text-white' : 'text-slate-500')}><Wallet className="w-3.5 h-3.5" />Viáticos</button>
          </div>
          <button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'rutas' && (
            <div className="space-y-2.5">
              <button onClick={() => setNuevaRuta(true)} className="btn btn-primary mb-2"><Plus className="w-4 h-4" />Nueva ruta</button>
              {!rutas && <p className="text-xs text-slate-400">Cargando…</p>}
              {rutas && !rutas.length && <div className="card p-8 text-center text-xs text-slate-400">Todavía no hay rutas registradas.</div>}
              {rutas?.map((r) => (
                <article key={r.id} className="card p-4">
                  <div className="flex items-center gap-2 flex-wrap"><b className="text-sm text-slate-800">{r.nombre}</b><span className="pill">{r.estado}</span><span className="text-[10px] text-slate-400 ml-auto">{r.codigo} · {r.asesor?.nombre ?? '—'}</span></div>
                  <p className="text-[11px] text-slate-500 mt-1">{r.fecha_inicio ?? '—'} → {r.fecha_fin ?? '—'} · {r.clientes.length} cliente{r.clientes.length === 1 ? '' : 's'}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">{r.clientes.map((c, i) => <span key={i} className="pill" style={{ background: '#eff6ff', color: '#055c9d' }}><MapPin className="w-2.5 h-2.5 inline -mt-0.5" /> {c.nombre}{c.ciudad ? ' · ' + c.ciudad : ''}{c.fecha ? ' · ' + c.fecha : ''}</span>)}</div>
                </article>
              ))}
            </div>
          )}
          {tab === 'viaticos' && (
            <div className="space-y-2.5">
              <button onClick={() => setNuevoViatico(true)} className="btn btn-primary mb-2"><Plus className="w-4 h-4" />Nueva solicitud</button>
              {!viaticos && <p className="text-xs text-slate-400">Cargando…</p>}
              {viaticos && !viaticos.length && <div className="card p-8 text-center text-xs text-slate-400">Todavía no hay solicitudes de viáticos.</div>}
              {viaticos?.map((v) => (
                <article key={v.id} className="card p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <b className="text-sm text-slate-800">{v.asesor?.nombre ?? '—'}</b>
                    <span className="pill" style={v.estado === 'Aprobado' ? { background: '#ecfaf5', color: '#04896f' } : v.estado === 'Rechazado' ? { background: '#fdecea', color: '#c0392b' } : { background: '#fff8eb', color: '#a16207' }}>{v.estado}</span>
                    <b className="ml-auto text-sm text-slate-700">{money(v.monto_total ?? 0)}</b>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{v.codigo} · {new Date(v.created_at).toLocaleDateString('es-EC')}</p>
                  <p className="text-xs text-slate-600 mt-1.5">{v.motivos}</p>
                  {v.estado === 'Pendiente' && puedeAprobar && (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => resolverViatico(v.id, 'Rechazado')} className="btn flex-1 justify-center" style={{ color: '#b91c1c', borderColor: '#fecaca' }}><XCircle className="w-4 h-4" />Rechazar</button>
                      <button onClick={() => resolverViatico(v.id, 'Aprobado')} className="btn btn-primary flex-1 justify-center"><Check className="w-4 h-4" />Aprobar</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
      {nuevaRuta && <NuevaRuta perfil={perfil} cerrar={() => setNuevaRuta(false)} creado={() => { setNuevaRuta(false); cargarRutas(); aviso('Ruta creada.') }} aviso={aviso} />}
      {nuevoViatico && <NuevoViatico perfil={perfil} rutas={rutas ?? []} cerrar={() => setNuevoViatico(false)} creado={() => { setNuevoViatico(false); cargarViaticos(); aviso('Solicitud de viáticos enviada.') }} aviso={aviso} />}
    </div>
  )
}

function NuevaRuta({ perfil, cerrar, creado, aviso }: { perfil: Perfil; cerrar: () => void; creado: () => void; aviso: (t: string) => void }) {
  const [nombre, setNombre] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [clientes, setClientes] = useState<ClienteRuta[]>([])
  const [busqueda, setBusqueda] = useState<{ texto: string; res: { id: string; nombre: string }[] } | null>(null)
  const [guardando, setGuardando] = useState(false)

  function buscar(texto: string) {
    setBusqueda({ texto, res: [] })
    if (texto.trim().length < 2) return
    supabase.from('clientes').select('id,nombre').ilike('nombre', `%${texto.trim()}%`).is('deleted_at', null).limit(8)
      .then(({ data }) => setBusqueda((b) => (b ? { ...b, res: (data as { id: string; nombre: string }[]) ?? [] } : b)))
  }
  function elegir(c: { id: string; nombre: string }) {
    setClientes((a) => [...a, { clienteId: c.id, nombre: c.nombre, ciudad: '', fecha: '' }])
    setBusqueda(null)
  }
  function quitar(i: number) { setClientes((a) => a.filter((_, k) => k !== i)) }
  function set(i: number, campo: 'ciudad' | 'fecha', v: string) { setClientes((a) => a.map((x, k) => (k === i ? { ...x, [campo]: v } : x))) }

  async function guardar() {
    if (!clientes.length) { aviso('Agrega al menos un cliente a la ruta.'); return }
    setGuardando(true)
    const { error } = await supabase.from('rutas').insert({
      id: crypto.randomUUID(), codigo: 'RUT-' + Math.floor(1000 + Math.random() * 9000), nombre: nombre.trim() || 'Ruta ' + new Date().toLocaleDateString('es-EC'),
      asesor_id: perfil.id, fecha_inicio: fechaInicio || null, fecha_fin: fechaFin || null, clientes, estado: 'Planificada', ultima_actividad: new Date().toISOString(),
    })
    setGuardando(false)
    if (error) { aviso('No se pudo crear la ruta: ' + error.message); return }
    creado()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-[80] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[86vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100"><h3 className="font-display font-bold text-sm text-slate-800">Nueva ruta de visitas</h3><button onClick={cerrar} aria-label="Cerrar"><X className="w-4 h-4 text-slate-400" /></button></div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <label className="block text-[11px] font-bold text-slate-500">Nombre de la ruta<input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} className="inp w-full mt-1" placeholder="Ej. Visitas Guayaquil semana 1" /></label>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-[11px] font-bold text-slate-500">Fecha inicio<input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className="inp w-full mt-1" /></label>
            <label className="block text-[11px] font-bold text-slate-500">Fecha fin<input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} className="inp w-full mt-1" /></label>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 mb-1.5">Clientes a visitar *</p>
            <div className="relative">
              <input type="text" value={busqueda?.texto ?? ''} onChange={(e) => buscar(e.target.value)} placeholder="Buscar cliente por nombre" className="inp w-full" />
              {busqueda && busqueda.res.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
                  {busqueda.res.map((c) => <button key={c.id} type="button" onClick={() => elegir(c)} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50">{c.nombre}</button>)}
                </div>
              )}
            </div>
            <div className="space-y-2 mt-2">
              {clientes.map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <b className="text-xs flex-1 truncate">{c.nombre}</b>
                  <input type="text" value={c.ciudad} onChange={(e) => set(i, 'ciudad', e.target.value)} placeholder="Ciudad" className="inp w-28" />
                  <input type="date" value={c.fecha} onChange={(e) => set(i, 'fecha', e.target.value)} className="inp w-36" />
                  <button type="button" onClick={() => quitar(i)} className="w-8 h-8 rounded-lg border border-red-200 text-red-600 flex items-center justify-center shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-slate-100 p-4"><button onClick={guardar} disabled={guardando} className="btn btn-primary w-full justify-center">{guardando ? 'Guardando…' : 'Crear ruta'}</button></div>
      </div>
    </div>
  )
}

function NuevoViatico({ perfil, rutas, cerrar, creado, aviso }: { perfil: Perfil; rutas: Ruta[]; cerrar: () => void; creado: () => void; aviso: (t: string) => void }) {
  const [departamento, setDepartamento] = useState('')
  const [local, setLocal] = useState('')
  const [apellidos, setApellidos] = useState('')
  const [nombres, setNombres] = useState('')
  const [cedula, setCedula] = useState('')
  const [motivos, setMotivos] = useState('')
  const [rutaId, setRutaId] = useState('')
  const [destinos, setDestinos] = useState<Destino[]>([{ lugar: '', transporte: '', dias: '' }])
  const [gastos, setGastos] = useState<Gasto[]>([{ categoria: '', dias: '', frecuencia: '1', costoUnitario: '' }])
  const [guardando, setGuardando] = useState(false)

  const monto = gastos.reduce((s, g) => s + (Number(g.dias) || 0) * (Number(g.frecuencia) || 0) * (Number(g.costoUnitario) || 0), 0)

  async function guardar() {
    if (motivos.trim().length < 10) { aviso('El motivo del viaje es obligatorio y debe ser detallado (mínimo 10 caracteres).'); return }
    if (!destinos.some((d) => d.lugar.trim())) { aviso('Agrega al menos un destino.'); return }
    setGuardando(true)
    const { error } = await supabase.from('viaticos').insert({
      id: crypto.randomUUID(), codigo: 'VTC-' + Math.floor(1000 + Math.random() * 9000), asesor_id: perfil.id, departamento: departamento.trim() || null, local: local.trim() || null,
      apellidos: apellidos.trim() || null, nombres: nombres.trim() || null, cedula: cedula.trim() || null, motivos: motivos.trim(), ruta_id: rutaId || null,
      destinos, gastos, monto_total: Math.round(monto * 100) / 100, estado: 'Pendiente',
    })
    setGuardando(false)
    if (error) { aviso('No se pudo enviar la solicitud: ' + error.message); return }
    creado()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-[80] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[86vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100"><h3 className="font-display font-bold text-sm text-slate-800">Solicitud de fondos para viáticos</h3><button onClick={cerrar} aria-label="Cerrar"><X className="w-4 h-4 text-slate-400" /></button></div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-[11px] font-bold text-slate-500">Departamento<input type="text" value={departamento} onChange={(e) => setDepartamento(e.target.value)} className="inp w-full mt-1" /></label>
            <label className="block text-[11px] font-bold text-slate-500">Local<input type="text" value={local} onChange={(e) => setLocal(e.target.value)} className="inp w-full mt-1" /></label>
            <label className="block text-[11px] font-bold text-slate-500">Apellidos<input type="text" value={apellidos} onChange={(e) => setApellidos(e.target.value)} className="inp w-full mt-1" /></label>
            <label className="block text-[11px] font-bold text-slate-500">Nombres<input type="text" value={nombres} onChange={(e) => setNombres(e.target.value)} className="inp w-full mt-1" /></label>
            <label className="block text-[11px] font-bold text-slate-500">Cédula<input type="text" value={cedula} onChange={(e) => setCedula(e.target.value)} className="inp w-full mt-1" /></label>
            <label className="block text-[11px] font-bold text-slate-500">Ruta asociada (opcional)
              <select value={rutaId} onChange={(e) => setRutaId(e.target.value)} className="inp w-full mt-1"><option value="">Ninguna</option>{rutas.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></label>
          </div>
          <label className="block text-[11px] font-bold text-slate-500">Motivo del viaje * (mínimo 10 caracteres)
            <textarea rows={2} value={motivos} onChange={(e) => setMotivos(e.target.value)} className="inp w-full mt-1" /></label>
          <div>
            <p className="text-[11px] font-bold text-slate-500 mb-1.5">Destinos *</p>
            {destinos.map((d, i) => (
              <div key={i} className="flex gap-2 mb-1.5">
                <input type="text" value={d.lugar} onChange={(e) => setDestinos((a) => a.map((x, k) => (k === i ? { ...x, lugar: e.target.value } : x)))} placeholder="Lugar" className="inp flex-1" />
                <input type="text" value={d.transporte} onChange={(e) => setDestinos((a) => a.map((x, k) => (k === i ? { ...x, transporte: e.target.value } : x)))} placeholder="Transporte" className="inp w-28" />
                <input type="number" min="0" value={d.dias} onChange={(e) => setDestinos((a) => a.map((x, k) => (k === i ? { ...x, dias: e.target.value } : x)))} placeholder="Días" className="inp w-16" />
              </div>
            ))}
            <button type="button" onClick={() => setDestinos((a) => [...a, { lugar: '', transporte: '', dias: '' }])} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Agregar destino</button>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 mb-1.5">Gastos</p>
            {gastos.map((g, i) => (
              <div key={i} className="flex gap-2 mb-1.5">
                <input type="text" value={g.categoria} onChange={(e) => setGastos((a) => a.map((x, k) => (k === i ? { ...x, categoria: e.target.value } : x)))} placeholder="Categoría (ej. Hospedaje)" className="inp flex-1" />
                <input type="number" min="0" value={g.dias} onChange={(e) => setGastos((a) => a.map((x, k) => (k === i ? { ...x, dias: e.target.value } : x)))} placeholder="Días" className="inp w-16" />
                <input type="number" min="0" value={g.frecuencia} onChange={(e) => setGastos((a) => a.map((x, k) => (k === i ? { ...x, frecuencia: e.target.value } : x)))} placeholder="Frec." className="inp w-16" />
                <input type="number" min="0" step="0.01" value={g.costoUnitario} onChange={(e) => setGastos((a) => a.map((x, k) => (k === i ? { ...x, costoUnitario: e.target.value } : x)))} placeholder="Costo u." className="inp w-20" />
              </div>
            ))}
            <button type="button" onClick={() => setGastos((a) => [...a, { categoria: '', dias: '', frecuencia: '1', costoUnitario: '' }])} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Agregar gasto</button>
          </div>
          <p className="text-sm font-bold text-slate-700 text-right">Total estimado: {money(monto)}</p>
        </div>
        <div className="shrink-0 border-t border-slate-100 p-4"><button onClick={guardar} disabled={guardando} className="btn btn-primary w-full justify-center">{guardando ? 'Enviando…' : 'Enviar solicitud'}</button></div>
      </div>
    </div>
  )
}
