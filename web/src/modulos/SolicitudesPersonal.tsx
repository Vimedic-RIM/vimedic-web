import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BadgeCheck, CalendarClock, Clock3, Download, History, Inbox, ListChecks, MessageSquarePlus, Paperclip, Plus, Send, Settings, ShieldAlert, ThumbsDown, ThumbsUp, TreePalm, Undo2, UserRound, Users, X, XCircle } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import '../estilos/solicitudes.css'

/* Solicitudes del personal (SolicitudesPersonal.gs + SolicitudesVista.html).
   modo "miperfil": datos laborales, saldo de vacaciones y formularios de Vacaciones / Permiso / Horas (todo empleado).
   modo "solicitudes": bandeja del jefe inmediato y de Talento Humano, saldos, tipos de permiso, configuración y auditoría.
   Toda la lógica y los permisos viven en la base (funciones th_*). */

type Saldo = { acumulados: number; utilizados: number; disponibles: number; comprometidos: number; disponiblesReales: number; diasPorAnio: number; aniosServicio: number; antiguedad: string; nota: string }
type Hist = { fecha: string; por: string; rol: string; accion: string; estado: string; nota: string }
type Sol = {
  id: string; codigo: string; tipo: string; subtipo: string; estado: string; estadoTxt: string; fecha: string; empleadoId: string; empleadoNombre: string; cedula: string; cargo: string
  departamento: string; jefeId: string | null; jefeNombre: string; modalidad: string; fechaInicio: string | null; fechaFin: string | null; fechaReincorporacion: string | null
  horaInicio: string; horaFin: string; duracion: number; unidad: string; diasVacaciones: number; motivo: string; observaciones: string; confidencial: boolean
  requiereExcepcion: boolean; excepcionMotivo: string; tieneDocumento: boolean; documentoNombre: string; puedeVerDocumento: boolean; jefeDecision: string; jefeDecisionFecha: string | null
  tthhDecision: string; tthhDecisionFecha: string | null; horasAutorizadas: number | null; horasTrabajadas: number | null; horasCompensadas: number | null; verificadaPago: boolean
  descuentoId: string; version: number; alcance: string; historial: Hist[]; saldoActual?: Saldo
}
type Tipo = { id: string; codigo: string; nombre: string; requiereDocumento: boolean; remunerado: boolean; duracionMax: number; unidadMax: string; afectaVacaciones: boolean; autorizacionEspecial: boolean; clase: string; confidencial: boolean; activo: boolean; orden: number }
type Config = { conteo: string; devengo: string; diasBase: number; adicionalDesdeAnio: number; adicionalMax: number; feriados: string[]; horasPorDia: number; correo?: boolean; diasMinAnticipacion: number }
type Roles = { yo: string; esAdmin: boolean; esTTHH: boolean; validaTTHH: boolean; esJefe: boolean }
type Mov = { id: string; codigo: string; fecha: string; tipo: string; dias: number; motivo: string; empleadoNombre?: string; solicitud?: string; usuario?: string }
type PerfilLab = { id: string; nombre: string; email: string; cedula: string; cargo: string; departamento: string; jefeNombre: string; jefeVinculado: boolean; fechaIngreso: string | null; antiguedad: string; estadoLaboral: string; jornada: string; horaEntrada: string; horaSalida: string; foto: string }
type DatosPerfil = { perfil: PerfilLab; saldo: Saldo; movimientos: Mov[]; solicitudes: Sol[]; tipos: Tipo[]; tiposHoras: string[]; config: Config; roles: Roles; hoy: string }
type EmpSaldo = { id: string; nombre: string; cedula: string; cargo: string; departamento: string; jefeNombre: string; jefeVinculado: boolean; fechaIngreso: string | null; antiguedad: string; estadoLaboral: string; activo: boolean; acumulados: number; utilizados: number; disponibles: number; comprometidos: number; nota: string }
type Aud = { fecha: string; usuario: string; rol: string; accion: string; solicitud: string; empleado: string; antes: string; despues: string; detalle: string }
type Bandeja = {
  roles: Roles; yo: { id: string; nombre: string }; hoy: string; config: Config; equipo: Sol[]
  miEquipo: { id: string; nombre: string; cargo: string; departamento: string; estadoLaboral: string; disponibles: number; comprometidos: number }[]
  todas?: Sol[]; empleados?: EmpSaldo[]; movimientos?: Mov[]; tipos?: Tipo[]; auditoria?: Aud[]
}
type Aviso = (t: string) => void

const n2 = (v: number | null | undefined) => Number(v || 0).toLocaleString('es-EC', { maximumFractionDigits: 2 })
const fFecha = (iso: string | null | undefined) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : '—' }
const fFH = (ts: string | null | undefined) => (ts ? new Date(ts).toLocaleString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const fD = (ts: string | null | undefined) => (ts ? new Date(ts).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const tipoTxt = (s: Sol) => s.tipo + (s.subtipo ? ' · ' + s.subtipo : '')
const periodo = (s: Sol) => s.unidad === 'horas' ? fFecha(s.fechaInicio) + (s.horaInicio ? ' · ' + s.horaInicio + '–' + s.horaFin : '') : fFecha(s.fechaInicio) + (s.fechaFin && s.fechaFin !== s.fechaInicio ? ' al ' + fFecha(s.fechaFin) : '')
const dur = (s: Sol) => n2(s.duracion) + (s.unidad === 'horas' ? ' h' : ' día(s)')
const ini = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()
const msg = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : String(e))
const pendiente = (s: Sol) => s.estado === 'Pendiente jefe' || s.estado === 'Pendiente TTHH'
const reglaTxt = (c: Config) => (c.conteo === 'laborables' ? 'Se cuentan solo días laborables (sin fines de semana ni feriados).' : 'Se cuentan días calendario (Código del Trabajo, Art. 69).') + (c.devengo === 'proporcional' ? ' Las vacaciones se acumulan de forma proporcional.' : ' Se acumulan al cumplir cada año de servicio.')

const pDate = (iso: string) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null }
const isoD = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
function diasRango(a: string, b: string, cfg: Config) {
  const x = pDate(a), y = pDate(b); if (!x || !y || y < x) return 0
  const fer = new Set(cfg.feriados || []); let n = 0
  for (let d = new Date(x), g = 0; d <= y && g < 800; d.setDate(d.getDate() + 1), g++) { const w = d.getDay(); if (cfg.conteo !== 'laborables' || (w !== 0 && w !== 6 && !fer.has(isoD(d)))) n++ }
  return n
}
function siguienteLaborable(iso: string, cfg: Config) {
  const d = pDate(iso); if (!d) return ''
  const fer = new Set(cfg.feriados || [])
  for (let g = 0; g < 30; g++) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (cfg.conteo !== 'laborables' || (w !== 0 && w !== 6 && !fer.has(isoD(d)))) break }
  return isoD(d)
}
const minutos = (h: string) => { const m = String(h || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null }

function Estado({ s }: { s: Sol }) {
  const c = s.estado === 'Pendiente jefe' ? 'e-jefe' : s.estado === 'Pendiente TTHH' ? 'e-tthh' : s.estado === 'Aprobada' ? 'e-ok' : s.estado === 'Rechazada' ? 'e-no' : 'e-can'
  return <span className={'pill ' + c}>{s.estado}</span>
}
const Dd = ({ t, v }: { t: string; v: ReactNode }) => <div><dt>{t}</dt><dd>{v}</dd></div>

function Ventana({ titulo, cerrar, children, pie, sm, alto }: { titulo: string; cerrar: () => void; children: ReactNode; pie?: ReactNode; sm?: boolean; alto?: boolean }) {
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f) }, [cerrar])
  return (
    <div className={'vm-sol-ovl' + (alto ? ' alto' : '')} onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className={'modal' + (sm ? ' sm' : '')} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="mh"><h2>{titulo}</h2><button className="x" aria-label="Cerrar" onClick={cerrar}><X size={18} /></button></div>
        <div className="mb">{children}</div>
        {pie && <div className="mf">{pie}</div>}
      </div>
    </div>
  )
}

