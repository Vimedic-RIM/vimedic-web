import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, BookOpen, Calendar, CalendarCheck, CalendarPlus, Check, CheckCheck, ClipboardList, Cpu, FileCheck2, FileText, Gauge, GraduationCap, Hammer, History, Hourglass, Lightbulb, List, ListChecks, MapPin, MessageCircle, PackageOpen, Package, Pencil, Phone, Play, Plus, PlugZap, RefreshCw, RotateCcw, Save, ScanSearch, Search, ShieldAlert, Stethoscope, User, UserPlus, Users, Wrench, X, XCircle, BadgeCheck, Camera } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { agrupar } from '../tiempoReal'
import { puede } from '../permisos'
import { descargarInforme, TITULOS, type OrdenDoc, type EquipoDoc } from './servicioInforme'
import '../estilos/servicio.css'
// Equipos de importación con defecto (RecepcionImportacion.gs): se carga solo al abrir la pestaña
const RecepcionImp = lazy(() => import('./RecepcionImportaciones'))


/* ============================ Tipos y constantes ============================ */
const TIPOS = ['Instalación', 'Capacitación', 'Mantenimiento preventivo', 'Mantenimiento correctivo', 'Diagnóstico', 'Inspección técnica', 'Calibración', 'Baja técnica']
const COBERTURAS = ['Garantía', 'Incluido en la venta', 'Contrato', 'Facturable', 'Cortesía']
const MODALIDADES = ['En sitio', 'Taller', 'Remoto']
const PRIORIDADES = ['Normal', 'Alta', 'Urgente']
const ESTADOS_FINALES = ['Operativo', 'Operativo con observaciones', 'No operativo', 'Dado de baja']
const PLANES = ['Facturable', 'Incluido', 'Contrato', 'Sin plan']
const RESULTADOS = ['OK', 'Corregido', 'Falla', 'N/A']
const ESTADOS_INV = ['Pendiente de revisión', 'En diagnóstico', 'En reparación', 'Esperando repuesto', 'Listo para revisión de Bodega', 'No reparable', 'Resuelto']
const SUGERIDAS: Record<string, [string, string, string][]> = {
  '*': [['Voltaje de alimentación', 'V', '110 – 127'], ['Corriente de fuga', 'µA', '< 500']],
  autoclave: [['Temperatura de esterilización', '°C', '121 / 134'], ['Presión de cámara', 'bar', '1,1 / 2,1'], ['Tiempo de ciclo', 'min', '—'], ['Vacío alcanzado', 'bar', '≤ -0,8']],
  monitor: [['Frecuencia cardíaca (simulador)', 'lpm', '± 1'], ['SpO2 (simulador)', '%', '± 2'], ['PNI (simulador)', 'mmHg', '± 3']],
  'succión': [['Presión de vacío máxima', 'kPa', '≥ 80']], desfibrilador: [['Energía entregada (200 J)', 'J', '± 15 %']],
}
const ICONO_TIPO: Record<string, typeof Wrench> = { 'Instalación': PlugZap, 'Capacitación': GraduationCap, 'Mantenimiento preventivo': CalendarCheck, 'Mantenimiento correctivo': Wrench, 'Diagnóstico': Stethoscope, 'Inspección técnica': ScanSearch, 'Calibración': Gauge, 'Baja técnica': Archive }
type Ck = { actividad: string; resultado: string; obs: string }
type Med = { parametro: string; valor: string; unidad: string; referencia: string; resultado: string }
type Foto = { url: string; etapa: string; nota: string }
type Evento = { fecha: string; por: string; nota: string; publico: boolean }
type Orden = {
  id: string; codigo: string; fecha: string; tipo: string; origen: string; prioridad: string; estado: string; modalidad: string; cobertura: string; equipoId: string; serie: string; producto: string; empresa: string
  cliente: string; identificacion: string; contacto: string; telefono: string; email: string; direccion: string; ciudad: string; facturaId: string | null; factura: string; asesor: string; asesorId: string | null
  tecnico: string; tecnicoId: string | null; fechaProgramada: string; falla: string; recepcion: Record<string, string>; diagnostico: string; checklist: Ck[]; mediciones: Med[]; trabajo: string
  repuestos: { id: string; nombre: string; cantidad: number; precio: number }[]; asistentes: { nombre: string; cargo: string; cedula: string }[]; fotos: Foto[]; recomendaciones: string; estadoFinal: string
  proximoMantenimiento: string; horas: number; firma: Record<string, string>; inicio: string; cierre: string; informeN: string; recepcionN: string; repuestosDescontados: boolean; facturacion: string; eventos: Evento[]; actualizado: string
  linkCliente: string
}
type Equipo = {
  id: string; codigo: string; serie: string; producto: string; marca: string; modelo: string; empresa: string; operacion: string; factura: string; facturaId: string | null; cliente: string; identificacion: string; telefono: string
  email: string; ciudad: string; direccion: string; asesor: string; fechaEntrega: string; garantiaMeses: number | null; garantiaHasta: string; garantia: string; plan: string; frecuencia: number; proximo: string
  estado: string; ubicacion: string; notas: string; lote: string; proveedor: string; importacion: string; preventivoVencido: boolean; garantiaEnRiesgo: boolean; codigoProducto: string
}
type Tecnico = { id: string | null; nombre: string; tipo: 'Interno' | 'Externo'; empresa: string; email: string; telefono: string; especialidad: string; activo: boolean }
const COLS_OS = 'id,codigo,token,fecha,tipo,origen,prioridad,estado,modalidad,cobertura,equipo_id,serie,producto_texto,empresa,cliente_texto,identificacion,contacto,telefono,email,direccion,ciudad,factura_id,factura_texto,asesor_id,tecnico_id,tecnico_texto,fecha_programada,falla_reportada,recepcion,diagnostico,checklist,mediciones,trabajo_realizado,repuestos,asistentes,fotos,recomendaciones,estado_final,proximo_mantenimiento,horas,firma,inicio,cierre,informe_numero,recepcion_numero,repuestos_descontados,facturacion,eventos,updated_at,asesor:empleados!st_ordenes_asesor_id_fkey(nombre)'
const COLS_EQ = 'id,codigo,empresa,serie,producto_id,producto_texto,marca,modelo,lote,proveedor_texto,importacion_codigo,factura_id,operacion_codigo,factura_texto,cliente_texto,identificacion,telefono,email,ciudad,direccion,ubicacion,fecha_entrega,garantia_meses,garantia_hasta,plan_mantenimiento,frecuencia_meses,proximo_mantenimiento,estado,notas,asesor:empleados!st_equipos_asesor_id_fkey(nombre),producto:productos!st_equipos_producto_id_fkey(codigo)'

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const slug = (v: string) => norm(v).replace(/[^a-z0-9]/g, '')
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const objeto = <T,>(v: unknown): T => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : ({} as T))
const dfecha = (iso: string) => { if (!iso) return '—'; const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-EC', { weekday: 'short', day: '2-digit', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) }
const dhora = (iso: string) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) }
const ymd = (iso: string) => { if (!iso) return ''; if (iso.length === 10) return iso; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const hm = (iso: string) => { if (!iso || iso.length === 10) return ''; const d = new Date(iso); return isNaN(d.getTime()) || (!d.getHours() && !d.getMinutes()) || (d.getHours() === 12 && !d.getMinutes()) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
const hoyYmd = () => ymd(new Date().toISOString())
const esHoy = (iso: string) => !!iso && ymd(iso) === hoyYmd()
const waNum = (t: string) => { const d = String(t || '').replace(/\D/g, ''); if (d.startsWith('593')) return d; if (d.startsWith('0')) return '593' + d.slice(1); return d.length === 9 ? '593' + d : d }
const abierta = (o: Orden) => o.estado !== 'Finalizada' && o.estado !== 'Cancelada'
const enTrabajo = (o: Orden) => ['En proceso', 'Esperando aprobación', 'Esperando repuesto'].includes(o.estado)
const mapOrden = (x: any): Orden => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: x.id, codigo: x.codigo ?? '', fecha: x.fecha, tipo: x.tipo ?? '', origen: x.origen ?? '', prioridad: x.prioridad ?? 'Normal', estado: x.estado ?? 'Recibida', modalidad: x.modalidad ?? 'En sitio', cobertura: x.cobertura ?? '', equipoId: x.equipo_id ?? '',
  serie: x.serie ?? '', producto: x.producto_texto ?? '', empresa: x.empresa ?? '', cliente: x.cliente_texto ?? '', identificacion: x.identificacion ?? '', contacto: x.contacto ?? '', telefono: x.telefono ?? '', email: x.email ?? '',
  direccion: x.direccion ?? '', ciudad: x.ciudad ?? '', facturaId: x.factura_id ?? null, factura: x.factura_texto ?? '', asesor: x.asesor?.nombre ?? '', asesorId: x.asesor_id ?? null, tecnico: x.tecnico_texto ?? '', tecnicoId: x.tecnico_id ?? null,
  fechaProgramada: x.fecha_programada ?? '', falla: x.falla_reportada ?? '', recepcion: objeto(x.recepcion), diagnostico: x.diagnostico ?? '', checklist: arr<Ck>(x.checklist), mediciones: arr<Med>(x.mediciones), trabajo: x.trabajo_realizado ?? '',
  repuestos: arr(x.repuestos), asistentes: arr(x.asistentes), fotos: arr<Foto>(x.fotos), recomendaciones: x.recomendaciones ?? '', estadoFinal: x.estado_final ?? '', proximoMantenimiento: x.proximo_mantenimiento ?? '', horas: Number(x.horas) || 0,
  firma: objeto(x.firma), inicio: x.inicio ?? '', cierre: x.cierre ?? '', informeN: x.informe_numero ?? '', recepcionN: x.recepcion_numero ?? '', repuestosDescontados: !!x.repuestos_descontados, facturacion: x.facturacion ?? '', eventos: arr<Evento>(x.eventos), actualizado: x.updated_at ?? '',
  linkCliente: x.token ? window.location.origin + '/servicio/?c=' + x.token : '', // seguimiento público del cliente (vmServicioPublico)
})
const mapEquipo = (x: any): Equipo => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const hoy = new Date(), hasta = x.garantia_hasta ? new Date(x.garantia_hasta + 'T23:59:59') : null, prox = x.proximo_mantenimiento ? new Date(x.proximo_mantenimiento + 'T12:00:00') : null
  const plan = x.plan_mantenimiento || 'Sin plan'
  const garantia = hasta ? (hasta >= hoy ? 'Vigente' : 'Vencida') : x.garantia_meses === 0 ? 'Sin garantía' : 'Por confirmar'
  return { id: x.id, codigo: x.codigo ?? '', serie: x.serie ?? '', producto: x.producto_texto ?? '', marca: x.marca ?? '', modelo: x.modelo ?? '', empresa: x.empresa ?? '', operacion: x.operacion_codigo ?? '', factura: x.factura_texto ?? '', facturaId: x.factura_id ?? null,
    cliente: x.cliente_texto ?? '', identificacion: x.identificacion ?? '', telefono: x.telefono ?? '', email: x.email ?? '', ciudad: x.ciudad ?? '', direccion: x.direccion ?? '', asesor: x.asesor?.nombre ?? '', fechaEntrega: x.fecha_entrega ?? '',
    garantiaMeses: x.garantia_meses ?? null, garantiaHasta: x.garantia_hasta ?? '', garantia, plan, frecuencia: x.frecuencia_meses ?? 0, proximo: x.proximo_mantenimiento ?? '', estado: x.estado ?? 'Operativo', ubicacion: x.ubicacion ?? '', notas: x.notas ?? '', lote: x.lote ?? '',
    proveedor: x.proveedor_texto ?? '', importacion: x.importacion_codigo ?? '', preventivoVencido: !!(prox && plan !== 'Sin plan' && prox < hoy), garantiaEnRiesgo: !!(garantia === 'Vigente' && prox && plan !== 'Sin plan' && hoy.getTime() - prox.getTime() > 30 * 86400000), codigoProducto: x.producto?.codigo ?? '' }
}
const coberturaSugerida = (tipo: string, e: Equipo) => tipo === 'Instalación' || tipo === 'Capacitación' ? 'Incluido en la venta' : tipo === 'Mantenimiento preventivo' ? (e.plan === 'Incluido' ? 'Incluido en la venta' : e.plan === 'Contrato' ? 'Contrato' : 'Facturable') : (tipo === 'Mantenimiento correctivo' || tipo === 'Diagnóstico') && e.garantia === 'Vigente' ? 'Garantía' : 'Facturable'
const codigoNuevo = (pref: string) => `${pref}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`
const token = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 32)
const sugeridasDe = (producto: string) => { const p = norm(producto); let out: [string, string, string][] = []; Object.keys(SUGERIDAS).forEach((k) => { if (k !== '*' && p.includes(norm(k))) out = out.concat(SUGERIDAS[k]) }); return out.concat(SUGERIDAS['*']).map(([parametro, unidad, referencia]) => ({ parametro, unidad, referencia })) }

function reducir(file: File, max = 1280): Promise<Blob> {
  return new Promise((ok, ko) => { const u = URL.createObjectURL(file), img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob((b) => (b ? ok(b) : ko(new Error('No se pudo procesar la foto.'))), 'image/jpeg', 0.8) }; img.onerror = () => ko(new Error('No se pudo leer la foto.')); img.src = u })
}
const Spin = () => <span className="spin" />
function Hoja({ cerrar, children }: { cerrar: () => void; children: React.ReactNode }) { return <div className="ovl" onClick={cerrar}><div className="sheet" onClick={(e) => e.stopPropagation()}>{children}</div></div> }
function Seg({ opciones, valor, cambia }: { opciones: string[]; valor: string; cambia: (v: string) => void }) { return <div className="seg">{opciones.map((x) => <button key={x} type="button" className={x === valor ? 'on' : ''} onClick={() => cambia(x)}>{x}</button>)}</div> }
function Foto({ ruta, ancho = 86 }: { ruta: string; ancho?: number }) {
  const [url, setUrl] = useState(/^https?:/i.test(ruta) ? ruta : '')
  useEffect(() => { if (!/^https?:/i.test(ruta)) supabase.storage.from('servicio-tecnico').createSignedUrl(ruta, 3600).then(({ data }) => { if (data) setUrl(data.signedUrl) }) }, [ruta])
  return url ? <a href={url} target="_blank" rel="noopener"><img src={url} alt="" style={{ width: ancho, height: ancho }} /></a> : <span className="spin" />
}

