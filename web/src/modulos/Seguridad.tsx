import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { BadgeCheck, Check, ClipboardCheck, Crown, Download, Grid3x3, LogOut, Lock, MonitorSmartphone, Pencil, Plus, RefreshCw, Save, ScrollText, Search, Settings2, ShieldCheck, Unlock, Users, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import '../estilos/seguridad.css'

/* ============================ Tipos y catálogos ============================ */
type Usuario = {
  id: string; email: string; nombre: string; estado: string; cargo: string | null; departamento: string | null; jefe: string | null
  rol_id: string | null; rol: string | null; alcance: string | null; superadmin: boolean; empleados_admin: boolean; modulos: string[]
  sesiones: number; ultimo_ingreso: string | null
}
type Rol = { id: string; nombre: string; descripcion: string | null; rol_crm: string | null; permisos: Record<string, string[]>; alcance: string; es_superadmin: boolean; es_sistema: boolean }
type Sesion = { id: string; email: string; nombre: string; creada: string; ultimo_uso: string | null; vence: string | null; dispositivo: string | null; ip: string | null }
type Fila = { id: string; email: string; nombre: string; superadmin: boolean; permisos: Record<string, string[]> }
type Evento = { id: number; fecha: string; usuario_email: string | null; modulo: string | null; accion: string | null; registro: string | null; resultado: string | null; detalle: string | null }
type Filtros = { desde: string; hasta: string; usuario: string; modulo: string; resultado: string; q: string }

const MODULOS: { k: string; t: string }[] = [
  { k: 'crm', t: 'CRM' }, { k: 'clientes', t: 'Clientes' }, { k: 'femedics', t: 'Femedics CRM' }, { k: 'inventario', t: 'Inventario' }, { k: 'movimientos', t: 'Movimientos' },
  { k: 'facturacion', t: 'Facturación' }, { k: 'agenda', t: 'Mi Agenda' }, { k: 'empleados', t: 'Empleados' }, { k: 'dashboard', t: 'Dashboard Ejecutivo' },
  { k: 'marketing', t: 'Marketing' }, { k: 'catalogos', t: 'Catálogos' }, { k: 'ofertas', t: 'Ofertas y Liquidación' }, { k: 'promociones', t: 'Promociones' },
  { k: 'documentos_tecnicos', t: 'Documentos técnicos' }, { k: 'bodega', t: 'Bodega' }, { k: 'logistica', t: 'Logística' }, { k: 'importaciones', t: 'Importaciones' },
  { k: 'servicio_tecnico', t: 'Servicio Técnico' }, { k: 'talento_humano', t: 'Talento Humano' }, { k: 'financiero', t: 'Financiero' }, { k: 'seguridad', t: 'Seguridad y Auditoría' }, { k: 'basedatos', t: 'Bases de Datos' },
]
const ACCIONES = ['ver', 'crear', 'editar', 'eliminar', 'aprobar', 'exportar', 'ver_todos', 'ver_costos', 'respaldar', 'restaurar', 'administrar']
const ALCANCES: [string, string][] = [['propio', 'Propio'], ['departamento', 'Departamento'], ['subordinados', 'Subordinados'], ['organizacion', 'Organización']]
const ROLES_CRM = ['Asesor', 'Supervisor Comercial', 'Alta Dirección', 'Marketing']
const MODULOS_BIT = ['login', 'sesiones', 'empleados', 'seguridad', 'basedatos', 'crm', 'inventario', 'facturacion', 'marketing', 'agenda', 'sistema', 'web']
const TABS: [string, string, typeof Users][] = [
  ['usuarios', 'Usuarios', Users], ['roles', 'Roles', BadgeCheck], ['matriz', 'Matriz de permisos', Grid3x3],
  ['sesiones', 'Sesiones activas', MonitorSmartphone], ['bitacora', 'Bitácora', ScrollText], ['revision', 'Revisión de privilegios', ClipboardCheck],
]
const tituloMod = (k: string) => MODULOS.find((m) => m.k === k)?.t ?? k
const nombreAlcance = (a: string | null) => ALCANCES.find((x) => x[0] === a)?.[1] ?? a ?? ''
const bloqueado = (e: string) => /bloque|inactiv/i.test(e)
const fecha = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? String(iso) : d.toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) }
const msg = (e: unknown) => String((e as { message?: string })?.message ?? e ?? '').replace(/^(Exception|Error):\s*/i, '')
const Cargando = () => <div className="text-center py-12 text-slate-400"><span className="spin" /> Cargando…</div>
const Falla = ({ t }: { t: string }) => <div className="card text-center text-sm text-red-700">{t}</div>
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

