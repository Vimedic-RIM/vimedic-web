/* Botón «Escanear» de Bodega, Logística y Servicio Técnico: abre la cámara, lee el QR de la guía de despacho (o se
   escribe el código) y devuelve los registros del pedido en cada módulo (función mod_escanear) para abrirlo ahí mismo. */
import { useEffect, useRef, useState } from 'react'
import { Camera, Flashlight, Keyboard, Loader2, ScanLine, X } from 'lucide-react'
import { supabase } from '../supabase'

export type ResEscaneo = { pedido: string | null; despacho: string | null; entrega: string | null; orden: string | null; factura: string | null; cliente: string; codigo: string }
type Lector = { start: (c: unknown, o: unknown, ok: (t: string) => void, err: () => void) => Promise<unknown>; stop: () => Promise<unknown>; clear: () => void; applyVideoConstraints?: (c: unknown) => Promise<unknown> }
const libQr = () => (window as unknown as { Html5Qrcode?: new (id: string) => Lector }).Html5Qrcode
/** La librería del lector se carga solo al abrir la cámara (igual que en el escáner de pedidos). */
export const cargarLectorQr = () => libQr() ? Promise.resolve() : new Promise<void>((ok, fail) => {
  const s = document.createElement('script'); s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'; s.onload = () => ok(); s.onerror = () => fail(new Error('No se pudo cargar el lector. Revisa tu internet.')); document.head.appendChild(s)
})
const textoError = (e: unknown) => {
  const m = String((e as Error)?.message ?? e ?? '')
  if (/Permission|NotAllowed/i.test(m)) return 'El teléfono no dio permiso para usar la cámara. Actívalo en el candado de la barra de direcciones.'
  if (/NotFound|Requested device/i.test(m)) return 'No se encontró una cámara.'
  return m || 'No se pudo abrir la cámara.'
}

export async function resolverCodigo(texto: string): Promise<ResEscaneo> {
  const { data, error } = await supabase.rpc('mod_escanear', { p_texto: texto })
  if (error) throw new Error(error.message)
  return data as ResEscaneo
}

/** Botón + ventana del escáner. `alLeer` recibe el pedido encontrado (la ventana se cierra sola). */
export function BotonEscanear({ alLeer, className, texto = 'Escanear' }: { alLeer: (r: ResEscaneo) => void; className?: string; texto?: string }) {
  const [abierto, setAbierto] = useState(false)
  return <>
    <button type="button" className={className} title="Escanear el QR de la guía de despacho" onClick={() => setAbierto(true)}><ScanLine /><span className="hidden sm:inline">{texto}</span></button>
    {abierto && <VentanaEscaner cerrar={() => setAbierto(false)} alLeer={(r) => { setAbierto(false); alLeer(r) }} />}
  </>
}

export function VentanaEscaner({ cerrar, alLeer }: { cerrar: () => void; alLeer: (r: ResEscaneo) => void }) {
  const [modo, setModo] = useState<'camara' | 'manual'>('camara')
  const [manual, setManual] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')
  const ultimo = useRef({ t: '', at: 0 })
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  async function buscar(t: string) {
    const x = t.trim(); if (!x || buscando) return
    if (x === ultimo.current.t && Date.now() - ultimo.current.at < 2500) return
    ultimo.current = { t: x, at: Date.now() }
    setBuscando(true); setError('')
    try { const r = await resolverCodigo(x); try { navigator.vibrate?.(80) } catch { /* sin vibración */ } alLeer(r) }
    catch (e) { setError((e as Error).message); try { navigator.vibrate?.([60, 60, 60]) } catch { /* sin vibración */ } }
    setBuscando(false)
  }
  return (
    <div onClick={cerrar} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(15,23,42,.72)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', color: '#0f172a', textAlign: 'left' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 480, borderRadius: '20px 20px 0 0', padding: '16px 16px calc(16px + env(safe-area-inset-bottom))', maxHeight: '94vh', overflowY: 'auto', boxShadow: '0 -20px 40px -20px rgba(0,0,0,.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <ScanLine style={{ width: 20, height: 20, color: '#055c9d' }} />
          <b style={{ fontSize: 16, color: '#0b2545', flex: 1 }}>Escanear la guía del pedido</b>
          <button type="button" onClick={cerrar} aria-label="Cerrar" style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', display: 'grid', placeItems: 'center' }}><X style={{ width: 16, height: 16 }} /></button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {([['camara', 'Cámara', Camera], ['manual', 'Escribir código', Keyboard]] as const).map(([k, t, I]) => (
            <button key={k} type="button" onClick={() => setModo(k)} style={{ flex: 1, minHeight: 40, borderRadius: 10, border: '1px solid ' + (modo === k ? '#055c9d' : '#e2e8f0'), background: modo === k ? '#eef6fd' : '#fff', color: modo === k ? '#055c9d' : '#475569', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><I style={{ width: 15, height: 15 }} />{t}</button>
          ))}
        </div>
        {modo === 'camara' ? <Camara leido={buscar} pausado={buscando} />
          : <form onSubmit={(e) => { e.preventDefault(); buscar(manual) }}>
              <input autoFocus value={manual} onChange={(e) => setManual(e.target.value)} placeholder="GD-…, DSP-…, ENT-…, TRK-…, orden o factura" style={{ width: '100%', minHeight: 48, borderRadius: 12, border: '1px solid #cbd5e1', padding: '0 12px', fontSize: 16 }} />
              <button disabled={!manual.trim() || buscando} style={{ width: '100%', minHeight: 48, marginTop: 8, borderRadius: 12, border: 0, background: '#055c9d', color: '#fff', fontWeight: 800, fontSize: 15 }}>Buscar</button>
            </form>}
        {buscando && <p style={{ fontSize: 13, color: '#475569', marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 className="animate-spin" style={{ width: 16, height: 16 }} />Buscando el pedido…</p>}
        {error && <p style={{ fontSize: 13.5, color: '#c0392b', marginTop: 10, fontWeight: 600 }}>{error}</p>}
      </div>
    </div>
  )
}

function Camara({ leido, pausado }: { leido: (t: string) => void; pausado: boolean }) {
  const [error, setError] = useState('')
  const [luz, setLuz] = useState<boolean | null>(null)
  const lector = useRef<Lector | null>(null)
  const leer = useRef(leido); leer.current = leido
  const pausa = useRef(pausado); pausa.current = pausado
  const idDiv = useRef('vmEscMod' + Math.random().toString(36).slice(2, 8))
  useEffect(() => {
    let activo = true
    cargarLectorQr().then(() => {
      if (!activo) return
      const esc = new (libQr()!)(idDiv.current); lector.current = esc
      return esc.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w: number, h: number) => { const m = Math.min(w, h) * 0.75; return { width: Math.min(280, m), height: Math.min(280, m) } } },
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
    <div>
      <div id={idDiv.current} style={{ width: '100%', minHeight: 260, borderRadius: 14, overflow: 'hidden', background: '#0b2545' }} />
      {error ? <p style={{ color: '#c0392b', fontSize: 13, margin: '10px 2px 0' }}>{error} Puedes escribir el código en «Escribir código».</p>
        : <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}><p style={{ fontSize: 12, color: '#64748b', margin: 0, flex: 1 }}>Apunta al QR de la guía de despacho o de la etiqueta del pedido.</p>
          {luz !== null && <button type="button" onClick={alternarLuz} style={{ minHeight: 36, borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', padding: '0 10px', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}><Flashlight style={{ width: 14, height: 14 }} />{luz ? 'Apagar' : 'Linterna'}</button>}</div>}
    </div>
  )
}
