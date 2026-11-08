import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore, CalendarClock, Columns3, Copy, Database, Download, Eye, KeyRound, LayoutDashboard, Pencil, Plus, RefreshCw, RotateCcw, Save, Search, ShieldAlert, ShieldCheck, Table2, TableProperties, Upload, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import '../estilos/basedatos.css'

/* ============================ Tipos y catálogos ============================ */
type Campo = { nombre: string; tipo: string; obligatorio?: boolean; unico?: boolean; defecto?: string; activo?: boolean; opciones?: string[]; relacion?: { tabla: string; campo: string }; min?: number; max?: number; _existe?: boolean }
type TablaSis = { nombre: string; columnas: number; cols: string[]; filas: number }
type TablaPropia = { id: string; nombre: string; base: string; modulo: string; descripcion: string | null; campos: Campo[]; filas: number }
type Panel = { tablas: TablaSis[]; propias: TablaPropia[]; tamano: number; permisos: string[]; superadmin: boolean }
type Fila = { id: string | null; activo?: boolean; v: unknown[] }
type Datos = { tabla: string; encabezados: string[]; secretas: string[]; filas: Fila[]; total: number; pagina: number; tam: number; esquema?: Campo[] }
type Opc = { pagina: number; tam: number; q?: string; orden?: string; dir?: string; col?: string; valor?: string; inactivos?: boolean }
type Respaldo = { id: string; codigo: string; tipo: string; archivo: string | null; nombre: string | null; tamano: number; tablas: string[]; filas: number; sha256: string | null; verificado: string; estado: string; created_at: string; por_nombre: string | null }
type Manifiesto = { version: number; id: string; tipo: string; fecha: string; tablas: { nombre: string; archivo: string; filas: number; columnas: number; encabezados: string[]; secretas: string[]; sha256: string }[]; propias: boolean; nota: string }

const MODULOS_TABLA: [RegExp, string][] = [
  [/^(imp_ordenes_st|st_|documentos_tecnicos)/, 'Servicio Técnico'],
  [/^(leads|cotizaciones|clientes|interacciones|rutas|viaticos|sugerencias_clientes|solicitudes_cambio_asesor|etapas_pipeline|mensajes|asignacion_conversaciones|notas_internas|encuestas)/, 'CRM'],
  [/^(productos|movimientos_inventario|producto_galeria|categorias|fichas_tecnicas)/, 'Inventario'],
  [/^(facturas|notas_credito|nota_credito|ingresos_proveedor|proveedores)/, 'Facturación'],
  [/^(actividades|proyectos|premios_agenda|monedas_movimientos)/, 'Agenda'],
  [/^(empleados|roles|bitacora|seg_)/, 'Usuarios y seguridad'],
  [/^(marketing_|audiovisual|promo_|ofertas|catalogo|catalogos_generados|material_|anuncios_activos|aliados)/, 'Marketing'],
  [/^imp_/, 'Importaciones'],
  [/^(despachos|entregas)/, 'Operaciones'],
  [/^(th_|tareas_modulo)/, 'Administración'],
  [/^bd_/, 'Bases de Datos'],
]
const moduloDe = (n: string) => MODULOS_TABLA.find(([r]) => r.test(n))?.[1] ?? 'Otros'
const MODULOS_PROPIAS = ['Tablas propias', 'CRM', 'Inventario', 'Facturación', 'Agenda', 'Marketing', 'Importaciones', 'Operaciones', 'Servicio Técnico', 'Administración', 'Usuarios y seguridad']
const TIPOS = ['texto', 'numero', 'fecha', 'booleano', 'correo', 'lista', 'relacion']
const TABS: [string, string, typeof Table2, string?][] = [
  ['panel', 'Panel', LayoutDashboard], ['registros', 'Registros', Table2], ['nueva', 'Nueva tabla', TableProperties, 'crear'], ['exportar', 'Exportar', Download, 'exportar'],
  ['respaldos', 'Respaldos', ArchiveRestore], ['ajustes', 'Permisos y ajustes', KeyRound, 'administrar'],
]

/* ============================ Utilidades ============================ */
const nf = (n: number) => Number(n || 0).toLocaleString('es-EC')
const fecha = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? String(iso) : d.toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) }
const msg = (e: unknown) => String((e as { message?: string })?.message ?? e ?? '').replace(/^(Exception|Error):\s*/i, '')
const celda = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const kb = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB')
const sello = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1_')
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}
const auditar = (accion: string, registro: string, detalle: string) => { supabase.rpc('auditar', { p_modulo: 'basedatos', p_accion: accion, p_registro: registro.slice(0, 190), p_detalle: detalle }).then(() => undefined) }
function descargar(datos: BlobPart, nombre: string, tipo: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([datos], { type: tipo })); a.download = nombre
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
const csvDe = (filas: unknown[][]) => filas.map((r) => r.map((v) => {
  let s = celda(v); if (/^[=+\-@]/.test(s)) s = "'" + s
  return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}).join(',')).join('\r\n')