/* ============================ Pantalla principal ============================ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ServicioTecnico({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [ordenes, setOrdenes] = useState<Orden[] | null>(null)
  const [equipos, setEquipos] = useState<Equipo[] | null>(null)
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [error, setError] = useState('')
  const [tab, setTab] = useState('inventario')
  const [q, setQ] = useState('')
  const [panel, setPanel] = useState<{ tipo: 'orden' | 'equipo' | 'producto'; id: string } | null>(null)
  const [hoja, setHoja] = useState<{ k: 'nueva' | 'registrar' | 'tecnico'; eq?: Equipo; tec?: Tecnico } | null>(null)
  const [sync, setSync] = useState(false)
  const editar = puede(perfil, 'servicio_tecnico', 'editar')
  const externo = useMemo(() => tecnicos.some((t) => t.tipo === 'Externo' && t.activo && t.email && t.email === perfil.email.toLowerCase()), [tecnicos, perfil.email])
  const miNombre = externo ? tecnicos.find((t) => t.email === perfil.email.toLowerCase())!.nombre : perfil.nombre
  const yaPreventivos = useRef(false)

  const cargarTecnicos = useCallback(async () => {
    const [ext, int] = await Promise.all([supabase.from('st_tecnicos').select('id,nombre,empresa,email,telefono,especialidad,activo').is('deleted_at', null).order('nombre'), supabase.rpc('st_tecnicos_internos')])
    const externos: Tecnico[] = ((ext.data ?? []) as unknown as Record<string, any>[]).map((t) => ({ id: t.id, nombre: t.nombre, tipo: 'Externo', empresa: t.empresa ?? '', email: String(t.email ?? '').toLowerCase(), telefono: t.telefono ?? '', especialidad: t.especialidad ?? '', activo: t.activo !== false }))
    const correos = new Set(externos.map((t) => t.email).filter(Boolean))
    const internos: Tecnico[] = ((int.data ?? []) as { id: string; nombre: string; email: string; telefono: string }[]).filter((t) => !correos.has(t.email)).map((t) => ({ id: null, nombre: t.nombre, tipo: 'Interno', empresa: '', email: t.email, telefono: t.telefono ?? '', especialidad: '', activo: true }))
    setTecnicos([...internos, ...externos])
  }, [])
  const cargarOrdenes = useCallback(async () => {
    const limite = new Date(Date.now() - 120 * 86400000).toISOString()
    const { data, error } = await supabase.from('st_ordenes').select(COLS_OS).is('deleted_at', null).or(`estado.not.in.(Finalizada,Cancelada),cierre.gte.${limite},cierre.is.null`).order('fecha', { ascending: false }).limit(600)
    if (error) { setError(error.message); return }
    setError(''); setOrdenes((data ?? []).map(mapOrden))
  }, [])
  const cargarEquipos = useCallback(async () => {
    const { data, error } = await supabase.from('st_equipos').select(COLS_EQ).is('deleted_at', null).order('created_at', { ascending: false }).limit(1500)
    if (error) { setError(error.message); return }
    setEquipos((data ?? []).map(mapEquipo))
  }, [])
  const recargar = useCallback(async () => { await cargarOrdenes(); cargarEquipos() }, [cargarOrdenes, cargarEquipos])
  useEffect(() => {
    cargarTecnicos()
    ;(async () => { if (editar && !yaPreventivos.current) { yaPreventivos.current = true; await supabase.rpc('st_programar_preventivos') } await cargarOrdenes(); cargarEquipos() })()
  }, [cargarTecnicos, cargarOrdenes, cargarEquipos, editar])
  useEffect(() => {
    const recargar = agrupar(() => cargarOrdenes())
    const c = supabase.channel('st-ordenes').on('postgres_changes', { event: '*', schema: 'public', table: 'st_ordenes' }, recargar).subscribe()
    return () => { recargar.cancelar(); supabase.removeChannel(c) }
  }, [cargarOrdenes])
  useEffect(() => { if (externo && (tab === 'inventario' || tab === 'agendar')) setTab('mias') }, [externo, tab])

  const O = (ordenes ?? []).filter((o) => !externo || norm(o.tecnico) === norm(miNombre))
  const E = equipos ?? []
  const enTab = (o: Orden, t: string) => t === 'agendar' ? o.estado === 'Recibida' : t === 'agendadas' ? o.estado === 'Agendada' : t === 'proceso' ? ['En proceso', 'Esperando aprobación', 'Esperando repuesto'].includes(o.estado) : t === 'mias' ? abierta(o) && norm(o.tecnico) === norm(perfil.nombre) : t === 'finalizadas' ? !abierta(o) : false
  const ab = O.filter(abierta)
  const en30 = new Date(Date.now() + 30 * 86400000)
  const kpis: [string, number, string][] = [['Abiertas', ab.length, ''], ['Para hoy', ab.filter((o) => esHoy(o.fechaProgramada)).length, ''], ['Esperan aprobación', ab.filter((o) => o.estado === 'Esperando aprobación').length, ''],
    ['Preventivos 30 días', E.filter((e) => e.proximo && e.plan !== 'Sin plan' && new Date(e.proximo + 'T12:00:00') <= en30).length, ''], ['Garantía en riesgo', E.filter((e) => e.garantiaEnRiesgo).length, E.some((e) => e.garantiaEnRiesgo) ? 'alerta' : '']]
  const TABS: [string, string][] = [['inventario', 'Inventario con observaciones'], ['agendar', 'Por agendar'], ['agendadas', 'Agendadas'], ['proceso', 'En proceso'], ['mias', 'Mis órdenes'], ['finalizadas', 'Finalizadas'], ['equipos', 'Equipos'], ['importaciones', 'Importaciones'], ['documentos', 'Documentos técnicos'], ['tecnicos', 'Técnicos']]
  const tabsVis = TABS.filter(([k]) => !externo || ['mias', 'finalizadas'].includes(k))
  const cuenta = (k: string) => k === 'equipos' ? E.length : k === 'tecnicos' ? tecnicos.filter((t) => t.tipo === 'Externo').length + tecnicos.filter((t) => t.tipo === 'Interno').length : k === 'inventario' || k === 'documentos' || k === 'importaciones' ? null : O.filter((o) => enTab(o, k)).length

  const lista = useMemo(() => {
    const w = norm(q).trim().split(/\s+/).filter(Boolean), pr: Record<string, number> = { Urgente: 0, Alta: 1, Normal: 2 }
    return O.filter((o) => enTab(o, tab) && (!w.length || w.every((x) => norm([o.codigo, o.cliente, o.serie, o.producto, o.tipo, o.tecnico, o.ciudad, o.falla].join(' ')).includes(x))))
      .sort((a, b) => tab === 'finalizadas' ? b.cierre.localeCompare(a.cierre) : (pr[a.prioridad] - pr[b.prioridad]) || (a.fechaProgramada || a.fecha).localeCompare(b.fechaProgramada || b.fecha))
  }, [O, tab, q]) // eslint-disable-line react-hooks/exhaustive-deps

  async function sincronizar() {
    setSync(true)
    const { data, error } = await supabase.rpc('st_sincronizar')
    setSync(false)
    if (error) { aviso(error.message); return }
    const r = data as { nuevos: number; garantias: number }
    aviso(`${r.nuevos} equipo(s) nuevo(s) · ${r.garantias} garantía(s) actualizada(s)`); cargarEquipos()
  }

  const esListaOrdenes = !['inventario', 'equipos', 'documentos', 'tecnicos', 'importaciones'].includes(tab)
  return (
    <div className="vm-st">
      <header className="hdr text-white">
        <div className="w-full px-4 lg:px-6 py-3 flex items-center gap-3 flex-wrap vm-head-pad">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><Wrench style={{ width: 20, height: 20 }} /></div>
          <div className="min-w-0"><h1 className="font-display font-bold text-lg leading-tight">Servicio Técnico</h1><p className="text-[11px] text-white/70">Observaciones de inventario, seguimiento por serie e informes técnicos · {miNombre}{externo ? ' (técnico externo)' : ''}</p></div>
          <div className="ml-auto flex gap-2">
            {!externo && editar && <button className="btn btn-sm !bg-white !border-white !text-[var(--acc)]" onClick={() => setHoja({ k: 'nueva' })}><Plus />Nueva orden</button>}
            <button className="btn btn-sm !bg-white/10 !border-white/20 !text-white" title="Actualizar" onClick={() => { recargar(); cargarTecnicos() }}><RefreshCw /></button>
          </div>
        </div>
      </header>
      <main className="w-full px-4 lg:px-6 py-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">{kpis.filter((_, i) => !externo || i < 3).map(([t, n, c]) => <div key={t} className={'kpi ' + c}><span>{t}</span><b>{n}</b></div>)}</div>
        <div className="tabs">{tabsVis.map(([k, t]) => <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => { setTab(k); setQ('') }}>{t}{cuenta(k) != null && <b>{cuenta(k)}</b>}</button>)}</div>
        <div className="flex gap-2 items-center">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp !pl-9" placeholder="Buscar cliente, serie, equipo, orden…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {tab === 'equipos' && !externo && editar && <div className="flex gap-2"><button className="btn btn-sm" onClick={() => setHoja({ k: 'registrar' })}><Plus />Registrar equipo</button><button className="btn btn-sm" disabled={sync} onClick={sincronizar} title="Traer equipos de ventas ya despachadas">{sync ? <Spin /> : <><RefreshCw />Sincronizar</>}</button></div>}
          {tab === 'tecnicos' && !externo && editar && <button className="btn btn-sm" onClick={() => setHoja({ k: 'tecnico' })}><UserPlus />Técnico externo</button>}
        </div>
        {error && <div className="text-center py-14 text-red-600 font-semibold">{error}</div>}
        {tab === 'inventario' && <Inventario perfil={perfil} q={q} editar={editar} aviso={aviso} />}
        {tab === 'importaciones' && !externo && <Suspense fallback={<div className="text-center py-14 text-slate-400"><span className="spin" /> Cargando…</div>}><RecepcionImp perfil={perfil} aviso={aviso} area="st" /></Suspense>}
        {tab === 'documentos' && <div className="sec text-sm text-slate-600"><b>Documentos técnicos</b> (manuales, protocolos y fichas por producto) tiene su propio módulo con permiso <span className="mono">documentos_tecnicos</span>; se migra en su turno. Esta pestaña se activará cuando exista.</div>}
        {tab === 'tecnicos' && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {tecnicos.map((t) => (
              <div key={t.nombre + t.email} className="card" onClick={() => (t.tipo === 'Externo' ? !externo && editar && setHoja({ k: 'tecnico', tec: t }) : aviso('Los técnicos internos se administran en Empleados.'))}>
                <div className="flex items-center gap-2 mb-1"><span className={'pill ' + (t.tipo === 'Externo' ? 's-esperandoaprobacion' : 's-agendada')}>{t.tipo}</span>{!t.activo && <span className="pill gris">Inactivo</span>}</div>
                <p className="font-bold text-[15px]">{t.nombre}</p><p className="text-xs text-slate-500">{[t.empresa, t.especialidad].filter(Boolean).join(' · ') || (t.tipo === 'Interno' ? 'Empleado con acceso a Servicio Técnico' : '')}</p>
                <p className="text-xs text-slate-500 mt-1">{[t.email, t.telefono].filter(Boolean).join(' · ')}</p>
                <p className="text-[11px] text-slate-400 mt-2">{O.filter((o) => abierta(o) && norm(o.tecnico) === norm(t.nombre)).length} orden(es) abierta(s)</p>
              </div>
            ))}
            <div className="col-span-full text-xs text-slate-500 sec"><b>Internos:</b> empleados con acceso a Servicio Técnico (módulo Empleados). <b>Externos:</b> agrégalos aquí. Si un externo necesita entrar a la app, créale un usuario en Empleados con el mismo correo y acceso a Servicio Técnico: solo verá sus órdenes.</div>
          </div>
        )}
        {tab === 'equipos' && <ListaEquipos equipos={equipos} q={q} abrir={(id) => setPanel({ tipo: 'equipo', id })} />}
        {esListaOrdenes && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {ordenes === null && !error && <div className="col-span-full text-center py-14 text-slate-400"><Spin /> Cargando…</div>}
            {ordenes && !lista.length && <div className="col-span-full text-center py-14 text-slate-400"><Wrench className="mx-auto mb-2" style={{ width: 34, height: 34 }} /><p className="font-semibold text-slate-500">Nada en esta vista.</p><p className="text-xs mt-1">{externo ? 'Aquí verás las órdenes que te asignen.' : 'Crea una orden con "Nueva orden" o desde la hoja de vida de un equipo.'}</p></div>}
            {lista.map((o) => {
              const hoy = abierta(o) && esHoy(o.fechaProgramada), vencida = abierta(o) && !!o.fechaProgramada && ymd(o.fechaProgramada) < hoyYmd(), I = ICONO_TIPO[o.tipo] || Wrench
              return (
                <div key={o.id} className={'card ' + (o.prioridad === 'Urgente' ? 'urg' : o.prioridad === 'Alta' ? 'alta' : hoy ? 'hoy' : '')} onClick={() => setPanel({ tipo: 'orden', id: o.id })}>
                  <div className="flex items-center gap-1.5 flex-wrap mb-2"><span className={'pill s-' + slug(o.estado)}>{o.estado}</span>{o.empresa === 'FEMEDICS' && <span className="pill fm">Femedics</span>}
                    {o.prioridad !== 'Normal' && <span className="pill" style={o.prioridad === 'Urgente' ? { background: '#fdecec', color: '#c0392b' } : { background: '#fff1e0', color: '#b45309' }}>{o.prioridad}</span>}<span className="ml-auto text-[10px] text-slate-400 mono">{o.codigo}</span></div>
                  <p className="text-[12px] font-bold text-[var(--acc)] flex items-center gap-1"><I style={{ width: 13, height: 13 }} />{o.tipo} · {o.modalidad}</p>
                  <p className="font-bold text-[15px] text-slate-800 mt-0.5">{o.cliente}</p><p className="text-xs text-slate-500">{o.producto} · <span className="mono">{o.serie}</span></p>
                  {o.falla && tab !== 'finalizadas' && <p className="text-xs text-slate-600 mt-1 line-clamp-2">{o.falla}</p>}
                  <div className="flex items-center gap-3 mt-3 text-[11.5px] text-slate-500 flex-wrap"><span className="flex items-center gap-1"><User style={{ width: 13, height: 13 }} />{o.tecnico || 'Sin técnico'}</span><span className="pill gris">{o.cobertura}</span>
                    <span className={'ml-auto ' + (vencida ? 'text-red-600 font-bold' : hoy ? 'text-[var(--teal)] font-bold' : '')}>{!abierta(o) ? (o.estado === 'Cancelada' ? 'Cancelada' : 'Cerrada ' + dfecha(o.cierre)) : o.fechaProgramada ? (hoy ? 'Hoy' : dfecha(o.fechaProgramada)) + (hm(o.fechaProgramada) ? ' ' + hm(o.fechaProgramada) : '') : 'Sin fecha'}</span></div>
                  {o.estado === 'Esperando aprobación' && <p className="text-[11px] text-amber-700 font-semibold mt-2">Pendiente de autorización para continuar el trabajo</p>}
                  {o.informeN && o.estado === 'Finalizada' && <p className="text-[11px] text-emerald-700 font-semibold mt-2 flex items-center gap-1"><FileCheck2 style={{ width: 13, height: 13 }} />Informe {o.informeN}</p>}
                </div>
              )
            })}
          </div>
        )}
      </main>
      {panel?.tipo === 'orden' && <PanelOrden id={panel.id} perfil={perfil} externo={externo} editar={editar} tecnicos={tecnicos} aviso={aviso} cerrar={() => { setPanel(null); recargar() }} abrirEquipo={(id) => setPanel({ tipo: 'equipo', id })} abrirOrden={(id) => setPanel({ tipo: 'orden', id })} />}
      {panel?.tipo === 'equipo' && <PanelEquipo id={panel.id} externo={externo} editar={editar} aviso={aviso} cerrar={() => { setPanel(null); recargar() }} abrirOrden={(id) => setPanel({ tipo: 'orden', id })} nueva={(eq) => setHoja({ k: 'nueva', eq })} />}
      {hoja?.k === 'nueva' && <NuevaOrden eq={hoja.eq ?? null} equipos={E} tecnicos={tecnicos.filter((t) => t.activo)} perfil={perfil} aviso={aviso} cerrar={() => setHoja(null)} creada={(id) => { setHoja(null); recargar(); setPanel({ tipo: 'orden', id }) }} />}
      {hoja?.k === 'registrar' && <RegistrarEquipo aviso={aviso} cerrar={() => setHoja(null)} listo={(id) => { setHoja(null); cargarEquipos(); setPanel({ tipo: 'equipo', id }) }} />}
      {hoja?.k === 'tecnico' && <EditarTecnico tec={hoja.tec} aviso={aviso} cerrar={() => setHoja(null)} listo={() => { setHoja(null); cargarTecnicos() }} />}
    </div>
  )
}

/* ============================ Equipos ============================ */
function ListaEquipos({ equipos, q, abrir }: { equipos: Equipo[] | null; q: string; abrir: (id: string) => void }) {
  const w = norm(q).trim().split(/\s+/).filter(Boolean)
  const l = (equipos ?? []).filter((e) => !w.length || w.every((x) => norm([e.codigo, e.serie, e.producto, e.cliente, e.factura, e.ciudad, e.identificacion].join(' ')).includes(x)))
    .sort((a, b) => Number(b.garantiaEnRiesgo) - Number(a.garantiaEnRiesgo) || Number(b.preventivoVencido) - Number(a.preventivoVencido) || (a.proximo || '9').localeCompare(b.proximo || '9'))
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {equipos === null && <div className="col-span-full text-center py-14 text-slate-400"><Spin /> Cargando equipos…</div>}
      {equipos && !l.length && <div className="col-span-full text-center py-14 text-slate-400"><Cpu className="mx-auto mb-2" style={{ width: 34, height: 34 }} /><p className="font-semibold text-slate-500">Sin equipos{w.length ? ' con esa búsqueda' : ''}.</p><p className="text-xs mt-1">Los equipos se registran solos al entregarse. Usa "Sincronizar" para traer ventas anteriores.</p></div>}
      {l.slice(0, 300).map((e) => (
        <div key={e.id} className="card" onClick={() => abrir(e.id)}>
          <div className="flex items-center gap-1.5 flex-wrap mb-2"><span className={'pill g-' + slug(e.garantia)}>Garantía {e.garantia.toLowerCase()}</span>{e.empresa === 'FEMEDICS' && <span className="pill fm">Femedics</span>}
            {e.garantiaEnRiesgo ? <span className="pill s-esperandorepuesto">Garantía en riesgo</span> : e.preventivoVencido ? <span className="pill s-esperandoaprobacion">Preventivo vencido</span> : null}{e.estado !== 'Operativo' && <span className="pill gris">{e.estado}</span>}<span className="ml-auto text-[10px] text-slate-400 mono">{e.codigo}</span></div>
          <p className="font-bold text-[15px] text-slate-800">{e.producto}</p><p className="text-xs text-slate-500 mono">Serie {e.serie}</p><p className="text-xs text-slate-600 mt-1">{e.cliente}{e.ciudad ? ' · ' + e.ciudad : ''}</p>
          <div className="flex items-center gap-3 mt-3 text-[11.5px] text-slate-500"><span>{e.plan === 'Sin plan' ? 'Sin plan de mantenimiento' : `Plan ${e.plan.toLowerCase()} · cada ${e.frecuencia} m`}</span><span className={'ml-auto ' + (e.preventivoVencido ? 'text-red-600 font-bold' : '')}>{e.proximo && e.plan !== 'Sin plan' ? 'Próximo ' + dfecha(e.proximo) : ''}</span></div>
        </div>
      ))}
      {l.length > 300 && <p className="col-span-full text-center text-xs text-slate-400">Mostrando 300 de {l.length}. Usa la búsqueda.</p>}
    </div>
  )
}

