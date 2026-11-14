import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, BarChart3, CheckCheck, Boxes, FileText, ImageOff, ImagePlus, MoveRight, PackagePlus, Pencil, Plus, RefreshCw, RotateCcw, Search, Ship, Trash2, Unlock, X,
} from 'lucide-react'
import { imagenWebp, subirCatalogo } from './audiovisualMedios'
import { supabase, type Perfil } from '../supabase'
import { agrupar } from '../tiempoReal'
import { puede } from '../permisos'
import { imagen } from './inventarioUtil'
import { ConfirmarEliminar } from './CrmClientes'
import '../estilos/importaciones.css'
// Recepción por línea (RecepcionImportacion.gs): se carga solo al abrirla
const Recepcion = lazy(() => import('./RecepcionImportaciones'))

/* ============================ Datos y utilidades ============================ */
const ETAPAS = ['Borrador', 'Registrado', 'En tránsito', 'En aduana', 'En bodega', 'Ingresado']
const MANUALES = ['Registrado', 'En tránsito', 'En aduana', 'En bodega']
const COLOR_ET: Record<string, string> = { Borrador: '#94a3b8', Registrado: '#6366f1', 'En tránsito': '#0284c7', 'En aduana': '#7c3aed', 'En bodega': '#d97706', Ingresado: '#04896f' }
type Flujo = { etapa?: string; eta?: string; observaciones?: string; enviado?: { fecha: string; por: string } | null }
type Res = { etapa: string; unidades: number; lineas: number; aprobada: number; enST: number; devuelta: number; noReparable: number; faltante: number; porRecibir: number; pendiente: number; sinIdentificar: number; nuevos: number; novedades: number; miniaturas: string[] }
type Exp = { id: string; codigo: string; nombre: string; proveedor: string; pais: string; etapa: string; eta: string; observaciones: string; enviado: Flujo['enviado']; flujo: Flujo; lineas: number; unidades: number; res?: Res }
type Linea = { id: string; codigo: string; productoId: string | null; codigoProducto: string; nombre: string; imagen: string; categoria: string; marca: string; cantidad: number; obs: string; tipo: string; reservado: string; deseado: string; prefijo: string; descripcion: string; modelo: string }
// Avance de la recepción por línea (imp_detalle)
type LinAv = { itemId: string; tipo: string; producto: string; nombre: string; cantidad: number; recibida: number; faltante: number; porRecibir: number; pendiente: number; aprobada: number; enST: number; devuelta: number; noReparable: number }
type Det = { etapa: string; reabrible: boolean; lineas: LinAv[]; ordenes: { id: string; fecha: string; producto: string; modelo: string; cantidad: number; defecto: string; estado: string; reparadas: number; noReparables: number }[]; graficos: { danos: Record<string, number>; porDia: Record<string, number>; diasST: number | null; tasaProveedor: number | null; revisionesProveedor: number } }
type Prod = { id: string; codigo: string; codigo_unico: string | null; nombre: string; marca: string | null; stock: number | null; imagen_url: string | null }

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const hoy = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10)
const sumarDias = (d: string, n: number) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
const fCorta = (s: string) => { if (!s) return ''; const d = new Date(String(s).length === 10 ? s + 'T12:00:00' : s); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' }) }
const hace = (s: string) => { const t = new Date(s).getTime(); if (!t) return ''; const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'ahora' : m < 60 ? 'hace ' + m + ' min' : m < 1440 ? 'hace ' + Math.round(m / 60) + ' h' : 'hace ' + Math.round(m / 1440) + ' d' }
const siguienteEtapa = (c: { etapa: string; unidades: number }) => {
  if (c.etapa === 'Borrador') return 'confirmar'
  const i = MANUALES.indexOf(c.etapa)
  if (i === -1 || i >= MANUALES.length - 1) return ''
  return MANUALES[i + 1]
}
const atrasada = (c: Exp) => !!c.eta && c.eta < hoy() && !['Borrador', 'Ingresado', 'En bodega'].includes(c.etapa)

/* ============================ Pantalla principal ============================ */
export default function Importaciones({ perfil, aviso, accion, limpiarAccion }: { perfil: Perfil; aviso: (t: string) => void; accion?: string | null; limpiarAccion?: () => void }) {
  const [lista, setLista] = useState<Exp[] | null>(null)
  const [proveedores, setProveedores] = useState<{ nombre: string; pais: string | null }[]>([])
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [fProv, setFProv] = useState('')
  const [vista, setVista] = useState<'tablero' | 'panel' | 'recepcion'>('tablero')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [nueva, setNueva] = useState(false)
  const [papelera, setPapelera] = useState(false)
  const [menuMover, setMenuMover] = useState<Exp | null>(null)
  const [arrastre, setArrastre] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const [deshacer, setDeshacer] = useState<{ texto: string; fn: () => void } | null>(null)
  const timerDeshacer = useRef<number | undefined>(undefined)
  const puedeCrear = puede(perfil, 'importaciones', 'crear')

  // Acceso directo de la barra lateral: "Nuevo ingreso" abre el formulario de una vez.
  useEffect(() => {
    if (accion === 'ingreso') setNueva(true)
    if (accion) limpiarAccion?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accion])

  const cargar = useCallback(async () => {
    const [e, it, p, tb] = await Promise.all([
      supabase.from('imp_expedientes').select('id,codigo,nombre,proveedor_texto,pais_origen,flujo,estado').is('deleted_at', null).order('created_at', { ascending: false }).limit(500),
      supabase.from('imp_items').select('pedido_codigo,cantidad').is('deleted_at', null).limit(10000),
      supabase.from('proveedores').select('nombre:razon_social,pais').is('deleted_at', null).order('razon_social').limit(500),
      supabase.rpc('imp_tablero'),
    ])
    const resumen = ((tb.data ?? {}) as Record<string, Res>)
    if (e.error) { setError(e.error.message); return }
    setError('')
    const tot: Record<string, { n: number; u: number }> = {}
    ;((it.data ?? []) as { pedido_codigo: string; cantidad: number }[]).forEach((x) => { const t = (tot[x.pedido_codigo] = tot[x.pedido_codigo] || { n: 0, u: 0 }); t.n++; t.u += Number(x.cantidad) || 0 })
    type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    setLista(((e.data ?? []) as R[]).map((x) => {
      const f = (x.flujo ?? {}) as Flujo
      const r = resumen[x.codigo] // la etapa real sale de la recepción (En bodega / Ingresado)
      return { id: x.id, codigo: x.codigo, nombre: x.nombre ?? '', proveedor: x.proveedor_texto ?? '', pais: x.pais_origen ?? '', etapa: r?.etapa || f.etapa || (ETAPAS.includes(x.estado) ? x.estado : 'Registrado'), eta: f.eta ?? '', observaciones: f.observaciones ?? '', enviado: f.enviado ?? null, flujo: f, lineas: tot[x.codigo]?.n ?? 0, unidades: tot[x.codigo]?.u ?? 0, res: r }
    }))
    setProveedores((p.data ?? []) as { nombre: string; pais: string | null }[])
  }, [])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => {
    const recargar = agrupar(() => cargar())
    const c = supabase.channel('imp-exp').on('postgres_changes', { event: '*', schema: 'public', table: 'imp_expedientes' }, recargar).subscribe()
    return () => { recargar.cancelar(); supabase.removeChannel(c) }
  }, [cargar])

  const filtrados = useMemo(() => {
    const pal = norm(q).trim().split(/\s+/).filter(Boolean)
    return (lista ?? []).filter((c) => (!fProv || c.proveedor === fProv) && (!pal.length || pal.every((w) => norm([c.codigo, c.nombre, c.proveedor, c.pais].join(' ')).includes(w))))
  }, [lista, q, fProv])
  const provs = useMemo(() => [...new Set((lista ?? []).map((c) => c.proveedor).filter(Boolean))].sort(), [lista])
  const l = lista ?? []
  const kpis: [string, string | number, boolean?][] = [
    ['En tránsito', l.filter((c) => ['En tránsito', 'En aduana'].includes(c.etapa)).reduce((a, c) => a + c.unidades, 0) + ' u.'],
    ['En bodega', l.filter((c) => c.etapa === 'En bodega').length],
    ['Con novedades', l.filter((c) => c.etapa !== 'Ingresado').reduce((a, c) => a + (c.res?.novedades ?? 0), 0) + ' u.'],
    ['En reparación', l.reduce((a, c) => a + (c.res?.enST ?? 0) + (c.res?.devuelta ?? 0), 0) + ' u.'],
    ['Atrasadas', l.filter(atrasada).length, l.some(atrasada)],
  ]

  async function mover(c: Exp, etapa: string) {
    if (c.etapa === etapa) return
    if (c.etapa === 'Borrador') { aviso('Primero confirma la lista de productos.'); return }
    if (c.etapa === 'Ingresado') { aviso('Ya ingresó al inventario.'); return }
    if (!MANUALES.includes(etapa)) { aviso(etapa === 'Ingresado' ? '"Ingresado" lo marca el sistema cuando Bodega termina la revisión.' : 'No se puede mover ahí.'); return }
    const antes = c.etapa
    const ok = await guardarEtapa(c, etapa)
    if (!ok) return
    window.clearTimeout(timerDeshacer.current)
    setDeshacer({ texto: `${c.codigo} → ${etapa}`, fn: () => { guardarEtapa({ ...c, etapa }, antes === 'Borrador' ? 'Registrado' : antes) } })
    timerDeshacer.current = window.setTimeout(() => setDeshacer(null), 6000)
  }
  async function guardarEtapa(c: Exp, etapa: string) {
    setLista((a) => (a ?? []).map((x) => (x.id === c.id ? { ...x, etapa } : x)))
    const { error } = await supabase.from('imp_expedientes').update({ flujo: { ...c.flujo, etapa }, estado: etapa }).eq('id', c.id)
    if (error) { aviso('No se pudo mover: ' + error.message); cargar(); return false }
    return true
  }

  const botonSig = (c: Exp) => {
    const n = siguienteEtapa(c)
    if (!n) return null
    if (n === 'confirmar') return c.unidades ? <button className="sig" onClick={(e) => { e.stopPropagation(); setAbierto(c.codigo) }}><CheckCheck />Confirmar lista</button> : null
    return <button className="sig" onClick={(e) => { e.stopPropagation(); mover(c, n) }}><ArrowRight />Pasar a {n}</button>
  }
  const tarjeta = (c: Exp) => {
    const t = c.unidades, mueve = MANUALES.includes(c.etapa)
    const av = atrasada(c) ? 'Atrasada · llegaba ' + fCorta(c.eta) : ''
    const info = [c.proveedor, t ? `${c.lineas ? c.lineas + ' ítem' + (c.lineas === 1 ? '' : 's') + ' · ' : ''}${t} u.` : c.etapa === 'Borrador' ? 'sin productos' : '', c.eta && !['Borrador', 'Ingresado', 'En bodega'].includes(c.etapa) && !atrasada(c) ? 'llega ' + fCorta(c.eta) : ''].filter(Boolean)
    return (
      <div key={c.id} className={'card' + (c.etapa === 'Borrador' ? ' borr' : '') + (av ? ' al' : '')} draggable={mueve} onClick={() => setAbierto(c.codigo)}
        onDragStart={(e) => { setArrastre(c.codigo); e.dataTransfer.setData('text/plain', c.codigo) }} onDragEnd={() => { setArrastre(null); setSobre(null) }}>
        {mueve && <button className="mover" title="Mover a…" onClick={(e) => { e.stopPropagation(); setMenuMover(c) }}><MoveRight style={{ width: 14, height: 14 }} /></button>}
        <span className="cod">{c.codigo}</span><h4>{c.nombre}</h4>
        <div className="sub">{info.join(' · ')}{av && <span className="av">{av}</span>}</div>
        {c.res && ['En bodega', 'Ingresado'].includes(c.etapa) && c.res.unidades > 0 && <div className="chips"><span className="chip ok">{c.res.aprobada} en inventario</span>{c.res.enST + c.res.devuelta > 0 && <span className="chip vi">{c.res.enST + c.res.devuelta} en reparación</span>}{c.res.porRecibir + c.res.pendiente > 0 && <span className="chip wa">{c.res.porRecibir + c.res.pendiente} por recibir o revisar</span>}</div>}
        {c.res && c.res.sinIdentificar > 0 && c.etapa !== 'Borrador' && <div className="chips"><span className="chip bl">{c.res.sinIdentificar} por identificar en Marketing</span></div>}
        {botonSig(c)}
      </div>
    )
  }

  const detalleAbierto = abierto ? (lista ?? []).find((c) => c.codigo === abierto) ?? null : null

  return (
    <div className="vm-imp">
      <header className="hdr"><div className="hdr-in">
        <div className="ico"><Ship style={{ width: 20, height: 20 }} /></div>
        <div className="min-w-0"><h1>Importaciones</h1><p>Contenedores, productos y avance de la recepción · {perfil.nombre}</p></div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {puedeCrear && <button className="btn btn-w" onClick={() => setNueva(true)} title="Nueva importación (N)"><Plus />Nueva importación</button>}
          {puede(perfil, 'importaciones', 'eliminar') && <button className="btn btn-g" onClick={() => setPapelera(true)} title="Papelera (importaciones eliminadas)"><Trash2 /></button>}
          <button className="btn btn-g" onClick={cargar} title="Actualizar"><RefreshCw /></button>
        </div>
      </div></header>

      <main className="wrap">
        <div className="kpis">{kpis.map(([t, v, al]) => <div key={t} className={'kpi' + (al ? ' al' : '')}><span>{t}</span><b>{v}</b></div>)}</div>
        <div className="barra">
          <div className="seg"><button className={vista === 'tablero' ? 'on' : ''} onClick={() => setVista('tablero')}>Tablero</button><button className={vista === 'recepcion' ? 'on' : ''} onClick={() => setVista('recepcion')}>Recepción</button><button className={vista === 'panel' ? 'on' : ''} onClick={() => setVista('panel')}>Panel</button></div>
          <div className="busca"><Search /><input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código, nombre o proveedor  ( / )" /></div>
          <select className="inp" style={{ width: 'auto', minWidth: 170 }} value={fProv} onChange={(e) => setFProv(e.target.value)}><option value="">Todos los proveedores</option>{provs.map((p) => <option key={p}>{p}</option>)}</select>
        </div>

        {vista === 'tablero' && (
          <div><div className="tab">
            {error && <div className="vacio" style={{ width: '100%', color: '#c0392b' }}>{error}</div>}
            {!error && lista === null && <div className="vacio" style={{ width: '100%' }}><span className="spin" /> Cargando…</div>}
            {lista !== null && ETAPAS.map((e) => {
              const cs = filtrados.filter((c) => c.etapa === e), u = cs.reduce((a, c) => a + c.unidades, 0)
              return (
                <div key={e} className={'col' + (sobre === e ? ' sobre' : '')}
                  onDragOver={(ev) => { if (arrastre && MANUALES.includes(e)) { ev.preventDefault(); setSobre(e) } }} onDragLeave={() => setSobre(null)}
                  onDrop={(ev) => { ev.preventDefault(); setSobre(null); const c = (lista ?? []).find((x) => x.codigo === arrastre); if (c) mover(c, e) }}>
                  <div className="col-h"><span className="pt" style={{ background: COLOR_ET[e] }} />{e} <span className="chip">{cs.length}</span><small>{u} u.</small></div>
                  <div className="cards">{cs.length ? cs.map(tarjeta) : <div className="vacio">{e === 'Borrador' ? 'Crea una importación con "Nueva importación"' : 'Sin importaciones'}</div>}</div>
                </div>
              )
            })}
          </div></div>
        )}
        {vista === 'recepcion' && <Suspense fallback={<div className="sec" style={{ textAlign: 'center', padding: 28 }}>Cargando…</div>}><Recepcion perfil={perfil} aviso={aviso} area="importacion" /></Suspense>}
        {vista === 'panel' && <Panel q={q} />}
      </main>

      {detalleAbierto && <Detalle exp={detalleAbierto} perfil={perfil} proveedores={proveedores} cerrar={() => { setAbierto(null); cargar() }} aviso={aviso} mover={mover} recargar={cargar} />}
      {papelera && <PapeleraImp cerrar={() => setPapelera(false)} aviso={aviso} restaurado={cargar} />}
      {nueva && <NuevaImportacion perfil={perfil} proveedores={proveedores} lista={lista ?? []} cerrar={() => setNueva(false)} creado={(codigo) => { setNueva(false); cargar().then(() => setAbierto(codigo)) }} aviso={aviso} />}
      {menuMover && (
        <div className="sheet-o" onClick={(e) => { if (e.target === e.currentTarget) setMenuMover(null) }}>
          <div className="sheet">
            <h3 className="font-display font-bold text-lg mb-1" style={{ color: 'var(--navy)' }}>Mover {menuMover.codigo}</h3><p className="text-xs text-slate-500 mb-3">{menuMover.nombre}</p>
            <div style={{ display: 'grid', gap: 8 }}>{MANUALES.map((e) => <button key={e} className={'btn' + (e === menuMover.etapa ? ' btn-p' : '')} onClick={() => { const c = menuMover; setMenuMover(null); mover(c, e) }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: COLOR_ET[e] }} />{e}</button>)}</div>
          </div>
        </div>
      )}
      {deshacer && <div className="toast"><span>{deshacer.texto}</span><button onClick={() => { const f = deshacer.fn; setDeshacer(null); f() }}>Deshacer</button></div>}
    </div>
  )
}

