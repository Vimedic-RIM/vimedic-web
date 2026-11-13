import { useCallback, useEffect, useMemo, useState } from 'react'
import { Calendar, Plus, RefreshCw, Search, Trash2, User, type LucideIcon } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { agrupar } from '../tiempoReal'
import { puede } from '../permisos'
import { ConfirmarEliminar } from './CrmClientes'
import '../estilos/tablero.css'

/* Tablero común de registros (ModulosBase.gs): usado por Talento Humano y Financiero. */
const ESTADOS = ['Pendiente', 'En proceso', 'Completado', 'Cancelado']
const PRIORIDADES = ['Baja', 'Media', 'Alta', 'Urgente']
type Reg = { id: string; codigo: string; titulo: string; detalle: string; estado: string; prioridad: string; responsableId: string | null; responsable: string; compromiso: string; fecha: string; creadoPor: string; actualizadoPor: string; actualizado: string }
type Emp = { id: string; nombre: string }
const COLS = 'id,codigo,titulo,detalle,estado,prioridad,responsable_id,fecha_compromiso,fecha,created_at,updated_at,deleted_at,motivo_eliminacion,responsable:empleados!tareas_modulo_responsable_id_fkey(nombre),creador:empleados!tareas_modulo_creado_por_fkey(nombre),actualizador:empleados!tareas_modulo_actualizado_por_fkey(nombre)'
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const slug = (v: string) => norm(v).replace(/[^a-z0-9]/g, '')
const fFecha = (iso: string) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapear = (x: any): Reg => ({ id: x.id, codigo: x.codigo ?? '', titulo: x.titulo ?? '', detalle: x.detalle ?? '', estado: x.estado, prioridad: x.prioridad, responsableId: x.responsable_id, responsable: x.responsable?.nombre ?? '', compromiso: x.fecha_compromiso ?? '', fecha: x.fecha ?? x.created_at, creadoPor: x.creador?.nombre ?? '', actualizadoPor: x.actualizador?.nombre ?? '', actualizado: x.updated_at })