type Dialogo = { tipo: 'confirmar'; titulo: string; texto: string; rojo?: boolean; res: (v: boolean) => void } | { tipo: 'clave'; res: (v: string) => void }

/* ============================ Módulo ============================ */
export default function Seguridad({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const admin = puede(perfil, 'seguridad', 'administrar')
  const superadmin = perfil.es_superadmin
  const [tab, setTab] = useState('usuarios')
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null)
  const [roles, setRoles] = useState<Rol[] | null>(null)
  const [error, setError] = useState('')
  const [dlg, setDlg] = useState<Dialogo | null>(null)
  const [verUsuario, setVerUsuario] = useState<Usuario | null>(null)
  const [verRol, setVerRol] = useState<Rol | 'nuevo' | null>(null)
  const [bit, setBit] = useState<Filtros>({ desde: '', hasta: '', usuario: '', modulo: '', resultado: '', q: '' })

  const cargar = useCallback(async () => {
    setUsuarios(null); setError('')
    try { setUsuarios(await rpc<Usuario[]>('seg_usuarios')) } catch (e) { setError(msg(e)) }
  }, [])
  const cargarRoles = useCallback(async () => {
    const { data, error: er } = await supabase.from('roles').select('id,nombre,descripcion,rol_crm,permisos,alcance,es_superadmin,es_sistema').is('deleted_at', null).order('nombre')
    if (er) throw new Error(er.message)
    setRoles((data as Rol[]) ?? [])
  }, [])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { if (tab === 'roles' || verUsuario) cargarRoles().catch((e) => aviso(msg(e))) }, [tab, verUsuario, cargarRoles, aviso])

  const confirmar = (titulo: string, texto: string, rojo?: boolean) => new Promise<boolean>((res) => setDlg({ tipo: 'confirmar', titulo, texto, rojo, res }))
  /** Acciones críticas: se vuelve a pedir la contraseña (se verifica contra Supabase Auth). */
  const reautenticar = async () => {
    const pw = await new Promise<string>((res) => setDlg({ tipo: 'clave', res }))
    if (!pw) throw new Error('Acción cancelada.')
    const { error: er } = await supabase.auth.signInWithPassword({ email: perfil.email, password: pw })
    if (er) throw new Error('La contraseña no es correcta.')
  }

  const sub = (superadmin ? 'Superadministrador' : admin ? 'Administrador' : 'Solo lectura') + ' · ' + perfil.email

  return (
    <div className="vm-seg">
      <header className="hdr text-white">
        <div className="max-w-[1250px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><ShieldCheck /></div>
          <div className="min-w-0"><h1 className="font-display font-bold text-lg leading-tight">Seguridad y Auditoría</h1><p className="text-[11px] text-white/70">{sub}</p></div>
          <button className="btn ml-auto !bg-white/10 !border-white/20 !text-white" onClick={() => { setRoles(null); cargar() }}><RefreshCw /><span className="hidden sm:inline">Actualizar</span></button>
        </div>
      </header>
      <main className="max-w-[1250px] mx-auto px-4 py-4 space-y-3">
        <div className="tabs">
          {TABS.map(([k, t, Ic]) => <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}><Ic />{t}</button>)}
        </div>
        <div>
          {error ? <Falla t={error} /> : tab === 'usuarios' ? (
            usuarios ? <PUsuarios usuarios={usuarios} admin={admin} abrir={setVerUsuario} /> : <Cargando />
          ) : tab === 'roles' ? (
            roles ? <PRoles roles={roles} superadmin={superadmin} editar={setVerRol} /> : <Cargando />
          ) : tab === 'matriz' ? <PMatriz /> : tab === 'sesiones' ? <PSesiones admin={admin} aviso={aviso} /> : tab === 'bitacora' ? (
            <PBitacora filtros={bit} setFiltros={setBit} aviso={aviso} />
          ) : <PRevision admin={admin} aviso={aviso} />}
        </div>
      </main>

      {verUsuario && usuarios && (
        <ModalUsuario u={verUsuario} roles={roles ?? []} superadmin={superadmin} haySuperadmin={usuarios.some((x) => x.superadmin)} yo={perfil.id}
          cerrar={() => setVerUsuario(null)} aviso={aviso} confirmar={confirmar} reautenticar={reautenticar} recargar={() => { setVerUsuario(null); cargar() }} />
      )}
      {verRol && <ModalRol r={verRol === 'nuevo' ? null : verRol} cerrar={() => setVerRol(null)} aviso={aviso} guardado={() => { setVerRol(null); cargarRoles() }} />}
      {dlg?.tipo === 'confirmar' && (
        <div className="ovl"><div className="modal" style={{ maxWidth: 420 }}>
          <h3 className="font-display font-bold text-base mb-1">{dlg.titulo}</h3><p className="text-sm text-slate-600 mb-3">{dlg.texto}</p>
          <div className="flex justify-end gap-2"><button className="btn" onClick={() => { dlg.res(false); setDlg(null) }}>Cancelar</button><button className={'btn ' + (dlg.rojo ? 'btn-r' : 'btn-p')} onClick={() => { dlg.res(true); setDlg(null) }}>Confirmar</button></div>
        </div></div>
      )}
      {dlg?.tipo === 'clave' && <PedirClave res={(v) => { dlg.res(v); setDlg(null) }} />}
    </div>
  )
}