/* Ventana de texto con campos extra (pedirTexto del original). */
type Campo = { k: string; tipo: 'num' | 'check' | 'texto'; label: string; valor?: string | boolean; max?: number }
type Pedido = { titulo: string; etiqueta: string; minimo: number; info?: ReactNode; campos?: Campo[]; ok: (texto: string, v: Record<string, string | boolean>) => Promise<void> }
function DialogoPedir({ p, cerrar, aviso }: { p: Pedido; cerrar: () => void; aviso: Aviso }) {
  const [texto, setTexto] = useState('')
  const [v, setV] = useState<Record<string, string | boolean>>(() => Object.fromEntries((p.campos ?? []).map((c) => [c.k, c.valor ?? (c.tipo === 'check' ? false : '')])))
  const [ocupado, setOcupado] = useState(false)
  async function confirmar() {
    if (texto.trim().length < p.minimo) { aviso(p.minimo > 1 ? `Escribe al menos ${p.minimo} caracteres.` : 'Este campo es obligatorio.'); return }
    setOcupado(true)
    try { await p.ok(texto.trim(), v); cerrar() } catch (e) { aviso(msg(e)) }
    setOcupado(false)
  }
  return (
    <Ventana titulo={p.titulo} cerrar={() => !ocupado && cerrar()} sm alto pie={<><button className="btn" onClick={cerrar} disabled={ocupado}>Volver</button><button className="btn bp" onClick={confirmar} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Confirmar'}</button></>}>
      {p.info}
      {(p.campos ?? []).map((c) => c.tipo === 'check'
        ? <label key={c.k} className="sw"><input type="checkbox" checked={!!v[c.k]} onChange={(e) => setV({ ...v, [c.k]: e.target.checked })} />{c.label}</label>
        : <label key={c.k} className="f">{c.label}{c.tipo === 'num'
          ? <input className="inp" type="number" min={-400} max={c.max} step={0.25} value={String(v[c.k] ?? '')} onChange={(e) => setV({ ...v, [c.k]: e.target.value })} />
          : <textarea className="inp" maxLength={500} value={String(v[c.k] ?? '')} onChange={(e) => setV({ ...v, [c.k]: e.target.value })} />}</label>)}
      <label className="f">{p.etiqueta}{p.minimo > 0 && <em> *</em>}<textarea className="inp" maxLength={1000} autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} /></label>
    </Ventana>
  )
}

/* ============================== Pantalla ============================== */
export default function SolicitudesPersonal({ perfil, aviso, modo }: { perfil: Perfil; aviso: Aviso; modo: string }) {
  const esPerfil = modo !== 'solicitudes'
  const [P, setP] = useState<DatosPerfil | null>(null)
  const [B, setB] = useState<Bandeja | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<'vacaciones' | 'permiso' | 'horas' | null>(null)
  const [detalle, setDetalle] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc(esPerfil ? 'th_mi_perfil' : 'th_bandeja')
    if (e) { setError(e.message); return }
    setError('')
    if (esPerfil) setP(data as DatosPerfil); else setB(data as Bandeja)
  }, [esPerfil])
  useEffect(() => { cargar() }, [cargar])

  const roles = (B?.roles ?? P?.roles) as Roles | undefined
  const titulo = esPerfil ? (P?.perfil.nombre ?? perfil.nombre) : 'Solicitudes del personal'
  const sub = esPerfil ? ([P?.perfil.cargo, P?.perfil.departamento].filter(Boolean).join(' · ') || 'Mi Perfil')
    : (B ? B.yo.nombre + ' · ' + (B.roles.esAdmin ? 'Administrador' : B.roles.validaTTHH ? 'Talento Humano' : B.roles.esTTHH ? 'Talento Humano (consulta)' : 'Jefe inmediato') : '')
  const foto = esPerfil ? (P?.perfil.foto || perfil.foto_url || '') : ''

  return (
    <div className="vm-sol">
      <header className="hdr"><div className="hdr-in">
        <div className="ava">{esPerfil ? (/^https:/.test(foto) ? <img src={foto} alt="" referrerPolicy="no-referrer" /> : ini(titulo)) : <Inbox size={22} />}</div>
        <div style={{ minWidth: 0 }}><h1>{titulo}</h1><p>{sub}</p></div>
      </div></header>
      <main>
        {error && <div className="warn">{error}</div>}
        {!error && !P && !B && <div className="empty">Cargando…</div>}
        {esPerfil && P && <MiPerfil P={P} abrirForm={(t) => { if (!P.perfil.jefeVinculado) { aviso('Primero Talento Humano debe asignarte un jefe inmediato en Empleados.'); return } setForm(t) }} verDetalle={setDetalle} />}
        {!esPerfil && B && <BandejaVista B={B} aviso={aviso} recargar={cargar} verDetalle={setDetalle} setB={setB} />}
      </main>
      {form && P && <Formulario tipo={form} P={P} cerrar={() => setForm(null)} aviso={aviso} listo={async (codigo, repetida) => { setForm(null); aviso((repetida ? 'Esta solicitud ya estaba registrada: ' : 'Solicitud enviada: ') + codigo); await cargar() }} />}
      {detalle && roles && <Detalle id={detalle} modo={esPerfil ? 'miperfil' : 'solicitudes'} roles={roles} cerrar={() => setDetalle(null)} aviso={aviso} recargar={cargar} />}
    </div>
  )
}

/* ============================== Mi Perfil ============================== */
function MiPerfil({ P, abrirForm, verDetalle }: { P: DatosPerfil; abrirForm: (t: 'vacaciones' | 'permiso' | 'horas') => void; verDetalle: (id: string) => void }) {
  const p = P.perfil, s = P.saldo
  const [f, setF] = useState<'activas' | 'aprobadas' | 'cerradas' | 'todas'>('activas')
  const sol = P.solicitudes
  const cnt = { activas: sol.filter(pendiente).length, aprobadas: sol.filter((x) => x.estado === 'Aprobada').length, cerradas: sol.filter((x) => x.estado === 'Rechazada' || x.estado === 'Cancelada').length, todas: sol.length }
  const l = sol.filter((x) => f === 'todas' || (f === 'activas' && pendiente(x)) || (f === 'aprobadas' && x.estado === 'Aprobada') || (f === 'cerradas' && (x.estado === 'Rechazada' || x.estado === 'Cancelada')))
  const avisos: string[] = []
  if (!p.jefeVinculado) avisos.push('No tienes un jefe inmediato vinculado. Hasta que Talento Humano lo configure en Empleados no podrás enviar solicitudes.')
  if (s.nota) avisos.push(s.nota)
  return (
    <>
      {avisos.length > 0 && <div className="warn">{avisos.map((a) => <div key={a}>{a}</div>)}</div>}
      <div className="acc">
        <button className="accbtn a1" onClick={() => abrirForm('vacaciones')}><TreePalm /><div><b>SOLICITAR VACACIONES</b><span>{n2(s.disponiblesReales)} día(s) disponibles</span></div></button>
        <button className="accbtn a2" onClick={() => abrirForm('permiso')}><CalendarClock /><div><b>SOLICITAR PERMISO</b><span>Cita médica, trámites, calamidad…</span></div></button>
        <button className="accbtn a3" onClick={() => abrirForm('horas')}><Clock3 /><div><b>SOLICITAR HORAS</b><span>Recuperación, compensación, adicionales…</span></div></button>
      </div>
      <div className="g2">
        <section className="card"><h3><UserRound />Datos laborales</h3>
          <dl className="dl">
            <Dd t="Nombres completos" v={p.nombre} /><Dd t="Cédula" v={p.cedula || '—'} /><Dd t="Cargo" v={p.cargo || '—'} /><Dd t="Departamento" v={p.departamento || '—'} />
            <Dd t="Jefe inmediato" v={p.jefeNombre || '—'} /><Dd t="Fecha de ingreso" v={fFecha(p.fechaIngreso)} /><Dd t="Antigüedad laboral" v={p.antiguedad} />
            <Dd t="Estado laboral" v={p.estadoLaboral || '—'} /><Dd t="Jornada" v={[p.jornada, p.horaEntrada && p.horaSalida ? p.horaEntrada + ' – ' + p.horaSalida : ''].filter(Boolean).join(' · ') || '—'} />
          </dl>
          <p className="note">Estos datos vienen del módulo Empleados. Si algo está mal, pide a Talento Humano que lo corrija.</p>
        </section>
        <section className="card"><h3><TreePalm />Vacaciones</h3>
          <div className="kp">
            <div className="k"><small>Acumuladas</small><b>{n2(s.acumulados)}</b></div><div className="k"><small>Utilizadas</small><b>{n2(s.utilizados)}</b></div>
            <div className="k v"><small>Disponibles</small><b>{n2(s.disponibles)}</b></div><div className="k c"><small>En trámite</small><b>{n2(s.comprometidos)}</b></div>
          </div>
          <p className="note">Te corresponden <b>{n2(s.diasPorAnio)}</b> días en tu año de servicio actual. {reglaTxt(P.config)}
            {s.comprometidos > 0 && <> Tienes <b>{n2(s.comprometidos)}</b> día(s) en solicitudes pendientes: tu saldo libre es <b>{n2(s.disponiblesReales)}</b>.</>} El saldo se descuenta solo cuando Talento Humano aprueba la solicitud.</p>
          {P.movimientos.length > 0 && <details style={{ marginTop: 8 }}><summary>Ver movimientos del saldo</summary>
            <ul className="tl" style={{ marginTop: 10 }}>{P.movimientos.map((m) => <li key={m.id}><b>{m.tipo} {m.dias > 0 ? '+' : ''}{n2(m.dias)} día(s)</b> <span className="q">{fFH(m.fecha)}</span><div className="q">{m.motivo}</div></li>)}</ul></details>}
        </section>
      </div>
      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}><h3 style={{ margin: 0, flex: 1 }}><ListChecks />Mis solicitudes</h3></div>
        <div className="chips">{([['activas', 'En trámite'], ['aprobadas', 'Aprobadas'], ['cerradas', 'Rechazadas / canceladas'], ['todas', 'Todas']] as const).map(([k, t]) =>
          <button key={k} className={'chip' + (k === f ? ' on' : '')} onClick={() => setF(k)}>{t} ({cnt[k]})</button>)}</div>
        {l.length ? <div className="tw"><table className="t rs"><thead><tr><th>Nº</th><th>Fecha</th><th>Tipo</th><th>Período</th><th>Duración</th><th>Estado</th></tr></thead><tbody>
          {l.map((x) => <tr key={x.id} className="cl" onClick={() => verDetalle(x.id)}><td data-l="Nº"><b>{x.codigo}</b></td><td data-l="Fecha">{fD(x.fecha)}</td><td data-l="Tipo">{tipoTxt(x)}</td>
            <td data-l="Período">{periodo(x)}</td><td data-l="Duración" className="n">{dur(x)}</td><td data-l="Estado"><Estado s={x} /></td></tr>)}
        </tbody></table></div> : <div className="empty">{f === 'activas' ? 'No tienes solicitudes en trámite.' : 'Sin solicitudes en esta vista.'}</div>}
      </section>
    </>
  )
}

