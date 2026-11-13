import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlarmClock, Bell, BellRing, BadgeDollarSign, CalendarClock, CalendarPlus, Calendar, CircleDot, CirclePlus,
  ClipboardPlus, Contact, Copy, FilePlus2, FileText, Handshake, Hourglass, IdCard, ImagePlus, KanbanSquare, Lock,
  Magnet, Mail, MapPin, Menu, MessageCircle, MessageSquareText, Phone, PhoneCall, PhoneMissed, Plus, Receipt, RefreshCw,
  Repeat, Search, Settings, Settings2, SlidersHorizontal, Sparkles, Trash2, Trophy, TriangleAlert, User, UserPlus, UserRound,
  Users, UserX, Wallet, X, CircleX, Pencil, Megaphone, Building2,
} from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { ClientesLista, Papelera, ConfirmarEliminar } from './CrmClientes'
import RutasViaticos from './RutasViaticos'
import CrmDocumento, { type Origen, type InfoGuardado } from './CrmDocumento'
import { ProformaVisor, enriquecerItems, type DatosDoc } from '../proforma'
import {
  ActividadReciente, CampoCaptura, DetalleEstado, EditorEtapas, FormEtapa, NotaConEvidencia, cargarActividad, esMovil, esNegociacion,
  estadoConIntento, leerVisto, subirCaptura, tipoObservacion, type GestionRef, type ModoEtapa,
} from './CrmEtapas'
import { FichaCliente } from './Clientes'
import { EditorDatosEmpresa, RepartoMeta } from './CrmMeta'
import CrmMensajes from './CrmMensajes'
import '../estilos/crm-original.css'
import '../estilos/clientes.css'

/* ============================ Tipos y datos ============================ */
type Etapa = { nombre: string; orden: number; es_final: boolean }
type Asesor = { id: string; nombre: string }
type Gestion = {
  key: string; tabla: 'leads' | 'cotizaciones'; id: string; codigo: string; tipo: string; nombre: string; estado: string
  asesorId: string | null; fechaTS: number; ultimaTS: number; proximoTS: number; total: number
  telefono: string; email: string; identificacion: string; pdfUrl: string; medio: string; interes: string; clienteId: string | null; conversacionId: string | null
}
type PasoEtapa = { g: GestionRef; modo: ModoEtapa; destino: string; titulo?: string; boton?: string; ayuda?: string }
const refDe = (g: Gestion): GestionRef => ({ tabla: g.tabla, id: g.id, nombre: g.nombre, estado: g.estado, total: g.total })
type Interaccion = { id: string; fecha: string; tipo: string; nota: string | null; usuario_texto: string | null }

const COLOR_ESTADO: Record<string, string> = {
  Nuevo: '#17a9ba', Contactado: '#055c9d', Visita: '#7c3aed', 'En Negociación': '#c98a1f', Ganado: '#04896f', Perdido: '#c0392b',
}
const PALETA = ['#17a9ba', '#055c9d', '#7c3aed', '#c98a1f', '#04896f', '#c0392b', '#db2777', '#0891b2', '#65a30d', '#ea580c']
const PAGINA_COLUMNA = 40
const ETAPAS_POR_DEFECTO: Etapa[] = ['Nuevo', 'Contactado', 'Sin Respuesta', 'Seguimiento', 'En Negociación', 'Visita', 'Ganado', 'Perdido']
  .map((nombre, i) => ({ nombre, orden: i + 1, es_final: nombre === 'Ganado' || nombre === 'Perdido' }))

const TIPO_LEAD: Record<string, string> = { contacto: 'Contacto', whatsapp: 'Chat WhatsApp', cita: 'Cita', meta: 'Contacto', web: 'Contacto', otro: 'Contacto' }
const TIPOS_FILTRO = ['ALL', 'Cotización', 'Venta', 'Cita', 'Chat WhatsApp', 'Contacto']
const ETIQUETA_FILTRO: Record<string, string> = { ALL: 'Todos', Cotización: 'Cotizaciones', Venta: 'Ventas', Cita: 'Citas', 'Chat WhatsApp': 'Chat WhatsApp', Contacto: 'Contactos' }

