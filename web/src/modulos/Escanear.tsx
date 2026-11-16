import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, ChevronRight, Flashlight, Keyboard, Loader2, MapPinned, Repeat, ScanLine, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import '../estilos/tracking.css'

/* Escáner de pedidos (Issue #38). Enlace directo: …/escanear (o …/#escanear), se puede guardar como ícono en el celular.
   Abre la cámara, lee el QR de la guía (o se escribe el código TRK / número de guía) y muestra la acción que le toca a
   la persona según su área y la etapa del pedido. Las acciones con series, fotos o firma abren el pedido en su módulo. */
type Accion = { clave: string; titulo: string; destino?: string; principal?: boolean }
type Res = {
  id: string; codigo: string; cliente: string; empresa: string; etapa: string; etapaNombre: string; estado: string; area: string; mio: boolean; acciones: Accion[]
  guia: string | null; factura: string | null; despacho: string | null; entrega: string | null; estimada: string | null; dias: number; objetivo: number; atrasado: boolean
}
type Lector = { start: (c: unknown, o: unknown, ok: (t: string) => void, err: () => void) => Promise<unknown>; stop: () => Promise<unknown>; clear: () => void; applyVideoConstraints?: (c: unknown) => Promise<unknown> }
// La librería se carga de unpkg al abrir la cámara (igual que en Bodega y Recepción).
const libQr = () => (window as unknown as { Html5Qrcode?: new (id: string) => Lector }).Html5Qrcode
const cargarLib = () => libQr() ? Promise.resolve() : new Promise<void>((ok, fail) => {
  const s = document.createElement('script'); s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'; s.onload = () => ok(); s.onerror = () => fail(new Error('No se pudo cargar el lector.')); document.head.appendChild(s)
})
const n1 = (v: number) => Number(v || 0).toLocaleString('es-EC', { maximumFractionDigits: 1 })
const textoError = (e: unknown) => {
  const m = String((e as Error)?.message ?? e ?? '')
  if (/Permission|NotAllowed/i.test(m)) return 'El teléfono no dio permiso para usar la cámara. Actívalo en el candado de la barra de direcciones.'
  if (/NotFound|Requested device/i.test(m)) return 'No se encontró una cámara.'
  return m || 'No se pudo abrir la cámara.'
}