function parseCsv(texto: string): string[][] {
  const filas: string[][] = []; let fila: string[] = [], campo = '', com = false; const s = texto.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (com) { if (ch === '"') { if (s[i + 1] === '"') { campo += '"'; i++ } else com = false } else campo += ch }
    else if (ch === '"') com = true
    else if (ch === ',' || ch === ';') { fila.push(campo); campo = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = '' }
    else campo += ch
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila) }
  return filas.filter((r) => r.some((x) => x.trim() !== ''))
}
const sha256 = async (datos: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', datos as BufferSource))).map((b) => b.toString(16).padStart(2, '0')).join('')
let sheetjs: Promise<unknown> | null = null
const libXlsx = () => (sheetjs ??= new Promise((ok, fail) => {
  const w = window as never as { XLSX?: unknown }; if (w.XLSX) return ok(w.XLSX)
  const s = document.createElement('script'); s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
  s.onload = () => (w.XLSX ? ok(w.XLSX) : fail(new Error('No se pudo cargar la descarga Excel.'))); s.onerror = () => { sheetjs = null; fail(new Error('No se pudo cargar la descarga Excel. Revisa tu conexión.')) }
  document.head.appendChild(s)
}))
const esProp = (p: Panel, n: string) => p.propias.find((t) => t.nombre === n)

/** Trae todas las filas de una tabla (sistema o propia) paginando de 5.000 en 5.000. */
async function traerTodo(p: Panel, tabla: string, f: { col?: string; valor?: string; ids?: string[] } = {}): Promise<Datos> {
  const pr = esProp(p, tabla); let acum: Fila[] = [], pag = 1, d: Datos
  for (;;) {
    d = pr
      ? await rpc<Datos>('bd_registros', { p_tabla: pr.id, p_col: f.col || null, p_valor: f.valor || null, p_pagina: pag, p_tam: 5000, p_inactivos: true, p_exportar: true, p_ids: f.ids?.length ? f.ids : null })
      : await rpc<Datos>('bd_tabla', { p_tabla: tabla, p_col: f.col || null, p_valor: f.valor || null, p_pagina: pag, p_tam: 5000, p_exportar: true, p_ids: f.ids?.length ? f.ids : null })
    acum = acum.concat(d.filas)
    if (acum.length >= d.total || !d.filas.length || pag >= 40) break
    pag++
  }
  return { ...d, filas: acum }
}

type Dlg = { tipo: 'conf'; titulo: string; texto: string; rojo?: boolean; res: (v: boolean) => void } | { tipo: 'clave'; res: (v: string) => void }

/* ============================ Módulo ============================ */
export default function BaseDatos({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [tab, setTab] = useState('panel')
  const [panel, setPanel] = useState<Panel | null>(null)
  const [error, setError] = useState('')
  const [tabla, setTabla] = useState('')
  const [opc, setOpc] = useState<Opc>({ pagina: 1, tam: 50 })
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [expSel, setExpSel] = useState<string[] | null>(null)
  const [dlg, setDlg] = useState<Dlg | null>(null)

  const cargar = useCallback(async () => {
    setPanel(null); setError('')
    try { setPanel(await rpc<Panel>('bd_panel')) } catch (e) { setError(msg(e)) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const puede = (a: string) => !!panel && (panel.superadmin || panel.permisos.includes(a))
  const confirmar = (titulo: string, texto: string, rojo?: boolean) => new Promise<boolean>((res) => setDlg({ tipo: 'conf', titulo, texto, rojo, res }))
  const reautenticar = async () => {
    const pw = await new Promise<string>((res) => setDlg({ tipo: 'clave', res }))
    if (!pw) throw new Error('Acción cancelada.')
    const { error: er } = await supabase.auth.signInWithPassword({ email: perfil.email, password: pw })
    if (er) throw new Error('La contraseña no es correcta.')
  }
  const verTabla = (n: string) => { setTabla(n); setOpc({ pagina: 1, tam: 50 }); setSel(new Set()); setTab('registros') }
  const sub = panel ? 'Conectado a Supabase (Postgres) · ' + (panel.superadmin ? 'todos los permisos' : panel.permisos.join(', ')) : 'Tablas, registros, exportaciones y respaldos'

  return (
    <div className="vm-bd">
      <header className="hdr text-white" style={{ background: 'linear-gradient(120deg,#0b2545,#0f172a)' }}>
        <div className="max-w-[1250px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><Database /></div>
          <div className="min-w-0"><h1 className="font-display font-bold text-lg leading-tight">Administración de Bases de Datos</h1><p className="text-[11px] text-white/70">{sub}</p></div>
          <button className="btn ml-auto !bg-white/10 !border-white/20 !text-white" onClick={cargar}><RefreshCw /><span className="hidden sm:inline">Actualizar</span></button>
        </div>
      </header>
      <main className="max-w-[1250px] mx-auto px-4 py-4 space-y-3">
        <div className="tabs">
          {TABS.filter(([, , , p]) => !p || puede(p)).map(([k, t, Ic]) => <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}><Ic />{t}</button>)}
        </div>
        <div>
          {error ? <div className="card text-sm text-red-700">{error}</div> : !panel ? <div className="text-center py-16 text-slate-400"><span className="spin" /> Cargando…</div> : tab === 'panel' ? (
            <PPanel p={panel} puede={puede} ver={verTabla} />
          ) : tab === 'registros' ? (
            <PRegistros p={panel} puede={puede} tabla={tabla} setTabla={(t) => { setTabla(t); setOpc({ pagina: 1, tam: 50 }); setSel(new Set()) }} opc={opc} setOpc={setOpc} sel={sel} setSel={setSel}
              aviso={aviso} confirmar={confirmar} recargar={cargar} exportarSel={(ids) => { setExpSel(ids); setTab('exportar') }} />
          ) : tab === 'nueva' ? (
            <PNueva aviso={aviso} creada={async (n) => { await cargar(); verTabla(n) }} />
          ) : tab === 'exportar' ? (
            <PExportar p={panel} tabla={tabla} sel={expSel} limpiarSel={() => setExpSel(null)} aviso={aviso} />
          ) : tab === 'respaldos' ? (
            <PRespaldos p={panel} puede={puede} aviso={aviso} confirmar={confirmar} reautenticar={reautenticar} recargar={cargar} />
          ) : <PAjustes />}
        </div>
      </main>
      {dlg?.tipo === 'conf' && (
        <div className="ovl"><div className="modal" style={{ maxWidth: 420 }}>
          <h3 className="font-display font-bold text-base mb-1">{dlg.titulo}</h3><p className="text-sm text-slate-600 mb-3">{dlg.texto}</p>
          <div className="flex justify-end gap-2"><button className="btn" onClick={() => { dlg.res(false); setDlg(null) }}>Cancelar</button><button className={'btn ' + (dlg.rojo ? 'btn-r' : 'btn-p')} onClick={() => { dlg.res(true); setDlg(null) }}>Confirmar</button></div>
        </div></div>
      )}
      {dlg?.tipo === 'clave' && <Clave res={(v) => { dlg.res(v); setDlg(null) }} />}
    </div>
  )
}

function Clave({ res }: { res: (v: string) => void }) {
  const [v, setV] = useState('')
  return (
    <div className="ovl"><div className="modal" style={{ maxWidth: 380 }}>
      <h3 className="font-display font-bold text-base mb-1">Confirma tu contraseña</h3>
      <p className="text-xs text-slate-500 mb-3">Es una acción crítica: por seguridad vuelve a escribir tu contraseña.</p>
      <input type="password" className="inp" autoFocus autoComplete="current-password" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') res(v) }} />
      <div className="flex justify-end gap-2 mt-3"><button className="btn" onClick={() => res('')}>Cancelar</button><button className="btn btn-p" onClick={() => res(v)}>Confirmar</button></div>
    </div></div>
  )
}

/* ============================ Panel ============================ */
function PPanel({ p, puede, ver }: { p: Panel; puede: (a: string) => boolean; ver: (t: string) => void }) {
  const [ult, setUlt] = useState<Respaldo | null | undefined>(undefined)
  useEffect(() => {
    supabase.from('bd_respaldos').select('id,codigo,tipo,verificado,created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => setUlt(((data as unknown as Respaldo[]) ?? [])[0] ?? null))
  }, [])
  const todas = [
    ...p.tablas.map((t) => ({ nombre: t.nombre, modulo: moduloDe(t.nombre), base: 'VIMEDIC', propia: false, filas: t.filas, columnas: t.columnas })),
    ...p.propias.map((t) => ({ nombre: t.nombre, modulo: t.modulo, base: t.base, propia: true, filas: t.filas, columnas: t.campos.filter((c) => c.activo !== false).length })),
  ]
  const mods: Record<string, { n: number; filas: number }> = {}
  todas.forEach((t) => { const m = (mods[t.modulo] ??= { n: 0, filas: 0 }); m.n++; m.filas += t.filas })
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
        <div className="kpi"><b>{todas.length}</b><span>Tablas</span></div>
        <div className="kpi"><b>{nf(todas.reduce((a, t) => a + t.filas, 0))}</b><span>Registros</span></div>
        <div className="kpi"><b>{kb(p.tamano)}</b><span>Tamaño de la base</span></div>
        <div className="kpi"><b className="!text-sm !leading-6">{ult === undefined ? '…' : ult ? fecha(ult.created_at) : 'Nunca'}</b><span>Último respaldo{ult ? ' · ' + ult.tipo + (ult.verificado === 'SI' ? ' ✓' : '') : ''}</span></div>
        <div className="kpi"><b className="!text-sm !leading-6">Diarios de Supabase</b><span>Copia automática del servicio</span></div>
      </div>
      <div className="card mb-3 text-xs text-slate-600 flex flex-wrap gap-x-6 gap-y-1">
        <span><b>Base:</b> vimedic (Postgres en Supabase)</span><span><b>Estado:</b> <span className="pill ok">Conectada</span></span>
        <span><b>Sincronización:</b> Fuente única: Supabase (la app móvil sincroniza con PowerSync)</span>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">{Object.keys(mods).sort().map((m) => <span key={m} className="pill gr">{m}: {mods[m].n} tablas · {nf(mods[m].filas)} filas</span>)}</div>
      <div className="tw"><table className="t"><thead><tr><th>Tabla</th><th>Módulo</th><th>Base</th><th className="text-right">Filas</th><th className="text-right">Columnas</th><th /></tr></thead><tbody>
        {todas.sort((a, b) => a.modulo.localeCompare(b.modulo) || a.nombre.localeCompare(b.nombre)).map((t) => (
          <tr key={t.nombre}>
            <td><b>{t.nombre}</b>{t.propia && <> <span className="pill bl">propia</span></>}</td><td>{t.modulo}</td><td>{t.base}</td>
            <td className="text-right">{nf(t.filas)}</td><td className="text-right">{t.columnas}</td>
            <td>{puede('ver') && <button className="btn !py-1" onClick={() => ver(t.nombre)}><Eye />Ver</button>}</td>
          </tr>
        ))}
      </tbody></table></div>
      <p className="text-[11px] text-slate-500 mt-2">Las tablas del sistema se consultan y exportan aquí, pero se editan desde su módulo para no romper su lógica. Las tablas propias (prefijo BD_) se administran completas aquí.</p>
    </>
  )
}

/* ============================ Registros ============================ */
function PRegistros({ p, puede, tabla, setTabla, opc, setOpc, sel, setSel, aviso, confirmar, recargar, exportarSel }: {
  p: Panel; puede: (a: string) => boolean; tabla: string; setTabla: (t: string) => void; opc: Opc; setOpc: (o: Opc) => void; sel: Set<string>; setSel: (s: Set<string>) => void
  aviso: (t: string) => void; confirmar: (t: string, x: string, rojo?: boolean) => Promise<boolean>; recargar: () => void; exportarSel: (ids: string[]) => void
}) {
  const nombre = tabla || p.propias[0]?.nombre || p.tablas[0]?.nombre || ''
  const prop = esProp(p, nombre)
  const [d, setD] = useState<Datos | null>(null)
  const [er, setEr] = useState('')
  const [f, setF] = useState({ q: opc.q ?? '', orden: opc.orden ?? '', dir: opc.dir ?? 'asc', col: opc.col ?? '', valor: opc.valor ?? '' })
  const [extra, setExtra] = useState<React.ReactNode>(null)
  const [form, setForm] = useState<Fila | 'nuevo' | null>(null)
  const [camposModal, setCamposModal] = useState(false)
  const [imp, setImp] = useState(false)
  const cargarD = useCallback(async () => {
    setD(null); setEr(''); setExtra(null)
    try {
      setD(prop
        ? await rpc<Datos>('bd_registros', { p_tabla: prop.id, p_q: opc.q || null, p_orden: opc.orden || null, p_dir: opc.dir || 'asc', p_col: opc.col || null, p_valor: opc.valor || null, p_pagina: opc.pagina, p_tam: opc.tam, p_inactivos: !!opc.inactivos })
        : await rpc<Datos>('bd_tabla', { p_tabla: nombre, p_q: opc.q || null, p_orden: opc.orden || null, p_dir: opc.dir || 'asc', p_col: opc.col || null, p_valor: opc.valor || null, p_pagina: opc.pagina, p_tam: opc.tam }))
    } catch (e) { setEr(msg(e)) }
  }, [nombre, prop, opc])
  useEffect(() => { if (nombre) cargarD() }, [cargarD, nombre])
  useEffect(() => { setF({ q: opc.q ?? '', orden: opc.orden ?? '', dir: opc.dir ?? 'asc', col: opc.col ?? '', valor: opc.valor ?? '' }) }, [nombre]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!puede('ver')) return <div className="card text-sm">Necesitas el permiso «ver» de Bases de Datos para consultar registros.</div>
  const aplicar = () => setOpc({ ...opc, pagina: 1, q: f.q.trim(), orden: f.orden, dir: f.dir, col: f.col, valor: f.valor.trim() })
  const cols = d?.encabezados ?? []
  const pags = d ? Math.max(1, Math.ceil(d.total / d.tam)) : 1
  const opcionesTablas = [...p.propias.map((t) => ({ n: t.nombre, m: t.modulo })), ...p.tablas.map((t) => ({ n: t.nombre, m: moduloDe(t.nombre) }))]
  return (
    <>
      <div className="card !p-3 flex flex-wrap gap-2 items-end mb-3">
        <label className="f min-w-[220px] flex-1">Tabla<select className="inp" value={nombre} onChange={(e) => setTabla(e.target.value)}>{opcionesTablas.map((t) => <option key={t.n} value={t.n}>{t.m} · {t.n}</option>)}</select></label>
        <label className="f flex-1 min-w-[160px]">Buscar<input className="inp" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') aplicar() }} /></label>
        <label className="f">Ordenar por<select className="inp" value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value })}><option value="">—</option>{cols.filter((c) => !c.startsWith('_') && !d?.secretas.includes(c)).map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="f">Dirección<select className="inp" value={f.dir} onChange={(e) => setF({ ...f, dir: e.target.value })}><option value="asc">Ascendente</option><option value="desc">Descendente</option></select></label>
        <label className="f">Filtrar columna<select className="inp" value={f.col} onChange={(e) => setF({ ...f, col: e.target.value })}><option value="">—</option>{cols.filter((c) => !c.startsWith('_') && !d?.secretas.includes(c)).map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="f">= valor<input className="inp" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></label>
        <button className="btn btn-p" onClick={aplicar}><Search />Aplicar</button>
      </div>
      {er ? <div className="card text-sm text-red-700">{er}</div> : !d ? <div className="text-center py-12 text-slate-400"><span className="spin" /> Cargando…</div> : (
        <>
          <div className="flex flex-wrap gap-2 items-center mb-2">
            <span className="text-xs text-slate-500">{nf(d.total)} registros · página {d.pagina} de {pags}{sel.size ? ` · ${sel.size} seleccionados` : ''}</span>
            <span className="ml-auto" />
            {prop && puede('crear') && <><button className="btn btn-p" onClick={() => setForm('nuevo')}><Plus />Nuevo registro</button><button className="btn" onClick={() => setImp(true)}><Upload />Importar CSV</button></>}
            {prop && puede('editar') && <button className="btn" onClick={() => setCamposModal(true)}><Columns3 />Campos</button>}
            {prop && <label className="btn"><input type="checkbox" checked={!!opc.inactivos} onChange={(e) => setOpc({ ...opc, pagina: 1, inactivos: e.target.checked })} />Ver desactivados</label>}
            <button className="btn" onClick={async () => {
              const c = f.col || f.orden || d.encabezados.find((x) => !x.startsWith('_')) || ''
              if (prop) { setExtra(<div className="card text-xs text-slate-600">Los duplicados en tablas propias se evitan marcando el campo como «único». Activa «único» en <b>Campos</b>.</div>); return }
              try {
                const r = await rpc<{ columna: string; total: number; grupos: { valor: string; n: number; ids: string[] }[] }>('bd_duplicados', { p_tabla: nombre, p_columna: c })
                setExtra(<div className="card"><b>Duplicados en "{r.columna}":</b> {r.total} valores repetidos<div className="text-xs text-slate-600 mt-2 space-y-1">{r.grupos.slice(0, 100).map((g) => <div key={g.valor}><span className="mono">{g.valor}</span> → {g.n} filas</div>)}</div>
                  <p className="text-[11px] text-slate-400 mt-2">Columna usada: la de «Filtrar columna» u «Ordenar por» (por defecto, la primera).</p></div>)
              } catch (e) { aviso(msg(e)) }
            }}><Copy />Duplicados</button>
            <button className="btn" onClick={async () => {
              if (prop) { setExtra(<div className="card text-xs text-slate-600">Cada registro se valida contra el esquema al guardarlo o importarlo, así que los registros de esta tabla siempre cumplen sus reglas.</div>); return }
              try {
                const r = await rpc<{ revisadas: number; borradas: number; total: number; regla: string; problemas: { fila: string; problemas: string[] }[] }>('bd_integridad', { p_tabla: nombre })
                setExtra(<div className="card"><b>Integridad:</b> {nf(r.revisadas)} filas revisadas ({nf(r.borradas)} borradas lógicamente) · {r.total} problemas <span className="text-xs text-slate-500">({r.regla})</span>
                  <div className="text-xs text-slate-600 mt-2 space-y-1">{r.problemas.slice(0, 100).map((x, i) => <div key={i}>{x.fila}: {x.problemas.join('; ')}</div>)}{!r.problemas.length && <span className="pill ok">Sin problemas</span>}</div></div>)
              } catch (e) { aviso(msg(e)) }
            }}><ShieldAlert />Integridad</button>
            {puede('exportar') && <button className="btn" onClick={() => exportarSel([...sel])}><Download />Exportar{sel.size ? ' selección' : ''}</button>}
          </div>
          <div className="tw"><table className="t"><thead><tr>
            <th><input type="checkbox" checked={d.filas.length > 0 && d.filas.every((x) => x.id && sel.has(x.id))} onChange={(e) => { const s = new Set(sel); d.filas.forEach((x) => { if (x.id) { if (e.target.checked) s.add(x.id); else s.delete(x.id) } }); setSel(s) }} /></th>
            {cols.map((c) => <th key={c}>{c}{d.secretas.includes(c) ? ' 🔒' : ''}</th>)}{prop && puede('editar') && <th />}</tr></thead><tbody>
            {d.filas.map((x, i) => (
              <tr key={x.id ?? i} style={x.activo === false ? { opacity: 0.55 } : undefined}>
                <td>{x.id && <input type="checkbox" checked={sel.has(x.id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(x.id!); else s.delete(x.id!); setSel(s) }} />}</td>
                {x.v.map((v, j) => { const s = /^_(creado|actualizado)$/.test(cols[j]) ? fecha(String(v)) : celda(v); return <td key={j} className="max-w-[260px] truncate" title={s}>{s}</td> })}
                {prop && puede('editar') && (
                  <td className="whitespace-nowrap"><button className="btn !py-1 !px-2" onClick={() => setForm(x)}><Pencil /></button>
                    {puede('eliminar') && <button className="btn !py-1 !px-2 ml-1" onClick={async () => {
                      const reac = x.activo === false
                      if (!reac && !(await confirmar('Desactivar registro', 'El registro se oculta pero no se borra; puedes reactivarlo.'))) return
                      try { await rpc('bd_desactivar_registro', { p_registro: x.id, p_activo: reac }); aviso(reac ? 'Reactivado' : 'Desactivado'); cargarD() } catch (e) { aviso(msg(e)) }
                    }}>{x.activo === false ? <RotateCcw /> : <Archive />}</button>}
                  </td>
                )}
              </tr>
            ))}
            {!d.filas.length && <tr><td colSpan={99} className="text-center py-6 text-slate-400">Sin registros</td></tr>}
          </tbody></table></div>
          <div className="flex justify-center gap-2 mt-3">
            <button className="btn" disabled={d.pagina <= 1} onClick={() => setOpc({ ...opc, pagina: opc.pagina - 1 })}>Anterior</button>
            <button className="btn" disabled={d.pagina >= pags} onClick={() => setOpc({ ...opc, pagina: opc.pagina + 1 })}>Siguiente</button>
          </div>
          <div className="mt-3">{extra}</div>
        </>
      )}
      {form && prop && d && <FormRegistro prop={prop} d={d} fila={form === 'nuevo' ? null : form} cerrar={() => setForm(null)} aviso={aviso} guardado={() => { setForm(null); cargarD(); recargar() }} />}
      {camposModal && prop && <ModalCampos prop={prop} cerrar={() => setCamposModal(false)} aviso={aviso} guardado={() => { setCamposModal(false); recargar(); cargarD() }} />}
      {imp && prop && <ModalImportar prop={prop} cerrar={() => setImp(false)} aviso={aviso} hecho={() => { setImp(false); cargarD(); recargar() }} />}
    </>
  )
}

function FormRegistro({ prop, d, fila, cerrar, aviso, guardado }: { prop: TablaPropia; d: Datos; fila: Fila | null; cerrar: () => void; aviso: (t: string) => void; guardado: () => void }) {
  const campos = (d.esquema ?? prop.campos).filter((c) => c.activo !== false)
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(campos.map((c) => { const i = d.encabezados.indexOf(c.nombre); const x = fila && i >= 0 ? fila.v[i] : ''; return [c.nombre, x == null ? '' : celda(x)] })))
  const [ocupado, setOcupado] = useState(false)
  const input = (c: Campo) => {
    const val = v[c.nombre] ?? '', set = (x: string) => setV({ ...v, [c.nombre]: x })
    if (c.tipo === 'lista') return <select className="inp" value={val} onChange={(e) => set(e.target.value)}><option value="" />{(c.opciones ?? []).map((o) => <option key={o}>{o}</option>)}</select>
    if (c.tipo === 'booleano') return <select className="inp" value={val} onChange={(e) => set(e.target.value)}><option value="" /><option>SI</option><option>NO</option></select>
    const t = c.tipo === 'numero' ? 'number' : c.tipo === 'fecha' ? 'date' : c.tipo === 'correo' ? 'email' : 'text'
    return <input type={t} step="any" className="inp" value={c.tipo === 'fecha' ? val.slice(0, 10) : val} onChange={(e) => set(e.target.value)} />
  }
  return (
    <div className="ovl" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}><div className="modal">
      <div className="flex items-center mb-3"><h3 className="font-display font-bold text-base">{fila ? 'Editar registro' : 'Nuevo registro'} · {prop.nombre}</h3><button className="btn ml-auto !p-2" onClick={cerrar}><X /></button></div>
      <div className="grid sm:grid-cols-2 gap-2">
        {campos.map((c) => <label key={c.nombre} className="f">{c.nombre}{c.obligatorio ? ' *' : ''} <span className="text-slate-400 font-normal">· {c.tipo}{c.unico ? ' · único' : ''}{c.relacion?.tabla ? ' → ' + c.relacion.tabla : ''}</span>{input(c)}</label>)}
      </div>
      <div className="flex justify-end gap-2 mt-4"><button className="btn" onClick={cerrar}>Cancelar</button>
        <button className="btn btn-p" disabled={ocupado} onClick={async () => {
          setOcupado(true)
          try { await rpc('bd_guardar_registro', { p_tabla: prop.id, p_registro: fila?.id ?? null, p_datos: v }); aviso('Registro guardado'); guardado() } catch (e) { aviso(msg(e)); setOcupado(false) }
        }}><Save />Guardar</button></div>
    </div></div>
  )
}

function ModalImportar({ prop, cerrar, aviso, hecho }: { prop: TablaPropia; cerrar: () => void; aviso: (t: string) => void; hecho: () => void }) {
  const [res, setRes] = useState<{ errores: string[]; total: number } | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="ovl"><div className="modal">
      <h3 className="font-display font-bold text-base mb-1">Importar CSV a {prop.nombre}</h3>
      <p className="text-xs text-slate-500 mb-3">La primera fila debe tener los nombres de los campos. Si alguna fila no cumple las reglas, no se importa nada y verás qué corregir. Máximo 5.000 filas.</p>
      <input ref={ref} type="file" accept=".csv,text/csv" className="inp" />
      {res && <div className="text-xs mt-2"><div className="card" style={{ borderColor: '#fecaca' }}><b className="text-red-700">{res.total} filas con errores — no se importó nada:</b><div className="mt-1 space-y-0.5">{res.errores.map((e, i) => <div key={i}>{e}</div>)}</div></div></div>}
      <div className="flex justify-end gap-2 mt-3"><button className="btn" onClick={cerrar}>Cerrar</button>
        <button className="btn btn-p" onClick={async () => {
          const f = ref.current?.files?.[0]; if (!f) { aviso('Elige un archivo CSV.'); return }
          if (f.size > 5 * 1024 * 1024) { aviso('El archivo supera 5 MB.'); return }
          const filas = parseCsv(await f.text()); if (filas.length < 2) { aviso('El archivo no tiene filas de datos.'); return }
          const cab = filas[0].map((x) => x.trim())
          const objs = filas.slice(1).map((r) => Object.fromEntries(cab.map((c, j) => [c, r[j] ?? ''])))
          try {
            const r = await rpc<{ success: boolean; importadas?: number; errores?: string[]; totalErrores?: number }>('bd_importar', { p_tabla: prop.id, p_filas: objs })
            if (r.success) { aviso(r.importadas + ' filas importadas'); hecho() } else setRes({ errores: r.errores ?? [], total: r.totalErrores ?? 0 })
          } catch (e) { aviso(msg(e)) }
        }}><Upload />Importar</button></div>
    </div></div>
  )
}