/* ============================== Formularios ============================== */
function Formulario({ tipo, P, cerrar, aviso, listo }: { tipo: 'vacaciones' | 'permiso' | 'horas'; P: DatosPerfil; cerrar: () => void; aviso: Aviso; listo: (codigo: string, repetida: boolean) => void }) {
  const cfg = P.config, s = P.saldo, p = P.perfil
  const reqId = useMemo(() => crypto.randomUUID(), [])
  const [d, setD] = useState({ ini: '', fin: '', rein: '', reinTocada: false, obs: '', exc: false, excM: '', tipoId: '', mod: 'días', hi: '', hf: '', mot: '', sub: '' })
  const [doc, setDoc] = useState<File | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const set = (c: Partial<typeof d>) => setD((x) => ({ ...x, ...c }))
  const T = P.tipos.find((t) => t.id === d.tipoId)
  const horas = tipo === 'horas' || (tipo === 'permiso' && d.mod === 'horas')
  const dias = tipo === 'vacaciones' ? diasRango(d.ini, d.fin, cfg) : 0
  const faltaSaldo = tipo === 'vacaciones' && dias > s.disponiblesReales
  const durTxt = (() => {
    if (horas) { const a = minutos(d.hi), b = minutos(d.hf); return a != null && b != null && b > a ? n2((b - a) / 60) + ' h' : '—' }
    if (tipo === 'permiso') { const a = pDate(d.ini), b = pDate(d.fin || d.ini); return a && b && b >= a ? Math.round((+b - +a) / 864e5) + 1 + ' día(s)' : '—' }
    return String(dias)
  })()
  const titulo = tipo === 'vacaciones' ? 'Solicitud de vacaciones' : tipo === 'permiso' ? 'Solicitud de permiso' : 'Solicitud de horas'

  function revisar() {
    if (tipo === 'vacaciones') {
      if (!d.ini || !d.fin) return aviso('Indica las fechas de inicio y fin.')
      if (faltaSaldo && !d.exc) return aviso('No tienes saldo suficiente: marca la excepción o reduce los días.')
    } else if (tipo === 'permiso') {
      if (!d.tipoId) return aviso('Elige el tipo de permiso.')
      if (!d.ini) return aviso('Indica la fecha de inicio.')
      if (d.mod === 'horas' && (!d.hi || !d.hf)) return aviso('Indica la hora de salida y de retorno.')
      if (!d.mot.trim()) return aviso('Explica el motivo del permiso.')
      if (T?.requiereDocumento && !doc) return aviso('Este tipo de permiso requiere un documento de respaldo.')
    } else {
      if (!d.sub) return aviso('Elige el tipo de solicitud.')
      if (!d.ini || !d.hi || !d.hf) return aviso('Indica la fecha y las horas.')
      if (!d.mot.trim()) return aviso('Escribe la justificación.')
    }
    if (doc && doc.size > 8 * 1024 * 1024) return aviso('El documento supera 8 MB.')
    if (doc && !/^(application\/pdf|image\/(jpeg|png|webp))$/.test(doc.type)) return aviso('El documento debe ser PDF o foto (JPG, PNG, WEBP).')
    setConfirmar(true)
  }
  async function enviar() {
    setEnviando(true)
    try {
      let documento: { ruta: string; nombre: string } | null = null
      if (doc) {
        const ext = (doc.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '')
        const ruta = `solicitudes/${p.id}/${crypto.randomUUID()}.${ext}`
        const up = await supabase.storage.from('talento-humano').upload(ruta, doc, { contentType: doc.type })
        if (up.error) throw new Error('No se pudo subir el documento: ' + up.error.message)
        documento = { ruta, nombre: doc.name }
      }
      const body: Record<string, unknown> = { tipo, requestId: reqId, fechaInicio: d.ini, observaciones: d.obs, documento }
      if (tipo === 'vacaciones') Object.assign(body, { fechaFin: d.fin, fechaReincorporacion: d.rein, solicitarExcepcion: faltaSaldo && d.exc, motivoExcepcion: d.excM })
      else if (tipo === 'permiso') Object.assign(body, { subtipoId: d.tipoId, modalidad: d.mod === 'horas' ? 'horas' : 'días', fechaFin: d.fin, horaInicio: d.hi, horaFin: d.hf, motivo: d.mot })
      else Object.assign(body, { subtipo: d.sub, horaInicio: d.hi, horaFin: d.hf, motivo: d.mot })
      const { data, error } = await supabase.rpc('th_sol_crear', { d: body })
      if (error) throw error
      const r = data as { repetida?: boolean; solicitud: Sol }
      listo(r.solicitud.codigo, !!r.repetida)
    } catch (e) { aviso(msg(e)); setConfirmar(false) }
    setEnviando(false)
  }
  const resumen = tipo === 'vacaciones' ? <>Vacaciones del <b>{fFecha(d.ini)}</b> al <b>{fFecha(d.fin)}</b> · <b>{dias}</b> día(s). Regresas el {fFecha(d.rein)}.</>
    : tipo === 'permiso' ? <>Permiso <b>{T?.nombre}</b> · {fFecha(d.ini)}{d.mod === 'horas' ? ` de ${d.hi} a ${d.hf}` : d.fin && d.fin !== d.ini ? ' al ' + fFecha(d.fin) : ''} · <b>{durTxt}</b>.</>
    : <><b>{d.sub}</b> · {fFecha(d.ini)} de {d.hi} a {d.hf} · <b>{durTxt}</b>.</>
  const docInput = (req: boolean) => <label className="f w">{req ? <>Documento de respaldo <em>*</em></> : 'Documento adjunto (opcional)'}
    <input className="inp" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setDoc(e.target.files?.[0] ?? null)} />
    <span className="note">PDF o foto · máximo 8 MB · solo lo ven tú, tu jefe y Talento Humano{T?.confidencial ? ' (este tipo es confidencial: tu jefe no lo ve)' : ''}</span></label>

  if (confirmar) return (
    <Ventana titulo="¿Enviar la solicitud?" cerrar={() => !enviando && setConfirmar(false)} sm pie={<><button className="btn" disabled={enviando} onClick={() => setConfirmar(false)}>Volver</button><button className="btn bp" disabled={enviando} onClick={enviar}><Send />{enviando ? 'Enviando…' : 'Enviar'}</button></>}>
      <p style={{ margin: 0, lineHeight: 1.5 }}>{resumen}</p>
      <p style={{ margin: 0 }}>Se enviará a tu jefe inmediato (<b>{p.jefeNombre}</b>) y después a Talento Humano.</p>
    </Ventana>
  )
  return (
    <Ventana titulo={titulo} cerrar={cerrar} pie={<><button className="btn" onClick={cerrar}>Cancelar</button><button className="btn bp" onClick={revisar}><Send />Enviar solicitud</button></>}>
      <div className="auto"><dl className="dl">
        <Dd t="Fecha de solicitud" v={fFecha(P.hoy)} /><Dd t="Nombres completos" v={p.nombre} /><Dd t="Cédula" v={p.cedula || '—'} /><Dd t="Cargo" v={p.cargo || '—'} />
        <Dd t="Departamento" v={p.departamento || '—'} /><Dd t="Jefe inmediato" v={p.jefeNombre || '—'} />
        {tipo === 'vacaciones' && <><Dd t="Fecha de ingreso" v={fFecha(p.fechaIngreso)} /><Dd t="Antigüedad laboral" v={p.antiguedad} /><Dd t="Días acumulados" v={n2(s.acumulados)} />
          <Dd t="Días utilizados" v={n2(s.utilizados)} /><Dd t="Días disponibles" v={n2(s.disponibles) + (s.comprometidos ? ` (${n2(s.comprometidos)} en trámite)` : '')} /></>}
        {tipo === 'permiso' && <Dd t="Número de solicitud" v="Se asigna al enviar" />}
      </dl></div>
      {tipo === 'vacaciones' && <div className="fg">
        <label className="f">Fecha de inicio <em>*</em><input className="inp" type="date" min={P.hoy} value={d.ini} onChange={(e) => { const v = e.target.value; const fin = !d.fin || d.fin < v ? v : d.fin; set({ ini: v, fin, rein: d.reinTocada ? d.rein : siguienteLaborable(fin, cfg) }) }} /></label>
        <label className="f">Fecha de finalización <em>*</em><input className="inp" type="date" min={d.ini || P.hoy} value={d.fin} onChange={(e) => set({ fin: e.target.value, rein: d.reinTocada ? d.rein : siguienteLaborable(e.target.value, cfg) })} /></label>
        <label className="f">Fecha prevista de reincorporación<input className="inp" type="date" value={d.rein} onChange={(e) => set({ rein: e.target.value, reinTocada: true })} /></label>
        <div><span className="f">Días solicitados</span><div className="calc"><b>{dias}</b><span className="note">{cfg.conteo === 'laborables' ? 'días laborables' : 'días calendario'}</span></div></div>
        <div className="w">
          {d.ini && d.fin && d.fin < d.ini ? <div className="warn">La fecha de finalización no puede ser anterior a la de inicio.</div>
            : faltaSaldo ? <div className="warn"><b>Saldo insuficiente.</b> Pides {dias} día(s) y tu saldo libre es {n2(s.disponiblesReales)}{s.comprometidos ? ` (tienes ${n2(s.comprometidos)} en otras solicitudes pendientes)` : ''}. Solo puedes enviarla como excepción para que Talento Humano la autorice.</div>
            : dias > 0 ? <div className="info">Después de esta solicitud te quedarían <b>{n2(s.disponiblesReales - dias)}</b> día(s) libres (se descuentan solo al aprobarse).</div> : null}
        </div>
        <label className="f w">Observaciones<textarea className="inp" maxLength={1000} placeholder="Opcional" value={d.obs} onChange={(e) => set({ obs: e.target.value })} /></label>
        {docInput(false)}
        {faltaSaldo && <div className="w"><label className="sw"><input type="checkbox" checked={d.exc} onChange={(e) => set({ exc: e.target.checked })} />Solicitar como excepción de saldo (lo decide Talento Humano)</label>
          <label className="f" style={{ marginTop: 8 }}>Motivo de la excepción<textarea className="inp" maxLength={500} value={d.excM} onChange={(e) => set({ excM: e.target.value })} /></label></div>}
      </div>}
      {tipo === 'permiso' && <div className="fg">
        <label className="f w">Tipo de permiso <em>*</em><select className="inp" value={d.tipoId} onChange={(e) => set({ tipoId: e.target.value })}><option value="">Elige…</option>{P.tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></label>
        {T && <div className="w">{T.remunerado ? <span className="tag">Remunerado</span> : <span className="tag r">No remunerado</span>}<span className="tag">{T.clase}</span>
          {T.requiereDocumento && <span className="tag r">Requiere documento</span>}{T.duracionMax > 0 && <span className="tag">Máximo {T.duracionMax} {T.unidadMax}</span>}
          {T.afectaVacaciones && <span className="tag v">Se descuenta de vacaciones</span>}{T.autorizacionEspecial && <span className="tag">Autorización especial</span>}{T.confidencial && <span className="tag">Confidencial</span>}</div>}
        <label className="f">Modalidad <em>*</em><select className="inp" value={d.mod} onChange={(e) => set({ mod: e.target.value })}><option value="días">Por días</option><option value="horas">Por horas</option></select></label>
        <label className="f">Fecha de inicio <em>*</em><input className="inp" type="date" value={d.ini} onChange={(e) => set({ ini: e.target.value })} /></label>
        {d.mod !== 'horas' && <label className="f">Fecha de finalización<input className="inp" type="date" min={d.ini} value={d.fin} onChange={(e) => set({ fin: e.target.value })} /></label>}
        <label className="f">Hora de salida{d.mod === 'horas' && <em> *</em>}<input className="inp" type="time" value={d.hi} onChange={(e) => set({ hi: e.target.value })} /></label>
        <label className="f">Hora de retorno{d.mod === 'horas' && <em> *</em>}<input className="inp" type="time" value={d.hf} onChange={(e) => set({ hf: e.target.value })} /></label>
        <div><span className="f">Duración solicitada</span><div className="calc"><b>{durTxt}</b></div></div>
        <label className="f w">Detalle del motivo <em>*</em><textarea className="inp" maxLength={2000} placeholder="Explica la solicitud" value={d.mot} onChange={(e) => set({ mot: e.target.value })} /></label>
        {docInput(!!T?.requiereDocumento)}
      </div>}
      {tipo === 'horas' && <div className="fg">
        <label className="f w">Tipo de solicitud <em>*</em><select className="inp" value={d.sub} onChange={(e) => set({ sub: e.target.value })}><option value="">Elige…</option>{P.tiposHoras.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="f">Fecha correspondiente <em>*</em><input className="inp" type="date" value={d.ini} onChange={(e) => set({ ini: e.target.value })} /></label>
        <div><span className="f">Total de horas</span><div className="calc"><b>{durTxt}</b></div></div>
        <label className="f">Hora de inicio <em>*</em><input className="inp" type="time" value={d.hi} onChange={(e) => set({ hi: e.target.value })} /></label>
        <label className="f">Hora de finalización <em>*</em><input className="inp" type="time" value={d.hf} onChange={(e) => set({ hf: e.target.value })} /></label>
        <label className="f w">Justificación <em>*</em><textarea className="inp" maxLength={2000} value={d.mot} onChange={(e) => set({ mot: e.target.value })} /></label>
        <label className="f w">Observaciones<textarea className="inp" maxLength={1000} placeholder="Opcional" value={d.obs} onChange={(e) => set({ obs: e.target.value })} /></label>
        {docInput(false)}
        <p className="note w">Las horas adicionales no se consideran horas extraordinarias pagables hasta que Talento Humano las verifique.</p>
      </div>}
    </Ventana>
  )
}

/* ============================== Detalle (común) ============================== */
function Detalle({ id, modo, roles, cerrar, aviso, recargar }: { id: string; modo: 'miperfil' | 'solicitudes'; roles: Roles; cerrar: () => void; aviso: Aviso; recargar: () => Promise<void> }) {
  const [s, setS] = useState<Sol | null>(null)
  const [error, setError] = useState('')
  const [pedir, setPedir] = useState<Pedido | null>(null)
  const [doc, setDoc] = useState(false)
  useEffect(() => { supabase.rpc('th_sol_detalle', { p_id: id }).then(({ data, error: e }) => { if (e) setError(e.message); else setS(data as Sol) }) }, [id])
  if (error) return <Ventana titulo="Solicitud" cerrar={cerrar} sm pie={<button className="btn" onClick={cerrar}>Cerrar</button>}><div className="warn">{error}</div></Ventana>
  if (!s) return <Ventana titulo="Solicitud" cerrar={cerrar} sm><div className="note">Cargando…</div></Ventana>

  const propia = s.empleadoId === roles.yo, esJefeDe = s.alcance === 'jefe' && !propia, hrs = s.unidad === 'horas', pend = pendiente(s)
  async function correr(fn: string, args: Record<string, unknown>, ok: string) {
    const { data, error: e } = await supabase.rpc(fn, args)
    if (e) throw e
    aviso(ok)
    const n = (data as { solicitud?: Sol }).solicitud
    if (n) setS({ ...n, saldoActual: s?.saldoActual })
    await recargar()
  }
  const falta = !!s.saldoActual && s.diasVacaciones > s.saldoActual.disponibles
  const aprobarTTHH = (omitir: boolean) => setPedir({
    titulo: (omitir ? 'Validar sin jefe · ' : 'Aprobar definitivamente · ') + s.codigo, etiqueta: 'Observación (opcional)', minimo: 0,
    info: <>{omitir && <div className="warn">Procedimiento excepcional: se omite la aprobación del jefe inmediato. Queda registrado en la auditoría.</div>}
      {s.diasVacaciones > 0 && <div className={falta ? 'warn' : 'info'}>Se descontarán <b>{n2(s.diasVacaciones)}</b> día(s). Disponibles: <b>{n2(s.saldoActual?.disponibles)}</b>.</div>}</>,
    campos: [...(omitir ? [{ k: 'motivoOmitir', tipo: 'texto' as const, label: 'Motivo para omitir al jefe (mín. 10 caracteres)' }] : []),
      ...(hrs ? [{ k: 'horasAutorizadas', tipo: 'num' as const, label: `Horas autorizadas (de ${n2(s.duracion)})`, valor: String(s.duracion), max: s.duracion }] : []),
      ...(s.diasVacaciones > 0 && (falta || s.requiereExcepcion) ? [{ k: 'excepcionSaldo', tipo: 'check' as const, label: 'Autorizar excepción de saldo' }, { k: 'motivoExcepcion', tipo: 'texto' as const, label: 'Motivo de la excepción' }] : [])],
    ok: (t, v) => correr('th_sol_decidir_tthh', { p_id: s.id, p_decision: 'aprobar', p_observacion: t, p_version: s.version,
      p_opciones: { horasAutorizadas: v.horasAutorizadas ?? '', excepcionSaldo: !!v.excepcionSaldo, motivoExcepcion: v.motivoExcepcion ?? '', omitirJefe: omitir, motivoOmitir: v.motivoOmitir ?? '' } },
      'Aprobada definitivamente.' + (s.diasVacaciones > 0 ? ' Saldo actualizado.' : '')),
  })
  const acciones: ReactNode[] = [<button key="obs" className="btn" onClick={() => setPedir({ titulo: 'Agregar observación', etiqueta: 'Observación', minimo: 1, ok: (t) => correr('th_sol_observar', { p_id: s.id, p_texto: t }, 'Observación registrada.') })}><MessageSquarePlus />Agregar observación</button>]
  if (propia && pend) acciones.push(<button key="can" className="btn bno" onClick={() => setPedir({ titulo: 'Cancelar solicitud ' + s.codigo, etiqueta: 'Motivo (opcional)', minimo: 0, ok: (t) => correr('th_sol_cancelar', { p_id: s.id, p_motivo: t, p_version: s.version }, 'Solicitud cancelada.') })}><XCircle />Cancelar solicitud</button>)
  if (modo === 'solicitudes') {
    if (esJefeDe && s.estado === 'Pendiente jefe') acciones.push(
      <button key="jr" className="btn bno" onClick={() => setPedir({ titulo: 'Rechazar ' + s.codigo, etiqueta: 'Motivo del rechazo', minimo: 1, ok: (t) => correr('th_sol_decidir_jefe', { p_id: s.id, p_decision: 'rechazar', p_observacion: t, p_version: s.version }, 'Solicitud rechazada. Se notificó al empleado.') })}><ThumbsDown />Rechazar</button>,
      <button key="ja" className="btn bok" onClick={() => setPedir({ titulo: 'Aprobar ' + s.codigo, etiqueta: 'Observación (opcional)', minimo: 0, info: <p className="note">Al aprobar, la solicitud pasa a Talento Humano para la validación final.</p>, ok: (t) => correr('th_sol_decidir_jefe', { p_id: s.id, p_decision: 'aprobar', p_observacion: t, p_version: s.version }, 'Aprobada y enviada a Talento Humano.') })}><ThumbsUp />Aprobar y enviar a TTHH</button>)
    if (roles.validaTTHH && !propia) {
      if (s.estado === 'Pendiente TTHH') acciones.push(
        <button key="tr" className="btn bno" onClick={() => setPedir({ titulo: 'Rechazar ' + s.codigo, etiqueta: 'Justificación del rechazo', minimo: 1, ok: (t) => correr('th_sol_decidir_tthh', { p_id: s.id, p_decision: 'rechazar', p_observacion: t, p_opciones: {}, p_version: s.version }, 'Solicitud rechazada.') })}><ThumbsDown />Rechazar</button>,
        <button key="ta" className="btn bok" onClick={() => aprobarTTHH(false)}><BadgeCheck />Aprobar definitivamente</button>)
      if (s.estado === 'Pendiente jefe') acciones.push(<button key="om" className="btn" title="Procedimiento excepcional: queda auditado" onClick={() => aprobarTTHH(true)}><ShieldAlert />Validar sin jefe (excepcional)</button>)
      if (s.estado === 'Aprobada') acciones.push(<button key="an" className="btn bno" onClick={() => setPedir({ titulo: 'Anular ' + s.codigo, etiqueta: 'Motivo de la anulación (mín. 10 caracteres)', minimo: 10, info: s.diasVacaciones > 0 ? <div className="info">Se devolverán {n2(s.diasVacaciones)} día(s) al saldo del empleado.</div> : undefined, ok: (t) => correr('th_sol_cancelar', { p_id: s.id, p_motivo: t, p_version: s.version }, 'Solicitud anulada.') })}><Undo2 />Anular</button>)
      if (s.estado === 'Aprobada' && hrs) acciones.push(<button key="hr" className="btn" onClick={() => setPedir({ titulo: 'Registrar horas · ' + s.codigo, etiqueta: 'Nota (opcional)', minimo: 0,
        campos: [{ k: 'horasTrabajadas', tipo: 'num', label: 'Horas efectivamente trabajadas', valor: s.horasTrabajadas != null ? String(s.horasTrabajadas) : '' }, { k: 'horasCompensadas', tipo: 'num', label: 'Horas compensadas', valor: s.horasCompensadas != null ? String(s.horasCompensadas) : '' }, { k: 'verificadaPago', tipo: 'check', label: 'Verificadas por TTHH para pago (horas extraordinarias)', valor: s.verificadaPago }],
        ok: (_t, v) => correr('th_sol_registrar_horas', { p_id: s.id, d: v, p_version: s.version }, 'Horas registradas.') })}><Clock3 />Registrar horas</button>)
      if (pend && s.estado !== 'Pendiente jefe') acciones.push(<button key="tc" className="btn bno" onClick={() => setPedir({ titulo: 'Cancelar ' + s.codigo, etiqueta: 'Motivo de la cancelación', minimo: 5, ok: (t) => correr('th_sol_cancelar', { p_id: s.id, p_motivo: t, p_version: s.version }, 'Solicitud cancelada.') })}>Cancelar</button>)
    }
  }
  return (
    <>
      <Ventana titulo={'Solicitud ' + s.codigo} cerrar={cerrar} pie={<>{acciones}</>}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Estado s={s} /><span className="note">{s.estadoTxt}</span>
          {s.requiereExcepcion && <span className="tag r">Excepción de saldo</span>}{s.confidencial && <span className="tag">Confidencial</span>}</div>
        <dl className="dl">
          <Dd t="Tipo" v={tipoTxt(s)} /><Dd t="Empleado" v={s.empleadoNombre} /><Dd t="Cédula" v={s.cedula || '—'} /><Dd t="Cargo" v={s.cargo || '—'} /><Dd t="Departamento" v={s.departamento || '—'} />
          <Dd t="Jefe inmediato" v={s.jefeNombre || '—'} /><Dd t="Fecha de solicitud" v={fFH(s.fecha)} /><Dd t={hrs ? 'Fecha' : 'Período'} v={periodo(s)} />
          {s.fechaReincorporacion && <Dd t="Reincorporación" v={fFecha(s.fechaReincorporacion)} />}<Dd t="Duración" v={dur(s)} />
          {s.tipo === 'Vacaciones' && <Dd t="Días de vacaciones" v={n2(s.diasVacaciones)} />}
          {s.horasAutorizadas != null && <Dd t="Horas autorizadas" v={n2(s.horasAutorizadas)} />}{s.horasTrabajadas != null && <Dd t="Horas trabajadas" v={n2(s.horasTrabajadas)} />}
          {s.horasCompensadas != null && <Dd t="Horas compensadas" v={n2(s.horasCompensadas)} />}{hrs && s.estado === 'Aprobada' && <Dd t="Verificada para pago" v={s.verificadaPago ? 'Sí' : 'No'} />}
        </dl>
        {s.motivo && <div className="caja"><b className="t">{s.tipo === 'Horas' ? 'JUSTIFICACIÓN' : 'MOTIVO'}</b><div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{s.motivo}</div></div>}
        {s.observaciones && <div className="caja"><b className="t">OBSERVACIONES</b><div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{s.observaciones}</div></div>}
        {s.excepcionMotivo && <div className="warn"><b>Excepción de saldo:</b> {s.excepcionMotivo}</div>}
        {s.tieneDocumento && (s.puedeVerDocumento ? <div><button className="btn" onClick={() => setDoc(true)}><Paperclip />Ver documento: {s.documentoNombre || 'adjunto'}</button></div>
          : <p className="note">Tiene documento de respaldo (confidencial: solo lo ve Talento Humano).</p>)}
        {s.saldoActual && <div className="info">Saldo actual del empleado: <b>{n2(s.saldoActual.disponibles)}</b> día(s) disponibles · {n2(s.saldoActual.comprometidos)} en trámite · acumulados {n2(s.saldoActual.acumulados)} · utilizados {n2(s.saldoActual.utilizados)}.</div>}
        <h3 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 14, color: '#0b2545', margin: '6px 0 0' }}>Historial</h3>
        <ul className="tl">{(s.historial || []).map((x, i) => <li key={i}><b>{x.accion}</b> <span className="q">· {x.por}{x.rol ? ` (${x.rol})` : ''} · {fFH(x.fecha)}</span>{x.nota && <div style={{ whiteSpace: 'pre-wrap' }}>{x.nota}</div>}</li>)}</ul>
      </Ventana>
      {pedir && <DialogoPedir p={pedir} cerrar={() => setPedir(null)} aviso={aviso} />}
      {doc && <VerDocumento id={s.id} cerrar={() => setDoc(false)} />}
    </>
  )
}