export default function Escanear({ perfil, aviso, codigo, limpiarCodigo }: { perfil: Perfil; aviso: (t: string) => void; codigo?: string; limpiarCodigo?: () => void }) {
  const [modo, setModo] = useState<'camara' | 'manual'>('camara')
  const [res, setRes] = useState<Res | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const [hecho, setHecho] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [continuo, setContinuo] = useState(() => { try { return localStorage.getItem('vm_esc_continuo') === '1' } catch { return false } })
  const ultimo = useRef({ t: '', at: 0 })

  const buscar = useCallback(async (texto: string) => {
    const t = texto.trim(); if (!t) return
    if (t === ultimo.current.t && Date.now() - ultimo.current.at < 3000) return
    ultimo.current = { t, at: Date.now() }
    setBuscando(true); setError(''); setHecho('')
    const { data, error: e } = await supabase.rpc('trk_escanear', { p_texto: t, p_dispositivo: navigator.userAgent.slice(0, 160) })
    setBuscando(false)
    if (e) { setError(e.message); try { navigator.vibrate?.([60, 60, 60]) } catch { /* sin vibración */ } return }
    try { navigator.vibrate?.(80) } catch { /* sin vibración */ }
    setRes(data as Res)
  }, [])

  useEffect(() => { if (codigo) { buscar(codigo); limpiarCodigo?.() } }, [codigo, limpiarCodigo, buscar])

  async function accion(a: Accion) {
    if (!res) return
    if (a.destino) { window.location.hash = a.destino; return }
    setOcupado(true)
    const { data, error: e } = await supabase.rpc('trk_accion', { p_pedido: res.id, p_accion: a.clave, p_dispositivo: navigator.userAgent.slice(0, 160) })
    setOcupado(false)
    if (e) { setError(e.message); return }
    const r = data as { etapaNombre: string }
    const msg = `${res.codigo}: ${a.titulo.toLowerCase()} ✓ · ahora "${r.etapaNombre}"`
    aviso(msg); setHecho(msg)
    if (continuo) { setRes(null); ultimo.current = { t: '', at: 0 } } else { buscar(res.codigo); ultimo.current = { t: '', at: 0 } }
  }
  const otro = () => { setRes(null); setError(''); setHecho(''); ultimo.current = { t: '', at: 0 } }
  const puedeUsar = perfil.es_superadmin || ['tracking', 'bodega', 'logistica', 'servicio_tecnico', 'facturacion'].some((m) => perfil.permisos?.[m]?.includes('ver'))

  return (
    <div className="vm-trk vm-esc">
      <header className="hdr"><div className="hdr-in">
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.15)', display: 'grid', placeItems: 'center' }}><ScanLine size={20} /></div>
        <div style={{ minWidth: 0, flex: 1 }}><h1>Escanear pedido</h1><p>Apunta al QR de la guía · {perfil.nombre}</p></div>
        <a className="btn cl" href="#tracking" title="Trackings"><MapPinned /></a>
      </div></header>
      <main style={{ maxWidth: 560 }}>
        {!puedeUsar && <div className="card">Necesitas acceso a Trackings, Bodega, Logística, Servicio Técnico o Facturación para usar el escáner.</div>}
        {puedeUsar && !res && <>
          <div className="tabs">
            <button className={'tab' + (modo === 'camara' ? ' on' : '')} onClick={() => setModo('camara')}><Camera size={14} style={{ verticalAlign: -2 }} /> Cámara</button>
            <button className={'tab' + (modo === 'manual' ? ' on' : '')} onClick={() => setModo('manual')}><Keyboard size={14} style={{ verticalAlign: -2 }} /> Escribir código</button>
            <label className="tab" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={continuo} onChange={(e) => { setContinuo(e.target.checked); try { localStorage.setItem('vm_esc_continuo', e.target.checked ? '1' : '0') } catch { /* nada */ } }} /><Repeat size={14} /> Continuo</label>
          </div>
          {hecho && <div className="card" style={{ borderColor: '#bfe9dc', background: '#ecfaf5', color: '#04896f', fontWeight: 700, fontSize: 13 }}><CheckCircle2 size={16} style={{ verticalAlign: -3 }} /> {hecho}</div>}
          {modo === 'camara' && <Camara leido={buscar} pausado={buscando} />}
          {modo === 'manual' && <form className="card" onSubmit={(e) => { e.preventDefault(); buscar(manual) }}>
            <label className="nota" style={{ display: 'block', fontWeight: 700 }}>Código del pedido (TRK-…), número de guía (GD-…) o el enlace del QR</label>
            <input className="inp" style={{ marginTop: 6 }} autoFocus value={manual} onChange={(e) => setManual(e.target.value)} placeholder="TRK-2026-00001 o GD-2026-00001" />
            <button className="btn p" style={{ marginTop: 10, width: '100%' }} disabled={!manual.trim() || buscando}>Buscar</button>
          </form>}
          {buscando && <div className="vacio"><Loader2 size={18} className="animate-spin" style={{ verticalAlign: -4 }} /> Buscando el pedido…</div>}
          {error && <div className="card" style={{ color: '#c0392b', fontSize: 13.5 }}>{error}</div>}
          <p className="nota">Consejo: guarda <b>{window.location.origin}/escanear</b> como ícono en la pantalla de inicio del celular para abrir la cámara de un toque.</p>
        </>}
        {res && <Resultado r={res} ocupado={ocupado} error={error} accion={accion} otro={otro} />}
      </main>
    </div>
  )
}

