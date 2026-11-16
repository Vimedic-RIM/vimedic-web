import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, MapPinned, MessageSquarePlus, RefreshCw, ScanLine, Search, Settings, X, XCircle } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { enlaceSeguimiento, mensajeSeguimiento, NOMBRE_ETAPA } from './TrackingVenta'
import '../estilos/tracking.css'

/* Módulo Trackings (Issue #38): todos los pedidos del proceso nuevo, en qué etapa están, cuánto llevan
   ahí frente al tiempo objetivo, sus errores y la configuración de tiempos. */
type Ped = {
  id: string; codigo: string; token: string; empresa: string; cliente: string; asesor: string; factura: string; venta: string; etapa: string; etapaNombre: string; area: string
  etapaDesde: string; estado: string; zona: string; instalacion: boolean; estimada: string | null; creado: string; completado: string | null; errores: number
  dias: number; objetivo: number; atrasado: boolean
}
type Cfg = { habiles: boolean; feriados: string[]; objetivos: Record<string, number>; en_ruta: { local: number; provincia: number } }
type Ev = { id: string; fecha: string; etapa: string; tipo: string; titulo: string; detalle: string | null; publico: boolean; area: string | null; por: string; lat: number | null; lng: number | null }
type Det = Ped & { eventos: Ev[]; guia: string | null; requiere_instalacion: boolean; cliente_texto: string; fecha_estimada: string | null; etapa_desde: string }
const ETAPAS_TAB = ['facturar', 'facturada', 'preparacion', 'lista', 'despachada', 'en_ruta', 'entregada', 'instalacion']
const n1 = (v: number) => Number(v || 0).toLocaleString('es-EC', { maximumFractionDigits: 1 })
const fF = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('es-EC', { day: '2-digit', month: 'short' }) : '—')
const fH = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('es-EC', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const semaforo = (p: { estado: string; dias: number; objetivo: number }) => p.estado !== 'En curso' ? 'gr' : p.objetivo <= 0 ? 'ok' : p.dias > p.objetivo ? 'mal' : p.dias > p.objetivo * 0.75 ? 'amb' : 'ok'
const msgError = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : String(e))