function Cabecera({ titulo, sub, cerrar, extra }: { titulo: string; sub: string; cerrar: () => void; extra?: React.ReactNode }) {
  return <div className="hdr text-white sticky top-0 z-10"><div className="w-full px-4 lg:px-6 py-3 flex items-center gap-3"><button className="btn btn-sm !bg-white/10 !border-white/20 !text-white" onClick={cerrar} title="Cerrar"><X /></button><div className="min-w-0"><p className="font-display font-bold leading-tight truncate">{titulo}</p><p className="text-[11px] text-white/70 mono truncate">{sub}</p></div>{extra}</div></div>
}
const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (v ? <><dt>{k}</dt><dd>{v}</dd></> : null)

function PanelEquipo({ id, externo, editar, aviso, cerrar, abrirOrden, nueva }: { id: string; externo: boolean; editar: boolean; aviso: (t: string) => void; cerrar: () => void; abrirOrden: (id: string) => void; nueva: (e: Equipo) => void }) {
  const [e, setE] = useState<Equipo | null>(null)
  const [ords, setOrds] = useState<Orden[]>([])
  const [editando, setEditando] = useState(false)
  const cargar = useCallback(async () => {
    const [eq, os] = await Promise.all([supabase.from('st_equipos').select(COLS_EQ).eq('id', id).single(), supabase.from('st_ordenes').select(COLS_OS).eq('equipo_id', id).is('deleted_at', null).order('fecha', { ascending: false }).limit(100)])
    if (eq.data) setE(mapEquipo(eq.data)); setOrds((os.data ?? []).map(mapOrden))
  }, [id])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])
  if (!e) return <div className="panel"><div className="text-center py-24 text-slate-400"><Spin /> Abriendo…</div></div>
  return (
    <div className="panel">
      <Cabecera titulo={e.producto} sub={`Serie ${e.serie} · ${e.codigo}`} cerrar={cerrar} extra={<span className={'pill g-' + slug(e.garantia) + ' ml-auto'}>Garantía {e.garantia.toLowerCase()}</span>} />
      <div className="w-full px-4 lg:px-6 py-4 space-y-3">
        {e.garantiaEnRiesgo && <div className="sec" style={{ borderColor: '#f5c6c0', background: '#fff7f6' }}><p className="text-sm text-red-700 font-semibold flex items-center gap-2"><ShieldAlert />Garantía en riesgo: el mantenimiento preventivo venció el {dfecha(e.proximo)}. El acta exige los preventivos para mantener la garantía.</p></div>}
        <div className="sec"><h3><Cpu />Hoja de vida del equipo</h3>
          <dl className="kv"><KV k="Equipo" v={<b>{e.producto}</b>} /><KV k="Código" v={e.codigoProducto} /><KV k="Marca / modelo" v={[e.marca, e.modelo].filter(Boolean).join(' · ')} /><KV k="Serie" v={<span className="mono">{e.serie}</span>} /><KV k="Estado" v={e.estado} /><KV k="Lote" v={e.lote} />
            <KV k="Origen" v={[e.proveedor, e.importacion].filter(Boolean).join(' · ')} /><KV k="Cliente" v={e.cliente + (e.identificacion ? ' · ' + e.identificacion : '')} /><KV k="Teléfono" v={e.telefono} /><KV k="Dirección" v={[e.direccion, e.ciudad].filter(Boolean).join(', ')} />
            <KV k="Ubicación" v={e.ubicacion} /><KV k="Factura" v={e.factura} /><KV k="Asesor" v={e.asesor} /><KV k="Entregado" v={e.fechaEntrega ? dfecha(e.fechaEntrega) : ''} />
            <KV k="Garantía" v={e.garantiaMeses == null ? 'Por confirmar (aún sin acta)' : e.garantiaMeses ? `${e.garantiaMeses} meses · hasta ${dfecha(e.garantiaHasta)}` : 'Sin garantía'} /><KV k="Notas" v={e.notas} /></dl></div>
        <div className="sec"><h3><CalendarCheck />Plan de mantenimiento</h3>
          <dl className="kv"><KV k="Plan" v={e.plan} /><KV k="Frecuencia" v={e.frecuencia ? `Cada ${e.frecuencia} meses` : ''} /><KV k="Próximo" v={e.proximo && e.plan !== 'Sin plan' ? <span className={e.preventivoVencido ? 'text-red-600 font-bold' : ''}>{dfecha(e.proximo)}</span> : ''} /></dl>
          <p className="text-[11px] text-slate-500 mt-2">La orden de mantenimiento preventivo se crea sola 15 días antes. "Facturable": se cobra; "Incluido" o "Contrato": sin costo para el cliente.</p>
          {!externo && editar && <button className="btn w-full mt-3" onClick={() => setEditando(true)}><Pencil />Editar plan y datos</button>}</div>
        <div className="sec"><h3><History />Historial de servicios ({ords.length})</h3>
          {ords.length ? ords.map((o) => { const I = ICONO_TIPO[o.tipo] || Wrench; return (
            <div key={o.id} className="py-2.5 border-b border-slate-100 flex items-start gap-3 cursor-pointer" onClick={() => abrirOrden(o.id)}><I className="mt-0.5 text-[var(--acc)]" />
              <div className="flex-1 min-w-0"><p className="text-sm font-semibold">{o.tipo} <span className={'pill s-' + slug(o.estado)}>{o.estado}</span></p><p className="text-[11.5px] text-slate-500">{dfecha(o.cierre || o.fecha)} · {o.tecnico || 'sin técnico'}{o.estadoFinal ? ' · ' + o.estadoFinal : ''}</p></div></div>) }) : <p className="text-xs text-slate-500">Aún no tiene servicios.</p>}</div>
        {!externo && editar && e.estado !== 'Dado de baja' && <div className="acciones"><button className="btn btn-p w-full" onClick={() => nueva(e)}><Plus />Nueva orden para este equipo</button></div>}
      </div>
      {editando && <EditarEquipo e={e} aviso={aviso} cerrar={() => setEditando(false)} listo={() => { setEditando(false); cargar(); aviso('Equipo actualizado') }} />}
    </div>
  )
}

function EditarEquipo({ e, aviso, cerrar, listo }: { e: Equipo; aviso: (t: string) => void; cerrar: () => void; listo: () => void }) {
  const [f, setF] = useState({ plan: e.plan, frecuencia: String(e.frecuencia || 0), proximo: e.proximo, garantiaHasta: e.garantiaHasta, estado: e.estado, ubicacion: e.ubicacion, direccion: e.direccion, ciudad: e.ciudad, telefono: e.telefono, notas: e.notas })
  const [ocupado, setOcupado] = useState(false)
  const s = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  async function guardar() {
    const fr = Math.round(Number(f.frecuencia)); if (!(fr >= 0 && fr <= 36)) { aviso('Frecuencia de 0 a 36 meses.'); return }
    setOcupado(true)
    const { error } = await supabase.from('st_equipos').update({ plan_mantenimiento: f.plan, frecuencia_meses: fr, proximo_mantenimiento: f.proximo || null, garantia_hasta: f.garantiaHasta || null, estado: f.estado, ubicacion: f.ubicacion.slice(0, 200) || null, direccion: f.direccion.slice(0, 300) || null, ciudad: f.ciudad.slice(0, 80) || null, telefono: f.telefono.slice(0, 40) || null, notas: f.notas.slice(0, 1500) || null }).eq('id', e.id)
    if (error) { setOcupado(false); aviso(error.message); return }
    supabase.rpc('st_programar_preventivos'); listo()
  }
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">Plan y datos del equipo</h3>
      <div className="space-y-3">
        <label className="f">Plan de mantenimiento<Seg opciones={PLANES} valor={f.plan} cambia={s('plan')} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="f">Cada (meses)<input type="number" min={0} max={36} className="inp" value={f.frecuencia} onChange={(x) => s('frecuencia')(x.target.value)} /></label><label className="f">Próximo mantenimiento<input type="date" className="inp" value={f.proximo} onChange={(x) => s('proximo')(x.target.value)} /></label></div>
        <label className="f">Garantía hasta<input type="date" className="inp" value={f.garantiaHasta} onChange={(x) => s('garantiaHasta')(x.target.value)} /></label>
        <label className="f">Estado del equipo<Seg opciones={ESTADOS_FINALES} valor={f.estado} cambia={s('estado')} /></label>
        <label className="f">Ubicación (área, consultorio)<input className="inp" value={f.ubicacion} onChange={(x) => s('ubicacion')(x.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="f">Dirección<input className="inp" value={f.direccion} onChange={(x) => s('direccion')(x.target.value)} /></label><label className="f">Ciudad<input className="inp" value={f.ciudad} onChange={(x) => s('ciudad')(x.target.value)} /></label></div>
        <label className="f">Teléfono de contacto<input className="inp" value={f.telefono} onChange={(x) => s('telefono')(x.target.value)} /></label>
        <label className="f">Notas<textarea className="inp" rows={2} value={f.notas} onChange={(x) => s('notas')(x.target.value)} /></label></div>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" disabled={ocupado} onClick={guardar}>{ocupado ? <Spin /> : <><Check />Guardar</>}</button></div></Hoja>
  )
}

function RegistrarEquipo({ aviso, cerrar, listo }: { aviso: (t: string) => void; cerrar: () => void; listo: (id: string) => void }) {
  const [q, setQ] = useState('')
  type V = { id: string; cliente: string; factura: string; fecha: string; productos: { key: string; id: string; nombre: string; cantidad: number }[] }
  const [res, setRes] = useState<V[] | null>(null)
  const [venta, setVenta] = useState<V | null>(null)
  const [f, setF] = useState({ key: '', serie: '', entrega: '', ciudad: '', direccion: '', ubicacion: '' })
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => {
    if (q.trim().length < 3 || venta) { setRes(null); return }
    const t = setTimeout(async () => {
      const txt = q.trim().replace(/[,()%*\\"']/g, ' ')
      const { data, error } = await supabase.from('facturas').select('id,codigo,numero_contifico,fecha_facturacion,identificacion,items,cliente:clientes(nombre)').is('deleted_at', null).eq('estado', 'Facturado').or(`codigo.ilike.%${txt}%,numero_contifico.ilike.%${txt}%,identificacion.ilike.%${txt}%`).order('fecha_facturacion', { ascending: false }).limit(25)
      if (error) { aviso(error.message); return }
      const porCliente = await supabase.from('facturas').select('id,codigo,numero_contifico,fecha_facturacion,identificacion,items,cliente:clientes!inner(nombre)').is('deleted_at', null).eq('estado', 'Facturado').ilike('clientes.nombre', `%${txt}%`).limit(25)
      const filas = [...(data ?? []), ...(porCliente.data ?? [])] as unknown as { id: string; codigo: string; numero_contifico: string; fecha_facturacion: string; items: Record<string, unknown>[]; cliente: { nombre: string } | null }[]
      const vistos = new Set<string>()
      setRes(filas.filter((x) => !vistos.has(x.id) && vistos.add(x.id)).map((x) => {
        const cnt: Record<string, number> = {}
        return { id: x.id, cliente: x.cliente?.nombre ?? x.codigo, factura: x.numero_contifico ?? '', fecha: x.fecha_facturacion ?? '', productos: arr<Record<string, unknown>>(x.items).map((it) => { const c = String(it.codigo || it.itemId || it.id || ''); cnt[c] = (cnt[c] || 0) + 1; return { key: c + '|' + cnt[c], id: c, nombre: String(it.nombre ?? ''), cantidad: Math.abs(Number(it.cantidad) || 1) } }) }
      }))
    }, 350)
    return () => clearTimeout(t)
  }, [q, venta]) // eslint-disable-line react-hooks/exhaustive-deps
  async function registrar() {
    if (!venta) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('st_registrar_equipo', { p_factura: venta.id, p_clave: f.key || venta.productos[0]?.key, p_serie: f.serie, p_entrega: f.entrega || null, p_ciudad: f.ciudad, p_direccion: f.direccion, p_ubicacion: f.ubicacion })
    if (error) { setOcupado(false); aviso(error.message); return }
    aviso('Equipo registrado'); listo(data as string)
  }
  const s = (k: keyof typeof f) => (x: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((v) => ({ ...v, [k]: x.target.value }))
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-1">Registrar equipo de una venta</h3><p className="text-xs text-slate-500 mb-3">Solo equipos vendidos por VIMEDIC o FEMEDICS. Busca la venta y elige el producto.</p>
      <div className="relative"><input className="inp" placeholder="Cliente, RUC o número de factura" value={q} onChange={(e) => { setQ(e.target.value); setVenta(null) }} />
        {res && <div className="sugg">{res.length ? res.map((v) => <div key={v.id} onClick={() => { setVenta(v); setF((x) => ({ ...x, key: v.productos[0]?.key ?? '' })); setQ(v.cliente + ' · ' + (v.factura || v.id.slice(0, 6))) }}><b>{v.cliente}</b><br /><span className="text-xs text-slate-500">Factura {v.factura || '—'} · {dfecha(v.fecha)} · {v.productos.length} producto(s)</span></div>) : <div className="text-slate-400">Sin ventas con ese dato.</div>}</div>}</div>
      {venta && <div className="mt-3">
        <label className="f">Producto de la venta<select className="inp" value={f.key} onChange={s('key')}>{venta.productos.map((p) => <option key={p.key} value={p.key}>{`${p.cantidad}× ${p.nombre} (${p.id})`}</option>)}</select></label>
        <label className="f mt-3">Número de serie *<input className="inp mono" autoCapitalize="characters" value={f.serie} onChange={s('serie')} /></label>
        <div className="grid grid-cols-2 gap-2 mt-3"><label className="f">Fecha de entrega<input type="date" className="inp" value={f.entrega} onChange={s('entrega')} /></label><label className="f">Ciudad<input className="inp" value={f.ciudad} onChange={s('ciudad')} /></label></div>
        <label className="f mt-3">Dirección<input className="inp" value={f.direccion} onChange={s('direccion')} /></label><label className="f mt-3">Ubicación (área, consultorio)<input className="inp" value={f.ubicacion} onChange={s('ubicacion')} /></label></div>}
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" disabled={!venta || ocupado} onClick={registrar}>{ocupado ? <Spin /> : <><Check />Registrar</>}</button></div></Hoja>
  )
}

function EditarTecnico({ tec, aviso, cerrar, listo }: { tec?: Tecnico; aviso: (t: string) => void; cerrar: () => void; listo: () => void }) {
  const [f, setF] = useState({ nombre: tec?.nombre ?? '', empresa: tec?.empresa ?? '', email: tec?.email ?? '', telefono: tec?.telefono ?? '', especialidad: tec?.especialidad ?? '', activo: tec?.activo === false ? 'Inactivo' : 'Activo' })
  const [ocupado, setOcupado] = useState(false)
  const s = (k: keyof typeof f) => (x: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: x.target.value }))
  async function guardar() {
    if (!f.nombre.trim()) { aviso('Escribe el nombre del técnico.'); return }
    const email = f.email.trim().toLowerCase(); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { aviso('Correo no válido.'); return }
    setOcupado(true)
    const campos = { nombre: f.nombre.trim().slice(0, 120), tipo: 'externo', empresa: f.empresa.slice(0, 120) || null, email: email || null, telefono: f.telefono.slice(0, 40) || null, especialidad: f.especialidad.slice(0, 200) || null, activo: f.activo !== 'Inactivo' }
    const { error } = tec?.id ? await supabase.from('st_tecnicos').update(campos).eq('id', tec.id) : await supabase.from('st_tecnicos').insert({ id: crypto.randomUUID(), ...campos })
    if (error) { setOcupado(false); aviso(error.message); return }
    aviso('Técnico guardado'); listo()
  }
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">{tec ? 'Editar' : 'Nuevo'} técnico externo</h3>
      <div className="space-y-3"><label className="f">Nombre *<input className="inp" value={f.nombre} onChange={s('nombre')} /></label><label className="f">Empresa<input className="inp" value={f.empresa} onChange={s('empresa')} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="f">Correo<input type="email" className="inp" value={f.email} onChange={s('email')} /></label><label className="f">Teléfono<input className="inp" value={f.telefono} onChange={s('telefono')} /></label></div>
        <label className="f">Especialidad<input className="inp" placeholder="Ej.: autoclaves, monitores, rayos X" value={f.especialidad} onChange={s('especialidad')} /></label>
        <label className="f">Estado<Seg opciones={['Activo', 'Inactivo']} valor={f.activo} cambia={(v) => setF((x) => ({ ...x, activo: v }))} /></label></div>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" disabled={ocupado} onClick={guardar}>{ocupado ? <Spin /> : <><Check />Guardar</>}</button></div></Hoja>
  )
}