/* ============================ Nueva importación ============================ */
function NuevaImportacion({ perfil, proveedores, lista, cerrar, creado, aviso }: { perfil: Perfil; proveedores: { nombre: string; pais: string | null }[]; lista: Exp[]; cerrar: () => void; creado: (codigo: string) => void; aviso: (t: string) => void }) {
  const mes = (new Date().toLocaleDateString('es-EC', { month: 'long' }) + ' ' + new Date().getFullYear()).toUpperCase()
  const [prov, setProv] = useState('')
  const [nom, setNom] = useState('IMPORTACIÓN ' + mes)
  const [tocado, setTocado] = useState(false)
  const [pais, setPais] = useState('')
  const [eta, setEta] = useState(sumarDias(hoy(), 90))
  const [guardando, setGuardando] = useState(false)
  const ultima = lista.find((c) => c.proveedor && norm(c.proveedor) === norm(prov))
  const [copiar, setCopiar] = useState(false)
  function cambiaProv(v: string) {
    setProv(v)
    if (!tocado) setNom('IMPORTACIÓN ' + mes + (v ? ' · ' + v.toUpperCase().slice(0, 30) : ''))
    const p = proveedores.find((x) => norm(x.nombre) === norm(v))
    if (p?.pais) setPais(p.pais)
  }
  async function crear() {
    if (!prov.trim() || !nom.trim()) { aviso('Escribe el proveedor y el nombre.'); return }
    setGuardando(true)
    const p = proveedores.find((x) => norm(x.nombre) === norm(prov))
    const codigo = 'PI-' + crypto.randomUUID().slice(0, 6).toUpperCase()
    const id = crypto.randomUUID()
    const { error } = await supabase.from('imp_expedientes').insert({
      id, codigo, nombre: nom.trim(), proveedor_texto: prov.trim(), pais_origen: pais.trim() || null, estado: 'Borrador', origen: 'interno', fecha_ingreso: null,
      flujo: { etapa: 'Borrador', eta: eta || '', observaciones: '', enviado: null },
    })
    if (error) { setGuardando(false); aviso('No se pudo crear: ' + error.message); return }
    if (copiar && ultima) {
      const { data } = await supabase.from('imp_items').select('producto_id,codigo_producto,nombre_snapshot,imagen_referencia,categoria,marca,modelo,cantidad,observaciones').eq('pedido_codigo', ultima.codigo).is('deleted_at', null)
      const filas = ((data ?? []) as Record<string, unknown>[]).map((x) => ({ ...x, id: crypto.randomUUID(), codigo: 'IT-' + crypto.randomUUID().slice(0, 8).toUpperCase(), pedido_codigo: codigo, expediente_id: id, tipo_linea: 'Existente' }))
      if (filas.length) await supabase.from('imp_items').insert(filas)
    }
    void p; void perfil
    creado(codigo)
  }
  return (
    <div className="sheet-o" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="sheet">
        <h3 className="font-display font-bold text-lg mb-1" style={{ color: 'var(--navy)' }}>Nueva importación</h3><p className="text-xs text-slate-500 mb-3">Se guarda como borrador: puedes editarla hasta confirmar la lista.</p>
        <div style={{ display: 'grid', gap: 10 }}>
          <label className="f">Proveedor *<input className="inp" list="dlProvImp" autoComplete="off" value={prov} onChange={(e) => cambiaProv(e.target.value)} placeholder="Escribe o elige" /></label>
          <datalist id="dlProvImp">{proveedores.map((p) => <option key={p.nombre} value={p.nombre} />)}</datalist>
          <label className="f">Nombre o referencia *<input className="inp" value={nom} onChange={(e) => { setNom(e.target.value); setTocado(true) }} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="f">País de origen<input className="inp" value={pais} onChange={(e) => setPais(e.target.value)} placeholder="China" /></label>
            <label className="f">Llegada estimada<input className="inp" type="date" value={eta} onChange={(e) => setEta(e.target.value)} /></label>
          </div>
          {ultima && <label className="text-[12.5px] font-semibold" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={copiar} onChange={(e) => setCopiar(e.target.checked)} /> <span>Copiar los productos de la última de este proveedor ({ultima.codigo})</span></label>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button className="btn" style={{ flex: 1 }} onClick={cerrar}>Cancelar</button><button className="btn btn-p" style={{ flex: 1 }} onClick={crear} disabled={guardando}>{guardando ? 'Creando…' : <><CheckCheck />Crear borrador</>}</button></div>
      </div>
    </div>
  )
}

/* ============================ Detalle de una importación ============================ */
function Detalle({ exp, perfil, proveedores, cerrar, aviso, mover, recargar }: { exp: Exp; perfil: Perfil; proveedores: { nombre: string; pais: string | null }[]; cerrar: () => void; aviso: (t: string) => void; mover: (c: Exp, etapa: string) => Promise<void>; recargar: () => void }) {
  const [d, setD] = useState<Exp>(exp)
  const [lineas, setLineas] = useState<Linea[] | null>(null)
  const [pestana, setPestana] = useState<'productos' | 'avance'>('productos')
  const [elim, setElim] = useState(false)
  const [guardado, setGuardado] = useState(true)
  const timers = useRef<Record<string, number>>({})
  const editable = d.etapa === 'Borrador'
  // Con la lista confirmada se puede agregar o aumentar cantidades hasta que ingrese al inventario (versión 4)
  const agregable = !editable && d.etapa !== 'Ingresado'
  const [det, setDet] = useState<Det | null>(null)
  const [nuevoEq, setNuevoEq] = useState<Linea | 'nuevo' | null>(null)
  const cargarDetalle = useCallback(() => { supabase.rpc('imp_detalle', { p_codigo: exp.codigo }).then(({ data }) => { if (data) setDet(data as Det) }) }, [exp.codigo])
  useEffect(() => { cargarDetalle() }, [cargarDetalle])
  const reabrible = !!det?.reabrible && !!d.enviado

  const cargarLineas = useCallback(() => {
    supabase.from('imp_items').select('id,codigo,producto_id,codigo_producto,nombre_snapshot,imagen_referencia,categoria,marca,cantidad,observaciones,tipo_linea,codigo_reservado,codigo_deseado,prefijo,descripcion,modelo').eq('pedido_codigo', exp.codigo).is('deleted_at', null).gt('cantidad', 0).order('created_at').then(({ data }) => {
      setLineas(((data ?? []) as Record<string, any>[]).map((x) => ({ id: x.id, codigo: x.codigo, productoId: x.producto_id, codigoProducto: x.codigo_producto ?? '', nombre: x.nombre_snapshot || x.descripcion || x.modelo || '', imagen: x.imagen_referencia ?? '', categoria: x.categoria ?? '', marca: x.marca ?? '', cantidad: Number(x.cantidad) || 0, obs: x.observaciones ?? '',
        tipo: x.tipo_linea ?? '', reservado: x.codigo_reservado ?? '', deseado: x.codigo_deseado ?? '', prefijo: x.prefijo ?? '', descripcion: x.descripcion ?? '', modelo: x.modelo ?? '' }))) // eslint-disable-line @typescript-eslint/no-explicit-any
    })
  }, [exp.codigo])
  useEffect(() => { cargarLineas() }, [cargarLineas])
  useEffect(() => { setD((x) => ({ ...x, etapa: exp.etapa })) }, [exp.etapa])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])

  const unidades = (lineas ?? []).reduce((a, l) => a + l.cantidad, 0)
  const ie = ETAPAS.indexOf(d.etapa)

  async function guardarCampo(campo: 'nombre' | 'proveedor' | 'pais' | 'eta' | 'observaciones', valor: string) {
    if (['nombre', 'proveedor'].includes(campo) && !valor.trim()) { aviso('No puede quedar vacío.'); return }
    const nuevo = { ...d, [campo]: valor }
    setD(nuevo); setGuardado(false)
    const flujo = { ...d.flujo, etapa: nuevo.etapa, eta: nuevo.eta, observaciones: nuevo.observaciones, enviado: nuevo.enviado }
    const cols: Record<string, unknown> = { flujo }
    if (campo === 'nombre') cols.nombre = valor; if (campo === 'proveedor') cols.proveedor_texto = valor; if (campo === 'pais') cols.pais_origen = valor
    const { error } = await supabase.from('imp_expedientes').update(cols).eq('id', d.id)
    setGuardado(true)
    if (error) aviso('No se guardó: ' + error.message)
  }
  const programar = (campo: Parameters<typeof guardarCampo>[0], valor: string) => { window.clearTimeout(timers.current[campo]); timers.current[campo] = window.setTimeout(() => guardarCampo(campo, valor), 900) }

  async function guardarLinea(l: Linea) {
    setGuardado(false)
    const { error } = await supabase.from('imp_items').update({ cantidad: l.cantidad, observaciones: l.obs || null }).eq('id', l.id)
    setGuardado(true)
    if (error) aviso('No se guardó la línea: ' + error.message)
  }
  function ponCant(l: Linea, n: number) {
    n = Math.max(0, Math.floor(Number(n) || 0))
    if (n === 0) { quitar(l); return }
    const nl = { ...l, cantidad: n }
    setLineas((a) => (a ?? []).map((x) => (x.id === l.id ? nl : x))); guardarLinea(nl)
  }
  async function quitar(l: Linea) {
    setLineas((a) => (a ?? []).filter((x) => x.id !== l.id))
    const { error } = await supabase.from('imp_items').update({ deleted_at: new Date().toISOString() }).eq('id', l.id)
    if (error) { aviso('No se pudo quitar: ' + error.message); cargarLineas() }
  }
  // Lista confirmada: agregar o aumentar por la base (no deja bajar cantidades)
  async function linea(op: Record<string, unknown>, ok: string) {
    setGuardado(false)
    const { error } = await supabase.rpc('imp_linea', { p_codigo: d.codigo, p: op })
    setGuardado(true)
    if (error) { aviso(error.message); return false }
    aviso(ok); cargarLineas(); cargarDetalle(); recargar(); return true
  }
  async function agregarProducto(p: Prod, cant: number) {
    if (!editable) { await linea({ op: 'linea', producto: p.codigo, cantidad: String(cant) }, 'Agregadas ' + cant + ' u. de ' + p.nombre); return }
    const ya = (lineas ?? []).find((x) => x.productoId === p.id)
    if (ya) { ponCant(ya, ya.cantidad + cant); aviso('Sumadas ' + cant + ' u. de ' + p.nombre); return }
    const { error } = await supabase.from('imp_items').insert({
      id: crypto.randomUUID(), codigo: 'IT-' + crypto.randomUUID().slice(0, 8).toUpperCase(), pedido_codigo: d.codigo, expediente_id: d.id, producto_id: p.id, codigo_producto: p.codigo,
      nombre_snapshot: p.nombre, imagen_referencia: p.imagen_url, marca: p.marca, cantidad: cant, tipo_linea: 'Existente',
    })
    if (error) { aviso('No se pudo agregar: ' + error.message); return }
    aviso('Agregadas ' + cant + ' u. de ' + p.nombre); cargarLineas()
  }
  // Confirmar lista: reserva los códigos de los equipos nuevos y envía el listado a Marketing (vmTabConfirmar)
  async function confirmar() {
    if (!(lineas ?? []).length) { aviso('Agrega al menos un producto.'); return }
    if (!d.proveedor.trim()) { aviso('Falta el proveedor.'); return }
    const { data, error } = await supabase.rpc('imp_confirmar', { p_codigo: d.codigo })
    if (error) { aviso('No se pudo confirmar: ' + error.message); return }
    const r = data as { reservados?: string[]; porIdentificar?: number }
    setD({ ...d, etapa: 'Registrado', enviado: { fecha: new Date().toISOString(), por: perfil.nombre } })
    aviso('Lista confirmada' + (r.reservados?.length ? ': códigos ' + r.reservados.join(', ') : '') + (r.porIdentificar ? ' · ' + r.porIdentificar + ' por identificar en Marketing' : '') + '.')
    cargarLineas(); cargarDetalle(); recargar()
  }
  async function reabrir() {
    const { error } = await supabase.rpc('imp_reabrir', { p_codigo: d.codigo })
    if (error) { aviso('No se pudo reabrir: ' + error.message); return }
    setD({ ...d, etapa: 'Borrador', enviado: null }); cargarLineas(); cargarDetalle(); recargar()
  }
  async function cambiarCodigo(l: Linea) {
    const nuevo = window.prompt('Nuevo código para ' + (l.descripcion || l.modelo) + ' (prefijo + número):', l.reservado || l.deseado)
    if (!nuevo || nuevo.trim().toUpperCase() === (l.reservado || l.deseado)) return
    const { error } = await supabase.rpc('imp_cambiar_codigo', { p_codigo: d.codigo, p_item: l.codigo, p_nuevo: nuevo.trim() })
    if (error) { aviso(error.message); return }
    aviso('Código cambiado a ' + nuevo.trim().toUpperCase()); cargarLineas()
  }
  async function eliminar(motivo: string) {
    const { error } = await supabase.from('imp_expedientes').update({ deleted_at: new Date().toISOString(), motivo_eliminacion: motivo || null } as never).eq('id', d.id)
    if (error) { aviso('No se pudo eliminar: ' + error.message); return }
    setElim(false); aviso('Borrador enviado a la papelera.'); cerrar()
  }
  const sig = siguienteEtapa({ etapa: d.etapa, unidades })

  return (
    <div className="panel">
      <div className="hdr ph"><div className="hdr-in">
        <button className="btn btn-g btn-sm" onClick={cerrar} title="Volver (Esc)"><ArrowLeft /></button>
        <div className="min-w-0" style={{ flex: 1 }}>
          <p style={{ font: "700 16px 'Space Grotesk',Inter,sans-serif", color: '#fff', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.codigo} · {d.nombre}</p>
          <p>{[d.proveedor, d.pais].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="estado">{guardado ? '✓ Guardado' : 'Guardando…'}</span>
        <span className="chip" style={{ background: COLOR_ET[d.etapa], color: '#fff' }}>{d.etapa}</span>
        {sig === 'confirmar' ? (lineas?.length ? <button className="btn btn-sm btn-sig" onClick={confirmar}><CheckCheck />Confirmar lista</button> : null)
          : sig ? <button className="btn btn-sm btn-sig" onClick={() => { mover(d, sig); setD({ ...d, etapa: sig }) }}><ArrowRight />Pasar a {sig}</button> : null}
      </div></div>

      <div className="wrap">
        <div className="sec" style={{ padding: '10px 14px' }}><div className="pasos">
          {ETAPAS.map((e, i) => <button key={e} className={i < ie ? 'h' : i === ie ? 'a' : ''} disabled={!(MANUALES.includes(e) && !editable && d.etapa !== 'Ingresado')} onClick={() => { mover(d, e); setD({ ...d, etapa: e }) }}><i />{e}</button>)}
        </div></div>

        <div className="sec"><h3><FileText />Datos</h3>
          <div className="grid2">
            <label className="f">Nombre o referencia<input className="inp" value={d.nombre} readOnly={!editable} onChange={(e) => { setD({ ...d, nombre: e.target.value }); programar('nombre', e.target.value) }} /></label>
            <label className="f">Proveedor<input className="inp" list="dlProvDet" value={d.proveedor} readOnly={!editable} onChange={(e) => { setD({ ...d, proveedor: e.target.value }); programar('proveedor', e.target.value) }} /></label>
            <datalist id="dlProvDet">{proveedores.map((p) => <option key={p.nombre} value={p.nombre} />)}</datalist>
            <label className="f">País de origen<input className="inp" value={d.pais} readOnly={!editable} onChange={(e) => { setD({ ...d, pais: e.target.value }); programar('pais', e.target.value) }} /></label>
            <label className="f">Llegada estimada<input className="inp" type="date" value={d.eta} readOnly={d.etapa === 'Ingresado'} onChange={(e) => { setD({ ...d, eta: e.target.value }); programar('eta', e.target.value) }} /></label>
          </div>
          <label className="f" style={{ marginTop: 10 }}>Notas<textarea className="inp" rows={2} value={d.observaciones} readOnly={d.etapa === 'Ingresado'} onChange={(e) => { setD({ ...d, observaciones: e.target.value }); programar('observaciones', e.target.value) }} /></label>
        </div>

        <div className="seg" style={{ marginBottom: 12 }}>
          <button className={pestana === 'productos' ? 'on' : ''} onClick={() => setPestana('productos')}>Productos ({lineas?.length ?? 0} ítem{lineas?.length === 1 ? '' : 's'})</button>
          <button className={pestana === 'avance' ? 'on' : ''} onClick={() => setPestana('avance')}>Avance</button>
        </div>

        {pestana === 'productos' && (
          <div className="sec">
            {lineas && lineas.length > 0 && <h3><Boxes />Productos <span className="chip">{lineas.length} ítem{lineas.length === 1 ? '' : 's'} · {unidades} unidades</span></h3>}
            {lineas === null && <p className="text-slate-500 text-sm" style={{ textAlign: 'center', padding: 18 }}>Cargando productos…</p>}
            {lineas && !lineas.length && <div style={{ textAlign: 'center', padding: '18px 0 6px' }}><p className="text-slate-500 text-sm mb-3">Aún no hay productos en esta importación.</p></div>}
            {lineas?.map((l, n) => (
              <div key={l.id} className="lin" title="Producto de la importación">
                <span className="lin-n" title={`Ítem ${n + 1} de ${lineas.length}`}>{n + 1}</span>
                {l.imagen ? <img loading="lazy" src={imagen(l.imagen, 120)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <div className="sinimg"><ImageOff /></div>}
                <div className="min-w-0"><b>{l.nombre}</b><small>{l.codigoProducto || (l.reservado ? 'Código reservado ' + l.reservado : l.deseado ? 'Código pedido ' + l.deseado : l.prefijo ? 'Prefijo ' + l.prefijo : '')}{l.marca ? ' · ' + l.marca : ''}{l.modelo && l.modelo !== l.nombre ? ' · ' + l.modelo : ''}</small>
                  {!l.productoId && <div className="chips"><span className="chip bl">Equipo nuevo</span>{(l.reservado || l.deseado) && <button className="chip" style={{ border: 0, cursor: 'pointer' }} onClick={() => cambiarCodigo(l)}>Cambiar código</button>}</div>}
                  {editable ? <input className="inp" value={l.obs} placeholder="Nota (opcional)" style={{ marginTop: 5, padding: '5px 8px', fontSize: 12 }}
                      onChange={(e) => { const nl = { ...l, obs: e.target.value }; setLineas((a) => (a ?? []).map((x) => (x.id === l.id ? nl : x))); window.clearTimeout(timers.current['o' + l.id]); timers.current['o' + l.id] = window.setTimeout(() => guardarLinea(nl), 900) }} />
                    : l.obs ? <small>Nota: {l.obs}</small> : null}</div>
                {editable ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div className="qty"><button onClick={() => ponCant(l, l.cantidad - 1)}>–</button><input type="number" min={0} value={l.cantidad} onChange={(e) => ponCant(l, Number(e.target.value))} /><button onClick={() => ponCant(l, l.cantidad + 1)}>+</button></div>
                    <button className="btn btn-sm" title={l.productoId ? 'Editar producto' : 'Editar equipo nuevo'} onClick={() => (l.productoId ? aviso('Editar el producto: ábrelo desde Inventario.') : setNuevoEq(l))}><Pencil /></button>
                    <button className="btn btn-sm btn-red" title="Quitar" onClick={() => quitar(l)}><X /></button>
                  </div>
                ) : <div style={{ textAlign: 'right' }}><b style={{ font: "700 16px 'Space Grotesk',Inter,sans-serif" }}>{l.cantidad}</b>
                  {agregable && <div style={{ marginTop: 4 }}><button className="btn btn-sm" title="Aumentar (lista confirmada: solo se puede agregar)" onClick={() => (l.productoId ? linea({ op: 'linea', item: l.codigo, producto: l.codigoProducto, cantidad: String(l.cantidad + 1) }, '+1 ' + l.nombre) : linea({ op: 'nuevo', item: l.codigo, cantidad: String(l.cantidad + 1), prefijo: l.prefijo, codigo: l.reservado ? '' : l.deseado, descripcion: l.descripcion, modelo: l.modelo, marca: l.marca, categoria: l.categoria, obs: l.obs }, '+1 ' + l.nombre))}><Plus />1</button></div>}</div>}
              </div>
            ))}
            {(editable || agregable) && <>{agregable && <p className="text-[11.5px] text-slate-500" style={{ marginTop: 10 }}>Lista confirmada: puedes agregar productos o aumentar cantidades hasta que la importación ingrese al inventario.</p>}<BarraAgregar agregar={agregarProducto} aviso={aviso} equipoNuevo={() => setNuevoEq('nuevo')} /></>}
          </div>
        )}

        {pestana === 'avance' && (
          <div className="sec">
            <h3><Boxes />Avance de la recepción</h3>
            {!det ? <p className="text-slate-500 text-sm">Cargando…</p> : !det.lineas.length ? <p className="text-slate-500 text-sm">Todavía no hay productos.</p> : <Avance det={det} etapa={d.etapa} />}
          </div>
        )}

        {editable && <div className="pie"><button className="btn btn-red" onClick={() => setElim(true)} style={{ display: puede(perfil, 'importaciones', 'eliminar') ? undefined : 'none' }}><Trash2 />Eliminar borrador</button><span style={{ flex: 1 }} /><button className="btn btn-p" onClick={confirmar}><CheckCheck />Confirmar lista</button></div>}
        {reabrible && <div className="pie"><span className="text-[12px] text-slate-500" style={{ flex: 1 }}>Lista confirmada {d.enviado ? hace(d.enviado.fecha) : ''}. Bodega aún no revisa: se puede reabrir.</span><button className="btn" onClick={reabrir}><Unlock />Reabrir lista</button></div>}
      </div>
      {nuevoEq && <NuevoEquipo linea={nuevoEq === 'nuevo' ? null : nuevoEq} cerrar={() => setNuevoEq(null)} guardar={async (op) => { const ok = await linea(op, nuevoEq === 'nuevo' ? 'Equipo nuevo agregado' : 'Equipo actualizado'); if (ok) setNuevoEq(null) }} />}
      {elim && <ConfirmarEliminar titulo={`¿Eliminar el borrador ${d.codigo}?`} detalle="Se quita de la lista. Queda guardado y se puede restaurar desde la papelera." ok={eliminar} cerrar={() => setElim(false)} />}
    </div>
  )
}

/* ============================ Agregar rápido ============================ */
function BarraAgregar({ agregar, aviso, equipoNuevo }: { agregar: (p: Prod, n: number) => void; aviso: (t: string) => void; equipoNuevo: () => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Prod[]>([])
  const [abierta, setAbierta] = useState(false)
  const [elegido, setElegido] = useState<Prod | null>(null)
  const [cant, setCant] = useState('1')
  useEffect(() => {
    if (elegido) return
    const t = q.trim().replace(/[,()%*\\"']/g, ' ')
    const h = setTimeout(() => {
      let c = supabase.from('productos').select('id,codigo,codigo_unico,nombre,marca,stock,imagen_url').is('deleted_at', null)
      for (const p of t.split(/\s+/).filter(Boolean)) c = c.or(`nombre.ilike.%${p}%,codigo.ilike.%${p}%,codigo_unico.ilike.%${p}%,marca.ilike.%${p}%`)
      c.order('en_vista_publica', { ascending: false }).order('nombre').limit(40).then(({ data }) => setRes((data as Prod[]) ?? []))
    }, 150)
    return () => clearTimeout(h)
  }, [q, elegido])
  function elegir(p: Prod) { setElegido(p); setQ(p.codigo + ' · ' + p.nombre); setAbierta(false) }
  function anadir() {
    if (!elegido) { aviso('Elige un producto de la lista.'); setAbierta(true); return }
    agregar(elegido, Math.max(1, Math.floor(Number(cant) || 1))); setElegido(null); setQ(''); setCant('1')
  }
  return (
    <div className="qa"><div className="qa-f">
      <label className="f qa-q">Buscar producto (ID, código interno o nombre)
        <div className="qa-w">
          <input className="inp" value={q} onFocus={() => setAbierta(true)} onChange={(e) => { setQ(e.target.value); setElegido(null); setAbierta(true) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (abierta && res[0]) elegir(res[0]); else anadir() } if (e.key === 'Escape') setAbierta(false) }} placeholder="EQM525, código interno o monitor…" autoComplete="off" spellCheck={false} />
          {abierta && (
            <div className="qa-lista" role="listbox">
              {res.length ? res.map((p) => (
                <div key={p.id} className="qa-o" role="option" onMouseDown={(e) => { e.preventDefault(); elegir(p) }}>
                  {p.imagen_url ? <img loading="lazy" src={imagen(p.imagen_url, 96)} alt="" /> : <span className="qa-si"><ImageOff /></span>}
                  <div className="min-w-0"><b>{p.codigo}</b>{p.codigo_unico && p.codigo_unico !== p.codigo && <span className="qa-cu"> {p.codigo_unico}</span>}<span className="qa-n">{p.nombre}</span><small>Hay {p.stock ?? 0}{p.marca ? ' · ' + p.marca : ''}</small></div>
                </div>
              )) : <div className="qa-v">Sin resultados.</div>}
            </div>
          )}
        </div>
      </label>
      <label className="f qa-c">Cantidad<input className="inp" type="number" min={1} step={1} value={cant} onChange={(e) => setCant(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); anadir() } }} /></label>
      <button className="btn" onClick={anadir}><Plus />Agregar</button>
      <button className="btn" onClick={equipoNuevo} title="Producto que aún no existe en el inventario: se reserva su código al confirmar"><PackagePlus />Equipo nuevo</button>
    </div>{elegido && <p className="qa-sel"><b>{elegido.nombre}</b>{elegido.marca ? ' · ' + elegido.marca : ''} · hay {elegido.stock ?? 0}</p>}</div>
  )
}

/* ============================ Avance de la recepción (vmTabDetalle) ============================ */
function Avance({ det, etapa }: { det: Det; etapa: string }) {
  const t = det.lineas.reduce((a, l) => ({ u: a.u + l.cantidad, ap: a.ap + l.aprobada, st: a.st + l.enST + l.devuelta, nr: a.nr + l.noReparable, pr: a.pr + l.porRecibir, pe: a.pe + l.pendiente, fa: a.fa + l.faltante }), { u: 0, ap: 0, st: 0, nr: 0, pr: 0, pe: 0, fa: 0 })
  const g = det.graficos, danos = Object.entries(g.danos || {}).sort((a, b) => b[1] - a[1]), dias = Object.entries(g.porDia || {}).sort((a, b) => a[0].localeCompare(b[0]))
  const maxDia = Math.max(1, ...dias.map(([, n]) => n)), totDanos = danos.reduce((a, [, n]) => a + n, 0)
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0) + '%'
  return (
    <>
      <p className="text-[12.5px] text-slate-500 mb-2">{t.u} unidades pedidas · {t.ap} en inventario · {t.pr} por recibir · {t.pe} por revisar · {t.st} en Servicio Técnico{t.nr ? ' · ' + t.nr + ' no reparables' : ''}{t.fa ? ' · ' + t.fa + ' faltantes' : ''}{etapa === 'Ingresado' ? ' · recepción completa' : ''}</p>
      {det.lineas.map((l) => (
        <div key={l.itemId} style={{ marginBottom: 10 }}>
          <div className="flex justify-between text-[12px]"><span className="font-semibold text-slate-700 truncate">{l.nombre}{!l.producto && <span className="chip bl" style={{ marginLeft: 6 }}>sin identificar</span>}</span><b>{l.aprobada}/{l.cantidad} u.</b></div>
          <div className="ldbar" style={{ display: 'flex' }} title={`En inventario ${l.aprobada} · Servicio Técnico ${l.enST + l.devuelta} · No reparables ${l.noReparable} · Por revisar ${l.pendiente} · Por recibir ${l.porRecibir}`}>
            <span style={{ width: pct(l.aprobada, l.cantidad), background: '#04896f' }} /><span style={{ width: pct(l.enST + l.devuelta, l.cantidad), background: '#7c3aed' }} /><span style={{ width: pct(l.noReparable + l.faltante, l.cantidad), background: '#c0392b' }} /><span style={{ width: pct(l.pendiente, l.cantidad), background: '#f59e0b' }} />
          </div>
        </div>
      ))}
      <p className="text-[11px] text-slate-400" style={{ marginTop: 4 }}><span style={{ color: '#04896f' }}>■</span> inventario · <span style={{ color: '#7c3aed' }}>■</span> Servicio Técnico · <span style={{ color: '#c0392b' }}>■</span> no reparable o faltante · <span style={{ color: '#f59e0b' }}>■</span> por revisar</p>
      {(danos.length > 0 || dias.length > 0 || g.diasST != null || g.tasaProveedor != null) && <div className="grid2" style={{ marginTop: 14 }}>
        {danos.length > 0 && <div><h4 className="text-[12px] font-bold text-slate-600 mb-1">Daños encontrados ({totDanos})</h4>{danos.map(([k, n]) => <div key={k} className="flex justify-between text-[12px]" style={{ padding: '2px 0' }}><span>{k}</span><b>{n}</b></div>)}</div>}
        {dias.length > 0 && <div><h4 className="text-[12px] font-bold text-slate-600 mb-1">Revisadas por día</h4>{dias.slice(-10).map(([k, n]) => <div key={k} className="flex items-center gap-2 text-[11.5px]" style={{ padding: '1px 0' }}><span style={{ width: 62 }}>{fCorta(k)}</span><span style={{ flex: 1, height: 8, borderRadius: 99, background: '#e2e8f0', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: (n / maxDia) * 100 + '%', background: '#055c9d' }} /></span><b>{n}</b></div>)}</div>}
        {(g.diasST != null || g.tasaProveedor != null) && <div className="text-[12px]">{g.diasST != null && <p>Días promedio en Servicio Técnico: <b>{g.diasST}</b></p>}{g.tasaProveedor != null && <p>Tasa de daño de este proveedor en otras importaciones: <b>{g.tasaProveedor}%</b> ({g.revisionesProveedor} revisadas)</p>}</div>}
      </div>}
      {det.ordenes.length > 0 && <div style={{ marginTop: 14 }}><h4 className="text-[12px] font-bold text-slate-600 mb-1">Órdenes de Servicio Técnico</h4>
        {det.ordenes.map((o) => <div key={o.id} className="text-[12px]" style={{ padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}><b>{o.id}</b> · {o.modelo || o.producto} · {o.cantidad} u. · <span className={'chip ' + (o.estado === 'Abierta' ? 'vi' : 'ok')}>{o.estado}</span>{o.estado !== 'Abierta' && <> · {o.reparadas} reparada(s), {o.noReparables} no reparable(s)</>}<br /><span className="text-slate-500">{o.defecto}</span></div>)}</div>}
    </>
  )
}

/* ============================ Equipo nuevo (producto que aún no existe) ============================ */
type Pref = { prefijo: string; total: number; siguiente: string; categorias: string[] }
function NuevoEquipo({ linea, cerrar, guardar }: { linea: Linea | null; cerrar: () => void; guardar: (op: Record<string, unknown>) => Promise<void> }) {
  const [prefs, setPrefs] = useState<Pref[]>([])
  const [f, setF] = useState({ prefijo: linea?.prefijo ?? '', categoria: linea?.categoria ?? '', descripcion: linea?.descripcion ?? '', modelo: linea?.modelo ?? '', marca: linea?.marca ?? '', codigo: linea?.reservado ? '' : linea?.deseado ?? '', cantidad: String(linea?.cantidad ?? 1), obs: linea?.obs ?? '', imagen: linea?.imagen ?? '' })
  const [libres, setLibres] = useState<{ siguiente: string; libres: string[] } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  useEffect(() => { supabase.rpc('imp_prefijos').then(({ data }) => setPrefs((data as Pref[]) ?? [])) }, [])
  useEffect(() => { setLibres(null); if (f.prefijo) supabase.rpc('imp_codigos_libres', { p_prefijo: f.prefijo }).then(({ data }) => setLibres(data as never)) }, [f.prefijo])
  useEffect(() => {
    setMotivo(''); const c = f.codigo.trim(); if (c.length < 3) return
    const t = setTimeout(() => supabase.rpc('imp_verificar_codigo', { p_codigo: c, p_item: linea?.codigo ?? null }).then(({ data }) => setMotivo(String(data ?? ''))), 350)
    return () => clearTimeout(t)
  }, [f.codigo, linea])
  const pref = prefs.find((x) => x.prefijo === f.prefijo)
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  return (
    <div className="sheet-o" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="sheet" style={{ maxWidth: 560 }}>
        <h3 className="font-display font-bold text-lg mb-1" style={{ color: 'var(--navy)' }}>{linea ? 'Equipo nuevo' : 'Agregar equipo nuevo'}</h3>
        <p className="text-xs text-slate-500 mb-3">{linea?.reservado ? 'Código reservado ' + linea.reservado + '. ' : 'Al confirmar la lista se reserva su código. '}Marketing le pone el nombre comercial cuando llega.</p>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            <label className="f">Prefijo del código *<select className="inp" value={f.prefijo} onChange={(e) => { const p = prefs.find((x) => x.prefijo === e.target.value); setF((x) => ({ ...x, prefijo: e.target.value, categoria: x.categoria || (p?.categorias?.[0] ?? '') })) }}>
              <option value="">Elige…</option>{prefs.map((p) => <option key={p.prefijo} value={p.prefijo}>{p.prefijo} · {p.categorias.slice(0, 2).join(', ') || p.total + ' productos'}</option>)}</select></label>
            <label className="f">Categoría<input className="inp" list="dlCatEq" value={f.categoria} onChange={(e) => set('categoria', e.target.value)} /><datalist id="dlCatEq">{(pref?.categorias ?? []).map((c) => <option key={c} value={c} />)}</datalist></label>
          </div>
          <label className="f">Descripción del proveedor *<input className="inp" value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} placeholder="Ej. Monitor de signos vitales 12 pulgadas" /></label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            <label className="f">Modelo / código interno<input className="inp" value={f.modelo} onChange={(e) => set('modelo', e.target.value)} placeholder="PM-9000" /></label>
            <label className="f">Marca<input className="inp" value={f.marca} onChange={(e) => set('marca', e.target.value)} /></label>
          </div>
          {!linea?.reservado && <label className="f">Código que quieres (opcional)<input className="inp" value={f.codigo} onChange={(e) => set('codigo', e.target.value.toUpperCase())} placeholder={libres?.siguiente ? 'Si lo dejas vacío se usa ' + libres.siguiente : 'Prefijo + número'} />
            {motivo && <small style={{ color: '#c0392b' }}>{motivo}</small>}
            {libres && libres.libres.length > 0 && <small className="text-slate-500">Libres: {libres.libres.slice(0, 6).map((c) => <button key={c} type="button" className="chip" style={{ border: 0, cursor: 'pointer', marginRight: 4 }} onClick={() => set('codigo', c)}>{c}</button>)}</small>}</label>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            <label className="f">Cantidad *<input className="inp" type="number" min={1} value={f.cantidad} onChange={(e) => set('cantidad', e.target.value)} /></label>
            <div className="f" style={{ fontSize: 12 }}>Foto de referencia<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{f.imagen && <img src={imagen(f.imagen, 96)} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} />}
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}><ImagePlus />{subiendo ? 'Subiendo…' : f.imagen ? 'Cambiar' : 'Subir'}<input type="file" accept="image/*" hidden onChange={async (e) => {
                const file = e.target.files?.[0]; e.target.value = ''; if (!file) return
                setSubiendo(true); try { set('imagen', await subirCatalogo(await imagenWebp(file), 'importaciones/' + (f.prefijo || 'equipo'), 'webp', 'image/webp')) } catch { /* sin foto */ } setSubiendo(false)
              }} /></label></div></div>
          </div>
          <label className="f">Nota (opcional)<input className="inp" value={f.obs} onChange={(e) => set('obs', e.target.value)} /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button className="btn" style={{ flex: 1 }} onClick={cerrar}>Cancelar</button>
          <button className="btn btn-p" style={{ flex: 1 }} disabled={ocupado || subiendo || !!motivo} onClick={async () => { setOcupado(true); await guardar({ op: 'nuevo', item: linea?.codigo, ...f, cantidad: String(Math.max(1, Math.floor(Number(f.cantidad) || 1))) }); setOcupado(false) }}>{ocupado ? 'Guardando…' : <><CheckCheck />Guardar</>}</button></div>
      </div>
    </div>
  )
}

