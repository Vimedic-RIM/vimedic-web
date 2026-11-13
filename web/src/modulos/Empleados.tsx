import { useCallback, useEffect, useMemo, useState } from 'react'
import { Cake, Pencil, Search, ShieldOff, Trash2, UserPlus, Users, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { imagen } from './Inventario'
import { ConfirmarEliminar } from './CrmClientes'
import '../estilos/empleados.css'

type Emp = {
  id: string; email: string; nombre: string; cedula: string | null; telefono: string | null; correo_personal: string | null; cumpleanos: string | null
  foto_url: string | null; empresa: 'VIMEDIC' | 'FEMEDICS'; local: string | null; cargo: string | null; jefe_id: string | null; rol_id: string | null
  permisos_extra: Record<string, string[]> | null; recibe_leads: boolean; recibe_leads_mensajes: boolean; recibe_clientes_meta: boolean
  auth_user_id: string | null; estado: 'activo' | 'inactivo'; preferencias: Record<string, any> | null // eslint-disable-line @typescript-eslint/no-explicit-any
}
type Rol = { id: string; nombre: string; rol_crm: string | null; permisos: Record<string, string[]> }
const COLS = 'id,email,nombre,cedula,telefono,correo_personal,cumpleanos,foto_url,empresa,local,cargo,jefe_id,rol_id,permisos_extra,recibe_leads,recibe_leads_mensajes,recibe_clientes_meta,auth_user_id,estado,preferencias'

/* Interruptores del original → módulo / acción de la base nueva */
type Tog = { k: string; t: string; d?: string; fondo?: string; mod?: string; acc?: string; flag?: string; col?: 'recibe_leads' | 'recibe_leads_mensajes' | 'recibe_clientes_meta' }
const TOGGLES: Tog[] = [
  { k: 'facturacion', t: 'Acceso a Facturación', mod: 'facturacion' },
  { k: 'empleados', t: 'Acceso a Empleados', mod: 'empleados' },
  { k: 'dashboardEjecutivo', t: 'Acceso a Dashboard Ejecutivo', mod: 'dashboard' },
  { k: 'movimientos', t: 'Acceso a Movimientos', d: 'Ve el historial de ingresos y salidas de todos los productos.', mod: 'movimientos' },
  { k: 'clientes', t: 'Acceso a Clientes', d: 'Ficha completa de cada cliente: datos, cotizaciones, facturas, productos e historial. Crear, editar y eliminar se dan en "Qué puede hacer en cada módulo".', mod: 'clientes' },
  { k: 'bodega', t: 'Acceso a Bodega', d: 'Despacho de ventas: series, fotos/videos de evidencia y novedades.', mod: 'bodega' },
  { k: 'logistica', t: 'Acceso a Logística', d: 'Envíos, entregas y seguimiento de pedidos.', mod: 'logistica' },
  { k: 'serviciotecnico', t: 'Acceso a Servicio Técnico', d: 'Órdenes de servicio, mantenimientos e instalaciones.', mod: 'servicio_tecnico' },
  { k: 'documentostecnicos', t: 'Subir documentos técnicos', d: 'Manuales, hojas de datos, certificados y registros de cada equipo, sin acceso al resto de Servicio Técnico.', mod: 'documentos_tecnicos' },
  { k: 'talentohumano', t: 'Acceso a Talento Humano', d: 'Personal, solicitudes, permisos y capacitaciones.', mod: 'talento_humano' },
  { k: 'importaciones', t: 'Acceso a Importaciones', d: 'Pedidos a proveedores, embarques y nacionalización.', mod: 'importaciones' },
  { k: 'importacionesaprueba', t: 'Aprueba importaciones (Gerencia)', d: 'Aprueba órdenes de compra y pagos al exterior en Importaciones.', fondo: 'indigo', mod: 'importaciones', acc: 'aprobar' },
  { k: 'financiero', t: 'Acceso a Financiero', d: 'Cobros, pagos, flujo de caja y reportes.', mod: 'financiero' },
  { k: 'catalogos', t: 'Acceso a Catálogos personalizados', d: 'Arma catálogos PDF por segmento con el WhatsApp del asesor.', mod: 'catalogos' },
  { k: 'ofertas', t: 'Acceso a Ofertas y Liquidación', d: 'Stock dormido y con observaciones: estrategias, ofertas y resultados.', mod: 'ofertas' },
  { k: 'femedics', t: 'Acceso a Femedics CRM', mod: 'femedics' },
  { k: 'marketing', t: 'Módulo Marketing', mod: 'marketing' },
]
/* Issue #3: antes de activar un permiso sensible, confirmación explícita en vez de un toggle instantáneo. */
const ACCIONES_RIESGO = new Set(['eliminar', 'aprobar', 'administrar', 'ver_costos', 'restaurar'])
function confirmarRiesgo(acc: string, activando: boolean) {
  if (!activando || !ACCIONES_RIESGO.has(acc)) return true
  return confirm(`¿Dar el permiso "${acc}"? Es una acción sensible — confirma que esta persona de verdad debe tenerlo.`)
}
const FONDOS: Record<string, React.CSSProperties> = {
  azul: { background: '#eef6fd', border: '1px solid #d6e6f5' }, violeta: { background: '#f5f3ff', border: '1px solid #ddd6fe' },
  naranja: { background: '#fff7ed', border: '1px solid #fde2c3' }, indigo: { background: '#eef2ff', border: '1px solid #dbe2fb' },
}
/* Módulos de la tabla "Qué puede hacer en cada módulo" */
const MODS_ACC: [string, string][] = [
  ['crm', 'CRM Vimedic'], ['clientes', 'Clientes'], ['femedics', 'Femedics CRM'], ['inventario', 'Inventario'], ['movimientos', 'Movimientos'], ['facturacion', 'Facturación'],
  ['agenda', 'Agenda'], ['empleados', 'Empleados'], ['marketing', 'Marketing'], ['catalogos', 'Catálogos'], ['ofertas', 'Ofertas y Liquidación'], ['bodega', 'Bodega'],
  ['logistica', 'Logística'], ['importaciones', 'Importaciones'], ['servicio_tecnico', 'Servicio Técnico'], ['documentos_tecnicos', 'Documentos técnicos'],
  ['talento_humano', 'Talento Humano'], ['financiero', 'Financiero'],
]
/* Tabla unificada de permisos: un interruptor de "Acceso al módulo" (TOGGLES) se combina en la
   misma fila con sus acciones (crear/editar/eliminar/aprobar) en vez de mostrarse por separado. */
const VER_TOGGLE: Record<string, Tog> = Object.fromEntries(TOGGLES.filter((t) => t.mod && !t.col && !t.flag && (!t.acc || t.acc === 'ver')).map((t) => [t.mod!, t]))
const APROBAR_EXTRA: Record<string, Tog> = Object.fromEntries(TOGGLES.filter((t) => t.acc === 'aprobar' && t.mod).map((t) => [t.mod!, t]))
/* Cada permiso extra vive bajo el módulo al que pertenece de verdad (los leads son del CRM, el
   precio Femedics es de Femedics, etc.) y solo se muestra cuando ese módulo está habilitado —
   nunca más como una lista suelta de "otros accesos" sin relación con nada. */
const SUBMODULO: Record<string, Tog[]> = {
  crm: [
    { k: 'recibeLeads', t: 'Recibe leads de la web', d: 'Entra únicamente al reparto automático de leads de la web. No incluye mensajes de redes.', fondo: 'azul', col: 'recibe_leads' },
    { k: 'recibeMensajes', t: 'Recibe leads de mensajes de redes', d: 'Permiso independiente para Messenger, Instagram y WhatsApp. Creación automática pausada temporalmente en CRM Vimedic.', fondo: 'violeta', col: 'recibe_leads_mensajes' },
    { k: 'recibeMeta', t: 'Recibe clientes potenciales de Meta', d: 'Entra al reparto justo de los formularios de Facebook e Instagram. Sin este permiso no recibe ninguno.', fondo: 'naranja', col: 'recibe_clientes_meta' },
  ],
  inventario: [
    { k: 'inventarioVerMovimientos', t: 'Ver Movimientos del producto', mod: 'movimientos' },
    { k: 'inventarioMultimedia', t: 'Editar Multimedia', flag: 'inventarioMultimedia' },
    { k: 'adquisiciones', t: 'Acceso a Adquisiciones', d: 'Ingresos de mercadería (compras a proveedor que suben el stock).', flag: 'adquisiciones' },
  ],
  femedics: [
    { k: 'preciosFemedics', t: 'Inventario con precios Femedics', d: 'Ve y cotiza con el PVP subido 11.11 % (con 10 % de descuento vuelve al PVP VIMEDIC). Siempre activo si la empresa del empleado es solo Femedics (con «Ambas empresas» el +11.11 % se aplica en Femedics CRM).', flag: 'preciosFemedics' },
  ],
  marketing: [
    { k: 'marketingindicadores', t: 'Ver indicadores de Marketing', d: 'Pestañas Resumen y Anuncios del módulo Marketing (resultados, ventas, inversión). Sin este permiso solo ve el Planificador, Audiovisual, Biblioteca y Material.', flag: 'marketingindicadores' },
  ],
}

const titulo = (s: string) => s.replace(/(^|\s)([a-záéíóúñ])/g, (_m, a, b) => a + b.toUpperCase())
const iniciales = (n: string) => { const p = n.trim().split(' ').filter(Boolean); return p.length ? (p[0][0] + (p[1]?.[0] ?? '')).toUpperCase() : '?' }
const fechaCorta = (d: string | null) => (d ? d.split('-').reverse().join('/') : '')

function Interruptor({ on, onClick, chico, id }: { on: boolean; onClick: () => void; chico?: boolean; id?: string }) {
  const w = chico ? 'w-10 h-5' : 'w-11 h-6'
  return (
    <button type="button" id={id} onClick={onClick} className={`relative ${w} rounded-full transition-colors shrink-0`} style={{ background: on ? 'var(--teal)' : '#cbd5e1' }}>
      <span className={`absolute top-0.5 left-0.5 ${chico ? 'w-4 h-4' : 'w-5 h-5'} rounded-full bg-white shadow transition-transform`} style={{ transform: on ? 'translateX(20px)' : 'translateX(0)' }} />
    </button>
  )
}

/* ============================ Pantalla principal ============================ */
export default function Empleados({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [lista, setLista] = useState<Emp[] | null>(null)
  const [roles, setRoles] = useState<Rol[]>([])
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [editando, setEditando] = useState<Emp | 'nuevo' | null>(null)
  const [papelera, setPapelera] = useState(false)

  const cargar = useCallback(() => {
    supabase.from('empleados').select(COLS).is('deleted_at', null).order('nombre').limit(500)
      .then(({ data, error }) => { if (error) setError(error.message); else { setError(''); setLista((data as Emp[]) ?? []) } })
  }, [])
  useEffect(() => {
    cargar()
    supabase.from('roles').select('id,nombre,rol_crm,permisos').is('deleted_at', null).order('nombre').then(({ data }) => setRoles((data as Rol[]) ?? []))
  }, [cargar])

  const rolDe = (e: Emp) => roles.find((r) => r.id === e.rol_id)
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (lista ?? []).filter((e) => !t || [e.nombre, e.email, e.cargo, rolDe(e)?.nombre, e.cedula].join(' ').toLowerCase().includes(t))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, q, roles])

  return (
    <div>
      <header className="sticky top-0 z-30 border-b border-slate-200" style={{ background: 'linear-gradient(135deg, var(--navy), var(--primary))' }}>
        <div className="vm-head-pad max-w-6xl mx-auto px-4 sm:px-6 min-h-16 flex items-center justify-between gap-3 flex-wrap py-1.5">
          <h1 className="font-display font-bold text-sm text-white flex items-center gap-2"><Users className="w-5 h-5" /> Empleados</h1>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, correo, rol..." className="pl-8 pr-3 py-2 rounded-lg bg-white/10 text-white placeholder:text-white/50 text-xs w-48 sm:w-64 focus:outline-none focus:ring-2 focus:ring-white/40" />
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/60" />
            </div>
            {puede(perfil, 'empleados', 'eliminar') && (
              <button onClick={() => setPapelera(true)} className="bg-white/10 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 hover:bg-white/20 transition-colors shrink-0" title="Empleados eliminados"><Trash2 className="w-4 h-4" /> <span className="hidden sm:inline">Papelera</span></button>
            )}
            {puede(perfil, 'empleados', 'crear') && (
              <button onClick={() => setEditando('nuevo')} className="bg-white text-xs font-bold px-3.5 py-2 rounded-lg flex items-center gap-1.5 shadow-sm hover:bg-slate-50 transition-colors shrink-0" style={{ color: 'var(--primary)' }}><UserPlus className="w-4 h-4" /> <span className="hidden sm:inline">Nuevo Empleado</span></button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {error && <p className="text-xs text-red-600 col-span-full text-center py-6">Error cargando empleados: {error}</p>}
          {filtrados.map((e) => {
            const inactivo = e.estado !== 'activo'
            const empresa = e.preferencias?.ambasEmpresas ? 'AMBAS' : e.empresa
            return (
              <div key={e.id} onClick={() => setEditando(e)} className={'emp-card bg-white rounded-2xl border border-slate-200 p-4 flex items-start gap-3 ' + (inactivo ? 'opacity-60' : '')}>
                <Avatar e={e} />
                <div className="min-w-0 flex-grow">
                  <p className="font-display font-bold text-sm text-slate-800 truncate">{e.nombre || 'Sin nombre'}</p>
                  <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--primary)' }}>{e.cargo || rolDe(e)?.nombre || '—'}
                    {empresa !== 'VIMEDIC' && <> <span style={{ background: '#0cc4cf1f', color: '#0a9aa3', fontSize: 9.5, fontWeight: 800, padding: '1px 6px', borderRadius: 999 }}>{empresa}</span></>}</p>
                  <p className="text-[11px] text-slate-400 truncate mt-1">{e.email || '—'}</p>
                  {e.telefono && <p className="text-[11px] text-slate-400 truncate font-mono-spec">{e.telefono}</p>}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {inactivo && <span className="pill" style={{ background: '#fef2f2', color: 'var(--red)' }}>Inactivo</span>}
                    {e.cumpleanos && <span className="pill flex items-center gap-1" style={{ background: '#fffbeb', color: 'var(--amber)' }}><Cake className="w-2.5 h-2.5" />{fechaCorta(e.cumpleanos)}</span>}
                  </div>
                </div>
                <Pencil className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              </div>
            )
          })}
        </div>
        {lista === null && !error && <p className="text-center text-sm text-slate-400 py-16">Cargando empleados...</p>}
        {lista !== null && filtrados.length === 0 && <p className="text-center text-sm text-slate-400 py-16">Sin empleados que coincidan.</p>}
      </main>

      {editando && <Ficha perfil={perfil} emp={editando === 'nuevo' ? null : editando} lista={lista ?? []} roles={roles} cerrar={() => setEditando(null)} aviso={aviso} guardado={() => { setEditando(null); cargar() }} />}
      {papelera && <PapeleraEmp cerrar={() => setPapelera(false)} alRestaurar={cargar} aviso={aviso} />}
    </div>
  )
}

function Avatar({ e }: { e: Emp }) {
  const [falla, setFalla] = useState(false)
  const src = imagen(e.foto_url, 160)
  if (src && !falla) return <img loading="lazy" src={src} onError={() => setFalla(true)} className="w-14 h-14 rounded-full object-cover shrink-0 border border-slate-200" alt="" />
  return <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-display font-bold text-base shrink-0" style={{ background: 'var(--primary)' }}>{iniciales(e.nombre)}</div>
}

/* Una sola fila por módulo: interruptor de acceso (o "según su rol" si no tiene uno dedicado)
   + chips compactos de Crear/Editar/Eliminar/Aprobar — reemplaza las dos listas separadas de antes. */
function FilaModulo({ mod, nombre, tiene, delRol, cambiar, cambiarAcc }: {
  mod: string; nombre: string; tiene: (mod: string, acc: string) => boolean; delRol: (mod: string, acc: string) => boolean
  cambiar: (t: Tog) => void; cambiarAcc: (mod: string, acc: string) => void
}) {
  const entra = tiene(mod, 'ver')
  const bloqueadoVer = delRol(mod, 'ver')
  const t = VER_TOGGLE[mod]
  const puedeVer = !!t || mod === 'inventario'
  const aprobar = APROBAR_EXTRA[mod]
  const toggleVer = () => { if (bloqueadoVer) return; if (t) cambiar(t); else if (mod === 'inventario') cambiar({ k: 'inventarioModulo', t: '', mod: 'inventario' }) }
  const chip = (acc: string, letra: string, titulo: string, color: string) => {
    const on = tiene(mod, acc), bloqueado = delRol(mod, acc), dis = !entra || bloqueado
    return (
      <button key={acc} type="button" disabled={dis} title={!entra ? 'Primero dale acceso al módulo' : bloqueado ? 'Lo da su rol' : titulo} onClick={() => cambiarAcc(mod, acc)}
        className="w-[22px] h-[22px] text-[9.5px] font-bold rounded-full border transition-colors grid place-items-center shrink-0"
        style={{ ...(on ? { background: color, borderColor: color, color: '#fff' } : { background: '#fff', borderColor: '#cbd5e1', color: '#64748b' }), ...(dis ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }}>{letra}</button>
    )
  }
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-50">
      {puedeVer
        ? <span title={bloqueadoVer ? 'Lo da su rol' : undefined} className={bloqueadoVer ? 'opacity-60' : ''}><Interruptor chico on={entra} onClick={toggleVer} /></span>
        : <span className="w-10 h-5 shrink-0" />}
      <span className={'text-[11.5px] font-semibold min-w-0 flex-1 truncate ' + (entra ? 'text-slate-700' : 'text-slate-400')}>
        {nombre}{!puedeVer && <span className="font-normal text-slate-400"> · según su rol</span>}
      </span>
      <div className="flex gap-1 shrink-0">
        {chip('crear', 'C', 'Crear', 'var(--teal)')}
        {chip('editar', 'E', 'Editar', 'var(--teal)')}
        {chip('eliminar', 'X', 'Eliminar', '#dc2626')}
        {aprobar && chip('aprobar', 'A', 'Aprobar', '#7c3aed')}
      </div>
    </div>
  )
}

/* ============================ Nuevo / Editar empleado ============================ */
function Ficha({ perfil, emp, lista, roles, cerrar, guardado, aviso }: { perfil: Perfil; emp: Emp | null; lista: Emp[]; roles: Rol[]; cerrar: () => void; guardado: () => void; aviso: (t: string) => void }) {
  const v = (x: string | null | undefined) => x ?? ''
  const [f, setF] = useState({
    email: v(emp?.email), nombre: v(emp?.nombre), cedula: v(emp?.cedula), telefono: v(emp?.telefono), cargo: v(emp?.cargo), local: v(emp?.local), jefe: v(emp?.jefe_id),
    empresa: emp?.preferencias?.ambasEmpresas ? 'AMBAS' : (emp?.empresa ?? 'VIMEDIC'), correoPersonal: v(emp?.correo_personal), cumpleanos: v(emp?.cumpleanos), foto: v(emp?.foto_url),
    estado: emp?.estado ?? 'activo', rolId: v(emp?.rol_id),
  })
  const [extra, setExtra] = useState<Record<string, string[]>>(() => JSON.parse(JSON.stringify(emp?.permisos_extra ?? {})))
  const [flags, setFlags] = useState<Record<string, boolean>>(() => ({ ...(emp?.preferencias?.permisosFlags ?? {}) }))
  const [cols, setCols] = useState({ recibe_leads: !!emp?.recibe_leads, recibe_leads_mensajes: !!emp?.recibe_leads_mensajes, recibe_clientes_meta: !!emp?.recibe_clientes_meta })
  const [mk, setMk] = useState({ rol: v(emp?.preferencias?.marketing?.rol), directa: !!emp?.preferencias?.marketing?.directa, aprueba: !!emp?.preferencias?.marketing?.aprueba })
  const [accesoCrm, setAccesoCrm] = useState(!!emp?.rol_id)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [elim, setElim] = useState(false)
  const [fotoFalla, setFotoFalla] = useState(false)
  const [clave, setClave] = useState<{ valor: string; nuevo: boolean } | null>(null)
  const [generando, setGenerando] = useState(false)
  const [permBusq, setPermBusq] = useState('')
  const modsFiltrados = useMemo(() => {
    const t = permBusq.trim().toLowerCase()
    return t ? MODS_ACC.filter(([, nombre]) => nombre.toLowerCase().includes(t)) : MODS_ACC
  }, [permBusq])
  async function generarClave() {
    if (!emp) return
    setGenerando(true); setClave(null)
    const { data, error } = await supabase.functions.invoke('empleados-cuenta', { body: { empleadoId: emp.id } })
    setGenerando(false)
    if (error || (data as { error?: string })?.error) {
      let msg = (data as { error?: string })?.error || error?.message || 'No se pudo generar la contraseña.'
      try { const j = await (error as unknown as { context?: Response })?.context?.json?.(); if (j?.error) msg = j.error } catch { /* sin detalle */ }
      aviso(msg); return
    }
    const r = data as { clave: string; nuevo: boolean }
    setClave({ valor: r.clave, nuevo: r.nuevo })
    aviso(r.nuevo ? 'Cuenta de acceso creada.' : 'Contraseña actualizada.')
  }
  const set = (k: keyof typeof f, val: string) => setF((a) => ({ ...a, [k]: val }))
  const rol = roles.find((r) => r.id === f.rolId)
  const puedeEditar = puede(perfil, 'empleados', 'editar') || (!emp && puede(perfil, 'empleados', 'crear'))

  /* Estado efectivo de un interruptor = lo del rol + lo extra */
  const tiene = (mod: string, acc: string) => !!extra[mod]?.includes(acc) || !!rol?.permisos?.[mod]?.includes(acc)
  const delRol = (mod: string, acc: string) => !!rol?.permisos?.[mod]?.includes(acc)
  const estaOn = (t: Tog) => (t.col ? cols[t.col] : t.flag ? !!flags[t.flag] : tiene(t.mod!, t.acc ?? 'ver'))
  function cambiar(t: Tog) {
    if (t.col) { setCols((c) => ({ ...c, [t.col!]: !c[t.col!] })); return }
    if (t.flag) { setFlags((x) => ({ ...x, [t.flag!]: !x[t.flag!] })); return }
    const acc = t.acc ?? 'ver', mod = t.mod!
    if (!confirmarRiesgo(acc, !tiene(mod, acc))) return
    setExtra((x) => {
      const n = { ...x }; const act = new Set(n[mod] ?? [])
      if (act.has(acc)) { act.delete(acc); if (acc === 'ver') ['crear', 'editar', 'eliminar', 'aprobar', 'exportar'].forEach((a) => act.delete(a)) } else act.add(acc)
      if (acc !== 'ver' && act.size) act.add('ver')
      if (act.size) n[mod] = [...act]; else delete n[mod]
      return n
    })
  }
  function cambiarAcc(mod: string, acc: string) {
    if (!confirmarRiesgo(acc, !tiene(mod, acc))) return
    setExtra((x) => { const n = { ...x }; const act = new Set(n[mod] ?? []); if (act.has(acc)) act.delete(acc); else act.add(acc); if (act.size) n[mod] = [...act]; else delete n[mod]; return n })
  }
  const fila = (t: Tog, chico = false) => {
    const on = estaOn(t), porRol = !!t.mod && delRol(t.mod, t.acc ?? 'ver')
    if (chico) return (
      <div key={t.k} className="flex items-center justify-between bg-slate-50 rounded-lg p-2.5">
        <span className="text-[11px] font-semibold text-slate-600">{t.t}{porRol && <span className="font-normal text-slate-400"> · por rol</span>}</span>
        <Interruptor chico on={on} onClick={() => !porRol && cambiar(t)} />
      </div>
    )
    return (
      <div key={t.k} className={'flex items-center justify-between gap-3 rounded-lg p-3 mb-2.5 ' + (t.fondo ? '' : 'bg-slate-50')} style={t.fondo ? FONDOS[t.fondo] : undefined}>
        <span className="min-w-0"><span className="block text-xs font-semibold text-slate-700">{t.t}{porRol && <span className="font-normal text-slate-400"> · por el rol</span>}</span>
          {t.d && <span className="block text-[10px] text-slate-500 leading-snug mt-0.5">{t.d}</span>}</span>
        <Interruptor on={on} onClick={() => !porRol && cambiar(t)} />
      </div>
    )
  }

  async function guardar() {
    setError('')
    const email = f.email.trim().toLowerCase()
    if (!email) { setError('El correo institucional es obligatorio.'); return }
    if (!f.nombre.trim()) { setError('El nombre es obligatorio.'); return }
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError('El correo no es válido.'); return }
    setGuardando(true)
    const fila = {
      email, nombre: f.nombre.trim(), cedula: f.cedula || null, telefono: f.telefono || null, cargo: f.cargo.trim() || null, local: f.local.trim() || null,
      jefe_id: f.jefe || null, empresa: f.empresa === 'AMBAS' ? 'VIMEDIC' : f.empresa, correo_personal: f.correoPersonal.trim().toLowerCase() || null, cumpleanos: f.cumpleanos || null,
      foto_url: f.foto.trim() || null, estado: f.estado, rol_id: accesoCrm ? f.rolId || null : null, permisos_extra: extra,
      recibe_leads: cols.recibe_leads, recibe_leads_mensajes: cols.recibe_leads_mensajes, recibe_clientes_meta: cols.recibe_clientes_meta,
      preferencias: { ...(emp?.preferencias ?? {}), ambasEmpresas: f.empresa === 'AMBAS', permisosFlags: flags, marketing: mk },
    }
    const r = emp
      ? await supabase.from('empleados').update(fila).eq('id', emp.id)
      : await supabase.from('empleados').insert({ id: crypto.randomUUID(), codigo: 'EMP-' + crypto.randomUUID().slice(0, 6).toUpperCase(), ...fila })
    setGuardando(false)
    if (r.error) { setError(/duplicate|unique/i.test(r.error.message) ? 'Ya existe un empleado con ese correo.' : r.error.message); return }
    aviso(emp ? 'Empleado actualizado.' : 'Empleado creado. Crea su cuenta de acceso en Supabase Auth con ese correo para que pueda iniciar sesión.')
    guardado()
  }

  async function eliminar(motivo: string) {
    if (!emp) return
    const { error } = await supabase.from('empleados').update({ deleted_at: new Date().toISOString(), motivo_eliminacion: motivo || null }).eq('id', emp.id)
    if (error) { aviso('No se pudo eliminar: ' + error.message); return }
    setElim(false); aviso('Empleado enviado a la Papelera.'); guardado()
  }

  /* Offboarding en un solo click: limpia rol y permisos extra, y desactiva — en vez de desmarcar casilla por casilla. */
  async function revocarAccesos() {
    if (!emp) return
    if (!confirm(`¿Revocar todos los accesos de ${f.nombre || f.email}? Pierde su rol y todos sus permisos extra, y queda inactivo. No se elimina su ficha.`)) return
    const { error } = await supabase.from('empleados').update({ rol_id: null, permisos_extra: {}, estado: 'inactivo' }).eq('id', emp.id)
    if (error) { aviso('No se pudo revocar: ' + error.message); return }
    aviso('Accesos revocados.'); guardado()
  }

  const campo = 'w-full border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-2'
  const ring = { ['--tw-ring-color' as string]: 'var(--cyan)' }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className={'modal-panel bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[92vh] flex flex-col overflow-hidden ' + (emp ? 'sm:max-w-6xl' : 'sm:max-w-2xl')}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 className="font-display font-bold text-sm text-slate-800">{emp ? 'Editar Empleado' : 'Nuevo Empleado'}</h3>
          <button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex items-center gap-3 mb-4">
            {f.foto && !fotoFalla
              ? <img src={imagen(f.foto, 160)} onError={() => setFotoFalla(true)} className="w-16 h-16 rounded-full object-cover border border-slate-200 shrink-0" alt="" />
              : <div className="w-16 h-16 rounded-full flex items-center justify-center text-white font-display font-bold text-lg shrink-0" style={{ background: 'var(--primary)' }}>{f.nombre ? iniciales(f.nombre) : '?'}</div>}
            <div className="flex-grow">
              <label className="block text-xs font-bold mb-1">Foto del empleado</label>
              <input type="text" value={f.foto} onChange={(e) => { set('foto', e.target.value); setFotoFalla(false) }} placeholder="Enlace de la imagen (la carga de archivos se activa con el almacenamiento)" className="w-full border border-slate-200 rounded-lg p-2 text-xs" />
              <p className="text-xs text-slate-500 mt-1">JPG, PNG, WEBP o GIF · Máximo 8 MB</p>
            </div>
          </div>

          <div className={'grid grid-cols-1 sm:grid-cols-2 gap-2.5 ' + (emp ? 'lg:grid-cols-4' : '')}>
            <input type="email" value={f.email} onChange={(e) => set('email', e.target.value.toLowerCase())} placeholder="Correo institucional (obligatorio) *" className={campo + ' sm:col-span-2'} style={ring} />
            <input type="text" value={f.nombre} onChange={(e) => set('nombre', titulo(e.target.value))} placeholder="Nombre completo *" className={campo + ' sm:col-span-2'} style={ring} />
            <input type="text" inputMode="numeric" value={f.cedula} onChange={(e) => set('cedula', e.target.value.replace(/\D/g, ''))} placeholder="Cédula" className={campo} style={ring} />
            <input type="text" inputMode="numeric" value={f.telefono} onChange={(e) => set('telefono', e.target.value.replace(/\D/g, ''))} placeholder="Teléfono" className={campo} style={ring} />
            <input type="text" value={f.cargo} onChange={(e) => set('cargo', titulo(e.target.value))} placeholder="Rol / Área (ej. Comercial)" className={campo} style={ring} />
            <input type="text" value={f.local} onChange={(e) => set('local', titulo(e.target.value))} placeholder="Local (ej. Matriz)" className={campo} style={ring} />
            <select value={f.jefe} onChange={(e) => set('jefe', e.target.value)} className={campo + ' bg-white'} style={ring} title="Jefe inmediato">
              <option value="">Jefe inmediato</option>
              {lista.filter((x) => x.id !== emp?.id).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
            <select value={f.empresa} onChange={(e) => set('empresa', e.target.value)} className={campo + ' bg-white'} style={ring} title="Empresa del empleado">
              <option value="VIMEDIC">Empresa: Importaciones Médicas Richard</option>
              <option value="FEMEDICS">Empresa: Femedics Importaciones Médicas (precios +11.11 %)</option>
              <option value="AMBAS">Empresa: Ambas empresas</option>
            </select>
            <input type="email" value={f.correoPersonal} onChange={(e) => set('correoPersonal', e.target.value.toLowerCase())} placeholder="Correo personal (opcional)" className={campo} style={ring} />
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Cumpleaños</label>
              <input type="date" value={f.cumpleanos} onChange={(e) => set('cumpleanos', e.target.value)} className={campo} style={ring} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Estado</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(['activo', 'inactivo'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => set('estado', s)} className={'emp-estado-btn text-[11px] font-bold py-2 rounded-lg border' + (f.estado === s ? ' active' : '')}>{s === 'activo' ? 'Activo' : 'Inactivo'}</button>
                ))}
              </div>
            </div>
          </div>

          {emp && (
            <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
              {/* Columna izquierda: cuenta + accesos secundarios (más corta, no crece con la lista de módulos) */}
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase mb-2">Acceso al CRM</p>
                  <div className="flex items-center justify-between bg-slate-50 rounded-lg p-2.5 mb-2">
                    <span className="text-xs font-semibold text-slate-700">¿Puede entrar al CRM?</span>
                    <Interruptor chico on={accesoCrm} onClick={() => setAccesoCrm((a) => !a)} />
                  </div>
                  {accesoCrm && (
                    <select value={f.rolId} onChange={(e) => set('rolId', e.target.value)} className={campo + ' bg-white mb-2'} style={ring}>
                      <option value="">Selecciona un rol</option>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}{r.rol_crm ? ' · ' + r.rol_crm : ''}</option>)}
                    </select>
                  )}
                  <button type="button" onClick={generarClave} disabled={generando} className="w-full text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-60">
                    {generando ? 'Generando…' : emp.auth_user_id ? 'Generar contraseña nueva' : 'Crear cuenta de acceso'}
                  </button>
                  <p className="text-[10px] text-slate-400 mt-1">{emp.auth_user_id ? 'Cuenta vinculada' : 'Todavía sin cuenta de acceso'}</p>
                  {clave && (
                    <div className="mt-2 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                      <div className="min-w-0">
                        <p className="text-[9px] font-bold text-amber-700 uppercase">{clave.nuevo ? 'Cuenta creada' : 'Contraseña nueva'} · una vez</p>
                        <code className="text-xs font-bold text-slate-800 select-all">{clave.valor}</code>
                      </div>
                      <button type="button" onClick={() => { navigator.clipboard?.writeText(clave.valor); aviso('Contraseña copiada.') }} className="ml-auto text-[9px] font-semibold px-2 py-1 rounded-md border border-amber-300 bg-white hover:bg-amber-100 shrink-0">Copiar</button>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase mb-2">Dashboard Ejecutivo</p>
                  {fila(TOGGLES.find((t) => t.k === 'dashboardEjecutivo')!, true)}
                </div>

                {tiene('marketing', 'ver') && (
                  <div className="bg-slate-50 rounded-lg p-2.5 space-y-2">
                    <p className="text-[11px] font-bold text-slate-500 uppercase -mb-0.5">Marketing</p>
                    <label className="block"><span className="block text-[11px] font-semibold text-slate-700" title="Coordinación aprueba; Asistente y Audiovisual envían a aprobación lo importante (nombre, especificaciones, visible al público y publicaciones).">Rol en Marketing</span>
                      <select value={mk.rol} onChange={(e) => setMk({ ...mk, rol: e.target.value })} className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] bg-white">
                        <option value="">Sin rol (Asistente)</option><option>Coordinación</option><option>Asistente</option><option>Audiovisual</option>
                      </select></label>
                    <label className="flex items-center gap-2 text-[10.5px] font-semibold text-slate-600" title="Sus cambios salen sin esperar; Coordinación los revisa después"><input type="checkbox" checked={mk.directa} onChange={(e) => setMk({ ...mk, directa: e.target.checked })} className="w-3.5 h-3.5" />Publicación directa</label>
                    <label className="flex items-center gap-2 text-[10.5px] font-semibold text-slate-600" title="Ve márgenes, edita porcentajes y aprueba campañas como Black Friday"><input type="checkbox" checked={mk.aprueba} onChange={(e) => setMk({ ...mk, aprueba: e.target.checked })} className="w-3.5 h-3.5" />Aprueba promociones</label>
                  </div>
                )}
              </div>

              {/* Columna derecha: tabla única de módulos — acceso + qué puede hacer, en una sola fila cada uno */}
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[11px] font-bold text-slate-500 uppercase">Permisos por módulo</p>
                  <span className="text-[10px] font-bold text-slate-400 shrink-0">{modsFiltrados.filter(([mod]) => tiene(mod, 'ver')).length}/{MODS_ACC.length} con acceso</span>
                </div>
                <div className="relative mb-2">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
                  <input type="text" value={permBusq} onChange={(e) => setPermBusq(e.target.value)} placeholder="Buscar módulo…" className="w-full border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs focus:outline-none focus:ring-2" style={ring} />
                </div>
                <p className="text-[10px] text-slate-400 mb-2 leading-snug">Ver se activa con el interruptor (o lo da el rol). Eliminar no borra de la base: queda en la Papelera.</p>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="grid grid-cols-[1fr_auto] items-center gap-2 px-2.5 py-1.5 bg-slate-50 border-b border-slate-200 text-[9.5px] font-bold text-slate-400 uppercase">
                    <span>Módulo</span><span>Crear · Editar · Eliminar{Object.keys(APROBAR_EXTRA).length ? ' · Aprobar' : ''}</span>
                  </div>
                  <div className="max-h-[52vh] overflow-y-auto divide-y divide-slate-100">
                    {modsFiltrados.map(([mod, nombre]) => (
                      <div key={mod}>
                        <FilaModulo mod={mod} nombre={nombre} tiene={tiene} delRol={delRol} cambiar={cambiar} cambiarAcc={cambiarAcc} />
                        {/* Permisos propios del módulo (leads del CRM, precio Femedics, etc.): solo aparecen con el módulo habilitado */}
                        {SUBMODULO[mod] && tiene(mod, 'ver') && (
                          <div className="pl-9 pr-2.5 pb-1.5 space-y-1">
                            {SUBMODULO[mod].map((t) => fila(t, true))}
                          </div>
                        )}
                      </div>
                    ))}
                    {modsFiltrados.length === 0 && <p className="text-center text-xs text-slate-400 py-6">Sin módulos que coincidan.</p>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 p-4 flex gap-2 items-center">
          {error && <p className="text-[11px] font-semibold flex-1" style={{ color: '#c0392b' }}>{error}</p>}
          {emp && puede(perfil, 'empleados', 'eliminar') && (
            <button type="button" onClick={revocarAccesos} title="Para offboarding: quita rol y permisos extra, y desactiva, en un solo paso" className="text-xs font-bold px-3.5 py-2.5 rounded-lg border flex items-center gap-1.5" style={{ borderColor: '#fde68a', color: '#92400e', background: '#fffbeb' }}><ShieldOff className="w-3.5 h-3.5" />Revocar accesos</button>
          )}
          {emp && puede(perfil, 'empleados', 'eliminar') && (
            <button type="button" onClick={() => setElim(true)} className="text-xs font-bold px-3.5 py-2.5 rounded-lg border flex items-center gap-1.5" style={{ borderColor: '#fecaca', color: '#b91c1c', background: '#fff5f5' }}><Trash2 className="w-3.5 h-3.5" />Eliminar</button>
          )}
          <button onClick={guardar} disabled={guardando || !puedeEditar} className={'text-white text-xs font-bold py-2.5 rounded-lg disabled:opacity-60 ' + (error ? 'px-6' : 'flex-1 w-full')} style={{ background: 'var(--primary)' }}>{guardando ? 'Guardando...' : 'Guardar Empleado'}</button>
        </div>
      </div>
      {elim && <ConfirmarEliminar titulo={`¿Eliminar a ${f.nombre || f.email}?`} detalle="Pierde todos sus accesos (no podrá iniciar sesión) y deja de aparecer en las listas. Su ficha no se borra: se puede restaurar desde la Papelera de Empleados." ok={eliminar} cerrar={() => setElim(false)} />}
    </div>
  )
}