/* ============================ Nueva orden ============================ */
function NuevaOrden({ eq: eqPre, equipos, tecnicos, perfil, aviso, cerrar, creada }: { eq: Equipo | null; equipos: Equipo[]; tecnicos: Tecnico[]; perfil: Perfil; aviso: (t: string) => void; cerrar: () => void; creada: (id: string) => void }) {
  const [eq, setEq] = useState<Equipo | null>(eqPre)
  const [q, setQ] = useState(eqPre ? `${eqPre.producto} · ${eqPre.serie} · ${eqPre.cliente}` : '')
  const [abrirLista, setAbrirLista] = useState(false)
  const [f, setF] = useState({ tipo: 'Mantenimiento correctivo', cobertura: 'Facturable', modalidad: 'En sitio', prioridad: 'Normal', falla: '', contacto: '', telefono: eqPre?.telefono ?? '', tecnico: '', fecha: '', hora: '' })
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { if (eq) setF((x) => ({ ...x, cobertura: coberturaSugerida(x.tipo, eq) })) }, [eq, f.tipo]) // eslint-disable-line react-hooks/exhaustive-deps
  const w = norm(q).trim().split(/\s+/).filter(Boolean)
  const sug = equipos.filter((e) => e.estado !== 'Dado de baja' && (!w.length || w.every((x) => norm([e.serie, e.producto, e.cliente, e.identificacion, e.factura].join(' ')).includes(x)))).slice(0, 12)
  async function crear() {
    if (!eq) { aviso('Elige el equipo.'); return }
    if (/correctivo|Diagn/i.test(f.tipo) && !f.falla.trim()) { aviso('Describe la falla que reporta el cliente.'); return }
    const tec = f.tecnico ? tecnicos.find((t) => t.nombre === f.tecnico) : null
    let prog: string | null = null
    if (f.fecha) { const d = new Date(f.fecha + 'T12:00:00'); if (f.hora) { const [h, m] = f.hora.split(':'); d.setHours(+h, +m, 0, 0) } prog = d.toISOString() }
    const estado = tec && prog ? 'Agendada' : 'Recibida', ahora = new Date().toISOString()
    const ev: Evento[] = [{ fecha: ahora, por: perfil.nombre, nota: `Solicitud de ${f.tipo.toLowerCase()} recibida.`, publico: true }]
    if (estado === 'Agendada') ev.push({ fecha: ahora, por: perfil.nombre, nota: `Servicio agendado para el ${new Date(prog!).toLocaleDateString('es-EC')} con ${tec!.nombre}.`, publico: true })
    setOcupado(true)
    const id = crypto.randomUUID()
    const { error } = await supabase.from('st_ordenes').insert({ id, codigo: codigoNuevo('OS'), empresa: eq.empresa, tipo: f.tipo, origen: 'Manual · ' + perfil.nombre, prioridad: f.prioridad, estado, modalidad: f.modalidad, cobertura: f.cobertura, equipo_id: eq.id, serie: eq.serie, producto_texto: eq.producto,
      cliente_texto: eq.cliente, identificacion: eq.identificacion, contacto: f.contacto.slice(0, 120) || null, telefono: f.telefono.slice(0, 40) || eq.telefono, email: eq.email, direccion: eq.direccion, ciudad: eq.ciudad, factura_id: eq.facturaId, operacion_codigo: eq.operacion, factura_texto: eq.factura,
      tecnico_id: tec?.id ?? null, tecnico_texto: tec?.nombre ?? null, fecha_programada: prog, falla_reportada: f.falla.slice(0, 2000) || null, token: token(), eventos: ev, creado_por: perfil.id })
    if (error) { setOcupado(false); aviso(error.message); return }
    aviso('Orden creada'); creada(id)
  }
  const s = (k: keyof typeof f) => (x: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: x.target.value }))
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">Nueva orden de servicio</h3>
      <div className="space-y-3">
        <div className="relative"><label className="f">Equipo (serie, cliente o producto) *<input className="inp" autoComplete="off" value={q} onFocus={() => setAbrirLista(true)} onBlur={() => setTimeout(() => setAbrirLista(false), 200)} onChange={(e) => { setQ(e.target.value); setAbrirLista(true) }} /></label>
          {abrirLista && <div className="sugg">{sug.length ? sug.map((e) => <div key={e.id} onMouseDown={() => { setEq(e); setQ(`${e.producto} · ${e.serie} · ${e.cliente}`); setF((x) => ({ ...x, telefono: e.telefono })); setAbrirLista(false) }}><b>{e.producto}</b> · <span className="mono text-xs">{e.serie}</span><br /><span className="text-xs text-slate-500">{e.cliente}</span></div>) : <div className="text-slate-400">Sin equipos. Regístralo en la pestaña Equipos.</div>}</div>}</div>
        {eq && <div className="rounded-xl bg-slate-50 p-3 text-xs"><b className="text-sm">{eq.producto}</b> · <span className="mono">{eq.serie}</span><br />{eq.cliente} · <span className={'pill g-' + slug(eq.garantia)}>Garantía {eq.garantia.toLowerCase()}</span>{eq.garantiaHasta ? ' hasta ' + dfecha(eq.garantiaHasta) : ''} · Plan: {eq.plan}</div>}
        <label className="f">Tipo de servicio<Seg opciones={TIPOS} valor={f.tipo} cambia={(v) => setF((x) => ({ ...x, tipo: v }))} /></label>
        <label className="f">Cobertura<select className="inp" value={f.cobertura} onChange={s('cobertura')}>{COBERTURAS.map((c) => <option key={c}>{c}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2"><label className="f">Modalidad<select className="inp" value={f.modalidad} onChange={s('modalidad')}>{MODALIDADES.map((c) => <option key={c}>{c}</option>)}</select></label><label className="f">Prioridad<select className="inp" value={f.prioridad} onChange={s('prioridad')}>{PRIORIDADES.map((c) => <option key={c}>{c}</option>)}</select></label></div>
        <label className="f">Falla reportada / motivo<textarea className="inp" rows={3} placeholder="Qué reporta el cliente, desde cuándo, mensajes de error…" value={f.falla} onChange={s('falla')} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="f">Contacto en sitio<input className="inp" value={f.contacto} onChange={s('contacto')} /></label><label className="f">Teléfono<input className="inp" value={f.telefono} onChange={s('telefono')} /></label></div>
        <p className="font-display font-bold text-[var(--navy)] pt-1">Agendar ahora (opcional)</p>
        <label className="f">Técnico<select className="inp" value={f.tecnico} onChange={s('tecnico')}><option value="">— Después —</option>{tecnicos.map((t) => <option key={t.nombre} value={t.nombre}>{t.nombre + (t.tipo === 'Externo' ? ' · externo' + (t.empresa ? ` (${t.empresa})` : '') : '')}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2"><label className="f">Fecha<input type="date" className="inp" value={f.fecha} onChange={s('fecha')} /></label><label className="f">Hora<input type="time" className="inp" value={f.hora} onChange={s('hora')} /></label></div></div>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" disabled={ocupado} onClick={crear}>{ocupado ? <Spin /> : <><Check />Crear orden</>}</button></div></Hoja>
  )
}

/* ============================ Panel de la orden ============================ */
function Firma({ lienzo, limpiar }: { lienzo: React.RefObject<HTMLCanvasElement>; limpiar: number }) {
  const dibujada = useRef(false)
  useEffect(() => {
    const c = lienzo.current; if (!c) return
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1
    c.width = r.width * dpr; c.height = r.height * dpr
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b2545'
    dibujada.current = false; c.dataset.firmado = ''
    let dib = false
    const pos = (ev: PointerEvent) => { const b = c.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top] }
    c.onpointerdown = (ev) => { dib = true; c.setPointerCapture(ev.pointerId); const [x, y] = pos(ev); ctx.beginPath(); ctx.moveTo(x, y) }
    c.onpointermove = (ev) => { if (!dib) return; const [x, y] = pos(ev); ctx.lineTo(x, y); ctx.stroke(); c.dataset.firmado = '1' }
    c.onpointerup = c.onpointercancel = () => { dib = false }
  }, [lienzo, limpiar])
  return <canvas ref={lienzo} className="firma" />
}
const firmaPng = (c: HTMLCanvasElement | null) => { if (!c || !c.dataset.firmado) return ''; const k = Math.min(1, 420 / c.width), t = document.createElement('canvas'); t.width = Math.round(c.width * k); t.height = Math.round(c.height * k); const x = t.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, t.width, t.height); x.drawImage(c, 0, 0, t.width, t.height); return t.toDataURL('image/png') }

type Trabajo = { diagnostico: string; trabajo: string; recomendaciones: string; horas: string; checklist: Ck[]; mediciones: Med[]; repuestos: Orden['repuestos']; asistentes: Orden['asistentes']; fotos: Foto[] }
const aTrabajo = (o: Orden): Trabajo => ({ diagnostico: o.diagnostico, trabajo: o.trabajo, recomendaciones: o.recomendaciones, horas: o.horas ? String(o.horas) : '', checklist: JSON.parse(JSON.stringify(o.checklist)), mediciones: JSON.parse(JSON.stringify(o.mediciones)), repuestos: JSON.parse(JSON.stringify(o.repuestos)), asistentes: JSON.parse(JSON.stringify(o.asistentes)), fotos: JSON.parse(JSON.stringify(o.fotos)) })