/* ============================ Campos y nueva tabla ============================ */
function EditorCampos({ campos, setCampos }: { campos: Campo[]; setCampos: (c: Campo[]) => void }) {
  const cambiar = (i: number, k: Partial<Campo>) => setCampos(campos.map((c, j) => (j === i ? { ...c, ...k } : c)))
  return (
    <>
      <div className="tw"><table className="t"><thead><tr><th>Campo</th><th>Tipo</th><th>Oblig.</th><th>Único</th><th>Por defecto</th><th>Opciones (lista)</th><th>Relación</th><th /></tr></thead><tbody>
        {campos.map((c, i) => (
          <tr key={i}>
            <td><input className="inp" value={c.nombre} readOnly={c._existe} onChange={(e) => cambiar(i, { nombre: e.target.value })} /></td>
            <td><select className="inp" value={c.tipo} onChange={(e) => cambiar(i, { tipo: e.target.value })}>{TIPOS.map((t) => <option key={t}>{t}</option>)}</select></td>
            <td className="text-center"><input type="checkbox" checked={!!c.obligatorio} onChange={(e) => cambiar(i, { obligatorio: e.target.checked })} /></td>
            <td className="text-center"><input type="checkbox" checked={!!c.unico} onChange={(e) => cambiar(i, { unico: e.target.checked })} /></td>
            <td><input className="inp" value={c.defecto ?? ''} onChange={(e) => cambiar(i, { defecto: e.target.value })} /></td>
            <td><input className="inp" placeholder="A,B,C" value={(c.opciones ?? []).join(',')} onChange={(e) => cambiar(i, { opciones: e.target.value.split(',') })} /></td>
            <td><input className="inp" placeholder="BD_Tabla.Campo" value={c.relacion?.tabla ? c.relacion.tabla + '.' + (c.relacion.campo ?? '') : ''} onChange={(e) => { const [t, ...r] = e.target.value.split('.'); cambiar(i, { relacion: { tabla: t, campo: r.join('.') } }) }} /></td>
            <td><button className="btn !p-2" onClick={() => setCampos(campos.filter((_, j) => j !== i))}><X /></button></td>
          </tr>
        ))}
      </tbody></table></div>
      <button className="btn mt-2" onClick={() => setCampos([...campos, { nombre: '', tipo: 'texto' }])}><Plus />Agregar campo</button>
    </>
  )
}
const limpiarCampos = (c: Campo[]) => c.filter((x) => x.nombre.trim()).map(({ _existe, ...x }) => ({ ...x, nombre: x.nombre.trim(), opciones: (x.opciones ?? []).map((o) => o.trim()).filter(Boolean) }))