export default function Tracking({ perfil, aviso, abrir, limpiarAbrir }: { perfil: Perfil; aviso: (t: string) => void; abrir?: string; limpiarAbrir?: () => void }) {
  const [tab, setTab] = useState<'curso' | 'atrasados' | 'completados' | 'config'>('curso')
  const [lista, setLista] = useState<Ped[] | null>(null)
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  // Enlace directo (#tracking/<id>): aviso de pedido entregado, escáner…
  useEffect(() => { if (abrir) { setAbierto(abrir); limpiarAbrir?.() } }, [abrir, limpiarAbrir])
  const editar = puede(perfil, 'tracking', 'editar')
  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('trk_lista', { p_estado: '', p_dias: 60 })
    if (e) { setError(e.message); return }
    const r = data as { pedidos: Ped[]; config: Cfg }
    setError(''); setLista(r.pedidos); setCfg(r.config)
  }, [])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { const t = window.setInterval(() => { if (document.visibilityState === 'visible') cargar() }, 60000); return () => window.clearInterval(t) }, [cargar])

  const L = useMemo(() => {
    const t = norm(q.trim())
    return (lista ?? []).filter((p) => !t || norm([p.codigo, p.cliente, p.asesor, p.factura, p.venta].join(' ')).includes(t))
  }, [lista, q])
  const curso = L.filter((p) => p.estado === 'En curso'), atrasados = curso.filter((p) => p.atrasado).sort((a, b) => (b.dias - b.objetivo) - (a.dias - a.objetivo))
  const completados = L.filter((p) => p.estado !== 'En curso')
  const conErrores = curso.filter((p) => p.errores > 0).length
  return (
    <div className="vm-trk">
      <header className="hdr"><div className="hdr-in">
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.15)', display: 'grid', placeItems: 'center' }}><MapPinned size={20} /></div>
        <div style={{ minWidth: 0, flex: 1 }}><h1>Trackings</h1><p>Seguimiento de pedidos: etapas, atrasos, errores y tiempos objetivo · {perfil.nombre}</p></div>
        <a className="btn cl" href="#escanear" title="Escanear el QR de un pedido"><ScanLine />Escanear</a>
        <button className="btn cl" onClick={cargar} title="Actualizar"><RefreshCw /></button>
      </div></header>
      <main>
        {error && <div className="card" style={{ color: '#c0392b' }}>{error}</div>}
        <div className="kpis">
          <button className={'kpi' + (tab === 'curso' ? ' on' : '')} onClick={() => setTab('curso')}><b>{curso.length}</b><span>Pedidos en curso</span></button>
          <button className={'kpi' + (atrasados.length ? ' mal' : '') + (tab === 'atrasados' ? ' on' : '')} onClick={() => setTab('atrasados')}><b>{atrasados.length}</b><span>Atrasados</span></button>
          <button className={'kpi' + (conErrores ? ' mal' : '')} onClick={() => setTab('curso')}><b>{conErrores}</b><span>En curso con errores</span></button>
          <button className={'kpi' + (tab === 'completados' ? ' on' : '')} onClick={() => setTab('completados')}><b>{completados.filter((p) => p.estado === 'Completado').length}</b><span>Completados (60 días)</span></button>
        </div>
        <div className="barra">
          <div className="tabs">{([['curso', 'Por etapa'], ['atrasados', 'Atrasados'], ['completados', 'Completados'], ['config', 'Tiempos objetivo']] as const).map(([k, t]) =>
            <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{t}</button>)}</div>
          {tab !== 'config' && <div className="buscar"><Search /><input className="inp" placeholder="Buscar pedido, cliente, asesor o factura" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
        </div>
        {!lista && !error && <div className="vacio">Cargando…</div>}
        {lista && tab === 'curso' && <Tablero lista={curso} abrir={setAbierto} />}
        {lista && tab === 'atrasados' && <Tabla lista={atrasados} abrir={setAbierto} vacio="No hay pedidos atrasados. 🎉" />}
        {lista && tab === 'completados' && <Tabla lista={completados} abrir={setAbierto} vacio="Todavía no hay pedidos completados en los últimos 60 días." />}
        {tab === 'config' && cfg && <Config cfg={cfg} editar={editar} aviso={aviso} guardado={(c) => { setCfg(c); cargar() }} />}
        {lista && !lista.length && tab !== 'config' && <p className="nota">Los pedidos aparecen aquí cuando una venta se envía a Facturación (proceso nuevo, desde el 16-nov-2026).</p>}
      </main>
      {abierto && <Detalle id={abierto} perfil={perfil} cerrar={() => setAbierto(null)} aviso={aviso} recargar={cargar} />}
    </div>
  )
}

function Tarjeta({ p, abrir }: { p: Ped; abrir: (id: string) => void }) {
  const s = semaforo(p)
  return (
    <button type="button" className={'tj ' + s} onClick={() => abrir(p.id)}>
      <b>{p.cliente || 'Cliente'}</b>
      <small>{p.codigo}{p.factura ? ' · ' + p.factura : ''}{p.asesor ? ' · ' + p.asesor : ''}</small>
      <div className="fila">
        <span className={'pill-t ' + s}>{n1(p.dias)} / {n1(p.objetivo)} d</span>
        {p.errores > 0 && <span className="pill-t mal"><AlertTriangle size={11} />{p.errores}</span>}
        {p.estimada && <small>entrega {fF(p.estimada)}</small>}
      </div>
    </button>
  )
}

