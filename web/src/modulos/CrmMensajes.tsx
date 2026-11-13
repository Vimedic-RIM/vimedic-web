import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, Image as ImageIcon, MessageCircle, Paperclip, RefreshCw, Search, Send, Sparkles, X } from 'lucide-react'
import { supabase } from '../supabase'
import '../estilos/crm-extra.css'

/* =====================================================================
   CRM — Mensajes (Mensajeria meta.gs + bandeja del CRMDashboard original):
   conversaciones de Messenger / Instagram / WhatsApp vía Zernio, historial
   con adjuntos, responder (ventana de 24 h), redactar con IA y reasignar.
   Todo pasa por la Edge Function crm-mensajes: el navegador nunca ve la clave.
   ===================================================================== */

type Conv = { id: string; cuenta: string; canal: string; plataforma: string; nombre: string; foto: string; perfilUrl: string; ultimo: string; fecha: string; sinLeer: number; asesorId: string | null; asesor: string }
type Adj = { indice: number; tipo: string; nombre: string; vista: string; url: string }
type Msg = { id: string; saliente: boolean; fecha: string; texto: string; adjuntos: Adj[] }
type Ventana = { puedeResponder: boolean; hasta: string } | null

async function llamar<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('crm-mensajes', { body: cuerpo })
  if (error) {
    let msg = error.message
    try { const ctx = (error as { context?: Response }).context; if (ctx) { const j = await ctx.json(); if (j?.error) msg = j.error } } catch { /* sin cuerpo */ }
    throw new Error(msg)
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error)
  return data as T
}

const COLOR_CANAL: Record<string, string> = { Facebook: '#1877f2', Instagram: '#e1306c', WhatsApp: '#16a34a' }
const hora = (s: string) => {
  if (!s) return ''
  const d = new Date(s), hoy = new Date()
  return d.toDateString() === hoy.toDateString() ? d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })
}
const iniciales = (n: string) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase() || '?'