/* ============================ Panel (vmTabPanel / vmTabEquiposPanel) ============================ */
function Panel({ q }: { q: string }) {
  const [sub, setSub] = useState<'general' | 'equipos'>('general')
  const [p, setP] = useState<{ proveedores: { nombre: string; importaciones: number; revisadas: number; danadas: number; faltantes: number; tasa: number | null; diasLlegada: number | null }[]; productos: { producto: string; nombre: string; revisadas: number; danadas: number; tasa: number }[]; meses: { mes: string; unidades: number }[] } | null>(null)
  const [eq, setEq] = useState<{ importacion: string; importacionNombre: string; etapa: string; codigo: string; codigoUnico: string; nombre: string; imagen: string; cantidad: number; enInventario: boolean; stock: number; tipo: string; modelo: string }[] | null>(null)
  useEffect(() => { supabase.rpc('imp_panel').then(({ data }) => setP(data as never)) }, [])
  useEffect(() => { if (sub === 'equipos' && !eq) supabase.rpc('imp_equipos_panel').then(({ data }) => setEq((data as never) ?? [])) }, [sub, eq])
  const maxMes = Math.max(1, ...(p?.meses ?? []).map((m) => m.unidades))
  const pal = norm(q).trim().split(/\s+/).filter(Boolean)
  const eqVis = (eq ?? []).filter((x) => !pal.length || pal.every((w) => norm([x.codigo, x.codigoUnico, x.nombre, x.modelo, x.importacion, x.importacionNombre].join(' ')).includes(w)))
  return (
    <div>
      <div className="seg" style={{ marginBottom: 12 }}><button style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} className={sub === 'general' ? 'on' : ''} onClick={() => setSub('general')}><BarChart3 style={{ width: 14, height: 14 }} />General</button><button style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} className={sub === 'equipos' ? 'on' : ''} onClick={() => setSub('equipos')}><Boxes style={{ width: 14, height: 14 }} />Equipos</button></div>
      {sub === 'general' && (!p ? <div className="sec text-slate-500 text-sm">Cargando…</div> : <>
        <div className="sec"><h3><Ship />Proveedores</h3><div style={{ overflowX: 'auto' }}><table className="text-[12.5px]" style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr className="text-slate-400 text-[11px]" style={{ textAlign: 'left' }}><th>Proveedor</th><th>Importaciones</th><th>Revisadas</th><th>Con daño</th><th>Faltantes</th><th>Tasa de daño</th><th>Días de llegada</th></tr></thead>
          <tbody>{p.proveedores.map((x) => <tr key={x.nombre} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: '6px 4px' }}><b>{x.nombre}</b></td><td>{x.importaciones}</td><td>{x.revisadas}</td><td>{x.danadas}</td><td>{x.faltantes}</td><td>{x.tasa == null ? '—' : x.tasa + '%'}</td><td>{x.diasLlegada == null ? '—' : x.diasLlegada}</td></tr>)}</tbody></table></div></div>
        <div className="grid2">
          <div className="sec"><h3><Boxes />Productos con más daños</h3>{!p.productos.length ? <p className="text-slate-400 text-sm">Sin daños registrados.</p> : p.productos.map((x) => <div key={x.producto} className="flex justify-between text-[12.5px]" style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><span className="truncate"><b>{x.producto}</b> · {x.nombre}</span><span>{x.danadas} de {x.revisadas} ({x.tasa}%)</span></div>)}</div>
          <div className="sec"><h3><BarChart3 />Unidades confirmadas por mes</h3>{p.meses.map((m) => <div key={m.mes} className="flex items-center gap-2 text-[12px]" style={{ padding: '2px 0' }}><span style={{ width: 60 }}>{m.mes}</span><span style={{ flex: 1, height: 9, borderRadius: 99, background: '#e2e8f0', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: (m.unidades / maxMes) * 100 + '%', background: '#055c9d' }} /></span><b>{m.unidades}</b></div>)}</div>
        </div>
      </>)}
      {sub === 'equipos' && (!eq ? <div className="sec text-slate-500 text-sm">Cargando…</div> : <div className="sec">
        <h3><Boxes />Equipos de todas las importaciones <span className="chip">{eqVis.length}</span></h3>
        {eqVis.slice(0, 400).map((x, i) => <div key={x.importacion + i} className="lin" style={{ gridTemplateColumns: '46px 1fr auto' }}>
          {x.imagen ? <img loading="lazy" src={imagen(x.imagen, 96)} alt="" /> : <div className="sinimg"><ImageOff /></div>}
          <div className="min-w-0"><b>{x.nombre}</b><small>{[x.codigo, x.codigoUnico && x.codigoUnico !== x.codigo ? x.codigoUnico : '', x.importacion + ' · ' + x.etapa].filter(Boolean).join(' · ')}</small></div>
          <div style={{ textAlign: 'right' }} className="text-[12px]"><b>{x.cantidad} u.</b><br /><span className={'chip ' + (x.enInventario ? 'ok' : 'bl')}>{x.enInventario ? 'Stock ' + x.stock : 'Nuevo'}</span></div>
        </div>)}
      </div>)}
    </div>
  )
}