const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ts = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0)
const hace = (t: number) => {
  const h = (Date.now() - t) / 3600000
  if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm'
  if (h < 24) return Math.round(h) + 'h'
  return Math.round(h / 24) + 'd'
}
const haceTexto = (t: number) => {
  if (!t) return ''
  const d = Math.floor((Date.now() - t) / 86400000)
  if (d <= 0) { const h = Math.floor((Date.now() - t) / 3600000); return h <= 0 ? 'hace minutos' : `hace ${h} h` }
  return d === 1 ? 'ayer' : `hace ${d} días`
}
const monto = (n: number) => {
  n = Number(n) || 0
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace('.0', '') + 'M'
  if (n >= 1e4) return '$' + (n / 1e3).toFixed(1).replace('.0', '') + 'k'
  return '$' + n.toLocaleString('es-EC', { maximumFractionDigits: 0 })
}
const dinero2 = (n: number) => '$' + Number(n || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const waLink = (tel: string) => { const d = String(tel || '').replace(/\D/g, ''); return d ? 'https://wa.me/' + (d.startsWith('0') ? '593' + d.slice(1) : d) : '' }
const telLink = (tel: string) => (tel ? 'tel:' + String(tel).replace(/[^\d+]/g, '') : '')

function iconoEstado(estado: string) {
  const e = norm(estado)
  if (/nuev/.test(e)) return Sparkles
  if (/sin resp|no resp|contest|atiend|sin contacto|no contact/.test(e)) return PhoneMissed
  if (/contact|llamad/.test(e)) return Phone
  if (/visit|cita/.test(e)) return MapPin
  if (/negoc/.test(e)) return Handshake
  if (/cotiz|propuest|proforma/.test(e)) return FileText
  if (/seguim|intento/.test(e)) return Repeat
  if (/gan|venta|cerrad/.test(e)) return Trophy
  if (/perd|descart|rechaz/.test(e)) return CircleX
  if (/espera|pend/.test(e)) return Hourglass
  return CircleDot
}
const iconoTipo = (t: string) => (t === 'Venta' ? Receipt : t === 'Cotización' ? FileText : t === 'Chat WhatsApp' ? MessageCircle : t === 'Contacto' ? UserPlus : Calendar)

const abandonado = (g: Gestion) => g.estado === 'Nuevo' && g.fechaTS > 0 && Date.now() - g.fechaTS > 24 * 3600000
const vencido = (g: Gestion) => g.estado !== 'Nuevo' && g.proximoTS > 0 && g.proximoTS < Date.now() && g.estado !== 'Ganado' && g.estado !== 'Perdido'

/* ============================ Pantalla principal ============================ */
export default function Crm({ perfil, aviso, empresa = 'VIMEDIC', accion, limpiarAccion }: { perfil: Perfil; aviso: (t: string) => void; empresa?: 'VIMEDIC' | 'FEMEDICS'; accion?: string | null; limpiarAccion?: () => void }) {
  const mod = empresa === 'FEMEDICS' ? 'femedics' : 'crm'
  const nombreCrm = empresa === 'FEMEDICS' ? 'Femedics CRM' : 'CRM Vimedic'
  const [etapas, setEtapas] = useState<Etapa[]>(ETAPAS_POR_DEFECTO)
  const [asesores, setAsesores] = useState<Asesor[]>([])
  const [gestiones, setGestiones] = useState<Gestion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState('ALL')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [panelFiltros, setPanelFiltros] = useState(false)
  const [menuMovil, setMenuMovil] = useState(false)
  const [panelAlertas, setPanelAlertas] = useState(false)
  const [soloAlertas, setSoloAlertas] = useState<Set<string>>(new Set())
  const [limites, setLimites] = useState<Record<string, number>>({})
  const [etapaMovil, setEtapaMovil] = useState(0)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [nueva, setNueva] = useState(false)
  const [proforma, setProforma] = useState<DatosDoc | null>(null)
  const [clientes, setClientes] = useState(false)
  const [papelera, setPapelera] = useState(false)
  const [rutasViaticos, setRutasViaticos] = useState(false)
  const [documento, setDocumento] = useState<{ modo: 'Cotización' | 'Venta'; origen: Origen; editar?: Record<string, any> | null; items?: Record<string, any>[] } | null>(() => { // eslint-disable-line @typescript-eslint/no-explicit-any
    // Viene del cotizador de Inventario: abre «Nueva cotización» con los productos ya cargados.
    try { const j = sessionStorage.getItem('vm_cot_pendiente'); if (j && empresa === 'VIMEDIC') { sessionStorage.removeItem('vm_cot_pendiente'); return { modo: 'Cotización', origen: null, items: JSON.parse(j) } } } catch { /* sin almacenamiento */ }
    return null
  }) // eslint-disable-line @typescript-eslint/no-explicit-any
  const [mover, setMover] = useState<{ key: string; x: number; y: number } | null>(null)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [clienteNuevo, setClienteNuevo] = useState(false)
  const [paso, setPaso] = useState<PasoEtapa | null>(null)
  const [pasoTrasProforma, setPasoTrasProforma] = useState<PasoEtapa | null>(null)
  const [editorEtapas, setEditorEtapas] = useState(false)
  const [versionEtapas, setVersionEtapas] = useState(0)
  const [actividad, setActividad] = useState(false)
  const [nuevasActividad, setNuevasActividad] = useState(0)
  const [verComo, setVerComo] = useState('')
  const [fichaCliente, setFichaCliente] = useState<string | null>(null)
  const [repartoMeta, setRepartoMeta] = useState(false)
  const [mensajes, setMensajes] = useState<{ conversacion: string | null } | null>(null)
  const [datosEmpresa, setDatosEmpresa] = useState(false)
  const peticion = useRef(0)

  // Acceso directo de la barra lateral (Rail): abre de una vez el formulario pedido.
  useEffect(() => {
    if (!accion || empresa !== 'VIMEDIC') return
    if (accion === 'gestion') setNueva(true)
    else if (accion === 'cotizacion') setDocumento({ modo: 'Cotización', origen: null })
    else if (accion === 'venta') setDocumento({ modo: 'Venta', origen: null })
    else if (accion === 'cliente') { setClienteNuevo(true); setClientes(true) }
    else if (accion === 'seguimientos') setPanelAlertas(true)
    else if (accion === 'mensajes') setMensajes({ conversacion: null })
    limpiarAccion?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accion])

  const crear = puede(perfil, mod, 'crear')
  const eliminar = puede(perfil, mod, 'eliminar')
  const adminEtapas = perfil.es_superadmin || puede(perfil, 'crm', 'administrar') || puede(perfil, 'marketing', 'administrar')
  const veTodos = puede(perfil, mod, 'ver_todos')
  // Reparto de leads de Meta: Marketing / administración (en el original, solo el rol Marketing).
  const puedeMeta = perfil.es_superadmin || puede(perfil, 'marketing', 'editar') || puede(perfil, 'crm', 'administrar') || puede(perfil, 'femedics', 'administrar')
  const puedeDatosEmpresa = perfil.es_superadmin || puede(perfil, empresa === 'FEMEDICS' ? 'femedics' : 'crm', 'administrar')
  const nombres = useMemo(() => new Map(asesores.map((a) => [a.id, a.nombre])), [asesores])
  const estados = etapas.map((e) => e.nombre)
  const colorEstado = (e: string) => COLOR_ESTADO[e] ?? PALETA[Math.max(0, estados.indexOf(e)) % PALETA.length]

  const cargar = useCallback(async () => {
    const n = ++peticion.current
    setCargando(true)
    const [l, c] = await Promise.all([
      supabase.from('leads')
        .select('id,codigo,origen_tipo,fecha,nombre,telefono,email,identificacion,interes,medio_captacion,asesor_id,estado_crm,ultima_actividad,proximo_seguimiento,cliente_id,conversacion_id')
        .is('deleted_at', null).eq('empresa', empresa).order('fecha', { ascending: false }).limit(2000),
      supabase.from('cotizaciones')
        .select('id,codigo,fecha,tipo_registro,nombre,telefono,email,identificacion,asesor_id,estado_crm,ultima_actividad,proximo_seguimiento,total,pdf_url,lead_id,medio_captacion_lead,detalle_equipos,cliente_id')
        .is('deleted_at', null).eq('empresa', empresa).neq('tipo_registro', 'Histórico').order('fecha', { ascending: false }).limit(2000),
    ])
    if (n !== peticion.current) return
    if (l.error || c.error) { setError('No se pudo cargar el CRM: ' + (l.error?.message || c.error?.message)); setCargando(false); return }
    setError('')
    const cots = (c.data ?? []) as Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
    const conCotizacion = new Set(cots.map((x) => x.lead_id).filter(Boolean))
    const deCot: Gestion[] = cots.map((x) => ({
      key: 'cotizaciones:' + x.id, tabla: 'cotizaciones', id: x.id, codigo: x.codigo ?? '', tipo: x.tipo_registro === 'Venta' ? 'Venta' : 'Cotización',
      nombre: x.nombre ?? '', estado: x.estado_crm || 'Nuevo', asesorId: x.asesor_id, fechaTS: ts(x.fecha), ultimaTS: ts(x.ultima_actividad),
      proximoTS: ts(x.proximo_seguimiento), total: Number(x.total) || 0, telefono: x.telefono ?? '', email: x.email ?? '',
      identificacion: x.identificacion ?? '', pdfUrl: x.pdf_url ?? '', medio: x.medio_captacion_lead ?? '', interes: x.detalle_equipos ?? '', clienteId: x.cliente_id ?? null, conversacionId: null,
    }))
    const deLead: Gestion[] = ((l.data ?? []) as Record<string, any>[]) // eslint-disable-line @typescript-eslint/no-explicit-any
      .filter((x) => !conCotizacion.has(x.id))
      .map((x) => ({
        key: 'leads:' + x.id, tabla: 'leads', id: x.id, codigo: x.codigo ?? '', tipo: TIPO_LEAD[x.origen_tipo] ?? 'Contacto',
        nombre: x.nombre ?? '', estado: x.estado_crm || 'Nuevo', asesorId: x.asesor_id, fechaTS: ts(x.fecha), ultimaTS: ts(x.ultima_actividad),
        proximoTS: ts(x.proximo_seguimiento), total: 0, telefono: x.telefono ?? '', email: x.email ?? '', identificacion: x.identificacion ?? '',
        pdfUrl: '', medio: x.medio_captacion ?? '', interes: x.interes ?? '', clienteId: x.cliente_id ?? null, conversacionId: x.conversacion_id ?? null,
      }))
    setGestiones([...deLead, ...deCot])
    setCargando(false)
    try {
      const k = sessionStorage.getItem('vm_crm_abrir')
      if (k && [...deLead, ...deCot].some((g) => g.key === k)) { sessionStorage.removeItem('vm_crm_abrir'); setAbierta(k) }
    } catch { /* sin almacenamiento */ }
  }, [])

  useEffect(() => {
    supabase.from('etapas_pipeline').select('nombre,orden,es_final').is('deleted_at', null).order('orden')
      .then(({ data }) => { if (data?.length) setEtapas(data as Etapa[]) })
  }, [versionEtapas])
  useEffect(() => {
    supabase.from('v_directorio_empleados').select('id,nombre').order('nombre')
      .then(({ data }) => setAsesores((data as Asesor[]) ?? []))
    // Campana de actividad: cuántas novedades hay desde la última vez que se abrió.
    const visto = leerVisto(empresa)
    cargarActividad(empresa, 60, visto ? new Date(visto).toISOString() : new Date(Date.now() - 86400000).toISOString()).then((l) => setNuevasActividad(l.length))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => {
    const canal = supabase.channel('crm-gestiones-' + empresa)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => cargar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cotizaciones' }, () => cargar())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [cargar])
  useEffect(() => {
    const f = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('#vmFiltrosWrap,#vmMovePanel,.vm-card-move')) { setPanelFiltros(false); setMover(null) } }
    document.addEventListener('click', f)
    return () => document.removeEventListener('click', f)
  }, [])
  useEffect(() => { document.body.classList.toggle('vm-moving', !!mover); return () => document.body.classList.remove('vm-moving') }, [mover])

  const filtradas = useMemo(() => {
    const q = norm(texto).trim()
    const d = desde ? new Date(desde + 'T00:00:00').getTime() : 0
    const h = hasta ? new Date(hasta + 'T23:59:59').getTime() : 0
    return gestiones.filter((g) => {
      if (verComo && (verComo === '__sin' ? !!g.asesorId : g.asesorId !== verComo)) return false
      if (tipo !== 'ALL' && g.tipo !== tipo) return false
      if (d && g.fechaTS < d) return false
      if (h && g.fechaTS > h) return false
      if (!q) return true
      const campo = norm([g.nombre, g.email, g.telefono, nombres.get(g.asesorId ?? '') ?? '', g.codigo, g.identificacion, g.interes].join(' '))
      return q.split(/\s+/).every((p) => campo.includes(p))
    })
  }, [gestiones, texto, tipo, desde, hasta, nombres, verComo])

  const alertaDesde = (g: Gestion): number | null => (abandonado(g) ? g.fechaTS : vencido(g) ? g.proximoTS : null)
  const grupos = useMemo(() => {
    const m = new Map<string, Gestion[]>(estados.map((e) => [e, []]))
    filtradas.forEach((g) => { const e = m.has(g.estado) ? g.estado : null; if (e) m.get(e)!.push(g) })
    const reciente = (g: Gestion) => g.fechaTS || g.ultimaTS
    m.forEach((items, e) => {
      if (soloAlertas.has(e)) {
        const conAlerta = items.map((g) => ({ g, t: alertaDesde(g) })).filter((x) => x.t != null)
        conAlerta.sort((a, b) => a.t! - b.t!)
        m.set(e, conAlerta.map((x) => x.g))
      } else m.set(e, items.slice().sort((a, b) => reciente(b) - reciente(a)))
    })
    return m
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtradas, etapas, soloAlertas])
  const conteoAlertas = (e: string) => filtradas.filter((g) => g.estado === e && alertaDesde(g) != null).length

  /* ---- Indicadores (mismos que la app original) ---- */
  const kpis = useMemo(() => {
    const ahora = Date.now(), d = new Date()
    const hoy = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), manana = hoy + 86400000
    const mes = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    const cerrado = (g: Gestion) => g.estado === 'Ganado' || g.estado === 'Perdido'
    const abiertos = filtradas.filter((g) => !cerrado(g))
    const cierre = (g: Gestion) => g.ultimaTS || g.fechaTS
    const ventasHoy = filtradas.filter((g) => g.estado === 'Ganado' && cierre(g) >= hoy)
    const ventasMes = filtradas.filter((g) => g.estado === 'Ganado' && cierre(g) >= mes)
    const suma = (a: Gestion[]) => a.reduce((t, g) => t + g.total, 0)
    const atencion = abiertos.filter((g) => (ahora - g.ultimaTS) / 86400000 >= 3).length
    const nuevosHoy = filtradas.filter((g) => g.fechaTS >= hoy).length
    const sinAsesor = abiertos.filter((g) => !g.asesorId).length
    const visitasMes = filtradas.filter((g) => (g.tipo === 'Cita' || g.estado === 'Visita') && Math.max(g.fechaTS, g.ultimaTS) >= mes).length
    void manana
    return [
      { label: 'Ventas hoy', value: monto(suma(ventasHoy)), extra: ventasHoy.length + ' cierre' + (ventasHoy.length === 1 ? '' : 's'), icon: BadgeDollarSign, color: '#04896f', destacado: true, alerta: false },
      { label: 'Requieren atención', value: String(atencion), extra: '+3 días sin actividad', icon: BellRing, color: 'var(--red)', alerta: atencion > 0, destacado: false },
      { label: 'Ventas del mes', value: monto(suma(ventasMes)), extra: ventasMes.length + ' cierres', icon: Trophy, color: 'var(--teal)', alerta: false, destacado: false },
      { label: 'Gestiones hoy', value: String(nuevosHoy), extra: 'creadas hoy', icon: ClipboardPlus, color: 'var(--primary)', alerta: false, destacado: false },
      { label: 'Visitas del mes', value: String(visitasMes), extra: 'citas y etapa Visita', icon: MapPin, color: '#7c3aed', alerta: false, destacado: false },
      ...(sinAsesor ? [{ label: 'Sin asesor', value: String(sinAsesor), extra: '', icon: UserX, color: '#c0392b', alerta: true, destacado: false }] : []),
    ]
  }, [filtradas])
  const pendientes = useMemo(() => filtradas.filter((g) => g.estado !== 'Ganado' && g.estado !== 'Perdido' && (Date.now() - g.ultimaTS) / 86400000 >= 3), [filtradas])

  /* ---- Cambiar de etapa: mismas reglas que arrastrar en la app original ----
     Ganado abre la venta; Contactado / Sin respuesta / Seguimiento / Negociación /
     Visita / Perdido piden sus datos antes de mover; Perdido no se permite desde Nuevo;
     "En Negociación" de un contacto sin proforma abre además la cotización. */
  async function cambiarEstado(key: string, nuevo: string) {
    const g = gestiones.find((x) => x.key === key)
    if (!g || g.estado === nuevo) return
    if (g.estado === 'Ganado') { aviso('Esta gestión ya está en Ganado y pasó a facturación: no se puede mover de columna.'); return }
    if (nuevo === 'Ganado') { abrirVenta(g); return }
    if (nuevo === 'Perdido' && (g.estado || 'Nuevo') === 'Nuevo') { aviso('Aún no se puede marcar como Perdido: primero realiza y registra al menos una gestión (Contactado, Sin respuesta, etc.).'); return }
    const conDatos = (modo: ModoEtapa) => { setAbierta(null); setPaso({ g: refDe(g), modo, destino: nuevo }) }
    if (nuevo === 'Contactado') return conDatos('contactado')
    if (nuevo === 'Perdido') return conDatos('perdido')
    if (nuevo === 'Visita') return conDatos('visita')
    if (tipoObservacion(nuevo)) return conDatos('observacion')
    if (esNegociacion(nuevo) && (g.tipo === 'Cotización' || g.tipo === 'Venta')) return conDatos('negociacion')
    const antes = gestiones
    setGestiones((a) => a.map((x) => (x.key === key ? { ...x, estado: nuevo, ultimaTS: Date.now() } : x)))
    const { error } = await supabase.rpc('crm_cambiar_estado', { p_tabla: g.tabla, p_id: g.id, p_estado: nuevo })
    if (error) { setGestiones(antes); aviso('No se pudo mover: ' + error.message); return }
    if (esNegociacion(nuevo) && g.tabla === 'leads') cotizarDesde(g)
  }
  /* El formulario de la etapa ya guardó en la base: la tarjeta se mueve sin esperar la recarga. */
  function pasoGuardado(p: PasoEtapa, proximoISO: string | null) {
    const key = p.g.tabla + ':' + p.g.id
    setGestiones((a) => a.map((x) => (x.key === key ? { ...x, estado: p.modo === 'registro' ? x.estado : p.destino, ultimaTS: Date.now(), proximoTS: proximoISO ? new Date(proximoISO).getTime() : x.proximoTS } : x)))
    setPaso(null)
    aviso(p.modo === 'registro' ? 'Seguimiento registrado.' : 'Movida a ' + p.destino + '.')
    cargar()
  }
  const nuevoIntento = (g: Gestion) => setPaso({ g: refDe(g), modo: 'registro', destino: g.estado, titulo: 'Nuevo intento · ' + g.estado, boton: 'Guardar intento' })
  async function abrirFichaCliente(g: Gestion) {
    let id = g.clienteId
    if (!id && g.identificacion) {
      const { data } = await supabase.from('clientes').select('id').eq('identificacion', g.identificacion).eq('empresa', empresa).is('deleted_at', null).limit(1).maybeSingle()
      id = (data as { id: string } | null)?.id ?? null
    }
    setAbierta(null)
    if (id) setFichaCliente(id); else { aviso('Esta gestión todavía no tiene un cliente registrado: búscalo o créalo en Clientes.'); setClientes(true) }
  }
  async function duplicar(g: Gestion) {
    const { data, error } = await supabase.from('cotizaciones').select('items').eq('id', g.id).single()
    const items = ((data as { items?: Record<string, any>[] } | null)?.items ?? []) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (error || !items.length) { aviso('Esta gestión no tiene productos para duplicar.'); return }
    setAbierta(null)
    setDocumento({ modo: 'Cotización', origen: null, items: await enriquecerItems(items as never) as never })
    aviso(items.length + ' producto(s) cargados en una cotización nueva. Elige el cliente para continuar.')
  }

  function abrirVenta(g: Gestion) { setAbierta(null); setDocumento({ modo: 'Venta', origen: { tabla: g.tabla, id: g.id, codigo: g.codigo, nombre: g.nombre, telefono: g.telefono, email: g.email, identificacion: g.identificacion, medio: g.medio } }) }
  function cotizarDesde(g: Gestion) { setAbierta(null); setDocumento({ modo: 'Cotización', origen: { tabla: g.tabla, id: g.id, codigo: g.codigo, nombre: g.nombre, telefono: g.telefono, email: g.email, identificacion: g.identificacion, medio: g.medio } }) }

  const columnaActiva = typeof window !== 'undefined' && window.innerWidth < 640

  return (
    <div>
      <div id="refreshBar" className={cargando ? 'fixed top-0 left-0 right-0 h-[3px] z-[200] overflow-hidden' : 'hidden'} style={{ background: 'rgba(5,92,157,.12)' }}>
        <div style={{ height: '100%', width: '40%', background: 'linear-gradient(90deg,var(--cyan),var(--primary))', animation: 'refreshBarSlide 1s ease-in-out infinite' }} />
      </div>

      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-slate-200" style={{ background: 'linear-gradient(135deg, var(--navy), var(--primary))' }}>
        <div className="vm-head-pad w-full px-4 sm:pr-5 min-h-14 flex items-center justify-between gap-3 flex-wrap py-1.5">
          <div className="flex sm:hidden items-center justify-between w-full py-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); setActividad(false); setPanelAlertas((v) => !v) }} className="relative bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition-colors" title="Seguimientos pendientes">
              <AlarmClock className="w-5 h-5" />
              {pendientes.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{pendientes.length}</span>}
            </button>
            <span className="text-white font-display font-bold text-sm">{nombreCrm}</span>
            <button onClick={() => setMenuMovil((v) => !v)} className="relative bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition-colors" title="Menú"><Menu className="w-5 h-5" /></button>
          </div>

          <div className="hidden sm:block min-w-0 shrink-0 max-w-[260px]">
            <h1 className="font-display font-bold text-white text-base leading-tight">{nombreCrm}</h1>
            <p className="text-[11px] text-white/60 truncate">{perfil.nombre}</p>
          </div>

          <div className="hidden sm:flex items-center gap-2 ml-2">
            <div className="relative">
              <input type="text" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar nombre, cédula, Nº cotización o equipo..."
                className="pl-8 pr-3 py-2 rounded-lg bg-white/10 text-white placeholder:text-white/50 text-xs w-56 xl:w-72 focus:outline-none focus:ring-2 focus:ring-white/40" />
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/60" />
            </div>
            <div className="relative" id="vmFiltrosWrap">
              <button type="button" onClick={(e) => { e.stopPropagation(); setPanelFiltros((v) => !v) }} className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors">
                <SlidersHorizontal className="w-3.5 h-3.5" /><span>Filtros</span>
                {(tipo !== 'ALL' || desde || hasta || verComo) && <span className="bg-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center" style={{ color: 'var(--primary)' }}>{(tipo !== 'ALL' ? 1 : 0) + (desde || hasta ? 1 : 0) + (verComo ? 1 : 0)}</span>}
              </button>
              {panelFiltros && (
                <div className="absolute left-0 top-full mt-2 w-[340px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 z-50" onClick={(e) => e.stopPropagation()}>
                  <p className="text-[10px] font-mono-spec uppercase text-slate-400 font-semibold mb-2">Tipo de gestión</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {TIPOS_FILTRO.map((t) => (
                      <button key={t} className={'tab-btn btn-filter text-[11px] font-semibold px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600' + (tipo === t ? ' active' : '')} onClick={() => setTipo(t)}>{ETIQUETA_FILTRO[t]}</button>
                    ))}
                  </div>
                  <p className="text-[10px] font-mono-spec uppercase text-slate-400 font-semibold mb-2">Fecha de creación</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] font-semibold text-slate-500">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-full mt-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--cyan)' }} /></label>
                    <label className="text-[10px] font-semibold text-slate-500">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-full mt-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--cyan)' }} /></label>
                  </div>
                  {veTodos && (
                    <>
                      <p className="text-[10px] font-mono-spec uppercase text-slate-400 font-semibold mb-2 mt-3">Ver como asesor</p>
                      <select value={verComo} onChange={(e) => setVerComo(e.target.value)} className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--cyan)' }}>
                        <option value="">Todos los asesores</option>
                        <option value="__sin">Sin asesor asignado</option>
                        {asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                      </select>
                    </>
                  )}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                    <button type="button" onClick={() => { setTipo('ALL'); setDesde(''); setHasta(''); setVerComo('') }} className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 underline">Limpiar todo</button>
                    <button type="button" onClick={() => setPanelFiltros(false)} className="text-xs font-bold text-white px-3 py-1.5 rounded-lg" style={{ background: 'var(--primary)' }}>Listo</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 ml-2">
            {crear && <button type="button" onClick={() => setNueva(true)} className="vm-hqa" title="Nueva gestión"><CirclePlus /><span>Nueva gestión</span></button>}
            {crear && <button type="button" onClick={() => setDocumento({ modo: 'Cotización', origen: null })} className="vm-hqa" title="Nueva cotización"><FilePlus2 /><span>Cotización</span></button>}
            {crear && <button type="button" onClick={() => setDocumento({ modo: 'Venta', origen: null })} className="vm-hqa" title="Nueva venta"><Receipt /><span>Venta</span></button>}
            <button type="button" onClick={() => setMensajes({ conversacion: null })} className="vm-hqa" title="Mensajes (Facebook, Instagram, WhatsApp)"><MessageCircle /><span>Mensajes</span></button>
            <button type="button" onClick={() => setClientes(true)} className="vm-hqa" title="Clientes"><Users /><span>Clientes</span></button>
            <button type="button" onClick={() => setRutasViaticos(true)} className="vm-hqa" title="Rutas y viáticos"><MapPin /><span>Rutas y viáticos</span></button>
            {eliminar && <button type="button" onClick={() => setPapelera(true)} className="vm-hqa" title="Papelera"><Trash2 /><span>Papelera</span></button>}
          </div>

          <div className="hidden sm:flex items-center gap-2 ml-auto">
            {puedeMeta && <button onClick={() => setRepartoMeta(true)} className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition-colors" title="Clientes potenciales de Meta (reparto)"><Megaphone className="w-4 h-4" /></button>}
            {puedeDatosEmpresa && empresa === 'FEMEDICS' && <button onClick={() => setDatosEmpresa(true)} className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition-colors" title="Datos de FEMEDICS (remitente de la guía)"><Building2 className="w-4 h-4" /></button>}
            {adminEtapas && <button onClick={() => setEditorEtapas(true)} className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition-colors" title="Administrar etapas del pipeline"><Settings className="w-4 h-4" /></button>}
            <button type="button" onClick={(e) => { e.stopPropagation(); setPanelAlertas(false); setActividad((v) => !v); setNuevasActividad(0) }} className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition-colors relative" title="Actividad reciente">
              <Bell className="w-4 h-4" />
              {nuevasActividad > 0 && <span className="absolute -top-1 -right-1 bg-cyan-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center" style={{ background: 'var(--cyan)' }}>{nuevasActividad > 9 ? '9+' : nuevasActividad}</span>}
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setActividad(false); setPanelAlertas((v) => !v) }} className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition-colors relative" title="Seguimientos pendientes">
              <AlarmClock className="w-4 h-4" />
              {pendientes.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{pendientes.length}</span>}
            </button>
            <button onClick={() => cargar()} className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition-colors" title="Sincronizar"><RefreshCw className={'w-4 h-4 ' + (cargando ? 'animate-spin' : '')} /></button>
          </div>
        </div>

        {menuMovil && (
          <div className="sm:hidden bg-white border-t border-slate-200 shadow-xl">
            <div className="px-3 py-2 border-b border-slate-100">
              <div className="relative">
                <input type="text" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar nombre, cédula, Nº cotización o equipo..."
                  className="pl-8 pr-3 py-2.5 rounded-lg bg-slate-100 text-slate-800 placeholder:text-slate-400 text-xs w-full focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--primary)' }} />
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
            <div className="py-1.5 vm-mgrid">
              {crear && <button onClick={() => { setMenuMovil(false); setNueva(true) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 text-left"><CirclePlus className="w-4 h-4" style={{ color: 'var(--primary)' }} /> Nueva Gestión</button>}
              {crear && <button onClick={() => { setMenuMovil(false); setDocumento({ modo: 'Cotización', origen: null }) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 text-left"><FilePlus2 className="w-4 h-4" style={{ color: 'var(--teal)' }} /> Nueva Cotización</button>}
              {crear && <button onClick={() => { setMenuMovil(false); setDocumento({ modo: 'Venta', origen: null }) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 text-left"><Receipt className="w-4 h-4" style={{ color: '#04896f' }} /> Nueva Venta</button>}
              <button onClick={() => { setMenuMovil(false); setClientes(true) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 text-left"><Users className="w-4 h-4 text-slate-500"  /> Clientes</button>
              <button onClick={() => { setMenuMovil(false); setRutasViaticos(true) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 text-left"><MapPin className="w-4 h-4 text-slate-500"  /> Rutas y viáticos</button>
              <button onClick={() => { setMenuMovil(false); setMensajes({ conversacion: null }) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 text-left"><MessageCircle className="w-4 h-4 text-slate-500"  /> Mensajes</button>
              {eliminar && <button onClick={() => { setMenuMovil(false); setPapelera(true) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 text-left"><Trash2 className="w-4 h-4 text-slate-500"  /> Papelera</button>}
              <div className="border-t border-slate-100 my-1.5" />
              <button onClick={() => { setMenuMovil(false); setPanelAlertas(false); setActividad(true); setNuevasActividad(0) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 text-left"><Bell className="w-4 h-4 text-slate-500" /> Actividad reciente{nuevasActividad > 0 ? ` (${nuevasActividad})` : ''}</button>
              {puedeMeta && <button onClick={() => { setMenuMovil(false); setRepartoMeta(true) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 text-left"><Megaphone className="w-4 h-4 text-slate-500" /> Leads de Meta (reparto)</button>}
              {puedeDatosEmpresa && empresa === 'FEMEDICS' && <button onClick={() => { setMenuMovil(false); setDatosEmpresa(true) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 text-left"><Building2 className="w-4 h-4 text-slate-500" /> Datos de FEMEDICS</button>}
              {adminEtapas && <button onClick={() => { setMenuMovil(false); setEditorEtapas(true) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 text-left"><Settings className="w-4 h-4 text-slate-500"  /> Administrar etapas</button>}
              <button onClick={() => { setMenuMovil(false); cargar() }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 text-left"><RefreshCw className="w-4 h-4 text-slate-500" /> Actualizar</button>
            </div>
          </div>
        )}
      </header>

      {/* PANEL DE ALERTAS */}
      {panelAlertas && (
        <div id="vmAlertPanel" role="dialog" aria-label="Seguimientos pendientes">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: '#c0392b1A', color: 'var(--red)' }}><AlarmClock className="w-4 h-4" /></span>
            <div className="min-w-0"><h4 className="font-display font-bold text-sm text-slate-800">Requieren seguimiento</h4><p className="text-[10px] text-slate-400">3 días o más sin actividad</p></div>
            <span className="pill text-white ml-auto" style={{ background: 'var(--red)' }}>{pendientes.length}</span>
            <button type="button" onClick={() => setPanelAlertas(false)} className="text-slate-400 hover:text-slate-700" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-3 space-y-2 overflow-y-auto">
            {pendientes.length === 0 && <p className="text-xs text-slate-400 text-center py-6">Todo al día 🎉</p>}
            {pendientes.slice(0, 50).map((g) => (
              <button key={g.key} type="button" className="w-full text-left bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 shadow-sm" onClick={() => { setPanelAlertas(false); setAbierta(g.key) }}>
                <p className="font-display font-bold text-xs text-slate-800 truncate">{g.nombre || 'Sin nombre'}</p>
                <p className="text-[10px] text-slate-500 truncate">{g.estado} · {nombres.get(g.asesorId ?? '') ?? 'Sin asignar'} · {hace(g.ultimaTS)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <main className="w-full px-3 sm:pr-5 py-4">
        {/* Accesos rápidos (móvil) */}
        {crear && (
          <div className="vm-mobile-quick sm:hidden grid grid-cols-2 gap-2.5 mb-4">
            <button type="button" onClick={() => setNueva(true)} className="bg-white rounded-2xl border border-slate-200 p-3.5 flex flex-col items-center gap-2 shadow-sm active:scale-95 transition-transform">
              <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: '#055c9d1A', color: '#055c9d' }}><CirclePlus className="w-5 h-5" /></div>
              <span className="text-[11px] font-bold text-slate-700 text-center leading-tight">Nueva Gestión</span>
            </button>
          </div>
        )}

        {/* KPIs */}
        <div className="vm-kpis mb-3">
          {kpis.map((c) => {
            const I = c.icon
            return (
              <div key={c.label} className={'stat-card vm-kpi ' + (c.alerta ? 'alerta ' : '') + (c.destacado ? 'vm-kpi-top' : '')} style={{ ['--c' as string]: c.color }} title={c.label + (c.extra ? ' · ' + c.extra : '')}>
                <I /><span>{c.label}</span><b>{c.value}</b>{c.extra && <em>{c.extra}</em>}
              </div>
            )
          })}
        </div>

        {/* KANBAN */}
        <div>
          <div className="vm-pipe-title flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-display font-bold text-sm text-slate-800 flex items-center gap-2"><KanbanSquare className="w-4 h-4" style={{ color: 'var(--primary)' }} /> Pipeline de Leads</h2>
            <div className="hidden sm:flex gap-2 flex-wrap items-center">
              {crear && <button type="button" onClick={() => setNueva(true)} className="vm-qa" style={{ ['--c' as string]: 'var(--primary)' }}><CirclePlus />Nueva gestión</button>}
              {crear && <button type="button" onClick={() => setDocumento({ modo: 'Cotización', origen: null })} className="vm-qa" style={{ ['--c' as string]: '#0e7490' }}><FilePlus2 />Cotización</button>}
              {crear && <button type="button" onClick={() => setDocumento({ modo: 'Venta', origen: null })} className="vm-qa" style={{ ['--c' as string]: '#04896f' }}><Receipt />Venta</button>}
              <button type="button" onClick={() => setClientes(true)} className="vm-qa" style={{ ['--c' as string]: 'var(--navy)' }}><Users />Clientes</button>
              {eliminar && <button type="button" onClick={() => setPapelera(true)} className="vm-qa" style={{ ['--c' as string]: '#b91c1c' }}><Trash2 />Papelera</button>}
            </div>
          </div>

          {/* Pestañas de etapa (móvil) */}
          <div id="mobileStageTabs" className="sm:hidden">
            <div className="vm-mtgrid" style={{ gridTemplateColumns: `repeat(${estados.length <= 8 ? estados.length : Math.ceil(estados.length / 2)},minmax(0,1fr))` }}>
              {estados.map((e, i) => {
                const n = (grupos.get(e) || []).length
                const I = iconoEstado(e)
                return <button key={e} type="button" title={e} aria-label={`${e} (${n})`} onClick={() => setEtapaMovil(i)} className={'vm-mtic ' + (i === etapaMovil ? 'on ' : '') + (n ? '' : 'vacia')} style={{ ['--c' as string]: colorEstado(e) }}><I />{n ? <b>{n > 99 ? '99+' : n}</b> : null}</button>
              })}
            </div>
            <div className="vm-mtlabel" style={{ ['--c' as string]: colorEstado(estados[etapaMovil] ?? '') }}>
              {estados[etapaMovil]}<span>· {(grupos.get(estados[etapaMovil]) || []).length} gestiones</span><em>{etapaMovil + 1}/{estados.length} · toca para cambiar</em>
            </div>
          </div>

          <div id="kanbanBoard" className="flex gap-2.5 overflow-x-auto pb-3">
            {error && <div className="w-full text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
            {!error && cargando && gestiones.length === 0 && (
              <div className="w-full flex flex-col items-center justify-center py-16 gap-2 text-slate-400">
                <span className="inline-block w-5 h-5 rounded-full border-2 border-slate-300 border-t-[color:var(--primary)] animate-spin" />
                <p className="text-xs font-semibold">Cargando gestiones...</p>
              </div>
            )}
            {(!cargando || gestiones.length > 0) && !error && estados.map((estado, i) => {
              const items = grupos.get(estado) || []
              const limite = limites[estado] || PAGINA_COLUMNA
              const n = conteoAlertas(estado)
              const on = soloAlertas.has(estado)
              return (
                <section key={estado} id={'kanbanCol' + i} className={'kanban-col vm-pipeline-column' + (columnaActiva && i === etapaMovil ? ' vm-activa' : '')} style={{ ['--stage-color' as string]: colorEstado(estado) }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('drag-over') }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.classList.remove('drag-over') }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const k = e.dataTransfer.getData('text/plain'); setArrastrando(null); e.currentTarget.classList.remove('drag-over'); if (k) cambiarEstado(k, estado) }}>
                  <header className="vm-column-heading">
                    <span className="vm-stage-dot" /><h3>{estado}</h3>
                    <button type="button" className={'vm-alert-btn' + (on ? ' on' : '') + (n ? ' has' : '')} aria-pressed={on}
                      title={on ? 'Mostrando solo alertas (más antiguas primero) · toca para ver todas' : n ? `${n} alerta(s) · toca para ver solo alertas` : 'Sin alertas en este estado'}
                      onClick={(e) => { e.stopPropagation(); setSoloAlertas((s) => { const x = new Set(s); if (x.has(estado)) x.delete(estado); else x.add(estado); return x }) }}>
                      {on ? <BellRing /> : <Bell />}{n ? <b>{n > 99 ? '99+' : n}</b> : null}
                    </button>
                    <span data-kanban-count>{items.length}</span>
                  </header>
                  <div data-kanban-items className="vm-column-list">
                    {on && <div className="vm-alert-note"><BellRing />Solo alertas · de la más antigua a la más reciente</div>}
                    {items.slice(0, limite).map((g) => (
                      <Tarjeta key={g.key} g={g} asesor={nombres.get(g.asesorId ?? '') ?? 'Sin asignar'} color={colorEstado(g.estado)} arrastrando={arrastrando === g.key}
                        abrir={() => setAbierta(g.key)} intento={() => nuevoIntento(g)}
                        iniciarArrastre={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', g.key); setArrastrando(g.key) }}
                        finArrastre={() => setArrastrando(null)}
                        mover={(x, y) => setMover({ key: g.key, x, y })} />
                    ))}
                    {items.length === 0 && <p className="vm-empty-column">{on ? 'Sin alertas en este estado 🎉' : 'Arrastra una gestión aquí'}</p>}
                  </div>
                  <div className="vm-column-footer">
                    {items.length > limite && <button type="button" className="vm-more-cards" onClick={() => setLimites((l) => ({ ...l, [estado]: limite + PAGINA_COLUMNA }))}>Ver más · {items.length - limite} restantes</button>}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      </main>

      {/* Panel "Mover a" */}
      {mover && (() => {
        const g = gestiones.find((x) => x.key === mover.key)
        if (!g) return null
        return (
          <section id="vmMovePanel" aria-label="Mover gestión" role="region" style={{ left: Math.min(mover.x, window.innerWidth - 260), top: Math.min(mover.y, window.innerHeight - 320) }}>
            <div className="vm-move-heading"><div className="min-w-0"><h2>Mover a</h2><p>{g.nombre || 'Gestión'}</p></div><button type="button" className="vm-move-close" onClick={() => setMover(null)} aria-label="Cancelar">✕</button></div>
            <div id="vmMoveCells">
              {estados.map((e, i) => (
                <button key={e} type="button" data-stage-index={i} className={'vm-drop-cell ' + (e === g.estado ? 'vm-current-stage' : '')} style={{ ['--stage-color' as string]: colorEstado(e) }}
                  onClick={() => { setMover(null); cambiarEstado(g.key, e) }}>{e}</button>
              ))}
            </div>
            <p className="vm-move-hint">Selecciona el destino. Ganado abre el formulario de venta.</p>
          </section>
        )
      })()}

      {actividad && <ActividadReciente empresa={empresa} cerrar={() => setActividad(false)} abrir={(k) => { if (gestiones.some((x) => x.key === k)) setAbierta(k); else aviso('Esa gestión ya no está en el pipeline (puede estar en la Papelera o en el histórico).') }} />}

      {abierta && gestiones.find((x) => x.key === abierta) && (() => {
        const ga = gestiones.find((x) => x.key === abierta)!
        return (
          <Ficha g={ga} perfil={perfil} asesores={asesores} etapas={estados} colorEstado={colorEstado}
            cerrar={() => setAbierta(null)} cambiarEstado={cambiarEstado} recargar={cargar} aviso={aviso}
            mod={mod} empresa={empresa} verProforma={setProforma} editarDoc={(row) => { setAbierta(null); setDocumento({ modo: 'Cotización', origen: null, editar: row }) }}
            facturar={() => abrirVenta(ga)} cotizar={() => cotizarDesde(ga)} clientes={() => abrirFichaCliente(ga)}
            seguimiento={() => setPaso({ g: refDe(ga), modo: 'registro', destino: ga.estado, titulo: 'Registrar seguimiento · ' + ga.estado, boton: 'Guardar seguimiento' })}
            duplicar={() => duplicar(ga)} chat={ga.conversacionId ? () => { setAbierta(null); setMensajes({ conversacion: ga.conversacionId }) } : undefined} />
        )
      })()}
      {clientes && <ClientesLista empresa={empresa} perfil={perfil} asesores={asesores} cerrar={() => setClientes(false)} aviso={aviso} abrirNuevo={clienteNuevo} consumirAbrirNuevo={() => setClienteNuevo(false)} />}
      {fichaCliente && <div className="vm-cli"><FichaCliente id={fichaCliente} perfil={perfil} asesores={asesores} cerrar={() => setFichaCliente(null)} aviso={aviso} cambio={cargar} /></div>}
      {papelera && <Papelera empresa={empresa} cerrar={() => setPapelera(false)} alRestaurar={cargar} aviso={aviso} />}
      {rutasViaticos && <RutasViaticos perfil={perfil} cerrar={() => setRutasViaticos(false)} aviso={aviso} />}
      {documento && <CrmDocumento empresa={empresa} editar={documento.editar} itemsIniciales={documento.items} modo={documento.modo} perfil={perfil} asesores={asesores} origen={documento.origen} cerrar={() => setDocumento(null)}
        guardado={(m, doc, info?: InfoGuardado) => {
          setDocumento(null); aviso(m); cargar(); setProforma(doc)
          // Proforma nueva: igual que el original, al cerrar la vista previa se pide registrar el seguimiento (cuándo volver a contactar).
          if (info && info.nuevo && info.modo === 'Cotización') setPasoTrasProforma({ g: { tabla: 'cotizaciones', id: info.id, nombre: info.nombre, estado: 'Seguimiento', total: info.total }, modo: 'registro', destino: 'Seguimiento', titulo: 'Proforma creada · Seguimiento', boton: 'Guardar seguimiento', ayuda: '¿Cómo la enviaste y cuándo vuelves a contactar al cliente? Queda en el historial y avisa cuando toque el próximo intento.' })
        }} />}
      {proforma && <ProformaVisor datos={proforma} cerrar={() => { setProforma(null); if (pasoTrasProforma) { setPaso(pasoTrasProforma); setPasoTrasProforma(null) } }} />}
      {nueva && <NuevaGestion empresa={empresa} perfil={perfil} asesores={asesores} cerrar={() => setNueva(false)} guardado={() => { setNueva(false); aviso('Gestión creada.'); cargar() }} />}
      {paso && <FormEtapa g={paso.g} modo={paso.modo} destino={paso.destino} titulo={paso.titulo} boton={paso.boton} ayuda={paso.ayuda} aviso={aviso} cerrar={() => setPaso(null)} hecho={(p) => pasoGuardado(paso, p)} />}
      {mensajes && <CrmMensajes empresa={empresa} inicial={mensajes.conversacion} aviso={aviso} cerrar={() => setMensajes(null)} />}
      {repartoMeta && <RepartoMeta empresa={empresa} cerrar={() => setRepartoMeta(false)} aviso={aviso} cambio={cargar} />}
      {datosEmpresa && <EditorDatosEmpresa empresa={empresa} cerrar={() => setDatosEmpresa(false)} aviso={aviso} />}
      {editorEtapas && <EditorEtapas etapas={estados} colorEstado={colorEstado} conteo={(e) => gestiones.filter((x) => x.estado === e).length} cerrar={() => setEditorEtapas(false)} guardado={() => { setEditorEtapas(false); setVersionEtapas((v) => v + 1); aviso('Etapas del pipeline guardadas.') }} />}
    </div>
  )
}

/* ============================ Tarjeta del tablero ============================ */
function Tarjeta({ g, asesor, color, arrastrando, abrir, intento: abrirIntento, iniciarArrastre, finArrastre, mover }: {
  g: Gestion; asesor: string; color: string; arrastrando: boolean; abrir: () => void; intento: () => void
  iniciarArrastre: (e: React.DragEvent) => void; finArrastre: () => void; mover: (x: number, y: number) => void
}) {
  const esGanado = g.estado === 'Ganado'
  const venc = vencido(g), aband = abandonado(g)
  const Tipo = iconoTipo(g.tipo)
  // "Nuevo intento": se habilita cuando llega la hora del próximo intento; en Contactado sin fecha, a las 24 h de la última gestión.
  const intento = estadoConIntento(g.estado) && !esGanado && g.estado !== 'Perdido'
  const sinFechaContactado = !g.proximoTS && /contactad/i.test(g.estado)
  const esperaIntento = intento && (sinFechaContactado ? Date.now() - (g.ultimaTS || g.fechaTS) < 86400000 : g.proximoTS > Date.now())
  return (
    <div className={'lead-card vm-lead-card-v2 bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 shadow-sm ' + (venc ? 'vm-vencida ' : '') + (aband ? 'vm-abandonada ' : '') + (arrastrando ? 'dragging' : '')}
      draggable={!esGanado} onDragStart={(e) => { if ((e.target as HTMLElement).closest('button,select,input,a')) { e.preventDefault(); return } iniciarArrastre(e) }} onDragEnd={finArrastre} onClick={abrir}>
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="pill text-[9px] truncate" style={{ background: color + '1A', color }}><Tipo className="w-2.5 h-2.5 inline -mt-0.5" /> {g.tipo}</span>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">{esGanado && <Lock className="w-2.5 h-2.5 inline -mt-0.5" />}{esGanado ? ' ' : ''}{hace(g.fechaTS)}</span>
          {!esGanado && <button type="button" className="vm-card-move" aria-label="Mover gestión" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); mover(r.left, r.bottom + 6) }}>Mover</button>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-1.5">
        <p className="font-display font-bold text-xs text-slate-800 truncate min-w-0">{g.nombre || 'Sin nombre'}</p>
        {g.total > 0 && <span className="vm-card-total shrink-0" title="Total con IVA incluido">{dinero2(g.total)}</span>}
      </div>
      {aband ? <p className="vm-venc-chip vm-aband-chip" title="Más de 24 h en Nuevo sin gestionar"><TriangleAlert />Lead abandonado · {hace(g.fechaTS)}</p>
        : venc ? <p className="vm-venc-chip" title={'Próximo seguimiento: ' + new Date(g.proximoTS).toLocaleString('es-EC')}><AlarmClock />Seguimiento vencido · {hace(g.proximoTS)}</p> : null}
      <div className="flex items-center justify-between gap-1">
        <p className="text-[10px] text-slate-500 truncate min-w-0">{asesor}</p>
        {g.telefono && (
          <div className="vm-card-hover-acts hidden sm:flex" onClick={(e) => e.stopPropagation()}>
            <a href={waLink(g.telefono)} target="_blank" rel="noopener" aria-label="WhatsApp" title="WhatsApp" style={{ ['--c' as string]: '#16a34a' }}><MessageCircle /></a>
            <a href={telLink(g.telefono)} target="_blank" rel="noopener" aria-label="Llamar" title="Llamar" style={{ ['--c' as string]: 'var(--primary)' }}><Phone /></a>
          </div>
        )}
      </div>
      {(g.telefono || (intento && !esperaIntento)) && (
        <div className="vm-mcard-acts sm:hidden">
          {g.telefono && <a href={waLink(g.telefono)} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} style={{ ['--c' as string]: '#16a34a' }}><MessageCircle />WhatsApp</a>}
          {g.telefono && <a href={telLink(g.telefono)} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} style={{ ['--c' as string]: 'var(--primary)' }}><Phone />Llamar</a>}
          {intento && !esperaIntento && <button type="button" onClick={(e) => { e.stopPropagation(); abrirIntento() }} style={{ ['--c' as string]: '#7c3aed' }}><Repeat />Intento</button>}
        </div>
      )}
      {intento && !esperaIntento && <button type="button" className="vm-int-pc" onClick={(e) => { e.stopPropagation(); abrirIntento() }}><Plus />Nuevo intento</button>}
    </div>
  )
}

/* ============================ Ficha lateral de la gestión ============================ */
function Ficha({ g, perfil, asesores, etapas, colorEstado, cerrar, cambiarEstado, recargar, aviso, facturar, cotizar, clientes, verProforma, editarDoc, mod, empresa, seguimiento, duplicar, chat }: {
  mod: string; empresa: 'VIMEDIC' | 'FEMEDICS'; seguimiento: () => void; duplicar: () => void; chat?: () => void
  g: Gestion; perfil: Perfil; asesores: Asesor[]; etapas: string[]; colorEstado: (e: string) => string
  cerrar: () => void; cambiarEstado: (key: string, nuevo: string) => Promise<void>; recargar: () => void; aviso: (t: string) => void; facturar: () => void; cotizar: () => void; clientes: () => void; verProforma: (d: DatosDoc) => void; editarDoc: (row: Record<string, any>) => void // eslint-disable-line @typescript-eslint/no-explicit-any
}) {
  const [versiones, setVersiones] = useState<{ id: string; version: number; fecha: string; usuario_texto: string | null; cambios: string[]; items: Record<string, any>[]; total: number; nota: string | null; cliente: Record<string, string> | null }[] | null>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const [elim, setElim] = useState(false)
  const [historial, setHistorial] = useState<Interaccion[] | null>(null)
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [abierto, setAbierto] = useState(false)
  useEffect(() => { const t = setTimeout(() => setAbierto(true), 10); return () => clearTimeout(t) }, [])
  const campo = g.tabla === 'leads' ? 'lead_id' : 'cotizacion_id'
  const [comprobante, setComprobante] = useState<{ ruta: string; url: string } | null>(null)
  useEffect(() => {
    setComprobante(null)
    if (g.tabla !== 'cotizaciones') return
    supabase.from('cotizaciones').select('detalle_venta').eq('id', g.id).single().then(({ data }) => {
      const ruta = (data?.detalle_venta as { comprobantePagoUrl?: string } | null)?.comprobantePagoUrl
      if (ruta) supabase.storage.from('crm').createSignedUrl(ruta, 3600).then(({ data: s }) => { if (s) setComprobante({ ruta, url: s.signedUrl }) })
    })
  }, [g.id, g.tabla])

  const cargarHistorial = useCallback(() => {
    supabase.from('interacciones').select('id,fecha,tipo,nota,usuario_texto').eq(campo, g.id).is('deleted_at', null).order('fecha', { ascending: false }).limit(200)
      .then(({ data }) => setHistorial((data as Interaccion[]) ?? []))
  }, [campo, g.id])
  useEffect(() => { setHistorial(null); cargarHistorial() }, [cargarHistorial])
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', f); return () => document.removeEventListener('keydown', f) }, [cerrar])

  const color = colorEstado(g.estado)
  const iniciales = String(g.nombre || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase() || '?'
  const asesor = asesores.find((a) => a.id === g.asesorId)?.nombre ?? 'Sin asignar'
  const dias = g.ultimaTS ? Math.floor((Date.now() - g.ultimaTS) / 86400000) : 0
  const prox = g.proximoTS
  const proxVenc = prox && prox < Date.now() && g.estado !== 'Ganado' && g.estado !== 'Perdido'
  const wa = waLink(g.telefono), tel = telLink(g.telefono), mail = /@/.test(g.email) ? 'mailto:' + encodeURIComponent(g.email) : ''

  const tarjetas = [
    { cls: 'hl', icon: Magnet, l: 'Medio de captación', v: g.medio || 'Sin registrar', s: 'de la gestión' },
    { cls: '', icon: Wallet, l: 'Valor', v: g.total ? '$' + g.total.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—', s: g.total ? 'total con IVA' : 'sin proforma' },
    { cls: '', icon: UserRound, l: 'Asesor', v: asesor, s: g.tipo },
    { cls: dias >= 3 && g.estado !== 'Ganado' && g.estado !== 'Perdido' ? 'warn' : '', icon: Activity, l: 'Última actividad', v: haceTexto(g.ultimaTS) || '—', s: g.ultimaTS ? new Date(g.ultimaTS).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' }) : '' },
    { cls: proxVenc ? 'warn' : '', icon: CalendarClock, l: 'Próximo seguimiento', v: prox ? new Date(prox).toLocaleDateString('es-EC', { weekday: 'short', day: 'numeric', month: 'short' }) : '—', s: proxVenc ? 'vencido' : prox ? 'programado' : '' },
    { cls: '', icon: CalendarPlus, l: 'Creada', v: g.fechaTS ? haceTexto(g.fechaTS) : '—', s: g.fechaTS ? new Date(g.fechaTS).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' }) : '' },
  ]

  async function guardarNota() {
    if (!nota.trim()) return
    setGuardando(true)
    const { error } = await supabase.from('interacciones').insert({
      id: crypto.randomUUID(), codigo: 'INT-' + crypto.randomUUID().slice(0, 8), ref_tipo: g.tipo, ref_codigo: g.codigo || null,
      [campo]: g.id, tipo: 'Nota', nota: nota.trim(), empleado_id: perfil.id, usuario_texto: perfil.nombre,
    })
    if (error) { aviso('No se pudo guardar la nota: ' + error.message); setGuardando(false); return }
    await supabase.from(g.tabla).update({ ultima_actividad: new Date().toISOString() }).eq('id', g.id)
    setNota(''); setGuardando(false); cargarHistorial(); recargar()
  }

  async function cambiarAsesor(id: string) {
    const { error } = await supabase.from(g.tabla).update({ asesor_id: id || null, ultima_actividad: new Date().toISOString() }).eq('id', g.id)
    if (error) { aviso('No se pudo cambiar el asesor: ' + error.message); return }
    await supabase.from('interacciones').insert({
      id: crypto.randomUUID(), codigo: 'INT-' + crypto.randomUUID().slice(0, 8), ref_tipo: g.tipo, ref_codigo: g.codigo || null,
      [campo]: g.id, tipo: 'Cambio de Asesor', nota: `Asesor cambiado a ${asesores.find((a) => a.id === id)?.nombre ?? 'Sin asignar'}.`, empleado_id: perfil.id, usuario_texto: perfil.nombre,
    })
    // Igual que reassignAdvisor del original: el asesor nuevo se entera ya (aviso interno en Mi Espacio).
    if (id && id !== perfil.id) {
      await supabase.from('notificaciones').insert({ id: crypto.randomUUID(), para_id: id, modulo: 'crm', evento: 'reasignacion', tipo: 'aviso',
        texto: `Te asignaron una gestión: ${g.nombre || 'Sin nombre'}${g.codigo ? ' (' + g.codigo + ')' : ''} — por ${perfil.nombre}.`, entidad: g.tabla, entidad_id: g.id })
    }
    cargarHistorial(); recargar()
  }

  const cargarVersiones = useCallback(() => {
    if (g.tabla !== 'cotizaciones') return
    supabase.from('cotizaciones_historial').select('id,version,fecha:created_at,usuario_texto,cambios,items,total,nota,cliente').eq('cotizacion_id', g.id).is('deleted_at', null).order('version', { ascending: false }).limit(50)
      .then(({ data }) => setVersiones((data as never) ?? []))
  }, [g.tabla, g.id])
  useEffect(() => { cargarVersiones() }, [cargarVersiones])

  async function editarProforma() {
    const { data, error } = await supabase.from('cotizaciones').select('id,codigo,tipo_registro,nombre,identificacion,email,telefono,cliente_id,asesor_id,items,total,nota_cotizacion,medio_captacion_lead').eq('id', g.id).single()
    if (error || !data) { aviso('No se pudo abrir la proforma para editar: ' + (error?.message ?? '')); return }
    const row = data as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    row.items = await enriquecerItems((row.items ?? []) as never)
    editarDoc(row)
  }

  async function verVersion(v: NonNullable<typeof versiones>[number]) {
    const items = await enriquecerItems(((v.items ?? []) as Record<string, any>[]).map((i) => ({ ...i, precio: Number(i.precio) || 0, cantidad: Number(i.cantidad) || 0, descuento: Number(i.descuento) || 0, iva: i.iva !== false })) as never) // eslint-disable-line @typescript-eslint/no-explicit-any
    verProforma({ codigo: g.codigo + ' · v' + v.version, fecha: new Date(v.fecha).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }), tipo: g.tipo === 'Venta' ? 'Venta' : 'Cotización', empresa,
      cliente: { nombre: v.cliente?.nombre ?? g.nombre, identificacion: v.cliente?.identificacion, email: v.cliente?.email, telefono: v.cliente?.telefono }, asesor: asesor, nota: v.nota, items })
  }

  async function abrirProforma() {
    const { data, error } = await supabase.from('cotizaciones')
      .select('codigo,fecha,tipo_registro,nombre,identificacion,email,telefono,items,nota_cotizacion,nota_venta,asesor_id,estado_pago,metodo_pago,tipo_entrega,direccion_entrega,fecha_entrega,detalle_venta').eq('id', g.id).single()
    if (error || !data) { aviso('No se pudo cargar la proforma: ' + (error?.message ?? '')); return }
    const r = data as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const venta = r.tipo_registro === 'Venta'
    verProforma({
      codigo: r.codigo ?? g.codigo, fecha: new Date(r.fecha).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }), tipo: venta ? 'Venta' : 'Cotización', empresa,
      cliente: { nombre: r.nombre, identificacion: r.identificacion, email: r.email, telefono: r.telefono }, asesor: asesor, nota: venta ? r.nota_venta : r.nota_cotizacion,
      items: await enriquecerItems(((r.items ?? []) as Record<string, any>[]).map((i) => ({ ...i, precio: Number(i.precio) || 0, cantidad: Number(i.cantidad) || 0, descuento: Number(i.descuento) || 0, iva: i.iva !== false })) as never), // eslint-disable-line @typescript-eslint/no-explicit-any
      pagoEntrega: venta ? { pago: [r.estado_pago, r.metodo_pago].filter(Boolean).join(' · '), entrega: r.tipo_entrega ?? '', detalle: [r.direccion_entrega, r.fecha_entrega ? 'Fecha de entrega: ' + r.fecha_entrega : ''].filter(Boolean) } : null,
    })
  }

  async function revertirGanado() {
    if (g.codigo) {
      const { data: fact } = await supabase.from('facturas').select('estado,numero_contifico').eq('codigo', g.codigo).is('deleted_at', null).maybeSingle()
      if (fact && fact.estado === 'Facturado') { aviso('Ya tiene factura' + (fact.numero_contifico ? ' N.º ' + fact.numero_contifico : '') + ' generada: no se puede revertir. Usa Notas de Crédito en Facturación.'); return }
    }
    const { error } = await supabase.from(g.tabla).update({ estado_crm: 'En Negociación', ultima_actividad: new Date().toISOString() }).eq('id', g.id)
    if (error) { aviso('No se pudo revertir: ' + error.message); return }
    // Era "Ganado" solo por error (sin venta válida): la factura "Pendiente" que se creó al marcarlo se elimina para no dejarla huérfana.
    if (g.codigo) await supabase.from('facturas').update({ deleted_at: new Date().toISOString() }).eq('codigo', g.codigo).is('deleted_at', null)
    await supabase.from('interacciones').insert({
      id: crypto.randomUUID(), codigo: 'INT-' + crypto.randomUUID().slice(0, 8), ref_tipo: g.tipo, ref_codigo: g.codigo || null,
      [campo]: g.id, tipo: 'Cambio de Estado', nota: 'Revertido de Ganado a En Negociación por ' + perfil.nombre + ' (sin venta válida asociada).', empleado_id: perfil.id, usuario_texto: perfil.nombre,
    })
    aviso('Revertido a En Negociación.'); cerrar(); recargar()
  }

  async function eliminarGestion(motivo: string) {
    const { error } = await supabase.from(g.tabla).update({ deleted_at: new Date().toISOString(), motivo_eliminacion: motivo || null }).eq('id', g.id)
    if (error) { aviso('No se pudo eliminar: ' + error.message); return }
    // Ganado = ya tiene (o pudo tener) una fila en Facturación con el mismo código: se elimina también para no dejarla huérfana.
    if (g.estado === 'Ganado' && g.codigo) await supabase.from('facturas').update({ deleted_at: new Date().toISOString() }).eq('codigo', g.codigo).is('deleted_at', null)
    setElim(false); aviso('Gestión enviada a la Papelera.'); cerrar(); recargar()
  }

  function copiarSolicitud() {
    const t = `Hola${g.nombre ? ' ' + g.nombre : ''}, para continuar con su gestión necesitamos sus datos: nombre completo, cédula o RUC, correo electrónico, ciudad y dirección. ¡Gracias!`
    navigator.clipboard?.writeText(t).then(() => aviso('Mensaje copiado: pégalo en el chat del cliente.'))
  }

  /* Editar los datos del contacto (updateLeadFields del original). */
  const puedeEditar = puede(perfil, mod, 'editar') || g.asesorId === perfil.id
  const [editando, setEditando] = useState(false)
  const [datos, setDatos] = useState({ nombre: g.nombre, telefono: g.telefono, email: g.email, identificacion: g.identificacion })
  useEffect(() => { setDatos({ nombre: g.nombre, telefono: g.telefono, email: g.email, identificacion: g.identificacion }); setEditando(false) }, [g.id, g.nombre, g.telefono, g.email, g.identificacion])
  async function guardarDatos() {
    const limpio = { nombre: datos.nombre.trim(), telefono: datos.telefono.trim(), email: datos.email.trim().toLowerCase(), identificacion: datos.identificacion.replace(/\s+/g, '') }
    if (!limpio.nombre) { aviso('El nombre no puede quedar vacío.'); return }
    if (limpio.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpio.email)) { aviso('El correo no es válido.'); return }
    if (limpio.identificacion && !/^\d{10}(\d{3})?$/.test(limpio.identificacion)) { aviso('La cédula debe tener 10 dígitos o el RUC 13.'); return }
    const cambios = (Object.keys(limpio) as (keyof typeof limpio)[]).filter((k) => limpio[k] !== (g[k] ?? ''))
    if (!cambios.length) { setEditando(false); return }
    const { error } = await supabase.from(g.tabla).update({ nombre: limpio.nombre, telefono: limpio.telefono || null, email: limpio.email || null, identificacion: limpio.identificacion || null, ultima_actividad: new Date().toISOString() }).eq('id', g.id)
    if (error) { aviso('No se pudieron guardar los datos: ' + error.message); return }
    const etiquetas: Record<string, string> = { nombre: 'nombre', telefono: 'teléfono', email: 'correo', identificacion: 'cédula/RUC' }
    await supabase.from('interacciones').insert({
      id: crypto.randomUUID(), codigo: 'INT-' + crypto.randomUUID().slice(0, 8), ref_tipo: g.tipo, ref_codigo: g.codigo || null,
      [campo]: g.id, tipo: 'Datos Actualizados', nota: 'Se actualizó: ' + cambios.map((k) => etiquetas[k]).join(', ') + '.', empleado_id: perfil.id, usuario_texto: perfil.nombre,
    })
    setEditando(false); aviso('Datos del contacto actualizados.'); cargarHistorial(); recargar()
  }
  const abiertaEtapa = g.estado !== 'Ganado' && g.estado !== 'Perdido'

  return (
    <>
      <div id="detailOverlay" className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-40" onClick={cerrar} />
      <div id="detailDrawer" className={'fixed right-0 top-0 h-full w-full sm:max-w-md bg-white shadow-2xl z-50 flex flex-col' + (abierto ? ' open' : '')}>
        <div className="px-4 pt-4 pb-3 text-white shrink-0" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl grid place-items-center font-display font-bold text-sm shrink-0" style={{ background: 'rgba(255,255,255,.14)' }}>{iniciales}</div>
            <div className="min-w-0 flex-1">
              <p className="font-display font-bold text-base leading-tight truncate">{g.nombre || 'Sin nombre'}</p>
              <p className="font-mono-spec text-[10px] text-white/65 mt-0.5 truncate">{g.codigo || g.id.slice(0, 8)} · creada {g.fechaTS ? new Date(g.fechaTS).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</p>
            </div>
            <button onClick={cerrar} className="bg-white/10 hover:bg-white/20 p-1.5 rounded-full transition-colors shrink-0" aria-label="Cerrar"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            <span className="vm-dchip"><i style={{ background: color }} />{g.estado}</span>
            <span className="vm-dchip">{g.tipo}</span>
            {g.medio && <span className="vm-dchip" title="Medio de captación">{g.medio}</span>}
          </div>
        </div>

        <div className="flex-grow overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {tarjetas.map((c) => {
              const I = c.icon
              return (
                <div key={c.l} className={'vm-dcard ' + c.cls}>
                  <p className="l"><I />{c.l}</p>
                  <p className="v" title={c.v}>{c.v}</p>
                  {c.s && <p className="s" title={c.s}>{c.s}</p>}
                </div>
              )
            })}
          </div>

          <div className="flex gap-2">
            <a className={'vm-qbtn ' + (wa ? '' : 'off')} style={{ ['--c' as string]: '#16a34a' }} {...(wa ? { href: wa, target: '_blank', rel: 'noopener' } : {})}><MessageCircle />WhatsApp</a>
            <a className={'vm-qbtn ' + (tel ? '' : 'off')} style={{ ['--c' as string]: 'var(--primary)' }} {...(tel ? { href: tel } : {})}><Phone />Llamar</a>
            <a className={'vm-qbtn ' + (mail ? '' : 'off')} style={{ ['--c' as string]: '#7c3aed' }} {...(mail ? { href: mail } : {})}><Mail />Correo</a>
            {g.pdfUrl && <a className="vm-qbtn" style={{ ['--c' as string]: '#c0392b' }} href={g.pdfUrl} target="_blank" rel="noopener"><FileText />Proforma</a>}
            {chat && <button type="button" className="vm-qbtn" style={{ ['--c' as string]: '#e1306c' }} onClick={chat}><MessageSquareText />Chat</button>}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Estado</label>
              <select value={g.estado} disabled={g.estado === 'Ganado'} onChange={(e) => cambiarEstado(g.key, e.target.value)}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs font-semibold focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--cyan)' }}>
                {etapas.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              {g.estado === 'Ganado' && <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1"><Lock className="w-3 h-3" /> En facturación — ya no se puede cambiar de estado</p>}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Asesor</label>
              <select value={g.asesorId ?? ''} onChange={(e) => cambiarAsesor(e.target.value)}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs font-semibold focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--cyan)' }}>
                <option value="">Sin asignar</option>
                {asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
          </div>

          <button onClick={facturar} disabled={g.estado === 'Ganado'} className="w-full text-white text-sm font-bold py-3 rounded-xl disabled:opacity-50" style={{ background: '#04896f' }}>
            {g.estado === 'Ganado' ? 'Ganado · En facturación' : 'Facturar / Marcar ganado'}
          </button>

          {g.tabla === 'cotizaciones' && g.tipo === 'Cotización' && g.estado !== 'Ganado' && puede(perfil, mod, 'editar') && (
            <button onClick={editarProforma} className="w-full text-sm font-bold py-2.5 rounded-xl border flex items-center justify-center gap-1.5" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}><Pencil className="w-4 h-4" /> Editar proforma</button>
          )}
          {g.tabla === 'cotizaciones' && (
            <button onClick={abrirProforma} className="w-full text-sm font-bold py-2.5 rounded-xl border flex items-center justify-center gap-1.5" style={{ borderColor: '#c0392b', color: '#c0392b' }}><FileText className="w-4 h-4" /> Ver proforma (PDF A4)</button>
          )}
          {comprobante && (
            <a href={comprobante.url} target="_blank" rel="noopener noreferrer" className="w-full text-sm font-bold py-2.5 rounded-xl border flex items-center justify-center gap-1.5" style={{ borderColor: '#16a34a', color: '#16a34a' }}><ImagePlus className="w-4 h-4" /> Ver comprobante de transferencia</a>
          )}

          {g.tabla === 'leads' && g.estado !== 'Ganado' && g.estado !== 'Perdido' && (
            <button onClick={cotizar} className="w-full text-sm font-bold py-2.5 rounded-xl border flex items-center justify-center gap-1.5" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}><FilePlus2 className="w-4 h-4" /> Crear cotización</button>
          )}
          <div className="grid grid-cols-2 gap-2">
            {abiertaEtapa && (
              <button onClick={seguimiento} className="text-xs font-bold py-2.5 rounded-xl border flex items-center justify-center gap-1.5" style={{ borderColor: '#7c3aed', color: '#7c3aed' }}><Repeat className="w-3.5 h-3.5" /> Registrar seguimiento</button>
            )}
            {g.tabla === 'cotizaciones' && puede(perfil, mod, 'crear') && (
              <button onClick={duplicar} className="text-xs font-bold py-2.5 rounded-xl border flex items-center justify-center gap-1.5" style={{ borderColor: '#0e7490', color: '#0e7490' }} title="Nueva cotización con los mismos productos, precios y descuentos"><Copy className="w-3.5 h-3.5" /> Duplicar cotización</button>
            )}
          </div>

          <DetalleEstado historial={historial} estado={g.estado} color={color} />

          {g.interes && (
            <div className="vm-dsec" style={{ padding: 12 }}>
              <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Interés / equipos</p>
              <p className="text-xs text-slate-700" style={{ whiteSpace: 'pre-line' }}>{g.interes}</p>
            </div>
          )}

          <details className="vm-dsec" open>
            <summary><Contact className="w-3.5 h-3.5" />Contacto y cliente</summary>
            {editando ? (
              <div className="space-y-1.5 pt-2">
                {([['nombre', 'Nombre'], ['telefono', 'Teléfono'], ['email', 'Correo'], ['identificacion', 'Cédula / RUC']] as [keyof typeof datos, string][]).map(([k, t]) => (
                  <label key={k} className="block text-[10px] font-bold text-slate-500 uppercase">{t}
                    <input value={datos[k]} onChange={(e) => setDatos({ ...datos, [k]: e.target.value })} inputMode={k === 'telefono' || k === 'identificacion' ? 'numeric' : undefined}
                      className="w-full mt-0.5 border border-slate-200 rounded-lg p-2 text-xs font-normal normal-case focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--cyan)' }} />
                  </label>
                ))}
                <div className="flex gap-1.5 pt-1">
                  <button onClick={() => setEditando(false)} className="flex-1 text-xs font-bold py-2 rounded-lg border border-slate-200 text-slate-600">Cancelar</button>
                  <button onClick={guardarDatos} className="flex-1 text-xs font-bold py-2 rounded-lg text-white" style={{ background: 'var(--teal)' }}>Guardar datos</button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 pt-2 text-xs text-slate-700">
                <p><b>Nombre:</b> {g.nombre || '—'}</p>
                <p><b>Teléfono:</b> {g.telefono || '—'}</p>
                <p><b>Correo:</b> {g.email || '—'}</p>
                <p><b>Cédula / RUC:</b> {g.identificacion || '—'}</p>
                {puedeEditar && g.estado !== 'Ganado' && <button onClick={() => setEditando(true)} className="text-[11px] font-bold flex items-center gap-1" style={{ color: 'var(--primary)' }}><Pencil className="w-3 h-3" /> Editar datos</button>}
              </div>
            )}
            <div className="grid grid-cols-2 gap-1.5 mt-3">
              <button onClick={clientes} className="text-xs font-bold py-2 rounded-lg border flex items-center justify-center gap-1.5 transition-colors" style={{ borderColor: '#04896f', color: '#04896f' }}><IdCard className="w-3.5 h-3.5" /> Ficha Cliente</button>
              <button onClick={copiarSolicitud} className="text-xs font-bold py-2 rounded-lg border flex items-center justify-center gap-1.5 transition-colors" style={{ borderColor: '#25D366', color: '#25D366' }}><Copy className="w-3.5 h-3.5" /> Pedir datos</button>
            </div>
          </details>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Agregar nota</label>
            <div className="flex gap-2">
              <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. Cliente pidió cotización de mesa quirúrgica adicional..."
                className="flex-grow border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--cyan)' }} />
            </div>
            <button onClick={guardarNota} disabled={guardando} className="mt-1.5 w-full text-white text-xs font-bold py-2 rounded-lg transition-transform hover:-translate-y-0.5" style={{ background: 'var(--teal)' }}>{guardando ? 'Guardando…' : 'Guardar Nota'}</button>
          </div>

          {g.estado === 'Ganado' && puede(perfil, mod, 'editar') && (
            <button onClick={revertirGanado} className="w-full text-xs font-bold py-2 rounded-lg border flex items-center justify-center gap-1.5" style={{ borderColor: '#fcd34d', color: '#92400e', background: '#fffbeb' }}><Repeat className="w-3.5 h-3.5" /> Revertir a En Negociación (fue un error)</button>
          )}

          {(g.estado === 'Ganado' ? perfil.es_superadmin : puede(perfil, mod, 'eliminar')) && (
            <button onClick={() => setElim(true)} className="w-full text-xs font-bold py-2 rounded-lg border flex items-center justify-center gap-1.5" style={{ borderColor: '#fecaca', color: '#b91c1c', background: '#fff5f5' }}><Trash2 className="w-3.5 h-3.5" /> Eliminar {g.estado === 'Ganado' ? 'venta' : 'gestión'}</button>
          )}

          {g.tabla === 'cotizaciones' && (
            <div>
              <h4 className="text-[11px] font-bold text-slate-500 uppercase mb-2">Versiones de la {g.tipo === 'Venta' ? 'venta' : 'proforma'}</h4>
              <div className="space-y-2">
                {versiones === null && <p className="text-xs text-slate-400">Cargando versiones…</p>}
                {versiones?.length === 0 && <p className="text-xs text-slate-400">Sin versiones registradas (se crean desde ahora al guardar).</p>}
                {versiones?.map((v) => (
                  <div key={v.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase font-mono-spec" style={{ color: 'var(--primary)' }}>v{v.version} · {dinero2(v.total)}</span>
                      <span className="text-[10px] text-slate-400">{new Date(v.fecha).toLocaleString('es-EC')}</span>
                    </div>
                    <ul className="mt-1 space-y-0.5">{v.cambios.map((c, k) => <li key={k} className="text-[11px] text-slate-700" style={{ overflowWrap: 'anywhere' }}>• {c}</li>)}</ul>
                    <div className="flex items-center justify-between mt-1.5"><span className="text-[10px] text-slate-400">{v.usuario_texto}</span>
                      <button type="button" onClick={() => verVersion(v)} className="text-[10px] font-bold px-2 py-1 rounded border" style={{ borderColor: '#c0392b', color: '#c0392b' }}>Ver proforma de esta versión</button></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h4 className="text-[11px] font-bold text-slate-500 uppercase mb-2">Historial</h4>
            <div className="space-y-3">
              {historial === null && <p className="text-xs text-slate-400">Cargando el historial…</p>}
              {historial?.map((i) => (
                <div key={i.id} className="flex gap-2.5">
                  <div className="w-1.5 rounded-full shrink-0" style={{ background: 'var(--cyan)' }} />
                  <div className="pb-2 border-b border-slate-100 flex-grow">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase font-mono-spec" style={{ color: 'var(--primary)' }}>{i.tipo}</span>
                      <span className="text-[10px] text-slate-400">{new Date(i.fecha).toLocaleString('es-EC')}</span>
                    </div>
                    <NotaConEvidencia nota={i.nota} />
                    {i.usuario_texto && <p className="text-[10px] text-slate-400 mt-0.5">{i.usuario_texto}</p>}
                  </div>
                </div>
              ))}
              {historial?.length === 0 && <p className="text-xs text-slate-400">Sin actividad registrada.</p>}
            </div>
          </div>
        </div>
      </div>
      {elim && <ConfirmarEliminar titulo={`¿Eliminar la ${g.estado === 'Ganado' ? 'venta' : 'gestión'} de "${g.nombre}"?`} detalle={g.estado === 'Ganado' ? 'Es una venta ya ganada: también se elimina su factura en Facturación si existe. Desaparece del pipeline pero no se borra de la base; se puede restaurar desde la Papelera del CRM.' : 'Desaparece del pipeline pero no se borra de la base. Se puede restaurar desde la Papelera del CRM.'} cerrar={() => setElim(false)} ok={eliminarGestion} />}
    </>
  )
}

/* ============================ Nueva gestión ============================ */
const MEDIOS: [string, string[]][] = [
  ['Web y catálogo VIMEDIC', ['🤖 Chat bot web', '📝 Cotización web', '📅 Visita web', '🔓 Desbloqueo precios y stock web', '🛒 Catálogo web', '🌐 Página web']],
  ['Publicidad pagada', ['📣 Anuncio en Facebook o Instagram', '🎵 Anuncio en TikTok', '🔎 Anuncio en Google', '▶️ Anuncio en YouTube']],
  ['Redes sociales (sin pago)', ['📱 Publicación en redes sociales', '📖 Historia o estado', '💬 Mensaje directo en redes sociales']],
  ['El cliente nos contactó directo', ['🔗 Enlace directo de WhatsApp', '📲 Escribió al WhatsApp del asesor', '☎️ Llamada entrante', '✉️ Correo electrónico entrante']],
  ['Búsqueda en internet', ['📍 Google Maps', '🔍 Búsqueda en Google (sin anuncio)']],
  ['Recomendación', ['🤝 Referido por un cliente', '🩺 Referido por un médico o profesional de salud', '🏷️ Distribuidor o aliado comercial']],
  ['Gestión comercial', ['🚶 Visita comercial', '🏢 Visita del cliente a nuestras instalaciones', '📞 Prospección telefónica', '🎪 Feria o evento', '🏛️ Compra pública (SERCOP)', '🔄 Reactivación o seguimiento']],
]
const CANALES = ['WhatsApp', 'Instagram', 'Facebook', 'Llamada', 'Referido', 'Feria/Evento', 'Otro']
const SEGUIMIENTOS: [string, string, number][] = [['2h', '2 horas', 2 * 3600000], ['12h', '12 horas', 12 * 3600000], ['1d', '1 día', 86400000], ['2d', '2 días', 2 * 86400000], ['3d', '3 días', 3 * 86400000], ['1s', '1 semana', 7 * 86400000], ['custom', 'Otra fecha', 0]]

type ClienteRes = { id: string; nombre: string; identificacion: string | null; email: string | null; telefono: string | null }

function NuevaGestion({ perfil, asesores, cerrar, guardado, empresa }: { empresa: 'VIMEDIC' | 'FEMEDICS'; perfil: Perfil; asesores: Asesor[]; cerrar: () => void; guardado: () => void }) {
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<ClienteRes[]>([])
  const [cliente, setCliente] = useState<ClienteRes | null>(null)
  const [manual, setManual] = useState({ nombre: '', telefono: '', email: '' })
  const [medio, setMedio] = useState('')
  const [interes, setInteres] = useState('')
  const [canal, setCanal] = useState('')
  const [contesto, setContesto] = useState<boolean | null>(null)
  const [seg, setSeg] = useState('')
  const [fechaCustom, setFechaCustom] = useState('')
  const [estadoInicial, setEstadoInicial] = useState('Nuevo')
  const [asesorId, setAsesorId] = useState(perfil.id)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [anuncio, setAnuncio] = useState('')
  const [anuncios, setAnuncios] = useState<string[]>([])
  const [nuevoAnuncio, setNuevoAnuncio] = useState<string | null>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [faltaCaptura, setFaltaCaptura] = useState(false)
  const capturaObligatoria = !esMovil()
  const puedeAgregarAnuncio = puede(perfil, 'marketing', 'editar')
  const cambiarArchivo = useCallback((f: File | null) => { setArchivo(f); if (f) setFaltaCaptura(false) }, [])
  const cargarAnuncios = useCallback(() => {
    supabase.from('anuncios_activos').select('nombre').is('deleted_at', null).order('nombre').limit(300)
      .then(({ data }) => setAnuncios(((data ?? []) as { nombre: string }[]).map((a) => a.nombre)))
  }, [])
  useEffect(() => { cargarAnuncios() }, [cargarAnuncios])
  async function guardarAnuncio() {
    const n = (nuevoAnuncio ?? '').trim()
    if (!n) return
    const { error: e } = await supabase.from('anuncios_activos').insert({ id: crypto.randomUUID(), nombre: n })
    if (e && !/duplicate|unique/i.test(e.message)) { setError('No se pudo agregar el anuncio: ' + e.message); return }
    setNuevoAnuncio(null); setAnuncio(n); cargarAnuncios()
  }

  useEffect(() => {
    const q = busca.trim().replace(/[,()%*\\]/g, ' ')
    if (q.length < 2) { setResultados([]); return }
    const t = setTimeout(() => {
      supabase.from('clientes').select('id,nombre,identificacion,email,telefono').is('deleted_at', null).eq('empresa', empresa)
        .or(`nombre.ilike.%${q}%,identificacion.ilike.%${q}%,email.ilike.%${q}%`).limit(8)
        .then(({ data }) => setResultados((data as ClienteRes[]) ?? []))
    }, 250)
    return () => clearTimeout(t)
  }, [busca])

  const nombre = cliente?.nombre ?? manual.nombre.trim()
  const faltan: string[] = []
  if (!nombre) faltan.push('cliente')
  if (!medio) faltan.push('medio de captación')
  if (!seg) faltan.push('próximo intento')
  if (seg === 'custom' && !fechaCustom) faltan.push('fecha del intento')
  const pasos = { cliente: !!nombre, captacion: !!medio, detalle: !!(interes.trim() || canal) }
  const progreso = Math.round(([!!nombre, !!medio, !!(interes.trim() || canal), !!seg].filter(Boolean).length / 4) * 100)

  async function guardar() {
    if (faltan.length) { setError('Falta: ' + faltan.join(', ') + '.'); return }
    if (capturaObligatoria && !archivo) { setFaltaCaptura(true); setError('Adjunta la captura o el PDF de respaldo: es obligatorio para la auditoría.'); return }
    setGuardando(true); setError('')
    const ahora = Date.now()
    const proximo = seg === 'custom' ? new Date(fechaCustom + 'T09:00:00').getTime() : ahora + (SEGUIMIENTOS.find((s) => s[0] === seg)?.[2] ?? 0)
    const id = crypto.randomUUID()
    const codigo = 'CON-' + id.slice(0, 6).toUpperCase()
    const { error } = await supabase.from('leads').insert({
      id, codigo, empresa, origen_tipo: 'contacto', nombre, telefono: cliente?.telefono ?? (manual.telefono.trim() || null), email: cliente?.email ?? (manual.email.trim() || null),
      identificacion: cliente?.identificacion ?? null, cliente_id: cliente?.id ?? null, medio_captacion: medio, interes: interes.trim() || null, canal: canal || null, anuncio: anuncio || null,
      contesto, estado_crm: estadoInicial, asesor_id: asesorId || null, ultima_actividad: new Date(ahora).toISOString(), proximo_seguimiento: new Date(proximo).toISOString(),
    })
    if (error) { setError(error.message); setGuardando(false); return }
    let captura = ''
    if (archivo) { try { captura = ' — Captura: ' + (await subirCaptura(archivo, id)) } catch { captura = ' — Captura: no se pudo subir' } }
    await supabase.from('interacciones').insert({
      id: crypto.randomUUID(), codigo: 'INT-' + crypto.randomUUID().slice(0, 8), ref_tipo: 'Contacto', ref_codigo: codigo, lead_id: id, tipo: 'Contacto Registrado',
      nota: `Gestión creada — Medio: ${medio}${anuncio ? ' — Anuncio: ' + anuncio : ''}${canal ? ' — Canal: ' + canal : ''}${interes.trim() ? ' — Interés: ' + interes.trim() : ''}${contesto === null ? '' : ' — ' + (contesto ? 'Sí contestó' : 'No contestó')}${captura}`,
      empleado_id: perfil.id, usuario_texto: perfil.nombre,
    })
    guardado()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[60] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="ns-shell nq-theme bg-slate-50 sm:rounded-3xl shadow-2xl w-full h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:max-w-3xl flex flex-col overflow-hidden">
        <div className="ns-head shrink-0 px-5 pt-4 pb-3 text-white">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl grid place-items-center bg-white/15"><CirclePlus className="w-5 h-5" /></span>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-base leading-tight">Nueva Gestión</h3>
              <p className="text-[11px] text-white/70">Registra un contacto con un cliente o prospecto.</p>
            </div>
            <div className="ml-auto hidden md:flex items-center gap-1.5">
              <span className={'ns-step' + (pasos.cliente ? ' done' : '')}><User />Cliente</span>
              <span className={'ns-step' + (pasos.captacion ? ' done' : '')}><Magnet />Captación</span>
              <span className={'ns-step' + (pasos.detalle ? ' done' : '')}><MessageSquareText />Detalle</span>
            </div>
            <button onClick={cerrar} className="ml-2 w-9 h-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-white/15 overflow-hidden"><i className="block h-full rounded-full bg-white transition-all duration-300" style={{ width: progreso + '%' }} /></div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 grid md:grid-cols-2 gap-3 items-start">
          <div className="space-y-3">
            <section className="ns-sec">
              <header><span className="ns-num">1</span><h4>Cliente</h4></header>
              <div className="relative mb-2">
                <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente por nombre, cédula o correo..." className="ns-input pl-9" />
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
              {resultados.length > 0 && !cliente && (
                <div className="border border-slate-200 rounded-xl max-h-40 overflow-y-auto mb-2 divide-y divide-slate-100 bg-white shadow-sm">
                  {resultados.map((c) => (
                    <button key={c.id} type="button" className="w-full text-left px-3 py-2 hover:bg-slate-50" onClick={() => { setCliente(c); setBusca(''); setResultados([]) }}>
                      <p className="text-xs font-bold text-slate-800 truncate">{c.nombre}</p>
                      <p className="text-[10px] text-slate-500 truncate">{[c.identificacion, c.telefono, c.email].filter(Boolean).join(' · ')}</p>
                    </button>
                  ))}
                </div>
              )}
              {cliente ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 truncate">{cliente.nombre}</p>
                    <p className="text-[10px] text-slate-500 truncate">{[cliente.identificacion, cliente.telefono, cliente.email].filter(Boolean).join(' · ') || 'Sin más datos'}</p>
                  </div>
                  <button type="button" className="text-[10px] font-bold" style={{ color: 'var(--acc)' }} onClick={() => setCliente(null)}>Cambiar</button>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                  <p className="text-[10px] text-slate-500">¿No está en la lista? Registra un prospecto nuevo:</p>
                  <input className="ns-input" placeholder="Nombre *" value={manual.nombre} onChange={(e) => setManual({ ...manual, nombre: e.target.value })} />
                  <div className="grid grid-cols-2 gap-2">
                    <input className="ns-input" placeholder="Teléfono" value={manual.telefono} onChange={(e) => setManual({ ...manual, telefono: e.target.value })} />
                    <input className="ns-input" placeholder="Correo" value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} />
                  </div>
                </div>
              )}
            </section>

            <section className="ns-sec">
              <header><span className="ns-num">2</span><h4>Medio de captación <span className="text-red-500">*</span></h4></header>
              <select value={medio} onChange={(e) => setMedio(e.target.value)} className="ns-input">
                <option value="">Selecciona cómo llegó</option>
                {MEDIOS.map(([g, ops]) => <optgroup key={g} label={g}>{ops.map((o) => <option key={o} value={o}>{o}</option>)}</optgroup>)}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">Elige por dónde llegó <b>esta vez</b>, aunque ya sea cliente.</p>
              <p className="ns-label !mt-3">Anuncio / campaña</p>
              <select value={anuncio} onChange={(e) => setAnuncio(e.target.value)} className="ns-input">
                <option value="">Sin anuncio / No aplica</option>
                {anuncios.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              {puedeAgregarAnuncio && nuevoAnuncio === null && <button type="button" onClick={() => setNuevoAnuncio('')} className="mt-1.5 text-[10px] font-bold flex items-center gap-1" style={{ color: 'var(--acc)' }}><Plus className="w-3 h-3" /> Agregar anuncio nuevo</button>}
              {nuevoAnuncio !== null && (
                <div className="mt-1.5 flex gap-1.5">
                  <input value={nuevoAnuncio} onChange={(e) => setNuevoAnuncio(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') guardarAnuncio() }} placeholder="Nombre del anuncio..." className="ns-input" autoFocus />
                  <button type="button" onClick={guardarAnuncio} className="shrink-0 text-[11px] font-bold px-3 rounded-xl text-white" style={{ background: 'var(--acc)' }}>Ok</button>
                  <button type="button" onClick={() => setNuevoAnuncio(null)} className="shrink-0 text-[11px] font-bold px-2 rounded-xl border border-slate-200 text-slate-500" aria-label="Cancelar"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </section>
          </div>

          <div className="space-y-3">
            <section className="ns-sec">
              <header><span className="ns-num">3</span><h4>Detalles de la gestión</h4></header>
              <p className="ns-label">Interés / producto</p>
              <input type="text" value={interes} onChange={(e) => setInteres(e.target.value)} placeholder="Ej.: autoclave clase B para consultorio" className="ns-input mb-3" />
              <p className="ns-label">Medio de contacto</p>
              <div className="flex flex-wrap gap-1.5 mb-1">
                {CANALES.map((c) => <button key={c} type="button" onClick={() => setCanal(canal === c ? '' : c)} className={'ns-chip nc-canal-chip' + (canal === c ? ' active' : '')}>{c}</button>)}
              </div>
              <p className="ns-label !mt-3">¿Contestó?</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setContesto(true)} className={'ns-opt !flex-row !justify-center !py-2.5' + (contesto === true ? ' active' : '')}><PhoneCall />Sí contestó</button>
                <button type="button" onClick={() => setContesto(false)} className={'ns-opt !flex-row !justify-center !py-2.5' + (contesto === false ? ' active' : '')}><PhoneMissed />No contestó</button>
              </div>
            </section>

            <section className="ns-sec">
              <header><span className="ns-num">4</span><h4>Próximo intento <span className="text-red-500">*</span></h4></header>
              <p className="ns-label">¿Cuándo es el próximo intento? *</p>
              <div className="flex flex-wrap gap-1.5">
                {SEGUIMIENTOS.map(([v, t]) => <button key={v} type="button" onClick={() => setSeg(v)} className={'nc-seg ns-chip' + (seg === v ? ' active' : '')}>{t}</button>)}
              </div>
              {seg === 'custom' && <input type="date" value={fechaCustom} onChange={(e) => setFechaCustom(e.target.value)} className="ns-input mt-2" />}
              <p className="ns-label !mt-3">Evidencia (captura o PDF){capturaObligatoria ? ' *' : ''}</p>
              <CampoCaptura archivo={archivo} cambiar={cambiarArchivo} obligatoria={capturaObligatoria} falta={faltaCaptura} />
            </section>

            <section className="ns-sec">
              <header><span className="ns-num"><Settings2 className="w-3 h-3" /></span><h4>Asignación</h4></header>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="ns-label">Estado inicial</span>
                  <select value={estadoInicial} onChange={(e) => setEstadoInicial(e.target.value)} className="ns-input">
                    <option value="Nuevo">Nuevo (sin contactar todavía)</option>
                    <option value="Contactado">Contactado</option>
                    <option value="Sin Respuesta">Sin Respuesta</option>
                  </select></label>
                <label className="block"><span className="ns-label">Asesor</span>
                  <select value={asesorId} onChange={(e) => setAsesorId(e.target.value)} className="ns-input">
                    {asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select></label>
              </div>
            </section>
          </div>
        </div>

        <div className="shrink-0 px-4 py-3 border-t border-slate-200 bg-white flex items-center gap-3">
          <p className="text-[11px] flex-1" style={{ color: error || faltan.length ? '#c0392b' : '#04896f' }}>{error || (faltan.length ? 'Falta: ' + faltan.join(', ') : 'Todo listo para guardar')}</p>
          <button onClick={guardar} disabled={guardando} className="ns-submit !w-auto px-6">{guardando ? 'Guardando…' : 'Guardar gestión'}</button>
        </div>
      </div>
    </div>
  )
}