function PedirClave({ res }: { res: (v: string) => void }) {
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

/* ============================ Usuarios ============================ */
function PUsuarios({ usuarios, admin, abrir }: { usuarios: Usuario[]; admin: boolean; abrir: (u: Usuario) => void }) {
  const [q, setQ] = useState('')
  const t = q.toLowerCase()
  const lista = usuarios.filter((u) => !t || [u.nombre, u.email, u.rol, u.cargo, u.estado].join(' ').toLowerCase().includes(t))
  const sesiones = usuarios.reduce((a, u) => a + u.sesiones, 0)
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div className="kpi"><b>{usuarios.length}</b><span>Usuarios</span></div>
        <div className="kpi"><b>{usuarios.filter((u) => u.superadmin).length}</b><span>Superadministradores</span></div>
        <div className="kpi"><b>{sesiones}</b><span>Sesiones activas</span></div>
        <div className="kpi"><b>{usuarios.filter((u) => bloqueado(u.estado)).length}</b><span>Bloqueados o inactivos</span></div>
      </div>
      {!usuarios.some((u) => u.superadmin) && <div className="card mb-3" style={{ borderColor: '#fde68a', background: '#fffbeb' }}><p className="text-sm text-amber-800"><b>Aún no hay Superadministrador.</b> Nómbralo desde aquí para que solo esa persona pueda dar el módulo Empleados y tocar a otros administradores.</p></div>}
      <div className="card !p-3 mb-3"><input className="inp" placeholder="Buscar nombre, correo, rol…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="tw"><table className="t"><thead><tr><th>Persona</th><th>Estado</th><th>Rol del sistema</th><th>Módulos</th><th>Sesiones</th><th>Último ingreso</th><th /></tr></thead><tbody>
        {lista.map((u) => (
          <tr key={u.id}>
            <td><b>{u.nombre || '—'}</b>{u.superadmin && <> <span className="pill bl">Superadmin</span></>}{u.empleados_admin && !u.superadmin && <> <span className="pill gr">Admin. Empleados</span></>}<div className="text-[11px] text-slate-500">{u.email}</div></td>
            <td><span className={'pill ' + (bloqueado(u.estado) ? 'no' : 'ok')}>{u.estado ? u.estado[0].toUpperCase() + u.estado.slice(1) : 'Activo'}</span></td>
            <td>{u.rol || '—'}{u.alcance && <div className="text-[11px] text-slate-500">Alcance: {nombreAlcance(u.alcance)}</div>}</td>
            <td className="text-[11px] text-slate-600">{u.modulos.map(tituloMod).join(', ') || '—'}</td>
            <td>{u.sesiones}</td><td className="text-[11px]">{fecha(u.ultimo_ingreso)}</td>
            <td className="whitespace-nowrap">{admin && <button className="btn !py-1 !px-2" title="Administrar" onClick={() => abrir(u)}><Settings2 /></button>}</td>
          </tr>
        ))}
        {!lista.length && <tr><td colSpan={7} className="text-center text-slate-400 py-6">Sin resultados</td></tr>}
      </tbody></table></div>
    </>
  )
}

