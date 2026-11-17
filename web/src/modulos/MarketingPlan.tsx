/* Marketing › Plan de trabajo: quien coordina programa las actividades del equipo (completar la ficha de un producto, fotos,
   video, ficha técnica, documentos técnicos del proveedor, publicación). Cada tarea es una actividad de la Agenda de la
   persona (la ve y la trabaja también allí), tiene sus pasos y se cierra sola cuando el producto ya cumple
   (supabase/migrations/20261117110000_marketing_plan_trabajo.sql). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Camera, Check, ChevronLeft, ChevronRight, Clapperboard, ClipboardList, FileBadge, FileText, FolderUp, ImageOff, LayoutGrid, List, Megaphone,
  Plus, RefreshCw, Scissors, Sparkles, Trash2, Video, X,
} from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { imagen } from './inventarioUtil'
import { hoyEC } from './ofertasInv'
import { BuscadorProducto, type ProdBusq } from './MarketingArchivos'
import { EditorProducto, type Prod } from './MarketingIntegraciones'
import '../estilos/marketing-plan.css'

export type Trabajo = 'completar' | 'fotos' | 'video' | 'produccion' | 'edicion' | 'ficha_tecnica' | 'documentos_proveedor' | 'publicacion' | 'otro'
type Persona = { id: string; nombre: string; foto: string | null; rol: string }
type ProductoT = { id: string; codigo: string; nombre: string; imagen: string | null; publico: boolean }
type Tarea = {
  id: string; codigo: string; descripcion: string; trabajo: Trabajo; detalle: string | null; instrucciones: string | null
  fecha: string | null; prioridad: 'Urgente' | 'Importante' | 'Normal' | null; estado: string; responsable: string | null; creadoPor: string | null
  pasos: { t: string; hecho: boolean }[]; resultado: string | null; finalizada: string | null; creada: string
  devolucion: { motivo?: string; comentario?: string } | null; producto: ProductoT | null
}
type Plan = { coordina: boolean; yo: string; cerradasAhora: number; equipo: Persona[]; tareas: Tarea[] }
export type PendientePlan = { producto: ProdBusq & { imagen?: string | null }; trabajo: Trabajo; detalle?: string } | null

export const TRABAJOS: Record<Trabajo, { t: string; c: string; i: typeof FileText; d: string }> = {
  completar: { t: 'Completar ficha', c: '#055c9d', i: FileText, d: 'Descripción, características, especificaciones, imagen y 3 fotos.' },
  fotos: { t: 'Fotos', c: '#0e7490', i: Camera, d: 'Imagen principal y fotos nuevas en la galería.' },
  video: { t: 'Video', c: '#e1306c', i: Video, d: 'Un video nuevo del producto (del tipo elegido).' },
  produccion: { t: 'Producción de video', c: '#be185d', i: Clapperboard, d: 'Guion, preparación del equipo y del producto, grabación y respaldo del material.' },
  edicion: { t: 'Edición de video', c: '#9333ea', i: Scissors, d: 'Edición (cortes, música, textos y logo), revisión y subida a la galería del producto.' },
  ficha_tecnica: { t: 'Ficha técnica', c: '#04896f', i: FileBadge, d: 'Generar o actualizar la ficha técnica en PDF.' },
  documentos_proveedor: { t: 'Documentos del proveedor', c: '#7c3aed', i: FolderUp, d: 'Pedir al proveedor y cargar manual / hoja de datos y certificados en Documentos técnicos.' },
  publicacion: { t: 'Publicación', c: '#c2410c', i: Megaphone, d: 'Copy, diseño o video y programarla en el Planificador.' },
  otro: { t: 'Otra tarea', c: '#64748b', i: ClipboardList, d: 'Una tarea libre del equipo (sin producto).' },
}
const TIPOS_VIDEO = ['Comercial', 'Informativo', 'Reel para redes', 'Técnico', 'Demostración en uso', 'Testimonio']
const PRIO_COLOR: Record<string, string> = { Urgente: '#c0392b', Importante: '#d97706', Normal: '#94a3b8' }
const ESTADO_COLOR: Record<string, [string, string]> = {
  'Por hacer': ['#eef2f7', '#475569'], 'En marcha': ['#e0f2fe', '#0369a1'], Pausado: ['#fef3c7', '#92400e'], Devuelto: ['#fdecea', '#c0392b'],
  Listo: ['#dcfce7', '#15803d'], Cancelado: ['#f1f5f9', '#94a3b8'],
}
const abierta = (t: Tarea) => t.estado !== 'Listo' && t.estado !== 'Cancelado'
const esVideo = (t: Trabajo) => t === 'video' || t === 'produccion' || t === 'edicion'

/* ---------------------------------------------------------------- Fechas (AAAA-MM-DD, sin zona horaria) */
const dia = (iso: string) => new Date(iso + 'T12:00:00')
const sumar = (iso: string, n: number) => { const d = dia(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const lunesDe = (iso: string) => { const d = dia(iso); const w = (d.getDay() + 6) % 7; return sumar(iso, -w) }
const habil = (iso: string) => { let x = iso; while ([0, 6].includes(dia(x).getDay())) x = sumar(x, 1); return x }
const fCorta = (iso: string) => dia(iso).toLocaleDateString('es-EC', { weekday: 'short', day: 'numeric' })
const fLarga = (iso: string) => dia(iso).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' })
/** Reparte productos en días hábiles: `porDia` por día desde `desde`. */
function repartir<T>(lista: T[], desde: string, porDia: number): { x: T; fecha: string }[] {
  const r: { x: T; fecha: string }[] = []; let f = habil(desde), n = 0
  for (const x of lista) { if (n >= Math.max(1, porDia)) { f = habil(sumar(f, 1)); n = 0 } r.push({ x, fecha: f }); n++ }
  return r
}

async function rpc<T>(nombre: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nombre, args)
  if (error) throw new Error(error.message)
  return data as T
}

export function PlanTrabajo({ perfil, aviso, irA, pendiente, consumirPendiente }: {
  perfil: Perfil; aviso: (t: string) => void; irA: (tab: string) => void; pendiente: PendientePlan; consumirPendiente: () => void
}) {
  const hoy = hoyEC()
  const [lunes, setLunes] = useState(lunesDe(hoy))
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [persona, setPersona] = useState('')
  const [vista, setVista] = useState<'semana' | 'lista'>(() => (typeof window !== 'undefined' && window.innerWidth < 760 ? 'lista' : 'semana'))
  const [detalle, setDetalle] = useState<Tarea | null>(null)
  // Tarea con producto: se abre el formulario del producto (Biblioteca) con la tarea arriba
  const [editor, setEditor] = useState<Tarea | null>(null)
  const [asignar, setAsignar] = useState<PendientePlan | 'nuevo' | null>(null)
  const [armar, setArmar] = useState(false)
  // Clic en el día de una persona: formulario según su rol (Asistente → producto, Audiovisual → video)
  const [diaSel, setDiaSel] = useState<{ persona: string; fecha: string } | null>(null)
  const arrastra = useRef<string | null>(null)
  const [encima, setEncima] = useState('')
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumar(lunes, i)), [lunes])

  const cargar = useCallback(async () => {
    try {
      const p = await rpc<Plan>('mkt_plan', { p_desde: lunes, p_hasta: sumar(lunes, 6) })
      setPlan(p); setError('')
      if (p.cerradasAhora > 0) aviso(`${p.cerradasAhora} tarea${p.cerradasAhora === 1 ? '' : 's'} se cerr${p.cerradasAhora === 1 ? 'ó' : 'aron'} sola${p.cerradasAhora === 1 ? '' : 's'}: el producto ya cumple.`)
    } catch (e) { setError((e as Error).message) }
  }, [lunes, aviso])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { const f = () => { if (document.visibilityState === 'visible') cargar() }; document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f) }, [cargar])
  // Desde la Biblioteca («Asignar» en Por completar / Videos pendientes)
  useEffect(() => { if (pendiente && plan?.coordina) { setAsignar(pendiente); consumirPendiente() } }, [pendiente, plan?.coordina, consumirPendiente])

  if (error) return <div className="card p-6 text-sm" style={{ color: '#a3341f', background: '#fdecea' }}>{error}</div>
  if (!plan) return <p className="text-xs text-slate-400 p-4">Cargando el plan de trabajo…</p>

  const nombre = (id: string | null) => plan.equipo.find((e) => e.id === id)?.nombre ?? '—'
  const gente = plan.coordina ? plan.equipo.filter((e) => !persona || e.id === persona) : plan.equipo.filter((e) => e.id === plan.yo)
  const visibles = plan.tareas.filter((t) => !persona || t.responsable === persona)
  const atrasada = (t: Tarea) => abierta(t) && !!t.fecha && t.fecha < hoy
  const deAntes = visibles.filter((t) => abierta(t) && (!t.fecha || t.fecha < lunes))
  const kAbiertas = visibles.filter(abierta).length, kAtrasadas = visibles.filter(atrasada).length
  const kListas = visibles.filter((t) => t.estado === 'Listo' && t.fecha && t.fecha >= lunes && t.fecha <= dias[6]).length

  async function mover(id: string, fecha: string, resp: string) {
    const t = plan!.tareas.find((x) => x.id === id)
    if (!t || !abierta(t) || (t.fecha === fecha && t.responsable === resp)) return
    setPlan((p) => p && { ...p, tareas: p.tareas.map((x) => (x.id === id ? { ...x, fecha, responsable: resp } : x)) })
    try { await rpc('mkt_plan_mover', { p_id: id, p_fecha: fecha, p_responsable: resp }); aviso(t.responsable !== resp ? 'Tarea pasada a ' + nombre(resp) + '.' : 'Tarea movida al ' + fLarga(fecha) + '.') }
    catch (e) { aviso((e as Error).message); cargar() }
  }

  const Tarjeta = ({ t, conPersona = false }: { t: Tarea; conPersona?: boolean }) => {
    const m = TRABAJOS[t.trabajo] ?? TRABAJOS.otro, I = m.i
    const hechos = t.pasos.filter((p) => p.hecho).length, [fb, fc] = ESTADO_COLOR[t.estado] ?? ESTADO_COLOR['Por hacer']
    const mueve = plan!.coordina && abierta(t)
    return (
      <button type="button" className={'mkp-card' + (atrasada(t) ? ' tarde' : '') + (abierta(t) ? '' : ' cerrada') + (mueve ? ' mueve' : '')} style={{ ['--c' as string]: m.c }}
        draggable={mueve} onDragStart={(e) => { arrastra.current = t.id; e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { arrastra.current = null; setEncima('') }}
        onClick={() => (t.producto ? setEditor(t) : setDetalle(t))} title={t.producto ? 'Abrir el producto para completarlo' : t.descripcion}>
        <span className="tipo"><I />{m.t}{t.detalle ? ' · ' + t.detalle : ''}<span className="mkp-pri" style={{ background: PRIO_COLOR[t.prioridad ?? 'Normal'], marginLeft: 'auto' }} title={'Prioridad ' + (t.prioridad ?? 'Normal')} /></span>
        <span className="nom">{t.producto ? t.producto.nombre : t.instrucciones || t.descripcion}</span>
        <span className="pie">
          {t.pasos.length > 0 && <span className="pas"><i style={{ width: Math.round((hechos / t.pasos.length) * 100) + '%' }} /></span>}
          {t.pasos.length > 0 && <span>{hechos}/{t.pasos.length}</span>}
          <span className="mkp-est" style={{ background: fb, color: fc }}>{atrasada(t) ? 'Atrasada' : t.estado}</span>
        </span>
        {conPersona && <span className="pie">{nombre(t.responsable)}{t.fecha ? ' · ' + fCorta(t.fecha) : ''}</span>}
      </button>
    )
  }
  const celda = (resp: string, fecha: string | null, lista: Tarea[], clase: string) => {
    const k = resp + '|' + (fecha ?? 'atr')
    return (
      <div key={k} className={'mkp-celda ' + clase + (encima === k ? ' encima' : '') + (plan.coordina && fecha ? ' prog' : '')}
        onDragOver={(e) => { if (!plan.coordina || !fecha || !arrastra.current) return; e.preventDefault(); setEncima(k) }}
        onDragLeave={() => setEncima((v) => (v === k ? '' : v))}
        onDrop={(e) => { e.preventDefault(); setEncima(''); if (fecha && arrastra.current) mover(arrastra.current, fecha, resp); arrastra.current = null }}
        onClick={(e) => { if (!plan.coordina || !fecha || (e.target as HTMLElement).closest('.mkp-card')) return; setDiaSel({ persona: resp, fecha }) }}>
        {lista.map((t) => <Tarjeta key={t.id} t={t} />)}
        {plan.coordina && fecha && <span className="mkp-mas" aria-hidden="true"><Plus />Programar</span>}
      </div>
    )
  }

  // Cumplimiento por persona (semana visible + lo atrasado)
  const cumplimiento = plan.coordina ? plan.equipo.map((e) => {
    const suyas = plan.tareas.filter((t) => t.responsable === e.id)
    const semana = suyas.filter((t) => t.fecha && t.fecha >= lunes && t.fecha <= dias[6] && t.estado !== 'Cancelado')
    const listas = semana.filter((t) => t.estado === 'Listo')
    const aTiempo = listas.filter((t) => t.finalizada && t.fecha && t.finalizada.slice(0, 10) <= t.fecha)
    return { e, total: semana.length, listas: listas.length, aTiempo: aTiempo.length, atrasadas: suyas.filter(atrasada).length, abiertas: suyas.filter(abierta).length }
  }).filter((x) => x.total || x.abiertas) : []

  return (
    <div>
      <div className="mkp-barra">
        <div className="mkp-semana">
          <button type="button" className="mkp-ib" onClick={() => setLunes(sumar(lunes, -7))} aria-label="Semana anterior"><ChevronLeft /></button>
          <b>{dia(lunes).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })} – {dia(dias[6]).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })}</b>
          <button type="button" className="mkp-ib" onClick={() => setLunes(sumar(lunes, 7))} aria-label="Semana siguiente"><ChevronRight /></button>
        </div>
        {lunes !== lunesDe(hoy) && <button type="button" className="btn" onClick={() => setLunes(lunesDe(hoy))}>Esta semana</button>}
        {plan.coordina && (
          <select className="inp" style={{ width: 'auto' }} value={persona} onChange={(e) => setPersona(e.target.value)}>
            <option value="">Todo el equipo</option>{plan.equipo.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        )}
        <div className="mkp-semana">
          <button type="button" className="mkp-ib" style={vista === 'semana' ? { background: '#eef6fd', color: 'var(--primary)' } : undefined} onClick={() => setVista('semana')} title="Tablero de la semana"><LayoutGrid /></button>
          <button type="button" className="mkp-ib" style={vista === 'lista' ? { background: '#eef6fd', color: 'var(--primary)' } : undefined} onClick={() => setVista('lista')} title="Lista por día"><List /></button>
        </div>
        <button type="button" className="mkp-ib" onClick={cargar} title="Actualizar"><RefreshCw /></button>
        <span className="mkp-esp" />
        {plan.coordina && <button type="button" className="btn" onClick={() => setArmar(true)}><Sparkles />Armar la semana</button>}
        {plan.coordina && <button type="button" className="btn btn-primary" onClick={() => setAsignar('nuevo')}><Plus />Asignar tarea</button>}
      </div>

      <div className="mkp-kpis">
        <div className="mkp-kpi"><b>{kAbiertas}</b><span>Abiertas</span></div>
        <div className={'mkp-kpi' + (kAtrasadas ? ' rojo' : '')}><b>{kAtrasadas}</b><span>Atrasadas</span></div>
        <div className="mkp-kpi verde"><b>{kListas}</b><span>Listas esta semana</span></div>
        <p className="mkp-nota" style={{ alignSelf: 'center', maxWidth: 420 }}>{plan.coordina ? 'Arrastra una tarea a otro día o a otra persona. ' : ''}Cada tarea también está en la Agenda de la persona y se cierra sola cuando el producto ya cumple.</p>
      </div>

      {!gente.length && <div className="mkp-vacio">Todavía no hay personas en el equipo de Marketing.</div>}
      {gente.length > 0 && vista === 'semana' && (
        <div className="mkp-tablero-caja">
          <div className="mkp-tablero" style={{ gridTemplateColumns: `150px ${deAntes.length ? 'minmax(140px,1fr) ' : ''}repeat(7, minmax(120px,1fr))` }}>
            <div className="mkp-th">Persona</div>
            {deAntes.length > 0 && <div className="mkp-th atr">Atrasadas<small>de antes</small></div>}
            {dias.map((d) => <div key={d} className={'mkp-th' + (d === hoy ? ' hoy' : '')}>{fCorta(d)}{d === hoy && <small>hoy</small>}</div>)}
            {gente.map((e) => {
              const suyas = visibles.filter((t) => t.responsable === e.id)
              const carga = suyas.filter((t) => abierta(t) && t.fecha && t.fecha >= lunes && t.fecha <= dias[6]).length
              return (
                <div key={e.id} style={{ display: 'contents' }}>
                  <div className="mkp-persona"><b>{e.nombre}</b><small>{e.rol} · {carga} abierta{carga === 1 ? '' : 's'}</small>
                    <div className="mkp-carga"><i style={{ width: Math.min(100, carga * 10) + '%', background: carga > 8 ? '#c0392b' : carga > 5 ? '#d97706' : '#04896f' }} /></div></div>
                  {deAntes.length > 0 && celda(e.id, null, suyas.filter((t) => abierta(t) && (!t.fecha || t.fecha < lunes)), 'atr')}
                  {dias.map((d) => celda(e.id, d, suyas.filter((t) => t.fecha === d), d === hoy ? 'hoy' : ''))}
                </div>
              )
            })}
          </div>
        </div>
      )}
      {gente.length > 0 && vista === 'lista' && (
        <div className="mkp-lista">
          {deAntes.length > 0 && <div className="mkp-dia"><h4 className="atr">Atrasadas de antes</h4><div className="grid">{deAntes.map((t) => <Tarjeta key={t.id} t={t} conPersona={plan.coordina} />)}</div></div>}
          {dias.map((d) => {
            const l = visibles.filter((t) => t.fecha === d)
            const prog = plan.coordina && plan.equipo.length > 0
            return l.length || prog ? <div key={d} className="mkp-dia"><h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{fLarga(d)}{d === hoy ? ' · hoy' : ''}
              {prog && <button type="button" className="mkp-mas-btn" onClick={() => setDiaSel({ persona: persona || plan.equipo[0].id, fecha: d })}><Plus />Programar</button>}</h4>
              {l.length > 0 && <div className="grid">{l.map((t) => <Tarjeta key={t.id} t={t} conPersona={plan.coordina} />)}</div>}</div> : null
          })}
          {!deAntes.length && !dias.some((d) => visibles.some((t) => t.fecha === d)) && <div className="mkp-vacio">No hay tareas en esta semana.{plan.coordina ? ' Usa «Asignar tarea» o «Armar la semana».' : ''}</div>}
        </div>
      )}

      {cumplimiento.length > 0 && (
        <div className="card p-4 mkp-cumpl">
          <p className="font-display font-bold text-sm text-slate-800">Cumplimiento del equipo · esta semana</p>
          <table><thead><tr><th>Persona</th><th style={{ textAlign: 'center' }}>Tareas</th><th style={{ textAlign: 'center' }}>Listas</th><th style={{ textAlign: 'center' }}>A tiempo</th><th style={{ textAlign: 'center' }}>Atrasadas</th></tr></thead>
            <tbody>{cumplimiento.map((c) => (
              <tr key={c.e.id}><td>{c.e.nombre}</td><td className="num">{c.total}</td><td className="num">{c.listas}</td>
                <td className="num" style={{ color: c.listas ? (c.aTiempo / c.listas >= 0.8 ? '#04896f' : '#d97706') : '#94a3b8' }}>{c.listas ? Math.round((c.aTiempo / c.listas) * 100) + '%' : '—'}</td>
                <td className="num" style={{ color: c.atrasadas ? '#c0392b' : '#94a3b8' }}>{c.atrasadas}</td></tr>
            ))}</tbody></table>
        </div>
      )}

      {editor && <EditorDesdePlan t={plan.tareas.find((x) => x.id === editor.id) ?? editor} plan={plan} perfil={perfil} nombre={nombre} aviso={aviso}
        cerrar={() => { setEditor(null); cargar() }} verTarea={() => { const t = editor; setEditor(null); setDetalle(t) }} recargar={cargar} />}
      {detalle && <DetalleTarea t={plan.tareas.find((x) => x.id === detalle.id) ?? detalle} plan={plan} nombre={nombre} cerrar={() => setDetalle(null)} aviso={aviso} irA={irA} recargar={cargar} />}
      {asignar && <ModalAsignar plan={plan} inicial={asignar === 'nuevo' ? null : asignar} personaDef={persona} fechaDef={habil(lunes > hoy ? lunes : hoy)} cerrar={() => setAsignar(null)} aviso={aviso} listo={() => { setAsignar(null); cargar() }} />}
      {diaSel && <FormularioDia plan={plan} personaId={diaSel.persona} fecha={diaSel.fecha} cerrar={() => setDiaSel(null)} aviso={aviso} listo={() => { setDiaSel(null); cargar() }} />}
      {armar && <ModalArmar plan={plan} personaDef={persona} fechaDef={habil(lunes > hoy ? lunes : hoy)} cerrar={() => setArmar(false)} aviso={aviso} listo={() => { setArmar(false); cargar() }} />}
    </div>
  )
}