function Avatar({ c, tam = 40 }: { c: Pick<Conv, 'foto' | 'nombre' | 'canal'>; tam?: number }) {
  const [mal, setMal] = useState(false)
  return (
    <span className="relative shrink-0 grid place-items-center rounded-full text-white font-bold overflow-hidden" style={{ width: tam, height: tam, fontSize: tam * 0.32, background: COLOR_CANAL[c.canal] ?? '#055c9d' }}>
      {c.foto && !mal ? <img src={c.foto} alt="" referrerPolicy="no-referrer" onError={() => setMal(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : iniciales(c.nombre)}
    </span>
  )
}

export default function CrmMensajes({ empresa, inicial, cerrar, aviso }: { empresa: 'VIMEDIC' | 'FEMEDICS'; inicial?: string | null; cerrar: () => void; aviso: (t: string) => void }) {
  const [convs, setConvs] = useState<Conv[] | null>(null)
  const [error, setError] = useState('')
  const [veTodos, setVeTodos] = useState(false)
  const [asesores, setAsesores] = useState<{ id: string; nombre: string }[]>([])
  const [q, setQ] = useState('')
  const [canal, setCanal] = useState('')
  const [solo, setSolo] = useState<'' | 'sinLeer' | 'sinAsesor'>('')
  const [actual, setActual] = useState<string | null>(inicial ?? null)
  const [msgs, setMsgs] = useState<Msg[] | null>(null)
  const [ventana, setVentana] = useState<Ventana>(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [ia, setIa] = useState(false)
  const [iaMenu, setIaMenu] = useState(false)
  const [actualizando, setActualizando] = useState(false)
  const fin = useRef<HTMLDivElement>(null)
  const pedido = useRef(0)

  const cargarBandeja = useCallback(async () => {
    setActualizando(true)
    try {
      const r = await llamar<{ conversaciones: Conv[]; veTodos: boolean; asesores: { id: string; nombre: string }[] }>({ accion: 'bandeja' })
      setConvs(r.conversaciones); setVeTodos(r.veTodos); setAsesores(r.asesores); setError('')
    } catch (e) { setError((e as Error).message); setConvs((c) => c ?? []) }
    setActualizando(false)
  }, [])
  useEffect(() => { cargarBandeja() }, [cargarBandeja])

  const conv = useMemo(() => convs?.find((c) => c.id === actual) ?? null, [convs, actual])
  const cargarHilo = useCallback(async (c: Conv, silencioso = false) => {
    const n = ++pedido.current
    if (!silencioso) { setMsgs(null); setVentana(null) }
    try {
      const r = await llamar<{ mensajes: Msg[]; ventana: Ventana }>({ accion: 'historial', conversacion: c.id, cuenta: c.cuenta })
      if (n !== pedido.current) return
      setMsgs(r.mensajes); setVentana(r.ventana)
      if (c.sinLeer) { llamar({ accion: 'leida', conversacion: c.id, cuenta: c.cuenta }).catch(() => {}); setConvs((l) => (l ?? []).map((x) => (x.id === c.id ? { ...x, sinLeer: 0 } : x))) }
    } catch (e) { if (n === pedido.current) { setMsgs([]); aviso((e as Error).message) } }
  }, [aviso])
  useEffect(() => { if (conv) cargarHilo(conv) }, [conv?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }) }, [msgs])

  // Mensajes nuevos (webhook de Zernio → tabla mensajes) en tiempo real, en lugar de consultar cada pocos segundos.
  useEffect(() => {
    let t: number | undefined
    const canalRt = supabase.channel('crm-mensajes-' + empresa)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, (p) => {
        window.clearTimeout(t)
        t = window.setTimeout(() => { cargarBandeja(); const id = (p.new as { conversacion_id?: string }).conversacion_id; if (id && id === actual && conv) cargarHilo(conv, true) }, 800)
      })
      .subscribe()
    return () => { window.clearTimeout(t); supabase.removeChannel(canalRt) }
  }, [cargarBandeja, cargarHilo, actual, conv, empresa])

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (convs ?? []).filter((c) => (!canal || c.canal === canal) && (!solo || (solo === 'sinLeer' ? c.sinLeer > 0 : !c.asesorId)) && (!t || (c.nombre + ' ' + c.ultimo + ' ' + c.asesor).toLowerCase().includes(t)))
  }, [convs, q, canal, solo])
  const canales = useMemo(() => [...new Set((convs ?? []).map((c) => c.canal))], [convs])
  const totalSinLeer = (convs ?? []).reduce((n, c) => n + (c.sinLeer > 0 ? 1 : 0), 0)

  async function enviar() {
    if (!conv || !texto.trim() || enviando) return
    setEnviando(true)
    try {
      await llamar({ accion: 'enviar', conversacion: conv.id, cuenta: conv.cuenta, plataforma: conv.plataforma, texto: texto.trim() })
      setMsgs((m) => [...(m ?? []), { id: 'local-' + Date.now(), saliente: true, fecha: new Date().toISOString(), texto: texto.trim(), adjuntos: [] }])
      setTexto('')
      window.setTimeout(() => { if (conv) cargarHilo(conv, true) }, 1500)
    } catch (e) { aviso((e as Error).message) }
    setEnviando(false)
  }
  async function sugerir(tipo: 'rapida' | 'comercial' | 'seguimiento') {
    if (!conv) return
    setIaMenu(false); setIa(true)
    try {
      const r = await llamar<{ texto: string }>({ accion: 'sugerir', conversacion: conv.id, cuenta: conv.cuenta, tipo, empresa, nombre: conv.nombre, hilo: (msgs ?? []).slice(-20).map((m) => ({ saliente: m.saliente, texto: m.texto })) })
      setTexto(r.texto)
    } catch (e) { aviso((e as Error).message) }
    setIa(false)
  }
  async function abrirAdjunto(m: Msg, a: Adj) {
    if (!conv) return
    if (a.url) { window.open(a.url, '_blank', 'noopener'); return }
    const v = window.open('', '_blank')
    try { const r = await llamar<{ url: string }>({ accion: 'adjunto', conversacion: conv.id, cuenta: conv.cuenta, mensaje: m.id, indice: a.indice }); if (v) v.location.href = r.url; else window.open(r.url, '_blank') }
    catch (e) { v?.close(); aviso((e as Error).message) }
  }
  async function reasignar(asesorId: string) {
    if (!conv) return
    try {
      await llamar({ accion: 'reasignar', conversacion: conv.id, cuenta: conv.cuenta, asesor: asesorId || null, nombre: conv.nombre, canal: conv.canal })
      const nombre = asesores.find((a) => a.id === asesorId)?.nombre ?? ''
      setConvs((l) => (l ?? []).map((x) => (x.id === conv.id ? { ...x, asesorId: asesorId || null, asesor: nombre } : x)))
      aviso(asesorId ? 'Conversación asignada a ' + nombre + '.' : 'Conversación sin asesor.')
    } catch (e) { aviso((e as Error).message) }
  }

  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', f); return () => document.removeEventListener('keydown', f) }, [cerrar])
  const enChat = !!conv

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[65] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="ns-shell nq-theme bg-slate-50 sm:rounded-3xl shadow-2xl vm-msg-caja w-full flex flex-col overflow-hidden" style={{ maxWidth: 1180 }} role="dialog" aria-modal="true" aria-label="Mensajes">
        <div className="ns-head shrink-0 px-5 py-3 text-white">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl grid place-items-center bg-white/15 shrink-0"><MessageCircle className="w-5 h-5" /></span>
            <div className="min-w-0"><h3 className="font-display font-bold text-base leading-tight">Mensajes</h3><p className="text-[11px] text-white/70">Facebook, Instagram y WhatsApp en un solo lugar{totalSinLeer ? ` · ${totalSinLeer} sin leer` : ''}</p></div>
            <button onClick={cargarBandeja} className="ml-auto w-9 h-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 shrink-0" title="Actualizar" aria-label="Actualizar"><RefreshCw className={'w-4 h-4' + (actualizando ? ' animate-spin' : '')} /></button>
            <button onClick={cerrar} className="w-9 h-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 shrink-0" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Bandeja */}
          <aside className={'flex-col min-h-0 border-r border-slate-200 bg-white vm-msg-bandeja shrink-0 ' + (enChat ? 'hidden sm:flex' : 'flex')}>
            <div className="p-3 space-y-2 border-b border-slate-100">
              <div className="relative"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contacto o mensaje…" className="ns-input pl-9" /><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /></div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setCanal('')} className={'ns-chip' + (!canal ? ' active' : '')}>Todos</button>
                {canales.map((c) => <button key={c} type="button" onClick={() => setCanal(canal === c ? '' : c)} className={'ns-chip' + (canal === c ? ' active' : '')}>{c}</button>)}
                <button type="button" onClick={() => setSolo(solo === 'sinLeer' ? '' : 'sinLeer')} className={'ns-chip' + (solo === 'sinLeer' ? ' active' : '')}>Sin leer</button>
                {veTodos && <button type="button" onClick={() => setSolo(solo === 'sinAsesor' ? '' : 'sinAsesor')} className={'ns-chip' + (solo === 'sinAsesor' ? ' active' : '')}>Sin asesor</button>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {error && <div style={{ margin: 12 }} className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
              {convs === null && <p className="text-xs text-slate-400 text-center py-10">Cargando conversaciones…</p>}
              {convs && lista.length === 0 && !error && <p className="text-xs text-slate-400 text-center py-10">{convs.length ? 'Sin coincidencias.' : veTodos ? 'No hay conversaciones.' : 'No tienes conversaciones asignadas.'}</p>}
              {lista.map((c) => (
                <button key={c.id} type="button" onClick={() => setActual(c.id)} className="w-full text-left flex gap-2.5 px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50" style={c.id === actual ? { background: 'var(--acc-l)' } : undefined}>
                  <Avatar c={c} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><p className="text-xs font-bold text-slate-800 truncate flex-1">{c.nombre}</p><span className="text-[10px] text-slate-400 shrink-0">{hora(c.fecha)}</span></div>
                    <p className={'text-[11px] truncate ' + (c.sinLeer ? 'text-slate-800 font-semibold' : 'text-slate-500')}>{c.ultimo || '—'}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] font-bold uppercase" style={{ color: COLOR_CANAL[c.canal] ?? '#055c9d' }}>{c.canal}</span>
                      <span className="text-[10px] text-slate-400 truncate flex-1">{c.asesor || (veTodos ? 'Sin asesor' : '')}</span>
                      {c.sinLeer > 0 && <span className="px-1 rounded-full text-[10px] font-bold text-white grid place-items-center" style={{ background: '#ef4444', minWidth: 18, height: 18 }}>{c.sinLeer > 9 ? '9+' : c.sinLeer}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          {/* Conversación */}
          <section className={'flex-1 min-w-0 min-h-0 flex-col ' + (enChat ? 'flex' : 'hidden sm:flex')}>
            {!conv ? (
              <div className="flex-1 grid place-items-center text-center p-6"><div><MessageCircle className="w-10 h-10 mx-auto text-slate-300" /><p className="text-sm font-bold text-slate-500 mt-2">Elige una conversación</p><p className="text-[11px] text-slate-400">Los mensajes nuevos aparecen solos.</p></div></div>
            ) : (
              <>
                <div className="shrink-0 bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-2.5">
                  <button type="button" className="sm:hidden w-8 h-8 rounded-full grid place-items-center hover:bg-slate-100" onClick={() => setActual(null)} aria-label="Volver"><ArrowLeft className="w-4 h-4" /></button>
                  <Avatar c={conv} tam={36} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800 truncate">{conv.nombre}</p>
                    <p className="text-[10.5px] text-slate-500 truncate"><span style={{ color: COLOR_CANAL[conv.canal] ?? '#055c9d', fontWeight: 700 }}>{conv.canal}</span>{conv.asesor ? ' · ' + conv.asesor : ''}</p>
                  </div>
                  {conv.perfilUrl && <a href={conv.perfilUrl} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-full grid place-items-center hover:bg-slate-100 text-slate-500" title="Ver perfil"><ExternalLink className="w-4 h-4" /></a>}
                  {veTodos && (
                    <select value={conv.asesorId ?? ''} onChange={(e) => reasignar(e.target.value)} className="ns-input" style={{ width: 160, padding: '6px 8px', fontSize: 11 }} title="Asesor de la conversación">
                      <option value="">Sin asesor</option>
                      {asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5" style={{ background: '#f1f5f9' }}>
                  {msgs === null && <p className="text-xs text-slate-400 text-center py-8">Cargando mensajes…</p>}
                  {msgs?.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Sin mensajes todavía.</p>}
                  {msgs?.map((m) => (
                    <div key={m.id} className={'flex ' + (m.saliente ? 'justify-end' : 'justify-start')}>
                      <div className="rounded-2xl px-3 py-2 shadow-sm" style={{ maxWidth: '78%', background: m.saliente ? 'var(--acc)' : '#fff', color: m.saliente ? '#fff' : '#1e293b', borderBottomRightRadius: m.saliente ? 6 : 16, borderBottomLeftRadius: m.saliente ? 16 : 6 }}>
                        {m.texto && m.texto !== '[Multimedia]' && <p className="text-[12.5px]" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.texto}</p>}
                        {m.adjuntos.map((a) => (
                          <button key={a.indice} type="button" onClick={() => abrirAdjunto(m, a)} className="block mt-1 text-left">
                            {a.vista && /image|photo|sticker/i.test(a.tipo)
                              ? <img src={a.vista} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 10 }} />
                              : <span className="inline-flex items-center gap-1 text-[11px] font-bold underline">{/image|photo/i.test(a.tipo) ? <ImageIcon className="w-3.5 h-3.5" /> : <Paperclip className="w-3.5 h-3.5" />}{a.nombre || a.tipo || 'Archivo'}</span>}
                          </button>
                        ))}
                        <p className="text-[9.5px] mt-0.5 text-right" style={{ opacity: 0.7 }}>{m.fecha ? new Date(m.fecha).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</p>
                      </div>
                    </div>
                  ))}
                  <div ref={fin} />
                </div>

                <div className="shrink-0 bg-white border-t border-slate-200 p-2.5">
                  {ventana && !ventana.puedeResponder && (
                    <p className="text-[10.5px] mb-1.5 rounded-lg px-2 py-1" style={{ background: '#fef3c7', color: '#92400e' }}>
                      Pasaron más de 24 h desde el último mensaje del cliente: {conv.plataforma.toLowerCase() === 'facebook' ? 'se enviará como "agente humano" (Facebook lo permite hasta 7 días).' : 'la plataforma puede rechazar la respuesta hasta que el cliente vuelva a escribir.'}
                    </p>
                  )}
                  <div className="flex items-end gap-2">
                    <div className="relative shrink-0">
                      <button type="button" onClick={() => setIaMenu((v) => !v)} disabled={ia} className="h-10 px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5" style={{ borderColor: '#ddd6fe', background: '#f5f3ff', color: '#6d28d9' }} title="Redactar con IA">
                        <Sparkles className={'w-4 h-4' + (ia ? ' animate-spin' : '')} /><span className="hidden sm:inline">{ia ? 'Redactando…' : 'IA'}</span>
                      </button>
                      {iaMenu && (
                        <div style={{ bottom: 48, width: 256 }} className="absolute left-0 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden z-10">
                          <p className="text-[10px] text-slate-500 px-3 pt-2 pb-1">La IA prepara el texto. Tú decides si enviarlo.</p>
                          {([['rapida', 'Respuesta rápida', 'Breve y directa'], ['comercial', 'Respuesta comercial', 'Orienta la conversación a la venta'], ['seguimiento', 'Seguimiento', 'Retoma la conversación']] as const).map(([k, t, d]) => (
                            <button key={k} type="button" onClick={() => sugerir(k)} className="w-full text-left px-3 py-2 hover:bg-slate-50 border-t border-slate-100"><p className="text-xs font-bold text-slate-800">{t}</p><p className="text-[10.5px] text-slate-500">{d}</p></button>
                          ))}
                        </div>
                      )}
                    </div>
                    <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={1} placeholder="Escribe un mensaje…" className="ns-input flex-1" style={{ minHeight: 40, maxHeight: 140, resize: 'vertical' }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }} />
                    <button type="button" onClick={enviar} disabled={!texto.trim() || enviando} className="h-10 w-10 rounded-xl grid place-items-center text-white shrink-0 disabled:opacity-50" style={{ background: 'var(--acc)' }} aria-label="Enviar"><Send className="w-4 h-4" /></button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