function PanelOrden({ id, perfil, externo, editar, tecnicos, aviso, cerrar, abrirEquipo, abrirOrden }: { id: string; perfil: Perfil; externo: boolean; editar: boolean; tecnicos: Tecnico[]; aviso: (t: string) => void; cerrar: () => void; abrirEquipo: (id: string) => void; abrirOrden: (id: string) => void }) {
  const [o, setO] = useState<Orden | null>(null)
  const [eq, setEq] = useState<Equipo | null>(null)
  const [hist, setHist] = useState<Orden[]>([])
  const [W, setW] = useState<Trabajo | null>(null)
  const [sucio, setSucio] = useState(false)
  const [hoja, setHoja] = useState<'editar' | 'agendar' | 'recepcion' | 'finalizar' | 'mensajes' | 'estado' | 'cancelar' | null>(null)
  const [estadoNuevo, setEstadoNuevo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [productos, setProductos] = useState<{ id: string; nombre: string; stock: number }[] | null>(null)
  const [repQ, setRepQ] = useState('')
  const [repAbierto, setRepAbierto] = useState(false)
  const [ckNuevo, setCkNuevo] = useState('')
  const sinGuardarRef = useRef(false); sinGuardarRef.current = sucio

  const cargar = useCallback(async (resetW = true) => {
    const { data, error } = await supabase.from('st_ordenes').select(COLS_OS).eq('id', id).single()
    if (error || !data) { aviso(error?.message ?? 'No se encontró la orden'); cerrar(); return null }
    const ord = mapOrden(data); setO(ord); if (resetW) { setW(aTrabajo(ord)); setSucio(false) }
    const [e, h] = await Promise.all([ord.equipoId ? supabase.from('st_equipos').select(COLS_EQ).eq('id', ord.equipoId).maybeSingle() : Promise.resolve({ data: null }), ord.equipoId ? supabase.from('st_ordenes').select(COLS_OS).eq('equipo_id', ord.equipoId).neq('id', id).is('deleted_at', null).order('fecha', { ascending: false }).limit(6) : Promise.resolve({ data: [] })])
    setEq(e.data ? mapEquipo(e.data) : null); setHist(((h.data ?? []) as unknown[]).map(mapOrden))
    return ord
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])
  useEffect(() => { const f = (e: BeforeUnloadEvent) => { if (sinGuardarRef.current) { e.preventDefault(); e.returnValue = '' } }; window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f) }, [])
  const salir = (fn: () => void) => { if (sucio && !confirm('Tienes cambios sin guardar. ¿Salir sin guardar?')) return; fn() }
  const marcar = (cambio: (w: Trabajo) => void) => { setW((w) => { if (!w) return w; const n = { ...w }; cambio(n); return n }); setSucio(true) }
  const err = (e: unknown) => aviso((e as Error).message)

  async function evento(ord: Orden, nota: string, publico: boolean, extra: Record<string, unknown> = {}) {
    const ev = [...ord.eventos, { fecha: new Date().toISOString(), por: perfil.nombre, nota: nota.slice(0, 600), publico }].slice(-200)
    const { error } = await supabase.from('st_ordenes').update({ ...extra, eventos: ev }).eq('id', ord.id)
    if (error) throw new Error(error.message)
  }
  async function protocolo(tipo: string, producto: string): Promise<string[]> {
    const { data } = await supabase.from('st_protocolos').select('aplica_a,orden,actividad').eq('tipo_servicio', tipo).is('deleted_at', null)
    const p = norm(producto), gen: [number, string][] = [], esp: [number, string][] = []
    ;((data ?? []) as { aplica_a: string; orden: number; actividad: string }[]).forEach((r) => { const a = (r.aplica_a || '*').trim(); if (!r.actividad?.trim()) return; if (a === '*' || !a) gen.push([r.orden || 99, r.actividad.trim()]); else if (p.includes(norm(a))) esp.push([r.orden || 99, r.actividad.trim()]) })
    const g = gen.sort((a, b) => a[0] - b[0]).map((x) => x[1]), e = esp.sort((a, b) => a[0] - b[0]).map((x) => x[1])
    const lista = g.length > 1 ? [...g.slice(0, -1), ...e, ...g.slice(-1)] : [...g, ...e]
    return lista.filter((x, i) => lista.indexOf(x) === i)
  }
  async function guardarAvance(silencioso?: boolean, extra: Record<string, unknown> = {}) {
    if (!o || !W) return
    if (!abierta(o)) throw new Error('La orden ya está cerrada.')
    setGuardando(true)
    try {
      const campos: Record<string, unknown> = { diagnostico: W.diagnostico.slice(0, 4000), trabajo_realizado: W.trabajo.slice(0, 4000), recomendaciones: W.recomendaciones.slice(0, 2000), horas: Math.max(0, Math.min(200, Number(W.horas) || 0)),
        checklist: W.checklist.slice(0, 60).map((x) => ({ actividad: x.actividad.slice(0, 200), resultado: RESULTADOS.includes(x.resultado) ? x.resultado : '', obs: x.obs.slice(0, 300) })).filter((x) => x.actividad),
        mediciones: W.mediciones.slice(0, 40).map((x) => ({ parametro: x.parametro.slice(0, 120), valor: x.valor.slice(0, 40), unidad: x.unidad.slice(0, 20), referencia: x.referencia.slice(0, 60), resultado: x.resultado === 'No conforme' ? 'No conforme' : x.resultado === 'Conforme' ? 'Conforme' : '' })).filter((x) => x.parametro),
        asistentes: W.asistentes.slice(0, 60).map((x) => ({ nombre: x.nombre.slice(0, 120), cargo: x.cargo.slice(0, 80), cedula: x.cedula.slice(0, 20) })).filter((x) => x.nombre),
        fotos: W.fotos.slice(0, 16).map((x) => ({ url: x.url, etapa: ['Antes', 'Durante', 'Después', 'Recepción'].includes(x.etapa) ? x.etapa : 'Durante', nota: (x.nota || '').slice(0, 120) })), ...extra }
      if (!o.repuestosDescontados) campos.repuestos = W.repuestos.slice(0, 40).map((x) => ({ id: x.id, nombre: x.nombre, cantidad: Math.max(1, Math.round(Number(x.cantidad) || 1)), precio: Number(x.precio) || 0 }))
      const { error } = await supabase.from('st_ordenes').update(campos).eq('id', o.id)
      if (error) throw new Error(error.message)
      await cargar(); if (!silencioso) aviso('Avance guardado')
    } finally { setGuardando(false) }
  }

  async function iniciar() {
    if (!o) return
    const go = async (gps: { lat: number; lng: number } | null) => {
      try {
        if (o.estado !== 'Agendada' && o.estado !== 'Recibida') throw new Error('La orden ya está en proceso o cerrada.')
        const campos: Record<string, unknown> = { estado: 'En proceso', inicio: new Date().toISOString() }
        if (!o.tecnico) { campos.tecnico_texto = perfil.nombre; const t = tecnicos.find((x) => x.nombre === perfil.nombre); campos.tecnico_id = t?.id ?? null }
        if (!o.checklist.length) campos.checklist = (await protocolo(o.tipo, o.producto)).map((a) => ({ actividad: a, resultado: '', obs: '' }))
        await evento(o, o.modalidad === 'Taller' ? 'Equipo en revisión en nuestro taller.' : 'El técnico inició el servicio.', true, campos)
        if (gps) { const f = await supabase.from('st_ordenes').select('eventos').eq('id', o.id).single(); await supabase.from('st_ordenes').update({ eventos: [...arr<Evento>(f.data?.eventos), { fecha: new Date().toISOString(), por: perfil.nombre, nota: `Inicio registrado (ubicación ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}).`, publico: false }] }).eq('id', o.id) }
        await cargar(); aviso('Servicio iniciado. Checklist cargado.')
      } catch (e) { err(e) }
    }
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => go({ lat: p.coords.latitude, lng: p.coords.longitude }), () => go(null), { enableHighAccuracy: true, timeout: 8000 }); else go(null)
  }
  async function cambiarEstado(est: 'En proceso' | 'Esperando repuesto' | 'Cancelada', nota: string) {
    if (!o) return
    try {
      if (sucio) await guardarAvance(true)
      const base = (await cargar(false)) ?? o
      if (!abierta(base)) throw new Error('La orden ya está cerrada.')
      if (est === 'Cancelada' && !nota.trim()) throw new Error('Indica el motivo de la cancelación.')
      const txt = est === 'Esperando repuesto' ? `Estamos esperando un repuesto para tu equipo${nota ? ` (${nota.slice(0, 200)})` : ''}.` : est === 'Cancelada' ? `Orden cancelada: ${nota.slice(0, 300)}` : `Continuamos con el servicio${nota ? ': ' + nota.slice(0, 200) : ''}.`
      await evento(base, txt, true, est === 'Cancelada' ? { estado: est, cierre: new Date().toISOString() } : { estado: est })
      await cargar(); aviso(est === 'Esperando repuesto' ? 'En espera de repuesto' : est === 'Cancelada' ? 'Orden cancelada' : 'Servicio reanudado')
    } catch (e) { err(e) }
  }
  async function subirFotos(files: File[], etapa: string, destino?: Foto[]) {
    if (!o) return
    setSubiendo(true)
    const nuevas: Foto[] = []
    for (const f of files) {
      try {
        const ruta = `ordenes/${o.id}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`
        const { error } = await supabase.storage.from('servicio-tecnico').upload(ruta, await reducir(f), { contentType: 'image/jpeg' })
        if (error) throw new Error(error.message)
        nuevas.push({ url: ruta, etapa, nota: '' })
      } catch (e) { err(e) }
    }
    setSubiendo(false)
    if (destino) { destino.push(...nuevas); return }
    marcar((w) => { w.fotos = [...w.fotos, ...nuevas] })
    // guarda de inmediato las fotos subidas (como el original)
    setTimeout(() => { guardarAvance(true).catch(err) }, 0)
  }
  async function buscarProductos() {
    if (productos) return
    const { data } = await supabase.from('productos').select('codigo,nombre,stock').is('deleted_at', null).order('en_vista_publica', { ascending: false }).order('nombre').limit(3000)
    setProductos(((data ?? []) as { codigo: string; nombre: string; stock: number }[]).map((p) => ({ id: p.codigo, nombre: p.nombre, stock: p.stock })))
  }
  async function descargar(variante: 'informe' | 'recepcion') {
    if (!o) return
    try {
      const doc: OrdenDoc = { codigo: o.codigo, tipo: o.tipo, empresa: o.empresa, cobertura: o.cobertura, modalidad: o.modalidad, cliente: o.cliente, identificacion: o.identificacion, direccion: o.direccion, ciudad: o.ciudad, contacto: o.contacto, telefono: o.telefono, factura: o.factura, producto: o.producto, serie: o.serie,
        tecnico: o.tecnico, tecnicoEmpresa: tecnicos.find((t) => t.nombre === o.tecnico)?.empresa ?? '', inicio: o.inicio, cierre: o.cierre, horas: o.horas, falla: o.falla, diagnostico: o.diagnostico, trabajo: o.trabajo, recomendaciones: o.recomendaciones, estadoFinal: o.estadoFinal,
        proximoMantenimiento: o.proximoMantenimiento, informeN: o.informeN, recepcionN: o.recepcionN, checklist: o.checklist, mediciones: o.mediciones, repuestos: o.repuestos, asistentes: o.asistentes, fotos: o.fotos, recepcion: o.recepcion, firma: o.firma }
      const e: EquipoDoc = eq ? { marca: eq.marca, modelo: eq.modelo, codigo: eq.codigoProducto, lote: eq.lote, fechaEntrega: eq.fechaEntrega, garantia: eq.garantia, garantiaHasta: eq.garantiaHasta, ubicacion: eq.ubicacion } : null
      let logo = ''
      if (o.empresa !== 'FEMEDICS') { try { const b = await (await fetch('/logo-documento.png')).blob(); logo = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(b) }) } catch { /* sin logo */ } }
      await descargarInforme(doc, e, variante, logo)
    } catch (e) { err(e) }
  }

  if (!o || !W) return <div className="panel"><div className="text-center py-24 text-slate-400"><Spin /> Abriendo…</div></div>
  const cerrado = !abierta(o), trabajo = enTrabajo(o), cap = o.tipo === 'Capacitación'
  const tel = o.telefono || eq?.telefono || '', dir = [o.direccion, o.ciudad].filter(Boolean).join(', ')
  const hechos = W.checklist.filter((x) => x.resultado).length
  const sug = sugeridasDe(o.producto).filter((s) => !W.mediciones.map((m) => norm(m.parametro)).includes(norm(s.parametro)))
  const ab = (id2: string) => salir(() => abrirEquipo(id2))

  return (
    <div className="panel">
      <Cabecera titulo={o.cliente} sub={`${o.codigo} · ${o.tipo}`} cerrar={() => salir(cerrar)} extra={<span className={'pill s-' + slug(o.estado) + ' ml-auto'}>{o.estado}</span>} />
      <div className="w-full px-4 lg:px-6 py-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {tel ? <><a className="btn" href={'tel:' + tel}><Phone />Llamar</a><button className="btn btn-wa" onClick={() => setHoja('mensajes')}><MessageCircle />WhatsApp</button></> : <><span /><span /></>}
          {dir ? <a className="btn" target="_blank" rel="noopener" href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(dir + ', Ecuador')}><MapPin />Mapa</a> : <span />}
        </div>
        <div className="sec"><h3><Cpu />Equipo{eq && <span className={'pill g-' + slug(eq.garantia) + ' ml-auto'}>Garantía {eq.garantia.toLowerCase()}</span>}</h3>
          <dl className="kv"><KV k="Equipo" v={<b>{o.producto}</b>} /><KV k="Serie" v={<span className="mono">{o.serie}</span>} /><KV k="Garantía" v={eq?.garantiaHasta ? 'Hasta ' + dfecha(eq.garantiaHasta) : eq?.garantia} /><KV k="Plan" v={eq ? eq.plan + (eq.proximo && eq.plan !== 'Sin plan' ? ' · próximo ' + dfecha(eq.proximo) : '') : ''} /><KV k="Ubicación" v={eq?.ubicacion} /><KV k="Factura" v={o.factura} /></dl>
          {o.equipoId && <button className="btn btn-sm mt-3" onClick={() => ab(o.equipoId)}><BookOpen />Hoja de vida ({hist.length + 1} servicio{hist.length ? 's' : ''})</button>}</div>
        <div className="sec"><h3><ClipboardList />Orden de servicio</h3>
          <dl className="kv"><KV k="Tipo" v={o.tipo} /><KV k="Modalidad" v={o.modalidad} /><KV k="Cobertura" v={o.cobertura} /><KV k="Prioridad" v={o.prioridad} />
            <KV k="Técnico" v={o.tecnico ? o.tecnico + (tecnicos.find((t) => t.nombre === o.tecnico)?.tipo === 'Externo' ? ' · externo' : '') : 'Sin asignar'} /><KV k="Fecha" v={o.fechaProgramada ? dfecha(o.fechaProgramada) + (hm(o.fechaProgramada) ? ' · ' + hm(o.fechaProgramada) : '') : ''} />
            <KV k="Contacto" v={[o.contacto, o.telefono].filter(Boolean).join(' · ')} /><KV k="Dirección" v={dir} /><KV k="Falla / motivo" v={o.falla ? <span style={{ whiteSpace: 'pre-line' }}>{o.falla}</span> : ''} /><KV k="Origen" v={o.origen} /><KV k="Asesor" v={o.asesor} /></dl>
          {!cerrado && !externo && editar && <div className="flex gap-2 mt-3 flex-wrap"><button className="btn btn-sm" onClick={() => setHoja('editar')}><Pencil />Editar</button><button className="btn btn-sm" onClick={() => setHoja('agendar')}><Calendar />{o.tecnico ? 'Reagendar' : 'Agendar'}</button></div>}</div>
        {o.recepcion?.entregadoPor && <div className="sec"><h3><PackageOpen />Recepción en taller</h3><dl className="kv"><KV k="Entregó" v={o.recepcion.entregadoPor + (o.recepcion.cedula ? ' · C.I. ' + o.recepcion.cedula : '')} /><KV k="Fecha" v={dhora(o.recepcion.fecha)} /><KV k="Accesorios" v={o.recepcion.accesorios} /><KV k="Estado físico" v={o.recepcion.estadoFisico} />
          <KV k="Comprobante" v={o.recepcionN ? <button className="text-[var(--acc)] font-semibold" onClick={() => descargar('recepcion')}>{o.recepcionN} (descargar PDF)</button> : ''} /></dl></div>}

        {trabajo && (
          <>
            {!cap && o.tipo !== 'Instalación' && <div className="sec"><h3><Stethoscope />Diagnóstico</h3><textarea className="inp" rows={3} placeholder="Qué encontraste, causa de la falla…" value={W.diagnostico} onChange={(e) => marcar((w) => { w.diagnostico = e.target.value })} /></div>}
            <div className="sec"><h3><ListChecks />{cap ? 'Temas de la capacitación' : 'Checklist'}<span className="ml-auto text-xs text-slate-500 font-semibold">{hechos}/{W.checklist.length}</span></h3>
              <div className="prog mb-2"><i style={{ width: (W.checklist.length ? Math.round(hechos / W.checklist.length * 100) : 0) + '%' }} /></div>
              {W.checklist.map((x, i) => (
                <div key={i} className="ck"><div className="flex gap-2 items-start"><span className="text-sm flex-1">{x.actividad}</span><button className="text-slate-300 hover:text-red-500" title="Quitar" onClick={() => marcar((w) => { w.checklist = w.checklist.filter((_, j) => j !== i) })}><X style={{ width: 14, height: 14 }} /></button></div>
                  <div className="res">{RESULTADOS.map((r) => <button key={r} type="button" data-r={r} className={x.resultado === r ? 'on' : ''} onClick={() => marcar((w) => { w.checklist = w.checklist.map((c, j) => (j === i ? { ...c, resultado: c.resultado === r ? '' : r } : c)) })}>{r}</button>)}</div>
                  {(x.resultado === 'Falla' || x.resultado === 'Corregido' || x.obs) && <input className="inp mt-1.5 !py-1.5 text-xs" placeholder="Observación" value={x.obs} onChange={(e) => marcar((w) => { w.checklist = w.checklist.map((c, j) => (j === i ? { ...c, obs: e.target.value } : c)) })} />}</div>
              ))}
              <div className="flex gap-2 mt-3"><input className="inp !py-2 text-sm" placeholder="Agregar actividad" value={ckNuevo} onChange={(e) => setCkNuevo(e.target.value)} /><button className="btn btn-sm" onClick={() => { if (ckNuevo.trim()) { marcar((w) => { w.checklist = [...w.checklist, { actividad: ckNuevo.trim(), resultado: '', obs: '' }] }); setCkNuevo('') } }}><Plus /></button></div>
              <div className="flex gap-2 mt-2"><button className="btn btn-sm" onClick={() => marcar((w) => { w.checklist = w.checklist.map((c) => (c.resultado ? c : { ...c, resultado: 'OK' })) })}><CheckCheck />Marcar pendientes OK</button>
                <button className="btn btn-sm" onClick={async () => { const l = await protocolo(o.tipo, o.producto); const ya = W.checklist.map((x) => norm(x.actividad)); marcar((w) => { l.filter((a) => !ya.includes(norm(a))).forEach((a) => w.checklist.push({ actividad: a, resultado: '', obs: '' })) }); aviso('Protocolo cargado') }}><RotateCcw />Protocolo</button></div></div>
            {!cap && <div className="sec"><h3><Gauge />Mediciones y pruebas</h3>
              {W.mediciones.map((m, i) => (
                <div key={i} className="py-2 border-b border-slate-100"><div className="flex items-center gap-2"><b className="text-sm flex-1">{m.parametro}</b><span className="text-[11px] text-slate-500">Ref. {m.referencia || '—'}</span><button className="text-slate-300 hover:text-red-500" onClick={() => marcar((w) => { w.mediciones = w.mediciones.filter((_, j) => j !== i) })}><X style={{ width: 14, height: 14 }} /></button></div>
                  <div className="fila mt-1" style={{ gridTemplateColumns: '1fr 70px auto' }}><input className="inp !py-1.5" placeholder="Valor" inputMode="decimal" value={m.valor} onChange={(e) => marcar((w) => { w.mediciones = w.mediciones.map((c, j) => (j === i ? { ...c, valor: e.target.value } : c)) })} />
                    <input className="inp !py-1.5" placeholder="Unidad" value={m.unidad} onChange={(e) => marcar((w) => { w.mediciones = w.mediciones.map((c, j) => (j === i ? { ...c, unidad: e.target.value } : c)) })} />
                    <div className="seg !mt-0"><button type="button" className={m.resultado === 'Conforme' ? 'on' : ''} onClick={() => marcar((w) => { w.mediciones = w.mediciones.map((c, j) => (j === i ? { ...c, resultado: c.resultado === 'Conforme' ? '' : 'Conforme' } : c)) })}>✓</button>
                      <button type="button" className={m.resultado === 'No conforme' ? 'on' : ''} style={m.resultado === 'No conforme' ? { background: '#c0392b', borderColor: '#c0392b' } : undefined} onClick={() => marcar((w) => { w.mediciones = w.mediciones.map((c, j) => (j === i ? { ...c, resultado: c.resultado === 'No conforme' ? '' : 'No conforme' } : c)) })}>✗</button></div></div></div>
              ))}
              <div className="flex gap-1.5 flex-wrap mt-2">{sug.map((s) => <span key={s.parametro} className="chip" onClick={() => marcar((w) => { w.mediciones = [...w.mediciones, { parametro: s.parametro, valor: '', unidad: s.unidad, referencia: s.referencia, resultado: '' }] })}><Plus style={{ width: 12, height: 12 }} />{s.parametro}</span>)}
                <span className="chip" onClick={() => { const n = prompt('Nombre de la medición:'); if (n) marcar((w) => { w.mediciones = [...w.mediciones, { parametro: n, valor: '', unidad: '', referencia: '', resultado: '' }] }) }}><Plus style={{ width: 12, height: 12 }} />Otra</span></div></div>}
            {cap && <div className="sec"><h3><Users />Personal capacitado ({W.asistentes.length})</h3>
              {W.asistentes.map((a, i) => (
                <div key={i} className="fila py-1.5" style={{ gridTemplateColumns: '1.4fr 1fr .9fr auto' }}>{(['nombre', 'cargo', 'cedula'] as const).map((k) => <input key={k} className="inp !py-1.5 text-sm" placeholder={k === 'cedula' ? 'C.I.' : k === 'cargo' ? 'Cargo' : 'Nombre'} value={a[k]} onChange={(e) => marcar((w) => { w.asistentes = w.asistentes.map((c, j) => (j === i ? { ...c, [k]: e.target.value } : c)) })} />)}
                  <button className="text-slate-300 hover:text-red-500" onClick={() => marcar((w) => { w.asistentes = w.asistentes.filter((_, j) => j !== i) })}><X style={{ width: 14, height: 14 }} /></button></div>))}
              <button className="btn btn-sm mt-2" onClick={() => marcar((w) => { w.asistentes = [...w.asistentes, { nombre: '', cargo: '', cedula: '' }] })}><UserPlus />Agregar persona</button></div>}
            <div className="sec"><h3><Hammer />{cap ? 'Desarrollo de la capacitación' : 'Trabajo realizado'}</h3><textarea className="inp" rows={4} placeholder={cap ? 'Temas, prácticas realizadas, dudas resueltas…' : 'Qué se hizo, piezas cambiadas, ajustes, pruebas…'} value={W.trabajo} onChange={(e) => marcar((w) => { w.trabajo = e.target.value })} />
              <div className="grid grid-cols-2 gap-2 mt-2"><label className="f">Horas de trabajo<input className="inp" type="number" step="0.5" min={0} value={W.horas} onChange={(e) => marcar((w) => { w.horas = e.target.value })} /></label></div></div>
            {!cap && <div className="sec"><h3><Package />Repuestos del inventario</h3>
              {o.repuestosDescontados ? <p className="text-xs text-emerald-700 font-semibold mb-2">Ya se descontaron del inventario.</p> : <p className="text-[11px] text-slate-500 mb-2">Se descuentan del inventario (Movimientos) al finalizar la orden.</p>}
              {W.repuestos.map((r, i) => <div key={r.id} className="flex items-center gap-2 py-1.5 border-b border-slate-100"><span className="text-sm flex-1">{r.nombre} <span className="mono text-[11px] text-slate-400">{r.id}</span></span>
                <input className="inp !py-1 !w-16 text-center" type="number" min={1} value={r.cantidad} disabled={o.repuestosDescontados} onChange={(e) => marcar((w) => { w.repuestos = w.repuestos.map((c, j) => (j === i ? { ...c, cantidad: Math.max(1, +e.target.value || 1) } : c)) })} />
                {!o.repuestosDescontados && <button className="text-slate-300 hover:text-red-500" onClick={() => marcar((w) => { w.repuestos = w.repuestos.filter((_, j) => j !== i) })}><X style={{ width: 14, height: 14 }} /></button>}</div>)}
              {!o.repuestosDescontados && <div className="relative mt-2"><input className="inp !py-2 text-sm" placeholder="Buscar repuesto por nombre o código" autoComplete="off" value={repQ} onFocus={() => { buscarProductos(); setRepAbierto(true) }} onBlur={() => setTimeout(() => setRepAbierto(false), 200)} onChange={(e) => { setRepQ(e.target.value); setRepAbierto(true) }} />
                {repAbierto && productos && <div className="sugg">{(() => { const w = norm(repQ).trim().split(/\s+/).filter(Boolean); const l = productos.filter((p) => !w.length || w.every((x) => norm(p.id + ' ' + p.nombre).includes(x))).slice(0, 15); return l.length ? l.map((p) => <div key={p.id} className={p.stock > 0 ? '' : 'opacity-50'} onMouseDown={() => { marcar((wk) => { const ya = wk.repuestos.find((r) => r.id === p.id); if (ya) ya.cantidad++; else wk.repuestos = [...wk.repuestos, { id: p.id, nombre: p.nombre, cantidad: 1, precio: 0 }] }); setRepQ('') }}><b>{p.nombre}</b><br /><span className="text-xs text-slate-500 mono">{p.id}</span> <span className={'text-xs font-semibold ' + (p.stock > 0 ? 'text-emerald-700' : 'text-red-600')}>· stock {p.stock}</span></div>) : <div className="text-slate-400">Sin resultados</div> })()}</div>}</div>}</div>}
            <div className="sec"><h3><Camera />Evidencia fotográfica ({W.fotos.length})</h3>
              <div className="fotos">{W.fotos.map((f, i) => <div key={f.url} className="ft"><Foto ruta={f.url} /><button onClick={() => marcar((w) => { w.fotos = w.fotos.filter((_, j) => j !== i) })}>×</button>
                <select value={f.etapa} onChange={(e) => marcar((w) => { w.fotos = w.fotos.map((c, j) => (j === i ? { ...c, etapa: e.target.value } : c)) })}>{['Antes', 'Durante', 'Después', 'Recepción'].map((x) => <option key={x}>{x}</option>)}</select></div>)}</div>
              <div className="flex gap-2 mt-2 flex-wrap">{['Antes', 'Durante', 'Después'].map((et) => <label key={et} className="btn btn-sm cursor-pointer"><Camera />{et}<input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; subirFotos(f, et) }} /></label>)}{subiendo && <Spin />}</div>
              <p className="text-[11px] text-slate-500 mt-2">Hasta 8 fotos van al informe. Se reducen en el teléfono antes de subir.</p></div>
            <div className="sec"><h3><Lightbulb />Recomendaciones al cliente</h3><textarea className="inp" rows={2} placeholder="Uso, cuidados, cambios sugeridos…" value={W.recomendaciones} onChange={(e) => marcar((w) => { w.recomendaciones = e.target.value })} /></div>
          </>
        )}
        {cerrado && (() => { const f = o.firma; return (
          <div className="sec" style={{ borderColor: o.estado === 'Cancelada' ? '#e2e8f0' : '#9ae6c7' }}><h3 style={{ color: o.estado === 'Cancelada' ? '#64748b' : 'var(--teal)' }}>{o.estado === 'Cancelada' ? <XCircle /> : <BadgeCheck />}{o.estado === 'Cancelada' ? 'Orden cancelada' : 'Servicio finalizado'}</h3>
            <dl className="kv"><KV k="Estado del equipo" v={o.estadoFinal && <b>{o.estadoFinal}</b>} /><KV k="Cierre" v={o.cierre ? dhora(o.cierre) : ''} /><KV k="Horas" v={o.horas ? String(o.horas) : ''} /><KV k="Próximo mant." v={o.proximoMantenimiento ? dfecha(o.proximoMantenimiento) : ''} />
              <KV k="Recibió" v={f.nombre ? [f.nombre, f.cargo, f.cedula ? 'C.I. ' + f.cedula : ''].filter(Boolean).join(' · ') : ''} /><KV k="Facturación" v={o.facturacion && o.facturacion !== 'No aplica' ? o.facturacion : ''} /><KV k="Diagnóstico" v={o.diagnostico} /><KV k="Trabajo" v={o.trabajo} /></dl>
            {f.png && <img src={f.png} alt="Firma" className="mt-2 h-16 border-b border-slate-300" style={{ height: 64 }} />}
            {o.estado === 'Finalizada' && <div className="grid grid-cols-2 gap-2 mt-3"><button className="btn btn-ok" onClick={() => descargar('informe')}><FileText />Descargar informe {o.informeN}</button><button className="btn btn-wa" onClick={() => setHoja('mensajes')}><MessageCircle />Enviar por WhatsApp</button></div>}</div>) })()}
        {hist.length > 0 && <div className="sec"><h3><History />Servicios anteriores de este equipo</h3>{hist.map((x) => <div key={x.id} className="py-2 border-b border-slate-100 flex gap-2 items-center text-sm cursor-pointer" onClick={() => salir(() => abrirOrden(x.id))}><span className="flex-1">{x.tipo} · <span className="text-slate-500 text-xs">{dfecha(x.cierre || x.fecha)} · {x.estadoFinal || x.estado}</span></span></div>)}</div>}
        <div className="sec"><h3><List />Línea de tiempo</h3>{[...o.eventos].reverse().map((ev, i) => <div key={i} className="ev"><span className="text-slate-400 shrink-0 w-28">{dhora(ev.fecha)}</span><span className="flex-1">{ev.nota} <span className="text-slate-400">— {ev.por}</span></span></div>)}
          {o.linkCliente ? <p className="text-[11px] text-slate-500 mt-2">El cliente ve lo marcado como público en <a className="text-[var(--acc)] font-semibold" href={o.linkCliente} target="_blank" rel="noopener noreferrer">su enlace de seguimiento</a> <button type="button" className="text-[var(--acc)] font-semibold underline" onClick={() => { navigator.clipboard?.writeText(o.linkCliente).then(() => aviso('Enlace copiado'), () => aviso(o.linkCliente)) }}>Copiar</button></p>
            : <p className="text-[10.5px] text-slate-400 mt-2">Esta orden aún no tiene enlace de seguimiento.</p>}</div>

        {!cerrado && editar && (
          <div className="acciones"><div className="flex gap-2 flex-wrap">
            {(o.estado === 'Recibida' || o.estado === 'Agendada') && <>
              {!externo && !o.tecnico && <button className="btn btn-p flex-1" onClick={() => setHoja('agendar')}><CalendarPlus />Agendar</button>}
              <button className={'btn flex-1 ' + (o.tecnico ? 'btn-p' : '')} onClick={iniciar}><Play />Iniciar servicio</button>
              <button className="btn flex-1" onClick={() => setHoja('recepcion')}><PackageOpen />Recibir en taller</button></>}
            {trabajo && <>
              <button className={'btn flex-1 ' + (sucio ? 'btn-n' : '')} disabled={guardando} onClick={() => guardarAvance().catch(err)}>{guardando ? <Spin /> : <><Save />{sucio ? 'Guardar avance' : 'Guardado'}</>}</button>
              {o.estado === 'Esperando repuesto' ? <button className="btn flex-1" onClick={() => cambiarEstado('En proceso', '')}><Play />Repuesto recibido</button> : o.estado === 'En proceso' ? <button className="btn flex-1" onClick={() => { setEstadoNuevo(''); setHoja('estado') }}><Hourglass />Esperar repuesto</button> : null}
              {o.estado !== 'Esperando aprobación' && <button className="btn btn-ok flex-1" onClick={() => {
                const falta: string[] = []
                if (W.checklist.some((x) => !x.resultado)) falta.push(W.checklist.filter((x) => !x.resultado).length + ' actividad(es) del checklist')
                if (cap ? !W.asistentes.filter((a) => a.nombre).length : !W.trabajo.trim() && !W.diagnostico.trim()) falta.push(cap ? 'los asistentes' : 'el trabajo realizado')
                if (o.modalidad !== 'Remoto' && !W.fotos.length) falta.push('fotos de evidencia')
                if (falta.length) { aviso('Antes de cerrar completa: ' + falta.join(', ') + '.'); return }
                setHoja('finalizar') }}><FileCheck2 />Finalizar e informe</button>}</>}
            {!externo && <button className="btn btn-red btn-sm" title="Cancelar orden" onClick={() => setHoja('cancelar')}><XCircle /></button>}
          </div></div>
        )}
      </div>
      {hoja === 'editar' && <EditarOrden o={o} aviso={aviso} cerrar={() => setHoja(null)} listo={async (c) => { const { error } = await supabase.from('st_ordenes').update(c).eq('id', o.id); if (error) { aviso(error.message); return } setHoja(null); await cargar(); aviso('Orden actualizada') }} />}
      {hoja === 'agendar' && <Agendar o={o} tecnicos={tecnicos.filter((t) => t.activo)} cerrar={() => setHoja(null)} listo={async (a) => {
        try {
          const prog = new Date(a.fecha + 'T12:00:00'); if (a.hora) { const [h, m] = a.hora.split(':'); prog.setHours(+h, +m, 0, 0) }
          const t = tecnicos.find((x) => x.nombre === a.tecnico)!
          await evento(o, `Servicio agendado para el ${prog.toLocaleDateString('es-EC')}${a.hora ? ' a las ' + a.hora : ''} con ${t.nombre}${t.empresa ? ` (${t.empresa})` : ''}.`, true, { tecnico_id: t.id, tecnico_texto: t.nombre, fecha_programada: prog.toISOString(), modalidad: a.modalidad, ...(o.estado === 'Recibida' ? { estado: 'Agendada' } : {}) })
          setHoja(null); await cargar(); aviso('Servicio agendado'); setTimeout(() => setHoja('mensajes'), 300)
        } catch (e) { err(e) } }} />}
      {hoja === 'recepcion' && <Recepcion o={o} perfil={perfil} subir={(f, et, d) => subirFotos(f, et, d)} cerrar={() => setHoja(null)} listo={async (r) => {
        try {
          const base = (await cargar(false)) ?? o
          if (!abierta(base)) throw new Error('La orden ya está cerrada.')
          const campos: Record<string, unknown> = { recepcion: { ...r.recepcion, fecha: new Date().toISOString(), recibidoPor: perfil.nombre }, modalidad: 'Taller', falla_reportada: r.falla.slice(0, 2000) || base.falla }
          if (r.fotos.length) campos.fotos = [...base.fotos, ...r.fotos.map((f) => ({ ...f, etapa: 'Recepción' }))].slice(0, 16)
          if (base.estado === 'Recibida' || base.estado === 'Agendada') { campos.estado = 'En proceso'; campos.inicio = new Date().toISOString(); if (!base.tecnico) campos.tecnico_texto = perfil.nombre }
          if (!base.checklist.length) campos.checklist = (await protocolo(base.tipo, base.producto)).map((a) => ({ actividad: a, resultado: '', obs: '' }))
          if (!base.recepcionN) { const y = new Date().getFullYear(); const { count } = await supabase.from('st_ordenes').select('id', { count: 'exact', head: true }).like('recepcion_numero', `RE-${y}-%`); campos.recepcion_numero = `RE-${y}-${String((count ?? 0) + 1).padStart(4, '0')}` }
          await evento(base, 'Recibimos tu equipo en nuestro taller.', true, campos)
          setHoja(null); await cargar(); aviso('Equipo recibido. Descarga el comprobante desde la orden.')
        } catch (e) { err(e) } }} />}
      {hoja === 'estado' && <Hoja cerrar={() => setHoja(null)}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">Esperar repuesto</h3><label className="f">¿Qué repuesto se espera? (lo verá el cliente)<input className="inp" value={estadoNuevo} onChange={(e) => setEstadoNuevo(e.target.value)} autoFocus /></label>
        <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={() => setHoja(null)}>Cancelar</button><button className="btn btn-p flex-1" onClick={() => { setHoja(null); cambiarEstado('Esperando repuesto', estadoNuevo) }}>Aceptar</button></div></Hoja>}
      {hoja === 'cancelar' && <Hoja cerrar={() => setHoja(null)}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">Cancelar la orden</h3><label className="f">Motivo de la cancelación *<input className="inp" value={estadoNuevo} onChange={(e) => setEstadoNuevo(e.target.value)} autoFocus /></label>
        <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={() => setHoja(null)}>Volver</button><button className="btn btn-red flex-1" onClick={() => { if (!estadoNuevo.trim()) { aviso('Indica el motivo de la cancelación.'); return } setHoja(null); setSucio(false); cambiarEstado('Cancelada', estadoNuevo) }}>Cancelar orden</button></div></Hoja>}
      {hoja === 'finalizar' && <Finalizar o={o} eq={eq} W={W} cerrar={() => setHoja(null)} listo={async (fin) => {
        try {
          await guardarAvance(true, { recomendaciones: fin.recomendaciones.slice(0, 2000), horas: Number(fin.horas) || 0 })
          const { data, error } = await supabase.rpc('st_finalizar', { p_id: o.id, p_fin: fin })
          if (error) throw new Error(error.message)
          setHoja(null); await cargar(); aviso(`Servicio finalizado. Informe ${data} listo para descargar.`); setTimeout(() => setHoja('mensajes'), 400)
        } catch (e) { err(e); throw e } }} />}
      {hoja === 'mensajes' && <Mensajes o={o} eq={eq} cerrar={() => setHoja(null)} registrar={async (txt) => { await evento(o, 'Mensaje de WhatsApp al cliente: ' + txt + '.', false); cargar(false) }} />}
    </div>
  )
}

