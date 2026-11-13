import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Bell, CalendarClock, CircleX, FileText, Handshake, ImagePlus, Lock, MapPin, Paperclip, Phone, PhoneMissed, Plus, Repeat, Settings, Trash2, X } from 'lucide-react'
import { supabase } from '../supabase'

/* =====================================================================
   CRM — lo que pedía datos al cambiar de etapa en la app original
   (openContactadoModal, openObsEstadoModal, openNegModal, openPerdidoModal,
   openVisitaModal, vmNuevoIntento_) + administrar etapas, actividad reciente
   y el detalle del estado actual en la ficha.
   ===================================================================== */

export type ModoEtapa = 'contactado' | 'observacion' | 'negociacion' | 'perdido' | 'visita' | 'registro'
export type GestionRef = { tabla: 'leads' | 'cotizaciones'; id: string; nombre: string; estado: string; total?: number }

const nrm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** En el teléfono la evidencia es opcional; en computadora es obligatoria (igual que el original). */
export const esMovil = () => typeof window !== 'undefined' && (window.matchMedia('(max-width: 767px)').matches || window.matchMedia('(pointer: coarse)').matches)
export function tipoObservacion(estado: string): '' | 'sinrespuesta' | 'seguimiento' {
  const n = nrm(estado)
  if (/sin resp|no resp|sin contest|no contest|no atiend|sin contacto|no contact|no localiz/.test(n)) return 'sinrespuesta'
  if (/seguimiento/.test(n)) return 'seguimiento'
  return ''
}
export const esNegociacion = (estado: string) => /negociaci/.test(nrm(estado))
/** Etapas que llevan historial de intentos y el botón "Nuevo intento". */
export const estadoConIntento = (estado: string) => !!tipoObservacion(estado) || /negociaci|contactad/.test(nrm(estado))

const ESPERAS: [string, string][] = [['1h', '1 hora'], ['2h', '2 horas'], ['4h', '4 horas'], ['12h', '12 horas'], ['1d', '1 día'], ['2d', '2 días'], ['3d', '3 días'], ['1s', '1 semana'], ['custom', 'Otra fecha']]
const ESPERAS_NEG = ESPERAS.filter(([v]) => !['1h', '2h', '4h'].includes(v))
const MEDIOS_CONTACTO = ['Llamada', 'WhatsApp', 'Email', 'Visita', 'Redes Sociales', 'Otro']
const MEDIOS_INTENTO: [string, string][] = [['Llamada', '📞 Llamada'], ['WhatsApp', '💬 WhatsApp'], ['Email', '✉️ Email'], ['Redes Sociales', '📱 Redes'], ['Visita', '📍 Visita']]
const OBJECIONES = ['Precio', 'Forma de pago', 'Plazo de entrega', 'Comparando con competencia', 'Especificaciones técnicas', 'Necesita aprobación interna', 'Sin presupuesto por ahora', 'Garantía / servicio técnico', 'Registro sanitario / documentos', 'Otra']
const PROBABILIDADES = ['25', '50', '75', '90']
const PASOS = ['Enviar proforma ajustada', 'Llamar al decisor', 'Demostración / visita', 'Enviar ficha técnica', 'Esperar aprobación', 'Negociar descuento o forma de pago']