function ModalUsuario({ u, roles, superadmin, haySuperadmin, yo, cerrar, aviso, confirmar, reautenticar, recargar }: {
  u: Usuario; roles: Rol[]; superadmin: boolean; haySuperadmin: boolean; yo: string; cerrar: () => void; aviso: (t: string) => void
  confirmar: (t: string, x: string, rojo?: boolean) => Promise<boolean>; reautenticar: () => Promise<void>; recargar: () => void
}) {
  const [rolId, setRolId] = useState(u.rol_id ?? '')
  const [ocupado, setOcupado] = useState(false)
  const bloq = bloqueado(u.estado)
  const hacer = async (fn: () => Promise<unknown>, ok: string) => {
    setOcupado(true)
    try { await fn(); aviso(ok); recargar() } catch (e) { aviso(msg(e)); setOcupado(false) }
  }
  return (
    <div className="ovl" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="modal">
        <div className="flex items-start gap-2 mb-3">
          <div className="min-w-0"><h3 className="font-display font-bold text-base">{u.nombre || u.email}</h3><p className="text-xs text-slate-500">{u.email}</p></div>
          <button className="btn ml-auto !p-2" onClick={cerrar}><X /></button>
        </div>
        <label className="f">Asignar rol
          <select className="inp" value={rolId} onChange={(e) => setRolId(e.target.value)}>
            <option value="">— Elegir —</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre} · {nombreAlcance(r.alcance)}</option>)}
          </select>
        </label>
        <p className="text-[11px] text-slate-500 mt-1">Aplica los permisos del rol a la persona. No puedes dar permisos que tú no tienes.</p>
        <div className="flex flex-wrap gap-2 mt-4">
          <button className="btn btn-p" disabled={ocupado} onClick={() => { if (!rolId) { aviso('Elige un rol.'); return } hacer(async () => { await reautenticar(); await rpc('seg_asignar_rol', { p_empleado: u.id, p_rol: rolId }) }, 'Rol aplicado') }}><Check />Aplicar rol</button>
          <button className="btn" disabled={ocupado} onClick={async () => { if (await confirmar('Cerrar sesiones', 'Se cerrarán todas las sesiones abiertas de ' + u.email + '.')) hacer(() => rpc('seg_cerrar_sesiones_de', { p_empleado: u.id }), 'Sesiones cerradas') }}><LogOut />Cerrar sus sesiones ({u.sesiones})</button>
          {u.id !== yo && (
            <button className={'btn ' + (bloq ? '' : 'btn-r')} disabled={ocupado} onClick={async () => {
              if (bloq) { hacer(() => rpc('seg_bloquear', { p_empleado: u.id, p_bloquear: false, p_motivo: '' }), 'Cuenta desbloqueada'); return }
              if (await confirmar('Bloquear cuenta', 'La persona no podrá entrar y se cerrarán sus sesiones. Puedes desbloquearla después.', true)) hacer(() => rpc('seg_bloquear', { p_empleado: u.id, p_bloquear: true, p_motivo: 'Desde Seguridad' }), 'Cuenta bloqueada')
            }}>{bloq ? <Unlock /> : <Lock />}{bloq ? 'Desbloquear' : 'Bloquear cuenta'}</button>
          )}
          {(superadmin || !haySuperadmin) && (
            <button className="btn" disabled={ocupado} onClick={async () => {
              if (await confirmar(u.superadmin ? 'Quitar Superadministrador' : 'Nombrar Superadministrador', u.superadmin ? 'Dejará de tener control total.' : 'Tendrá control total: Empleados, Seguridad y Bases de Datos.', !u.superadmin)) hacer(async () => { await reautenticar(); await rpc('seg_superadmin', { p_empleado: u.id, p_valor: !u.superadmin }) }, 'Listo')
            }}><Crown />{u.superadmin ? 'Quitar Superadministrador' : 'Nombrar Superadministrador'}</button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ============================ Roles ============================ */
function PRoles({ roles, superadmin, editar }: { roles: Rol[]; superadmin: boolean; editar: (r: Rol | 'nuevo') => void }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="text-sm text-slate-600 flex-1">Cada rol define qué puede hacer en cada módulo y su alcance (propio, departamento, subordinados u organización).</p>
        {superadmin && <button className="btn btn-p" onClick={() => editar('nuevo')}><Plus />Nuevo rol</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {roles.map((r) => (
          <div key={r.id} className="card">
            <div className="flex items-start gap-2">
              <div className="min-w-0"><b className="font-display">{r.nombre}</b>{r.es_superadmin && <> <span className="pill bl">Superadmin</span></>}<p className="text-xs text-slate-500">{r.descripcion}</p></div>
              {superadmin && <button className="btn !p-2 ml-auto" onClick={() => editar(r)}><Pencil /></button>}
            </div>
            <div className="flex flex-wrap gap-1 mt-2"><span className="pill gr">Alcance: {nombreAlcance(r.alcance)}</span>{r.rol_crm && <span className="pill gr">CRM: {r.rol_crm}</span>}</div>
            <div className="text-[11px] text-slate-600 mt-2 space-y-0.5">
              {Object.keys(r.permisos ?? {}).map((k) => <div key={k}><b>{tituloMod(k)}:</b> {r.permisos[k].join(', ')}</div>)}
              {!Object.keys(r.permisos ?? {}).length && (r.es_superadmin ? 'Control total' : '—')}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function ModalRol({ r, cerrar, aviso, guardado }: { r: Rol | null; cerrar: () => void; aviso: (t: string) => void; guardado: () => void }) {
  const [nombre, setNombre] = useState(r?.nombre ?? '')
  const [desc, setDesc] = useState(r?.descripcion ?? '')
  const [alcance, setAlcance] = useState(r?.alcance ?? 'propio')
  const [crm, setCrm] = useState(r?.rol_crm ?? '')
  const [sa, setSa] = useState(!!r?.es_superadmin)
  const [perm, setPerm] = useState<Record<string, string[]>>(() => JSON.parse(JSON.stringify(r?.permisos ?? {})))
  const [ocupado, setOcupado] = useState(false)
  const alternar = (m: string, a: string) => setPerm((p) => {
    const act = new Set(p[m] ?? []); if (act.has(a)) act.delete(a); else act.add(a)
    const lista = [...act]; const n = { ...p }
    if (lista.length) { if (!lista.includes('ver')) lista.unshift('ver'); n[m] = ACCIONES.filter((x) => lista.includes(x)) } else delete n[m]
    return n
  })
  const guardar = async () => {
    setOcupado(true)
    try {
      await rpc('seg_guardar_rol', { p_id: r?.id ?? null, p_nombre: nombre, p_descripcion: desc, p_alcance: alcance, p_rol_crm: crm, p_permisos: perm, p_superadmin: sa })
      aviso('Rol guardado'); guardado()
    } catch (e) { aviso(msg(e)); setOcupado(false) }
  }
  return (
    <div className="ovl" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="modal" style={{ maxWidth: 860 }}>
        <div className="flex items-center mb-3"><h3 className="font-display font-bold text-base">{r ? 'Editar rol' : 'Nuevo rol'}</h3><button className="btn ml-auto !p-2" onClick={cerrar}><X /></button></div>
        <div className="grid sm:grid-cols-3 gap-2">
          <label className="f">Nombre<input className="inp" value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
          <label className="f">Alcance<select className="inp" value={alcance} onChange={(e) => setAlcance(e.target.value)}>{ALCANCES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
          <label className="f">Rol en el CRM<select className="inp" value={crm} onChange={(e) => setCrm(e.target.value)}><option value="">(sin CRM)</option>{ROLES_CRM.map((a) => <option key={a}>{a}</option>)}</select></label>
          <label className="f sm:col-span-3">Descripción<input className="inp" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        </div>
        <div className="tw mt-3" style={{ maxHeight: '50vh' }}><table className="t"><thead><tr><th>Módulo</th>{ACCIONES.map((a) => <th key={a} className="text-center">{a}</th>)}</tr></thead><tbody>
          {MODULOS.map((m) => <tr key={m.k}><td className="font-semibold">{m.t}</td>{ACCIONES.map((a) => <td key={a} className="text-center"><input type="checkbox" checked={!!perm[m.k]?.includes(a)} onChange={() => alternar(m.k, a)} /></td>)}</tr>)}
        </tbody></table></div>
        <label className="flex items-center gap-2 text-xs mt-3"><input type="checkbox" checked={sa} onChange={(e) => setSa(e.target.checked)} /> Este rol convierte a la persona en Superadministrador</label>
        <div className="flex justify-end gap-2 mt-3"><button className="btn" onClick={cerrar}>Cancelar</button><button className="btn btn-p" disabled={ocupado} onClick={guardar}><Save />Guardar rol</button></div>
      </div>
    </div>
  )
}

/* ============================ Matriz ============================ */
function PMatriz() {
  const [m, setM] = useState<Fila[] | null>(null)
  const [er, setEr] = useState('')
  useEffect(() => { rpc<Fila[]>('seg_matriz').then(setM).catch((e) => setEr(msg(e))) }, [])
  if (er) return <Falla t={er} />
  if (!m) return <Cargando />
  const celda = (f: Fila, k: string) => {
    if (f.superadmin) return 'VCEX'
    const a = f.permisos?.[k] ?? []
    return a.includes('ver') ? 'V' + (a.includes('crear') ? 'C' : '') + (a.includes('editar') ? 'E' : '') + (a.includes('eliminar') ? 'X' : '') : ''
  }
  return (
    <>
      <p className="text-xs text-slate-500 mb-2">V = entra · C = crear · E = editar · X = eliminar. Es la situación real hoy, calculada desde el rol y los permisos extra de cada persona.</p>
      <div className="tw"><table className="t"><thead><tr><th>Persona</th>{MODULOS.map((x) => <th key={x.k}>{x.t}</th>)}</tr></thead><tbody>
        {m.map((f) => <tr key={f.id}><td><b>{f.nombre || f.email}</b>{f.superadmin && <> <span className="pill bl">SA</span></>}</td>{MODULOS.map((x) => <td key={x.k} className="mono text-[11px]">{celda(f, x.k)}</td>)}</tr>)}
      </tbody></table></div>
    </>
  )
}

/* ============================ Sesiones ============================ */
function PSesiones({ admin, aviso }: { admin: boolean; aviso: (t: string) => void }) {
  const [s, setS] = useState<Sesion[] | null>(null)
  const [er, setEr] = useState('')
  const cargar = useCallback(() => { rpc<Sesion[]>('seg_sesiones').then(setS).catch((e) => setEr(msg(e))) }, [])
  useEffect(() => { cargar() }, [cargar])
  if (er) return <Falla t={er} />
  if (!s) return <Cargando />
  return (
    <>
      <p className="text-xs text-slate-500 mb-2">Cada dispositivo con sesión abierta. Se cierran al cambiar la contraseña o bloquear la cuenta.</p>
      <div className="tw"><table className="t"><thead><tr><th>Persona</th><th>Inició</th><th>Último uso</th><th>Dispositivo</th><th /></tr></thead><tbody>
        {s.map((x) => (
          <tr key={x.id}>
            <td><b>{x.nombre}</b><div className="text-[11px] text-slate-500">{x.email}</div></td><td>{fecha(x.creada)}</td><td>{fecha(x.ultimo_uso)}</td>
            <td className="text-[11px] text-slate-500" style={{ maxWidth: 260 }}>{x.dispositivo || '—'}{x.ip && <div className="mono">{x.ip}</div>}</td>
            <td>{admin && <button className="btn btn-r !py-1" onClick={async () => { try { await rpc('seg_cerrar_sesion', { p_id: x.id }); aviso('Sesión cerrada'); cargar() } catch (e) { aviso(msg(e)) } }}><LogOut />Cerrar</button>}</td>
          </tr>
        ))}
        {!s.length && <tr><td colSpan={5} className="text-center text-slate-400 py-6">Sin sesiones activas</td></tr>}
      </tbody></table></div>
    </>
  )
}

/* ============================ Bitácora ============================ */
const COLS_BIT = 'id,fecha,usuario_email,modulo,accion,registro,resultado,detalle'
const LIM = 300
function aplicar(f: Filtros, q: ReturnType<ReturnType<typeof supabase.from>['select']>) {
  let r = q
  if (f.desde) r = r.gte('fecha', f.desde + 'T00:00:00-05:00')
  if (f.hasta) r = r.lte('fecha', f.hasta + 'T23:59:59-05:00')
  if (f.usuario) r = r.ilike('usuario_email', '%' + f.usuario.replace(/[%,()]/g, '') + '%')
  if (f.modulo) r = r.eq('modulo', f.modulo)
  if (f.resultado) r = r.eq('resultado', f.resultado)
  if (f.q) { const t = f.q.replace(/[%,()]/g, ''); r = r.or(`accion.ilike.%${t}%,registro.ilike.%${t}%,detalle.ilike.%${t}%,usuario_email.ilike.%${t}%`) }
  return r
}
function PBitacora({ filtros, setFiltros, aviso }: { filtros: Filtros; setFiltros: (f: Filtros) => void; aviso: (t: string) => void }) {
  const [f, setF] = useState(filtros)
  const [filas, setFilas] = useState<Evento[] | null>(null)
  const [er, setEr] = useState('')
  const [resumen, setResumen] = useState<Record<string, number>>({})
  const buscar = useCallback(async (fil: Filtros) => {
    setFiltros(fil); setFilas(null); setEr('')
    try {
      const { data, error } = await aplicar(fil, supabase.from('bitacora').select(COLS_BIT)).order('fecha', { ascending: false }).limit(LIM)
      if (error) throw new Error(error.message)
      const d = (data as unknown as Evento[]) ?? []
      setFilas(d); setResumen(d.reduce<Record<string, number>>((a, x) => { const k = x.resultado ?? '—'; a[k] = (a[k] ?? 0) + 1; return a }, {}))
    } catch (e) { setEr(msg(e)) }
  }, [setFiltros])
  useEffect(() => { buscar(filtros) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const exportar = async () => {
    try {
      const todo: Evento[] = []
      for (let i = 0; i < 20; i++) {
        const { data, error } = await aplicar(f, supabase.from('bitacora').select(COLS_BIT)).order('fecha', { ascending: false }).range(i * 1000, i * 1000 + 999)
        if (error) throw new Error(error.message)
        const d = (data as unknown as Evento[]) ?? []; todo.push(...d); if (d.length < 1000) break
      }
      const esc = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"' }
      const csv = ['Fecha,Usuario,Módulo,Acción,Registro,Resultado,Detalle'].concat(todo.map((x) => [x.fecha, x.usuario_email, x.modulo, x.accion, x.registro, x.resultado, x.detalle].map(esc).join(','))).join('\r\n')
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
      a.download = 'bitacora_vimedic_' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.csv'; document.body.appendChild(a); a.click(); a.remove()
      await supabase.rpc('auditar', { p_modulo: 'seguridad', p_accion: 'Exportación de bitácora', p_detalle: todo.length + ' filas' })
      aviso(todo.length + ' eventos exportados')
    } catch (e) { aviso(msg(e)) }
  }
  const set = (k: keyof Filtros, v: string) => setF({ ...f, [k]: v })
  const clase = (r: string | null) => ({ OK: 'ok', Denegado: 'no', Error: 'no', Pendiente: 'wa' } as Record<string, string>)[r ?? ''] ?? 'gr'
  return (
    <>
      <div className="card !p-3 grid grid-cols-2 sm:grid-cols-6 gap-2 mb-3">
        <label className="f">Desde<input type="date" className="inp" value={f.desde} onChange={(e) => set('desde', e.target.value)} /></label>
        <label className="f">Hasta<input type="date" className="inp" value={f.hasta} onChange={(e) => set('hasta', e.target.value)} /></label>
        <label className="f">Usuario<input className="inp" value={f.usuario} onChange={(e) => set('usuario', e.target.value)} /></label>
        <label className="f">Módulo<select className="inp" value={f.modulo} onChange={(e) => set('modulo', e.target.value)}><option value="">Todos</option>{MODULOS_BIT.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="f">Resultado<select className="inp" value={f.resultado} onChange={(e) => set('resultado', e.target.value)}><option value="">Todos</option>{['OK', 'Denegado', 'Error', 'Pendiente'].map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="f">Texto<input className="inp" value={f.q} onChange={(e) => set('q', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') buscar(f) }} /></label>
        <div className="col-span-2 sm:col-span-6 flex gap-2 justify-end"><button className="btn" onClick={exportar}><Download />Exportar CSV</button><button className="btn btn-p" onClick={() => buscar(f)}><Search />Buscar</button></div>
      </div>
      {er ? <Falla t={er} /> : !filas ? <Cargando /> : (
        <>
          <p className="text-xs text-slate-500 mb-2">{filas.length} eventos{filas.length >= LIM ? ` (se muestran los ${LIM} más recientes; usa filtros o exporta)` : ''} · {Object.keys(resumen).map((k) => k + ': ' + resumen[k]).join(' · ')}</p>
          <div className="tw"><table className="t"><thead><tr><th>Fecha</th><th>Usuario</th><th>Módulo</th><th>Acción</th><th>Registro</th><th>Resultado</th><th>Detalle</th></tr></thead><tbody>
            {filas.map((x) => <tr key={x.id}><td className="whitespace-nowrap text-[11px]">{fecha(x.fecha)}</td><td className="text-[11px]">{x.usuario_email}</td><td>{x.modulo}</td><td>{x.accion}</td><td className="text-[11px]">{x.registro}</td><td><span className={'pill ' + clase(x.resultado)}>{x.resultado}</span></td><td className="text-[11px] text-slate-500">{x.detalle}</td></tr>)}
            {!filas.length && <tr><td colSpan={7} className="text-center text-slate-400 py-6">Sin eventos con estos filtros</td></tr>}
          </tbody></table></div>
        </>
      )}
    </>
  )
}

/* ============================ Revisión de privilegios ============================ */
function PRevision({ admin, aviso }: { admin: boolean; aviso: (t: string) => void }) {
  const [m, setM] = useState<Fila[] | null>(null)
  const [ult, setUlt] = useState<{ created_at: string; por_email: string | null; nota: string | null } | null | undefined>(undefined)
  const [nota, setNota] = useState('')
  const [er, setEr] = useState('')
  const cargar = useCallback(async () => {
    try {
      setM(await rpc<Fila[]>('seg_matriz'))
      const { data } = await supabase.from('seg_revisiones').select('created_at,por_email,nota').is('deleted_at', null).order('created_at', { ascending: false }).limit(1)
      setUlt((data as { created_at: string; por_email: string | null; nota: string | null }[] | null)?.[0] ?? null)
    } catch (e) { setEr(msg(e)) }
  }, [])
  useEffect(() => { cargar() }, [cargar])
  if (er) return <Falla t={er} />
  if (!m || ult === undefined) return <Cargando />
  const priv = m.map((f) => {
    const mot: ReactNode[] = []; const p = f.permisos ?? {}
    if (f.superadmin) mot.push('Superadministrador')
    if (p.empleados?.includes('editar')) mot.push('Administra Empleados')
    if (p.seguridad?.includes('administrar')) mot.push('Administra Seguridad')
    const conX = Object.keys(p).filter((k) => p[k].includes('eliminar')); if (conX.length) mot.push('Puede eliminar en: ' + conX.map(tituloMod).join(', '))
    return { f, mot }
  }).filter((x) => x.mot.length)
  return (
    <>
      <div className="card mb-3"><p className="text-sm">Revisa cada trimestre quién tiene privilegios altos y quita lo que ya no corresponda (ISO 27001, control 5.18).</p>
        <p className="text-xs text-slate-500 mt-1">Última revisión: {ult ? fecha(ult.created_at) + ' por ' + (ult.por_email ?? '') + (ult.nota ? ' · ' + ult.nota : '') : 'nunca'}</p></div>
      <div className="tw"><table className="t"><thead><tr><th>Persona</th><th>Privilegios</th></tr></thead><tbody>
        {priv.map(({ f, mot }) => <tr key={f.id}><td><b>{f.nombre || f.email}</b><div className="text-[11px] text-slate-500">{f.email}</div></td><td className="text-[12px]">{mot.map((t, i) => <div key={i}>{t}</div>)}</td></tr>)}
      </tbody></table></div>
      {admin && (
        <div className="card mt-3 flex flex-wrap gap-2 items-end">
          <label className="f flex-1 min-w-[220px]">Nota de la revisión<input className="inp" placeholder="Qué se revisó o cambió" value={nota} onChange={(e) => setNota(e.target.value)} /></label>
          <button className="btn btn-p" onClick={async () => { try { await rpc('seg_marcar_revision', { p_nota: nota }); setNota(''); aviso('Revisión registrada'); cargar() } catch (e) { aviso(msg(e)) } }}><ClipboardCheck />Marcar revisión hecha</button>
        </div>
      )}
    </>
  )
}