function EditarOrden({ o, aviso, cerrar, listo }: { o: Orden; aviso: (t: string) => void; cerrar: () => void; listo: (c: Record<string, unknown>) => void }) {
  void aviso
  const [f, setF] = useState({ tipo: o.tipo, cobertura: o.cobertura, prioridad: o.prioridad, modalidad: o.modalidad, falla: o.falla, contacto: o.contacto, telefono: o.telefono })
  const s = (k: keyof typeof f) => (x: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: x.target.value }))
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">Editar orden</h3>
      <div className="space-y-3"><label className="f">Tipo<Seg opciones={TIPOS} valor={f.tipo} cambia={(v) => setF((x) => ({ ...x, tipo: v }))} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="f">Cobertura<select className="inp" value={f.cobertura} onChange={s('cobertura')}>{COBERTURAS.map((c) => <option key={c}>{c}</option>)}</select></label><label className="f">Prioridad<select className="inp" value={f.prioridad} onChange={s('prioridad')}>{PRIORIDADES.map((c) => <option key={c}>{c}</option>)}</select></label></div>
        <label className="f">Modalidad<select className="inp" value={f.modalidad} onChange={s('modalidad')}>{MODALIDADES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="f">Falla / motivo<textarea className="inp" rows={3} value={f.falla} onChange={s('falla')} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="f">Contacto<input className="inp" value={f.contacto} onChange={s('contacto')} /></label><label className="f">Teléfono<input className="inp" value={f.telefono} onChange={s('telefono')} /></label></div></div>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" onClick={() => listo({ tipo: f.tipo, cobertura: f.cobertura, prioridad: f.prioridad, modalidad: f.modalidad, falla_reportada: f.falla.slice(0, 2000), contacto: f.contacto.slice(0, 120), telefono: f.telefono.slice(0, 40) })}><Check />Guardar</button></div></Hoja>
  )
}