export function fechaDesdeOpcion(v: string, custom: string): Date | null {
  const d = new Date()
  switch (v) {
    case '1h': d.setHours(d.getHours() + 1); return d
    case '2h': d.setHours(d.getHours() + 2); return d
    case '4h': d.setHours(d.getHours() + 4); return d
    case '12h': d.setHours(d.getHours() + 12); return d
    case '1d': d.setDate(d.getDate() + 1); return d
    case '2d': d.setDate(d.getDate() + 2); return d
    case '3d': d.setDate(d.getDate() + 3); return d
    case '1s': d.setDate(d.getDate() + 7); return d
    case 'custom': return custom ? new Date(custom + 'T09:00:00') : null
    default: return null
  }
}
export const fechaTexto = (f: Date | null) => (f ? f.toLocaleString('es-EC', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'sin definir')

/** Reduce la imagen (máx. 1600 px, JPG) o valida el PDF y la sube al almacenamiento privado del CRM. Devuelve la ruta. */
export async function subirCaptura(archivo: File, gestionId: string): Promise<string> {
  const esPdf = archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name || '')
  let cuerpo: Blob = archivo, tipo = 'application/pdf', ext = 'pdf'
  if (esPdf) {
    if (archivo.size > 15 * 1024 * 1024) throw new Error('El PDF supera los 15 MB.')
  } else {
    if (!/^image\//.test(archivo.type)) throw new Error('La evidencia debe ser una imagen o un PDF.')
    const url = URL.createObjectURL(archivo)
    try {
      const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('No se pudo leer la imagen.')); i.src = url })
      const escala = Math.min(1, 1600 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * escala)); c.height = Math.max(1, Math.round(img.height * escala))
      const g = c.getContext('2d')
      if (!g) throw new Error('No se pudo procesar la imagen.')
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height)
      cuerpo = await new Promise<Blob>((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('No se pudo procesar la imagen.'))), 'image/jpeg', 0.85))
      tipo = 'image/jpeg'; ext = 'jpg'
    } finally { URL.revokeObjectURL(url) }
  }
  const ruta = `capturas/${new Date().toISOString().slice(0, 7)}/${gestionId}_${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('crm').upload(ruta, cuerpo, { contentType: tipo })
  if (error) throw new Error('No se pudo subir la evidencia: ' + error.message)
  return ruta
}

/** Recuadro para adjuntar la captura o PDF (también se puede pegar con Ctrl+V). */
export function CampoCaptura({ archivo, cambiar, obligatoria, falta }: { archivo: File | null; cambiar: (f: File | null) => void; obligatoria: boolean; falta: boolean }) {
  const [vista, setVista] = useState('')
  useEffect(() => {
    if (!archivo || !/^image\//.test(archivo.type)) { setVista(''); return }
    const u = URL.createObjectURL(archivo); setVista(u)
    return () => URL.revokeObjectURL(u)
  }, [archivo])
  useEffect(() => {
    const f = (e: ClipboardEvent) => {
      const it = Array.from(e.clipboardData?.items ?? []).find((i) => /^image\//.test(i.type))
      const file = it?.getAsFile()
      if (file) { e.preventDefault(); cambiar(file) }
    }
    document.addEventListener('paste', f)
    return () => document.removeEventListener('paste', f)
  }, [cambiar])
  const pdf = !!archivo && (archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name || ''))
  return (
    <label className={'vm-cap-drop' + (archivo ? ' has' : '') + (obligatoria ? ' vm-oblig' : '') + (falta ? ' vm-falta' : '')}>
      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => cambiar(e.target.files?.[0] ?? null)} />
      {vista ? <img src={vista} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} /> : <ImagePlus className="w-5 h-5 shrink-0" />}
      <span style={{ overflowWrap: 'anywhere' }}>
        {archivo ? (pdf ? '📄 ' : '✓ ') + (archivo.name || 'captura pegada') + ' · toca para cambiar'
          : obligatoria ? 'Adjunta captura o PDF (obligatorio) · también puedes pegarla con Ctrl+V' : 'Adjuntar captura o PDF (opcional en el teléfono)'}
      </span>
    </label>
  )
}

function Chips({ opciones, valor, poner, multiple }: { opciones: [string, string][]; valor: string | string[]; poner: (v: string) => void; multiple?: boolean }) {
  const activo = (v: string) => (multiple ? (valor as string[]).includes(v) : valor === v)
  return (
    <div className="flex flex-wrap gap-1.5">
      {opciones.map(([v, t]) => <button key={v} type="button" onClick={() => poner(v)} className={'ns-chip' + (activo(v) ? ' active' : '')}>{t}</button>)}
    </div>
  )
}

/* ============================ Formulario al cambiar de etapa ============================ */
export function FormEtapa({ g, modo, destino, titulo, boton, ayuda, cerrar, hecho, aviso }: {
  g: GestionRef; modo: ModoEtapa; destino: string; titulo?: string; boton?: string; ayuda?: string
  cerrar: () => void; hecho: (proximoISO: string | null) => void; aviso: (t: string) => void
}) {
  const tipoObs = tipoObservacion(modo === 'registro' ? g.estado : destino)
  const [medio, setMedio] = useState('')
  const [interes, setInteres] = useState('')
  const [espera, setEspera] = useState('')
  const [custom, setCustom] = useState('')
  const [obs, setObs] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [falta, setFalta] = useState(false)
  const [objeciones, setObjeciones] = useState<string[]>([])
  const [respuesta, setRespuesta] = useState('')
  const [prob, setProb] = useState('')
  const [paso, setPaso] = useState('')
  const [cierre, setCierre] = useState('')
  const [decisor, setDecisor] = useState('')
  const [fecha, setFecha] = useState('')
  const [hora, setHora] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const pideCaptura = modo !== 'perdido' && modo !== 'visita'
  const obligatoria = pideCaptura && !esMovil()
  const cambiarArchivo = useCallback((f: File | null) => { setArchivo(f); if (f) setFalta(false) }, [])
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape' && !guardando) cerrar() }; document.addEventListener('keydown', f); return () => document.removeEventListener('keydown', f) }, [cerrar, guardando])

  const cabecera = modo === 'contactado' ? { t: 'Pasar a Contactado', I: Phone, fondo: '' }
    : modo === 'negociacion' ? { t: 'Pasar a ' + destino, I: Handshake, fondo: '' }
    : modo === 'perdido' ? { t: 'Motivo de la pérdida', I: CircleX, fondo: 'linear-gradient(135deg,#7f1d1d,#b91c1c)' }
    : modo === 'visita' ? { t: 'Programar visita', I: MapPin, fondo: 'linear-gradient(135deg,#4c1d95,#7c3aed)' }
    : modo === 'registro' ? { t: titulo || 'Nuevo intento · ' + g.estado, I: Repeat, fondo: tipoObs === 'sinrespuesta' ? 'linear-gradient(135deg,#7c2d12,#b45309 50%,#c98a1f)' : '' }
    : { t: 'Pasar a ' + destino, I: tipoObs === 'sinrespuesta' ? PhoneMissed : Repeat, fondo: tipoObs === 'sinrespuesta' ? 'linear-gradient(135deg,#7c2d12,#b45309 50%,#c98a1f)' : '' }
  const Icono = cabecera.I

  async function guardar() {
    setError('')
    let base = ''
    let proximo: Date | null = null
    if (modo === 'contactado') {
      if (!medio) { setError('Selecciona el medio de contacto.'); return }
      if (!interes) { setError('Indica si está interesado o no.'); return }
      if (!espera) { setError('Selecciona el tiempo de espera de respuesta.'); return }
      proximo = fechaDesdeOpcion(espera, custom)
      if (!proximo) { setError('Elige hasta qué fecha esperas la respuesta.'); return }
      base = `Medio: ${medio} — Interesado: ${interes} — Espera de respuesta hasta: ${fechaTexto(proximo)}` + (obs.trim() ? ` — Observación: ${obs.trim()}` : '')
    } else if (modo === 'observacion' || modo === 'registro') {
      if (!obs.trim()) { setError('Escribe una observación.'); return }
      if (!espera) { setError('Elige cuándo será el próximo intento (obligatorio).'); return }
      proximo = fechaDesdeOpcion(espera, custom)
      if (!proximo) { setError('Elige la fecha del próximo intento.'); return }
      base = (medio ? `Intento por: ${medio} — ` : '') + `Observación: ${obs.trim()} — Próximo intento: ${fechaTexto(proximo)}`
    } else if (modo === 'negociacion') {
      if (!objeciones.length && !respuesta.trim()) { setError('Marca al menos una objeción o describe la conversación.'); return }
      if (!prob) { setError('Indica la probabilidad de cierre.'); return }
      if (!paso) { setError('Elige el próximo paso.'); return }
      if (!espera) { setError('Elige cuándo será el próximo contacto (obligatorio).'); return }
      proximo = fechaDesdeOpcion(espera, custom)
      if (!proximo) { setError('Elige la fecha del próximo contacto.'); return }
      base = 'Negociación — Objeciones: ' + (objeciones.join(', ') || 'ninguna registrada') + (respuesta.trim() ? ' — Respuesta: ' + respuesta.trim() : '')
        + ' — Probabilidad de cierre: ' + prob + '%' + (cierre ? ' — Cierre estimado: ' + cierre : '') + (decisor.trim() ? ' — Decide: ' + decisor.trim() : '')
        + ' — Próximo paso: ' + paso + ' — Próximo contacto: ' + fechaTexto(proximo)
    } else if (modo === 'perdido') {
      if (!obs.trim()) { setError('Escribe el motivo de la pérdida.'); return }
      base = obs.trim()
    } else {
      if (!fecha || !hora) { setError('Indica fecha y hora de la visita.'); return }
      base = `Visita programada: ${fecha} ${hora}` + (obs.trim() ? ` — Observación: ${obs.trim()}` : '')
    }
    if (obligatoria && !archivo) { setFalta(true); setError('Adjunta la captura o el PDF de respaldo: es obligatorio para la auditoría.'); return }

    setGuardando(true)
    let detalle = base
    if (archivo) {
      try { detalle += ' — Captura: ' + (await subirCaptura(archivo, g.id)) }
      catch (e) { detalle += ' — Captura: no se pudo subir'; aviso((e instanceof Error ? e.message : 'No se subió la evidencia') + ' · se guarda sin captura.') }
    }
    const proximoISO = proximo ? proximo.toISOString() : null
    const { error: err } = modo === 'registro'
      ? await supabase.rpc('crm_registrar_seguimiento', { p_tabla: g.tabla, p_id: g.id, p_detalle: detalle, p_proximo: proximoISO })
      : await supabase.rpc('crm_cambiar_estado', { p_tabla: g.tabla, p_id: g.id, p_estado: destino, p_detalle: detalle, p_proximo: proximoISO })
    setGuardando(false)
    if (err) { setError(err.message); return }
    hecho(proximoISO)
  }

  const placeholderObs = modo === 'registro'
    ? (ayuda ? 'Ej.: envié la proforma por WhatsApp, revisará con su jefe y responde el jueves...' : tipoObs === 'sinrespuesta' ? 'Ej.: llamé 2 veces y dejé mensaje por WhatsApp...' : 'Ej.: pidió que le escribamos el lunes con precios actualizados...')
    : tipoObs === 'sinrespuesta' ? 'Ej.: llamé 2 veces y dejé mensaje por WhatsApp...' : 'Ej.: pidió que le escribamos el lunes con precios actualizados...'

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget && !guardando) cerrar() }}>
      <div className="ns-shell nq-theme bg-slate-50 sm:rounded-3xl shadow-2xl w-full h-[100dvh] sm:h-auto sm:max-h-[92vh] flex flex-col overflow-hidden" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label={cabecera.t}>
        <div className="ns-head shrink-0 px-5 pt-4 pb-3 text-white" style={cabecera.fondo ? { background: cabecera.fondo } : undefined}>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl grid place-items-center bg-white/15 shrink-0"><Icono className="w-5 h-5" /></span>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-base leading-tight">{cabecera.t}</h3>
              <p className="text-[11px] text-white/70 truncate">{g.nombre || 'Gestión'}{g.total ? ' · $' + Number(g.total).toFixed(2) : ''}</p>
            </div>
            <button onClick={cerrar} disabled={guardando} className="ml-auto w-9 h-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 shrink-0" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {ayuda && <p className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2">{ayuda}</p>}

          {modo === 'contactado' && (
            <section className="ns-sec">
              <p className="ns-label">Medio de contacto *</p>
              <Chips opciones={MEDIOS_CONTACTO.map((m) => [m, m])} valor={medio} poner={setMedio} />
              <p className="ns-label !mt-3">¿Está interesado? *</p>
              <Chips opciones={[['Sí', 'Sí'], ['No', 'No']]} valor={interes} poner={setInteres} />
            </section>
          )}

          {(modo === 'observacion' || modo === 'registro') && tipoObs === 'sinrespuesta' && (
            <section className="ns-sec">
              <p className="ns-label">¿Cómo se intentó contactar?</p>
              <Chips opciones={MEDIOS_INTENTO} valor={medio} poner={(v) => setMedio(medio === v ? '' : v)} />
            </section>
          )}

          {modo === 'negociacion' && (
            <section className="ns-sec">
              <p className="ns-label">Objeciones del cliente</p>
              <Chips multiple opciones={OBJECIONES.map((o) => [o, o])} valor={objeciones} poner={(v) => setObjeciones((a) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]))} />
              <p className="ns-label !mt-3">¿Qué respondió? / conversación</p>
              <textarea rows={2} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} className="ns-input" placeholder="Ej.: le parece alto el precio, compara con otra marca..." />
              <p className="ns-label !mt-3">Probabilidad de cierre *</p>
              <Chips opciones={PROBABILIDADES.map((p) => [p, p + '%'])} valor={prob} poner={setProb} />
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className="block"><span className="ns-label">Cierre estimado</span><input type="date" value={cierre} onChange={(e) => setCierre(e.target.value)} className="ns-input" /></label>
                <label className="block"><span className="ns-label">¿Quién decide?</span><input value={decisor} onChange={(e) => setDecisor(e.target.value)} className="ns-input" placeholder="Ej.: Dr. Pérez (gerente)" /></label>
              </div>
              <p className="ns-label !mt-3">Próximo paso *</p>
              <Chips opciones={PASOS.map((p) => [p, p])} valor={paso} poner={setPaso} />
            </section>
          )}

          {modo === 'visita' && (
            <section className="ns-sec">
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="ns-label">Fecha *</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="ns-input" /></label>
                <label className="block"><span className="ns-label">Hora *</span><input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="ns-input" /></label>
              </div>
            </section>
          )}

          {modo !== 'negociacion' && (
            <section className="ns-sec">
              <p className="ns-label">{modo === 'perdido' ? 'Motivo de la pérdida *' : modo === 'contactado' || modo === 'visita' ? 'Observación' : 'Observación *'}</p>
              <textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)} className="ns-input" autoFocus
                placeholder={modo === 'perdido' ? 'Ej.: compró a la competencia por precio, ya no necesita el equipo...' : modo === 'visita' ? 'Ej.: llevar demo del monitor, preguntar por el jefe de área...' : placeholderObs} />
            </section>
          )}

          {(modo === 'contactado' || modo === 'observacion' || modo === 'registro' || modo === 'negociacion') && (
            <section className="ns-sec">
              <p className="ns-label">{modo === 'contactado' ? 'Tiempo de espera de respuesta *' : modo === 'negociacion' ? 'Próximo contacto *' : 'Próximo intento *'}</p>
              <Chips opciones={modo === 'negociacion' ? ESPERAS_NEG : ESPERAS} valor={espera} poner={setEspera} />
              {espera === 'custom' && <input type="date" value={custom} onChange={(e) => setCustom(e.target.value)} className="ns-input mt-2" />}
            </section>
          )}

          {pideCaptura && (
            <section className="ns-sec">
              <p className="ns-label">Evidencia (captura o PDF){obligatoria ? ' *' : ''}</p>
              <CampoCaptura archivo={archivo} cambiar={cambiarArchivo} obligatoria={obligatoria} falta={falta} />
            </section>
          )}
        </div>

        <div className="shrink-0 px-4 py-3 border-t border-slate-200 bg-white flex items-center gap-3">
          <p className="text-[11px] flex-1" style={{ color: error ? '#c0392b' : '#64748b' }}>{error || (modo === 'registro' ? 'No cambia la etapa: queda en el historial.' : 'Queda registrado en el historial de la gestión.')}</p>
          <button onClick={guardar} disabled={guardando} className="ns-submit !w-auto px-6">{guardando ? 'Guardando…' : boton || (modo === 'registro' ? 'Guardar intento' : modo === 'perdido' ? 'Marcar como Perdido' : 'Guardar y mover')}</button>
        </div>
      </div>
    </div>
  )
}

/* ============================ Administrar etapas del pipeline ============================ */
const PROTEGIDAS = ['Nuevo', 'Ganado', 'Perdido']
export function EditorEtapas({ etapas, conteo, colorEstado, cerrar, guardado }: {
  etapas: string[]; conteo: (e: string) => number; colorEstado: (e: string) => string; cerrar: () => void; guardado: () => void
}) {
  const [lista, setLista] = useState(etapas)
  const [nueva, setNueva] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  function mover(i: number, d: number) {
    const j = i + d
    if (j < 0 || j >= lista.length) return
    setLista((a) => { const b = a.slice(); [b[i], b[j]] = [b[j], b[i]]; return b })
  }
  function agregar() {
    const n = nueva.trim()
    if (!n) return
    if (lista.some((x) => x.toLowerCase() === n.toLowerCase())) { setError('Esa etapa ya existe.'); return }
    if (n.length > 40) { setError('Máximo 40 caracteres.'); return }
    // Las nuevas se agregan antes de Ganado / Perdido para que esas dos sigan al final.
    setLista((a) => { const k = a.findIndex((x) => x === 'Ganado' || x === 'Perdido'); const b = a.slice(); b.splice(k < 0 ? b.length : k, 0, n); return b })
    setNueva(''); setError('')
  }
  async function guardar() {
    setGuardando(true); setError('')
    const { error: err } = await supabase.rpc('crm_guardar_etapas', { p_etapas: lista })
    setGuardando(false)
    if (err) { setError(err.message); return }
    guardado()
  }
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="ns-shell nq-theme bg-slate-50 sm:rounded-3xl shadow-2xl w-full h-[100dvh] sm:h-auto sm:max-h-[92vh] flex flex-col overflow-hidden" style={{ maxWidth: 460 }} role="dialog" aria-modal="true" aria-label="Etapas del pipeline">
        <div className="ns-head shrink-0 px-5 pt-4 pb-3 text-white">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl grid place-items-center bg-white/15 shrink-0"><Settings className="w-5 h-5" /></span>
            <div className="min-w-0"><h3 className="font-display font-bold text-base leading-tight">Etapas del pipeline</h3><p className="text-[11px] text-white/70">Agrega, quita u ordena las columnas del CRM.</p></div>
            <button onClick={cerrar} className="ml-auto w-9 h-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {lista.map((e, i) => {
            const prot = PROTEGIDAS.includes(e), n = conteo(e)
            return (
              <div key={e} className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorEstado(e) }} />
                <span className="text-xs font-semibold text-slate-700 flex-grow truncate">{e}</span>
                {n > 0 && <span className="text-[10px] text-slate-400 shrink-0" title="Gestiones en esta etapa">{n}</span>}
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className="w-7 h-7 rounded-lg grid place-items-center text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Subir"><ArrowUp className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => mover(i, 1)} disabled={i === lista.length - 1} className="w-7 h-7 rounded-lg grid place-items-center text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Bajar"><ArrowDown className="w-3.5 h-3.5" /></button>
                {prot
                  ? <span className="w-7 h-7 grid place-items-center text-slate-300" title="Etapa obligatoria"><Lock className="w-3.5 h-3.5" /></span>
                  : <button type="button" onClick={() => setLista((a) => a.filter((x) => x !== e))} disabled={n > 0} title={n > 0 ? 'Tiene gestiones: muévelas antes de quitarla' : 'Quitar etapa'} className="w-7 h-7 rounded-lg grid place-items-center text-red-500 hover:bg-red-50 disabled:opacity-25" aria-label="Quitar"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            )
          })}
          <div className="flex gap-2 pt-2">
            <input value={nueva} onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') agregar() }} placeholder="Nombre de la etapa nueva" className="ns-input" maxLength={40} />
            <button type="button" onClick={agregar} className="shrink-0 text-xs font-bold px-3 rounded-xl text-white flex items-center gap-1" style={{ background: 'var(--acc)' }}><Plus className="w-3.5 h-3.5" />Agregar</button>
          </div>
          <p className="text-[10.5px] text-slate-500">Nuevo, Ganado y Perdido son obligatorias. Una etapa con gestiones no se puede quitar hasta mover sus tarjetas.</p>
        </div>
        <div className="shrink-0 px-4 py-3 border-t border-slate-200 bg-white flex items-center gap-3">
          <p className="text-[11px] flex-1" style={{ color: error ? '#c0392b' : '#64748b' }}>{error || 'Los cambios se ven al instante en el pipeline de todos.'}</p>
          <button onClick={guardar} disabled={guardando} className="ns-submit !w-auto px-6">{guardando ? 'Guardando…' : 'Guardar etapas'}</button>
        </div>
      </div>
    </div>
  )
}

/* ============================ Actividad reciente (campana del encabezado) ============================ */
type Actividad = { id: string; fecha: string; tipo: string; nota: string | null; usuario_texto: string | null; key: string; nombre: string }
const CLAVE_VISTO = (empresa: string) => 'vm_crm_actividad_vista_' + empresa
export function leerVisto(empresa: string): number { try { return Number(localStorage.getItem(CLAVE_VISTO(empresa))) || 0 } catch { return 0 } }
function marcarVisto(empresa: string) { try { localStorage.setItem(CLAVE_VISTO(empresa), String(Date.now())) } catch { /* sin almacenamiento */ } }

/** Interacciones recientes solo de las gestiones que la persona puede ver (el !inner aplica la misma regla de alcance de leads y cotizaciones). */
export async function cargarActividad(empresa: string, limite = 60, desde?: string): Promise<Actividad[]> {
  type Fila = { id: string; fecha: string; tipo: string; nota: string | null; usuario_texto: string | null; lead_id?: string; cotizacion_id?: string; lead?: { nombre: string | null } | null; cot?: { nombre: string | null } | null }
  let q1 = supabase.from('interacciones').select('id,fecha,tipo,nota,usuario_texto,lead_id,lead:leads!inner(nombre,empresa)').eq('lead.empresa', empresa).is('deleted_at', null).order('fecha', { ascending: false }).limit(limite)
  let q2 = supabase.from('interacciones').select('id,fecha,tipo,nota,usuario_texto,cotizacion_id,cot:cotizaciones!inner(nombre,empresa)').eq('cot.empresa', empresa).is('deleted_at', null).order('fecha', { ascending: false }).limit(limite)
  if (desde) { q1 = q1.gt('fecha', desde); q2 = q2.gt('fecha', desde) }
  const [a, b] = await Promise.all([q1, q2])
  const filas = [...((a.data ?? []) as unknown as Fila[]), ...((b.data ?? []) as unknown as Fila[])]
  return filas
    .map((f) => ({ id: f.id, fecha: f.fecha, tipo: f.tipo, nota: f.nota, usuario_texto: f.usuario_texto, key: f.lead_id ? 'leads:' + f.lead_id : 'cotizaciones:' + f.cotizacion_id, nombre: (f.lead?.nombre ?? f.cot?.nombre) || 'Sin nombre' }))
    .sort((x, y) => (x.fecha < y.fecha ? 1 : -1))
    .slice(0, limite)
}

export function ActividadReciente({ empresa, cerrar, abrir }: { empresa: string; cerrar: () => void; abrir: (key: string) => void }) {
  const [lista, setLista] = useState<Actividad[] | null>(null)
  const [visto] = useState(() => leerVisto(empresa))
  useEffect(() => { cargarActividad(empresa).then((l) => { setLista(l); marcarVisto(empresa) }) }, [empresa])
  return (
    <div id="vmAlertPanel" role="dialog" aria-label="Actividad reciente">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: '#055c9d1A', color: 'var(--primary)' }}><Bell className="w-4 h-4" /></span>
        <div className="min-w-0"><h4 className="font-display font-bold text-sm text-slate-800">Actividad reciente</h4><p className="text-[10px] text-slate-400">Lo último que pasó en tus gestiones</p></div>
        <button type="button" onClick={cerrar} className="text-slate-400 hover:text-slate-700 ml-auto" aria-label="Cerrar"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-3 space-y-2 overflow-y-auto">
        {lista === null && <p className="text-xs text-slate-400 text-center py-6">Cargando…</p>}
        {lista?.length === 0 && <p className="text-xs text-slate-400 text-center py-6">Sin actividad todavía.</p>}
        {lista?.map((a) => (
          <button key={a.id} type="button" className="w-full text-left bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 shadow-sm" style={new Date(a.fecha).getTime() > visto ? { borderColor: 'var(--cyan)', background: '#f0fbfc' } : undefined}
            onClick={() => { cerrar(); abrir(a.key) }}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-display font-bold text-xs text-slate-800 truncate">{a.nombre}</p>
              <span className="text-[9px] text-slate-400 shrink-0">{new Date(a.fecha).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <p className="text-[10px] font-bold uppercase font-mono-spec" style={{ color: 'var(--primary)' }}>{a.tipo}</p>
            {a.nota && <p className="text-[10.5px] text-slate-600 line-clamp-2" style={{ overflowWrap: 'anywhere' }}>{sinCaptura(a.nota)}</p>}
            {a.usuario_texto && <p className="text-[9.5px] text-slate-400">{a.usuario_texto}</p>}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ============================ Evidencias dentro de las notas ============================ */
const RE_CAPTURA = /\s*—\s*Captura:\s*(\S+)/
export const sinCaptura = (nota: string) => nota.replace(RE_CAPTURA, '').replace(/\s*—\s*Captura:\s*no se pudo subir/, '')

export function EnlaceEvidencia({ ruta }: { ruta: string }) {
  const [abriendo, setAbriendo] = useState(false)
  if (/^https?:\/\//.test(ruta)) return <a href={ruta} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10.5px] font-bold" style={{ color: 'var(--primary)' }}><Paperclip className="w-3 h-3" />Ver evidencia</a>
  if (!/^capturas\//.test(ruta)) return null
  return (
    <button type="button" disabled={abriendo} className="inline-flex items-center gap-1 text-[10.5px] font-bold" style={{ color: 'var(--primary)' }}
      onClick={async () => {
        setAbriendo(true)
        const ventana = window.open('', '_blank')
        const { data } = await supabase.storage.from('crm').createSignedUrl(ruta, 3600)
        setAbriendo(false)
        if (data?.signedUrl) { if (ventana) ventana.location.href = data.signedUrl; else window.open(data.signedUrl, '_blank') } else ventana?.close()
      }}>
      <Paperclip className="w-3 h-3" />{abriendo ? 'Abriendo…' : 'Ver evidencia'}
    </button>
  )
}

export function NotaConEvidencia({ nota }: { nota: string | null }) {
  if (!nota) return null
  const m = nota.match(RE_CAPTURA)
  return (
    <>
      <p className="text-xs text-slate-700 mt-0.5" style={{ overflowWrap: 'anywhere' }}>{sinCaptura(nota)}</p>
      {m && m[1] !== 'no' && <EnlaceEvidencia ruta={m[1]} />}
    </>
  )
}

/* ============================ Detalle del estado actual (ficha) ============================ */
type Inter = { id: string; fecha: string; tipo: string; nota: string | null; usuario_texto: string | null }
function esNotaDeEstado(i: Inter, estado: string) {
  if (estado === 'Contactado' && i.tipo === 'Contacto Registrado') return true
  if (estado === 'Perdido' && i.tipo === 'Lead Perdido') return true
  if (estado === 'Visita' && i.tipo === 'Visita Programada') return true
  return i.tipo === 'Cambio de Estado' && (i.nota ?? '').includes(`"${estado}"`)
}
function campos(nota: string) {
  return nota.replace(/^Estado actualizado a "[^"]*"\.\s*/, '').split(' — ').map((p) => p.trim()).filter(Boolean)
    .map((p) => { const m = p.match(/^([^:]{2,40}):\s*(.*)$/); return m ? { k: m[1].trim(), v: m[2].trim() } : { k: '', v: p } })
}
export function DetalleEstado({ historial, estado, color }: { historial: Inter[] | null; estado: string; color: string }) {
  const { nota, seg } = useMemo(() => {
    if (!historial) return { nota: null, seg: null }
    const n = historial.find((i) => esNotaDeEstado(i, estado)) ?? null
    const s = historial.find((i) => i.tipo === 'Seguimiento' && (!n || i.fecha > n.fecha)) ?? null
    return { nota: n, seg: s }
  }, [historial, estado])
  if (!historial) return null
  const bloque = (i: Inter, titulo: string, Icono: typeof CalendarClock) => {
    const cs = campos(i.nota ?? '')
    return (
      <div className="space-y-1">
        <p className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1"><Icono className="w-3 h-3" />{titulo} · <span className="font-normal normal-case">{new Date(i.fecha).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{i.usuario_texto ? ' · ' + i.usuario_texto : ''}</span></p>
        {cs.length === 0 && <p className="text-[11px] text-slate-500">Sin detalle.</p>}
        {cs.map((c, k) => c.k === 'Captura'
          ? (c.v !== 'no se pudo subir' && <div key={k}><EnlaceEvidencia ruta={c.v} /></div>)
          : <p key={k} className="text-[11.5px] text-slate-700" style={{ overflowWrap: 'anywhere' }}>{c.k && <b className="text-slate-500 font-semibold">{c.k}: </b>}{c.v}</p>)}
      </div>
    )
  }
  return (
    <div className="vm-dsec" style={{ padding: 12, borderLeft: '3px solid ' + color }}>
      <p className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 flex items-center gap-1"><FileText className="w-3 h-3" />Detalle del estado · {estado}</p>
      {nota ? bloque(nota, 'Al pasar a ' + estado, CalendarClock) : <p className="text-[11px] text-slate-400">Sin detalle registrado al pasar a este estado.</p>}
      {seg && <div className="mt-2 pt-2 border-t border-slate-100">{bloque(seg, 'Último seguimiento', Repeat)}</div>}
    </div>
  )
}