function Resultado({ r, ocupado, error, accion, otro }: { r: Res; ocupado: boolean; error: string; accion: (a: Accion) => void; otro: () => void }) {
  const s = r.estado !== 'En curso' ? 'gr' : r.atrasado ? 'mal' : r.dias > r.objetivo * 0.75 ? 'amb' : 'ok'
  const principales = r.acciones.filter((a) => a.principal), otras = r.acciones.filter((a) => !a.principal)
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 17, color: '#0b2545', display: 'block' }}>{r.cliente || 'Cliente'}</b>
          <span className="nota">{r.codigo}{r.factura ? ' · factura ' + r.factura : ''}{r.guia ? ' · guía ' + r.guia : ''}</span></div>
        <button className="btn" onClick={otro} aria-label="Cerrar"><X /></button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span className={'pill-t ' + (r.estado === 'Completado' ? 'ok' : r.estado === 'Cancelado' ? 'gr' : 'az')}>{r.estado === 'En curso' ? r.etapaNombre : r.estado}</span>
        {r.estado === 'En curso' && <span className={'pill-t ' + s}>{n1(r.dias)} de {n1(r.objetivo)} días{r.atrasado ? ' · atrasado' : ''}</span>}
        {r.estado === 'En curso' && <span className="pill-t gr">Le toca a: {r.area}</span>}
      </div>
      {r.estado === 'En curso' && !r.mio && <p className="nota" style={{ margin: 0 }}>Este pedido está en <b>{r.etapaNombre}</b>: lo mueve <b>{r.area}</b>. Tu área no tiene una acción en esta etapa.</p>}
      {error && <p style={{ color: '#c0392b', fontSize: 13, margin: 0 }}>{error}</p>}
      {principales.map((a, i) => <button key={i} className="btn p" style={{ width: '100%', minHeight: 48, fontSize: 15 }} disabled={ocupado} onClick={() => accion(a)}>{ocupado && !a.destino ? <Loader2 className="animate-spin" /> : null}{a.titulo}{a.destino ? <ChevronRight /> : null}</button>)}
      {otras.map((a, i) => <button key={i} className="btn" style={{ width: '100%', justifyContent: 'space-between' }} disabled={ocupado} onClick={() => accion(a)}>{a.titulo}<ChevronRight /></button>)}
      <button className="btn" style={{ width: '100%' }} onClick={otro}><ScanLine />Escanear otro pedido</button>
    </section>
  )
}

function Camara({ leido, pausado }: { leido: (t: string) => void; pausado: boolean }) {
  const [error, setError] = useState('')
  const [luz, setLuz] = useState<boolean | null>(null)
  const lector = useRef<Lector | null>(null)
  const leer = useRef(leido); leer.current = leido
  const pausa = useRef(pausado); pausa.current = pausado
  useEffect(() => {
    let activo = true
    cargarLib().then(() => {
      if (!activo) return
      const esc = new (libQr()!)('vmEscLector'); lector.current = esc
      return esc.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w: number, h: number) => { const m = Math.min(w, h) * 0.75; return { width: Math.min(300, m), height: Math.min(300, m) } } },
        (t) => { if (!pausa.current) leer.current(t) }, () => undefined)
        .then(() => { if (activo) setLuz(false) })
    }).catch((e) => { if (activo) setError(textoError(e)) })
    return () => { activo = false; const e = lector.current; lector.current = null; if (e) e.stop().catch(() => undefined).then(() => { try { e.clear() } catch { /* nada */ } }) }
  }, [])
  async function alternarLuz() {
    const e = lector.current; if (!e?.applyVideoConstraints) return
    try { await e.applyVideoConstraints({ advanced: [{ torch: !luz }] }); setLuz(!luz) } catch { setLuz(null) }
  }
  return (
    <div className="card" style={{ padding: 10 }}>
      <div id="vmEscLector" style={{ width: '100%', minHeight: 260, borderRadius: 14, overflow: 'hidden', background: '#0b2545' }} />
      {error ? <p style={{ color: '#c0392b', fontSize: 13, margin: '10px 4px 0' }}>{error} Puedes escribir el código en "Escribir código".</p>
        : <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}><p className="nota" style={{ margin: 0, flex: 1 }}>Apunta al QR de la guía de envío o de la etiqueta del pedido.</p>
          {luz !== null && <button className="btn" onClick={alternarLuz} title="Linterna"><Flashlight />{luz ? 'Apagar' : 'Linterna'}</button>}</div>}
    </div>
  )
}