function Agendar({ o, tecnicos, cerrar, listo }: { o: Orden; tecnicos: Tecnico[]; cerrar: () => void; listo: (a: { tecnico: string; fecha: string; hora: string; modalidad: string }) => Promise<void> }) {
  const [a, setA] = useState({ tecnico: o.tecnico, fecha: ymd(o.fechaProgramada), hora: hm(o.fechaProgramada), modalidad: o.modalidad })
  const [err, setErr] = useState('')
  const s = (k: keyof typeof a) => (x: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setA((v) => ({ ...v, [k]: x.target.value }))
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">Agendar servicio</h3>
      <div className="space-y-3"><label className="f">Técnico *<select className="inp" value={a.tecnico} onChange={s('tecnico')}><option value="">— Elegir —</option>{tecnicos.map((t) => <option key={t.nombre} value={t.nombre}>{t.nombre + (t.tipo === 'Externo' ? ' · externo' + (t.empresa ? ` (${t.empresa})` : '') : '')}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2"><label className="f">Fecha *<input type="date" className="inp" value={a.fecha} onChange={s('fecha')} /></label><label className="f">Hora<input type="time" className="inp" value={a.hora} onChange={s('hora')} /></label></div>
        <label className="f">Modalidad<select className="inp" value={a.modalidad} onChange={s('modalidad')}>{MODALIDADES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <p className="text-[11px] text-slate-500">Luego avísale al cliente por WhatsApp.</p>{err && <p className="text-[11px] text-red-600">{err}</p>}</div>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" onClick={() => { if (!a.tecnico) { setErr('Elige el técnico.'); return } if (!a.fecha) { setErr('Indica la fecha del servicio.'); return } listo(a) }}><Check />Agendar</button></div></Hoja>
  )
}

function Recepcion({ o, perfil, subir, cerrar, listo }: { o: Orden; perfil: Perfil; subir: (f: File[], etapa: string, destino: Foto[]) => Promise<void>; cerrar: () => void; listo: (r: { falla: string; recepcion: Record<string, string>; fotos: Foto[] }) => Promise<void> }) {
  void perfil
  const [f, setF] = useState({ falla: o.falla, accesorios: '', estadoFisico: '', entregadoPor: o.contacto, cedula: '' })
  const [fotos, setFotos] = useState<Foto[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const [limpiar, setLimpiar] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  const lienzo = useRef<HTMLCanvasElement>(null)
  const s = (k: keyof typeof f) => (x: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: x.target.value }))
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-1">Recibir equipo en taller</h3><p className="text-xs text-slate-500 mb-3">Después podrás descargar el comprobante de recepción en PDF para el cliente.</p>
      <div className="space-y-3"><label className="f">Falla reportada<textarea className="inp" rows={2} value={f.falla} onChange={s('falla')} /></label>
        <label className="f">Accesorios que se reciben<textarea className="inp" rows={2} placeholder="Cable de poder, bandejas, manual, maleta…" value={f.accesorios} onChange={s('accesorios')} /></label>
        <label className="f">Estado físico<textarea className="inp" rows={2} placeholder="Rayones, golpes, piezas faltantes…" value={f.estadoFisico} onChange={s('estadoFisico')} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="f">Entrega (nombre) *<input className="inp" value={f.entregadoPor} onChange={s('entregadoPor')} /></label><label className="f">Cédula<input className="inp" inputMode="numeric" value={f.cedula} onChange={s('cedula')} /></label></div>
        <p className="text-xs font-semibold text-slate-500">Fotos del equipo al recibirlo</p><div className="fotos">{fotos.map((x) => <div key={x.url} className="ft"><Foto ruta={x.url} /></div>)}{subiendo && <Spin />}</div>
        <label className="btn btn-sm cursor-pointer w-fit"><Camera />Tomar foto<input type="file" accept="image/*" capture="environment" multiple hidden onChange={async (e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; setSubiendo(true); const nuevo: Foto[] = []; await subir(fs, 'Recepción', nuevo); setFotos((x) => [...x, ...nuevo]); setSubiendo(false) }} /></label>
        <p className="text-xs font-semibold text-slate-500 flex">Firma de quien entrega (opcional)<button type="button" className="ml-auto text-[var(--acc)] font-bold" onClick={() => setLimpiar((n) => n + 1)}>Borrar</button></p><Firma lienzo={lienzo} limpiar={limpiar} />{err && <p className="text-[11px] text-red-600">{err}</p>}</div>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" disabled={ocupado} onClick={async () => { if (!f.entregadoPor.trim()) { setErr('Escribe quién entrega el equipo.'); return } setOcupado(true); await listo({ falla: f.falla, fotos, recepcion: { accesorios: f.accesorios.slice(0, 600), estadoFisico: f.estadoFisico.slice(0, 600), entregadoPor: f.entregadoPor.slice(0, 120), cedula: f.cedula.slice(0, 20), firma: firmaPng(lienzo.current) } }); setOcupado(false) }}>{ocupado ? <Spin /> : <><Check />Registrar ingreso</>}</button></div></Hoja>
  )
}

function Finalizar({ o, eq, W, cerrar, listo }: { o: Orden; eq: Equipo | null; W: Trabajo; cerrar: () => void; listo: (fin: Record<string, string>) => Promise<void> }) {
  let prox = ''
  if (o.tipo === 'Mantenimiento preventivo' && eq?.frecuencia) { const d = new Date(); d.setMonth(d.getMonth() + eq.frecuencia); prox = ymd(d.toISOString()) } else if (eq?.proximo && eq.plan !== 'Sin plan') prox = eq.proximo
  const [f, setF] = useState({ estadoFinal: o.tipo === 'Baja técnica' ? 'Dado de baja' : 'Operativo', proximo: prox, horas: W.horas, recomendaciones: W.recomendaciones, nombre: o.contacto, cedula: '', cargo: '' })
  const [limpiar, setLimpiar] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  const lienzo = useRef<HTMLCanvasElement>(null)
  const s = (k: keyof typeof f) => (x: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: x.target.value }))
  const remoto = o.modalidad === 'Remoto'
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-1">Finalizar y generar informe</h3><p className="text-xs text-slate-500 mb-3">Se descuentan los repuestos, se actualiza la hoja de vida y queda listo el informe para descargar en PDF.</p>
      <div className="space-y-3"><label className="f">Estado final del equipo *<Seg opciones={ESTADOS_FINALES} valor={f.estadoFinal} cambia={(v) => setF((x) => ({ ...x, estadoFinal: v }))} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="f">Próximo mantenimiento<input type="date" className="inp" value={f.proximo} onChange={s('proximo')} /></label><label className="f">Horas de trabajo<input type="number" step="0.5" min={0} className="inp" value={f.horas} onChange={s('horas')} /></label></div>
        <label className="f">Recomendaciones<textarea className="inp" rows={2} value={f.recomendaciones} onChange={s('recomendaciones')} /></label>
        {!remoto && <><p className="font-display font-bold text-[var(--navy)] pt-1">Recibe conforme</p>
          <div className="grid grid-cols-2 gap-2"><label className="f">Nombre *<input className="inp" value={f.nombre} onChange={s('nombre')} /></label><label className="f">Cédula<input className="inp" inputMode="numeric" value={f.cedula} onChange={s('cedula')} /></label></div>
          <label className="f">Cargo<input className="inp" placeholder="Ej.: Odontólogo, Jefe de enfermería" value={f.cargo} onChange={s('cargo')} /></label>
          <p className="text-xs font-semibold text-slate-500 flex">Firma *<button type="button" className="ml-auto text-[var(--acc)] font-bold" onClick={() => setLimpiar((n) => n + 1)}>Borrar</button></p><Firma lienzo={lienzo} limpiar={limpiar} /></>}
        {err && <p className="text-[12px] text-red-600">{err}</p>}</div>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-ok flex-1" disabled={ocupado} onClick={async () => {
        if (!remoto) { if (!f.nombre.trim()) { setErr('Escribe quién recibe el servicio.'); return } if (!lienzo.current?.dataset.firmado) { setErr('Falta la firma.'); return } }
        setOcupado(true); setErr('')
        try { await listo({ estadoFinal: f.estadoFinal, proximo: f.proximo, horas: f.horas, recomendaciones: f.recomendaciones, firma: remoto ? '' : firmaPng(lienzo.current), firmaNombre: f.nombre, firmaCedula: f.cedula, firmaCargo: f.cargo }) } catch (e) { setOcupado(false); setErr((e as Error).message) }
      }}>{ocupado ? <Spin /> : <><FileCheck2 />Finalizar</>}</button></div></Hoja>
  )
}

function Mensajes({ o, eq, cerrar, registrar }: { o: Orden; eq: Equipo | null; cerrar: () => void; registrar: (t: string) => void }) {
  const n = String(o.contacto || o.cliente || '').split(' ')[0], marca = o.empresa === 'FEMEDICS' ? 'FEMEDICS' : 'VIMEDIC', e = `${o.producto} (serie ${o.serie})`
  const f = o.fechaProgramada ? new Date(o.fechaProgramada).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' }) + (hm(o.fechaProgramada) ? ' a las ' + hm(o.fechaProgramada) : '') : ''
  // Enlace de seguimiento del cliente (como en el original, va en cada mensaje)
  const link = o.linkCliente
  const pl: Record<string, [string, string]> = {
    agendado: ['Servicio agendado', `Hola ${n}, le saluda el departamento de Servicio Técnico de ${marca}. Su servicio de ${o.tipo.toLowerCase()} para el equipo ${e} quedó agendado para el ${f}${o.tecnico ? ' con el técnico ' + o.tecnico.split(' ')[0] : ''}.${link ? ' Puede ver el avance aquí: ' + link : ''}`],
    camino: ['Técnico en camino', `Hola ${n}, el técnico de ${marca} va en camino para atender su equipo ${e}.${link ? ' Seguimiento: ' + link : ''}`],
    repuesto: ['Esperando repuesto', `Hola ${n}, estamos esperando un repuesto para su equipo ${e}. Le avisaremos apenas llegue.${link ? ' Seguimiento: ' + link : ''}`],
    informe: ['Servicio finalizado + informe', link ? `Hola ${n}, finalizamos el servicio de ${o.tipo.toLowerCase()} de su equipo ${e}. Aquí puede ver y descargar el informe técnico: ${link}` : `Hola ${n}, finalizamos el servicio de ${o.tipo.toLowerCase()} de su equipo ${e}. Le haremos llegar el informe técnico.`],
    preventivo: ['Recordatorio de mantenimiento', `Hola ${n}, le recordamos que su equipo ${e} tiene programado su mantenimiento preventivo${eq?.proximo ? ' para el ' + new Date(eq.proximo + 'T12:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'long' }) : ''}${eq?.garantia === 'Vigente' ? ', necesario para mantener la garantía vigente' : ''}. ¿Coordinamos la visita?`],
  }
  const sug = ({ Recibida: o.tipo === 'Mantenimiento preventivo' ? 'preventivo' : 'agendado', Agendada: 'agendado', 'En proceso': 'camino', 'Esperando aprobación': 'agendado', 'Esperando repuesto': 'repuesto', Finalizada: 'informe' } as Record<string, string>)[o.estado] || 'agendado'
  const [k, setK] = useState(sug)
  const [txt, setTxt] = useState(pl[sug][1])
  const [tel, setTel] = useState(o.telefono || eq?.telefono || '')
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-2">Mensaje por WhatsApp</h3>
      <label className="f">Plantilla<select className="inp" value={k} onChange={(x) => { setK(x.target.value); setTxt(pl[x.target.value][1]) }}>{Object.keys(pl).map((p) => <option key={p} value={p}>{pl[p][0]}</option>)}</select></label>
      <label className="f mt-3">Teléfono<input className="inp" value={tel} onChange={(x) => setTel(x.target.value)} /></label>
      <label className="f mt-3">Mensaje (puedes editarlo)<textarea className="inp" rows={7} value={txt} onChange={(x) => setTxt(x.target.value)} /></label>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cerrar</button><button className="btn btn-wa flex-1" onClick={() => { const num = waNum(tel); if (!num) return; window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(txt), '_blank'); registrar(pl[k][0]); cerrar() }}><MessageCircle />Abrir WhatsApp</button></div></Hoja>
  )
}

/* ============================ Inventario con observaciones ============================ */
type Unidad = { unidadId: string | null; serie: string; origen: string; estadoBodega: string; observacionBodega: string; importacion: string; requiereRevision: boolean; seg?: Seg }
type Seg = { id: string; estado: string; falla: string; diagnostico: string; trabajo: string; pruebas: string; recomendaciones: string; tecnico: string; version: string; historial: { fecha: string; por: string; estado: string; falla?: string; diagnostico?: string; trabajo?: string; pruebas?: string }[]; evidencias: { id: string; nombre: string; mime: string; tamano: number; fecha: string; por: string }[] }
type Prod = { id: string; codigo: string; nombre: string; categoria: string; imagen: string; stock: number; observacion: string; porReparar: number; noDisponible: number; unidades: Unidad[] }