function VerDocumento({ id, cerrar }: { id: string; cerrar: () => void }) {
  const [d, setD] = useState<{ url: string; nombre: string; img: boolean } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase.rpc('th_sol_documento', { p_id: id })
      if (e) { setError(e.message); return }
      const r = data as { ruta: string; nombre: string }
      const f = await supabase.storage.from('talento-humano').createSignedUrl(r.ruta, 600, { download: false })
      if (f.error || !f.data) { setError(f.error?.message || 'No se pudo abrir el documento.'); return }
      setD({ url: f.data.signedUrl, nombre: r.nombre, img: /\.(jpe?g|png|webp)$/i.test(r.ruta) })
    })()
  }, [id])
  return (
    <Ventana titulo="Documento" cerrar={cerrar} alto>
      {error && <div className="warn">{error}</div>}
      {!error && !d && <div className="note">Abriendo…</div>}
      {d && <div className="doc">{d.img ? <img src={d.url} alt="" /> : <iframe src={d.url} title="Documento" />}
        <p><a className="btn" href={d.url} target="_blank" rel="noopener noreferrer" download={d.nombre}><Download />Descargar {d.nombre}</a></p></div>}
    </Ventana>
  )
}

/* ============================== Bandeja (jefes / TTHH / admin) ============================== */
function TablaSol({ lista, conJefe, ver }: { lista: Sol[]; conJefe: boolean; ver: (id: string) => void }) {
  const [n, setN] = useState(100)
  if (!lista.length) return <div className="empty">No hay solicitudes en esta vista.</div>
  return (
    <>
      <div className="tw"><table className="t rs"><thead><tr><th>Nº</th><th>Fecha</th><th>Empleado</th><th>Departamento</th>{conJefe && <th>Jefe</th>}<th>Tipo</th><th>Período</th><th>Duración</th><th>Motivo</th><th>Estado</th></tr></thead><tbody>
        {lista.slice(0, n).map((s) => <tr key={s.id} className="cl" onClick={() => ver(s.id)}><td data-l="Nº"><b>{s.codigo}</b></td><td data-l="Fecha">{fD(s.fecha)}</td><td data-l="Empleado">{s.empleadoNombre}</td>
          <td data-l="Departamento">{s.departamento || '—'}</td>{conJefe && <td data-l="Jefe">{s.jefeNombre || '—'}</td>}<td data-l="Tipo">{tipoTxt(s)}{s.requiereExcepcion && <> <span className="tag r">Excepción</span></>}</td>
          <td data-l="Período">{periodo(s)}</td><td data-l="Duración" className="n">{dur(s)}</td><td data-l="Motivo"><div className="mot" title={s.motivo}>{s.motivo || '—'}</div></td><td data-l="Estado"><Estado s={s} /></td></tr>)}
      </tbody></table></div>
      {lista.length > n && <div style={{ textAlign: 'center', marginTop: 10 }}><button className="btn" onClick={() => setN(n + 100)}>Mostrar más ({lista.length - n})</button></div>}
    </>
  )
}