function Tablero({ lista, abrir }: { lista: Ped[]; abrir: (id: string) => void }) {
  if (!lista.length) return <div className="card vacio">No hay pedidos en curso.</div>
  return (
    <div className="tablero">{ETAPAS_TAB.map((e) => {
      const c = lista.filter((p) => p.etapa === e).sort((a, b) => (b.dias - b.objetivo) - (a.dias - a.objetivo))
      const mal = c.filter((p) => p.atrasado).length
      return (
        <section key={e} className="col">
          <div className="col-h"><span>{NOMBRE_ETAPA[e]}<small>{[c[0]?.area, mal ? `${mal} atrasado${mal === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</small></span><b>{c.length}</b></div>
          <div className="col-b">{c.map((p) => <Tarjeta key={p.id} p={p} abrir={abrir} />)}{!c.length && <p className="nota" style={{ textAlign: 'center', padding: 8 }}>—</p>}</div>
        </section>)
    })}</div>
  )
}

function Tabla({ lista, abrir, vacio }: { lista: Ped[]; abrir: (id: string) => void; vacio: string }) {
  const [n, setN] = useState(100)
  if (!lista.length) return <div className="card vacio">{vacio}</div>
  return (
    <>
      <div className="tw"><table className="rs"><thead><tr><th>Pedido</th><th>Cliente</th><th>Asesor</th><th>Etapa</th><th>Días / objetivo</th><th>Errores</th><th>Entrega estimada</th></tr></thead><tbody>
        {lista.slice(0, n).map((p) => { const s = semaforo(p); return (
          <tr key={p.id} className="cl" onClick={() => abrir(p.id)}><td data-l="Pedido"><b>{p.codigo}</b><div className="nota" style={{ margin: 0 }}>{p.factura || p.venta}</div></td>
            <td data-l="Cliente">{p.cliente}</td><td data-l="Asesor">{p.asesor || '—'}</td>
            <td data-l="Etapa"><span className={'pill-t ' + (p.estado === 'Completado' ? 'ok' : p.estado === 'Cancelado' ? 'gr' : 'az')}>{p.estado === 'En curso' ? p.etapaNombre : p.estado}</span></td>
            <td data-l="Días"><span className={'pill-t ' + s}>{p.estado === 'En curso' ? `${n1(p.dias)} / ${n1(p.objetivo)} d` : fF(p.completado)}</span></td>
            <td data-l="Errores">{p.errores ? <span className="pill-t mal">{p.errores}</span> : '—'}</td><td data-l="Estimada">{fF(p.estimada)}</td></tr>) })}
      </tbody></table></div>
      {lista.length > n && <div style={{ textAlign: 'center' }}><button className="btn" onClick={() => setN(n + 100)}>Mostrar más ({lista.length - n})</button></div>}
    </>
  )
}

function Detalle({ id, perfil, cerrar, aviso, recargar }: { id: string; perfil: Perfil; cerrar: () => void; aviso: (t: string) => void; recargar: () => void }) {
  const [d, setD] = useState<Det | null>(null)
  const [error, setError] = useState('')
  const [nota, setNota] = useState({ texto: '', tipo: 'nota', publico: false })
  const [ocupado, setOcupado] = useState(false)
  const cargar = useCallback(() => { supabase.rpc('trk_detalle', { p_id: id }).then(({ data, error: e }) => { if (e) setError(e.message); else setD(data as Det) }) }, [id])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f) }, [cerrar])
  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    setOcupado(true)
    const { error: e } = await supabase.rpc(fn, args)
    setOcupado(false)
    if (e) { aviso(msgError(e)); return false }
    aviso(ok); cargar(); recargar(); return true
  }
  const editar = puede(perfil, 'tracking', 'editar'), st = puede(perfil, 'servicio_tecnico', 'editar')
  const copiar = (t: string, ok: string) => navigator.clipboard?.writeText(t).then(() => aviso(ok), () => aviso(t))
  const s = d ? semaforo({ estado: d.estado, dias: d.dias, objetivo: d.objetivo }) : 'gr'
  return (
    <div className="vm-trk-ovl" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Pedido">
        <div className="mh"><h2>{d ? `${d.codigo} · ${d.cliente_texto || 'Cliente'}` : 'Pedido'}</h2><button aria-label="Cerrar" onClick={cerrar}><X size={18} /></button></div>
        <div className="mb">
          {error && <p style={{ color: '#c0392b' }}>{error}</p>}
          {!d && !error && <p className="nota">Cargando…</p>}
          {d && <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={'pill-t ' + (d.estado === 'Completado' ? 'ok' : d.estado === 'Cancelado' ? 'gr' : 'az')}>{d.estado === 'En curso' ? d.etapaNombre : d.estado}</span>
              {d.estado === 'En curso' && <span className={'pill-t ' + s}>{n1(d.dias)} de {n1(d.objetivo)} días hábiles en esta etapa{d.atrasado ? ' · ATRASADO' : ''}</span>}
              {d.requiere_instalacion && <span className="pill-t az">Con instalación</span>}
              <span className="pill-t gr">{d.zona === 'provincia' ? 'Provincia' : 'Local / Quito'}</span>
            </div>
            <div className="datos">
              <div><small>Asesor</small><b>{d.asesor || '—'}</b></div><div><small>Venta</small><b>{d.venta || '—'}</b></div>
              <div><small>Factura</small><b>{d.factura || '—'}</b></div><div><small>Guía</small><b>{d.guia || '—'}</b></div>
              <div><small>Área responsable</small><b>{d.estado === 'En curso' ? d.area : '—'}</b></div><div><small>Entrega estimada</small><b>{fF(d.fecha_estimada)}</b></div>
              <div><small>Creado</small><b>{fH(d.creado ?? (d as unknown as { created_at: string }).created_at)}</b></div><div><small>Completado</small><b>{fH(d.completado ?? (d as unknown as { completado_en: string | null }).completado_en)}</b></div>
            </div>
            <div className="caja">
              <p style={{ margin: 0, fontWeight: 800, color: '#0e7490', fontSize: 12 }}>Enlace para el cliente</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                <button className="btn p" onClick={() => copiar(mensajeSeguimiento(d.cliente_texto, d.codigo, d.token, d.empresa), 'Mensaje copiado: pégalo en el chat del cliente.')}><Copy />Copiar mensaje</button>
                <button className="btn" onClick={() => copiar(enlaceSeguimiento(d.token), 'Enlace copiado.')}><Copy />Copiar enlace</button>
                <a className="btn" href={enlaceSeguimiento(d.token)} target="_blank" rel="noopener noreferrer"><ExternalLink />Ver como cliente</a>
              </div>
            </div>
            <h3 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 14, color: '#0b2545', margin: '4px 0 0' }}>Línea de tiempo</h3>
            <ul className="linea">{d.eventos.map((v) => (
              <li key={v.id} className={v.tipo}><b>{v.titulo}</b>{v.detalle ? <span> · {v.detalle}</span> : null}
                <small>{fH(v.fecha)}{v.por ? ' · ' + v.por : ''}{v.area ? ' · ' + v.area : ''}{v.publico ? '' : ' · interno'}{v.lat != null ? ' · ' : ''}{v.lat != null && <a href={`https://maps.google.com/?q=${v.lat},${v.lng}`} target="_blank" rel="noopener noreferrer">ver ubicación</a>}</small></li>))}</ul>
            {d.estado === 'En curso' && <div className="caja" style={{ background: '#fff', borderColor: '#e2e8f0' }}>
              <label className="f">Agregar al pedido
                <textarea className="inp" maxLength={1000} placeholder="Nota, problema o solución" value={nota.texto} onChange={(e) => setNota({ ...nota, texto: e.target.value })} /></label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                <select className="inp" style={{ width: 'auto' }} value={nota.tipo} onChange={(e) => setNota({ ...nota, tipo: e.target.value })}><option value="nota">Nota</option><option value="error">Problema (error)</option><option value="resuelto">Problema resuelto</option></select>
                {nota.tipo === 'nota' && <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, fontWeight: 600 }}><input type="checkbox" checked={nota.publico} onChange={(e) => setNota({ ...nota, publico: e.target.checked })} />Que lo vea el cliente</label>}
                <span style={{ flex: 1 }} />
                <button className="btn p" disabled={ocupado || !nota.texto.trim()} onClick={async () => { if (await rpc('trk_nota', { p_id: d.id, p_texto: nota.texto, p_tipo: nota.tipo, p_publico: nota.publico }, 'Registrado en el pedido.')) setNota({ texto: '', tipo: 'nota', publico: false }) }}><MessageSquarePlus />Agregar</button>
              </div>
            </div>}
          </>}
        </div>
        {d && d.estado === 'En curso' && <div className="mf">
          {(editar || st || puede(perfil, 'logistica', 'editar')) && app_ins(d) && <button className="btn" disabled={ocupado} onClick={() => rpc('trk_instalacion', { p_id: d.id, p_requiere: !d.requiere_instalacion }, d.requiere_instalacion ? 'Sin instalación.' : 'Marcado: requiere instalación o capacitación.')}>{d.requiere_instalacion ? 'Quitar instalación' : 'Requiere instalación'}</button>}
          {(editar || st) && d.etapa === 'instalacion' && <button className="btn p" disabled={ocupado} onClick={() => { const t = prompt('Nota de la instalación o capacitación (opcional):') ?? ''; rpc('trk_instalacion_realizada', { p_id: d.id, p_nota: t }, 'Pedido completado.') }}><CheckCircle2 />Instalación realizada</button>}
          {editar && <button className="btn no" disabled={ocupado} onClick={() => { const m = prompt('Motivo de la cancelación del pedido (mín. 5 caracteres):'); if (m) rpc('trk_cancelar', { p_id: d.id, p_motivo: m }, 'Pedido cancelado.') }}><XCircle />Cancelar pedido</button>}
        </div>}
      </div>
    </div>
  )
}
// La instalación se puede marcar o quitar hasta que el pedido se entregue.
const app_ins = (d: Det) => ['venta', 'facturar', 'facturada', 'preparacion', 'lista', 'despachada', 'en_ruta'].includes(d.etapa)

function Config({ cfg, editar, aviso, guardado }: { cfg: Cfg; editar: boolean; aviso: (t: string) => void; guardado: (c: Cfg) => void }) {
  const [c, setC] = useState({
    habiles: cfg.habiles !== false, feriados: (cfg.feriados ?? []).join('\n'),
    objetivos: { ...cfg.objetivos } as Record<string, number | string>, local: String(cfg.en_ruta?.local ?? 1), provincia: String(cfg.en_ruta?.provincia ?? 4),
  })
  const [ocupado, setOcupado] = useState(false)
  const filas: [string, string][] = [['facturar', 'Facturación emite la factura'], ['facturada', 'Bodega empieza a preparar'], ['preparacion', 'Bodega termina de preparar'], ['lista', 'Bodega despacha'], ['despachada', 'Sale a ruta o se entrega al transportista'], ['instalacion', 'Servicio Técnico instala o capacita']]
  const local = Number(c.local) || 0, prov = Number(c.provincia) || 0, desp = Number(c.objetivos.despachada) || 0
  async function guardar() {
    setOcupado(true)
    const { data, error } = await supabase.rpc('trk_config_guardar', { c: { habiles: c.habiles, feriados: c.feriados.split(/[\s,;]+/).filter(Boolean), objetivos: c.objetivos, en_ruta: { local: c.local, provincia: c.provincia } } })
    setOcupado(false)
    if (error) { aviso(error.message); return }
    aviso('Tiempos guardados. Los atrasos se recalculan desde ahora.'); guardado(data as Cfg)
  }
  return (
    <section className="card">
      <h3><Settings size={16} style={{ verticalAlign: -3 }} /> Tiempos objetivo por etapa</h3>
      <p className="nota" style={{ marginTop: 0 }}>Cuántos días puede quedarse un pedido en cada etapa antes de marcarse como atrasado. Con estos tiempos se calcula la fecha estimada que ve el cliente y el mapa de proceso del Dashboard.</p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600, margin: '8px 0 12px' }}><input type="checkbox" disabled={!editar} checked={c.habiles} onChange={(e) => setC({ ...c, habiles: e.target.checked })} />Contar solo días hábiles (lunes a viernes, sin feriados)</label>
      <div className="cfg">
        {filas.map(([k, t]) => <label key={k}><span>{NOMBRE_ETAPA[k]}<small>Hasta que: {t}</small></span>
          <input className="inp" type="number" min={0} max={60} step={0.5} disabled={!editar} value={c.objetivos[k] ?? ''} onChange={(e) => setC({ ...c, objetivos: { ...c.objetivos, [k]: e.target.value } })} /></label>)}
        <label><span>En camino · Quito / local<small>Hasta que se entrega (entrega total: {desp + local} días)</small></span><input className="inp" type="number" min={0} max={60} step={0.5} disabled={!editar} value={c.local} onChange={(e) => setC({ ...c, local: e.target.value })} /></label>
        <label><span>En camino · provincias<small>Envío por transporte (entrega total: {desp + prov} días)</small></span><input className="inp" type="number" min={0} max={60} step={0.5} disabled={!editar} value={c.provincia} onChange={(e) => setC({ ...c, provincia: e.target.value })} /></label>
      </div>
      <label className="f" style={{ display: 'block', marginTop: 12, fontSize: 12.5, fontWeight: 700, color: '#475569' }}>Feriados (AAAA-MM-DD, uno por línea)
        <textarea className="inp" style={{ minHeight: 90, marginTop: 4 }} disabled={!editar} value={c.feriados} onChange={(e) => setC({ ...c, feriados: e.target.value })} /></label>
      {editar ? <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button className="btn p" disabled={ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar tiempos'}</button></div>
        : <p className="nota">Solo quien tiene permiso de editar en Trackings cambia los tiempos.</p>}
    </section>
  )
}