/* ---------------------------------------------------------------- Formulario del producto desde una tarea */
function EditorDesdePlan({ t, plan, perfil, nombre, aviso, cerrar, verTarea, recargar }: {
  t: Tarea; plan: Plan; perfil: Perfil; nombre: (id: string | null) => string; aviso: (s: string) => void; cerrar: () => void; verTarea: () => void; recargar: () => Promise<void>
}) {
  const [prod, setProd] = useState<Prod | null>(null)
  const [categorias, setCategorias] = useState<string[]>([])
  const [marcas, setMarcas] = useState<string[]>([])
  const [error, setError] = useState('')
  const pid = t.producto?.id
  useEffect(() => {
    if (!pid) return
    supabase.from('productos').select('id,codigo,nombre,descripcion,imagen_url,marca,drive_carpeta_url,ficha_tecnica_url,fecha_creacion,sin_etiqueta_nuevo,en_catalogo,categoria:categorias(nombre)').eq('id', pid).single()
      .then(({ data, error: e }) => { if (e || !data) setError('No se pudo abrir el producto: ' + (e?.message ?? 'no existe')); else setProd(data as unknown as Prod) })
    supabase.from('categorias').select('nombre').is('deleted_at', null).order('nombre').then(({ data }) => setCategorias(((data as { nombre: string }[] | null) ?? []).map((x) => x.nombre)))
    supabase.from('productos').select('marca').not('marca', 'is', null).is('deleted_at', null).limit(1000)
      .then(({ data }) => setMarcas([...new Set(((data as { marca: string }[] | null) ?? []).map((x) => x.marca.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))))
  }, [pid])
  useEffect(() => { if (error) { aviso(error); cerrar() } }, [error]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!prod) return <div className="mkp-fondo"><p className="text-sm font-semibold text-white">Abriendo el producto…</p></div>
  const m = TRABAJOS[t.trabajo] ?? TRABAJOS.otro, I = m.i
  const puede = (t.responsable === plan.yo || plan.coordina) && abierta(t)
  const paso = async (i: number, hecho: boolean) => {
    try { await rpc('mkt_plan_paso', { p_id: t.id, p_indice: i, p_hecho: hecho }); await recargar() } catch (e) { aviso((e as Error).message) }
  }
  const encabezado = (
    <>
      <div className="mkf-tarea" style={{ ['--c' as string]: m.c }}>
        <span className="t"><I />{m.t}{t.detalle ? ' · ' + t.detalle : ''}</span>
        <span className="text-slate-500" style={{ fontSize: 11.5 }}>{nombre(t.responsable)} · {t.fecha ? fLarga(t.fecha) : 'sin fecha'} · <b>{t.estado}</b></span>
        {t.pasos.length > 0 && <span className="pasos">{t.pasos.map((p, i) => (
          <label key={i} className={'paso' + (p.hecho ? ' ok' : '')}><input type="checkbox" checked={p.hecho} disabled={!puede} onChange={(e) => paso(i, e.target.checked)} />{p.t}</label>))}</span>}
        <button type="button" className="btn !py-1.5" style={{ marginLeft: 'auto' }} onClick={verTarea}>Terminar o reprogramar</button>
      </div>
      {t.instrucciones && <p className="text-[11.5px] text-slate-600" style={{ margin: 0 }}><b>Instrucciones:</b> {t.instrucciones}</p>}
    </>
  )
  return <EditorProducto perfil={perfil} prod={prod} categorias={categorias} marcas={marcas} cerrar={cerrar} aviso={aviso} encabezado={encabezado} />
}

/* ---------------------------------------------------------------- Detalle de una tarea */
function DetalleTarea({ t, plan, nombre, cerrar, aviso, irA, recargar }: {
  t: Tarea; plan: Plan; nombre: (id: string | null) => string; cerrar: () => void; aviso: (s: string) => void; irA: (tab: string) => void; recargar: () => Promise<void>
}) {
  const m = TRABAJOS[t.trabajo] ?? TRABAJOS.otro
  const mia = t.responsable === plan.yo, puede = (mia || plan.coordina) && abierta(t)
  const [resultado, setResultado] = useState('')
  const [fecha, setFecha] = useState(t.fecha ?? '')
  const [resp, setResp] = useState(t.responsable ?? '')
  const [ocupado, setOcupado] = useState('')
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  const hacer = async (k: string, f: () => Promise<unknown>, ok: string, cerrarAl = false) => {
    setOcupado(k)
    try { await f(); aviso(ok); await recargar(); if (cerrarAl) cerrar() } catch (e) { aviso((e as Error).message) }
    setOcupado('')
  }
  const destino: [string, string] | null = t.trabajo === 'documentos_proveedor' ? ['material', 'Ir a Material de proveedores'] : t.trabajo === 'publicacion' ? ['planificador', 'Ir al Planificador']
    : esVideo(t.trabajo) || t.trabajo === 'fotos' ? ['audiovisual', 'Ir a Audiovisual'] : t.producto ? ['biblioteca', 'Ir a la Biblioteca'] : null
  return (
    <div className="mkp-fondo" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="mkp-modal">
        <header><div><p style={{ opacity: 0.85, fontWeight: 800, textTransform: 'uppercase', fontSize: 10.5 }}>{m.t}{t.detalle ? ' · ' + t.detalle : ''} · {t.codigo}</p><h3>{t.producto ? t.producto.nombre : t.instrucciones || t.descripcion}</h3>
          <p>{nombre(t.responsable)} · {t.fecha ? fLarga(t.fecha) : 'Sin fecha'} · Prioridad {t.prioridad ?? 'Normal'}</p></div>
          <button type="button" className="x" onClick={cerrar} aria-label="Cerrar"><X className="w-4 h-4" /></button></header>
        <div className="cuerpo">
          {t.producto && (
            <div className="mkp-prod">
              {t.producto.imagen ? <img src={imagen(t.producto.imagen, 120)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="ph" style={{ display: 'grid', placeItems: 'center' }}><ImageOff className="w-4 h-4 text-slate-300" /></span>}
              <div className="min-w-0 flex-1"><p className="text-[10.5px] font-mono-spec text-slate-400">{t.producto.codigo}{t.producto.publico ? ' · visible al público' : ''}</p><p className="text-[12.5px] font-bold text-slate-800">{t.producto.nombre}</p></div>
            </div>
          )}
          <p className="mkp-nota" style={{ marginTop: 8 }}>{m.d} {t.trabajo !== 'otro' ? 'Se cierra sola cuando el producto ya lo tiene.' : ''}</p>
          {t.instrucciones && t.producto && <><span className="mkp-lab">Instrucciones</span><p className="text-[12.5px] text-slate-700 whitespace-pre-line">{t.instrucciones}</p></>}
          {t.estado === 'Devuelto' && t.devolucion && <p className="mkp-alerta" style={{ background: '#fdecea', color: '#a3341f' }}><b>Devuelta:</b> {t.devolucion.motivo} — {t.devolucion.comentario}</p>}
          {t.pasos.length > 0 && <>
            <span className="mkp-lab">Pasos</span>
            <div className="mkp-pasos">{t.pasos.map((p, i) => (
              <label key={i} className={'mkp-paso' + (p.hecho ? ' ok' : '')}>
                <input type="checkbox" checked={p.hecho} disabled={!puede || !!ocupado} onChange={(e) => hacer('paso', () => rpc('mkt_plan_paso', { p_id: t.id, p_indice: i, p_hecho: e.target.checked }), e.target.checked ? 'Paso marcado.' : 'Paso desmarcado.')} />{p.t}
              </label>))}</div>
          </>}
          {!abierta(t) && <p className="mkp-alerta" style={{ background: t.estado === 'Listo' ? '#dcfce7' : '#f1f5f9', color: t.estado === 'Listo' ? '#15803d' : '#475569' }}><b>{t.estado}</b>{t.finalizada ? ' el ' + new Date(t.finalizada).toLocaleDateString('es-EC') : ''}{t.resultado ? ' · ' + t.resultado : ''}</p>}
          {puede && <>
            <span className="mkp-lab">Terminar a mano</span>
            <textarea className="inp" rows={2} value={resultado} onChange={(e) => setResultado(e.target.value)} placeholder="Qué se hizo (p. ej. «Video subido y enviado a revisión»)" />
          </>}
          {plan.coordina && abierta(t) && <>
            <span className="mkp-lab">Reprogramar o cambiar de persona</span>
            <div className="mkp-2">
              <input type="date" className="inp" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              <select className="inp" value={resp} onChange={(e) => setResp(e.target.value)}>{plan.equipo.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select>
            </div>
          </>}
          <p className="mkp-nota" style={{ marginTop: 10 }}>También está en la Agenda de {mia ? 'tu' : 'la persona'} (cronómetro, monedas y devoluciones).</p>
        </div>
        <footer>
          {destino && <button type="button" className="btn" onClick={() => { cerrar(); irA(destino[0]) }}>{destino[1]}</button>}
          <span style={{ flex: 1 }} />
          {plan.coordina && abierta(t) && <button type="button" className="btn" style={{ color: '#b91c1c' }} disabled={!!ocupado} onClick={() => { const mo = prompt('¿Por qué se cancela esta tarea?'); if (mo !== null) hacer('cancelar', () => rpc('mkt_plan_cancelar', { p_id: t.id, p_motivo: mo }), 'Tarea cancelada.', true) }}><Trash2 />Cancelar</button>}
          {plan.coordina && abierta(t) && (fecha !== (t.fecha ?? '') || resp !== (t.responsable ?? '')) && <button type="button" className="btn" disabled={!!ocupado || !fecha} onClick={() => hacer('mover', () => rpc('mkt_plan_mover', { p_id: t.id, p_fecha: fecha, p_responsable: resp }), 'Tarea reprogramada.')}>Guardar cambios</button>}
          {puede && <button type="button" className="btn btn-primary" disabled={!!ocupado || !resultado.trim()} onClick={() => hacer('terminar', () => rpc('mkt_plan_terminar', { p_id: t.id, p_resultado: resultado }), 'Tarea terminada.', true)}><Check />Terminar</button>}
        </footer>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Formulario del día de una persona
   Asistente: todo lo del producto (ficha, fotos, ficha técnica, documentos del proveedor, publicación); la app marca lo que
   le falta al producto. Audiovisual: el video desde la producción (guion y grabación) hasta la edición, cada etapa en su día. */
type EstadoProd = { imagen: boolean; fotos: number; videos: number; tipos: Record<string, number>; descripcion: boolean; caracteristicas: boolean; especificaciones: boolean; ficha: boolean; docs_manual: boolean; docs_cert: boolean; abiertas: Trabajo[] }
type ProdDia = ProdBusq & { estado?: EstadoProd | null }
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
const DEL_PRODUCTO: Trabajo[] = ['completar', 'fotos', 'ficha_tecnica', 'documentos_proveedor', 'publicacion']
function faltaDe(e: EstadoProd): string[] {
  const f: string[] = []
  if (!e.descripcion) f.push('descripción'); if (!e.caracteristicas) f.push('características'); if (!e.especificaciones) f.push('especificaciones')
  if (!e.imagen) f.push('imagen principal'); if (e.fotos < 3) f.push(e.fotos ? 'fotos (' + e.fotos + ' de 3)' : 'fotos')
  if (!e.ficha) f.push('ficha técnica'); if (!e.docs_manual) f.push('manual / hoja de datos'); if (!e.docs_cert) f.push('certificados')
  return f
}
function sugeridos(e: EstadoProd): Trabajo[] {
  const t: Trabajo[] = []
  if (!(e.descripcion && e.caracteristicas && e.especificaciones && e.imagen && e.fotos >= 3)) t.push('completar')
  if (!e.ficha) t.push('ficha_tecnica')
  if (!(e.docs_manual && e.docs_cert)) t.push('documentos_proveedor')
  return t.filter((x) => !e.abiertas.includes(x))
}
function FormularioDia({ plan, personaId, fecha, cerrar, aviso, listo }: {
  plan: Plan; personaId: string; fecha: string; cerrar: () => void; aviso: (s: string) => void; listo: () => void
}) {
  const [resp, setResp] = useState(personaId)
  const persona = plan.equipo.find((e) => e.id === resp)
  const [tipo, setTipo] = useState<'producto' | 'video' | 'otro'>(persona?.rol === 'Audiovisual' ? 'video' : 'producto')
  const [tocoTipo, setTocoTipo] = useState(false)
  useEffect(() => { if (!tocoTipo) setTipo(plan.equipo.find((e) => e.id === resp)?.rol === 'Audiovisual' ? 'video' : 'producto') }, [resp, tocoTipo, plan.equipo])
  const [productos, setProductos] = useState<ProdDia[]>([])
  const [busca, setBusca] = useState<ProdBusq | null>(null)
  const [trabajos, setTrabajos] = useState<Trabajo[]>([])
  const [tocoTrabajos, setTocoTrabajos] = useState(false)
  const [tipoVideo, setTipoVideo] = useState('')
  const [etapas, setEtapas] = useState<'ambas' | 'produccion' | 'edicion'>('ambas')
  const [fProd, setFProd] = useState(fecha)
  const [fEdi, setFEdi] = useState(habil(sumar(fecha, 1)))
  const [prioridad, setPrioridad] = useState('Normal')
  const [instrucciones, setInstrucciones] = useState('')
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  // Al agregar un producto se trae lo que le falta (y lo que ya tiene en marcha)
  useEffect(() => {
    if (!busca) return
    const p = busca; setBusca(null)
    if (tipo === 'video') setProductos([{ ...p }])
    else setProductos((l) => (l.some((x) => x.id === p.id) ? l : [...l, { ...p }]))
    rpc<EstadoProd>('mkt_plan_estado_producto', { p_producto: p.id }).then((e) => {
      setProductos((l) => l.map((x) => (x.id === p.id ? { ...x, estado: e } : x)))
      if (!tocoTrabajos && e) setTrabajos((t) => [...new Set([...t, ...sugeridos(e)])])
    }).catch(() => setProductos((l) => l.map((x) => (x.id === p.id ? { ...x, estado: null } : x))))
  }, [busca]) // eslint-disable-line react-hooks/exhaustive-deps

  async function asignar(trabajo: Trabajo, items: { producto_id?: string; fecha: string }[], detalle = '') {
    return rpc<{ creadas: number; omitidos: { producto: string; motivo: string }[] }>('mkt_plan_asignar', { p: { responsable: resp, trabajo, detalle, prioridad, instrucciones, items } })
  }
  async function guardar() {
    if (!resp) { aviso('Elige a la persona.'); return }
    const lotes: [Trabajo, { producto_id?: string; fecha: string }[], string][] = []
    if (tipo === 'producto') {
      if (!productos.length) { aviso('Agrega al menos un producto.'); return }
      if (!trabajos.length) { aviso('Marca qué tiene que completar.'); return }
      for (const t of DEL_PRODUCTO) if (trabajos.includes(t)) lotes.push([t, productos.map((p) => ({ producto_id: p.id, fecha })), ''])
    } else if (tipo === 'video') {
      if (!productos.length) { aviso('Elige el producto del video.'); return }
      if (etapas === 'ambas' && fEdi < fProd) { aviso('La edición no puede ser antes de la producción.'); return }
      if (etapas !== 'edicion') lotes.push(['produccion', [{ producto_id: productos[0].id, fecha: fProd }], tipoVideo])
      if (etapas !== 'produccion') lotes.push(['edicion', [{ producto_id: productos[0].id, fecha: etapas === 'edicion' ? fProd : fEdi }], tipoVideo])
    } else {
      if (!instrucciones.trim()) { aviso('Escribe qué hay que hacer.'); return }
      lotes.push(['otro', [{ fecha }], ''])
    }
    setOcupado(true)
    let creadas = 0; const omitidos: string[] = []
    try {
      for (const [t, items, det] of lotes) {
        const r = await asignar(t, items, det)
        creadas += r.creadas
        r.omitidos.forEach((o) => omitidos.push(TRABAJOS[t].t + ' · ' + o.producto + ' (' + o.motivo.toLowerCase() + ')'))
      }
      aviso(`${creadas} tarea${creadas === 1 ? '' : 's'} para ${persona?.nombre ?? ''}.` + (omitidos.length ? ' No se asignó: ' + omitidos.join(', ') + '.' : ''))
      listo()
    } catch (e) { aviso((e as Error).message); setOcupado(false) }
  }
  const tab = (k: 'producto' | 'video' | 'otro', t: string, I: typeof FileText) => (
    <button type="button" className={tipo === k ? 'on' : ''} onClick={() => { setTipo(k); setTocoTipo(true); if (k === 'video') setProductos((l) => l.slice(0, 1)) }}><I />{t}</button>
  )
  return (
    <div className="mkp-fondo" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="mkp-modal">
        <header><div><p style={{ opacity: 0.85, fontWeight: 800, textTransform: 'uppercase', fontSize: 10.5 }}>{persona?.rol ?? ''}</p><h3>{persona?.nombre ?? 'Programar'}</h3><p>{cap(fLarga(fecha))}</p></div>
          <button type="button" className="x" onClick={cerrar} aria-label="Cerrar"><X className="w-4 h-4" /></button></header>
        <div className="cuerpo">
          {plan.equipo.length > 1 && (
            <label><span className="mkp-lab" style={{ marginTop: 0 }}>Persona</span>
              <select className="inp" value={resp} onChange={(e) => setResp(e.target.value)}>{plan.equipo.map((e) => <option key={e.id} value={e.id}>{e.nombre} · {e.rol}</option>)}</select></label>
          )}
          <div className="mkp-tabs">{tab('producto', 'Producto', FileText)}{tab('video', 'Video', Clapperboard)}{tab('otro', 'Otra tarea', ClipboardList)}</div>

          {tipo !== 'otro' && <>
            <span className="mkp-lab">{tipo === 'video' ? 'Producto del video' : 'Productos'}</span>
            <BuscadorProducto valor={busca} cambiar={setBusca} placeholder={tipo === 'video' ? 'Busca el producto (código o nombre)…' : 'Busca y agrega productos (código o nombre)…'} />
            {productos.length > 0 && <div className="mkp-pasos" style={{ marginTop: 6 }}>{productos.map((p) => {
              const e = p.estado, falta = e ? faltaDe(e) : []
              return (
                <div key={p.id} className="mkp-paso" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <span className="min-w-0 flex-1"><b style={{ fontSize: 12.5 }}>{p.codigo} · {p.nombre}</b>
                    <span className="block text-[11px]" style={{ color: e === undefined ? '#94a3b8' : falta.length ? '#b45309' : '#04896f' }}>
                      {e === undefined ? 'Revisando…' : e === null ? '' : tipo === 'video'
                        ? (e.videos ? e.videos + ' video' + (e.videos === 1 ? '' : 's') + ': ' + Object.entries(e.tipos).map(([k, n]) => k + ' ' + n).join(', ') : 'Todavía no tiene videos')
                        : (falta.length ? 'Le falta: ' + falta.join(', ') : 'Ficha completa')}</span>
                    {e && e.abiertas.length > 0 && <span className="block text-[10.5px] text-slate-500">En marcha: {e.abiertas.map((t) => TRABAJOS[t]?.t ?? t).join(', ')}</span>}
                  </span>
                  <button type="button" className="mkp-ib" style={{ width: 26, height: 26 }} onClick={() => setProductos((l) => l.filter((x) => x.id !== p.id))} aria-label="Quitar"><X className="w-3 h-3" /></button>
                </div>
              )
            })}</div>}
          </>}

          {tipo === 'producto' && <>
            <span className="mkp-lab">Qué completa</span>
            <div className="mkp-pasos">{DEL_PRODUCTO.map((t) => {
              const m = TRABAJOS[t], I = m.i, on = trabajos.includes(t)
              return (
                <label key={t} className={'mkp-paso' + (on ? ' ok' : '')}>
                  <input type="checkbox" checked={on} onChange={() => { setTocoTrabajos(true); setTrabajos((l) => (on ? l.filter((x) => x !== t) : [...l, t])) }} />
                  <I className="w-4 h-4 shrink-0" style={{ color: m.c }} /><span className="min-w-0 flex-1"><b>{m.t}</b><span className="block text-[11px] text-slate-500">{m.d}</span></span>
                </label>
              )
            })}</div>
          </>}

          {tipo === 'video' && <>
            <div className="mkp-2">
              <label><span className="mkp-lab">Tipo de video</span><select className="inp" value={tipoVideo} onChange={(e) => setTipoVideo(e.target.value)}><option value="">Cualquiera</option>{TIPOS_VIDEO.map((v) => <option key={v}>{v}</option>)}</select></label>
              <label><span className="mkp-lab">Qué se programa</span><select className="inp" value={etapas} onChange={(e) => setEtapas(e.target.value as 'ambas' | 'produccion' | 'edicion')}>
                <option value="ambas">Producción y edición</option><option value="produccion">Solo producción (grabación)</option><option value="edicion">Solo edición</option></select></label>
            </div>
            <div className="mkp-2">
              <label><span className="mkp-lab">{etapas === 'edicion' ? 'Día de edición' : 'Día de producción'}</span><input type="date" className="inp" value={fProd} onChange={(e) => { setFProd(e.target.value); if (e.target.value && fEdi < e.target.value) setFEdi(habil(sumar(e.target.value, 1))) }} /></label>
              {etapas === 'ambas' && <label><span className="mkp-lab">Día de edición</span><input type="date" className="inp" value={fEdi} min={fProd} onChange={(e) => setFEdi(e.target.value)} /></label>}
            </div>
            <div className="mkp-pasos" style={{ marginTop: 10 }}>
              {etapas !== 'edicion' && <div className="mkp-paso" style={{ cursor: 'default' }}><Clapperboard className="w-4 h-4 shrink-0" style={{ color: TRABAJOS.produccion.c }} /><span><b>Producción</b><span className="block text-[11px] text-slate-500">Guion y lista de tomas · preparar equipo, lugar y producto · grabación · respaldo</span></span></div>}
              {etapas !== 'produccion' && <div className="mkp-paso" style={{ cursor: 'default' }}><Scissors className="w-4 h-4 shrink-0" style={{ color: TRABAJOS.edicion.c }} /><span><b>Edición</b><span className="block text-[11px] text-slate-500">Elegir tomas · cortes, música, textos y logo · revisión · subir a la galería del producto</span></span></div>}
            </div>
            <p className="mkp-nota" style={{ marginTop: 6 }}>Las dos se cierran solas cuando el video nuevo aparece en la galería del producto.</p>
          </>}

          <div className="mkp-2">
            <label><span className="mkp-lab">Prioridad</span><select className="inp" value={prioridad} onChange={(e) => setPrioridad(e.target.value)}><option>Normal</option><option>Importante</option><option>Urgente</option></select></label>
            {tipo !== 'video' && <label><span className="mkp-lab">Fecha</span><input type="text" className="inp" value={cap(fLarga(fecha))} readOnly style={{ background: '#f8fafc' }} /></label>}
          </div>
          <label><span className="mkp-lab">{tipo === 'otro' ? 'Qué hay que hacer' : tipo === 'video' ? 'Lugar e indicaciones (opcional)' : 'Instrucciones (opcional)'}</span>
            <textarea className="inp" rows={3} value={instrucciones} onChange={(e) => setInstrucciones(e.target.value)}
              placeholder={tipo === 'otro' ? 'Ej. Ordenar el material de la sala de exhibición' : tipo === 'video' ? 'Ej. Grabar en la sala de exhibición con el equipo encendido; formato vertical para redes' : 'Ej. Tomar los datos del catálogo del fabricante'} /></label>
        </div>
        <footer><span style={{ flex: 1 }} /><button type="button" className="btn" onClick={cerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={ocupado} onClick={guardar}><Check />{ocupado ? 'Guardando…' : 'Programar'}</button></footer>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Asignar */
function ModalAsignar({ plan, inicial, personaDef, fechaDef, cerrar, aviso, listo }: {
  plan: Plan; inicial: PendientePlan; personaDef: string; fechaDef: string; cerrar: () => void; aviso: (s: string) => void; listo: () => void
}) {
  const [resp, setResp] = useState(personaDef || plan.equipo[0]?.id || '')
  const [trabajo, setTrabajo] = useState<Trabajo>(inicial?.trabajo ?? 'completar')
  const [detalle, setDetalle] = useState(inicial?.detalle ?? '')
  const [productos, setProductos] = useState<ProdBusq[]>(inicial ? [inicial.producto] : [])
  const [busca, setBusca] = useState<ProdBusq | null>(null)
  const [fecha, setFecha] = useState(fechaDef)
  const [repartir1, setRepartir1] = useState(false)
  const [prioridad, setPrioridad] = useState('Normal')
  const [instrucciones, setInstrucciones] = useState('')
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { if (busca) { setProductos((l) => (l.some((x) => x.id === busca.id) ? l : [...l, busca])); setBusca(null) } }, [busca])
  async function enviar() {
    if (!resp) { aviso('Elige a la persona.'); return }
    if (trabajo === 'otro' ? !instrucciones.trim() : !productos.length) { aviso(trabajo === 'otro' ? 'Escribe qué hay que hacer.' : 'Agrega al menos un producto.'); return }
    const items = trabajo === 'otro' ? [{ fecha }] : (repartir1 ? repartir(productos, fecha, 1) : productos.map((x) => ({ x, fecha }))).map((r) => ({ producto_id: r.x.id, fecha: r.fecha }))
    setOcupado(true)
    try {
      const r = await rpc<{ creadas: number; omitidos: { producto: string; motivo: string }[] }>('mkt_plan_asignar', { p: { responsable: resp, trabajo, detalle: esVideo(trabajo) ? detalle : '', prioridad, instrucciones, items } })
      aviso(`${r.creadas} tarea${r.creadas === 1 ? '' : 's'} asignada${r.creadas === 1 ? '' : 's'}.` + (r.omitidos.length ? ' No se asignó: ' + r.omitidos.map((o) => o.producto + ' (' + o.motivo.toLowerCase() + ')').join(', ') + '.' : ''))
      listo()
    } catch (e) { aviso((e as Error).message); setOcupado(false) }
  }
  return (
    <div className="mkp-fondo" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="mkp-modal">
        <header><div><h3>Asignar tarea</h3><p>Le llega un aviso a la persona y queda en su Agenda.</p></div><button type="button" className="x" onClick={cerrar} aria-label="Cerrar"><X className="w-4 h-4" /></button></header>
        <div className="cuerpo">
          <div className="mkp-2">
            <label><span className="mkp-lab">Persona</span><select className="inp" value={resp} onChange={(e) => setResp(e.target.value)}>{plan.equipo.map((e) => <option key={e.id} value={e.id}>{e.nombre} · {e.rol}</option>)}</select></label>
            <label><span className="mkp-lab">Trabajo</span><select className="inp" value={trabajo} onChange={(e) => setTrabajo(e.target.value as Trabajo)}>{(Object.keys(TRABAJOS) as Trabajo[]).map((k) => <option key={k} value={k}>{TRABAJOS[k].t}</option>)}</select></label>
          </div>
          <p className="mkp-nota" style={{ marginTop: 6 }}>{TRABAJOS[trabajo].d}</p>
          {esVideo(trabajo) && <label><span className="mkp-lab">Tipo de video</span><select className="inp" value={detalle} onChange={(e) => setDetalle(e.target.value)}><option value="">Cualquiera</option>{TIPOS_VIDEO.map((v) => <option key={v}>{v}</option>)}</select></label>}
          {trabajo !== 'otro' ? <>
            <span className="mkp-lab">Productos</span>
            <BuscadorProducto valor={busca} cambiar={setBusca} placeholder="Busca y agrega productos (código o nombre)…" />
            {productos.length > 0 && <div className="mkp-chips">{productos.map((x) => <span key={x.id} className="mkp-chip">{x.codigo} · {x.nombre.slice(0, 40)}<button type="button" onClick={() => setProductos((l) => l.filter((y) => y.id !== x.id))} aria-label="Quitar"><X className="w-3 h-3" /></button></span>)}</div>}
          </> : null}
          <div className="mkp-2">
            <label><span className="mkp-lab">Fecha</span><input type="date" className="inp" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
            <label><span className="mkp-lab">Prioridad</span><select className="inp" value={prioridad} onChange={(e) => setPrioridad(e.target.value)}><option>Normal</option><option>Importante</option><option>Urgente</option></select></label>
          </div>
          {trabajo !== 'otro' && productos.length > 1 && <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 mt-2"><input type="checkbox" checked={repartir1} onChange={(e) => setRepartir1(e.target.checked)} />Repartir uno por día hábil desde esa fecha</label>}
          <label><span className="mkp-lab">{trabajo === 'otro' ? 'Qué hay que hacer' : 'Instrucciones (opcional)'}</span><textarea className="inp" rows={3} value={instrucciones} onChange={(e) => setInstrucciones(e.target.value)} placeholder={trabajo === 'otro' ? 'Ej. Ordenar el material de la sala de exhibición' : 'Ej. Grabar en la sala de exhibición, con el equipo encendido'} /></label>
        </div>
        <footer><span style={{ flex: 1 }} /><button type="button" className="btn" onClick={cerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={ocupado} onClick={enviar}><Check />{ocupado ? 'Asignando…' : 'Asignar'}</button></footer>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Armar la semana */
type Sugerido = { id: string; codigo: string; nombre: string; imagen: string | null; publico: boolean; motivo: string }
function ModalArmar({ plan, personaDef, fechaDef, cerrar, aviso, listo }: {
  plan: Plan; personaDef: string; fechaDef: string; cerrar: () => void; aviso: (s: string) => void; listo: () => void
}) {
  const [resp, setResp] = useState(personaDef || plan.equipo[0]?.id || '')
  const [trabajo, setTrabajo] = useState<Trabajo>('completar')
  const [detalle, setDetalle] = useState('')
  const [cantidad, setCantidad] = useState(5)
  const [porDia, setPorDia] = useState(1)
  const [desde, setDesde] = useState(fechaDef)
  const [prioridad, setPrioridad] = useState('Normal')
  const [sug, setSug] = useState<Sugerido[] | null>(null)
  const [fuera, setFuera] = useState<Set<string>>(new Set())
  const [ocupado, setOcupado] = useState(false)
  async function sugerir() {
    setOcupado(true); setFuera(new Set())
    try { setSug(await rpc<Sugerido[]>('mkt_plan_sugerir', { p_trabajo: trabajo, p_limite: cantidad, p_detalle: trabajo === 'video' ? detalle : null })) } catch (e) { aviso((e as Error).message) }
    setOcupado(false)
  }
  const elegidos = (sug ?? []).filter((x) => !fuera.has(x.id))
  const reparto = repartir(elegidos, desde, porDia)
  async function asignarTodo() {
    if (!elegidos.length) return
    setOcupado(true)
    try {
      const r = await rpc<{ creadas: number; omitidos: { producto: string; motivo: string }[] }>('mkt_plan_asignar', { p: { responsable: resp, trabajo, detalle: trabajo === 'video' ? detalle : '', prioridad, items: reparto.map((x) => ({ producto_id: x.x.id, fecha: x.fecha })) } })
      aviso(`Semana armada: ${r.creadas} tarea${r.creadas === 1 ? '' : 's'} para ${plan.equipo.find((e) => e.id === resp)?.nombre ?? ''}.` + (r.omitidos.length ? ` ${r.omitidos.length} no se asignaron.` : ''))
      listo()
    } catch (e) { aviso((e as Error).message); setOcupado(false) }
  }
  return (
    <div className="mkp-fondo" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="mkp-modal ancho">
        <header><div><h3>Armar la semana</h3><p>La app propone los siguientes productos: visibles al público primero, luego los más cotizados, en oferta y nuevos con stock.</p></div><button type="button" className="x" onClick={cerrar} aria-label="Cerrar"><X className="w-4 h-4" /></button></header>
        <div className="cuerpo">
          <div className="mkp-2">
            <label><span className="mkp-lab">Persona</span><select className="inp" value={resp} onChange={(e) => setResp(e.target.value)}>{plan.equipo.map((e) => <option key={e.id} value={e.id}>{e.nombre} · {e.rol}</option>)}</select></label>
            <label><span className="mkp-lab">Trabajo</span><select className="inp" value={trabajo} onChange={(e) => { setTrabajo(e.target.value as Trabajo); setSug(null) }}>{(Object.keys(TRABAJOS) as Trabajo[]).filter((k) => k !== 'otro' && k !== 'produccion' && k !== 'edicion').map((k) => <option key={k} value={k}>{TRABAJOS[k].t}</option>)}</select></label>
          </div>
          {trabajo === 'video' && <label><span className="mkp-lab">Tipo de video</span><select className="inp" value={detalle} onChange={(e) => { setDetalle(e.target.value); setSug(null) }}><option value="">Productos sin ningún video</option>{TIPOS_VIDEO.map((v) => <option key={v} value={v}>Sin video {v.toLowerCase()}</option>)}</select></label>}
          <div className="mkp-2">
            <label><span className="mkp-lab">Cuántos productos</span><input type="number" min={1} max={20} className="inp" value={cantidad} onChange={(e) => { setCantidad(Math.max(1, Math.min(20, Number(e.target.value) || 1))); setSug(null) }} /></label>
            <label><span className="mkp-lab">Por día</span><input type="number" min={1} max={5} className="inp" value={porDia} onChange={(e) => setPorDia(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} /></label>
          </div>
          <div className="mkp-2">
            <label><span className="mkp-lab">Desde</span><input type="date" className="inp" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label><span className="mkp-lab">Prioridad</span><select className="inp" value={prioridad} onChange={(e) => setPrioridad(e.target.value)}><option>Normal</option><option>Importante</option><option>Urgente</option></select></label>
          </div>
          <button type="button" className="btn" style={{ marginTop: 10 }} disabled={ocupado} onClick={sugerir}><Sparkles />{sug ? 'Volver a sugerir' : 'Ver sugerencias'}</button>
          {sug && !sug.length && <p className="mkp-alerta" style={{ background: '#dcfce7', color: '#15803d' }}>No hay productos pendientes de este trabajo. ¡Todo al día!</p>}
          {sug && sug.length > 0 && (
            <div className="mkp-sug">
              {reparto.length > 0 && <p className="mkp-nota">Se reparten en días hábiles ({porDia} por día): del {fLarga(reparto[0].fecha)} al {fLarga(reparto[reparto.length - 1].fecha)}.</p>}
              {sug.map((x) => {
                const f = reparto.find((r) => r.x.id === x.id)
                return (
                  <label key={x.id} className={fuera.has(x.id) ? 'off' : ''}>
                    <input type="checkbox" checked={!fuera.has(x.id)} onChange={() => setFuera((s) => { const n = new Set(s); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n })} />
                    {x.imagen ? <img src={imagen(x.imagen, 100)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="ph" style={{ display: 'grid', placeItems: 'center' }}><ImageOff className="w-4 h-4 text-slate-300" /></span>}
                    <span className="min-w-0 flex-1"><b>{x.nombre}</b><small>{x.codigo}{x.motivo ? ' · ' + x.motivo : ''}</small></span>
                    {f && <span className="text-[11px] font-bold text-slate-500 shrink-0" style={{ textTransform: 'capitalize' }}>{fCorta(f.fecha)}</span>}
                  </label>
                )
              })}
            </div>
          )}
          {!plan.equipo.length && <p className="mkp-alerta" style={{ background: '#fef3c7', color: '#92400e' }}><AlertTriangle className="w-4 h-4 inline" /> No hay personas en el equipo de Marketing.</p>}
        </div>
        <footer><span style={{ flex: 1 }} /><button type="button" className="btn" onClick={cerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={ocupado || !elegidos.length || !resp} onClick={asignarTodo}><Check />{ocupado ? 'Asignando…' : `Asignar ${elegidos.length || ''} tarea${elegidos.length === 1 ? '' : 's'}`}</button></footer>
      </div>
    </div>
  )
}