function ModalCampos({ prop, cerrar, aviso, guardado }: { prop: TablaPropia; cerrar: () => void; aviso: (t: string) => void; guardado: () => void }) {
  const [campos, setCampos] = useState<Campo[]>(() => prop.campos.filter((c) => c.activo !== false).map((c) => ({ ...c, _existe: true })))
  return (
    <div className="ovl"><div className="modal" style={{ maxWidth: 980 }}>
      <div className="flex items-center mb-2"><h3 className="font-display font-bold text-base">Campos de {prop.nombre}</h3><button className="btn ml-auto !p-2" onClick={cerrar}><X /></button></div>
      <p className="text-xs text-slate-500 mb-2">Puedes agregar campos y cambiar reglas. Un campo que quites queda desactivado (sus datos no se borran).</p>
      <EditorCampos campos={campos} setCampos={setCampos} />
      <div className="flex justify-end gap-2 mt-3"><button className="btn" onClick={cerrar}>Cancelar</button>
        <button className="btn btn-p" onClick={async () => { try { await rpc('bd_editar_esquema', { p_tabla: prop.id, p_campos: limpiarCampos(campos) }); aviso('Campos guardados'); guardado() } catch (e) { aviso(msg(e)) } }}><Save />Guardar</button></div>
    </div></div>
  )
}