function exportarCsv(lista: Sol[]) {
  const cols = ['Nº', 'Fecha solicitud', 'Empleado', 'Cédula', 'Cargo', 'Departamento', 'Jefe', 'Tipo', 'Subtipo', 'Inicio', 'Fin', 'Hora inicio', 'Hora fin', 'Duración', 'Unidad', 'Días vacaciones', 'Estado', 'Jefe decisión', 'Jefe fecha', 'TTHH decisión', 'TTHH fecha', 'Horas autorizadas', 'Horas trabajadas', 'Horas compensadas']
  const q = (v: unknown) => { let x = String(v ?? ''); if (/^[=+\-@]/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"' }
  const filas = lista.map((s) => [s.codigo, s.fecha, s.empleadoNombre, s.cedula, s.cargo, s.departamento, s.jefeNombre, s.tipo, s.subtipo, s.fechaInicio, s.fechaFin, s.horaInicio, s.horaFin, s.duracion, s.unidad, s.diasVacaciones, s.estadoTxt, s.jefeDecision, s.jefeDecisionFecha, s.tthhDecision, s.tthhDecisionFecha, s.horasAutorizadas, s.horasTrabajadas, s.horasCompensadas].map(q).join(';'))
  const blob = new Blob(['﻿' + [cols.map(q).join(';')].concat(filas).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'solicitudes_' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove()
}

function BandejaVista({ B, aviso, recargar, verDetalle, setB }: { B: Bandeja; aviso: Aviso; recargar: () => Promise<void>; verDetalle: (id: string) => void; setB: (b: Bandeja) => void }) {
  const R = B.roles
  const T: [string, string, number][] = []
  if (R.esJefe) T.push(['equipo', 'Mi equipo', B.equipo.filter((s) => s.estado === 'Pendiente jefe').length])
  if (R.esTTHH || R.esAdmin) T.push(['tthh', 'Talento Humano', (B.todas ?? []).filter((s) => s.estado === 'Pendiente TTHH').length], ['saldos', 'Saldos de vacaciones', 0], ['tipos', 'Tipos de permiso', 0])
  if (R.esAdmin) T.push(['config', 'Configuración', 0], ['aud', 'Auditoría', 0])
  const [tab, setTab] = useState(T[0]?.[0] ?? '')
  return (
    <>
      <nav className="tabs" role="tablist">{T.map(([k, t, n]) => <button key={k} role="tab" className={'tab' + (k === tab ? ' on' : '')} onClick={() => setTab(k)}>{t}{n > 0 && <b>{n}</b>}</button>)}</nav>
      {tab === 'equipo' && <TabEquipo B={B} ver={verDetalle} />}
      {tab === 'tthh' && <TabTTHH B={B} ver={verDetalle} />}
      {tab === 'saldos' && <TabSaldos B={B} aviso={aviso} recargar={recargar} />}
      {tab === 'tipos' && <TabTipos B={B} aviso={aviso} setTipos={(tipos) => setB({ ...B, tipos })} />}
      {tab === 'config' && <TabConfig B={B} aviso={aviso} recargar={recargar} />}
      {tab === 'aud' && <TabAud B={B} />}
      {!T.length && <div className="empty">Sin acceso.</div>}
    </>
  )
}

function TabEquipo({ B, ver }: { B: Bandeja; ver: (id: string) => void }) {
  const [f, setF] = useState('pend')
  const L = B.equipo
  const vis = L.filter((s) => f === 'todas' || (f === 'pend' ? s.estado === 'Pendiente jefe' : f === 'curso' ? s.estado === 'Pendiente TTHH' : !pendiente(s)))
  return (
    <>
      <div className="chips">{[['pend', 'Por aprobar', L.filter((s) => s.estado === 'Pendiente jefe').length], ['curso', 'En TTHH', L.filter((s) => s.estado === 'Pendiente TTHH').length], ['cerr', 'Cerradas', L.filter((s) => !pendiente(s)).length], ['todas', 'Historial completo', L.length]].map(([k, t, n]) =>
        <button key={k} className={'chip' + (k === f ? ' on' : '')} onClick={() => setF(String(k))}>{t} ({n})</button>)}</div>
      <TablaSol lista={vis} conJefe={false} ver={ver} />
      <section className="card"><h3><Users />Mi equipo ({B.miEquipo.length})</h3>
        {B.miEquipo.length ? <div className="tw"><table className="t rs"><thead><tr><th>Empleado</th><th>Cargo</th><th>Estado laboral</th><th>Vacaciones disponibles</th><th>En trámite</th></tr></thead><tbody>
          {B.miEquipo.map((x) => <tr key={x.id}><td data-l="Empleado">{x.nombre}</td><td data-l="Cargo">{x.cargo || '—'}</td><td data-l="Estado laboral">{x.estadoLaboral}</td><td data-l="Disponibles" className="n">{n2(x.disponibles)}</td><td data-l="En trámite" className="n">{n2(x.comprometidos)}</td></tr>)}
        </tbody></table></div> : <div className="empty">No tienes personal asignado.</div>}
      </section>
    </>
  )
}

function TabTTHH({ B, ver }: { B: Bandeja; ver: (id: string) => void }) {
  const L = useMemo(() => B.todas ?? [], [B.todas])
  const [F, setF] = useState({ est: 'pend', q: '', dep: '', jefe: '', tipo: '', desde: '', hasta: '' })
  const deps = useMemo(() => [...new Set(L.map((s) => s.departamento).filter(Boolean))].sort(), [L])
  const jefes = useMemo(() => [...new Set(L.map((s) => s.jefeNombre).filter(Boolean))].sort(), [L])
  const tipos = useMemo(() => [...new Set(L.map(tipoTxt))].sort(), [L])
  const q = norm(F.q)
  const vis = L.filter((s) => {
    if (F.est === 'pend' && s.estado !== 'Pendiente TTHH') return false
    if (F.est === 'jefe' && s.estado !== 'Pendiente jefe') return false
    if (F.est === 'ap' && s.estado !== 'Aprobada') return false
    if (F.est === 're' && s.estado !== 'Rechazada' && s.estado !== 'Cancelada') return false
    if (F.dep && s.departamento !== F.dep) return false
    if (F.jefe && s.jefeNombre !== F.jefe) return false
    if (F.tipo && tipoTxt(s) !== F.tipo) return false
    if (F.desde && (s.fechaFin || s.fechaInicio || '') < F.desde) return false
    if (F.hasta && (s.fechaInicio || '') > F.hasta) return false
    if (q && !norm([s.codigo, s.empleadoNombre, s.cedula, s.motivo, s.subtipo].join(' ')).includes(q)) return false
    return true
  })
  return (
    <>
      <div className="chips">{[['pend', 'Por validar', L.filter((s) => s.estado === 'Pendiente TTHH').length], ['jefe', 'Con el jefe', L.filter((s) => s.estado === 'Pendiente jefe').length], ['ap', 'Aprobadas', L.filter((s) => s.estado === 'Aprobada').length], ['re', 'Rechazadas / canceladas', L.filter((s) => s.estado === 'Rechazada' || s.estado === 'Cancelada').length], ['todas', 'Todas', L.length]].map(([k, t, n]) =>
        <button key={k} className={'chip' + (k === F.est ? ' on' : '')} onClick={() => setF({ ...F, est: String(k) })}>{t} ({n})</button>)}</div>
      <div className="flt">
        <input className="inp" placeholder="Buscar empleado, Nº o motivo" value={F.q} onChange={(e) => setF({ ...F, q: e.target.value })} />
        <select className="inp" value={F.dep} onChange={(e) => setF({ ...F, dep: e.target.value })}><option value="">Todos los departamentos</option>{deps.map((d) => <option key={d}>{d}</option>)}</select>
        <select className="inp" value={F.jefe} onChange={(e) => setF({ ...F, jefe: e.target.value })}><option value="">Todos los jefes</option>{jefes.map((d) => <option key={d}>{d}</option>)}</select>
        <select className="inp" value={F.tipo} onChange={(e) => setF({ ...F, tipo: e.target.value })}><option value="">Todos los tipos</option>{tipos.map((d) => <option key={d}>{d}</option>)}</select>
        <label className="f">Desde<input className="inp" type="date" value={F.desde} onChange={(e) => setF({ ...F, desde: e.target.value })} /></label>
        <label className="f">Hasta<input className="inp" type="date" value={F.hasta} onChange={(e) => setF({ ...F, hasta: e.target.value })} /></label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span className="note" style={{ margin: 0 }}>{vis.length} solicitud(es)</span><button className="btn" onClick={() => exportarCsv(vis)}><Download />Exportar CSV</button></div>
      <TablaSol lista={vis} conJefe ver={ver} />
    </>
  )
}

function TabSaldos({ B, aviso, recargar }: { B: Bandeja; aviso: Aviso; recargar: () => Promise<void> }) {
  const E = B.empleados ?? []
  const [q, setQ] = useState('')
  const [solo, setSolo] = useState(false)
  const [pedir, setPedir] = useState<Pedido | null>(null)
  const nq = norm(q)
  const vis = E.filter((x) => (!nq || norm(x.nombre + ' ' + x.departamento + ' ' + x.cedula).includes(nq)) && (!solo || !x.fechaIngreso || !x.jefeVinculado))
  const ajustar = (x: EmpSaldo) => setPedir({
    titulo: 'Ajustar saldo · ' + x.nombre, etiqueta: 'Motivo del ajuste (mín. 10 caracteres)', minimo: 10, info: <div className="info">Disponibles hoy: <b>{n2(x.disponibles)}</b> día(s).</div>,
    campos: [{ k: 'dias', tipo: 'num', label: 'Días (+ suma, − resta) *' }],
    ok: async (t, v) => {
      const { error } = await supabase.rpc('th_ajustar_saldo', { p_empleado: x.id, p_dias: Number(v.dias), p_motivo: t })
      if (error) throw error
      aviso('Ajuste registrado.'); await recargar()
    },
  })
  return (
    <>
      <div className="flt" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}><input className="inp" placeholder="Buscar empleado o departamento" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="sw"><input type="checkbox" checked={solo} onChange={(e) => setSolo(e.target.checked)} />Solo con datos incompletos</label></div>
      <div className="tw"><table className="t rs"><thead><tr><th>Empleado</th><th>Departamento</th><th>Jefe inmediato</th><th>Ingreso</th><th>Antigüedad</th><th>Acumulados</th><th>Utilizados</th><th>Disponibles</th><th>En trámite</th><th></th></tr></thead><tbody>
        {vis.map((x) => <tr key={x.id}>
          <td data-l="Empleado"><b>{x.nombre}</b>{!x.activo && <> <span className="tag">Inactivo</span></>}<div className="note" style={{ margin: 0 }}>{x.cargo}</div></td>
          <td data-l="Departamento">{x.departamento || '—'}</td>
          <td data-l="Jefe">{x.jefeVinculado ? x.jefeNombre : <span className="tag r">Sin jefe</span>}</td>
          <td data-l="Ingreso">{x.fechaIngreso ? fFecha(x.fechaIngreso) : <span className="tag r">Falta</span>}</td><td data-l="Antigüedad">{x.antiguedad}</td>
          <td data-l="Acumulados" className="n">{n2(x.acumulados)}</td><td data-l="Utilizados" className="n">{n2(x.utilizados)}</td><td data-l="Disponibles" className="n"><b>{n2(x.disponibles)}</b></td><td data-l="En trámite" className="n">{n2(x.comprometidos)}</td>
          <td data-l="">{B.roles.validaTTHH && <button className="btn bsm" onClick={() => ajustar(x)}>Ajustar</button>}</td></tr>)}
      </tbody></table></div>
      <p className="note">Fecha de ingreso, jefe inmediato y saldo inicial se configuran en el módulo Empleados (Datos laborales).</p>
      <section className="card"><h3><History />Últimos movimientos de saldo</h3>
        {(B.movimientos ?? []).length ? <div className="tw" style={{ maxHeight: 360 }}><table className="t rs"><thead><tr><th>Fecha</th><th>Empleado</th><th>Tipo</th><th>Días</th><th>Solicitud</th><th>Motivo</th><th>Usuario</th></tr></thead><tbody>
          {(B.movimientos ?? []).map((m) => <tr key={m.id}><td data-l="Fecha">{fFH(m.fecha)}</td><td data-l="Empleado">{m.empleadoNombre}</td><td data-l="Tipo">{m.tipo}</td><td data-l="Días" className="n">{m.dias > 0 ? '+' : ''}{n2(m.dias)}</td>
            <td data-l="Solicitud">{m.solicitud || '—'}</td><td data-l="Motivo">{m.motivo}</td><td data-l="Usuario">{m.usuario}</td></tr>)}
        </tbody></table></div> : <div className="empty">Sin movimientos todavía.</div>}
      </section>
      {pedir && <DialogoPedir p={pedir} cerrar={() => setPedir(null)} aviso={aviso} />}
    </>
  )
}

function TabTipos({ B, aviso, setTipos }: { B: Bandeja; aviso: Aviso; setTipos: (t: Tipo[]) => void }) {
  const T = B.tipos ?? []
  const [ed, setEd] = useState<Partial<Tipo> | null>(null)
  return (
    <>
      {B.roles.validaTTHH && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn bp" onClick={() => setEd({ activo: true, remunerado: true, clase: 'Beneficio interno' })}><Plus />Nuevo tipo</button></div>}
      <div className="tw"><table className="t rs"><thead><tr><th>Tipo</th><th>Clase</th><th>Remunerado</th><th>Documento</th><th>Duración máx.</th><th>Afecta vacaciones</th><th>Autorización especial</th><th>Confidencial</th><th>Estado</th><th></th></tr></thead><tbody>
        {T.map((t) => <tr key={t.id}><td data-l="Tipo"><b>{t.nombre}</b></td><td data-l="Clase">{t.clase}</td><td data-l="Remunerado">{t.remunerado ? 'Sí' : 'No'}</td><td data-l="Documento">{t.requiereDocumento ? 'Obligatorio' : 'Opcional'}</td>
          <td data-l="Duración máx.">{t.duracionMax ? `${t.duracionMax} ${t.unidadMax}` : 'Sin límite'}</td><td data-l="Afecta vacaciones">{t.afectaVacaciones ? <span className="tag v">Sí</span> : 'No'}</td>
          <td data-l="Autorización">{t.autorizacionEspecial ? 'Sí' : 'No'}</td><td data-l="Confidencial">{t.confidencial ? 'Sí' : 'No'}</td><td data-l="Estado">{t.activo ? 'Activo' : <span className="tag">Inactivo</span>}</td>
          <td data-l="">{B.roles.validaTTHH && <button className="btn bsm" onClick={() => setEd(t)}>Editar</button>}</td></tr>)}
      </tbody></table></div>
      <p className="note">"Afecta vacaciones" descuenta del saldo al aprobarse: actívalo solo si existe una regla legal o una política interna que lo respalde. Los permisos confidenciales (p. ej. médicos) ocultan el motivo y el documento al jefe.</p>
      {ed && <EditarTipo t={ed} cerrar={() => setEd(null)} aviso={aviso} guardado={(tipos) => { setTipos(tipos); setEd(null); aviso('Tipo de permiso guardado.') }} />}
    </>
  )
}

function EditarTipo({ t, cerrar, aviso, guardado }: { t: Partial<Tipo>; cerrar: () => void; aviso: Aviso; guardado: (t: Tipo[]) => void }) {
  const [d, setD] = useState({ nombre: t.nombre ?? '', clase: t.clase === 'Licencia legal' ? 'Licencia legal' : 'Beneficio interno', duracionMax: t.duracionMax ? String(t.duracionMax) : '', unidadMax: t.unidadMax ?? '',
    remunerado: !!t.remunerado, requiereDocumento: !!t.requiereDocumento, afectaVacaciones: !!t.afectaVacaciones, autorizacionEspecial: !!t.autorizacionEspecial, confidencial: !!t.confidencial, activo: t.activo !== false })
  const [ocupado, setOcupado] = useState(false)
  const ck = (k: 'remunerado' | 'requiereDocumento' | 'afectaVacaciones' | 'autorizacionEspecial' | 'confidencial' | 'activo', txt: string) =>
    <label className="sw"><input type="checkbox" checked={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.checked })} />{txt}</label>
  async function guardar() {
    if (d.afectaVacaciones && !t.afectaVacaciones && !confirm('Este tipo de permiso descontará días del saldo de vacaciones al aprobarse. Úsalo solo si existe una regla legal o una política interna válida. ¿Continuar?')) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('th_tipo_guardar', { t: { id: t.id ?? '', ...d } })
    setOcupado(false)
    if (error) { aviso(error.message); return }
    guardado((data as { tipos: Tipo[] }).tipos)
  }
  return (
    <Ventana titulo={t.id ? 'Editar tipo de permiso' : 'Nuevo tipo de permiso'} cerrar={cerrar} pie={<><button className="btn" onClick={cerrar}>Cancelar</button><button className="btn bp" disabled={ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button></>}>
      <div className="fg">
        <label className="f w">Nombre <em>*</em><input className="inp" maxLength={80} value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></label>
        <label className="f">Clase<select className="inp" value={d.clase} onChange={(e) => setD({ ...d, clase: e.target.value })}><option>Licencia legal</option><option>Beneficio interno</option></select></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="f">Duración máxima<input className="inp" type="number" min={0} placeholder="Sin límite" value={d.duracionMax} onChange={(e) => setD({ ...d, duracionMax: e.target.value })} /></label>
          <label className="f">Unidad<select className="inp" value={d.unidadMax} onChange={(e) => setD({ ...d, unidadMax: e.target.value })}><option value="">—</option><option>horas</option><option>días</option></select></label>
        </div>
        <div className="w" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          {ck('remunerado', 'Remunerado')}{ck('requiereDocumento', 'Requiere documento de respaldo')}{ck('afectaVacaciones', 'Afecta vacaciones')}
          {ck('autorizacionEspecial', 'Requiere autorización especial')}{ck('confidencial', 'Confidencial (oculto al jefe)')}{ck('activo', 'Activo')}
        </div>
      </div>
    </Ventana>
  )
}

function TabConfig({ B, aviso, recargar }: { B: Bandeja; aviso: Aviso; recargar: () => Promise<void> }) {
  const c = B.config
  const [d, setD] = useState({ conteo: c.conteo, devengo: c.devengo, diasBase: String(c.diasBase), adicionalDesdeAnio: String(c.adicionalDesdeAnio), adicionalMax: String(c.adicionalMax),
    horasPorDia: String(c.horasPorDia), diasMinAnticipacion: String(c.diasMinAnticipacion || 0), correo: c.correo !== false, feriados: (c.feriados || []).join('\n') })
  const [ocupado, setOcupado] = useState(false)
  async function guardar() {
    if (!confirm('¿Guardar la configuración? Cambia cómo se calculan los saldos de todos los empleados desde ahora.')) return
    setOcupado(true)
    const { error } = await supabase.rpc('th_config_guardar', { c: d })
    setOcupado(false)
    if (error) { aviso(error.message); return }
    aviso('Configuración guardada.'); await recargar()
  }
  const num = (k: 'diasBase' | 'adicionalDesdeAnio' | 'adicionalMax' | 'horasPorDia' | 'diasMinAnticipacion', t: string) =>
    <label className="f">{t}<input className="inp" type="number" min={0} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} /></label>
  return (
    <section className="card"><h3><Settings />Reglas de vacaciones</h3>
      <div className="vm-sol-ovl" style={{ position: 'static', background: 'none', padding: 0, display: 'block', overflow: 'visible', zIndex: 'auto' }}>
        <div className="fg">
          <label className="f">Cómo se cuentan los días<select className="inp" value={d.conteo} onChange={(e) => setD({ ...d, conteo: e.target.value })}><option value="calendario">Días calendario (Art. 69, incluye no laborables)</option><option value="laborables">Solo días laborables (sin fines de semana ni feriados)</option></select></label>
          <label className="f">Cómo se acumulan<select className="inp" value={d.devengo} onChange={(e) => setD({ ...d, devengo: e.target.value })}><option value="anual">Al cumplir cada año de servicio</option><option value="proporcional">Proporcional (día a día)</option></select></label>
          {num('diasBase', 'Días por año de servicio')}{num('adicionalDesdeAnio', 'Día adicional desde el año')}{num('adicionalMax', 'Máximo de días adicionales')}
          {num('horasPorDia', 'Horas por día (permisos por horas)')}{num('diasMinAnticipacion', 'Anticipación mínima para vacaciones (días)')}
          <label className="sw" style={{ alignSelf: 'end' }}><input type="checkbox" checked={d.correo} onChange={(e) => setD({ ...d, correo: e.target.checked })} />Enviar también por correo (cuando el correo esté conectado)</label>
          <label className="f w">Feriados (uno por línea, AAAA-MM-DD) — solo si se cuentan días laborables<textarea className="inp" style={{ minHeight: 110 }} value={d.feriados} onChange={(e) => setD({ ...d, feriados: e.target.value })} /></label>
        </div>
        <p className="note">Por defecto: Código del Trabajo, Art. 69 — 15 días por año cumplido y, desde el sexto año, 1 día adicional por año hasta 15 adicionales. Los cambios quedan en la auditoría.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button className="btn bp" disabled={ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar configuración'}</button></div>
      </div>
    </section>
  )
}

function TabAud({ B }: { B: Bandeja }) {
  const A = B.auditoria ?? []
  const [q, setQ] = useState('')
  const nq = norm(q)
  const vis = A.filter((a) => !nq || norm([a.usuario, a.accion, a.solicitud, a.empleado, a.detalle].join(' ')).includes(nq))
  return (
    <>
      <div className="flt" style={{ gridTemplateColumns: '1fr' }}><input className="inp" placeholder="Buscar usuario, acción o solicitud" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {vis.length ? <div className="tw" style={{ maxHeight: '70vh' }}><table className="t rs"><thead><tr><th>Fecha</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Solicitud</th><th>Empleado</th><th>Detalle</th></tr></thead><tbody>
        {vis.map((a, i) => <tr key={i}><td data-l="Fecha">{fFH(a.fecha)}</td><td data-l="Usuario">{a.usuario}</td><td data-l="Rol">{a.rol}</td><td data-l="Acción"><b>{a.accion}</b></td><td data-l="Solicitud">{a.solicitud || '—'}</td><td data-l="Empleado">{a.empleado || '—'}</td>
          <td data-l="Detalle"><div className="mot" title={[a.detalle, a.antes && 'Antes: ' + a.antes, a.despues && 'Después: ' + a.despues].filter(Boolean).join(' · ')}>{a.detalle || a.despues || '—'}</div></td></tr>)}
      </tbody></table></div> : <div className="empty">Sin registros.</div>}
    </>
  )
}