export default function Tablero({ perfil, aviso, modulo, titulo, desc, color, icono: Icono }: { perfil: Perfil; aviso: (t: string) => void; modulo: string; titulo: string; desc: string; color: string; icono: LucideIcon }) {
  const [regs, setRegs] = useState<Reg[] | null>(null)
  const [error, setError] = useState('')
  const [emps, setEmps] = useState<Emp[]>([])
  const [estado, setEstado] = useState('abiertos')
  const [q, setQ] = useState('')
  const [prio, setPrio] = useState('')
  const [resp, setResp] = useState('')
  const [edit, setEdit] = useState<Partial<Reg> | null>(null)
  const [papelera, setPapelera] = useState(false)
  const crear = puede(perfil, modulo, 'crear'), eliminar = puede(perfil, modulo, 'eliminar')

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('tareas_modulo').select(COLS).eq('modulo', modulo).is('deleted_at', null).order('fecha', { ascending: false }).limit(500)
    if (error) { setError(error.message); return }
    setError(''); setRegs((data ?? []).map(mapear))
  }, [modulo])
  useEffect(() => { setRegs(null); cargar() }, [cargar])
  useEffect(() => { supabase.from('empleados').select('id,nombre').is('deleted_at', null).eq('estado', 'activo').order('nombre').limit(300).then(({ data }) => setEmps((data as Emp[]) ?? [])) }, [])
  useEffect(() => {
    const recargar = agrupar(() => cargar())
    const c = supabase.channel('tab-' + modulo).on('postgres_changes', { event: '*', schema: 'public', table: 'tareas_modulo', filter: 'modulo=eq.' + modulo }, recargar).subscribe()
    return () => { recargar.cancelar(); supabase.removeChannel(c) }
  }, [modulo, cargar])

  const lista = regs ?? []
  const cuenta = (e: string) => lista.filter((r) => r.estado === e).length
  const abiertos = lista.filter((r) => r.estado === 'Pendiente' || r.estado === 'En proceso').length
  const kpis: [string, string, number][] = [['abiertos', 'Abiertos', abiertos], ['Pendiente', 'Pendientes', cuenta('Pendiente')], ['En proceso', 'En proceso', cuenta('En proceso')], ['Completado', 'Completados', cuenta('Completado')], ['', 'Todos', lista.length]]
  const responsables = useMemo(() => [...new Set(lista.map((r) => r.responsable).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [lista])
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const filtradas = lista.filter((r) => {
    if (estado === 'abiertos' && !(r.estado === 'Pendiente' || r.estado === 'En proceso')) return false
    if (estado && estado !== 'abiertos' && r.estado !== estado) return false
    if (prio && r.prioridad !== prio) return false
    if (resp && r.responsable !== resp) return false
    const w = norm(q).trim().split(/\s+/).filter(Boolean)
    if (w.length) { const t = norm([r.codigo, r.titulo, r.detalle, r.responsable, r.creadoPor].join(' ')); if (!w.every((x) => t.includes(x))) return false }
    return true
  })

  return (
    <div className="vm-tab" style={{ ['--acc' as string]: color }}>
      <header className="hdr text-white">
        <div className="max-w-[1200px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap vm-head-pad">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><Icono style={{ width: 20, height: 20 }} /></div>
          <div className="min-w-0"><h1 className="font-display font-bold text-lg leading-tight">{titulo}</h1><p className="text-[11px] text-white/70">{desc} · {perfil.nombre}</p></div>
          <div className="ml-auto flex gap-2">
            <button className="btn !bg-white/10 !border-white/20 !text-white" title="Actualizar" onClick={cargar}><RefreshCw /><span className="hidden sm:inline">Actualizar</span></button>
            {eliminar && <button className="btn !bg-white/10 !text-white !border-white/40" title="Papelera" onClick={() => setPapelera(true)}><Trash2 /></button>}
            {crear && <button className="btn !bg-white !text-[var(--navy)] !border-white" onClick={() => setEdit({ estado: 'Pendiente', prioridad: 'Media' })}><Plus />Nuevo</button>}
          </div>
        </div>
      </header>
      <main className="max-w-[1200px] mx-auto px-4 py-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">{kpis.map(([k, t, n]) => <button key={k} className={'kpi' + (estado === k ? ' on' : '')} onClick={() => setEstado(k)}><span>{t}</span><b>{n}</b></button>)}</div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp !pl-9" placeholder="Buscar título, detalle, responsable…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="inp !w-auto" value={prio} onChange={(e) => setPrio(e.target.value)}><option value="">Toda prioridad</option>{PRIORIDADES.map((p) => <option key={p}>{p}</option>)}</select>
          <select className="inp !w-auto" value={resp} onChange={(e) => setResp(e.target.value)}><option value="">Todos los responsables</option>{responsables.map((r) => <option key={r}>{r}</option>)}</select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {error && <div className="col-span-full text-center py-12 text-red-600 font-semibold">{error}</div>}
          {!error && regs === null && <div className="col-span-full text-center py-12 text-slate-400"><span className="spin" /> Cargando…</div>}
          {regs && !filtradas.length && <div className="col-span-full text-center py-14 text-slate-400"><p className="font-semibold text-slate-500">{lista.length ? 'Nada con estos filtros.' : 'Todavía no hay registros.'}</p>{!lista.length && crear && <button className="btn btn-p mt-3" onClick={() => setEdit({ estado: 'Pendiente', prioridad: 'Media' })}><Plus />Crear el primero</button>}</div>}
          {filtradas.map((r) => {
            const vencido = r.compromiso && new Date(r.compromiso + 'T12:00:00') < hoy && (r.estado === 'Pendiente' || r.estado === 'En proceso')
            return (
              <div key={r.id} className="card" onClick={() => setEdit(r)}>
                <div className="flex items-center gap-1.5 flex-wrap mb-1.5"><span className={'pill e-' + slug(r.estado)}>{r.estado}</span><span className={'pill p-' + slug(r.prioridad)}>{r.prioridad}</span><span className="ml-auto text-[10px] text-slate-400 font-mono">{r.codigo}</span></div>
                <p className="font-bold text-sm text-slate-800 leading-snug">{r.titulo}</p>
                {r.detalle && <p className="text-xs text-slate-500 mt-1 line-clamp-3 whitespace-pre-line">{r.detalle}</p>}
                <div className="flex items-center gap-3 mt-2.5 text-[11px] text-slate-500 flex-wrap">
                  {r.responsable && <span className="flex items-center gap-1"><User style={{ width: 12, height: 12 }} />{r.responsable}</span>}
                  {r.compromiso && <span className={'flex items-center gap-1 ' + (vencido ? 'text-red-600 font-bold' : '')}><Calendar style={{ width: 12, height: 12 }} />{fFecha(r.compromiso + 'T12:00:00')}{vencido ? ' · vencido' : ''}</span>}
                  <span className="ml-auto">{fFecha(r.fecha)}</span>
                </div>
              </div>
            )
          })}
        </div>
        <div className="text-[11px] text-slate-400 text-center pt-2">Módulo en construcción: por ahora registra pendientes y su avance. Las funciones propias del módulo se agregan sobre esta base.</div>
      </main>
      {edit && <Formulario reg={edit} emps={emps} modulo={modulo} perfil={perfil} eliminar={eliminar} cerrar={() => setEdit(null)} listo={() => { setEdit(null); cargar() }} aviso={aviso} />}
      {papelera && <Papelera modulo={modulo} titulo={titulo} cerrar={() => setPapelera(false)} restaurado={cargar} aviso={aviso} />}
    </div>
  )
}

function Formulario({ reg, emps, modulo, perfil, eliminar, cerrar, listo, aviso }: { reg: Partial<Reg>; emps: Emp[]; modulo: string; perfil: Perfil; eliminar: boolean; cerrar: () => void; listo: () => void; aviso: (t: string) => void }) {
  const [titulo, setTitulo] = useState(reg.titulo ?? '')
  const [detalle, setDetalle] = useState(reg.detalle ?? '')
  const [estado, setEstado] = useState(reg.estado ?? 'Pendiente')
  const [prio, setPrio] = useState(reg.prioridad ?? 'Media')
  const [resp, setResp] = useState(reg.responsable ?? '')
  const [comp, setComp] = useState((reg.compromiso ?? '').slice(0, 10))
  const [err, setErr] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [elim, setElim] = useState(false)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !elim) cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar, elim])
  async function guardar() {
    if (!titulo.trim()) { setErr('Escribe un título.'); return }
    let responsableId: string | null = null
    if (resp.trim()) {
      const e = emps.find((x) => norm(x.nombre) === norm(resp.trim()))
      if (!e) { setErr('El responsable debe ser un empleado de la lista.'); return }
      responsableId = e.id
    }
    setGuardando(true); setErr('')
    const campos = { titulo: titulo.trim(), detalle: detalle || null, estado, prioridad: prio, responsable_id: responsableId, fecha_compromiso: comp || null, actualizado_por: perfil.id }
    const r = reg.id
      ? await supabase.from('tareas_modulo').update(campos).eq('id', reg.id)
      : await supabase.from('tareas_modulo').insert({ id: crypto.randomUUID(), modulo, creado_por: perfil.id, ...campos })
    if (r.error) { setGuardando(false); setErr(r.error.message); return }
    listo()
  }
  async function borrar(motivo: string) {
    const { error } = await supabase.from('tareas_modulo').update({ deleted_at: new Date().toISOString(), motivo_eliminacion: motivo || null }).eq('id', reg.id!)
    if (error) { setElim(false); setErr(error.message); return }
    aviso('Registro eliminado. Puedes restaurarlo desde la Papelera.'); listo()
  }
  return (
    <div className="ovl" onClick={cerrar}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2"><h3 className="font-display font-bold" style={{ color: 'var(--navy)' }}>{reg.id ? 'Editar registro' : 'Nuevo registro'}</h3>{reg.id && <span className="text-[10px] text-slate-400 font-mono ml-auto">{reg.codigo}</span>}</div>
        <label className="f">Título *<input className="inp" maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} autoFocus /></label>
        <label className="f">Detalle<textarea className="inp" rows={4} value={detalle} onChange={(e) => setDetalle(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="f">Estado<select className="inp" value={estado} onChange={(e) => setEstado(e.target.value)}>{ESTADOS.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="f">Prioridad<select className="inp" value={prio} onChange={(e) => setPrio(e.target.value)}>{PRIORIDADES.map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <label className="f">Responsable<input className="inp" list="dlResp" value={resp} onChange={(e) => setResp(e.target.value)} /></label>
        <datalist id="dlResp">{emps.map((x) => <option key={x.id} value={x.nombre} />)}</datalist>
        <label className="f">Fecha compromiso<input type="date" className="inp" value={comp} onChange={(e) => setComp(e.target.value)} /></label>
        {reg.id && <p className="text-[10px] text-slate-400">Creado por {reg.creadoPor || '—'} el {fFecha(reg.fecha ?? '')}{reg.actualizadoPor ? ` · último cambio: ${reg.actualizadoPor} (${fFecha(reg.actualizado ?? '')})` : ''}</p>}
        {err && <p className="text-[11px] text-red-600">{err}</p>}
        <div className="flex items-center gap-2 pt-1">
          {reg.id && eliminar && <button className="btn !text-red-600" onClick={() => setElim(true)}><Trash2 />Eliminar</button>}
          <button className="btn ml-auto" onClick={cerrar}>Cancelar</button><button className="btn btn-p" onClick={guardar} disabled={guardando}>{guardando ? <span className="spin" /> : 'Guardar'}</button>
        </div>
      </div>
      {elim && <ConfirmarEliminar titulo="¿Eliminar este registro?" detalle="Se quitará del tablero. Queda guardado y se puede restaurar desde la Papelera." ok={borrar} cerrar={() => setElim(false)} />}
    </div>
  )
}

function Papelera({ modulo, titulo, cerrar, restaurado, aviso }: { modulo: string; titulo: string; cerrar: () => void; restaurado: () => void; aviso: (t: string) => void }) {
  const [items, setItems] = useState<{ id: string; titulo: string; codigo: string; deleted_at: string; motivo_eliminacion: string | null }[] | null>(null)
  const [ocupado, setOcupado] = useState('')
  useEffect(() => { supabase.from('tareas_modulo').select('id,titulo,codigo,deleted_at,motivo_eliminacion').eq('modulo', modulo).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(100).then(({ data }) => setItems((data as never) ?? [])) }, [modulo])
  async function restaurar(id: string) {
    setOcupado(id)
    const { error } = await supabase.from('tareas_modulo').update({ deleted_at: null, motivo_eliminacion: null }).eq('id', id)
    setOcupado('')
    if (error) { aviso('No se pudo restaurar: ' + error.message); return }
    setItems((a) => (a ?? []).filter((x) => x.id !== id)); restaurado()
  }
  return (
    <div className="vmpap-fondo" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="vmpap" role="dialog" aria-modal="true">
        <div className="vmpap-h"><b>Papelera · {titulo}<small>Lo eliminado no se borra de la base: aquí puedes devolverlo a la app.</small></b><button className="vmpap-x" aria-label="Cerrar" onClick={cerrar}>×</button></div>
        <div className="vmpap-b">
          {items === null && <div className="vmpap-v">Cargando…</div>}
          {items && !items.length && <div className="vmpap-v">La papelera está vacía.</div>}
          {items?.map((x) => <div key={x.id} className="vmpap-i"><div className="vmpap-t"><p className="d"><span className="tg">Registro</span>{x.titulo}{x.codigo ? ' · ' + x.codigo : ''}</p><p className="m">Eliminado el {fFecha(x.deleted_at)}</p>{x.motivo_eliminacion && <p className="m">Motivo: {x.motivo_eliminacion}</p>}</div><button className="vmpap-r" disabled={ocupado === x.id} onClick={() => restaurar(x.id)}>{ocupado === x.id ? 'Restaurando…' : 'Restaurar'}</button></div>)}
        </div>
      </div>
    </div>
  )
}