function Inventario({ perfil, q, editar, aviso }: { perfil: Perfil; q: string; editar: boolean; aviso: (t: string) => void }) {
  const [prods, setProds] = useState<Prod[] | null>(null)
  const [error, setError] = useState('')
  const [cat, setCat] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const cargar = useCallback(async () => {
    const col = 'id,codigo,nombre,imagen_url,stock,reservaciones,stock_por_reparar,stock_no_disponible_nc,categoria:categorias(nombre)'
    const [a, u, i] = await Promise.all([
      supabase.from('productos').select(col).is('deleted_at', null).or('reservaciones.not.is.null,stock_por_reparar.gt.0,stock_no_disponible_nc.gt.0').limit(1500),
      supabase.from('imp_unidades').select('id,codigo,producto_id,serie,estado,revision_bodega,pedido_codigo').is('deleted_at', null).not('serie', 'is', null).or('estado.ilike.%servicio t%,estado.ilike.%reparar%,estado.ilike.%no reparable%').limit(1500),
      supabase.from('st_incidencias_inventario').select('id,producto_id,producto_codigo,serie,unidad_id,estado,falla,diagnostico,trabajo,pruebas,recomendaciones,tecnico_texto,historial,evidencias,updated_at').is('deleted_at', null).limit(1500),
    ])
    const fallo = a.error || u.error || i.error; if (fallo) { setError(fallo.message); return }
    type P = { id: string; codigo: string; nombre: string; imagen_url: string | null; stock: number; reservaciones: string | null; stock_por_reparar: number; stock_no_disponible_nc: number; categoria: { nombre: string } | null }
    const mapa = new Map<string, Prod>()
    const nuevo = (p: P): Prod => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, categoria: p.categoria?.nombre ?? '', imagen: p.imagen_url ?? '', stock: p.stock, observacion: p.reservaciones ?? '', porReparar: p.stock_por_reparar, noDisponible: p.stock_no_disponible_nc, unidades: [] })
    ;((a.data ?? []) as unknown as P[]).filter((p) => (p.reservaciones ?? '').trim() || p.stock_por_reparar || p.stock_no_disponible_nc).forEach((p) => mapa.set(p.id, nuevo(p)))
    const unis = (u.data ?? []) as { id: string; codigo: string; producto_id: string | null; serie: string; estado: string; revision_bodega: Record<string, unknown>; pedido_codigo: string }[]
    const incs = (i.data ?? []) as { id: string; producto_id: string | null; producto_codigo: string; serie: string; unidad_id: string | null; estado: string; falla: string; diagnostico: string; trabajo: string; pruebas: string; recomendaciones: string; tecnico_texto: string; historial: unknown; evidencias: unknown; updated_at: string }[]
    const faltan = [...new Set([...unis.map((x) => x.producto_id), ...incs.map((x) => x.producto_id)].filter((x): x is string => !!x && !mapa.has(x)))]
    if (faltan.length) { const { data } = await supabase.from('productos').select(col).in('id', faltan); ((data ?? []) as unknown as P[]).forEach((p) => mapa.set(p.id, nuevo(p))) }
    unis.forEach((x) => {
      const p = x.producto_id ? mapa.get(x.producto_id) : null; if (!p || !x.serie?.trim()) return
      const rb = x.revision_bodega || {}, rev = arr<Record<string, unknown>>(rb.revisiones), last = rev.length ? rev[rev.length - 1] : rb
      const ob = String(last.defecto || last.observacion || last.obs || rb.defecto || '')
      p.unidades.push({ unidadId: x.id, serie: x.serie.trim(), origen: 'Bodega', estadoBodega: x.estado ?? '', observacionBodega: ob, importacion: x.pedido_codigo ?? '', requiereRevision: true })
    })
    incs.forEach((c) => {
      const p = (c.producto_id && mapa.get(c.producto_id)) || [...mapa.values()].find((x) => x.codigo.toUpperCase() === String(c.producto_codigo).toUpperCase()); if (!p) return
      let un = p.unidades.find((x) => x.serie.toUpperCase() === String(c.serie).toUpperCase())
      if (!un) { un = { unidadId: c.unidad_id, serie: c.serie, origen: 'Registrada en Servicio Técnico', estadoBodega: '', observacionBodega: '', importacion: '', requiereRevision: true }; p.unidades.push(un) }
      un.seg = { id: c.id, estado: c.estado ?? 'Pendiente de revisión', falla: c.falla ?? '', diagnostico: c.diagnostico ?? '', trabajo: c.trabajo ?? '', pruebas: c.pruebas ?? '', recomendaciones: c.recomendaciones ?? '', tecnico: c.tecnico_texto ?? '', version: c.updated_at, historial: arr(c.historial), evidencias: arr(c.evidencias) }
    })
    setError(''); setProds([...mapa.values()].sort((x, y) => x.nombre.localeCompare(y.nombre, 'es')))
  }, [])
  useEffect(() => { cargar() }, [cargar])
  const w = norm(q).trim().split(/\s+/).filter(Boolean)
  const cats = [...new Set((prods ?? []).map((p) => p.categoria).filter(Boolean))].sort()
  const l = (prods ?? []).filter((p) => (!cat || p.categoria === cat) && w.every((x) => norm([p.codigo, p.nombre, p.categoria, p.observacion, ...p.unidades.map((u) => [u.serie, u.observacionBodega, u.seg?.falla, u.seg?.diagnostico].join(' '))].join(' ')).includes(x)))
  const actual = prods?.find((p) => p.id === abierto) ?? null
  return (
    <>
      {error && <div className="text-red-700 p-4">{error}</div>}
      {prods === null && !error && <div className="text-center py-12"><Spin /> Cargando observaciones de Inventario y Bodega…</div>}
      {prods && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <div className="col-span-full"><div className="flex gap-3 flex-wrap items-center"><label className="text-xs font-semibold">Categoría<select className="inp" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas las categorías</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label><p className="text-sm text-slate-600">{l.length} de {prods.length} productos · Observaciones generales y seguimiento por serie</p></div>
            <p className="text-xs text-slate-500 mt-2">Las observaciones generales no se atribuyen a una unidad hasta identificar su serie. Los estados técnicos no ingresan ni liberan stock.</p></div>
          {l.map((p) => (
            <button key={p.id} className="card text-left" type="button" onClick={() => setAbierto(p.id)}>
              <div className="flex gap-3">{p.imagen && <img src={p.imagen} alt="" style={{ width: 64, height: 64, objectFit: 'contain', borderRadius: 10 }} loading="lazy" onError={(e) => e.currentTarget.remove()} />}<div className="min-w-0"><p className="text-xs text-slate-500">{p.codigo} · {p.categoria}</p><b className="text-sm">{p.nombre}</b><p className="text-xs mt-1">Stock registrado: {p.stock} · {p.unidades.length} unidades identificadas</p></div></div>
              <p className="text-xs text-slate-700 mt-3" style={{ whiteSpace: 'pre-wrap' }}>{p.observacion || 'Observación registrada en una unidad de Bodega'}</p>
              <p className="text-xs text-[var(--acc)] font-semibold mt-2">{p.unidades.some((u) => u.seg) ? `${p.unidades.filter((u) => u.seg).length} seguimiento(s) por serie` : 'Pendiente de identificar / revisar'}</p>
            </button>
          ))}
        </div>
      )}
      {actual && <PanelProducto p={actual} perfil={perfil} editar={editar} aviso={aviso} cerrar={() => setAbierto(null)} recargar={cargar} />}
    </>
  )
}

function PanelProducto({ p, perfil, editar, aviso, cerrar, recargar }: { p: Prod; perfil: Perfil; editar: boolean; aviso: (t: string) => void; cerrar: () => void; recargar: () => Promise<void> }) {
  const [obs, setObs] = useState(p.observacion)
  const [guardando, setGuardando] = useState(false)
  const [unidad, setUnidad] = useState<{ u: Unidad | null } | null>(null)
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])
  const sucio = obs !== p.observacion
  async function guardarObs() {
    setGuardando(true)
    const { error } = await supabase.from('productos').update({ reservaciones: obs || null }).eq('id', p.id).eq('codigo', p.codigo)
    setGuardando(false)
    if (error) { aviso(error.message); return }
    await recargar(); aviso('Observación general actualizada')
  }
  return (
    <div className="panel">
      <Cabecera titulo={p.nombre} sub={p.codigo + ' · Observaciones técnicas'} cerrar={() => { if (sucio && !confirm('Tienes cambios sin guardar. ¿Salir sin guardar?')) return; cerrar() }} />
      <div className="w-full px-4 lg:px-6 py-4 space-y-3">
        <div className="sec"><h3>Observación general original de Inventario</h3><p className="text-xs text-slate-500 mb-2">Esta nota pertenece al producto completo. No describe automáticamente a todas sus unidades.</p>
          <textarea className="inp" rows={4} maxLength={40000} value={obs} readOnly={!editar} onChange={(e) => setObs(e.target.value)} />
          <button className="btn btn-sm mt-2" disabled={!editar || !sucio || guardando} onClick={guardarObs}>{guardando ? <Spin /> : 'Guardar observación general'}</button>
          <p className="text-xs text-slate-500 mt-2">Por reparar: {p.porReparar} · No disponible NC: {p.noDisponible}</p></div>
        <div className="sec"><h3>Equipos específicos por número de serie</h3><p className="text-xs text-slate-500 mb-3">Abre la serie correspondiente para registrar la falla, diagnóstico, reparación y pruebas. Las notas de Bodega se conservan como origen.</p>
          {p.unidades.map((u) => (
            <button key={u.serie} className="w-full text-left border rounded-xl p-3 mb-2" onClick={() => { if (sucio) { aviso('Guarda primero la observación general del producto.'); return } setUnidad({ u }) }}>
              <b className="mono text-sm">Serie {u.serie}</b><p className="text-xs text-slate-500">{u.origen}{u.importacion ? ' · ' + u.importacion : ''} · {u.estadoBodega || 'Estado de inventario sin modificar'}</p>
              <p className="text-xs mt-1">{u.observacionBodega || 'Sin observación individual de Bodega'}</p><p className="text-xs font-bold text-[var(--acc)] mt-1">{u.seg ? u.seg.estado : 'Sin seguimiento técnico'}</p></button>
          ))}
          {editar && <button className="btn btn-p w-full mt-2" onClick={() => { if (sucio) { aviso('Guarda primero la observación general del producto.'); return } setUnidad({ u: null }) }}>Identificar otra unidad por serie</button>}</div>
      </div>
      {unidad && <SeguimientoUnidad p={p} u={unidad.u} perfil={perfil} cerrar={() => setUnidad(null)} guardado={async () => { setUnidad(null); await recargar(); aviso('Seguimiento por serie guardado') }} />}
    </div>
  )
}

function SeguimientoUnidad({ p, u, perfil, cerrar, guardado }: { p: Prod; u: Unidad | null; perfil: Perfil; cerrar: () => void; guardado: () => Promise<void> }) {
  const c = u?.seg
  const [f, setF] = useState({ serie: u?.serie ?? '', estado: c?.estado ?? 'Pendiente de revisión', tecnico: c?.tecnico ?? perfil.nombre, falla: c?.falla || u?.observacionBodega || '', diagnostico: c?.diagnostico ?? '', trabajo: c?.trabajo ?? '', pruebas: c?.pruebas ?? '', recomendaciones: c?.recomendaciones ?? '' })
  const [evid, setEvid] = useState<Seg['evidencias']>(c?.evidencias ?? [])
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const s = (k: keyof typeof f) => (x: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: x.target.value }))
  async function archivos(files: File[]) {
    if (!f.serie.trim()) { setErr('Escribe la serie antes de adjuntar fotos o videos.'); return }
    if (evid.length + files.length > 20) { setErr('Máximo 20 evidencias por equipo.'); return }
    setSubiendo(true); setErr('')
    try {
      for (let i = 0; i < files.length; i++) {
        const x = files[i], mime = x.type || (/\.mov$/i.test(x.name) ? 'video/quicktime' : '')
        if (!/^(image\/(jpeg|png|webp)|video\/(mp4|webm|quicktime))$/.test(mime)) throw new Error('Formato no admitido: ' + x.name)
        if (!x.size || x.size > (mime.startsWith('video/') ? 25 : 10) * 1048576) throw new Error('Archivo vacío o demasiado grande: ' + x.name)
        setMsg(`Subiendo ${i + 1} de ${files.length}: ${x.name}`)
        const ruta = `inventario/${p.codigo}/${f.serie.trim().replace(/[^a-zA-Z0-9.-]/g, '_')}/${crypto.randomUUID().slice(0, 8)}_${x.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const { error } = await supabase.storage.from('servicio-tecnico').upload(ruta, x, { contentType: mime })
        if (error) throw new Error(error.message)
        setEvid((a) => [...a, { id: ruta, nombre: x.name, mime, tamano: x.size, fecha: new Date().toISOString(), por: perfil.email }])
      }
      setMsg('Archivos cargados. Guarda el seguimiento para vincularlos al historial.')
    } catch (e) { setErr((e as Error).message); setMsg('Los archivos ya cargados se conservan en este formulario.') }
    setSubiendo(false)
  }
  async function ver(e: Seg['evidencias'][number]) {
    const { data } = await supabase.storage.from('servicio-tecnico').createSignedUrl(e.id, 600)
    if (data) window.open(data.signedUrl, '_blank', 'noopener')
  }
  async function guardar() {
    const serie = f.serie.trim().slice(0, 100)
    if (!serie) { setErr('Escribe la serie de este equipo.'); return }
    if (!f.falla.trim()) { setErr('Describe la falla o motivo de revisión de esta unidad.'); return }
    if (f.estado === 'No reparable' && !f.diagnostico.trim()) { setErr('Documenta el diagnóstico antes de marcar una unidad como no reparable.'); return }
    if ((f.estado === 'Resuelto' || f.estado === 'Listo para revisión de Bodega') && (!f.diagnostico.trim() || !f.pruebas.trim())) { setErr('Registra el diagnóstico y las pruebas antes de dar por resuelto el trabajo.'); return }
    if (!evid.some((e) => e.mime.startsWith('image/'))) { setErr('Adjunta al menos una foto del problema. También puedes añadir videos.'); return }
    setOcupado(true); setErr('')
    const ahora = new Date().toISOString()
    const hist = [...(c?.historial ?? []), { fecha: ahora, por: perfil.nombre, estado: f.estado, falla: f.falla.slice(0, 4000), diagnostico: f.diagnostico.slice(0, 4000), trabajo: f.trabajo.slice(0, 4000), pruebas: f.pruebas.slice(0, 4000), recomendaciones: f.recomendaciones.slice(0, 4000), evidencias: evid.map((e) => e.id) }]
    const campos = { producto_id: p.id, producto_codigo: p.codigo, serie, unidad_id: u?.unidadId ?? null, estado: f.estado, falla: f.falla.slice(0, 4000), diagnostico: f.diagnostico.slice(0, 4000), trabajo: f.trabajo.slice(0, 4000), pruebas: f.pruebas.slice(0, 4000), recomendaciones: f.recomendaciones.slice(0, 4000), tecnico_texto: (f.tecnico || perfil.nombre).slice(0, 150), historial: hist, evidencias: evid }
    let error
    if (c) { const r = await supabase.from('st_incidencias_inventario').update(campos).eq('id', c.id).eq('updated_at', c.version).select('id'); error = r.error ?? (r.data?.length ? null : { message: 'Esta unidad cambió. Vuelve a abrirla antes de guardar.' }) }
    else { const r = await supabase.from('st_incidencias_inventario').insert({ id: crypto.randomUUID(), codigo: codigoNuevo('STI'), ...campos }); error = r.error }
    if (error) { setOcupado(false); setErr(error.message); return }
    await guardado()
  }
  const campo = (k: keyof typeof f, t: string) => <label className="block mt-3"><span className="f">{t}</span><textarea className="inp" rows={2} maxLength={4000} value={f[k]} onChange={s(k)} /></label>
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg">Seguimiento técnico de una unidad</h3><p className="text-xs text-slate-500">{p.codigo} · {p.nombre}</p>
      <label className="block mt-3"><span className="f">Número de serie de este equipo</span><input className="inp mono" maxLength={100} value={f.serie} readOnly={!!u} placeholder="Lee la serie de la etiqueta física" onChange={s('serie')} /></label>
      {u?.observacionBodega && <div className="aviso mt-3"><b>Observación original de Bodega:</b><p className="text-xs" style={{ whiteSpace: 'pre-wrap' }}>{u.observacionBodega}</p></div>}
      <label className="block mt-3"><span className="f">Estado técnico</span><select className="inp" value={f.estado} onChange={s('estado')}>{ESTADOS_INV.map((e) => <option key={e}>{e}</option>)}</select></label>
      <label className="block mt-3"><span className="f">Técnico responsable</span><input className="inp" maxLength={150} value={f.tecnico} onChange={s('tecnico')} /></label>
      {campo('falla', 'Falla o motivo de revisión de ESTA unidad')}{campo('diagnostico', 'Diagnóstico')}{campo('trabajo', 'Trabajo realizado / repuestos utilizados (sin precios)')}{campo('pruebas', 'Pruebas y resultado de funcionamiento')}{campo('recomendaciones', 'Recomendaciones y próximos pasos')}
      <section className="mt-4 border rounded-xl p-3"><h4 className="font-bold text-sm">Foto del problema obligatoria · videos opcionales</h4><p className="text-xs text-slate-500 my-2">Adjunta al menos una foto de esta serie; puedes añadir videos. Fotos JPG, PNG o WebP hasta 10 MB; videos MP4, WebM o MOV hasta 25 MB. Máximo 20 archivos. Los archivos quedan privados en Servicio Técnico.</p>
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,.mov" className="inp" disabled={subiendo} onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; archivos(fs) }} />
        <div className="mt-2 space-y-2">{evid.map((e) => <button key={e.id} type="button" className="btn w-full text-left" onClick={() => ver(e)}>{e.mime.startsWith('video/') ? '▶ Video · ' : '📷 Foto · '}{e.nombre} · {(Number(e.tamano) / 1048576).toFixed(1)} MB</button>)}</div>
        <p className="text-xs text-teal-700 mt-2" role="status">{msg}</p></section>
      {c?.historial?.length ? <details className="mt-3"><summary className="text-sm font-bold cursor-pointer">Historial técnico de esta serie ({c.historial.length})</summary>{[...c.historial].reverse().map((e, i) => <div key={i} className="text-xs border-b py-2"><b>{e.estado}</b> · {e.por} · {dhora(e.fecha)}<p>{e.diagnostico || e.falla}</p><p>{e.trabajo}</p><p>{e.pruebas}</p></div>)}</details> : null}
      <p className="text-xs text-slate-500 mt-3">Este registro conserva el historial por serie. El alta, disponibilidad y traslado de stock siguen a cargo de Bodega.</p>
      {err && <p className="text-sm text-red-700 mt-2" role="alert">{err}</p>}
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" disabled={subiendo || ocupado} onClick={guardar}>{ocupado ? <Spin /> : 'Guardar seguimiento'}</button></div></Hoja>
  )
}