/* ============================ Papelera de empleados ============================ */
function PapeleraEmp({ cerrar, alRestaurar, aviso }: { cerrar: () => void; alRestaurar: () => void; aviso: (t: string) => void }) {
  const [items, setItems] = useState<{ id: string; nombre: string; email: string; deleted_at: string; motivo_eliminacion: string | null }[] | null>(null)
  const [ocupado, setOcupado] = useState('')
  useEffect(() => {
    supabase.from('empleados').select('id,nombre,email,deleted_at,motivo_eliminacion').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(100).then(({ data }) => setItems((data as never) ?? []))
  }, [])
  async function restaurar(id: string) {
    setOcupado(id)
    const { error } = await supabase.from('empleados').update({ deleted_at: null, motivo_eliminacion: null }).eq('id', id)
    setOcupado('')
    if (error) { aviso('No se pudo restaurar: ' + error.message); return }
    setItems((a) => (a ?? []).filter((x) => x.id !== id)); alRestaurar()
  }
  return (
    <div className="vmpap-fondo" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="vmpap" role="dialog" aria-modal="true">
        <div className="vmpap-h"><b>Papelera · Empleados<small>Lo eliminado no se borra de la base: aquí puedes devolverlo a la app.</small></b><button className="vmpap-x" aria-label="Cerrar" onClick={cerrar}>×</button></div>
        <div className="vmpap-b">
          {items === null && <div className="vmpap-v">Cargando…</div>}
          {items?.length === 0 && <div className="vmpap-v">La papelera está vacía.</div>}
          {items?.map((x) => (
            <div key={x.id} className="vmpap-i">
              <div className="vmpap-t"><p className="d"><span className="tg">Empleado</span>{x.nombre} · {x.email}</p>
                <p className="m">Eliminado · {new Date(x.deleted_at).toLocaleString('es-EC', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                {x.motivo_eliminacion && <p className="m">Motivo: {x.motivo_eliminacion}</p>}</div>
              <button className="vmpap-r" disabled={ocupado === x.id} onClick={() => restaurar(x.id)}>{ocupado === x.id ? 'Restaurando…' : 'Restaurar'}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