function PNueva({ aviso, creada }: { aviso: (t: string) => void; creada: (n: string) => void }) {
  const [n, setN] = useState(''), [b, setB] = useState('General'), [m, setM] = useState('Tablas propias'), [d, setD] = useState('')
  const [campos, setCampos] = useState<Campo[]>([{ nombre: 'Nombre', tipo: 'texto', obligatorio: true }])
  return (
    <div className="card space-y-3">
      <p className="text-sm text-slate-600">Crea una tabla propia (nombre «BD_…») con sus reglas. Cada registro lleva además fecha de creación, de actualización y estado activo.</p>
      <div className="grid sm:grid-cols-3 gap-2">
        <label className="f">Nombre<input className="inp" placeholder="Ej. Garantías" value={n} onChange={(e) => setN(e.target.value)} /></label>
        <label className="f">Base de datos lógica<input className="inp" value={b} onChange={(e) => setB(e.target.value)} /></label>
        <label className="f">Módulo asociado<select className="inp" value={m} onChange={(e) => setM(e.target.value)}>{MODULOS_PROPIAS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="f sm:col-span-3">Descripción<input className="inp" value={d} onChange={(e) => setD(e.target.value)} /></label>
      </div>
      <EditorCampos campos={campos} setCampos={setCampos} />
      <div className="flex justify-end"><button className="btn btn-p" onClick={async () => {
        try { await rpc('bd_crear_tabla', { p_nombre: n, p_base: b, p_modulo: m, p_descripcion: d, p_campos: limpiarCampos(campos) }); const nom = 'BD_' + n.replace(/[^\p{L}\p{N} _]/gu, '').trim().replace(/\s+/g, '_').slice(0, 40); aviso('Tabla ' + nom + ' creada'); creada(nom) } catch (e) { aviso(msg(e)) }
      }}><TableProperties />Crear tabla</button></div>
    </div>
  )
}

/* ============================ Exportar ============================ */
function PExportar({ p, tabla, sel, limpiarSel, aviso }: { p: Panel; tabla: string; sel: string[] | null; limpiarSel: () => void; aviso: (t: string) => void }) {
  const todas = [...p.propias.map((t) => ({ n: t.nombre, m: t.modulo })), ...p.tablas.map((t) => ({ n: t.nombre, m: moduloDe(t.nombre) }))]
  const [mod, setMod] = useState(''), [t, setT] = useState(tabla || todas[0]?.n || ''), [fmt, setFmt] = useState('xlsx')
  const [cols, setCols] = useState<string[]>([]), [col, setCol] = useState(''), [val, setVal] = useState(''), [cf, setCf] = useState(''), [desde, setDesde] = useState(''), [hasta, setHasta] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const conSel = !!sel && sel.length > 0
  useEffect(() => {
    if (mod || conSel || !t) { setCols([]); return }
    const pr = esProp(p, t)
    const c = pr ? [...pr.campos.filter((x) => x.activo !== false).map((x) => x.nombre), '_creado', '_actualizado'] : p.tablas.find((x) => x.nombre === t)?.cols ?? []
    setCols(c); setCol(''); setCf('')
  }, [t, mod, conSel, p])
  const exportar = async () => {
    setOcupado(true)
    try {
      const nombres = mod ? todas.filter((x) => x.m === mod).map((x) => x.n) : [t]
      if (!nombres.length) throw new Error('Elige al menos una tabla.')
      const sal: { nombre: string; enc: string[]; filas: unknown[][] }[] = []
      let total = 0
      for (const n of nombres) {
        const d = await traerTodo(p, n, { col: mod ? '' : col, valor: mod ? '' : val, ids: conSel ? sel! : undefined })
        let filas = d.filas.map((x) => x.v)
        if (!mod && !conSel && cf && (desde || hasta)) {
          const i = d.encabezados.indexOf(cf), a = desde ? new Date(desde + 'T00:00:00-05:00').getTime() : -Infinity, b = hasta ? new Date(hasta + 'T23:59:59-05:00').getTime() : Infinity
          filas = filas.filter((r) => { const x = new Date(String(r[i])).getTime(); return !isNaN(x) && x >= a && x <= b })
        }
        sal.push({ nombre: n, enc: d.encabezados, filas }); total += filas.length
      }
      const nom = 'vimedic_' + (sal.length === 1 ? sal[0].nombre : 'exportacion') + '_' + sello()
      if (fmt === 'xlsx') {
        const X = (await libXlsx()) as { utils: { book_new: () => unknown; aoa_to_sheet: (a: unknown[][]) => unknown; book_append_sheet: (b: unknown, s: unknown, n: string) => void }; writeFile: (b: unknown, n: string, o: unknown) => void }
        const wb = X.utils.book_new()
        sal.forEach((s) => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([s.enc, ...s.filas.map((r) => r.map((v) => (v != null && typeof v === 'object' ? JSON.stringify(v) : typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v)))]), s.nombre.slice(0, 31)))
        X.writeFile(wb, nom + '.xlsx', { compression: true })
      } else {
        const arch = sal.map((s) => fmt === 'json'
          ? { n: s.nombre + '.json', c: JSON.stringify({ tabla: s.nombre, exportado: new Date().toISOString(), encabezados: s.enc, filas: s.filas.map((r) => Object.fromEntries(s.enc.map((e, i) => [e, r[i]]))) }, null, 1), t: 'application/json' }
          : { n: s.nombre + '.csv', c: '﻿' + csvDe([s.enc, ...s.filas]), t: 'text/csv;charset=utf-8' })
        if (arch.length === 1) descargar(arch[0].c, nom + '.' + fmt, arch[0].t)
        else { const JSZip = (await import('jszip')).default; const z = new JSZip(); arch.forEach((a) => z.file(a.n, a.c)); descargar(await z.generateAsync({ type: 'blob' }), nom + '.zip', 'application/zip') }
      }
      auditar('Exportación ' + fmt.toUpperCase(), nombres.join(', '), total + ' filas')
      aviso(nf(total) + ' filas exportadas')
    } catch (e) { aviso(msg(e)) }
    setOcupado(false)
  }
  return (
    <div className="card space-y-3">
      <p className="text-sm text-slate-600">Descarga datos por tabla, módulo, columna (p. ej. departamento o asesor), rango de fechas o selección. Las contraseñas, tokens y códigos nunca se exportan. Cada exportación queda en la bitácora.</p>
      {conSel && <div className="pill bl">Exportando {sel!.length} filas seleccionadas de {tabla} <button className="ml-2 underline" onClick={limpiarSel}>quitar</button></div>}
      <div className="grid sm:grid-cols-3 gap-2">
        <label className="f">Por módulo (todas sus tablas)<select className="inp" value={mod} disabled={conSel} onChange={(e) => setMod(e.target.value)}><option value="">— Una tabla —</option>{Array.from(new Set(todas.map((x) => x.m))).sort().map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="f">Tabla<select className="inp" value={conSel ? tabla : t} disabled={!!mod || conSel} onChange={(e) => setT(e.target.value)}>{todas.map((x) => <option key={x.n} value={x.n}>{x.m} · {x.n}</option>)}</select></label>
        <label className="f">Formato<select className="inp" value={fmt} onChange={(e) => setFmt(e.target.value)}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option><option value="json">JSON (.json)</option></select></label>
      </div>
      {!mod && !conSel && (
        <div className="grid sm:grid-cols-4 gap-2">
          <label className="f">Columna<select className="inp" value={col} onChange={(e) => setCol(e.target.value)}><option value="">—</option>{cols.filter((c) => !c.startsWith('_') && !(/password|hash|token|secret|clave/i.test(c))).map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="f">= valor<input className="inp" placeholder="Ej. Ventas" value={val} onChange={(e) => setVal(e.target.value)} /></label>
          <label className="f">Columna de fecha<select className="inp" value={cf} onChange={(e) => setCf(e.target.value)}><option value="">—</option>{cols.map((c) => <option key={c}>{c}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2"><label className="f">Desde<input type="date" className="inp" value={desde} onChange={(e) => setDesde(e.target.value)} /></label><label className="f">Hasta<input type="date" className="inp" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label></div>
        </div>
      )}
      <div className="flex justify-end"><button className="btn btn-p" disabled={ocupado} onClick={exportar}>{ocupado ? <span className="spin" /> : <Download />}{ocupado ? ' Exportando…' : 'Exportar'}</button></div>
    </div>
  )
}

/* ============================ Respaldos ============================ */
const NOTA_RESP = 'Columnas confidenciales (contraseñas, tokens, códigos) enmascaradas y no restaurables desde este respaldo.'
async function crearRespaldo(p: Panel, tipo: string, nombres: string[], progreso: (t: string) => void, detalle = ''): Promise<{ codigo: string; filas: number; tamano: number; ok: boolean }> {
  const JSZip = (await import('jszip')).default
  const codigo = 'RSP-' + sello().replace('_', '-') + '-' + Math.random().toString(16).slice(2, 6)
  const z = new JSZip(); const man: Manifiesto = { version: 1, id: codigo, tipo, fecha: new Date().toISOString(), tablas: [], propias: false, nota: NOTA_RESP }
  const propias: unknown[] = []; let total = 0; const enc = new TextEncoder()
  for (let k = 0; k < nombres.length; k++) {
    const n = nombres[k]; progreso(`Tabla ${k + 1} de ${nombres.length}: ${n}`)
    const d = await traerTodo(p, n); const pr = esProp(p, n)
    const filas = d.filas.map((f) => f.v.map((v) => (v === '••••••' ? '' : v)))
    const base = String(k).padStart(3, '0') + '_' + n.replace(/[^\w-]/g, '_')
    const json = JSON.stringify({ hoja: n, encabezados: d.encabezados, filas })
    z.file(base + '.csv', '﻿' + csvDe([d.encabezados, ...filas])); z.file(base + '.json', json)
    man.tablas.push({ nombre: n, archivo: base, filas: filas.length, columnas: d.encabezados.length, encabezados: d.encabezados, secretas: d.secretas, sha256: await sha256(enc.encode(json)) })
    total += filas.length
    if (pr) {
      const campos = pr.campos.filter((c) => c.activo !== false).map((c) => c.nombre)
      propias.push({ nombre: pr.nombre, base: pr.base, modulo: pr.modulo, descripcion: pr.descripcion, campos: pr.campos,
        registros: d.filas.map((f) => ({ id: f.id, activo: f.activo !== false, datos: Object.fromEntries(campos.map((c, i) => [c, f.v[i] ?? null]).filter(([, v]) => v !== null)) })) })
    }
  }
  if (propias.length) { man.propias = true; z.file('propias.json', JSON.stringify(propias)) }
  const manTxt = JSON.stringify(man, null, 1); z.file('manifiesto.json', manTxt)
  progreso('Comprimiendo…')
  const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  const shaMan = await sha256(enc.encode(manTxt))
  // verificación: se vuelve a leer el ZIP y se comparan las sumas de control
  const lec = await JSZip.loadAsync(await blob.arrayBuffer()); let ok = (await sha256(enc.encode(await lec.file('manifiesto.json')!.async('string')))) === shaMan
  for (const t of man.tablas) { const f = lec.file(t.archivo + '.json'); if (!f || (await sha256(enc.encode(await f.async('string')))) !== t.sha256) ok = false }
  progreso('Guardando respaldo…')
  const ruta = codigo + '.zip', nombreArch = `respaldo_vimedic_${tipo.replace(/\s+/g, '_')}_${sello()}.zip`
  const { error } = await supabase.storage.from('respaldos').upload(ruta, blob, { contentType: 'application/zip' })
  if (error) throw new Error(error.message)
  await rpc('bd_registrar_respaldo', { p_codigo: codigo, p_tipo: tipo, p_archivo: ruta, p_nombre: nombreArch, p_tamano: blob.size, p_tablas: nombres, p_filas: total, p_sha: shaMan, p_verificado: ok ? 'SI' : 'NO', p_detalle: detalle })
  return { codigo, filas: total, tamano: blob.size, ok }
}
async function leerZip(r: Respaldo) {
  const { data, error } = await supabase.storage.from('respaldos').download(r.archivo ?? '')
  if (error || !data) throw new Error(error?.message || 'No se pudo descargar el respaldo.')
  const JSZip = (await import('jszip')).default
  const z = await JSZip.loadAsync(await data.arrayBuffer()), mf = z.file('manifiesto.json')
  if (!mf) throw new Error('El respaldo no tiene manifiesto: está dañado.')
  const txt = await mf.async('string')
  return { z, man: JSON.parse(txt) as Manifiesto, shaMan: await sha256(new TextEncoder().encode(txt)), blob: data }
}
async function verificarZip(r: Respaldo) {
  const { z, man, shaMan } = await leerZip(r); const errores: string[] = []
  if (r.sha256 && shaMan !== r.sha256) errores.push('El manifiesto no coincide con el registrado')
  for (const t of man.tablas) { const f = z.file(t.archivo + '.json'); if (!f) errores.push('Falta ' + t.nombre); else if ((await sha256(new TextEncoder().encode(await f.async('string')))) !== t.sha256) errores.push('Suma de control distinta en ' + t.nombre) }
  return { ok: !errores.length, errores, man }
}

function PRespaldos({ p, puede, aviso, confirmar, reautenticar, recargar }: { p: Panel; puede: (a: string) => boolean; aviso: (t: string) => void; confirmar: (t: string, x: string, rojo?: boolean) => Promise<boolean>; reautenticar: () => Promise<void>; recargar: () => void }) {
  const [lista, setLista] = useState<Respaldo[] | null>(null)
  const [er, setEr] = useState('')
  const [prog, setProg] = useState('')
  const [rest, setRest] = useState<Respaldo | null>(null)
  const cargarL = useCallback(async () => {
    const { data, error } = await supabase.from('bd_respaldos').select('id,codigo,tipo,archivo,nombre,tamano,tablas,filas,sha256,verificado,estado,created_at,por_nombre').is('deleted_at', null).order('created_at', { ascending: false }).limit(200)
    if (error) setEr(error.message); else setLista((data as Respaldo[]) ?? [])
  }, [])
  useEffect(() => { cargarL() }, [cargarL])
  if (!puede('respaldar') && !puede('restaurar') && !puede('administrar')) return <div className="card text-sm">Necesitas el permiso «respaldar» o «restaurar» de Bases de Datos.</div>
  if (er) return <div className="card text-sm text-red-700">{er}</div>
  return (
    <>
      <div className="card mb-3 flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[240px] text-sm text-slate-600">Cada respaldo es un ZIP en un almacenamiento privado: CSV y JSON de cada tabla y un manifiesto con sumas de control SHA-256 que se verifican al crearlo. Además, Supabase conserva sus propias copias diarias de todo el proyecto. Los respaldos programados automáticamente todavía no están activados.</div>
        {puede('respaldar') && (
          <button className="btn btn-p" disabled={!!prog} onClick={async () => {
            try {
              const r = await crearRespaldo(p, 'manual', [...p.propias.map((t) => t.nombre), ...p.tablas.map((t) => t.nombre)], setProg)
              aviso(`Respaldo listo: ${nf(r.filas)} filas · ${kb(r.tamano)}${r.ok ? ' · verificado' : ' · FALLÓ la verificación'}`)
            } catch (e) { aviso(msg(e)) }
            setProg(''); cargarL()
          }}>{prog ? <span className="spin" /> : <Archive />}{prog || 'Respaldar ahora'}</button>
        )}
      </div>
      {!lista ? <div className="text-center py-10 text-slate-400"><span className="spin" /></div> : (
        <div className="tw"><table className="t"><thead><tr><th>Fecha</th><th>Tipo</th><th>Tablas</th><th className="text-right">Filas</th><th className="text-right">Tamaño</th><th>Verificado</th><th>Estado</th><th /></tr></thead><tbody>
          {lista.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{fecha(r.created_at)}<div className="mono text-[10px] text-slate-400">{r.codigo}</div></td><td>{r.tipo}</td>
              <td className="text-[11px] max-w-[260px] truncate" title={r.tablas.join(', ')}>{r.tablas.length} tablas</td><td className="text-right">{nf(r.filas)}</td><td className="text-right">{kb(r.tamano)}</td>
              <td><span className={'pill ' + (r.verificado === 'SI' ? 'ok' : r.verificado === 'NO' ? 'no' : 'wa')}>{r.verificado}</span></td><td className="text-[11px]">{r.estado}</td>
              <td className="whitespace-nowrap">
                <button className="btn !py-1 !px-2" title="Verificar" onClick={async () => {
                  try { const v = await verificarZip(r); await rpc('bd_marcar_verificado', { p_id: r.id, p_ok: v.ok, p_detalle: v.errores.join('; ') }); aviso(v.ok ? `Respaldo íntegro (${v.man.tablas.length} tablas)` : 'Falló: ' + v.errores.join('; ')); cargarL() } catch (e) { aviso(msg(e)) }
                }}><ShieldCheck /></button>
                {puede('exportar') && puede('respaldar') && <button className="btn !py-1 !px-2 ml-1" title="Descargar ZIP" onClick={async () => {
                  const { data, error } = await supabase.storage.from('respaldos').createSignedUrl(r.archivo ?? '', 120, { download: r.nombre ?? true })
                  if (error || !data) { aviso(error?.message ?? 'No se pudo preparar la descarga.'); return }
                  auditar('Descarga de respaldo', r.codigo, ''); window.open(data.signedUrl, '_blank', 'noopener')
                }}><Download /></button>}
                {puede('restaurar') && <button className="btn !py-1 !px-2 ml-1" title="Restaurar" onClick={() => setRest(r)}><ArchiveRestore /></button>}
              </td>
            </tr>
          ))}
          {!lista.length && <tr><td colSpan={8} className="text-center py-6 text-slate-400">Todavía no hay respaldos</td></tr>}
        </tbody></table></div>
      )}
      {rest && <ModalRestaurar r={rest} p={p} cerrar={() => setRest(null)} aviso={aviso} confirmar={confirmar} reautenticar={reautenticar} hecho={() => { setRest(null); cargarL(); recargar() }} />}
    </>
  )
}

function ModalRestaurar({ r, p, cerrar, aviso, reautenticar, hecho }: { r: Respaldo; p: Panel; cerrar: () => void; aviso: (t: string) => void; confirmar: (t: string, x: string, rojo?: boolean) => Promise<boolean>; reautenticar: () => Promise<void>; hecho: () => void }) {
  const [v, setV] = useState<{ ok: boolean; errores: string[]; man: Manifiesto } | null>(null)
  const [er, setEr] = useState('')
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())
  const [conf, setConf] = useState('')
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { verificarZip(r).then((x) => { setV(x); setElegidas(new Set(x.man.tablas.filter((t) => t.nombre.startsWith('BD_')).map((t) => t.nombre))) }).catch((e) => setEr(msg(e))) }, [r])
  const superadmin = p.superadmin
  const restaurar = async () => {
    if (conf.trim() !== 'RESTAURAR') { aviso('Escribe RESTAURAR para confirmar.'); return }
    if (!superadmin) { aviso('Solo un Superadministrador restaura sobre los datos actuales.'); return }
    if (!elegidas.size) { aviso('Elige al menos una tabla propia.'); return }
    setOcupado(true)
    try {
      await reautenticar()
      const nombres = [...elegidas]
      const pto = await crearRespaldo(p, 'punto de recuperación', nombres.filter((n) => esProp(p, n)), () => undefined, 'Antes de restaurar ' + r.codigo)
      const { z } = await leerZip(r)
      const todas = JSON.parse(await z.file('propias.json')!.async('string')) as { nombre: string }[]
      const res = await rpc<{ tablas: number; registros: number }>('bd_restaurar_propias', { p_tablas: todas.filter((t) => elegidas.has(t.nombre)) })
      aviso(`Restauración terminada: ${res.tablas} tablas, ${res.registros} registros · punto de recuperación ${pto.codigo}`); hecho()
    } catch (e) { aviso(msg(e)); setOcupado(false) }
  }
  return (
    <div className="ovl"><div className="modal" style={{ maxWidth: 860 }}>
      <div className="flex items-center mb-2"><h3 className="font-display font-bold text-base">Restaurar {r.codigo}</h3><button className="btn ml-auto !p-2" onClick={cerrar}><X /></button></div>
      {er ? <div className="card text-sm text-red-700">{er}</div> : !v ? <div className="text-center py-10 text-slate-400"><span className="spin" /> Verificando respaldo…</div> : (
        <>
          <p className="text-xs mb-2">{fecha(r.created_at)} · {r.tipo} · <span className={'pill ' + (v.ok ? 'ok' : 'no')}>{v.ok ? 'Íntegro' : 'Dañado: ' + v.errores.join('; ')}</span></p>
          <div className="tw" style={{ maxHeight: '40vh' }}><table className="t"><thead><tr><th /><th>Tabla</th><th className="text-right">Filas respaldo</th><th className="text-right">Filas hoy</th><th>Compatibilidad</th></tr></thead><tbody>
            {v.man.tablas.map((t) => {
              const prop = esProp(p, t.nombre), sis = p.tablas.find((x) => x.nombre === t.nombre), propia = t.nombre.startsWith('BD_')
              const actual = sis?.cols ?? [], faltan = sis ? t.encabezados.filter((c) => c && !actual.includes(c)) : [], nuevas = sis ? actual.filter((c) => !t.encabezados.includes(c)) : []
              return (
                <tr key={t.nombre}>
                  <td>{propia && <input type="checkbox" checked={elegidas.has(t.nombre)} onChange={(e) => { const s = new Set(elegidas); if (e.target.checked) s.add(t.nombre); else s.delete(t.nombre); setElegidas(s) }} />}</td>
                  <td><b>{t.nombre}</b>{propia ? <> <span className="pill bl">propia</span></> : <> <span className="pill gr">solo vista previa</span></>}{!prop && !sis && <> <span className="pill wa">no existe hoy</span></>}</td>
                  <td className="text-right">{nf(t.filas)}</td><td className="text-right">{nf(prop?.filas ?? sis?.filas ?? 0)}</td>
                  <td className="text-[11px]">{faltan.length ? 'Ya no existen: ' + faltan.join(', ') : ''}{faltan.length && nuevas.length ? <br /> : null}{nuevas.length ? 'Nuevas: ' + nuevas.join(', ') : ''}{!faltan.length && !nuevas.length ? <span className="pill ok">Compatible</span> : null}</td>
                </tr>
              )
            })}
          </tbody></table></div>
          <div className="card !p-3 mt-3 text-xs text-slate-600">Desde aquí se restauran las <b>tablas propias</b> (BD_…): se reemplaza su contenido y antes se guarda un punto de recuperación. Las tablas del sistema (clientes, productos, facturas…) no se sobrescriben desde la aplicación: para volver atrás usa las copias de Supabase, o descarga este ZIP y recupera los datos que necesites.</div>
          <label className="f mt-3">Escribe RESTAURAR para confirmar<input className="inp" autoComplete="off" value={conf} onChange={(e) => setConf(e.target.value)} /></label>
          <div className="flex justify-end gap-2 mt-3"><button className="btn" onClick={cerrar}>Cancelar</button>
            <button className="btn btn-r" disabled={!v.ok || ocupado || !superadmin || !elegidas.size} onClick={restaurar}>{ocupado ? <span className="spin" /> : <ArchiveRestore />}Restaurar tablas propias</button></div>
          {!superadmin && <p className="text-[11px] text-slate-500 mt-1 text-right">Solo un Superadministrador puede restaurar.</p>}
        </>
      )}
    </div></div>
  )
}