/* ============================ Papelera (vmPapeleraListar / vmPapeleraRestaurar) ============================ */
function PapeleraImp({ cerrar, aviso, restaurado }: { cerrar: () => void; aviso: (t: string) => void; restaurado: () => void }) {
  const [l, setL] = useState<{ codigo: string; nombre: string; proveedor: string; eliminado: string; motivo: string }[] | null>(null)
  const cargar = useCallback(() => { supabase.rpc('imp_papelera').then(({ data, error }) => { if (error) { aviso(error.message); setL([]) } else setL((data as never) ?? []) }) }, [aviso])
  useEffect(() => { cargar() }, [cargar])
  return (
    <div className="sheet-o" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="sheet" style={{ maxWidth: 520 }}>
        <h3 className="font-display font-bold text-lg mb-1" style={{ color: 'var(--navy)' }}>Papelera de importaciones</h3><p className="text-xs text-slate-500 mb-3">Lo eliminado no se borra: aquí puedes devolverlo al tablero.</p>
        {l === null && <p className="text-sm text-slate-500">Cargando…</p>}
        {l && !l.length && <p className="text-sm text-slate-500">La papelera está vacía.</p>}
        {l?.map((x) => <div key={x.codigo} className="flex items-center gap-2" style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
          <div className="min-w-0" style={{ flex: 1 }}><b className="text-[13px]">{x.codigo} · {x.nombre}</b><p className="text-[11.5px] text-slate-500">{x.proveedor}{x.eliminado ? ' · eliminada ' + fCorta(x.eliminado) : ''}{x.motivo ? ' · ' + x.motivo : ''}</p></div>
          <button className="btn btn-sm" onClick={async () => { const { error } = await supabase.rpc('imp_restaurar', { p_codigo: x.codigo }); if (error) { aviso(error.message); return } aviso('Importación restaurada'); cargar(); restaurado() }}><RotateCcw />Restaurar</button>
        </div>)}
        <button className="btn" style={{ width: '100%', marginTop: 14 }} onClick={cerrar}>Cerrar</button>
      </div>
    </div>
  )
}