/* ============================ Permisos y ajustes ============================ */
const ACC_BD = ['ver', 'crear', 'editar', 'eliminar', 'exportar', 'respaldar', 'restaurar', 'administrar']
function PAjustes() {
  const [m, setM] = useState<{ id: string; nombre: string; email: string; superadmin: boolean; permisos: Record<string, string[]> }[] | null>(null)
  const [er, setEr] = useState('')
  useEffect(() => { rpc<typeof m>('seg_matriz').then(setM).catch((e) => setEr(msg(e))) }, [])
  return (
    <>
      <div className="card mb-3"><p className="text-sm text-slate-600">Los permisos de Bases de Datos se dan con el rol de cada persona (módulo «Bases de Datos») o como permisos extra, desde <b>Seguridad › Roles</b> y <b>Empleados</b>. Nadie puede dar un permiso que no tiene, y «restaurar» solo funciona para un Superadministrador.</p></div>
      {er ? <div className="card text-sm text-red-700">{er}</div> : !m ? <div className="text-center py-10 text-slate-400"><span className="spin" /></div> : (
        <div className="tw"><table className="t"><thead><tr><th>Persona</th>{ACC_BD.map((a) => <th key={a} className="text-center">{a}</th>)}</tr></thead><tbody>
          {m.filter((x) => x.superadmin || x.permisos?.basedatos?.length).map((x) => (
            <tr key={x.id}><td><b>{x.nombre || x.email}</b>{x.superadmin && <> <span className="pill bl">SA</span></>}<div className="text-[11px] text-slate-500">{x.email}</div></td>
              {ACC_BD.map((a) => <td key={a} className="text-center">{x.superadmin || x.permisos?.basedatos?.includes(a) ? <span className="pill ok">sí</span> : ''}</td>)}</tr>
          ))}
        </tbody></table></div>
      )}
    </>
  )
}
